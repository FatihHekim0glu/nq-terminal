"""ROLL dumps for the reference cross-check in `terminal/qa` (TASKS Phase 11; ANALYTICS MV10, gaps as MV2 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules) with the prefix
`nqt_p11_roll_`. Each dump is a `roll` bundle: one market's synthetic 1d rows (the test loader, no gate and no file)
in `inputs`, with a planted bar past the fence that the terminal must never turn into a roll, and in `values.ours`
the calendar `services.roll` serves. `terminal/qa/crosscheck/p11_roll.py` recomputes it with a plain Python walk.

The `roll` kind is registered in `crosscheck.dumps.BUNDLE_INPUTS` and `crosscheck.compare.BUNDLE_REFERENCES`, so
`test_write_roll_dumps` writes the bundles into the shared dump folder on every run. Read-only on `results/`; writes
only into the given dump folder.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_universe import by_root
from nq_terminal.services import roll

from fakes import synthetic_loader

PREFIX = "nqt_p11_roll_"
ROOTS = ("NQ", "CL", "6J")
LEAK_TS = pd.Timestamp("2022-01-03", tz="UTC")


def market_inputs(root: str) -> tuple[pd.DataFrame, dict]:
    frame = synthetic_loader(f"{root}.V.0", "1d")(IS_START, IS_END)
    leak = frame.iloc[[-1]].copy()
    leak["ts"] = LEAK_TS
    leak["instrument_id"] = frame["instrument_id"].iloc[-1] + 1
    rows = pd.concat([frame, leak], ignore_index=True)
    ts = pd.to_datetime(rows["ts"], utc=True)
    return rows, {"dates": ts.dt.strftime("%Y-%m-%d").tolist(), "t": (ts.astype("int64") // 10**9).tolist(),
                  "instrument_id": rows["instrument_id"].tolist(), "offset": rows["offset"].tolist(),
                  "c_none": rows["c_none"].tolist(), "qa_rolls_total": None}


def roll_doc(root: str) -> dict:
    rows, inputs = market_inputs(root)
    market = roll.market_rolls(rows, by_root(root))
    events = market.rolls
    ours = {"count": len(events), "per_year": market.per_year, "t": [e.t for e in events],
            "from_id": [e.from_id for e in events], "to_id": [e.to_id for e in events],
            "gap_pts": [e.gap_pts for e in events], "gap_pct": [e.gap_pct for e in events],
            "close_before": [e.close_before for e in events]}
    return _clean({"schema": SCHEMA, "kind": "roll", "case": f"roll_{root}_synthetic",
                   "source": "services.roll.market_rolls on the synthetic 1d loader with a bar planted past the fence",
                   "inputs": inputs, "values": {"ours": ours}, "missing": {}})


def write_roll_dumps(folder: Path) -> list[Path]:
    folder = checked_dump_dir(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob(f"{PREFIX}*.json"):
        old.unlink()
    written = []
    for root in ROOTS:
        doc = roll_doc(root)
        path = folder / f"{PREFIX}{doc['case'][len('roll_'):]}.json"
        path.write_text(json.dumps(doc, allow_nan=False), encoding="utf-8")
        written.append(path)
    return written


def test_roll_docs_carry_the_inputs_and_the_served_calendar():
    for root in ROOTS:
        doc = roll_doc(root)
        inputs, ours = doc["inputs"], doc["values"]["ours"]
        assert set(inputs) == {"dates", "t", "instrument_id", "offset", "c_none", "qa_rolls_total"}
        assert len({len(v) for k, v in inputs.items() if k != "qa_rolls_total"}) == 1
        assert inputs["dates"][-1] == "2022-01-03"  # the planted bar is in the inputs ...
        assert ours["count"] == len(ours["t"]) > 40
        assert max(ours["t"]) < int(IS_END.timestamp())  # ... and never in the served calendar
        assert all(len(ours[k]) == ours["count"] for k in ("from_id", "to_id", "gap_pts", "gap_pct", "close_before"))


def test_roll_dumps_are_written_to_the_given_folder_only(tmp_path):
    written = write_roll_dumps(tmp_path / "dumps")
    assert [p.name for p in written] == [f"{PREFIX}{root}_synthetic.json" for root in ROOTS]
    back = json.loads(written[0].read_text(encoding="utf-8"))
    assert back["schema"] == SCHEMA and back["kind"] == "roll"


def test_write_roll_dumps():
    written = write_roll_dumps(dump_dir())
    assert [p.name for p in written] == [f"{PREFIX}{root}_synthetic.json" for root in ROOTS]


@pytest.mark.parametrize("folder", [ROOT / "results", ROOT / "data", ROOT / "live" / "x", ROOT])
def test_a_protected_folder_is_refused_before_any_write(folder):
    with pytest.raises(ValueError, match="refused dump folder"):
        write_roll_dumps(folder)
