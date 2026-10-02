"""The served effective numbers as a bridge file for the browser's mirror test (SV3b and SV8 step 8; C8).

`terminal/qa/golden/p2_neff_served.json` holds what the backend serves for the seeded golden panel of
`p12_neff.json` (a synthetic `DeflatedView`, `effective_n` included, over nine daily trials and two monthly books) and
for a few correlation matrices (`SpaView.effective_members`). The web tests (`src/screens/reg/neffMirror.test.ts`)
recompute the same numbers with the browser reference estimators (`src/quant`), kept as a test reference only, and
require them to match to 1e-12 relative (integers and labels exactly): that is the mirror equality, checked on the
golden vectors and fixtures the browser was pinned to. The gallery draws the same file, labelled not research data.

This test fails when the file is stale. Rewrite it with `NQT_UPDATE_NEFF_BRIDGE=1` (the file is a test artefact, kept
under qa/golden beside the numpy and scipy golden vectors; it never holds research data).
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import numpy as np
import pytest
from test_p2_neff import panel_trials

from nq_terminal.services import tearsheet_extended
from nq_terminal.services.neff_view import effective_members_view

BRIDGE = Path(__file__).resolve().parents[2] / "qa" / "golden" / "p2_neff_served.json"
UPDATE = "NQT_UPDATE_NEFF_BRIDGE"
FLOAT_REL_TOL = 1e-12  # another platform's libm and BLAS move a value by a few last bits
FLOAT_ABS_TOL = 1e-14
NAMES = ["a_v0", "b_v0", "c_v0", "d_v0"]
FOUR = [[1, 0.9, 0.85, 0.1], [0.9, 1, 0.8, 0.05], [0.85, 0.8, 1, 0], [0.1, 0.05, 0, 1]]
SPA_THREE = [[1, 0.12, 0.08], [0.12, 1, 0.61], [0.08, 0.61, 1]]
GAP = [[1, None, 0.2], [None, None, None], [0.2, None, 1]]
TIE = [[1, -0.7, 0.7], [-0.7, 1, 0.1], [0.7, 0.1, 1]]
FIVE = [[1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0.95], [0, 0, 0, 0.95, 1]]
SPA_CASES = (("four", NAMES, FOUR), ("spa_fixture", ["za_v0", "overnight_v0", "halloween_v0"], SPA_THREE),
             ("identical", ["x", "y", "z"], [[1.0] * 3] * 3), ("independent", ["x", "y", "z"], np.eye(3).tolist()),
             ("a_member_without_spread", ["x", "y", "z"], GAP), ("tie_on_the_strongest_pair", ["x", "y", "z"], TIE),
             ("two_clusters_and_singles", list("vwxyz"), FIVE), ("one_member", ["only"], [[1.0]]))


def served_view() -> dict:
    golden = json.loads((BRIDGE.parent / "p12_neff.json").read_text(encoding="utf-8"))
    trials = panel_trials(golden)
    return tearsheet_extended.deflated_view(trials).model_dump(mode="json")


def spa_cases() -> list[dict]:
    out = []
    for name, names, matrix in SPA_CASES:
        dense = np.array([[math.nan if v is None else v for v in row] for row in matrix], dtype=float)
        out.append({"name": name, "names": names, "correlation": matrix,
                    "served": effective_members_view(dense, names).model_dump(mode="json")})
    return out


def build_bridge() -> dict:
    return {"source": "backend/tests/test_p2_neff_bridge.py", "panel": "qa/golden/p12_neff.json",
            "note": "synthetic, seeded: not research data", "sv3b": served_view(), "sv8": spa_cases()}


def first_difference(built, stored, path: str = "") -> str | None:
    """Path of the first key or index where the two JSON values differ (numbers to the tolerance above)."""
    if isinstance(built, dict) and isinstance(stored, dict):
        for key in sorted(set(built) | set(stored)):
            where = f"{path}.{key}" if path else str(key)
            if key not in built or key not in stored:
                return where
            found = first_difference(built[key], stored[key], where)
            if found is not None:
                return found
        return None
    if isinstance(built, list) and isinstance(stored, list):
        for index in range(max(len(built), len(stored))):
            where = f"{path}[{index}]"
            if index >= len(built) or index >= len(stored):
                return where
            found = first_difference(built[index], stored[index], where)
            if found is not None:
                return found
        return None
    if isinstance(built, float) and isinstance(stored, float):
        same = math.isclose(built, stored, rel_tol=FLOAT_REL_TOL, abs_tol=FLOAT_ABS_TOL)
    else:
        same = type(built) is type(stored) and built == stored
    return None if same else (path or "<root>")


def render(bridge: dict) -> str:
    return json.dumps(bridge, indent=1, sort_keys=True, allow_nan=False) + "\n"


@pytest.fixture(scope="module")
def built() -> dict:
    return json.loads(render(build_bridge()))


def test_the_bridge_file_is_what_the_backend_serves(built):
    if os.environ.get(UPDATE) == "1":
        BRIDGE.write_text(render(built), encoding="utf-8", newline="\n")
    assert BRIDGE.is_file(), f"{BRIDGE} is missing: run this test with {UPDATE}=1"
    stored = json.loads(BRIDGE.read_text(encoding="utf-8"))
    where = first_difference(built, stored)
    assert where is None, f"{BRIDGE.name} differs from what the backend serves at {where}: rerun with {UPDATE}=1"


def test_born_failing_a_tampered_number_or_label_is_found():
    base = {"a": [1.0, {"b": 2.0}], "c": "x", "d": None, "e": 3}
    assert first_difference(base, json.loads(json.dumps(base))) is None
    assert first_difference(base, {**base, "a": [1.0, {"b": 2.0 * (1 + 1e-9)}]}) == "a[1].b"
    assert first_difference(base, {**base, "c": "y"}) == "c"
    assert first_difference(base, {**base, "e": 3.0}) == "e"  # an integer stays an integer
    assert first_difference(base, {"a": base["a"], "c": "x", "d": None}) == "e"


def test_the_bridge_view_is_a_served_deflated_view_with_the_effective_trials(built):
    view = built["sv3b"]
    assert view["effective_n"]["refusal"] is None and len(view["effective_n"]["daily"]) == 9
    assert view["effective_n"]["monthly"] == ["m0", "m1"] and view["n_trials"] == 11
    assert [r["name"] for r in view["rows"]] == view["effective_n"]["daily"] + ["m0", "m1"]


def test_the_bridge_spa_cases_cover_each_refusal_and_the_estimators(built):
    kinds = {c["name"]: (c["served"]["refusal"] or {}).get("kind") for c in built["sv8"]}
    assert kinds["a_member_without_spread"] == "undefined" and kinds["one_member"] == "single"
    assert [k for n, k in kinds.items() if k is None] == [None] * 6
