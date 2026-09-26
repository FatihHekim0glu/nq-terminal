"""Tests for the trade, cost and exposure cross-check (TASKS 3.4: TA1, TA3, EX1 to EX4). In memory only."""
from __future__ import annotations

import copy
import math
from pathlib import Path

import pytest

from crosscheck import compare, dumps, paths
from crosscheck.compare import FAIL, INFO, PASS, SKIP
from crosscheck.trade_reference import costs_references, trades_references

PNL = [10.0, -5.0, 0.0, 3.0, -2.0]
ENTRY = ["2021-03-12T14:35:00+00:00", "2021-03-15T13:35:00+00:00", "2021-03-15T20:00:00+00:00",
         "2021-04-06T13:40:00+00:00", "2021-04-07T13:40:00+00:00"]  # ET: 09:35 EST, 09:35 EDT, 16:00, 09:40, 09:40
K = 1_000_000.0
T1, T2, T3 = 1_307_390_400_000_000_000, 1_307_476_800_000_000_000, 1_307_563_200_000_000_000


def trades_doc(ours=None, stored=None) -> dict:
    return {"schema": dumps.SCHEMA, "kind": "trades", "case": "hand_trades", "source": "hand-built",
            "inputs": {"pnl": list(PNL), "entry_ts": list(ENTRY)},
            "values": {"ours": ours or {}, "stored": stored or {}}, "missing": {}}


def costs_doc(ours=None, stored=None) -> dict:
    """One MNQ lot of 20: bought at 100 on T1, sold at 110 on T3; 1 tick of slippage, $0.61 fee per side."""
    equity = [K - 22.2, K - 22.2 + 200.0, K + 355.6]
    return {"schema": dumps.SCHEMA, "kind": "costs", "case": "hand_costs", "source": "hand-built",
            "inputs": {"instruments": [{"name": "MNQ.XCME", "multiplier": "2.0", "tick_size": "0.25",
                                        "cost_per_side": "1.11"}],
                       "ticks": 1, "starting_usd": K, "price_basis": "hand", "trade_pnl": ["355.6"],
                       "trade_commission": ["44.4"],
                       "fills": {"instrument": [0, 0], "signed_qty": [20, -20], "commission": ["22.20", "22.20"],
                                 "ts_ns": [T1, T3]},
                       "snapshots": {"date": ["2011-06-06", "2011-06-07", "2011-06-08"], "ts_ns": [T1, T2, T3],
                                     "net_qty": [[20], [20], [0]], "price": [[100.0], [105.0], [110.0]],
                                     "equity": equity}},
            "values": {"ours": ours or {}, "stored": stored or {}}, "missing": {}}


def rows_for(document: dict) -> list:
    return compare.compare_bundle(dumps.parse_bundle(document))


def status(rows: list, metric: str, side: str = "ours") -> str:
    return next(row.status for row in rows if row.metric == metric and row.side == side)


# ---------------------------------------------------------------- TA1 and TA3 references


def test_trade_references_on_hand_values():
    refs = trades_references(trades_doc()["inputs"])
    assert refs["win_rate"].value == 0.4 and refs["expectancy"].value == pytest.approx(1.5, rel=1e-15)
    assert refs["avg_win"].value == 6.5 and refs["avg_loss"].value == -3.5
    assert (refs["max_win"].value, refs["max_loss"].value) == (10.0, -5.0)
    assert refs["profit_factor"].value == pytest.approx(13 / 7, rel=1e-15)
    assert refs["payoff"].value == pytest.approx(6.5 / 3.5, rel=1e-15)
    assert refs["win_rate_quantstats"].value == 0.5 and refs["win_rate_quantstats"].kind == "documented"


def test_by_entry_references_follow_eastern_time():
    refs = trades_references(trades_doc()["inputs"])
    assert refs["by_hour_n"].value == {"9": 4.0, "16": 1.0}
    assert refs["by_hour_mean"].value["9"] == pytest.approx(1.5, rel=1e-15)  # 10, -5, 3, -2
    assert math.isnan(refs["by_hour_ci_lo"].value["16"])
    assert refs["by_month_n"].value == {"3": 3.0, "4": 2.0}
    assert set(refs["by_weekday_n"].value) == {"0", "1", "2", "4"}


def test_matching_trade_values_pass_and_the_stored_hit_rate_is_compared():
    refs = trades_references(trades_doc()["inputs"])
    ours = {key: ref.value for key, ref in refs.items() if ref.kind != "documented"}
    rows = rows_for(trades_doc(ours=ours, stored={"win_rate": 0.4}))
    assert status(rows, "win_rate", "stored") == PASS
    assert {row.status for row in rows if row.side == "ours" and row.metric != "win_rate_quantstats"} == {PASS}
    documented = [row for row in rows if row.metric == "win_rate_quantstats"]  # shown for ours and stored
    assert {row.status for row in documented} == {INFO} and {row.side for row in documented} == {"ours", "stored"}
    assert compare.exit_code(rows, strict=True) == 0


def test_born_failing_a_wrong_expectancy_or_hit_rate_fails():
    rows = rows_for(trades_doc(ours={"expectancy": 1.2}, stored={"win_rate": 0.5}))
    assert status(rows, "expectancy") == FAIL and status(rows, "win_rate", "stored") == FAIL
    assert compare.exit_code(rows) == 1


def test_born_failing_a_group_mean_off_fails():
    refs = trades_references(trades_doc()["inputs"])
    shifted = {k: v + 1e-6 for k, v in refs["by_hour_mean"].value.items()}
    rows = rows_for(trades_doc(ours={"by_hour_mean": shifted}))
    assert status(rows, "by_hour_mean") == FAIL


def test_missing_trade_metric_is_a_skip():
    document = trades_doc()
    document["missing"] = {"profit_factor": "nq_terminal.analytics.trades not available"}
    rows = rows_for(document)
    assert status(rows, "profit_factor") == SKIP
    assert compare.exit_code(rows) == 0 and compare.exit_code(rows, strict=True) == 1


# ---------------------------------------------------------------- EX1 to EX4 references


def test_cost_references_on_hand_values():
    refs = costs_references(costs_doc()["inputs"])
    assert refs["gross"].value == pytest.approx(400.0, rel=1e-15)
    assert refs["commissions"].value == pytest.approx(0.61 * 40, rel=1e-15)
    assert refs["slippage"].value == pytest.approx(0.5 * 40, rel=1e-15)
    assert refs["net"].value == pytest.approx(355.6, rel=1e-15)
    assert refs["costs_total"].value == pytest.approx(44.4, rel=1e-15)
    assert refs["ladder_net_0"].value == pytest.approx(375.6, rel=1e-15)
    assert refs["ladder_net_2"].value == pytest.approx(335.6, rel=1e-15)
    assert refs["break_even_ticks"].value == pytest.approx(375.6 / 20, rel=1e-15)


def test_exposure_and_turnover_references_on_hand_values():
    refs = costs_references(costs_doc()["inputs"])
    e0, e1, e2 = costs_doc()["inputs"]["snapshots"]["equity"]
    assert refs["exposure_gross"].value == pytest.approx([4000 / e0, 4200 / e1, 0.0], rel=1e-15)
    assert refs["exposure_net"].value == pytest.approx([4000 / e0, 4200 / e1, 0.0], rel=1e-15)
    daily = [4000 / e0, 0.0, 4400 / e2]
    assert refs["turnover_daily"].value == pytest.approx(daily, rel=1e-15)
    assert refs["turnover_annualised"].value == pytest.approx(sum(daily) / 3 * 252, rel=1e-15)


def test_matching_cost_values_pass_including_stored_totals_and_re_runs():
    refs = costs_references(costs_doc()["inputs"])
    ours = {key: ref.value for key, ref in refs.items()}
    stored = {"net": 355.6, "net@delta_usd": 355.6, "costs_total": 44.4, "ladder_net_0": 375.6}
    rows = rows_for(costs_doc(ours=ours, stored=stored))
    assert {row.status for row in rows} == {PASS}
    assert {row.side for row in rows if row.metric == "net"} == {"ours", "stored", "stored@delta_usd"}


def test_born_failing_a_dropped_fill_breaks_the_exposure_agreement():
    refs = costs_references(costs_doc()["inputs"])
    ours = {"exposure_gross": refs["exposure_gross"].value}
    document = costs_doc(ours=ours)
    document["inputs"]["fills"] = {k: v[1:] for k, v in document["inputs"]["fills"].items()}
    rows = rows_for(document)
    assert status(rows, "exposure_gross") == FAIL


def test_born_failing_a_tampered_commission_string_fails_the_costs():
    refs = costs_references(costs_doc()["inputs"])
    ours = {"costs_total": refs["costs_total"].value}
    document = copy.deepcopy(costs_doc(ours=ours))
    document["inputs"]["fills"]["commission"][0] = "22.21"
    assert status(rows_for(document), "costs_total") == FAIL


def test_a_run_without_fills_counts_two_sides_per_trade():
    document = costs_doc()
    document["inputs"].update(instruments=[{"name": "NQ", "multiplier": "20.0", "tick_size": "0.25",
                                            "cost_per_side": "2.24"}], ticks=0, fills=None, snapshots=None,
                              trade_pnl=["-94.48", "310.52"], trade_commission=["4.48", "4.48"])
    refs = costs_references(document["inputs"])
    assert refs["commissions"].value == pytest.approx(2.24 * 4, rel=1e-15) and refs["slippage"].value == 0.0
    assert refs["net"].value == pytest.approx(216.04, rel=1e-15)  # gross 225 less four sides of 2.24
    assert refs["break_even_ticks"].value == pytest.approx(216.04 / (5 * 4), rel=1e-15)  # $5 a tick, 4 sides
    assert "exposure_gross" not in refs


# ---------------------------------------------------------------- parsing and paths


def test_bundle_schema_errors_are_refused():
    bad = trades_doc()
    del bad["inputs"]["entry_ts"]
    with pytest.raises(dumps.DumpError, match="entry_ts"):
        dumps.parse_bundle(bad)
    short = trades_doc()
    short["inputs"]["entry_ts"] = short["inputs"]["entry_ts"][:-1]
    with pytest.raises(dumps.DumpError):
        dumps.parse_bundle(short)
    nan = trades_doc()
    nan["inputs"]["pnl"][0] = None
    with pytest.raises(dumps.DumpError, match="NaN"):
        dumps.parse_bundle(nan)
    with pytest.raises(dumps.DumpError):
        dumps.parse_bundle({**costs_doc(), "kind": "orders"})


def test_parse_any_dispatches_on_kind():
    assert isinstance(dumps.parse_any(trades_doc()), dumps.Bundle)
    assert dumps.parse_any(costs_doc()).kind == "costs"


def test_the_default_dump_folder_is_under_terminal_qa():
    assert paths.DEFAULT_DUMP_DIR == Path(paths.__file__).resolve().parents[1] / ".dumps"
    assert paths.DEFAULT_DUMP_DIR.parent.name == "qa" and paths.DEFAULT_DUMP_DIR.parent.parent.name == "terminal"
    ignore = (paths.QA_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".dumps/" in ignore
