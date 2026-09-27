"""Trade analytics (TASKS 3.4; ANALYTICS_CATALOG section 8: TA1, TA3, TA6).

- TA1: the tiles equal Nautilus `calculate_from_realized_pnls` (ProfitFactor, which 1.231.0 implements only from
  returns, through `calculate_from_returns`), on hand-built P&Ls, edge cases and every real run; the win rate
  equals the runner's `summary.hit_rate` on every real run; mean net R and t are read from `summary`.
- TA3: mean net P&L by entry hour (US/Eastern), weekday and month with a 95% t interval, against a second code
  path (a plain loop with zoneinfo and scipy).
- TA6: slippage by entry and exit reason from `results/quote_check_v1.json` (read only) equals the stored
  summary; a tampered row is born failing.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from statistics import mean, stdev
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest
from nautilus_trader.analysis import AvgLoser, AvgWinner, Expectancy, MaxLoser, MaxWinner, ProfitFactor, WinRate
from scipy import stats as sps

from nq_lab.config import RESULTS, ROOT
from nq_terminal.analytics import trades

from fakes import FIXTURES
from test_runs_support import RUNS, FakeClock, service

HAND = [10.0, -5.0, 0.0, 3.0, -2.0]
QUOTE_CHECK = RESULTS / "quote_check_v1.json"
ET = ZoneInfo("America/New_York")
NAUTILUS = {"win_rate": WinRate, "expectancy": Expectancy, "avg_win": AvgWinner, "avg_loss": AvgLoser,
            "max_win": MaxWinner, "max_loss": MaxLoser}


@lru_cache(maxsize=1)
def real_runs():
    return service(ROOT, clock=FakeClock())


@lru_cache(maxsize=1)
def fixture_runs():
    return service(FIXTURES, clock=FakeClock())


def usable_real_ids() -> list[str]:
    return sorted(s.run_id for s in real_runs().summaries() if s.readable and s.usable and s.n_trades)


def rows_of(runs, run_id: str) -> list[dict]:
    detail = runs.detail(run_id)
    return [row.model_dump() for row in runs.trades(run_id, 0, max(detail.counts.trades, 1)).items]


EXACT = frozenset({"win_rate", "max_win", "max_loss"})
PARITY = 1e-12  # relative: Nautilus sums in its own order, so means differ from numpy in the last bits


def same(a: float, b, key: str = "win_rate") -> bool:
    b = math.nan if b is None else float(b)
    if math.isnan(a) or math.isnan(b):
        return math.isnan(a) and math.isnan(b)
    return a == b if key in EXACT else abs(a - b) <= PARITY * max(abs(a), abs(b))


def nautilus_stats(pnls) -> dict:
    values = [float(v) for v in pnls]
    out = {key: cls().calculate_from_realized_pnls(values) for key, cls in NAUTILUS.items()}
    out["profit_factor"] = ProfitFactor().calculate_from_returns(dict(enumerate(values)))
    return out


# ---------------------------------------------------------------- TA1


def test_trade_stats_on_hand_values():
    s = trades.trade_stats(HAND)
    assert (s["n"], s["wins"], s["losses"], s["flat"]) == (5, 2, 2, 1)
    assert s["win_rate"] == 0.4 and s["avg_win"] == 6.5 and s["avg_loss"] == -3.5
    assert s["max_win"] == 10.0 and s["max_loss"] == -5.0
    assert s["expectancy"] == pytest.approx(1.5, rel=1e-15)  # mean over the four non-zero trades
    assert s["mean_pnl"] == pytest.approx(1.2, rel=1e-15) and s["total_pnl"] == pytest.approx(6.0, rel=1e-15)
    assert s["profit_factor"] == pytest.approx(13 / 7, rel=1e-15)
    assert s["payoff"] == pytest.approx(6.5 / 3.5, rel=1e-15)


@pytest.mark.parametrize("pnls", [HAND, [1.0, 2.0], [-1.0, -2.0], [0.0, 0.0], [], [7.25],
                                  (np.random.default_rng(3).normal(10, 200, 400).round(2).tolist() + [0.0] * 9)])
def test_trade_stats_equal_nautilus(pnls):
    ours, theirs = trades.trade_stats(pnls), nautilus_stats(pnls)
    for key, value in theirs.items():
        assert same(ours[key], value, key), (key, ours[key], value)


def test_real_trade_stats_equal_nautilus_and_the_summary_hit_rate():
    ids = usable_real_ids()
    assert len(ids) >= 50
    for run_id in ids:
        rows = rows_of(real_runs(), run_id)
        tiles = trades.trade_tiles(rows, real_runs().detail(run_id).summary_stats)
        theirs = nautilus_stats([r["pnl_usd"] for r in rows])
        for key, value in theirs.items():
            assert same(tiles["stats"][key], value, key), (run_id, key)
        assert tiles["stats"]["win_rate"] == tiles["summary"]["hit_rate"], run_id
        assert tiles["hit_rate_matches"] is True


def test_summary_values_are_read_not_recomputed():
    run_id = RUNS["za_orb"]
    summary = fixture_runs().detail(run_id).summary_stats
    tiles = trades.trade_tiles(rows_of(fixture_runs(), run_id), summary)
    for key in ("mean_net_r", "t_net_r", "gross_mean_r", "hit_rate", "mean_pnl_usd", "t_pnl_usd"):
        assert tiles["summary"][key] == summary.get(key)
    assert tiles["stats"]["n"] == summary["n_trades"] == 6


def test_born_failing_a_tampered_hit_rate_does_not_match():
    run_id = RUNS["za_orb"]
    summary = dict(fixture_runs().detail(run_id).summary_stats)
    rows = rows_of(fixture_runs(), run_id)
    assert trades.trade_tiles(rows, summary)["hit_rate_matches"] is True
    summary["hit_rate"] += 1e-9
    assert trades.trade_tiles(rows, summary)["hit_rate_matches"] is False


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), "12.5"])
def test_born_failing_a_trade_without_a_finite_pnl_is_refused(bad):
    rows = [{"pnl_usd": 1.0}, {"pnl_usd": bad}]
    with pytest.raises(trades.TradeError, match="pnl_usd"):
        trades.pnl_values(rows)


# ---------------------------------------------------------------- TA3


def loop_groups(rows: list[dict], key: str) -> dict:
    """Second code path: a plain loop with zoneinfo, statistics and scipy."""
    groups: dict[int, list[float]] = {}
    for row in rows:
        stamp = pd.Timestamp(row["entry_ts"]).to_pydatetime().astimezone(ET)
        k = {"hour": stamp.hour, "weekday": stamp.weekday(), "month": stamp.month}[key]
        groups.setdefault(k, []).append(float(row["pnl_usd"]))
    out = {}
    for k, values in groups.items():
        m = mean(values)
        if len(values) < 2:
            out[k] = (len(values), m, math.nan, math.nan)
            continue
        half = sps.t.ppf(0.975, len(values) - 1) * stdev(values) / math.sqrt(len(values))
        out[k] = (len(values), m, m - half, m + half)
    return out


@pytest.mark.parametrize("key", ["hour", "weekday", "month"])
def test_by_entry_agrees_with_a_second_code_path(key):
    rows = rows_of(real_runs(), "nt_za_v0_repaired_a")
    table = trades.by_entry(rows, key)
    other = loop_groups(rows, key)
    assert [row["key"] for row in table["rows"]] == sorted(other)
    for row in table["rows"]:
        n, m, lo, hi = other[row["key"]]
        assert row["n"] == n
        assert row["mean"] == pytest.approx(m, rel=1e-12, abs=1e-9)
        for ours, theirs in ((row["ci_lo"], lo), (row["ci_hi"], hi)):
            assert (math.isnan(ours) and math.isnan(theirs)) or ours == pytest.approx(theirs, rel=1e-12, abs=1e-9)
    assert table["tag"] == "[POST HOC]" and table["unit"] == "USD per trade"
    assert sum(row["n"] for row in table["rows"]) == len(rows)


def test_entry_hour_follows_eastern_time_across_the_clock_change():
    rows = [{"entry_ts": "2021-03-12T14:35:00+00:00", "pnl_usd": 1.0},   # EST: 09:35
            {"entry_ts": "2021-03-15T13:35:00+00:00", "pnl_usd": 3.0},   # EDT: 09:35
            {"entry_ts": "2021-03-15T20:00:00+00:00", "pnl_usd": -4.0}]  # EDT: 16:00
    table = trades.by_entry(rows, "hour")
    by_key = {row["key"]: row for row in table["rows"]}
    assert set(by_key) == {9, 16}
    assert by_key[9]["n"] == 2 and by_key[9]["mean"] == 2.0 and by_key[9]["label"] == "09:00"
    half = sps.t.ppf(0.975, 1) * stdev([1.0, 3.0]) / math.sqrt(2)
    assert by_key[9]["ci_lo"] == pytest.approx(2.0 - half, rel=1e-12)
    assert math.isnan(by_key[16]["ci_lo"]) and math.isnan(by_key[16]["ci_hi"])  # one trade: no interval
    weekdays = {row["label"] for row in trades.by_entry(rows, "weekday")["rows"]}
    assert weekdays == {"Fri", "Mon"}
    assert [row["label"] for row in trades.by_entry(rows, "month")["rows"]] == ["Mar"]


def test_by_entry_refuses_an_unknown_grouping_and_a_missing_time():
    with pytest.raises(ValueError, match="grouping"):
        trades.by_entry([{"entry_ts": "2021-03-12T14:35:00+00:00", "pnl_usd": 1.0}], "minute")
    with pytest.raises(trades.TradeError, match="entry_ts"):
        trades.by_entry([{"entry_ts": None, "pnl_usd": 1.0}], "hour")


# ---------------------------------------------------------------- TA6


def quote_doc() -> dict:
    return json.loads(QUOTE_CHECK.read_text(encoding="utf-8"))


def test_quote_check_slippage_equals_the_stored_summary():
    table = trades.slippage_distribution(quote_doc())
    groups = {g["name"]: g for g in table["groups"]}
    assert groups["entry"]["mean"] == pytest.approx(0.71875, rel=1e-12)
    assert groups["close"]["mean"] == pytest.approx(1.0, rel=1e-12)
    assert groups["stop"]["mean"] == pytest.approx(-0.7333333333333333, rel=1e-12)
    assert (groups["entry"]["n"], groups["close"]["n"], groups["stop"]["n"], groups["target"]["n"]) == (96, 20, 75, 1)
    for group in table["groups"]:
        assert group["matches_stored"] is (None if group["name"] == "live close" else True), group["name"]
        assert sum(group["counts"]) == group["n"]
    assert table["matches_stored"] is True
    assert "positive" in table["label"] and table["unit"] == "ticks of 0.25 points"


def test_born_failing_a_tampered_quote_row_no_longer_matches():
    doc = quote_doc()
    doc["trades"][0] = {**doc["trades"][0], "entry_cost_ticks": doc["trades"][0]["entry_cost_ticks"] + 1.0}
    table = trades.slippage_distribution(doc)
    groups = {g["name"]: g for g in table["groups"]}
    assert groups["entry"]["matches_stored"] is False and table["matches_stored"] is False


def test_live_slippage_drops_missing_values_and_has_no_stored_value():
    table = trades.slippage_distribution(quote_doc(), live_ticks=[0.5, None, -1.0, 2.0])
    live = next(g for g in table["groups"] if g["name"] == "live close")
    assert live["n"] == 3 and live["mean"] == pytest.approx(0.5, rel=1e-15)
    assert live["values"] == [-1.0, 0.5, 2.0] and live["counts"] == [1, 1, 1]
    assert live["matches_stored"] is None and live["source"] == "live close rows (performance only)"


def test_percentiles_are_linear_as_the_quote_check():
    table = trades.slippage_distribution(quote_doc())
    close = next(g for g in table["groups"] if g["name"] == "close")
    values = [r["exit_cost_ticks"] for r in quote_doc()["trades"] if r["reason"] == "eod"]
    assert close["p95"] == pytest.approx(float(np.percentile(values, 95)), rel=1e-12)
    assert close["p95"] == pytest.approx(quote_doc()["summary"]["exit_cost_ticks_by_reason"]["eod"]["pct"]["95"],
                                         rel=1e-12)
