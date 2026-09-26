"""Frozen tables: sealed allowlists and key rules, screen aliases, sealed-window links, rounds, series, mnemonics.

Mnemonics (ARCHITECTURE s2): the command line table, pinned to UI_SPEC section 5 by `tests/test_mnemonics.py`,
and the catalog-only instruments the command index adds to the dtsmom table.

Sealed CSV allowlists (PRD DL14, ARCHITECTURE s3.3). The sealed CSVs hold 2022+ prices, so each file is
served through the columns named here and nothing else; a new column in a later file stays hidden until it
is added on purpose. The service refuses an allowlist that names a column the file lacks, or a column that
matches `PRICE_COLUMN` (`px|raw|price` in any case, `_c` at the end, or a bare `O`, `H`, `L` or `C`).

Screen aliases mirror `nq_lab.registry.RESULT_FILE` (the registry reads those rows from another screen
file); a test fails if the two drift apart.

Rounds and summaries: the round each registered hypothesis belongs to and the summary that reports it.
A name missing here falls back, at run time, to the summary whose title line names it.

Series sources: where the Basis A series of each hypothesis lives (ANALYTICS_CATALOG C1) and which column
holds the value at 0, 1 or 2 ticks per side. Only these columns are read; none is a price column (tested).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Mapping

PRICE_COLUMN = re.compile(r"(?i:px|raw|price)|_c$|^[OHLC]$")
# Sealed JSON keys (a denylist, stricter than the CSV check above, because the JSONs have no allowlist): any key
# that PRICE_COLUMN catches, a word from PRICE_KEY_WORDS in any case (split on anything but letters and digits),
# a `_none` or `_back` suffix, or one of the single letters the project uses for prices and month anchors. The
# lowercase `c` is not among them: in the sealed files it is the vol-managed exposure scale.
PRICE_KEY_WORDS = frozenset({"px", "raw", "price", "prices", "close", "open", "high", "low", "settle", "entry", "exit"})
PRICE_KEY_SUFFIXES = ("_none", "_back")
PRICE_KEY_LETTERS = frozenset({"o", "h", "l", "O", "H", "L", "C", "A", "S", "E", "X"})
SPENT_LABEL = "spent window, opened {date}, descriptive only"
SPENT_LABEL_UNDATED = "spent window, descriptive only"

_VOLMANAGED_OOS = ("date", "variant", "roll", "sigma2", "c", "wstar", "N", "n_bh", "held_exposure",
                   "r_m_0", "r_bh_0", "r_m_1", "r_bh_1", "r_m_2", "r_bh_2")
_REBAL_CONFIRM = ("month", "year", "mon", "s", "pct", "x_pct",
                  "net_nq_0", "usd_nq_0", "net_nq_1", "usd_nq_1", "net_nq_2", "usd_nq_2",
                  "net_mnq_1", "usd_mnq_1", "net_mnq_2", "usd_mnq_2",
                  "long_only_pos", "long_only_usd_1tick", "long_usd_1tick", "long_only_usd_2tick", "long_usd_2tick",
                  "long_short_pos", "long_short_usd_1tick", "long_short_usd_2tick",
                  "spans_closure", "roll", "rolls")
SEALED_CSV_ALLOWLIST: Mapping[str, tuple[str, ...]] = MappingProxyType({
    "volmanaged_oos_daily.csv": _VOLMANAGED_OOS,
    "rebal_v1_confirm_trades.csv": _REBAL_CONFIRM,
})

SCREEN_ALIASES: Mapping[str, str] = MappingProxyType({
    "za_v0": "za_v0_repaired",
    "za_v0_C3_gao_momentum": "za_v0_repaired",
})

# Sealed-window links (UI_SPEC s7 DES "in-sample against sealed strip"): the confirmation that tested each
# in-sample hypothesis, and the sealed files (by stem, as `/api/sealed/{name}` serves them) that belong to it.
# Neither the sealed JSON nor the spec names its parent, so the link is written down here once.
CONFIRMS: Mapping[str, str] = MappingProxyType({"rebal_v1_confirm": "rebal_v0"})
SEALED_BY_PARENT: Mapping[str, tuple[str, ...]] = MappingProxyType({
    "rebal_v0": ("rebal_v1_confirm", "rebal_v1_confirm_trades"),
    "volmanaged_v0": ("volmanaged_oos", "volmanaged_oos_daily"),
})

_ROUND_FILES = (
    (0, None, ("za_v0", "za_v0_C3_gao_momentum")),
    (1, "calendar_summary.md", ("tom_v0", "preholiday_v0", "prefomc_v0", "overnight_v0")),
    (2, "calendar_summary.md", ("macroday_v0", "halloween_v0")),
    (3, "sizing_summary.md", ("volmanaged_v0", "tsmom_v0")),
    (4, "round4_summary.md", ("rebal_v0", "mac5rev_v0")),
    (5, "round5_summary.md", ("fomccycle_v0",)),
    (6, "round6_summary.md", ("eurodrift_v0",)),
    (7, "round7_summary.md", ("fomctone_v0",)),
    (8, "round8_summary.md", ("dtsmom_v0",)),
    (9, "round9_summary.md", ("mim_v0",)),
)
ROUNDS: Mapping[str, tuple[int, str | None]] = MappingProxyType(
    {name: (number, summary) for number, summary, names in _ROUND_FILES for name in names})


STAMP, MONTH_END_SESSION = "stamp", "month_end_session"


@dataclass(frozen=True)
class SeriesSource:
    """One hypothesis series: the CSV under results/screens, its time column and the value column per cost.

    `time_rule`: "stamp" reads the time column as a time; "month_end_session" reads it as a `YYYY-MM` label and
    dates the row at the last NYSE session of that month, which must not lie after `guard_column` (dtsmom_v0:
    its `end` is the first session of the next month, so dating by `end` put every row one month late).
    `void_as_zero`: a row whose value is empty is a void event worth 0, as the screen's own unconditional book
    (eurodrift_v0, `eurodrift_stats.daily_books`); otherwise empty rows are left out.
    """

    file: str
    time_column: str
    values: Mapping[int, str]
    unit: str
    kind: str
    bench: Mapping[int, str] = field(default_factory=lambda: MappingProxyType({}))
    bench_label: str | None = None
    time_rule: str = STAMP
    guard_column: str | None = None
    void_as_zero: bool = False


USD_TRADE = "USD per trade, one NQ contract"
_COSTS = (0, 1, 2)


def _per_cost(template: str, costs: tuple[int, ...] = _COSTS) -> Mapping[int, str]:
    return MappingProxyType({cost: template.format(k=cost) for cost in costs})


def _trades(file: str, time_column: str) -> SeriesSource:
    return SeriesSource(file, time_column, _per_cost("usd_nq_{k}"), USD_TRADE, "trades")


SERIES_SOURCES: Mapping[str, SeriesSource] = MappingProxyType({
    "za_v0": SeriesSource("za_v0_repaired_trades.csv", "date", MappingProxyType({1: "pnl_usd_nq"}), USD_TRADE,
                          "trades"),
    "tom_v0": _trades("tom_v0_trades.csv", "exit"),
    "preholiday_v0": _trades("preholiday_v0_trades.csv", "exit"),
    "prefomc_v0": _trades("prefomc_v0_trades.csv", "date"),
    "overnight_v0": _trades("overnight_v0_trades.csv", "exit_date"),
    "macroday_v0": _trades("macroday_v0_trades.csv", "date"),
    "halloween_v0": _trades("halloween_v0_trades.csv", "date"),
    "mac5rev_v0": _trades("mac5rev_v0_trades.csv", "exit"),
    "rebal_v0": _trades("rebal_v0_trades.csv", "exit_ts"),
    "fomccycle_v0": SeriesSource("fomccycle_v0_daily.csv", "date", _per_cost("usd_nq_{k}"),
                                 "USD per session, one NQ contract", "daily"),
    "eurodrift_v0": SeriesSource("eurodrift_v0_nights.csv", "exit_date", _per_cost("net_bps_{k}", (1, 2)),
                                 "basis points per night", "nights", void_as_zero=True),
    "fomctone_v0": SeriesSource("fomctone_v0_trades.csv", "date", MappingProxyType({1: "usd_nq_1"}), USD_TRADE,
                                "trades"),
    "volmanaged_v0": SeriesSource("volmanaged_v0_daily.csv", "date", _per_cost("r_m_{k}"),
                                  "return on capital per session", "daily", _per_cost("r_bh_{k}"),
                                  "same-exposure buy and hold"),
    "tsmom_v0": SeriesSource("tsmom_v0_monthly.csv", "end", _per_cost("r_m_{k}"), "return on capital per month",
                             "monthly", _per_cost("r_bh_{k}"), "same-exposure buy and hold"),
    "dtsmom_v0": SeriesSource("dtsmom_v0_monthly.csv", "label", _per_cost("r_ts_{k}"), "return on capital per month",
                              "monthly", _per_cost("r_lo_{k}"), "long-only equal-risk book",
                              time_rule=MONTH_END_SESSION, guard_column="end"),
    "mim_v0": SeriesSource("mim_v0_daily.csv", "date", MappingProxyType({0: "R_gross", 1: "R_net_1tick"}),
                           "return on capital per session", "daily", MappingProxyType({0: "R_lo_gross"}),
                           "long-only book, gross"),
})


# Command line mnemonics (UI_SPEC s5; a test compares this table with the doc): (code, screen, priority, context).
MNEMONICS: tuple[tuple[str, str, str, str], ...] = (
    ("HOME", "Launchpad", "P0", "none"),
    ("GP", "Candles with volume and an indicator pane", "P0", "instrument"),
    ("GIP", "Intraday candles for one date", "P0", "instrument"),
    ("DES", "Hypothesis tear sheet or instrument description", "P0", "hypothesis or instrument"),
    ("REG", "Registry board", "P0", "none"),
    ("MT", "Multiple-testing view", "P0", "none"),
    ("RUNS", "Nautilus runs table", "P0", "none"),
    ("RUN", "Run inspector", "P0", "run"),
    ("EQ", "Analytics: equity", "P0", "run or hypothesis"),
    ("DD", "Analytics: drawdown", "P0", "run or hypothesis"),
    ("RET", "Analytics: returns and risk", "P0", "run or hypothesis"),
    ("RR", "Analytics: rolling statistics", "P0", "run or hypothesis"),
    ("MRET", "Analytics: monthly returns", "P0", "run or hypothesis"),
    ("MON", "27-futures monitor", "P0", "universe"),
    ("CORR", "Correlation matrix", "P0", "universe"),
    ("LEDG", "Ledger", "P0", "none"),
    ("OOS", "Gate access log and openings", "P0", "none"),
    ("LIVE", "Paper book", "P0", "none"),
    ("JRNL", "Journals", "P0", "none"),
    ("HELP", "Mnemonics and keys, with link groups and licences", "P0", "none"),
    ("COST", "Cost ladder", "P1", "run or hypothesis"),
    ("BLK", "Blocks", "P1", "hypothesis"),
    ("EXPO", "Exposure", "P1", "run"),
    ("SEAL", "Sealed results", "P1", "hypothesis"),
    ("VCONE", "Volatility cone", "P1", "instrument"),
    ("SEAS", "Seasonality", "P1", "instrument"),
    ("EVT", "Event study", "P1", "instrument"),
    ("ROLL", "Roll calendar", "P1", "instrument"),
    ("DQ", "Data quality", "P1", "instrument"),
    ("JOBS", "Backtest queue", "P2", "none"),
)

# Instruments the command line resolves beyond the dtsmom table: (root, sector). RTY has a processed 1m series but
# no daily file (its daily history starts 2017, so the dtsmom rule dropped it).
EXTRA_INSTRUMENTS: tuple[tuple[str, str], ...] = (("RTY", "equity"),)
