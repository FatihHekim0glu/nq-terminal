"""The W3 dump kinds are wired into the dump reader and the comparison: `registry_completeness`, `p12plan` and
`p12power` (wave w3-research-integrity).

Each kind is read, compared and judged end to end (`parse_any` then `compare_any`), with a born-failing case that feeds
the broken state to the same path: a plan served with a Bonferroni bar for the family size instead of the next slot, a
power table built on a two-sided quantile, a registered row nobody covers.
"""
from __future__ import annotations

import copy

import pytest
from scipy.stats import norm

from crosscheck import compare, dumps
from crosscheck.compare import FAIL, PASS, SKIP, exit_code
from crosscheck.p12_plan import PERIODS, flatten_plans, grid_inputs, reference_plan
from crosscheck.p12_power import mde, power_at
from crosscheck.p12_sv9 import P12_SV9_REFERENCES, PLAN_KEYS, POWER_KEYS

DESIGNS = [{**d, "k_registry": 2} for d in grid_inputs()[::97]]
BOOKS = [(2520, 252), (120, 12), (787, 252), (40, 4)]
ALPHA, K = 0.05, 21


def doc_for(kind: str, case: str, inputs: dict, ours: dict) -> dict:
    return {"schema": dumps.SCHEMA, "kind": kind, "case": case, "source": "test", "inputs": inputs,
            "values": {"ours": ours}, "missing": {}}


def plan_doc(plans: list[dict] | None = None) -> dict:
    plans = plans if plans is not None else [reference_plan(**d) for d in DESIGNS]
    return doc_for("p12plan", "plans", {"designs": DESIGNS}, flatten_plans(plans))


def power_doc(figures: dict | None = None) -> dict:
    rows = [{"periods": p, "n": n} for n, p in BOOKS]
    family = ALPHA / K
    ours = figures or {
        "power.mde_nominal": [mde(n, p, ALPHA, 0.8) for n, p in BOOKS],
        "power.mde_family": [mde(n, p, family, 0.8) for n, p in BOOKS],
        "power.power_nominal": [power_at(0.5, n, p, ALPHA) for n, p in BOOKS],
        "power.power_family": [power_at(0.5, n, p, family) for n, p in BOOKS],
    }
    return doc_for("p12power", "power", {"rows": rows, "alpha": ALPHA, "k": K}, ours)


def statuses(doc: dict) -> list[str]:
    return [row.status for row in compare.compare_any(dumps.parse_any(doc))]


@pytest.mark.parametrize("kind", ["registry_completeness", "p12plan", "p12power"])
def test_each_w3_kind_is_read_and_compared(kind: str) -> None:
    assert kind in dumps.BUNDLE_INPUTS and kind in compare.BUNDLE_REFERENCES


def test_the_literals_in_dumps_equal_the_reference_keys() -> None:
    assert dumps.BUNDLE_INPUTS["p12plan"] == ("designs",)
    assert dumps.BUNDLE_INPUTS["p12power"] == ("rows", "alpha", "k")
    assert compare.BUNDLE_REFERENCES["p12plan"] is P12_SV9_REFERENCES["p12plan"]
    assert compare.BUNDLE_REFERENCES["p12power"] is P12_SV9_REFERENCES["p12power"]


def test_a_plan_served_as_the_reference_builds_it_passes_on_every_key() -> None:
    rows = compare.compare_any(dumps.parse_any(plan_doc()))
    assert {row.metric for row in rows} == set(PLAN_KEYS)
    assert [row.status for row in rows] == [PASS, PASS] and exit_code(rows, strict=True) == 0


def test_born_failing_a_bonferroni_bar_for_the_family_size_not_the_next_slot_fails() -> None:
    plans = [reference_plan(**d) for d in DESIGNS]
    for plan in plans:
        for slot in plan["slots"]:
            slot["bonferroni"] = {"alpha": plan["alpha"] / slot["k"] if slot["k"] else plan["alpha"],
                                  "z": float(norm.isf(plan["alpha"] / max(slot["k"], 1)))}
    assert FAIL in statuses(plan_doc(plans))


def test_born_failing_a_slot_dropped_from_a_served_plan_changes_the_length_and_fails() -> None:
    plans = [reference_plan(**d) for d in DESIGNS]
    typed = next(p for p in plans if len(p["slots"]) == 2)
    typed["slots"] = typed["slots"][:1]
    assert FAIL in statuses(plan_doc(plans))


def test_born_failing_a_365_period_book_in_the_designs_is_refused_by_the_reference() -> None:
    bad = copy.deepcopy(plan_doc())
    bad["inputs"]["designs"][0]["periods"] = 365
    assert 365 not in PERIODS
    with pytest.raises(ValueError):
        compare.compare_any(dumps.parse_any(bad))


def test_a_power_table_served_as_the_reference_builds_it_passes_on_every_key() -> None:
    rows = compare.compare_any(dumps.parse_any(power_doc()))
    assert {row.metric for row in rows} == set(POWER_KEYS) and {row.status for row in rows} == {PASS}


def test_born_failing_a_two_sided_quantile_in_the_power_table_fails() -> None:
    doc = power_doc()
    doc["values"]["ours"]["power.mde_nominal"] = [
        float((norm.isf(ALPHA / 2) + norm.ppf(0.8)) / (n / p) ** 0.5) for n, p in BOOKS]
    statuses_by_key = {row.metric: row.status for row in compare.compare_any(dumps.parse_any(doc))}
    assert statuses_by_key["power.mde_nominal"] == FAIL and statuses_by_key["power.mde_family"] == PASS


def test_a_power_table_with_a_figure_missing_is_a_skip_which_strict_fails() -> None:
    doc = power_doc()
    del doc["values"]["ours"]["power.power_family"]
    rows = compare.compare_any(dumps.parse_any(doc))
    assert SKIP in [row.status for row in rows] and exit_code(rows, strict=True) == 1 and exit_code(rows) == 0


def completeness_doc(learned: list[str], not_learnable: dict) -> dict:
    return doc_for("registry_completeness", "completeness",
                   {"registered": ["a_v0", "b_v0", "c_v0"], "learned": learned, "not_learnable": not_learnable}, {})


def test_the_completeness_dump_is_judged_from_its_own_lists_whatever_the_terminal_says() -> None:
    rows = compare.compare_any(dumps.parse_any(completeness_doc(["a_v0", "b_v0"], {"c_v0": "a weekly book"})))
    assert [row.status for row in rows] == [PASS, PASS, PASS] and exit_code(rows, strict=True) == 0


def test_born_failing_a_registered_row_nobody_covers_fails_the_dump() -> None:
    rows = compare.compare_any(dumps.parse_any(completeness_doc(["a_v0"], {"c_v0": "a weekly book"})))
    assert [row.status for row in rows] == [PASS, FAIL, PASS] and exit_code(rows) == 1
