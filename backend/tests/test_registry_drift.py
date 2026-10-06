"""Registry drift (TASKS Phase 8 notes): rounds 13 and 14, registry tags and amendments, accepted amendments.

The terminal learns a new registered row through rules, not names, wherever it can:
- tags (edge, overlay, check) and the amendment columns are read from `results/registry.csv` when it carries them,
  and a registry without them (older files, the fixture) still parses;
- the accepted amendments come from `results/amendment_acceptances.md`, each re-hashed now against the hash it
  was accepted at, so a changed amendment file shows as changed (born failing below);
- the round-13 overlay's series is the screen's own P2 portfolio (`nq_lab.vt_har_stats.portfolio`, rescaled), so
  its drawdown reproduces the stored MDD_port; the round-14 book leaves out its void months.
Counts are read from the files at run time; nothing here hard-codes 21 or 22.
"""
from __future__ import annotations

import csv
import io
import json
import math

import numpy as np
import pandas as pd
import pytest

from nq_lab import registry as nq_registry
from nq_lab.config import ROOT
from nq_terminal import constants
from nq_terminal.analytics import drawdown, perf
from nq_terminal.analytics.series import hypothesis_series
from nq_terminal.services import amendments
from nq_terminal.services.research import ResearchService, parse_registry

from fakes import FIXTURES
from test_research_support import REAL_EXPERIMENTS, REAL_RESULTS, REAL_SCREENS, build_root, copy_file, flip_one_byte

TOL = 1e-9


@pytest.fixture(scope="module")
def real() -> ResearchService:
    return ResearchService(ROOT)


def _csv_rows() -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO((REAL_RESULTS / "registry.csv").read_text(encoding="utf-8"))))


def _screen(stem: str) -> dict:
    return json.loads((REAL_SCREENS / f"{stem}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- tags and amendments


def test_tags_follow_the_registry_rule(real):
    rows = {r["name"]: r for r in _csv_rows()}
    view = real.registry()
    for row in view.rows:
        raw = rows[row.name]
        flags = {"overlay": raw.get("overlay") == "True", "registered": raw["registered"] == "True"}
        expected = nq_registry._tag(flags)
        assert row.tag == expected, row.name
        assert row.overlay is (raw.get("overlay") == "True")
    assert view.counts.overlays == sum(r.get("overlay") == "True" for r in rows.values())
    assert view.counts.edges == sum(r.tag == "edge" for r in view.rows)
    passes = [r.verdict.split()[0].rstrip(",;:") == "PASS" for r in view.rows]
    assert view.counts.passed_edges == sum(r.tag == "edge" and ok for r, ok in zip(view.rows, passes))
    assert view.counts.passed_edges <= view.counts.passed


def test_amendment_columns_come_from_the_file(real):
    rows = {r["name"]: r for r in _csv_rows()}
    for row in real.registry().rows:
        raw = rows[row.name]
        files = [f for f in (raw.get("amendment_files") or "").split(";") if f]
        assert row.amendment_files == files, row.name
        assert row.amendments == int(raw.get("amendments") or 0) == len(files), row.name
        assert row.amendments_ok is (raw.get("amendments_ok") != "False"), row.name


def test_a_registry_without_the_new_columns_still_parses():
    raw = (FIXTURES / "results" / "registry.csv").read_bytes()
    rows = parse_registry(raw)
    assert rows and all(r.amendments == 0 and r.amendment_files == [] and r.overlay is False for r in rows)
    assert {r.tag for r in rows} <= {"edge", "check"}


def test_accepted_amendments_are_parsed_and_rehashed(real):
    view = real.registry().acceptances
    assert view.found and view.accepted_utc and view.accepted_utc.endswith("Z")
    listed = {a.file: a for a in view.amendments}
    text = (REAL_RESULTS / "amendment_acceptances.md").read_text(encoding="utf-8")
    assert len(listed) == text.count("| `experiments/")
    for row in real.registry().rows:
        for name in row.amendment_files:
            entry = listed.get(f"experiments/{name}")
            if entry is None:
                continue  # written by the research side, accepted later: see the pending test below
            assert row.name in entry.rows and entry.unchanged is True, name
    for entry in view.amendments:
        assert entry.sha256_now == amendments.sha256_file(ROOT / entry.file)
        assert "\\" not in entry.file and not entry.file.startswith("/")


def test_an_amendment_not_yet_accepted_is_never_listed_as_accepted(real):
    """The research side owns the acceptance record: a row may name an amendment file that the record does not list
    yet. The terminal then lists nothing for it (it never invents an acceptance) and the listed ones stay unchanged."""
    view = real.registry().acceptances
    listed = {a.file for a in view.amendments}
    pending = {f"experiments/{name}" for row in real.registry().rows for name in row.amendment_files} - listed
    for file in pending:
        assert (ROOT / file).is_file(), f"{file} is named by a registry row but is not in experiments/"
    assert view.all_unchanged is all(a.unchanged for a in view.amendments)


def test_a_row_naming_an_unaccepted_amendment_adds_no_acceptance_entry(tmp_path):
    """Born failing for an invented acceptance: the amendment is copied, the record does not list it."""
    root = build_root(tmp_path, ("airfx_v0",))
    copy_file(REAL_EXPERIMENTS / "airfx_v0_amend1.json", root, "experiments", "airfx_v0_amend1.json")
    copy_file(REAL_RESULTS / "amendment_acceptances.md", root, "results", "amendment_acceptances.md")
    view = ResearchService(root).registry().acceptances
    assert "experiments/airfx_v0_amend1.json" not in {a.file for a in view.amendments}


def test_a_changed_amendment_file_shows_as_changed(tmp_path):
    """Born failing: one byte changed in an accepted amendment breaks its acceptance hash."""
    root = build_root(tmp_path, ("vt_har_v0",))
    copy_file(REAL_RESULTS / "amendment_acceptances.md", root, "results", "amendment_acceptances.md")
    for path in REAL_EXPERIMENTS.glob("vt_har_v0_amend*.json"):
        copy_file(path, root, "experiments", path.name)
    before = {a.file: a.unchanged for a in ResearchService(root).registry().acceptances.amendments}
    assert before["experiments/vt_har_v0_amend1.json"] is True
    flip_one_byte(root / "experiments" / "vt_har_v0_amend1.json")
    after = {a.file: a for a in ResearchService(root).registry().acceptances.amendments}
    assert after["experiments/vt_har_v0_amend1.json"].unchanged is False
    assert after["experiments/repair_futures_v2_amendment_1.json"].sha256_now is None  # not copied: missing


def test_no_acceptance_file_is_an_empty_block(tmp_path):
    root = build_root(tmp_path, ("volmanaged_v0",))
    block = ResearchService(root).registry().acceptances
    assert block.found is False and block.amendments == [] and block.accepted_utc is None


def test_parse_acceptances_reads_rows_and_the_accepted_time():
    text = ("# Accepted amendments\n\nAccepted on 2026-09-27T03:20:09Z, each on review.\n\n| amendment | sha |\n"
            "|---|---|\n| `experiments/a_v0_amend1.json` | `" + "ab" * 32 + "` |\n| not a row |\n")
    parsed = amendments.parse_acceptances(text)
    assert parsed.accepted_utc == "2026-09-27T03:20:09Z"
    assert parsed.rows == (("experiments/a_v0_amend1.json", "ab" * 32),)


def test_cards_carry_tag_and_amendments(real):
    cards = {c.name: c for c in real.cards()}
    rows = {r.name: r for r in real.registry().rows}
    for name, card in cards.items():
        assert card.tag == rows[name].tag and card.amendment_files == rows[name].amendment_files
    overlay = [c for c in cards.values() if c.tag == "overlay"]
    assert overlay and all(c.registered for c in overlay)


def test_multiple_testing_rows_carry_their_tag(real):
    tags = {r.name: r.tag for r in real.registry().rows}
    assert all(row.tag == tags[row.name] for row in real.multiple_testing().rows)


# ---------------------------------------------------------------- rounds 13 and 14 series


def test_vt_har_series_is_the_screens_p2_portfolio(real):
    s = real.series("vt_har_v0", 1)
    head = _screen("vt_har_v0")["headline"]
    assert len(s.t) == head["n"] and s.kind == "daily" and "sd" in s.unit and s.r_bench is not None
    r = pd.Series(s.r)
    assert -drawdown.max_drawdown(r, "A") == pytest.approx(head["mdd_port_vt"], rel=TOL, abs=0)
    bench = pd.Series(s.r_bench)
    assert -drawdown.max_drawdown(bench, "A") == pytest.approx(head["mdd_port_ce"], rel=TOL, abs=0)


def test_vt_har_portfolio_leaves_out_exactly_the_anchor_markets():
    markets = pd.read_csv(REAL_SCREENS / "vt_har_v0_markets.csv")
    anchors = tuple(markets.loc[markets["anchor"].astype(bool), "root"])
    source = constants.SERIES_SOURCES["vt_har_v0"]
    assert source.portfolio is not None and source.portfolio.exclude == anchors
    header = (REAL_SCREENS / source.file).read_text(encoding="utf-8").splitlines()[0].split(",")
    members = source.columns(header, 1)
    assert len([c for c in members if c.endswith("_VT")]) == len(markets) - len(anchors)
    assert not any(c.startswith(f"{a}_") for a in anchors for c in members)


def test_vt_har_has_no_series_at_a_cost_the_csv_does_not_hold(real):
    from nq_terminal.services.research import UnknownNameError
    with pytest.raises(UnknownNameError, match="cost"):
        real.series("vt_har_v0", 0)


def test_vrp_series_leaves_out_void_months_and_reproduces_the_screen(real):
    screen = _screen("vrp_eq_v0")
    for cost in (0, 1, 2):
        s = real.series("vrp_eq_v0", cost)
        assert len(s.t) == screen["headline"]["n"]
        days = pd.to_datetime(s.t, unit="s")
        assert not any(d.strftime("%Y-%m") in screen["void_book_months"] for d in days)
        r = np.asarray(s.r)
        assert r.mean() * 100 == pytest.approx(screen["means_pct_per_month"][str(cost)]["VRP"], rel=1e-12)
        assert perf.sharpe(pd.Series(r), 12) == pytest.approx(screen["sharpe"][str(cost)]["VRP"], rel=1e-12)


def test_a_void_column_row_is_left_out_not_zeroed(tmp_path):
    """Born failing: flipping the void month to valid adds one row to the series."""
    root = build_root(tmp_path, ("vrp_eq_v0",), series=("vrp_eq_v0_monthly.csv",))
    n = len(ResearchService(root).series("vrp_eq_v0", 1).t)
    path = root / "results" / "screens" / "vrp_eq_v0_monthly.csv"
    path.write_text(path.read_text(encoding="utf-8").replace(",True,", ",False,"), encoding="utf-8")
    assert len(ResearchService(root).series("vrp_eq_v0", 1).t) == n + 1


def test_the_analytics_series_checks_the_recorded_counts(real):
    for name in ("vt_har_v0", "vrp_eq_v0"):
        s = hypothesis_series(real, name, 1)
        assert s.n == _screen(name)["headline"]["n"]
        assert s.bench is not None and not s.bench.isna().any()
    vrp = hypothesis_series(real, "vrp_eq_v0", 1)
    assert vrp.on_capital and vrp.periods == 12
    vt = hypothesis_series(real, "vt_har_v0", 1)
    assert not vt.on_capital and vt.periods == 252
    assert math.isfinite(perf.sharpe(vt.r, 252))


def test_vrp_alpha_tiles_read_the_stored_fit():
    from nq_terminal.services.stored_alpha import stored_fit
    screen = _screen("vrp_eq_v0")
    fit = stored_fit("vrp_eq_v0", 1, screen)
    head = screen["headline"]
    assert fit is not None and fit.alpha_annual_pct == head["alpha_annual_pct"] and fit.t_min == head["t_a"]
    assert fit.t == {k: v for k, v in head["t_nw"].items()} and fit.b == head["b"]
    assert [b.block for b in fit.blocks] == sorted(screen["P2_blocks"])
    assert stored_fit("vrp_eq_v0", 2, screen) is None  # the screen records the headline fit at 1 tick only


def test_a_recorded_count_that_disagrees_fails_the_build(tmp_path):
    """Born failing: a round-14 CSV with one more valid month than the screen's n is refused."""
    from nq_terminal.analytics.series import SeriesError
    root = build_root(tmp_path, ("vrp_eq_v0",), series=("vrp_eq_v0_monthly.csv",))
    path = root / "results" / "screens" / "vrp_eq_v0_monthly.csv"
    path.write_text(path.read_text(encoding="utf-8").replace(",True,", ",False,"), encoding="utf-8")
    with pytest.raises(SeriesError, match="the screen records"):
        hypothesis_series(ResearchService(root), "vrp_eq_v0", 1)
