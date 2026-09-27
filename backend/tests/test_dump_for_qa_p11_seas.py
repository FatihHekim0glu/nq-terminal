"""SEAS dumps for the reference cross-check in `terminal/qa` (TASKS Phase 11; ANALYTICS MV7 and section 14).

Same contract as `test_dump_for_qa.py` (schema `nqt-qa-dump/1`, the same folder rules), prefix `nqt_p11_seas_`, kind
`seasonality`: the daily returns the service groups (`dates`, `r`, `aggregation`) and, for the intraday case, the
1m bars of the kept sessions (`bars`), with the panels the terminal serves in `values.ours` (`{panel}_n`, `_mean`,
`_se`, `_hit` and the flattened `heatmap`). Prices are the tests' synthetic loader (no gate and no file); the
hypothesis case reads the fixture tree's recorded series. `terminal/qa/crosscheck/p11_seas.py` recomputes every value
with plain Python loops and the `statistics` module. Read-only on `results/`.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd
import pytest
from test_dump_for_qa import SCHEMA, _clean, checked_dump_dir, dump_dir

from nq_lab.config import IS_END, IS_START
from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics import seasonality as seas
from nq_terminal.analytics import series
from nq_terminal.services import seasonality as seas_service
from nq_terminal.services.bars import derive_raw_close
from nq_terminal.services.research import service_for_root

from fakes import FIXTURES, synthetic_loader

PREFIX = "nqt_p11_seas_"
KIND = "seasonality"
SYMBOL = "NQ.V.0"
FIELDS = {"n": "n", "mean": "mean", "se": "se", "hit": "hit_rate"}
MONTH_START, MONTH_END = dt.date(2020, 3, 2), dt.date(2020, 3, 31)
EXCLUDED = frozenset({dt.date(2020, 3, 9), dt.date(2020, 3, 16)})  # planted: two sessions left out
REBUILT_DAY = dt.date(2020, 3, 11)  # planted: a session stored as the repair stores a rebuilt one


def ours_of(result: seas_service.Result) -> dict:
    ours: dict = {}
    for panel in result.panels:
        if not panel.available:
            continue
        for key, attr in FIELDS.items():
            ours[f"{panel.id}_{key}"] = [float(getattr(b, attr)) if key == "n" else getattr(b, attr)
                                         for b in panel.buckets]
    ours["heatmap"] = [v for row in result.heat_values for v in row]
    return ours


def daily_inputs(r: pd.Series, aggregation: str) -> dict:
    return {"dates": [d.strftime("%Y-%m-%d") for d in r.index], "r": r.tolist(), "aggregation": aggregation}


def bundle(case: str, source: str, inputs: dict, ours: dict) -> dict:
    return _clean({"schema": SCHEMA, "kind": KIND, "case": case, "source": source, "inputs": inputs,
                   "values": {"ours": ours}, "missing": {}})


def instrument_doc(start_year: int, end_year: int) -> dict:
    daily = synthetic_loader(SYMBOL, "1d")(IS_START, IS_END)
    result = seas_service.instrument_seasonality(daily, SYMBOL, minutes=None, exclusions=seas_service.NOT_ASSESSED,
                                                 start_year=start_year, end_year=end_year)
    r = seas_service.daily_returns(daily, SYMBOL)
    r = r[(r.index.year >= start_year) & (r.index.year <= end_year)]
    return bundle(f"nq_{start_year}_{end_year}", "synthetic 1d NQ (tests/fakes.py), r = dB / (N - dB)",
                  daily_inputs(r, result.aggregation), ours_of(result))


def intraday_doc(rebuilt: bool = False) -> dict:
    """NQ 2020 calendar panels plus the 30-minute buckets of March 2020 with two sessions excluded; `rebuilt` blanks
    the raw close and offset of one session's bars, as NQ's repaired file stores its rebuilt sessions, and the
    terminal derives them (`bars.derive_raw_close`) as its BarService does."""
    doc = instrument_doc(2020, 2020)
    lo = pd.Timestamp(MONTH_START, tz="UTC")
    hi = pd.Timestamp(MONTH_END + dt.timedelta(days=1), tz="UTC")
    frame = synthetic_loader(SYMBOL, "1m", "repaired")(lo, hi).sort_values("ts", ignore_index=True)
    if rebuilt:
        day = pd.to_datetime(frame["ts"], utc=True).dt.date == REBUILT_DAY
        frame.loc[day.to_numpy(), ["raw_c", "offset"]] = float("nan")
    table = nyse_sessions(MONTH_START, MONTH_END)
    keep = set(table.index) - EXCLUDED
    buckets = seas.by_bucket(seas.intraday_bucket_returns(derive_raw_close(frame), table, keep))
    kept = table[[d in keep for d in table.index]]
    ts = pd.to_datetime(frame["ts"], utc=True)
    inside = pd.Series(False, index=frame.index)
    for open_utc, close_utc in zip(kept["open_utc"], kept["close_utc"]):
        inside |= (ts >= open_utc) & (ts < close_utc)
    rth = frame[inside.to_numpy()]
    doc["inputs"]["bars"] = _clean({
        "ts": [t.isoformat() for t in pd.to_datetime(rth["ts"], utc=True)], "o": rth["o"].tolist(),
        "c": rth["c"].tolist(), "raw_c": rth["raw_c"].tolist(), "offset": rth["offset"].tolist(),
        "instrument_id": [int(x) for x in rth["instrument_id"]],
        "sessions": [{"date": str(d), "open_utc": pd.Timestamp(o).isoformat(), "close_utc": pd.Timestamp(c).isoformat()}
                     for d, o, c in zip(kept.index, kept["open_utc"], kept["close_utc"])]})
    for key, attr in FIELDS.items():
        doc["values"]["ours"][f"intraday_{key}"] = _clean(
            [float(getattr(b, attr)) if key == "n" else getattr(b, attr) for b in buckets])
    doc["case"] = "nq_2020_intraday_march" + ("_rebuilt" if rebuilt else "")
    doc["source"] += "; March 2020 synthetic repaired 1m bars, 2020-03-09 and 2020-03-16 excluded"
    if rebuilt:
        doc["source"] += f"; {REBUILT_DAY} stored without raw close or offset (rebuilt)"
    return doc


def hypothesis_doc(name: str, cost: int) -> dict:
    built = series.hypothesis_series(service_for_root(FIXTURES), name, cost, bars=None)
    last = (IS_END - pd.Timedelta(days=1)).year
    result = seas_service.hypothesis_seasonality(built, cost=cost, start_year=IS_START.year, end_year=last)
    r = built.r.astype(float)
    r = r[(r.index.year >= IS_START.year) & (r.index.year <= last)]
    return bundle(f"{name}_c{cost}", f"fixture recorded series of {name} at {cost} tick(s), Basis A",
                  daily_inputs(r, result.aggregation), ours_of(result))


def write_seas_dumps(folder: Path, docs: list[dict]) -> list[Path]:
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
    return [instrument_doc(IS_START.year, (IS_END - pd.Timedelta(days=1)).year), intraday_doc(),
            hypothesis_doc("volmanaged_v0", 1), intraday_doc(rebuilt=True)]


def test_seas_docs_carry_the_inputs_and_every_served_panel(docs):
    full, intraday, hypothesis, rebuilt = docs
    assert full["inputs"]["aggregation"] == "compound" and hypothesis["inputs"]["aggregation"] == "sum"
    assert full["inputs"]["dates"][-1] <= "2021-12-31" and len(full["inputs"]["dates"]) == len(full["inputs"]["r"])
    for doc in docs:
        assert {"month_n", "weekday_mean", "week_of_month_se", "heatmap"} <= set(doc["values"]["ours"])
    assert len(intraday["values"]["ours"]["intraday_n"]) == seas.SESSION_BUCKETS
    kept = {s["date"] for s in intraday["inputs"]["bars"]["sessions"]}
    assert kept and not kept & {str(d) for d in EXCLUDED}
    assert rebuilt["values"]["ours"]["intraday_n"] == intraday["values"]["ours"]["intraday_n"]  # the day stays
    assert None in rebuilt["inputs"]["bars"]["raw_c"] and None not in intraday["inputs"]["bars"]["raw_c"]


def test_write_seas_dumps(docs):
    paths = write_seas_dumps(dump_dir(), docs)
    assert [p.name for p in paths] == [f"{PREFIX}{d['case']}.json" for d in docs]
    assert json.loads(paths[0].read_text(encoding="utf-8"))["kind"] == KIND


def test_the_seas_prefix_leaves_other_dumps_alone(tmp_path):
    (tmp_path / "nqt_p1_keep.json").write_text("{}", encoding="utf-8")
    write_seas_dumps(tmp_path, [])
    assert (tmp_path / "nqt_p1_keep.json").exists()


def test_a_protected_folder_is_refused_before_any_write():
    from nq_lab.config import RESULTS
    with pytest.raises(ValueError):
        write_seas_dumps(RESULTS / "nqt_dump_probe", [])
