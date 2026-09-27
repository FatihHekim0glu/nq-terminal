"""VCONE dump for the reference cross-check in `terminal/qa` (TASKS Phase 11; ANALYTICS MV9 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_p11_vcone_`, one
`vcone` bundle: the universe returns of synthetic 1d frames (the tests' loader, no gate and no file), the horizons,
percentiles and minimum window count, with the cone the terminal serves (`ours`, `services.vcone.volatility_cone`)
and the small multiples' statistics at each horizon as a second terminal value (`@universe`).
`terminal/qa/crosscheck/p11_vcone.py` recomputes every value with the standard library.

The `vcone` kind is registered in `crosscheck.dumps.BUNDLE_INPUTS` and `crosscheck.compare.BUNDLE_REFERENCES`, so
`test_write_vcone_dumps` writes into the shared dump folder on every run. Read-only on `results/`.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.services import vcone
from nq_terminal.services.market import last_in_sample_day

from fakes import synthetic_loader

PREFIX = "nqt_p11_vcone_"
SYMBOLS = ("NQ.V.0", "CL.V.0", "ZN.V.0")
STAT_KEYS = ("n", "min", *(f"p{p}" for p in vcone.PERCENTILES), "max", "latest", "latest_rank")


def vcone_doc(symbol: str) -> dict:
    frame = synthetic_loader(symbol, "1d")(IS_START, IS_END)
    panel = build_panel({symbol: frame}, master_days(IS_START.date(), last_in_sample_day()))
    cone = vcone.volatility_cone(frame, symbol)
    contracts = [c for c in TABLE if f"{c.root}.V.0" == symbol]
    ours = {}
    for row in cone.horizons:
        ours |= {f"h{row.sessions}.{k}": getattr(row, k) for k in STAT_KEYS}
        small = vcone.universe_cone({symbol: frame}, contracts=contracts, sessions=row.sessions).rows[0].stats
        ours |= {f"h{row.sessions}.{k}@universe": getattr(small, k) for k in STAT_KEYS}
    root = symbol.split(".")[0].lower()
    return _clean({"schema": SCHEMA, "kind": "vcone", "case": f"vcone_{root}_synthetic",
                   "source": f"synthetic 1d {symbol} frame (tests/fakes.py), universe returns r = dB / (N - dB)",
                   "inputs": {"dates": [str(d) for d in panel.days], "r": panel.r[:, 0].tolist(),
                              "horizons": list(vcone.HORIZONS), "percentiles": list(vcone.PERCENTILES),
                              "min_windows": vcone.MIN_WINDOWS},
                   "values": {"ours": ours}, "missing": {}})


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    paths = []
    for doc in docs:
        path = folder / f"{PREFIX}{doc['case'].removeprefix('vcone_')}.json"
        path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        paths.append(path)
    return paths


@pytest.fixture(scope="module")
def docs() -> list[dict]:
    return [vcone_doc(s) for s in SYMBOLS]


def test_vcone_docs_hold_every_horizon(docs):
    for doc in docs:
        assert doc["schema"] == SCHEMA and doc["kind"] == "vcone"
        assert len(doc["inputs"]["dates"]) == len(doc["inputs"]["r"])
        assert doc["inputs"]["dates"][-1] == "2021-12-31"
        for h in vcone.HORIZONS:
            for k in STAT_KEYS:
                assert doc["values"]["ours"][f"h{h}.{k}"] == doc["values"]["ours"][f"h{h}.{k}@universe"]
            assert doc["values"]["ours"][f"h{h}.p50"] is not None


def test_write_vcone_dumps(docs):
    paths = write_dumps(dump_dir(), docs)
    assert [p.name for p in paths] == [f"{PREFIX}{s.split('.')[0].lower()}_synthetic.json" for s in SYMBOLS]
    back = json.loads(paths[0].read_text(encoding="utf-8"))
    assert back["kind"] == "vcone" and back["values"]["ours"]


def test_the_dump_folder_rules_hold(tmp_path):
    from nq_lab.config import RESULTS
    with pytest.raises(ValueError):
        write_dumps(RESULTS / "nqt_dump_probe", [])
