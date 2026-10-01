"""The P2 bundle kinds are wired into the dump reader and the comparison, and the literals agree (TASKS Phase 12).

`crosscheck.dumps` cannot import the reference modules (they import `crosscheck.reference`, which imports `dumps`),
so it holds the input names as literals. These tests pin each literal to the reference module's own constant, and
each kind to a reference function, so the two cannot drift apart.
"""
from __future__ import annotations

import pytest

from crosscheck import compare, dumps
from crosscheck.p2_regimes_capacity_term import P2_RCT_INPUTS, P2_RCT_REFERENCES
from crosscheck.p2_risk_extras import P2_RISK_INPUTS, P2_RISK_REFERENCES
from crosscheck.p2_spa import P2_SPA_INPUTS, P2_SPA_REFERENCES

PAIRS = [(P2_SPA_INPUTS, P2_SPA_REFERENCES), (P2_RISK_INPUTS, P2_RISK_REFERENCES), (P2_RCT_INPUTS, P2_RCT_REFERENCES)]
KINDS = sorted(kind for inputs, _ in PAIRS for kind in inputs)


@pytest.mark.parametrize("kind", KINDS)
def test_each_p2_kind_is_read_and_compared(kind: str) -> None:
    assert kind in dumps.BUNDLE_INPUTS
    assert kind in compare.BUNDLE_REFERENCES


@pytest.mark.parametrize("inputs, references", PAIRS)
def test_the_literals_in_dumps_equal_the_reference_modules_constants(inputs: dict, references: dict) -> None:
    for kind, names in inputs.items():
        assert tuple(dumps.BUNDLE_INPUTS[kind]) == tuple(names), kind
        assert compare.BUNDLE_REFERENCES[kind] is references[kind], kind


def test_a_bundle_missing_an_input_is_refused_born_failing() -> None:
    doc = {"schema": dumps.SCHEMA, "kind": "spa", "case": "x", "source": "t", "inputs": {"names": []}, "values": {}}
    with pytest.raises(dumps.DumpError, match="lacks inputs"):
        dumps.parse_bundle(doc)


def test_the_report_prints_a_word_value_born_failing() -> None:
    from crosscheck import report
    from crosscheck.compare import PASS, Row

    row = Row("case", "superior", "ours", "none", "none", 0.0, PASS, "arch 8.0.0")
    text = " ".join(report.lines([row]))
    assert "value none" in text and "ref none" in text
