"""Series sources for ten monthly screens, part B of the wave "research integrity".

`SOURCES` maps a registered name to its `SeriesSource`; the package that merges the parts (series-core) owns the
registry itself. Each mapping was reviewed against the screen JSON, the frozen spec and the CSV header, and is
anchored by `tests/test_series_monthly_b.py`: the series reproduces the numbers the screen records at 1e-9 (n, mean,
sd and Sharpe at 1 tick, the mean at 0 and 2 ticks, the benchmark, and the date of every row).

What the ten share:

- Monthly books, P = 12 (ANALYTICS_CATALOG C2), a return on the capital K per month (`CAPITAL_MONTH`), net of 1 era
  tick plus $2.50 per side at cost 1, of 0 ticks plus $2.50 at cost 0 and of 2 ticks plus $2.50 at cost 2.
- The time column names the holding month (`YYYY-MM`, or a date inside it for zqcut_v0), dated at the last NYSE
  session of that month (`MONTH_END_SESSION`). A file with a `label, start, end` layout (the dtsmom_v0 family) holds a
  window `(close of the first session, close of the first session of the next month]`: its `end` is one session after
  the month end, so dating by `end` put every row one session late, and `end` is the guard column. A file without an
  `end` records the calendar month: the screens say so (rateamp_tsy_v0 "month m+1 is (close d_m, close d_{m+1}]",
  xsintra_w_v0 "sum of daily net $ in calendar month m"), and the month-end session is the day its return is complete.
- The benchmark is the control book the screen itself regresses on, the one with no timing or ranking in it (the
  constant or long-only book of the same legs), at the cost the screen records it at. A control that is a factor
  sleeve or another strategy (TSMOM, CARRY, LIN, UNC and the rest) is not a benchmark and is left out.
- The fence: no mapping here can drop a row by date. Every row relies on the shared check in
  `ResearchService.series` (a stamp on or after 2022-01-01 is an error); the tests name that a regression guard. All
  ten screens record a sample that ends on or before 2021-12-31, so nothing is left unlearned for passing the fence.

Row by row (time column and guard, void handling, benchmark):

- oigrowth_v0: `label`, guard `end`; no void month (a flat month is a row worth 0, none occurs); benchmark `r_lo_k`,
  the constant 1x equal-risk long-only 14-commodity basket, at 0, 1 and 2 ticks.
- rateamp_tsy_v0: `month`, no guard column in the file; `void` flags a month with too many void tenors, whose returns
  are NaN in the screen's own book (`r[vm] = nan`), so the month is left out twice over; benchmark `lo1`, the W = 1
  twin of the headline, at 1 tick only.
- stmomturn_v0: `label`, guard `end`; no void month; benchmark `lo20_1`, carry_v0's equal-risk long-only book of the
  COMM and FX sleeves (LO20), at 1 tick only. UNC (the unconditional 1-month book), CARRY and TSMOM are controls.
- termprem_cmdty_v0: `label`, guard `end`; no void month; benchmark `r_lo_1`, the cskew_v0 equal-risk long-only
  commodity book, at 1 tick only.
- tsyauction_mid_v0: `month`, no guard (the legs end inside the month: the post leg runs A to A + 5 sessions from an
  auction in days 1 to 20); `void` holds a reason text and a void month has empty returns, so empty values drop it
  (the fxeomhedge_v0 pattern); benchmark `lo{k}`, the all-month long-only Treasury book (eomtsy_v0 rule 7).
- tsydemfx_v0: `month`, no guard; no void month; cost 0 is `r_fee_only` (fee only, no slippage), cost 1 `r_1tick`,
  cost 2 `r_2tick`; `r_gross` is gross of the fee and has no cost key. The benchmark `ctl_LO` is the screen's gross
  long-only control (no costs at all), served at every cost and labelled gross.
- xsbreadth_q_v0: `label`, guard `end`; no void month (`flat` months are rows worth 0); benchmark `lo_1`, the
  equal-risk long-only book of the admitted markets, at 1 tick only.
- xsintra_w_v0: `label` (calendar months), no guard; benchmark `lo15_1`, the equal-risk long-only book of the 15
  traded markets, at 1 tick only.
- xsml_m_v0: `label`, guard `end`; benchmark `lo21_1`, the equal-risk long-only book of the 21 traded markets, at
  1 tick only.
- zqcut_v0: `e` (the entry session, always the first session of the holding month), guard `x` (the exit, the first
  session of the next month); a void month enters as 0 in the screen's own statistics ("a void there enters as 0, as
  every void does") and is a row worth 0 in the file, so it is kept (T counts it); benchmark `cl`, the constant
  full-weight long m+6 ZQ book (CL), at 1 tick only.

Not learned: none. `NOT_LEARNABLE` is empty.
"""
from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from nq_terminal.constants import MONTH_END_SESSION, SeriesSource

CAPITAL_MONTH = "return on capital per month"
GROSS_LONG_ONLY = "constant long book, gross of every cost (the screen's LO control)"

NOT_LEARNABLE: Mapping[str, str] = MappingProxyType({})


def _ticks(template: str, costs: tuple[int, ...] = (0, 1, 2)) -> Mapping[int, str]:
    return MappingProxyType({cost: template.format(k=cost) for cost in costs})


def _monthly(file: str, time_column: str, values: Mapping[int, str], bench: Mapping[int, str], bench_label: str,
             guard_column: str | None = None, void_column: str | None = None) -> SeriesSource:
    return SeriesSource(file, time_column, values, CAPITAL_MONTH, "monthly", bench, bench_label,
                        time_rule=MONTH_END_SESSION, guard_column=guard_column, void_column=void_column)


SOURCES: Mapping[str, SeriesSource] = MappingProxyType({
    "oigrowth_v0": _monthly(
        "oigrowth_v0_monthly.csv", "label", _ticks("r_timed_{k}"), _ticks("r_lo_{k}"),
        "constant 1x equal-risk long-only 14-commodity basket (LO)", guard_column="end"),
    "rateamp_tsy_v0": _monthly(
        "rateamp_tsy_v0_monthly.csv", "month", _ticks("r{k}"), _ticks("lo1", (1,)),
        "constant long ZF, ZN and ZB book, the W = 1 twin of the headline (LO)", void_column="void"),
    "stmomturn_v0": _monthly(
        "stmomturn_v0_monthly.csv", "label", _ticks("r_{k}"), _ticks("lo20_1", (1,)),
        "equal-risk long-only book of the commodity and FX sleeves (LO20)", guard_column="end"),
    "termprem_cmdty_v0": _monthly(
        "termprem_cmdty_v0_monthly.csv", "label", _ticks("r_{k}"), _ticks("r_lo_1", (1,)),
        "equal-risk long-only commodity book (cskew_v0 rule 6)", guard_column="end"),
    "tsyauction_mid_v0": _monthly(
        "tsyauction_mid_v0_monthly.csv", "month", _ticks("r{k}"), _ticks("lo{k}"),
        "all-month long-only ZF, ZN and ZB book (eomtsy_v0 rule 7)"),
    "tsydemfx_v0": _monthly(
        "tsydemfx_v0_monthly.csv", "month", MappingProxyType({0: "r_fee_only", 1: "r_1tick", 2: "r_2tick"}),
        _ticks("ctl_LO"), GROSS_LONG_ONLY),
    "xsbreadth_q_v0": _monthly(
        "xsbreadth_q_v0_monthly.csv", "label", _ticks("r_ml_{k}"), _ticks("lo_1", (1,)),
        "equal-risk long-only book of the admitted markets (LO)", guard_column="end"),
    "xsintra_w_v0": _monthly(
        "xsintra_w_v0_monthly.csv", "label", _ticks("r_ml_{k}"), _ticks("lo15_1", (1,)),
        "equal-risk long-only book of the 15 traded markets (LO15)"),
    "xsml_m_v0": _monthly(
        "xsml_m_v0_monthly.csv", "label", _ticks("r_ml_{k}"), _ticks("lo21_1", (1,)),
        "equal-risk long-only book of the 21 traded markets (LO21)", guard_column="end"),
    "zqcut_v0": _monthly(
        "zqcut_v0_monthly.csv", "e", _ticks("r{k}"), _ticks("cl", (1,)),
        "constant full-weight long m+6 ZQ book (CL)", guard_column="x"),
})
