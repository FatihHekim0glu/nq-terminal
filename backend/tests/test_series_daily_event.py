"""Series sources of the daily and event rows (wave w3, slice series-daily-event).

Two runs share every test:
- the fixture copy (plain `pytest`): synthetic files under `fixtures/results/screens/daily_event/`, which copy each
  file's column layout with made-up values and carry a synthetic screen JSON written at the same paths as the lab's;
- the lab tree (`-m lab_only`): the real files, anchored to the real screen JSON at 1e-9. Skipped without the marker
  or without the lab files. The repository is public, so no real in-sample row is ever copied into a fixture.

Three rows state their headline sample as a row filter (hvix_nd_v0, apieia_ho_v0, wkndshort_v0):
`SeriesSource.keep_where` says it, and the tests plant the source without the rule to show the anchor needs it.

Anchors: n, mean and sd of the series at 1 tick against the screen's headline, the 0 and 2 tick means against the
cost ladder, and a date anchor from a calendar fact the file does not write itself (E+15, the session before D, the
Friday before the refunding, the first full day after the Friday, the first and last mark). Each is born failing
against the broken state it guards. wkndshort_v0 is a legs file: the legs of a week share one exit and their sum over
K is the weekly book (spec rule 2), so its anchor sums the legs per session first.
"""
from __future__ import annotations

import dataclasses
import functools
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Callable

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import ROOT
from nq_terminal import constants
from nq_terminal.analytics import perf
from nq_terminal.analytics import series as series_mod
from nq_terminal.analytics.series import SeriesError, hypothesis_series, screen_window, session_index
from nq_terminal.series_sources import daily_event
from nq_terminal.services import research as research_mod
from nq_terminal.services.research import ResearchDataError, ResearchService

from fakes import FIXTURES

FIXTURE_DIR = FIXTURES / "results" / "screens" / "daily_event"
ROWS = ("fedflow_tsy_v0", "lhrev_letf_v0", "tsyauct_intra_ml_v0", "hvix_nd_v0", "apieia_ho_v0", "cropsmooth_v0",
        "dburst_rev_v1", "fomcdrift_tsy_v0", "fomcfx_v0", "fomcpc_fx_v0", "pretra_tsy_v0", "xfut_tcn120_v0",
        "wkndgap_fx_v0", "wkndshort_v0")
LEARNED = tuple(daily_event.SOURCES)
TRADE_ROWS = tuple(n for n in LEARNED if daily_event.SOURCES[n].kind == "trades")
ONE_TICK_ROWS = ("wkndshort_v0",)  # the legs file records the net P&L at 1 tick only (`h_net1`)
WKNDSHORT_K = 100_000_000  # spec design.K_usd: the book is the sum of the active legs over K (rule 2)
SESSION_TABLE = ROOT / "data" / "calendar" / "wkndshort_sessions_2010_2021.json"
FENCE = pd.Timestamp("2022-01-01", tz="UTC")
HASH = "0" * 64
REGISTRY_HEADER = "name,registered,n,p,control_p,verdict,family_k,bonferroni_p,holm_p,bh_q,spec,spec_sha256,spec_sha_ok"


@dataclass(frozen=True)
class Anchor:
    """Where the screen JSON records the numbers a series must reproduce (dotted paths) and the column scale."""

    scale: float
    n: str
    mean: str
    sd: str | None
    ladder: dict[int, str]
    events_only: bool = False  # the file holds a zero row in every week without an event; the screen counts events
    per_session: bool = False  # the file holds legs; the legs of one event share its exit and the screen counts events


_HEAD = {"n": "headline.n", "mean": "headline.mean_bp", "sd": "headline.sd_bp"}
_LADDER = {0: "cost_ladder_mean_bp.0_tick", 2: "cost_ladder_mean_bp.2_tick"}
ANCHORS = {
    "fedflow_tsy_v0": Anchor(1.0, **_HEAD, ladder={0: "secondaries.S10.mean_net_0tick_bp",
                                                   2: "secondaries.S10.mean_net_2tick_bp"}),
    "lhrev_letf_v0": Anchor(1e4, **_HEAD, ladder=_LADDER),
    "tsyauct_intra_ml_v0": Anchor(1e4, **_HEAD, ladder={0: "secondaries.S11.zero_tick_fee_only.mean_bp"}),
    "cropsmooth_v0": Anchor(1.0, "headline.n", "headline.mean", None,
                            {0: "net_0tick.mean", 2: "net_2tick.mean"}),
    "hvix_nd_v0": Anchor(1.0, "headline.n", "headline.mean_bp", "headline.sd",
                         {0: "fee_only_mean_bp", 2: "P3_mean_2tick_bp"}),
    "apieia_ho_v0": Anchor(1.0, "headline.n", "headline.mean", "headline.sd",
                           {0: "headline.ladder_mean_bp.0", 2: "headline.ladder_mean_bp.2"}),
    "fomcdrift_tsy_v0": Anchor(1e4, **_HEAD, ladder=_LADDER),
    "fomcfx_v0": Anchor(1e4, **_HEAD, ladder=_LADDER),
    "fomcpc_fx_v0": Anchor(1.0, **_HEAD, ladder={0: "secondaries.S12_costs.net_0tick_bp",
                                                 2: "P4_2tick.mean_bp"}),
    "pretra_tsy_v0": Anchor(1e4, **_HEAD, ladder=_LADDER),
    "wkndgap_fx_v0": Anchor(1.0, "headline.n", "headline.mean", "headline.sd", {2: "headline.mean_2tick"},
                            events_only=True),
    "wkndshort_v0": Anchor(1 / WKNDSHORT_K, "headline.n", "headline.mean", "headline.sd", {}, per_session=True),
}


# ---------------------------------------------------------------- roots and helpers


def _pluck(doc: dict, path: str):
    for key in path.split("."):
        doc = doc[key]
    return doc


def _fixture_root(tmp: Path) -> Path:
    screens = tmp / "results" / "screens"
    screens.mkdir(parents=True)
    for path in FIXTURE_DIR.iterdir():
        shutil.copyfile(path, screens / path.name)
    lines = [REGISTRY_HEADER] + [f"{n},True,10,0.5,,FAIL,59,1,1,1,{n},{HASH},True" for n in LEARNED]
    (tmp / "results" / "registry.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return tmp


@pytest.fixture
def patched(monkeypatch):
    """The slice's sources active in the research service and the series builder, whether or not they are merged."""
    merged = MappingProxyType({**constants.SERIES_SOURCES, **daily_event.SOURCES})
    monkeypatch.setattr(research_mod, "SERIES_SOURCES", merged)
    monkeypatch.setattr(series_mod, "SERIES_SOURCES", merged)
    return monkeypatch


def _lab_or_skip(request) -> Path:
    if not (ROOT / "results" / "screens" / daily_event.SOURCES[LEARNED[0]].file).is_file():
        pytest.skip("no lab tree")
    return ROOT


@pytest.fixture(params=[pytest.param("fixture"), pytest.param("lab", marks=pytest.mark.lab_only)])
def root(request, tmp_path, patched) -> Path:
    return _fixture_root(tmp_path / "fx") if request.param == "fixture" else _lab_or_skip(request)


@pytest.fixture
def lab(request, patched) -> Path:
    return _lab_or_skip(request)


def _variant(tmp: Path, base: Path, name: str, mutate: Callable[[pd.DataFrame], pd.DataFrame] | None = None) -> Path:
    """A research root holding one row of `base` (registry, screen JSON, series file), the file optionally edited."""
    source = daily_event.SOURCES[name]
    screens = tmp / "results" / "screens"
    screens.mkdir(parents=True)
    shutil.copyfile(base / "results" / "registry.csv", tmp / "results" / "registry.csv")
    shutil.copyfile(base / "results" / "screens" / f"{name}.json", screens / f"{name}.json")
    frame = pd.read_csv(base / "results" / "screens" / source.file)
    (mutate(frame) if mutate else frame).to_csv(screens / source.file, index=False, lineterminator="\n")
    return tmp


def _doc(base: Path, name: str) -> dict:
    return json.loads((base / "results" / "screens" / f"{name}.json").read_text(encoding="utf-8"))


def _raw(base: Path, name: str) -> pd.DataFrame:
    return pd.read_csv(base / "results" / "screens" / daily_event.SOURCES[name].file)


def _keep_mask(frame: pd.DataFrame, source) -> pd.Series:
    """The rows `source.keep_where` keeps, worked out here from the file (not through the service)."""
    keep = pd.Series(True, index=frame.index)
    for column, wanted in source.keep_where.items():
        keep &= frame[column].isna() if wanted is None else frame[column] == wanted
    return keep


def _stamp(source, day: str) -> str:
    """A date in the form the source's time column is written in (hvix_nd_v0's exit stamps carry a time)."""
    return f"{day} 19:59:00+00:00" if source.time_column == "exit_ts" else day


def _stamps(hs) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(pd.to_datetime(hs.t, unit="s").normalize())


@functools.lru_cache(maxsize=1)
def _calendar() -> pd.DatetimeIndex:
    return session_index(pd.Timestamp("2010-09-01"), pd.Timestamp("2022-03-01"))


def _next_session(day: pd.Timestamp) -> pd.Timestamp:
    sessions = _calendar()
    return sessions[sessions.searchsorted(day, side="right")]


@functools.lru_cache(maxsize=1)
def _full_days() -> pd.DatetimeIndex:
    """wkndshort_v0's full days: NYSE sessions less those the spec's session table marks an early close, a holiday
    halt or a year-end day. The table is a calendar, not a result, so it is read from the lab tree whenever it is
    there; without it every NYSE session counts as full, which is all the fixture's weeks need."""
    sessions = _calendar()
    if not SESSION_TABLE.is_file():
        return sessions
    days = json.loads(SESSION_TABLE.read_text(encoding="utf-8"))["days"]
    return sessions[[days.get(d.strftime("%Y-%m-%d")) == "full" for d in sessions]]


def _kept(base: Path, name: str) -> pd.DataFrame:
    """The file's rows the source keeps (its rule, a value at 1 tick), worked out here from the file."""
    source, raw = daily_event.SOURCES[name], _raw(base, name)
    return raw[_keep_mask(raw, source)].dropna(subset=[source.values[1]])


def _swap_cost(name: str, cost: int, read: int):
    source = daily_event.SOURCES[name]
    return dataclasses.replace(source, values=MappingProxyType({**source.values, cost: source.values[read]}))


def _use(monkeypatch, name: str, source) -> None:
    merged = MappingProxyType({**research_mod.SERIES_SOURCES, name: source})
    monkeypatch.setattr(research_mod, "SERIES_SOURCES", merged)
    monkeypatch.setattr(series_mod, "SERIES_SOURCES", merged)


# ---------------------------------------------------------------- anchors


def anchor_headline(base: Path, name: str, cost: int = 1) -> None:
    """n, mean and sd of the series at `cost` against the screen JSON (the 1 tick headline, or the ladder)."""
    anchor, doc = ANCHORS[name], _doc(base, name)
    hs = ResearchService(base).series(name, cost)
    r = np.asarray(hs.r)
    if anchor.per_session:
        r = pd.Series(r).groupby(np.asarray(hs.t)).sum().to_numpy()
    if anchor.events_only:
        r = r[r != 0]
    if cost == 1:
        assert len(r) == _pluck(doc, anchor.n)
        assert r.mean() * anchor.scale == pytest.approx(_pluck(doc, anchor.mean), rel=1e-9, abs=1e-12)
        if anchor.sd:
            assert r.std(ddof=1) * anchor.scale == pytest.approx(_pluck(doc, anchor.sd), rel=1e-9, abs=1e-12)
    else:
        assert r.mean() * anchor.scale == pytest.approx(_pluck(doc, anchor.ladder[cost]), rel=1e-9, abs=1e-12)


def _years(stamps: pd.DatetimeIndex) -> dict[str, int]:
    return {str(y): int(c) for y, c in pd.Series(stamps.year).value_counts().sort_index().items()}


def anchor_dates(base: Path, name: str) -> None:
    """The series is dated where a calendar fact the file does not write itself says the return is realised."""
    hs = ResearchService(base).series(name, 1)
    stamps, doc, raw = _stamps(hs), _doc(base, name), _raw(base, name)
    source = daily_event.SOURCES[name]
    kept = raw[_keep_mask(raw, source)].dropna(subset=[source.values[1]])
    assert stamps.isin(session_index(stamps.min(), stamps.max() + pd.Timedelta(days=1))).all()
    if name == "fomcdrift_tsy_v0":
        due = [session_index(pd.Timestamp(e), pd.Timestamp(e) + pd.Timedelta(days=45))[15] for e in kept["date"]]
        assert sorted(due) == sorted(stamps)
    elif name == "fomcfx_v0":
        before = [session_index(pd.Timestamp(d) - pd.Timedelta(days=10), pd.Timestamp(d))[-1] for d in kept["D"]]
        assert before == [pd.Timestamp(p) for p in kept["P"]]
        assert sorted(kept["D"]) == [d.strftime("%Y-%m-%d") for d in stamps]
    elif name == "pretra_tsy_v0":
        friday = pd.DatetimeIndex(pd.to_datetime(kept["P"]))
        before = [session_index(d - pd.Timedelta(days=10), d)[-1] for d in friday]
        assert (friday.weekday == 4).all() and before == [pd.Timestamp(p) for p in kept["Pm1"]]
        assert sorted(friday) == sorted(stamps)
    elif name == "hvix_nd_v0":
        assert sorted(_next_session(pd.Timestamp(d)) for d in kept["date"]) == sorted(stamps)
    elif name == "apieia_ho_v0":
        assert sorted(_next_session(pd.Timestamp(d)) for d in kept["signal_day"]) == sorted(stamps)
    elif name == "lhrev_letf_v0":
        assert (stamps[0].strftime("%Y-%m-%d"), stamps[-1].strftime("%Y-%m-%d")) == (
            _pluck(doc, "sample.first_mark"), _pluck(doc, "sample.last_mark"))
    elif name == "fedflow_tsy_v0":
        assert stamps[0].strftime("%Y-%m-%d") == _pluck(doc, "effective_start.first_valid_event")
    elif name == "cropsmooth_v0":
        per_date = pd.Series([leg["R"] for leg in _pluck(doc, "voids.legs")]).value_counts()
        dropped = {d for d, c in per_date.items() if c == 2}
        kept_voids = {d for d, c in per_date.items() if c == 1}
        seen = {d.strftime("%Y-%m-%d") for d in stamps}
        assert not dropped & seen and kept_voids <= seen
    elif name == "fomcpc_fx_v0":
        assert _years(stamps) == _pluck(doc, "headline.events_per_year")
    elif name == "wkndgap_fx_v0":
        # The trade is Sunday 18:00 CT to Monday 15:59 CT: realised at the Monday session, one row per valid week.
        assert (stamps.weekday == 0).all()
        assert (stamps[0].strftime("%Y-%m-%d"), stamps[-1].strftime("%Y-%m-%d")) == (
            _pluck(doc, "first_valid_week"), _pluck(doc, "last_valid_week"))
        events = pd.Series(np.asarray(hs.r), index=stamps)
        events = events[events != 0]
        for key, block in _pluck(doc, "blocks").items():
            opens = key.split("_")[0]
            opens = pd.Timestamp(_pluck(doc, "first_valid_week") if opens == "first" else f"{opens}-01")
            assert events.index[events.index >= opens][0] == pd.Timestamp(block["first"])
    elif name == "wkndshort_v0":
        # Short from the Friday close F to the close of the first full day after it (spec: X), so realised there,
        # never at F; the legs of a week share that exit, so the book has one session per active week.
        fridays = pd.DatetimeIndex(pd.to_datetime(kept["F"]))
        full = _full_days()
        due = full[full.searchsorted(fridays, side="right")]
        assert (fridays.weekday == 4).all() and sorted(due) == sorted(stamps)
        assert len(set(stamps)) == fridays.nunique() == _pluck(doc, "headline.n")
    else:
        assert sorted(pd.to_datetime(kept[source.time_column])) == sorted(stamps)


INDEPENDENT_DATE_FACTS = ("fomcdrift_tsy_v0", "fomcfx_v0", "pretra_tsy_v0", "lhrev_letf_v0", "fedflow_tsy_v0",
                          "cropsmooth_v0", "hvix_nd_v0", "apieia_ho_v0", "wkndgap_fx_v0", "wkndshort_v0")
REGRESSION_ONLY_DATES = tuple(n for n in LEARNED if n not in INDEPENDENT_DATE_FACTS)


# ---------------------------------------------------------------- the mapping table


def test_the_slice_names_its_fourteen_rows_once_each():
    assert set(daily_event.SOURCES) | set(daily_event.NOT_LEARNABLE) == set(ROWS)
    assert not set(daily_event.SOURCES) & set(daily_event.NOT_LEARNABLE)
    assert len(LEARNED) == 12 and set(daily_event.NOT_LEARNABLE) == {"dburst_rev_v1", "xfut_tcn120_v0"}


def test_each_row_states_the_unit_its_spec_defines():
    """A basis-point column is a fraction of K unless the spec says otherwise: apieia_ho_v0's spec (rule 2) defines
    P&L and cost in basis points of the entry price of one HO contract, so its unit names that, not a capital."""
    units = {n: s.unit for n, s in daily_event.SOURCES.items()}
    assert units["apieia_ho_v0"] == daily_event.BP_PER_HO_CONTRACT
    assert "HO contract" in daily_event.BP_PER_HO_CONTRACT and "capital" not in daily_event.BP_PER_HO_CONTRACT
    assert daily_event.BP_PER_HO_CONTRACT.endswith("per trade")
    bp_of_k = ("fedflow_tsy_v0", "cropsmooth_v0", "hvix_nd_v0", "fomcpc_fx_v0", "wkndgap_fx_v0")
    assert {n: units[n] for n in bp_of_k} == dict.fromkeys(bp_of_k, daily_event.BP_PER_TRADE)


def test_wkndshort_states_usd_of_its_k_book_so_it_is_not_on_capital():
    """wkndshort_v0's legs are net USD (spec rule 2: side x n x M x price change less costs); the book is their sum
    over K = $100M. A USD unit is not a return on capital, so the served series is not on capital (no CAGR)."""
    unit = daily_event.SOURCES["wkndshort_v0"].unit
    assert unit == daily_event.BOOK_USD_PER_TRADE == "USD of the K = $100M book per trade"
    assert not unit.startswith(series_mod.CAPITAL_UNIT) and unit.endswith("per trade")


def test_texts_use_no_em_or_en_dash_and_each_refusal_gives_a_reason():
    texts = [*daily_event.NOT_LEARNABLE.values(), *(s.unit for s in daily_event.SOURCES.values())]
    assert not any(chr(code) in text for code in (0x2013, 0x2014) for text in texts)
    assert all(len(reason) > 80 for reason in daily_event.NOT_LEARNABLE.values())


def test_event_rows_are_summed_per_session_and_the_one_daily_row_is_used_as_recorded():
    assert {n: s.kind for n, s in daily_event.SOURCES.items() if s.kind != "trades"} == {"lhrev_letf_v0": "daily"}
    for name, source in daily_event.SOURCES.items():
        assert sorted(source.values) == ([1] if name in ONE_TICK_ROWS else [0, 1, 2])
        assert not source.void_as_zero and source.void_column is None
        assert source.time_rule == constants.STAMP and source.portfolio is None


def test_no_event_row_maps_a_benchmark_column():
    assert all(not daily_event.SOURCES[n].bench for n in TRADE_ROWS)
    assert daily_event.SOURCES["lhrev_letf_v0"].bench == {1: "lo_net1"}


def test_a_per_event_benchmark_cannot_line_up_with_the_summed_session_series(patched, tmp_path):
    """Why the rule above stands: a trades row with a benchmark column is refused by the series builder."""
    base = _fixture_root(tmp_path)
    source = dataclasses.replace(daily_event.SOURCES["fomcfx_v0"], bench=MappingProxyType({1: "r2"}),
                                 bench_label="made-up benchmark")
    _use(patched, "fomcfx_v0", source)
    with pytest.raises(ValueError):
        hypothesis_series(ResearchService(base), "fomcfx_v0", 1)


@pytest.mark.parametrize("name", LEARNED)
def test_mapped_columns_are_dates_and_returns_never_prices(name):
    source = daily_event.SOURCES[name]
    named = [source.time_column, *source.values.values(), *source.bench.values(), *source.keep_where]
    assert not [c for c in named if constants.PRICE_COLUMN.search(c)]


@pytest.mark.parametrize("name", LEARNED)
def test_the_file_holds_every_mapped_column(root, name):
    source = daily_event.SOURCES[name]
    header = list(pd.read_csv(root / "results" / "screens" / source.file, nrows=0).columns)
    assert {source.time_column, *source.values.values(), *source.bench.values(), *source.keep_where} <= set(header)


@pytest.mark.lab_only
@pytest.mark.parametrize("name", LEARNED)
def test_fixture_layout_is_the_labs_layout(lab, name):
    file = daily_event.SOURCES[name].file
    fixture = list(pd.read_csv(FIXTURE_DIR / file, nrows=0).columns)
    assert fixture == list(pd.read_csv(lab / "results" / "screens" / file, nrows=0).columns)


# ---------------------------------------------------------------- anchors, positive controls


@pytest.mark.parametrize("name", ANCHORS)
def test_the_headline_is_reproduced(root, name):
    anchor_headline(root, name)


@pytest.mark.parametrize("name", ANCHORS)
def test_the_cost_ladder_is_reproduced(root, name):
    for cost in ANCHORS[name].ladder:
        anchor_headline(root, name, cost)


@pytest.mark.parametrize("name", LEARNED)
def test_the_dates_meet_their_anchor(root, name):
    anchor_dates(root, name)


@pytest.mark.parametrize("name", TRADE_ROWS)
def test_events_are_summed_per_session_and_zero_filled_over_the_window(root, name):
    research = ResearchService(root)
    hs, s = research.series(name, 1), hypothesis_series(research, name, 1)
    assert s.kind == "trades" and s.periods == 252 and s.bench is None and not s.dropped
    start = pd.Timestamp(daily_event.SOURCES[name].window_start) if daily_event.SOURCES[name].window_start else None
    assert list(s.r.index) == list(session_index(*screen_window(research.screen(name), start)))
    assert s.r.sum() == pytest.approx(sum(hs.r), rel=1e-9, abs=1e-12)
    assert set(s.r.index[s.r != 0]) <= set(_stamps(hs))
    assert s.on_capital is hs.unit.startswith("return on capital")
    assert "per session" in s.unit and "per trade" not in s.unit


def test_lhrev_is_a_daily_series_with_the_lo_control_as_benchmark(root):
    research = ResearchService(root)
    s = hypothesis_series(research, "lhrev_letf_v0", 1)
    doc = _doc(root, "lhrev_letf_v0")
    assert s.kind == "daily" and s.periods == 252 and s.on_capital and s.n == _pluck(doc, "headline.n")
    control = _pluck(doc, "secondaries.controls_alone.LO_net_1tick")
    assert s.bench is not None and s.bench.notna().sum() == control["n"]
    assert s.bench.mean() * 1e4 == pytest.approx(control["mean_bp"], rel=1e-9, abs=1e-12)
    assert "lo_net1" in s.bench_label


# ---------------------------------------------------------------- born failing


@pytest.mark.parametrize("wrong", [0, 2])
@pytest.mark.parametrize("name", [n for n in ANCHORS if n not in ONE_TICK_ROWS])
def test_a_wrong_tick_column_read_for_one_tick_fails_its_anchor(root, tmp_path, patched, name, wrong):
    anchor_headline(root, name)
    _use(patched, name, _swap_cost(name, 1, wrong))
    with pytest.raises(AssertionError):
        anchor_headline(root, name)


@pytest.mark.parametrize("name", INDEPENDENT_DATE_FACTS)
def test_a_series_dated_one_session_late_fails_its_date_anchor(root, tmp_path, name):
    column = daily_event.SOURCES[name].time_column

    def later(frame: pd.DataFrame) -> pd.DataFrame:
        def moved(d):
            return d if pd.isna(d) else _next_session(pd.Timestamp(str(d)[:10])).strftime("%Y-%m-%d")

        frame[column] = [moved(d) for d in frame[column]]
        return frame

    anchor_dates(_variant(tmp_path / "ok", root, name), name)
    with pytest.raises((AssertionError, ResearchDataError)):
        anchor_dates(_variant(tmp_path / "late", root, name, later), name)


@pytest.mark.parametrize("name", REGRESSION_ONLY_DATES)
def test_regression_guard_the_dates_are_the_files_own_time_column(root, name):
    """No calendar fact outside the file dates these rows (tsyauct: test auction days with no list in the screen JSON;
    fomcpc: only a count of events per year, which one session of shift rarely changes), so the anchor holds the mapping
    to the column named here and is a regression guard."""
    anchor_dates(root, name)
    assert daily_event.SOURCES[name].time_column == {"tsyauct_intra_ml_v0": "date", "fomcpc_fx_v0": "day"}[name]


@pytest.mark.parametrize("name", ["cropsmooth_v0", "fomcfx_v0"])
def test_a_void_event_is_left_out_not_zeroed_or_kept(root, tmp_path, name):
    source = daily_event.SOURCES[name]
    values = list(source.values.values())

    def fill_voids(frame: pd.DataFrame) -> pd.DataFrame:
        empty = frame[source.values[1]].isna()
        frame.loc[empty, values] = 0.001
        return frame

    anchor_headline(root, name)
    with pytest.raises(AssertionError):
        anchor_headline(_variant(tmp_path / "filled", root, name, fill_voids), name)


@pytest.mark.parametrize("name", LEARNED)
def test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_check(root, tmp_path, name):
    """Relies on `ResearchService.series` alone: the mapping has no way to drop a row by date."""
    source = daily_event.SOURCES[name]

    def plant(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame[_keep_mask(frame, source)].iloc[[-1]].copy()
        row[source.time_column] = _stamp(source, "2022-01-04")
        return pd.concat([frame, row], ignore_index=True)

    with pytest.raises(ResearchDataError, match="2022-01-01"):
        ResearchService(_variant(tmp_path, root, name, plant)).series(name, 1)


@pytest.mark.parametrize("name", LEARNED)
def test_with_the_shared_check_stubbed_the_mapping_alone_does_not_drop_a_2022_row(root, tmp_path, patched, name):
    """Records the limit of this slice: the fence for these rows is the shared helper's, not the mapping's."""
    source = daily_event.SOURCES[name]

    def plant(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame[_keep_mask(frame, source)].iloc[[-1]].copy()
        row[source.time_column] = _stamp(source, "2022-01-04")
        return pd.concat([frame, row], ignore_index=True)

    patched.setattr(research_mod, "IS_END", pd.Timestamp("2030-01-01", tz="UTC"))
    planted = ResearchService(_variant(tmp_path, root, name, plant)).series(name, 1)
    assert pd.Timestamp("2022-01-04") in set(_stamps(planted))


@pytest.mark.parametrize("name", TRADE_ROWS)
def test_regression_guard_an_event_on_a_non_session_is_refused_by_the_series_builder(root, tmp_path, name):
    source = daily_event.SOURCES[name]

    def saturday(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame[_keep_mask(frame, source)].iloc[[-1]].copy()
        row[source.time_column] = _stamp(source, "2012-06-02")
        return pd.concat([frame, row], ignore_index=True)

    with pytest.raises(SeriesError, match="not sessions"):
        hypothesis_series(ResearchService(_variant(tmp_path, root, name, saturday)), name, 1)


# ---------------------------------------------------------------- the window start (rows whose sample starts late)

WINDOW_ROWS = ("tsyauct_intra_ml_v0", "fedflow_tsy_v0", "hvix_nd_v0", "apieia_ho_v0", "fomcdrift_tsy_v0", "fomcfx_v0",
               "fomcpc_fx_v0", "pretra_tsy_v0", "wkndgap_fx_v0", "wkndshort_v0")
# The start each row's spec or screen fixes (statistics review of wave w3): a zero fill from the NQ data start would pad
# sessions before the sample and zero-fill statements the screen left out. wkndshort_v0 starts at the exit of the
# spec's first eligible Friday (2011-10-14).
WINDOW_STARTS = {"fomcdrift_tsy_v0": "2011-01-26", "fomcfx_v0": "2010-12-01", "fomcpc_fx_v0": "2011-04-27",
                 "pretra_tsy_v0": "2011-01-03", "apieia_ho_v0": "2010-10-06", "wkndgap_fx_v0": "2011-06-20",
                 "wkndshort_v0": "2011-10-17"}


def test_the_rows_whose_sample_starts_after_the_default_window_name_their_start():
    assert {n for n in LEARNED if daily_event.SOURCES[n].window_start} == set(WINDOW_ROWS)
    assert {n: daily_event.SOURCES[n].window_start for n in WINDOW_STARTS} == WINDOW_STARTS


@pytest.mark.parametrize("name", WINDOW_ROWS)
def test_the_zero_fill_starts_at_the_rows_window_start_not_the_nq_data_start(root, name):
    research = ResearchService(root)
    s = hypothesis_series(research, name, 1)
    start = pd.Timestamp(daily_event.SOURCES[name].window_start)
    assert s.r.index[0] == session_index(start, start + pd.Timedelta(days=10))[0]
    assert s.r.index[0] > screen_window(research.screen(name))[0]


@pytest.mark.parametrize("name", WINDOW_ROWS)
def test_regression_guard_an_event_before_the_window_start_is_refused(root, tmp_path, name):
    source = daily_event.SOURCES[name]

    def early(frame: pd.DataFrame) -> pd.DataFrame:
        row = frame[_keep_mask(frame, source)].iloc[[0]].copy()
        row[source.time_column] = _stamp(source, "2010-10-04")
        return pd.concat([row, frame], ignore_index=True)

    with pytest.raises(SeriesError, match="not sessions"):
        hypothesis_series(ResearchService(_variant(tmp_path, root, name, early)), name, 1)


@pytest.mark.lab_only
def test_tsyauct_served_sharpe_is_the_screens(lab):
    doc = _doc(lab, "tsyauct_intra_ml_v0")
    s = hypothesis_series(ResearchService(lab), "tsyauct_intra_ml_v0", 1)
    assert perf.sharpe(s.r, s.periods) == pytest.approx(doc["headline"]["sharpe"], abs=1e-4)


@pytest.mark.lab_only
def test_regression_guard_the_padded_window_fails_the_sharpe_anchor(lab, patched):
    name = "tsyauct_intra_ml_v0"
    _use(patched, name, dataclasses.replace(daily_event.SOURCES[name], window_start=None))
    s = hypothesis_series(ResearchService(lab), name, 1)
    assert len(s.r) == 2836
    assert perf.sharpe(s.r, s.periods) != pytest.approx(_doc(lab, name)["headline"]["sharpe"], abs=1e-4)


@pytest.mark.lab_only
def test_fedflow_window_starts_at_the_screens_frozen_effective_start(lab):
    doc = _doc(lab, "fedflow_tsy_v0")
    assert daily_event.SOURCES["fedflow_tsy_v0"].window_start == doc["effective_start"]["frozen"]


# ---------------------------------------------------------------- the refusals are true (lab tree)


@pytest.mark.lab_only
def test_every_row_ends_inside_the_fence(lab):
    registry = pd.read_csv(lab / "results" / "registry.csv").set_index("name")
    for name in ROWS:
        assert "in-sample only" in registry.loc[name, "verdict"]
        ends = []

        def walk(node):
            if isinstance(node, dict):
                ends.extend(pd.Timestamp(v) for k, v in node.items() if k == "end" and isinstance(v, str))
                for child in node.values():
                    walk(child)
            elif isinstance(node, list):
                for child in node[:60]:
                    walk(child)

        walk(_doc(lab, name).get("serve", _doc(lab, name).get("serves", {})))
        assert all(end <= FENCE for end in ends), name


@pytest.mark.lab_only
def test_hvix_rule_keeps_the_headline_sessions_and_a_wider_sample_has_another_mean(lab):
    frame, doc = pd.read_csv(lab / "results" / "screens" / "hvix_nd_v0_sessions.csv"), _doc(lab, "hvix_nd_v0")
    kept = frame[_keep_mask(frame, daily_event.SOURCES["hvix_nd_v0"])]
    assert len(kept) == doc["headline"]["n"] < frame["r_net1_bp"].notna().sum()
    assert kept["r_net1_bp"].mean() == pytest.approx(doc["headline"]["mean_bp"], rel=1e-9)
    assert frame["r_net1_bp"].mean() != pytest.approx(doc["headline"]["mean_bp"], rel=1e-3)


@pytest.mark.lab_only
def test_apieia_rule_keeps_the_event_rows_with_an_empty_void_and_the_controls_have_another_mean(lab):
    frame, doc = pd.read_csv(lab / "results" / "screens" / "apieia_ho_v0_events.csv"), _doc(lab, "apieia_ho_v0")
    kept = frame[_keep_mask(frame, daily_event.SOURCES["apieia_ho_v0"])]
    assert len(kept) == doc["headline"]["n"] and kept["n1"].mean() == pytest.approx(doc["headline"]["mean"], rel=1e-9)
    assert frame["n1"].mean() != pytest.approx(doc["headline"]["mean"], rel=1e-3)


@pytest.mark.lab_only
def test_hvix_window_starts_at_the_first_valid_session_of_the_file(lab):
    frame = pd.read_csv(lab / "results" / "screens" / "hvix_nd_v0_sessions.csv")
    assert daily_event.SOURCES["hvix_nd_v0"].window_start == frame.loc[frame["valid"], "date"].iloc[0]


@pytest.mark.lab_only
def test_apieia_window_starts_at_the_first_trade_day_not_the_placebo_row_before_it(lab):
    frame = pd.read_csv(lab / "results" / "screens" / "apieia_ho_v0_events.csv")
    kept = frame[_keep_mask(frame, daily_event.SOURCES["apieia_ho_v0"])]
    assert daily_event.SOURCES["apieia_ho_v0"].window_start == kept["date"].iloc[0] > frame["date"].iloc[0]


def _spec(lab: Path, name: str) -> dict:
    """The frozen spec, read only (`experiments/<name>.json`)."""
    return json.loads((lab / "experiments" / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.lab_only
def test_fomcdrift_window_starts_at_the_specs_first_scheduled_statement(lab):
    spec, frame = _spec(lab, "fomcdrift_tsy_v0"), _raw(lab, "fomcdrift_tsy_v0")
    assert daily_event.SOURCES["fomcdrift_tsy_v0"].window_start == spec["design"]["first_event"] == frame["date"].min()


@pytest.mark.lab_only
def test_fomcfx_window_starts_after_every_statement_the_screen_dropped_unwarmed(lab):
    start = pd.Timestamp(daily_event.SOURCES["fomcfx_v0"].window_start)
    dropped = [pd.Timestamp(d) for d in _doc(lab, "fomcfx_v0")["dropped_unwarmed"]]
    first_p = pd.to_datetime(_raw(lab, "fomcfx_v0")["P"]).min()
    assert dropped and all(d < start for d in dropped) and start <= first_p


@pytest.mark.lab_only
def test_fomcpc_window_starts_at_the_specs_first_event(lab):
    spec, frame = _spec(lab, "fomcpc_fx_v0"), _raw(lab, "fomcpc_fx_v0")
    first = spec["design"]["guards_fomcpc"]["fomcpc_first_event"]
    assert daily_event.SOURCES["fomcpc_fx_v0"].window_start == first == frame["day"].min()


@pytest.mark.lab_only
def test_pretra_window_starts_at_the_specs_panel_start(lab):
    spec, frame = _spec(lab, "pretra_tsy_v0"), _raw(lab, "pretra_tsy_v0")
    assert daily_event.SOURCES["pretra_tsy_v0"].window_start == spec["design"]["panel_start"]
    assert spec["design"]["panel_start"] < frame["Pm1"].min()


@pytest.mark.lab_only
def test_wkndgap_window_starts_at_the_screens_first_valid_week(lab):
    assert daily_event.SOURCES["wkndgap_fx_v0"].window_start == _doc(lab, "wkndgap_fx_v0")["first_valid_week"]


@pytest.mark.lab_only
def test_wkndgap_counts_117_events_among_its_weeks_and_a_week_without_one_is_a_zero_row(lab):
    frame, doc = _raw(lab, "wkndgap_fx_v0"), _doc(lab, "wkndgap_fx_v0")
    active = frame["r1"] != 0
    assert int(active.sum()) == doc["headline"]["n"] == doc["n_active"] == 117
    assert len(frame) == doc["n_valid_weeks"] and (active == (frame["legs"] > 0)).all()
    assert (frame.loc[~active, ["r0", "r1", "r2"]] == 0).all().all()


@pytest.mark.lab_only
def test_dburst_headline_is_the_mean_of_each_episode_not_a_session_sum(lab):
    frame, doc = pd.read_csv(lab / "results" / "screens" / "dburst_rev_v1_legs.csv"), _doc(lab, "dburst_rev_v1")
    by_episode = frame.groupby("episode")["net1"]
    assert by_episode.ngroups == doc["headline"]["n"]
    assert by_episode.mean().mean() == pytest.approx(doc["headline"]["mean"], rel=1e-9)
    assert by_episode.sum().mean() != pytest.approx(doc["headline"]["mean"], rel=1e-3)


@pytest.mark.lab_only
def test_xfut_headline_is_gross_less_cost_over_a_capital_the_file_lacks(lab):
    frame, doc = pd.read_csv(lab / "results" / "screens" / "xfut_tcn120_v0_trades.csv"), _doc(lab, "xfut_tcn120_v0")
    capital = 100_000_000
    net = (frame["gross"] - frame["cost1"]).sum() / capital / doc["headline"]["T"]
    assert net == pytest.approx(doc["headline"]["mean"], rel=1e-9)
    assert "capital" not in " ".join(frame.columns).lower() and "net" not in frame.columns


# ---------------------------------------------------------------- the weekend gap book is dated at its Monday exit


def test_born_failing_wkndgap_dated_at_its_sunday_entry_fails_its_date_anchor(root, tmp_path):
    """The trade opens on Sunday evening and is realised at Monday's close; a file dated at the entry fails."""
    name = "wkndgap_fx_v0"
    column = daily_event.SOURCES[name].time_column

    def sunday(frame: pd.DataFrame) -> pd.DataFrame:
        frame[column] = [(pd.Timestamp(d) - pd.Timedelta(days=1)).strftime("%Y-%m-%d") for d in frame[column]]
        return frame

    anchor_dates(_variant(tmp_path / "ok", root, name), name)
    with pytest.raises((AssertionError, ResearchDataError, SeriesError)):
        anchor_dates(_variant(tmp_path / "sunday", root, name, sunday), name)


def test_born_failing_wkndgap_counting_its_zero_weeks_as_events_fails_the_headline(root, patched):
    name = "wkndgap_fx_v0"
    anchor_headline(root, name)
    patched.setitem(ANCHORS, name, dataclasses.replace(ANCHORS[name], events_only=False))
    with pytest.raises(AssertionError):
        anchor_headline(root, name)


# ---------------------------------------------------------------- the weekend short book: legs summed at their exit


def test_wkndshort_keeps_the_active_legs_and_each_week_has_one_exit(root):
    name = "wkndshort_v0"
    kept, doc = _kept(root, name), _doc(root, name)
    assert len(kept) == _pluck(doc, "precheck.active_market_weeks")
    assert kept["F"].nunique() == _pluck(doc, "precheck.T_active") == _pluck(doc, "headline.n")
    assert kept.groupby("F")["X"].nunique().eq(1).all()


def test_wkndshort_serves_the_headline_book_in_usd_of_k_per_session(root):
    """The session series is the sum of each week's active legs at its exit; over K it is the screen's weekly book."""
    name = "wkndshort_v0"
    s, doc = hypothesis_series(ResearchService(root), name, 1), _doc(root, name)
    events = s.r[s.r != 0] / WKNDSHORT_K
    assert s.kind == "trades" and s.unit == "USD of the K = $100M book per session" and not s.on_capital
    assert len(events) == _pluck(doc, "headline.n")
    assert events.mean() == pytest.approx(_pluck(doc, "headline.mean"), rel=1e-9, abs=0)
    assert events.std(ddof=1) == pytest.approx(_pluck(doc, "headline.sd"), rel=1e-9, abs=0)


def test_born_failing_wkndshort_dated_at_its_friday_entry_fails_its_date_anchor(root, patched):
    """The weekly file's only date is the Friday entry F; a source dated there puts each week's book at least one
    session before the session its return is realised."""
    name = "wkndshort_v0"
    anchor_dates(root, name)
    _use(patched, name, dataclasses.replace(daily_event.SOURCES[name], time_column="F"))
    with pytest.raises((AssertionError, ResearchDataError, SeriesError)):
        anchor_dates(root, name)


def test_born_failing_wkndshort_counted_per_leg_not_per_week_fails_the_headline(root, patched):
    name = "wkndshort_v0"
    anchor_headline(root, name)
    patched.setitem(ANCHORS, name, dataclasses.replace(ANCHORS[name], per_session=False))
    with pytest.raises(AssertionError):
        anchor_headline(root, name)


@pytest.mark.parametrize("column", ["h_gross", "c_net1", "s1_net1"])
def test_born_failing_wkndshort_reading_another_leg_column_fails_the_headline(root, patched, column):
    """Gross, the midweek control leg and the S1 leg sit beside the headline leg `h_net1` in the same file."""
    name = "wkndshort_v0"
    anchor_headline(root, name)
    _use(patched, name, dataclasses.replace(daily_event.SOURCES[name], values=MappingProxyType({1: column})))
    with pytest.raises(AssertionError):
        anchor_headline(root, name)


@pytest.mark.lab_only
def test_wkndshort_active_legs_over_k_are_the_weekly_book_in_every_week(lab):
    """Spec rule 2: r_w = the sum over the active legs / K. The weekly file holds r_w by Friday and no exit date."""
    name = "wkndshort_v0"
    kept = _kept(lab, name)
    weekly = pd.read_csv(lab / "results" / "screens" / "wkndshort_v0_weekly.csv").set_index("F")["r1"].sort_index()
    book = kept.groupby("F")["h_net1"].sum() / WKNDSHORT_K
    assert _spec(lab, name)["design"]["K_usd"] == WKNDSHORT_K
    assert list(book.index) == list(weekly.index) and len(book) == 381
    assert float((book - weekly).abs().max()) < 1e-12


@pytest.mark.lab_only
def test_wkndshort_serves_2570_sessions_381_of_them_events_with_the_headline_sharpe(lab):
    name = "wkndshort_v0"
    s, doc = hypothesis_series(ResearchService(lab), name, 1), _doc(lab, name)
    events = s.r[s.r != 0]
    assert (len(s.r), s.r.index[0], s.r.index[-1]) == (2570, pd.Timestamp("2011-10-17"), pd.Timestamp("2021-12-31"))
    assert len(events) == doc["headline"]["n"] == doc["precheck"]["T_active"] == 381
    assert (events / WKNDSHORT_K).mean() == pytest.approx(doc["headline"]["mean"], rel=1e-9, abs=0)
    assert (events / WKNDSHORT_K).std(ddof=1) == pytest.approx(doc["headline"]["sd"], rel=1e-9, abs=0)
    assert perf.sharpe(s.r, s.periods) == pytest.approx(0.7794, abs=1e-4)


@pytest.mark.lab_only
def test_wkndshort_window_starts_at_the_exit_of_the_specs_first_eligible_friday(lab):
    name = "wkndshort_v0"
    spec, kept = _spec(lab, name), _kept(lab, name)
    first = set(spec["data_facts"]["first_structurally_eligible_friday"].values())
    assert first == {kept["F"].min()} == {"2011-10-14"}
    exit_day = _full_days()[_full_days().searchsorted(pd.Timestamp("2011-10-14"), side="right")]
    assert daily_event.SOURCES[name].window_start == exit_day.strftime("%Y-%m-%d") == kept["X"].min()


@pytest.mark.lab_only
def test_wkndshort_exits_a_session_late_only_where_the_next_session_is_not_a_full_day(lab):
    """A next-session rule would misdate three weeks: the session after the Friday is an early close (2017-07-03,
    2018-12-24) or a year-end day (2018-12-31) in the spec's session table, so the exit is the session after it."""
    kept = _kept(lab, "wkndshort_v0")
    late = sorted({f for f, x in zip(kept["F"], kept["X"]) if pd.Timestamp(x) != _next_session(pd.Timestamp(f))})
    assert late == ["2017-06-30", "2018-12-21", "2018-12-28"]
    days = json.loads(SESSION_TABLE.read_text(encoding="utf-8"))["days"]
    assert [days[_next_session(pd.Timestamp(f)).strftime("%Y-%m-%d")] for f in late] == [
        "early_close", "early_close", "year_end_unverified"]


# ---------------------------------------------------------------- the keep rule is what selects the sample

RULE_ROWS = ("hvix_nd_v0", "apieia_ho_v0", "wkndshort_v0")


def test_the_rule_rows_are_the_three_that_state_a_row_filter():
    assert {n for n in LEARNED if daily_event.SOURCES[n].keep_where} == set(RULE_ROWS)


@pytest.mark.parametrize("name", RULE_ROWS)
def test_the_file_holds_more_filled_rows_than_the_headline_sample(root, name):
    source = daily_event.SOURCES[name]
    frame = _raw(root, name)
    assert 0 < int(_keep_mask(frame, source).sum()) < int(frame[source.values[1]].notna().sum())


@pytest.mark.parametrize("name", RULE_ROWS)
def test_born_failing_a_source_without_its_rule_serves_another_sample_and_fails_the_anchor(root, patched, name):
    anchor_headline(root, name)
    _use(patched, name, dataclasses.replace(daily_event.SOURCES[name], keep_where=MappingProxyType({})))
    with pytest.raises(AssertionError):
        anchor_headline(root, name)


@pytest.mark.parametrize("name", RULE_ROWS)
def test_born_failing_a_rule_on_the_wrong_value_keeps_the_wrong_rows(root, patched, name):
    wrong = {"hvix_nd_v0": {"headline": False}, "apieia_ho_v0": {"kind": "thu_fri", "void": None},
             "wkndshort_v0": {"active": False}}[name]
    _use(patched, name, dataclasses.replace(daily_event.SOURCES[name], keep_where=MappingProxyType(wrong)))
    with pytest.raises((AssertionError, ResearchDataError)):
        anchor_headline(root, name)
