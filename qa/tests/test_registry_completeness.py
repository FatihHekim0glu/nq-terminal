"""The registry completeness reference (`crosscheck.reference`): every registered row is learned or NOT_LEARNABLE.

A fixture registry written here (made-up names, no research data) stands in for the lab's `results/registry.csv`; the
learned names and the NOT_LEARNABLE reasons stand in for what the backend's `registry_completeness` dump carries. The
verdicts go through `compare.judge` and `compare._row`, as the cross-check judges them, so a registered row that is
neither learned nor listed is a FAIL, and under `--strict` a row with no value at all fails too.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from crosscheck.compare import FAIL, PASS, SKIP, _row, _rows_for, exit_code
from crosscheck.reference import (
    COVERED,
    registered_names,
    registry_completeness_references,
    registry_completeness_values,
)

REASON = "outside convention C2 (P = 252 or 12, docs/ANALYTICS_CATALOG.md:16); needs a statistics decision (O23)"
SAMPLE = Path(__file__).resolve().parent / "data" / "registry_sample.csv"  # five rows, four registered


@pytest.fixture
def registry() -> Path:
    return SAMPLE


def inputs_for(registry: Path, learned: list[str], not_learnable: dict[str, str]) -> dict:
    return {"registered": list(registered_names(registry)), "learned": learned, "not_learnable": not_learnable}


def verdicts(inputs: dict) -> dict[str, str]:
    """The status the cross-check gives each reference, with the values recomputed from the dumped lists."""
    values = {"ours": registry_completeness_values(inputs)}
    rows = [row for key, ref in registry_completeness_references(inputs).items()
            for row in _rows_for("registry_completeness", key, ref, values, {})]
    return {row.metric: row.status for row in rows}


def test_registered_names_are_the_rows_marked_registered_in_file_order(registry):
    assert registered_names(registry) == ("aa_v0", "bb_v0", "dd_v0", "ee_v0")


def test_every_registered_row_learned_or_listed_passes(registry):
    found = verdicts(inputs_for(registry, ["aa_v0", "bb_v0", "ee_v0"], {"dd_v0": REASON}))
    assert found == {f"coverage.{n}": PASS for n in ("aa_v0", "bb_v0", "dd_v0", "ee_v0")}


def test_born_failing_a_registered_fixture_row_neither_learned_nor_listed_fails(registry):
    found = verdicts(inputs_for(registry, ["aa_v0", "bb_v0"], {"dd_v0": REASON}))
    assert found["coverage.ee_v0"] == FAIL
    assert [k for k, v in found.items() if v != PASS] == ["coverage.ee_v0"]


def test_born_failing_a_row_both_learned_and_listed_fails(registry):
    found = verdicts(inputs_for(registry, ["aa_v0", "bb_v0", "dd_v0", "ee_v0"], {"dd_v0": REASON}))
    assert found["coverage.dd_v0"] == FAIL


def test_born_failing_a_listed_row_without_a_reason_fails(registry):
    found = verdicts(inputs_for(registry, ["aa_v0", "bb_v0", "ee_v0"], {"dd_v0": " "}))
    assert found["coverage.dd_v0"] == FAIL


def test_an_unregistered_row_needs_nothing_and_extra_learned_names_are_ignored(registry):
    found = verdicts(inputs_for(registry, ["aa_v0", "bb_v0", "ee_v0", "zz_v0"], {"dd_v0": REASON}))
    assert "coverage.cc_v0" not in found and set(found.values()) == {PASS}


def test_one_reference_per_registered_row_so_none_can_vanish(registry):
    inputs = inputs_for(registry, [], {})
    refs = registry_completeness_references(inputs)
    assert list(refs) == [f"coverage.{n}" for n in inputs["registered"]]
    assert {ref.value for ref in refs.values()} == {COVERED}


def test_under_strict_a_row_with_no_value_fails_the_run(registry):
    inputs = inputs_for(registry, ["aa_v0", "bb_v0", "ee_v0"], {"dd_v0": REASON})
    rows = [row for key, ref in registry_completeness_references(inputs).items()
            for row in _rows_for("registry_completeness", key, ref, {"ours": {}}, {})]
    assert {row.status for row in rows} == {SKIP}
    assert exit_code(rows, strict=False) == 0 and exit_code(rows, strict=True) == 1


def test_a_word_is_judged_exactly():
    ref = registry_completeness_references({"registered": ["aa_v0"]})["coverage.aa_v0"]
    assert _row("c", "coverage.aa_v0", "ours", COVERED, ref).status == PASS
    assert _row("c", "coverage.aa_v0", "ours", COVERED.upper(), ref).status == FAIL
