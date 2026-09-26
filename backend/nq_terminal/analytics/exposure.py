"""Exposure and costs of a Nautilus run (ANALYTICS_CATALOG.md section 9: EX1 to EX4). Descriptive only.

A `RunBook` holds what these functions need from one run: its instruments with their cost model, its totals and
its `trades`, `fills` and `strategy_log.snapshots` rows as the runs service serves them (sanitised: Decimal money
kept as strings, nanosecond times as ISO strings). `run_book` builds one from those rows; reading them through the
runs service (`load_book`) and the raw prices through the gate (`gated_raw_prices`) live in
`services/run_books.py`, so every function here is pure (ANALYTICS_CATALOG C8). Money is added up in `decimal`, so
the checks below are exact.

Cost model, read from the run (never assumed):
- `dtsmom` books: per instrument, tick value = `price_increment x multiplier` and cost per contract side =
  `cost_per_side` (venue), `ticks` from `data` (rule 11 of the spec: ticks x tick value + $2.50);
- sized books (`volmanaged`, `tsmom`, on MNQ): tick 0.25 points x `multiplier`, cost per side
  `data.cost_per_contract_side_usd` (fee $0.61 + ticks x $0.50, the venue's cost note), `ticks` from `data`;
- intraday runs (`za_orb`, `overnight`): one NQ contract per trade (USD 20 a point, tick 0.25), cost per side
  `venue.fee_per_contract_side_usd`, and no modelled slippage (the fill model's `prob_slippage` must be 0).
The fee per side is the cost per side less `ticks x tick value`; the rest is modelled slippage.

EX3 waterfall: gross = sum of (trade net P&L + trade commissions); commissions = sum of fee per side x sides;
modelled slippage = sum of ticks x tick value x sides; net = gross - commissions - modelled slippage. Sides are
the fills' quantities (two per one-contract trade when a run has no fills). Refused (`CostError`) unless every
fill's (or trade's) commission is exactly quantity x cost per side, commissions plus slippage equal `fees_total`,
and net equals `pnl_total` and `balance_check.delta_usd`.

EX4 ladder: `net(t) = gross - commissions - t x tick value x sides` for t = 0 to 4 ticks per side, with the fills
held fixed (linear), and the break-even t where it crosses zero. It passes through the run's own `pnl_total`.
The screens' own ladders (`cost_ladder`, `break_even_ticks_per_side`) are served by the research service.

EX1 exposure per snapshot (session): gross = sum |N_i x multiplier_i x px_i| / E_t, net = sum N_i x multiplier_i x
px_i / E_t, from the snapshots' `net_qty` and `equity`. The runs trade back-adjusted series, so the snapshot `px`
is back adjusted and would misstate the notional (volmanaged would seem to hold 4x against its 2x cap). px is
therefore the raw contract close: the sized books' own `strategy_log.closes[].raw`, or for dtsmom the 1d vendor
`c_none` through the gate (`services.run_books.gated_raw_prices`, caller "terminal", the `dtsmom_panel` as-of
rule). Only when neither is given is the snapshot price used, and `price_basis` then says so. Positions are rebuilt from cumulative fill
quantities as a second path; `positions_reconcile` says whether both agree.

EX2 turnover per session: one-way sum |dN_i| x multiplier_i x px_i / E_t, where dN_i is the session's net change
in position (roll trades that leave the position unchanged are not turnover), at the same price as EX1;
annualised as the mean x 252 (C2). `source="fills"` takes dN from the fills (each fill belongs to the first
snapshot at or after its time), `source="snapshots"` from snapshot differences; tests check both agree.

Runs without snapshots (intraday runs) have no exposure or turnover series (None).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

from nq_lab.calendar_effects import ECONOMICS, TICK
from nq_terminal.analytics._inputs import PERIODS_DAILY

__all__ = ["BookUnusable", "CostError", "ExposureError", "Instrument", "PRICE_RAW_GATE", "PRICE_RAW_RUN",
           "PRICE_SNAPSHOT", "RunBook", "TICK_LADDER", "cost_sensitivity", "cost_waterfall", "exposure",
           "instruments_of", "run_book", "sides", "turnover"]

TICK_LADDER = (0, 1, 2, 3, 4)
NQ_FAMILY = ("MNQ.XCME", "NQ.XCME")  # instruments on the NQ tick grid of 0.25 points
ONE_NQ = "NQ (one contract per trade)"
NQ_TICK = Decimal(repr(TICK))
NQ_POINT_VALUE = Decimal(repr(ECONOMICS["nq"][0]))
SIDE_SIGN = {"BUY": 1, "SELL": -1}
TURNOVER_SOURCES = ("fills", "snapshots")
WATERFALL_LABEL = ("Commissions are the fee per contract side; modelled slippage is ticks x tick value per "
                   "contract side, as the run's cost model charged it (za_orb and overnight runs model none).")
LADDER_LABEL = ("Net P&L if every contract side had cost t ticks of slippage, fills held fixed: "
                "net(t) = gross - commissions - t x tick value x contract sides.")
EXPOSURE_LABEL = "Notional at the session's close over the snapshot equity, per session"
TURNOVER_LABEL = "One-way notional of the session's net position change over equity, per session"
PRICE_RAW_RUN = "raw contract close recorded by the run (strategy_log.closes raw)"
PRICE_RAW_GATE = "raw contract close, 1d vendor c_none through the gate (caller terminal)"
PRICE_SNAPSHOT = "snapshot price, back adjusted: the notional is off by the roll adjustment"


class CostError(ValueError):
    """The run's costs, cost model or totals disagree with each other."""


class BookUnusable(CostError):
    """The run failed its balance check: it is unusable (rule 4) and gets no cost or exposure view."""


class ExposureError(ValueError):
    """Snapshots or fills cannot be put on one position grid."""


@dataclass(frozen=True)
class Instrument:
    name: str
    multiplier: Decimal
    tick_size: Decimal
    cost_per_side: Decimal
    ticks: int

    @property
    def tick_value(self) -> Decimal:
        return self.tick_size * self.multiplier

    @property
    def slippage_per_side(self) -> Decimal:
        return self.ticks * self.tick_value

    @property
    def fee_per_side(self) -> Decimal:
        return self.cost_per_side - self.slippage_per_side


@dataclass(frozen=True)
class RunBook:
    run_id: str
    strategy: str
    ticks: int
    starting_usd: float
    pnl_total: float
    fees_total: float
    delta_usd: float | None
    instruments: tuple[Instrument, ...]
    trades: tuple[Mapping[str, Any], ...]
    fills: tuple[Mapping[str, Any], ...]
    snapshots: tuple[Mapping[str, Any], ...]
    raw_closes: tuple[float | None, ...] = ()  # per snapshot, sized books only (strategy_log.closes raw)


# ---------------------------------------------------------------- reading a run


def _dec(value: Any, what: str) -> Decimal:
    """An exact decimal from a Decimal string, an int or a finite float (through its repr)."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise CostError(f"{what} is not a number ({value!r})")
    if isinstance(value, float) and not math.isfinite(value):
        raise CostError(f"{what} is not finite ({value!r})")
    try:
        number = Decimal(value if isinstance(value, str) else repr(value))
    except InvalidOperation as exc:
        raise CostError(f"{what} is not a number ({value!r})") from exc
    if not number.is_finite():
        raise CostError(f"{what} is not finite ({value!r})")
    return number


def _ticks(data: Mapping[str, Any], default: int | None = None) -> int:
    value = data.get("ticks", default)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CostError(f"the run records no valid ticks per side ({value!r})")
    return value


def _checked(inst: Instrument) -> Instrument:
    if inst.multiplier <= 0 or inst.tick_size <= 0 or inst.cost_per_side < 0 or inst.fee_per_side < 0:
        raise CostError(f"{inst.name}: the cost per side {inst.cost_per_side} is below its modelled slippage "
                        f"{inst.slippage_per_side}, or a multiplier or tick size is not positive")
    return inst


def _book_instruments(data: Mapping[str, Any], venue: Mapping[str, Any],
                      log_meta: Mapping[str, Any]) -> tuple[Instrument, ...]:
    ticks = _ticks(data)
    by_name = {}
    for row in venue["instruments"]:
        name = str(row.get("instrument"))
        by_name[name] = _checked(Instrument(name, _dec(row.get("multiplier"), f"{name} multiplier"),
                                            _dec(row.get("price_increment"), f"{name} price increment"),
                                            _dec(row.get("cost_per_side"), f"{name} cost per side"), ticks))
    order = list(log_meta.get("instruments") or by_name)
    if sorted(order) != sorted(by_name):
        raise CostError("the strategy log's instruments differ from the venue's instruments")
    return tuple(by_name[name] for name in order)


def _sized_instrument(data: Mapping[str, Any], venue: Mapping[str, Any]) -> Instrument:
    name = str(venue.get("instrument"))
    if name not in NQ_FAMILY:
        raise CostError(f"no tick size is known for {name}; expected one of {NQ_FAMILY}")
    cost = data.get("cost_per_contract_side_usd", venue.get("fee_per_contract_side_usd"))
    return _checked(Instrument(name, _dec(venue.get("multiplier"), "multiplier"), NQ_TICK,
                               _dec(cost, "cost per contract side"), _ticks(data)))


def _intraday_instrument(data: Mapping[str, Any], venue: Mapping[str, Any]) -> Instrument:
    model = venue.get("fill_model")
    slip = model.get("prob_slippage") if isinstance(model, Mapping) else None
    if slip not in (None, 0, 0.0):
        raise CostError(f"the fill model slips with probability {slip!r}; only a zero slippage model is known")
    return _checked(Instrument(ONE_NQ, NQ_POINT_VALUE, NQ_TICK,
                               _dec(venue.get("fee_per_contract_side_usd"), "fee per contract side"),
                               _ticks(data, default=0)))


def instruments_of(strategy: str | None, data: Mapping[str, Any], venue: Mapping[str, Any],
                   log_meta: Mapping[str, Any] | None = None) -> tuple[Instrument, ...]:
    """The run's instruments and cost model (see the module docstring)."""
    if isinstance(venue.get("instruments"), (list, tuple)):
        return _book_instruments(data, venue, log_meta or {})
    if venue.get("instrument"):
        return (_sized_instrument(data, venue),)
    if strategy not in ("za_orb", "overnight"):
        raise CostError(f"no cost model is known for strategy {strategy!r} without instruments")
    return (_intraday_instrument(data, venue),)


def _plain(row: Any) -> Mapping[str, Any]:
    return row.model_dump() if hasattr(row, "model_dump") else row


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _total(value: Any, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise CostError(f"the run records no {what}")
    return float(value)


def _raw_closes(snapshots: Sequence[Mapping[str, Any]], closes: Iterable[Any]) -> tuple[float | None, ...]:
    """The run's raw close for each snapshot session (None where the run recorded none)."""
    by_date = {}
    for row in (_plain(c) for c in closes):
        if _finite(row.get("raw")):
            by_date[str(row.get("date"))] = float(row["raw"])
    return tuple(by_date.get(str(s.get("date"))) for s in snapshots) if by_date else ()


def run_book(detail: Any, trades: Iterable[Any], fills: Iterable[Any], snapshots: Iterable[Any],
             closes: Iterable[Any] = ()) -> RunBook:
    """A `RunBook` from a run detail (the runs service's `RunDetail`) and its trade, fill, snapshot and close rows."""
    summary, check, venue = detail.summary, detail.balance_check or {}, detail.venue or {}
    instruments = instruments_of(summary.strategy, detail.data or {}, venue, detail.log_meta or {})
    starting = check.get("starting_usd", venue.get("starting_balance_usd"))
    delta = check.get("delta_usd")
    snaps = tuple(_plain(r) for r in snapshots)
    return RunBook(run_id=summary.run_id, strategy=str(summary.strategy), ticks=instruments[0].ticks,
                   starting_usd=_total(starting, "starting balance"), pnl_total=_total(summary.pnl_total, "pnl_total"),
                   fees_total=_total(summary.fees_total, "fees_total"),
                   delta_usd=None if delta is None else _total(delta, "delta_usd"), instruments=instruments,
                   trades=tuple(_plain(r) for r in trades), fills=tuple(_plain(r) for r in fills), snapshots=snaps,
                   raw_closes=_raw_closes(snaps, closes) if len(instruments) == 1 else ())


# ---------------------------------------------------------------- EX3 and EX4


def _qty(fill: Mapping[str, Any], number: int) -> int:
    value = fill.get("qty")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0 or float(value) != int(value):
        raise CostError(f"fill {number} has no positive whole quantity ({value!r})")
    return int(value)


def _fill_instrument(book: RunBook, fill: Mapping[str, Any], number: int) -> int:
    if len(book.instruments) == 1 and not fill.get("instrument"):
        return 0
    for index, inst in enumerate(book.instruments):
        if inst.name == fill.get("instrument"):
            return index
    raise CostError(f"fill {number} trades {fill.get('instrument')!r}, which the run does not list")


def _fill_sides(book: RunBook) -> tuple[list[int], Decimal]:
    counts, paid = [0] * len(book.instruments), Decimal(0)
    for number, fill in enumerate(book.fills):
        index, qty = _fill_instrument(book, fill, number), _qty(fill, number)
        commission = _dec(fill.get("commission"), f"fill {number} commission")
        expected = qty * book.instruments[index].cost_per_side
        if commission != expected:
            raise CostError(f"fill {number} commission {commission} is not quantity x cost per side ({expected})")
        counts[index] += qty
        paid += commission
    return counts, paid


def _trade_sides(book: RunBook) -> tuple[list[int], Decimal]:
    """Runs without fills: one contract per trade, two sides each."""
    (inst,) = book.instruments
    paid = Decimal(0)
    for number, trade in enumerate(book.trades):
        commission = _dec(trade.get("commissions_usd"), f"trade {number} commission")
        if commission != 2 * inst.cost_per_side:
            raise CostError(f"trade {number} commission {commission} is not two sides of {inst.cost_per_side}")
        paid += commission
    return [2 * len(book.trades)], paid


def sides(book: RunBook) -> dict[str, int]:
    """Contract sides traded per instrument (fills' quantities, or two per one-contract trade)."""
    counts, _ = _fill_sides(book) if book.fills else _trade_sides(book)
    return {inst.name: n for inst, n in zip(book.instruments, counts)}


def _gross(book: RunBook) -> Decimal:
    return sum((_dec(t.get("pnl_usd"), f"trade {i} pnl_usd") + _dec(t.get("commissions_usd"), f"trade {i} commission")
                for i, t in enumerate(book.trades)), Decimal(0))


def _require(ok: bool, what: str, ours: Decimal | float, stored: float | None) -> None:
    if not ok:
        raise CostError(f"the cost waterfall does not add up: {what} {stored!r} against {float(ours)!r}")


def _decompose(book: RunBook) -> dict[str, Any]:
    """Exact parts of the waterfall, checked against the run's own totals."""
    counts, paid = _fill_sides(book) if book.fills else _trade_sides(book)
    fees = sum((n * inst.fee_per_side for inst, n in zip(book.instruments, counts)), Decimal(0))
    per_tick = sum((n * inst.tick_value for inst, n in zip(book.instruments, counts)), Decimal(0))
    slippage = book.ticks * per_tick
    gross = _gross(book)
    net = gross - fees - slippage
    _require(fees + slippage == paid, "commissions plus slippage differ from the commissions paid, fees_total",
             fees + slippage, float(paid))
    _require(float(paid) == book.fees_total, "fees_total", paid, book.fees_total)
    _require(float(net) == book.pnl_total, "pnl_total", net, book.pnl_total)
    _require(book.delta_usd is None or float(net) == book.delta_usd, "delta_usd", net, book.delta_usd)
    return {"counts": counts, "paid": paid, "fees": fees, "per_tick": per_tick, "slippage": slippage,
            "gross": gross, "net": net}


def _by_instrument(book: RunBook, counts: Sequence[int]) -> list[dict]:
    return [{"instrument": inst.name, "sides": n, "commissions": float(n * inst.fee_per_side),
             "slippage": float(n * inst.slippage_per_side)} for inst, n in zip(book.instruments, counts) if n]


def cost_waterfall(book: RunBook) -> dict:
    """EX3: gross, commissions, modelled slippage and net, exact; `CostError` if they do not add up."""
    part = _decompose(book)
    gross, fees, slip, net = (float(part[k]) for k in ("gross", "fees", "slippage", "net"))
    return {"run_id": book.run_id, "unit": "USD", "label": WATERFALL_LABEL, "ticks": book.ticks,
            "sides": int(sum(part["counts"])), "gross": gross, "commissions": fees, "slippage": slip, "net": net,
            "costs_total": float(part["paid"]),
            "rows": [{"step": "gross", "value": gross}, {"step": "commissions", "value": -fees},
                     {"step": "modelled slippage", "value": -slip}, {"step": "net", "value": net}],
            "by_instrument": _by_instrument(book, part["counts"])}


def cost_sensitivity(book: RunBook, ticks: Sequence[int] = TICK_LADDER) -> dict:
    """EX4: net P&L against ticks per side, linear with the fills held fixed, and the break-even point."""
    part = _decompose(book)
    before = part["gross"] - part["fees"]
    net = [float(before - t * part["per_tick"]) for t in ticks]
    per_tick = float(part["per_tick"])
    return {"run_id": book.run_id, "unit": "USD", "label": LADDER_LABEL, "run_ticks": book.ticks,
            "ticks": list(ticks), "net_usd": net, "net_pct_of_k": [v / book.starting_usd for v in net],
            "cost_per_tick_usd": per_tick,
            "break_even_ticks_per_side": float(before / part["per_tick"]) if part["per_tick"] else math.nan}


# ---------------------------------------------------------------- EX1 and EX2


def _row_vector(snap: Mapping[str, Any], key: str, width: int, number: int) -> list[float]:
    value = snap.get(key)
    values = list(value) if isinstance(value, (list, tuple)) else [value]
    if len(values) != width or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
        raise ExposureError(f"snapshot {number} has no {width} numeric {key} values")
    return [float(v) for v in values]


def _equity(snap: Mapping[str, Any], number: int) -> float:
    value = snap.get("equity_float", snap.get("equity"))
    try:
        number_value = float(value)
    except (TypeError, ValueError) as exc:
        raise ExposureError(f"snapshot {number} has no equity") from exc
    if not math.isfinite(number_value) or number_value <= 0:
        raise ExposureError(f"snapshot {number} equity is not positive ({value!r})")
    return number_value


def _grid(book: RunBook) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(positions, prices, equity) on the snapshot sessions."""
    width = len(book.instruments)
    qty = np.array([_row_vector(s, "net_qty", width, i) for i, s in enumerate(book.snapshots)], dtype=float)
    px = np.array([_row_vector(s, "px", width, i) for i, s in enumerate(book.snapshots)], dtype=float)
    equity = np.array([_equity(s, i) for i, s in enumerate(book.snapshots)], dtype=float)
    return qty.reshape(-1, width), px.reshape(-1, width), equity


def _ns(stamps: Sequence[Any], what: str) -> np.ndarray:
    try:
        return pd.DatetimeIndex(pd.to_datetime(list(stamps), utc=True)).asi8
    except (TypeError, ValueError) as exc:
        raise ExposureError(f"{what} times are not ISO timestamps") from exc


def _fill_deltas(book: RunBook) -> tuple[np.ndarray, int]:
    """Net signed fill quantity per snapshot session and instrument, and the count of fills after the last one."""
    deltas = np.zeros((len(book.snapshots), len(book.instruments)), dtype=np.int64)
    if not book.fills:
        return deltas, 0
    slot = np.searchsorted(_ns([s.get("ts") for s in book.snapshots], "snapshot"),
                           _ns([f.get("ts") for f in book.fills], "fill"), side="left")
    late = 0
    for number, (fill, row) in enumerate(zip(book.fills, slot)):
        sign = SIDE_SIGN.get(str(fill.get("side")))
        if sign is None:
            raise ExposureError(f"fill {number} has side {fill.get('side')!r}, not BUY or SELL")
        if row >= len(book.snapshots):
            late += 1
            continue
        deltas[row, _fill_instrument(book, fill, number)] += sign * _qty(fill, number)
    return deltas, late


def _prices(book: RunBook, snapshot_px: np.ndarray, raw_px: np.ndarray | None) -> tuple[str, np.ndarray]:
    """(price basis, price grid): the given raw prices, else the run's raw closes, else the snapshot price."""
    if raw_px is not None:
        grid = np.asarray(raw_px, dtype=float)
        if grid.shape != snapshot_px.shape:
            raise ExposureError(f"raw prices of shape {grid.shape} do not fit the snapshot grid {snapshot_px.shape}")
        return PRICE_RAW_GATE, grid
    raw = book.raw_closes
    if raw and len(raw) == len(book.snapshots) and all(v is not None for v in raw):
        return PRICE_RAW_RUN, np.asarray(raw, dtype=float).reshape(-1, 1)
    return PRICE_SNAPSHOT, snapshot_px


def _notional(qty: np.ndarray, mult: np.ndarray, px: np.ndarray) -> np.ndarray:
    """N x multiplier x px, zero where nothing is held (a missing price is allowed there, nowhere else)."""
    held = qty != 0
    if np.any(held & ~np.isfinite(px)):
        raise ExposureError("a held position has no finite price")
    return np.where(held, qty * mult * np.where(np.isfinite(px), px, 0.0), 0.0)


def _multipliers(book: RunBook) -> np.ndarray:
    return np.array([float(inst.multiplier) for inst in book.instruments], dtype=float)


def _dates(book: RunBook) -> list[str]:
    return [str(s.get("date")) for s in book.snapshots]


def exposure(book: RunBook, raw_px: np.ndarray | None = None) -> dict | None:
    """EX1: gross and net exposure per session, per instrument held, and the fills-against-snapshots check."""
    if not book.snapshots:
        return None
    qty, snapshot_px, equity = _grid(book)
    basis, px = _prices(book, snapshot_px, raw_px)
    notional = _notional(qty, _multipliers(book), px)
    deltas, late = _fill_deltas(book)
    reconcile = late == 0 and bool(np.array_equal(np.cumsum(deltas, axis=0), qty))
    held = {inst.name: (np.abs(notional[:, i]) / equity).tolist()
            for i, inst in enumerate(book.instruments) if np.any(qty[:, i] != 0)}
    gross, net = np.abs(notional).sum(axis=1) / equity, notional.sum(axis=1) / equity
    return {"run_id": book.run_id, "basis": "B", "unit": "notional over equity", "label": EXPOSURE_LABEL,
            "price_basis": basis, "date": _dates(book), "gross": gross.tolist(), "net": net.tolist(),
            "by_instrument": held, "mean_gross": float(gross.mean()), "mean_net": float(net.mean()),
            "positions_reconcile": reconcile}


def turnover(book: RunBook, source: str = "fills", raw_px: np.ndarray | None = None) -> dict | None:
    """EX2: one-way turnover per session and its annualised mean (x 252)."""
    if source not in TURNOVER_SOURCES:
        raise ValueError(f"source must be one of {TURNOVER_SOURCES}, got {source!r}")
    if not book.snapshots:
        return None
    qty, snapshot_px, equity = _grid(book)
    basis, px = _prices(book, snapshot_px, raw_px)
    if source == "fills":
        deltas, late = _fill_deltas(book)
        if late:
            raise ExposureError(f"{late} fills fall after the last snapshot")
    else:
        deltas = np.diff(qty, axis=0, prepend=np.zeros((1, qty.shape[1])))
    daily = np.abs(_notional(deltas, _multipliers(book), px)).sum(axis=1) / equity
    return {"run_id": book.run_id, "basis": "B", "unit": "notional traded over equity", "label": TURNOVER_LABEL,
            "source": source, "price_basis": basis, "periods": PERIODS_DAILY, "date": _dates(book),
            "daily": daily.tolist(),
            "mean_daily": float(daily.mean()), "annualised": float(daily.mean() * PERIODS_DAILY)}
