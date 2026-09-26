"""Series rules settled in the Phase 3 improvement run (ARCHITECTURE s4 Analytics; ANALYTICS_CATALOG C1, C2).

- A malformed series is a `SeriesError` (served as 503), never a plain ValueError (an undeclared 500): an empty
  series, repeated or unsorted session dates.
- Item (b): an account whose equity reaches zero or below cannot compound; `SeriesNotCompoundable` names the first
  such session and the count (the three lookahead probe runs).
- dtsmom_v0 rows are dated inside their own label month (the last NYSE session of the month), not by `end`, which
  is the first session of the next month; blocks and month cells then equal the screen's own.
- Item (d): one-contract trade series are zero-filled over the screen's served window (serve.start to serve.end,
  else the NQ data start 2010-09-28 to the fence), not from the first to the last trade; where the screen records
  the evaluated session count, the built series must match it (born failing).
- eurodrift_v0 void nights are zero, as the screen's own unconditional book (`eurodrift_stats.daily_books`).
- The Basis A guard: a gate-rejected session that carries a trade is refused (born failing).
"""
from __future__ import annotations

import csv
import json
import math
import shutil
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import ROOT
from nq_terminal.analytics import distribution, perf, relative, series
from nq_terminal.services.research import ResearchService

from test_runs_support import FakeClock, service

SCREENS = ROOT / "results" / "screens"
ANCHOR = 1e-12


@lru_cache(maxsize=1)
def real_research() -> ResearchService:
    return ResearchService(ROOT)


@lru_cache(maxsize=1)
def real_runs():
    return service(ROOT, clock=FakeClock())


def _screen(name: str) -> dict:
    return json.loads((SCREENS / f"{name}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- malformed series are SeriesError


def _series(r: pd.Series) -> series.SessionSeries:
    return series.SessionSeries(name="x", basis="A", periods=252, r=r, unit="u", on_capital=True, capital=None,
                                source="s", kind="daily", label="l")


def test_repeated_session_dates_are_a_series_error():
    idx = pd.DatetimeIndex(["2015-01-02", "2015-01-02"])
    with pytest.raises(series.SeriesError, match="increasing"):
        _series(pd.Series([0.1, 0.2], index=idx))


def test_an_empty_series_is_a_series_error():
    with pytest.raises(series.SeriesError, match="empty"):
        _series(pd.Series([], index=pd.DatetimeIndex([]), dtype=float))


def test_a_nan_return_is_a_series_error():
    with pytest.raises(series.SeriesError, match="NaN"):
        _series(pd.Series([0.1, math.nan], index=pd.DatetimeIndex(["2015-01-02", "2015-01-05"])))


# ---------------------------------------------------------------- item (b): not compoundable


def test_non_positive_equity_names_the_first_session_and_the_count():
    """Born failing: an account below zero has no return; the error says where it first happened."""
    dates = ["2015-01-02", "2015-01-05", "2015-01-06", "2015-01-07"]
    with pytest.raises(series.SeriesNotCompoundable, match=r"2 sessions \(first 2015-01-05"):
        series.returns_from_equity([90.0, -5.0, 0.0, 10.0], dates, 100.0)
    assert len(series.returns_from_equity([90.0, 95.0, 99.0, 101.0], dates, 100.0)) == 4


def test_not_compoundable_is_a_series_error_but_not_a_missing_source():
    assert issubclass(series.SeriesNotCompoundable, series.SeriesError)
    assert not issubclass(series.SeriesNotCompoundable, series.SeriesUnusable)


@pytest.mark.parametrize(("run_id", "count", "first"), [
    ("nt_volmanaged_v0_final_probe_2012-02-16", 188, "2012-02-17"),
    ("nt_volmanaged_v0_final_probe_2013-04-03", 139, "2013-04-12"),
    ("nt_volmanaged_v0_final_probe_2014-06-18", 36, "2014-06-24"),
])
def test_the_lookahead_probes_are_not_compoundable(run_id, count, first):
    with pytest.raises(series.SeriesNotCompoundable, match=f"{count} sessions \\(first {first}"):
        series.run_series(real_runs(), real_research(), run_id)


# ---------------------------------------------------------------- dtsmom_v0 dated in its label month


def _dtsmom_rows() -> list[dict]:
    with (SCREENS / "dtsmom_v0_monthly.csv").open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_dtsmom_rows_sit_in_their_label_month_and_never_after_end():
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    rows = _dtsmom_rows()
    assert [d.strftime("%Y-%m") for d in s.r.index] == [row["label"] for row in rows]
    assert all(row["start"] <= d.strftime("%Y-%m-%d") <= row["end"] for d, row in zip(s.r.index, rows))
    assert s.r.index[0].strftime("%Y-%m-%d") == "2012-01-31" and s.r.index[-1].strftime("%Y-%m-%d") == "2021-12-31"
    assert abs(perf.sharpe(s.r, 12) - 0.25493487321272734) <= ANCHOR  # the section 14 anchor is untouched


def test_every_dtsmom_month_cell_equals_the_csv_row_of_its_label():
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    grid = distribution.monthly_heatmap(s.r, "A")
    for row in _dtsmom_rows():
        year, month = map(int, row["label"].split("-"))
        assert grid.loc[year, month] == pytest.approx(float(row["r_ts_1"]), rel=1e-12, abs=0), row["label"]
    assert int(grid.notna().to_numpy().sum()) == 120


def test_dtsmom_blocks_equal_the_screen_blocks():
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    stored = _screen("dtsmom_v0")["blocks"]["alphas"]
    ours = relative.alpha_by_block(s.r, s.bench, (4,), 12)
    for (_, want), (_, got) in zip(sorted(stored.items()), sorted(ours.items())):
        assert got["n"] == want["n"]
        assert abs(got["alpha_annual_pct"] - want["a_x12_pct"]) <= ANCHOR * abs(want["a_x12_pct"])
        assert abs(got["t_min"] - want["t_a"]) <= 1e-9 * abs(want["t_a"])


def test_dtsmom_research_series_carries_the_same_dates():
    rs = real_research().series("dtsmom_v0", 1)
    s = series.hypothesis_series(real_research(), "dtsmom_v0", 1)
    assert pd.to_datetime(rs.t, unit="s").strftime("%Y-%m-%d").tolist() == s.r.index.strftime("%Y-%m-%d").tolist()


# ---------------------------------------------------------------- item (d): the screen's served window


@pytest.mark.parametrize("name", ["tom_v0", "preholiday_v0", "prefomc_v0", "halloween_v0", "fomctone_v0",
                                  "mac5rev_v0", "rebal_v0", "macroday_v0", "overnight_v0"])
def test_trade_series_span_the_screen_window(name):
    s = series.hypothesis_series(real_research(), name, 1)
    assert s.r.index[0].strftime("%Y-%m-%d") == "2010-09-28", name
    assert s.r.index[-1].strftime("%Y-%m-%d") == "2021-12-31", name
    assert s.n == 2836 and s.r.index.equals(series.session_index("2010-09-28", "2022-01-01")), name


def test_za_v0_matches_the_gated_sessions_the_screen_evaluated():
    s = series.hypothesis_series(real_research(), "za_v0", 1)
    screen = _screen("za_v0_repaired")
    assert s.n == screen["gated_days"] == 2825 and len(s.dropped) == screen["rejected_days"] == 11


def test_mac5rev_matches_the_sessions_the_screen_counted():
    assert series.hypothesis_series(real_research(), "mac5rev_v0", 1).n == _screen("mac5rev_v0")["counts"]["sessions"]


def test_sharpe_moves_when_the_window_is_the_screen_window():
    """Recorded numbers: halloween_v0 at 1 tick, 0.8836 first to last trade (2,769 sessions), 0.8731 over the
    2,836 sessions of the served window (the statistics review's 0.8730587510830351)."""
    s = series.hypothesis_series(real_research(), "halloween_v0", 1)
    assert perf.sharpe(s.r, 252) == pytest.approx(0.8730587510830351, rel=1e-9)


# ---------------------------------------------------------------- eurodrift void nights are zero


def test_eurodrift_void_nights_are_zero_as_the_screen_unconditional_book():
    """The terminal showed 0.43397 on 2,317 valid nights annualised with 252; the screen's unconditional book puts
    0 on void nights (C6.sharpe_uncond 0.39301 on the 2,825 sessions with both NQ closes, a set that needs prices).
    Over the 2,835 candidate nights the Sharpe is 0.392314."""
    s = series.hypothesis_series(real_research(), "eurodrift_v0", 1)
    screen = _screen("eurodrift_v0")
    assert s.n == screen["counts"]["candidates"] == 2835
    assert int((s.r == 0).sum()) >= screen["counts"]["candidates"] - screen["counts"]["valid"]
    assert perf.sharpe(s.r, 252) == pytest.approx(0.39231436996843955, rel=1e-12)
    assert abs(perf.sharpe(s.r, 252) - screen["C6"]["sharpe_uncond"]) < 0.002


# ---------------------------------------------------------------- the Basis A gate guard (born failing)


def _za_root(tmp_path: Path, rejected: dict, gated_days: int | None = None) -> Path:
    root = tmp_path / "root"
    screens = root / "results" / "screens"
    screens.mkdir(parents=True)
    with (ROOT / "results" / "registry.csv").open(encoding="utf-8", newline="") as handle:
        lines = handle.read().splitlines()
    keep = [lines[0]] + [line for line in lines[1:] if line.startswith("za_v0,")]
    (root / "results" / "registry.csv").write_text("\n".join(keep) + "\n", encoding="utf-8")
    for name in ("za_v0_repaired_trades.csv", "za_v0_rejected_days.json"):
        shutil.copy(SCREENS / name, screens / name)
    screen = _screen("za_v0_repaired")
    if gated_days is not None:
        screen["gated_days"] = gated_days
    (screens / "za_v0_repaired.json").write_text(json.dumps(screen), encoding="utf-8")
    (screens / "za_v0_repaired_rejected_days.json").write_text(json.dumps(rejected), encoding="utf-8")
    return root


def _rejected() -> dict:
    return json.loads((SCREENS / "za_v0_repaired_rejected_days.json").read_text(encoding="utf-8"))


def _a_traded_session() -> str:
    s = series.hypothesis_series(real_research(), "za_v0", 1)
    return s.r.index[np.flatnonzero(s.r.to_numpy() != 0)[0]].strftime("%Y-%m-%d")


def test_the_untampered_za_copy_builds(tmp_path):
    assert series.hypothesis_series(ResearchService(_za_root(tmp_path, _rejected())), "za_v0", 1).n == 2825


def test_a_rejected_session_that_carries_a_trade_is_refused(tmp_path):
    rejected = _rejected()
    rejected.pop(sorted(rejected)[0])
    rejected[_a_traded_session()] = "tampered"  # same count, one traded session named
    with pytest.raises(series.SeriesError, match="carry trades"):
        series.hypothesis_series(ResearchService(_za_root(tmp_path, rejected)), "za_v0", 1)


def test_a_count_that_disagrees_with_the_screen_is_refused(tmp_path):
    with pytest.raises(series.SeriesError, match="2824"):
        series.hypothesis_series(ResearchService(_za_root(tmp_path, _rejected(), gated_days=2824)), "za_v0", 1)
