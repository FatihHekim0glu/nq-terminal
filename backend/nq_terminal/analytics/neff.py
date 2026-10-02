"""SV3b effective number of trials and SV8 effective number of members, served by the backend (ANALYTICS_CATALOG SV3b
and SV8 step 8; the C8 client-phase exception is closed by this module).

Until 2026-10-02 the browser computed these from `web/src/quant` (linalg, cluster, trials) and `effectiveNModel.ts`;
this module is that arithmetic, pure functions over arrays (no file, no gate, no hidden state), and the browser now
shows what the routes serve. Each value equals the browser value it replaced to 1e-12 relative (integers and cluster
labels exactly): both are pinned to the same numpy and scipy golden vectors, `terminal/qa/golden/p12_neff.json`.

The estimators, as the catalogue defines them (pre-registered constants, none tuned to a result):
- correlation: Pearson on the common sessions, never Spearman; the diagonal is exactly 1 and the matrix exactly
  symmetric (the centred and scaled product of `spa.member_correlation`);
- eigenvalues of the correlation matrix, largest first (numpy `eigvalsh`);
- participation ratio `(sum l)^2 / sum l^2`: M for M equal eigenvalues, 1 for one non-zero one;
- Li and Ji (2005): `sum over l of (|l| >= 1 ? 1 : 0) + (|l| - floor |l|)`, which jumps by one at every integer
  eigenvalue of 2 or more, so it is read as a count with that edge, and an eigenvalue within `SNAP_ULPS * k` last
  places of an integer is that integer (the solver's rounding noise does not pick the side);
- clusters: average linkage (UPGMA, never single or complete) on the distance `1 - rho`, cut at `CLUSTER_CUT = 0.5`
  (`scipy.cluster.hierarchy.fcluster`, criterion `distance`, which keeps every merge at or below the cut); N is the
  number of clusters;
- SR0 under each N: the SV3a step 5 closed form `sqrt(V) x ((1 - g) Phi^-1(1 - 1/N) + g Phi^-1(1 - 1/(N e)))` at
  the served null variance V0 and the served gamma (V0 is not recomputed for another N), N fractional for an
  effective N; and each registered row's DSR under it, `PSR(SR0 x sqrt(252 / P))` on the row's own moments.
  Monthly books are counted as independent: `N_total = N_eff(daily) + the monthly count`.

Refusals that remain are the ones about the data: no daily trial, fewer than `MIN_COMMON_SESSIONS` sessions on
which every daily trial has a return, a trial that does not vary on that window. The browser's other refusals (a
series that could not be read, an SR0, DSR, n or Sharpe that did not reproduce SV3) cannot arise here: the trials are
the very series SV3 was computed from, in the same process, and the tests pin the SR0 anchor.

An extra view only: a smaller N lowers SR0 and raises every DSR, so it errs towards flattering a trial; it never
overrides a frozen pass bar and gives no verdict.
"""
from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
from scipy import stats as sps
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from nq_terminal.analytics import spa, validity
from nq_terminal.analytics._inputs import PERIODS_DAILY

CLUSTER_CUT = 0.5  # on 1 - rho, average linkage
DAILY_PERIODS = PERIODS_DAILY
MIN_COMMON_SESSIONS = 252
SNAP_ULPS = 8  # last places an eigenvalue may sit off an integer and still count as that integer (Li and Ji)
REGISTERED, PARTICIPATION, LI_JI, CLUSTERS = "registered", "participation", "li_ji", "clusters"
ESTIMATORS = (PARTICIPATION, LI_JI, CLUSTERS)
NO_DAILY, TOO_FEW, DEGENERATE = "no_daily", "too_few", "degenerate"
SINGLE, UNDEFINED = "single", "undefined"


# ---------------------------------------------------------------- the estimators


def pearson(columns) -> np.ndarray:
    """Pearson correlation of the columns of a sessions by trials array: unit diagonal, exactly symmetric.

    A column that does not vary has no correlation: its row and column are NaN, the diagonal included.
    """
    return spa.member_correlation(np.asarray(columns, dtype=float))


def eigenvalues(correlation) -> np.ndarray:
    """The eigenvalues of a symmetric matrix, largest first."""
    return np.linalg.eigvalsh(np.asarray(correlation, dtype=float))[::-1].copy()


def _spectrum(values) -> np.ndarray:
    eig = np.asarray(values, dtype=float)
    if eig.ndim != 1 or eig.size == 0 or not np.isfinite(eig).all():
        raise ValueError("the spectrum needs at least one eigenvalue and every one must be finite")
    return eig


def participation_ratio(values) -> float:
    """(sum of the eigenvalues)^2 / (sum of their squares): how many eigenvalues carry the variance."""
    eig = _spectrum(values)
    squares = float(np.sum(eig ** 2))
    if squares == 0:
        raise ValueError("every eigenvalue is zero")
    return float(np.sum(eig) ** 2 / squares)


def li_ji_count(values) -> float:
    """The Li and Ji (2005) effective number of trials; a negative eigenvalue counts by its size.

    An eigenvalue within `SNAP_ULPS * k` last places of an integer of 1 or more is that integer: a solver lands a few
    bits either side of an exact eigenvalue (3 comes back as 2.9999999999999996 for a matrix of ones), and the count
    jumps by one there, so the rounding noise of the solver must not pick the side.
    """
    size = np.abs(_spectrum(values))
    nearest = np.round(size)
    slack = SNAP_ULPS * np.finfo(float).eps * np.maximum(1.0, size) * size.size
    size = np.where((nearest >= 1) & (np.abs(size - nearest) <= slack), nearest, size)
    return float(np.sum((size >= 1).astype(float) + (size - np.floor(size))))


def flat_clusters(correlation, cut: float = CLUSTER_CUT) -> list[list[int]]:
    """UPGMA clusters on `1 - rho` cut at `cut` (fcluster 'distance'): members ascending, clusters by first member."""
    corr = np.asarray(correlation, dtype=float)
    k = corr.shape[0]
    if k == 0:
        return []
    if k == 1:
        return [[0]]
    tree = linkage(squareform(1.0 - corr, checks=False), "average")
    labels = fcluster(tree, cut, criterion="distance")
    groups: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        groups.setdefault(int(label), []).append(index)
    return sorted(groups.values(), key=lambda members: members[0])


def rank_clusters(groups: Sequence[Sequence[int]]) -> list[list[int]]:
    """The clusters largest first, then by first member: the order the heatmap and the cluster line follow."""
    return [list(g) for g in sorted(groups, key=lambda g: (-len(g), g[0]))]


def expected_max_sr0(variance: float, trials: float, gamma: float) -> float | None:
    """SR0 in the unit of the Sharpe ratios whose variance is `variance`; `trials` may be fractional.

    None when trials <= 1, the variance is negative or an input is not finite.
    """
    if not (math.isfinite(variance) and math.isfinite(trials) and math.isfinite(gamma)):
        return None
    if trials <= 1 or variance < 0:
        return None
    mix = (1 - gamma) * sps.norm.ppf(1 - 1 / trials) + gamma * sps.norm.ppf(1 - 1 / (trials * math.e))
    return float(math.sqrt(variance) * mix)


def probabilistic_sharpe(sr: float, sr0: float, n: float, skew: float, kurt: float) -> float | None:
    """PSR(SR0), per-period SR and SR0, raw kurtosis; None when n <= 1, the variance term is not positive or an
    input is not finite."""
    if not all(math.isfinite(x) for x in (sr, sr0, n, skew, kurt)) or n <= 1:
        return None
    value = validity.psr(sr, sr0, n, skew, kurt)
    return None if math.isnan(value) else value


# ---------------------------------------------------------------- SV8: the effective number of members


def _strongest(corr: np.ndarray, names: Sequence[str]) -> dict:
    """The pair with the largest |rho|; the first in row order on a tie."""
    best = (0, 1, float(corr[0, 1]))
    for i in range(corr.shape[0]):
        for j in range(i + 1, corr.shape[0]):
            if abs(corr[i, j]) > abs(best[2]):
                best = (i, j, float(corr[i, j]))
    return {"a": names[best[0]], "b": names[best[1]], "rho": best[2]}


def effective_members(correlation, names: Sequence[str]) -> dict:
    """SV8 step 8: the family's effective number of members from the correlation of its loss differentials.

    Refuses (`refusal.kind`) for one member and for a member with no correlation (`undefined`, naming the first).
    Otherwise the participation ratio, the Li and Ji count, the clusters at the cut as member names (largest first)
    and the most correlated pair. It does not adjust any p-value.
    """
    corr = np.asarray(correlation, dtype=float)
    k = len(names)
    if corr.shape != (k, k):
        raise ValueError(f"need a {k} by {k} correlation matrix, got {corr.shape}")
    empty = {"k": k, "cut": CLUSTER_CUT, "participation": None, "li_ji": None, "clusters": [], "strongest": None}
    if k < 2:
        return {**empty, "refusal": {"kind": SINGLE, "name": None}}
    gap = np.flatnonzero(np.isnan(np.diag(corr)))
    if gap.size:
        return {**empty, "refusal": {"kind": UNDEFINED, "name": names[int(gap[0])]}}
    eig = eigenvalues(corr)
    groups = rank_clusters(flat_clusters(corr))
    return {**empty, "refusal": None, "participation": participation_ratio(eig), "li_ji": li_ji_count(eig),
            "clusters": [[names[i] for i in g] for g in groups], "strongest": _strongest(corr, names)}


# ---------------------------------------------------------------- SV3b: the effective number of trials


def _label(value) -> str:
    return value.strftime("%Y-%m-%d") if hasattr(value, "strftime") else str(value)


def _refused(kind: str, daily: list[str], monthly: list[str], *, name: str | None = None,
             sessions: int | None = None) -> dict:
    return {"refusal": {"kind": kind, "name": name, "sessions": sessions}, "daily": daily, "monthly": monthly,
            "window": None, "correlation": [], "eigenvalues": [], "clusters": [], "sequence": [], "estimates": [],
            "dsr": []}


def _common_window(daily) -> tuple[list, np.ndarray]:
    index = daily[0].r.index
    for t in daily[1:]:
        index = index.intersection(t.r.index)
    index = index.sort_values()
    return list(index), np.column_stack([t.r.reindex(index).to_numpy(dtype=float) for t in daily])


def _estimate(key: str, n_daily: float, monthly: int, found: dict) -> dict:
    n_total = n_daily + monthly
    sr0 = expected_max_sr0(found["variance_null"], n_total, found["euler_gamma"])
    return {"id": key, "n_daily": float(n_daily), "n_total": float(n_total), "sr0_session": sr0,
            "sr0_annual": None if sr0 is None else sr0 * math.sqrt(DAILY_PERIODS), "served": False}


def _dsr_under(row: dict, sr0_session: float | None) -> float | None:
    if sr0_session is None:
        return None
    return probabilistic_sharpe(row["sr"], sr0_session * math.sqrt(DAILY_PERIODS / row["periods"]), row["n"],
                                row["skew"], row["kurt"])


def effective_trials(trials: Sequence, found: dict) -> dict:
    """SV3b over the registered trials and the SV3 result `deflated.registry_dsr` gave for them.

    A daily trial is one with P = 252; the rest are monthly books, counted as independent trials. The view is the
    refusal (`refusal`, everything else empty) or the correlation of the daily trials on their common window, its
    eigenvalues, the clusters at the cut, and the four estimates of N (the registered count, participation, Li and
    Ji, clusters) with the SR0 each sets and every registered row's DSR under each.
    """
    daily = [t for t in trials if t.periods == DAILY_PERIODS]
    monthly = [t.name for t in trials if t.periods != DAILY_PERIODS]
    names = [t.name for t in daily]
    if not daily:
        return _refused(NO_DAILY, names, monthly)
    dates, columns = _common_window(daily)
    if len(dates) < MIN_COMMON_SESSIONS:
        return _refused(TOO_FEW, names, monthly, sessions=len(dates))
    flat = [i for i in range(columns.shape[1]) if bool(np.all(columns[:, i] == columns[0, i]))]
    if flat:
        return _refused(DEGENERATE, names, monthly, name=names[flat[0]])
    corr = pearson(columns)
    eig = eigenvalues(corr)
    groups = flat_clusters(corr)
    registered = {"id": REGISTERED, "n_daily": float(len(daily)), "n_total": float(found["n_trials"]),
                  "sr0_session": found["sr0_null_session"],
                  "sr0_annual": found["sr0_null_session"] * math.sqrt(DAILY_PERIODS), "served": True}
    estimates = [registered,
                 _estimate(PARTICIPATION, participation_ratio(eig), len(monthly), found),
                 _estimate(LI_JI, li_ji_count(eig), len(monthly), found),
                 _estimate(CLUSTERS, len(groups), len(monthly), found)]
    bars = {e["id"]: e["sr0_session"] for e in estimates}
    rows = [{"name": row["name"], "periods": row["periods"], "served": row["dsr_null"],
             **{key: _dsr_under(row, bars[key]) for key in ESTIMATORS}} for row in found["rows"]]
    return {"refusal": None, "daily": names, "monthly": monthly,
            "window": {"first": _label(dates[0]), "last": _label(dates[-1]), "sessions": len(dates)},
            "correlation": corr.tolist(), "eigenvalues": [float(x) for x in eig], "clusters": groups,
            "sequence": [i for g in rank_clusters(groups) for i in g], "estimates": estimates, "dsr": rows}
