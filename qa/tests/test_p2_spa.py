"""Tests for the SV8 reference (TASKS Phase 12; ANALYTICS_CATALOG SV8). In memory only; born-failing cases.

The dump format is the `spa` bundle the backend's `test_dump_for_qa_p2_spa.py` writes. The comparison goes through the
crosscheck's own row logic (`compare._rows_for`), so wiring `spa` into `dumps.BUNDLE_INPUTS` and
`compare.BUNDLE_REFERENCES` needs no other change.
"""
from __future__ import annotations

import numpy as np
import pytest

from crosscheck import compare
from crosscheck.compare import FAIL, INFO, PASS
from crosscheck.p2_spa import (
    BUNDLE_INPUTS,
    NONE,
    P2_SPA_INPUTS,
    P2_SPA_REFERENCES,
    spa_references,
    superior_word,
)

NAMES = ["a_v0", "b_v0", "c_v0", "d_v0"]


def inputs(seed: int = 7, reps: int = 400, edges=(0.6, 0.0, 0.0, 0.0), t: int = 300) -> dict:
    rng = np.random.default_rng(123)
    bench = rng.standard_normal(t)
    models = rng.standard_normal((t, len(NAMES))) + np.asarray(edges)
    return {"names": NAMES, "dates": [f"d{i}" for i in range(t)], "bench": bench.tolist(),
            "models": {n: models[:, j].tolist() for j, n in enumerate(NAMES)}, "reps": reps, "seed": seed,
            "size": 0.05}


def rows(refs: dict, ours: dict) -> list:
    return [row for key in ours for row in compare._rows_for("hand", key, refs[key], {"ours": ours}, {})]


def exact(refs: dict) -> dict:
    return {key: ref.value for key, ref in refs.items() if ref.kind != "documented"}


@pytest.fixture(scope="module")
def refs() -> dict:
    return spa_references(inputs())


def test_bundle_inputs_name_every_key_the_reference_reads():
    assert set(BUNDLE_INPUTS) == set(inputs()) and P2_SPA_INPUTS == {"spa": BUNDLE_INPUTS}
    assert P2_SPA_REFERENCES["spa"] is spa_references


def test_the_reference_passes_itself_and_orders_the_pvalues(refs):
    values = exact(refs)
    assert all(row.status == PASS for row in rows(refs, values))
    assert 0 <= values["p_lower"] <= values["p_consistent"] <= values["p_upper"] <= 1
    assert values["reality_check"] == values["p_upper"]
    assert values["superior"] == "a_v0" and values["k"] == 4.0 and values["t"] == 300.0


def test_the_statistic_is_the_largest_mean_differential(refs):
    means = refs["mean_differential"].value
    assert refs["statistic"].value == max(means.values()) and max(means, key=means.get) == "a_v0"


def test_the_note_on_studentisation_is_info_only(refs):
    [row] = compare._rows_for("hand", "statistic_note", refs["statistic_note"], {"ours": {}}, {})
    assert row.status == INFO and "not studentised" in row.ref


def test_born_failing_another_seed_is_caught(refs):
    other = spa_references(inputs(seed=8))
    moved = {k: other[k].value for k in ("crit_consistent", "crit_upper")}
    assert any(row.status == FAIL for row in rows(refs, moved))


def test_born_failing_returns_taken_as_losses_are_caught(refs):
    flipped = inputs()
    flipped["bench"] = [-v for v in flipped["bench"]]
    flipped["models"] = {n: [-v for v in col] for n, col in flipped["models"].items()}
    wrong = exact(spa_references(flipped))
    statuses = {row.metric: row.status for row in rows(refs, {k: wrong[k] for k in ("mean_differential", "superior")})}
    assert statuses == {"mean_differential": FAIL, "superior": FAIL}


def test_born_failing_an_empty_stepm_set_never_passes_a_rejection(refs):
    assert superior_word([]) == NONE
    [row] = rows(refs, {"superior": NONE})
    assert row.status == FAIL


def correlation_word(names, matrix) -> dict:
    return {f"{a}|{b}": matrix[i][j] for i, a in enumerate(names) for j, b in enumerate(names) if i <= j}


def test_the_correlation_reference_is_two_independent_recomputations_of_the_differentials(refs):
    from crosscheck.p2_spa import CORRELATION_KEYS

    assert CORRELATION_KEYS == ("correlation", "correlation_numpy")
    pandas_ref, numpy_ref = refs["correlation"], refs["correlation_numpy"]
    assert numpy_ref.against == "correlation" and pandas_ref.against == ""
    assert set(pandas_ref.value) == {f"{a}|{b}" for i, a in enumerate(NAMES) for b in NAMES[i:]}
    assert all(row.status == PASS for row in rows(refs, {"correlation": pandas_ref.value}))
    ours = {"ours": {"correlation": numpy_ref.value}}
    assert all(r.status == PASS for r in compare._rows_for("hand", "correlation_numpy", numpy_ref, ours, {}))
    assert pandas_ref.value["a_v0|a_v0"] == 1.0


def test_born_failing_the_correlation_of_returns_is_caught(refs):
    data = inputs()
    returns = np.corrcoef(np.column_stack([data["models"][n] for n in NAMES]), rowvar=False)
    wrong = correlation_word(NAMES, returns.tolist())
    [row] = rows(refs, {"correlation": wrong})
    assert row.status == FAIL


def test_born_failing_a_correlation_with_a_missing_pair_is_caught(refs):
    short = dict(refs["correlation"].value)
    short.pop("a_v0|b_v0")
    assert all(row.status == FAIL for row in rows(refs, {"correlation": short}))
