"""DQ (RI5): guard fingerprint status, `nq_lab.guards` against the lab's own fingerprint records.

CONSTANTS is recorded in results/guard_constants.json (sha256 plus the frozen values); every later group is pinned
as a sha256 literal in the lab's own test of that group. Each group shows OK, MISMATCH or NO RECORD.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from nq_lab import guards
from nq_lab.config import ROOT
from nq_terminal.services import dq_guards
from nq_terminal.services.files import FileCache

from dq_fixtures import write_dq_results


@pytest.fixture()
def results(tmp_path: Path) -> Path:
    return write_dq_results(tmp_path)


def report(results: Path, **kwargs):
    return dq_guards.guard_status(FileCache(roots=[results]), results, ROOT, **kwargs)


def group(rep, name: str):
    return next(g for g in rep.groups if g.name == name)


def test_every_guard_dict_of_the_module_is_a_group(results):
    names = {g.name for g in report(results).groups}
    expected = {n for n, v in vars(guards).items() if n.isupper() and isinstance(v, dict)}
    assert names == expected and "CONSTANTS" in names and "VRP_GUARDS" in names


def test_the_real_records_all_match(results):
    rep = report(results)
    assert rep.mismatch == 0 and rep.no_record == 0 and rep.ok == len(rep.groups)
    assert group(rep, "CONSTANTS").live_sha256 == guards.fingerprint()


def test_a_changed_record_is_a_mismatch_born_failing(results):
    path = results / "guard_constants.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["sha256"] = "0" * 64
    doc["constants"] = {**doc["constants"], "nq_tick": 0.5}
    path.write_text(json.dumps(doc), encoding="utf-8")
    g = group(report(results), "CONSTANTS")
    assert g.status == "MISMATCH" and g.changed_keys == ["nq_tick"]


def test_a_changed_live_value_is_a_mismatch_born_failing(results, monkeypatch):
    monkeypatch.setitem(guards.SIZING_GUARDS, "tsmom_lcap", 3.0)
    g = group(report(results), "SIZING_GUARDS")
    assert g.status == "MISMATCH" and g.recorded_sha256 is not None


def test_a_missing_record_is_no_record(results):
    (results / "guard_constants.json").unlink()
    g = group(report(results), "CONSTANTS")
    assert g.status == "NO RECORD" and g.recorded_sha256 is None


def test_a_group_with_no_pin_is_no_record(results, monkeypatch):
    monkeypatch.setattr(guards, "NEW_GUARDS", {"x": 1}, raising=False)
    g = group(report(results), "NEW_GUARDS")
    assert g.status == "NO RECORD" and g.record == "none"


def test_pin_reader_reads_only_a_string_literal(tmp_path):
    src = tmp_path / "t.py"
    src.write_text('A = "abc"\nB = compute()\n', encoding="utf-8")
    assert dq_guards.read_pin(src, "A") == "abc"
    assert dq_guards.read_pin(src, "B") is None
    assert dq_guards.read_pin(tmp_path / "absent.py", "A") is None


def test_pin_reader_refuses_a_name_assigned_twice(tmp_path):
    src = tmp_path / "t.py"
    src.write_text('A = "abc"\nif True:\n    A = "def"\nB = "x"\nB = "y"\n', encoding="utf-8")
    assert dq_guards.read_pin(src, "A") is None  # a hidden second assignment makes the pin ambiguous
    assert dq_guards.read_pin(src, "B") is None


def test_every_real_pin_is_assigned_exactly_once():
    for path, name in dq_guards.PINS.values():
        assert dq_guards.read_pin(ROOT / path, name) is not None, f"{path} {name}"


def test_label_is_descriptive(results):
    rep = report(results)
    assert "fingerprint" in rep.label and rep.ok + rep.mismatch + rep.no_record == len(rep.groups)
