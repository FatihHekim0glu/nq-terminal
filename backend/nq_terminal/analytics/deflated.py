"""SV3 Deflated Sharpe Ratio over the registry (ANALYTICS_CATALOG section 7, SV3 and the construction SV3a).

Bailey and Lopez de Prado, The Deflated Sharpe Ratio (2014):
- expected maximum Sharpe of N unskilled trials with cross-trial variance V:
  `SR0 = sqrt(V) x ((1 - g) PhiInv(1 - 1/N) + g PhiInv(1 - 1/(N e)))`, g the Euler-Mascheroni constant;
- `DSR = PSR(SR0)`, SV1's Probabilistic Sharpe Ratio at the threshold SR0 on the trial's own n, skewness and raw
  kurtosis (`validity.psr`, the plain moment estimators).

The common basis (SV3a, written in the catalogue before this code): each trial's Basis A series as the tear sheet
builds it at 1 tick per side (the caller passes them); per-session Sharpe `SR_d` is the per-period Sharpe for a daily
series and `SR_m x sqrt(12/252)` for a monthly book (same annualised value; assumes serially uncorrelated months);
V is the sample variance (ddof 1) of the N values `SR_d`; each trial's DSR uses SR0 in its own period
(`SR0_d x sqrt(252/P)` for a monthly book). Extra view only: it never overrides a frozen pass bar and gives no verdict.

Revision after the statistics review (SV3a steps 5 to 9): the expected-maximum formula treats the trials' Sharpe
estimates as N(0, V) draws when no trial has skill, so a trial far from the rest for a known cause (mim_v0's cost drag)
inflates the empirical V and makes the bar meaningless. Two rows are therefore shown beside it:
- the null variance `V0 = mean_i [1 / (n_i - 1)] x P_i/252`, the sampling variance of a per-session Sharpe estimate
  when no trial has skill: Mertens' `(1 - g3 SR + (g4-1)/4 SR^2) / (n - 1)` at SR = 0, where the skew and kurtosis
  terms vanish (revision 2 of the statistics review: the observed SR put mim_v0's cost drag back into V0), with its
  SR0 and every trial's DSR under it (each PSR still on the trial's own moments, as in the paper);
- a leave-one-out line: V without the trial whose removal lowers it most, N kept, with that SR0.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd
from scipy import stats as sps

from nq_terminal.analytics import validity
from nq_terminal.analytics._inputs import PERIODS_DAILY, check_periods, returns_array

EULER_GAMMA = 0.5772156649015329
COST = 1  # ticks per side: the one cost every screen records
TAG = "[POST HOC]"
LABEL = ("Deflated Sharpe over the registered hypotheses on one daily basis: an extra view only; it never overrides "
         "a frozen pass bar and gives no verdict")
N_NOTE = ("N = {n} treats the registered rows as independent trials and counts no variant tried before registration: "
          "correlated trials make the effective N smaller, untracked variants make it larger. SR0 uses the paper's "
          "closed-form approximation of the expected maximum, a little above the exact value at small N, so each DSR "
          "errs low; DSR is defined for the best trial, and the other rows are descriptive only")
MONTHLY_NOTE = ("monthly books are moved to sessions as SR_m x sqrt(12/252), the same annualised Sharpe; this assumes "
                "serially uncorrelated months")


@dataclass(frozen=True)
class Trial:
    """One registered hypothesis: its Basis A series at 1 tick per side and its periods per year."""

    name: str
    kind: str
    periods: int
    r: pd.Series


def expected_max_sharpe(n_trials: int, variance: float) -> float:
    """SR0 in the unit of the Sharpe ratios whose variance is `variance`."""
    if not (isinstance(n_trials, int) and n_trials >= 2):
        raise ValueError(f"the expected maximum needs at least two trials, got {n_trials!r}")
    if not (math.isfinite(variance) and variance >= 0):
        raise ValueError(f"the cross-trial variance must be finite and non-negative, got {variance!r}")
    mix = (1 - EULER_GAMMA) * sps.norm.ppf(1 - 1 / n_trials) + EULER_GAMMA * sps.norm.ppf(1 - 1 / (n_trials * math.e))
    return float(math.sqrt(variance) * mix)


def deflated_sharpe(sr: float, sr0: float, n: float, skew: float, kurt: float) -> float:
    """DSR = PSR(SR0); SR and SR0 per period, kurtosis raw (normal 3)."""
    return validity.psr(sr, sr0, n, skew, kurt)


def session_sharpe(sr_period: float, periods: int) -> float:
    """A per-period Sharpe moved to sessions at the same annualised value."""
    return sr_period * math.sqrt(check_periods(periods) / PERIODS_DAILY)


def _moments(trial: Trial) -> dict:
    check_periods(trial.periods)
    m = validity.moments(returns_array(trial.r))
    if not all(math.isfinite(m[k]) for k in ("sr", "skew", "kurt")):
        raise ValueError(f"{trial.name}: its series has too few rows or no spread, so it has no Sharpe ratio")
    return m


def _null_part(m: dict, periods: int) -> float:
    """One trial's sampling variance of its per-session Sharpe estimate at SR = 0 (Mertens), NaN below two rows."""
    return 1.0 / (m["n"] - 1) * periods / PERIODS_DAILY if m["n"] > 1 else math.nan


def _row(trial: Trial, m: dict, sr0_session: float, sr0_null_session: float) -> dict:
    sr_session = session_sharpe(m["sr"], trial.periods)
    to_own = math.sqrt(PERIODS_DAILY / trial.periods)
    sr0_own, sr0_null_own = sr0_session * to_own, sr0_null_session * to_own
    return {"name": trial.name, "kind": trial.kind, "periods": trial.periods, "n": m["n"], "sr": m["sr"],
            "sr_session": sr_session, "annual_sharpe": m["sr"] * math.sqrt(trial.periods), "skew": m["skew"],
            "kurt": m["kurt"], "sr0_own_period": sr0_own,
            "dsr": deflated_sharpe(m["sr"], sr0_own, m["n"], m["skew"], m["kurt"]),
            "sr0_null_own_period": sr0_null_own,
            "dsr_null": deflated_sharpe(m["sr"], sr0_null_own, m["n"], m["skew"], m["kurt"])}


def leave_one_out(names: Sequence[str], per_session: np.ndarray) -> dict:
    """V without the trial whose removal lowers it most (the one that drives V), N kept at the full count."""
    n = len(names)
    if n < 3:
        return {"name": None, "variance": math.nan, "sr0_session": math.nan, "sr0_annual": math.nan, "n_trials": n}
    without = [float(np.var(np.delete(per_session, i), ddof=1)) for i in range(n)]
    drop = int(np.argmin(without))
    sr0 = expected_max_sharpe(n, without[drop])
    return {"name": names[drop], "variance": without[drop], "sr0_session": sr0,
            "sr0_annual": sr0 * math.sqrt(PERIODS_DAILY), "n_trials": n}


def registry_dsr(trials: Sequence[Trial]) -> dict:
    """SV3 over the trials (the registered hypotheses): N, V, SR0 and one DSR per trial, under V and under V0."""
    if len(trials) < 2:
        raise ValueError(f"the Deflated Sharpe needs at least two trials, got {len(trials)}")
    moments = [_moments(t) for t in trials]
    per_session = np.array([session_sharpe(m["sr"], t.periods) for t, m in zip(trials, moments)])
    n = len(trials)
    variance = float(np.var(per_session, ddof=1))
    sr0 = expected_max_sharpe(n, variance)
    variance_null = float(np.mean([_null_part(m, t.periods) for t, m in zip(trials, moments)]))
    sr0_null = expected_max_sharpe(n, variance_null) if math.isfinite(variance_null) else math.nan
    return {"n_trials": n, "variance": variance, "sr0_session": sr0,
            "sr0_annual": sr0 * math.sqrt(PERIODS_DAILY), "variance_null": variance_null,
            "sr0_null_session": sr0_null, "sr0_null_annual": sr0_null * math.sqrt(PERIODS_DAILY),
            "leave_one_out": leave_one_out([t.name for t in trials], per_session),
            "euler_gamma": EULER_GAMMA, "cost": COST, "tag": TAG, "label": LABEL, "monthly_note": MONTHLY_NOTE,
            "n_note": N_NOTE.format(n=n),
            "rows": [_row(t, m, sr0, sr0_null) for t, m in zip(trials, moments)]}
