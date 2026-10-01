"""RG2, EX5 and MV6 dumps for the reference cross-check in `terminal/qa` (TASKS Phase 12; ANALYTICS_CATALOG section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_p2_rct_`, four
bundle kinds whose references are in `terminal/qa/crosscheck/p2_regimes_capacity_term.py`:
- `p2trend` (RG2): volmanaged_v0's screen series at 1 tick (research files, read only) and a synthetic series with
  holes in the close, each against NQ closes from the tests' synthetic 1d bars; `nautilus` carries Nautilus
  `SharpeRatio` on each regime's sessions (the third implementation).
- `p2capacity` (EX5): the fixture MNQ, dtsmom and za_orb runs and the real `nt_volmanaged_v0_m1` (read only), with the
  synthetic 1d volume served through the fake gate; `inputs.legs` are built from the raw fill or trade rows here.
- `p2term` (MV6): the synthetic NQ, ZN and CL calendar chains (`p2_chain_fakes.py`, bars planted past the fence).
- `p2expiry`: every root of the universe and every contract month 2010 to 2022 against the written-out CME rules.

The shared dump folder is read by `python -m crosscheck`, which refuses a kind it does not know; these bundles go
there because `crosscheck/dumps.py` and `crosscheck/compare.py` register the kinds (a test, `qa/tests/test_p2_dump_kinds.py`,
pins that). Without the registration the test would write them into a temporary folder and check them there. Read-only on `results/` and `backtests/output/`.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from p2_chain_fakes import chain_rows
from test_dump_for_qa import SCHEMA, _clean, _session_dict, checked_dump_dir, dump_dir

from nq_lab import carry_expiry
from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.analytics import series, term_structure, trend_regime
from nq_terminal.services import regimes_capacity_term as rct
from nq_terminal.services.bars import BarService
from nq_terminal.services.research import ResearchService
from nq_terminal.services.runs import RunService

from fakes import FIXTURES, make_fake_serve, synthetic_loader

PREFIX = "nqt_p2_rct_"
KINDS = ("p2trend", "p2capacity", "p2term", "p2expiry")
QA_CROSSCHECK = Path(__file__).resolve().parents[2] / "qa" / "crosscheck"
CAPACITY_RUNS = (("fixture_mnq", FIXTURES, "nt_volmanaged_v0_fixture_m1"),
                 ("fixture_dtsmom", FIXTURES, "nt_dtsmom_v0_fixture_ts1"),
                 ("fixture_za", FIXTURES, "nt_za_v0_fixture_a"), ("real_volmanaged_m1", ROOT, "nt_volmanaged_v0_m1"))
TERM_ROOTS = ("NQ", "ZN", "CL")
CACHE_BYTES = 512 * 2**20


def registered() -> bool:
    """Whether the cross-check knows the four kinds (both its dump reader and its comparison)."""
    try:
        dumps = (QA_CROSSCHECK / "dumps.py").read_text(encoding="utf-8")
        compare = (QA_CROSSCHECK / "compare.py").read_text(encoding="utf-8")
    except OSError:
        return False
    return "P2_RCT_INPUTS" in dumps and "P2_RCT_REFERENCES" in compare


def _days(index) -> list[str]:
    return [pd.Timestamp(d).strftime("%Y-%m-%d") for d in index]


def _doc(kind: str, case: str, source: str, inputs: dict, values: dict) -> dict:
    return _clean({"schema": SCHEMA, "kind": kind, "case": case, "source": source, "inputs": inputs,
                   "values": values, "missing": {}})


# ---------------------------------------------------------------- RG2


def _nautilus_sharpe(part: pd.Series) -> float:
    from nautilus_trader.analysis import SharpeRatio
    return SharpeRatio(252).calculate_from_returns(_session_dict(part)) if len(part) > 1 else math.nan


def trend_doc(case: str, source: str, r: pd.Series, close: pd.Series) -> dict:
    found = trend_regime.trend_stats(r, close, 252)
    labels = found["frame"]["regime"]
    ours = {"labels": ["none" if pd.isna(v) else v for v in labels], "unlabelled": found["unlabelled"],
            "welch_t": found["welch_t"], "welch_df": found["welch_df"]}
    nautilus = {}
    for row in found["rows"]:
        ours.update({f"{row['regime']}_{k}": row[k] for k in ("n", "mean", "sharpe", "hit_rate")})
        nautilus[f"{row['regime']}_sharpe"] = _nautilus_sharpe(r[(labels == row["regime"]).to_numpy()])
    inputs = {"dates": _days(r.index), "r": r.tolist(), "close_dates": _days(close.index),
              "close": [None if not math.isfinite(v) else v for v in close.tolist()], "window": trend_regime.WINDOW,
              "periods": 252}
    return _doc("p2trend", case, source, inputs, {"ours": ours, "nautilus": nautilus})


def _bars(tmp_path: Path) -> BarService:
    return BarService(make_fake_serve(tmp_path / "log" / "oos_access_log.jsonl"), cache_bytes=CACHE_BYTES)


def trend_docs(tmp_path: Path) -> list[dict]:
    close, _ = rct.nq_trend_close(_bars(tmp_path), None)
    s = series.hypothesis_series(ResearchService(ROOT), "volmanaged_v0", 1)
    rng = np.random.default_rng(20260927)
    days = close.index[300:1500]
    synthetic = pd.Series(rng.normal(0.0003, 0.011, len(days)), index=days)
    synthetic.iloc[::13] = 0.0
    holed = close.copy()
    holed.iloc[[700, 701, 1100]] = np.nan
    return [trend_doc("p2trend_volmanaged_v0", "volmanaged_v0 screen series at 1 tick against synthetic NQ closes",
                      s.r, close),
            trend_doc("p2trend_synthetic_holes", "synthetic returns against synthetic NQ closes with three holes",
                      synthetic, holed)]


# ---------------------------------------------------------------- EX5


def _legs(runs: RunService, run_id: str, sources: dict) -> list[list]:
    detail = runs.detail(run_id, anchor=False)
    if detail.counts.fills:
        default = next(iter(sources)) if len(sources) == 1 else None
        rows = runs.fills(run_id, 0, 5000).items
        return [[*sources[r.instrument or default], r.ts_epoch_s, r.qty] for r in rows]
    rows = runs.trades(run_id, 0, 5000).items
    (source,) = sources.values()
    return [[*source, stamp, 1.0] for r in rows for stamp in (r.entry_ts_epoch_s, r.exit_ts_epoch_s)]


def _volume(root: str) -> dict:
    frame = synthetic_loader(f"{root}.V.0", "1d")(IS_START, IS_END)
    return dict(zip(pd.to_datetime(frame["ts"], utc=True).dt.strftime("%Y-%m-%d"), frame["v"].astype(float)))


def capacity_doc(tmp_path: Path, case: str, data_root: Path, run_id: str) -> dict:
    runs = RunService(data_root=data_root, project_root=data_root)
    view, _ = rct.capacity_view(runs, _bars(tmp_path), run_id, lambda symbol: None)
    sources = {i.instrument: (i.symbol.removesuffix(".V.0") if i.symbol else None, i.factor) for i in view.instruments}
    legs = [[root, epoch, qty, factor] for root, factor, epoch, qty in _legs(runs, run_id, sources)]
    roots = sorted({leg[0] for leg in legs if leg[0] is not None})
    ours = {"max_ratio": view.max_ratio}
    for row in view.rows:
        root = row.symbol.removesuffix(".V.0")
        ours.update({f"{root}.{k}": getattr(row, k) for k in ("sessions", "sessions_with_volume", "void",
                                                               "contracts_total", "contracts_mean", "ratio_mean",
                                                               "ratio_median", "ratio_p95", "ratio_max",
                                                               "volume_median")})
        ours[f"{root}.ratio_max_session"] = [row.ratio_max_date or "none"]
    inputs = {"legs": legs, "volume": {root: _volume(root) for root in roots}}
    return _doc("p2capacity", f"p2capacity_{case}", f"{run_id} ({view.source}) against synthetic 1d volume", inputs,
                {"ours": ours})


# ---------------------------------------------------------------- MV6 and the expiries


def _leg(frame: pd.DataFrame) -> dict:
    return {"dates": pd.to_datetime(frame["ts"], utc=True).dt.strftime("%Y-%m-%d").tolist(), "c": frame["c"].tolist(),
            "v": frame["v"].tolist(), "h": frame["h"].tolist(), "l": frame["l"].tolist(),
            "contract": frame["contract"].tolist()}


def business_days() -> list[str]:
    return [str(d) for d in carry_expiry.business_days()]


def term_doc(root: str) -> dict:
    c0, c1 = chain_rows(root, 0), chain_rows(root, 1)
    found = term_structure.front_next(c0, c1, root)
    rows = found["rows"]
    ours = {key: [r[key] for r in rows] for key in ("date", "expiry_front", "expiry_next", "spread", "carry")}
    ours["tau"] = [r["tau_years"] for r in rows]
    ours["void"] = {k: float(v) for k, v in found["void"].items()}
    stats = term_structure.summary(rows)
    ours.update({k: stats[k] for k in ("n", "mean", "median", "min", "max", "share_backwardation")})
    inputs = {"root": root, "front": _leg(c0), "next": _leg(c1), "business_days": business_days()}
    return _doc("p2term", f"p2term_{root}_synthetic", "synthetic calendar chain with bars past the fence", inputs,
                {"ours": ours})


def expiry_doc() -> dict:
    contracts = [[c.root, year, month] for c in TABLE for year in range(2010, 2023) for month in range(1, 13)]
    keys = [f"{root}{carry_expiry.MONTH_CODES[month - 1]}{year}" for root, year, month in contracts]
    ours = {"expiries": [term_structure.expiry_of(k, root).isoformat() for k, (root, _, _) in zip(keys, contracts)],
            "count": len(contracts)}
    return _doc("p2expiry", "p2expiry_universe_2010_2022", "the pinned table through term_structure.expiry_of",
                {"contracts": contracts, "business_days": business_days()}, {"ours": ours})


# ---------------------------------------------------------------- writing


def all_docs(tmp_path: Path) -> list[dict]:
    docs = trend_docs(tmp_path)
    docs += [capacity_doc(tmp_path, case, root, run) for case, root, run in CAPACITY_RUNS]
    docs += [term_doc(root) for root in TERM_ROOTS]
    return [*docs, expiry_doc()]


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    written = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case']}.json"
        path.write_text(json.dumps(doc, allow_nan=False), encoding="utf-8")
        written.append(path)
    return written


@pytest.fixture(scope="module")
def docs(tmp_path_factory) -> list[dict]:
    return all_docs(tmp_path_factory.mktemp("p2rct"))


def test_every_kind_is_dumped_with_its_inputs(docs):
    wanted = {"p2trend": {"dates", "r", "close_dates", "close", "window", "periods"},
              "p2capacity": {"legs", "volume"}, "p2term": {"root", "front", "next", "business_days"},
              "p2expiry": {"contracts", "business_days"}}
    assert {d["kind"] for d in docs} == set(KINDS)
    for d in docs:
        assert set(d["inputs"]) == wanted[d["kind"]], d["case"]
        assert d["values"]["ours"], d["case"]


def test_the_trend_cases_have_both_regimes_and_a_nautilus_side(docs):
    for d in (x for x in docs if x["kind"] == "p2trend"):
        ours = d["values"]["ours"]
        assert ours["above_n"] > 10 and ours["below_n"] > 10, d["case"]
        assert set(d["values"]["nautilus"]) == {"above_sharpe", "below_sharpe"}


def test_the_capacity_cases_cover_fills_and_trades(docs):
    by = {d["case"]: d for d in docs}
    assert by["p2capacity_fixture_mnq"]["inputs"]["legs"][0][3] == pytest.approx(0.1)
    assert all(leg[3] == 1.0 for leg in by["p2capacity_fixture_za"]["inputs"]["legs"])
    assert len(by["p2capacity_real_volmanaged_m1"]["inputs"]["legs"]) == 705


def test_the_term_cases_carry_bars_past_the_fence_in_their_inputs_only(docs):
    for d in (x for x in docs if x["kind"] == "p2term"):
        assert max(d["inputs"]["front"]["dates"]) >= "2022-01-01"
        assert max(d["values"]["ours"]["date"]) < "2022-01-01"
        assert d["values"]["ours"]["void"]["thin"] >= 1


def test_write_p2rct_dumps(docs, tmp_path):
    folder = dump_dir() if registered() else tmp_path / "p2rct"
    paths = write_dumps(folder, docs)
    assert len(paths) == len(docs)
    back = json.loads(paths[0].read_text(encoding="utf-8"))
    assert back["schema"] == SCHEMA and back["kind"] in KINDS


@pytest.mark.parametrize("folder", [ROOT / "results", ROOT / "data", ROOT / "live" / "x", ROOT])
def test_a_protected_folder_is_refused_before_any_write(folder):
    with pytest.raises(ValueError, match="refused dump folder"):
        write_dumps(folder, [])
