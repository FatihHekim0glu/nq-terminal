"""SEAS service, the 30-minute panel's left-out count (TASKS Phase 11; descriptive, [POST HOC], no p-values).

Every eligible session the panel does not use is counted, and each reason is named on its own: excluded by the
session record, no 1m bar at all (for NQ, every session of 2010 before its 1m series starts on 2010-09-29), and bars
without a raw close (a contract with no known offset). Born failing: one lumped "no bar or no raw close" count hides
which of the two happened, so a user cannot tell a series that starts late from rebuilt sessions being dropped.
A stub bar service answers the one serve per year; nothing here reads a file or calls the gate.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from nq_lab.sessions import nyse_sessions
from nq_terminal.services import seasonality as seas_service
from nq_terminal.services.bars import Served
from nq_terminal.services.sessions import Exclusions

YEAR = 2021
SOURCE = "qa.day_gate, from the stub"


def minutes(day: str, raw: float) -> list[dict]:
    """Every 1m bar of one NYSE session (09:30 to 15:59 ET), back-adjusted o and c 100 above `raw`."""
    stamps = pd.date_range(f"{day} 09:30", f"{day} 15:59", freq="1min", tz="America/New_York").tz_convert("UTC")
    return [{"ts": t, "o": 1100.0 + i % 3, "c": 1101.0 + i % 3, "raw_c": raw} for i, t in enumerate(stamps)]


class StubBars:
    def __init__(self, frame: pd.DataFrame):
        self.frame_ = frame
        self.calls = 0

    def frame(self, symbol, source_tf, variant, start, end, *, version=None) -> Served:
        self.calls += 1
        rows = self.frame_[(self.frame_["ts"] >= start) & (self.frame_["ts"] < end)].reset_index(drop=True)
        return Served(frame=rows, years=(start.year,), cached=True)


def panel_for(frame: pd.DataFrame, gated: set[dt.date]) -> seas_service.Panel:
    src = seas_service.MinuteSource(StubBars(frame), "NQ.V.0", "repaired", None)
    exclusions = Exclusions(assessed=True, days=frozenset(gated), source=SOURCE)
    panel, years, _ = seas_service.intraday_panel(src, exclusions, YEAR, YEAR)
    assert years == [YEAR]
    return panel


def test_the_left_out_count_names_missing_bars_and_missing_raw_closes_apart():
    rows = minutes("2021-06-01", 1001.0) + minutes("2021-06-02", np.nan) + minutes("2021-06-03", 1002.0)
    frame = pd.DataFrame(rows)
    gated = {dt.date(2021, 6, 3), dt.date(2021, 6, 4)}
    panel = panel_for(frame, gated)
    eligible = len(nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31)))
    no_bar = eligible - len(gated) - 2  # kept 2021-06-01 and 06-02 have bars; 06-03 has bars but is gated
    assert max(b.n for b in panel.buckets) == 1
    assert panel.excluded_sessions == eligible - 1
    assert panel.source.startswith(SOURCE)
    assert f"{no_bar} more with no 1m bar" in panel.source
    assert "1 more whose bars have no raw close" in panel.source
    assert "no bar or no raw close" not in panel.source  # born failing: the old lumped note


def test_the_note_gives_the_first_bar_when_the_series_starts_inside_the_years():
    panel = panel_for(pd.DataFrame(minutes("2021-06-01", 1001.0)), set())
    assert "the first 1m bar in the years picked is on 2021-06-01" in panel.source


def test_a_complete_year_names_only_the_session_record():
    table = nyse_sessions(dt.date(YEAR, 1, 1), dt.date(YEAR, 12, 31))
    rows = [bar for day in table.index if day.month == 1 for bar in minutes(day.isoformat(), 1001.0)]
    frame = pd.DataFrame(rows)
    later = {d for d in table.index if d.month > 1}
    panel = panel_for(frame, later)
    assert panel.excluded_sessions == len(later)
    assert panel.source == SOURCE
