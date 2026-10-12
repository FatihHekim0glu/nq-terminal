"""DQ universe (research_ux item 3): the matrix of roots by years 2010 to 2021, from the per-symbol calendars.

Born failing (each fails on a build that lacks the guard, shown in the slice note):
- a stub calendar that does not filter, fed a planted 2022 session: the aggregator drops it itself;
- a `candidate_not_repaired` day counted as usable;
- a last bar past the fence shown as a date;
- per-year counts that differ from the sum of the per-symbol calendars (two code paths).
Fixture tree only (`dq_fixtures.write_universe_results`); no price is read.
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from nq_terminal.api.jobs import ALLOWED_WRITE_ROUTES
from nq_terminal.app import assert_get_only, create_app
from nq_terminal.models.dq import DqDay
from nq_terminal.services import dq
from nq_terminal.services.files import FileCache
from nq_terminal.settings import load_settings

from dq_fixtures import ES_WHY, HO_V2_SESSIONS, ZT_WHY, write_universe_results

from conftest import api_client

SEALED = "2021-12-31 or later, sealed"
YEARS = list(range(2010, 2022))
LOCAL, LOOPBACK = "http://127.0.0.1", ("127.0.0.1", 50000)


@pytest.fixture()
def results(tmp_path: Path) -> Path:
    return write_universe_results(tmp_path)


@pytest.fixture()
def files(results: Path) -> FileCache:
    return FileCache(roots=[results])


@pytest.fixture()
def universe(files, results):
    return dq.universe(files, results)


def root_of(universe, root: str):
    return next(r for r in universe.roots if r.root == root)


def row_of(universe, root: str, variant: str):
    return next(r for r in root_of(universe, root).rows if r.variant == variant)


def cell(row, year: int):
    return next(c for c in row.cells if c.year == year)


# ---- the shape ----------------------------------------------------------------------------------------------------
def test_roots_in_order_with_the_grid_years(universe):
    assert [r.root for r in universe.roots] == ["NQ", "ES", "GC", "HO", "ZT"]
    assert universe.years == YEARS and universe.fence == "2021-12-31" and universe.missing == []
    assert "[POST HOC]" in universe.label
    for root in universe.roots:
        for row in root.rows:
            assert [c.year for c in row.cells] == YEARS


def test_repair_status_and_variants_per_root(universe):
    status = {r.root: r.repair_status for r in universe.roots}
    assert status == {"NQ": "nq", "ES": "vendor_only", "GC": "v1", "HO": "v2", "ZT": "vendor_only"}
    variants = {r.root: [row.variant for row in r.rows] for r in universe.roots}
    assert variants == {"NQ": ["vendor", "repaired"], "ES": ["vendor"], "GC": ["vendor", "repaired"],
                        "HO": ["vendor", "repaired"], "ZT": ["vendor"]}
    assert all(row.timeframe == "1m" for r in universe.roots for row in r.rows)


def test_nq_without_a_repair_record_is_not_assessed(files, results):
    (results / "screens" / "za_v0_repaired_rejected_days.json").unlink()
    nq = root_of(dq.universe(files, results), "NQ")
    assert nq.repair_status == "not_assessed" and [r.variant for r in nq.rows] == ["vendor"]
    assert nq.rows[0].total.rejected == 4 and nq.rows[0].total.usable == nq.rows[0].total.sessions - 4


# ---- the counts, hand values --------------------------------------------------------------------------------------
def test_repaired_variant_counts_by_hand(universe):
    ho = row_of(universe, "HO", "repaired")
    c11, c12 = cell(ho, 2011), cell(ho, 2012)
    assert (c11.sessions, c11.usable, c11.unrepairable, c11.gated_out, c11.rejected) == (3, 2, 1, 0, 0)
    assert (c12.sessions, c12.usable, c12.unrepairable) == (4, 2, 2)
    assert c11.usable_share == pytest.approx(2 / 3) and c12.usable_share == 0.5
    assert cell(ho, 2013).sessions == 0 and cell(ho, 2013).usable_share is None


def test_vendor_variant_drops_every_candidate(universe):
    ho = row_of(universe, "HO", "vendor")
    c11 = cell(ho, 2011)
    # vendor 1, rebuilt 1 (dropped by research in the vendor variant: gated out), unrepairable 1
    assert (c11.sessions, c11.usable, c11.gated_out, c11.unrepairable) == (3, 1, 1, 1)
    es = row_of(universe, "ES", "vendor")  # a failed symbol: both candidates gated out
    assert (cell(es, 2011).usable, cell(es, 2011).gated_out, cell(es, 2011).unrepairable) == (1, 2, 0)


def test_nq_vendor_variant_calls_a_dropped_gate_day_rejected(universe):
    nq = row_of(universe, "NQ", "vendor")
    c14 = cell(nq, 2014)
    assert (c14.rejected, c14.unrepairable, c14.usable) == (0, 1, c14.sessions - 1)
    assert cell(nq, 2010).rejected == 1 and cell(nq, 2015).rejected == 1  # rebuilt in the repaired variant
    assert row_of(universe, "NQ", "repaired").total.unrepairable == 2


# ---- born failing: a candidate that was not repaired is never usable ---------------------------------------------
def raw_usable(results: Path, symbol: str, variant: str) -> Counter:
    """Usable sessions per year straight from the sidecar json: a third path that never uses DqDay."""
    name = f"repair_provenance_futures_v2/{symbol}.json"
    path = results / name if (results / name).is_file() else results / f"repair_provenance_futures/{symbol}.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    served = {"vendor"} | ({"rebuilt"} if variant == "repaired" else set())
    out: Counter = Counter()
    for day, row in doc["sessions"].items():
        if day <= "2021-12-31" and row["source"] in served:
            out[int(day[:4])] += 1
    return out


@pytest.mark.parametrize("root", ["ES", "GC", "HO", "ZT"])
def test_a_candidate_not_repaired_is_never_counted_usable(universe, results, root):
    for row in root_of(universe, root).rows:
        want = raw_usable(results, f"{root}.V.0", row.variant)
        assert {c.year: c.usable for c in row.cells if c.usable} == dict(want)
        assert row.total.usable == sum(want.values())


# ---- born failing: the 2022 session ------------------------------------------------------------------------------
def stub_loader(days_by_symbol: dict[str, list[DqDay]], repair: str = "v1", status: str = "repaired"):
    """A calendar source that does not filter by the fence (the per-symbol service does)."""
    def load(files, results, symbol):
        days = days_by_symbol.get(symbol)
        if days is None:
            return None
        return dq._summary(symbol, "results/stub.json", repair, status, None, days), days
    return load


def test_the_aggregator_drops_a_planted_2022_session_itself(files, results):
    days = [DqDay(date="2011-01-03", state="vendor", reason=None),
            DqDay(date="2021-12-31", state="rebuilt", reason="x"),
            DqDay(date="2022-01-03", state="rebuilt", reason="planted"),
            DqDay(date="2023-06-01", state="vendor", reason=None)]
    out = dq.universe(files, results, load=stub_loader({"GC.V.0": days}))
    gc = root_of(out, "GC")
    assert out.years == YEARS and all(c.year <= 2021 for row in gc.rows for c in row.cells)
    repaired = row_of(out, "GC", "repaired")
    assert repaired.total.sessions == 2 and repaired.total.usable == 2  # 2022 and 2023 are gone
    assert "2022" not in json.dumps(out.model_dump())


# ---- born failing: the last bar past the fence --------------------------------------------------------------------
def test_a_last_bar_past_the_fence_is_the_sealed_text_not_a_date(universe):
    nq, ho = root_of(universe, "NQ"), root_of(universe, "HO")
    for root in (nq, ho):  # NQ's QA runs to 2026-09-24, HO's to 2026-03-02
        assert root.last_bar == SEALED and root.last_sealed is True
    text = json.dumps(universe.model_dump())
    assert "2026" not in text and "2025" not in text


def test_a_last_bar_up_to_the_fence_is_its_date(universe):
    gc, es, zt = (root_of(universe, r) for r in ("GC", "ES", "ZT"))
    assert (gc.last_bar, gc.last_sealed) == ("2021-12-31", False)
    assert (es.last_bar, es.last_sealed) == ("2021-12-30", False)
    assert (zt.last_bar, zt.last_sealed) == ("2021-12-31", False)
    assert (gc.first_bar, zt.first_bar, root_of(universe, "NQ").first_bar) == ("2010-09-30", "2010-09-30", "2010-09-29")
    assert gc.qa_source == "results/qa_report_futures_1m.json"
    assert root_of(universe, "NQ").qa_source == "results/qa_report.json"


def test_a_root_without_a_qa_report_has_no_bounds(files, results):
    (results / "qa_report_futures_1m.json").unlink()
    out = dq.universe(files, results)
    gc = root_of(out, "GC")
    assert (gc.first_bar, gc.last_bar, gc.qa_source, gc.last_sealed) == (None, None, None, False)
    assert "results/qa_report_futures_1m.json" in out.missing


# ---- the 1d row ---------------------------------------------------------------------------------------------------
def test_the_daily_row_comes_from_the_1d_qa_and_is_clipped_at_the_fence(universe):
    nq, gc, es = (root_of(universe, r).daily for r in ("NQ", "GC", "ES"))
    assert (nq.rows, nq.first_bar, nq.last_bar, nq.last_sealed, nq.missing_nyse_sessions) == (
        2914, "2010-09-07", "2021-12-31", False, 6)
    assert (gc.rows, gc.last_bar, gc.last_sealed) == (2860, SEALED, True)  # 2900 minus 40 at or after the fence
    assert es.missing_nyse_sessions == 6 and gc.missing_nyse_sessions is None
    assert root_of(universe, "HO").daily is None and root_of(universe, "ZT").daily is None
    assert nq.source == "results/qa_report_carry_1d.json"
    assert "2022-03-01" not in json.dumps(universe.model_dump())


# ---- the known blocks, quoted -------------------------------------------------------------------------------------
def test_blocks_are_quoted_from_the_records(universe):
    assert root_of(universe, "ES").blocks[0] == ES_WHY
    assert root_of(universe, "ZT").blocks[0] == ZT_WHY
    ho = root_of(universe, "HO").blocks
    assert "RepairError: no trades: 2 sessions" in ho and "gate after repair: opening range bar missing: 1 session" in ho
    nq = root_of(universe, "NQ").blocks
    assert "RepairError: no trades: 1 session" in nq and "gate after repair: opening range bar missing: 1 session" in nq
    assert root_of(universe, "GC").blocks == ["RepairError: contract carries two offsets: 1 session"]


# ---- born failing: two code paths ---------------------------------------------------------------------------------
def calendar_sums(files, results, symbol: str) -> dict[int, Counter]:
    """Per-year state counts summed from the per-symbol calendar (the existing endpoint's path)."""
    out: dict[int, Counter] = {}
    for day in dq.calendar(files, results, symbol).days:
        out.setdefault(int(day.date[:4]), Counter())[day.state] += 1
    return out


@pytest.mark.parametrize("root", ["NQ", "ES", "GC", "HO", "ZT"])
def test_per_year_counts_equal_the_sum_of_the_symbol_calendar(universe, files, results, root):
    sums = calendar_sums(files, results, f"{root}.V.0")
    for row in root_of(universe, root).rows:
        for c in row.cells:
            s = sums.get(c.year, Counter())
            served = s["vendor"] + (s["rebuilt"] if row.variant == "repaired" else 0)
            assert c.sessions == sum(s.values()) and c.usable == served
            assert c.usable + c.gated_out + c.unrepairable + c.rejected == c.sessions
            if row.variant == "repaired":
                assert (c.gated_out, c.unrepairable, c.rejected) == (s["gated_out"], s["unrepairable"], s["rejected"])
            else:
                dropped = s["rebuilt"]
                assert c.gated_out + c.rejected == s["gated_out"] + s["rejected"] + dropped
                assert c.unrepairable == s["unrepairable"]


def test_totals_add_up_over_the_years(universe):
    for root in universe.roots:
        for row in root.rows:
            assert row.total.sessions == sum(c.sessions for c in row.cells)
            assert row.total.usable == sum(c.usable for c in row.cells)


# ---- failure handling ---------------------------------------------------------------------------------------------
def test_an_unreadable_sidecar_is_listed_missing_not_fatal(files, results):
    (results / "repair_provenance_futures" / "GC.V.0.json").write_text("{not json", encoding="utf-8")
    out = dq.universe(files, results)
    assert "GC" not in [r.root for r in out.roots]
    assert out.missing == ["results/repair_provenance_futures/GC.V.0.json"]


def test_an_unknown_session_source_is_refused(files, results):
    path = results / "repair_provenance_futures" / "ZT.V.0.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["sessions"]["2012-01-04"]["source"] = "invented"
    path.write_text(json.dumps(doc), encoding="utf-8")
    with pytest.raises(dq.DqRecordError):
        dq.universe(files, results)


def test_the_fixture_ho_record_is_the_one_planted_with_a_2022_session():
    assert any(d > "2021-12-31" for d in HO_V2_SESSIONS)  # the guard above would pass vacuously otherwise


# ---- the route ----------------------------------------------------------------------------------------------------
@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    write_universe_results(tmp_path)
    settings = replace(load_settings({"NQT_FIXTURE_DIR": str(tmp_path)}), web_dist=tmp_path / "no-dist")
    app = create_app(settings)
    assert_get_only(app, ALLOWED_WRITE_ROUTES)
    return api_client(app, base_url=LOCAL, client=LOOPBACK)


def test_route_serves_the_universe(client):
    body = client.get("/api/dq/universe").json()
    assert [r["root"] for r in body["roots"]] == ["NQ", "ES", "GC", "HO", "ZT"]
    assert body["years"] == YEARS and body["fence"] == "2021-12-31"
    nq = body["roots"][0]
    assert nq["last_bar"] == SEALED and nq["rows"][0]["cells"][0]["year"] == 2010


def test_route_is_get_only_and_leaks_no_path_or_sealed_date(client, tmp_path):
    assert client.post("/api/dq/universe").status_code == 405
    text = client.get("/api/dq/universe").text
    assert str(tmp_path).replace("\\", "\\\\") not in text and "Users" not in text
    assert "2026" not in text and "2022-" not in text


def test_route_answers_502_for_a_record_it_cannot_classify(tmp_path):
    results = write_universe_results(tmp_path)
    path = results / "repair_provenance_futures" / "ZT.V.0.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["sessions"]["2012-01-04"]["source"] = "invented"
    path.write_text(json.dumps(doc), encoding="utf-8")
    settings = replace(load_settings({"NQT_FIXTURE_DIR": str(tmp_path)}), web_dist=tmp_path / "no-dist")
    r = api_client(create_app(settings), base_url=LOCAL, client=LOOPBACK).get("/api/dq/universe")
    assert r.status_code == 502 and "invented" not in r.text


def test_the_fence_check_holds_even_if_the_grid_were_extended(monkeypatch):
    monkeypatch.setattr(dq, "YEARS", (2021, 2022))
    days = [DqDay(date="2021-12-31", state="vendor", reason=None), DqDay(date="2022-01-03", state="vendor", reason=None)]
    counts = dq.year_counts(days)
    assert counts[2021]["vendor"] == 1 and sum(counts[2022].values()) == 0


def test_more_than_six_reasons_are_folded_into_one_line():
    days = [DqDay(date=f"2011-01-{d:02d}", state="rejected", reason=f"gate: only {d} bars") for d in range(3, 12)]
    summary = dq._summary("NQ.V.0", "x", "nq", "not_assessed", None, days)
    blocks = dq._blocks(summary, days, {})
    assert len(blocks) == 7 and blocks[-1] == "3 further reasons: 3 sessions"
