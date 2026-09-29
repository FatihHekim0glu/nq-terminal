"""Tests for the paper path placement reference (ROADMAP 17 step 1; ANALYTICS SV6 cone, LV6 paper path).

Everything is built in memory except the golden round trip, which writes into pytest's tmp_path. The committed
golden file (qa/golden/p12_expectation.json) is checked against a fresh build, so a change to the reference must
regenerate it in the same change.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from crosscheck.p12_expectation import BANDS, build_golden, main, path_on_cone

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "p12_expectation.json"

# Flat quantile levels, in fractions of K, chosen so that usd / 1000 lands exactly on a level (a correctly rounded
# quotient is the double nearest the decimal, so -20 / 1000 == -0.02).
LEVELS = {"5": -0.1, "25": -0.02, "50": 0.0, "75": 0.03, "95": 0.05}
CAPITAL = 1000.0


def flat(steps: int, **override) -> dict:
    return {key: [override.get(key, level)] * steps for key, level in LEVELS.items()}


def test_the_bands_are_named_in_placement_order():
    assert BANDS == ("below5", "p5to25", "p25to50", "p50to75", "p75to95", "above95")


def test_the_fraction_is_usd_over_capital_from_the_first_value_and_step_k_sits_at_index_k_minus_one():
    usd = [None, None, 250.0, -500.0, 125.0]
    out = path_on_cone(usd, 1000.0, flat(4), 4)
    assert out["first_index"] == 2
    assert out["fraction"] == [0.25, -0.5, 0.125, None]  # a fourth step has no row yet
    assert out["beyond"] == 0


def test_the_fixture_numbers_place_paper_and_model_in_the_p50_to_p75_band_at_both_steps():
    quantiles = {
        "5": [-0.01743, -0.025095], "25": [-0.00735, -0.012521639999999999], "50": [-0.00147, -0.0031500000000000005],
        "75": [0.00378, 0.004935], "95": [0.013281, 0.01449],
    }
    out = path_on_cone([None, None, None, 12.0, 6.0], 1_000_000.0, quantiles, 2)
    assert out["first_index"] == 3
    assert out["fraction"] == [12.0 / 1_000_000.0, 6.0 / 1_000_000.0]
    assert out["bands"] == ["p50to75", "p50to75"]


def test_a_value_exactly_on_a_percentile_belongs_to_the_band_above_it():
    """side='right': p25 exactly is p25to50, p95 exactly is above95 (side='left' would say p5to25 and p75to95)."""
    out = path_on_cone([-20.0, 50.0], CAPITAL, flat(2), 2)
    assert out["fraction"] == [-0.02, 0.05]
    assert out["bands"] == ["p25to50", "above95"]
    left = [int(np.searchsorted(list(LEVELS.values()), v, side="left")) for v in out["fraction"]]
    assert [BANDS[i] for i in left] == ["p5to25", "p75to95"]


def test_every_percentile_is_a_tie_boundary_in_turn():
    usd = [-100.0, -20.0, 0.0, 30.0, 50.0]
    out = path_on_cone(usd, CAPITAL, flat(5), 5)
    assert out["bands"] == ["p5to25", "p25to50", "p50to75", "p75to95", "above95"]


def test_a_path_below_p5_is_below5_and_one_above_p95_is_above95():
    out = path_on_cone([-101.0, 51.0, -99.0], CAPITAL, flat(3), 3)
    assert out["bands"] == ["below5", "above95", "p5to25"]


def test_a_null_gap_gives_no_fraction_and_no_band_at_that_step_only():
    out = path_on_cone([None, 10.0, None, 30.0, 40.0], CAPITAL, flat(4), 4)
    assert out["first_index"] == 1
    assert out["fraction"] == [0.01, None, 0.03, 0.04]
    assert out["bands"] == ["p50to75", None, "p75to95", "p75to95"]


def test_a_non_finite_value_is_a_gap_too():
    out = path_on_cone([10.0, math.nan, math.inf], CAPITAL, flat(3), 3)
    assert out["fraction"] == [0.01, None, None]
    assert out["bands"] == ["p50to75", None, None]


def test_values_past_the_horizon_are_counted_not_placed_and_gaps_out_there_are_not_counted():
    out = path_on_cone([None, 5.0, 10.0, 15.0, 20.0, None, 30.0], CAPITAL, flat(3), 3)
    assert out["first_index"] == 1
    assert out["fraction"] == [0.005, 0.01, 0.015]
    assert out["beyond"] == 2  # 20 and 30; the gap between them is not a row with a value


def test_a_missing_quantile_leaves_that_step_unplaced_but_keeps_its_fraction():
    quantiles = flat(3)
    quantiles["50"] = [0.0, None, 0.0]
    quantiles["95"] = [0.05, 0.05]  # too short for step 3
    out = path_on_cone([10.0, 10.0, 10.0], CAPITAL, quantiles, 3)
    assert out["fraction"] == [0.01, 0.01, 0.01]
    assert out["bands"] == ["p50to75", None, None]


def test_a_missing_percentile_key_leaves_every_step_unplaced():
    quantiles = flat(2)
    del quantiles["75"]
    out = path_on_cone([10.0, 10.0], CAPITAL, quantiles, 2)
    assert out["bands"] == [None, None]


def test_crossing_quantiles_at_a_step_are_unusable_for_that_step():
    quantiles = flat(2)
    quantiles["25"] = [-0.02, 0.06]  # above p50 and p75 at step 2
    out = path_on_cone([10.0, 10.0], CAPITAL, quantiles, 2)
    assert out["bands"] == ["p50to75", None]


def test_a_path_with_no_value_has_no_first_index_and_nothing_placed():
    out = path_on_cone([None, None], CAPITAL, flat(3), 3)
    assert out == {"first_index": None, "fraction": [None, None, None], "bands": [None, None, None], "beyond": 0}


def test_an_empty_path_and_a_zero_horizon_are_valid():
    assert path_on_cone([], CAPITAL, flat(0), 0) == {"first_index": None, "fraction": [], "bands": [], "beyond": 0}
    assert path_on_cone([5.0], CAPITAL, flat(0), 0) == {"first_index": 0, "fraction": [], "bands": [], "beyond": 1}


@pytest.mark.parametrize("capital", [0, 0.0, -1.0, -1_000_000, math.nan, math.inf, -math.inf])
def test_a_capital_that_is_zero_negative_or_not_finite_raises(capital):
    with pytest.raises(ValueError, match="capital"):
        path_on_cone([1.0], capital, flat(1), 1)


@pytest.mark.parametrize("horizon", [-1, 1.5])
def test_a_negative_or_fractional_horizon_raises(horizon):
    with pytest.raises(ValueError, match="horizon"):
        path_on_cone([1.0], CAPITAL, flat(1), horizon)


def test_the_inputs_are_not_changed():
    usd = [None, 10.0]
    quantiles = flat(1)
    before = (list(usd), {k: list(v) for k, v in quantiles.items()})
    path_on_cone(usd, CAPITAL, quantiles, 1)
    assert (usd, quantiles) == before


# ---------------------------------------------------------------- the golden file


def test_the_golden_holds_named_cases_that_cover_every_branch():
    golden = build_golden()
    assert set(golden) == {"source", "cases"}
    names = [case["name"] for case in golden["cases"]]
    assert len(names) == len(set(names))
    for wanted in ("fixture paper", "fixture model", "tie on p25 and p95", "gap", "long path", "missing quantile",
                   "below p5"):
        assert any(wanted in name for name in names), wanted
    for case in golden["cases"]:
        assert set(case) == {"name", "input", "expected"}
        assert set(case["input"]) == {"usd", "capital", "quantiles", "horizon"}
        assert set(case["expected"]) == {"first_index", "fraction", "bands", "beyond"}
        assert case["expected"] == path_on_cone(**case["input"])


def test_the_golden_cases_reach_every_band_a_tie_a_gap_and_a_beyond():
    cases = build_golden()["cases"]
    bands = {b for case in cases for b in case["expected"]["bands"]}
    assert set(BANDS) <= bands and None in bands
    assert any(case["expected"]["beyond"] > 0 for case in cases)
    assert any(None in case["expected"]["fraction"][case["expected"]["first_index"] or 0:] for case in cases)


def test_the_fixture_cases_copy_the_web_fixtures_numbers():
    cases = {case["name"]: case for case in build_golden()["cases"]}
    paper, model = cases["fixture paper"], cases["fixture model"]
    assert paper["input"]["usd"] == [None, None, None, 12.0, 6.0]  # TRACKING_POPULATED.paper_cumulative
    assert model["input"]["usd"] == [None, None, None, 12.0, 7.0]  # TRACKING_POPULATED.model_cumulative
    assert paper["input"]["capital"] == 1_000_000  # RUN_ANALYTICS.capital
    assert paper["input"]["quantiles"] == model["input"]["quantiles"]
    assert paper["input"]["quantiles"]["5"][:2] == [-0.01743, -0.025095]  # HYP_BOOTSTRAP.cone.quantiles


def test_the_golden_is_json_that_needs_no_nan():
    text = json.dumps(build_golden(), indent=1, sort_keys=True, allow_nan=False)
    assert "NaN" not in text and "Infinity" not in text


def test_write_then_check_returns_zero_and_the_file_ends_with_a_newline(tmp_path, capsys):
    target = tmp_path / "golden.json"
    assert main(["--write", str(target)]) == 0
    text = target.read_text(encoding="utf-8")
    assert text == json.dumps(build_golden(), indent=1, sort_keys=True, allow_nan=False) + "\n"
    assert main(["--check", str(target)]) == 0
    capsys.readouterr()


def test_write_is_byte_identical_on_a_second_run(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    assert main(["--write", str(a)]) == 0 and main(["--write", str(b)]) == 0
    assert a.read_bytes() == b.read_bytes()


def test_check_names_the_first_differing_key_and_returns_one(tmp_path, capsys):
    target = tmp_path / "golden.json"
    main(["--write", str(target)])
    golden = json.loads(target.read_text(encoding="utf-8"))
    golden["cases"][1]["expected"]["beyond"] = 99
    target.write_text(json.dumps(golden, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    capsys.readouterr()
    assert main(["--check", str(target)]) == 1
    out = capsys.readouterr().out
    assert "cases[1].expected.beyond" in out


def test_check_returns_one_for_a_missing_or_unreadable_file(tmp_path, capsys):
    assert main(["--check", str(tmp_path / "absent.json")]) == 1
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert main(["--check", str(bad)]) == 1
    capsys.readouterr()


def test_the_committed_golden_matches_a_fresh_build(capsys):
    assert GOLDEN.is_file(), "regenerate with: uv run python -m crosscheck.p12_expectation --write golden/p12_expectation.json"
    assert main(["--check", str(GOLDEN)]) == 0
    capsys.readouterr()
