"""DQ dumps for the reference cross-check in `terminal/qa` (TASKS Phase 11; ANALYTICS RI4, RI5 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_p11_dq_`:
- `dq_sidecar`: one futures repair sidecar's status and sessions (the fixture tree's GC v1 and HO v2 files, and GC
  marked as a failed symbol, so its candidates are gated out), with the day-state counts `services.dq` serves;
- `dq_nq`: NQ's XNYS sessions and the za_v0 rejected and still-rejected days (and the case with no repaired file),
  with the counts `services.dq.classify_nq` gives;
- `guards`: every upper-case dict in `nq_lab.guards` and its record (the fixture `guard_constants.json`, the lab's
  own pins read as source), with the fingerprints and statuses `services.dq_guards` serves.
No price is read. `terminal/qa/crosscheck/p11_dq.py` recomputes each with set arithmetic, hashlib and json.
Read-only on `results/` and the lab's tests.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import ROOT
from nq_terminal.services import dq, dq_guards
from nq_terminal.services.files import FileCache

from fakes import FIXTURES

PREFIX = "nqt_p11_dq_"
RESULTS = FIXTURES / "results"


def _read(name: str) -> dict:
    return json.loads((RESULTS / name).read_text(encoding="utf-8"))


def _bundle(kind: str, case: str, source: str, inputs: dict, ours: dict) -> dict:
    return _clean({"schema": SCHEMA, "kind": kind, "case": case, "source": source, "inputs": inputs,
                   "values": {"ours": ours}, "missing": {}})


def sidecar_doc(name: str, case: str, status: str | None = None) -> dict:
    doc = _read(name)
    if status is not None:
        doc = {**doc, "status": status}
    counts = dq.count(dq.classify_sidecar(doc)).model_dump()
    sessions = {day: row["source"] for day, row in doc["sessions"].items()}
    note = f", status set to {status}" if status is not None else ""
    return _bundle("dq_sidecar", case, f"fixture results/{name}{note}",
                   {"status": doc.get("status"), "fence": dq.FENCE, "sessions": sessions}, {"counts": counts})


def nq_doc(with_repair: bool) -> dict:
    rejected = _read(dq.NQ_VENDOR)
    still = _read(dq.NQ_REPAIRED) if with_repair else None
    still_days = {str(k)[:10]: v for k, v in still.items()} if still is not None else None
    sessions = dq.nq_sessions()
    counts = dq.count(dq.classify_nq(rejected, still_days, {}, sessions)).model_dump()
    inputs = {"fence": dq.FENCE, "sessions": sessions, "rejected": sorted(str(d)[:10] for d in rejected),
              "still": sorted(still_days) if still_days is not None else None}
    case = "nq_repaired" if with_repair else "nq_no_repair_record"
    return _bundle("dq_nq", case, "fixture results/screens/za_v0_*rejected_days.json, XNYS from 2010-09-28",
                   inputs, {"counts": counts})


def guards_doc() -> dict:
    report = dq_guards.guard_status(FileCache(roots=[RESULTS]), RESULTS, ROOT)
    groups = dq_guards.live_groups()
    records = {g.name: g.recorded_sha256 for g in report.groups}
    ours = {"live_sha256": {g.name: g.live_sha256 for g in report.groups},
            "status": {g.name: g.status for g in report.groups}}
    return _bundle("guards", "guards", "nq_lab.guards; fixture results/guard_constants.json; the lab's pins as source",
                   {"groups": groups, "records": records}, ours)


def write_dq_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case']}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


@pytest.fixture(scope="module")
def docs() -> list[dict]:
    return [sidecar_doc(f"{dq.V1_DIR}/GC.V.0.json", "gc_v1"), sidecar_doc(f"{dq.V2_DIR}/HO.V.0.json", "ho_v2"),
            sidecar_doc(f"{dq.V1_DIR}/GC.V.0.json", "gc_failed_symbol", status="not_repaired"),
            nq_doc(True), nq_doc(False), guards_doc()]


def test_dq_docs_carry_the_records_and_the_served_counts(docs):
    by_case = {d["case"]: d for d in docs}
    assert by_case["gc_failed_symbol"]["values"]["ours"]["counts"]["unrepairable"] == 0
    assert by_case["ho_v2"]["values"]["ours"]["counts"]["rebuilt"] > 0
    assert by_case["nq_no_repair_record"]["values"]["ours"]["counts"]["rebuilt"] == 0
    assert by_case["nq_repaired"]["values"]["ours"]["counts"]["rebuilt"] > 0
    statuses = by_case["guards"]["values"]["ours"]["status"]
    assert statuses and set(statuses.values()) <= {"OK", "MISMATCH", "NO RECORD"}


def test_write_dq_dumps(docs):
    paths = write_dq_dumps(dump_dir(), docs)
    assert [p.name for p in paths] == [f"{PREFIX}{d['case']}.json" for d in docs]


def test_the_dq_prefix_leaves_other_dumps_alone(tmp_path):
    (tmp_path / "nqt_p1_keep.json").write_text("{}", encoding="utf-8")
    write_dq_dumps(tmp_path, [])
    assert (tmp_path / "nqt_p1_keep.json").exists()


def test_a_protected_folder_is_refused_before_any_write():
    from nq_lab.config import RESULTS as REAL_RESULTS
    with pytest.raises(ValueError):
        write_dq_dumps(REAL_RESULTS / "nqt_dump_probe", [])
