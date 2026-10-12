"""The power maths of SV9 and the planner (ANALYTICS_CATALOG SV9; research_ux.md item 2): `analytics/power.py`, pure
functions that mirror the browser reference `web/src/quant/normal.ts` and `power.ts`.

Pinned to `qa/golden/p12_power.json` (scipy.stats.norm, written by `qa/crosscheck/p12_power.py`) at 1e-12 relative, the
tolerance the browser reference met. The born-failing cases feed each guard the broken state: a two-sided quantile, 365
periods a year, and a Bonferroni bar for the family size instead of the next slot.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from nq_terminal.analytics import power

GOLDEN = Path(__file__).resolve().parents[2] / "qa" / "golden" / "p12_power.json"
REL = 1e-12
BONFERRONI = 0.05 / 21


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def close(got: float, want: float, rel: float = REL, abs_tol: float = 1e-300) -> bool:
    return math.isclose(got, want, rel_tol=rel, abs_tol=abs_tol)


# ---------------------------------------------------------------- the normal distribution against scipy


def test_the_cdf_equals_the_golden_vectors(golden):
    assert golden["cdf"]
    for case in golden["cdf"]:
        assert close(power.normal_cdf(case["x"]), case["value"]), case


def test_the_quantile_equals_the_golden_vectors(golden):
    assert golden["quantile"]
    for case in golden["quantile"]:
        assert close(power.normal_quantile(case["p"]), case["value"]), case


def test_the_normal_edges():
    assert math.isnan(power.normal_cdf(math.nan)) and math.isnan(power.normal_quantile(math.nan))
    assert power.normal_cdf(-math.inf) == 0.0 and power.normal_cdf(math.inf) == 1.0
    assert power.normal_quantile(0.0) == -math.inf and power.normal_quantile(1.0) == math.inf
    assert math.isnan(power.normal_quantile(-0.1)) and math.isnan(power.normal_quantile(1.1))
    assert power.normal_cdf(0.0) == 0.5 and power.normal_quantile(0.5) == 0.0


# ---------------------------------------------------------------- MDE and power against scipy


def test_mde_and_power_equal_the_golden_vectors(golden):
    assert len(golden["mde"]) == 96 and len(golden["power"]) == 192
    for case in golden["mde"]:
        got = power.minimum_detectable_sharpe(case["n"], case["periods"], case["alpha"], case["power"])
        assert close(got, case["value"]), case
    for case in golden["power"]:
        got = power.power_at_sharpe(case["sharpe"], case["n"], case["periods"], case["alpha"])
        assert close(got, case["value"], abs_tol=1e-15), case


def test_the_anchors_of_the_catalogue():
    assert round(power.minimum_detectable_sharpe(2836, 252, 0.05, 0.8), 4) == 0.7412
    assert round(power.minimum_detectable_sharpe(2836, 252, BONFERRONI, 0.8), 4) == 1.0923
    assert round(power.minimum_detectable_sharpe(2686, 252, 0.05, 0.8), 4) == 0.7616
    assert round(power.track_years(2686, 252), 2) == 10.66


def test_the_test_is_one_sided():
    # z(0.95), not z(0.975): a two-sided quantile would give 1.96 and a larger MDE
    assert close(power.critical_value(0.05), 1.6448536269514722)
    assert power.critical_value(0.05) < 1.9
    by_hand = (1.6448536269514722 + 0.8416212335729143) / math.sqrt(2836 / 252)
    assert close(power.minimum_detectable_sharpe(2836, 252, 0.05, 0.8), by_hand, 1e-14)


def test_a_tiny_alpha_keeps_its_digits():
    assert close(power.critical_value(1e-20), 9.262340089798408)


def test_power_is_alpha_at_zero_sharpe_and_inverts_the_mde():
    for n, periods in ((2836, 252), (120, 12), (2, 252)):
        assert close(power.power_at_sharpe(0.0, n, periods, 0.05), 0.05)
        mde = power.minimum_detectable_sharpe(n, periods, BONFERRONI, 0.8)
        assert close(power.power_at_sharpe(mde, n, periods, BONFERRONI), 0.8)


def test_unusable_inputs_give_nan_never_a_number():
    mde = power.minimum_detectable_sharpe
    assert math.isnan(mde(1, 252, 0.05, 0.8)) and math.isnan(mde(0, 252, 0.05, 0.8))
    assert math.isnan(mde(100, 0, 0.05, 0.8)) and math.isnan(mde(100, -12, 0.05, 0.8))
    assert math.isnan(mde(100, 252, 0.0, 0.8)) and math.isnan(mde(100, 252, 1.0, 0.8))
    assert math.isnan(mde(100, 252, 0.05, 0.0)) and math.isnan(mde(100, 252, 0.05, 1.0))
    assert math.isnan(mde(math.nan, 252, 0.05, 0.8)) and math.isnan(mde(math.inf, 252, 0.05, 0.8))
    assert math.isnan(power.power_at_sharpe(math.nan, 100, 252, 0.05))
    assert math.isnan(power.power_at_sharpe(0.5, 1, 252, 0.05))
    assert math.isnan(power.track_years(-1, 252)) and math.isnan(power.track_years(10, 0))


# ---------------------------------------------------------------- n needed and the mean per event


def test_the_years_needed_invert_the_mde():
    years = power.years_needed(0.5, 0.05, 0.8)
    assert close(years, ((1.6448536269514722 + 0.8416212335729143) / 0.5) ** 2, 1e-14)
    n = power.observations_needed(0.5, 252, 0.05, 0.8)
    assert n == math.ceil(years * 252)
    assert power.power_at_sharpe(0.5, n, 252, 0.05) >= 0.8 > power.power_at_sharpe(0.5, n - 1, 252, 0.05)


def test_no_n_reaches_a_sharpe_of_zero_or_less():
    assert math.isnan(power.years_needed(0.0, 0.05, 0.8)) and math.isnan(power.years_needed(-0.5, 0.05, 0.8))
    assert power.observations_needed(0.0, 252, 0.05, 0.8) is None
    assert power.observations_needed(math.nan, 252, 0.05, 0.8) is None


def test_the_detectable_mean_per_event():
    # gotobi6j_v0: event sd 14.8 bp over 787 events (lab notes, round 17): one-sided, 80% power
    mean = power.detectable_mean(14.8, 787, 0.05, 0.8)
    assert close(mean, (1.6448536269514722 + 0.8416212335729143) * 14.8 / math.sqrt(787), 1e-14)
    assert 1.2 < mean < 1.4
    assert power.detectable_mean(14.8, 787, 0.05 / 81, 0.8) > 2.0  # the Bonferroni bar at the next slot of a family of 80
    assert math.isnan(power.detectable_mean(0.0, 787, 0.05, 0.8)) and math.isnan(power.detectable_mean(14.8, 1, 0.05, 0.8))


# ---------------------------------------------------------------- the planner


def plan(**over) -> dict:
    inputs = dict(periods=252, n=2520, alpha=0.05, k_registry=59, k_typed=None, sharpe=None, event_sd=None)
    return power.plan(**{**inputs, **over})


def test_the_bars_are_at_the_next_slot_of_the_family():
    slot = plan()["slots"][0]
    assert slot["source"] == "registry" and slot["k"] == 59 and slot["slot"] == 60
    assert slot["bonferroni"]["alpha"] == 0.05 / 60
    assert slot["holm_strictest"]["alpha"] == 0.05 / 60 and slot["holm_loosest"]["alpha"] == 0.05
    assert close(slot["bonferroni"]["z"], -power.normal_quantile(0.05 / 60))


def test_born_failing_a_bar_for_the_family_size_instead_of_the_next_slot_is_not_the_served_bar():
    slot = plan()["slots"][0]
    assert slot["bonferroni"]["alpha"] != 0.05 / 59
    assert slot["at_slot"]["mde_sharpe"] > power.minimum_detectable_sharpe(2520, 252, 0.05 / 59, 0.8)
    assert slot["at_slot"]["mde_sharpe"] == power.minimum_detectable_sharpe(2520, 252, 0.05 / 60, 0.8)


def test_the_registry_and_a_typed_family_size_are_shown_together():
    slots = plan(k_typed=80)["slots"]
    assert [(s["source"], s["k"], s["slot"]) for s in slots] == [("registry", 59, 60), ("typed", 80, 81)]
    assert slots[1]["bonferroni"]["alpha"] == 0.05 / 81
    assert slots[1]["at_slot"]["mde_sharpe"] > slots[0]["at_slot"]["mde_sharpe"]


def test_a_typed_family_size_alone_and_the_registry_alone():
    assert [s["source"] for s in plan(k_registry=None, k_typed=80)["slots"]] == ["typed"]
    assert [s["source"] for s in plan(k_typed=None)["slots"]] == ["registry"]
    assert [s["source"] for s in plan(k_typed=59)["slots"]] == ["registry"]  # the same size is shown once
    with pytest.raises(ValueError, match="family size"):
        plan(k_registry=None, k_typed=None)


def test_the_first_test_of_a_family_has_no_correction():
    slot = plan(k_registry=None, k_typed=0)["slots"][0]
    assert slot["slot"] == 1 and slot["bonferroni"]["alpha"] == 0.05


def test_the_nominal_figures_do_not_depend_on_the_family():
    view = plan(k_typed=80, sharpe=1.0)
    nominal = view["nominal"]
    assert close(nominal["mde_sharpe"], power.minimum_detectable_sharpe(2520, 252, 0.05, 0.8), 1e-14)
    assert close(nominal["power_at_reference"], power.power_at_sharpe(0.5, 2520, 252, 0.05), 1e-14)
    assert close(nominal["power_at_typed"], power.power_at_sharpe(1.0, 2520, 252, 0.05), 1e-14)
    assert nominal["observations_for_reference"] == power.observations_needed(0.5, 252, 0.05, 0.8)
    assert nominal["observations_for_typed"] == power.observations_needed(1.0, 252, 0.05, 0.8)


def test_the_years_or_the_observations_describe_the_same_book():
    assert plan(n=2520, periods=252)["years"] == 10.0 and plan(n=120, periods=12)["years"] == 10.0
    assert plan(n=40, periods=4)["years"] == 10.0 and plan(n=520, periods=52)["years"] == 10.0


def test_the_typed_sharpe_and_the_event_sd_are_optional():
    bare = plan()
    assert bare["typed_sharpe"] is None and bare["event_sd"] is None
    assert bare["nominal"]["power_at_typed"] is None and bare["nominal"]["observations_for_typed"] is None
    assert bare["nominal"]["mean_per_event"] is None and bare["slots"][0]["at_slot"]["mean_per_event"] is None
    full = plan(sharpe=0.8, event_sd=14.8, n=787)
    assert full["nominal"]["mean_per_event"] == power.detectable_mean(14.8, 787, 0.05, 0.8)
    assert full["slots"][0]["at_slot"]["mean_per_event"] == power.detectable_mean(14.8, 787, 0.05 / 60, 0.8)


def test_born_failing_365_periods_a_year_is_refused():
    with pytest.raises(ValueError, match="periods"):
        plan(periods=365)
    for bad in (0, 1, 251, 253, 360, 366, -252):
        with pytest.raises(ValueError, match="periods"):
            plan(periods=bad)
    for good in (252, 52, 12, 4):
        assert plan(periods=good, n=100)["periods"] == good


def test_the_planner_refuses_inputs_the_maths_cannot_use():
    for bad in ({"n": 1}, {"n": 0}, {"alpha": 0.0}, {"alpha": 1.0}, {"alpha": math.nan}, {"k_registry": -1},
                {"k_typed": -1}, {"sharpe": math.nan}, {"event_sd": 0.0}, {"event_sd": -1.0}, {"event_sd": math.inf}):
        with pytest.raises(ValueError):
            plan(**bad)


def test_the_planner_wording_is_the_best_case_of_sv9():
    note = plan()["note"].lower()
    assert "best case" in note and "normal" in note and "independent" in note and "one-sided" in note
    assert "365" not in note


# ---------------------------------------------------------------- the served table of SV9


def rows_for(pairs):
    return [{"name": f"t{i}", "kind": "daily", "periods": p, "n": n, "annual_sharpe": 0.5 + i / 100}
            for i, (n, p) in enumerate(pairs)]


def test_the_table_equals_the_golden_for_every_real_and_edge_book(golden):
    pairs = [(c["n"], c["periods"]) for c in golden["mde"] if c["alpha"] == 0.05 and c["power"] == 0.8]
    assert len(pairs) == 24
    table = power.power_table(rows_for(pairs), alpha=0.05, k=21)
    assert table["alpha_family"] == 0.05 / 21 and len(table["rows"]) == 24
    mde = {(c["n"], c["periods"], c["alpha"]): c["value"] for c in golden["mde"] if c["power"] == 0.8}
    pwr = {(c["n"], c["periods"], c["alpha"]): c["value"] for c in golden["power"] if c["sharpe"] == 0.5}
    for row, (n, periods) in zip(table["rows"], pairs):
        assert close(row["mde_nominal"], mde[(n, periods, 0.05)]) and close(row["mde_family"], mde[(n, periods, 0.05 / 21)])
        assert close(row["power_nominal"], pwr[(n, periods, 0.05)]) and close(row["power_family"], pwr[(n, periods, 0.05 / 21)])
        assert close(row["years"], n / periods, 1e-15)


def test_the_table_row_for_volmanaged_v0_reads_as_the_catalogue_says():
    table = power.power_table([{"name": "volmanaged_v0", "kind": "daily", "periods": 252, "n": 2686,
                                "annual_sharpe": 0.99}], alpha=0.05, k=21)
    row = table["rows"][0]
    cells = ("years", "mde_nominal", "mde_family", "ratio", "power_nominal", "power_family")
    assert [round(row[cell], 2) for cell in cells] == [10.66, 0.76, 1.12, 0.88, 0.5, 0.12]


def test_the_table_leaves_a_missing_figure_null():
    rows = [{"name": "a", "kind": "daily", "periods": 252, "n": 1, "annual_sharpe": None},
            {"name": "b", "kind": "daily", "periods": 252, "n": 500, "annual_sharpe": None}]
    first, second = power.power_table(rows, alpha=0.05, k=21)["rows"]
    assert all(first[k] is None for k in ("mde_nominal", "mde_family", "ratio", "power_nominal", "power_family"))
    assert second["sharpe"] is None and second["ratio"] is None and second["mde_family"] is not None


def test_the_table_has_no_family_alpha_without_a_usable_k():
    table = power.power_table(rows_for([(500, 252)]), alpha=0.05, k=0)
    assert table["alpha_family"] is None and table["rows"][0]["mde_family"] is None
    assert table["rows"][0]["mde_nominal"] is not None


def test_the_table_is_tagged_post_hoc_basis_a_with_the_fixed_constants():
    table = power.power_table(rows_for([(500, 252)]), alpha=0.05, k=21)
    assert table["tag"] == "[POST HOC]" and table["basis"] == "A"
    assert table["power_target"] == 0.8 and table["reference_sharpe"] == 0.5
    assert "best case" in table["note"].lower() and "365" not in table["note"]
