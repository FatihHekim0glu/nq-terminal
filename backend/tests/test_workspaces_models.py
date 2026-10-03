"""The seven workspace documents: names, caps (413) and shapes (422) of 03 section 10.2 (D3.1)."""
from __future__ import annotations

import json

import pytest

from nq_terminal.models import workspaces as ws

PANEL = {"line": "HOME", "group": "-", "ref": None, "direction": "right"}
GROUPS = {"A": None, "B": None, "C": {"kind": "instrument", "value": "NQ"}}
RECIPE = {"version": 1, "panels": [PANEL, {"line": "GP NQ", "group": "A", "ref": 0, "direction": "below"}],
          "groups": GROUPS}


def chars(value: object) -> int:
    return len(json.dumps(value, separators=(",", ":")))


def test_the_seven_names_are_exactly_these():
    assert ws.DOC_NAMES == ("workspaces", "layouts", "linkGroups", "watch", "history", "prefs", "meta")


@pytest.mark.parametrize("doc", ws.DOC_NAMES)
def test_every_default_is_a_valid_document(doc):
    assert ws.clean(doc, ws.default_data(doc)) == ws.default_data(doc)


def test_the_default_of_meta_carries_the_backend_schema_and_no_imports():
    assert ws.default_data("meta") == {"schema": ws.SCHEMA, "imports": []}


def test_defaults_are_fresh_copies():
    first = ws.default_data("history")
    first.append("X")
    assert ws.default_data("history") == []


def test_an_unknown_document_is_refused():
    with pytest.raises(ws.UnknownDocument):
        ws.clean("secrets", {})
    with pytest.raises(ws.UnknownDocument):
        ws.default_data("..")


# ---------------------------------------------------------------- workspaces

def good_workspaces(count: int = 1) -> dict:
    return {"list": {f"WS{n:02d}": RECIPE for n in range(count)}, "last": "WS00"}


def test_twelve_recipes_are_stored_and_a_thirteenth_is_over_the_cap():
    assert ws.clean("workspaces", good_workspaces(12))["list"].keys() == good_workspaces(12)["list"].keys()
    with pytest.raises(ws.TooLarge):
        ws.clean("workspaces", good_workspaces(13))


def test_a_recipe_of_more_than_20000_characters_is_over_the_cap():
    big = {**RECIPE, "panels": [PANEL] + [{"line": "GP NQ", "group": "A", "ref": 0, "direction": "below"}] * 700}
    assert chars(big) > ws.MAX_RECIPE_CHARS
    with pytest.raises(ws.TooLarge):
        ws.clean("workspaces", {"list": {"BIG": big}, "last": None})


@pytest.mark.parametrize("mutate", [
    lambda d: d["list"].update({"lower": RECIPE}),                                  # name pattern
    lambda d: d["list"].update({"BUYNOW": RECIPE}),                                 # an order ticket word
    lambda d: d["list"].update({"WS_SELL": RECIPE}),
    lambda d: d.update({"extra": 1}),                                               # an unknown field
    lambda d: d.update({"last": 5}),
    lambda d: d["list"]["WS00"].update({"version": 2}),
    lambda d: d["list"]["WS00"].update({"panels": []}),
    lambda d: d["list"]["WS00"]["panels"][0].update({"ref": 0}),                    # the first panel has no parent
    lambda d: d["list"]["WS00"]["panels"][1].update({"ref": 1}),                    # a parent must come earlier
    lambda d: d["list"]["WS00"]["panels"][0].update({"line": "x" * 201}),
    lambda d: d["list"]["WS00"]["panels"][0].update({"line": "A;B"}),               # outside the command alphabet
    lambda d: d["list"]["WS00"]["panels"][0].update({"group": "Z"}),
    lambda d: d["list"]["WS00"]["panels"][0].update({"direction": "left"}),
    lambda d: d["list"]["WS00"]["panels"][0].update({"pad": 1}),
    lambda d: d["list"]["WS00"]["groups"].update({"A": {"kind": "order", "value": "NQ"}}),
    lambda d: d["list"]["WS00"]["groups"].pop("B"),
    lambda d: d.update({"list": []}),
])
def test_a_workspaces_document_with_a_bad_field_is_refused(mutate):
    data = json.loads(json.dumps(good_workspaces()))
    mutate(data)
    with pytest.raises(ws.InvalidDocument):
        ws.clean("workspaces", data)


def test_the_merge_copies_of_a_workspace_name_are_allowed():
    data = {"list": {"ALPHA": RECIPE, "ALPHA (conflict)": RECIPE, "ALPHA (imported)": RECIPE}, "last": None}
    assert set(ws.clean("workspaces", data)["list"]) == set(data["list"])


# ---------------------------------------------------------------- layouts

def test_layouts_are_keyed_by_screen_code_and_each_layout_is_capped():
    assert ws.clean("layouts", {"HOME": {"grid": 1}, "GP": {}}) == {"HOME": {"grid": 1}, "GP": {}}
    big = {"pad": "x" * ws.MAX_LAYOUT_CHARS}
    with pytest.raises(ws.TooLarge):
        ws.clean("layouts", {"HOME": big})
    for bad in ({"home": {}}, {"HOME": []}, {"HOME": "x"}, {"X": {}}, []):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("layouts", bad)


def test_a_layout_copy_is_kept_under_its_screen_code_with_the_conflict_or_imported_suffix():
    ok = {"HOME": {"a": 1}, "HOME (imported)": {"a": 2}, "GP (conflict)": {}}
    assert ws.clean("layouts", ok) == ok
    for bad in ({"HOME (other)": {}}, {"HOME (imported) (imported)": {}}, {"home (imported)": {}},
                {" (imported)": {}}, {"HOME(imported)": {}}, {"HOME (imported) ": {}}, {"X (imported)": {}}):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("layouts", bad)


def test_more_than_64_layouts_are_over_the_cap():
    with pytest.raises(ws.TooLarge):
        ws.clean("layouts", {f"S{n:03d}": {} for n in range(65)})


# ---------------------------------------------------------------- linkGroups

def test_link_groups_hold_three_contexts_in_eight_kilobytes():
    data = {"contexts": {"A": None, "B": {"kind": "run", "value": "r_1.2-x"}, "C": None}}
    assert ws.clean("linkGroups", data) == data
    with pytest.raises(ws.TooLarge):
        ws.clean("linkGroups", {**data, "pad": "x" * 8200})
    for bad in ({"contexts": {"A": None, "B": None}}, {"contexts": {"A": None, "B": None, "C": {"kind": "x", "value": "a"}}},
                {"contexts": {"A": None, "B": None, "C": {"kind": "run", "value": "a b"}}}, {"other": 1}):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("linkGroups", bad)


# ---------------------------------------------------------------- watch, history, prefs

def test_watch_is_an_object_of_at_most_200000_characters():
    assert ws.clean("watch", {"seen": [1, 2]}) == {"seen": [1, 2]}
    with pytest.raises(ws.TooLarge):
        ws.clean("watch", {"pad": "x" * ws.MAX_WATCH_CHARS})
    with pytest.raises(ws.InvalidDocument):
        ws.clean("watch", [1])


def test_history_keeps_100_lines_of_up_to_200_characters():
    assert ws.clean("history", ["HOME", "GP NQ"]) == ["HOME", "GP NQ"]
    assert len(ws.clean("history", ["L"] * 100)) == 100
    with pytest.raises(ws.TooLarge):
        ws.clean("history", ["L"] * 101)
    for bad in ([1], ["  "], ["x" * 201], {"a": 1}, "HOME"):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("history", bad)


def test_prefs_take_five_named_fields_in_four_kilobytes():
    data = {"tape": True, "cvd": "off", "theme": "dark", "orientation": 1, "mon": {"a": [1]}}
    assert ws.clean("prefs", data) == data
    with pytest.raises(ws.TooLarge):
        ws.clean("prefs", {"theme": "x" * 4100})
    for bad in ({"other": 1}, ["tape"]):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("prefs", bad)


# ---------------------------------------------------------------- meta

def test_meta_shape_and_caps():
    entry = {"origin": "http://127.0.0.1:8765", "at": "2026-10-02T10:00:00Z"}
    assert ws.clean("meta", {"schema": 1, "imports": [entry]}) == {"schema": 1, "imports": [entry]}
    with pytest.raises(ws.TooLarge):
        ws.clean("meta", {"schema": 1, "imports": [{"origin": f"http://127.0.0.1:{n}", "at": "t"} for n in range(17)]})
    for bad in ({"schema": "1", "imports": []}, {"schema": 1}, {"schema": 1, "imports": [{"origin": "o"}]},
                {"schema": 1, "imports": [], "x": 1}, {"schema": 1, "imports": [{"origin": 5, "at": "t"}]}):
        with pytest.raises(ws.InvalidDocument):
            ws.clean("meta", bad)


def test_the_body_limit_of_each_document_is_its_cap_plus_a_margin():
    assert ws.body_limit("history") < ws.body_limit("watch") < ws.body_limit("layouts")
    assert ws.body_limit("meta") >= ws.MAX_META_CHARS
