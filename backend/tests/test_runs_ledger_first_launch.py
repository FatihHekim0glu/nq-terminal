"""The cold /api/ledger body on a first launch (02 section 4.1 item 3, decided: the first launch; 04 D3.4; T3).

On a first launch the state folder is empty, so the result cache has no ledger on disk and the body is computed while
the HOME page loads. Its cost was the anchor pairs: each pair's Sharpe needs a run's equity curve, and the curve was
built from the WHOLE `trades` or `strategy_log` section of result.json, sanitised and frozen item by item (about
1.2 million calls on the real lab, 2.1 to 2.3 s of a cold call), although the curve reads two fields of a trade and
six of a snapshot. The curve now reads a projection of those sections that keeps only the fields it reads (and the
fields the sanitiser derives them from), so the values are the same and the work follows the rows, not the log.

What is proved here: the ledger reads no whole large section (born failing); a work budget and a time budget on a lab
with a heavy strategy log (born failing); the projected curve equals the whole-section curve for every fixture run and
every edge of the sanitiser's derived keys; the real lab's ledger body is byte-equal under both.
"""
from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Any

import pytest

from nq_lab.config import ROOT
from nq_terminal.services import files, result_cache, run_curves
from nq_terminal.services import runs as runs_module
from nq_terminal.services.files import FileCache
from nq_terminal.services.runs import RunService

from test_runs_support import RUNS, FakeClock, add_run, copy_root, ledger_row, result_doc, write_ledger

ZA, SIZED, BOOK = RUNS["za_orb"], RUNS["sized"], RUNS["dtsmom"]
WHOLE_SECTIONS = {"runs:trades", "runs:fills", "runs:strategy_log"}
HEAVY_DECISIONS = 60_000  # strategy log rows the equity curve never reads
SANITISE_BUDGET = 25_000  # sanitiser calls for the whole cold ledger of the heavy lab (whole sections: 840,634)
COLD_LEDGER_BUDGET_S = 1.0  # the heavy lab's cold ledger (whole sections: 2.6 s on the build machine)


class KindSpy(FileCache):
    """A FileCache that records the kind of every read."""

    def __init__(self, **kwargs: Any):
        super().__init__(**kwargs)
        self.kinds: list[str] = []

    def get(self, path, parser, *, kind):
        self.kinds.append(kind)
        return super().get(path, parser, kind=kind)


class WholeSections(RunService):
    """The service as it was: the curve read from the whole sections (the reference the projection must equal)."""

    def _read(self, entry, section):
        if section == runs_module.CURVE_TRADES:
            return super()._read(entry, "trades")
        if section == runs_module.CURVE_SNAPSHOTS:
            log = super()._read(entry, "strategy_log")
            return log.get("snapshots") if isinstance(log, dict) else None
        return super()._read(entry, section)


def svc(root: Path, cache: FileCache | None = None, cls: type[RunService] = RunService) -> RunService:
    return cls(data_root=root, project_root=ROOT, clock=FakeClock(), cache=cache)


def anchored_root(tmp_path: Path) -> Path:
    """The fixture runs plus an anchor of a realised run and of a snapshot run, both in the ledger."""
    root = copy_root(tmp_path)
    add_run(root, f"{ZA}_regress_r9", result_doc(ZA), {"regress_check.json": {"old": ZA, "identical": True}})
    add_run(root, f"{SIZED}_haltfix_r1", result_doc(SIZED))
    write_ledger(root, [ledger_row(ZA, "za_v0_nautilus_zero_slippage"), ledger_row(SIZED, "sized_v0")])
    return root


def heavy_root(tmp_path: Path) -> Path:
    """A snapshot run and its anchor whose strategy logs carry HEAVY_DECISIONS decision rows each."""
    root = copy_root(tmp_path, runs=[SIZED])
    doc = copy.deepcopy(result_doc(SIZED))
    doc["strategy_log"]["decisions"] = [
        {"ts": 1_600_000_000_000_000_000 + i, "date": "2020-09-13", "side": "BUY", "qty": "1.000", "reason": f"r{i}",
         "price": "12000.25"} for i in range(HEAVY_DECISIONS)]
    folder = root / "backtests" / "output" / SIZED
    (folder / "result.json").write_text(json.dumps({**doc, "run_id": SIZED}), encoding="utf-8")
    add_run(root, f"{SIZED}_haltfix_r1", doc)
    write_ledger(root, [ledger_row(SIZED, "sized_v0", doc)])
    return root


def count_sanitise(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    calls = [0]
    real = files.sanitise

    def counting(value):
        calls[0] += 1
        return real(value)

    monkeypatch.setattr(files, "sanitise", counting)  # the recursion inside files.py goes through the module name
    monkeypatch.setattr(runs_module, "sanitise", counting)
    return calls


# ---------------------------------------------------------------- born failing: what the cold ledger reads


def test_born_failing_the_cold_ledger_parses_no_whole_large_section(tmp_path):
    cache = KindSpy(roots=[tmp_path])
    view = svc(anchored_root(tmp_path), cache).ledger()
    assert {pair.anchor for pair in view.anchor_pairs} == {f"{ZA}_regress_r9", f"{SIZED}_haltfix_r1"}
    assert all(pair.verdict == "IDENTICAL" for pair in view.anchor_pairs), "the Sharpe of each side was computed"
    assert not WHOLE_SECTIONS & set(cache.kinds), f"a whole section was parsed: {sorted(set(cache.kinds))}"
    assert {f"runs:{runs_module.CURVE_TRADES}", f"runs:{runs_module.CURVE_SNAPSHOTS}"} <= set(cache.kinds)


def test_born_failing_the_cold_ledger_of_a_heavy_log_stays_inside_its_work_budget(tmp_path, monkeypatch):
    root = heavy_root(tmp_path)
    calls = count_sanitise(monkeypatch)
    view = svc(root).ledger()
    assert [pair.verdict for pair in view.anchor_pairs] == ["IDENTICAL"]
    assert calls[0] <= SANITISE_BUDGET, f"{calls[0]} sanitiser calls for a curve of a few hundred rows"


def test_born_failing_the_cold_ledger_of_a_heavy_log_stays_inside_its_time_budget(tmp_path):
    root = heavy_root(tmp_path)
    service = svc(root)
    began = time.perf_counter()
    body = result_cache.json_body(service.ledger())
    took = time.perf_counter() - began
    assert b'"IDENTICAL"' in body
    assert took <= COLD_LEDGER_BUDGET_S, f"cold ledger {took:.2f} s over the {COLD_LEDGER_BUDGET_S} s budget"


# ---------------------------------------------------------------- the projection changes no value


@pytest.mark.parametrize("run_id", sorted(RUNS.values()))
def test_the_projected_curve_equals_the_whole_section_curve_for_every_fixture_run(tmp_path, run_id):
    root = copy_root(tmp_path)
    mine, theirs = svc(root), svc(root, cls=WholeSections)
    assert mine.equity(run_id) == theirs.equity(run_id)
    assert mine.account_stats(run_id) == theirs.account_stats(run_id)


def test_the_ledger_body_is_byte_equal_to_the_whole_section_body(tmp_path):
    root = anchored_root(tmp_path)
    mine = result_cache.json_body(svc(root).ledger())
    theirs = result_cache.json_body(svc(root, cls=WholeSections).ledger())
    assert mine == theirs


def _edge_snapshot_doc() -> dict:
    """A snapshot run whose rows use every form the sanitiser rewrites: ns stamps that earn `_epoch_s`, Decimal
    strings that earn `_float`, an explicit `_float` that must win, a missing equity, a row that is not an object,
    and fields the curve never reads."""
    doc = copy.deepcopy(result_doc(SIZED))
    rows = doc["strategy_log"]["snapshots"]
    base = rows[0]
    rows[1:1] = [
        {**base, "ts_epoch_s": None, "ts": 1_600_000_000_000_000_000, "equity": "100250.50", "note": {"deep": [1, 2]}},
        {**base, "equity": "100250.50", "equity_float": 99.5, "balance": "7", "unrealized": None},
        {k: v for k, v in base.items() if k != "equity"},
        "not an object",
        {**base, "net_qty": {"NQ": 2, "ES": -3}, "date": 1_600_000_000_000_000_000},
    ]
    return doc


def _edge_trades_doc() -> dict:
    doc = copy.deepcopy(result_doc(ZA))
    first = doc["trades"][0]
    doc["trades"] += [{**first, "pnl_usd": "12.5"}, {**first, "date": None}, {**first, "pnl_usd": float("nan")},
                      {k: v for k, v in first.items() if k != "pnl_usd"}]
    return doc


@pytest.mark.parametrize(("run_id", "make"), [("nt_sized_edges", _edge_snapshot_doc), ("nt_trade_edges", _edge_trades_doc)])
def test_the_projection_keeps_every_derived_key_the_curve_reads(tmp_path, run_id, make):
    root = copy_root(tmp_path, runs=[])
    add_run(root, run_id, make())
    mine, theirs = svc(root).equity(run_id), svc(root, cls=WholeSections).equity(run_id)
    assert mine == theirs
    assert mine.usable and mine.n_sessions > 0


@pytest.mark.parametrize("shape", ["missing", "object", "empty"])
def test_a_snapshots_value_that_is_not_a_list_gives_the_same_curve(tmp_path, shape):
    doc = copy.deepcopy(result_doc(SIZED))
    value = {"missing": None, "object": {"a": 1}, "empty": []}[shape]
    doc["strategy_log"]["snapshots"] = value
    root = copy_root(tmp_path, runs=[])
    add_run(root, "nt_sized_shape", doc)
    assert svc(root).equity("nt_sized_shape") == svc(root, cls=WholeSections).equity("nt_sized_shape")


PLAIN_CORPUS = [
    None, True, False, 0, -7, 2**53 - 1, -(2**53 - 1), 2**53, -(2**60), 1_600_000_000_000_000_000, 1.5, -0.0,
    float("nan"), float("inf"), float("-inf"), "", "text", "12.50", "-3", "+4.0", "1e5", "2020-09-13", "1" * 400,
    [], {}, [1, "2.5", None, [float("nan"), {"a": 1_600_000_000_000_000_000}]],
    {"ts": 1_600_000_000_000_000_000, "ts_epoch_s": 5, "price": "12000.25", "price_float": 1.0, "qty": "3",
     "flag": True, "n": 2**60, "bad": float("inf"), "nested": {"v": "7", "w": [True, "8.0"]}, "date": "2020-01-02",
     "huge": "9" * 400, "nan_text": "NaN", "minus": "-0.5", "big_ns": -(2**62)},
]


def _same_shape(a: Any, b: Any) -> bool:
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return list(a) == list(b) and all(_same_shape(a[k], b[k]) for k in a)
    if isinstance(a, tuple):
        return len(a) == len(b) and all(_same_shape(x, y) for x, y in zip(a, b))
    return a == b or (a != a and b != b)


@pytest.mark.parametrize("value", PLAIN_CORPUS, ids=range(len(PLAIN_CORPUS)))
def test_the_one_pass_sanitiser_equals_freeze_of_sanitise_in_value_type_and_key_order(value):
    raw = json.loads(json.dumps(value))  # the values json.loads makes, as the parser sees them
    assert _same_shape(run_curves.frozen_plain(raw), files.freeze(files.sanitise(raw)))


# ---------------------------------------------------------------- the fast decoder (orjson, then json.loads when it must)

PARSERS = {"head": runs_module.parse_head, **runs_module.SECTION_PARSERS, **run_curves.CURVE_PARSERS}


def parsed_both_ways(raw: bytes, monkeypatch: pytest.MonkeyPatch) -> tuple[dict, dict]:
    fast = {name: parse(raw) for name, parse in PARSERS.items()}
    with monkeypatch.context() as patch:
        patch.setattr(run_curves, "_fast", None)  # the standard library alone, as before
        slow = {name: parse(raw) for name, parse in PARSERS.items()}
    return fast, slow


def test_born_failing_a_standard_result_file_is_parsed_without_the_standard_library_decoder(monkeypatch):
    raw = json.dumps(result_doc(SIZED)).encode("utf-8")

    def refuse(*args, **kwargs):
        raise AssertionError("json.loads used for a file the fast decoder reads exactly")

    monkeypatch.setattr(run_curves.json, "loads", refuse)
    assert {name: parse(raw) is not None for name, parse in PARSERS.items()}["head"]
    assert run_curves.CURVE_PARSERS[run_curves.CURVE_SNAPSHOTS](raw)


@pytest.mark.parametrize("run_id", sorted(RUNS.values()))
def test_every_parser_gives_what_the_standard_decoder_gives_for_every_fixture_run(run_id, tmp_path, monkeypatch):
    root = copy_root(tmp_path, runs=[run_id])
    raw = (root / "backtests" / "output" / run_id / "result.json").read_bytes()
    fast, slow = parsed_both_ways(raw, monkeypatch)
    assert _same_shape_deep(fast, slow)


WIDE = 123456789012345678901234567890  # beyond 64 bits: orjson would make it a float


@pytest.mark.parametrize("where", ["head", "trade", "snapshot", "log_meta", "negative", "nan"])
def test_a_value_orjson_cannot_keep_exact_falls_back_to_the_standard_decoder(where, monkeypatch):
    doc = copy.deepcopy(result_doc(SIZED))
    doc["trades"] = [{"date": "2020-01-02", "pnl_usd": 1.5}]
    if where == "head":
        doc["n_trades"] = WIDE
    elif where == "trade":
        doc["trades"][0]["pnl_usd"] = WIDE
    elif where == "snapshot":
        doc["strategy_log"]["snapshots"][0]["equity"] = WIDE
    elif where == "log_meta":
        doc["strategy_log"]["seed"] = WIDE
    elif where == "negative":
        doc["elapsed_s"] = -(2**63) - 1
    else:
        doc["pnl_total"] = float("nan")
    raw = json.dumps(doc).encode("utf-8")
    fast, slow = parsed_both_ways(raw, monkeypatch)
    assert _same_shape_deep(fast, slow)


def test_a_genuine_float_beyond_the_integer_range_is_kept_as_the_standard_decoder_keeps_it(monkeypatch):
    doc = copy.deepcopy(result_doc(SIZED))
    doc["elapsed_s"] = 1.5e19
    fast, slow = parsed_both_ways(json.dumps(doc).encode("utf-8"), monkeypatch)
    assert _same_shape_deep(fast, slow) and fast["head"]["elapsed_s"] == 1.5e19


@pytest.mark.parametrize("raw", [b"[1, 2]", b"\xef\xbb\xbf{}", b"{\"a\": ", b"\xff\xfe{}", b"null"])
def test_what_the_standard_decoder_refuses_is_still_a_value_error(raw):
    for parse in PARSERS.values():
        with pytest.raises(ValueError):
            parse(raw)


def _same_shape_deep(a: Any, b: Any) -> bool:
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return list(a) == list(b) and all(_same_shape_deep(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(_same_shape_deep(x, y) for x, y in zip(a, b))
    return a == b or (a != a and b != b)


REAL_OUTPUT = ROOT / "backtests" / "output"


@pytest.mark.skipif(not REAL_OUTPUT.is_dir(), reason="the real lab's runs are not on this machine")
def test_every_real_result_parses_to_what_the_standard_decoder_gives(monkeypatch):
    paths = sorted(REAL_OUTPUT.glob("*/result.json"))
    assert paths
    for path in paths:
        raw = path.read_bytes()
        fast = {"head": runs_module.parse_head(raw), **{n: p(raw) for n, p in run_curves.CURVE_PARSERS.items()}}
        with monkeypatch.context() as patch:
            patch.setattr(run_curves, "_fast", None)
            slow = {"head": runs_module.parse_head(raw), **{n: p(raw) for n, p in run_curves.CURVE_PARSERS.items()}}
        assert _same_shape_deep(fast, slow), path.parent.name


# ---------------------------------------------------------------- the real lab (read only)


REAL_LEDGER = ROOT / "results" / "ledger.csv"


@pytest.mark.skipif(not REAL_LEDGER.is_file(), reason="the real lab's ledger is not on this machine")
def test_the_real_ledger_body_is_byte_equal_to_the_whole_section_body():
    mine = result_cache.json_body(svc(ROOT).ledger())
    theirs = result_cache.json_body(svc(ROOT, cls=WholeSections).ledger())
    assert mine == theirs
