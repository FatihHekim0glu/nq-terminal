"""Reference for the terminal's client-side effective number of trials (roadmap #19, C8): the correlation of the
registered trials, its eigenvalues, two eigenvalue estimators of the effective N, the UPGMA clusters at a fixed cut,
and the expected-maximum Sharpe ratio (SR0) and Probabilistic Sharpe ratio (PSR) that turn an N into a bar. Every
number comes from numpy or scipy.

`[POST HOC]`: the panel below is synthetic. It exists to pin the browser's arithmetic, never to say anything about a
trial. The pre-registered constants:

- correlation: Pearson on the common sessions (`numpy.corrcoef`, rows are sessions), never Spearman;
- distance: `1 - rho`; linkage: average (UPGMA), never single or complete;
- cut: CLUSTER_CUT = 0.5 on that distance, `scipy.cluster.hierarchy.fcluster(..., criterion="distance")`, which keeps
  every merge whose height is at most the cut;
- participation ratio: `(sum of eigenvalues)^2 / (sum of squared eigenvalues)`;
- Li and Ji (2005): `sum(|l| >= 1) + sum(|l| - floor(|l|))` over the eigenvalues, `M_eff`; the estimator jumps by one
  at every integer eigenvalue of 2 or more (2 gives 1, just under 2 gives almost 2), so the hand cases that pin it
  avoid integer eigenvalues above 1 and the tests feed it the golden eigenvalues themselves, never a recomputed 2.0;
- per-session Sharpe ratio: `mean / sd` with ddof 1 (SV3a step 4), for the nine panel trials;
- SR0 (Bailey and Lopez de Prado 2014, the closed form kept by SV3a step 5):
  `sqrt(V) x ((1 - g) x Phi^-1(1 - 1/N) + g x Phi^-1(1 - 1/(N e)))`, g the Euler-Mascheroni constant; N may be
  fractional (an effective N); None (JSON null) for N <= 1, V < 0 or a non-finite input;
- PSR: `Phi((SR - SR0) x sqrt(n - 1) / sqrt(1 - skew x SR + (kurt - 1)/4 x SR^2))` with raw kurtosis (normal 3);
  None when n <= 1 or the variance term is not positive.

The panel: 400 sessions of nine trials in three planted blocks of three. Block b holds
`loading x factor_b + sqrt(1 - loading^2) x noise` (loadings 0.8, 0.6 and 0.3, so the within-block correlations are
about 0.64, 0.36 and 0.09), scaled to a daily standard deviation with a small drift. The last trial is trade-like: it
is zero on 90 percent of the sessions and carries the same kind of return, scaled up, on the other 10 percent. Every
value is a continuous draw, so there are no ties in the data and none between the linkage heights (checked below).

The golden file (`build_golden`, `--write`, `--check`) is what the terminal's TypeScript port is tested against
(web/src/quant/linalg.ts, cluster.ts, trials.ts):

    uv run python -m crosscheck.p12_neff --write golden/p12_neff.json
    uv run python -m crosscheck.p12_neff --check golden/p12_neff.json

`--check` rebuilds the golden vectors, compares them with the file for exact equality, names the first differing key
and exits 1 on a difference.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import scipy
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from scipy.stats import norm

SOURCE = "qa/crosscheck/p12_neff.py"
SEED = 20260928
SESSIONS = 400
BLOCK_SIZE = 3
LOADINGS = (0.8, 0.6, 0.3)
TRIALS = BLOCK_SIZE * len(LOADINGS)
NAMES = tuple(f"b{block}{letter}" for block in "123" for letter in "abc")
DAILY_SD = 0.01
TRADED_SHARE = 0.10  # the trade-like trial trades on 10 percent of the sessions and is zero on the other 90 percent
TRADE_SCALE = 3.0
FIRST_DATE = "2020-01-01"
CLUSTER_CUT = 0.5  # pre-registered: on 1 - rho, average linkage

# Copied from web/src/screens/reg/deflatedFixtures.ts (DEFLATED_REAL, the terminal's own GET /api/analytics/deflated
# on the real research files, 2026-09-27, V0 at SR = 0): the served SV3 view at N = 21. The rows are three of its 21.
SV3_ANCHOR: dict = {
    "n_trials": 21,
    "variance": 0.027775928049474662,
    "sr0_session": 0.3203403226128868,
    "variance_null": 0.00036764742284411126,
    "sr0_null_session": 0.036854717141262885,
    "euler_gamma": 0.5772156649015329,
    "rows": [
        {"name": "volmanaged_v0", "periods": 252, "n": 2686, "sr": 0.062457844034018856,
         "skew": -0.5760465158915851, "kurt": 6.725120316039107, "sr0_null_own_period": 0.036854717141262885,
         "dsr_null": 0.9031888626419274},
        {"name": "tsmom_v0", "periods": 12, "n": 123, "sr": 0.3038467936377017, "skew": -0.2758499188257157,
         "kurt": 2.9501188151401134, "sr0_null_own_period": 0.16888953101602366, "dsr_null": 0.9196939665711072},
        {"name": "halloween_v0", "periods": 252, "n": 2836, "sr": 0.054997531793198905,
         "skew": -0.959079488692517, "kurt": 20.490446915202643, "sr0_null_own_period": 0.036854717141262885,
         "dsr_null": 0.8250995407225304},
    ],
}
EULER_GAMMA = SV3_ANCHOR["euler_gamma"]
V0 = SV3_ANCHOR["variance_null"]

# N as the DEFLATED_REAL row count (21), a fractional effective N, two trials, and the edge (1 and below is null).
SR0_TRIALS = (21, 12.3, 9.4, 2, 1.5, 100, 1, 0.5)

# (sr, sr0, n, skew, kurt): per-period values, raw kurtosis.
PSR_INPUTS: tuple[tuple[float, float, float, float, float], ...] = (
    (0.05, 0.0, 250, 0.0, 3.0),  # normal returns against zero
    (0.1, 0.05, 1250, -3.0, 10.0),
    (0.02, 0.04, 500, 0.5, 6.0),  # below the bar
    (0.0619, 0.0619, 300, 0.0, 3.0),  # on the bar: exactly one half
    (0.05, 0.2, 2836, 3.0, 160.0),  # far below the bar, a fat tail
    (0.3, 0.1, 120, -0.5, 4.0),
    (0.9, 0.2, 60, -3.0, 25.0),  # a large Sharpe ratio makes the variance term large
    (0.03, 0.01, 2, 0.0, 3.0),  # the shortest usable series
    (0.05, 0.01, 1, 0.0, 3.0),  # n <= 1: null
    (0.05, 0.01, 0.5, 0.0, 3.0),  # n <= 1: null
    (2.0, 0.5, 100, 2.0, 1.0),  # variance term 1 - 4 + 0 < 0: null
    (1.0, 0.5, 100, 2.0, 1.0),  # variance term 1 - 2 + 0 < 0: null
)

HAND_MATRICES: tuple[tuple[str, list[list[float]]], ...] = (
    ("two_by_two", [[2.0, 1.0], [1.0, 2.0]]),  # eigenvalues 3 and 1
    ("identity_three", [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]),  # 1, 1, 1
    ("duplicate_columns", [[1.0, 1.0, 0.0], [1.0, 1.0, 0.0], [0.0, 0.0, 1.0]]),  # 2, 1, 0
    ("equicorrelation_04", [[1.0, 0.4, 0.4], [0.4, 1.0, 0.4], [0.4, 0.4, 1.0]]),  # 1.8, 0.6, 0.6
    ("path_laplacian", [[2.0, -1.0, 0.0], [-1.0, 2.0, -1.0], [0.0, -1.0, 2.0]]),  # 2 + sqrt 2, 2, 2 - sqrt 2
)


def participation_ratio(eigenvalues: np.ndarray) -> float:
    """(sum of eigenvalues)^2 / (sum of squared eigenvalues): M for M equal eigenvalues, 1 for one non-zero one."""
    return float(np.sum(eigenvalues) ** 2 / np.sum(eigenvalues**2))


def li_ji(eigenvalues: np.ndarray) -> float:
    """Li and Ji (2005): each |eigenvalue| adds 1 when it is at least 1, plus its fractional part."""
    size = np.abs(eigenvalues)
    return float(np.sum((size >= 1).astype(float) + (size - np.floor(size))))


def session_sharpe(returns: np.ndarray) -> np.ndarray:
    """mean / sd (ddof 1) of each column of a sessions x trials array."""
    return returns.mean(axis=0) / returns.std(axis=0, ddof=1)


def expected_max_sr0(variance: float, trials: float, gamma: float) -> float | None:
    """SR0 in the unit of the Sharpe ratios whose variance is `variance`; None when it is not defined."""
    if not (math.isfinite(trials) and math.isfinite(variance) and math.isfinite(gamma)):
        return None
    if trials <= 1 or variance < 0:
        return None
    mix = (1 - gamma) * norm.ppf(1 - 1 / trials) + gamma * norm.ppf(1 - 1 / (trials * math.e))
    return float(math.sqrt(variance) * mix)


def probabilistic_sharpe(sr: float, sr0: float, n: float, skew: float, kurt: float) -> float | None:
    """PSR(SR0): per-period SR and SR0, raw kurtosis; None when n <= 1 or the variance term is not positive."""
    if not all(math.isfinite(x) for x in (sr, sr0, n, skew, kurt)) or n <= 1:
        return None
    term = 1 - skew * sr + (kurt - 1) / 4 * sr * sr
    if not term > 0:
        return None
    return float(norm.cdf((sr - sr0) * math.sqrt(n - 1) / math.sqrt(term)))


def build_panel() -> dict:
    """The seeded 400 x 9 panel: three planted factor blocks, one trade-like trial, no ties."""
    rng = np.random.default_rng(SEED)
    factors = rng.standard_normal((SESSIONS, len(LOADINGS)))
    noise = rng.standard_normal((SESSIONS, TRIALS))
    loading = np.repeat(np.array(LOADINGS), BLOCK_SIZE)
    block = np.repeat(np.arange(len(LOADINGS)), BLOCK_SIZE)
    unit = loading * factors[:, block] + np.sqrt(1 - loading**2) * noise
    returns = DAILY_SD * unit + np.linspace(0.0002, 0.001, TRIALS)
    traded = np.sort(rng.choice(SESSIONS, size=round(TRADED_SHARE * SESSIONS), replace=False))
    trade_like = np.zeros(SESSIONS)
    trade_like[traded] = TRADE_SCALE * returns[traded, -1]
    returns[:, -1] = trade_like
    dates = np.busday_offset(FIRST_DATE, np.arange(SESSIONS), roll="forward")
    return {
        "dates": [str(d) for d in dates],
        "names": list(NAMES),
        "columns": [[float(x) for x in returns[:, j]] for j in range(TRIALS)],
    }


def clusters_at(tree: np.ndarray, cut: float) -> list[list[int]]:
    """fcluster(tree, cut, 'distance') as member lists: ascending members, clusters by first member."""
    labels = fcluster(tree, cut, criterion="distance")
    groups: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        groups.setdefault(int(label), []).append(index)
    return sorted(groups.values(), key=lambda members: members[0])


def cuts_between_heights(heights: np.ndarray) -> list[float]:
    """One cut in each gap between successive linkage heights (and below the first and above the last): the nine
    nested partitions from all singletons to one cluster."""
    edges = [0.0, *[float(h) for h in heights], float(heights[-1]) + 0.1]
    return [(edges[i] + edges[i + 1]) / 2 for i in range(len(edges) - 1)]


def eigen_case(name: str, matrix: list[list[float]]) -> dict:
    eigenvalues = np.linalg.eigvalsh(np.array(matrix))[::-1]
    return {"name": name, "matrix": matrix, "eigenvalues": [float(x) for x in eigenvalues],
            "participation_ratio": participation_ratio(eigenvalues), "li_ji": li_ji(eigenvalues)}


def inversion_case() -> dict:
    """A hand-made tree whose second merge (0.4) lies below the first (0.6): fcluster 'distance' keeps a merge only
    when every merge under it is at or below the cut too, so nothing joins until the cut reaches 0.6. (Average linkage
    never inverts; this pins the rule for the browser's flatClusters on any tree it is given.)"""
    tree = np.array([[0, 1, 0.6, 2], [2, 3, 0.4, 3]], dtype=float)
    return {"m": 3, "merges": [{"a": int(a), "b": int(b), "height": float(h), "size": int(s)} for a, b, h, s in tree],
            "cuts": [{"cut": cut, "clusters": clusters_at(tree, cut)} for cut in (0.3, 0.4, 0.5, 0.6, 0.7)]}


def paper_example() -> dict:
    """Bailey and Lopez de Prado (2014), the SV3 golden fixture: SR0 = 0.1132 and DSR = 0.9004 to four decimals."""
    n_trials, variance, sessions, skew, kurt = 100, 1 / 500, 1250, -3.0, 10.0
    sr = 2.5 / math.sqrt(250)
    sr0 = expected_max_sr0(variance, n_trials, EULER_GAMMA)
    assert sr0 is not None
    return {"n_trials": n_trials, "variance": variance, "sessions": sessions, "skew": skew, "kurt": kurt,
            "sr": sr, "gamma": EULER_GAMMA, "sr0": sr0, "dsr": probabilistic_sharpe(sr, sr0, sessions, skew, kurt),
            "reported": {"sr0": 0.1132, "dsr": 0.9004}}


def build_golden() -> dict:
    panel = build_panel()
    returns = np.array(panel["columns"]).T  # sessions x trials
    correlation = np.corrcoef(returns, rowvar=False)
    eigenvalues = np.linalg.eigvalsh(correlation)[::-1]
    tree = linkage(squareform(1 - correlation, checks=False), "average")
    heights = tree[:, 2]
    assert np.all(np.diff(heights) > 1e-6), "the panel must have no tied linkage heights"
    return {
        "source": SOURCE,
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "seed": SEED,
        "panel": panel,
        "correlation": correlation.tolist(),
        "eigenvalues": [float(x) for x in eigenvalues],
        "participation_ratio": participation_ratio(eigenvalues),
        "li_ji": li_ji(eigenvalues),
        "linkage": [{"a": int(a), "b": int(b), "height": float(h), "size": int(s)} for a, b, h, s in tree],
        "linkage_heights": [float(h) for h in heights],
        "cluster_cut": CLUSTER_CUT,
        "clusters": clusters_at(tree, CLUSTER_CUT),
        "cluster_sweep": [{"cut": cut, "clusters": clusters_at(tree, cut)} for cut in cuts_between_heights(heights)],
        "eigen_cases": [eigen_case(name, matrix) for name, matrix in HAND_MATRICES],
        "inversion_case": inversion_case(),
        "sr0_cases": [{"n_trials": n, "variance": V0, "gamma": EULER_GAMMA,
                       "value": expected_max_sr0(V0, n, EULER_GAMMA)} for n in SR0_TRIALS]
        + [{"n_trials": 21, "variance": SV3_ANCHOR["variance"], "gamma": EULER_GAMMA,
            "value": expected_max_sr0(SV3_ANCHOR["variance"], 21, EULER_GAMMA)},
           {"n_trials": 21, "variance": 0.0, "gamma": EULER_GAMMA, "value": expected_max_sr0(0.0, 21, EULER_GAMMA)},
           {"n_trials": 21, "variance": -1e-9, "gamma": EULER_GAMMA,
            "value": expected_max_sr0(-1e-9, 21, EULER_GAMMA)}],
        "session_sharpe": [{"name": name, "value": float(value)} for name, value in zip(NAMES, session_sharpe(returns))],
        "psr_cases": [{"sr": sr, "sr0": sr0, "n": n, "skew": skew, "kurt": kurt,
                       "value": probabilistic_sharpe(sr, sr0, n, skew, kurt)}
                      for sr, sr0, n, skew, kurt in PSR_INPUTS],
        "paper_example": paper_example(),
        "sv3_anchor": SV3_ANCHOR,
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
    parser = argparse.ArgumentParser(prog="crosscheck.p12_neff", description=__doc__.splitlines()[0])
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
