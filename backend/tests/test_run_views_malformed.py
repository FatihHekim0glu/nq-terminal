"""A run-view group file whose checksum passes but whose body is malformed is dropped and rebuilt, never served
(V032 cleanup, 0.3.1 audit): the cache validates the file's header, length and sha256 only, so the body must be
checked where it is read, and what is found wrong must leave memory and disk, or every /api/runs call would fail
until the next start."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

import pytest

from nq_terminal.services import result_cache as rc
from nq_terminal.services import run_views

from test_home_cold_runs import (Reads, _drop_run_list_entry, _first, _fresh, _ids, _index_files, _old_rows,  # noqa: F401
                                 small)

INDEX = "/api/runs"


def _rewrite(path: Path, change: Callable[[bytes, list[str]], bytes]) -> bytes:
    """Replace the group file's body with `change(body, ids)` and fix the header's sha256 and length to match."""
    head, _, body = path.read_bytes().partition(b"\n")
    header = json.loads(head)
    ids = sorted(json.loads(body))
    new = change(body, ids)
    header["sha256"], header["length"] = hashlib.sha256(new).hexdigest(), len(new)
    path.write_bytes(json.dumps(header, ensure_ascii=True, separators=(",", ":")).encode("utf-8") + b"\n" + new)
    return new


def _edit(rows_edit: Callable[[dict[str, Any], list[str]], Any]) -> Callable[[bytes, list[str]], bytes]:
    def change(body: bytes, ids: list[str]) -> bytes:
        return json.dumps(rows_edit(json.loads(body), ids), separators=(",", ":")).encode("utf-8")

    return change


def _drop_one(rows: dict[str, Any], ids: list[str]) -> Any:
    del rows[ids[0]]
    return rows


def _extra(rows: dict[str, Any], ids: list[str]) -> Any:
    rows["nt_not_in_this_group"] = {"view": {}}
    return rows


def _row(value: Any) -> Callable[[dict[str, Any], list[str]], Any]:
    def edit(rows: dict[str, Any], ids: list[str]) -> Any:
        rows[ids[0]] = value
        return rows

    return edit


MUTATIONS: dict[str, Callable[[bytes, list[str]], bytes]] = {
    "an empty object": lambda body, ids: b"{}",
    "an object missing one id": _edit(_drop_one),
    "an extra id": _edit(_extra),
    "an empty row": _edit(_row({})),
    "a row whose view is a string": _edit(_row({"view": "not an object"})),
    "a row whose error is not text": _edit(_row({"error": 5})),
    "a row holding both a view and an error": _edit(_row({"view": {}, "error": "x"})),
    "a row that is a list": _edit(_row([])),
    "a row whose view is an empty object": _edit(_row({"view": {}})),
    "a view without the terminal meta": _edit(_row({"view": {"config": {}}})),
    "a view whose meta is a list": _edit(_row({"view": {run_views.META: []}})),
    "a view whose meta holds no kind": _edit(_row({"view": {run_views.META: {}}})),
    "a view whose kind is not a run kind": _edit(_row({"view": {run_views.META: {"kind": "nonsense"}}})),
    "a view whose kind is a number": _edit(_row({"view": {run_views.META: {"kind": 7}}})),
    "a top level that is a list": lambda body, ids: b"[]",
    "invalid utf-8": lambda body, ids: b"\xff\xfe{",
}


@pytest.mark.parametrize("name", list(MUTATIONS))
def test_born_failing_a_malformed_group_body_is_dropped_and_rebuilt(small, tmp_path, monkeypatch, name):
    state, body, lab = _first(small, tmp_path)
    files = _index_files(lab, _ids(body))
    bucket = next(iter(files))
    mutated = _rewrite(files[bucket], MUTATIONS[name])
    _drop_run_list_entry(lab)
    group = {r for r in _ids(body) if run_views.bucket_of(r) == bucket}

    reads = Reads(monkeypatch)
    again = _fresh(small, state=state)
    response = again.client.get(INDEX)
    assert response.status_code == 200, response.text[:200]
    assert response.content == body
    assert reads.runs() == group, "only the damaged group is read again"
    assert files[bucket].read_bytes().partition(b"\n")[2] != mutated, "the damaged file was replaced"
    assert set(run_views._load(files[bucket].read_bytes().partition(b"\n")[2], sorted(group))) == group

    _drop_run_list_entry(again)  # a later start: the rewritten group file loads, nothing is read
    later = Reads(monkeypatch)
    third = _fresh(small, state=state)
    assert third.client.get(INDEX).content == body
    assert later.runs() == set()
    assert json.loads(body) == _old_rows(third)


def test_the_same_process_does_not_fail_twice(small, tmp_path):
    """The bad body is in memory too: a second request in the same process must not re-raise."""
    state, body, lab = _first(small, tmp_path)
    files = _index_files(lab, _ids(body))
    _rewrite(next(iter(files.values())), MUTATIONS["an empty row"])
    _drop_run_list_entry(lab)
    again = _fresh(small, state=state)
    assert again.client.get(INDEX).content == body
    again.cache.forget(rc.ROUTE_RUNS, {})  # the run list is rebuilt from the groups held in memory
    assert again.client.get(INDEX).content == body


# ---------------------------------------------------------------- what _load accepts


def test_load_accepts_view_rows_and_error_rows_for_exactly_the_expected_ids():
    view = {run_views.META: {"kind": "intraday"}, "n": 1}
    body = json.dumps({"a": {"view": view}, "b": {"error": "unreadable: truncated"}}).encode("utf-8")
    loaded = run_views._load(body, ["a", "b"])
    assert loaded["b"] == "unreadable: truncated" and loaded["a"]["n"] == 1


@pytest.mark.parametrize("body", [b"{}", b'{"a": {"view": {}}}', b'{"a": {"view": {}}, "b": {"view": {}}, "c": {"view": {}}}',
                                  b"[]", b'{"a": {"view": 1}, "b": {"view": {}}}', b'{"a": [], "b": {"view": {}}}',
                                  b'{"a": {"view": {}, "error": "x"}, "b": {"view": {}}}', b"\xff"])
def test_load_refuses_anything_else(body):
    with pytest.raises((ValueError, KeyError, TypeError, AttributeError, UnicodeDecodeError)):
        run_views._load(body, ["a", "b"])


def test_the_view_constants_are_the_run_service_ones():
    """run_views cannot import runs (runs imports it), so the two spellings are pinned here."""
    from typing import get_args

    from nq_terminal.models.runs import RunKind
    from nq_terminal.services import runs as runs_service

    assert run_views.META == runs_service.META
    assert set(run_views.KINDS) == set(get_args(RunKind))


@pytest.mark.parametrize("kind", ["book", "sized", "intraday"])
def test_load_accepts_a_view_with_each_run_kind(kind):
    body = json.dumps({"a": {"view": {run_views.META: {"kind": kind}, "n_trades": 1}}}).encode("utf-8")
    assert run_views._load(body, ["a"])["a"][run_views.META]["kind"] == kind


@pytest.mark.parametrize("view", [{}, {"config": {}}, {run_views.META: []}, {run_views.META: {}},
                                  {run_views.META: {"kind": "nonsense"}}, {run_views.META: {"kind": 7}}])
def test_load_refuses_a_view_without_a_run_kind(view):
    body = json.dumps({"a": {"view": view}}).encode("utf-8")
    with pytest.raises(ValueError):
        run_views._load(body, ["a"])
