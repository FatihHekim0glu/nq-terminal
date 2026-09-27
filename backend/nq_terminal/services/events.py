"""Event study (EVT, Phase 11, P1, descriptive, [POST HOC]): average cumulative return paths around scheduled
macro releases, with a band from the cross-event standard error and one row per event.

Event lists are fixed in the project's files and read only:
- `experiments/macroday_v0.json` `event_dates`: 135 CPI, 135 PPI and 135 Employment Situation (NFP) releases at
  08:30 ET and the 89 scheduled FOMC statements (12:30, 14:00 or 14:15 ET), one line per date,
  `YYYY-MM-DD TYPE@HH:MM[+TYPE@HH:MM]`. Lines marked EXCLUDED (the five Good Fridays, NYSE closed) are dropped.
- `data/text/fomc/manifest.json`: the FOMC statements fetched for fomctone_v0; its `event` pages must name the same
  89 dates as the spec, or the calendar is refused (`CalendarError`). When the file is absent the check says so.
The user picks the instrument, the event type (CPI, PPI, NFP, FOMC, or ALL: every date once, at its earliest release)
and the window; nothing else.

Daily (sessions, NYSE calendar to 2021-12-31): r_t is the project's daily return `dB / (N - dB)` (B = `c_back`,
N = `c_none`, `dtsmom_panel.build_panel`), so a roll never enters a return. For an event on session e, the path at
offset k is the cumulative sum of r from the close of e - 1: `sum(r[e..e+k])` for k >= 0 and `-sum(r[e+k+1..e-1])`
for k < 0, so it is 0 at the last close before the event (offset -1) and the event session's own close-to-close
return is offset 0 (an 08:30 release and an FOMC statement both fall inside it). An event is void when a close in
its window is missing or stale (no bar dated that session), or the window leaves the in-sample sessions.

Intraday (minutes, 1m bars where they are validated: a repaired series exists): the price at time T is `raw_c` of
the latest bar that closed by T (bar open <= T - 1 min), at most `MAX_STALE_MINUTES` old; the path is
`P(t0 + m) / P(t0) - 1`, 0 at the release minute t0 (US Eastern time converted to UTC). On bars rebuilt from trades
(NQ's repaired file stores no raw close and no offset there) the raw close is the close less the contract's one
offset: EVT derives it itself (`raw_closes`), whatever the bar service did, from the contract's vendor bars in the
window or, when the window holds none, in `CONTEXT_DAYS` days either side of the release (a second fetch through the
same gate, clamped to the in-sample window). NQ's rebuilt days hold only 09:30 to 16:00 ET bars, so an 08:30 release
on one still has no price before it. An event is void when a price is missing, a rebuilt bar's contract has no single
known offset, the contract (`instrument_id`) changes inside the window, a session the window reads is excluded (the
release date and the CME trade dates of the window's first and last bar, a trade date starting at 18:00 ET the
evening before; NQ: gated by `qa.day_gate`; other symbols: left unrepaired by the futures repair provenance,
`nq_lab.data.excluded_sessions`, as SEAS drops them), or the window passes the fence (checked before any serve).

Band: at each offset, mean over the complete events, `se = sd(ddof=1) / sqrt(n)` and `mean -/+ 1.96 se`
(pointwise, not a band whole paths stay inside). No p-value or t statistic is computed: the slice is picked on
screen. Every price comes through the injected `BarService` (the OOS gate, caller `terminal`).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import AbstractSet, Callable, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab.config import IS_END, IS_START
from nq_lab.dtsmom_panel import build_panel, master_days
from nq_terminal.services.bars import BarService
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError, parse_json

EVENT_TYPES = ("CPI", "PPI", "NFP", "FOMC")
ALL = "ALL"
SELECTIONS = (*EVENT_TYPES, ALL)
MACRO_SPEC = Path("experiments") / "macroday_v0.json"
FOMC_MANIFEST = Path("data") / "text" / "fomc" / "manifest.json"
ET = "America/New_York"
BAND_Z = 1.96
BAND_LEVEL = 0.95
MAX_STALE_MINUTES = 20
CONTEXT_DAYS = 7  # either side of a release: where a rebuilt window's contract offset is looked up
TRADE_DATE_SHIFT = pd.Timedelta(hours=6)  # a CME trade date starts at 18:00 ET the evening before
DAILY_DEFAULT = (5, 5)
INTRADAY_DEFAULT = (60, 120)
DAILY_LIMITS = (1, 20)  # pre and post sessions, inclusive
INTRADAY_LIMITS = (1, 390)  # pre and post minutes, inclusive
DAILY_TF, DAILY_VARIANT = "1d", "vendor"
INTRADAY_TF, INTRADAY_VARIANT = "1m", "repaired"
LABEL = "[POST HOC] descriptive event study, in-sample to 2021-12-31, not a registered test"
INTRADAY_UNIT = "fraction of the price at the release minute (0.01 is 1%)"
DAILY_UNIT = ("cumulative sum of daily returns from the close before the event (0.01 is 1%); a sum, so it is not "
              "exactly the price change over several sessions")
GATED_REASON = "gated session (qa.day_gate)"
UNREPAIRED_REASON = "unrepaired session (futures repair provenance: collapsed vendor bars)"
REBUILT_REASON = "no raw close: bars rebuilt from trades whose contract has no single known offset"
BAND_NOTE = ("band: mean -/+ 1.96 x the cross-event standard error (sd ddof 1 / sqrt n) at each offset, pointwise; "
             "no p-value is shown on a slice picked on screen")
DAILY_BASIS = ("cumulative sum of daily r = dB / (N - dB) (B = c_back, N = c_none, the dtsmom_panel convention) from "
               "the close before the event session; 0 at offset -1; offset 0 is the event session's close to close; "
               "NYSE sessions to 2021-12-31")
INTRADAY_BASIS = ("P(t0 + m) / P(t0) - 1 on raw 1m closes (the latest bar closed by each minute, at most "
                  f"{MAX_STALE_MINUTES} minutes old; on a bar rebuilt from trades, its close less the contract's "
                  "offset); t0 is the release time (US Eastern); a window with a roll or an excluded session is void")

_RELEASE = r"(CPI|PPI|NFP|FOMC)@(\d{2}:\d{2})"
_LINE = re.compile(rf"^(\d{{4}}-\d{{2}}-\d{{2}}) ({_RELEASE}(?:\+{_RELEASE})*)(?:\s.*)?$")
_PART = re.compile(_RELEASE)


class CalendarError(RuntimeError):
    """The fixed event files are missing, unreadable or disagree with each other."""


@dataclass(frozen=True)
class Release:
    type: str
    time_et: str


@dataclass(frozen=True)
class EventDay:
    date: dt.date
    releases: tuple[Release, ...]
    excluded: bool

    @property
    def types(self) -> tuple[str, ...]:
        return tuple(r.type for r in self.releases)


@dataclass(frozen=True)
class Calendar:
    days: tuple[EventDay, ...]
    spec_sha256: str
    source: str
    fomc_check: str

    @property
    def counts(self) -> dict[str, int]:
        live = [d for d in self.days if not d.excluded]
        return {**{t: sum(t in d.types for d in live) for t in EVENT_TYPES}, ALL: len(live)}


@dataclass(frozen=True)
class EventPick:
    date: dt.date
    types: tuple[str, ...]
    time_et: str


@dataclass(frozen=True)
class EventPath:
    pick: EventPick
    t0_utc: pd.Timestamp | None
    path: tuple[float, ...]
    reason: str | None


@dataclass(frozen=True)
class Aggregate:
    n: int
    mean: list[float | None]
    se: list[float | None]
    lower: list[float | None]
    upper: list[float | None]


@dataclass(frozen=True)
class StudyResult:
    offsets: list[int]
    rows: tuple[EventPath, ...]
    agg: Aggregate
    end: dict
    years: tuple[int, ...]
    cached: bool


# ---------------------------------------------------------------- the calendar


def parse_line(line: str) -> EventDay:
    m = _LINE.match(line)
    if not m:
        raise CalendarError(f"unparseable event line: {line!r}")
    releases = tuple(Release(t, hhmm) for t, hhmm in _PART.findall(m.group(2)))
    return EventDay(date=dt.date.fromisoformat(m.group(1)), releases=releases, excluded="EXCLUDED" in line)


def _read(files: FileCache, path: Path) -> tuple[str, object]:
    try:
        return files.get(path, lambda raw: (hashlib.sha256(raw).hexdigest(), parse_json(raw)), kind="json-sha")
    except FileNotFoundError as exc:
        raise CalendarError(f"{path.name} is missing") from exc
    except (FileAccessError, FileDecodeError) as exc:
        raise CalendarError(f"{path.name} could not be read ({type(exc).__name__})") from exc


def _fomc_check(files: FileCache, root: Path, days: Sequence[EventDay]) -> str:
    path = root / FOMC_MANIFEST
    if not path.is_file():
        return "not checked: data/text/fomc/manifest.json is not on disk"
    _, doc = _read(files, path)
    pages = doc.get("pages") if isinstance(doc, dict) else None
    if not isinstance(pages, dict):
        raise CalendarError("the FOMC statements manifest has no pages")
    statements = {str(d)[:10] for d, page in pages.items() if isinstance(page, dict) and page.get("role") == "event"}
    listed = {str(d.date) for d in days if "FOMC" in d.types}
    if statements != listed:
        diff = sorted(statements ^ listed)[:5]
        raise CalendarError(f"FOMC dates in macroday_v0 and data/text/fomc disagree (for example {diff})")
    return f"agrees with the {len(statements)} statements in data/text/fomc/manifest.json"


def load_calendar(files: FileCache, root: Path) -> Calendar:
    """The fixed event days from `root` (the project root, or the fixture root); raises CalendarError."""
    sha, doc = _read(files, Path(root) / MACRO_SPEC)
    lines = doc.get("event_dates") if isinstance(doc, dict) else None
    if not isinstance(lines, (list, tuple)) or not lines:
        raise CalendarError("macroday_v0.json has no event_dates")
    days = tuple(parse_line(str(line)) for line in lines)
    if len({d.date for d in days}) != len(days):
        raise CalendarError("macroday_v0.json lists a date twice")
    return Calendar(days=days, spec_sha256=sha, source=f"{MACRO_SPEC.as_posix()} event_dates (sha256 {sha[:12]})",
                    fomc_check=_fomc_check(files, Path(root), days))


def pick_events(calendar: Calendar, event_type: str) -> list[EventPick]:
    """The chosen type's releases in date order; ALL is every date once, at its earliest release."""
    if event_type not in SELECTIONS:
        raise ValueError(f"unknown event type {event_type!r}; use one of {', '.join(SELECTIONS)}")
    picks = []
    for day in sorted((d for d in calendar.days if not d.excluded), key=lambda d: d.date):
        if event_type == ALL:
            picks.append(EventPick(day.date, day.types, min(r.time_et for r in day.releases)))
            continue
        hit = next((r for r in day.releases if r.type == event_type), None)
        if hit is not None:
            picks.append(EventPick(day.date, day.types, hit.time_et))
    return picks


def release_utc(pick: EventPick) -> pd.Timestamp:
    return pd.Timestamp(f"{pick.date} {pick.time_et}", tz=ET).tz_convert("UTC")


# ---------------------------------------------------------------- daily paths


def _daily_reason(days: Sequence[dt.date], pos: int | None, r: np.ndarray, stale: np.ndarray, pre: int,
                  post: int) -> str | None:
    if pos is None:
        return "not an NYSE session"
    if pos - pre < 0:
        return "the window starts before the first session"
    if pos + post >= len(days):
        return "the window passes the last in-sample session"
    for i in range(pos - pre, pos + post + 1):
        if stale[i]:
            return f"stale close on {days[i]} (no bar dated that session)"
    for i in range(pos - pre + 1, pos + post + 1):
        if not math.isfinite(r[i]):
            return f"no return on {days[i]}"
    return None


def daily_paths(days: Sequence[dt.date], r: np.ndarray, stale: np.ndarray, picks: Sequence[EventPick], *, pre: int,
                post: int) -> list[EventPath]:
    """One path per event over offsets -pre..post (see the module docstring); () when void."""
    where = {d: i for i, d in enumerate(days)}
    out = []
    for pick in picks:
        pos = where.get(pick.date)
        reason = _daily_reason(days, pos, r, stale, pre, post)
        if reason is not None:
            out.append(EventPath(pick, None, (), reason))
            continue
        after = np.cumsum(r[pos:pos + post + 1])
        before = [-float(np.sum(r[pos + k + 1:pos])) for k in range(-pre, 0)]
        out.append(EventPath(pick, None, tuple(before) + tuple(float(x) for x in after), None))
    return out


def daily_study(service: BarService, symbol: str, picks: Sequence[EventPick], *, pre: int, post: int,
                version: tuple[int, int] | None = None) -> StudyResult:
    served = service.frame(symbol, DAILY_TF, DAILY_VARIANT, IS_START, IS_END, version=version)
    days = master_days(IS_START.date(), (IS_END - pd.Timedelta(days=1)).date())
    if served.frame.empty:
        r, stale = np.full(len(days), np.nan), np.zeros(len(days), dtype=bool)
    else:
        panel = build_panel({symbol: served.frame}, days)
        r, stale = panel.r[:, 0], panel.stale[:, 0]
    rows = tuple(daily_paths(days, r, stale, picks, pre=pre, post=post))
    return _result(list(range(-pre, post + 1)), rows, served.years, served.cached)


# ---------------------------------------------------------------- intraday paths


def contract_offsets(frame: pd.DataFrame) -> dict[int, float]:
    """{instrument_id: offset} for every contract whose bars with a raw close carry exactly one finite offset."""
    if frame.empty or not {"raw_c", "offset", "instrument_id"} <= set(frame.columns):
        return {}
    raw = frame["raw_c"].to_numpy(dtype=np.float64)
    offset = frame["offset"].to_numpy(dtype=np.float64)
    known = frame.loc[np.isfinite(raw) & np.isfinite(offset), ["instrument_id", "offset"]]
    spread = known.groupby("instrument_id")["offset"].agg(["min", "max"])
    single = spread.loc[spread["min"] == spread["max"], "min"]
    return {int(iid): float(value) for iid, value in single.items()}


def raw_closes(frame: pd.DataFrame, rows: np.ndarray, offsets: Mapping[int, float]) -> tuple[np.ndarray, bool]:
    """(raw closes at `rows`, whether a rebuilt bar's contract had no offset). A bar with a close but no raw close
    (rebuilt from trades) is priced at its close less its contract's offset from `offsets`, else NaN."""
    px = frame["raw_c"].to_numpy(dtype=np.float64)[rows]
    gap = ~np.isfinite(px)
    if not gap.any() or "c" not in frame.columns:
        return px, False
    close = frame["c"].to_numpy(dtype=np.float64)[rows]
    iid = frame["instrument_id"].to_numpy(dtype=np.int64)[rows]
    rebuilt = gap & np.isfinite(close)
    offset = np.array([offsets.get(int(i), math.nan) for i in iid[rebuilt]], dtype=np.float64)
    out = px.copy()
    out[rebuilt] = close[rebuilt] - offset
    return out, bool((~np.isfinite(offset)).any())


def intraday_path(frame: pd.DataFrame, t0: pd.Timestamp, *, pre: int, post: int,
                  offsets: Mapping[int, float] | None = None) -> tuple[tuple[float, ...] | None, str | None]:
    """(path over minutes -pre..post, None) or (None, reason) from served 1m bars (ts, raw_c, instrument_id; c and
    offset price the rebuilt bars). `offsets` are the contracts' offsets, by default the ones `frame` shows."""
    if frame.empty:
        return None, "no bar in the window"
    ts = frame["ts"].to_numpy(dtype="datetime64[ns]").astype(np.int64)
    minute = 60 * 10**9
    targets = t0.value + np.arange(-pre - 1, post, dtype=np.int64) * minute  # bar opens closing by t0 + m
    idx = np.searchsorted(ts, targets, side="right") - 1
    fresh = (idx >= 0) & (ts[np.maximum(idx, 0)] >= targets - MAX_STALE_MINUTES * minute)
    if not fresh.all():
        first = int(np.flatnonzero(~fresh)[0]) - pre
        when = (t0 + pd.Timedelta(minutes=first)).tz_convert(ET).strftime("%H:%M")
        return None, f"no bar within {MAX_STALE_MINUTES} minutes before {when} ET"
    iid = frame["instrument_id"].to_numpy(dtype=np.int64)[idx]
    if (iid != iid[pre]).any():
        return None, "roll inside the window (the contract changes)"
    px, unpriced = raw_closes(frame, idx, contract_offsets(frame) if offsets is None else offsets)
    if unpriced:
        return None, REBUILT_REASON
    p0 = px[pre]
    if not (math.isfinite(p0) and p0 > 0) or not np.isfinite(px).all():
        return None, "no finite price in the window"
    return tuple(float(x) for x in px / p0 - 1.0), None


FetchFn = Callable[[pd.Timestamp, pd.Timestamp], tuple[pd.DataFrame, tuple[int, ...], bool]]


def unit_for(mode: str) -> str:
    return DAILY_UNIT if mode == "daily" else INTRADAY_UNIT


def trade_date(ts: pd.Timestamp) -> dt.date:
    """The CME trade date (= NYSE session date) of a bar opening at `ts`."""
    return (ts.tz_convert(ET) + TRADE_DATE_SHIFT).date()


def window_sessions(pick: EventPick, lo: pd.Timestamp, hi: pd.Timestamp) -> set[str]:
    """The session dates (YYYY-MM-DD) an event window reads: the release date and its first and last bar's."""
    return {str(pick.date), str(trade_date(lo)), str(trade_date(hi - pd.Timedelta(minutes=1)))}


def _intraday_row(pick: EventPick, fetch: FetchFn, gated: AbstractSet[str], gated_reason: str, pre: int, post: int
                  ) -> tuple[EventPath, tuple[int, ...], bool]:
    t0 = release_utc(pick)
    lo = t0 - pd.Timedelta(minutes=pre + 1 + MAX_STALE_MINUTES)
    hi = t0 + pd.Timedelta(minutes=post)
    if not window_sessions(pick, lo, hi).isdisjoint(gated):
        return EventPath(pick, t0, (), gated_reason), (), True
    if lo < IS_START or hi > IS_END:
        return EventPath(pick, t0, (), "the window passes the fence (2022-01-01)"), (), True
    frame, years, cached = fetch(lo, hi)
    path, reason = intraday_path(frame, t0, pre=pre, post=post)
    if reason != REBUILT_REASON:
        return EventPath(pick, t0, path or (), reason), years, cached
    span = pd.Timedelta(days=CONTEXT_DAYS)  # the window holds no offset for a rebuilt bar's contract: look around it
    context, more, hit = fetch(max(IS_START, t0 - span), min(IS_END, t0 + span))
    offsets = {**contract_offsets(context), **contract_offsets(frame)}
    path, reason = intraday_path(frame, t0, pre=pre, post=post, offsets=offsets)
    return EventPath(pick, t0, path or (), reason), tuple(sorted({*years, *more})), cached and hit


def intraday_study(fetch: FetchFn, picks: Sequence[EventPick], *, pre: int, post: int,
                   gated: AbstractSet[str] = frozenset(), gated_reason: str = GATED_REASON) -> StudyResult:
    """`gated` holds the excluded session dates (YYYY-MM-DD); their events are void with `gated_reason`."""
    rows, years, cached = [], set(), True
    for pick in picks:
        row, served, hit = _intraday_row(pick, fetch, gated, gated_reason, pre, post)
        rows.append(row)
        years.update(served)
        cached = cached and hit
    return _result(list(range(-pre, post + 1)), tuple(rows), tuple(sorted(years)), cached)


# ---------------------------------------------------------------- the band


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(x) else None


def aggregate(paths: Sequence[Sequence[float]], *, width: int | None = None) -> Aggregate:
    """Pointwise mean, cross-event standard error and the 1.96 se band over complete paths."""
    k = width if width is not None else (len(paths[0]) if paths else 0)
    if not paths:
        empty = [None] * k
        return Aggregate(0, list(empty), list(empty), list(empty), list(empty))
    m = np.asarray(paths, dtype=np.float64)
    n = m.shape[0]
    mean = m.mean(axis=0)
    if n < 2:
        none = [None] * m.shape[1]
        return Aggregate(n, [_finite(x) for x in mean], list(none), list(none), list(none))
    se = m.std(axis=0, ddof=1) / math.sqrt(n)
    return Aggregate(n, [_finite(x) for x in mean], [_finite(x) for x in se],
                     [_finite(x) for x in mean - BAND_Z * se], [_finite(x) for x in mean + BAND_Z * se])


def end_stats(paths: Sequence[Sequence[float]]) -> dict:
    """The distribution of the last offset's values across events (descriptive; no test statistic)."""
    col = np.asarray([p[-1] for p in paths], dtype=np.float64)
    n = len(col)
    if n == 0:
        return {"n": 0, "mean": None, "median": None, "sd": None, "se": None, "share_positive": None}
    sd = float(col.std(ddof=1)) if n > 1 else math.nan
    return {"n": n, "mean": _finite(float(col.mean())), "median": _finite(float(np.median(col))), "sd": _finite(sd),
            "se": _finite(sd / math.sqrt(n)), "share_positive": float((col > 0).sum() / n)}


def _result(offsets: list[int], rows: tuple[EventPath, ...], years: tuple[int, ...], cached: bool) -> StudyResult:
    used = [r.path for r in rows if r.reason is None]
    return StudyResult(offsets=offsets, rows=rows, agg=aggregate(used, width=len(offsets)), end=end_stats(used),
                       years=years, cached=cached)
