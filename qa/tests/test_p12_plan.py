"""Tests for the planner reference (research_ux.md item 2, SV9 server mirror): hand values, the structure the backend
serves, the grid, and the born-failing variants (a two-sided quantile, 365 periods a year, a Bonferroni bar for the
family size instead of the next slot). In memory only; the backend compares its served plan with this module."""
from __future__ import annotations

import copy
import math

import pytest
from scipy.stats import norm

from crosscheck.p12_plan import (ALPHAS, FAMILY_SIZES, GRID_NS, PERIODS, REFERENCE_SHARPE, TYPED_SHARPES, build_grid,
                                 first_difference, grid_inputs, reference_plan)

BASE = dict(periods=252, n=2520, alpha=0.05, k_registry=59, k_typed=80, sharpe=1.0, event_sd=14.8)


def test_the_periods_of_a_year_are_the_four_the_planner_takes():
    assert PERIODS == (252, 52, 12, 4)


def test_hand_values_of_the_bars_at_the_next_slot():
    slot = reference_plan(**BASE)["slots"][0]
    assert slot["k"] == 59 and slot["slot"] == 60
    assert slot["bonferroni"]["alpha"] == 0.05 / 60
    assert slot["bonferroni"]["z"] == pytest.approx(norm.isf(0.05 / 60), rel=1e-14)
    assert slot["holm_strictest"]["alpha"] == 0.05 / 60 and slot["holm_loosest"]["alpha"] == 0.05
    assert slot["holm_loosest"]["z"] == pytest.approx(1.6448536269514722, rel=1e-14)


def test_hand_values_of_the_design():
    nominal = reference_plan(**BASE)["nominal"]
    by_hand = (1.6448536269514722 + 0.8416212335729143) / math.sqrt(10.0)
    assert nominal["mde_sharpe"] == pytest.approx(by_hand, rel=1e-14)
    assert nominal["observations_for_reference"] == math.ceil(((1.6448536269514722 + 0.8416212335729143) / 0.5) ** 2 * 252)
    assert nominal["mean_per_event"] == pytest.approx((1.6448536269514722 + 0.8416212335729143) * 14.8 / math.sqrt(2520),
                                                      rel=1e-14)


def test_two_family_sizes_give_two_slots_and_one_when_they_agree():
    assert [s["source"] for s in reference_plan(**BASE)["slots"]] == ["registry", "typed"]
    assert [s["source"] for s in reference_plan(**{**BASE, "k_typed": 59})["slots"]] == ["registry"]
    assert [s["source"] for s in reference_plan(**{**BASE, "k_registry": None})["slots"]] == ["typed"]


def test_the_grid_covers_every_period_alpha_and_family_size():
    inputs = grid_inputs()
    assert {i["periods"] for i in inputs} == set(PERIODS)
    assert {i["alpha"] for i in inputs} == set(ALPHAS)
    assert {i["k_typed"] for i in inputs} >= set(FAMILY_SIZES)
    assert {i["n"] for i in inputs} == set(GRID_NS) and {i["sharpe"] for i in inputs} >= set(TYPED_SHARPES)
    assert REFERENCE_SHARPE == 0.5 and len(build_grid()) == len(inputs) > 200


def test_born_failing_a_two_sided_quantile_differs_from_the_reference():
    reference = reference_plan(**BASE)
    two_sided = copy.deepcopy(reference)
    z = norm.ppf(1 - 0.05 / 2) + norm.ppf(0.8)
    two_sided["nominal"]["mde_sharpe"] = z / math.sqrt(10.0)
    assert two_sided["nominal"]["mde_sharpe"] > reference["nominal"]["mde_sharpe"]
    assert first_difference(two_sided, reference) == "nominal.mde_sharpe"


def test_born_failing_365_periods_a_year_differs_from_the_reference():
    reference = reference_plan(**BASE)
    wrong = copy.deepcopy(reference)
    wrong["nominal"]["mde_sharpe"] = (norm.ppf(0.95) + norm.ppf(0.8)) / math.sqrt(2520 / 365)
    assert first_difference(wrong, reference) == "nominal.mde_sharpe"
    with pytest.raises(ValueError, match="periods"):
        reference_plan(**{**BASE, "periods": 365})


def test_born_failing_a_bar_for_the_family_size_instead_of_the_next_slot_differs():
    reference = reference_plan(**BASE)
    wrong = copy.deepcopy(reference)
    wrong["slots"][0]["bonferroni"]["alpha"] = 0.05 / 59
    assert first_difference(wrong, reference) == "slots[0].bonferroni.alpha"
    wrong = copy.deepcopy(reference)
    wrong["slots"][0]["at_slot"]["mde_sharpe"] = (norm.ppf(1 - 0.05 / 59) + norm.ppf(0.8)) / math.sqrt(10.0)
    assert first_difference(wrong, reference) == "slots[0].at_slot.mde_sharpe"


def test_first_difference_names_the_path_and_tolerates_last_bits():
    reference = reference_plan(**BASE)
    nudged = copy.deepcopy(reference)
    nudged["nominal"]["mde_sharpe"] *= 1 + 1e-14
    assert first_difference(nudged, reference) is None
    nudged["nominal"]["mde_sharpe"] *= 1 + 1e-9
    assert first_difference(nudged, reference) == "nominal.mde_sharpe"
    missing = copy.deepcopy(reference)
    del missing["slots"][1]
    assert first_difference(missing, reference) == "slots[1]"
    retyped = copy.deepcopy(reference)
    retyped["n"] = float(retyped["n"])
    assert first_difference(retyped, reference) == "n"
