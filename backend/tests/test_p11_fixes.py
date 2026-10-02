"""Phase 11 QA fixes (improvement run), each born failing before its fix:

- Rebuilt NQ sessions: the repaired 1m file carries `raw_c` and `offset` NaN on the bars rebuilt from trades (the
  repair added the contract's offset to the trade prices and wrote no raw close). `bars.derive_raw_close` restores
  `raw_c = c - offset` from the one offset the same contract carries on its vendor bars in the same served year, so
  SEAS keeps those sessions in its 30-minute buckets and EVT keeps their events; a contract without exactly one
  known offset stays NaN and is counted as left out, with the reason named.
- EVT intraday applies the session exclusions SEAS applies: NQ from qa.day_gate, every other symbol from its futures
  repair provenance (`excluded_sessions`); a symbol with neither record is refused.
- DQ builds the XNYS session list once; ROLL states the gap's sign the way the offsets give it (old contract less
  new); EVT names the daily path a sum of returns; a calendar read failure names the error class only.
Every price read goes through the fake serve with a temporary log.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import shutil
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.sessions import nyse_sessions
from nq_terminal.app import create_app
from nq_terminal.services import dq as dq_mod
from nq_terminal.services import events as ev
from nq_terminal.services import roll as roll_mod
from nq_terminal.services import seasonality as seas_service
from nq_terminal.services.bars import BarService, derive_raw_close, find_rolls
from nq_terminal.services.catalog import SeriesId
from nq_terminal.services.events import FOMC_MANIFEST, MACRO_SPEC
from nq_terminal.services.files import FileAccessError, FileCache
from nq_terminal.settings import load_settings

from fakes import FIXTURES, FakeCatalog, fake_series_ids, make_fake_serve

from conftest import api_client

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
UTC = "UTC"
YEAR = 2020
CPI_DAY = "2015-01-16"


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=UTC)


# ---------------------------------------------------------------- serve wrappers (all through the fake gate)


class Blanking:
    """The fake serve, with `raw_c` and `offset` set to NaN on the rows `pick(frame)` selects in NQ repaired 1m
    frames, as the repaired file stores its rebuilt bars."""

    def __init__(self, log: Path, pick):
        self.fake = make_fake_serve(log)
        self.pick = pick

    def __call__(self, start, end, *, caller, reason, symbol="NQ.V.0", timeframe="1m", variant="vendor"):
        frame = self.fake(start, end, caller=caller, reason=reason, symbol=symbol, timeframe=timeframe,
                          variant=variant)
        if (symbol, timeframe, variant) != ("NQ.V.0", "1m", "repaired") or frame.empty:
            return frame
        out = frame.copy()
        rows = self.pick(out)
        out.loc[rows, ["raw_c", "offset"]] = np.nan
        return out


def day_rows(day: str, lo: str = "00:00", hi: str = "23:59"):
    def pick(frame: pd.DataFrame) -> pd.Series:
        return (frame["ts"] >= ts(f"{day} {lo}")) & (frame["ts"] <= ts(f"{day} {hi}"))

    return pick


def contract_rows(at: str):
    def pick(frame: pd.DataFrame) -> pd.Series:
        near = frame.loc[frame["ts"] >= ts(at), "instrument_id"]
        return frame["instrument_id"] == (near.iloc[0] if len(near) else -1)

    return pick


def app_client(root: Path, serve, catalog=None, exclusions=None) -> TestClient:
    app = create_app(load_settings({"NQT_FIXTURE_DIR": str(root)}))
    app.state.serve_fn = serve
    app.state.catalog = catalog or FakeCatalog()
    if exclusions is not None:
        app.state.seasonality_exclusions = exclusions
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


# ---------------------------------------------------------------- derive_raw_close


def minute_frame() -> pd.DataFrame:
    stamps = pd.date_range("2015-01-05 14:30", periods=6, freq="1min", tz=UTC)
    return pd.DataFrame({"ts": stamps, "o": [110.0, 111, 112, 113, 214, 215], "c": [111.0, 112, 113, 114, 215, 216],
                         "instrument_id": [1, 1, 1, 1, 2, 2], "raw_c": [101.0, 102, np.nan, np.nan, np.nan, np.nan],
                         "offset": [10.0, 10.0, np.nan, np.nan, np.nan, np.nan]})


def test_derive_raw_close_uses_the_contracts_one_offset():
    out = derive_raw_close(minute_frame())
    assert out["raw_c"].tolist()[:4] == [101.0, 102.0, 103.0, 104.0]
    assert out["offset"].tolist()[:4] == [10.0] * 4
    assert out["raw_c"].iloc[4:].isna().all()  # contract 2 has no known offset: stays unknown


def test_derive_raw_close_refuses_a_contract_with_two_offsets():
    frame = minute_frame()
    frame.loc[1, "offset"] = 11.0
    frame.loc[1, "raw_c"] = 101.0
    assert derive_raw_close(frame)["raw_c"].iloc[2:4].isna().all()


def test_derive_raw_close_leaves_a_complete_frame_as_it_is():
    frame = minute_frame().iloc[:2]
    assert derive_raw_close(frame) is frame


def test_the_bar_service_derives_the_raw_close_on_rebuilt_minutes(tmp_path):
    serve = Blanking(tmp_path / "log.jsonl", day_rows(CPI_DAY))
    served = BarService(serve, cache_bytes=2**31).frame("NQ.V.0", "1m", "repaired", ts(f"{CPI_DAY} 14:00"),
                                                        ts(f"{CPI_DAY} 15:00")).frame
    assert len(served) and np.isfinite(served["raw_c"].to_numpy()).all()
    assert np.allclose(served["raw_c"], served["c"] - served["offset"], rtol=0, atol=1e-9)
    assert all(c.caller == "terminal" for c in serve.fake.calls)


# ---------------------------------------------------------------- SEAS: rebuilt sessions stay in the buckets


def seas_intraday(client: TestClient) -> dict:
    res = client.get("/api/seasonality/instrument/NQ", params={"start_year": YEAR, "end_year": YEAR})
    assert res.status_code == 200, res.text
    return next(p for p in res.json()["panels"] if p["id"] == "intraday")


def gated(year: int) -> set[str]:
    doc = json.loads((FIXTURES / "results" / "screens" / "za_v0_repaired_rejected_days.json").read_text("utf-8"))
    return {d[:10] for d in doc if d[:4] == str(year)}


def test_seas_keeps_a_rebuilt_session_in_the_buckets(tmp_path):
    base = seas_intraday(app_client(FIXTURES, make_fake_serve(tmp_path / "a.jsonl")))
    table = nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31))
    day = next(str(d) for d in table.index if str(d) not in gated(YEAR))
    rebuilt = seas_intraday(app_client(FIXTURES, Blanking(tmp_path / "b.jsonl", day_rows(day))))
    assert rebuilt["excluded_sessions"] == base["excluded_sessions"]
    for ours, ref in zip(rebuilt["buckets"], base["buckets"]):
        assert ours["n"] == ref["n"]
        if ref["n"]:
            assert math.isclose(ours["mean"], ref["mean"], rel_tol=1e-9)


def test_seas_counts_and_names_sessions_left_without_a_raw_close(tmp_path):
    base = seas_intraday(app_client(FIXTURES, make_fake_serve(tmp_path / "a.jsonl")))
    blank = seas_intraday(app_client(FIXTURES, Blanking(tmp_path / "b.jsonl", contract_rows(f"{YEAR}-04-01"))))
    table = nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31))
    eligible = len(table)
    used = max(b["n"] for b in blank["buckets"])
    assert blank["excluded_sessions"] == eligible - used > base["excluded_sessions"]
    assert "no raw close" in blank["source"] and "qa.day_gate" in blank["source"]


# ---------------------------------------------------------------- EVT


LINES = ["2015-01-16 CPI@08:30", "2015-01-28 FOMC@14:00"]


def evt_root(tmp: Path) -> Path:
    (tmp / MACRO_SPEC).parent.mkdir(parents=True)
    (tmp / MACRO_SPEC).write_text(json.dumps({"name": "macroday_v0", "event_dates": LINES}), encoding="utf-8")
    (tmp / FOMC_MANIFEST).parent.mkdir(parents=True)
    (tmp / FOMC_MANIFEST).write_text(json.dumps({"pages": {"2015-01-28": {"role": "event"}}}), encoding="utf-8")
    (tmp / "results" / "screens").mkdir(parents=True)
    for name in ("za_v0_rejected_days.json", "za_v0_repaired_rejected_days.json"):  # NQ's session record
        shutil.copyfile(FIXTURES / "results" / "screens" / name, tmp / "results" / "screens" / name)
    return tmp


def cpi_study(client: TestClient, symbol: str = "NQ.V.0"):
    return client.get("/api/events/study", params={"symbol": symbol, "event": "CPI", "mode": "intraday", "pre": 10,
                                                   "post": 15})


def test_evt_keeps_an_event_on_a_rebuilt_session(tmp_path):
    root = evt_root(tmp_path / "root")
    base = cpi_study(app_client(root, make_fake_serve(tmp_path / "a.jsonl"))).json()["events"][0]
    rebuilt = cpi_study(app_client(root, Blanking(tmp_path / "b.jsonl", day_rows(CPI_DAY)))).json()["events"][0]
    assert base["used"] and rebuilt["used"], rebuilt["reason"]
    assert np.allclose(rebuilt["path"], base["path"], rtol=1e-12, atol=1e-15)


class RepairedGold:
    """The fake serve, answering GC.V.0 1m repaired with the synthetic GC minutes (the fake set has no GC repair)."""

    def __init__(self, log: Path):
        self.fake = make_fake_serve(log)

    def __call__(self, start, end, *, caller, reason, symbol="NQ.V.0", timeframe="1m", variant="vendor"):
        if symbol == "GC.V.0" and timeframe == "1m":
            variant = "vendor"
        return self.fake(start, end, caller=caller, reason=reason, symbol=symbol, timeframe=timeframe,
                         variant=variant)


def gold_catalog() -> FakeCatalog:
    return FakeCatalog((*fake_series_ids(), SeriesId("GC.V.0", "1m", "repaired")))


def test_evt_voids_a_non_nq_event_on_an_unrepaired_session(tmp_path):
    root = evt_root(tmp_path / "root")
    drop = seas_service.Exclusions(True, frozenset({dt.date(2015, 1, 16)}), "futures repair provenance (test)")
    client = app_client(root, RepairedGold(tmp_path / "a.jsonl"), gold_catalog(),
                        exclusions=lambda symbol, variant: drop)
    res = cpi_study(client, "GC.V.0")
    assert res.status_code == 200, res.text
    event = res.json()["events"][0]
    assert not event["used"] and "repair provenance" in event["reason"]
    keep = seas_service.Exclusions(True, frozenset(), "futures repair provenance (test)")
    kept = cpi_study(app_client(root, RepairedGold(tmp_path / "b.jsonl"), gold_catalog(),
                                exclusions=lambda symbol, variant: keep)).json()
    assert kept["events"][0]["used"]  # born failing: the same event is used when its session is not excluded


def test_evt_refuses_intraday_on_a_symbol_without_a_session_record(tmp_path):
    root = evt_root(tmp_path / "root")
    client = app_client(root, RepairedGold(tmp_path / "a.jsonl"), gold_catalog(),
                        exclusions=lambda symbol, variant: seas_service.NOT_ASSESSED)
    res = cpi_study(client, "GC.V.0")
    assert res.status_code == 422 and "not assessed" in res.json()["detail"]


def test_evt_nq_voids_still_name_the_day_gate(tmp_path):
    root = evt_root(tmp_path / "root")
    drop = seas_service.Exclusions(True, frozenset({dt.date(2015, 1, 16)}), "qa.day_gate, from results/screens")
    body = cpi_study(app_client(root, make_fake_serve(tmp_path / "a.jsonl"),
                                exclusions=lambda symbol, variant: drop)).json()
    assert body["events"][0]["reason"] == "gated session (qa.day_gate)"


def test_evt_units_name_each_modes_path():
    assert "sum of daily returns" in ev.DAILY_UNIT
    assert ev.INTRADAY_UNIT.startswith("fraction of the price")
    assert ev.unit_for("daily") == ev.DAILY_UNIT and ev.unit_for("intraday") == ev.INTRADAY_UNIT


def test_a_calendar_read_failure_names_the_error_class_only(tmp_path):
    path = tmp_path / "macroday_v0.json"
    path.write_text("{}", encoding="utf-8")

    class Broken(FileCache):
        def get(self, *args, **kwargs):
            raise FileAccessError("C:\\secret\\folder\\macroday_v0.json is locked")

    with pytest.raises(ev.CalendarError) as err:
        ev._read(Broken(roots=[tmp_path]), path)
    assert "secret" not in str(err.value) and "FileAccessError" in str(err.value)


# ---------------------------------------------------------------- DQ and ROLL


def test_dq_builds_the_nyse_session_list_once(monkeypatch):
    dq_mod.nq_sessions.cache_clear()
    calls = []
    real = dq_mod.xc.get_calendar

    def counted(name):
        calls.append(name)
        return real(name)

    monkeypatch.setattr(dq_mod.xc, "get_calendar", counted)
    first = dq_mod.nq_sessions()
    second = dq_mod.nq_sessions()
    assert calls == ["XNYS"] and first == second and first[0] == dq_mod.NQ_FIRST_SESSION
    dq_mod.nq_sessions.cache_clear()


def test_roll_gap_sign_is_old_contract_less_new():
    # contango: the new contract trades 50 points above the old one on the day before the roll
    frame = pd.DataFrame({"ts": [ts("2015-03-12"), ts("2015-03-13")], "c_none": [14_000.0, 14_060.0],
                          "instrument_id": [1, 2], "offset": [50.0, 0.0]})
    (roll,) = find_rolls(frame, "1d")
    assert roll.gap_pts == -50.0 and roll.gap_pct < 0
    assert "old contract less new" in roll_mod.UNIT_NOTE
    assert "negative when the new contract trades above the old" in roll_mod.UNIT_NOTE
