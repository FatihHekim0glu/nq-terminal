"""Tests for the DQ references (TASKS Phase 11: RI4 day-state counts, RI5 guard fingerprints). Hand values and
born-failing cases, in memory only."""
from __future__ import annotations

import hashlib
import json

import pytest

from crosscheck.p11_dq import dq_nq_references, dq_sidecar_references, guards_references

SIDECAR = {"status": "repaired", "fence": "2021-12-31", "sessions": {
    "2011-01-03": "vendor", "2011-01-04": "rebuilt", "2011-01-05": "candidate_not_repaired",
    "2011-01-06": "vendor", "2022-01-03": "rebuilt"}}


def test_sidecar_counts_by_hand():
    refs = dq_sidecar_references(SIDECAR)
    assert refs["counts"].value == {"vendor": 2, "gated_out": 0, "rejected": 0, "rebuilt": 1, "unrepairable": 1,
                                    "sessions": 4}


def test_a_failed_symbol_counts_candidates_as_gated_out():
    refs = dq_sidecar_references({**SIDECAR, "status": "not_repaired"})
    assert refs["counts"].value["gated_out"] == 1 and refs["counts"].value["unrepairable"] == 0


def test_an_unknown_source_fails_born_failing():
    with pytest.raises(ValueError):
        dq_sidecar_references({**SIDECAR, "sessions": {"2011-01-03": "invented"}})


def test_nq_counts_by_hand():
    inputs = {"fence": "2021-12-31", "sessions": ["2011-01-03", "2011-01-04", "2011-01-05"],
              "rejected": ["2011-01-04", "2011-01-05", "2022-01-03"], "still": ["2011-01-05"]}
    assert dq_nq_references(inputs)["counts"].value == {"vendor": 1, "gated_out": 0, "rejected": 0, "rebuilt": 1,
                                                        "unrepairable": 1, "sessions": 3}
    no_repair = dq_nq_references({**inputs, "still": None})["counts"].value
    assert no_repair["rejected"] == 2 and no_repair["rebuilt"] == 0


def test_guard_fingerprints_and_statuses():
    groups = {"A": {"x": 1.0, "y": "s"}, "B": {"z": [1, 2]}, "C": {"w": 0}}
    sha_a = hashlib.sha256(json.dumps({"y": "s", "x": 1.0}, sort_keys=True).encode("utf-8")).hexdigest()
    refs = guards_references({"groups": groups, "records": {"A": sha_a, "B": "0" * 64, "C": None}})
    assert refs["status"].value == {"A": "OK", "B": "MISMATCH", "C": "NO RECORD"}
    assert refs["live_sha256"].value["A"] == sha_a


def test_a_changed_value_changes_the_fingerprint_born_failing():
    base = guards_references({"groups": {"A": {"x": 1.0}}, "records": {}})["live_sha256"].value["A"]
    moved = guards_references({"groups": {"A": {"x": 1.5}}, "records": {}})["live_sha256"].value["A"]
    assert base != moved


def test_guard_rows_compare_the_words_and_hashes_exactly():
    # The RI5 references are words and sha256 strings: the crosscheck's own row logic compares them exactly.
    from crosscheck import compare

    groups = {"CONSTANTS": {"nq_tick": 0.25}, "SIZING_GUARDS": {"cap": 2.0}}
    live = {n: hashlib.sha256(json.dumps(v, sort_keys=True).encode("utf-8")).hexdigest() for n, v in groups.items()}
    refs = guards_references({"groups": groups, "records": {"CONSTANTS": live["CONSTANTS"], "SIZING_GUARDS": None}})
    ours = {"live_sha256": live, "status": {"CONSTANTS": "OK", "SIZING_GUARDS": "NO RECORD"}}
    rows = [r for k, ref in refs.items() for r in compare._rows_for("hand", k, ref, {"ours": ours}, {})]
    assert [r.status for r in rows] == [compare.PASS, compare.PASS]


def test_a_changed_guard_status_fails_the_row_born_failing():
    from crosscheck import compare

    groups = {"CONSTANTS": {"nq_tick": 0.25}}
    refs = guards_references({"groups": groups, "records": {"CONSTANTS": "0" * 64}})
    [row] = compare._rows_for("hand", "status", refs["status"], {"ours": {"status": {"CONSTANTS": "OK"}}}, {})
    assert refs["status"].value == {"CONSTANTS": "MISMATCH"} and row.status == compare.FAIL
