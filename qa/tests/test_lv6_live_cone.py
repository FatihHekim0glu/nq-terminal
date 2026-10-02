"""The `lv6` reference (LV6 and LV6b served): wiring, the live-start cone against arch, and its refusals.

Everything is built in memory from seeded synthetic paper books (not project data).
"""
from __future__ import annotations

import warnings

import numpy as np
import pytest
from crosscheck import compare, dumps
from crosscheck.dumps import Bundle
from crosscheck.lv6_live_cone import (
    BUNDLE_INPUTS,
    LV6_INPUTS,
    LV6_REFERENCES,
    NONE,
    live_cone,
    lv6_references,
    placement_refs,
)
from crosscheck.p12_expectation import path_on_cone

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from arch.bootstrap import StationaryBootstrap, optimal_block_length

K = 1_000_000.0
FLAT = {"5": [-0.1] * 3, "25": [-0.02] * 3, "50": [0.0] * 3, "75": [0.03] * 3, "95": [0.05] * 3}


def book(n: int, lead: int = 2, seed: int = 5, gaps: tuple[int, ...] = ()) -> dict:
    rng = np.random.default_rng(seed)
    paper = [None] * lead + [float(v) for v in rng.normal(25.0, 700.0, n).round(2)]
    model = [None] * lead + [float(v) for v in rng.normal(25.0, 700.0, n).round(2)]
    for i in gaps:
        paper[lead + i] = model[lead + i] = None

    def running(values):
        out, acc = [], 0.0
        for v in values:
            out.append(None if v is None else (acc := acc + v))
        return out

    return {"dates": [f"2026-01-{i + 1:02d}" for i in range(lead + n)], "paper": paper,
            "paper_cumulative": running(paper), "model_cumulative": running(model), "capital": K,
            "backtest_quantiles": FLAT, "backtest_horizon": 3, "reps": 200, "seed": 20260927}


def test_the_kind_is_read_and_compared_with_the_same_input_names():
    assert tuple(dumps.BUNDLE_INPUTS["lv6"]) == BUNDLE_INPUTS == LV6_INPUTS["lv6"]
    assert compare.BUNDLE_REFERENCES["lv6"] is LV6_REFERENCES["lv6"] is lv6_references


def test_the_live_cone_is_arch_on_the_finite_paper_values_over_k():
    inputs = book(40, gaps=(4, 9))
    found = live_cone(inputs)
    r = np.array([v / K for v in inputs["paper"] if v is not None])
    assert found["n"] == 38 == len(r) and found["horizon"] == 38 and found["refusal"] == NONE
    block = float(optimal_block_length(r)["stationary"].iloc[0])
    heads = [d[0][0] for d in StationaryBootstrap(block, r, seed=20260927).bootstrap(200)]
    want = np.percentile(np.cumsum(np.vstack(heads), axis=1), 50, axis=0)
    assert found["block"] == block and found["quantiles"]["50"] == want.tolist()


def test_born_failing_a_short_book_and_a_flat_book_get_their_words_and_no_cone():
    short = lv6_references(book(29))
    assert short["live_refusal"].value == "live_short" and "live_cone_50" not in short
    flat = book(35)
    flat["paper"] = [None, None] + [0.0] * 35  # a book that held nothing
    assert lv6_references(flat)["live_refusal"].value == "live_flat"


def test_the_placement_keys_follow_path_on_cone_and_the_anchor_rules():
    inputs = book(5)
    refs = placement_refs("backtest", inputs, FLAT, 3)
    want = path_on_cone(inputs["paper_cumulative"], K, FLAT, 3)
    assert refs["backtest_paper_fraction"].value == want["fraction"]
    assert refs["backtest_paper_bands"].value == want["bands"]
    assert refs["backtest_first_index"].value == 2.0 and refs["backtest_latest_step"].value == 3.0
    assert refs["backtest_beyond"].value == 2.0


def test_a_bundle_passes_when_ours_equals_the_reference_and_fails_on_a_shifted_band():
    inputs = book(31)
    refs = lv6_references(inputs)
    ours = {key: ref.value for key, ref in refs.items()}
    bundle = Bundle(name="lv6_synthetic", kind="lv6", source="t", inputs=inputs, values={"ours": ours}, missing={})
    assert {row.status for row in compare.compare_bundle(bundle)} == {compare.PASS}
    bands = list(ours["live_paper_bands"])
    bands[0] = "above95" if bands[0] != "above95" else "below5"
    broken = Bundle(name="lv6_broken", kind="lv6", source="t", inputs=inputs,
                    values={"ours": {**ours, "live_paper_bands": bands}}, missing={})
    assert compare.FAIL in {row.status for row in compare.compare_bundle(broken)}


@pytest.mark.parametrize("missing", ["live_cone_50", "backtest_paper_fraction"])
def test_born_failing_a_value_missing_from_ours_is_a_skip_that_strict_fails(missing):
    inputs = book(31)
    ours = {key: ref.value for key, ref in lv6_references(inputs).items() if key != missing}
    bundle = Bundle(name="lv6_gap", kind="lv6", source="t", inputs=inputs, values={"ours": ours}, missing={})
    rows = compare.compare_bundle(bundle)
    assert compare.exit_code(rows, strict=True) == 1


def test_born_failing_the_live_placement_is_by_finite_session_so_a_gap_row_shifts_nothing():
    inputs = book(40, lead=2, gaps=(4, 9))  # 38 finite sessions after two leading rows: 42 rows, 38 steps
    refs = lv6_references(inputs)
    assert refs["live_horizon"].value == 38.0
    for name in ("paper", "model"):
        running = [v for v in inputs[f"{name}_cumulative"] if v is not None]  # the running total of the finite sessions
        fraction = refs[f"live_{name}_fraction"].value
        assert len(fraction) == 38 and None not in fraction
        assert fraction[5] == pytest.approx(running[5] / K, rel=1e-12)
        assert refs[f"live_{name}_beyond"].value == 0.0 and refs[f"live_{name}_first_index"].value == 2
    assert refs["live_first_index"].value == 2.0 and refs["live_latest_step"].value == 38.0
    assert refs["live_beyond"].value == 0.0
    assert refs["backtest_latest_step"].value == 3.0  # the backtest cone still places by journal row
