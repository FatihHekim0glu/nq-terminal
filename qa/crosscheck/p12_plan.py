"""Reference for the terminal's pre-registration planner (research_ux.md item 2, the SV9 server mirror): the plan the
backend serves at `GET /api/analytics/plan` (`nq_terminal/analytics/power.py`), rebuilt from `scipy.stats.norm` over a
grid of designs.

The set-up is SV9's: a one-sided test of "annual Sharpe > 0" on normal, serially independent returns, best case. A book
of `n` observations at `periods` a year spans `n / periods` years and

    mde(n, periods, alpha, power)   = (z(1 - alpha) + z(power)) / sqrt(n / periods)
    power_at(S, n, periods, alpha)  = Phi(S sqrt(n / periods) - z(1 - alpha))
    years_needed(S, alpha, power)   = ((z(1 - alpha) + z(power)) / S) ^ 2
    mean_per_event(sd, n, alpha, power) = (z(1 - alpha) + z(power)) sd / sqrt(n)

with z the standard normal quantile (`norm.isf(alpha)` here, the upper tail directly) and Phi its CDF. A family of k
tests already registered puts the next test at slot k + 1: its Bonferroni bar is alpha / (k + 1) and its Holm bar lies
between alpha / (k + 1) and alpha. The annualisation is the book's own periods (252, 52, 12 or 4), never 365; the test
is one-sided, never two-sided; the bar is for the next slot, never for the family as it stands (the born-failing variants
in `tests/test_p12_plan.py`).

The backend test (`backend/tests/test_plan_route.py`) loads this file by path and requires the served plan to equal
`reference_plan` at 1e-12 relative over `grid_inputs()`, integers and labels exactly.
"""
from __future__ import annotations

import itertools
import math
from typing import Any

from scipy.stats import norm

SOURCE = "qa/crosscheck/p12_plan.py"
PERIODS = (252, 52, 12, 4)
POWER_TARGET = 0.8
REFERENCE_SHARPE = 0.5
NOTE = ("Best case: normal and independent returns, a one-sided test of annual Sharpe above zero. Serial correlation, "
        "fat tails and skew make the true minimum detectable Sharpe larger.")

GRID_NS = (2, 12, 120, 787, 2520, 25200)
ALPHAS = (0.01, 0.05, 0.1)
FAMILY_SIZES = (0, 21, 59, 80)
TYPED_SHARPES = (0.25, 1.0, 2.0)
EVENT_SDS = (1.0, 14.8)
ROUND_DIGITS = 9
FLOAT_REL_TOL = 1e-12
FLOAT_ABS_TOL = 1e-300


def z_one_sided(alpha: float) -> float:
    return float(norm.isf(alpha))


def mde(n: int, periods: int, alpha: float, power: float) -> float:
    return float((z_one_sided(alpha) + norm.ppf(power)) / math.sqrt(n / periods))


def power_at(sharpe: float, n: int, periods: int, alpha: float) -> float:
    return float(norm.cdf(sharpe * math.sqrt(n / periods) - z_one_sided(alpha)))


def observations(sharpe: float, periods: int, alpha: float, power: float) -> int:
    years = ((z_one_sided(alpha) + float(norm.ppf(power))) / sharpe) ** 2
    return math.ceil(round(years * periods, ROUND_DIGITS))


def mean_per_event(sd: float, n: int, alpha: float, power: float) -> float:
    return float((z_one_sided(alpha) + norm.ppf(power)) * sd / math.sqrt(n))


def _bar(alpha: float) -> dict[str, float]:
    return {"alpha": alpha, "z": z_one_sided(alpha)}


def _point(alpha: float, n: int, periods: int, sharpe: float | None, event_sd: float | None) -> dict[str, Any]:
    return {
        "alpha": alpha, "z": z_one_sided(alpha), "mde_sharpe": mde(n, periods, alpha, POWER_TARGET),
        "power_at_reference": power_at(REFERENCE_SHARPE, n, periods, alpha),
        "power_at_typed": None if sharpe is None else power_at(sharpe, n, periods, alpha),
        "observations_for_reference": observations(REFERENCE_SHARPE, periods, alpha, POWER_TARGET),
        "observations_for_typed": None if sharpe is None else observations(sharpe, periods, alpha, POWER_TARGET),
        "mean_per_event": None if event_sd is None else mean_per_event(event_sd, n, alpha, POWER_TARGET),
    }


def reference_plan(*, periods: int, n: int, alpha: float, k_registry: int | None, k_typed: int | None,
                   sharpe: float | None, event_sd: float | None) -> dict[str, Any]:
    """The plan the backend must serve for these inputs, built from scipy; ValueError for a `periods` outside the four."""
    if periods not in PERIODS:
        raise ValueError(f"periods must be one of {PERIODS}, not {periods}")
    sizes = [("registry", k_registry)]
    if k_typed is not None and k_typed != k_registry:
        sizes.append(("typed", k_typed))
    slots = []
    for source, k in sizes:
        if k is None:
            continue
        slot = k + 1
        slots.append({"source": source, "k": k, "slot": slot, "bonferroni": _bar(alpha / slot),
                      "holm_strictest": _bar(alpha / slot), "holm_loosest": _bar(alpha),
                      "at_slot": _point(alpha / slot, n, periods, sharpe, event_sd)})
    return {"basis": "A", "note": NOTE, "power_target": POWER_TARGET, "reference_sharpe": REFERENCE_SHARPE,
            "periods": periods, "n": n, "years": n / periods, "alpha": alpha, "typed_sharpe": sharpe,
            "event_sd": event_sd, "nominal": _point(alpha, n, periods, sharpe, event_sd), "slots": slots}


def grid_inputs() -> list[dict[str, Any]]:
    """Every design of the grid: the four periods, six book sizes, three alphas, the registry's 59 beside four typed
    family sizes (the same size once), with and without a typed Sharpe and an event standard deviation."""
    out = []
    for periods, n, alpha, k_typed in itertools.product(PERIODS, GRID_NS, ALPHAS, FAMILY_SIZES):
        for sharpe, event_sd in itertools.product((None, *TYPED_SHARPES), (None, *EVENT_SDS)):
            out.append({"periods": periods, "n": n, "alpha": alpha, "k_registry": 59, "k_typed": k_typed,
                        "sharpe": sharpe, "event_sd": event_sd})
    return out


def build_grid() -> list[dict[str, Any]]:
    """The grid as {inputs, plan} pairs."""
    return [{"inputs": inputs, "plan": reference_plan(**inputs)} for inputs in grid_inputs()]


def _walk(value: Any, numbers: list[float], labels: list[str]) -> None:
    if isinstance(value, dict):
        for key in sorted(value):
            _walk(value[key], numbers, labels)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _walk(item, numbers, labels)
    elif value is None:
        numbers.append(math.nan)
    elif isinstance(value, (bool, str)):
        labels.append(str(value))
    else:
        numbers.append(float(value))


def flatten_plans(plans: list[dict[str, Any]]) -> dict[str, list]:
    """Every number of the plans in key order (None as NaN) and every word or flag in key order, plan after plan."""
    numbers: list[float] = []
    labels: list[str] = []
    for plan in plans:
        _walk(plan, numbers, labels)
    return {"plan.numbers": numbers, "plan.labels": labels}


def first_difference(built: object, stored: object, path: str = "") -> str | None:
    """Path of the first key or index where the two values differ: floats agree to `FLOAT_REL_TOL`, everything else
    (type included, so an int is not a float) exactly."""
    if isinstance(built, dict) and isinstance(stored, dict):
        for key in sorted(set(built) | set(stored)):
            where = f"{path}.{key}" if path else str(key)
            if key not in built or key not in stored:
                return where
            found = first_difference(built[key], stored[key], where)
            if found is not None:
                return found
        return None
    if isinstance(built, list) and isinstance(stored, list):
        for index in range(max(len(built), len(stored))):
            where = f"{path}[{index}]"
            if index >= len(built) or index >= len(stored):
                return where
            found = first_difference(built[index], stored[index], where)
            if found is not None:
                return found
        return None
    if type(built) is float and type(stored) is float:
        same = math.isclose(built, stored, rel_tol=FLOAT_REL_TOL, abs_tol=FLOAT_ABS_TOL)
    else:
        same = type(built) is type(stored) and built == stored
    return None if same else (path or "<root>")
