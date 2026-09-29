"""Reference for the terminal's client-side power maths (roadmap #11, C8): the normal CDF and quantile, the minimum
detectable annual Sharpe ratio (MDE) and the power at a given Sharpe ratio, all from `scipy.stats.norm`.

The set-up is the one-sided test of "annual Sharpe > 0" on serially independent, normal returns. A book with `n`
observations at `periods` per year spans `n / periods` years; the t-statistic of its annual Sharpe ratio is
`sharpe * sqrt(years)`, so

    mde(n, periods, alpha, power)         = (z(1 - alpha) + z(power)) / sqrt(n / periods)
    power_at(sharpe, n, periods, alpha)   = Phi(sharpe * sqrt(n / periods) - z(1 - alpha))

with z the standard normal quantile and Phi its CDF. The annualisation is the book's own `periods` (252 sessions, 12
months), never 365; the test is one-sided, never two-sided (the born-failing variants in
`tests/test_p12_power.py`).

The web app ports the same formulas to TypeScript (`web/src/quant/normal.ts`, `power.ts`) and reads the golden
file this module writes: `python -m crosscheck.p12_power --write golden/p12_power.json`. `--check PATH` rebuilds the
golden vectors, compares them with the file for exact equality, names the first differing key and exits 1 on a
difference.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import scipy
from scipy.stats import norm

SOURCE = "qa/crosscheck/p12_power.py"

# (n, periods) of the 21 rows of DEFLATED_REAL in web/src/screens/reg/deflatedFixtures.ts (the terminal's own
# GET /api/analytics/deflated on the real research files, 2026-09-27), in that file's order.
REAL_PAIRS: tuple[tuple[int, int], ...] = (
    (2825, 252), (2836, 252), (2836, 252), (2836, 252), (2836, 252), (2836, 252), (2836, 252), (2686, 252),
    (123, 12), (2836, 252), (2836, 252), (2810, 252), (2835, 252), (2836, 252), (120, 12), (2811, 252),
    (120, 12), (131, 12), (120, 12), (2517, 252), (120, 12),
)
# A two-observation book, a ten-year monthly book and a forty-year daily book.
EDGE_PAIRS: tuple[tuple[int, int], ...] = ((2, 252), (120, 12), (10000, 252))
ALPHAS = (0.05, 0.05 / 21)  # a single test, and a Bonferroni cut for the 21 registered hypotheses
POWERS = (0.5, 0.8)
SHARPES = (0.0, 0.25, 0.5, 1.0)

CDF_XS = (-30.0, -20.0, -10.0, -8.3, -5.0, -3.0, -1.959963984540054, -1.0, -1e-8, 0.0, 0.5, 1.6448536269514722,
          3.0, 5.0, 8.0, 10.0)
QUANTILE_PS = (1e-300, 1e-100, 1e-20, 1e-12, 1e-6, 0.05 / 21, 0.01, 0.025, 0.05, 0.2, 0.5, 0.8, 0.95, 0.975, 0.99,
               1 - 1e-12, 1 - 1 / 21, 1 - 1 / (21 * math.e))


def mde(n: int, periods: int, alpha: float, power: float) -> float:
    """Smallest annual Sharpe ratio a one-sided test at `alpha` detects with probability `power`."""
    return float((norm.ppf(1 - alpha) + norm.ppf(power)) / math.sqrt(n / periods))


def power_at(sharpe: float, n: int, periods: int, alpha: float) -> float:
    """Probability that the one-sided test at `alpha` rejects when the true annual Sharpe ratio is `sharpe`."""
    return float(norm.cdf(sharpe * math.sqrt(n / periods) - norm.ppf(1 - alpha)))


def build_golden() -> dict:
    pairs = (*REAL_PAIRS, *EDGE_PAIRS)
    return {
        "source": SOURCE,
        "scipy": scipy.__version__,
        "cdf": [{"x": x, "value": float(norm.cdf(x))} for x in CDF_XS],
        "quantile": [{"p": p, "value": float(norm.ppf(p))} for p in QUANTILE_PS],
        "mde": [{"n": n, "periods": periods, "alpha": alpha, "power": power, "value": mde(n, periods, alpha, power)}
                for n, periods in pairs for alpha in ALPHAS for power in POWERS],
        "power": [{"sharpe": sharpe, "n": n, "periods": periods, "alpha": alpha,
                   "value": power_at(sharpe, n, periods, alpha)}
                  for n, periods in pairs for alpha in ALPHAS for sharpe in SHARPES],
    }


def render(golden: dict) -> str:
    return json.dumps(golden, indent=1, sort_keys=True, allow_nan=False) + "\n"


def first_difference(built: object, stored: object, path: str = "") -> str | None:
    """Path of the first key or index where the two JSON values differ (exact equality, type included)."""
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
    same = type(built) is type(stored) and built == stored
    return None if same else (path or "<root>")


def check(path: Path) -> int:
    try:
        stored = json.loads(path.read_text())
    except (OSError, ValueError) as error:
        print(f"cannot read {path}: {error}")
        return 1
    built = json.loads(render(build_golden()))
    where = first_difference(built, stored)
    if where is None:
        return 0
    print(f"{path} differs from the rebuilt golden vectors at {where}")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="crosscheck.p12_power", description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", metavar="PATH", help="write the golden vectors to PATH")
    mode.add_argument("--check", metavar="PATH", help="rebuild the golden vectors and compare them with PATH")
    args = parser.parse_args(argv)
    if args.write is not None:
        target = Path(args.write)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(build_golden()))
        return 0
    return check(Path(args.check))


if __name__ == "__main__":
    raise SystemExit(main())
