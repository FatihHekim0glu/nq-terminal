"""Tests for the power reference (roadmap #11, C8 client phase). In memory plus one committed golden file:
hand values, the anchors named in the brief and born-failing variants (sqrt(365), two-sided)."""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import pytest
from scipy.stats import norm

from crosscheck.compare import FAIL, PASS, judge
from crosscheck.p12_power import (ALPHAS, EDGE_PAIRS, POWERS, REAL_PAIRS, SHARPES, build_golden, main, mde,
                                  power_at)

QA_DIR = Path(__file__).resolve().parents[1]
GOLDEN = QA_DIR / "golden" / "p12_power.json"
BONFERRONI = 0.05 / 21


def status(value: float, reference: float, tol: float = 1e-9) -> str:
    return PASS if judge(value, reference, tol)[1] else FAIL


def test_hand_z_values():
    # The textbook one-sided and two-sided critical values and the 80 percent power quantile.
    assert norm.ppf(0.95) == pytest.approx(1.6448536269514722, rel=1e-15)
    assert norm.ppf(0.975) == pytest.approx(1.959963984540054, rel=1e-15)
    assert norm.ppf(0.8) == pytest.approx(0.8416212335729143, rel=1e-15)
    assert norm.ppf(0.5) == 0.0


def test_mde_by_hand():
    by_hand = (1.6448536269514722 + 0.8416212335729143) / math.sqrt(2836 / 252)
    assert mde(2836, 252, 0.05, 0.8) == pytest.approx(by_hand, rel=1e-14)
    assert mde(2836, 252, 0.05, 0.8) == pytest.approx(0.74119, abs=5e-6)


def test_the_anchors_of_the_brief():
    assert round(mde(2836, 252, 0.05, 0.8), 4) == 0.7412
    assert round(mde(2836, 252, BONFERRONI, 0.8), 4) == 1.0923  # not 1.0922
    assert mde(2836, 252, BONFERRONI, 0.8) == pytest.approx(1.0923010258993995, rel=1e-13)
    assert round(mde(2686, 252, 0.05, 0.8), 4) == 0.7616  # volmanaged_v0
    assert round(mde(2686, 252, BONFERRONI, 0.8), 4) == 1.1224


def test_power_is_alpha_at_zero_sharpe_and_half_at_the_mde_for_half_power():
    for n, periods in ((2836, 252), (120, 12), (2, 252)):
        assert power_at(0.0, n, periods, 0.05) == pytest.approx(0.05, rel=1e-13)
        assert power_at(mde(n, periods, 0.05, 0.5), n, periods, 0.05) == pytest.approx(0.5, rel=1e-13)


def test_power_and_mde_are_inverse_and_monotone():
    for power in (0.5, 0.8, 0.95):
        sharpe = mde(2836, 252, BONFERRONI, power)
        assert power_at(sharpe, 2836, 252, BONFERRONI) == pytest.approx(power, rel=1e-12)
    assert mde(2836, 252, 0.05, 0.8) < mde(120, 12, 0.05, 0.8) < mde(2, 252, 0.05, 0.8)
    assert mde(2836, 252, 0.05, 0.5) < mde(2836, 252, 0.05, 0.8) < mde(2836, 252, 0.05, 0.95)
    assert mde(2836, 252, 0.05, 0.8) < mde(2836, 252, BONFERRONI, 0.8)
    levels = [power_at(s, 2836, 252, 0.05) for s in (0.0, 0.25, 0.5, 1.0)]
    assert levels == sorted(levels) and len(set(levels)) == 4


def test_born_failing_sqrt_365_fails_the_comparison():
    reference = mde(2836, 252, 0.05, 0.8)
    sqrt_365 = (norm.ppf(0.95) + norm.ppf(0.8)) / math.sqrt(2836 / 365)
    assert sqrt_365 == pytest.approx(0.8921, abs=5e-4)  # 7.77 "years" instead of 11.25: a wrong, larger number
    assert status(sqrt_365, reference) == FAIL
    # the same slip on the power side: annualising with 365 instead of the book's own periods
    wrong = float(norm.cdf(0.5 * math.sqrt(2836 / 365) - norm.ppf(0.95)))
    assert status(wrong, power_at(0.5, 2836, 252, 0.05)) == FAIL


def test_born_failing_two_sided_fails_the_comparison():
    reference = mde(2836, 252, 0.05, 0.8)
    two_sided = (norm.ppf(1 - 0.05 / 2) + norm.ppf(0.8)) / math.sqrt(2836 / 252)
    assert two_sided > reference
    assert status(two_sided, reference) == FAIL
    wrong = float(norm.cdf(0.5 * math.sqrt(2836 / 252) - norm.ppf(1 - 0.05 / 2)))
    assert status(wrong, power_at(0.5, 2836, 252, 0.05)) == FAIL


def test_the_matching_value_passes_the_comparison():
    assert status(mde(2836, 252, 0.05, 0.8), 0.7411928646767564) == PASS


def test_golden_shape_and_coverage():
    golden = build_golden()
    assert golden["source"] == "qa/crosscheck/p12_power.py"
    assert golden["scipy"] == "1.18.1"
    assert len(REAL_PAIRS) == 21 and len(EDGE_PAIRS) == 3
    pairs = len(REAL_PAIRS) + len(EDGE_PAIRS)
    assert len(golden["mde"]) == pairs * len(ALPHAS) * len(POWERS)
    assert len(golden["power"]) == pairs * len(ALPHAS) * len(SHARPES)
    assert [row["x"] for row in golden["cdf"]][:3] == [-30, -20, -10]
    quantile_ps = [row["p"] for row in golden["quantile"]]
    assert quantile_ps[0] == 1e-300 and 0.5 in quantile_ps and 1 - 1e-12 in quantile_ps
    assert all(math.isfinite(row["value"]) for key in ("cdf", "quantile", "mde", "power") for row in golden[key])
    # the golden values are the scipy ones, not a recomputation through the reference functions
    for row in golden["cdf"]:
        assert row["value"] == float(norm.cdf(row["x"]))
    for row in golden["quantile"]:
        assert row["value"] == float(norm.ppf(row["p"]))


def test_golden_pairs_are_the_registered_books():
    assert (2836, 252) in REAL_PAIRS and (2686, 252) in REAL_PAIRS and (123, 12) in REAL_PAIRS
    assert sorted({p for _, p in REAL_PAIRS}) == [12, 252]
    assert sorted(EDGE_PAIRS) == [(2, 252), (120, 12), (10000, 252)]


def test_write_then_check_returns_zero(tmp_path, capsys):
    path = tmp_path / "p12_power.json"
    assert main(["--write", str(path)]) == 0
    text = path.read_text()
    assert text.endswith("}\n") and not text.endswith("\n\n")
    assert text == json.dumps(json.loads(text), indent=1, sort_keys=True, allow_nan=False) + "\n"
    assert main(["--check", str(path)]) == 0
    assert capsys.readouterr().out == ""


def test_the_committed_golden_file_is_current():
    assert GOLDEN.exists(), "run: uv run python -m crosscheck.p12_power --write golden/p12_power.json"
    assert main(["--check", str(GOLDEN)]) == 0


def test_a_tampered_copy_returns_one_and_names_the_first_difference(tmp_path, capsys):
    path = tmp_path / "tampered.json"
    golden = json.loads(GOLDEN.read_text())
    golden["mde"][3]["value"] += 1e-12
    path.write_text(json.dumps(golden, indent=1, sort_keys=True, allow_nan=False) + "\n")
    assert main(["--check", str(path)]) == 1
    assert "mde[3].value" in capsys.readouterr().out


def _one_ulp_up(value):
    """The same JSON value with every float moved one last bit up: what another platform's maths library can do."""
    if isinstance(value, float):
        return math.nextafter(value, math.inf)
    if isinstance(value, list):
        return [_one_ulp_up(item) for item in value]
    if isinstance(value, dict):
        return {key: _one_ulp_up(item) for key, item in value.items()}
    return value


def test_a_copy_that_differs_in_the_last_bit_of_every_float_still_passes(tmp_path, capsys):
    path = tmp_path / "other_platform.json"
    path.write_text(json.dumps(_one_ulp_up(json.loads(GOLDEN.read_text())), indent=1, sort_keys=True, allow_nan=False) + "\n")
    assert main(["--check", str(path)]) == 0
    assert capsys.readouterr().out == ""


def test_a_missing_or_shortened_copy_returns_one(tmp_path, capsys):
    assert main(["--check", str(tmp_path / "absent.json")]) == 1
    short = tmp_path / "short.json"
    golden = json.loads(GOLDEN.read_text())
    golden["cdf"].pop()
    short.write_text(json.dumps(golden, sort_keys=True) + "\n")
    assert main(["--check", str(short)]) == 1
    assert "cdf" in capsys.readouterr().out


def test_the_command_line_needs_exactly_one_mode():
    with pytest.raises(SystemExit):
        main([])
    with pytest.raises(SystemExit):
        main(["--write", "a.json", "--check", "b.json"])


def test_module_entry_point_exits_zero_on_the_committed_file():
    done = subprocess.run([sys.executable, "-m", "crosscheck.p12_power", "--check", "golden/p12_power.json"],
                          cwd=QA_DIR, capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stdout + done.stderr
