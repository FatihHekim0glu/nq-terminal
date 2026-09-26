"""RunService on the fixture runs (TASKS 2.1): index, badges, detail, pages, equity, anchors, ledger, compare."""
from __future__ import annotations

import copy
import json
import math

import pytest

from nq_lab.config import ROOT
from nq_terminal.services.files import FileCache
from nq_terminal.services.runs import (
    RESCAN_S,
    RunNotFound,
    SectionNotFound,
    SidecarNotFound,
    anchor_base_name,
    is_anchor,
    is_probe,
    run_kind,
)

from test_runs_support import (
    FIXTURE_OUTPUT,
    RUNS,
    FakeClock,
    SpyCache,
    add_run,
    copy_root,
    ledger_row,
    result_doc,
    service,
    write_ledger,
)

ZA, OVERNIGHT, SIZED, BOOK = RUNS["za_orb"], RUNS["overnight"], RUNS["sized"], RUNS["dtsmom"]
SMOKE, UNBALANCED = RUNS["nan_tokens"], RUNS["unbalanced"]


@pytest.fixture
def root(tmp_path):
    return copy_root(tmp_path)


# ---------------------------------------------------------------- index


def test_index_lists_every_fixture_run(root):
    ids = {s.run_id for s in service(root).summaries()}
    assert ids == set(RUNS.values())


def test_index_skips_folders_without_result_json(root):
    (root / "backtests" / "output" / "half_made_run").mkdir()
    (root / "backtests" / "output" / "stray.log").write_text("x", encoding="utf-8")
    ids = {s.run_id for s in service(root).summaries()}
    assert "half_made_run" not in ids and "stray.log" not in ids
    assert ids == set(RUNS.values())


def test_index_rescans_only_after_the_interval(root):
    clock = FakeClock()
    svc = service(root, clock=clock)
    assert "nt_late_run" not in {s.run_id for s in svc.summaries()}
    add_run(root, "nt_late_run", result_doc(ZA))
    clock.advance(RESCAN_S - 0.1)
    assert "nt_late_run" not in {s.run_id for s in svc.summaries()}
    clock.advance(0.2)
    assert "nt_late_run" in {s.run_id for s in svc.summaries()}


def test_missing_output_folder_gives_an_empty_list(tmp_path):
    assert service(tmp_path).summaries() == []


# ---------------------------------------------------------------- badges and kinds


@pytest.mark.parametrize(("shape", "kind"), [("za_orb", "intraday"), ("overnight", "intraday"),
                                             ("sized", "sized"), ("dtsmom", "book")])
def test_kind_follows_the_result_shape(root, shape, kind):
    by_id = {s.run_id: s for s in service(root).summaries()}
    assert by_id[RUNS[shape]].kind == kind


def test_run_kind_is_data_driven():
    assert run_kind({"strategy_log": {"snapshots": [], "instruments": ["ES.XCME"]}}) == "book"
    assert run_kind({"strategy_log": {"snapshots": []}}) == "sized"
    assert run_kind({"trades": []}) == "intraday"


def test_probe_flag_from_data_or_name():
    assert is_probe("nt_x_final_probe_2012-02-16", {})
    assert is_probe("nt_x_m1", {"lookahead_probe": {"day": "2012-02-16"}})
    assert not is_probe("nt_x_m1", {"variant": "repaired"})
    assert not is_probe("nt_x_m1", None)


def test_anchor_flag_from_name():
    assert is_anchor("nt_za_v0_repaired_regress_r8") and is_anchor("nt_tsmom_v0_m1_haltfix_r1")
    assert not is_anchor("nt_za_v0_repaired_a") and not is_anchor("nt_regressive_v0")


def test_anchor_base_by_name():
    assert anchor_base_name("nt_tsmom_v0_m1_haltfix_r1") == "nt_tsmom_v0_m1"
    assert anchor_base_name("nt_za_v0_repaired_regress_r3") == "nt_za_v0_repaired"
    assert anchor_base_name("nt_za_v0_repaired_a") is None


def test_summary_carries_the_result_numbers(root):
    doc = result_doc(ZA)
    s = {x.run_id: x for x in service(root).summaries()}[ZA]
    assert (s.strategy, s.variant, s.start, s.end) == ("za_orb", "repaired", "2010-09-28", "2022-01-01")
    assert (s.n_trades, s.pnl_total, s.fees_total) == (doc["n_trades"], doc["pnl_total"], doc["fees_total"])
    assert s.hit_rate == doc["summary"]["hit_rate"] and s.t_net_r == doc["summary"]["t_net_r"]
    assert s.balance_ok is True and s.mtm_ok is None and s.coverage_ok is None
    assert s.is_probe is False and s.is_anchor is False and s.ledger is None and s.readable is True


def test_unbalanced_run_is_flagged_unusable(root):
    s = {x.run_id: x for x in service(root).summaries()}[UNBALANCED]
    assert s.balance_ok is False and s.usable is False


def test_sized_summary_has_mtm_and_coverage(root):
    s = {x.run_id: x for x in service(root).summaries()}[SIZED]
    assert s.mtm_ok is True and s.coverage_ok is True and s.t_pnl_usd is not None and s.mean_net_r is None


def test_unreadable_result_is_listed_not_raised(root):
    folder = root / "backtests" / "output" / "nt_broken"
    folder.mkdir()
    (folder / "result.json").write_text('{"run_id": "nt_broken", "config": {', encoding="utf-8")
    svc = service(root, cache=FileCache(roots=[root], retry_delay_s=0))
    broken = {s.run_id: s for s in svc.summaries()}["nt_broken"]
    assert broken.readable is False and "decode" in broken.error


# ---------------------------------------------------------------- detail and NaN


def test_nan_tokens_become_null(root):
    detail = service(root).detail(SMOKE)
    block = detail.summary_stats["blocks"]["2010-2013"]
    assert block["mean_net_r"] is None and block["t"] is None
    text = detail.model_dump_json()
    assert "NaN" not in text and "Infinity" not in text


def test_detail_has_no_large_arrays(root):
    detail = service(root).detail(SIZED).model_dump()
    assert "trades" not in detail and "fills" not in detail and "strategy_log" not in detail
    assert detail["counts"] == {"trades": 4, "fills": 9}
    assert detail["log_sections"] == {"snapshots": 10, "closes": 10, "decisions": 11, "notes": 1}


def test_book_detail_keeps_log_metadata(root):
    detail = service(root).detail(BOOK)
    assert detail.log_sections["rolls"] == 3 and detail.log_meta["book"] == "tsmom"
    assert len(detail.log_meta["instruments"]) == 27 and detail.log_meta["halted"] is False


# ---------------------------------------------------------------- pages


def test_trades_page(root):
    page = service(root).trades(ZA, offset=2, limit=3)
    assert (page.offset, page.limit, page.total, len(page.items)) == (2, 3, 6, 3)
    assert page.items[0].date == result_doc(ZA)["trades"][2]["date"]


def test_fills_keep_the_decimal_string_and_add_iso_and_floats(root):
    fill = service(root).fills(SIZED, offset=0, limit=500).items[0].model_dump()
    raw = result_doc(SIZED)["fills"][0]
    assert fill["commission"] == raw["commission"] and fill["commission_float"] == float(raw["commission"])
    assert fill["ts"] == "2011-06-06T20:00:00.000000000Z" and fill["ts_epoch_s"] == raw["ts"] // 10**9


def test_intraday_run_has_no_fills(root):
    assert service(root).fills(ZA, offset=0, limit=10).total == 0


def test_log_section_page(root):
    page = service(root).log(SIZED, "snapshots", offset=0, limit=500)
    assert page.total == 10 and page.items[-1]["equity"] == "996419.72"


def test_missing_log_section_is_not_found(root):
    with pytest.raises(SectionNotFound):
        service(root).log(SIZED, "rolls", offset=0, limit=10)
    with pytest.raises(SectionNotFound):
        service(root).log(ZA, "snapshots", offset=0, limit=10)


# ---------------------------------------------------------------- unknown ids touch nothing


@pytest.mark.parametrize("run_id", ["nt_nope", "..", "../results", "nt_za_v0_fixture_a/../..", "result.json", ""])
def test_unknown_run_id_reads_no_file(root, run_id):
    spy = SpyCache(roots=[root])
    svc = service(root, cache=spy)
    svc.summaries()  # warm the index; the index itself is allowed to scan
    spy.paths.clear()
    for call in (lambda: svc.detail(run_id), lambda: svc.trades(run_id, 0, 10), lambda: svc.fills(run_id, 0, 10),
                 lambda: svc.log(run_id, "snapshots", 0, 10), lambda: svc.equity(run_id),
                 lambda: svc.sidecar(run_id, "regress_check")):
        with pytest.raises(RunNotFound):
            call()
    assert spy.paths == []


# ---------------------------------------------------------------- equity


@pytest.mark.parametrize("shape", ["sized", "dtsmom"])
def test_snapshot_equity_ends_at_final_usd(root, shape):
    doc = result_doc(RUNS[shape])
    eq = service(root).equity(RUNS[shape])
    assert eq.source == "mtm_snapshots" and eq.basis == "B" and eq.usable
    assert len(eq.t) == len(eq.equity) == len(eq.date) == len(doc["strategy_log"]["snapshots"])
    assert eq.equity[-1] == pytest.approx(doc["balance_check"]["final_usd"], abs=1e-6)
    assert eq.pnl[-1] == pytest.approx(doc["balance_check"]["final_usd"] - doc["balance_check"]["starting_usd"],
                                       abs=1e-6)
    assert eq.t == sorted(eq.t) and eq.balance is not None and eq.net_qty is not None


@pytest.mark.parametrize("shape", ["za_orb", "overnight", "nan_tokens"])
def test_realised_curve_ends_at_pnl_total(root, shape):
    doc = result_doc(RUNS[shape])
    eq = service(root).equity(RUNS[shape])
    assert eq.source == "realised_trades" and eq.label == "realised, no MTM"
    assert eq.pnl[-1] == pytest.approx(doc["pnl_total"], abs=1e-6)
    assert eq.equity[-1] == pytest.approx(doc["balance_check"]["starting_usd"] + doc["pnl_total"], abs=1e-6)
    assert eq.n_sessions == doc["data"]["sessions"] and eq.sessions_match is True
    assert eq.t == sorted(eq.t) and len(set(eq.date)) == len(eq.date)


def test_realised_curve_is_flat_on_days_without_trades(root):
    eq = service(root).equity(ZA)
    trade_days = {t["date"] for t in result_doc(ZA)["trades"]}
    moves = {d for d, a, b in zip(eq.date[1:], eq.pnl, eq.pnl[1:]) if a != b}
    assert moves <= trade_days and len(eq.date) == 2836


def test_unbalanced_run_has_no_equity_line(root):
    """Rule 4 guard. Born failing: with balance_check.ok forced true the same file draws a line."""
    eq = service(root).equity(UNBALANCED)
    assert eq.usable is False and eq.t == [] and eq.equity == [] and "balance" in eq.unusable_reason
    doc = result_doc(UNBALANCED)
    doc["balance_check"]["ok"] = True
    add_run(root, "nt_rebalanced", doc)
    assert service(root).equity("nt_rebalanced").equity != []


# ---------------------------------------------------------------- sidecars


def test_sidecar_is_served_sanitised(root):
    add_run(root, "nt_side", result_doc(ZA), {"regress_check.json": '{"identical": true, "x": NaN}',
                                              "compare_pandas_rows.csv": "a,b\n1,2\n"})
    svc = service(root)
    assert svc.summaries() and {s.run_id: s for s in svc.summaries()}["nt_side"].sidecars == ["regress_check"]
    assert svc.sidecar("nt_side", "regress_check") == {"identical": True, "x": None}
    for name in ("compare_pandas_rows", "result", "../result", "nope"):
        with pytest.raises(SidecarNotFound):
            svc.sidecar("nt_side", name)


# ---------------------------------------------------------------- anchors


def _anchor_fixture(root, *, shift: float = 0.0, with_check: bool = True):
    doc = result_doc(ZA)
    if shift:
        doc = copy.deepcopy(doc)
        doc["trades"][0]["pnl_usd"] += shift
        doc["pnl_total"] += shift
    sidecars = {"regress_check.json": {"old": ZA, "new": "nt_za_v0_fixture_a_regress_r9", "identical": not shift}}
    add_run(root, "nt_za_v0_fixture_a_regress_r9", doc, sidecars if with_check else None)


def test_anchor_pair_is_identical(root):
    _anchor_fixture(root)
    cmp = service(root).anchor("nt_za_v0_fixture_a_regress_r9")
    assert cmp.base == ZA and cmp.base_source == "regress_check"
    assert cmp.n_trades_equal and cmp.pnl_total_equal and cmp.fees_total_equal and cmp.sharpe_equal
    assert cmp.verdict == "IDENTICAL" and cmp.regress_check_identical is True


def test_shifted_anchor_is_different(root):
    """Born failing: one cent moved in one trade must break the pair."""
    _anchor_fixture(root, shift=0.01)
    cmp = service(root).anchor("nt_za_v0_fixture_a_regress_r9")
    assert cmp.verdict == "DIFFERENT" and not cmp.pnl_total_equal and not cmp.sharpe_equal


def test_anchor_base_from_a_sibling_regress_check(root):
    _anchor_fixture(root)
    add_run(root, "nt_za_v0_fixture_a_regress_r3", result_doc(ZA))  # no sidecar: base comes from r9's check
    cmp = service(root).anchor("nt_za_v0_fixture_a_regress_r3")
    assert cmp.base == ZA and cmp.base_source == "sibling_regress_check" and cmp.verdict == "IDENTICAL"


def test_haltfix_base_by_name(root):
    add_run(root, f"{ZA}_haltfix_r1", result_doc(ZA))
    cmp = service(root).anchor(f"{ZA}_haltfix_r1")
    assert cmp.base == ZA and cmp.base_source == "name" and cmp.verdict == "IDENTICAL"


def test_non_anchor_has_no_comparison(root):
    assert service(root).anchor(ZA) is None


# ---------------------------------------------------------------- ledger


def test_ledger_rows_join_the_runs(root):
    write_ledger(root, [ledger_row(ZA, "za_v0_nautilus_zero_slippage")])
    svc = service(root)
    view = svc.ledger()
    assert view.ledger_found and [r.run_id for r in view.rows] == [ZA]
    row = view.rows[0]
    assert row.run_found and row.matches_result and row.params == {"or_minutes": 5, "target_r": 10.0}
    assert {s.run_id: s for s in svc.summaries()}[ZA].ledger.exp_id == "za_v0_nautilus_zero_slippage"


def test_ledger_row_that_disagrees_with_its_result_is_flagged(root):
    """Born failing for rule 2: a ledger number that is not the on-disk result must show."""
    row = ledger_row(ZA, "za_v0_nautilus_zero_slippage")
    row["pnl_total"] = row["pnl_total"] + 1
    write_ledger(root, [row])
    assert service(root).ledger().rows[0].matches_result is False


def test_missing_ledger_is_empty(root):
    view = service(root).ledger()
    assert view.ledger_found is False and view.rows == []


def test_ledger_command_for_an_eligible_run(root):
    write_ledger(root, [ledger_row(OVERNIGHT, "overnight_v0")])
    add_run(root, "nt_overnight_v0_fixture_new", result_doc(OVERNIGHT))
    cmd = service(root).detail("nt_overnight_v0_fixture_new").ledger_command
    py = ROOT / ".venv" / "Scripts" / "python.exe"
    assert cmd.eligible and cmd.exp_id == "overnight_v0" and cmd.exp_id_source == "ledger"
    assert cmd.command == (f'"{py}" scripts\\ledger_append.py '
                           "backtests\\output\\nt_overnight_v0_fixture_new\\result.json --exp-id overnight_v0")
    assert cmd.cwd == str(ROOT)


def test_ledger_command_placeholder_without_a_known_experiment(root):
    cmd = service(root).detail(SIZED).ledger_command
    assert cmd.eligible and cmd.exp_id is None and cmd.command.endswith("--exp-id <exp>")


@pytest.mark.parametrize(("shape", "reason"), [("unbalanced", "balance"), ("za_orb", "ledger")])
def test_ineligible_runs_get_no_command(root, shape, reason):
    write_ledger(root, [ledger_row(ZA, "za_v0_nautilus_zero_slippage")])
    cmd = service(root).detail(RUNS[shape]).ledger_command
    assert not cmd.eligible and cmd.command is None and any(reason in r for r in cmd.reasons)


def test_probe_gets_no_command(root):
    doc = result_doc(SIZED)
    doc["data"]["lookahead_probe"] = {"day": "2011-06-08", "seed": 1}
    add_run(root, "nt_volmanaged_v0_fixture_probe_2011-06-08", doc)
    cmd = service(root).detail("nt_volmanaged_v0_fixture_probe_2011-06-08").ledger_command
    assert not cmd.eligible and any("probe" in r for r in cmd.reasons)


def test_coverage_failure_gets_no_command(root):
    doc = result_doc(OVERNIGHT)
    doc["coverage_check"]["ok"] = False
    add_run(root, "nt_overnight_v0_fixture_gap", doc)
    cmd = service(root).detail("nt_overnight_v0_fixture_gap").ledger_command
    assert not cmd.eligible and any("coverage" in r for r in cmd.reasons)


def test_ledger_anchor_pairs(root):
    _anchor_fixture(root)
    pairs = service(root).ledger().anchor_pairs
    assert [(p.anchor, p.base, p.verdict) for p in pairs] == [("nt_za_v0_fixture_a_regress_r9", ZA, "IDENTICAL")]


# ---------------------------------------------------------------- compare


def test_compare_rebases_each_series_to_one(root):
    cmp = service(root).compare([ZA, OVERNIGHT])
    assert [s.run_id for s in cmp.series] == [ZA, OVERNIGHT]
    assert len(cmp.t) == len(cmp.date) == len(cmp.series[0].rebased)
    for s in cmp.series:
        first = next(v for v in s.rebased if v is not None)
        assert first == 1.0
    stats = {s.run_id: s for s in cmp.stats}
    assert stats[ZA].n_trades == 6 and stats[ZA].basis == "B"
    doc = result_doc(ZA)
    total = doc["pnl_total"] / doc["balance_check"]["starting_usd"]
    assert stats[ZA].total_return == pytest.approx(total, abs=1e-12)


def test_compare_aligns_dates_across_windows(root):
    cmp = service(root).compare([SIZED, BOOK])
    sized, book = cmp.series
    assert cmp.date == sorted(cmp.date)
    # sessions plus the 1.0 base point on the day before each run's first session
    assert sum(v is not None for v in sized.rebased) == 11 and sum(v is not None for v in book.rebased) == 16


def test_compare_leaves_out_unusable_runs(root):
    cmp = service(root).compare([ZA, UNBALANCED])
    unusable = {s.run_id: s for s in cmp.series}[UNBALANCED]
    assert unusable.usable is False and all(v is None for v in unusable.rebased)


def test_compare_unknown_run(root):
    with pytest.raises(RunNotFound):
        service(root).compare([ZA, "nt_nope"])


def test_sharpe_of_the_realised_curve_is_finite(root):
    stats = service(root).compare([ZA, SIZED]).stats
    assert all(math.isfinite(s.sharpe) for s in stats)


def test_fixture_folder_itself_serves_as_a_root():
    ids = {s.run_id for s in service(FIXTURE_OUTPUT.parents[1]).summaries()}
    assert ids == set(RUNS.values())


def test_service_never_mutates_cached_values(root):
    svc = service(root)
    first = svc.detail(ZA).model_dump()
    svc.detail(ZA).summary_stats["blocks"]["2010-2013"]["n"] = 99
    assert svc.detail(ZA).model_dump() == first
    assert json.dumps(first)  # plain JSON types only
