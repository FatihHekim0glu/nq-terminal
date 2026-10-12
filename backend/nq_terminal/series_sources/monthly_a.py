"""Series sources for ten monthly screens (round 24 to 56 rows), part A of the wave "research integrity".

`SOURCES` maps a registered name to its `SeriesSource`; the package that merges the parts (series-core) owns the
registry itself. Each mapping below was reviewed against the screen JSON, the frozen spec and the CSV header, never
against a name or a convention alone. The choices every row shares:

- Monthly books, P = 12 (ANALYTICS_CATALOG C2). The time column is a `YYYY-MM` holding or event month, dated at the
  last NYSE session of that month (`MONTH_END_SESSION`): the return of a holding window `(close e_m, close e_{m+1}]`
  is realised by `end`, the first session of the next month, so dating by `end` put every row one month late
  (dtsmom_v0's finding). A file that carries `end` uses it as the guard column, so no row is dated after the day its
  return is complete; a file without one has its dating proved from its event file by the lab-only tests.
- The unit is the one the screen states. A book sized to a fixed capital K records a return on capital, so its
  Basis A series has CAGR and total return; gotobi6j_v0 records basis points of one contract notional per event, summed
  per month, which has no K, so its unit does not open with "return on capital" and the terminal shows no CAGR for it.
- Costs: the CSV columns hold the net return at 0, 1 and 2 era ticks per side (plus $2.50 per side) where the screen
  records all three; a file with one cost column serves that cost only.
- Benchmark: the control book the screen itself regresses on first (the constant or long-only book of the same
  legs), at the one cost the screen records it at. A control that is a factor sleeve (airfx_v0's DOL, CARRY, TSMOM),
  a different strategy or a transformation of the strategy itself (liqbias_v0's `D`, its own gross event return less
  the pre-window drift) is not a benchmark and is left out: Treynor, beta and the benchmark line against it would
  mean nothing.
- The fence: no mapping here can drop a row by date. Every row relies on the shared check in
  `ResearchService.series` (a stamp on or after 2022-01-01 is an error), and the tests name that a regression guard.

All ten rows are learned. airfx_v0 states its headline sample as a row filter (the flat month 2014-10 is a row with
`held` False and every return 0.0, which the screen leaves out: n 118 of 119 rows), which `SeriesSource.keep_where`
says as `{"held": True}`. `NOT_LEARNABLE` is empty and stays so the series-core package can merge it.
"""
from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from nq_terminal.constants import MONTH_END_SESSION, SeriesSource

CAPITAL_MONTH = "return on capital per month"
BP_MONTH = "basis points of one 6J contract notional per month, summed over the month's gotobi windows"
LONG_ONLY_COMMODITY = "equal-risk long-only commodity book (cskew_v0 rule 6)"


def _costs(template: str, costs: tuple[int, ...] = (0, 1, 2)) -> Mapping[int, str]:
    return MappingProxyType({cost: template.format(k=cost) for cost in costs})


def _one(cost: int, column: str) -> Mapping[int, str]:
    return MappingProxyType({cost: column})


def _monthly(file: str, time_column: str, values: Mapping[int, str], bench: Mapping[int, str], bench_label: str | None,
             guard_column: str | None = None, void_column: str | None = None, unit: str = CAPITAL_MONTH,
             keep_where: Mapping[str, bool | str | None] | None = None) -> SeriesSource:
    return SeriesSource(file, time_column, values, unit, "monthly", bench, bench_label,
                        time_rule=MONTH_END_SESSION, guard_column=guard_column, void_column=void_column,
                        keep_where=MappingProxyType(keep_where or {}))


SOURCES: dict[str, SeriesSource] = {
    # FX amplitude-of-illiquidity book: one `held` flag per month, False in the one flat month (2014-10, every return
    # 0.0), which the screen leaves out of its 118. No benchmark (the file's DOL, carry, TSMOM, illiquidity and
    # transitory-impact sleeves are factors, not a book on the same legs), no guard (no `end` column), 1 and 2 ticks.
    "airfx_v0": _monthly("airfx_v0_monthly.csv", "label", MappingProxyType({1: "r_air_1tick", 2: "r_air_2tick"}),
                         MappingProxyType({}), None, keep_where={"held": True}),
    # Commodity MAX premium, built on the cskew_v0 book: the same calendar, `end` is the first session of the next
    # month. `lo_1` is cskew_v0's `r_lo_1` (control GM7 reproduces it to 1e-12), recorded at 1 tick only.
    "cmax_v0": _monthly("cmax_v0_monthly.csv", "label", _costs("r_cmax_{k}"), _one(1, "lo_1"), LONG_ONLY_COMMODITY,
                        guard_column="end"),
    # Soybean crush band book: a daily book summed into calendar months (123, the first three flat at 0, which are
    # months of the headline, not voids). No guard column; `const` is the constant long crush control (C1's first
    # regressor), sized as the headline, at 1 tick.
    "crushdev_v0": _monthly("crushdev_v0_monthly.csv", "month", _costs("r_{k}tick"), _one(1, "const"),
                            "constant long crush book, sized as the headline"),
    # Equity variance premium timing a fixed-sign FX basket: `end` guards the dating; `cb_1` is the constant-sign
    # basket (long 6E and 6B, short 6J) the drift control regresses on. `vp_missing` months keep a zero-weight return
    # and stay in the headline's 120.
    "eqvrp_xasset_v0": _monthly("eqvrp_xasset_v0_monthly.csv", "label", _costs("r_{k}"), _one(1, "cb_1"),
                                "constant-sign basket (long 6E and 6B, short 6J), same legs", guard_column="end"),
    # Currency value (AMP form): same calendar as carry_v0; `cb_1` is the constant short-dollar basket on the same six
    # legs, the first control of C1.
    "fxval_ppp_v0": _monthly("fxval_ppp_v0_monthly.csv", "label", _costs("r_{k}"), _one(1, "cb_1"),
                             "constant short-dollar basket, same legs", guard_column="end"),
    # Monthly sum of gotobi-window returns in basis points, one value column (1 tick). Its 2 void months are void for
    # the control `lo` only (`lo_void` holds the reason text), the book `r` has events in them, so all 132 months stay
    # and the benchmark is empty in those two. The screen's own monthly Sharpe uses the 130 months where `lo` exists.
    "gotobi6j_v0": _monthly("gotobi6j_v0_monthly.csv", "month", _one(1, "r"), _one(1, "lo"),
                            "short 6J held all month (LO), same unit", unit=BP_MONTH),
    # Gold variance premium timing GC and SI: `cb_1` is the constant long precious-metals book.
    "gvzvrp_pm_v0": _monthly("gvzvrp_pm_v0_monthly.csv", "label", _costs("r_{k}"), _one(1, "cb_1"),
                             "constant long gold and silver book", guard_column="end"),
    # 52-week-high commodity book on the cskew_v0 calendar; same long-only control as cmax_v0.
    "hi52_v0": _monthly("hi52_v0_monthly.csv", "label", _costs("r_hi52_{k}"), _one(1, "lo_1"), LONG_ONLY_COMMODITY,
                        guard_column="end"),
    # Expiry-window energy spread book: r_m sums the events whose exit (L-1) falls in month m, every exit on or before
    # the month's last NYSE session (proved from the events file by a lab-only test). No benchmark: the file's `D`
    # (the window-specificity control, the event return less the pre-window drift) is a transformation of the
    # strategy, not a book.
    "liqbias_v0": _monthly("liqbias_v0_monthly.csv", "month", _costs("r{k}"), MappingProxyType({}), None),
    # Metals timing of the YM book on vrp_eq_v0's clock: holding month h covers (L_m, L_{m+1}], `void` months are left
    # out as in vrp_eq_v0, `C` is the constant 1x YM book the headline regresses on, at every cost.
    "metals_eq_ym_v1": _monthly("metals_eq_ym_v1_monthly.csv", "label", _costs("r_T_t{k}"), _costs("r_C_t{k}"),
                                "constant 1x YM book", void_column="void"),
}

NOT_LEARNABLE: Mapping[str, str] = MappingProxyType({})
