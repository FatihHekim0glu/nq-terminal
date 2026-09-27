"""Fixtures and the fake gate (TASKS 1.4).

Part 1 checks the fixture files: one tiny result.json per run shape copied from a real run, screens, series CSVs,
journals (NaN tokens, plumbing rows), a Nautilus log and an OOS log sample. Part 2 checks `fakes.py`: synthetic 1m
and 1d loaders and a fake serve that goes through the real `oos_gate.serve_bars` with a temporary log.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import sys
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest

from nq_lab import oos_gate, paper_plumbing
from nq_lab.config import OOS_LOG, ROOT
from nq_lab.nt_run import summarize

import fakes
from fakes import FIXTURES, TEST_MARKER, fixture_path, load_manifest, make_fake_serve, synthetic_loader

UTC = "UTC"
REAL_OUTPUT = ROOT / "backtests" / "output"
SHAPES = {"za_orb": "za_orb", "overnight": "overnight", "sized": "volmanaged", "dtsmom": "dtsmom"}


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=UTC)


def run_doc(key: str) -> dict:
    run_id = load_manifest()["runs"][key]
    return json.loads(fixture_path("backtests", "output", run_id, "result.json").read_text(encoding="utf-8"))


def source_of(rel: str) -> Path | None:
    src = load_manifest()["files"][rel]["source"]
    return None if src is None else ROOT / src


# ---------------------------------------------------------------- part 1: the fixture files

def test_manifest_lists_every_fixture_file_and_nothing_else():
    listed = set(load_manifest()["files"])
    on_disk = {p.relative_to(FIXTURES).as_posix() for p in FIXTURES.rglob("*") if p.is_file()} - {"manifest.json"}
    assert listed == on_disk
    for entry in load_manifest()["files"].values():
        assert entry["how"] in {"verbatim", "trimmed", "rebuilt", "synthetic"} and entry["note"]


def test_manifest_names_one_run_per_shape_and_the_strategy_matches():
    runs = load_manifest()["runs"]
    for key, strategy in SHAPES.items():
        doc = run_doc(key)
        assert doc["config"]["strategy"] == strategy
        assert doc["run_id"] == doc["config"]["run_id"] == runs[key]
    assert not any(re.search(r"_(probe|regress|haltfix)_", runs[k]) for k in SHAPES)


def key_tree(obj):
    if isinstance(obj, dict):
        return {k: key_tree(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [key_tree(obj[0])] if obj else []
    return None


def tree_diff(a, b, path="") -> list[str]:
    if isinstance(a, dict) and isinstance(b, dict):
        out = [f"{path}: keys {sorted(set(a) ^ set(b))}"] if set(a) != set(b) else []
        return out + [d for k in set(a) & set(b) for d in tree_diff(a[k], b[k], f"{path}.{k}")]
    if isinstance(a, list) and isinstance(b, list):
        return tree_diff(a[0], b[0], f"{path}[0]") if a and b else []
    return [] if (a is None) == (b is None) else [f"{path}: {type(a).__name__} vs {type(b).__name__}"]


@pytest.mark.parametrize("key", ["za_orb", "overnight", "sized", "dtsmom", "unbalanced", "nan_tokens"])
def test_each_run_keeps_the_key_tree_of_its_real_source(key):
    run_id = load_manifest()["runs"][key]
    rel = f"backtests/output/{run_id}/result.json"
    src = source_of(rel) or source_of(f"backtests/output/{load_manifest()['runs']['za_orb']}/result.json")
    if not src.exists():
        pytest.skip(f"real source {src} not on disk")
    real = json.loads(src.read_text(encoding="utf-8"))
    assert tree_diff(key_tree(run_doc(key)), key_tree(real)) == []
    assert list(run_doc(key)) == list(real), "top-level key order follows the source"


def test_key_tree_check_is_born_failing():
    doc = run_doc("sized")
    broken = copy.deepcopy(doc)
    del broken["strategy_log"]["snapshots"][0]["equity"]
    assert tree_diff(key_tree(broken), key_tree(doc)) != []


def money_sum(values) -> Decimal:
    return sum((Decimal(repr(v)) for v in values), Decimal(0))


@pytest.mark.parametrize("key", ["za_orb", "overnight", "sized", "dtsmom", "unbalanced", "nan_tokens"])
def test_run_totals_agree_with_their_trades(key):
    doc = run_doc(key)
    trades = doc["trades"]
    assert doc["n_trades"] == len(trades) == doc["summary"]["n_trades"]
    order = [(t["entry_ts"], t["exit_ts"]) for t in trades]
    assert order == sorted(order), "trades in nt_run order: by open time, then close time"
    assert Decimal(repr(doc["pnl_total"])) == money_sum(t["pnl_usd"] for t in trades)
    assert Decimal(repr(doc["fees_total"])) == money_sum(t["commissions_usd"] for t in trades)
    if key != "nan_tokens":  # the verbatim smoke run predates the current summary code
        want = summarize(trades)
        got = doc["summary"]
        assert {k: got[k] for k in got if k != "blocks"} == {k: want[k] for k in got if k != "blocks"}
        assert {b: {k: want["blocks"][b][k] for k in v} for b, v in got["blocks"].items()} == got["blocks"]


@pytest.mark.parametrize("key", ["za_orb", "overnight", "sized", "dtsmom", "nan_tokens"])
def test_balanced_runs_reconcile_to_the_cent(key):
    doc = run_doc(key)
    bc = doc["balance_check"]
    assert bc["ok"] is True and bc["diff_usd"] == 0.0 and bc["open_positions"] == 0
    assert Decimal(repr(bc["final_usd"])) - Decimal(repr(bc["starting_usd"])) == Decimal(repr(doc["pnl_total"]))


def test_the_unbalanced_run_fails_its_balance_check():
    doc = run_doc("unbalanced")
    bc = doc["balance_check"]
    assert bc["ok"] is False and bc["diff_usd"] != 0.0
    assert doc["trades"] == run_doc("za_orb")["trades"]


def _multipliers(doc: dict) -> dict:
    venue = doc["venue"]
    if "instruments" in venue:
        return {i["instrument"]: Decimal(repr(i["multiplier"])) for i in venue["instruments"]}
    return {None: Decimal(repr(venue["multiplier"]))}


def _apply_fill(f: dict, lots: dict, mult: dict) -> Decimal:
    """Apply one fill to the open lots; returns its effect on the balance (commission and realised P&L)."""
    inst, sign = f.get("instrument"), 1 if f["side"] == "BUY" else -1
    lot = lots.get(f["position_id"])
    change = -Decimal(f["commission"])
    if lot is None:
        lots[f["position_id"]] = {"inst": inst, "dir": sign, "qty": f["qty"], "px": Decimal(repr(f["px"]))}
        return change
    change += (Decimal(repr(f["px"])) - lot["px"]) * f["qty"] * mult[inst] * lot["dir"]
    lot["qty"] -= f["qty"]
    if lot["qty"] == 0:
        del lots[f["position_id"]]
    return change


def replay_problems(doc: dict) -> list[str]:
    """Independent MTM replay: balance, unrealised, equity, net qty and lots at every snapshot, from the fills."""
    mult, fills = _multipliers(doc), doc["fills"]
    places = len(doc["strategy_log"]["snapshots"][0]["balance"].split(".")[1])
    insts = doc["strategy_log"].get("instruments")
    balance, lots, i, out = Decimal(repr(doc["balance_check"]["starting_usd"])), {}, 0, []
    for s in doc["strategy_log"]["snapshots"]:
        while i < len(fills) and fills[i]["ts"] <= s["ts"]:
            balance += _apply_fill(fills[i], lots, mult)
            i += 1
        px = dict(zip(insts, s["px"])) if insts else {None: s["px"]}
        unreal = sum(((Decimal(repr(px[x["inst"]])) - x["px"]) * x["qty"] * mult[x["inst"]] * x["dir"]
                      for x in lots.values()), Decimal(0))
        got = (s["balance"], s["unrealized"], s["equity"])
        want = tuple(f"{v:.{places}f}" for v in (balance, unreal, balance + unreal))
        nets = [sum(x["qty"] * x["dir"] for x in lots.values() if x["inst"] == k) for k in (insts or [None])]
        if got != want or (s["net_qty"] != (nets if insts else nets[0])):
            out.append(f"{s['date']}: snapshot {got} net {s['net_qty']}, replay {want} net {nets}")
    if lots or i != len(fills):
        out.append(f"not flat at the end or fills after the last snapshot ({len(lots)} lots, {len(fills) - i} fills)")
    return out


@pytest.mark.parametrize("key", ["sized", "dtsmom"])
def test_sized_books_replay_exactly_from_their_fills(key):
    doc = run_doc(key)
    snaps = doc["strategy_log"]["snapshots"]
    assert replay_problems(doc) == []
    assert Decimal(snaps[-1]["equity"]) == Decimal(repr(doc["balance_check"]["final_usd"]))
    assert sum((Decimal(f["commission"]) for f in doc["fills"]), Decimal(0)) == Decimal(repr(doc["fees_total"]))
    mtm = doc["balance_check"]["mtm"]
    assert (mtm["rows"], mtm["fills"], mtm["ok"]) == (len(snaps), len(doc["fills"]), True)
    assert all(isinstance(f["ts"], int) and f["ts"] > 2**53 for f in doc["fills"]), "ns ints beyond JS safe range"
    assert {f["tags"] for f in doc["fills"]} >= {"REBAL", "ROLL", "LIQ"}


def test_replay_is_born_failing_on_a_shifted_snapshot():
    doc = copy.deepcopy(run_doc("sized"))
    snap = doc["strategy_log"]["snapshots"][3]
    snap["equity"] = f"{Decimal(snap['equity']) + Decimal('0.01'):.2f}"
    assert replay_problems(doc) != []


def test_the_nan_run_keeps_its_nan_tokens():
    rel = f"backtests/output/{load_manifest()['runs']['nan_tokens']}/result.json"
    text = fixture_path(*rel.split("/")).read_text(encoding="utf-8")
    assert "NaN" in text
    blocks = json.loads(text)["summary"]["blocks"]
    assert math.isnan(blocks["2010-2013"]["mean_net_r"]) and blocks["2014-2017"]["n"] == 20
    src = source_of(rel)
    if src.exists():
        assert text == src.read_text(encoding="utf-8")


def test_screens_are_verbatim_but_for_the_spec_hash_and_carry_their_verdicts():
    """Each screen is its real source byte for byte, except `spec_sha256`, which records the fixture spec's hash
    (the fixture specs reword references to the project rules file, so they hash differently from the real ones)."""
    for name, verdict in (("overnight_v0", "PASS"), ("volmanaged_v0", "FAIL")):
        rel = f"results/screens/{name}.json"
        raw = fixture_path(*rel.split("/")).read_bytes()
        doc = json.loads(raw.decode("utf-8"))
        spec_sha = hashlib.sha256(fixture_path("experiments", f"{name}.json").read_bytes()).hexdigest()
        assert doc["verdict"] == verdict and doc["spec_sha256"] == spec_sha
        if source_of(rel).exists():
            real = source_of(rel).read_bytes()
            real_sha = json.loads(real.decode("utf-8"))["spec_sha256"]
            assert raw.count(spec_sha.encode()) == 1
            assert raw.replace(spec_sha.encode(), real_sha.encode()) == real


def test_series_csvs_keep_the_real_header_and_are_trimmed():
    counts = {"overnight_v0_trades.csv": 12, "volmanaged_v0_daily.csv": 40, "dtsmom_v0_monthly.csv": 12}
    for name, n in counts.items():
        rel = f"results/screens/{name}"
        frame = pd.read_csv(fixture_path(*rel.split("/")))
        assert len(frame) == n
        if source_of(rel).exists():
            header = fixture_path(*rel.split("/")).read_bytes().splitlines()[0]
            assert header == source_of(rel).read_bytes().splitlines()[0]
    trades = pd.read_csv(fixture_path("results", "screens", "overnight_v0_trades.csv"))
    blocks = trades["entry_date"].str[:4].astype(int).map(lambda y: (y - 2010) // 4)
    assert blocks.value_counts().to_dict() == {0: 4, 1: 4, 2: 4}
    daily = pd.read_csv(fixture_path("results", "screens", "volmanaged_v0_daily.csv"))
    assert math.isnan(daily["r_m_1"].iloc[0]) and daily["r_m_1"].iloc[1:].notna().all()


def journal_rows(name: str) -> list[dict]:
    text = fixture_path("live", "logs", name).read_text(encoding="utf-8")
    return [json.loads(x) for x in text.splitlines() if x.strip()]


def test_the_book_journal_has_every_row_type_nan_tokens_and_one_plumbing_row():
    rows = journal_rows("volmanaged_paper_journal.jsonl")
    assert {r["type"] for r in rows} == {"warmup", "close", "skipped"}
    assert any("error" in r for r in rows)
    assert "NaN" in fixture_path("live", "logs", "volmanaged_paper_journal.jsonl").read_text(encoding="utf-8")
    assert any(isinstance(v, float) and math.isnan(v) for r in rows for v in r.values())
    assert sum(paper_plumbing.is_plumbing(r) for r in rows) == 1
    kept = paper_plumbing.performance_rows(rows)
    assert len(kept) == len(rows) - 1 and not any(paper_plumbing.is_plumbing(r) for r in kept)
    summary = paper_plumbing.exposure_summary(fixture_path("live", "logs", "volmanaged_paper_journal.jsonl"))
    assert summary == {"sessions": 1, "mean_exposure": 0.298212, "plumbing_rows_skipped": 1}


def test_plumbing_journals_are_plumbing_on_every_row():
    names = ("volmanaged_paper_journal.PLUMBING_DELAYED.jsonl", "preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl")
    for name in names:
        rows = journal_rows(name)
        paper_plumbing.check_plumbing_journal(fixture_path("live", "logs", name))
        assert rows and all(paper_plumbing.is_plumbing(r) for r in rows)
        assert paper_plumbing.performance_rows(rows) == []
    types = [r["type"] for r in journal_rows("volmanaged_paper_journal.PLUMBING_DELAYED.jsonl")]
    assert types == ["warmup", "delayed_fetch", "close"]


LOG_LINE = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}Z \[(INFO|WARN|ERROR|DEBUG)\] NQLAB-PAPER\.[\w.-]+: ")


def test_the_nautilus_log_follows_the_format_and_hides_the_account():
    text = fixture_path("live", "logs", "preflight2_2026-09-26_PLUMBING_DELAYED.log").read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines and all(LOG_LINE.match(x) for x in lines)
    assert any("\u2800" <= ch <= "\u28ff" for ch in text), "keeps the braille banner"
    assert {m for m in re.findall(r"DU[A-Z]*\d+", text)} == {"DU1234567"}
    assert {"[INFO]", "[WARN]"} <= set(re.findall(r"\[[A-Z]+\]", text))


def test_the_oos_log_sample_covers_the_four_key_sets_and_keeps_the_sealed_pin():
    path = fixture_path("results", "oos_access_log.jsonl")
    rows = [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()]
    key_sets = {frozenset(r) for r in rows}
    assert len(key_sets) == 4
    assert sum(r.get("sealed") is True for r in rows) == 2
    oos_gate.check_sealed_log_pin(path)
    oos_gate.check_openings_pin(fixture_path("results", "oos_openings.json"))
    assert [r["caller"] for r in rows[-2:]] == ["terminal", "terminal"]
    ends = [pd.Timestamp(r["end"]) for r in rows if r.get("sealed") is not True]
    assert all((e if e.tzinfo else e.tz_localize(UTC)) <= ts("2022-01-01") for e in ends)


# ---------------------------------------------------------------- part 2: synthetic loaders and the fake serve

M1_COLUMNS = ["ts", "o", "h", "l", "c", "v", "instrument_id", "raw_c", "offset"]
D1_COLUMNS = ["ts", "o_none", "h_none", "l_none", "c_none", "o_back", "h_back", "l_back", "c_back", "v",
              "instrument_id", "offset"]
# The processed files' schemas, read from parquet metadata only on 2026-09-26 (every 1m file, vendor and
# repaired, and every 1d file agree): `v` is double everywhere; `instrument_id` is int32 in 1m, int64 in 1d.
M1_DTYPES = {"ts": "datetime64[ns, UTC]", "o": "float64", "h": "float64", "l": "float64", "c": "float64",
             "v": "float64", "instrument_id": "int32", "raw_c": "float64", "offset": "float64"}
D1_DTYPES = {"ts": "datetime64[ns, UTC]", **{f"{x}_{m}": "float64" for m in ("none", "back") for x in "ohlc"},
             "v": "float64", "instrument_id": "int64", "offset": "float64"}
# data/processed/*_1m_back.parquet as listed on 2026-09-26 16:05 (names only): 24 roots, plus NQ repaired.
PROCESSED_1M_ROOTS = ("6A", "6B", "6C", "6E", "6J", "6S", "CL", "ES", "GC", "HG", "HO", "NG", "NQ", "RB", "RTY",
                      "SI", "YM", "ZB", "ZC", "ZF", "ZN", "ZS", "ZT", "ZW")


def dtypes(frame: pd.DataFrame) -> dict[str, str]:
    return {col: str(dtype) for col, dtype in frame.dtypes.items()}


def test_synthetic_1m_has_the_processed_columns_and_types():
    f = synthetic_loader("NQ.V.0", "1m", "vendor")(ts("2019-03-04"), ts("2019-03-06"))
    assert list(f.columns) == M1_COLUMNS
    assert str(f["ts"].dtype) == "datetime64[ns, UTC]"
    assert f["ts"].is_monotonic_increasing and f["ts"].is_unique
    assert f["ts"].min() >= ts("2019-03-04") and f["ts"].max() < ts("2019-03-06")
    assert (f["v"] > 0).all()
    assert 2 * 23 * 60 - 120 <= len(f) <= 2 * 24 * 60


@pytest.mark.parametrize("variant", ["vendor", "repaired"])
def test_synthetic_1m_dtypes_match_the_processed_schema(variant):
    f = synthetic_loader("NQ.V.0", "1m", variant)(ts("2019-03-04"), ts("2019-03-05"))
    assert dtypes(f) == M1_DTYPES


def test_synthetic_1d_dtypes_match_the_processed_schema():
    f = synthetic_loader("ES.V.0", "1d", "vendor")(ts("2019-03-04"), ts("2019-03-09"))
    assert dtypes(f) == D1_DTYPES


def test_the_1m_universe_mirrors_the_processed_1m_files():
    for root in PROCESSED_1M_ROOTS:
        f = synthetic_loader(f"{root}.V.0", "1m", "vendor")(ts("2019-06-03 14:00"), ts("2019-06-03 15:00"))
        assert len(f) == 60 and (f["c"] > 0).all() and dtypes(f) == M1_DTYPES, root


def test_synthetic_1m_is_the_same_however_the_window_is_split():
    load = synthetic_loader("NQ.V.0", "1m", "vendor")
    whole = load(ts("2018-06-07"), ts("2018-06-12"))
    parts = pd.concat([load(ts("2018-06-07"), ts("2018-06-08 13:31")), load(ts("2018-06-08 13:31"), ts("2018-06-12"))],
                      ignore_index=True)
    pd.testing.assert_frame_equal(whole, parts)


@pytest.mark.parametrize("symbol,tick", [("NQ.V.0", 0.25), ("ZN.V.0", 1 / 64)])
def test_synthetic_1m_bars_are_valid(symbol, tick):
    f = synthetic_loader(symbol, "1m", "vendor")(ts("2016-02-26"), ts("2016-03-02"))
    assert (f["h"] >= f[["o", "c"]].max(axis=1)).all() and (f["l"] <= f[["o", "c"]].min(axis=1)).all()
    for col in ("o", "h", "l", "c", "raw_c"):
        assert ((f[col] / tick - (f[col] / tick).round()).abs() < 1e-6).all(), col
    assert ((f["c"] - f["raw_c"] - f["offset"]).abs() < 1e-9).all()
    assert (f.groupby("instrument_id")["offset"].nunique() == 1).all()
    stamps = f["ts"].dt
    assert not (stamps.dayofweek == 5).any() and not (stamps.hour == 21).any()
    assert not ((stamps.dayofweek == 6) & (stamps.hour < 22)).any(), "Sunday opens at 22:00"
    assert not ((stamps.dayofweek == 4) & (stamps.hour >= 22)).any(), "Friday closes at 21:00"


def test_back_adjustment_is_continuous_across_a_roll_and_zero_at_the_anchor():
    load = synthetic_loader("NQ.V.0", "1m", "vendor")
    f = load(ts("2019-03-07"), ts("2019-03-13"))
    roll = f.index[f["instrument_id"].diff().fillna(0) != 0]
    assert len(roll) == 1
    k = roll[0]
    gap = f["raw_c"].iloc[k] - f["raw_c"].iloc[k - 1] - (f["c"].iloc[k] - f["c"].iloc[k - 1])
    assert abs(gap - (f["offset"].iloc[k - 1] - f["offset"].iloc[k])) < 1e-9 and abs(gap) > 0
    assert abs(f["c"].iloc[k] - f["c"].iloc[k - 1]) < 0.05 * f["c"].iloc[k]
    assert (load(ts("2026-09-23"), ts("2026-09-24"))["offset"] == 0).all()


def test_synthetic_1d_has_the_processed_columns_and_matches_the_1m_close():
    day = synthetic_loader("NQ.V.0", "1d", "vendor")(ts("2019-03-04"), ts("2019-03-11"))
    assert list(day.columns) == D1_COLUMNS and len(day) == 5
    assert (day["ts"].dt.dayofweek < 5).all() and (day["ts"].dt.hour == 0).all()
    for col in ("o", "h", "l", "c"):
        assert ((day[f"{col}_back"] - day[f"{col}_none"] - day["offset"]).abs() < 1e-9).all()
    assert (day["h_none"] >= day[["o_none", "c_none"]].max(axis=1)).all()
    assert (day["l_none"] <= day[["o_none", "c_none"]].min(axis=1)).all()
    m1 = synthetic_loader("NQ.V.0", "1m", "vendor")(ts("2019-03-05 20:59"), ts("2019-03-05 21:00"))
    assert m1["raw_c"].iloc[0] == day.loc[day["ts"] == ts("2019-03-05"), "c_none"].iloc[0]
    assert (synthetic_loader("NQ.V.0", "1d", "vendor")(ts("2021-12-30"), ts("2022-01-01"))["offset"] == 0).all()


def test_the_1d_universe_has_the_27_dtsmom_roots():
    from nq_lab.dtsmom_universe import ROOTS

    assert len(ROOTS) == 27
    for root in ROOTS:
        f = synthetic_loader(f"{root}.V.0", "1d", "vendor")(ts("2015-06-01"), ts("2015-06-06"))
        assert len(f) == 5 and (f["c_none"] > 0).all(), root


def test_repaired_has_the_same_prices_and_its_own_volume():
    a = synthetic_loader("NQ.V.0", "1m", "vendor")(ts("2012-05-01"), ts("2012-05-02"))
    b = synthetic_loader("NQ.V.0", "1m", "repaired")(ts("2012-05-01"), ts("2012-05-02"))
    pd.testing.assert_frame_equal(a.drop(columns="v"), b.drop(columns="v"))
    assert not a["v"].equals(b["v"])


@pytest.mark.parametrize("symbol,timeframe,variant", [("RTY.V.0", "1d", "vendor"), ("NQ.V.0", "1h", "vendor"),
                                                      ("ZN.V.0", "1m", "repaired"), ("NQ.V.0", "1d", "repaired"),
                                                      ("ES.V.0", "1m", "repaired"), ("XX.V.0", "1m", "vendor")])
def test_series_that_have_no_processed_file_raise_file_not_found(tmp_path, symbol, timeframe, variant):
    serve = make_fake_serve(tmp_path / "oos.jsonl")
    with pytest.raises(FileNotFoundError):
        serve(ts("2015-01-05"), ts("2015-01-06"), caller="terminal", reason="nqt fixture check",
              symbol=symbol, timeframe=timeframe, variant=variant)
    assert not (tmp_path / "oos.jsonl").exists() and serve.calls == ()


def read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def test_the_fake_serve_serves_in_sample_through_the_gate_and_logs_to_its_tmp_file(tmp_path):
    log = tmp_path / "oos.jsonl"
    serve = make_fake_serve(log)
    reason = "terminal display: NQ.V.0 1m vendor 2019 (chart only, not a registered test)"
    frame = serve(ts("2019-01-02"), ts("2019-01-04"), caller="terminal", reason=reason)
    pd.testing.assert_frame_equal(frame, synthetic_loader("NQ.V.0", "1m", "vendor")(ts("2019-01-02"), ts("2019-01-04")))
    (line,) = read_log(log)
    assert (line["caller"], line["reason"], line["rows"]) == ("terminal", reason, len(frame))
    assert (line["symbol"], line["timeframe"], line["variant"]) == ("NQ.V.0", "1m", "vendor")
    assert line["start"] == str(ts("2019-01-02")) and TEST_MARKER in json.dumps(line)
    (call,) = serve.calls
    assert (call.caller, call.reason, call.rows, call.refused) == ("terminal", reason, len(frame), None)
    assert serve.served == serve.calls and serve.refusals == () and serve.loader_calls == 1


OUTSIDE = [("2022-01-03", "2022-01-05", "1m"), ("2021-12-31", "2022-01-02", "1m"), ("2009-12-30", "2010-01-02", "1m"),
           ("2021-06-01", "2022-06-01", "1d"), ("2023-01-02", "2023-01-03", "1d")]


@pytest.mark.parametrize("start,end,timeframe", OUTSIDE)
def test_the_fake_serve_refuses_2022_and_straddling_windows(tmp_path, start, end, timeframe):
    serve = make_fake_serve(tmp_path / "oos.jsonl")
    with pytest.raises(oos_gate.OOSAccessError, match="straddling windows are refused"):
        serve(ts(start), ts(end), caller="terminal", reason="nqt fixture check", timeframe=timeframe)
    assert serve.loader_calls == 0 and serve.served == ()
    (call,) = serve.refusals
    assert "leaves the in-sample window" in call.refused and call.rows is None
    assert read_log(tmp_path / "oos.jsonl") == []


@pytest.mark.parametrize("kwargs", [{"caller": "terminal", "reason": "short"}, {"caller": " ", "reason": "long enough"},
                                    {"caller": "terminal", "reason": "long enough", "naive": True},
                                    {"caller": "terminal", "reason": "long enough", "backwards": True}])
def test_the_fake_serve_keeps_every_other_gate_rule(tmp_path, kwargs):
    serve = make_fake_serve(tmp_path / "oos.jsonl")
    start, end = ts("2015-01-05"), ts("2015-01-06")
    if kwargs.pop("naive", False):
        start, end = start.tz_localize(None), end.tz_localize(None)
    if kwargs.pop("backwards", False):
        start, end = end, start
    with pytest.raises(oos_gate.OOSAccessError):
        serve(start, end, **kwargs)
    assert serve.loader_calls == 0 and read_log(tmp_path / "oos.jsonl") == []


_RECORDERS: list[list[str]] = []
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_TRUNC


def _audit(event: str, args: tuple) -> None:
    if event != "open" or not _RECORDERS or isinstance(args[0], int):
        return
    mode, flags = (tuple(args) + (None, None))[1:3]
    writes = any(c in mode for c in "wax+") if isinstance(mode, str) else bool((flags or 0) & _WRITE_FLAGS)
    path = os.path.normcase(os.path.abspath(os.fsdecode(args[0])))
    if writes and not path.endswith(".pyc"):  # bytecode caches from lazy imports are not the code under test
        for sink in _RECORDERS:
            sink.append(path)


sys.addaudithook(_audit)


@contextmanager
def recorded_writes():
    sink: list[str] = []
    _RECORDERS.append(sink)
    try:
        yield sink
    finally:
        _RECORDERS.remove(sink)


def norm(path: Path) -> str:
    return os.path.normcase(os.path.abspath(path))


def exercise(serve) -> None:
    serve(ts("2020-02-03"), ts("2020-02-04"), caller="terminal", reason="nqt fixture check, write audit")
    with pytest.raises(oos_gate.OOSAccessError):
        serve(ts("2022-02-01"), ts("2022-02-02"), caller="terminal", reason="nqt fixture check, write audit")


def test_the_fake_serve_writes_to_its_tmp_log_only(tmp_path):
    log = tmp_path / "oos.jsonl"
    serve = make_fake_serve(log)
    real_size = OOS_LOG.stat().st_size if OOS_LOG.exists() else 0
    with recorded_writes() as seen:
        exercise(serve)
    assert set(seen) == {norm(log)} and len(read_log(log)) == 1
    if OOS_LOG.exists():  # other workflows may append meanwhile; none of their lines may carry the marker
        with OOS_LOG.open("rb") as fh:
            fh.seek(real_size)
            assert TEST_MARKER.encode("utf-8") not in fh.read()


def test_the_write_recorder_is_born_failing_on_a_stray_write(tmp_path):
    fake = make_fake_serve(tmp_path / "oos.jsonl")
    stray = tmp_path / "elsewhere.jsonl"

    def leaky(start, end, **kw):
        stray.write_text("x\n", encoding="utf-8")
        return fake(start, end, **kw)

    with recorded_writes() as seen:
        exercise(leaky)
    assert norm(stray) in seen


def gate_problems(serve) -> list[str]:
    """What an injected serve does with a 2022 window and a straddling one; [] when both are refused unserved."""
    out = []
    for start, end in (("2022-03-01", "2022-03-02"), ("2021-12-30", "2022-01-04")):
        try:
            frame = serve(ts(start), ts(end), caller="terminal", reason="nqt fixture check, gate probe")
        except oos_gate.OOSAccessError:
            continue
        out.append(f"[{start}, {end}) served {len(frame)} rows")
    return out


def test_the_gate_probe_is_born_failing_on_a_serve_that_skips_the_gate(tmp_path):
    def ungated(start, end, *, caller, reason, symbol="NQ.V.0", timeframe="1m", variant="vendor"):
        return synthetic_loader(symbol, timeframe, variant)(start, end)

    assert len(gate_problems(ungated)) == 2
    assert gate_problems(make_fake_serve(tmp_path / "oos.jsonl")) == []


@pytest.mark.parametrize("where", [lambda: OOS_LOG, lambda: ROOT / "results" / "other.jsonl",
                                   lambda: ROOT / "data" / "x.jsonl", lambda: ROOT / "live" / "logs" / "x.jsonl",
                                   lambda: ROOT / "backtests" / "output" / "x.jsonl",
                                   lambda: FIXTURES / "results" / "oos_access_log.jsonl"],
                         ids=["oos_log", "results", "data", "live", "backtests_output", "fixtures"])
def test_the_fake_serve_refuses_a_protected_log_path(where):
    with pytest.raises(ValueError, match="protected"):
        make_fake_serve(where())


def test_fakes_module_offers_no_sealed_door():
    names = set(dir(fakes))
    assert not {n for n in names if "sealed" in n.lower()}


def test_the_fake_catalog_describes_each_series_once(monkeypatch):
    # The fixture backend's catalog built synthetic bars on every request just to name their columns (about
    # 100 ms of each HOME load in the performance budget); the columns of a series never change.
    import fakes
    made: list[str] = []
    real = fakes.synthetic_loader
    monkeypatch.setattr(fakes, "synthetic_loader", lambda *a, **k: made.append(a[0]) or real(*a, **k))
    fakes._columns.cache_clear()
    catalog = fakes.FakeCatalog()
    first = catalog.entries()
    assert catalog.entries() == first
    assert len(made) == len(fakes.fake_series_ids())
