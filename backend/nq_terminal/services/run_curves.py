"""The equity curve's own view of a result.json (02 section 4.1 item 3, decided: the first launch; 04 D3.4; T3).

The curve (`runs.snapshot_curve`, `runs.realised_curve`) reads two fields of a trade and six of a snapshot. The parsers
here keep only those fields of each row (with `<field>_float`, which `runs._money` reads first, and the key the
sanitiser derives a read field from when the row lacks the read field itself), then sanitise and freeze the cut rows in
one pass. So a cold ledger (its anchor pairs need each side's Sharpe) or an equity line no longer sanitises a whole
strategy log: on the real lab the cold ledger fell from 2.1 to 2.3 s to a fraction of that, the main cost of a first
launch's HOME. Each kept value, and each key the sanitiser adds, is exactly what the whole section gives
(tests/test_runs_ledger_first_launch.py compares both on every fixture run, on edge rows and on the real lab's ledger).

Pure functions of the file's bytes: no I/O, no price read; the FileCache in runs.py does the reading.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping

from nq_terminal.services.files import (
    DECIMAL_STRING,
    EPOCH_SUFFIX,
    FLOAT_SUFFIX,
    JS_MAX_SAFE_INT,
    FrozenDict,
    freeze,
    sanitise,
)


try:  # in the lab's lock as a dependency of the pinned stack; without it the standard decoder reads alone
    import orjson as _fast
except ImportError:  # pragma: no cover - the lock carries it
    _fast = None

_INT64_SPAN = 2**63  # orjson keeps integers inside 64 bits exact and turns a wider one into a float at least this large


def load_object(raw: bytes) -> dict[str, Any]:
    """result.json as a dict through the standard decoder; ValueError (the FileCache retries once) when it is not a
    JSON object."""
    return _as_object(json.loads(raw.decode("utf-8")))


def _as_object(doc: Any) -> dict[str, Any]:
    if not isinstance(doc, dict):
        raise ValueError("result.json is not a JSON object")
    return doc


def kept_from(raw: bytes, keep: Callable[[dict[str, Any]], Any]) -> Any:
    """`keep(doc)` for result.json, decoded by orjson (about twice as fast on a 6.6 MB file) when what `keep` returns is
    exactly what the standard decoder would give, else by the standard decoder. orjson refuses the NaN and Infinity
    tokens a Python writer leaves (the standard decoder then reads them) and turns an integer wider than 64 bits into a
    float of magnitude at least 2**63: a kept float that large sends the file to the standard decoder too, so a value
    the terminal keeps never differs. A file both refuse raises ValueError."""
    if _fast is not None:
        try:
            doc = _fast.loads(raw)
        except _fast.JSONDecodeError:
            doc = None
        if isinstance(doc, dict):
            kept = keep(doc)
            if not _has_wide_float(kept):
                return kept
    return keep(load_object(raw))


def _has_wide_float(value: Any) -> bool:
    stack = [value]
    while stack:
        item = stack.pop()
        kind = type(item)
        if kind is float:
            if abs(item) >= _INT64_SPAN:
                return True
        elif kind is dict:
            stack.extend(item.values())
        elif kind is list or kind is tuple:
            stack.extend(item)
    return False


CURVE_TRADES = "curve:trades"
CURVE_SNAPSHOTS = "curve:snapshots"
_CURVE_FIELDS = {CURVE_TRADES: ("date", "pnl_usd"),
                 CURVE_SNAPSHOTS: ("ts_epoch_s", "date", "equity", "balance", "unrealized", "net_qty")}
_DERIVED_SUFFIXES = (EPOCH_SUFFIX, FLOAT_SUFFIX)


@dataclass(frozen=True)
class _Projection:
    read: frozenset[str]  # the fields the curve reads, with their `_float`
    derived: tuple[tuple[str, str], ...]  # (a read key the sanitiser can derive, the key it derives it from)


def _projection(fields: Iterable[str]) -> _Projection:
    read = frozenset(set(fields) | {f"{field}{FLOAT_SUFFIX}" for field in fields})
    derived = tuple((key, key[: -len(suffix)]) for key in sorted(read) for suffix in _DERIVED_SUFFIXES
                    if key.endswith(suffix))
    return _Projection(read, derived)


def _curve_rows(doc: Mapping[str, Any], section: str) -> Any:
    if section == CURVE_TRADES:
        return doc.get("trades")
    log = doc.get("strategy_log")
    return log.get("snapshots") if isinstance(log, dict) else None


def _project_row(row: dict[str, Any], projection: _Projection) -> dict[str, Any]:
    """The read keys of `row`, plus the source of a derivable read key the row does not carry itself (`ts` only when
    `ts_epoch_s` is absent), in the row's own key order."""
    bases = {base for key, base in projection.derived if key not in row}
    return {k: v for k, v in row.items() if k in projection.read or k in bases}


def _project(rows: Any, projection: _Projection) -> Any:
    """Each object row cut to what the curve reads; anything that is not a list (and every row that is not an object)
    unchanged."""
    if not isinstance(rows, list):
        return rows
    return [_project_row(row, projection) if isinstance(row, dict) else row for row in rows]


def frozen_plain(value: Any) -> Any:
    """`freeze(sanitise(value))` for a value `json.loads` made, in one pass with exact type tests. The common leaves
    (text, finite floats, safe integers, booleans, None) are their own sanitised form; every other leaf, and each
    key's derived sibling, is left to `sanitise` itself, so the rules stay in files.py."""
    kind = type(value)
    if kind is dict:
        return _frozen_plain_dict(value)
    if kind is list:
        return tuple(frozen_plain(item) for item in value)
    if kind is float:
        return value if math.isfinite(value) else None
    if kind is str or value is None or kind is bool or (kind is int and -JS_MAX_SAFE_INT <= value <= JS_MAX_SAFE_INT):
        return value
    return freeze(sanitise(value))


def _frozen_plain_dict(source: dict[str, Any]) -> FrozenDict:
    out: dict[str, Any] = {}
    siblings: dict[str, Any] = {}
    for key, item in source.items():
        kind = type(item)
        if kind is str:
            out[key] = item
            name = f"{key}{FLOAT_SUFFIX}"
            if name not in source and DECIMAL_STRING.fullmatch(item) and math.isfinite(number := float(item)):
                siblings[name] = number  # a Decimal string keeps its text and earns its float
        elif kind is int and not -JS_MAX_SAFE_INT <= item <= JS_MAX_SAFE_INT:
            pair = sanitise({key: item})  # an ns stamp (ISO text plus its seconds) or an unsafe integer (text)
            out[key] = pair[key]
            siblings.update((name, extra) for name, extra in pair.items() if name != key and name not in source)
        else:
            out[key] = frozen_plain(item)
    out.update(siblings)  # after every key, in key order, as files.sanitise adds them
    return FrozenDict(out)


def _curve_parser(section: str) -> Callable[[bytes], Any]:
    projection = _projection(_CURVE_FIELDS[section])

    def parse(raw: bytes) -> Any:
        return frozen_plain(kept_from(raw, lambda doc: _project(_curve_rows(doc, section), projection)))

    return parse


CURVE_PARSERS = {section: _curve_parser(section) for section in _CURVE_FIELDS}
