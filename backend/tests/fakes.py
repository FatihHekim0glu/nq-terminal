"""Test doubles for the terminal backend (TASKS 1.4): fixture paths, synthetic bars and a fake serve.

Synthetic bars. `synthetic_loader(symbol, timeframe, variant)` returns a loader `(start, end) -> DataFrame` with the
columns of the processed files (ARCHITECTURE s3.6): 1m `ts, o, h, l, c, v, instrument_id, raw_c, offset` and 1d
`ts, o_none..c_none, o_back..c_back, v, instrument_id, offset`. Prices are a deterministic function of the minute,
so any split of a window gives the same rows; nothing is read from disk. Conventions:
- 1m bars are stamped at the bar open (UTC) on a Globex-like week: Sunday 22:00 to Friday 21:00 with a daily break
  from 21:00 to 22:00, no holidays. `c` of the bar at minute m is the price at minute m + 1.
- 1d bars are weekdays stamped at 00:00 UTC; `c_none` equals the unadjusted close of that day's 20:59 1m bar.
- Contracts roll quarterly at 22:00 UTC on the 10th of March, June, September and December. `raw_c` and the
  `*_none` columns are unadjusted; back-adjusted prices add `offset`, which is constant per `instrument_id` and 0 for
  the contract live at the anchor (1m: 2026-09-24, like the processed 1m files; 1d: 2021-12-31, where the daily pull
  stops). The loaders serve any window, 2022+ included: refusing it is the gate's job, and the tests prove it is.
- The series that exist mirror the processed files as listed (names only) on 2026-09-27 02:30: 1m (vendor) for the
  29 roots in `MINUTE_ROOTS` (all 27 dtsmom roots plus RTY and MNQ, the micro the paper book trades, pulled from
  2019-05), 1m repaired for the roots in `REPAIRED_ROOTS`, and 1d (vendor) for the 27 dtsmom roots plus the nine
  vendor-only roots in `EXTRA_DAILY_ROOTS` that the daily pull added on 2026-10-06 (RTY and MNQ have no processed
  1d file). Anything else raises FileNotFoundError before the
  gate, as the real serve does. `repaired` has the vendor prices and its own volume, so a test can tell which
  variant was served. The catalog drift test (`test_catalog_drift.py`) compares these sets with the real listing:
  vendor 1m and 1d exactly; repaired files generically (the futures repair workflow adds
  `<root>_1m_back_repaired.parquet` files, and each must belong to a mirrored minute root).
- `FakeCatalog` stands in for `services.catalog.Catalog` over the same series (never listing a folder), for tests
  and the fixture-mode E2E harness (`fixture_app.py`).
- Column dtypes match the processed schemas (parquet metadata): `v` float64; `instrument_id` int32 in 1m and int64
  in 1d; prices and `offset` float64; `ts` datetime64[ns, UTC].

Fake serve. `make_fake_serve(tmp_log)` returns a callable with the signature of `nq_lab.data.serve`. Every call goes
through the real `oos_gate.serve_bars` with the synthetic loader and the temporary log (ARCHITECTURE s5.2: the real
serve binds the project log at definition time, so it cannot be redirected). Each log line carries the test marker
in an extra `test` key, so a line leaking into the project log is visible to the session guard; the reason is left
untouched, so the gate's reason rule is tested exactly. Log paths inside results, data, live, backtests/output or
the fixtures folder are refused.
"""
from __future__ import annotations

import functools
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd
import pyarrow as pa

from nq_lab import oos_gate
from nq_lab.config import OOS_LOG, ROOT
from nq_lab.dtsmom_universe import TABLE
from nq_terminal.services.catalog import ColumnInfo, Listing, SeriesId, SeriesMeta

from research_guard import TEST_MARKER

FIXTURES = Path(__file__).resolve().parent / "fixtures"
PROTECTED = (ROOT / "results", ROOT / "data", ROOT / "live", ROOT / "backtests" / "output", FIXTURES)
Loader = Callable[[pd.Timestamp, pd.Timestamp], pd.DataFrame]

EPOCH_NS = pd.Timestamp("2000-01-01", tz="UTC").value  # a Saturday
MINUTE_NS = 60 * 10**9
DAY_MINUTES = 1440
EPOCH_WEEKDAY = 5
ANCHORS = {"1m": pd.Timestamp("2026-09-24", tz="UTC"), "1d": pd.Timestamp("2021-12-31", tz="UTC")}
OCTAVES = ((20 * DAY_MINUTES, 0.10), (DAY_MINUTES, 0.02), (60, 0.004), (1, 0.0006))  # (scale in minutes, log amp)
BASIS_SHARE = 0.003  # roll gaps up to about this share of the 2010 price level
MINUTE_ROOTS = ("6A", "6B", "6C", "6E", "6J", "6S", "CL", "ES", "GC", "HE", "HG", "HO", "LE", "MNQ", "NG", "NQ", "RB",
                "RTY", "SI", "YM", "ZB", "ZC", "ZF", "ZL", "ZM", "ZN", "ZS", "ZT", "ZW")
REPAIRED_ROOTS = ("NQ",)
MINUTE_SERIES = frozenset({(f"{root}.V.0", "vendor") for root in MINUTE_ROOTS}
                          | {(f"{root}.V.0", "repaired") for root in REPAIRED_ROOTS})
RTY_TICK = 0.10  # E-mini Russell 2000 (not in the dtsmom table: its 1d series starts 2017, so the rule dropped it)
MNQ_TICK = 0.25  # Micro E-mini Nasdaq-100 (the paper book's contract; its 1m file starts 2019-05)
LEVELS = {  # served price level in 2010 and at the end of 2021, in each root's served units
    "ES": (1100, 4700), "NQ": (2000, 16000), "YM": (10500, 36000), "ZT": (109, 109.5), "ZF": (117, 121),
    "ZN": (121, 130), "ZB": (124, 160), "6E": (1.35, 1.14), "6J": (0.0111, 0.0087), "6B": (1.55, 1.35),
    "6A": (0.9, 0.73), "6C": (0.97, 0.79), "6S": (0.95, 1.09), "CL": (80, 75), "NG": (4.5, 3.8), "HO": (2.2, 2.3),
    "RB": (2.1, 2.3), "GC": (1100, 1800), "SI": (17, 23), "HG": (3.3, 4.4), "ZC": (400, 590), "ZS": (1000, 1340),
    "ZW": (500, 770), "ZL": (40, 65), "ZM": (300, 400), "LE": (95, 140), "HE": (70, 80), "RTY": (650, 2250),
    "MNQ": (7700, 16000),
    "6M": (0.0805, 0.0488), "6N": (0.7200, 0.6830), "GF": (100, 160), "KE": (500, 770), "PA": (450, 2000),
    "PL": (1600, 960), "UB": (140, 190), "ZO": (300, 550), "ZR": (12.5, 13.5),
}
# Roots with a processed 1d vendor file but outside the frozen dtsmom table (the daily pull of 2026-10-06): the
# catalog lists them, no screen ranks them. (root, tick in served units).
EXTRA_DAILY_TICKS = (("6M", 0.000005), ("6N", 0.0001), ("GF", 0.025), ("KE", 0.25), ("PA", 0.05), ("PL", 0.1),
                     ("UB", 0.03125), ("ZO", 0.25), ("ZR", 0.005))
EXTRA_DAILY_ROOTS = tuple(root for root, _ in EXTRA_DAILY_TICKS)


@dataclass(frozen=True)
class Spec:
    root: str
    tick: float
    lo: float
    hi: float
    salt: int


SPECS = {c.root: Spec(c.root, c.tick, *LEVELS[c.root], salt=1000 * (i + 1)) for i, c in enumerate(TABLE)}
SPECS["RTY"] = Spec("RTY", RTY_TICK, *LEVELS["RTY"], salt=1000 * (len(TABLE) + 1))
SPECS["MNQ"] = Spec("MNQ", MNQ_TICK, *LEVELS["MNQ"], salt=1000 * (len(TABLE) + 2))
for _i, (_root, _tick) in enumerate(EXTRA_DAILY_TICKS):
    SPECS[_root] = Spec(_root, _tick, *LEVELS[_root], salt=1000 * (len(TABLE) + 3 + _i))
DAILY_ROOTS = frozenset(c.root for c in TABLE) | frozenset(EXTRA_DAILY_ROOTS)


def fixture_path(*parts: str) -> Path:
    return FIXTURES.joinpath(*parts)


def load_manifest() -> dict:
    """The fixture manifest: `runs` (shape -> run_id) and `files` (path -> source, how, note)."""
    return json.loads(fixture_path("manifest.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- deterministic prices

def _unit(i: np.ndarray, salt: int) -> np.ndarray:
    """A uniform number in [0, 1) for each integer (splitmix64 mixing)."""
    with np.errstate(over="ignore"):
        x = np.asarray(i, dtype=np.int64).astype(np.uint64) * np.uint64(0x9E3779B97F4A7C15) + np.uint64(salt)
        x ^= x >> np.uint64(30)
        x *= np.uint64(0xBF58476D1CE4E5B9)
        x ^= x >> np.uint64(27)
        x *= np.uint64(0x94D049BB133111EB)
        x ^= x >> np.uint64(31)
    return (x >> np.uint64(11)).astype(np.float64) / float(2**53)


def _noise(m: np.ndarray, scale: int, salt: int) -> np.ndarray:
    """Smooth value noise in [-1, 1] with knots every `scale` minutes."""
    k, r = np.divmod(m, scale)
    f = r / scale
    w = f * f * (3 - 2 * f)
    a, b = _unit(k, salt), _unit(k + 1, salt)
    return 2 * (a + (b - a) * w) - 1


def _price(m: np.ndarray, spec: Spec) -> np.ndarray:
    years_since_2010 = m / (365.25 * DAY_MINUTES) - 10
    trend = np.log(spec.lo) + np.log(spec.hi / spec.lo) * years_since_2010 / 12
    wiggle = sum(amp * _noise(m, scale, spec.salt + j) for j, (scale, amp) in enumerate(OCTAVES))
    return np.exp(trend + wiggle)


def _contract(stamps: pd.DatetimeIndex) -> np.ndarray:
    """Quarterly contract index: the roll is at 22:00 UTC on the 10th of the quarter's last month."""
    quarter = stamps.year * 4 + (stamps.month - 1) // 3
    rolled = (stamps.month % 3 == 0) & ((stamps.day > 10) | ((stamps.day == 10) & (stamps.hour >= 22)))
    return np.asarray(quarter + rolled, dtype=np.int64)


def _basis(k: np.ndarray, spec: Spec) -> np.ndarray:
    """Per-contract basis in whole ticks; consecutive contracts differ in parity, so every roll has a gap."""
    half_range = max(1, round(BASIS_SHARE * spec.lo / spec.tick / 2))
    return (2 * np.floor(_unit(k, spec.salt + 101) * half_range) + k % 2) * spec.tick


def _grid(x: np.ndarray, tick: float) -> np.ndarray:
    return np.round(x / tick) * tick


def _offset(k: np.ndarray, spec: Spec, timeframe: str) -> np.ndarray:
    anchor = _contract(pd.DatetimeIndex([ANCHORS[timeframe]]))
    return _basis(anchor, spec)[0] - _basis(k, spec)


def _stamps(m: np.ndarray) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(pd.to_datetime(EPOCH_NS + m * MINUTE_NS, utc=True))


def _index_range(start: pd.Timestamp, end: pd.Timestamp, step_ns: int) -> np.ndarray:
    """Every i with EPOCH + i * step in [start, end) (ceil division on both ends)."""
    first = -((EPOCH_NS - start.value) // step_ns)
    stop = -((EPOCH_NS - end.value) // step_ns)
    return np.arange(first, stop, dtype=np.int64)


def _open_minutes(start: pd.Timestamp, end: pd.Timestamp) -> np.ndarray:
    m = _index_range(start, end, MINUTE_NS)
    dow = (m // DAY_MINUTES + EPOCH_WEEKDAY) % 7
    hour = (m % DAY_MINUTES) // 60
    shut = (hour == 21) | (dow == 5) | ((dow == 6) & (hour < 22)) | ((dow == 4) & (hour >= 22))
    return m[~shut]


def _bars_1m(start: pd.Timestamp, end: pd.Timestamp, spec: Spec, variant: str) -> pd.DataFrame:
    m = _open_minutes(start, end)
    stamps = _stamps(m)
    k = _contract(stamps)
    basis, offset = _basis(k, spec), _offset(k, spec, "1m")
    o, c = _grid(_price(m, spec) + basis, spec.tick), _grid(_price(m + 1, spec) + basis, spec.tick)
    h = np.maximum(o, c) + spec.tick * np.floor(3 * _unit(m, spec.salt + 211))
    low = np.minimum(o, c) - spec.tick * np.floor(3 * _unit(m, spec.salt + 223))
    volume_salt = spec.salt + (307 if variant == "repaired" else 301)
    v = 1 + np.floor(999 * _unit(m, volume_salt))
    instrument_id = (100_000 * (spec.salt // 1000) + k).astype(np.int32)
    return pd.DataFrame({"ts": stamps, "o": o + offset, "h": h + offset, "l": low + offset, "c": c + offset,
                         "v": v, "instrument_id": instrument_id, "raw_c": c, "offset": offset})


def _bars_1d(start: pd.Timestamp, end: pd.Timestamp, spec: Spec) -> pd.DataFrame:
    days = _index_range(start, end, DAY_MINUTES * MINUTE_NS)
    days = days[(days + EPOCH_WEEKDAY) % 7 < 5]
    close_m = days * DAY_MINUTES + 21 * 60
    samples = close_m[:, None] - 60 * np.arange(23, -1, -1)[None, :]  # hourly from 22:00 the day before to 21:00
    k = _contract(_stamps(close_m))
    raw = _grid(_price(samples, spec) + _basis(k, spec)[:, None], spec.tick)
    ext = spec.tick * np.floor(3 * _unit(days, spec.salt + 401))
    none = {"o": raw[:, 0], "h": raw.max(axis=1) + ext, "l": raw.min(axis=1) - ext, "c": raw[:, -1]}
    offset = _offset(k, spec, "1d")
    cols = {"ts": _stamps(days * DAY_MINUTES), **{f"{x}_none": none[x] for x in "ohlc"},
            **{f"{x}_back": none[x] + offset for x in "ohlc"},
            "v": 100_000 + np.floor(50_000 * _unit(days, spec.salt + 409)),
            "instrument_id": 100_000 * (spec.salt // 1000) + k, "offset": offset}
    return pd.DataFrame(cols)


def synthetic_loader(symbol: str, timeframe: str = "1m", variant: str = "vendor") -> Loader:
    """The synthetic loader for one series; FileNotFoundError when the project has no such processed series."""
    root = symbol[: -len(".V.0")] if symbol.endswith(".V.0") else None
    if timeframe == "1m" and (symbol, variant) in MINUTE_SERIES:
        return lambda start, end: _bars_1m(start, end, SPECS[root], variant)
    if timeframe == "1d" and variant == "vendor" and root in DAILY_ROOTS:
        return lambda start, end: _bars_1d(start, end, SPECS[root])
    raise FileNotFoundError(f"no processed series {symbol} {timeframe} {variant} (the synthetic set mirrors the "
                            "processed files)")


# ---------------------------------------------------------------- the fake serve over the real gate

@dataclass(frozen=True)
class ServeCall:
    start: pd.Timestamp
    end: pd.Timestamp
    caller: str
    reason: str
    symbol: str
    timeframe: str
    variant: str
    rows: int | None
    refused: str | None


def checked_log_path(log_path: Path) -> Path:
    """The temporary log must lie outside every folder that holds research, data, live or fixture files."""
    path = Path(log_path)
    resolved = path.resolve()
    if resolved == OOS_LOG.resolve() or any(resolved.is_relative_to(p.resolve()) for p in PROTECTED):
        raise ValueError(f"fake serve log {resolved} is inside a protected folder; use a temporary path")
    return path


class FakeServe:
    """Callable like `nq_lab.data.serve`; every call goes through `oos_gate.serve_bars` with the temporary log."""

    def __init__(self, log_path: Path):
        self.log_path = checked_log_path(log_path)
        self.calls: tuple[ServeCall, ...] = ()
        self.loader_calls = 0

    def __call__(self, start: pd.Timestamp, end: pd.Timestamp, *, caller: str, reason: str, symbol: str = "NQ.V.0",
                 timeframe: str = "1m", variant: str = "vendor") -> pd.DataFrame:
        loader = synthetic_loader(symbol, timeframe, variant)
        source = {"symbol": symbol, "timeframe": timeframe, "variant": variant, "test": TEST_MARKER}
        series = (symbol, timeframe, variant)
        try:
            frame = oos_gate.serve_bars(start, end, caller=caller, reason=reason, loader=self._counted(loader),
                                        log_path=self.log_path, source=source)
        except oos_gate.OOSAccessError as exc:
            self._record(ServeCall(start, end, caller, reason, *series, rows=None, refused=str(exc)))
            raise
        self._record(ServeCall(start, end, caller, reason, *series, rows=len(frame), refused=None))
        return frame

    def _counted(self, loader: Loader) -> Loader:
        def load(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
            self.loader_calls += 1
            return loader(start, end)

        return load

    def _record(self, call: ServeCall) -> None:
        self.calls = (*self.calls, call)

    @property
    def served(self) -> tuple[ServeCall, ...]:
        return tuple(c for c in self.calls if c.refused is None)

    @property
    def refusals(self) -> tuple[ServeCall, ...]:
        return tuple(c for c in self.calls if c.refused is not None)


def make_fake_serve(log_path: Path) -> FakeServe:
    return FakeServe(log_path)


# ---------------------------------------------------------------- the fake catalog

CATALOG_MTIME = "2026-09-26T00:00:00Z"
SCHEMA_WINDOW = (pd.Timestamp("2019-05-06", tz="UTC"), pd.Timestamp("2019-05-08", tz="UTC"))


def fake_series_ids() -> tuple[SeriesId, ...]:
    minute = {SeriesId(symbol, "1m", variant) for symbol, variant in MINUTE_SERIES}
    daily = {SeriesId(f"{root}.V.0", "1d", "vendor") for root in DAILY_ROOTS}
    return tuple(sorted(minute | daily))


def _file_name(sid: SeriesId) -> str:
    suffix = "" if sid.variant == "vendor" else f"_{sid.variant}"
    return f"{sid.symbol}_{sid.timeframe}_back{suffix}.parquet"


@functools.lru_cache(maxsize=None)  # a series' columns never change; building its bars cost ~3 ms each
def _columns(sid: SeriesId) -> tuple[ColumnInfo, ...]:
    frame = synthetic_loader(sid.symbol, sid.timeframe, sid.variant)(*SCHEMA_WINDOW)
    return tuple(ColumnInfo(f.name, str(f.type)) for f in pa.Schema.from_pandas(frame, preserve_index=False))


class FakeCatalog:
    """`Catalog` over the synthetic series: the same `listing`, `has`, `entries` and `version`, no folder read.
    `touch` bumps one series' version, as a rewritten processed file would."""

    def __init__(self, series: tuple[SeriesId, ...] | None = None):
        self._series = tuple(series) if series is not None else fake_series_ids()
        self._versions = {sid: (1, 1) for sid in self._series}
        self._lock = threading.Lock()

    def listing(self) -> Listing:
        return Listing(series={sid: Path(_file_name(sid)) for sid in self._series}, unrecognised=())

    def has(self, symbol: str, timeframe: str, variant: str) -> bool:
        return SeriesId(symbol, timeframe, variant) in self._versions

    def version(self, symbol: str, timeframe: str, variant: str) -> tuple[int, int] | None:
        with self._lock:
            return self._versions.get(SeriesId(symbol, timeframe, variant))

    def touch(self, symbol: str, timeframe: str, variant: str) -> None:
        sid = SeriesId(symbol, timeframe, variant)
        with self._lock:
            mtime, size = self._versions[sid]
            self._versions[sid] = (mtime + 1, size)

    def entries(self) -> list[SeriesMeta]:
        return [SeriesMeta(series_id=sid, file=_file_name(sid), size_bytes=0, modified_utc=CATALOG_MTIME, rows=None,
                           row_groups=None, columns=_columns(sid), first_ts=None, extends_past_fence=None, error=None)
                for sid in self._series]
