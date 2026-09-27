"""EVT dumps for the reference cross-check in `terminal/qa` (TASKS Phase 11; `crosscheck/p11_evt.py`).

Bundles of kind `evt` (schema `nqt-qa-dump/1`, prefix `nqt_p11_evt_`): the raw inputs the study read and the values
the terminal computed. Prices come from the tests' fake serve (synthetic bars through the real gate with a temporary
log), never from a real price file. Events are the real fixed calendar when it is on disk (read only), else a
hand-built list.

The `evt` kind is registered in `crosscheck.dumps.BUNDLE_INPUTS` and `crosscheck.compare.BUNDLE_REFERENCES`, so the
bundles go to the shared QA dump folder on every run.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import IS_END, IS_START, ROOT
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_terminal.services.bars import BarService
from nq_terminal.services.events import (
    INTRADAY_TF,
    INTRADAY_VARIANT,
    MACRO_SPEC,
    MAX_STALE_MINUTES,
    EventPick,
    daily_study,
    intraday_study,
    load_calendar,
    pick_events,
    release_utc,
)
from nq_terminal.services.files import FileCache

from fakes import make_fake_serve

PREFIX = "nqt_p11_evt_"
KIND = "evt"
SYMBOL = "NQ.V.0"
HAND = [EventPick(dt.date(2012, 3, 13), ("FOMC",), "14:15"), EventPick(dt.date(2015, 1, 16), ("CPI",), "08:30"),
        EventPick(dt.date(2016, 6, 15), ("FOMC",), "14:00"), EventPick(dt.date(2019, 5, 1), ("FOMC",), "14:00")]


def _picks(event_type: str) -> list[EventPick]:
    if not (ROOT / MACRO_SPEC).is_file():
        return HAND
    return pick_events(load_calendar(FileCache(roots=[ROOT]), ROOT), event_type)


def _ours(result) -> dict:
    used = [r.path for r in result.rows if r.reason is None]
    return {"mean": result.agg.mean, "se": result.agg.se, "lower": result.agg.lower, "upper": result.agg.upper,
            "n_used": float(result.agg.n), "end_values": [p[-1] for p in used],
            **{f"end_{k}": v for k, v in result.end.items() if k != "n"}}


def _bundle(case: str, inputs: dict, ours: dict) -> dict:
    return {"schema": SCHEMA, "kind": KIND, "case": case, "source": "fake serve (synthetic bars), fixed calendar",
            "inputs": _clean(inputs), "values": {"ours": _clean(ours)}, "missing": {}}


def daily_doc(service: BarService, event_type: str, pre: int, post: int) -> dict:
    picks = _picks(event_type)
    result = daily_study(service, SYMBOL, picks, pre=pre, post=post)
    days = master_days(IS_START.date(), (IS_END - pd.Timedelta(days=1)).date())
    panel = build_panel({SYMBOL: service.frame(SYMBOL, "1d", "vendor", IS_START, IS_END).frame}, days)
    inputs = {"mode": "daily", "dates": [str(d) for d in days], "r": panel.r[:, 0].tolist(),
              "stale": [bool(x) for x in panel.stale[:, 0]], "events": [str(p.date) for p in picks], "pre": pre,
              "post": post}
    return _bundle(f"daily_{event_type.lower()}_{pre}_{post}", inputs, _ours(result))


def intraday_doc(service: BarService, picks: list[EventPick], pre: int, post: int) -> dict:
    events = []

    def fetch(lo: pd.Timestamp, hi: pd.Timestamp):
        served = service.frame(SYMBOL, INTRADAY_TF, INTRADAY_VARIANT, lo, hi)
        frame = served.frame
        events.append({"ts": [str(t) for t in frame["ts"]], "raw_c": frame["raw_c"].tolist(),
                       "instrument_id": frame["instrument_id"].tolist()})
        return frame, served.years, served.cached

    result = intraday_study(fetch, picks, pre=pre, post=post)
    for pick, event in zip(picks, events):
        event["t0"] = release_utc(pick).isoformat()
    inputs = {"mode": "intraday", "events": events, "pre": pre, "post": post, "max_stale": MAX_STALE_MINUTES}
    return _bundle(f"intraday_{pre}_{post}", inputs, _ours(result))


def write_dumps(folder: Path, docs: list[dict]) -> list[Path]:
    checked_dump_dir(folder)
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
def service(tmp_path_factory) -> BarService:
    return BarService(make_fake_serve(tmp_path_factory.mktemp("log") / "oos_access_log.jsonl"),
                      cache_bytes=2 * 1024**3)


def test_evt_dumps_hold_every_case(service):
    docs = [daily_doc(service, "FOMC", 5, 5), daily_doc(service, "ALL", 1, 10),
            intraday_doc(service, HAND, 30, 60)]
    assert all(c.caller == "terminal" for c in service.serve_fn.calls)
    paths = write_dumps(dump_dir(), docs)
    for path, doc in zip(paths, docs):
        back = json.loads(path.read_text(encoding="utf-8"))
        assert back["schema"] == SCHEMA and back["kind"] == KIND and back["values"]["ours"]["mean"]
        assert back["values"]["ours"]["n_used"] >= 1


def test_the_evt_prefix_leaves_other_dumps_alone(tmp_path):
    (tmp_path / "nqt_p1_keep.json").write_text("{}", encoding="utf-8")
    write_dumps(tmp_path, [])
    assert (tmp_path / "nqt_p1_keep.json").exists()
