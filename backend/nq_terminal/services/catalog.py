"""The data catalog: processed price series listed by file name and described from parquet footers only.

This is the one terminal module allowed to look at the processed folder (ARCHITECTURE sections 3.6 and 5.5,
`tests/test_safety_ast.py`). It never reads a row: the folder comes from `nq_lab.data.processed_path`, series are
recognised by name, and each file is described by `pyarrow.parquet.read_metadata` (row count, row groups, the
Arrow schema, and the `ts` column statistics for the first bar and whether the file runs past the fence).
Prices are read only through `nq_lab.data.serve` (see `services/bars.py`).

The folder is listed on every call rather than hard-coded, because other workflows add series while the
terminal runs; metadata is cached per file on `(mtime_ns, size)`. A file that cannot be described (for example
one being written) is reported with an `error` and no columns, never raised.

It also lists the QA and repair reports in the results folder by an allowlisted name pattern
(`qa_report*.json`, `repair_report.json`); their content is read through `services/files.FileCache`.
"""
from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from nq_lab.config import IS_END
from nq_lab.data import processed_path

SERIES_FILE = re.compile(r"(?P<symbol>[A-Z0-9]{1,5}\.V\.0)_(?P<timeframe>1m|1d)_back(?:_(?P<variant>[a-z]+))?"
                         r"\.parquet")
QA_REPORT_FILE = re.compile(r"(?P<name>qa_report(?:[A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)?|repair_report)\.json")
HISTORY_MARKERS = (".first", ".prev_")
VENDOR = "vendor"
TS_COLUMN = "ts"
PARQUET_SUFFIX = ".parquet"


@dataclass(frozen=True, order=True)
class SeriesId:
    symbol: str
    timeframe: str
    variant: str

    @property
    def root(self) -> str:
        return self.symbol.removesuffix(".V.0")


@dataclass(frozen=True)
class Listing:
    series: dict[SeriesId, Path]
    unrecognised: tuple[str, ...]


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    type: str


@dataclass(frozen=True)
class SeriesMeta:
    series_id: SeriesId
    file: str
    size_bytes: int
    modified_utc: str
    rows: int | None
    row_groups: int | None
    columns: tuple[ColumnInfo, ...]
    first_ts: pd.Timestamp | None
    extends_past_fence: bool | None
    error: str | None


@dataclass(frozen=True)
class QaReportInfo:
    name: str
    file: Path
    size_bytes: int
    modified_utc: str
    history: bool


def processed_dir() -> Path:
    """The processed folder, derived from nq_lab's own path rule (never spelt out here)."""
    return processed_path().parent


def parse_series_name(name: str) -> SeriesId | None:
    match = SERIES_FILE.fullmatch(name)
    if match is None:
        return None
    return SeriesId(match["symbol"], match["timeframe"], match["variant"] or VENDOR)


def _iso_mtime(mtime_ns: int) -> str:
    stamp = datetime.fromtimestamp(mtime_ns / 1e9, tz=timezone.utc)
    return stamp.isoformat(timespec="seconds").replace("+00:00", "Z")


def list_folder(folder: Path) -> Listing:
    """Series files by name; other parquet files are listed as unrecognised. A missing folder lists nothing."""
    try:
        files = sorted(p for p in Path(folder).iterdir() if p.is_file())
    except (FileNotFoundError, NotADirectoryError):
        return Listing(series={}, unrecognised=())
    series, other = {}, []
    for path in files:
        sid = parse_series_name(path.name)
        if sid is not None:
            series[sid] = path
        elif path.suffix.lower() == PARQUET_SUFFIX:
            other.append(path.name)
    return Listing(series=series, unrecognised=tuple(other))


def _ts_range(meta: object) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    """Min and max of the ts column from row-group statistics (no rows are read)."""
    names = [meta.schema.column(i).name for i in range(meta.num_columns)]
    if TS_COLUMN not in names:
        return None, None
    col = names.index(TS_COLUMN)
    lows, highs = [], []
    for group in range(meta.num_row_groups):
        stats = meta.row_group(group).column(col).statistics
        if stats is not None and stats.has_min_max:
            lows.append(pd.Timestamp(stats.min))
            highs.append(pd.Timestamp(stats.max))
    return (min(lows), max(highs)) if lows else (None, None)


def _utc(stamp: pd.Timestamp | None) -> pd.Timestamp | None:
    if stamp is None:
        return None
    return stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")


def read_series_meta(sid: SeriesId, path: Path) -> SeriesMeta:
    """Describe one series file from its footer; errors are reported in the result."""
    stat = path.stat()
    base = {"series_id": sid, "file": path.name, "size_bytes": stat.st_size,
            "modified_utc": _iso_mtime(stat.st_mtime_ns)}
    try:
        meta = pq.read_metadata(path)
        schema = meta.schema.to_arrow_schema()
        first, last = _ts_range(meta)
    except (OSError, ValueError, pa.ArrowException) as exc:
        return SeriesMeta(**base, rows=None, row_groups=None, columns=(), first_ts=None, extends_past_fence=None,
                          error=f"metadata unreadable: {type(exc).__name__}")
    columns = tuple(ColumnInfo(f.name, str(f.type)) for f in schema)
    first, last = _utc(first), _utc(last)
    return SeriesMeta(**base, rows=meta.num_rows, row_groups=meta.num_row_groups, columns=columns, first_ts=first,
                      extends_past_fence=None if last is None else bool(last >= IS_END), error=None)


def diff_series(expected: Iterable[SeriesId], actual: Iterable[SeriesId]) -> tuple[tuple[SeriesId, ...],
                                                                                 tuple[SeriesId, ...]]:
    """(expected but missing, present but not expected), each sorted."""
    want, have = set(expected), set(actual)
    return tuple(sorted(want - have)), tuple(sorted(have - want))


class Catalog:
    """The processed folder's series with cached footer metadata. Thread safe."""

    def __init__(self, folder: Path | None = None):
        self.folder = Path(folder) if folder is not None else processed_dir()
        self._meta: dict[Path, tuple[tuple[int, int], SeriesMeta]] = {}
        self._lock = threading.Lock()

    def listing(self) -> Listing:
        return list_folder(self.folder)

    def has(self, symbol: str, timeframe: str, variant: str) -> bool:
        return SeriesId(symbol, timeframe, variant) in self.listing().series

    def version(self, symbol: str, timeframe: str, variant: str) -> tuple[int, int] | None:
        """(mtime_ns, size) of the series file, for the bar cache key; None when it is not listed."""
        path = self.listing().series.get(SeriesId(symbol, timeframe, variant))
        try:
            stat = path.stat() if path is not None else None
        except FileNotFoundError:
            return None
        return None if stat is None else (stat.st_mtime_ns, stat.st_size)

    def entries(self) -> list[SeriesMeta]:
        out = []
        for sid, path in sorted(self.listing().series.items()):
            entry = self._entry(sid, path)
            if entry is not None:
                out.append(entry)
        return out

    def _entry(self, sid: SeriesId, path: Path) -> SeriesMeta | None:
        try:
            stat = path.stat()
        except FileNotFoundError:
            return None  # removed between the listing and now
        key = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            cached = self._meta.get(path)
        if cached is not None and cached[0] == key:
            return cached[1]
        entry = read_series_meta(sid, path)
        if entry.error is None:
            with self._lock:
                self._meta[path] = (key, entry)
        return entry


def list_qa_reports(results_dir: Path) -> list[QaReportInfo]:
    """The QA and repair reports by allowlisted name, sorted; history copies (`.first`, `.prev_`) are marked."""
    try:
        files = [p for p in Path(results_dir).iterdir() if p.is_file()]
    except (FileNotFoundError, NotADirectoryError):
        return []
    reports = []
    for path in files:
        match = QA_REPORT_FILE.fullmatch(path.name)
        if match is None:
            continue
        stat = path.stat()
        name = match["name"]
        reports.append(QaReportInfo(name=name, file=path, size_bytes=stat.st_size,
                                    modified_utc=_iso_mtime(stat.st_mtime_ns),
                                    history=any(marker in name for marker in HISTORY_MARKERS)))
    return sorted(reports, key=lambda r: r.name)
