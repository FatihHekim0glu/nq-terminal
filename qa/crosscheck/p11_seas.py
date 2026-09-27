"""Reference values for SEAS, seasonality (TASKS Phase 11), for a `seasonality` bundle.

Written apart from the terminal's pandas and numpy grouping: plain Python loops over `datetime` dates and the
`statistics` module. Inputs:
- `dates` (YYYY-MM-DD) and `r` (floats or null): one session series; `aggregation` "compound" or "sum";
- optionally `bars` for the 30-minute buckets: `ts` (ISO 8601 UTC bar opens), `o`, `c`, `raw_c`, and `sessions`, a
  list of {date, open_utc, close_utc} for the kept sessions only (gated and excluded sessions already left out);
  with `offset` and `instrument_id`, a bar whose raw close is null (rebuilt from trades) takes `c - offset`, the
  offset being the one value its contract carries on bars that have a raw close (none or two: no raw close).

Per group the reference gives n, the mean, one standard error `stdev / sqrt(n)` (None below two values) and the hit
rate (share above zero). Months: one value per (year, month), compounded or summed; weekdays Monday 0 to Friday 4;
week of month `(day - 1) // 7 + 1`; buckets `(ts - open) // 30 min`, return `dB / (raw_c_last - dB)` with
`dB = c_last - o_first`. The heatmap is years (first to last) by 12 months, flattened row by row. No test statistic.
"""
from __future__ import annotations

import datetime as dt
import math
import statistics

from crosscheck.reference import Ref

MONTHS = 12
WEEKDAYS = 5
WEEKS = 5
BUCKETS = 13
BUCKET_SECONDS = 30 * 60
SOURCE = "plain Python loops with statistics.fmean and statistics.stdev (sample)"


def _stats(values: list[float]) -> tuple[int, float | None, float | None, float | None]:
    n = len(values)
    if n == 0:
        return 0, None, None, None
    se = statistics.stdev(values) / math.sqrt(n) if n >= 2 else None
    return n, statistics.fmean(values), se, sum(1 for v in values if v > 0) / n


def _group(pairs: list[tuple[int, float]], keys: range) -> dict[str, list]:
    out: dict[str, list] = {"n": [], "mean": [], "se": [], "hit": []}
    for key in keys:
        n, mean, se, hit = _stats([v for k, v in pairs if k == key])
        out["n"].append(float(n))
        out["mean"].append(mean)
        out["se"].append(se)
        out["hit"].append(hit)
    return out


def _clean(dates: list[str], r: list) -> list[tuple[dt.date, float]]:
    return [(dt.date.fromisoformat(d[:10]), float(v)) for d, v in zip(dates, r)
            if v is not None and math.isfinite(float(v))]


def monthly(rows: list[tuple[dt.date, float]], aggregation: str) -> dict[tuple[int, int], float]:
    if aggregation not in ("compound", "sum"):
        raise ValueError(f"unknown aggregation {aggregation!r}")
    acc: dict[tuple[int, int], float] = {}
    for day, v in rows:
        key = (day.year, day.month)
        if aggregation == "compound":
            acc[key] = (1.0 + acc.get(key, 0.0)) * (1.0 + v) - 1.0
        else:
            acc[key] = acc.get(key, 0.0) + v
    return acc


def heatmap_flat(months: dict[tuple[int, int], float]) -> list[float | None]:
    if not months:
        return []
    years = range(min(y for y, _ in months), max(y for y, _ in months) + 1)
    return [months.get((y, m)) for y in years for m in range(1, MONTHS + 1)]


def _stamp(text: str) -> float:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def _finite(x) -> bool:
    return x is not None and math.isfinite(float(x))


def raw_closes(bars: dict) -> list[float]:
    """`raw_c`, with a missing value filled as `c - offset` from the contract's one known offset."""
    raws = [float(x) if _finite(x) else math.nan for x in bars["raw_c"]]
    if "offset" not in bars or "instrument_id" not in bars:
        return raws
    seen: dict[int, set[float]] = {}
    for raw, off, iid in zip(bars["raw_c"], bars["offset"], bars["instrument_id"]):
        if _finite(raw) and _finite(off):
            seen.setdefault(int(iid), set()).add(float(off))
    out = []
    for raw, c, iid in zip(raws, bars["c"], bars["instrument_id"]):
        offsets = seen.get(int(iid), set())
        out.append(float(c) - next(iter(offsets)) if math.isnan(raw) and len(offsets) == 1 else raw)
    return out


def bucket_returns(bars: dict) -> list[tuple[int, float]]:
    """(bucket, r) per kept session and bucket with bars, walking the bars one by one."""
    firsts: dict[tuple[str, int], float] = {}
    lasts: dict[tuple[str, int], tuple[float, float]] = {}
    sessions = [(s["date"], _stamp(s["open_utc"]), _stamp(s["close_utc"])) for s in bars["sessions"]]
    for ts, o, c, raw in zip(bars["ts"], bars["o"], bars["c"], raw_closes(bars)):
        t = _stamp(ts)
        for day, open_s, close_s in sessions:
            if open_s <= t < close_s:
                key = (day, int((t - open_s) // BUCKET_SECONDS))
                firsts.setdefault(key, float(o))
                lasts[key] = (float(c), float(raw))
                break
    out = []
    for key, o_first in firsts.items():
        c_last, raw_last = lasts[key]
        d_b = c_last - o_first
        base = raw_last - d_b
        out.append((key[1], d_b / base if base > 0 else math.nan))
    return [(k, v) for k, v in out if math.isfinite(v)]


def _refs(prefix: str, groups: dict[str, list]) -> dict[str, Ref]:
    return {f"{prefix}_{field}": Ref(values, SOURCE) for field, values in groups.items()}


def seasonality_references(inputs: dict) -> dict[str, Ref]:
    rows = _clean(inputs["dates"], inputs["r"])
    months = monthly(rows, inputs["aggregation"])
    out: dict[str, Ref] = {}
    out.update(_refs("month", _group([(m, v) for (_, m), v in months.items()], range(1, MONTHS + 1))))
    out.update(_refs("weekday", _group([(d.weekday(), v) for d, v in rows], range(WEEKDAYS))))
    out.update(_refs("week_of_month", _group([((d.day - 1) // 7 + 1, v) for d, v in rows], range(1, WEEKS + 1))))
    out["heatmap"] = Ref(heatmap_flat(months), SOURCE)
    if inputs.get("bars"):
        out.update(_refs("intraday", _group(bucket_returns(inputs["bars"]), range(BUCKETS))))
    return out


P11_SEAS_REFERENCES = {"seasonality": seasonality_references}
