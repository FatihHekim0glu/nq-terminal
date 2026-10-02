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


# ---------------------------------------------------------------- the effective number of members (SV8 step 8)


EFFECTIVE_KEYS = ("effective_participation", "effective_li_ji", "effective_clusters", "effective_pair",
                  "effective_rho")


def correlated_inputs() -> dict:
    """Four members whose differentials (against a zero benchmark: their own returns) form two blocks."""
    rng = np.random.default_rng(31)
    t = 500
    f1, f2 = rng.standard_normal(t), rng.standard_normal(t)
    models = np.column_stack([f1 + 0.4 * rng.standard_normal(t), f1 + 0.5 * rng.standard_normal(t),
                              f2 + 0.6 * rng.standard_normal(t), rng.standard_normal(t)]) + 0.05
    return {"names": NAMES, "dates": [f"d{i}" for i in range(t)], "bench": [0.0] * t,
            "models": {n: models[:, j].tolist() for j, n in enumerate(NAMES)}, "reps": 200, "seed": 7, "size": 0.05}


@pytest.fixture(scope="module")
def eff_refs() -> dict:
    return spa_references(correlated_inputs())


def test_the_reference_names_the_effective_member_keys(eff_refs):
    assert all(key in eff_refs for key in EFFECTIVE_KEYS)
    assert EFFECTIVE_KEYS == tuple(k for k in eff_refs if k.startswith("effective_"))


def test_the_effective_members_are_read_from_the_correlation_of_the_differentials(eff_refs):
    data = correlated_inputs()
    d = np.column_stack([data["models"][n] for n in NAMES])
    eig = np.linalg.eigvalsh(np.corrcoef(d, rowvar=False))
    want = float(eig.sum() ** 2 / (eig ** 2).sum())
    assert eff_refs["effective_participation"].value == pytest.approx(want, rel=1e-12)
    assert eff_refs["effective_clusters"].value == "a_v0,b_v0;c_v0;d_v0"
    assert eff_refs["effective_pair"].value == "a_v0|b_v0"
    assert 0.8 < eff_refs["effective_rho"].value < 1.0
    assert 2.0 < eff_refs["effective_participation"].value < 3.5


def test_born_failing_identical_members_count_one_li_ji_not_two():
    from crosscheck.p2_spa import effective_references

    refs = effective_references(["x", "y", "z"], np.ones((3, 3)))  # the eigenvalue 3 comes back as 2.9999999999999996
    assert refs["effective_li_ji"].value == pytest.approx(1.0, abs=1e-12)


def test_the_effective_references_pass_themselves(eff_refs):
    values = {k: eff_refs[k].value for k in EFFECTIVE_KEYS}
    assert all(row.status == PASS for row in rows(eff_refs, values))


def test_born_failing_a_different_cluster_word_participation_or_pair_never_passes(eff_refs):
    wrong = {"effective_clusters": "a_v0,b_v0,c_v0;d_v0", "effective_pair": "a_v0|c_v0",
             "effective_participation": eff_refs["effective_participation"].value + 0.01}
    assert {r.metric: r.status for r in rows(eff_refs, wrong)} == {k: FAIL for k in wrong}


def test_born_failing_the_effective_members_of_the_returns_against_buy_and_hold_are_not_those_of_the_differentials():
    data = correlated_inputs()
    held = dict(data, bench=(np.random.default_rng(2).standard_normal(len(data["bench"])) * 3).tolist())
    cash_refs, held_refs = spa_references(data), spa_references(held)
    assert cash_refs["effective_rho"].value != held_refs["effective_rho"].value


def test_the_correlation_key_for_cash_is_the_return_correlation_so_the_clusters_follow_the_returns(eff_refs):
    data = correlated_inputs()
    returns = np.corrcoef(np.column_stack([data["models"][n] for n in NAMES]), rowvar=False)
    pair = max(((i, j) for i in range(4) for j in range(i + 1, 4)), key=lambda p: abs(returns[p]))
    assert eff_refs["effective_pair"].value == f"{NAMES[pair[0]]}|{NAMES[pair[1]]}"


# ---------------------------------------------------------------- a StepM that rejects in a second step


def two_step_inputs() -> dict:
    """Step 1 rejects the noisy member, step 2 rejects the one quiet member left: nothing remains for a third step."""
    t = 300
    bench = np.random.default_rng(3).standard_normal(t)
    rng = np.random.default_rng(5)
    quiet = rng.standard_normal(t)
    models = np.column_stack([bench + 1.0 + rng.standard_normal(t), bench + 0.1025 + (quiet - quiet.mean())])
    names = ["noisy_v0", "quiet_v0"]
    return {"names": names, "dates": [f"d{i}" for i in range(t)], "bench": bench.tolist(),
            "models": {n: models[:, j].tolist() for j, n in enumerate(names)}, "reps": 1000, "seed": 7, "size": 0.05}


def test_the_two_step_reference_rejects_both_members_where_arch_s_own_loop_raises():
    from arch.bootstrap import StepM

    data = two_step_inputs()
    refs = spa_references(data)
    assert refs["superior"].value == "noisy_v0,quiet_v0" and refs["k"].value == 2.0
    loss_b = -np.array(data["bench"])
    loss_m = -np.column_stack([data["models"][n] for n in data["names"]])
    stock = StepM(loss_b, loss_m, size=0.05, block_size=refs["block"].value, reps=data["reps"], seed=data["seed"])
    with pytest.raises(ValueError, match="zero-size array"):
        stock.compute()


def test_the_two_step_member_is_below_the_first_steps_bar_and_rejected_only_at_the_second():
    refs = spa_references(two_step_inputs())
    quiet_mean = refs["mean_differential"].value["quiet_v0"]
    assert quiet_mean < refs["crit_consistent"].value  # the bar the first step used
    assert refs["superior"].value.endswith("quiet_v0")


def test_born_failing_a_one_step_reading_would_name_only_the_noisy_member():
    refs = spa_references(two_step_inputs())
    [row] = rows(refs, {"superior": "noisy_v0"})
    assert row.status == FAIL
