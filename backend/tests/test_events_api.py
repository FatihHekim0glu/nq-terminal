"""EVT API (Phase 11): /api/events/calendar and /api/events/study, GET only, through the fake gate.

`create_app` includes the router before the web mount. The
fixture root is a temporary folder with a small copy of the macroday_v0 line format, so no real research file is
needed and nothing under the project is written. Born-failing: a p-value key planted in a body is caught by the scan
the study body must pass.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_terminal.api import events
from nq_terminal.app import create_app
from nq_terminal.services import bars as bars_module
from nq_terminal.services.events import FOMC_MANIFEST, MACRO_SPEC
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, make_fake_serve

from conftest import api_client

LINES = ["2015-01-09 NFP@08:30", "2015-01-15 PPI@08:30", "2015-01-16 CPI@08:30", "2015-01-28 FOMC@14:00",
         "2015-03-18 FOMC@14:00+PPI@08:30", "2015-04-03 NFP@08:30 EXCLUDED (Good Friday, NYSE closed)",
         "2016-06-15 FOMC@14:00", "2021-12-31 CPI@08:30"]
BANNED_KEYS = ("p_value", "pvalue", "p_val", "t_stat", "tstat")


def _root(tmp: Path) -> Path:
    (tmp / MACRO_SPEC).parent.mkdir(parents=True)
    (tmp / MACRO_SPEC).write_text(json.dumps({"name": "macroday_v0", "event_dates": LINES}), encoding="utf-8")
    (tmp / FOMC_MANIFEST).parent.mkdir(parents=True)
    pages = {d: {"role": "event"} for d in ("2015-01-28", "2015-03-18", "2016-06-15")}
    (tmp / FOMC_MANIFEST).write_text(json.dumps({"pages": pages}), encoding="utf-8")
    (tmp / "results" / "screens").mkdir(parents=True)
    for name in ("za_v0_rejected_days.json", "za_v0_repaired_rejected_days.json"):  # NQ's session record
        shutil.copyfile(FIXTURES / "results" / "screens" / name, tmp / "results" / "screens" / name)
    return tmp


def _client(root: Path, log: Path | None) -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)}))
    if log is not None:
        app.state.serve_fn = make_fake_serve(log)
    app.state.catalog = FakeCatalog()
    return api_client(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


@pytest.fixture(scope="module")
def root(tmp_path_factory) -> Path:
    return _root(tmp_path_factory.mktemp("evt-root"))


@pytest.fixture(scope="module")
def log(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("evt-log") / "oos_access_log.jsonl"


@pytest.fixture(scope="module")
def client(root, log) -> TestClient:
    return _client(root, log)


def banned_keys(value, path: str = "") -> list[str]:
    """Every key in a JSON body that names a p-value or a test statistic."""
    if isinstance(value, dict):
        found = [f"{path}.{k}" for k in value if str(k).lower() in BANNED_KEYS]
        return found + [x for k, v in value.items() for x in banned_keys(v, f"{path}.{k}")]
    if isinstance(value, list):
        return [x for i, v in enumerate(value) for x in banned_keys(v, f"{path}[{i}]")]
    return []


def test_the_p_value_scan_is_born_failing():
    assert banned_keys({"a": [{"end": {"p_value": 0.04}}]}) == [".a[0].end.p_value"]
    assert banned_keys({"a": 1}) == []


def test_calendar_lists_the_fixed_events_and_the_instruments(client):
    res = client.get("/api/events/calendar")
    assert res.status_code == 200
    body = res.json()
    assert body["counts"] == {"CPI": 2, "PPI": 2, "NFP": 1, "FOMC": 3, "ALL": 7}
    assert body["fomc_check"].startswith("agrees")
    assert body["excluded"] == ["2015-04-03"]
    assert len(body["daily_symbols"]) == 27 and "NQ.V.0" in body["daily_symbols"]
    assert body["intraday_symbols"] == ["NQ.V.0"]  # the only repaired 1m series in the fake catalog
    assert body["daily_default"] == [5, 5] and body["intraday_default"] == [60, 120]
    assert "[POST HOC]" in body["label"]


def test_daily_study_through_the_gate(client, log):
    res = client.get("/api/events/study", params={"symbol": "NQ.V.0", "event": "FOMC", "mode": "daily"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert banned_keys(body) == []
    assert "[POST HOC]" in body["label"]
    assert body["offsets"] == list(range(-5, 6)) and body["offset_unit"] == "session"
    assert body["n_listed"] == 3 and body["n_used"] + body["n_void"] == 3
    assert body["mean"][4] == 0.0  # offset -1: the close before the event
    used = [r for r in body["events"] if r["used"]]
    assert len(used) == body["n_used"] == body["end"]["n"]
    mean_end = sum(r["end"] for r in used) / len(used)
    assert body["mean"][-1] == pytest.approx(mean_end, abs=1e-15)
    assert body["gate"]["caller"] == "terminal"
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    assert all(x["caller"] == "terminal" for x in lines)


def test_all_counts_each_date_once_and_voids_the_window_past_the_fence(client):
    body = client.get("/api/events/study", params={"symbol": "NQ.V.0", "event": "ALL", "pre": 2, "post": 3}).json()
    assert body["n_listed"] == 7
    last = body["events"][-1]
    assert last["date"] == "2021-12-31" and not last["used"] and "last in-sample session" in last["reason"]
    assert last["path"] == [] and last["end"] is None


def test_intraday_study_on_the_repaired_minutes(client):
    res = client.get("/api/events/study", params={"symbol": "NQ.V.0", "event": "CPI", "mode": "intraday", "pre": 10,
                                                  "post": 15})
    assert res.status_code == 200, res.text
    body = res.json()
    assert banned_keys(body) == []
    assert body["offset_unit"] == "minute" and body["offsets"] == list(range(-10, 16))
    assert body["variant"] == "repaired" and body["timeframe"] == "1m"
    first, last = body["events"]
    assert first["t0_utc"] == "2015-01-16T13:30:00Z" and first["used"], first["reason"]
    assert first["path"][10] == 0.0
    assert last["t0_utc"] == "2021-12-31T13:30:00Z"  # 08:30 ET + 15 minutes is still in-sample
    assert body["gate"]["served_years"] == [2015, 2021]


@pytest.mark.parametrize(("params", "status"), [
    ({"symbol": "ES.V.0", "mode": "intraday"}, 422),  # no repaired 1m series: not validated for intraday work
    ({"symbol": "MNQ.V.0"}, 404),  # no daily series in the universe
    ({"symbol": "nq"}, 422),
    ({"event": "GDP"}, 422),
    ({"mode": "daily", "pre": 21}, 422),
    ({"mode": "intraday", "post": 391}, 422),
    ({"pre": 0}, 422),
])
def test_bad_requests_are_refused_before_any_serve(client, params, status):
    assert client.get("/api/events/study", params=params).status_code == status


def test_get_only(client):
    assert client.post("/api/events/study").status_code == 405


def test_without_a_price_source_the_study_answers_503(root):
    bare = _client(root, None)
    assert bare.get("/api/events/study").status_code == 503
    assert bare.get("/api/events/calendar").status_code == 200  # no price is read there


def test_a_broken_calendar_answers_502(tmp_path, log):
    (tmp_path / MACRO_SPEC).parent.mkdir(parents=True)
    (tmp_path / MACRO_SPEC).write_text(json.dumps({"event_dates": ["not a line"]}), encoding="utf-8")
    (tmp_path / "results").mkdir()
    res = _client(tmp_path, log).get("/api/events/calendar")
    assert res.status_code == 502 and "unparseable" in res.json()["detail"]


class RebuiltDay:
    """The fake serve, with `raw_c` and `offset` set to NaN on one day of NQ's repaired 1m bars, as the repaired file
    stores the sessions it rebuilt from trades."""

    def __init__(self, log: Path, day: str):
        self.fake = make_fake_serve(log)
        self.lo = pd.Timestamp(day, tz="UTC")

    def __call__(self, start, end, *, caller, reason, symbol="NQ.V.0", timeframe="1m", variant="vendor"):
        frame = self.fake(start, end, caller=caller, reason=reason, symbol=symbol, timeframe=timeframe,
                          variant=variant)
        if (symbol, timeframe, variant) != ("NQ.V.0", "1m", "repaired") or frame.empty:
            return frame
        out = frame.copy()
        out.loc[(out["ts"] >= self.lo) & (out["ts"] < self.lo + pd.Timedelta(days=1)), ["raw_c", "offset"]] = np.nan
        return out


def test_evt_prices_a_rebuilt_day_itself_without_the_bar_services_derivation(root, tmp_path, monkeypatch):
    """Born failing: with the bar service's raw-close derivation switched off, the CPI event on a rebuilt day was void
    ("no finite price"); EVT now prices the rebuilt bars as the close less the contract's offset on its own."""
    params = {"symbol": "NQ.V.0", "event": "CPI", "mode": "intraday", "pre": 10, "post": 15}
    base = _client(root, tmp_path / "a.jsonl").get("/api/events/study", params=params).json()["events"][0]
    monkeypatch.setattr(bars_module, "derive_raw_close", lambda frame: frame)
    client = _client(root, None)
    client.app.state.serve_fn = RebuiltDay(tmp_path / "b.jsonl", base["date"])
    res = client.get("/api/events/study", params=params)
    assert res.status_code == 200, res.text
    rebuilt = res.json()["events"][0]
    assert base["used"] and rebuilt["used"], rebuilt["reason"]
    assert np.allclose(rebuilt["path"], base["path"], rtol=1e-12, atol=1e-15)
