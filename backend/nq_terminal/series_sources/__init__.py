"""Series sources: where the Basis A series of each registered hypothesis lives (ANALYTICS_CATALOG C1), and which
registered rows cannot have one.

`SERIES_SOURCES` maps a hypothesis name to its `constants.SeriesSource`: the 22 rows of 0.3.3 (`BASE_SOURCES`, below)
first, then the `SOURCES` dict of each module in `PARTS` in turn (`monthly_a`, `monthly_b`, `daily_event`), each imported by name
(a computed import would hide the module from the safety scan). `constants.SERIES_SOURCES` is this same mapping, so every caller that read it there
reads it here. Only the columns named are read; none is a price column (tested).

`NOT_LEARNABLE` maps a registered row the terminal will not learn to the reason, which REG and SV3 show beside the
Deflated Sharpe: the five rows below, and any a module lists in its own optional `NOT_LEARNABLE`. A name may not be
both learned and not learnable, nor learned twice, and a reason may not be empty: the package refuses to load
otherwise (`SeriesRegistryError`), so the server never starts with an ambiguous N.
"""
from __future__ import annotations

from types import MappingProxyType, ModuleType
from typing import Mapping, Sequence

from nq_terminal.constants import (
    MONTH_END_SESSION,
    USD_TRADE,
    PortfolioRule,
    SeriesSource,
    _per_cost,
    _trades,
)

from nq_terminal.series_sources import daily_event, monthly_a, monthly_b  # they import constants only

PART_MODULES: tuple[tuple[str, ModuleType], ...] = (("monthly_a", monthly_a), ("monthly_b", monthly_b),
                                                    ("daily_event", daily_event))
PARTS = tuple(name for name, _ in PART_MODULES)
NO_SOURCE_REASON = "no series source yet"
C2_REASON = ("outside convention C2 (P = 252 or 12, docs/ANALYTICS_CATALOG.md:16); needs a statistics decision "
             "(O23)")

BASE_SOURCES: Mapping[str, SeriesSource] = MappingProxyType({
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
    "carry_v0": SeriesSource("carry_v0_monthly.csv", "label", _per_cost("r_carry_{k}"), "return on capital per month",
                             "monthly", _per_cost("r_loac_{k}"), "equal-risk long-only book in the same classes",
                             time_rule=MONTH_END_SESSION, guard_column="end"),
    "eomtsy_v0": SeriesSource("eomtsy_v0_monthly.csv", "month", _per_cost("r{k}"), "return on capital per month",
                              "monthly", _per_cost("lo{k}"), "held-contract all-month long-only book",
                              time_rule=MONTH_END_SESSION, guard_column="L"),
    "cskew_v0": SeriesSource("cskew_v0_monthly.csv", "label", _per_cost("r_cskew_{k}"), "return on capital per month",
                             "monthly", _per_cost("r_lo_{k}"), "equal-risk long-only commodity book",
                             time_rule=MONTH_END_SESSION, guard_column="end"),
    "mim_v0": SeriesSource("mim_v0_daily.csv", "date", MappingProxyType({0: "R_gross", 1: "R_net_1tick"}),
                           "return on capital per session", "daily", MappingProxyType({0: "R_lo_gross"}),
                           "long-only book, gross"),
    # Round 13: the daily CSV holds each market's VT and CE books at 1 era tick only; the series is the screen's P2
    # portfolio over the 26 test markets (NQ is the anchor and is left out, as the screen's `anchor` flag says).
    "vt_har_v0": SeriesSource("vt_har_v0_daily.csv", "date", MappingProxyType({1: "_VT"}),
                              "portfolio return per session, in units of its own winsorised sd", "daily",
                              MappingProxyType({1: "_CE"}),
                              "constant-notional books at equal winsorised volatility, same portfolio rule",
                              portfolio=PortfolioRule(exclude=("NQ",))),
    # Round 14: `label` is the holding month (the signal forms in the month before); void months are left out.
    "vrp_eq_v0": SeriesSource("vrp_eq_v0_monthly.csv", "label", _per_cost("r_VRP_t{k}"), "return on capital per month",
                              "monthly", _per_cost("r_C_t{k}"), "constant long book, ES and YM",
                              time_rule=MONTH_END_SESSION, void_column="void"),
    # Round 15: monthly book on the last weekday of the month (a holding hour at the WM/R fix, recorded as one
    # return on K per month). `void` holds the reason text of a void month (empty otherwise) and its returns are
    # empty, so empty values drop those months; `D` is the weekday the book traded on, never before the NYSE
    # session it is dated at.
    "fxeomhedge_v0": SeriesSource("fxeomhedge_v0_monthly.csv", "month", _per_cost("r{k}"),
                                  "return on capital per month", "monthly", _per_cost("lo{k}"),
                                  "gross long-only FX basket, same hour", time_rule=MONTH_END_SESSION,
                                  guard_column="D"),
})

# Weekly books (P = 52) and one quarterly book (P = 4): convention C2 knows P = 252 and 12 only, so these rows wait for
# a statistics decision (O23) instead of a series moved to sessions here.
BASE_NOT_LEARNABLE: Mapping[str, str] = MappingProxyType({
    "cotliq_v0": C2_REASON,
    "mpslope_ym_v0": C2_REASON,
    "wkndgap_fx_v0": C2_REASON,
    "wkndshort_v0": C2_REASON,
    "finroll_tff_v0": C2_REASON,
})

Part = tuple[str, Mapping[str, SeriesSource], Mapping[str, str]]


class SeriesRegistryError(ValueError):
    """The registry is ambiguous: a name learned twice, learned and not learnable, or not learnable with no reason."""


def part_tables(name: str, module: ModuleType) -> Part:
    """A module's `SOURCES` and its optional `NOT_LEARNABLE`, under its name."""
    return name, dict(getattr(module, "SOURCES", {})), dict(getattr(module, "NOT_LEARNABLE", {}))


def merge_registry(base: Mapping[str, SeriesSource], parts: Sequence[Part],
                   not_learnable: Mapping[str, str]) -> tuple[Mapping[str, SeriesSource], Mapping[str, str]]:
    """(learned, not learnable), read-only, in order: `base`, then each part's sources in turn. Refuses a name learned
    twice, a name both learned and not learnable, an entry that is not a SeriesSource and an empty reason."""
    owner = dict.fromkeys(base, "the base table")
    learned, barred = dict(base), dict(not_learnable)
    for part, sources, extra in parts:
        for name, source in sources.items():
            if name in owner:
                raise SeriesRegistryError(f"{name} is learned twice: by {owner[name]} and by {part}")
            if not isinstance(source, SeriesSource):
                raise SeriesRegistryError(f"{name} in {part} is a {type(source).__name__}, not a SeriesSource")
            owner[name], learned[name] = part, source
        barred.update(extra)
    _check_not_learnable(owner, barred)
    return MappingProxyType(learned), MappingProxyType(barred)


def _check_not_learnable(owner: Mapping[str, str], barred: Mapping[str, str]) -> None:
    both = [name for name in barred if name in owner]
    if both:
        raise SeriesRegistryError(f"{', '.join(both)}: both learned and not learnable (learned by "
                                  f"{', '.join(owner[name] for name in both)})")
    empty = [name for name, reason in barred.items() if not isinstance(reason, str) or not reason.strip()]
    if empty:
        raise SeriesRegistryError(f"{', '.join(empty)}: not learnable with no reason")


def _build() -> tuple[Mapping[str, SeriesSource], Mapping[str, str]]:
    parts = [part_tables(name, module) for name, module in PART_MODULES]
    return merge_registry(BASE_SOURCES, parts, BASE_NOT_LEARNABLE)


SERIES_SOURCES, NOT_LEARNABLE = _build()


def unlearned_reason(name: str) -> str:
    """Why a registered row has no series: its NOT_LEARNABLE reason, or that no release has learned it yet."""
    return NOT_LEARNABLE.get(name, NO_SOURCE_REASON)
