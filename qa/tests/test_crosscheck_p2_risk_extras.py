"""Tests for the P2 risk extras cross-check reference (TASKS Phase 12; RK4, PF11, BR5). In memory only; hand values,
the PerformanceAnalytics case and born-failing cases."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from crosscheck.compare import FAIL, INFO, PASS, SKIP, _rows_for, judge
from crosscheck.p2_risk_extras import (
    P2_RISK_INPUTS,
    edgeworth_density_nonnegative,
    edgeworth_mean_closed,
    edgeworth_mean_quad,
    expansion,
    in_domain,
    p2risk_references,
    underwater_walk,
)

PA_CASE = [v / 1000 for v in (10, -10, 5, -5, 0, 2, -2, 60, -55, 3, -3, 1, 4, -4, 6, -6)]
PA_MES = {"95": 0.040574792447599579352, "99": 0.088666361185136973576}  # 50-digit decimals, exact moments
TOL = 1e-9


def inputs(r, bench=None, basis="B", periods=252, on_capital=True) -> dict:
    dates = [str(d.date()) for d in pd.bdate_range("2014-01-02", periods=len(r))]
    return {"dates": dates, "r": list(r), "bench": None if bench is None else list(bench), "basis": basis,
            "periods": periods, "on_capital": on_capital}


def pair(n=900, seed=4) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    b = 0.0004 + 0.011 * rng.standard_normal(n)
    return 0.0002 + 0.45 * b + 0.006 * rng.standard_t(10, n), b


def value(refs: dict, key: str):
    return refs[key].value


def test_the_bundle_kind_is_declared():
    assert P2_RISK_INPUTS["p2risk"] == ("dates", "r", "bench", "basis", "periods", "on_capital")


def test_performance_analytics_case_99():
    refs = p2risk_references(inputs(PA_CASE))
    assert value(refs, "rk4.99.value") == pytest.approx(PA_MES["99"], rel=1e-12)
    assert value(refs, "rk4.99.in_domain") == 1.0 and value(refs, "rk4.99.floored") == 0.0
    assert "rk4.99.pa_density" not in refs


def test_performance_analytics_case_95_is_refused_by_the_density_rule_and_listed_as_info():
    refs = p2risk_references(inputs(PA_CASE))
    assert value(refs, "rk4.95.raw_expansion") == pytest.approx(PA_MES["95"], rel=1e-12)
    assert value(refs, "rk4.95.in_domain") == 0.0 and value(refs, "rk4.95.modified") is None
    r = np.array(PA_CASE)
    cut = float(np.quantile(r, 0.05))
    assert value(refs, "rk4.95.value") == pytest.approx(-r[r <= cut].mean(), rel=1e-12)
    info = refs["rk4.95.pa_density"]
    assert info.kind == "documented" and info.against == "rk4.95.value"
    assert info.value == pytest.approx(PA_MES["95"], rel=1e-12)


@pytest.mark.parametrize(("skew", "exkurt", "expected"),
                         [(0.0, 6.0, False), (-1.0, 6.0, False), (0.0, 3.0, True), (0.0, 0.0, True)])
def test_the_grid_density_rule_at_the_issue_cases(skew, exkurt, expected):
    h = float(expansion(-1.6448536269514729, skew, exkurt))
    assert edgeworth_density_nonnegative(h, skew, exkurt) is expected


def test_the_density_rule_leaves_the_one_percent_tail_at_k6_inside():
    h = float(expansion(-2.3263478740408408, 0.0, 6.0))
    assert edgeworth_density_nonnegative(h, 0.0, 6.0) is True


@pytest.mark.parametrize(("skew", "exkurt"), [(0.0, 0.0), (0.25, 1.5), (-0.5, 3.0), (0.5, 7.0)])
def test_closed_form_and_integral_agree(skew, exkurt):
    for tail in (0.05, 0.01):
        h = float(expansion(-1.6448536269514729 if tail == 0.05 else -2.3263478740408408, skew, exkurt))
        assert edgeworth_mean_closed(h, skew, exkurt, tail) == pytest.approx(
            edgeworth_mean_quad(h, skew, exkurt, tail), rel=1e-10)


def test_the_grid_domain_at_zero_skew_is_zero_to_eight():
    assert in_domain(0.0, 0.0) and in_domain(0.0, 7.9) and not in_domain(0.0, 8.2) and not in_domain(0.0, -0.5)


def test_outside_the_domain_the_value_is_the_historical_cvar():
    rng = np.random.default_rng(11)
    r = 0.0004 + 0.01 * rng.standard_t(3, 3000)
    refs = p2risk_references(inputs(r))
    assert value(refs, "rk4.95.in_domain") == 0.0 and value(refs, "rk4.95.modified") is None
    cut = np.quantile(r, 0.05)
    assert value(refs, "rk4.95.value") == pytest.approx(-r[r <= cut].mean(), rel=1e-12)


def test_underwater_walk_by_hand():
    assert underwater_walk([0.1, -0.05, -0.05, 0.02, 0.1], "A") == pytest.approx([0, -0.05, -0.10, -0.08, 0])
    assert underwater_walk([-0.1, 0.05, 0.1], "B") == pytest.approx([-0.1, -0.055, 0.0])


def test_ulcer_and_recovery_by_hand_and_quantstats_agree_on_a_compounded_series():
    r, _ = pair()
    r[0] = -0.02  # a loss on the first session: the baseline matters
    refs = p2risk_references(inputs(r))
    walk = underwater_walk(r, "B")
    assert value(refs, "pf11.ulcer_index") == pytest.approx(math.sqrt(np.mean(np.square(walk))), rel=1e-12)
    ok = judge(value(refs, "pf11.ulcer_index_quantstats"), value(refs, "pf11.ulcer_index"), TOL)[1]
    assert ok and refs["pf11.ulcer_index_quantstats_raw"].kind == "documented"
    total = float(np.prod(1 + r) - 1)
    assert value(refs, "pf11.recovery_factor") == pytest.approx(total / abs(min(walk)), rel=1e-12)


def test_a_summed_series_has_no_quantstats_exact_reference():
    r, _ = pair()
    refs = p2risk_references(inputs(r * 1e4, basis="A", on_capital=False))
    assert "pf11.ulcer_index_quantstats" not in refs and "br5.treynor" not in refs


def test_treynor_is_cagr_over_the_ols_slope():
    r, b = pair()
    refs = p2risk_references(inputs(r, b))
    slope = np.polyfit(b, r, 1)[0]
    cagr = float(np.prod(1 + r)) ** (252 / len(r)) - 1
    assert value(refs, "br5.beta") == pytest.approx(slope, rel=1e-10)
    assert value(refs, "br5.treynor") == pytest.approx(cagr / slope, rel=1e-10)


def test_basis_a_treynor_uses_the_summed_growth():
    r, b = pair()
    refs = p2risk_references(inputs(r, b, basis="A"))
    cagr = (1 + r.sum()) ** (252 / len(r)) - 1
    assert value(refs, "br5.cagr") == pytest.approx(cagr, rel=1e-12)


def test_rows_pass_on_matching_values_and_skip_a_missing_one():
    r, b = pair()
    refs = p2risk_references(inputs(r, b))
    values = {"ours": {k: ref.value for k, ref in refs.items() if ref.kind != "documented" and not ref.against}}
    rows = [row for key, ref in refs.items() for row in _rows_for("case", key, ref, values, {})]
    assert {row.status for row in rows} <= {PASS, INFO}
    missing = _rows_for("case", "br5.treynor", refs["br5.treynor"], {"ours": {}}, {})
    assert [row.status for row in missing] == [SKIP]


def test_born_failing_wrong_divisor_no_floor_or_compounded_basis_a_fail():
    r, b = pair()
    refs = p2risk_references(inputs(r, b))
    walk = np.array(underwater_walk(r, "B"))
    n_minus_one = math.sqrt(np.sum(walk ** 2) / (len(walk) - 1))
    assert not judge(n_minus_one, value(refs, "pf11.ulcer_index"), TOL)[1]
    h = float(expansion(-1.6448536269514729, 0.5, 7.0))
    unfloored = -edgeworth_mean_closed(h, 0.5, 7.0, 0.05)
    assert not judge(unfloored, -min(edgeworth_mean_closed(h, 0.5, 7.0, 0.05), h), TOL)[1]
    compounded = (float(np.prod(1 + r)) ** (252 / len(r)) - 1) / value(refs, "br5.beta")
    refs_a = p2risk_references(inputs(r, b, basis="A"))
    status = PASS if judge(compounded, value(refs_a, "br5.treynor"), TOL)[1] else FAIL
    assert status == FAIL
