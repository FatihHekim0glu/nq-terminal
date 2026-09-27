"""DQ (RI4): the data quality calendar from the QA reports and the repair provenance records.

Day states, one per session:
- vendor: served from the vendor bars, never a structural candidate (futures) or never rejected (NQ);
- gated_out: a structural candidate of a symbol whose repair failed its validation, so the day keeps its collapsed
  vendor bars and research drops it (`nq_lab.data.excluded_sessions(..., "vendor")`);
- rejected: an NQ day the session gate rejected where no repair record exists;
- rebuilt: rebuilt from trade prints and served in the repaired series;
- unrepairable: the repair was tried on the day and failed (still rejected, or a per-day repair error).
Nothing after 2021-12-31 is served, and the v2 sidecar wins over v1 for the eight v2 symbols.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from nq_lab import data as nq_data
from nq_terminal.services import dq
from nq_terminal.services.files import FileCache

from dq_fixtures import ES_WHY, write_dq_results


@pytest.fixture()
def results(tmp_path: Path) -> Path:
    return write_dq_results(tmp_path)


@pytest.fixture()
def files(results: Path) -> FileCache:
    return FileCache(roots=[results])


def states(cal) -> dict[str, str]:
    return {d.date: d.state for d in cal.days}


def test_v2_symbols_match_the_lab():
    assert dq.V2_SYMBOLS == nq_data.V2_SYMBOLS


def test_classify_sidecar_maps_each_source_to_a_state():
    doc = {"status": "repaired", "sessions": {
        "2011-01-03": {"source": "vendor"},
        "2011-01-04": {"source": "rebuilt", "vendor_reasons": ["few_bars"]},
        "2011-01-05": {"source": "candidate_not_repaired", "reason": "RepairError: x"}}}
    days = dq.classify_sidecar(doc)
    assert [(d.date, d.state) for d in days] == [
        ("2011-01-03", "vendor"), ("2011-01-04", "rebuilt"), ("2011-01-05", "unrepairable")]
    assert days[2].reason == "RepairError: x"
    assert "few_bars" in days[1].reason


def test_a_failed_symbol_marks_its_candidates_gated_out_not_unrepairable():
    doc = {"status": "not_repaired", "sessions": {"2011-01-04": {"source": "candidate_not_repaired",
                                                                "reason": "symbol not repaired", "flags": ["c6"]}}}
    (day,) = dq.classify_sidecar(doc)
    assert day.state == "gated_out"
    assert "c6" in day.reason


def test_an_unknown_source_is_refused_born_failing():
    with pytest.raises(dq.DqRecordError):
        dq.classify_sidecar({"status": "repaired", "sessions": {"2011-01-03": {"source": "invented"}}})


def test_nq_days_from_the_rejected_files(files, results):
    cal = dq.calendar(files, results, "NQ.V.0")
    s = states(cal)
    assert s["2010-09-28"] == "rebuilt" and s["2015-03-02"] == "rebuilt"
    assert s["2014-06-12"] == "unrepairable" and s["2020-03-09"] == "unrepairable"
    assert s["2011-01-03"] == "vendor"  # an NYSE session with no record
    reasons = {d.date: d.reason for d in cal.days}
    assert "RepairError: no trades" in reasons["2014-06-12"]
    assert "only 300 of 390 RTH bars" in reasons["2015-03-02"]
    assert cal.symbol.counts.rebuilt == 2 and cal.symbol.counts.unrepairable == 2
    assert cal.symbol.counts.sessions == len(cal.days)


def test_nq_without_the_repaired_file_reports_rejected_days(files, results):
    (results / "screens" / "za_v0_repaired_rejected_days.json").unlink()
    cal = dq.calendar(files, results, "NQ.V.0")
    assert states(cal)["2014-06-12"] == "rejected"
    assert cal.symbol.counts.rejected == 4 and cal.symbol.counts.rebuilt == 0


def test_nothing_after_the_fence_is_served(files, results):
    for symbol in ("NQ.V.0", "GC.V.0"):
        cal = dq.calendar(files, results, symbol)
        assert max(d.date for d in cal.days) <= "2021-12-31"
        assert all(y.year <= 2021 for y in cal.qa_years)
    assert [y.year for y in dq.calendar(files, results, "NQ.V.0").qa_years] == [2011]


def test_v2_sidecar_wins_for_a_v2_symbol(files, results):
    cal = dq.calendar(files, results, "ES.V.0")
    assert cal.symbol.repair == "v2" and "repair_provenance_futures_v2" in cal.symbol.source
    assert cal.symbol.why_not_repaired == ES_WHY
    assert cal.symbol.counts.gated_out == 2 and cal.symbol.counts.vendor == 1


def test_v1_symbol_counts_and_qa_years(files, results):
    cal = dq.calendar(files, results, "GC.V.0")
    assert cal.symbol.repair == "v1" and cal.symbol.status == "repaired"
    c = cal.symbol.counts
    assert (c.vendor, c.rebuilt, c.unrepairable, c.gated_out, c.sessions) == (2, 1, 1, 0, 4)
    assert cal.qa_source == "results/qa_report_futures_1m.json"
    assert [(y.year, y.ohlc_violations, y.contract_changes) for y in cal.qa_years] == [(2011, 1, 4)]
    rebuilt = next(d for d in cal.days if d.state == "rebuilt")
    assert "volume flagged" in rebuilt.reason


def test_unknown_symbol_is_none(files, results):
    assert dq.calendar(files, results, "ZZ.V.0") is None


def test_index_lists_nq_first_then_the_sidecars(files, results):
    index = dq.symbol_index(files, results)
    assert [s.symbol for s in index.symbols] == ["NQ.V.0", "ES.V.0", "GC.V.0"]
    assert index.missing == []
    assert "[POST HOC]" in index.label and index.fence == "2021-12-31"
    gc = next(s for s in index.symbols if s.symbol == "GC.V.0")
    assert gc.first == "2011-01-03" and gc.last == "2011-01-06"


def test_an_unreadable_sidecar_is_listed_missing_not_fatal(files, results):
    (results / "repair_provenance_futures" / "GC.V.0.json").write_text("{not json", encoding="utf-8")
    index = dq.symbol_index(files, results)
    assert "GC.V.0" not in [s.symbol for s in index.symbols]
    assert index.missing == ["results/repair_provenance_futures/GC.V.0.json"]


def test_counts_add_up_on_the_real_tree():
    from nq_lab.config import RESULTS
    files = FileCache(roots=[RESULTS])
    index = dq.symbol_index(files, RESULTS)
    assert index.symbols[0].symbol == "NQ.V.0" and len(index.symbols) == 26
    for s in index.symbols:
        c = s.counts
        assert c.vendor + c.gated_out + c.rejected + c.rebuilt + c.unrepairable == c.sessions
        assert s.last is None or s.last <= "2021-12-31"
    nq = index.symbols[0].counts
    assert (nq.rebuilt, nq.unrepairable) == (487, 11)
    ho = next(s for s in index.symbols if s.symbol == "HO.V.0")
    assert ho.repair == "v2" and (ho.counts.rebuilt, ho.counts.unrepairable) == (740, 222)


def test_the_e2e_fixture_files_serve_a_calendar():
    """The DQ files in tests/fixtures/results (read only here) give a working screen in fixture mode."""
    results = Path(__file__).resolve().parent / "fixtures" / "results"
    files = FileCache(roots=[results])
    index = dq.symbol_index(files, results)
    assert [s.symbol for s in index.symbols] == ["NQ.V.0", "GC.V.0", "HO.V.0"] and index.missing == []
    ho = dq.calendar(files, results, "HO.V.0")
    assert ho.symbol.repair == "v2" and ho.symbol.counts.rebuilt > 0 and ho.qa_years
    assert dq.calendar(files, results, "NQ.V.0").symbol.counts.sessions > 0
