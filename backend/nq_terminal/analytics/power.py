"""SV9 power of the registered tests and the pre-registration planner (ANALYTICS_CATALOG SV9; research_ux.md item 2).

Pure functions, standard library only, no file, no gate and no price: this is the server mirror of the browser
reference `web/src/quant/normal.ts` and `power.ts`, pinned to `scipy.stats.norm` by the golden vectors of
`qa/golden/p12_power.json` at 1e-12 relative (`tests/test_power.py`), and by `qa/crosscheck/p12_plan.py` over a grid.

The set-up is the catalogue's: a one-sided test of "annual Sharpe > 0" on normal, serially independent returns. A book
of n observations at `periods` per year spans n / periods years, and the z-statistic of its annual Sharpe ratio is
`sharpe x sqrt(years)`. With z the standard normal quantile and Phi its distribution function:

    minimum detectable Sharpe = (z(1 - alpha) + z(power)) / sqrt(years)
    power at a Sharpe         = Phi(sharpe x sqrt(years) - z(1 - alpha))
    years needed for a Sharpe = ((z(1 - alpha) + z(power)) / sharpe) ^ 2
    detectable mean per event = (z(1 - alpha) + z(power)) x sd / sqrt(n)

The annualisation is the book's own `periods` (252, 52, 12 or 4), never 365, and the test is one-sided: a two-sided
test would use z(1 - alpha / 2) and give a larger number. Best case: serial correlation, fat tails and skew make the
true detectable Sharpe ratio larger. Descriptive only; no verdict, never overrides a frozen pass bar.

The planner reads nothing. A family of k tests already registered puts the next test at slot k + 1, so its Bonferroni
bar is alpha / (k + 1) and its Holm bar lies between alpha / (k + 1) (the smallest p value of the family) and alpha (the
largest, when every other hypothesis was rejected first).
"""
from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from statistics import NormalDist
from typing import Any

PERIODS = (252, 52, 12, 4)
POWER_TARGET = 0.8
REFERENCE_SHARPE = 0.5
MIN_OBSERVATIONS = 2
POST_HOC = "[POST HOC]"
NOTE = ("Best case: normal and independent returns, a one-sided test of annual Sharpe above zero. Serial correlation, "
        "fat tails and skew make the true minimum detectable Sharpe larger.")
_STANDARD = NormalDist()
_SQRT_TWO = math.sqrt(2.0)
_ROUND_DIGITS = 9  # a count of observations that is an integer up to float noise stays that integer


# ---------------------------------------------------------------- the standard normal distribution


def normal_cdf(x: float) -> float:
    """Phi(x). NaN for NaN; 0 at minus infinity and 1 at plus infinity. Full relative accuracy in the lower tail."""
    if math.isnan(x):
        return math.nan
    return 0.5 * math.erfc(-x / _SQRT_TWO)


def normal_quantile(p: float) -> float:
    """The z with Phi(z) = p (Wichura's AS 241, relative accuracy about 1e-16). Minus infinity at 0, plus infinity at
    1; NaN for NaN and for p outside [0, 1]."""
    if math.isnan(p) or p < 0.0 or p > 1.0:
        return math.nan
    if p == 0.0:
        return -math.inf
    if p == 1.0:
        return math.inf
    return _STANDARD.inv_cdf(p)


def critical_value(alpha: float) -> float:
    """z(1 - alpha) of the one-sided test, written -z(alpha) so a tiny alpha keeps its digits."""
    return -normal_quantile(alpha)


# ---------------------------------------------------------------- the maths of SV9


def _is_probability(value: float) -> bool:
    return 0.0 < value < 1.0


def _is_usable_book(n: float, periods: float) -> bool:
    return math.isfinite(n) and n > 1 and math.isfinite(periods) and periods > 0


def track_years(n: float, periods: float) -> float:
    """The years n observations at `periods` a year span. NaN for a negative or non-finite n or a `periods` that is not
    positive and finite."""
    if math.isfinite(n) and n >= 0 and math.isfinite(periods) and periods > 0:
        return n / periods
    return math.nan


def minimum_detectable_sharpe(n: float, periods: float, alpha: float, power: float) -> float:
    """The smallest annual Sharpe a one-sided test at `alpha` detects with probability `power`. NaN when n <= 1,
    periods <= 0, alpha or power is outside (0, 1), or any input is not finite."""
    if not _is_usable_book(n, periods) or not _is_probability(alpha) or not _is_probability(power):
        return math.nan
    return (critical_value(alpha) + normal_quantile(power)) / math.sqrt(track_years(n, periods))


def power_at_sharpe(sharpe: float, n: float, periods: float, alpha: float) -> float:
    """The probability that a one-sided test at `alpha` rejects "annual Sharpe <= 0" when the true annual Sharpe is
    `sharpe`. NaN when sharpe is not finite, n <= 1, periods <= 0, alpha is outside (0, 1), or any input is not
    finite."""
    if not math.isfinite(sharpe) or not _is_usable_book(n, periods) or not _is_probability(alpha):
        return math.nan
    return normal_cdf(sharpe * math.sqrt(track_years(n, periods)) - critical_value(alpha))


def years_needed(sharpe: float, alpha: float, power: float) -> float:
    """The years a one-sided test at `alpha` needs to detect annual `sharpe` with probability `power`. NaN for a Sharpe
    that is not finite and positive, and for alpha or power outside (0, 1)."""
    if not math.isfinite(sharpe) or sharpe <= 0 or not _is_probability(alpha) or not _is_probability(power):
        return math.nan
    return ((critical_value(alpha) + normal_quantile(power)) / sharpe) ** 2


def observations_needed(sharpe: float, periods: float, alpha: float, power: float) -> int | None:
    """The whole number of observations at `periods` a year that `years_needed` asks for; None when it is undefined."""
    years = years_needed(sharpe, alpha, power)
    if math.isnan(years) or not math.isfinite(periods) or periods <= 0:
        return None
    return math.ceil(round(years * periods, _ROUND_DIGITS))


def detectable_mean(sd: float, n: float, alpha: float, power: float) -> float:
    """The smallest mean per event a one-sided test at `alpha` detects with probability `power` over n events whose
    standard deviation is `sd` (in the units of `sd`). NaN when sd is not positive and finite, n <= 1, or alpha or
    power is outside (0, 1)."""
    if not math.isfinite(sd) or sd <= 0 or not math.isfinite(n) or n <= 1:
        return math.nan
    if not _is_probability(alpha) or not _is_probability(power):
        return math.nan
    return (critical_value(alpha) + normal_quantile(power)) * sd / math.sqrt(n)


def _figure(value: float | None) -> float | None:
    """A finite number, or None for NaN, an infinity or a missing value."""
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None


# ---------------------------------------------------------------- the served table of SV9


def _family_alpha(alpha: float, k: int) -> float | None:
    return _figure(alpha / k) if k > 0 else None


def _row_at(row: Mapping[str, Any], alpha: float | None) -> tuple[float | None, float | None]:
    if alpha is None:
        return None, None
    n, periods = row["n"], row["periods"]
    mde = _figure(minimum_detectable_sharpe(n, periods, alpha, POWER_TARGET))
    return mde, _figure(power_at_sharpe(REFERENCE_SHARPE, n, periods, alpha))


def _table_row(row: Mapping[str, Any], alpha: float, alpha_family: float | None) -> dict[str, Any]:
    sharpe = _figure(row.get("annual_sharpe"))
    mde_nominal, power_nominal = _row_at(row, _figure(alpha))
    mde_family, power_family = _row_at(row, alpha_family)
    ratio = sharpe / mde_family if sharpe is not None and mde_family is not None and mde_family > 0 else None
    return {
        "name": row["name"], "kind": row["kind"], "periods": row["periods"], "n": row["n"],
        "years": _figure(track_years(row["n"], row["periods"])), "sharpe": sharpe,
        "mde_nominal": mde_nominal, "mde_family": mde_family, "ratio": _figure(ratio),
        "power_nominal": power_nominal, "power_family": power_family,
    }


def power_table(rows: Iterable[Mapping[str, Any]], alpha: float, k: int) -> dict[str, Any]:
    """The SV9 table over the registered trials (`name`, `kind`, `periods`, `n`, `annual_sharpe` each), in the given
    order, for the family alpha and the registry's k: the MDE and the power at the reference Sharpe 0.5, at alpha and
    at alpha / k. A figure that does not exist is None."""
    alpha_family = _family_alpha(alpha, k)
    return {
        "tag": POST_HOC, "basis": "A", "alpha": alpha, "k": k, "alpha_family": alpha_family,
        "power_target": POWER_TARGET, "reference_sharpe": REFERENCE_SHARPE, "note": NOTE,
        "rows": [_table_row(row, alpha, alpha_family) for row in rows],
    }


# ---------------------------------------------------------------- the planner


def _check_plan(periods: int, n: int, alpha: float, k_registry: int | None, k_typed: int | None,
                sharpe: float | None, event_sd: float | None) -> None:
    if periods not in PERIODS:
        raise ValueError(f"periods must be one of {', '.join(str(p) for p in PERIODS)}, not {periods}")
    if n < MIN_OBSERVATIONS:
        raise ValueError(f"n must be at least {MIN_OBSERVATIONS}")
    if not _is_probability(alpha):
        raise ValueError("alpha must lie between 0 and 1")
    sizes = [k for k in (k_registry, k_typed) if k is not None]
    if not sizes:
        raise ValueError("a family size is needed: the registry has none and none was typed")
    if any(k < 0 for k in sizes):
        raise ValueError("the family size cannot be negative")
    if sharpe is not None and not math.isfinite(sharpe):
        raise ValueError("the typed Sharpe must be a finite number")
    if event_sd is not None and not (math.isfinite(event_sd) and event_sd > 0):
        raise ValueError("the event standard deviation must be positive and finite")


def _point(alpha: float, n: int, periods: int, sharpe: float | None, event_sd: float | None) -> dict[str, Any]:
    """The figures of the design at one alpha: the bar, the MDE, the power at the reference and typed Sharpe, the
    observations needed for each, and the detectable mean per event."""
    typed = sharpe is not None
    return {
        "alpha": alpha, "z": critical_value(alpha),
        "mde_sharpe": minimum_detectable_sharpe(n, periods, alpha, POWER_TARGET),
        "power_at_reference": power_at_sharpe(REFERENCE_SHARPE, n, periods, alpha),
        "power_at_typed": _figure(power_at_sharpe(sharpe, n, periods, alpha)) if typed else None,
        "observations_for_reference": observations_needed(REFERENCE_SHARPE, periods, alpha, POWER_TARGET),
        "observations_for_typed": observations_needed(sharpe, periods, alpha, POWER_TARGET) if typed else None,
        "mean_per_event": _figure(detectable_mean(event_sd, n, alpha, POWER_TARGET)) if event_sd is not None else None,
    }


def _bar(alpha: float) -> dict[str, float]:
    return {"alpha": alpha, "z": critical_value(alpha)}


def _slot(source: str, k: int, alpha: float, n: int, periods: int, sharpe: float | None,
          event_sd: float | None) -> dict[str, Any]:
    """The next slot of a family of k tests: slot k + 1, with its Bonferroni and Holm bars and the design at the
    Bonferroni bar."""
    slot = k + 1
    return {
        "source": source, "k": k, "slot": slot,
        "bonferroni": _bar(alpha / slot), "holm_strictest": _bar(alpha / slot), "holm_loosest": _bar(alpha),
        "at_slot": _point(alpha / slot, n, periods, sharpe, event_sd),
    }


def plan(*, periods: int, n: int, alpha: float, k_registry: int | None, k_typed: int | None,
         sharpe: float | None, event_sd: float | None) -> dict[str, Any]:
    """The pre-registration plan of a design of n observations at `periods` a year: the figures at alpha and, for the
    registry's family size and a typed one (shown once when they agree), at the next slot of the family. `sharpe` is
    an optional typed annual Sharpe; `event_sd` an optional standard deviation per event (n is then the event count).

    Raises ValueError for a `periods` outside PERIODS (365 is refused), n below 2, alpha outside (0, 1), a negative or
    missing family size, a Sharpe that is not finite and an event standard deviation that is not positive."""
    _check_plan(periods, n, alpha, k_registry, k_typed, sharpe, event_sd)
    sizes = [("registry", k_registry)]
    if k_typed is not None and k_typed != k_registry:
        sizes.append(("typed", k_typed))
    return {
        "basis": "A", "note": NOTE, "power_target": POWER_TARGET, "reference_sharpe": REFERENCE_SHARPE,
        "periods": periods, "n": n, "years": n / periods, "alpha": alpha,
        "typed_sharpe": sharpe, "event_sd": event_sd,
        "nominal": _point(alpha, n, periods, sharpe, event_sd),
        "slots": [_slot(source, k, alpha, n, periods, sharpe, event_sd) for source, k in sizes if k is not None],
    }
