"""Monthly series sources, part A (wave research integrity, slice series-monthly-a).

Ten monthly screens: airfx_v0 (its flat month left out by `keep_where`), cmax_v0, crushdev_v0, eqvrp_xasset_v0, fxval_ppp_v0,
gotobi6j_v0, gvzvrp_pm_v0, hi52_v0, liqbias_v0 and metals_eq_ym_v1. Two trees run the same anchors:

- the fixture copy (always): `fixtures/results/screens/monthly_a`, synthetic files with the lab's column layout and
  made-up values (the repository is public), plus a made-up screen JSON per row holding the recorded numbers the anchor
  reads, computed from the synthetic CSV by `make_fixtures.py`;
- the lab tree (`-m lab_only`): the real screens, where the served series reproduces the numbers the screen JSON
  records (n, means per cost, Sharpe, block means, regression intercepts) to 1e-9. Skipped unless selected.

An anchor that ignores dates would pass a shifted calendar, so every row anchors a block (a date range) or a
regression over the dated rows; the born-failing tests feed the shifted calendar, the wrong cost column and a planted
2022 row to the same checks.
"""
from __future__ import annotations

import dataclasses
import json
import math
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

import numpy as np
import pandas as pd
import pytest

from nq_lab.config import IS_END, ROOT
from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics import series as series_mod
from nq_terminal.analytics.series import hypothesis_series
from nq_terminal.constants import MONTH_END_SESSION, SeriesSource
from nq_terminal.series_sources.monthly_a import NOT_LEARNABLE, SOURCES
from nq_terminal.services import research as research_mod
from nq_terminal.services.research import ResearchDataError, ResearchService, is_price_column

from test_research_support import write_registry

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "results" / "screens" / "monthly_a"
LAB_SCREENS = ROOT / "results" / "screens"
TOL = 1e-9
FENCE_DAY = "2022-01-01"
TEN = ("airfx_v0", "cmax_v0", "crushdev_v0", "eqvrp_xasset_v0", "fxval_ppp_v0", "gotobi6j_v0", "gvzvrp_pm_v0",
       "hi52_v0", "liqbias_v0", "metals_eq_ym_v1")
LEARNED = tuple(n for n in TEN if n in SOURCES)
# Rows served without a benchmark: airfx_v0's controls are factor sleeves, and liqbias_v0's `D` is the strategy's own
# gross event return less its pre-window drift, a transformation of the strategy rather than a book.
NO_BENCHMARK = ("airfx_v0", "liqbias_v0")
lab_only = pytest.mark.lab_only

CAL = {"2012-13": ("2012-01", "2013-12"), "2014-17": ("2014-01", "2017-12"), "2018-21": ("2018-01", "2021-12")}
EARLY = {"2011-13": ("2011-01", "2013-12"), "2014-17": ("2014-01", "2017-12"), "2018-21": ("2018-01", "2021-12")}
CRUSH = {"2011-13": ("2011-10", "2013-12"), "2014-17": ("2014-01", "2017-12"), "2018-21": ("2018-01", "2021-12")}
METALS = {"2012-10..2014-12": ("2012-10", "2014-12"), "2015-01..2018-12": ("2015-01", "2018-12"),
          "2019-01..2021-12": ("2019-01", "2021-12")}
AIRFX = {"2012-01_2013-12": ("2012-01", "2013-12"), "2014-01_2017-12": ("2014-01", "2017-12"),
         "2018-01_2021-11": ("2018-01", "2021-11")}
PCT, FRAC = 0.01, 1.0


@dataclass(frozen=True)
class Spec:
    """Where a screen JSON records what the served series must reproduce.

    `mean`: cost -> (json path, factor to a fraction); `blocks`: (container path, {key: (first, last)}, mean field,
    factor, count field); `bench`: cost -> (mean path, factor, Sharpe path or None); `ols`: (cost, intercept path, slope
    path or None, count path or None) over the rows where the benchmark exists; `events`: a CSV column of event counts
    that turns the means into per-event means (gotobi6j_v0)."""

    n: str
    mean: Mapping[int, tuple[str, float]]
    sharpe: Mapping[int, str] = field(default_factory=dict)
    blocks: tuple[str, Mapping[str, tuple[str, str]], str, float, str | None] | None = None
    bench: Mapping[int, tuple[str, float, str | None]] = field(default_factory=dict)
    ols: tuple[tuple[int, str, str | None, str | None], ...] = ()
    ols_blocks: tuple[str, Mapping[str, tuple[str, str]], str] | None = None
    events: str | None = None
    sharpe_on_bench_rows: bool = False


def _ticks(template: str, factor: float) -> dict[int, tuple[str, float]]:
    return {k: (template.format(k=k), factor) for k in (0, 1, 2)}


_COSTS_FX = {"n": "headline.n", "mean": _ticks("costs.mean_pct.{k}", PCT),
             "sharpe": {k: f"costs.sharpe.{k}" for k in (0, 1, 2)}, "blocks": ("blocks", CAL, "mean_pct", PCT, "n")}
_COMMODITY = {"n": "headline.n", "mean": _ticks("cost_stress.mean_pct_by_ticks.{k}", PCT),
              "sharpe": {1: "headline.sharpe"}, "blocks": ("blocks", CAL, "mean_pct", PCT, "n")}

SPECS: dict[str, Spec] = {
    "airfx_v0": Spec(n="headline.n", mean={1: ("headline.mean", FRAC), 2: ("checks.mean_2tick", FRAC)},
                     sharpe={1: "headline.sharpe_ann"}, blocks=("blocks", AIRFX, "mean", FRAC, "n")),
    "cmax_v0": Spec(**_COMMODITY),
    "hi52_v0": Spec(**_COMMODITY),
    "crushdev_v0": Spec(
        n="headline.n", mean={k: (f"cost_ladder.{k}_tick.mean", FRAC) for k in (0, 1, 2)},
        sharpe={k: f"cost_ladder.{k}_tick.sharpe" for k in (0, 1, 2)},
        blocks=("blocks", CRUSH, "mean_pct", PCT, "n"), bench={1: ("const_book.mean", FRAC, "const_book.sharpe")}),
    "eqvrp_xasset_v0": Spec(**_COSTS_FX, bench={1: ("constant_basket.mean_pct", PCT, "constant_basket.sharpe")}),
    "gvzvrp_pm_v0": Spec(**_COSTS_FX, bench={1: ("constant_basket.mean_pct", PCT, "constant_basket.sharpe")}),
    "fxval_ppp_v0": Spec(**_COSTS_FX, bench={1: ("control_means_pct.CB", PCT, None)}),
    "liqbias_v0": Spec(
        n="headline.n", mean={k: (f"cost_ladder_mean_pct.{k}_tick", PCT) for k in (0, 1, 2)},
        sharpe={1: "headline.sharpe_ann"}, blocks=("blocks", EARLY, "mean_pct", PCT, "n")),
    "metals_eq_ym_v1": Spec(
        n="headline.n", mean={k: (f"means_pct_per_month.{k}.T", PCT) for k in (0, 1, 2)},
        bench={k: (f"means_pct_per_month.{k}.C", PCT, None) for k in (0, 1, 2)},
        ols=((1, "headline.a", "headline.b", "headline.n"), (2, "P3_2tick.a", None, "P3_2tick.n")),
        ols_blocks=("P2_blocks", METALS, "a")),
    "gotobi6j_v0": Spec(
        n="n_events", mean={1: ("headline.mean", FRAC)}, events="n_events",
        blocks=("blocks", EARLY, "mean_bp", FRAC, "n"), sharpe={1: "drift_P1b.sharpe_monthly_annualised"},
        sharpe_on_bench_rows=True, ols=((1, "drift_P1b.a", "drift_P1b.beta", "drift_P1b.n"),)),
}


# ---------------------------------------------------------------- the trees


@dataclass
class Tree:
    name: str
    root: Path
    screens: Path
    service: ResearchService


def _registry_rows(names: tuple[str, ...]) -> list[dict[str, str]]:
    return [{"name": n, "registered": "True", "n": "120", "p": "0.5", "control_p": "0.5", "verdict": "FAIL",
             "family_k": "10", "bonferroni_p": "1.0", "holm_p": "1.0", "bh_q": "1.0", "spec": n,
             "spec_sha256": "0" * 64, "spec_sha_ok": "True"} for n in names]


def _fixture_tree(tmp_path: Path) -> Tree:
    screens = tmp_path / "results" / "screens"
    screens.mkdir(parents=True)
    for path in FIXTURE_DIR.iterdir():
        if path.suffix in (".csv", ".json"):
            shutil.copyfile(path, screens / path.name)
    write_registry(tmp_path, _registry_rows(TEN))
    return Tree("fixture", tmp_path, screens, ResearchService(tmp_path))


@pytest.fixture
def merged(monkeypatch) -> dict[str, SeriesSource]:
    """The shared registries with this part's rows added, until the merge step does it for good."""
    table = {**research_mod.SERIES_SOURCES, **SOURCES}
    monkeypatch.setattr(research_mod, "SERIES_SOURCES", table, raising=False)
    monkeypatch.setattr(series_mod, "SERIES_SOURCES", table, raising=False)
    return table


@pytest.fixture
def fixture_tree(tmp_path, merged) -> Tree:
    return _fixture_tree(tmp_path)


@pytest.fixture
def lab(request) -> Path:
    """The lab's screens folder, for a test that reads the real files (conftest skips `lab_only` items unless `-m` selects it)."""
    if not (LAB_SCREENS / "cmax_v0.json").is_file():
        pytest.skip("no lab tree")
    return LAB_SCREENS


@pytest.fixture(params=["fixture", pytest.param("lab", marks=lab_only)])
def tree(request, tmp_path, merged) -> Tree:
    if request.param == "fixture":
        return _fixture_tree(tmp_path)
    return Tree("lab", ROOT, request.getfixturevalue("lab"), ResearchService(ROOT))


# ---------------------------------------------------------------- the anchor


def _get(doc: Mapping[str, Any], path: str) -> Any:
    node: Any = doc
    for key in path.split("."):
        node = node[key]
    return node


def _close(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=TOL, abs_tol=1e-12)


def _sharpe(x: np.ndarray) -> float:
    return float(x.mean() / x.std(ddof=1) * math.sqrt(12))


def _months(t: list[int]) -> np.ndarray:
    return np.asarray(pd.to_datetime(t, unit="s").strftime("%Y-%m"))


def _slope(y: np.ndarray, x: np.ndarray) -> tuple[float, float]:
    coef = np.linalg.lstsq(np.column_stack([np.ones(len(x)), x]), y, rcond=None)[0]
    return float(coef[0]), float(coef[1])


def _events(tree: Tree, name: str, spec: Spec, n_rows: int) -> np.ndarray:
    if spec.events is None:
        return np.ones(n_rows)
    counts = pd.read_csv(tree.screens / SOURCES[name].file, usecols=[spec.events])[spec.events].to_numpy(dtype=float)
    if len(counts) != n_rows:
        raise ValueError(f"{n_rows} months served against {len(counts)} rows of event counts")
    return counts


def _compare(out: list[str], what: str, got: float, want: float) -> None:
    if not _close(got, want):
        out.append(f"{what}: served {got!r}, recorded {want!r}")


def _check_costs(tree: Tree, name: str, spec: Spec, doc: Mapping[str, Any], out: list[str]) -> None:
    for cost, (path, factor) in spec.mean.items():
        s = tree.service.series(name, cost)
        r = np.asarray(s.r, dtype=float)
        w = _events(tree, name, spec, len(r))
        _compare(out, f"n at {cost} ticks", float(w.sum()), float(_get(doc, spec.n)))
        _compare(out, f"mean at {cost} ticks", float(r.sum() / w.sum()), float(_get(doc, path)) * factor)
        if cost in spec.sharpe:
            keep = np.array([b is not None for b in s.r_bench]) if spec.sharpe_on_bench_rows else np.ones(len(r), bool)
            _compare(out, f"Sharpe at {cost} ticks", _sharpe(r[keep]), float(_get(doc, spec.sharpe[cost])))


def _check_blocks(tree: Tree, name: str, spec: Spec, doc: Mapping[str, Any], out: list[str]) -> None:
    if spec.blocks is None:
        return
    container, ranges, field_name, factor, count = spec.blocks
    s = tree.service.series(name, 1)
    r, m = np.asarray(s.r, dtype=float), _months(s.t)
    w = _events(tree, name, spec, len(r))
    for key, (first, last) in ranges.items():
        mask = (m >= first) & (m <= last)
        recorded = _get(doc, container)[key]
        if count is not None:
            _compare(out, f"block {key} count", float(w[mask].sum()), float(recorded[count]))
        _compare(out, f"block {key} mean", float(r[mask].sum() / w[mask].sum()), float(recorded[field_name]) * factor)


def _check_bench(tree: Tree, name: str, spec: Spec, doc: Mapping[str, Any], out: list[str]) -> None:
    for cost, (path, factor, sharpe_path) in spec.bench.items():
        s = tree.service.series(name, cost)
        if s.r_bench is None:
            out.append(f"no benchmark served at {cost} ticks")
            continue
        b = np.asarray([math.nan if v is None else v for v in s.r_bench], dtype=float)
        _compare(out, f"benchmark mean at {cost} ticks", float(np.nanmean(b)), float(_get(doc, path)) * factor)
        if sharpe_path:
            _compare(out, f"benchmark Sharpe at {cost} ticks", _sharpe(b[~np.isnan(b)]), float(_get(doc, sharpe_path)))


def _check_ols(tree: Tree, name: str, spec: Spec, doc: Mapping[str, Any], out: list[str]) -> None:
    for cost, a_path, b_path, n_path in spec.ols:
        s = tree.service.series(name, cost)
        b = np.asarray([math.nan if v is None else v for v in s.r_bench], dtype=float)
        ok = ~np.isnan(b)
        a, slope = _slope(np.asarray(s.r, dtype=float)[ok], b[ok])
        _compare(out, f"intercept at {cost} ticks", a, float(_get(doc, a_path)))
        if b_path:
            _compare(out, f"slope at {cost} ticks", slope, float(_get(doc, b_path)))
        if n_path:
            _compare(out, f"regression rows at {cost} ticks", float(ok.sum()), float(_get(doc, n_path)))
    if spec.ols_blocks is None:
        return
    container, ranges, key = spec.ols_blocks
    s = tree.service.series(name, 1)
    m, r = _months(s.t), np.asarray(s.r, dtype=float)
    b = np.asarray([math.nan if v is None else v for v in s.r_bench], dtype=float)
    for label, (first, last) in ranges.items():
        mask = (m >= first) & (m <= last)
        _compare(out, f"block {label} intercept", _slope(r[mask], b[mask])[0], float(_get(doc, container)[label][key]))


def mismatches(tree: Tree, name: str) -> list[str]:
    """Every difference between the served series and what the screen JSON records (empty when it reproduces)."""
    doc = json.loads((tree.screens / f"{name}.json").read_text(encoding="utf-8"))
    spec, out = SPECS[name], []
    for check in (_check_costs, _check_blocks, _check_bench, _check_ols):
        check(tree, name, spec, doc, out)
    return out


def fails_anchor(tree: Tree, name: str) -> list[str]:
    """The mismatches, or the refusal the build raised (a shifted calendar can run into the fence)."""
    try:
        return mismatches(tree, name)
    except (ResearchDataError, ValueError) as exc:
        return [f"refused: {exc}"]


# ---------------------------------------------------------------- the mapping


def test_the_ten_rows_are_learned_or_named_with_a_reason():
    assert set(SOURCES) | set(NOT_LEARNABLE) == set(TEN)
    assert not set(SOURCES) & set(NOT_LEARNABLE)
    assert all(len(reason) > 40 for reason in NOT_LEARNABLE.values())
    assert set(SPECS) == set(SOURCES)


@pytest.mark.parametrize("name", LEARNED)
def test_a_mapping_reads_real_columns_and_no_price(name):
    source = SOURCES[name]
    header = pd.read_csv(FIXTURE_DIR / source.file, nrows=0).columns
    read = [source.time_column, *source.values.values(), *source.bench.values(),
            *[c for c in (source.guard_column, source.void_column) if c]]
    assert [c for c in read if c not in header] == []
    assert [c for c in read if is_price_column(c)] == []
    assert source.kind == "monthly" and source.time_rule == MONTH_END_SESSION and set(source.values) <= {0, 1, 2}
    assert 1 in source.values and set(source.bench) <= set(source.values)
    assert (source.guard_column == "end") == ("end" in header), "a file with an `end` column dates inside it"
    assert source.unit.startswith("return on capital") == (name != "gotobi6j_v0")


@lab_only
@pytest.mark.parametrize("name", TEN)
def test_the_fixture_has_the_lab_files_column_layout(lab, name):
    file = f"{name}_monthly.csv"
    ours = list(pd.read_csv(FIXTURE_DIR / file, nrows=0).columns)
    assert ours == list(pd.read_csv(lab / file, nrows=0).columns)


def test_a_fixture_holds_made_up_values_only():
    """Public repository: the synthetic JSON says so, and no fixture JSON carries a lab key such as a path or a hash."""
    for path in FIXTURE_DIR.glob("*.json"):
        doc = json.loads(path.read_text(encoding="utf-8"))
        assert doc["synthetic_fixture"] is True and not {"spec_sha256", "utc", "compute"} & set(doc)


# ---------------------------------------------------------------- the anchors


@pytest.mark.parametrize("name", LEARNED)
def test_the_served_series_reproduces_what_the_screen_records(tree, name):
    assert mismatches(tree, name) == []


@pytest.mark.parametrize("name", LEARNED)
def test_a_month_shifted_by_one_session_fails_the_block_anchor(tree, name, monkeypatch):
    """Born failing: dating each month at the next session (the first of the following month) moves the last month of
    every block into the next block, which the dated anchors see; a shift that left the means alone would not."""
    real = research_mod.series_stamps

    def one_session_late(source, frame):
        base = real(source, frame)
        days = pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in nyse_sessions(
            base.min().date(), (base.max() + pd.Timedelta(days=10)).date()).index]))
        later = pd.Series(days[days.searchsorted(base.dt.tz_localize(None).to_numpy(), side="right")],
                          index=base.index).dt.tz_localize("UTC")
        return later.where(later < IS_END, base)  # the last month stays inside the fence

    assert mismatches(tree, name) == []
    monkeypatch.setattr(research_mod, "series_stamps", one_session_late)
    found = fails_anchor(tree, name)
    assert any("block" in m for m in found), found


@pytest.mark.parametrize("name", [n for n in LEARNED if 2 in SOURCES[n].values])
def test_the_two_tick_column_read_for_one_tick_fails_the_anchor(tree, name, merged):
    """Born failing: the 1-tick series served from the 2-tick column no longer reproduces the recorded 1-tick mean."""
    source = SOURCES[name]
    merged[name] = dataclasses.replace(source, values={**source.values, 1: source.values[2]})
    found = fails_anchor(tree, name)
    assert any("mean at 1 ticks" in m for m in found), found


@pytest.mark.parametrize("name", [n for n in LEARNED if SOURCES[n].bench])
def test_the_benchmark_column_read_as_the_value_fails_the_anchor(tree, name, merged):
    """Born failing: a swapped value and benchmark column is caught by the value's own mean."""
    source = SOURCES[name]
    merged[name] = dataclasses.replace(source, values={**source.values, 1: source.bench[1]},
                                       bench={**source.bench, 1: source.values[1]})
    found = fails_anchor(tree, name)
    assert any("mean at 1 ticks" in m or m.startswith("refused") for m in found), found


# ---------------------------------------------------------------- dating and voids


def _last_sessions(labels: list[str]) -> list[str]:
    first, last = pd.Period(min(labels), "M"), pd.Period(max(labels), "M")
    days = pd.DatetimeIndex(pd.to_datetime([d.isoformat() for d in nyse_sessions(
        first.start_time.date(), last.end_time.date()).index]))
    by_month = pd.Series(days, index=days.to_period("M")).groupby(level=0).max()
    return [by_month[pd.Period(label, "M")].strftime("%Y-%m-%d") for label in labels]


@pytest.mark.parametrize("name", LEARNED)
def test_every_row_is_dated_at_the_last_nyse_session_of_its_month(tree, name):
    source = SOURCES[name]
    frame = pd.read_csv(tree.screens / source.file)
    s = tree.service.series(name, 1)
    served = list(pd.to_datetime(s.t, unit="s").strftime("%Y-%m-%d"))
    kept = frame[~frame[source.void_column]] if source.void_column else frame
    for column, wanted in source.keep_where.items():
        kept = kept[kept[column].isna() if wanted is None else kept[column] == wanted]
    assert served == _last_sessions(list(kept[source.time_column]))
    if source.guard_column:
        assert all(day <= end for day, end in zip(served, kept[source.guard_column]))


@lab_only
def _month_book(events: pd.DataFrame, days: str, value: str, scale: float) -> pd.Series:
    events = events.assign(month=events[days].str[:7])
    months = sorted(set(events["month"]))
    last = dict(zip(months, _last_sessions(months)))
    assert all(day <= last[m] for m, day in zip(events["month"], events[days])), "an event after its month's last day"
    return events.groupby("month")[value].sum() / scale


@lab_only
def test_the_event_files_prove_the_dating_of_the_two_files_without_a_guard(lab):
    """liqbias_v0 books an event in the month of its exit and gotobi6j_v0 in the month of its day, and the monthly
    file is exactly the sum of those events: none lies after its month's last NYSE session, where the series dates it."""
    liq = pd.read_csv(lab / "liqbias_v0_events.csv", usecols=["month", "exit_used", "net1"]).dropna(subset=["net1"])
    got = pd.read_csv(lab / "gotobi6j_v0_events.csv", usecols=["date", "xnys", "void", "gotobi", "n1"])
    got = got[got["gotobi"] & got["xnys"] & got["void"].isna()]
    for file, book, column in (("liqbias_v0_monthly.csv", _month_book(liq, "exit_used", "net1", 1e8), "r1"),
                               ("gotobi6j_v0_monthly.csv", _month_book(got, "date", "n1", 1.0), "r")):
        monthly = pd.read_csv(lab / file).set_index("month")[column]
        assert (monthly - book.reindex(monthly.index).fillna(0.0)).abs().max() < 1e-12


def test_gotobi_months_void_for_the_control_keep_their_book_and_lose_only_the_benchmark(fixture_tree):
    s = fixture_tree.service.series("gotobi6j_v0", 1)
    frame = pd.read_csv(fixture_tree.screens / SOURCES["gotobi6j_v0"].file)
    assert len(s.r) == len(frame) == 132 and sum(b is None for b in s.r_bench) == int(frame["lo"].isna().sum()) == 2
    assert s.r == pytest.approx(frame["r"].tolist(), abs=0)


def test_a_metals_void_month_is_left_out_not_zeroed(fixture_tree):
    """Born failing: flipping the void flag of the one void month adds a zero-return row to the series."""
    path = fixture_tree.screens / "metals_eq_ym_v1_monthly.csv"
    before = len(fixture_tree.service.series("metals_eq_ym_v1", 1).t)
    assert before == int(_get(json.loads((fixture_tree.screens / "metals_eq_ym_v1.json").read_text()), "headline.n"))
    path.write_text(path.read_text(encoding="utf-8").replace(",True,", ",False,", 1), encoding="utf-8")
    assert len(ResearchService(fixture_tree.root).series("metals_eq_ym_v1", 1).t) == before + 1


def test_flat_months_at_zero_stay_in_the_crush_book(fixture_tree):
    s = fixture_tree.service.series("crushdev_v0", 1)
    assert len(s.r) == 123 and s.r[:3] == [0.0, 0.0, 0.0]


@pytest.mark.parametrize("name", [n for n in LEARNED if SOURCES[n].guard_column])
def test_a_row_dated_after_its_guard_column_is_refused(fixture_tree, name, merged):
    """Born failing: a return that is complete a day before the month's last session cannot be dated at that session;
    without the guard column the same file would load."""
    source = SOURCES[name]
    path = fixture_tree.screens / source.file
    frame = pd.read_csv(path)
    frame.loc[3, source.guard_column] = "2012-04-02"
    frame.to_csv(path, index=False)
    with pytest.raises(ResearchDataError, match="after its end column"):
        ResearchService(fixture_tree.root).series(name, 1)
    merged[name] = dataclasses.replace(source, guard_column=None)
    assert len(ResearchService(fixture_tree.root).series(name, 1).t) == len(frame)


# ---------------------------------------------------------------- the fence


def _plant_2022_row(tree: Tree, name: str) -> None:
    source = SOURCES[name]
    path = tree.screens / source.file
    frame = pd.read_csv(path)
    row = frame.iloc[[-1]].copy()
    row[source.time_column] = "2022-01"
    for column in ("start", "d", "e", "end"):
        if column in row:
            row[column] = "2022-01-31" if column == "end" else "2022-01-03"
    pd.concat([frame, row]).to_csv(path, index=False)


@pytest.mark.parametrize("name", LEARNED)
def test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_fence(fixture_tree, name):
    """A regression guard, not a mapping guard: no source here can drop a row by date, so each relies on the fence in
    `ResearchService.series`, which this test keeps honest for the ten files."""
    _plant_2022_row(fixture_tree, name)
    with pytest.raises(ResearchDataError, match="on or after 2022-01-01"):
        ResearchService(fixture_tree.root).series(name, 1)


@pytest.mark.parametrize("name", LEARNED)
def test_with_the_shared_fence_stubbed_the_planted_row_is_served(fixture_tree, name, monkeypatch):
    """Born failing for the regression guard above: with the shared fence stubbed to pass rows through, the planted
    2022 row comes out of the mapping into the series, so the guard is the fence and nothing in the mapping."""
    _plant_2022_row(fixture_tree, name)
    monkeypatch.setattr(research_mod, "IS_END", pd.Timestamp("2100-01-01", tz="UTC"))
    s = ResearchService(fixture_tree.root).series(name, 1)
    assert pd.to_datetime(s.t[-1], unit="s").year == 2022


def _dates_under(node: Any) -> list[str]:
    if isinstance(node, Mapping):
        return [d for v in node.values() for d in _dates_under(v)]
    if isinstance(node, list):
        return [d for v in node for d in _dates_under(v)]
    return re.findall(r"\d{4}-\d{2}-\d{2}", node) if isinstance(node, str) else []


def sample_end(doc: Mapping[str, Any]) -> str | None:
    """The latest date the screen says it served (exclusive ends included), from its `serve` block; a screen with no
    `serve` block (airfx_v0) is read from its last block, whose key `YYYY-MM_YYYY-MM` ends the sample in that month."""
    found = _dates_under(doc.get("serve"))
    if found:
        return max(found)
    ends = [key.rsplit("_", 1)[1] for key in doc.get("blocks", {}) if re.fullmatch(r"\d{4}-\d{2}_\d{4}-\d{2}", key)]
    return (pd.Period(max(ends), "M").end_time.date().isoformat()) if ends else None


@pytest.mark.parametrize("name", LEARNED)
def test_every_learned_row_has_a_recorded_sample_that_stops_at_the_fence(tree, name):
    doc = json.loads((tree.screens / f"{name}.json").read_text(encoding="utf-8"))
    end = sample_end(doc)
    assert end is not None and end <= FENCE_DAY, f"{name}: the screen records a sample end of {end}"


def test_a_screen_whose_sample_passes_the_fence_is_seen():
    """Born failing for the check above: a served window ending 2022-03-01 is reported as past the fence."""
    assert sample_end({"serve": {"serves": [{"end": "2022-03-01 00:00:00+00:00"}]}}) > FENCE_DAY
    assert sample_end({"serve": {"v0_window": ["2010-06-01", "2022-01-01"]}}) == FENCE_DAY
    assert sample_end({"blocks": {"2018-01_2021-11": {}}}) == "2021-11-30"
    assert sample_end({"blocks": {"2018-01_2022-02": {}}}) > FENCE_DAY


@lab_only
@pytest.mark.parametrize("name", LEARNED)
def test_the_lab_file_labels_stop_before_the_fence(lab, name):
    source = SOURCES[name]
    labels = pd.read_csv(lab / source.file, usecols=[source.time_column])[source.time_column]
    assert labels.str[:7].max() < FENCE_DAY[:7]


# ---------------------------------------------------------------- the benchmark of the cskew family, airfx


@lab_only
@pytest.mark.parametrize("name", ("cmax_v0", "hi52_v0"))
def test_the_long_only_benchmark_is_cskew_v0s_own_book(lab, name, merged):
    """GM7 reproduces cskew_v0's long-only book to 1e-12 inside both screens: the served benchmark is that series."""
    service = ResearchService(ROOT)
    mine, theirs = service.series(name, 1), service.series("cskew_v0", 1)
    assert mine.t == theirs.t
    assert np.allclose(mine.r_bench, theirs.r_bench, rtol=0, atol=1e-12)


def test_airfx_serves_the_held_months_and_leaves_its_flat_month_out(fixture_tree):
    """The flat month is a row the screen leaves out: the served series holds the 118 held months, not the file's 119."""
    assert SOURCES["airfx_v0"].keep_where == {"held": True} and not NOT_LEARNABLE
    frame = pd.read_csv(fixture_tree.screens / "airfx_v0_monthly.csv")
    doc = json.loads((fixture_tree.screens / "airfx_v0.json").read_text(encoding="utf-8"))
    served = fixture_tree.service.series("airfx_v0", 1)
    assert len(frame) == doc["headline"]["n"] + 1 == len(served.t) + 1 and "2014-10" not in _months(served.t)
    assert fails_anchor(fixture_tree, "airfx_v0") == []


def test_regression_guard_airfx_without_its_rule_serves_a_spurious_zero_month(fixture_tree, merged):
    """The rule is what the anchor needs: planted without it the series holds 119 months and the count anchor fails."""
    merged["airfx_v0"] = dataclasses.replace(SOURCES["airfx_v0"], keep_where={})
    assert len(fixture_tree.service.series("airfx_v0", 1).t) == 119
    assert any(line.startswith("n at 1 ticks") for line in fails_anchor(fixture_tree, "airfx_v0"))


@lab_only
def test_the_lab_airfx_flat_month_is_the_one_row_the_screen_leaves_out(lab):
    doc = json.loads((lab / "airfx_v0.json").read_text(encoding="utf-8"))
    frame = pd.read_csv(lab / "airfx_v0_monthly.csv")
    assert len(frame) - int(frame["held"].sum()) == 1 == len(doc["counts"]["flat_months"])
    assert int(frame["held"].sum()) == doc["headline"]["n"]
    assert (frame.loc[~frame["held"], [c for c in frame if c.startswith("r_")]] == 0.0).all().all()


# ---------------------------------------------------------------- rows without a benchmark


@pytest.mark.parametrize("name", NO_BENCHMARK)
def test_born_failing_a_row_whose_control_is_not_a_book_maps_no_benchmark(name):
    """Treynor, beta and the benchmark line read the mapped benchmark when the series is on capital; against a
    control that is a transformation of the strategy (liqbias_v0's `D`) or a factor sleeve (airfx_v0) they mean
    nothing, so no benchmark column and no label are mapped."""
    source = SOURCES[name]
    assert dict(source.bench) == {} and source.bench_label is None


def test_liqbias_serves_no_benchmark_although_its_file_holds_the_control_column(fixture_tree):
    header = pd.read_csv(fixture_tree.screens / SOURCES["liqbias_v0"].file, nrows=0).columns
    assert "D" in header
    s = hypothesis_series(fixture_tree.service, "liqbias_v0", 1)
    assert s.bench is None and s.bench_label is None and s.on_capital


# ---------------------------------------------------------------- the part feeds the shared flow


@pytest.mark.parametrize("name", LEARNED)
def test_the_analytics_series_builds_for_each_row(tree, name):
    s = hypothesis_series(tree.service, name, 1)
    assert s.periods == 12 and s.kind == "monthly" and (s.bench is None) is (name in NO_BENCHMARK)
    assert s.on_capital is (name != "gotobi6j_v0")
    assert len(s.r) == len(tree.service.series(name, 1).t) and not s.r.isna().any()


def test_no_cost_is_served_that_the_file_does_not_hold(fixture_tree):
    from nq_terminal.services.research import UnknownNameError
    with pytest.raises(UnknownNameError, match="cost"):
        fixture_tree.service.series("gotobi6j_v0", 2)


def test_the_sources_are_a_plain_dict_of_series_sources():
    assert isinstance(SOURCES, dict) and all(isinstance(v, SeriesSource) for v in SOURCES.values())
