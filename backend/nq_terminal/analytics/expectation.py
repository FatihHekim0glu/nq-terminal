"""LV6 and LV6b: the paper book against its backtest expectation (ANALYTICS_CATALOG section 13). [POST HOC].

LV6. The paper and the model cumulative P&L of LV5 (USD, one entry per journal close row after the first) are
divided by K, the served capital of the linked Nautilus reproduction, and placed step by step on a cone in
"fraction of K", summed:
- step k of the cone is the k-th row counted from the first row with a finite value (rows, not dates);
- the band at a step is the count of the percentiles p5, p25, p50, p75 and p95 at or below the fraction, named
  (`numpy.searchsorted(..., side="right")`: a value on a percentile sits in the band above it); a missing value or
  percentile, or percentiles that are not ascending at that step, give no band;
- rows with a value after the cone's horizon are counted (`beyond`) and never placed.
This is the browser's client-phase arithmetic (`pathOnCone`, `coneBand` and the numbers of `expectationView` in
web/src/screens/live/expectationModel.ts), served now: `path_on_cone` equals every case of
`terminal/qa/golden/p12_expectation.json` (numpy reference `qa/crosscheck/p12_expectation.py`). A bool is not a
number here, as in the browser, where `typeof true` is not "number".

The gate (`gate`) gives the first reason the paths cannot be placed that needs no cone, in the browser's order: no
value to place, no registered hypothesis owning the journal, no recorded cost, no usable linked run, no capital. The
run whose capital is K (`capital_run`) is the first of the hypothesis card's `nautilus_runs` that the run list knows,
is not a probe, is readable and has not failed its balance check (an unanswered check is accepted). The default cost
(`default_cost`) is 1 tick per side when recorded, else the first recorded cost. A cone whose unit is not exactly
"fraction of K" or whose paths are not summed is refused in words (`cone_refusal`).

LV6b, the live-start cone. SV6's resampling (`analytics/bootstrap.py`: Politis and Romano's stationary bootstrap,
arch 8.0.0's Politis-White stationary block length on the series itself, seed 20260927, 10,000 replications, the
first H values of each replication summed, numpy linear percentiles 5, 25, 50, 75 and 95 at each step on their own)
applied to the paper book's own daily P&L from its start instead of the backtest's series: the LV5 `paper` values
from the first one that is finite (the start date), sessions without a value left out, each divided by the same K.
H = min(252, n), as SV6 never draws a horizon longer than the series. Fewer than 30 sessions (the bootstrap's
minimum), or a series without spread, get no cone and a refusal in words. The paper path is part of the history this
cone resamples, so where it sits on it is not an independent comparison: the cone shows the spread of reorderings, in
blocks, of the book's own sessions. Pointwise percentiles, not a band that whole paths stay inside; descriptive only,
no alarm, no verdict, no threshold.

LV6b places both paths by finite session (`live_placement`): step k of that cone sums the first k sessions with a
paper value, so rows without one are taken out of the running totals first, where on the backtest cone steps count
rows.

Pure: plain lists and mappings in, plain dicts out; nothing is read from disk and nothing is cached here.
"""
from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from itertools import pairwise
from typing import Any

import numpy as np
import pandas as pd

from nq_terminal.analytics import bootstrap

TAG = "[POST HOC]"
BANDS = ("below5", "p5to25", "p25to50", "p50to75", "p75to95", "above95")
PERCENTILE_KEYS = ("5", "25", "50", "75", "95")
CONE_UNIT = "fraction of K"
CONE_HOW = "summed"
DEFAULT_COST = 1
LIVE_PERIODS = 252
LIVE_BASIS = "A"
MIN_LIVE_SESSIONS = bootstrap.MIN_N
LIVE_LABEL = ("resampled from the paper book's own sessions since its start, not a forecast; the paper path is part "
              "of the history it resamples; pointwise percentiles at each horizon, not a band that whole paths stay "
              "inside")
# The paper books that follow a registered hypothesis: the journal file name (from its start, up to a word boundary)
# and the hypothesis behind it. ASCII word boundaries, as JavaScript's \b.
PAPER_BOOKS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^volmanaged_paper_journal\b", re.ASCII), "volmanaged_v0"),
)


def as_finite(value: Any) -> float | None:
    """The value as a float when it is a finite number (not a bool), else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        return None
    x = float(value)
    return x if math.isfinite(x) else None


def _refusal(code: str, **params: Any) -> dict:
    return {"code": code, "params": {k: str(v) for k, v in params.items()}}


# ---------------------------------------------------------------- the placement (pathOnCone, coneBand)


def cone_band(value: Any, q: Sequence[Any]) -> str | None:
    """The band of `value` among five percentiles, or None for a non-finite value or percentile, or crossing ones."""
    x = as_finite(value)
    cut = [as_finite(p) for p in q]
    if x is None or len(cut) != len(PERCENTILE_KEYS) or any(p is None for p in cut):
        return None
    if any(b < a for a, b in pairwise(cut)):
        return None
    return BANDS[sum(1 for p in cut if p <= x)]


def _percentiles_at(quantiles: Mapping[str, Sequence[Any]], step: int) -> list[float] | None:
    cut = []
    for key in PERCENTILE_KEYS:
        line = quantiles.get(key) or []
        value = as_finite(line[step]) if step < len(line) else None
        if value is None:
            return None
        cut.append(value)
    return cut


def _check_horizon(horizon: Any) -> int:
    if isinstance(horizon, bool) or not isinstance(horizon, (int, np.integer)) or horizon < 0:
        raise ValueError(f"horizon must be a non-negative whole number, got {horizon!r}")
    return int(horizon)


def path_on_cone(usd: Sequence[Any], capital: Any, quantiles: Mapping[str, Sequence[Any]], horizon: Any) -> dict:
    """Place a cumulative USD path on the cone: {first_index, fraction, bands, beyond} (see the module doc)."""
    k = as_finite(capital)
    if k is None or k <= 0:
        raise ValueError(f"capital must be a positive finite number, got {capital!r}")
    steps = _check_horizon(horizon)
    values = [as_finite(v) for v in usd]
    first = next((i for i, v in enumerate(values) if v is not None), None)
    if first is None:
        return {"first_index": None, "fraction": [None] * steps, "bands": [None] * steps, "beyond": 0}
    fraction: list[float | None] = []
    bands: list[str | None] = []
    for step in range(steps):
        row = first + step
        value = values[row] if row < len(values) else None
        if value is None:
            fraction.append(None)
            bands.append(None)
            continue
        share = value / k
        cut = _percentiles_at(quantiles, step)
        fraction.append(share)
        bands.append(None if cut is None else cone_band(share, cut))
    beyond = sum(1 for v in values[first + steps:] if v is not None)
    return {"first_index": first, "fraction": fraction, "bands": bands, "beyond": beyond}


# ---------------------------------------------------------------- the book, the cost and K


def paper_book_hypothesis(journal: str | None) -> str | None:
    """The hypothesis whose cone a paper journal is placed on, or None for a journal no registered hypothesis owns."""
    if not journal:
        return None
    return next((name for pattern, name in PAPER_BOOKS if pattern.search(journal)), None)


def default_cost(costs: Sequence[int]) -> int | None:
    """1 tick per side when the hypothesis records it, else its first recorded cost, else None."""
    if DEFAULT_COST in costs:
        return DEFAULT_COST
    return costs[0] if len(costs) else None


def capital_run(nautilus_runs: Sequence[str], runs: Sequence[Mapping[str, Any]]) -> str | None:
    """The first card run the run list knows that is not a probe, is readable and has not failed its balance check."""
    by_id = {r["run_id"]: r for r in runs}
    for run_id in nautilus_runs:
        found = by_id.get(run_id)
        if found is None or found.get("is_probe") or found.get("balance_ok") is False:
            continue
        if found.get("readable") is False:
            continue
        return run_id
    return None


def tracking_has_value(tracking: Mapping[str, Any] | None) -> bool:
    """Present, with a finite paper or model cumulative value."""
    if not tracking or not tracking.get("present"):
        return False
    return any(as_finite(v) is not None for key in ("paper_cumulative", "model_cumulative")
               for v in tracking.get(key) or [])


def gate(tracking: Mapping[str, Any] | None, hypothesis: str | None, cost: int | None, run_id: str | None,
         capital: Any) -> dict | None:
    """The first refusal that needs no cone, as {code, params}, or None when only the cone is left to check."""
    if not tracking_has_value(tracking):
        return _refusal("empty")
    if hypothesis is None:
        return _refusal("no_book")
    if cost is None:
        return _refusal("no_cost", hypothesis=hypothesis)
    if run_id is None:
        return _refusal("no_run")
    k = as_finite(capital)
    if k is None or k <= 0:
        return _refusal("no_capital", run=run_id)
    return None


def cone_refusal(cone: Mapping[str, Any]) -> dict | None:
    """None for a summed fraction-of-K cone; otherwise the refusal that names its unit and how its paths were made."""
    if cone.get("unit") == CONE_UNIT and cone.get("how") == CONE_HOW:
        return None
    return _refusal("unit", unit=cone.get("unit"), how=cone.get("how"))


# ---------------------------------------------------------------- the numbers of the card on one cone


def _last_step(paper: dict, model: dict) -> int:
    """The last step (1-based) at which either path has a value, or 0 when neither has."""
    for step in range(max(len(paper["fraction"]), len(model["fraction"])), 0, -1):
        for path in (paper, model):
            if step <= len(path["fraction"]) and path["fraction"][step - 1] is not None:
                return step
    return 0


def _date_at(dates: Sequence[str], row: int) -> str | None:
    return dates[row] if 0 <= row < len(dates) else None


def placement(tracking: Mapping[str, Any], capital: float, cone: Mapping[str, Any]) -> dict:
    """Both paths on one cone, the anchor row and session, the latest step with a value and the rows past the horizon."""
    horizon = len(cone["steps"])
    quantiles = cone["quantiles"]
    paper = path_on_cone(tracking.get("paper_cumulative") or [], capital, quantiles, horizon)
    model = path_on_cone(tracking.get("model_cumulative") or [], capital, quantiles, horizon)
    first = paper["first_index"] if paper["first_index"] is not None else model["first_index"]
    first = 0 if first is None else first
    dates = tracking.get("date") or []
    step = _last_step(paper, model)
    return {"horizon": horizon, "first_index": first, "anchor_date": _date_at(dates, first), "paper": paper,
            "model": model, "latest_step": step, "latest_date": _date_at(dates, first + step - 1) if step else None,
            "beyond": max(paper["beyond"], model["beyond"])}


def _kept(values: Sequence[Any], rows: Sequence[int]) -> list[Any]:
    return [values[i] if i < len(values) else None for i in rows]


def live_placement(tracking: Mapping[str, Any], capital: float, cone: Mapping[str, Any]) -> dict:
    """`placement` on the live-start cone, by finite session: step k of that cone sums the first k sessions with a
    paper value (`live_series` leaves the others out), so the rows without one are taken out of the dates and of both
    running totals before the placement. `first_index` is still the row in the tracking read; `anchor_date` and
    `latest_date` name the sessions."""
    rows = [i for i, v in enumerate(tracking.get("paper") or []) if as_finite(v) is not None]
    squeezed = {"date": _kept(tracking.get("date") or [], rows),
                "paper_cumulative": _kept(tracking.get("paper_cumulative") or [], rows),
                "model_cumulative": _kept(tracking.get("model_cumulative") or [], rows)}
    found = placement(squeezed, capital, cone)

    def row(i: int | None) -> int | None:
        return None if i is None else rows[i]

    return {**found, "first_index": row(found["first_index"]) if rows else 0,
            "paper": {**found["paper"], "first_index": row(found["paper"]["first_index"])},
            "model": {**found["model"], "first_index": row(found["model"]["first_index"])}}


# ---------------------------------------------------------------- LV6b: the live-start cone


def _index(dates: Sequence[str]) -> pd.Index:
    """A DatetimeIndex of the session dates when every one parses and they strictly increase, else row numbers."""
    parsed = pd.to_datetime(pd.Series(list(dates), dtype=object), format="%Y-%m-%d", errors="coerce")
    if len(parsed) and not parsed.isna().any() and parsed.is_monotonic_increasing and parsed.is_unique:
        return pd.DatetimeIndex(parsed)
    return pd.RangeIndex(len(dates))


def live_series(dates: Sequence[str], paper: Sequence[Any], capital: Any) -> pd.Series:
    """The paper book's daily P&L over K from its first finite value, sessions without a value left out."""
    k = as_finite(capital)
    if k is None or k <= 0:
        raise ValueError(f"capital must be a positive finite number, got {capital!r}")
    if len(dates) != len(paper):
        raise ValueError(f"{len(dates)} dates for {len(paper)} paper values")
    values = [as_finite(v) for v in paper]
    keep = [i for i, v in enumerate(values) if v is not None]
    index = _index(dates)
    return pd.Series([values[i] / k for i in keep], index=index[keep], dtype=float)


def live_start_cone(dates: Sequence[str], paper: Sequence[Any], capital: Any, *, reps: int = bootstrap.REPS,
                    seed: int = bootstrap.SEED) -> dict:
    """LV6b: SV6's cone of the paper book's own daily P&L (fraction of K, summed), or a refusal in words."""
    r = live_series(dates, paper, capital)
    n = len(r)
    labelled = isinstance(r.index, pd.DatetimeIndex)
    out = {"n": n, "start_date": r.index[0].strftime("%Y-%m-%d") if n and labelled else None,
           "end_date": r.index[-1].strftime("%Y-%m-%d") if n and labelled else None, "block": None, "reps": reps,
           "seed": seed, "horizon": 0, "steps": [], "quantiles": None, "realised": [], "realised_dates": [],
           "unit": CONE_UNIT, "how": CONE_HOW, "label": LIVE_LABEL, "refusal": None}
    if n < MIN_LIVE_SESSIONS:
        return {**out, "refusal": _refusal("live_short", n=n, min=MIN_LIVE_SESSIONS)}
    block = bootstrap.optimal_block_length(r)["stationary"]
    if not math.isfinite(block):
        return {**out, "refusal": _refusal("live_flat", n=n)}
    found = bootstrap.cone(r, LIVE_BASIS, LIVE_PERIODS, reps=reps, seed=seed, block=block)
    return {**out, "block": float(block), "horizon": found["horizon"], "steps": found["steps"],
            "quantiles": {str(q): [float(v) for v in found["quantiles"][str(q)]] for q in bootstrap.CONE_PERCENTILES},
            "realised": [float(v) for v in found["realised"]], "realised_dates": found["realised_dates"]}
