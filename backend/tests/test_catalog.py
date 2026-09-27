"""The data catalog (TASKS 2.3): processed series listed by name and described from parquet metadata only,
plus the QA report index. Everything here runs on files in tmp_path; the real tree is in test_catalog_drift.py.
"""
from __future__ import annotations

import os

import pandas as pd
import pytest

from nq_lab.config import IS_END
from nq_terminal.services import catalog as catalog_mod
from nq_terminal.services.catalog import Catalog, SeriesId, diff_series, list_folder, list_qa_reports, parse_series_name

from fakes import synthetic_loader

UTC = "UTC"


def ts(text: str) -> pd.Timestamp:
    return pd.Timestamp(text, tz=UTC)


@pytest.mark.parametrize(("name", "want"), [
    ("NQ.V.0_1m_back.parquet", SeriesId("NQ.V.0", "1m", "vendor")),
    ("NQ.V.0_1m_back_repaired.parquet", SeriesId("NQ.V.0", "1m", "repaired")),
    ("6E.V.0_1d_back.parquet", SeriesId("6E.V.0", "1d", "vendor")),
    ("RTY.V.0_1m_back.parquet", SeriesId("RTY.V.0", "1m", "vendor")),
])
def test_series_names_parse(name, want):
    assert parse_series_name(name) == want
    assert want.root == want.symbol.removesuffix(".V.0")


@pytest.mark.parametrize("name", ["eurodrift_rsv_close.parquet", "nq.V.0_1m_back.parquet", "NQ.V.0_1m_back.csv",
                                  "NQ.V.0_1h_back.parquet", "..\\NQ.V.0_1m_back.parquet", "NQ.V.0_1m_back_.parquet",
                                  "NQ.V.0_1m_none.parquet", "NQ.V.1_1m_back.parquet"])
def test_other_names_are_not_series(name):
    assert parse_series_name(name) is None


def test_the_listing_is_by_name_only(tmp_path):
    for name in ("NQ.V.0_1m_back.parquet", "NQ.V.0_1m_back_repaired.parquet", "ES.V.0_1d_back.parquet",
                 "eurodrift_rsv_close.parquet"):
        (tmp_path / name).write_bytes(b"not parquet at all")
    (tmp_path / "repairs").mkdir()
    listing = list_folder(tmp_path)
    assert set(listing.series) == {SeriesId("NQ.V.0", "1m", "vendor"), SeriesId("NQ.V.0", "1m", "repaired"),
                                   SeriesId("ES.V.0", "1d", "vendor")}
    assert listing.unrecognised == ("eurodrift_rsv_close.parquet",)
    assert list_folder(tmp_path / "missing").series == {}


def write_series(folder, name: str, frame: pd.DataFrame):
    path = folder / name
    frame.to_parquet(path, index=False)
    return path


def test_metadata_describes_columns_rows_and_first_bar(tmp_path):
    frame = synthetic_loader("NQ.V.0")(ts("2019-05-06"), ts("2019-05-08"))
    write_series(tmp_path, "NQ.V.0_1m_back.parquet", frame)
    [entry] = Catalog(tmp_path).entries()
    assert entry.series_id == SeriesId("NQ.V.0", "1m", "vendor")
    assert entry.rows == len(frame) and entry.error is None
    assert [c.name for c in entry.columns] == list(frame.columns)
    types = {c.name: c.type for c in entry.columns}
    assert types["v"] == "double" and types["instrument_id"] == "int32" and types["ts"] == "timestamp[ns, tz=UTC]"
    assert entry.first_ts == frame["ts"].iloc[0]
    assert entry.extends_past_fence is False


def test_daily_metadata_has_int64_instrument_ids(tmp_path):
    frame = synthetic_loader("ES.V.0", "1d")(ts("2015-01-01"), ts("2016-01-01"))
    write_series(tmp_path, "ES.V.0_1d_back.parquet", frame)
    [entry] = Catalog(tmp_path).entries()
    assert {c.name: c.type for c in entry.columns}["instrument_id"] == "int64"


def test_a_file_that_runs_past_the_fence_is_flagged(tmp_path):
    frame = synthetic_loader("NQ.V.0")(ts("2021-12-31"), ts("2022-01-04"))
    write_series(tmp_path, "NQ.V.0_1m_back.parquet", frame)
    [entry] = Catalog(tmp_path).entries()
    assert entry.extends_past_fence is True
    assert entry.first_ts < IS_END


def test_an_unreadable_file_is_reported_not_raised(tmp_path):
    (tmp_path / "CL.V.0_1m_back.parquet").write_bytes(b"half written")
    [entry] = Catalog(tmp_path).entries()
    assert entry.error and entry.rows is None and entry.columns == ()


def test_metadata_is_cached_until_the_file_changes(tmp_path, monkeypatch):
    frame = synthetic_loader("NQ.V.0")(ts("2019-05-06"), ts("2019-05-07"))
    path = write_series(tmp_path, "NQ.V.0_1m_back.parquet", frame)
    reads = []
    real = catalog_mod.read_series_meta
    monkeypatch.setattr(catalog_mod, "read_series_meta", lambda sid, p: reads.append(p) or real(sid, p))
    catalog = Catalog(tmp_path)
    catalog.entries()
    catalog.entries()
    assert len(reads) == 1
    write_series(tmp_path, path.name, frame.iloc[:10])
    assert catalog.entries()[0].rows == 10 and len(reads) == 2


def test_has_answers_from_the_listing(tmp_path):
    (tmp_path / "NQ.V.0_1m_back.parquet").write_bytes(b"x")
    catalog = Catalog(tmp_path)
    assert catalog.has("NQ.V.0", "1m", "vendor")
    assert not catalog.has("NQ.V.0", "1m", "repaired")
    assert not catalog.has("ES.V.0", "1m", "vendor")


def later_mtime(folder) -> None:
    """Move the folder's own mtime one second on, as the next add, remove or rename in it would."""
    stat = folder.stat()
    os.utime(folder, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))


def counted_scans(monkeypatch) -> list:
    scans: list = []
    real = catalog_mod.list_folder
    monkeypatch.setattr(catalog_mod, "list_folder", lambda folder: scans.append(folder) or real(folder))
    return scans


def test_the_folder_is_listed_once_for_many_lookups_until_it_changes(tmp_path, monkeypatch):
    roots = ("NQ", "ES", "YM", "RTY", "CL", "GC", "ZN", "6E")
    for root in roots:
        (tmp_path / f"{root}.V.0_1d_back.parquet").write_bytes(b"x")
    scans = counted_scans(monkeypatch)
    catalog = Catalog(tmp_path)
    for root in roots:  # a multi-symbol request: has() and version() per symbol
        assert catalog.has(f"{root}.V.0", "1d", "vendor")
        assert catalog.version(f"{root}.V.0", "1d", "vendor") is not None
    catalog.entries()
    assert len(scans) == 1

    (tmp_path / "HG.V.0_1d_back.parquet").write_bytes(b"x")
    later_mtime(tmp_path)
    assert catalog.has("HG.V.0", "1d", "vendor")
    assert len(scans) == 2

    (tmp_path / "HG.V.0_1d_back.parquet").unlink()
    later_mtime(tmp_path)
    assert not catalog.has("HG.V.0", "1d", "vendor")
    assert catalog.version("HG.V.0", "1d", "vendor") is None
    assert len(scans) == 3


def test_a_rewritten_file_changes_its_version_without_a_new_listing(tmp_path, monkeypatch):
    path = tmp_path / "NQ.V.0_1m_back.parquet"
    path.write_bytes(b"x")
    scans = counted_scans(monkeypatch)
    catalog = Catalog(tmp_path)
    before = catalog.version("NQ.V.0", "1m", "vendor")
    path.write_bytes(b"longer content")
    assert catalog.version("NQ.V.0", "1m", "vendor") != before
    assert len(scans) == 1


def test_a_missing_folder_lists_nothing_and_is_seen_once_created(tmp_path):
    folder = tmp_path / "processed"
    catalog = Catalog(folder)
    assert not catalog.has("NQ.V.0", "1m", "vendor")
    folder.mkdir()
    (folder / "NQ.V.0_1m_back.parquet").write_bytes(b"x")
    assert catalog.has("NQ.V.0", "1m", "vendor")


def test_diff_series_is_born_failing_in_both_directions(tmp_path):
    for name in ("NQ.V.0_1m_back.parquet", "ES.V.0_1m_back.parquet"):
        (tmp_path / name).write_bytes(b"x")
    expected = {SeriesId("NQ.V.0", "1m", "vendor"), SeriesId("YM.V.0", "1m", "vendor")}
    missing, extra = diff_series(expected, set(list_folder(tmp_path).series))
    assert missing == (SeriesId("YM.V.0", "1m", "vendor"),)
    assert extra == (SeriesId("ES.V.0", "1m", "vendor"),)
    assert diff_series(expected, expected) == ((), ())


# ---------------------------------------------------------------- QA reports

def test_qa_reports_are_listed_by_allowlisted_name(tmp_path):
    for name in ("qa_report.json", "qa_report_zn.json", "qa_report_universe.first.json", "repair_report.json",
                 "qa_report.md", "registry.csv", "other.json"):
        (tmp_path / name).write_text("{}", encoding="utf-8")
    reports = list_qa_reports(tmp_path)
    assert [r.name for r in reports] == ["qa_report", "qa_report_universe.first", "qa_report_zn", "repair_report"]
    assert [r.history for r in reports] == [False, True, False, False]
    assert all(r.size_bytes == 2 for r in reports)
    assert list_qa_reports(tmp_path / "missing") == []
