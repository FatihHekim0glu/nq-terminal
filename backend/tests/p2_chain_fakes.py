"""Synthetic calendar chains for the MV6 tests (TASKS Phase 12) and a fake serve that knows them.

`chain_loader(root, rank)` builds `<ROOT>.C.<rank>` 1d rows as the carry round's processed files hold them: `ts`
(00:00 UTC of each weekday), unadjusted `o h l c`, volume `v`, `instrument_id` and the `contract` key ("NQH2015"). The
chain rolls on the pinned CME last trading day (C.0 is the nearest contract not yet expired, C.1 the next), so the
tests check the terminal's expiries against the same table the rows were built from, and the carry against numbers
built from the rows alone. Prices follow a known carry: every contract trades at `spot x (1 - CARRY x years to
expiry)`, so the front to next carry is close to CARRY and positive (backwardation). A planted bar with an empty key
and a thin bar exercise the void counts.

`ChainServe` answers `<ROOT>.C.k` symbols through `oos_gate.serve_bars` with a temporary log (the real serve is never
called) and hands every other symbol to the shared fake serve.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

from nq_lab import carry_expiry, oos_gate

from fakes import FakeServe, checked_log_path
from research_guard import TEST_MARKER

CARRY = 0.02  # a year, positive: every later contract trades lower
QUARTERS = {"NQ": (3, 6, 9, 12), "ZN": (3, 6, 9, 12), "CL": tuple(range(1, 13))}
LEVEL = {"NQ": 2000.0, "ZN": 120.0, "CL": 80.0}
RANKS = {"NQ": (0, 1, 2), "ZN": (0, 1), "CL": (0, 1, 2, 3)}
FIRST = pd.Timestamp("2010-09-01", tz="UTC")
LAST = pd.Timestamp("2022-01-15", tz="UTC")  # a few bars past the fence; the gate never serves them
THIN_DAY = "2015-06-01"
UNRESOLVED_DAY = "2016-02-01"


def _contracts(root: str) -> list[tuple[str, dt.date]]:
    out = []
    for year in range(2010, 2024):
        for month in QUARTERS[root]:
            key = f"{root}{carry_expiry.MONTH_CODES[month - 1]}{year}"
            out.append((key, carry_expiry.last_trading_day(root, year, month)))
    return sorted(out, key=lambda kv: kv[1])


def chain_rows(root: str, rank: int) -> pd.DataFrame:
    days = pd.bdate_range(FIRST, LAST, tz="UTC")
    contracts = _contracts(root)
    expiries = np.array([np.datetime64(e, "D") for _, e in contracts])
    day_d = days.tz_localize(None).to_numpy(dtype="datetime64[D]")
    first = np.searchsorted(expiries, day_d, side="left")  # the nearest contract expiring on or after the day
    pick = first + rank
    keys = [contracts[i][0] for i in pick]
    years = (expiries[pick] - day_d).astype(float) / 365.25
    step = np.arange(len(days))
    spot = LEVEL[root] * (1.0 + 0.3 * step / len(days) + 0.02 * np.sin(step / 37.0))
    close = spot * (1.0 - CARRY * years)
    volume = np.where(rank == 0, 200_000.0, 20_000.0 / (rank + 1)) + (step % 7) * 10.0
    frame = pd.DataFrame({"ts": days, "o": close, "h": close * 1.002, "l": close * 0.998, "c": close, "v": volume,
                          "instrument_id": 1000 * (rank + 1) + pick, "contract": keys})
    dates = days.strftime("%Y-%m-%d")
    frame.loc[dates == THIN_DAY, "v"] = 3.0
    if rank == 1:
        frame.loc[dates == UNRESOLVED_DAY, "contract"] = ""
    return frame


def chain_loader(root: str, rank: int):
    if root not in RANKS or rank not in RANKS[root]:
        raise FileNotFoundError(f"no processed series {root}.C.{rank} 1d vendor")
    rows = chain_rows(root, rank)

    def load(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
        return rows.loc[(rows["ts"] >= start) & (rows["ts"] < end)].reset_index(drop=True)

    return load


def parse_chain(symbol: str) -> tuple[str, int] | None:
    parts = symbol.split(".")
    if len(parts) == 3 and parts[1] == "C" and parts[2].isdigit():
        return parts[0], int(parts[2])
    return None


class ChainServe:
    """Callable like `nq_lab.data.serve`; chain symbols through the gate with a temporary log, the rest to `base`."""

    def __init__(self, log_path: Path, base: FakeServe):
        self.log_path = checked_log_path(log_path)
        self.base = base
        self.chain_calls: tuple[str, ...] = ()

    def __call__(self, start: pd.Timestamp, end: pd.Timestamp, *, caller: str, reason: str, symbol: str = "NQ.V.0",
                 timeframe: str = "1m", variant: str = "vendor") -> pd.DataFrame:
        chain = parse_chain(symbol)
        if chain is None:
            return self.base(start, end, caller=caller, reason=reason, symbol=symbol, timeframe=timeframe,
                             variant=variant)
        loader = chain_loader(*chain)
        self.chain_calls = (*self.chain_calls, symbol)
        source = {"symbol": symbol, "timeframe": timeframe, "variant": variant, "test": TEST_MARKER}
        return oos_gate.serve_bars(start, end, caller=caller, reason=reason, loader=loader, log_path=self.log_path,
                                   source=source)
