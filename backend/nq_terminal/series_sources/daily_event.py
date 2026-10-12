"""Series sources for the daily and event rows of the registry (wave w3, slice series-daily-event).

Fourteen registered rows have a screen file that is not a monthly book: four daily files, nine event, leg or trade
files and one weekly event file. This module maps the ones whose headline sample a `SeriesSource` can reproduce
(twelve) and says, for the other two, why not (`NOT_LEARNABLE`). Nothing here reads a file; the mapping only names
columns, and every column named is a return, a date or a cost, never a price (`tests/test_series_daily_event.py`
checks that against `constants.PRICE_COLUMN`).

Choices that bind every row below (ANALYTICS_CATALOG C1 and C2, SV3a step 2):
- Event rows are `trades`. The file holds one value per event (or per event day) and nothing on the sessions between;
  `analytics.series.hypothesis_series` sums the events per session and puts them on every session of the window,
  0 where there is no event, exactly as the calendar rows (tom_v0, prefomc_v0, fomctone_v0) already are. Reading the
  events alone as a `daily` series would annualise 8 events a year as if they were 252 sessions and so flatter the
  Sharpe the Deflated Sharpe compares.
- The one `daily` row, lhrev_letf_v0, has a value on every mark (flat marks included), so it is used as recorded.
- A value is dated at the session the return is realised, never the session the signal forms: fomcdrift_tsy_v0 at
  its `exit` (E+15), pretra_tsy_v0 at the pre-refunding Friday `P`, fomcfx_v0 at the statement day `D` (entry at the
  close of the session before), wkndgap_fx_v0 at the Monday `week` (entry Sunday 18:00 CT, exit Monday 15:59 CT),
  wkndshort_v0 at each leg's exit `X` (the first full day after the Friday entry `F`: normally the Monday, a session
  later when that day is a holiday, an early close or a year-end day). The intraday books (fedflow, tsyauct,
  cropsmooth, fomcpc) realise on the day itself.
- A trades row's zero fill starts where its sample starts (`window_start`), never at the NQ data start when the spec
  or screen fixes a later one: padding sessions before the sample lowers the Sharpe and zero-fills events the screen
  left out (statistics review of wave w3: fomcdrift, fomcfx, fomcpc and pretra).
- wkndgap_fx_v0's weekly file holds a row for every valid week, 0.0 in a week without an event; a zero row adds
  nothing to the session sum, so the served series is the 117 events of the headline and the zero fill.
- wkndshort_v0 is learned from its legs file, not its weekly file: the weekly file dates each week at the Friday
  entry and holds no exit date, while every leg carries its exit `X`. Spec rule 2 defines the weekly book as the sum
  of the active legs over K ($100M); the legs of a week share one exit, so the session sum is that book in USD
  (381 events, equal to the weekly `r1` times K in every week).
- A file that mixes the headline sample with other rows says so in `keep_where`: hvix_nd_v0 keeps the sessions where
  its `headline` column is True (100 spike sessions of the 2,193 valid ones), apieia_ho_v0 the rows whose `kind`
  is `event` and whose `void` is empty (426 of 1,294) and wkndshort_v0 the legs whose `active` is True (1,465 of
  the 6,888 market-weeks). Rows the rule leaves out are not voids and are never zeroed.
- A void event is left out, never zeroed (the screen's n excludes it): cropsmooth_v0's two warm-up dates and
  fomcfx_v0's two dates with six void roots have empty values, so the default empty-row rule drops them.
- Units follow the spec: a fraction of K is "return on capital", a basis-point column is "basis points of
  capital" unless the spec defines another base (apieia_ho_v0: basis points of one HO contract's entry price), and a
  USD leg is "USD of the K = $100M book" (wkndshort_v0; a USD unit is not on capital). The Sharpe ratio is scale
  free, so they stay comparable.
- Costs: 0, 1 and 2 ticks per side where the file holds all three (every mapped row does but wkndshort_v0, whose
  legs record the net at 1 tick only, `h_net1`).
- No benchmark is mapped for a `trades` row: `hypothesis_series` lines a benchmark column up with the summed session
  series row for row, which only works when the file has one row per session. lhrev_letf_v0 is such a file and keeps
  its LO control (1 tick, the only cost the control is recorded at).

Fence: every mapped row's screen records a sample that ends on or before 2021-12-31 (serves end at 2022-01-01
exclusive; the spec says so for the three screens that record no serve window). No event is dated after the fence;
the shared check in `ResearchService.series` refuses a row dated on or after it, and the tests plant one.
"""
from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from nq_terminal.constants import SeriesSource

CAPITAL_PER_TRADE = "return on capital per trade"
BP_PER_TRADE = "basis points of capital per trade"
BP_PER_HO_CONTRACT = "basis points of one HO contract notional per trade"
BOOK_USD_PER_TRADE = "USD of the K = $100M book per trade"
CAPITAL_PER_SESSION = "return on capital per session"
TRADES, DAILY = "trades", "daily"
COSTS = (0, 1, 2)


def _per_cost(template: str) -> Mapping[int, str]:
    """The value column at each recorded tick cost, from a name template with `{k}`."""
    return MappingProxyType({cost: template.format(k=cost) for cost in COSTS})


SOURCES: dict[str, SeriesSource] = {
    # Fed Treasury purchase operations: one row per event day, net basis points of K at 0, 1, 2 and 3 ticks.
    # The screen's frozen effective start is 2010-12-02, so the zero fill starts there, not at the NQ data start.
    "fedflow_tsy_v0": SeriesSource("fedflow_tsy_v0_daily.csv", "day", _per_cost("net_bp_{k}"), BP_PER_TRADE, TRADES,
                                  window_start="2010-12-02"),
    # NQ last half hour reversal: a return on K for every mark, flat marks included (2,784 marks).
    "lhrev_letf_v0": SeriesSource("lhrev_letf_v0_daily.csv", "date", _per_cost("r_{k}"), CAPITAL_PER_SESSION, DAILY,
                                  MappingProxyType({1: "lo_net1"}), "long-only last-half-hour book (LO control)"),
    # ML protocol on auction days: one row per test auction day (zero when no leg traded), fractions of K. The
    # walk-forward tests from the first 2013 session (first event 2013-01-08), so the zero fill starts there.
    "tsyauct_intra_ml_v0": SeriesSource("tsyauct_intra_ml_v0_daily.csv", "date",
                                        MappingProxyType({0: "r_ml_0tick", 1: "r_ml_1tick", 2: "r_ml_2tick"}),
                                        CAPITAL_PER_TRADE, TRADES, window_start="2013-01-02"),
    # USDA revisions on report dates: basis points of K; the two warm-up dates have empty values and are left out.
    "cropsmooth_v0": SeriesSource("cropsmooth_v0_dates.csv", "R", _per_cost("net_{k}tick_bp"), BP_PER_TRADE, TRADES),
    # VIX spike overnight: entered after the close of the signal day, exited at 15:59 ET of the next session, dated at
    # the exit stamp, where the return is realised. Basis points of K at 0 (fee only), 1 and 2 ticks. The headline is
    # the spike sessions (`headline` True); the net return is filled on every valid session, so the rule is what
    # selects the sample. The zero fill starts at the first valid session (2010-10-11), the first the screen evaluates.
    "hvix_nd_v0": SeriesSource("hvix_nd_v0_sessions.csv", "exit_ts",
                               MappingProxyType({0: "r_fee_bp", 1: "r_net1_bp", 2: "r_net2_bp"}), BP_PER_TRADE, TRADES,
                               window_start="2010-10-11", keep_where=MappingProxyType({"headline": True})),
    # Heating oil on API and EIA report days: one intraday trade per event day, net at 0, 1 and 2 ticks (`n0`, `n1`,
    # `n2`) in basis points of the entry price of one HO contract (spec rule 2), not of a capital K. The file also
    # holds two control weekday groups and the voided events; the headline is the `event` rows with an empty `void`.
    # The zero fill starts at the first trade day (2010-10-06), not the placebo row the day before.
    "apieia_ho_v0": SeriesSource("apieia_ho_v0_events.csv", "date", _per_cost("n{k}"), BP_PER_HO_CONTRACT, TRADES,
                                 window_start="2010-10-06",
                                 keep_where=MappingProxyType({"kind": "event", "void": None})),
    # Post-FOMC drift: entered E+1, exited E+15; dated at the exit, where the return is realised. The sample starts
    # with the spec's first scheduled statement (2011-01-26), so the 2010-11-03 and 2010-12-14 statements it excludes
    # are not zero-filled.
    "fomcdrift_tsy_v0": SeriesSource("fomcdrift_tsy_v0_events.csv", "exit", _per_cost("r{k}"), CAPITAL_PER_TRADE,
                                     TRADES, window_start="2011-01-26"),
    # FOMC day in six FX futures: entry at the close of the session before D, exit at the close of D. The sample
    # starts in December 2010, after the 2010-11-03 statement the screen dropped as unwarmed.
    "fomcfx_v0": SeriesSource("fomcfx_v0_events.csv", "D", _per_cost("r{k}"), CAPITAL_PER_TRADE, TRADES,
                              window_start="2010-12-01"),
    # FOMC press conference hour in six FX futures: one day, basis points of K. The sample starts at the spec's first
    # event (2011-04-27, the first press conference).
    "fomcpc_fx_v0": SeriesSource("fomcpc_fx_v0_events.csv", "day", _per_cost("r{k}_bp"), BP_PER_TRADE, TRADES,
                                 window_start="2011-04-27"),
    # Pre-refunding Friday in Treasury futures: entry at the close before P, exit at the close of P. The sample starts
    # at the spec's panel start (2011-01-03), so the late-2010 refunding Friday it excludes is not zero-filled.
    "pretra_tsy_v0": SeriesSource("pretra_tsy_v0_events.csv", "P", _per_cost("r{k}"), CAPITAL_PER_TRADE, TRADES,
                                  window_start="2011-01-03"),
    # Weekend gap in six FX futures: one trade per active week, entered Sunday 18:00 CT and exited Monday 15:59 CT,
    # dated at the Monday session `week`, basis points of K at 0, 1 and 2 ticks. Weeks without an event are 0.0 rows
    # (117 events in 383 valid weeks). The zero fill starts at the screen's first valid week.
    "wkndgap_fx_v0": SeriesSource("wkndgap_fx_v0_weekly.csv", "week", _per_cost("r{k}"), BP_PER_TRADE, TRADES,
                                  window_start="2011-06-20"),
    # Weekend short in high-volatility weeks (twelve markets): one leg per active market-week, short from the Friday
    # `F` close to the close of the first full day after it, dated at that exit `X`; net USD at 1 tick (`h_net1`).
    # The headline legs are the `active` ones. The zero fill starts at the exit of the spec's first eligible Friday
    # (2011-10-14).
    "wkndshort_v0": SeriesSource("wkndshort_v0_legs.csv", "X", MappingProxyType({1: "h_net1"}), BOOK_USD_PER_TRADE,
                                 TRADES, window_start="2011-10-17", keep_where=MappingProxyType({"active": True})),
}

# Rows of this slice the current `SeriesSource` cannot reproduce. A mapping reached by dropping or reshaping rows would
# be a different sample from the screen's, so these stay unlearned with the reason shown beside them.
NOT_LEARNABLE: dict[str, str] = {
    "dburst_rev_v1": (
        "The headline is the mean of the leg returns inside each of 413 episodes (626 legs across ES, NQ and YM, up to "
        "three markets in one episode). A series source dates and sums rows; it cannot average the legs of an "
        "episode, and the per-session sum is a different statistic (mean of -5.25 against the screen's -1.83 at "
        "1 tick)."),
    "xfut_tcn120_v0": (
        "The trade file holds gross and cost in USD per trade, so the net return at a tick cost is gross minus cost "
        "divided by a capital K that the file does not carry (the spec fixes K at 100 million USD). A series source "
        "reads one finished column per cost, and the screen's book is a 2,267 session daily book, not the trades."),
}
