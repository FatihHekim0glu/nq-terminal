"""Reference values for the `lv6` dumps (ANALYTICS_CATALOG LV6 and LV6b, served): the paper path on the backtest-start
and live-start cones, recomputed from the raw inputs without the backend.

The bundle holds the paper book's LV5 rows (`dates`, daily `paper` P&L in USD with nulls, `paper_cumulative`,
`model_cumulative`), K (`capital`), the backtest-start cone's percentiles as served (`backtest_quantiles`, the SV6
cone whose own numbers the `bootstrap` kind checks against arch) with its `backtest_horizon`, and the replications and
seed of the live-start cone.

- Placement on the backtest-start cone: `p12_expectation.path_on_cone` (numpy: usd / K, `searchsorted` side right),
  the module the browser's client-phase port was pinned to, on the journal rows (step k is row `first + k - 1`); the
  anchor row (paper's first value, else the model's, else 0), the latest step with a value on either path and the
  larger beyond count are plain Python.
- Placement on the live-start cone: the same function after the rows whose daily `paper` value is not finite are
  taken out of both running totals, since step k of that cone sums the first k sessions with a value, not k rows.
  `first_index` stays the row in the input; the step counts and beyond counts are those of the squeezed paths.
- The live-start cone: r = the finite `paper` values from the first one, each over K (rows without a value dropped);
  arch 8.0.0 `optimal_block_length(r)` (stationary), `StationaryBootstrap(block, r, seed=seed)` with `reps`
  replications, the first H = min(252, n) values of each summed, `numpy.percentile` (linear) at 5, 25, 50, 75 and
  95 per step. Fewer than 30 values gives the word `live_short`, a series without spread `live_flat`; every other
  live value is then absent on both sides.
Words (bands, refusal codes) compare exactly; numbers at the crosscheck's tolerance (the cone is exact under the seed).
"""
from __future__ import annotations

import math
import warnings

import numpy as np

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from arch.bootstrap import StationaryBootstrap, optimal_block_length

from crosscheck.p12_expectation import path_on_cone
from crosscheck.reference import Ref

BUNDLE_INPUTS = ("dates", "paper", "paper_cumulative", "model_cumulative", "capital", "backtest_quantiles",
                 "backtest_horizon", "reps", "seed")
PERCENTILES = (5, 25, 50, 75, 95)
HORIZON = 252
MIN_N = 30
NONE = "none"
PLACE_SOURCE = "crosscheck.p12_expectation.path_on_cone (numpy usd / K, searchsorted side right)"


def _finite(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    x = float(value)
    return x if math.isfinite(x) else None


def _last_step(paper: dict, model: dict) -> int:
    steps = max(len(paper["fraction"]), len(model["fraction"]))
    for step in range(steps, 0, -1):
        if any(step <= len(p["fraction"]) and p["fraction"][step - 1] is not None for p in (paper, model)):
            return step
    return 0


def placement_refs(prefix: str, inputs: dict, quantiles: dict, horizon: int, *, by_session: bool = False) -> dict:
    """The placement keys of both paths; `by_session` squeezes out the rows without a daily paper value first."""
    capital = float(inputs["capital"])
    rows = [i for i, v in enumerate(inputs["paper"]) if _finite(v) is not None] if by_session else None

    def squeeze(path):
        return path if rows is None else [path[i] if i < len(path) else None for i in rows]

    def row(index):
        return index if rows is None or index is None else rows[index]

    paper = path_on_cone(squeeze(inputs["paper_cumulative"]), capital, quantiles, horizon)
    model = path_on_cone(squeeze(inputs["model_cumulative"]), capital, quantiles, horizon)
    first = paper["first_index"] if paper["first_index"] is not None else model["first_index"]
    out = {}
    for name, path in (("paper", paper), ("model", model)):
        out[f"{prefix}_{name}_fraction"] = Ref(path["fraction"], PLACE_SOURCE)
        out[f"{prefix}_{name}_bands"] = Ref(path["bands"], PLACE_SOURCE)
        out[f"{prefix}_{name}_first_index"] = Ref(row(path["first_index"]), PLACE_SOURCE)
        out[f"{prefix}_{name}_beyond"] = Ref(float(path["beyond"]), PLACE_SOURCE)
    out[f"{prefix}_first_index"] = Ref(float(0 if first is None else row(first)), "paper's first row, else the model's")
    out[f"{prefix}_latest_step"] = Ref(float(_last_step(paper, model)), "the last step with a value on either path")
    out[f"{prefix}_beyond"] = Ref(float(max(paper["beyond"], model["beyond"])), "the larger beyond count")
    return out


def live_cone(inputs: dict) -> dict:
    """{refusal, n, block, horizon, quantiles} of the live-start cone, recomputed with arch and numpy."""
    capital = float(inputs["capital"])
    values = [_finite(v) for v in inputs["paper"]]
    r = np.array([v / capital for v in values if v is not None], dtype=float)
    n = len(r)
    if n < MIN_N:
        return {"refusal": "live_short", "n": n}
    if not np.any(r - r.mean()):
        return {"refusal": "live_flat", "n": n}
    block = float(optimal_block_length(r)["stationary"].iloc[0])
    horizon = min(HORIZON, n)
    heads = [data[0][0][:horizon] for data in
             StationaryBootstrap(block, r, seed=int(inputs["seed"])).bootstrap(int(inputs["reps"]))]
    levels = np.cumsum(np.vstack(heads), axis=1)
    quantiles = {str(q): np.percentile(levels, q, axis=0).tolist() for q in PERCENTILES}
    return {"refusal": NONE, "n": n, "block": block, "horizon": horizon, "quantiles": quantiles}


def lv6_references(inputs: dict) -> dict:
    out = placement_refs("backtest", inputs, inputs["backtest_quantiles"], int(inputs["backtest_horizon"]))
    live = live_cone(inputs)
    src = "arch optimal_block_length and StationaryBootstrap(block, r, seed), first H summed, numpy percentile"
    out["live_refusal"] = Ref(live["refusal"], "fewer than 30 values: live_short; no spread: live_flat")
    out["live_n"] = Ref(float(live["n"]), "finite paper values from the first one")
    if live["refusal"] != NONE:
        return out
    out["live_block"] = Ref(live["block"], "arch optimal_block_length (stationary)")
    out["live_horizon"] = Ref(float(live["horizon"]), "min(252, n)")
    for q in PERCENTILES:
        out[f"live_cone_{q}"] = Ref(live["quantiles"][str(q)], src)
    out.update(placement_refs("live", inputs, live["quantiles"], live["horizon"], by_session=True))
    return out


LV6_INPUTS = {"lv6": BUNDLE_INPUTS}
LV6_REFERENCES = {"lv6": lv6_references}
