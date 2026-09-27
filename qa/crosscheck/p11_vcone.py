"""Reference values for VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised),
dumped as `vcone` bundles by `terminal/backend/tests/test_vcone_dump_for_qa.py`.

Inputs: the session dates, the universe's daily returns r (`dB / (N - dB)`), the horizons, the percentiles and the
minimum number of windows. The terminal rolls with pandas and takes numpy's linear percentiles; this reference uses
the standard library only: `log1p(r)` (undefined where r is missing or `1 + r <= 0`), then window by window the
sample sd (`statistics.stdev`) of each run of h consecutive defined log returns times sqrt(252), and
`statistics.quantiles(method="inclusive")`, the same linear rule as numpy's default, over those values.

Keys, per horizon h: `h<h>.n`, `h<h>.min`, `h<h>.p<q>`, `h<h>.max`, `h<h>.latest` (the window ending on the last
session, None when it is not full) and `h<h>.latest_rank` (percent of windows at or below the latest).
"""
from __future__ import annotations

import math
import statistics

from crosscheck.reference import Ref

SESSIONS_PER_YEAR = 252
SOURCE = ("stdlib: statistics.stdev of each full window of log1p(r) x sqrt(252), window by window; "
          "statistics.quantiles(n=100, method='inclusive')")


def log_returns(r: list) -> list[float]:
    out = []
    for v in r:
        x = math.nan if v is None else float(v)
        out.append(math.log1p(x) if math.isfinite(x) and x > -1.0 else math.nan)
    return out


def windows(logs: list[float], h: int) -> list[float | None]:
    """One value per session: the annualised sd of the h log returns ending there, None unless all are defined."""
    out: list[float | None] = []
    for i in range(len(logs)):
        seg = logs[i - h + 1:i + 1] if i >= h - 1 else []
        full = len(seg) == h and all(math.isfinite(x) for x in seg)
        out.append(statistics.stdev(seg) * math.sqrt(SESSIONS_PER_YEAR) if full else None)
    return out


def cone_stats(line: list[float | None], percentiles: list[int], min_windows: int) -> dict:
    values = [v for v in line if v is not None]
    latest = line[-1] if line else None
    stats: dict = {"n": len(values), "latest": latest}
    empty = len(values) < max(min_windows, 2)
    cuts = None if empty else statistics.quantiles(values, n=100, method="inclusive")
    stats["min"] = None if empty else min(values)
    stats["max"] = None if empty else max(values)
    for q in percentiles:
        stats[f"p{q}"] = None if empty else cuts[q - 1]
    rank = None if empty or latest is None else 100.0 * sum(1 for v in values if v <= latest) / len(values)
    stats["latest_rank"] = rank
    return stats


def vcone_references(inputs: dict) -> dict:
    logs = log_returns(list(inputs["r"]))
    percentiles = [int(q) for q in inputs["percentiles"]]
    refs = {}
    for h in (int(x) for x in inputs["horizons"]):
        stats = cone_stats(windows(logs, h), percentiles, int(inputs["min_windows"]))
        refs.update({f"h{h}.{key}": Ref(value, SOURCE) for key, value in stats.items()})
    return refs


P11_VCONE_INPUTS = {"vcone": ("dates", "r", "horizons", "percentiles", "min_windows")}
P11_VCONE_REFERENCES = {"vcone": vcone_references}
