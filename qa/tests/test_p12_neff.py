"""Tests for the effective-N reference (roadmap #19, C8 client phase). In memory plus one committed golden file:
hand values, an independent UPGMA, the paper example, the SV3 anchor at N = 21 and born-failing variants (Spearman,
single linkage, V instead of V0, N 15)."""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import scipy
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform
from scipy.stats import norm, rankdata

from crosscheck.compare import FAIL, PASS, judge
from crosscheck.p12_neff import (CLUSTER_CUT, HAND_MATRICES, NAMES, SESSIONS, SR0_TRIALS, SV3_ANCHOR, TRIALS,
                                 build_golden, build_panel, clusters_at, expected_max_sr0, li_ji, main,
                                 participation_ratio, probabilistic_sharpe, render)

QA_DIR = Path(__file__).resolve().parents[1]
GOLDEN = QA_DIR / "golden" / "p12_neff.json"
GAMMA = SV3_ANCHOR["euler_gamma"]
V0 = SV3_ANCHOR["variance_null"]


def status(value, reference, tol: float = 1e-9) -> str:
    return PASS if judge(np.ravel(value).tolist(), np.ravel(reference).tolist(), tol)[1] else FAIL


def golden() -> dict:
    return json.loads(GOLDEN.read_text())


def returns_of(g: dict) -> np.ndarray:
    return np.array(g["panel"]["columns"]).T  # sessions x trials


def tree_of(g: dict) -> np.ndarray:
    return np.array([[row["a"], row["b"], row["height"], row["size"]] for row in g["linkage"]])


def naive_average_linkage(distance: np.ndarray) -> list[tuple[int, int, float, int]]:
    """UPGMA by the book: repeatedly merge the closest pair of live clusters, ties to the lowest (a, b); the new
    cluster of merge i is numbered M + i (scipy's numbering)."""
    m = len(distance)
    live: dict[int, tuple[int, dict[int, float]]] = {}
    for i in range(m):
        live[i] = (1, {j: float(distance[min(i, j), max(i, j)]) for j in range(m) if j != i})
    merges = []
    for step in range(m - 1):
        best = None
        for a in sorted(live):
            for b in sorted(live):
                if a < b and (best is None or live[a][1][b] < best[0]):
                    best = (live[a][1][b], a, b)
        assert best is not None
        height, a, b = best
        (size_a, dist_a), (size_b, dist_b) = live.pop(a), live.pop(b)
        new = m + step
        row = {k: (size_a * dist_a[k] + size_b * dist_b[k]) / (size_a + size_b) for k in live}
        for k, value in row.items():
            live[k][1].pop(a, None)
            live[k][1].pop(b, None)
            live[k][1][new] = value
        live[new] = (size_a + size_b, row)
        merges.append((a, b, height, size_a + size_b))
    return merges


# ---- the panel -------------------------------------------------------------------------------------------------

def test_the_panel_is_the_seeded_400_by_9_draw():
    panel = build_panel()
    assert (SESSIONS, TRIALS) == (400, 9)
    assert len(panel["dates"]) == 400 and len(panel["columns"]) == 9 and all(len(c) == 400 for c in panel["columns"])
    assert panel["names"] == list(NAMES) and len(set(NAMES)) == 9
    assert build_panel() == panel  # seeded: the same draw every time
    dates = np.array(panel["dates"], dtype="datetime64[D]")
    assert np.all(np.diff(dates.astype(int)) > 0) and np.all(np.is_busday(dates))  # sessions: ascending weekdays


def test_the_last_trial_is_trade_like_and_nothing_is_tied():
    columns = np.array(build_panel()["columns"])
    trade_like = columns[-1]
    assert np.count_nonzero(trade_like == 0.0) == 360 and np.count_nonzero(trade_like) == 40  # zero on 90 percent
    assert len(set(trade_like[trade_like != 0.0])) == 40  # the 40 traded sessions carry distinct values
    for column in columns[:-1]:
        assert len(set(column)) == 400  # no tie inside any other trial


def test_the_planted_blocks_show_in_the_correlation():
    g = golden()
    r = np.array(g["correlation"])
    within = [np.mean([r[i, j] for i in range(3 * b, 3 * b + 3) for j in range(3 * b, 3 * b + 3) if i < j])
              for b in range(3)]
    assert 0.58 < within[0] < 0.70  # loading 0.8: 0.64 planted
    assert 0.28 < within[1] < 0.44  # loading 0.6: 0.36 planted
    assert within[2] < 0.2  # loading 0.3 (and a trade-like member): 0.09 planted, less after the zeros
    across = [abs(r[i, j]) for i in range(9) for j in range(i + 1, 9) if i // 3 != j // 3]
    assert max(across) < 0.15


# ---- correlation and eigenvalues -------------------------------------------------------------------------------

def test_the_golden_correlation_is_pearson_by_centred_sums():
    g = golden()
    x = returns_of(g)
    centred = x - x.mean(axis=0)
    sums = centred.T @ centred
    by_hand = sums / np.sqrt(np.outer(np.diag(sums), np.diag(sums)))
    assert np.max(np.abs(np.array(g["correlation"]) - by_hand)) < 1e-14
    assert np.max(np.abs(np.diag(np.array(g["correlation"])) - 1)) < 1e-15


def test_eigenvalues_are_descending_and_keep_the_trace_and_the_square_trace():
    g = golden()
    r, eig = np.array(g["correlation"]), np.array(g["eigenvalues"])
    assert list(eig) == sorted(eig, reverse=True) and len(eig) == 9
    assert eig.sum() == pytest.approx(9.0, abs=1e-12)  # trace of a correlation matrix
    assert (eig**2).sum() == pytest.approx(np.trace(r @ r), abs=1e-11)
    assert eig.min() > -1e-12
    assert np.max(np.abs(np.sort(eig) - np.linalg.eigvalsh((r + r.T) / 2))) < 1e-14


def test_hand_eigen_cases():
    cases = {c["name"]: c for c in golden()["eigen_cases"]}
    assert [n for n, _ in HAND_MATRICES] == list(cases)
    assert cases["two_by_two"]["eigenvalues"] == pytest.approx([3.0, 1.0], abs=1e-15)
    assert cases["identity_three"]["eigenvalues"] == pytest.approx([1.0, 1.0, 1.0], abs=1e-15)
    assert cases["duplicate_columns"]["eigenvalues"] == pytest.approx([2.0, 1.0, 0.0], abs=1e-15)
    assert cases["equicorrelation_04"]["eigenvalues"] == pytest.approx([1.8, 0.6, 0.6], abs=1e-15)
    assert cases["path_laplacian"]["eigenvalues"] == pytest.approx(
        [2 + math.sqrt(2), 2.0, 2 - math.sqrt(2)], abs=1e-14)
    # participation ratio and Li and Ji by hand: 16/10 and 1 + 1; 9/3 and 3; 9/5 and 1 + 1 + 0; 9/3.96 and 1 + 0.8 + 0.6 + 0.6
    assert cases["two_by_two"]["participation_ratio"] == pytest.approx(1.6, abs=1e-15)
    assert cases["two_by_two"]["li_ji"] == pytest.approx(2.0, abs=1e-15)
    assert cases["identity_three"]["participation_ratio"] == pytest.approx(3.0, abs=1e-15)
    assert cases["identity_three"]["li_ji"] == pytest.approx(3.0, abs=1e-15)
    assert cases["duplicate_columns"]["participation_ratio"] == pytest.approx(1.8, abs=1e-15)
    assert cases["duplicate_columns"]["li_ji"] == pytest.approx(2.0, abs=1e-15)
    assert cases["equicorrelation_04"]["participation_ratio"] == pytest.approx(9 / 3.96, abs=1e-14)
    assert cases["equicorrelation_04"]["li_ji"] == pytest.approx(3.0, abs=1e-14)


def test_participation_ratio_and_li_ji_of_the_panel_by_independent_sums():
    g = golden()
    eig = g["eigenvalues"]
    assert g["participation_ratio"] == pytest.approx(sum(eig) ** 2 / sum(x * x for x in eig), rel=1e-14)
    assert 1 < g["participation_ratio"] < 9
    at_least_one = sum(1 for x in eig if abs(x) >= 1)
    fractions = sum(abs(x) - math.floor(abs(x)) for x in eig)
    assert g["li_ji"] == pytest.approx(at_least_one + fractions, abs=1e-12)
    assert at_least_one == 3 and g["li_ji"] == pytest.approx(8.0, abs=1e-12)
    # M equal eigenvalues give M; one non-zero eigenvalue gives 1
    assert participation_ratio(np.ones(5)) == pytest.approx(5.0, abs=1e-15)
    assert participation_ratio(np.array([4.0, 0.0, 0.0, 0.0])) == pytest.approx(1.0, abs=1e-15)
    assert li_ji(np.array([-1.5, 0.25])) == pytest.approx(1 + 0.5 + 0.25, abs=1e-15)  # |l| is used


# ---- linkage and clusters --------------------------------------------------------------------------------------

def test_linkage_heights_grow_by_a_clear_gap_and_the_first_merge_is_the_closest_pair():
    g = golden()
    heights = g["linkage_heights"]
    assert heights == [row["height"] for row in g["linkage"]] and len(heights) == 8
    assert all(b - a > 0.01 for a, b in zip(heights, heights[1:]))  # average linkage is monotone; no ties
    distance = 1 - np.array(g["correlation"])
    closest = min(distance[i, j] for i in range(9) for j in range(i + 1, 9))
    assert heights[0] == pytest.approx(closest, abs=1e-15)
    sizes = [row["size"] for row in g["linkage"]]
    assert sizes[-1] == 9 and all(row["a"] < row["b"] for row in g["linkage"])  # scipy: smaller id first
    used = [row[key] for row in g["linkage"] for key in ("a", "b")]
    assert sorted(used) == sorted(set(range(9 + 7)) - {9 + 7})  # every id but the root is a child exactly once
    assert all(max(row["a"], row["b"]) < 9 + i for i, row in enumerate(g["linkage"]))


def test_an_independent_naive_upgma_reproduces_scipy_numbering_and_heights():
    g = golden()
    distance = 1 - np.array(g["correlation"])
    mine = naive_average_linkage(distance)
    for (a, b, height, size), row in zip(mine, g["linkage"]):
        assert (a, b, size) == (row["a"], row["b"], row["size"])
        assert height == pytest.approx(row["height"], abs=1e-12)


def test_scipy_average_linkage_on_the_panel_is_the_golden_tree():
    g = golden()
    tree = linkage(squareform(1 - np.array(g["correlation"]), checks=False), "average")
    assert np.array_equal(tree, tree_of(g))


def test_fcluster_count_and_partition_at_the_cut():
    g = golden()
    tree = tree_of(g)
    labels = fcluster(tree, CLUSTER_CUT, criterion="distance")
    assert g["cluster_cut"] == 0.5 == CLUSTER_CUT
    assert len(g["clusters"]) == len(set(labels)) == 7
    assert g["clusters"] == [[0, 1, 2], [3], [4], [5], [6], [7], [8]]
    members = [m for cluster in g["clusters"] for m in cluster]
    assert sorted(members) == list(range(9))  # every trial in exactly one cluster
    assert all(c == sorted(c) for c in g["clusters"]) and [c[0] for c in g["clusters"]] == sorted(c[0] for c in g["clusters"])
    assert clusters_at(tree, CLUSTER_CUT) == g["clusters"]


def test_a_merge_exactly_at_the_cut_is_kept():
    g = golden()
    tree = tree_of(g)
    for k, height in enumerate(g["linkage_heights"]):
        assert len(clusters_at(tree, height)) == 9 - (k + 1)  # 'distance' keeps every merge at or below the cut
        assert len(clusters_at(tree, np.nextafter(height, 0))) == 9 - k


def test_the_cluster_sweep_walks_from_nine_singletons_to_one_cluster_and_is_nested():
    sweep = golden()["cluster_sweep"]
    assert [len(s["clusters"]) for s in sweep] == [9, 8, 7, 6, 5, 4, 3, 2, 1]
    assert [s["cut"] for s in sweep] == sorted(s["cut"] for s in sweep)
    for finer, coarser in zip(sweep, sweep[1:]):
        for cluster in finer["clusters"]:
            assert any(set(cluster) <= set(other) for other in coarser["clusters"])
    at_half = [s for s in sweep if len(s["clusters"]) == 7]
    assert at_half and at_half[0]["clusters"] == golden()["clusters"]  # the 0.5 cut lies in the seven-cluster gap
    assert at_half[0]["cut"] < 0.5 < golden()["linkage_heights"][2]


def test_a_merge_below_its_child_joins_nothing_until_the_child_does():
    case = golden()["inversion_case"]
    assert case["m"] == 3 and [row["height"] for row in case["merges"]] == [0.6, 0.4]
    by_cut = {c["cut"]: c["clusters"] for c in case["cuts"]}
    for cut in (0.3, 0.4, 0.5):  # the parent (0.4) is at or below the cut but its child (0.6) is not
        assert by_cut[cut] == [[0], [1], [2]]
    for cut in (0.6, 0.7):
        assert by_cut[cut] == [[0, 1, 2]]


# ---- SR0 and PSR -----------------------------------------------------------------------------------------------

def test_the_paper_example():
    example = golden()["paper_example"]
    assert example["n_trials"] == 100 and example["sessions"] == 1250 and example["skew"] == -3.0
    assert example["kurt"] == 10.0 and example["variance"] == pytest.approx(1 / 500, rel=1e-15)
    assert example["sr"] == pytest.approx(2.5 / math.sqrt(250), rel=1e-15)
    assert round(example["sr0"], 4) == example["reported"]["sr0"] == 0.1132
    assert round(example["dsr"], 4) == example["reported"]["dsr"] == 0.9004
    # by hand from scipy's normal
    mix = (1 - GAMMA) * norm.ppf(1 - 1 / 100) + GAMMA * norm.ppf(1 - 1 / (100 * math.e))
    sr0 = math.sqrt(1 / 500) * mix
    assert example["sr0"] == pytest.approx(sr0, rel=1e-14)
    z = (example["sr"] - sr0) * math.sqrt(1249) / math.sqrt(1 + 3 * example["sr"] + 9 / 4 * example["sr"] ** 2)
    assert example["dsr"] == pytest.approx(norm.cdf(z), rel=1e-14)


def test_session_sharpe_is_mean_over_sample_sd():
    g = golden()
    x = returns_of(g)
    rows = g["session_sharpe"]
    assert [row["name"] for row in rows] == list(NAMES)
    for row, column in zip(rows, x.T):
        by_hand = sum(column) / len(column) / math.sqrt(sum((v - sum(column) / len(column)) ** 2 for v in column) / (len(column) - 1))
        assert row["value"] == pytest.approx(by_hand, rel=1e-12)
    # ddof 1, not 0: the population sd would give a larger ratio by sqrt(400 / 399)
    population = x.mean(axis=0) / x.std(axis=0, ddof=0)
    assert status([r["value"] for r in rows], population, 1e-6) == FAIL


def test_the_sv3_anchor_at_n_21_is_reproduced_by_scipy():
    anchor = golden()["sv3_anchor"]
    assert anchor == SV3_ANCHOR and anchor["n_trials"] == 21
    assert expected_max_sr0(anchor["variance_null"], 21, GAMMA) == pytest.approx(anchor["sr0_null_session"], rel=1e-13)
    assert expected_max_sr0(anchor["variance"], 21, GAMMA) == pytest.approx(anchor["sr0_session"], rel=1e-13)
    for row in anchor["rows"]:
        got = probabilistic_sharpe(row["sr"], row["sr0_null_own_period"], row["n"], row["skew"], row["kurt"])
        assert got == pytest.approx(row["dsr_null"], abs=1e-9), row["name"]
        assert row["sr0_null_own_period"] == pytest.approx(
            anchor["sr0_null_session"] * math.sqrt(252 / row["periods"]), rel=1e-13)  # a monthly book: x sqrt(252/12)


def test_sr0_cases():
    cases = golden()["sr0_cases"]
    by_trials = {c["n_trials"]: c["value"] for c in cases if c["variance"] == V0}
    assert sorted(by_trials) == sorted(SR0_TRIALS)
    assert by_trials[1] is None and by_trials[0.5] is None  # N <= 1 has no expected maximum
    finite = [n for n in sorted(by_trials) if by_trials[n] is not None]
    values = [by_trials[n] for n in finite]
    assert values == sorted(values) and len(set(values)) == len(values)  # the bar rises with N, fractional N included
    assert by_trials[2] == pytest.approx(math.sqrt(V0) * GAMMA * norm.ppf(1 - 1 / (2 * math.e)), rel=1e-14)  # Phi^-1(1/2) = 0
    assert by_trials[9.4] < by_trials[12.3] < by_trials[21]
    assert [c["value"] for c in cases if c["variance"] == 0.0] == [0.0]
    assert [c["value"] for c in cases if c["variance"] < 0] == [None]
    for c in cases:
        assert c["value"] == expected_max_sr0(c["variance"], c["n_trials"], c["gamma"])


def test_psr_cases():
    cases = golden()["psr_cases"]
    assert [c["value"] is None for c in cases] == [False] * 8 + [True] * 4
    for c in cases[:8]:
        term = 1 - c["skew"] * c["sr"] + (c["kurt"] - 1) / 4 * c["sr"] ** 2
        z = (c["sr"] - c["sr0"]) * math.sqrt(c["n"] - 1) / math.sqrt(term)
        assert c["value"] == pytest.approx(0.5 * math.erfc(-z / math.sqrt(2)), rel=1e-12)  # erfc keeps the small tail
    assert cases[3]["value"] == 0.5  # SR on the bar
    assert cases[4]["value"] < 1e-15  # far below the bar
    assert cases[2]["value"] < 0.5 < cases[0]["value"]


# ---- born failing ----------------------------------------------------------------------------------------------

def test_the_matching_pearson_average_pipeline_passes():
    g = golden()
    x = returns_of(g)
    r = np.corrcoef(x, rowvar=False)
    assert status(r, g["correlation"], 1e-12) == PASS
    assert status(np.linalg.eigvalsh(r)[::-1], g["eigenvalues"], 1e-12) == PASS
    assert status(linkage(squareform(1 - r, checks=False), "average")[:, 2], g["linkage_heights"], 1e-12) == PASS


def test_born_failing_spearman_fails_the_comparison():
    g = golden()
    x = returns_of(g)
    ranks = np.column_stack([rankdata(x[:, j]) for j in range(9)])
    spearman = np.corrcoef(ranks, rowvar=False)
    assert status(spearman, g["correlation"], 1e-9) == FAIL
    assert status(np.linalg.eigvalsh(spearman)[::-1], g["eigenvalues"], 1e-9) == FAIL
    # the 360 tied zeros of the trade-like trial are the largest single reason
    assert abs(spearman[8, 6] - g["correlation"][8][6]) > 1e-3 or abs(spearman[8, 7] - g["correlation"][8][7]) > 1e-3


def test_born_failing_single_and_complete_linkage_fail_the_comparison():
    g = golden()
    condensed = squareform(1 - np.array(g["correlation"]), checks=False)
    single = linkage(condensed, "single")[:, 2]
    complete = linkage(condensed, "complete")[:, 2]
    assert status(single, g["linkage_heights"]) == FAIL
    assert status(complete, g["linkage_heights"]) == FAIL
    assert single[-1] < g["linkage_heights"][-1] < complete[-1]  # chaining on one side, the farthest pair on the other


def test_born_failing_v_instead_of_v0_and_n_15_fail_the_comparison():
    anchor = golden()["sv3_anchor"]
    served = anchor["sr0_null_session"]
    assert status(expected_max_sr0(anchor["variance"], 21, GAMMA), served) == FAIL  # V (0.0278) instead of V0
    assert status(expected_max_sr0(V0, 15, GAMMA), served) == FAIL  # the N of the plan, not the served 21
    assert status(expected_max_sr0(V0, 21, GAMMA), served) == PASS
    row = anchor["rows"][0]
    wrong_bar = expected_max_sr0(anchor["variance"], 21, GAMMA)
    wrong = probabilistic_sharpe(row["sr"], wrong_bar, row["n"], row["skew"], row["kurt"])
    assert status(wrong, row["dsr_null"]) == FAIL


def test_born_failing_kurtosis_as_excess_or_n_instead_of_n_minus_1_fails():
    example = golden()["paper_example"]
    sr, sr0 = example["sr"], example["sr0"]
    excess = probabilistic_sharpe(sr, sr0, 1250, -3.0, 10.0 - 3.0)
    n_only = float(norm.cdf((sr - sr0) * math.sqrt(1250) / math.sqrt(1 + 3 * sr + 9 / 4 * sr * sr)))
    assert status(excess, example["dsr"]) == FAIL
    assert status(n_only, example["dsr"]) == FAIL
    assert status(example["dsr"], 0.9003968344493904) == PASS


# ---- the golden file and its command line ----------------------------------------------------------------------

def test_golden_shape_and_coverage():
    g = build_golden()
    assert g["source"] == "qa/crosscheck/p12_neff.py" and g["seed"] == 20260928
    assert g["numpy"] == np.__version__ and g["scipy"] == scipy.__version__ == "1.18.1"
    assert sorted(g) == sorted([
        "source", "numpy", "scipy", "seed", "panel", "correlation", "eigenvalues", "participation_ratio", "li_ji",
        "linkage", "linkage_heights", "cluster_cut", "clusters", "cluster_sweep", "eigen_cases", "inversion_case",
        "sr0_cases", "psr_cases", "session_sharpe", "paper_example", "sv3_anchor"])
    assert sorted(g["panel"]) == ["columns", "dates", "names"]
    assert len(g["correlation"]) == 9 and all(len(row) == 9 for row in g["correlation"])
    # the golden values are numpy's and scipy's own, not a recomputation through the reference functions
    r = np.corrcoef(returns_of(g), rowvar=False)
    assert g["correlation"] == r.tolist()
    assert g["eigenvalues"] == [float(x) for x in np.linalg.eigvalsh(r)[::-1]]
    assert g["linkage_heights"] == [float(h) for h in linkage(squareform(1 - r, checks=False), "average")[:, 2]]
    assert all(math.isfinite(x) for x in g["eigenvalues"] + g["linkage_heights"])


def test_write_then_check_returns_zero(tmp_path, capsys):
    path = tmp_path / "p12_neff.json"
    assert main(["--write", str(path)]) == 0
    text = path.read_text()
    assert text.endswith("}\n") and not text.endswith("\n\n")
    assert text == json.dumps(json.loads(text), indent=1, sort_keys=True, allow_nan=False) + "\n"
    assert text == render(build_golden())
    assert main(["--check", str(path)]) == 0
    assert capsys.readouterr().out == ""


def test_the_committed_golden_file_is_current():
    assert GOLDEN.exists(), "run: uv run python -m crosscheck.p12_neff --write golden/p12_neff.json"
    assert main(["--check", str(GOLDEN)]) == 0


def test_a_tampered_copy_returns_one_and_names_the_first_difference(tmp_path, capsys):
    path = tmp_path / "tampered.json"
    g = golden()
    g["panel"]["columns"][3][10] += 1e-12
    path.write_text(json.dumps(g, indent=1, sort_keys=True, allow_nan=False) + "\n")
    assert main(["--check", str(path)]) == 1
    assert "panel.columns[3][10]" in capsys.readouterr().out
    g = golden()
    g["linkage_heights"][2] += 1e-12
    path.write_text(json.dumps(g, indent=1, sort_keys=True, allow_nan=False) + "\n")
    assert main(["--check", str(path)]) == 1
    assert "linkage_heights[2]" in capsys.readouterr().out


def test_a_missing_or_shortened_copy_returns_one(tmp_path, capsys):
    assert main(["--check", str(tmp_path / "absent.json")]) == 1
    short = tmp_path / "short.json"
    g = golden()
    g["clusters"].pop()
    short.write_text(json.dumps(g, sort_keys=True) + "\n")
    assert main(["--check", str(short)]) == 1
    assert "clusters" in capsys.readouterr().out


def test_the_command_line_needs_exactly_one_mode():
    with pytest.raises(SystemExit):
        main([])
    with pytest.raises(SystemExit):
        main(["--write", "a.json", "--check", "b.json"])


def test_module_entry_point_exits_zero_on_the_committed_file():
    done = subprocess.run([sys.executable, "-m", "crosscheck.p12_neff", "--check", "golden/p12_neff.json"],
                          cwd=QA_DIR, capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stdout + done.stderr
