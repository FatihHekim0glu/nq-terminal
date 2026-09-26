"""QA and repair reports are fenced before they are served (ARCHITECTURE s9 "fence on every axis").

The reports are written by research scripts that may cover 2022+ (NQ's QA runs to 2026-09-24, and the futures
repair workflow is writing new ones now). `/api/qa/{name}` must not serve a market timestamp, year key or epoch
after the fence. Process write times (keys ending `_utc`, e.g. `written_utc`) are not market data and stay, and
a value equal to the fence itself (a window's exclusive end) stays.
"""
from __future__ import annotations

import re

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from nq_lab.config import IS_END, RESULTS
from nq_terminal.app import create_app
from nq_terminal.services.fence import after_fence, fence_filter
from nq_terminal.settings import load_settings

LOCAL = "http://127.0.0.1"
LOOPBACK = ("127.0.0.1", 50000)
DATE = re.compile(r"^(\d{4})-\d{2}-\d{2}")
FENCE_S = int(IS_END.timestamp())
REPORTS = sorted(p.stem for p in RESULTS.glob("qa_report*.json")) + ["repair_report"]


def _violations(value, path: str = "") -> list[str]:
    out = []
    if isinstance(value, dict):
        for key, item in value.items():
            text = str(key)
            if re.fullmatch(r"\d{4}", text) and int(text) >= IS_END.year:
                out.append(f"{path}/{text} (year key)")
            elif DATE.match(text) and pd.Timestamp(text[:10], tz="UTC") > IS_END:
                out.append(f"{path}/{text} (date key)")
            if not text.endswith("_utc"):
                out += _violations(item, f"{path}/{text}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            out += _violations(item, f"{path}[{i}]")
    elif isinstance(value, str) and DATE.match(value) and after_fence(value):
        out.append(f"{path}={value}")
    elif isinstance(value, (int, float)) and not isinstance(value, bool) and after_fence(value):
        out.append(f"{path}={value} (epoch)")
    return out


def test_after_fence_reads_dates_and_epochs():
    assert after_fence("2022-01-02 23:00:00+00:00") and after_fence("2022-03-16")
    assert not after_fence("2022-01-01 00:00:00+00:00") and not after_fence("2021-12-31")
    assert after_fence((FENCE_S + 86400) * 1000) and not after_fence(FENCE_S * 1000)
    assert after_fence((FENCE_S + 1) * 10**9) and not after_fence(2311) and not after_fence(1.5)
    assert not after_fence("NQ.V.0") and not after_fence(True)


def test_fence_filter_drops_post_fence_entries_born_failing():
    report = {"last_ts": "2026-09-24 23:59:00+00:00", "written_utc": "2026-09-26T15:18:24+00:00",
              "window": ["2010-01-01", "2022-01-01 00:00:00+00:00"],
              "years": {"2021": {"rows": 5}, "2022": {"rows": 7, "first_ts": "2022-01-02"}},
              "rolls": [{"ts": "2021-12-15", "gap": 10.0}, {"ts": "2022-06-15", "gap": 33.0}],
              "end_ms": (FENCE_S + 86400) * 1000}
    assert _violations(report)  # the raw report leaks
    kept, dropped = fence_filter(report)
    assert _violations(kept) == [] and dropped == 4
    assert kept["written_utc"] == report["written_utc"] and kept["window"] == report["window"]
    assert kept["years"] == {"2021": {"rows": 5}} and kept["rolls"] == [{"ts": "2021-12-15", "gap": 10.0}]
    assert kept["last_ts"] is None and kept["end_ms"] is None


@pytest.fixture(scope="module")
def real_client() -> TestClient:
    return TestClient(create_app(load_settings({})), base_url=LOCAL, client=LOOPBACK)


@pytest.mark.parametrize("name", REPORTS)
def test_no_real_report_serves_a_point_past_the_fence(real_client, name):
    body = real_client.get(f"/api/qa/{name}").json()
    assert body["fence_end"] == IS_END.date().isoformat()
    assert _violations(body["content"]) == [], name


def test_the_nq_report_had_post_fence_content_that_is_now_dropped(real_client):
    body = real_client.get("/api/qa/qa_report").json()
    assert body["fenced_out"] > 0
    assert all(int(y) < IS_END.year for y in body["content"].get("years", {}))
