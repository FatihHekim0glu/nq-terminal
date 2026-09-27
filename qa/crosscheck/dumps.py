"""Read and validate the JSON dumps written by `terminal/backend/tests/test_dump_for_qa.py`.

Schema `nqt-qa-dump/1`. Two kinds:

- `series`: one return series (and optional benchmark) with the values each implementation computed.
  `values` maps a side (`ours` = the terminal's `nq_terminal.analytics`, `nq_lab` = the existing nq_lab
  helper, `nautilus` = the Nautilus pyo3 statistic on a session index, `stored` = a value stored in a result
  file) to `{metric: value}`. `missing` maps a metric to the reason `ours` could not be computed.
- `registry`: the registered p values of `results/registry.csv` with the stored and computed adjustments.
- `trades` and `costs` (a `Bundle`): one Nautilus run's raw rows in `inputs` (per-trade net P&L and entry
  times; or the cost model, trade and fill money as decimal strings and the snapshot grid) with the values
  each implementation computed for TA1 and TA3, or EX1 to EX4.
- `market` (a `Bundle`): a market view's inputs (MV3: the session dates, the daily universe returns and the window)
  with the line the terminal serves.
- P1 bundles (`p1series`, `bootstrap`, `deflated`, `paths`, `regimes`, `stress`, `tracking`): the raw inputs of the
  Phase 10 metrics with the terminal's values (and Nautilus's where one exists); references in `p1_reference.py`.
- P11 bundles (`vcone`, `seasonality`, `evt`, `roll`, `dq_sidecar`, `dq_nq`, `guards`): the raw inputs of the
  Phase 11 screens with the terminal's values; references in `p11_*.py`.

This module only reads. It never imports the backend (ARCHITECTURE section 11).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

SCHEMA = "nqt-qa-dump/1"
SIDES = ("ours", "nq_lab", "nautilus", "stored")
BASES = ("A", "B")
BUNDLE_INPUTS = {"trades": ("pnl", "entry_ts"),
                 "costs": ("instruments", "ticks", "trade_pnl", "trade_commission", "fills", "snapshots"),
                 "market": ("dates", "r", "window"),
                 # P1 (TASKS Phase 10), written by terminal/backend/tests/test_dump_for_qa_p1.py
                 "p1series": ("dates", "r", "bench", "basis", "periods", "on_capital"),
                 "bootstrap": ("r", "basis", "periods", "on_capital", "seed", "reps", "horizon", "confidence"),
                 "deflated": ("trials", "paper"), "paths": ("trades", "all_trades", "bars", "point_value", "tick"),
                 "regimes": ("dates", "r", "rv_dates", "rv", "min_history"),
                 "stress": ("dates", "r", "bench", "basis", "windows"), "tracking": ("rows", "multiplier"),
                 # Phase 11 (the p11_*.py references; writers in terminal/backend/tests/test_*dump*p11* and
                 # test_*_dump_for_qa.py)
                 "vcone": ("dates", "r", "horizons", "percentiles", "min_windows"),
                 "seasonality": ("dates", "r", "aggregation"),
                 "evt": ("mode", "events", "pre", "post"),
                 "roll": ("dates", "t", "instrument_id", "offset", "c_none", "qa_rolls_total"),
                 "dq_sidecar": ("status", "fence", "sessions"), "dq_nq": ("fence", "sessions", "rejected", "still"),
                 "guards": ("groups", "records")}


class DumpError(ValueError):
    """A dump that does not follow the schema."""


@dataclass(frozen=True)
class Case:
    name: str
    source: str
    basis: str
    periods: int
    dates: pd.DatetimeIndex
    r: np.ndarray
    bench: np.ndarray | None
    values: dict = field(default_factory=dict)
    missing: dict = field(default_factory=dict)
    inputs: dict = field(default_factory=dict)

    @property
    def series(self) -> pd.Series:
        return pd.Series(self.r, index=self.dates)


@dataclass(frozen=True)
class RegistryDump:
    name: str
    source: str
    names: tuple
    p: np.ndarray
    values: dict = field(default_factory=dict)
    missing: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Bundle:
    name: str
    kind: str
    source: str
    inputs: dict
    values: dict = field(default_factory=dict)
    missing: dict = field(default_factory=dict)


def _require(doc: dict, key: str):
    if key not in doc:
        raise DumpError(f"dump {doc.get('case', '?')!r} has no {key!r}")
    return doc[key]


def _floats(values, what: str) -> np.ndarray:
    try:
        arr = np.array([math.nan if v is None else float(v) for v in values], dtype=float)
    except (TypeError, ValueError) as exc:
        raise DumpError(f"{what} holds a non-numeric value: {exc}") from exc
    return arr


def _check_header(doc: dict, kind: str) -> None:
    if doc.get("schema") != SCHEMA:
        raise DumpError(f"schema {doc.get('schema')!r} is not {SCHEMA!r}")
    if doc.get("kind", "series") != kind:
        raise DumpError(f"dump {doc.get('case')!r} is a {doc.get('kind')!r}, not a {kind!r}")


def _values(doc: dict) -> dict:
    values = doc.get("values") or {}
    unknown = set(values) - set(SIDES)
    if unknown:
        raise DumpError(f"unknown value sides {sorted(unknown)} in {doc.get('case')!r}")
    return {side: dict(values.get(side) or {}) for side in SIDES}


def parse_case(doc: dict) -> Case:
    _check_header(doc, "series")
    basis, periods = _require(doc, "basis"), int(_require(doc, "periods"))
    if basis not in BASES:
        raise DumpError(f"basis {basis!r} is not one of {BASES}")
    r = _floats(_require(doc, "r"), "r")
    dates = pd.DatetimeIndex(pd.to_datetime(_require(doc, "dates")))
    if len(dates) != len(r) or len(r) < 3:
        raise DumpError(f"{doc.get('case')!r}: {len(dates)} dates for {len(r)} returns (need equal and >= 3)")
    if not np.all(np.isfinite(r)):
        raise DumpError(f"{doc.get('case')!r}: r holds NaN or infinite values")
    bench = doc.get("bench")
    bench = None if bench is None else _floats(bench, "bench")
    if bench is not None and len(bench) != len(r):
        raise DumpError(f"{doc.get('case')!r}: benchmark length {len(bench)} differs from r {len(r)}")
    return Case(name=str(_require(doc, "case")), source=str(doc.get("source", "")), basis=basis,
                periods=periods, dates=dates, r=r, bench=bench, values=_values(doc),
                missing=dict(doc.get("missing") or {}), inputs=dict(doc.get("inputs") or {}))


def parse_registry(doc: dict) -> RegistryDump:
    _check_header(doc, "registry")
    names, p = _require(doc, "names"), _floats(_require(doc, "p"), "p")
    if len(names) != len(p) or not np.all((p >= 0) & (p <= 1)):
        raise DumpError("registry dump: names and p differ in length or a p lies outside [0, 1]")
    return RegistryDump(name=str(_require(doc, "case")), source=str(doc.get("source", "")), names=tuple(names),
                        p=p, values=_values(doc), missing=dict(doc.get("missing") or {}))


def parse_bundle(doc: dict) -> Bundle:
    kind = doc.get("kind")
    if kind not in BUNDLE_INPUTS:
        raise DumpError(f"dump {doc.get('case')!r} is a {kind!r}, not one of {sorted(BUNDLE_INPUTS)}")
    _check_header(doc, kind)
    inputs = _require(doc, "inputs")
    absent = [key for key in BUNDLE_INPUTS[kind] if key not in (inputs or {})]
    if absent:
        raise DumpError(f"{kind} dump {doc.get('case')!r} lacks inputs {absent}")
    if kind == "trades" and (len(inputs["pnl"]) != len(inputs["entry_ts"]) or not len(inputs["pnl"])):
        raise DumpError(f"trades dump {doc.get('case')!r}: {len(inputs['pnl'])} P&Ls for "
                        f"{len(inputs['entry_ts'])} entry times (need equal and >= 1)")
    if kind == "market" and (len(inputs["dates"]) != len(inputs["r"]) or int(inputs["window"]) < 2):
        raise DumpError(f"market dump {doc.get('case')!r}: {len(inputs['dates'])} dates for {len(inputs['r'])} "
                        "returns, or a window below 2")
    if kind == "trades" and not np.all(np.isfinite(_floats(inputs["pnl"], "pnl"))):
        raise DumpError(f"trades dump {doc.get('case')!r}: pnl holds NaN or infinite values")
    return Bundle(name=str(_require(doc, "case")), kind=kind, source=str(doc.get("source", "")), inputs=dict(inputs),
                  values=_values(doc), missing=dict(doc.get("missing") or {}))


def parse_any(doc: dict):
    kind = doc.get("kind", "series")
    if kind == "registry":
        return parse_registry(doc)
    return parse_bundle(doc) if kind in BUNDLE_INPUTS else parse_case(doc)


def read_dir(folder: Path) -> list:
    """Every `*.json` dump in `folder`, parsed, in name order."""
    return [parse_any(json.loads(path.read_text(encoding="utf-8"))) for path in sorted(folder.glob("*.json"))]
