"""Stored alpha extractor (ANALYTICS_CATALOG BR1: "read from the result JSON where present").

The screens record their spanning-alpha fit in different places and shapes, so each hypothesis that has one maps
to the dotted path of the fit per cost (ticks per side), the unit of its intercept `a`, what it regresses on, the
key that holds alpha in % per year (when the screen records one) and the key of its gating t. Values are copied as
they are; the one conversion is a stored annual fraction to % (`annual_scale` 100, for `mim_v0`'s `a_x252`).

- A missing path gives None, never a guess, and the tear sheet then falls back to the terminal's own fit
  ("[POST HOC]"). A test walks every path over the real screens, so a typo fails there (born failing: the same walk
  over a screen with the fit removed finds the gap).
- mac5rev_v0 and rebal_v0 record `alpha_annual_pct` on a points intercept (252 * a * 100 points), which is not a
  percentage, so no annual value is taken from them.
- Every value here is Basis A (a screen value) and "[PRE-REG]".
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

from nq_terminal.des_shapes import resolve
from nq_terminal.models.analytics import StoredAlpha, StoredAlphaBlock

COSTS = (0, 1, 2)
MAX_DEPTH = 32  # nesting kept by clean_json; deeper values are replaced, so a crafted fit cannot recurse out
TOO_DEEP = "[nested too deep to show]"
SAME_EXPOSURE = "same-exposure buy and hold"


@dataclass(frozen=True)
class AlphaShape:
    paths: Mapping[int, str]
    a_unit: str
    against: str
    annual_key: str | None = "alpha_annual_pct"
    annual_scale: float = 1.0
    t_key: str = "t_min"
    t_map_key: str = "t"  # the mapping of t by Newey-West lag
    blocks: str | None = None  # dotted path of the per-block fits, recorded at 1 tick per side
    blocks_cost: int = 1


def _per_cost(template: str) -> Mapping[int, str]:
    return MappingProxyType({k: template.format(k=k) for k in COSTS})


def _one(path: str) -> Mapping[int, str]:
    return MappingProxyType({1: path})


SHAPES: Mapping[str, AlphaShape] = MappingProxyType({
    "volmanaged_v0": AlphaShape(_per_cost("headline.{k}tick.alpha"), "return on capital per session", SAME_EXPOSURE,
                                blocks="blocks_1tick"),
    "tsmom_v0": AlphaShape(_per_cost("headline.{k}tick.alpha"), "return on capital per month", SAME_EXPOSURE,
                           blocks="blocks_1tick"),
    "dtsmom_v0": AlphaShape(_one("control"), "return on capital per month", "long-only equal-risk book",
                            annual_key="a_x12_pct", t_key="t_a", blocks="blocks.alphas"),
    "mim_v0": AlphaShape(_one("alpha"), "return on capital per session", "long-only book (criterion P1)",
                         annual_key="a_x252", annual_scale=100.0, t_key="t_a"),
    "eurodrift_v0": AlphaShape(_one("alpha"), "basis points per valid night",
                               "the unconditional same-window net book (control C5)", annual_key=None),
    "fomccycle_v0": AlphaShape(_one("alpha"), "return per session (fraction)",
                               "net NQ buy and hold, percent returns (the EVEN book's control)"),
    "mac5rev_v0": AlphaShape(_one("pass_checks.alpha"), "points per session (NQ)", "one NQ contract, buy and hold",
                             annual_key=None),
    "rebal_v0": AlphaShape(_one("pass_checks.alpha"), "points per interval (NQ)",
                           "the screen's timing control (Newey-West lags 1 and 3)", annual_key=None),
    "vrp_eq_v0": AlphaShape(_one("headline"), "return on capital per month", "constant long book, ES and YM (P0)",
                            t_key="t_a", t_map_key="t_nw", blocks="P2_blocks"),
})


def _node(screen: Mapping[str, Any], path: str) -> Mapping[str, Any] | None:
    node: Any = screen
    for step in path.split("."):
        if not isinstance(node, Mapping) or step not in node:
            return None
        node = node[step]
    return node if isinstance(node, Mapping) else None


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _annual(fit: Mapping[str, Any], shape: AlphaShape) -> float | None:
    if shape.annual_key is None:
        return None
    value = resolve(fit, shape.annual_key)
    return None if value is None else value * shape.annual_scale


def _t_map(value: Any) -> dict[str, float | None]:
    if not isinstance(value, Mapping):
        return {}
    return {str(k): resolve(value, str(k)) for k in value}


def _blocks(screen: Mapping[str, Any], shape: AlphaShape, cost: int) -> list[StoredAlphaBlock]:
    found = _node(screen, shape.blocks) if shape.blocks and cost == shape.blocks_cost else None
    if found is None:
        return []
    return [StoredAlphaBlock(block=str(name), n=_count(fit.get("n")), a=resolve(fit, "a"),
                             alpha_annual_pct=_annual(fit, shape), t_min=resolve(fit, shape.t_key))
            for name, fit in sorted(found.items()) if isinstance(fit, Mapping)]


def clean_json(value: Any, _depth: int = 0) -> Any:
    """A copy with non-finite numbers as None (JSON has no NaN); mappings get string keys; anything nested
    `MAX_DEPTH` levels down becomes `TOO_DEEP` (a result file is trusted, but a RecursionError would be a 500)."""
    if _depth >= MAX_DEPTH:
        return TOO_DEEP
    if isinstance(value, Mapping):
        return {str(k): clean_json(v, _depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v, _depth + 1) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def stored_fit(name: str, cost: int, screen: Mapping[str, Any] | None) -> StoredAlpha | None:
    """The stored fit of `name` at `cost` ticks per side, or None when the screen records none there."""
    shape = SHAPES.get(name)
    path = shape.paths.get(cost) if shape is not None else None
    fit = _node(screen, path) if path is not None and isinstance(screen, Mapping) else None
    if fit is None:
        return None
    p = resolve(fit, "p") if resolve(fit, "p") is not None else resolve(fit, "p_one_sided")
    return StoredAlpha(path=path, against=shape.against, a_unit=shape.a_unit, n=_count(fit.get("n")),
                       a=resolve(fit, "a"), b=resolve(fit, "b"), alpha_annual_pct=_annual(fit, shape),
                       t=_t_map(fit.get(shape.t_map_key)), t_min=resolve(fit, shape.t_key), p=p,
                       blocks=_blocks(screen, shape, cost), raw=clean_json(fit))
