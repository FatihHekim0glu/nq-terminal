"""Tests for the DQ references (TASKS Phase 11: RI4 day-state counts, RI5 guard fingerprints). Hand values and
born-failing cases, in memory only."""
from __future__ import annotations

import hashlib
import json

import pytest

from crosscheck.p11_dq import (SEALED_LAST, P11_DQ_REFERENCES, dq_nq_references, dq_sidecar_references,
                               dq_universe_references, guards_references)

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


# ---- the universe matrix (research_ux item 3) ---------------------------------------------------------------------
FENCE = "2021-12-31"
GC = {"kind": "sidecar", "status": "repaired", "first_ts": "2010-09-30 00:00:00+00:00",
      "last_ts": "2021-12-31 21:59:00+00:00", "sessions": {
          "2011-01-03": "vendor", "2011-01-04": "rebuilt", "2011-01-05": "candidate_not_repaired",
          "2012-01-03": "vendor", "2022-01-03": "rebuilt"}}
ES = {"kind": "sidecar", "status": "not_repaired", "first_ts": "2010-09-30 00:00:00+00:00",
      "last_ts": "2021-12-30 21:59:00+00:00", "sessions": {
          "2011-01-03": "vendor", "2011-01-04": "candidate_not_repaired", "2011-01-05": "candidate_not_repaired"}}
NQ = {"kind": "nq", "first_ts": "2010-09-29 00:01:00+00:00", "last_ts": "2026-09-24 23:59:00+00:00",
      "sessions": ["2011-01-03", "2011-01-04", "2011-01-05", "2012-01-03", "2022-01-03"],
      "rejected": ["2011-01-04", "2011-01-05", "2022-01-03"], "still": ["2011-01-05"]}
UNIVERSE = {"fence": FENCE, "years": list(range(2010, 2022)), "roots": {"GC": GC, "ES": ES, "NQ": NQ}}


def universe_cells() -> dict:
    return dq_universe_references(UNIVERSE)["cells"].value


def test_universe_cells_by_hand():
    c = universe_cells()
    # GC repaired: 2011 has vendor 1, rebuilt 1 (usable), one candidate not repaired (unrepairable)
    assert [c[f"GC|repaired|2011|{f}"] for f in ("sessions", "usable", "unrepairable", "gated_out")] == [3, 2, 1, 0]
    # GC vendor variant: the rebuilt day is dropped, so gated out
    assert [c[f"GC|vendor|2011|{f}"] for f in ("usable", "gated_out", "unrepairable")] == [1, 1, 1]
    assert c["GC|repaired|2012|usable"] == 1 and c["GC|repaired|2013|sessions"] == 0
    # ES failed validation: one variant, both candidates gated out
    assert [c[f"ES|vendor|2011|{f}"] for f in ("usable", "gated_out", "unrepairable")] == [1, 2, 0]
    assert not any(k.startswith("ES|repaired") for k in c)
    # NQ: rebuilt 2011-01-04 (usable when repaired, rejected by the gate in the vendor variant), still rejected 01-05
    assert [c[f"NQ|repaired|2011|{f}"] for f in ("sessions", "usable", "unrepairable", "rejected")] == [3, 2, 1, 0]
    assert [c[f"NQ|vendor|2011|{f}"] for f in ("usable", "rejected", "unrepairable")] == [1, 1, 1]


def test_a_planted_2022_session_is_in_no_cell_born_failing():
    c = universe_cells()
    assert not any("|2022|" in k for k in c)
    assert sum(c[f"GC|repaired|{y}|sessions"] for y in range(2010, 2022)) == 4  # the 2022 rebuilt day is not counted
    assert sum(c[f"NQ|repaired|{y}|sessions"] for y in range(2010, 2022)) == 4


def test_a_candidate_not_repaired_is_never_usable_born_failing():
    c = universe_cells()
    assert c["ES|vendor|2011|usable"] == 1  # only the vendor day; both candidates are gated out
    assert c["GC|repaired|2011|usable"] == 2 and c["GC|repaired|2011|unrepairable"] == 1  # not 3


def test_bars_are_dates_up_to_the_fence_and_sealed_text_past_it_born_failing():
    refs = dq_universe_references(UNIVERSE)
    assert refs["last_bar"].value == {"GC": "2021-12-31", "ES": "2021-12-30", "NQ": SEALED_LAST}
    assert refs["first_bar"].value["NQ"] == "2010-09-29"
    assert "2026" not in str(refs["last_bar"].value)


def test_the_sidecar_and_nq_references_are_unchanged_by_the_shared_sets():
    assert dq_sidecar_references({"status": "repaired", "fence": FENCE, "sessions": {"2011-01-03": "vendor"}})[
        "counts"].value["sessions"] == 1
    assert "dq_universe" in P11_DQ_REFERENCES


def test_a_terminal_that_counts_a_candidate_usable_fails_the_row_born_failing():
    from crosscheck import compare

    refs = dq_universe_references(UNIVERSE)
    good = dict(refs["cells"].value)
    [row] = compare._rows_for("hand", "cells", refs["cells"], {"ours": {"cells": good}}, {})
    assert row.status == compare.PASS
    bad = {**good, "ES|vendor|2011|usable": 3}
    [row] = compare._rows_for("hand", "cells", refs["cells"], {"ours": {"cells": bad}}, {})
    assert row.status == compare.FAIL


def test_a_last_bar_shown_as_a_date_fails_the_row_born_failing():
    from crosscheck import compare

    refs = dq_universe_references(UNIVERSE)
    ours = {"last_bar": {"GC": "2021-12-31", "ES": "2021-12-30", "NQ": "2026-09-24"}}
    [row] = compare._rows_for("hand", "last_bar", refs["last_bar"], {"ours": ours}, {})
    assert row.status == compare.FAIL


# ---- the universe matrix as a dump kind (`crosscheck --strict` reads it; writer test_dump_for_qa_dq_universe.py) ----
def universe_doc(ours: dict | None = None) -> dict:
    from crosscheck import dumps

    refs = dq_universe_references(UNIVERSE)
    values = ours if ours is not None else {k: ref.value for k, ref in refs.items()}
    return {"schema": dumps.SCHEMA, "kind": "dq_universe", "case": "universe", "source": "test", "inputs": UNIVERSE,
            "values": {"ours": values}, "missing": {}}


def universe_statuses(doc: dict) -> dict[str, str]:
    from crosscheck import compare, dumps

    return {row.metric: row.status for row in compare.compare_any(dumps.parse_any(doc))}


def test_dq_universe_is_a_dump_kind_the_cross_check_reads_and_passes_born_failing():
    from crosscheck import compare, dumps

    assert dumps.BUNDLE_INPUTS["dq_universe"] == ("fence", "years", "roots")
    assert "dq_universe" in compare.BUNDLE_REFERENCES
    assert universe_statuses(universe_doc()) == {"cells": compare.PASS, "first_bar": compare.PASS,
                                                 "last_bar": compare.PASS}


def test_a_served_universe_with_a_wrong_cell_or_an_unsealed_last_bar_fails_born_failing():
    from crosscheck import compare

    refs = dq_universe_references(UNIVERSE)
    ours = {k: dict(ref.value) for k, ref in refs.items()}
    ours["cells"]["GC|repaired|2011|usable"] += 1
    ours["last_bar"]["NQ"] = "2026-09-24"
    assert universe_statuses(universe_doc(ours)) == {"cells": compare.FAIL, "first_bar": compare.PASS,
                                                     "last_bar": compare.FAIL}


def test_a_universe_dump_without_the_roots_is_refused():
    import pytest as _pytest
    from crosscheck import dumps

    doc = universe_doc()
    del doc["inputs"]["roots"]
    with _pytest.raises(dumps.DumpError):
        dumps.parse_any(doc)
