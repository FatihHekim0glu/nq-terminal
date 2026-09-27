"""Reference values for the market views dumped as `market` bundles (MV3, GP's RV22 line).

The terminal rolls the daily universe returns with pandas (`rolling(window, min_periods=2).std(ddof=1)`); the
reference walks the windows one by one with numpy: for each session, the finite returns among the last `window`
ones, the sample sd (ddof 1) when there are at least two, times sqrt(252). The last value is compared both with the
line's own last value and with the universe table's realised volatility at the same window (`rv_last@universe`).
"""
from __future__ import annotations

import math

import numpy as np

from crosscheck.reference import Ref

SESSIONS_PER_YEAR = 252
MIN_VALUES = 2


def rolling_rv(r: np.ndarray, window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(r)):
        seg = r[max(0, i - window + 1):i + 1]
        seg = seg[np.isfinite(seg)]
        out.append(float(np.std(seg, ddof=1)) * math.sqrt(SESSIONS_PER_YEAR) if len(seg) >= MIN_VALUES else None)
    return out


def market_references(inputs: dict) -> dict:
    r = np.array([math.nan if v is None else float(v) for v in inputs["r"]], dtype=float)
    line = rolling_rv(r, int(inputs["window"]))
    last = next((v for v in reversed(line) if v is not None), None)
    source = "numpy sd(ddof=1) of the finite returns in each window x sqrt(252), window by window"
    return {"rv": Ref(line, source), "rv_last": Ref(last, source)}
