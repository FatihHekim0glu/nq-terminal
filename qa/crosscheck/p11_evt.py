"""Reference values for the event study (EVT, TASKS Phase 11), recomputed independently with pandas.

Bundle kind `evt`, written by `terminal/backend/tests/test_events_dump_for_qa.py` (prefix `nqt_p11_evt_`). Inputs:
- daily: `mode` "daily", `dates` (NYSE sessions, ISO), `r` (the served daily r, null where undefined), `stale`
  (bools), `events` (ISO dates), `pre`, `post`;
- intraday: `mode` "intraday", `events` (each `{t0, ts, raw_c, instrument_id}`, bars stamped at the open, UTC),
  `pre`, `post`, `max_stale` (minutes).

The references do not follow the terminal's code path:
- daily paths are differences of one running sum over the whole series, `S[e + k] - S[e - 1]`, on complete windows
  (every return from e - pre + 1 to e + post defined and no stale close from e - pre to e + post); the terminal sums
  each window directly;
- intraday prices come from `pandas.merge_asof` (backward, with the staleness tolerance) on the minute grid, where
  the terminal searches the sorted stamps with numpy;
- the band uses pandas `DataFrame.mean` and `DataFrame.sem` (ddof 1), mean -/+ 1.96 sem; the end statistics pandas
  `median`, `std` and a mean of the positive flags.
All are exact definitions (compared at 1e-9 relative). No p-value is referenced: the terminal computes none.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from crosscheck.reference import Ref

BAND_Z = 1.96
SRC_DAILY = "pandas running sum S[e+k] - S[e-1] on complete windows"
SRC_INTRADAY = "pandas merge_asof (backward, tolerance max_stale) on the minute grid"
NS_UTC = "datetime64[ns, UTC]"
SRC_BAND = "pandas DataFrame.mean and DataFrame.sem (ddof 1), mean -/+ 1.96 sem"


def _floats(values) -> np.ndarray:
    return np.array([math.nan if v is None else float(v) for v in values], dtype=float)


def daily_paths(inputs: dict) -> list[list[float]]:
    dates = [str(d)[:10] for d in inputs["dates"]]
    r = pd.Series(_floats(inputs["r"]))
    stale = pd.Series([bool(x) for x in inputs["stale"]])
    pre, post = int(inputs["pre"]), int(inputs["post"])
    running = r.fillna(0.0).cumsum()
    where = {d: i for i, d in enumerate(dates)}
    out = []
    for day in inputs["events"]:
        e = where.get(str(day)[:10])
        if e is None or e - pre < 0 or e + post >= len(dates):
            continue
        if stale.iloc[e - pre:e + post + 1].any() or r.iloc[e - pre + 1:e + post + 1].isna().any():
            continue
        base = running.iloc[e - 1] if e >= 1 else 0.0
        out.append([float(running.iloc[e + k] - base) for k in range(-pre, post + 1)])
    return out


def intraday_paths(inputs: dict) -> list[list[float]]:
    pre, post = int(inputs["pre"]), int(inputs["post"])
    tolerance = pd.Timedelta(minutes=int(inputs["max_stale"]))
    out = []
    for event in inputs["events"]:
        t0 = pd.Timestamp(event["t0"])
        t0 = t0.tz_localize("UTC") if t0.tzinfo is None else t0.tz_convert("UTC")
        stamps = pd.to_datetime(pd.Series(event["ts"], dtype=object), utc=True).astype(NS_UTC)
        bars = pd.DataFrame({"ts": stamps, "px": _floats(event["raw_c"]),
                             "iid": [int(x) for x in event["instrument_id"]]}).sort_values("ts")
        minutes = [t0 + pd.Timedelta(minutes=m - 1) for m in range(-pre, post + 1)]
        grid = pd.DataFrame({"at": pd.Series(minutes).astype(NS_UTC)})
        joined = pd.merge_asof(grid, bars, left_on="at", right_on="ts", direction="backward", tolerance=tolerance)
        if joined["px"].isna().any() or joined["iid"].nunique() != 1:
            continue
        p0 = joined["px"].iloc[pre]
        out.append((joined["px"] / p0 - 1.0).tolist())
    return out


def band_references(paths: list[list[float]], width: int, src: str) -> dict:
    frame = pd.DataFrame(paths, columns=range(width)) if paths else pd.DataFrame(columns=range(width), dtype=float)
    n = len(frame)
    mean = frame.mean(axis=0)
    sem = frame.sem(axis=0, ddof=1) if n >= 2 else pd.Series([math.nan] * width)
    end = frame.iloc[:, -1] if n else pd.Series([], dtype=float)
    return {
        "n_used": Ref(float(n), src),
        "mean": Ref(mean.tolist(), SRC_BAND),
        "se": Ref(sem.tolist(), SRC_BAND),
        "lower": Ref((mean - BAND_Z * sem).tolist(), SRC_BAND),
        "upper": Ref((mean + BAND_Z * sem).tolist(), SRC_BAND),
        "end_values": Ref(end.tolist(), src),
        "end_mean": Ref(float(end.mean()) if n else math.nan, SRC_BAND),
        "end_median": Ref(float(end.median()) if n else math.nan, "pandas median"),
        "end_sd": Ref(float(end.std(ddof=1)) if n > 1 else math.nan, "pandas std (ddof 1)"),
        "end_se": Ref(float(end.sem(ddof=1)) if n > 1 else math.nan, SRC_BAND),
        "end_share_positive": Ref(float((end > 0).mean()) if n else math.nan, "pandas mean of end > 0"),
    }


def evt_references(inputs: dict) -> dict:
    pre, post = int(inputs["pre"]), int(inputs["post"])
    if inputs["mode"] == "daily":
        return band_references(daily_paths(inputs), pre + post + 1, SRC_DAILY)
    return band_references(intraday_paths(inputs), pre + post + 1, SRC_INTRADAY)


P11_EVT_REFERENCES = {"evt": evt_references}
P11_EVT_INPUTS = {"evt": ("mode", "events", "pre", "post")}
