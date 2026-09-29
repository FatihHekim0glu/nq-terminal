"""Reference for the paper path on the SV6 cone (ROADMAP 17 step 1; ANALYTICS SV6 cone, LV6 paper path).

The terminal places a paper (or model) cumulative P&L path, in USD, on the stationary-bootstrap cone of the
hypothesis behind the paper book. The cone is in fractions of K (`unit: "fraction of K"`, `how: "summed"`), so
the path is divided by K, the capital of the linked Nautilus reproduction, and compared pointwise with the five
percentiles at each step. `[POST HOC]`: a placement of what happened against resampled history, descriptive
only. It says where the path sits, never whether it is right or wrong.

`path_on_cone(usd, capital, quantiles, horizon)`:

- `first_index`: the index of the first row with a finite value (None when there is none). Step k of the cone
  (k = 1..horizon) is the row at `first_index + k - 1`: steps count rows, not dates.
- `fraction`: a list of length `horizon`, `usd[first_index + k - 1] / capital`, None where that row is absent
  (the path is shorter than the horizon), null or not finite.
- `bands`: a list of length `horizon`. At each step the percentiles are `[p5, p25, p50, p75, p95]` and the
  band is `numpy.searchsorted(percentiles, fraction, side="right")`, 0..5 mapped to `BANDS`. A value exactly on
  a percentile therefore sits in the band above it (p25 exactly is `p25to50`, p95 exactly is `above95`).
  None where the fraction is None, or a percentile is missing (absent list, list too short, null, not finite), or
  the five percentiles are not in ascending order at that step (a placement against crossing percentiles would
  say nothing).
- `beyond`: the number of rows after step `horizon` that hold a finite value. They are counted, never placed.

A capital that is zero, negative or not finite raises ValueError (K <= 0 has no fraction); so does a negative or
non-integer horizon.

The golden file (`build_golden`, `--write`, `--check`) is what the terminal's TypeScript port (`pathOnCone` in
web/src/screens/live/expectationModel.ts) is tested against, case by case.

    uv run python -m crosscheck.p12_expectation --write golden/p12_expectation.json
    uv run python -m crosscheck.p12_expectation --check golden/p12_expectation.json
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

SOURCE = ("numpy: usd / capital; numpy.searchsorted([p5, p25, p50, p75, p95], fraction, side='right') "
          "at each step of the cone")
KEYS = ("5", "25", "50", "75", "95")
BANDS = ("below5", "p5to25", "p25to50", "p50to75", "p75to95", "above95")


def _finite(value) -> float | None:
    """The value as a float, or None when it is missing or not a finite number."""
    if value is None or isinstance(value, bool):
        return None
    x = float(value)
    return x if math.isfinite(x) else None


def _percentiles_at(quantiles: dict, step: int) -> np.ndarray | None:
    """[p5, p25, p50, p75, p95] at a 0-based step, or None when one is missing or they are not ascending."""
    cut = []
    for key in KEYS:
        line = quantiles.get(key) or []
        value = _finite(line[step]) if step < len(line) else None
        if value is None:
            return None
        cut.append(value)
    ascending = all(a <= b for a, b in zip(cut, cut[1:]))
    return np.array(cut, dtype=float) if ascending else None


def path_on_cone(usd, capital, quantiles: dict, horizon) -> dict:
    """Place a cumulative USD path on the cone; see the module doc for the definition of each key."""
    capital = float(capital)
    if not math.isfinite(capital) or capital <= 0:
        raise ValueError(f"capital must be a positive finite number, got {capital!r}")
    if isinstance(horizon, bool) or not isinstance(horizon, (int, np.integer)) or horizon < 0:
        raise ValueError(f"horizon must be a non-negative whole number, got {horizon!r}")
    horizon = int(horizon)

    values = np.array([math.nan if v is None else v for v in usd], dtype=float)
    defined = np.isfinite(values)
    if not defined.any():
        return {"first_index": None, "fraction": [None] * horizon, "bands": [None] * horizon, "beyond": 0}
    first = int(np.argmax(defined))

    fraction: list[float | None] = []
    bands: list[str | None] = []
    for step in range(horizon):
        row = first + step
        if row >= len(values) or not defined[row]:
            fraction.append(None)
            bands.append(None)
            continue
        share = float(values[row] / capital)
        fraction.append(share)
        cut = _percentiles_at(quantiles, step)
        bands.append(None if cut is None else BANDS[int(np.searchsorted(cut, share, side="right"))])
    beyond = int(defined[first + horizon:].sum())
    return {"first_index": first, "fraction": fraction, "bands": bands, "beyond": beyond}


# ---------------------------------------------------------------- the golden file

# The first five steps of the cone of volmanaged_v0 at cost 1 (web/src/screens/tear/tearP1.fixtures.ts,
# HYP_BOOTSTRAP.cone.quantiles, "fraction of K", summed).
FIXTURE_QUANTILES = {
    "5": [-0.01743, -0.025095, -0.032124, -0.037485, -0.04272935],
    "25": [-0.00735, -0.012521639999999999, -0.01586691, -0.01942125, -0.0231],
    "50": [-0.00147, -0.0031500000000000005, -0.005564999999999999, -0.007559999999999999, -0.00968664],
    "75": [0.00378, 0.004935, 0.004613, 0.0039675150000000005, 0.003255],
    "95": [0.013281, 0.01449, 0.017325, 0.018741212999999996, 0.020259567999999974],
}
# The paper book's cumulative P&L in USD (web/src/screens/live/trackingFixtures.ts, TRACKING_POPULATED
# .paper_cumulative and .model_cumulative) and K, the served capital of the Nautilus reproduction
# (web/src/screens/tear/tear.fixtures.ts, RUN_ANALYTICS.capital).
FIXTURE_PAPER = [None, None, None, 12.0, 6.0]
FIXTURE_MODEL = [None, None, None, 12.0, 7.0]
FIXTURE_CAPITAL = 1_000_000.0

# Flat levels for the synthetic cases, in fractions of K. With K = 1000, usd / 1000 is the correctly rounded
# quotient, so -20 / 1000 is exactly the double written -0.02: the ties are exact, not near.
LEVELS = {"5": -0.1, "25": -0.02, "50": 0.0, "75": 0.03, "95": 0.05}
K = 1000.0


def _flat(steps: int) -> dict:
    return {key: [level] * steps for key, level in LEVELS.items()}


def _case(name: str, usd: list, quantiles: dict, horizon: int, capital: float = K) -> dict:
    given = {"usd": usd, "capital": capital, "quantiles": quantiles, "horizon": horizon}
    return {"name": name, "input": given, "expected": path_on_cone(**given)}


def build_golden() -> dict:
    missing = _flat(4)
    missing["50"] = [0.0, None, 0.0, 0.0]
    missing["95"] = [0.05, 0.05, 0.05]
    crossing = _flat(3)
    crossing["25"] = [-0.02, 0.06, -0.02]
    cases = [
        _case("fixture paper", FIXTURE_PAPER, FIXTURE_QUANTILES, 5, FIXTURE_CAPITAL),
        _case("fixture model", FIXTURE_MODEL, FIXTURE_QUANTILES, 5, FIXTURE_CAPITAL),
        _case("tie on p25 and p95", [-20.0, 50.0], _flat(2), 2),
        _case("tie on p5, p50 and p75", [-100.0, 0.0, 30.0], _flat(3), 3),
        _case("gap in the path", [None, 10.0, None, 30.0, 40.0], _flat(4), 4),
        _case("long path beyond the horizon", [None, 5.0, 10.0, 15.0, 20.0, None, 30.0], _flat(3), 3),
        _case("missing quantile", [10.0, 10.0, 10.0, 10.0], missing, 4),
        _case("crossing quantiles", [10.0, 10.0, 10.0], crossing, 3),
        _case("below p5 and above p95", [-101.0, -99.0, 51.0, 49.0], _flat(4), 4),
        _case("negative path below p5", [-150.0, -300.0, -450.0], _flat(3), 3),
        _case("path with no value", [None, None], _flat(3), 3),
    ]
    return {"source": SOURCE, "cases": cases}


def _dump(obj) -> str:
    return json.dumps(obj, indent=1, sort_keys=True, allow_nan=False) + "\n"


def _first_difference(built, stored, path: str = "") -> str | None:
    """The path of the first key or index where the two JSON values differ, or None when they are equal."""
    if isinstance(built, dict) and isinstance(stored, dict):
        for key in sorted(set(built) | set(stored)):
            if key not in built or key not in stored:
                return f"{path}.{key}" if path else key
            found = _first_difference(built[key], stored[key], f"{path}.{key}" if path else key)
            if found:
                return found
        return None
    if isinstance(built, list) and isinstance(stored, list):
        for i in range(max(len(built), len(stored))):
            if i >= len(built) or i >= len(stored):
                return f"{path}[{i}]"
            found = _first_difference(built[i], stored[i], f"{path}[{i}]")
            if found:
                return found
        return None
    return None if built == stored and type(built) is type(stored) else (path or "<root>")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="crosscheck.p12_expectation", description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", metavar="PATH", help="write the golden file")
    mode.add_argument("--check", metavar="PATH", help="rebuild and compare with the golden file (exit 1 on a difference)")
    args = parser.parse_args(argv)
    if args.write:
        target = Path(args.write)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(_dump(build_golden()), encoding="utf-8", newline="\n")
        print(f"p12_expectation: wrote {target}")
        return 0
    try:
        stored = json.loads(Path(args.check).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"p12_expectation: cannot read {args.check}: {exc}")
        return 1
    where = _first_difference(json.loads(_dump(build_golden())), stored)
    if where is not None:
        print(f"p12_expectation: {args.check} differs from a fresh build at {where}")
        return 1
    print(f"p12_expectation: {args.check} matches a fresh build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
