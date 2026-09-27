"""SEAS seasonality (TASKS Phase 11): descriptive grouping of a return series by calendar period. [POST HOC].

Pure functions over session-indexed returns and served 1m frames; nothing here reads a file or calls the gate.

- Bucket statistics: for each key of a fixed domain, n (finite values), the mean, one standard error of the mean
  `sd(ddof=1) / sqrt(n)` (None below two values) and the hit rate, the share of values above zero (a zero is not a
  hit). No test statistic and no p-value is computed anywhere: the groups are user-picked slices (C7).
- Monthly values: the returns of each (year, month), compounded `prod(1 + r) - 1` for price returns or summed for
  Basis A books (C1: equity `K (1 + cumsum r)`). The calendar-month panel groups these monthly values, so its n is
  the number of years that have that month; the heatmap shows them as years by months.
- Weekday (Monday 0 to Friday 4) and week of month (`(day - 1) // 7 + 1`, so days 1 to 7 are week 1 and days 29 to
  31 week 5) group session returns directly.
- 30-minute buckets of the NYSE session: a 1m bar (stamped at its open, UTC) belongs to the session whose
  `[open_utc, close_utc)` holds its stamp, and to bucket `(ts - open_utc) // 30 min` (0 is 09:30 ET, 12 is 15:30 ET;
  an early close simply has fewer buckets). The bucket return follows the project convention on the back-adjusted
  change: `dB = c_last - o_first` and `r = dB / (N - dB)` with N the raw close of the bucket's last bar (`raw_c`),
  so it is never the percent change of the back-adjusted series. Sessions outside `keep` (gated or excluded by the
  repair provenance) never reach a bucket.
"""
from __future__ import annotations

import datetime as dt
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import numpy as np
import pandas as pd

COMPOUND = "compound"
SUM = "sum"
AGGREGATIONS = (COMPOUND, SUM)
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri")
WEEKS_OF_MONTH = ("W1", "W2", "W3", "W4", "W5")
DAYS_PER_WEEK = 7
BUCKET_MINUTES = 30
SESSION_BUCKETS = 13  # 09:30 to 16:00 ET
FIRST_BUCKET_MINUTE = 9 * 60 + 30
BUCKET_LABELS = tuple(f"{(FIRST_BUCKET_MINUTE + BUCKET_MINUTES * i) // 60:02d}:"
                      f"{(FIRST_BUCKET_MINUTE + BUCKET_MINUTES * i) % 60:02d}" for i in range(SESSION_BUCKETS))
BUCKET_NS = BUCKET_MINUTES * 60 * 10**9
BUCKET_COLUMNS = ["session", "bucket", "r"]

MONTH_DOMAIN = tuple(enumerate(MONTHS, start=1))
WEEKDAY_DOMAIN = tuple(enumerate(WEEKDAYS))
WEEK_OF_MONTH_DOMAIN = tuple(enumerate(WEEKS_OF_MONTH, start=1))
BUCKET_DOMAIN = tuple(enumerate(BUCKET_LABELS))


@dataclass(frozen=True)
class Bucket:
    key: int
    label: str
    n: int
    mean: float | None
    se: float | None
    hit_rate: float | None


def _finite(x: float) -> float | None:
    return float(x) if math.isfinite(x) else None


def summarise(values: np.ndarray) -> tuple[int, float | None, float | None, float | None]:
    """(n, mean, one standard error, hit rate) over the finite values."""
    v = np.asarray(values, dtype=float)
    v = v[np.isfinite(v)]
    n = int(len(v))
    if n == 0:
        return 0, None, None, None
    mean = _finite(float(np.mean(v)))
    se = _finite(float(np.std(v, ddof=1)) / math.sqrt(n)) if n >= 2 else None
    return n, mean, se, float(np.count_nonzero(v > 0)) / n


def bucket_stats(values: np.ndarray, keys: np.ndarray, domain: Iterable[tuple[int, str]]) -> tuple[Bucket, ...]:
    """One Bucket per (key, label) of `domain`, in its order; a key with no finite value has n 0 and no numbers."""
    v = np.asarray(values, dtype=float)
    k = np.asarray(keys)
    return tuple(Bucket(key, label, *summarise(v[k == key])) for key, label in domain)


# ---------------------------------------------------------------- calendar keys and months


def weekday_keys(index: pd.DatetimeIndex) -> np.ndarray:
    return np.asarray(index.weekday, dtype=int)


def week_of_month_keys(index: pd.DatetimeIndex) -> np.ndarray:
    return (np.asarray(index.day, dtype=int) - 1) // DAYS_PER_WEEK + 1


def _check_aggregation(how: str) -> None:
    if how not in AGGREGATIONS:
        raise ValueError(f"aggregation must be one of {', '.join(AGGREGATIONS)}, got {how!r}")


def monthly_returns(r: pd.Series, how: str) -> pd.Series:
    """The finite returns of each (year, month), compounded or summed; indexed by (year, month)."""
    _check_aggregation(how)
    clean = r[np.isfinite(r.to_numpy(dtype=float))]
    groups = clean.groupby([clean.index.year, clean.index.month])
    out = groups.apply(lambda s: float(np.prod(1.0 + s.to_numpy()) - 1.0)) if how == COMPOUND else groups.sum()
    return out.astype(float).rename_axis(["year", "month"])


def monthly_counts(r: pd.Series) -> pd.Series:
    clean = r[np.isfinite(r.to_numpy(dtype=float))]
    return clean.groupby([clean.index.year, clean.index.month]).size().rename_axis(["year", "month"])


def by_month(r: pd.Series, how: str) -> tuple[Bucket, ...]:
    monthly = monthly_returns(r, how)
    months = np.asarray(monthly.index.get_level_values("month"), dtype=int)
    return bucket_stats(monthly.to_numpy(dtype=float), months, MONTH_DOMAIN)


def by_weekday(r: pd.Series) -> tuple[Bucket, ...]:
    return bucket_stats(r.to_numpy(dtype=float), weekday_keys(r.index), WEEKDAY_DOMAIN)


def by_week_of_month(r: pd.Series) -> tuple[Bucket, ...]:
    return bucket_stats(r.to_numpy(dtype=float), week_of_month_keys(r.index), WEEK_OF_MONTH_DOMAIN)


def heatmap(r: pd.Series, how: str) -> tuple[list[int], list[list[float | None]], list[list[int]]]:
    """(years, values[year][month - 1], sessions[year][month - 1]) from the first to the last year of `r`."""
    monthly = monthly_returns(r, how)
    counts = monthly_counts(r)
    if monthly.empty:
        return [], [], []
    years = list(range(int(monthly.index.get_level_values("year").min()),
                       int(monthly.index.get_level_values("year").max()) + 1))
    values = [[_finite(monthly[(y, m)]) if (y, m) in monthly.index else None for m in range(1, 13)] for y in years]
    sessions = [[int(counts[(y, m)]) if (y, m) in counts.index else 0 for m in range(1, 13)] for y in years]
    return years, values, sessions


# ---------------------------------------------------------------- 30-minute NYSE buckets


def _empty_buckets() -> pd.DataFrame:
    return pd.DataFrame({"session": pd.Series([], dtype=object), "bucket": pd.Series([], dtype=int),
                         "r": pd.Series([], dtype=float)})[BUCKET_COLUMNS]


def _ns(values: Sequence[pd.Timestamp] | pd.Series) -> np.ndarray:
    return pd.DatetimeIndex(values).tz_convert("UTC").as_unit("ns").asi8


def intraday_bucket_returns(frame: pd.DataFrame, sessions: pd.DataFrame,
                            keep: set[dt.date] | None) -> pd.DataFrame:
    """One row per (session, bucket) that has bars: `session` (date), `bucket` (0 is 09:30 ET), `r`.

    `frame` holds served 1m bars sorted by `ts` (columns ts, o, c, raw_c); `sessions` is indexed by session date
    with `open_utc` and `close_utc` (nq_lab.sessions.nyse_sessions); `keep` limits the sessions (None keeps all)."""
    if frame.empty or sessions.empty:
        return _empty_buckets()
    table = sessions if keep is None else sessions[[d in keep for d in sessions.index]]
    if table.empty:
        return _empty_buckets()
    opens, closes = _ns(table["open_utc"]), _ns(table["close_utc"])
    ts = _ns(frame["ts"])
    at = np.searchsorted(opens, ts, side="right") - 1
    inside = (at >= 0) & (ts < closes[np.clip(at, 0, None)])
    if not inside.any():
        return _empty_buckets()
    at, ts = at[inside], ts[inside]
    bucket = (ts - opens[at]) // BUCKET_NS
    group = at * SESSION_BUCKETS + bucket
    starts = np.r_[0, np.flatnonzero(np.diff(group)) + 1]
    lasts = np.r_[starts[1:], len(group)] - 1
    o = frame["o"].to_numpy(dtype=float)[inside]
    c = frame["c"].to_numpy(dtype=float)[inside]
    raw = frame["raw_c"].to_numpy(dtype=float)[inside]
    d_b = c[lasts] - o[starts]
    base = raw[lasts] - d_b
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(base > 0, d_b / base, np.nan)
    days = list(table.index)
    return pd.DataFrame({"session": [days[i] for i in at[starts].tolist()],
                         "bucket": bucket[starts].astype(int), "r": r.astype(float)})[BUCKET_COLUMNS]


def sessions_used(returns: pd.DataFrame) -> int:
    """The number of sessions with at least one finite bucket return."""
    if returns.empty:
        return 0
    finite = np.isfinite(returns["r"].to_numpy(dtype=float))
    return int(returns.loc[finite, "session"].nunique())


def sessions_with_bars(returns: pd.DataFrame) -> int:
    """The number of sessions with at least one 1m bar inside the session (a row, finite or not)."""
    return 0 if returns.empty else int(returns["session"].nunique())


def by_bucket(returns: pd.DataFrame) -> tuple[Bucket, ...]:
    return bucket_stats(returns["r"].to_numpy(dtype=float), returns["bucket"].to_numpy(dtype=int), BUCKET_DOMAIN)
