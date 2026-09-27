"""SV3 Deflated Sharpe over the registry (TASKS 10.2; ANALYTICS_CATALOG SV3 and its construction SV3a).

The golden fixture is the paper's example (Bailey and Lopez de Prado, The Deflated Sharpe Ratio): N = 100,
V = 1/(2 x 250), T = 1250, skewness -3, raw kurtosis 10, SR = 2.5/sqrt(250) gives SR0 = 0.1132 and DSR = 0.9004.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_terminal.analytics import deflated, validity

PAPER = {"n_trials": 100, "variance": 1 / (2 * 250), "t": 1250, "skew": -3.0, "kurt": 10.0, "sr": 2.5 / math.sqrt(250)}


def test_paper_fixture_sr0():
    sr0 = deflated.expected_max_sharpe(PAPER["n_trials"], PAPER["variance"])
    assert round(sr0, 4) == 0.1132


def test_paper_fixture_dsr():
    sr0 = deflated.expected_max_sharpe(PAPER["n_trials"], PAPER["variance"])
    dsr = deflated.deflated_sharpe(PAPER["sr"], sr0, PAPER["t"], PAPER["skew"], PAPER["kurt"])
    assert round(dsr, 4) == 0.9004


def test_born_failing_the_wrong_gamma_misses_the_fixture():
    wrong = math.sqrt(PAPER["variance"]) * sps.norm.ppf(1 - 1 / PAPER["n_trials"])  # max of N normals, no gamma mix
    dsr = deflated.deflated_sharpe(PAPER["sr"], wrong, PAPER["t"], PAPER["skew"], PAPER["kurt"])
    assert round(dsr, 4) != 0.9004


def test_sr0_formula_by_hand():
    n, v, g = 21, 0.0004, 0.5772156649015329
    expected = math.sqrt(v) * ((1 - g) * sps.norm.ppf(1 - 1 / n) + g * sps.norm.ppf(1 - 1 / (n * math.e)))
    assert deflated.expected_max_sharpe(n, v) == pytest.approx(expected, rel=1e-15)
    assert deflated.EULER_GAMMA == pytest.approx(np.euler_gamma, rel=1e-15)


def test_dsr_is_psr_at_sr0():
    assert deflated.deflated_sharpe(0.05, 0.02, 800, -0.4, 5.0) == validity.psr(0.05, 0.02, 800, -0.4, 5.0)


def test_monthly_sharpe_is_moved_to_sessions_at_the_same_annual_value():
    assert deflated.session_sharpe(0.3, 12) == pytest.approx(0.3 * math.sqrt(12 / 252), rel=1e-15)
    assert deflated.session_sharpe(0.05, 252) == 0.05
    with pytest.raises(ValueError):
        deflated.session_sharpe(0.1, 365)


def _trial(name, periods, seed, mean):
    rng = np.random.default_rng(seed)
    n = 2000 if periods == 252 else 120
    return deflated.Trial(name=name, kind="daily" if periods == 252 else "monthly", periods=periods,
                          r=pd.Series(mean + rng.standard_normal(n)))


def test_registry_view_follows_the_construction():
    trials = [_trial("a", 252, 1, 0.03), _trial("b", 252, 2, -0.01), _trial("c", 12, 3, 0.2), _trial("d", 252, 4, 0.0)]
    view = deflated.registry_dsr(trials)
    per_session = []
    for t in trials:
        m = validity.moments(t.r)
        per_session.append(m["sr"] * math.sqrt(t.periods / 252))
    v = float(np.var(per_session, ddof=1))
    sr0_d = deflated.expected_max_sharpe(4, v)
    assert view["n_trials"] == 4 and view["variance"] == pytest.approx(v, rel=1e-14)
    assert view["sr0_session"] == pytest.approx(sr0_d, rel=1e-14)
    assert view["sr0_annual"] == pytest.approx(sr0_d * math.sqrt(252), rel=1e-14)
    rows = {row["name"]: row for row in view["rows"]}
    c = rows["c"]
    m = validity.moments(trials[2].r)
    sr0_m = sr0_d * math.sqrt(252 / 12)
    assert c["sr0_own_period"] == pytest.approx(sr0_m, rel=1e-14)
    assert c["dsr"] == pytest.approx(validity.psr(m["sr"], sr0_m, m["n"], m["skew"], m["kurt"]), rel=1e-14)
    assert rows["a"]["sr_session"] == pytest.approx(per_session[0], rel=1e-14)
    assert rows["a"]["annual_sharpe"] == pytest.approx(per_session[0] * math.sqrt(252), rel=1e-14)
    assert view["tag"] == "[POST HOC]" and "never overrides" in view["label"]


def test_fewer_than_two_trials_or_a_bad_trial_is_refused():
    with pytest.raises(ValueError):
        deflated.registry_dsr([_trial("a", 252, 1, 0.0)])
    flat = deflated.Trial(name="flat", kind="daily", periods=252, r=pd.Series(np.zeros(100)))
    with pytest.raises(ValueError, match="flat"):
        deflated.registry_dsr([_trial("a", 252, 1, 0.0), flat])


# ---------------------------------------------------------------- SV3a revision (statistics review, 2026-09-27)


def test_null_variance_is_the_sampling_variance_at_sr_zero_in_sessions():
    # Mertens at SR = 0 (no skill): the skew and kurtosis terms are multiplied by SR, so each trial's sampling
    # variance of its per-period Sharpe is 1/(n - 1), moved to sessions by P/252
    trials = [_trial("a", 252, 1, 0.03), _trial("b", 252, 2, -0.01), _trial("c", 12, 3, 0.2), _trial("d", 252, 4, 0.0)]
    view = deflated.registry_dsr(trials)
    v0 = float(np.mean([1 / (len(t.r) - 1) * t.periods / 252 for t in trials]))
    assert view["variance_null"] == pytest.approx(v0, rel=1e-14)
    sr0_null = deflated.expected_max_sharpe(4, v0)
    assert view["sr0_null_session"] == pytest.approx(sr0_null, rel=1e-14)
    assert view["sr0_null_annual"] == pytest.approx(sr0_null * math.sqrt(252), rel=1e-14)
    c = {row["name"]: row for row in view["rows"]}["c"]
    m = validity.moments(trials[2].r)
    sr0_m = sr0_null * math.sqrt(252 / 12)
    assert c["sr0_null_own_period"] == pytest.approx(sr0_m, rel=1e-14)
    assert c["dsr_null"] == pytest.approx(validity.psr(m["sr"], sr0_m, m["n"], m["skew"], m["kurt"]), rel=1e-14)


def test_born_failing_a_far_trial_does_not_move_the_null_variance():
    # V0 is the variance under no skill, so a trial's own Sharpe must not enter it: moving one trial far away (the
    # mim_v0 case, SR -11.5 annualised) leaves V0 where it was. The observed-moment formula moved it.
    base = [_trial("a", 252, 1, 0.03), _trial("b", 252, 2, -0.01), _trial("d", 252, 4, 0.0)]
    far = deflated.Trial(name="far", kind="daily", periods=252, r=_trial("e", 252, 5, 0.0).r - 0.7)
    near = deflated.Trial(name="far", kind="daily", periods=252, r=_trial("e", 252, 5, 0.0).r)
    with_far, with_near = deflated.registry_dsr([*base, far]), deflated.registry_dsr([*base, near])
    assert with_far["variance_null"] == pytest.approx(with_near["variance_null"], rel=1e-15)
    m = validity.moments(far.r)
    observed = validity.sr_variance_term(m["sr"], m["skew"], m["kurt"]) / (m["n"] - 1)
    assert observed > 1.1 / (m["n"] - 1)  # what the old formula put in for this trial


def test_leave_one_out_names_the_trial_that_drives_v_and_keeps_n():
    outlier = deflated.Trial(name="costly", kind="daily", periods=252,
                             r=pd.Series(-0.7 + np.random.default_rng(9).standard_normal(2000)))
    trials = [_trial("a", 252, 1, 0.03), _trial("b", 252, 2, -0.01), _trial("d", 252, 4, 0.0), outlier]
    view = deflated.registry_dsr(trials)
    loo = view["leave_one_out"]
    assert loo["name"] == "costly"
    rest = [validity.moments(t.r)["sr"] for t in trials[:3]]
    assert loo["variance"] == pytest.approx(float(np.var(rest, ddof=1)), rel=1e-14)
    assert loo["variance"] < view["variance"] / 30
    assert loo["sr0_session"] == pytest.approx(deflated.expected_max_sharpe(4, loo["variance"]), rel=1e-14)
    assert loo["n_trials"] == 4


def test_born_failing_the_empirical_v_alone_deflates_every_trial_to_nothing():
    outlier = deflated.Trial(name="costly", kind="daily", periods=252,
                             r=pd.Series(-0.7 + np.random.default_rng(9).standard_normal(2000)))
    good = deflated.Trial(name="good", kind="daily", periods=252,
                          r=pd.Series(0.06 + np.random.default_rng(5).standard_normal(2000)))
    view = deflated.registry_dsr([good, _trial("a", 252, 1, 0.0), _trial("b", 252, 2, 0.0), outlier])
    row = {r["name"]: r for r in view["rows"]}["good"]
    assert row["dsr"] < 1e-6  # the paper's empirical V, driven by the cost outlier
    assert row["dsr_null"] > 0.5  # the variance the expected-maximum formula assumes under no skill


def test_the_label_says_n_treats_the_rows_as_independent():
    view = deflated.registry_dsr([_trial("a", 252, 1, 0.0), _trial("b", 252, 2, 0.0)])
    assert "independent" in view["n_note"] and "variants" in view["n_note"]


def test_the_note_names_the_approximation_and_the_trial_dsr_is_for():
    # the paper's closed form is 1.7% above the exact E[max] of 21 normals (1.9221 against 1.8892): conservative
    view = deflated.registry_dsr([_trial("a", 252, 1, 0.0), _trial("b", 252, 2, 0.0)])
    assert "approximation" in view["n_note"] and "best trial" in view["n_note"]
