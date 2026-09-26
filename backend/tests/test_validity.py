"""Statistical validity (ANALYTICS_CATALOG SV1, SV2, SV4, SV7 and the PF4 interval; TASKS 3.3).

Golden values come from the sources the catalogue cites:
- DSR paper example (Bailey and Lopez de Prado, The Deflated Sharpe Ratio): N=100, V=1/(2*250), T=1250,
  skew -3, kurtosis 10, SR=2.5/sqrt(250) gives SR0 = 0.1132 and DSR = PSR(SR0) = 0.9004.
- Sharpe Ratio Efficient Frontier (SSRN 1821643), appendix A.3: monthly mean 2, sd sqrt(12), skew -0.72,
  kurtosis 5.78, SR* = 1/sqrt(12), 95% gives MinTRL = 59.895 months (about 4.99 years), and PSR at a sample
  length of 59.895 is 0.95. Figures 8 to 10: IID Normal, annual SR 2 against 1 at 95% needs 2.73 years of daily,
  2.83 of weekly and 3.24 of monthly data.
- Mertens (2002): Var(SR) = (1 + SR^2/2 - skew*SR + (kurt-3)/4*SR^2)/T; with Normal moments this is Lo's (2002)
  IID variance (1 + SR^2/2)/T. The catalogue uses n-1 as in the PSR.
- SV4: `results/registry.csv` (read only) stored Bonferroni, Holm and BH columns within 1e-12, plus scipy's
  `false_discovery_control` and nq-lab's own `registry.holm`/`bh`/`bonferroni`.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats as sps

from nq_lab import registry as nq_registry
from nq_lab import sizing_stats
from nq_lab.config import RESULTS
from nq_terminal.analytics.validity import (
    SHARPE_DIFF_LABEL,
    Z95,
    benjamini_hochberg,
    bonferroni,
    holm,
    mertens_se,
    min_trl,
    min_trl_from_returns,
    moments,
    mt_boundaries,
    psr,
    psr_from_returns,
    registry_adjustments,
    sharpe_ci,
    sharpe_difference_tests,
    validity_summary,
)

SCREENS = RESULTS / "screens"
TOL = 1e-12
EULER_GAMMA = 0.5772156649015329


def _expected_max_sr(n_trials: int, variance: float) -> float:
    """DSR paper SR0 (test-only; SV3 itself is P1)."""
    return math.sqrt(variance) * ((1 - EULER_GAMMA) * sps.norm.ppf(1 - 1 / n_trials)
                                  + EULER_GAMMA * sps.norm.ppf(1 - 1 / (n_trials * math.e)))


@pytest.fixture(scope="module")
def registry_frame() -> pd.DataFrame:
    return pd.read_csv(RESULTS / "registry.csv", encoding="utf-8")


@pytest.fixture(scope="module")
def r_m_1() -> pd.Series:
    daily = pd.read_csv(SCREENS / "volmanaged_v0_daily.csv", parse_dates=["date"], encoding="utf-8")
    return daily.set_index("date")["r_m_1"]


def _screen(name: str) -> dict:
    return json.loads((SCREENS / f"{name}.json").read_text(encoding="utf-8"))


# ---------- SV1: PSR ----------

def test_dsr_paper_sr0_is_0_1132() -> None:
    assert round(_expected_max_sr(100, 1 / (2 * 250)), 4) == 0.1132


def test_psr_reproduces_the_dsr_paper_example() -> None:
    """DSR = PSR(SR0) = 0.9004 with the paper's SR0 = 0.113172, printed as 0.1132."""
    sr0 = _expected_max_sr(100, 1 / (2 * 250))
    assert round(sr0, 4) == 0.1132
    assert round(psr(2.5 / math.sqrt(250), sr0, 1250, skew=-3.0, kurt=10.0), 4) == 0.9004


def test_psr_at_the_printed_sr0_is_within_its_rounding() -> None:
    """At the printed 0.1132 itself PSR is 0.90026: dPSR/dSR0 is about -5, so the 2.8e-5 rounding of SR0
    moves PSR by 1.4e-4. The paper used the unrounded SR0 (the N=46 check below confirms it)."""
    got = psr(2.5 / math.sqrt(250), 0.1132, 1250, skew=-3.0, kurt=10.0)
    assert abs(got - 0.9004) < 2e-4


def test_psr_reproduces_the_dsr_paper_n46_and_normal_n88_statements() -> None:
    """Paper: after N=46 trials DSR would have been 0.9505; with Normal returns N=88 is the last N at 0.95."""
    sr = 2.5 / math.sqrt(250)
    assert round(psr(sr, _expected_max_sr(46, 1 / 500), 1250, skew=-3.0, kurt=10.0), 4) == 0.9505
    assert psr(sr, _expected_max_sr(88, 1 / 500), 1250, skew=0.0, kurt=3.0) >= 0.95
    assert psr(sr, _expected_max_sr(89, 1 / 500), 1250, skew=0.0, kurt=3.0) < 0.95


def test_psr_with_excess_kurtosis_misses_the_paper_value() -> None:
    """Born failing: feeding excess kurtosis (7) where the formula wants raw kurtosis (10) must miss 0.9004."""
    assert round(psr(2.5 / math.sqrt(250), 0.1132, 1250, skew=-3.0, kurt=7.0), 4) != 0.9004


def test_psr_with_an_annualised_sharpe_misses_the_paper_value() -> None:
    """Born failing: the SR must be per period; the annual 2.5 gives a different (saturated) PSR."""
    assert round(psr(2.5, 0.1132 * math.sqrt(250), 1250, skew=-3.0, kurt=10.0), 4) != 0.9004


def test_psr_at_min_trl_is_the_confidence_level() -> None:
    sr, sr_star = 2 / math.sqrt(12), 1 / math.sqrt(12)
    assert psr(sr, sr_star, 59.895, skew=-0.72, kurt=5.78) == pytest.approx(0.95, abs=5e-6)


def test_psr_normal_case_by_hand() -> None:
    sr, n = 0.1, 400
    z = sr * math.sqrt(n - 1) / math.sqrt(1 + 0.5 * sr ** 2)
    assert psr(sr, 0.0, n, skew=0.0, kurt=3.0) == pytest.approx(sps.norm.cdf(z), rel=1e-15)


def test_psr_is_nan_when_the_variance_term_is_not_positive() -> None:
    assert math.isnan(psr(0.5, 0.0, 100, skew=5.0, kurt=3.0))
    assert math.isnan(psr(0.5, 0.0, 1, skew=0.0, kurt=3.0))


def test_psr_from_returns_uses_the_population_moments() -> None:
    rng = np.random.default_rng(3)
    r = rng.standard_t(5, 1000) * 0.01 + 0.0005
    m = moments(r)
    assert m["n"] == 1000
    assert m["sr"] == pytest.approx(r.mean() / r.std(ddof=1), rel=1e-15)
    assert m["skew"] == pytest.approx(float(sps.skew(r, bias=True)), rel=1e-12)
    assert m["kurt"] == pytest.approx(float(sps.kurtosis(r, fisher=False, bias=True)), rel=1e-12)
    assert psr_from_returns(r, 0.01) == psr(m["sr"], 0.01, 1000, m["skew"], m["kurt"])


def test_moments_drop_nan() -> None:
    assert moments([0.01, np.nan, 0.02, -0.01])["n"] == 3


# ---------- SV2: MinTRL ----------

def test_min_trl_reproduces_the_frontier_paper_appendix() -> None:
    got = min_trl(2 / math.sqrt(12), 1 / math.sqrt(12), skew=-0.72, kurt=5.78, alpha=0.05)
    assert round(got, 3) == 59.895
    assert round(got / 12, 2) == 4.99


@pytest.mark.parametrize(("periods", "years"), [(252, 2.73), (52, 2.83), (12, 3.24)])
def test_min_trl_reproduces_the_frontier_paper_figures(periods: int, years: float) -> None:
    k = math.sqrt(periods)
    got = min_trl(2 / k, 1 / k, skew=0.0, kurt=3.0, alpha=0.05)
    assert round(got / periods, 2) == years


def test_min_trl_is_infinite_when_sr_does_not_beat_the_threshold() -> None:
    assert min_trl(0.05, 0.05, 0.0, 3.0) == math.inf
    assert min_trl(0.01, 0.05, 0.0, 3.0) == math.inf


def test_min_trl_rejects_a_bad_alpha() -> None:
    with pytest.raises(ValueError, match="alpha"):
        min_trl(0.1, 0.0, 0.0, 3.0, alpha=1.5)


def test_min_trl_from_returns_reports_sessions_years_and_reachability() -> None:
    rng = np.random.default_rng(11)
    r = rng.normal(0.001, 0.01, 2000)
    out = min_trl_from_returns(r, sr_star=0.0)
    m = moments(r)
    assert out["sessions"] == min_trl(m["sr"], 0.0, m["skew"], m["kurt"], 0.05)
    assert out["years"] == out["sessions"] / 252
    assert out["actual_sessions"] == 2000 and out["actual_years"] == 2000 / 252
    assert out["reachable"] is True
    low = min_trl_from_returns(-r, sr_star=0.0)
    assert low["reachable"] is False and low["sessions"] is None and low["years"] is None


# ---------- Mertens standard error and the PF4 interval ----------

def test_mertens_se_equals_the_published_form() -> None:
    sr, n, skew, kurt = 0.08, 1500, -0.6, 7.5
    published = (1 + sr ** 2 / 2 - skew * sr + (kurt - 3) / 4 * sr ** 2) / (n - 1)
    assert mertens_se(sr, n, skew, kurt) == pytest.approx(math.sqrt(published), rel=1e-14)


def test_mertens_se_under_normality_is_lo_iid() -> None:
    sr, n = 0.12, 800
    assert mertens_se(sr, n, 0.0, 3.0) == pytest.approx(math.sqrt((1 + sr ** 2 / 2) / (n - 1)), rel=1e-15)


def test_mertens_se_matches_the_sampling_spread_of_skewed_returns() -> None:
    """Monte Carlo: the sd of 4,000 sample Sharpes of a skewed, fat-tailed law is within 5% of Mertens."""
    rng = np.random.default_rng(20260926)
    n, reps = 500, 4000
    draws = -(rng.lognormal(0.0, 0.5, (reps, n)) - math.exp(0.125)) * 0.01 + 0.001  # negative skew
    srs = draws.mean(axis=1) / draws.std(axis=1, ddof=1)
    big = -(rng.lognormal(0.0, 0.5, 2_000_000) - math.exp(0.125)) * 0.01 + 0.001
    m = moments(big)
    se = mertens_se(m["sr"], n, m["skew"], m["kurt"])
    iid = math.sqrt((1 + m["sr"] ** 2 / 2) / (n - 1))
    assert abs(srs.std(ddof=1) / se - 1) < 0.05
    assert abs(srs.std(ddof=1) / iid - 1) > abs(srs.std(ddof=1) / se - 1)  # the moments matter here


def test_sharpe_ci_matches_the_anchor_and_the_mertens_band(r_m_1: pd.Series) -> None:
    out = sharpe_ci(r_m_1)
    assert abs(out["sharpe"] - 0.9914875364356387) <= TOL
    assert out["sharpe"] == sizing_stats.sharpe(r_m_1.dropna(), 252)
    m = moments(r_m_1)
    se_annual = mertens_se(m["sr"], m["n"], m["skew"], m["kurt"]) * math.sqrt(252)
    assert out["se_annual"] == pytest.approx(se_annual, rel=1e-15)
    assert out["lo"] == pytest.approx(out["sharpe"] - Z95 * se_annual, rel=1e-15)
    assert out["hi"] == pytest.approx(out["sharpe"] + Z95 * se_annual, rel=1e-15)
    assert out["n"] == 2686 and Z95 == 1.96


def test_sharpe_anchor_fails_with_sqrt_365(r_m_1: pd.Series) -> None:
    """Born failing (QA protocol 4): a wrong annualisation factor would miss the Sharpe anchor, so it is refused
    (C2), as perf refuses it; the value it would give is recorded here."""
    wrong = r_m_1.mean() / r_m_1.std(ddof=1) * np.sqrt(365)
    assert abs(wrong - 0.9914875364356387) > 1e-3
    with pytest.raises(ValueError, match="periods"):
        sharpe_ci(r_m_1, periods=365)
    with pytest.raises(ValueError, match="periods"):
        min_trl_from_returns(r_m_1, 0.0, periods=365)


def test_sharpe_ci_on_too_few_points_is_nan() -> None:
    out = sharpe_ci([0.01])
    assert math.isnan(out["sharpe"]) and math.isnan(out["lo"])


def test_validity_summary_shows_psr_at_zero_and_at_the_benchmark() -> None:
    rng = np.random.default_rng(5)
    idx = pd.bdate_range("2014-01-01", periods=1500)
    b = pd.Series(rng.normal(0.0004, 0.012, 1500), idx)
    r = pd.Series(0.5 * b.to_numpy() + rng.normal(0.0003, 0.006, 1500), idx)
    out = validity_summary(r, b)
    sr_b = moments(b)["sr"]
    assert out["psr"]["at_zero"] == psr_from_returns(r, 0.0)
    assert out["psr"]["at_benchmark"] == psr_from_returns(r, sr_b)
    assert out["psr"]["benchmark_sr_per_period"] == sr_b
    assert out["min_trl"]["at_zero"] == min_trl_from_returns(r, 0.0)
    assert out["sharpe_ci"] == sharpe_ci(r)
    assert "at_benchmark" not in validity_summary(r)["psr"]


# ---------- SV4: multiple testing ----------

def _registered(frame: pd.DataFrame) -> pd.DataFrame:
    return frame[frame["registered"].astype(str) == "True"]


def test_adjustments_equal_the_stored_registry(registry_frame: pd.DataFrame) -> None:
    out = registry_adjustments(registry_frame)
    reg = _registered(registry_frame)
    assert out["family_k"] == len(reg) == int(reg["family_k"].iloc[0])
    assert out["family_k_ok"] is True
    for col in ("bonferroni_p", "holm_p", "bh_q"):
        assert out["max_abs_diff"][col] <= TOL, col
        assert np.allclose(out["rows"][col].to_numpy(), reg[col].to_numpy(), rtol=0, atol=TOL)
    assert list(out["rows"]["name"]) == list(reg["name"])


def test_unregistered_rows_are_outside_the_family(registry_frame: pd.DataFrame) -> None:
    names = set(registry_adjustments(registry_frame)["rows"]["name"])
    assert "za_v0_C3_gao_momentum" not in names


def test_a_tampered_registry_value_is_detected(registry_frame: pd.DataFrame) -> None:
    """Born failing: one stored BH q shifted by 1e-9 must show up above the 1e-12 tolerance."""
    tampered = registry_frame.copy()
    row = tampered.index[tampered["name"] == "overnight_v0"][0]
    tampered.loc[row, "bh_q"] = tampered.loc[row, "bh_q"] + 1e-9
    assert registry_adjustments(tampered)["max_abs_diff"]["bh_q"] > TOL


def test_adjustments_agree_with_scipy_and_nq_lab(registry_frame: pd.DataFrame) -> None:
    p = _registered(registry_frame)["p"].to_numpy(dtype=float)
    assert np.allclose(benjamini_hochberg(p), sps.false_discovery_control(p, method="bh"), rtol=0, atol=TOL)
    assert np.allclose(benjamini_hochberg(p), nq_registry.bh(list(p)), rtol=0, atol=TOL)
    assert np.allclose(holm(p), nq_registry.holm(list(p)), rtol=0, atol=TOL)
    assert np.allclose(bonferroni(p), nq_registry.bonferroni(list(p)), rtol=0, atol=TOL)


def test_adjustments_pass_nan_through_and_do_not_count_it() -> None:
    p = np.array([0.01, np.nan, 0.04])
    assert np.isnan(bonferroni(p)[1]) and np.isnan(holm(p)[1]) and np.isnan(benjamini_hochberg(p)[1])
    assert bonferroni(p)[0] == pytest.approx(0.02) and holm(p)[2] == pytest.approx(0.04)
    assert benjamini_hochberg(p)[0] == pytest.approx(0.02) and benjamini_hochberg(p)[2] == pytest.approx(0.04)


def test_boundaries_by_hand() -> None:
    table = mt_boundaries([0.01, 0.04, 0.03, 0.005], alpha=0.05)
    assert list(table["p"]) == [0.005, 0.01, 0.03, 0.04]
    assert list(table["rank"]) == [1, 2, 3, 4]
    assert list(table["input_position"]) == [3, 0, 2, 1]
    assert table["bonferroni_line"].tolist() == pytest.approx([0.0125] * 4)
    assert table["holm_line"].tolist() == pytest.approx([0.0125, 0.05 / 3, 0.025, 0.05])
    assert table["bh_line"].tolist() == pytest.approx([0.0125, 0.025, 0.0375, 0.05])
    assert table["reject_bonferroni"].tolist() == [True, True, False, False]
    assert table["reject_holm"].tolist() == [True, True, False, False]
    assert table["reject_bh"].tolist() == [True, True, True, True]


def test_holm_stops_at_the_first_failure() -> None:
    # sorted 0.001, 0.03, 0.04 against lines 0.0167, 0.025, 0.05: 0.03 fails, so 0.04 is kept although
    # it sits below its own line
    table = mt_boundaries([0.04, 0.001, 0.03], alpha=0.05)
    assert table["reject_holm"].tolist() == [True, False, False]
    assert bool(table["p"].iloc[2] <= table["holm_line"].iloc[2])
    table = mt_boundaries([0.001, 0.03, 0.02], alpha=0.05)  # 0.001, 0.02, 0.03 all pass their lines
    assert table["reject_holm"].tolist() == [True, True, True]


def test_bh_step_up_rejects_below_the_largest_passing_rank() -> None:
    table = mt_boundaries([0.02, 0.03, 0.035], alpha=0.05)  # lines 0.0167, 0.0333, 0.05
    assert table["reject_bh"].tolist() == [True, True, True]


def test_boundaries_on_the_registry_reject_only_overnight(registry_frame: pd.DataFrame) -> None:
    reg = _registered(registry_frame).reset_index(drop=True)
    table = mt_boundaries(reg["p"].to_numpy(dtype=float), alpha=0.05)
    rejected = {reg["name"][i] for i in table.loc[table["reject_holm"], "input_position"]}
    assert rejected == {"overnight_v0"}
    assert set(reg["name"][table.loc[table["reject_bonferroni"], "input_position"]]) == {"overnight_v0"}


def test_boundaries_reject_a_bad_alpha() -> None:
    with pytest.raises(ValueError, match="alpha"):
        mt_boundaries([0.1], alpha=0.0)


# ---------- SV7: Sharpe difference tests, read from the screen JSON ----------

@pytest.mark.parametrize("name", ["volmanaged_v0", "tsmom_v0"])
def test_sharpe_difference_tests_are_the_stored_values(name: str) -> None:
    screen = _screen(name)
    out = sharpe_difference_tests(screen)
    assert set(out) == {"1tick", "2tick"}
    for cost, row in out.items():
        stored = screen["reported"]
        lw = stored["ledoit_wolf"][cost] if "ledoit_wolf" in stored else stored[cost]["ledoit_wolf"]
        mm = stored["memmel"][cost] if "memmel" in stored else stored[cost]["memmel"]
        assert row["ledoit_wolf"] == lw and row["memmel"] == mm
        assert row["sharpe_difference"] == screen["headline"][cost]["dsr"]
        assert row["label"] == SHARPE_DIFF_LABEL == "Sharpe difference (m - BH)"


def test_sharpe_difference_tests_are_empty_for_screens_without_them() -> None:
    assert sharpe_difference_tests(_screen("overnight_v0")) == {}
    assert sharpe_difference_tests({}) == {}
