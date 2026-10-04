"""Gated bars for the terminal: a year-aligned in-memory cache over an injected serve function (TASKS 2.3).

One door (ARCHITECTURE section 5). The service never reads a price file. Every frame comes from the injected
`serve_fn`, which in production is `nq_lab.data.serve` (the OOS gate) and in tests a fake over
`oos_gate.serve_bars` with a temporary log. Every call passes `caller="terminal"` and a reason of the form
`terminal display: <symbol> <tf> <variant> <year> (chart only, not a registered test)`.

- Friendly refusal: a window is first checked with the gate's own `oos_gate.check_window` (a pure check that
  logs nothing and loads nothing), so a window outside `[IS_START, IS_END)`, or straddling it, raises
  `GateRefusal` with the gate's message before any serve; the loader is never called. The gate still decides
  on every serve: a refusal from `serve_fn` becomes `GateRefusal` too.
- Year-aligned cache (PRD DL1): 1m requests (and every bucket built from them) are widened to the calendar
  years they touch, clamped to the fence, and served one year per call; 1d is served for the whole in-sample
  window in one call. Frames are held in an LRU keyed by `(symbol, timeframe, variant, year, version)` and
  capped by bytes; `version` is the file's (mtime_ns, size) from the catalog, so a processed file rewritten by
  another workflow is served again rather than kept stale. A miss is loaded under a per-key lock, so concurrent
  requests for one year make one serve, and at most `MAX_CONCURRENT_LOADS` serves run at once. Nothing is
  written to disk. The year-aligned cache stays for every 1m reader but one.
- The one exception, a non-retaining read (`frame` and `bars` with `keep=False`; W5C D1): the two-day sparkline in
  desktop mode (`Settings.two_day_keeps_year`). It uses a year frame that is already cached (a hit, sliced, no serve);
  on a miss it takes the same per-key lock and a load slot, serves only the part of the year the request covers under
  the same `CacheKey` (so the gate logs the same reason, with the year label), and never stores the frame. The gate
  read is recorded and the serve counter moves exactly as for a cached read; the result reports `cached=False`.
- Span cap: one request covers at most `MAX_SPAN` of its timeframe (1m one year; 5m to 4h three years; 1d the
  whole window), checked after the fence and before any serve (`SpanTooLong`), so one call cannot load and
  bucket the whole 1m history.
- An empty serve (a year with no bars, e.g. before a series starts) is cached as an empty frame.
- Rebuilt 1m bars (NQ's repaired file stores no raw close or offset on the sessions rebuilt from trades) get
  `raw_c = c - offset` from the one offset their contract carries on its vendor bars in the same served year
  (`derive_raw_close`); a contract without exactly one known offset keeps NaN, which the screens count as unusable.
- OHLCV buckets (PRD DL4, ANALYTICS MV1): first open, max high, min low, last close, summed volume; never a
  decimation of prices. The bucket starts at the requested timeframe and widens along `BUCKETS` until the
  number of buckets is at most `max_points`. Buckets under a day are aligned on the UTC epoch; day buckets
  start at 22:00 UTC (the Globex session open) and week buckets on Sunday 22:00 UTC. Each bucket is stamped
  with the open time of its first bar (UTC epoch seconds).
- Roll markers (ANALYTICS MV2): at every `instrument_id` change inside the window,
  `gap_pts = offset_t - offset_{t-1}` and `gap_pct = 100 * gap_pts / raw close of the previous bar`
  (`raw_c` in 1m files, `c_none` in 1d files).
- Result cache hooks (services/result_cache.py): every frame handed out (a bar-cache hit included) is reported to the
  result cache's recorder as a gated read keyed on the processed file's (mtime_ns, size) from the catalogue, and moves
  the process-wide serve counter on entry and exit; every serve moves it before and after the call. `counted_serve`
  wraps any serve function (`app.state.serve_fn`) the same way, so a gated read in any thread or pool is seen.
- `nq_lab.oos_gate` is imported inside the functions that use it, not at module import (D1.1).
"""
from __future__ import annotations

import math
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd

from nq_lab.config import IS_END, IS_START
from nq_terminal.services import result_cache

CALLER = "terminal"
PRECHECK_REASON = "terminal display pre-check"
TS_CONVENTION = "bar open, UTC"
EMPTY_SERVE_PREFIX = "empty serve"
TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d")
VARIANTS = ("vendor", "repaired")
BUCKETS = (("1m", 1), ("5m", 5), ("15m", 15), ("30m", 30), ("1h", 60), ("4h", 240), ("1d", 1440), ("1w", 10080))
DEFAULT_MAX_POINTS = 4000
MAX_CONCURRENT_LOADS = 2
MAX_SPAN = {"1m": pd.DateOffset(years=1), "5m": pd.DateOffset(years=3), "15m": pd.DateOffset(years=3),
            "1h": pd.DateOffset(years=3), "4h": pd.DateOffset(years=3)}
MINUTE_NS = 60 * 10**9
NS_PER_S = 10**9
DAY_MINUTES = 1440
WEEK_MINUTES = 7 * DAY_MINUTES
SESSION_SHIFT_NS = 2 * 60 * MINUTE_NS  # 22:00 UTC is two hours before midnight
WEEK_ANCHOR_NS = (3 * DAY_MINUTES + 22 * 60) * MINUTE_NS  # Sunday 1970-01-04 22:00 UTC
PRICE_COLUMNS = {"1m": ("o", "h", "l", "c"), "1d": ("o_back", "h_back", "l_back", "c_back")}
RAW_CLOSE = {"1m": "raw_c", "1d": "c_none"}
FULL_WINDOW_LABEL = f"{IS_START.year}-{(IS_END - pd.Timedelta(days=1)).year}"

ServeFn = Callable[..., pd.DataFrame]


class GateRefusal(Exception):
    """The OOS gate refused the window (the message is the gate's own)."""


class UnknownSeries(LookupError):
    """No processed series exists for this symbol, timeframe and variant."""


class SpanTooLong(ValueError):
    """The window is longer than `MAX_SPAN` allows for the timeframe."""


@dataclass(frozen=True)
class CacheKey:
    symbol: str
    timeframe: str
    variant: str
    year: int | None  # None: the whole in-sample window (1d)
    version: tuple[int, int] | None = None  # the file's (mtime_ns, size) from the catalog


@dataclass(frozen=True)
class Served:
    frame: pd.DataFrame
    years: tuple[int, ...]
    cached: bool


@dataclass(frozen=True)
class Roll:
    t: int
    from_id: int
    to_id: int
    gap_pts: float
    gap_pct: float | None


@dataclass(frozen=True)
class BarsResult:
    symbol: str
    timeframe: str
    variant: str
    bucket: str
    start: pd.Timestamp
    end: pd.Timestamp
    t: list[int]
    o: list[float | None]
    h: list[float | None]
    l: list[float | None]  # noqa: E741 - the OHLC field name is the API contract
    c: list[float | None]
    v: list[float | None]
    rolls: tuple[Roll, ...]
    years: tuple[int, ...]
    cached: bool


# ---------------------------------------------------------------- windows and reasons


def precheck_window(start: pd.Timestamp, end: pd.Timestamp) -> None:
    """The gate's own window rule, before any serve; raises GateRefusal with the gate's message."""
    from nq_lab import oos_gate

    try:
        oos_gate.check_window(start, end, CALLER, PRECHECK_REASON)
    except oos_gate.OOSAccessError as exc:
        raise GateRefusal(str(exc)) from exc


def check_span(timeframe: str, start: pd.Timestamp, end: pd.Timestamp) -> None:
    span = MAX_SPAN.get(timeframe)
    if span is not None and start < end - span:
        raise SpanTooLong(f"a {timeframe} request may span at most {span.kwds['years']} year(s); "
                          "narrow the window or use a wider timeframe")


def source_timeframe(timeframe: str) -> str:
    if timeframe not in TIMEFRAMES:
        raise ValueError(f"unknown timeframe {timeframe!r}; use one of {', '.join(TIMEFRAMES)}")
    return "1d" if timeframe == "1d" else "1m"


def year_windows(source_tf: str, start: pd.Timestamp, end: pd.Timestamp) -> list[tuple[int | None, pd.Timestamp,
                                                                                       pd.Timestamp]]:
    """The cache windows a request touches: whole calendar years clamped to the fence, or the whole window (1d)."""
    if source_tf == "1d":
        return [(None, IS_START, IS_END)]
    last = (end - pd.Timedelta(1, unit="ns")).year
    windows = []
    for year in range(start.year, last + 1):
        lo = max(IS_START, pd.Timestamp(year=year, month=1, day=1, tz="UTC"))
        hi = min(IS_END, pd.Timestamp(year=year + 1, month=1, day=1, tz="UTC"))
        if lo < hi:
            windows.append((year, lo, hi))
    return windows


def serve_reason(key: CacheKey) -> str:
    span = FULL_WINDOW_LABEL if key.year is None else str(key.year)
    return (f"terminal display: {key.symbol} {key.timeframe} {key.variant} {span} "
            "(chart only, not a registered test)")


def frame_bytes(frame: pd.DataFrame) -> int:
    return int(frame.memory_usage(index=True).sum())


# ---------------------------------------------------------------- buckets and rolls


def bucket_ids(ts_ns: np.ndarray, minutes: int) -> np.ndarray:
    width = minutes * MINUTE_NS
    if minutes >= WEEK_MINUTES:
        return (ts_ns - WEEK_ANCHOR_NS) // width
    if minutes >= DAY_MINUTES:
        return (ts_ns + SESSION_SHIFT_NS) // width
    return ts_ns // width


def choose_bucket(ts_ns: np.ndarray, timeframe: str, max_points: int) -> tuple[str, int]:
    """The finest bucket, from the requested timeframe up, that gives at most `max_points` buckets."""
    first = next(i for i, (label, _) in enumerate(BUCKETS) if label == timeframe)
    for label, minutes in BUCKETS[first:]:
        ids = bucket_ids(ts_ns, minutes)
        count = int(np.count_nonzero(np.diff(ids))) + 1 if len(ids) else 0
        if count <= max_points:
            return label, minutes
    return BUCKETS[-1]


def _finite_list(values: np.ndarray) -> list[float | None]:
    return [x if math.isfinite(x) else None for x in np.asarray(values, dtype=np.float64).tolist()]


def aggregate(frame: pd.DataFrame, prices: tuple[str, str, str, str], minutes: int) -> dict[str, list]:
    """OHLCV per bucket: first open, max high, min low, last close, summed volume (NaN-tolerant)."""
    if frame.empty:
        return {"t": [], "o": [], "h": [], "l": [], "c": [], "v": []}
    ts_ns = frame["ts"].to_numpy(dtype="datetime64[ns]").astype(np.int64)
    ids = bucket_ids(ts_ns, minutes)
    starts = np.r_[0, np.flatnonzero(np.diff(ids)) + 1]
    lasts = np.r_[starts[1:], len(ids)] - 1
    o, h, low, c = (frame[col].to_numpy(dtype=np.float64) for col in prices)
    volume = np.nan_to_num(frame["v"].to_numpy(dtype=np.float64), nan=0.0)
    return {
        "t": (ts_ns[starts] // NS_PER_S).tolist(),
        "o": _finite_list(o[starts]),
        "h": _finite_list(np.fmax.reduceat(h, starts)),
        "l": _finite_list(np.fmin.reduceat(low, starts)),
        "c": _finite_list(c[lasts]),
        "v": _finite_list(np.add.reduceat(volume, starts)),
    }


def find_rolls(frame: pd.DataFrame, source_tf: str) -> tuple[Roll, ...]:
    if len(frame) < 2:
        return ()
    ids = frame["instrument_id"].to_numpy(dtype=np.int64)
    offset = frame["offset"].to_numpy(dtype=np.float64)
    raw = frame[RAW_CLOSE[source_tf]].to_numpy(dtype=np.float64)
    ts_ns = frame["ts"].to_numpy(dtype="datetime64[ns]").astype(np.int64)
    rolls = []
    for at in (np.flatnonzero(ids[1:] != ids[:-1]) + 1).tolist():
        gap = float(offset[at] - offset[at - 1])
        prior = float(raw[at - 1])
        pct = 100.0 * gap / prior if math.isfinite(prior) and prior != 0 and math.isfinite(gap) else None
        rolls.append(Roll(t=int(ts_ns[at] // NS_PER_S), from_id=int(ids[at - 1]), to_id=int(ids[at]),
                          gap_pts=gap if math.isfinite(gap) else math.nan, gap_pct=pct))
    return tuple(rolls)


def derive_raw_close(frame: pd.DataFrame) -> pd.DataFrame:
    """1m rows rebuilt from trades (NQ's repaired file) carry `raw_c` and `offset` NaN: the repair added the
    contract's back-adjustment offset to the trade prices and stored no raw close. Where the same `instrument_id`
    carries exactly one finite offset elsewhere in `frame` (its vendor bars; the offset is constant per contract),
    fill `offset` with it and `raw_c = c - offset`, the trade price. A contract with no known offset, or more than one,
    stays NaN. Returns `frame` itself when nothing is missing, else a new frame."""
    if frame.empty or not {"raw_c", "offset", "c", "instrument_id"} <= set(frame.columns):
        return frame
    raw = frame["raw_c"].to_numpy(dtype=np.float64)
    missing = ~np.isfinite(raw) & np.isfinite(frame["c"].to_numpy(dtype=np.float64))
    if not missing.any():
        return frame
    offset = frame["offset"].to_numpy(dtype=np.float64)
    known = frame.loc[np.isfinite(offset) & np.isfinite(raw), ["instrument_id", "offset"]]
    spread = known.groupby("instrument_id")["offset"].agg(["min", "max"])
    single = spread.loc[spread["min"] == spread["max"], "min"]
    fill = frame["instrument_id"].map(single).to_numpy(dtype=np.float64)
    use = missing & np.isfinite(fill)
    if not use.any():
        return frame
    out = frame.copy()
    out.loc[use, "offset"] = fill[use]
    out.loc[use, "raw_c"] = out.loc[use, "c"].to_numpy(dtype=np.float64) - fill[use]
    return out


def slice_window(frame: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    if frame.empty:
        return frame
    stamps = frame["ts"].to_numpy(dtype="datetime64[ns]")
    lo = int(np.searchsorted(stamps, start.tz_convert("UTC").tz_localize(None).to_datetime64(), side="left"))
    hi = int(np.searchsorted(stamps, end.tz_convert("UTC").tz_localize(None).to_datetime64(), side="left"))
    return frame.iloc[lo:hi]


# ---------------------------------------------------------------- the serve counter


class CountedServe:
    """A serve function that moves the process-wide serve counter before and after every call (refusals too).
    Other attributes reach the wrapped function, so a test double's call log stays readable."""

    def __init__(self, serve_fn: ServeFn):
        self.wrapped = serve_fn

    def __call__(self, *args: Any, **kwargs: Any) -> pd.DataFrame:
        result_cache.bump_serve_count()
        try:
            return self.wrapped(*args, **kwargs)
        finally:
            result_cache.bump_serve_count()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.wrapped, name)


def counted_serve(serve_fn: ServeFn) -> ServeFn:
    """`serve_fn` wrapped by CountedServe (once: wrapping a wrapped serve returns it unchanged)."""
    return serve_fn if isinstance(serve_fn, CountedServe) else CountedServe(serve_fn)


# ---------------------------------------------------------------- the service


class BarService:
    """Gated, cached bars (see the module docstring). Thread safe."""

    def __init__(self, serve_fn: ServeFn, *, cache_bytes: int):
        if cache_bytes <= 0:
            raise ValueError(f"cache_bytes must be positive, got {cache_bytes}")
        self._serve = serve_fn
        self._cap = cache_bytes
        self._entries: OrderedDict[CacheKey, pd.DataFrame] = OrderedDict()
        self._bytes = 0
        self._reads = 0
        self._lock = threading.Lock()
        self._key_locks: dict[CacheKey, threading.Lock] = {}
        self._load_slots = threading.BoundedSemaphore(MAX_CONCURRENT_LOADS)

    @property
    def serve_fn(self) -> ServeFn:
        return self._serve

    def stats(self) -> tuple[int, int, int]:
        """(gate reads this process, cached series, cached bytes) for /api/health."""
        with self._lock:
            return self._reads, len(self._entries), self._bytes

    def frame(self, symbol: str, source_tf: str, variant: str, start: pd.Timestamp, end: pd.Timestamp, *,
              version: tuple[int, int] | None = None, keep: bool = True) -> Served:
        """The served rows in [start, end) for one processed series, assembled from cached year frames. With
        `keep=False` a missing year is served for the requested part only and not stored (the module docstring)."""
        if source_tf not in PRICE_COLUMNS:
            raise ValueError(f"unknown source timeframe {source_tf!r}")
        if variant not in VARIANTS:
            raise ValueError(f"unknown variant {variant!r}")
        precheck_window(start, end)
        result_cache.record_gate_read(symbol, source_tf, variant, version)
        try:
            parts, years, cached = [], [], True
            for year, lo, hi in year_windows(source_tf, start, end):
                key = CacheKey(symbol, source_tf, variant, year, version)
                if keep:
                    part, hit = self._cached_serve(key, lo, hi)
                else:
                    part, hit = self._window_serve(key, max(lo, start), min(hi, end))
                cached = cached and hit
                years.extend(range(IS_START.year, IS_END.year) if year is None else [year])
                if not part.empty:
                    parts.append(part)
        finally:
            result_cache.bump_serve_count()
        frame = pd.concat(parts, ignore_index=True) if len(parts) > 1 else (parts[0] if parts else pd.DataFrame())
        return Served(frame=slice_window(frame, start, end), years=tuple(years), cached=cached)

    def bars(self, symbol: str, timeframe: str, variant: str, start: pd.Timestamp, end: pd.Timestamp, *,
             max_points: int = DEFAULT_MAX_POINTS, version: tuple[int, int] | None = None,
             keep: bool = True) -> BarsResult:
        source_tf = source_timeframe(timeframe)
        precheck_window(start, end)
        check_span(timeframe, start, end)
        served = self.frame(symbol, source_tf, variant, start, end, version=version, keep=keep)
        frame = served.frame
        ts_ns = frame["ts"].to_numpy(dtype="datetime64[ns]").astype(np.int64) if not frame.empty else np.array([])
        bucket, minutes = choose_bucket(ts_ns, timeframe, max_points)
        columns = aggregate(frame, PRICE_COLUMNS[source_tf], minutes)
        rolls = find_rolls(frame, source_tf) if not frame.empty else ()
        return BarsResult(symbol=symbol, timeframe=timeframe, variant=variant, bucket=bucket, start=start, end=end,
                          **columns, rolls=rolls, years=served.years, cached=served.cached)

    # internals

    def _lookup(self, key: CacheKey) -> pd.DataFrame | None:
        with self._lock:
            frame = self._entries.get(key)
            if frame is not None:
                self._entries.move_to_end(key)
            return frame

    def _key_lock(self, key: CacheKey) -> threading.Lock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def _cached_serve(self, key: CacheKey, start: pd.Timestamp, end: pd.Timestamp) -> tuple[pd.DataFrame, bool]:
        frame = self._lookup(key)
        if frame is not None:
            return frame, True
        with self._key_lock(key):
            frame = self._lookup(key)
            if frame is not None:
                return frame, True
            with self._load_slots:
                frame = self._load(key, start, end)
            self._store(key, frame)
            return frame, False

    def _window_serve(self, key: CacheKey, start: pd.Timestamp, end: pd.Timestamp) -> tuple[pd.DataFrame, bool]:
        """[start, end) inside `key`'s year: the cached year sliced on a hit; else one serve of just that window under
        the same key (the same reason), handed out and never stored."""
        frame = self._lookup(key)
        if frame is not None:
            return slice_window(frame, start, end), True
        with self._key_lock(key):
            frame = self._lookup(key)
            if frame is not None:
                return slice_window(frame, start, end), True
            with self._load_slots:
                return self._load(key, start, end), False

    def _load(self, key: CacheKey, start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        from nq_lab import oos_gate

        result_cache.bump_serve_count()
        try:
            frame = self._serve(start, end, caller=CALLER, reason=serve_reason(key), symbol=key.symbol,
                                timeframe=key.timeframe, variant=key.variant)
        except FileNotFoundError as exc:
            raise UnknownSeries(f"no processed series {key.symbol} {key.timeframe} {key.variant}") from exc
        except oos_gate.OOSAccessError as exc:
            if str(exc).startswith(EMPTY_SERVE_PREFIX):
                return pd.DataFrame()
            raise GateRefusal(str(exc)) from exc
        finally:
            result_cache.bump_serve_count()
        with self._lock:
            self._reads += 1
        frame = frame.sort_values("ts", ignore_index=True) if not frame["ts"].is_monotonic_increasing else frame
        return derive_raw_close(frame) if key.timeframe == "1m" else frame

    def _store(self, key: CacheKey, frame: pd.DataFrame) -> None:
        size = frame_bytes(frame)
        with self._lock:
            old = self._entries.pop(key, None)
            if old is not None:
                self._bytes -= frame_bytes(old)
            if size > self._cap:
                return
            self._entries[key] = frame
            self._bytes += size
            while self._bytes > self._cap and self._entries:
                _, evicted = self._entries.popitem(last=False)
                self._bytes -= frame_bytes(evicted)
