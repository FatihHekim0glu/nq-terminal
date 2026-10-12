"""The series sources of ten monthly screens (`nq_terminal.series_sources.monthly_b`), anchored at 1e-9.

Rows: oigrowth_v0, rateamp_tsy_v0, stmomturn_v0, termprem_cmdty_v0, tsyauction_mid_v0, tsydemfx_v0, xsbreadth_q_v0,
xsintra_w_v0, xsml_m_v0, zqcut_v0. Every test runs in two worlds:

- "fixture": the synthetic files under `fixtures/results/screens/monthly_b` (the layout of each lab file, made-up
  values; `make_fixtures.py` writes them, computing the screen JSON's numbers from the synthetic CSV). The repository
  is public, so this world carries no lab number.
- "lab" (marker `lab_only`): the lab's own `results/screens`, where the anchors are the screen JSON's recorded numbers.
  It is skipped where the lab tree is absent.

What an anchor is: the series the service builds from a mapping must reproduce what the screen JSON records at 1e-9
(relative): n, mean, sd and Sharpe at 1 tick; the mean at 0 and 2 ticks; the benchmark (its recorded mean, or the
coefficient of the screen's own control regression, which pins the column and its position); and every row's date is
the last NYSE session of its holding month, computed here from the session calendar and not from the service.

Born failing (each feeds a guard the broken state and expects it to see it): a month label shifted by one session or
one month; the 2-tick column read for 1 tick; another column read as the benchmark; a void month kept or zeroed. The
fence tests are regression guards: the shared check in `ResearchService.series` refuses a planted 2022 row, and no
mapping can drop one by itself (`SeriesSource` has no field for it); the one test that would need that is an expected
failure, strict, so it turns red the day the type grows one.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import shutil
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, NamedTuple

import numpy as np
import pandas as pd
import pytest
from nq_lab.config import IS_END, ROOT
from nq_lab.sessions import nyse_sessions

from nq_terminal.analytics import perf
from nq_terminal.analytics import series as analytics_series
from nq_terminal.analytics.series import hypothesis_series
from nq_terminal.constants import MONTH_END_SESSION, STAMP, SeriesSource
from nq_terminal.series_sources import monthly_b
from nq_terminal.services import research as research_module
from nq_terminal.services.research import ResearchDataError, ResearchService

from fakes import FIXTURES
from test_research_support import write_registry

Path_ = tuple[str, ...]
TOL = 1e-9
FENCE_DAY = dt.date(2021, 12, 31)
FIXTURE_DIR = FIXTURES / "results" / "screens" / "monthly_b"
LAB_SCREENS = ROOT / "results" / "screens"
LAB_PRESENT = (LAB_SCREENS / "oigrowth_v0.json").is_file()
CAPITAL_MONTH = "return on capital per month"


@dataclass(frozen=True)
class Ols:
    """The screen's own control regression: `y` on `xs` (a constant first); `at` is the benchmark's position in xs."""

    control: Path_
    y: str
    xs: tuple[str, ...]
    at: int


@dataclass(frozen=True)
class Anchor:
    """The truth for one row: its columns and where the screen JSON records each number the series must reproduce."""

    label: str
    values: Mapping[int, str]
    bench: Mapping[int, str]
    head: Mapping[str, Path_]
    scale: float
    ladder: Mapping[int, Path_] = field(default_factory=dict)
    bench_mean: Mapping[int, Path_] = field(default_factory=dict)
    ols: Ols | None = None
    void: str | None = None
    late: str | None = None  # a date column one session after the month end, for the born-failing shift


def _ticks(template: str, costs=(0, 1, 2)) -> Mapping[int, str]:
    return {cost: template.format(k=cost) for cost in costs}


def _head(*prefix: str, mean="mean_pct", sd="sd_pct", sharpe="sharpe", n="n") -> Mapping[str, Path_]:
    return {"n": (*prefix, n), "mean": (*prefix, mean), "sd": (*prefix, sd), "sharpe": (*prefix, sharpe)}


def _ladder(*prefix: str, tail: tuple[str, ...] = (), fmt="{k}_tick") -> Mapping[int, Path_]:
    return {k: (*prefix, fmt.format(k=k), *tail) for k in (0, 2)}


ANCHORS: Mapping[str, Anchor] = MappingProxyType({
    "oigrowth_v0": Anchor(
        "label", _ticks("r_timed_{k}"), _ticks("r_lo_{k}"), _head("headline", "timed"), 100.0,
        {k: ("mean_pct_by_ticks", "timed", str(k)) for k in (0, 2)},
        {k: ("mean_pct_by_ticks", "lo", str(k)) for k in (0, 1, 2)}, late="end"),
    "rateamp_tsy_v0": Anchor(
        "month", _ticks("r{k}"), {1: "lo1"}, _head("headline", sharpe="sharpe_ann"), 100.0,
        _ladder("cost_ladder_mean_pct"), {1: ("controls", "LO", "mean_pct")}, void="void"),
    "stmomturn_v0": Anchor(
        "label", _ticks("r_{k}"), {1: "lo20_1"}, _head("headline_by_ticks", "1"), 100.0,
        {k: ("headline_by_ticks", str(k), "mean_pct") for k in (0, 2)}, {1: ("controls", "LO20", "mean_pct")},
        Ols(("control_C1",), "r_1", ("unc_1", "lo20_1", "carry_comm_fx_1", "tsmom_1"), 1), late="end"),
    "termprem_cmdty_v0": Anchor(
        "label", _ticks("r_{k}"), {1: "r_lo_1"}, _head("cost_ladder", "1_tick"), 100.0,
        _ladder("cost_ladder", tail=("mean_pct",)), {},
        Ols(("control_C1",), "r_1", ("r_lo_1", "carry_comm_1", "tsmom_comm_1"), 0), late="end"),
    "tsyauction_mid_v0": Anchor(
        "month", _ticks("r{k}"), _ticks("lo{k}"), _head("headline"), 100.0, _ladder("cost_ladder_mean_pct"), {},
        Ols(("control",), "r1", ("lo1",), 0)),
    "tsydemfx_v0": Anchor(
        "month", {0: "r_fee_only", 1: "r_1tick", 2: "r_2tick"}, _ticks("ctl_LO"),
        _head("headline", mean="mean", sd="sd", sharpe="sharpe_ann"), 1.0,
        {0: ("headline", "fee_only_mean"), 2: ("P3", "mean")}, {k: ("controls_mean", "LO") for k in (0, 1, 2)}),
    "xsbreadth_q_v0": Anchor(
        "label", _ticks("r_ml_{k}"), {1: "lo_1"}, _head("headline"), 100.0, _ladder("cost_ladder_mean_pct"), {},
        Ols(("control",), "r_ml_1", ("lo_1", "tsmom_1", "carry_1", "lin_1"), 0), late="end"),
    "xsintra_w_v0": Anchor(
        "label", _ticks("r_ml_{k}"), {1: "lo15_1"}, _head("headline"), 100.0, _ladder("cost_ladder_mean_pct"), {},
        Ols(("control",), "r_ml_1", ("lo15_1", "tsmom_1", "carry_1", "cskew_1", "rev1w_1", "rev1m_1"), 0)),
    "xsml_m_v0": Anchor(
        "label", _ticks("r_ml_{k}"), {1: "lo21_1"}, _head("headline"), 100.0, _ladder("cost_ladder_mean_pct"), {},
        Ols(("control",), "r_ml_1", ("tsmom_1", "lo21_1", "carry_1", "lin_1"), 1), late="end"),
    "zqcut_v0": Anchor(
        "e", _ticks("r{k}"), {1: "cl"}, _head("headline", mean="mean", sd="sd", sharpe="sharpe_ann"), 1.0,
        _ladder("cost_stress", fmt="{k}_ticks"),
        {1: ("controls", "CL", "mean")}, late="x"),
})
NAMES = tuple(ANCHORS)
# the screens' own handling of a void month: left out (NaN or flagged), except zqcut_v0, where it enters as 0
VOID_FLAGGED = ("rateamp_tsy_v0",)


# ---------------------------------------------------------------- the worlds


class World(NamedTuple):
    service: ResearchService
    screens: Path
    root: Path
    lab: bool


def _registry_rows() -> list[dict[str, str]]:
    return [{"name": name, "registered": "True", "n": "14", "p": "0.5", "control_p": "", "verdict": "FAIL",
             "family_k": "10", "bonferroni_p": "1.0", "holm_p": "1.0", "bh_q": "0.5", "spec": name,
             "spec_sha256": "0" * 64, "spec_sha_ok": "True"} for name in NAMES]


def copy_world(source: World, tmp: Path, name: str | None = None) -> World:
    """A fresh synthetic root holding the screens (and series files) of `name`, or of every row, from `source`."""
    root = tmp / "copy"
    screens = root / "results" / "screens"
    screens.mkdir(parents=True)
    write_registry(root, _registry_rows())
    for row in ([name] if name else NAMES):
        for file in (f"{row}.json", f"{row}_monthly.csv"):
            shutil.copyfile(source.screens / file, screens / file)
    return World(ResearchService(root), screens, root, source.lab)


@pytest.fixture(params=["fixture", pytest.param("lab", marks=pytest.mark.lab_only)])
def world(request, tmp_path) -> World:
    if request.param == "lab":
        if not LAB_PRESENT:
            pytest.skip("the lab tree is not on this machine")
        return World(ResearchService(ROOT), LAB_SCREENS, ROOT, True)
    root = tmp_path / "fixture"
    (root / "results" / "screens").mkdir(parents=True)
    write_registry(root, _registry_rows())
    for path in FIXTURE_DIR.glob("*"):
        if path.suffix in (".json", ".csv"):
            shutil.copyfile(path, root / "results" / "screens" / path.name)
    return World(ResearchService(root), root / "results" / "screens", root, False)


def use_sources(monkeypatch, **changes: SeriesSource) -> None:
    """Make the service and the analytics builder read `changes` in place of the registered mapping."""
    merged = dict(research_module.SERIES_SOURCES) | changes
    monkeypatch.setattr(research_module, "SERIES_SOURCES", merged)
    monkeypatch.setattr(analytics_series, "SERIES_SOURCES", merged)


# ---------------------------------------------------------------- the anchors


def dig(document, path: Path_):
    for key in path:
        document = document[key]
    return document


def screen_of(world: World, name: str) -> dict:
    return json.loads((world.screens / f"{name}.json").read_text(encoding="utf-8"))


def close(got: float, want: float) -> bool:
    return bool(np.isfinite(got)) and abs(got - want) <= TOL * abs(want) + 1e-15


def month_end_sessions(months: list[pd.Period]) -> list[int]:
    """Epoch seconds of the last NYSE session of each month, from the calendar alone."""
    table = nyse_sessions(min(months).start_time.date(), max(months).end_time.date())
    latest: dict[pd.Period, dt.date] = {}
    for day in table.index:  # ascending, so the last write per month is its last session
        latest[pd.Period(day, freq="M")] = day
    return [int(pd.Timestamp(latest[m], tz="UTC").timestamp()) for m in months]


def kept_rows(frame: pd.DataFrame, anchor: Anchor) -> pd.Series:
    mask = np.isfinite(frame[anchor.values[1]].to_numpy(dtype=float))
    if anchor.void in frame.columns:
        mask &= ~frame[anchor.void].astype(bool).to_numpy()
    return pd.Series(mask, index=frame.index)


def time_errors(world: World, name: str, frame: pd.DataFrame, anchor: Anchor) -> list[str]:
    labels = [pd.Period(str(v)[:7], freq="M") for v in frame.loc[kept_rows(frame, anchor), anchor.label]]
    want = month_end_sessions(labels)
    got = world.service.series(name, 1).t
    return [] if got == want else [f"dates differ from the month-end sessions (first {got[:1]} against {want[:1]})"]


def stat_errors(world: World, name: str, anchor: Anchor, screen: dict) -> list[str]:
    r = np.asarray(world.service.series(name, 1).r)
    got = {"n": float(len(r)), "mean": r.mean() * anchor.scale, "sd": r.std(ddof=1) * anchor.scale,
           "sharpe": perf.sharpe(pd.Series(r), 12)}
    errors = [f"{key}: {got[key]} against {dig(screen, path)}" for key, path in anchor.head.items()
              if not close(got[key], float(dig(screen, path)))]
    for cost, path in anchor.ladder.items():
        mean = np.mean(world.service.series(name, cost).r) * anchor.scale
        errors += [f"mean at {cost} ticks: {mean} against {dig(screen, path)}"] * (not close(mean, dig(screen, path)))
    return errors


def bench_errors(world: World, name: str, anchor: Anchor, screen: dict, frame: pd.DataFrame) -> list[str]:
    errors = []
    for cost, path in anchor.bench_mean.items():
        bench = world.service.series(name, cost).r_bench
        mean = np.mean(bench) * anchor.scale if bench else float("nan")
        errors += [f"benchmark mean at {cost} ticks: {mean} against {dig(screen, path)}"] * (
            not close(mean, dig(screen, path)))
    if anchor.ols is not None:
        errors += ols_errors(world, name, anchor, screen, frame)
    return errors


def ols_errors(world: World, name: str, anchor: Anchor, screen: dict, frame: pd.DataFrame) -> list[str]:
    ols, served = anchor.ols, world.service.series(name, 1)
    kept = frame.loc[kept_rows(frame, anchor)]
    columns = [kept[c].to_numpy(dtype=float) for c in ols.xs]
    if not served.r_bench:
        return ["no benchmark is served for the control regression"]
    columns[ols.at] = np.asarray(served.r_bench)
    design = np.column_stack([np.ones(len(served.r)), *columns])
    beta = np.linalg.lstsq(design, np.asarray(served.r), rcond=None)[0]
    control = dig(screen, ols.control)
    b = control["b"] if isinstance(control["b"], list) else [control["b"]]
    pairs = [("a", beta[0], control["a"])] + [(f"b[{i}]", g, w) for i, (g, w) in enumerate(zip(beta[1:], b))]
    return [f"{label}: {g} against {w}" for label, g, w in pairs if not close(g, w)]


def anchor_errors(world: World, name: str) -> list[str]:
    """Everything the series must reproduce; an empty list is a match. A refusal by the service is an error too."""
    anchor, screen = ANCHORS[name], screen_of(world, name)
    frame = pd.read_csv(world.screens / f"{name}_monthly.csv")
    try:
        return (time_errors(world, name, frame, anchor) + stat_errors(world, name, anchor, screen)
                + bench_errors(world, name, anchor, screen, frame))
    except ResearchDataError as exc:
        return [f"refused: {exc}"]


def recorded_sample_end(screen: dict, spec_text: str = "") -> dt.date | None:
    """The last day of the sample the screen JSON records (a last month, else the exclusive end of its serves); a row
    whose screen records neither falls back to the frozen window in its spec text."""
    for path in (("facts", "last_label"), ("counts", "last_label"), ("counts", "last_holding")):
        try:
            return pd.Period(str(dig(screen, path)), freq="M").end_time.date()
        except (KeyError, TypeError):
            continue
    serves = screen.get("serve", {}).get("serves", [])
    ends = [pd.Timestamp(s["end"]) for s in serves if isinstance(s, dict) and "end" in s]
    if ends:
        return (max(ends) - pd.Timedelta(days=1)).date()
    months = re.findall(r"to (20\d\d-\d\d)", spec_text) + [f"{y}-12" for y in re.findall(r"to Dec (20\d\d)", spec_text)]
    return max(pd.Period(m, freq="M") for m in months).end_time.date() if months else None


# ---------------------------------------------------------------- the mapping, as reviewed


def test_the_module_maps_exactly_these_ten_rows_and_learns_all_of_them():
    assert set(monthly_b.SOURCES) == set(NAMES)
    assert dict(monthly_b.NOT_LEARNABLE) == {}


@pytest.mark.parametrize("name", NAMES)
def test_each_row_reads_the_columns_of_its_truth_table(name):
    source, anchor = monthly_b.SOURCES[name], ANCHORS[name]
    assert source.file == f"{name}_monthly.csv" and source.kind == "monthly" and source.unit == CAPITAL_MONTH
    assert dict(source.values) == dict(anchor.values) and dict(source.bench) == dict(anchor.bench)
    assert source.bench_label
    assert source.time_rule == MONTH_END_SESSION and source.void_as_zero is False and source.portfolio is None
    assert source.time_column == anchor.label
    assert source.void_column == (anchor.void if name in VOID_FLAGGED else None)


@pytest.mark.parametrize("name", NAMES)
def test_a_guard_column_is_declared_where_the_file_has_a_session_it_must_not_pass(name):
    guards = {"oigrowth_v0": "end", "stmomturn_v0": "end", "termprem_cmdty_v0": "end", "xsbreadth_q_v0": "end",
              "xsml_m_v0": "end", "zqcut_v0": "x"}
    assert monthly_b.SOURCES[name].guard_column == guards.get(name)


@pytest.mark.parametrize("name", NAMES)
def test_the_fixture_has_the_layout_of_the_lab_file(name):
    fixture = (FIXTURE_DIR / f"{name}_monthly.csv").read_text(encoding="utf-8").splitlines()[0]
    if LAB_PRESENT:
        assert fixture == (LAB_SCREENS / f"{name}_monthly.csv").read_text(encoding="utf-8").splitlines()[0]
    source = monthly_b.SOURCES[name]
    assert {source.time_column, *source.values.values(), *source.bench.values()} <= set(fixture.split(","))


# ---------------------------------------------------------------- the fence, read before any series file is used


@pytest.mark.parametrize("name", NAMES)
def test_the_recorded_sample_ends_on_or_before_the_fence(world, name):
    spec = ROOT / "experiments" / f"{name}.json"
    text = spec.read_text(encoding="utf-8") if world.lab and spec.is_file() else ""
    end = recorded_sample_end(screen_of(world, name), text)
    assert end is not None and end <= FENCE_DAY or name in monthly_b.NOT_LEARNABLE


def test_born_failing_a_screen_that_records_a_sample_past_the_fence_is_seen():
    assert recorded_sample_end({"facts": {"last_label": "2022-03"}}) == dt.date(2022, 3, 31) > FENCE_DAY
    serves = {"serve": {"serves": [{"end": "2022-04-01 00:00:00+00:00"}, {"end": "2022-01-01 00:00:00+00:00"}]}}
    assert recorded_sample_end(serves) == dt.date(2022, 3, 31)
    assert recorded_sample_end({"serve": {"serves": [{"end": "2022-01-01 00:00:00+00:00"}]}}) == FENCE_DAY
    assert recorded_sample_end({}, "n = 108 (2013-01 to 2021-12)") == FENCE_DAY
    assert recorded_sample_end({}, "T = 120 (Jan 2012 to Dec 2021)") == FENCE_DAY
    assert recorded_sample_end({}) is None


# ---------------------------------------------------------------- the anchors


@pytest.fixture
def registered(monkeypatch):
    """The module's own mapping, read by the service and the analytics builder whatever else is merged."""
    use_sources(monkeypatch, **monthly_b.SOURCES)


@pytest.mark.parametrize("name", NAMES)
def test_the_series_reproduces_the_screen(world, registered, name):
    assert anchor_errors(world, name) == []


@pytest.mark.parametrize("name", NAMES)
def test_the_analytics_series_is_a_monthly_return_on_capital_with_its_benchmark(world, registered, name):
    built = hypothesis_series(world.service, name, 1)
    served = world.service.series(name, 1)
    assert built.periods == 12 and built.on_capital and built.kind == "monthly" and built.basis == "A"
    assert built.n == len(served.r) and built.r.index.is_monotonic_increasing and built.r.index.is_unique
    assert built.bench is not None and not built.bench.isna().any() and built.bench_label
    assert set(monthly_b.SOURCES[name].values) == {0, 1, 2}


@pytest.mark.parametrize("name", NAMES)
def test_a_cost_the_file_does_not_hold_is_refused(world, registered, name):
    from nq_terminal.services.research import UnknownNameError
    with pytest.raises(UnknownNameError, match="cost"):
        world.service.series(name, 3)


# ---------------------------------------------------------------- born failing: the broken state is seen


@pytest.mark.parametrize("name", NAMES)
def test_born_failing_the_2_tick_column_read_for_1_tick_fails_its_anchor(world, monkeypatch, name):
    source = monthly_b.SOURCES[name]
    use_sources(monkeypatch, **{name: replace(source, values={**source.values, 1: source.values[2]})})
    assert any(e.startswith(("mean", "sd", "sharpe")) for e in anchor_errors(world, name))


@pytest.mark.parametrize("name", NAMES)
def test_born_failing_another_column_read_as_the_benchmark_fails_its_anchor(world, monkeypatch, name):
    source = monthly_b.SOURCES[name]
    # another return column, never the one the series itself reads at that cost
    wrong = {cost: source.values[2] if cost == 0 else source.values[0] for cost in source.bench}
    use_sources(monkeypatch, **{name: replace(source, bench=wrong)})
    assert any("benchmark" in e or e.startswith(("a:", "b[")) for e in anchor_errors(world, name))


@pytest.mark.parametrize("name", [n for n in NAMES if ANCHORS[n].late])
def test_born_failing_a_month_dated_one_session_late_fails_its_anchor(world, monkeypatch, name):
    source = monthly_b.SOURCES[name]
    late = replace(source, time_column=ANCHORS[name].late, time_rule=STAMP, guard_column=None)
    use_sources(monkeypatch, **{name: late})
    assert any(e.startswith("dates differ") for e in anchor_errors(world, name))


def shift_label(path: Path, column: str, months: int) -> None:
    frame = pd.read_csv(path, dtype={column: str})
    frame[column] = [str(pd.Period(v[:7], freq="M") + months) + v[7:] for v in frame[column]]
    frame.to_csv(path, index=False, lineterminator="\n")


@pytest.mark.parametrize("name", NAMES)
def test_born_failing_a_month_label_shifted_by_one_month_is_seen(world, registered, tmp_path, name):
    copy = copy_world(world, tmp_path, name)
    shift_label(copy.screens / f"{name}_monthly.csv", ANCHORS[name].label, 1)
    # the anchor reads the true months from the unshifted file: dates move, or the guard column refuses them
    truth, anchor = pd.read_csv(world.screens / f"{name}_monthly.csv"), ANCHORS[name]
    months = [pd.Period(str(v)[:7], freq="M") for v in truth.loc[kept_rows(truth, anchor), anchor.label]]
    want = month_end_sessions(months)
    try:
        got = copy.service.series(name, 1).t
    except ResearchDataError:
        return
    assert got != want


# ---------------------------------------------------------------- void months


def edit_csv(path: Path, row: int, **cells) -> None:
    """Set cells of one row of a series file in a copy (every edited column becomes an object column)."""
    frame = pd.read_csv(path)
    for column, value in cells.items():
        frame[column] = frame[column].astype(object)
        frame.loc[row, column] = value
    frame.to_csv(path, index=False, lineterminator="\n")


def fixture_copy(tmp_path, name: str) -> World:
    base = World(ResearchService(FIXTURE_DIR), FIXTURE_DIR, FIXTURE_DIR, False)
    return copy_world(base, tmp_path, name)


def test_a_flagged_void_month_is_left_out_of_rateamp_tsy(registered, tmp_path):
    copy = fixture_copy(tmp_path, "rateamp_tsy_v0")
    n = len(copy.service.series("rateamp_tsy_v0", 1).r)
    edit_csv(copy.screens / "rateamp_tsy_v0_monthly.csv", 3, void=True)
    assert len(copy.service.series("rateamp_tsy_v0", 1).r) == n - 1


def test_born_failing_rateamp_tsy_without_its_void_column_keeps_a_flagged_month(monkeypatch, tmp_path):
    copy = fixture_copy(tmp_path, "rateamp_tsy_v0")
    source = monthly_b.SOURCES["rateamp_tsy_v0"]
    use_sources(monkeypatch, rateamp_tsy_v0=replace(source, void_column=None))
    n = len(copy.service.series("rateamp_tsy_v0", 1).r)
    edit_csv(copy.screens / "rateamp_tsy_v0_monthly.csv", 3, void=True)
    assert len(copy.service.series("rateamp_tsy_v0", 1).r) == n  # the broken mapping does not see it


def test_a_void_month_with_empty_returns_is_left_out_of_tsyauction_mid_not_zeroed(registered, monkeypatch, tmp_path):
    copy = fixture_copy(tmp_path, "tsyauction_mid_v0")
    n = len(copy.service.series("tsyauction_mid_v0", 1).r)
    edit_csv(copy.screens / "tsyauction_mid_v0_monthly.csv", 3, void="no auction in the window", r0=np.nan,
             r1=np.nan, r2=np.nan, lo0=np.nan, lo1=np.nan, lo2=np.nan)
    assert len(copy.service.series("tsyauction_mid_v0", 1).r) == n - 1
    source = monthly_b.SOURCES["tsyauction_mid_v0"]
    use_sources(monkeypatch, tsyauction_mid_v0=replace(source, void_as_zero=True))
    assert len(copy.service.series("tsyauction_mid_v0", 1).r) == n  # born failing: a zeroed void is a different series


def test_a_void_month_of_zqcut_enters_as_zero_as_the_screen_counts_it(registered, monkeypatch, tmp_path):
    copy = fixture_copy(tmp_path, "zqcut_v0")
    served = copy.service.series("zqcut_v0", 1)
    path = copy.screens / "zqcut_v0_monthly.csv"
    edit_csv(path, 3, void=True, r0=0.0, r1=0.0, r2=0.0)
    after = copy.service.series("zqcut_v0", 1)
    assert len(after.r) == len(served.r) and after.r[3] == 0.0
    source = monthly_b.SOURCES["zqcut_v0"]
    use_sources(monkeypatch, zqcut_v0=replace(source, void_column="void"))
    assert len(copy.service.series("zqcut_v0", 1).r) == len(served.r) - 1  # born failing: dropping it changes T


# ---------------------------------------------------------------- the fence


def plant_2022(world: World, name: str) -> None:
    """Append a row dated in 2022 to the series file of `name` in the copy `world`."""
    anchor, source = ANCHORS[name], monthly_b.SOURCES[name]
    path = world.screens / f"{name}_monthly.csv"
    frame = pd.read_csv(path)
    row = frame.iloc[-1].copy()
    row[anchor.label] = "2022-01-03" if anchor.label == "e" else "2022-01"
    if source.guard_column:
        row[source.guard_column] = "2022-02-01"
    frame.loc[len(frame)] = row
    frame.to_csv(path, index=False, lineterminator="\n")


@pytest.mark.parametrize("name", NAMES)
def test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_check(world, registered, tmp_path, name):
    """Not born failing: the shared check at `ResearchService.series` does the refusing; no mapping can."""
    copy = copy_world(world, tmp_path, name)
    plant_2022(copy, name)
    with pytest.raises(ResearchDataError, match="2022-01-01"):
        copy.service.series(name, 1)


@pytest.mark.xfail(strict=True, reason="SeriesSource has no field that drops a row by date: a mapping cannot fence "
                                       "a 2022 row without the shared check in ResearchService.series")
@pytest.mark.parametrize("name", NAMES)
def test_with_the_shared_check_stubbed_a_planted_2022_row_is_still_dropped_by_the_mapping(
        registered, monkeypatch, tmp_path, name):
    copy = fixture_copy(tmp_path, name)
    plant_2022(copy, name)
    monkeypatch.setattr(research_module, "IS_END", pd.Timestamp("2100-01-01", tz="UTC"))
    stamps = pd.to_datetime(copy.service.series(name, 1).t, unit="s")
    assert (stamps < pd.Timestamp(IS_END).tz_localize(None)).all()
