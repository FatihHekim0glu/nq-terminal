"""Frozen per-screen extract table for the DES tear sheet (ARCHITECTURE s3.2; UI_SPEC s6 and s7; ANALYTICS RL5, EX4).

The screen JSONs differ per hypothesis, so each registered name maps to the dotted paths of its headline value, its
t statistic, its block ladder and its cost ladder. Every value is read from the file at that path; nothing is
recomputed (RL5: "never recomputed"; EX4: anchor to `cost_ladder`). `break_even_ticks_per_side` is shown only
where the screen records it. A test walks every path over the real screens, so a typo fails there.

Names:
- The sizing screens' `dsr` is the Sharpe difference (managed minus buy and hold), not the Deflated Sharpe Ratio
  (ANALYTICS_CATALOG C4). No headline here points at it, and the fallback for a screen without a shape skips it.
- `za_v0_C3_gao_momentum` is a check inside `za_v0` with no pass bar of its own: it reads its own block
  (`C3_gao_momentum`) and shows no pass checks.
- Basis A (ANALYTICS_CATALOG C1): every value here is a screen value, never an account value.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping

from nq_terminal.constants import SCREEN_ALIASES

BASIS = "A"
DSR_KEY = "dsr"
FALLBACK_ROOTS = ("headline", "v0")
FALLBACK_KEYS = ("mean_r", "mean", "diff_pct", "sharpe", "sharpe_m", "sharpe_a")

_PTS = "points per trade (NQ), net at 1 tick per side"
_SIZING_BLOCK = "alpha, % per year, 1 tick per side"
_MONTHLY = "% per month, return on capital"


@dataclass(frozen=True)
class Shape:
    """Dotted paths into one screen JSON. Blocks: `blocks` names a mapping of label to value (or to a mapping
    holding `block_key`). Ladder: ticks per side to a path."""

    headline: str
    display: str
    unit: str
    t: str
    t_label: str
    blocks: str | None = None
    block_key: str | None = None
    blocks_unit: str | None = None
    ladder: Mapping[int, str] = field(default_factory=lambda: MappingProxyType({}))
    ladder_unit: str | None = None
    break_even: str | None = None
    block: str | None = None  # a sub-block of a shared screen (C3); pass checks are then not the row's own

    def paths(self) -> tuple[str, ...]:
        return (self.headline, self.t, *self.ladder.values(), *((self.break_even,) if self.break_even else ()))


def _ladder(template: str, ticks: tuple[int, ...] = (0, 1, 2)) -> Mapping[int, str]:
    return MappingProxyType({k: template.format(k=k) for k in ticks})


def _points(t_label: str = "t (1 tick per side)") -> Shape:
    return Shape("headline.nq_1tick.mean", "Net mean per trade, 1 tick", _PTS, "headline.nq_1tick.t", t_label,
                 blocks="headline.blocks", block_key="mean", blocks_unit=_PTS,
                 ladder=_ladder("headline.cost_ladder.nq_{k}.mean"), ladder_unit=_PTS)


def _monthly_book(ladder: str) -> Shape:
    """Rounds 10 to 12 (carry_v0, eomtsy_v0, cskew_v0): a monthly book on $100M, headline the net mean monthly
    return in % with its Newey-West t (the registry's p is that t's one-sided p), blocks by period."""
    return Shape("headline.mean_pct", "Net mean monthly return, 1 tick", _MONTHLY, "headline.t_nw", "Newey-West t",
                 blocks="blocks", block_key="mean_pct", blocks_unit=f"{_MONTHLY}, 1 tick", ladder=_ladder(ladder),
                 ladder_unit=_MONTHLY)


SHAPES: Mapping[str, Shape] = MappingProxyType({
    "za_v0": Shape("v0.mean_r", "Net mean R per trade, 1 tick", "R per trade", "v0.t", "t (1 tick per side)",
                   blocks="blocks", block_key="mean_r", blocks_unit="R per trade, 1 tick",
                   ladder=_ladder("C4_cost_stress.{k}.mean_r"), ladder_unit="R per trade"),
    "za_v0_C3_gao_momentum": Shape("C3_gao_momentum.mean_pts", "Gao momentum check, mean per trade",
                                   "points per trade (NQ)", "C3_gao_momentum.t", "t", block="C3_gao_momentum"),
    "tom_v0": _points(), "preholiday_v0": _points(), "prefomc_v0": _points(), "overnight_v0": _points(),
    "macroday_v0": _points(), "mac5rev_v0": _points(), "rebal_v0": _points(),
    "halloween_v0": Shape("headline.mean", "Net mean per winter session, 1 tick", "points per session (NQ)",
                          "headline.t_min", "t (smallest of plain and Newey-West)", blocks="winter_book.blocks",
                          block_key="mean", blocks_unit="points per winter session (NQ), 1 tick",
                          ladder=MappingProxyType({1: "headline.mean", 2: "winter_book.per_day_2tick.mean"}),
                          ladder_unit="points per winter session (NQ)"),
    "fomccycle_v0": Shape("headline.mean", "Net mean per even-week session, 1 tick", "points per session (NQ)",
                          "headline.t_min", "t (smallest of plain and Newey-West)", blocks="even_block_means",
                          blocks_unit="points per session (NQ), 1 tick",
                          ladder=MappingProxyType({1: "headline.mean", 2: "two_tick_mean"}),
                          ladder_unit="points per session (NQ)"),
    "volmanaged_v0": Shape("headline.1tick.sharpe_m", "Managed Sharpe, 1 tick", "Sharpe ratio, annualised (daily)",
                           "headline.1tick.alpha.t_min", "alpha t (gating: smaller of Newey-West lags 5 and 21)",
                           blocks="blocks_1tick", block_key="alpha_annual_pct", blocks_unit=_SIZING_BLOCK,
                           ladder=_ladder("cost_ladder.ladder.{k}tick.alpha_annual_pct"),
                           ladder_unit="alpha, % per year", break_even="cost_ladder.break_even_ticks_per_side"),
    "tsmom_v0": Shape("headline.1tick.sharpe_a", "Strategy Sharpe, 1 tick", "Sharpe ratio, annualised (monthly)",
                      "headline.1tick.alpha.t_min", "alpha t (gating, Newey-West lag 4)", blocks="blocks_1tick",
                      block_key="alpha_annual_pct", blocks_unit=_SIZING_BLOCK,
                      ladder=_ladder("headline.{k}tick.alpha.alpha_annual_pct"), ladder_unit="alpha, % per year"),
    "eurodrift_v0": Shape("headline.mean", "Net mean per held night, 1 tick", "basis points per night",
                          "headline.t_head", "headline t", blocks="blocks", block_key="mean",
                          blocks_unit="basis points per night, 1 tick",
                          ladder=MappingProxyType({1: "headline.mean", 2: "two_tick.mean"}),
                          ladder_unit="basis points per night"),
    "fomctone_v0": Shape("headline.mean", "Net mean per traded statement", "% per traded statement",
                         "headline.t", "t", blocks="blocks.blocks", block_key="mean",
                         blocks_unit="% per traded statement"),
    "dtsmom_v0": Shape("headline.sharpe", "Net Sharpe, 1 tick", "Sharpe ratio, annualised (monthly)",
                       "headline.t_nw", "Newey-West t", blocks="blocks.tsmom", block_key="sharpe",
                       blocks_unit="Sharpe ratio, 1 tick", ladder=_ladder("cost_stress.tsmom.sharpe.{k}"),
                       ladder_unit="Sharpe ratio"),
    "carry_v0": _monthly_book("cost_stress.mean_pct_by_ticks.{k}"),
    "eomtsy_v0": _monthly_book("cost_ladder_mean_pct.{k}_tick"),
    "cskew_v0": _monthly_book("cost_stress.mean_pct_by_ticks.{k}"),
    "mim_v0": Shape("headline.mean", "Net mean per session, 1 tick plus fees", "return on capital per session",
                    "headline.t_nw", "Newey-West t", blocks="blocks", block_key="mean",
                    blocks_unit="return on capital per session, 1 tick",
                    ladder=MappingProxyType({0: "zero_tick.mean", 1: "headline.mean", 2: "two_tick.mean"}),
                    ladder_unit="return on capital per session"),
})


def screen_stem(name: str) -> str:
    return SCREEN_ALIASES.get(name, name)


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def resolve(screen: Mapping[str, Any], path: str) -> float | None:
    """The finite number at a dotted path, or None when a step is missing or the value is not a number."""
    node: Any = screen
    for step in path.split("."):
        if not isinstance(node, Mapping) or step not in node:
            return None
        node = node[step]
    return _finite(node)


def _first(block: Mapping[str, Any], path: str, depth: int) -> tuple[str, float] | None:
    for key in FALLBACK_KEYS:
        value = _finite(block.get(key))
        if value is not None:
            return f"{path}.{key}", value
    if depth >= 1:
        return None
    children = sorted((k for k, v in block.items() if isinstance(v, Mapping)), key=lambda k: "1tick" not in str(k))
    for key in children:
        found = _first(block[key], f"{path}.{key}", depth + 1)
        if found is not None:
            return found
    return None


def fallback_headline(screen: Mapping[str, Any]) -> tuple[str | None, float | None]:
    """For a screen with no shape yet: the first plain headline number, never the `dsr` Sharpe difference."""
    for root in FALLBACK_ROOTS:
        block = screen.get(root)
        if isinstance(block, Mapping):
            found = _first(block, root, depth=0)
            if found is not None:
                return found
    return None, None


def blocks(screen: Mapping[str, Any], shape: Shape) -> list[tuple[str, float | None]]:
    """The block ladder at `shape.blocks`; none for a shape without one (never the screen's own top-level keys)."""
    if not shape.blocks:
        return []
    node: Any = screen
    for step in shape.blocks.split("."):
        node = node.get(step) if isinstance(node, Mapping) else None
    if not isinstance(node, Mapping):
        return []
    out = []
    for label, item in node.items():
        value = item.get(shape.block_key) if shape.block_key and isinstance(item, Mapping) else item
        out.append((str(label), _finite(value)))
    return out


def ladder(screen: Mapping[str, Any], shape: Shape) -> list[tuple[int, float | None]]:
    return [(ticks, resolve(screen, path)) for ticks, path in sorted(shape.ladder.items())]
