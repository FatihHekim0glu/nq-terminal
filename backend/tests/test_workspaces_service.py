"""The workspace store: versions, atomic writes, five kept copies, one folder (03 section 10.3, D3.1, G03)."""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from nq_terminal.models import workspaces as ws
from nq_terminal.services import workspaces as store_module
from nq_terminal.services.workspaces import WorkspaceStore

ORIGIN = "http://127.0.0.1:50000"
FIXED = datetime(2026, 10, 2, 12, 0, 30, tzinfo=timezone.utc)


@pytest.fixture
def state(tmp_path: Path) -> Path:
    folder = tmp_path / "state"
    folder.mkdir()
    return folder


@pytest.fixture
def store(state: Path) -> WorkspaceStore:
    return WorkspaceStore(state, clock=lambda: FIXED)


def files(state: Path) -> list[str]:
    return sorted(str(p.relative_to(state)).replace("\\", "/") for p in state.rglob("*") if p.is_file())


def test_a_missing_document_reads_as_its_default_at_version_zero(store, state):
    document = store.read("history")
    assert (document.version, document.saved_at, document.data) == (0, None, [])
    assert files(state) == [] and not (state / "workspaces").exists()  # a read creates nothing


def test_the_index_lists_the_seven_documents_in_order(store):
    index = store.index()
    assert [entry.doc for entry in index] == list(ws.DOC_NAMES)
    assert {entry.version for entry in index} == {0}


def test_a_write_returns_the_next_version_and_the_backends_time(store, state):
    first = store.write("history", ["HOME"], 0)
    second = store.write("history", ["HOME", "GP NQ"], 1)
    assert (first.version, second.version) == (1, 2)
    assert second.saved_at == "2026-10-02T12:00:30Z"
    assert store.read("history").data == ["HOME", "GP NQ"]
    stored = json.loads((state / "workspaces" / "history.json").read_text(encoding="utf-8"))
    assert stored["version"] == 2 and stored["data"] == ["HOME", "GP NQ"] and stored["saved_at"] == "2026-10-02T12:00:30Z"


def test_a_stale_version_is_refused_and_changes_nothing(store, state):
    store.write("history", ["A"], 0)
    for stale in (0, 2, 7):
        with pytest.raises(store_module.VersionConflict) as caught:
            store.write("history", ["B"], stale)
        assert caught.value.current == 1
    assert store.read("history").data == ["A"]
    assert files(state) == ["workspaces/history.json"]


def test_an_over_cap_or_invalid_document_is_refused_before_the_version_check(store):
    with pytest.raises(ws.TooLarge):
        store.write("history", ["L"] * 101, 99)
    with pytest.raises(ws.InvalidDocument):
        store.write("history", "no", 99)


def test_five_older_versions_are_kept_as_dot_one_to_dot_five(store, state):
    for version in range(8):
        store.write("history", [f"V{version + 1}"], version)
    folder = state / "workspaces"
    assert sorted(p.name for p in folder.iterdir()) == ["history.json"] + [f"history.json.{n}" for n in range(1, 6)]
    seen = {name: json.loads((folder / name).read_text(encoding="utf-8")) for name in sorted(p.name for p in folder.iterdir())}
    assert [seen["history.json"]["version"]] + [seen[f"history.json.{n}"]["version"] for n in range(1, 6)] == [
        8, 7, 6, 5, 4, 3]
    assert seen["history.json.1"]["data"] == ["V7"]


def test_the_first_write_keeps_no_copy_and_the_second_keeps_one(store, state):
    store.write("prefs", {"theme": "dark"}, 0)
    assert files(state) == ["workspaces/prefs.json"]
    store.write("prefs", {"theme": "light"}, 1)
    assert files(state) == ["workspaces/prefs.json", "workspaces/prefs.json.1"]


def test_documents_do_not_share_versions_or_copies(store, state):
    store.write("history", ["A"], 0)
    store.write("prefs", {"theme": "dark"}, 0)
    store.write("history", ["B"], 1)
    assert store.read("prefs").version == 1 and store.read("history").version == 2
    assert files(state) == ["workspaces/history.json", "workspaces/history.json.1", "workspaces/prefs.json"]


def test_nothing_but_the_workspaces_folder_is_written(store, state):
    for doc in ws.DOC_NAMES:
        if doc != "meta":
            for version in range(7):
                store.write(doc, ws.default_data(doc), version)
    store.write("meta", {"schema": 1, "imports": [{"origin": ORIGIN, "at": "x"}]}, 0, session_origin=ORIGIN)
    names = files(state)
    assert names and all(name.startswith("workspaces/") for name in names)
    allowed = {f"{doc}.json{suffix}" for doc in ws.DOC_NAMES for suffix in ("", ".1", ".2", ".3", ".4", ".5")}
    assert {name.split("/", 1)[1] for name in names} <= allowed
    assert [p.name for p in state.iterdir()] == ["workspaces"]


@pytest.mark.parametrize("name", ["..", ".", "", "../history", "..\\history", "history/..", "a/b", "workspaces.json",
                                  "History", "history ", "history\x00", "CON", "meta.json"])
def test_a_name_outside_the_seven_is_refused_everywhere(store, state, name):
    with pytest.raises(ws.UnknownDocument):
        store.read(name)
    with pytest.raises(ws.UnknownDocument):
        store.write(name, [], 0)
    assert files(state) == []


@pytest.mark.parametrize("name", ["../x.json", "..\\x.json", "history.json.6", "history.json.0", "x.json",
                                  "history.json.tmp.tmp", "/history.json", "C:/x.json", "history.json.1/.."])
def test_the_file_confiner_refuses_any_path_that_is_not_one_of_the_store_files(store, name):
    with pytest.raises(store_module.StoreError):
        store._workspace_file(name)


def test_the_folder_may_not_sit_in_a_research_folder(tmp_path):
    from nq_lab.config import ROOT

    hostile = WorkspaceStore(ROOT / "results" / "state-x", clock=lambda: FIXED)
    with pytest.raises(store_module.StoreError):
        hostile.write("history", ["A"], 0)
    assert not (ROOT / "results" / "state-x").exists()


def test_a_client_time_is_never_stored(store):
    document = store.write("watch", {"saved_at": "1999-01-01T00:00:00Z"}, 0)
    assert document.saved_at == "2026-10-02T12:00:30Z"


def test_a_damaged_file_reads_as_missing_and_is_kept_as_the_first_copy(store, state):
    store.write("history", ["A"], 0)
    target = state / "workspaces" / "history.json"
    target.write_bytes(b"{not json")
    assert store.read("history").version == 0
    store.write("history", ["B"], 0)
    assert (state / "workspaces" / "history.json.1").read_bytes() == b"{not json"
    assert store.read("history").data == ["B"]


def test_a_transient_read_fault_is_a_store_error_and_the_version_never_goes_back(store, state, monkeypatch):
    for value in (["A"], ["B"], ["C"]):
        store.write("history", value, store.read("history").version)
    real = Path.read_bytes

    def refused(self):
        if self.name == "history.json":
            raise PermissionError("sharing violation")
        return real(self)

    monkeypatch.setattr(Path, "read_bytes", refused)
    with pytest.raises(store_module.StoreError):
        store.read("history")
    with pytest.raises(store_module.StoreError):
        store.write("history", ["X"], 0)
    with pytest.raises(store_module.StoreError):
        store.write("history", ["X"], 3)
    monkeypatch.undo()
    document = store.read("history")
    assert (document.version, document.data) == (3, ["C"])
    assert not (state / "workspaces" / "history.json.4").exists()


def test_a_failed_replace_leaves_the_old_document_and_no_temporary_file(store, state, monkeypatch):
    store.write("history", ["A"], 0)
    real = os.replace

    def failing(source, target):
        if str(target).endswith("history.json"):
            raise OSError("disk full")
        return real(source, target)

    monkeypatch.setattr(store_module.os, "replace", failing)
    with pytest.raises(store_module.StoreError):
        store.write("history", ["B"], 1)
    monkeypatch.undo()
    assert store.read("history").data == ["A"] and store.read("history").version == 1
    assert not [n for n in files(state) if n.endswith(".tmp")]


def test_two_writers_with_the_same_version_get_one_winner(store):
    results: list[str] = []
    barrier = threading.Barrier(8)

    def writer(n: int) -> None:
        barrier.wait()
        try:
            store.write("history", [f"W{n}"], 0)
            results.append("ok")
        except store_module.VersionConflict:
            results.append("stale")

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == ["ok"] + ["stale"] * 7 and store.read("history").version == 1


# ---------------------------------------------------------------- meta (03 10.2)

def meta(*origins: str, schema: int = 1) -> dict:
    return {"schema": schema, "imports": [{"origin": o, "at": "2026-01-01T00:00:00Z"} for o in origins]}


def test_meta_accepts_one_added_import_for_the_callers_own_origin_and_stamps_the_time(store):
    stored = store.write("meta", meta(ORIGIN), 0, session_origin=ORIGIN)
    assert stored.data == {"schema": 1, "imports": [{"origin": ORIGIN, "at": "2026-10-02T12:00:30Z"}]}


@pytest.mark.parametrize("data", [
    meta("http://127.0.0.1:9"),                                   # another origin
    meta(),                                                        # nothing added
    meta(ORIGIN, "http://127.0.0.1:9"),                            # two added
    meta(ORIGIN, schema=2),                                        # the page may not change the schema
])
def test_a_meta_write_that_is_not_one_own_origin_is_refused(store, data):
    with pytest.raises(ws.InvalidDocument):
        store.write("meta", data, 0, session_origin=ORIGIN)
    assert store.read("meta").data == ws.default_data("meta")


def test_meta_is_never_written_without_a_session_origin(store):
    with pytest.raises(ws.InvalidDocument):
        store.write("meta", meta(ORIGIN), 0)


def test_meta_entries_can_neither_be_removed_nor_edited_nor_repeated(store):
    store.write("meta", meta(ORIGIN), 0, session_origin=ORIGIN)
    other = "http://127.0.0.1:50001"
    store.write("meta", {"schema": 1, "imports": store.read("meta").data["imports"]
                         + [{"origin": other, "at": "x"}]}, 1, session_origin=other)
    current = store.read("meta").data
    assert [e["origin"] for e in current["imports"]] == [ORIGIN, other]
    edited = {"schema": 1, "imports": [{"origin": ORIGIN, "at": "1999-01-01T00:00:00Z"}, current["imports"][1],
                                       {"origin": "http://127.0.0.1:50002", "at": "x"}]}
    removed = {"schema": 1, "imports": [current["imports"][0], {"origin": "http://127.0.0.1:50002", "at": "x"}]}
    again = {"schema": 1, "imports": current["imports"] + [{"origin": other, "at": "x"}]}
    for bad in (edited, removed, again):
        with pytest.raises(ws.InvalidDocument):
            store.write("meta", bad, 2, session_origin="http://127.0.0.1:50002" if bad is not again else other)
    assert store.read("meta").data == current


def test_a_stale_meta_write_gets_the_version_clash_before_the_import_rule(store):
    store.write("meta", meta(ORIGIN), 0, session_origin=ORIGIN)
    with pytest.raises(store_module.VersionConflict):
        store.write("meta", meta("http://127.0.0.1:9"), 0, session_origin="http://127.0.0.1:9")


def test_the_17th_import_is_over_the_cap(store):
    for n in range(16):
        origin = f"http://127.0.0.1:{50000 + n}"
        entries = store.read("meta").data["imports"] + [{"origin": origin, "at": "x"}]
        store.write("meta", {"schema": 1, "imports": entries}, n, session_origin=origin)
    origin = "http://127.0.0.1:50099"
    with pytest.raises(ws.TooLarge):
        store.write("meta", {"schema": 1, "imports": store.read("meta").data["imports"]
                             + [{"origin": origin, "at": "x"}]}, 16, session_origin=origin)


def test_the_schema_on_disk_is_the_backends_own(store, state):
    store.write("meta", meta(ORIGIN), 0, session_origin=ORIGIN)
    stored = json.loads((state / "workspaces" / "meta.json").read_text(encoding="utf-8"))
    assert stored["data"]["schema"] == ws.SCHEMA == 1 and stored["schema_version"] == ws.SCHEMA
