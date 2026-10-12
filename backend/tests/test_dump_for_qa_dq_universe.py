"""The DQ universe matrix served, dumped for the reference cross-check in `terminal/qa` (wave w3-research-integrity).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_w3_dq_universe_`, one
kind `dq_universe`: the fixture app's `GET /api/dq/universe`, flattened to `ROOT|variant|year|field` cells and the QA first
and last bars of each root, with the raw inputs of every root (the sidecar sessions and status, or NQ's XNYS sessions and
rejected and still-rejected days, and the QA first and last timestamps) read from the fixture files, not through the
aggregator. `terminal/qa/crosscheck/p11_dq.py` recomputes the cells and bars with set arithmetic (`dq_universe_references`).
The prefix differs from `nqt_p11_dq_` so the other DQ writer, which clears its own prefix, leaves these alone.
"""
from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from dq_fixtures import FUTURES_QA_BOUNDS, NQ_QA_FIRST, NQ_QA_LAST, write_universe_results
from conftest import api_client
from nq_terminal.app import create_app
from nq_terminal.services import dq
from nq_terminal.settings import load_settings

PREFIX = "nqt_w3_dq_universe_"
ROUTE = "/api/dq/universe"
FIELDS = ("sessions", "usable", "gated_out", "unrepairable", "rejected")
LOCAL, LOOPBACK = "http://127.0.0.1", ("127.0.0.1", 50000)


def _read(results: Path, name: str):
    return json.loads((results / name).read_text(encoding="utf-8"))


def raw_root(results: Path, root: dict, qa_futures: dict) -> dict:
    """One root's raw record from the fixture files, with its QA bounds."""
    if root["root"] == dq.NQ.split(".")[0]:
        rejected = _read(results, dq.NQ_VENDOR)
        still = _read(results, dq.NQ_REPAIRED) if (results / dq.NQ_REPAIRED).is_file() else None
        first, last = _read(results, "qa_report.json")["first_ts"], _read(results, "qa_report.json")["last_ts"]
        return {"kind": "nq", "sessions": list(dq.nq_sessions()), "rejected": sorted(str(d)[:10] for d in rejected),
                "still": sorted(str(d)[:10] for d in still) if still is not None else None,
                "first_ts": first, "last_ts": last}
    name, _ = dq.sidecar_name(root["symbol"], results)
    doc = _read(results, name)
    bounds = qa_futures["symbols"][root["root"]]
    return {"kind": "sidecar", "status": doc["status"],
            "sessions": {day: row["source"] for day, row in doc["sessions"].items()},
            "first_ts": bounds["first_ts"], "last_ts": bounds["last_ts"]}


def flat_cells(body: dict) -> dict:
    return {f"{root['root']}|{row['variant']}|{cell['year']}|{field}": cell[field]
            for root in body["roots"] for row in root["rows"] for cell in row["cells"] for field in FIELDS}


def universe_doc(results: Path, body: dict) -> dict:
    qa_futures = _read(results, "qa_report_futures_1m.json")
    roots = {r["root"]: raw_root(results, r, qa_futures) for r in body["roots"]}
    ours = {"cells": flat_cells(body),
            "first_bar": {r["root"]: r["first_bar"] for r in body["roots"] if r["first_bar"] is not None},
            "last_bar": {r["root"]: r["last_bar"] for r in body["roots"] if r["last_bar"] is not None}}
    return _clean({"schema": SCHEMA, "kind": "dq_universe", "case": "universe_fixture",
                   "source": f"GET {ROUTE} on the fixture app; raw records from the fixture results tree",
                   "inputs": {"fence": body["fence"], "years": body["years"], "roots": roots},
                   "values": {"ours": ours}, "missing": {}})


def write_universe_dump(folder: Path, doc: dict) -> Path:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    path = folder / f"{PREFIX}{doc['case']}.json"
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def doc(tmp_path_factory) -> dict:
    base = tmp_path_factory.mktemp("universe")
    results = write_universe_results(base)
    app = create_app(replace(load_settings({"NQT_FIXTURE_DIR": str(base)}), web_dist=base / "no-dist"))
    body = api_client(app, base_url=LOCAL, client=LOOPBACK).get(ROUTE).json()
    return universe_doc(results, body)


def test_the_dump_carries_every_served_root_with_its_raw_record(doc):
    roots = doc["inputs"]["roots"]
    assert doc["kind"] == "dq_universe" and list(roots) == ["NQ", "ES", "GC", "HO", "ZT"]
    assert roots["NQ"]["kind"] == "nq" and roots["NQ"]["still"] == ["2014-06-12", "2020-03-09"]
    assert roots["HO"]["kind"] == "sidecar" and roots["HO"]["status"] == "repaired"
    assert roots["ZT"]["status"] == "not_repaired" and roots["ES"]["first_ts"] == FUTURES_QA_BOUNDS["ES"][0]
    assert roots["NQ"]["first_ts"] == NQ_QA_FIRST and roots["NQ"]["last_ts"] == NQ_QA_LAST
    assert doc["inputs"]["years"] == list(range(2010, 2022))


def test_the_served_cells_are_flat_one_per_variant_year_and_field(doc):
    cells = doc["values"]["ours"]["cells"]
    variants = {"NQ": 2, "ES": 1, "GC": 2, "HO": 2, "ZT": 1}
    assert len(cells) == sum(variants.values()) * 12 * len(FIELDS)
    assert cells["HO|repaired|2011|usable"] == 2 and cells["HO|vendor|2011|gated_out"] == 1
    assert cells["ES|vendor|2011|gated_out"] == 2 and not any(k.startswith("ES|repaired") for k in cells)


def test_the_bars_are_dates_up_to_the_fence_and_the_sealed_text_past_it(doc):
    ours = doc["values"]["ours"]
    assert ours["last_bar"]["NQ"] == dq.SEALED_LAST and ours["last_bar"]["HO"] == dq.SEALED_LAST
    assert ours["last_bar"]["GC"] == "2021-12-31" and ours["first_bar"]["NQ"] == "2010-09-29"
    assert "2026" not in json.dumps(ours)


def test_write_the_dq_universe_dump(doc):
    path = write_universe_dump(dump_dir(), doc)
    assert path.name == f"{PREFIX}universe_fixture.json"
    assert json.loads(path.read_text(encoding="utf-8"))["schema"] == SCHEMA


def test_the_universe_prefix_leaves_other_dumps_alone(tmp_path, doc):
    (tmp_path / "nqt_p11_dq_gc_v1.json").write_text("{}", encoding="utf-8")
    write_universe_dump(tmp_path, doc)
    assert (tmp_path / "nqt_p11_dq_gc_v1.json").exists()
