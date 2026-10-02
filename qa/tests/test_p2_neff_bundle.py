"""Tests for the SV3b references the strict crosscheck compares the served `effective_n` with (the C8 mirror).

In memory plus the committed golden file: the `deflated` bundle carries each trial's session dates, and
`deflated_references` then recomputes the effective number of trials with pandas, numpy and scipy only.
Born-failing variants: Spearman, another N, V instead of V0, the monthly books left out of N.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from scipy.stats import rankdata

from crosscheck import compare
from crosscheck.compare import FAIL, PASS
from crosscheck.p1_reference import deflated_references
from crosscheck.p12_neff import SV3_ANCHOR, expected_max_sr0

GOLDEN = Path(__file__).resolve().parents[1] / "golden" / "p12_neff.json"
NEFF_KEYS = ("neff_window_sessions", "neff_correlation", "neff_correlation_numpy", "neff_eigenvalues",
             "neff_participation", "neff_li_ji", "neff_clusters", "neff_n_total", "neff_sr0_session",
             "neff_dsr_participation", "neff_dsr_li_ji", "neff_dsr_clusters")
PAPER = {"n_trials": 100, "variance": 1 / 500, "t": 1250, "skew": -3.0, "kurt": 10.0, "sr": 2.5 / math.sqrt(250)}


def golden() -> dict:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))


def monthly_trials(count: int = 2) -> list[dict]:
    rng = np.random.default_rng(5)
    months = [d.strftime("%Y-%m-%d") for d in pd.date_range("2020-01-31", periods=48, freq="ME")]
    return [{"name": f"m{i}", "periods": 12, "dates": months, "r": (rng.standard_normal(48) * 0.03 + 0.004).tolist()}
            for i in range(count)]


def inputs(monthly: int = 2, dates: bool = True) -> dict:
    g = golden()
    daily = [{"name": n, "periods": 252, "r": col, **({"dates": g["panel"]["dates"]} if dates else {})}
             for n, col in zip(g["panel"]["names"], g["panel"]["columns"])]
    return {"trials": daily + (monthly_trials(monthly) if dates else []), "paper": PAPER}


def rows(refs: dict, ours: dict) -> list:
    return [row for key in ours for row in compare._rows_for("hand", key, refs[key], {"ours": ours}, {})]


def word_of(names: list[str], groups: list[list[int]]) -> str:
    ranked = sorted(groups, key=lambda m: (-len(m), m[0]))
    return ";".join(",".join(names[i] for i in members) for members in ranked)


@pytest.fixture(scope="module")
def refs() -> dict:
    return deflated_references(inputs())


def test_a_bundle_without_dates_has_no_effective_n_reference_and_the_old_keys_stay():
    plain = deflated_references(inputs(dates=False))
    assert not any(k.startswith("neff_") for k in plain) and "dsr_null" in plain


def test_every_effective_n_key_is_a_reference_beside_the_old_ones(refs):
    assert all(key in refs for key in NEFF_KEYS) and "dsr_null" in refs and "variance_null" in refs


def test_the_matrix_eigenvalues_and_estimators_equal_the_golden_vectors(refs):
    g = golden()
    got = refs["neff_correlation"].value
    names = g["panel"]["names"]
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            if i <= j:
                assert got[f"{a}|{b}"] == pytest.approx(g["correlation"][i][j], rel=1e-12, abs=1e-14)
    assert refs["neff_eigenvalues"].value == pytest.approx(g["eigenvalues"], rel=1e-12)
    assert refs["neff_participation"].value == pytest.approx(g["participation_ratio"], rel=1e-12)
    assert refs["neff_li_ji"].value == pytest.approx(g["li_ji"], rel=1e-12)
    assert refs["neff_window_sessions"].value == 400.0


def test_the_clusters_word_is_the_golden_clusters_largest_first(refs):
    g = golden()
    assert refs["neff_clusters"].value == word_of(g["panel"]["names"], g["clusters"])


def test_n_total_adds_the_monthly_books_and_the_sr0_is_at_v0(refs):
    g = golden()
    n = refs["neff_n_total"].value
    assert n["participation"] == pytest.approx(g["participation_ratio"] + 2, rel=1e-12)
    assert n["li_ji"] == pytest.approx(g["li_ji"] + 2, rel=1e-12)
    assert n["clusters"] == len(g["clusters"]) + 2
    assert set(refs["neff_sr0_session"].value) == {"registered", "participation", "li_ji", "clusters"}
    v0, gamma = refs["variance_null"].value, SV3_ANCHOR["euler_gamma"]
    assert refs["neff_sr0_session"].value["li_ji"] == pytest.approx(expected_max_sr0(v0, n["li_ji"], gamma), rel=1e-12)
    assert refs["neff_sr0_session"].value["registered"] == refs["sr0_null_session"].value


def test_the_dsr_references_cover_every_trial_in_its_own_period(refs):
    for key in ("neff_dsr_participation", "neff_dsr_li_ji", "neff_dsr_clusters"):
        assert len(refs[key].value) == 11 and all(0.0 <= v <= 1.0 for v in refs[key].value.values())
    served = refs["dsr_null"].value
    # a smaller N lowers SR0, so no DSR falls below the one at the registered N
    assert all(refs["neff_dsr_li_ji"].value[n] >= served[n] - 1e-12 for n in served)


def test_the_references_pass_themselves(refs):
    ours = {key: refs[key].value for key in NEFF_KEYS}
    assert all(r.status == PASS for r in rows(refs, ours))


def test_the_numpy_correlation_is_a_second_exact_reference_against_the_first(refs):
    assert refs["neff_correlation_numpy"].against == "neff_correlation" and refs["neff_correlation"].against == ""
    assert refs["neff_correlation_numpy"].value == pytest.approx(refs["neff_correlation"].value, rel=1e-12, abs=1e-14)


def test_born_failing_spearman_another_n_and_another_cluster_word_are_caught(refs):
    g = golden()
    names = g["panel"]["names"]
    ranks = np.apply_along_axis(rankdata, 0, np.array(g["panel"]["columns"]).T)
    spearman = np.corrcoef(ranks, rowvar=False)
    wrong = {f"{a}|{b}": float(spearman[i][j]) for i, a in enumerate(names) for j, b in enumerate(names) if i <= j}
    assert [r.status for r in rows(refs, {"neff_correlation": wrong})] == [FAIL]
    n = dict(refs["neff_n_total"].value, participation=refs["neff_n_total"].value["participation"] - 2)
    assert [r.status for r in rows(refs, {"neff_n_total": n})] == [FAIL]
    one_cluster = ",".join(names)
    assert [r.status for r in rows(refs, {"neff_clusters": one_cluster})] == [FAIL]


def test_born_failing_the_sr0_at_v_instead_of_v0_is_not_the_reference(refs):
    n = refs["neff_n_total"].value["li_ji"]
    wrong = expected_max_sr0(refs["variance"].value, n, SV3_ANCHOR["euler_gamma"])
    assert wrong != pytest.approx(refs["neff_sr0_session"].value["li_ji"], rel=1e-6)
    bad = dict(refs["neff_sr0_session"].value, li_ji=wrong)
    assert [r.status for r in rows(refs, {"neff_sr0_session": bad})] == [FAIL]


def test_born_failing_the_monthly_books_left_out_of_n_total_are_caught():
    without = deflated_references(inputs(monthly=0))
    withm = deflated_references(inputs(monthly=2))
    assert without["neff_n_total"].value["li_ji"] == pytest.approx(withm["neff_n_total"].value["li_ji"] - 2, rel=1e-12)
    assert [r.status for r in rows(withm, {"neff_n_total": without["neff_n_total"].value})] == [FAIL]


def test_a_window_below_252_sessions_or_no_daily_trial_gives_no_reference():
    short = inputs()
    for t in short["trials"]:
        if t["periods"] == 252:
            t["dates"], t["r"] = t["dates"][:251], t["r"][:251]
    assert not any(k.startswith("neff_") for k in deflated_references(short))
    assert not any(k.startswith("neff_") for k in deflated_references({"trials": monthly_trials(3), "paper": PAPER}))


def test_the_common_window_is_the_dates_every_daily_trial_has():
    data = inputs()
    first = data["trials"][0]
    first["dates"], first["r"] = first["dates"][10:], first["r"][10:]
    assert deflated_references(data)["neff_window_sessions"].value == 390.0
