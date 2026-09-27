"""TA2 MAE and MFE, TA4 holding times, TA5 streaks (TASKS 10.4; ANALYTICS_CATALOG section 8).

TA2's three trades are built by hand over six 1-minute bars (open times 14:30 to 14:35 UTC, highs and lows below);
the expected values are worked out in each test's comment. Bar rules: a bar that opens at or after the entry and
closes at or before the exit counts both extremes; a bar the entry or the exit falls strictly inside counts only its
adverse extreme (the order inside a bar is unknown, so the conservative side); a bar opening at or after the exit is
not part of the trade. The entry and exit prices themselves always count.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal.analytics import excursions, trades

BAR_OPEN = pd.date_range("2015-03-02 14:30", periods=6, freq="1min", tz="UTC")
HIGH = [101.0, 102.5, 101.5, 104.0, 103.0, 105.0]
LOW = [99.5, 100.0, 98.0, 100.5, 101.0, 102.0]
BARS = pd.DataFrame({"ts": BAR_OPEN, "h": HIGH, "l": LOW})
POINT = 20.0
TICK = 0.25


def trade(direction, entry, exit_, entry_px, exit_px, r_pts=None, pnl_usd=None):
    return {"direction": direction, "entry_ts": entry, "exit_ts": exit_, "entry_px": entry_px, "exit_px": exit_px,
            "r_pts": r_pts, "pnl_usd": pnl_usd if pnl_usd is not None else direction * (exit_px - entry_px) * POINT}


T1 = trade(1, "2015-03-02T14:30:00+00:00", "2015-03-02T14:34:00+00:00", 100.0, 102.0, r_pts=2.0)
T2 = trade(-1, "2015-03-02T14:31:30+00:00", "2015-03-02T14:33:30+00:00", 101.0, 100.0)
T3 = trade(1, "2015-03-02T14:40:00+00:00", "2015-03-02T14:45:00+00:00", 103.0, 102.5)


def by_trade(rows):
    return excursions.excursions(rows, BARS, point_value=POINT, tick=TICK)["rows"]


def test_trade_one_long_whole_bars():
    # bars 14:30 to 14:33 are whole (14:34 opens at the exit): MFE max(h) 104 - 100 = 4; MAE min(l) 98 - 100 = -2
    row = by_trade([T1])[0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-2.0, 4.0)
    assert (row["mae_r"], row["mfe_r"]) == (-1.0, 2.0)
    assert (row["whole_bars"], row["partial_bars"]) == (4, 0)
    assert row["mae_usd"] == -40.0 and row["mfe_usd"] == 80.0 and row["win"] is True


def test_trade_two_short_partial_entry_and_exit_bars():
    # entry 14:31:30 inside bar 14:31 (adverse only: -(102.5 - 101) = -1.5); bar 14:32 whole (adverse -(101.5 - 101)
    # = -0.5, favourable -(98 - 101) = 3); exit 14:33:30 inside bar 14:33 (adverse only: -(104 - 101) = -3).
    # Final +1 point. MAE -3, MFE 3; no r_pts, so no R values.
    row = by_trade([T2])[0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-3.0, 3.0)
    assert row["mae_r"] is None and row["mfe_r"] is None
    assert (row["whole_bars"], row["partial_bars"]) == (1, 2)


def test_trade_three_without_bars_uses_entry_and_exit_only():
    # no bar in 14:40 to 14:45: MAE min(0, -0.5) = -0.5, MFE max(0, -0.5) = 0, flagged
    row = by_trade([T3])[0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-0.5, 0.0) and row["no_bars"] is True and row["win"] is False


def naive_mfe(row) -> float:
    """A naive rule that counts every bar from the entry minute to the exit whole."""
    entry, exit_ = pd.Timestamp(row["entry_ts"]).floor("1min"), pd.Timestamp(row["exit_ts"])
    inside = BARS[(BARS["ts"] >= entry) & (BARS["ts"] < exit_)]
    fav = row["direction"] * (np.r_[inside["h"], inside["l"]] - row["entry_px"])
    return float(max(0.0, row["direction"] * (row["exit_px"] - row["entry_px"]), fav.max()))


def test_born_failing_the_partial_entry_bar_is_not_counted_whole():
    # short entry 14:33:30 at 103 inside bar 14:33: adverse only -(104 - 103) = -1 (its low 100.5 would give 2.5);
    # bar 14:34 whole: -(103 - 103) = 0 and -(101 - 103) = 2; exit 14:35:00 at 102 (+1). MFE 2, MAE -1.
    row = trade(-1, "2015-03-02T14:33:30+00:00", "2015-03-02T14:35:00+00:00", 103.0, 102.0)
    found = by_trade([row])[0]
    assert (found["mae_pts"], found["mfe_pts"]) == (-1.0, 2.0)
    assert (found["whole_bars"], found["partial_bars"]) == (1, 1)
    assert naive_mfe(row) == 2.5 != found["mfe_pts"]


def test_summary_and_the_label():
    found = excursions.excursions([T1, T2, T3], BARS, point_value=POINT, tick=TICK)
    assert found["n"] == 3 and found["no_bars"] == 1 and found["in_r"] == 1
    assert "adverse" in found["label"] and "1-minute bars" in found["label"]


def test_bad_rows_are_refused():
    with pytest.raises(excursions.ExcursionError):
        excursions.excursions([dict(T1, direction=0)], BARS, point_value=POINT, tick=TICK)
    with pytest.raises(excursions.ExcursionError):
        excursions.excursions([dict(T1, exit_ts="2015-03-02T14:29:00+00:00")], BARS, point_value=POINT,
                                  tick=TICK)


# ---------------------------------------------------------------- TA2: the exit bar of an intrabar fill

# za's first trade shape (statistics review): a long enters at 5790.5 at 13:35 (the 13:34 bar's close), its stop
# 5786.0 (r_pts 4.5) fills inside the 13:36 bar, and the fill is stamped at that bar's close, 13:37.
STOP_BARS = pd.DataFrame({"ts": pd.date_range("2010-09-29 13:34", periods=3, freq="1min", tz="UTC"),
                          "h": [5791.0, 5791.5, 5792.5], "l": [5789.5, 5788.0, 5784.0]})


def za_trade(reason, exit_px):
    return dict(trade(1, "2010-09-29T13:35:00+00:00", "2010-09-29T13:37:00+00:00", 5790.5, exit_px, r_pts=4.5),
                reason=reason)


def stop_rows(rows, bars=STOP_BARS):
    return excursions.excursions(rows, bars, point_value=POINT, tick=TICK)


def test_born_failing_a_stop_exit_bar_adds_nothing_past_the_fill():
    # 13:35 is whole: adverse 5788 - 5790.5 = -2.5, favourable 5791.5 - 5790.5 = 1. The 13:36 bar holds the stop
    # fill: its low 5784 came after the exit and its high may have too, so it adds nothing. MAE min(0, -4.5, -2.5)
    # = -4.5 (-1R, the stop), MFE max(0, -4.5, 1) = 1. The old rule counted 13:36 whole: MAE -6.5, MFE 2.
    row = stop_rows([za_trade("stop", 5786.0)])["rows"][0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-4.5, 1.0)
    assert row["mae_r"] == -1.0 and (row["whole_bars"], row["partial_bars"]) == (1, 1)
    old_mae = min(0.0, -4.5, *(STOP_BARS["l"][1:] - 5790.5))
    assert old_mae == -6.5 != row["mae_pts"]


def test_a_target_exit_bar_keeps_its_adverse_extreme_only():
    # target 5795 fills inside 13:36 (h 5797, l 5789): its favourable 6.5 is after the exit, its adverse -1.5 may be
    # before it (the conservative side). 13:35 whole: -2.5 and 1. MAE -2.5, MFE max(0, 4.5, 1) = 4.5.
    bars = STOP_BARS.assign(h=[5791.0, 5791.5, 5797.0], l=[5789.5, 5788.0, 5789.0])
    row = stop_rows([za_trade("target", 5795.0)], bars)["rows"][0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-2.5, 4.5)


def test_a_market_exit_at_the_bar_close_keeps_the_bar_whole():
    # an end-of-day exit fills at the 13:36 bar's close (stamped 13:37): the bar is inside the trade
    row = stop_rows([za_trade("eod", 5786.0)])["rows"][0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-6.5, 2.0) and row["whole_bars"] == 2


def test_a_stop_filled_strictly_inside_its_bar_adds_nothing_either():
    row = stop_rows([dict(za_trade("stop", 5786.0), exit_ts="2010-09-29T13:36:40+00:00")])["rows"][0]
    assert (row["mae_pts"], row["mfe_pts"]) == (-4.5, 1.0)


# ---------------------------------------------------------------- TA2: price basis of the bars and the fills


def test_fills_inside_their_bars_are_on_basis():
    found = stop_rows([za_trade("stop", 5786.0)])
    assert found["rows"][0]["off_basis"] is False and (found["off_basis"], found["basis_checked"]) == (0, 1)


def test_born_failing_bars_on_another_basis_are_counted():
    # the QA dumps once paired fills near 5790 with bars near 2480; bars 1,000 points away must be flagged
    shifted = STOP_BARS.assign(h=STOP_BARS["h"] + 1000.0, l=STOP_BARS["l"] + 1000.0)
    found = stop_rows([za_trade("stop", 5786.0)], shifted)
    assert found["rows"][0]["off_basis"] is True and (found["off_basis"], found["basis_checked"]) == (1, 1)


def test_one_tick_outside_the_bar_is_still_on_basis():
    assert stop_rows([za_trade("stop", 5786.0)], STOP_BARS.assign(l=[5789.75, 5788.0, 5786.25]))["off_basis"] == 0
    assert stop_rows([za_trade("stop", 5786.0)], STOP_BARS.assign(l=[5789.75, 5788.0, 5786.5]))["off_basis"] == 1


def test_a_trade_without_bars_is_not_checked():
    found = excursions.excursions([T3], BARS, point_value=POINT, tick=TICK)
    assert found["rows"][0]["off_basis"] is False and found["basis_checked"] == 0


# ---------------------------------------------------------------- TA2: bar time resolution


def test_born_failing_microsecond_bar_times_give_the_same_rows():
    # pandas 3 parses to microseconds; asi8 is then in us while Timestamp.value is in ns, so every search missed
    micro = BARS.assign(ts=pd.DatetimeIndex(BARS["ts"]).as_unit("us"))
    assert excursions.excursions([T1, T2], micro, point_value=POINT, tick=TICK)["rows"] == by_trade([T1, T2])


# ---------------------------------------------------------------- TA4


def test_holding_times_in_minutes_with_log_bins():
    rows = [T1, T2, T3, dict(T1, exit_ts=T1["entry_ts"])]
    found = trades.holding_times(rows)
    assert found["unit"] == "minutes" and found["n"] == 4 and found["zero"] == 1
    assert found["durations"] == [4.0, 2.0, 5.0, 0.0]
    kept = np.log10([4.0, 2.0, 5.0])
    assert found["log10_edges"] == pytest.approx(np.histogram_bin_edges(kept, bins="sturges").tolist())
    assert sum(found["counts"]) == 3 and found["median"] == 3.0


# ---------------------------------------------------------------- TA5


def test_streaks_and_the_runs_test():
    pnl = [5, 3, -1, 0, 2, 4, 6, -2, -3, -1, 1]
    rows = [{"pnl_usd": float(p)} for p in pnl]
    found = trades.streaks(rows)
    assert found["longest_win"] == 3 and found["longest_loss"] == 3
    signs = [p > 0 for p in pnl if p != 0]
    n1, n2 = sum(signs), len(signs) - sum(signs)
    runs = 1 + sum(a != b for a, b in zip(signs, signs[1:]))
    mean = 2 * n1 * n2 / (n1 + n2) + 1
    var = 2 * n1 * n2 * (2 * n1 * n2 - n1 - n2) / ((n1 + n2) ** 2 * (n1 + n2 - 1))
    z = (runs - mean) / math.sqrt(var)
    test = found["runs_test"]
    assert (test["wins"], test["losses"], test["runs"]) == (n1, n2, runs)
    assert test["z"] == pytest.approx(z, rel=1e-12) and test["p"] == pytest.approx(2 * sps.norm.sf(abs(z)), rel=1e-12)


def test_a_zero_breaks_both_streaks():
    found = trades.streaks([{"pnl_usd": v} for v in (1.0, 1.0, 0.0, 1.0, -1.0, 0.0, -1.0)])
    assert found["longest_win"] == 2 and found["longest_loss"] == 1


def test_runs_test_needs_both_signs():
    found = trades.streaks([{"pnl_usd": 1.0}, {"pnl_usd": 2.0}])
    assert found["runs_test"]["z"] is None and found["longest_loss"] == 0
