"""DQ calendar (ANALYTICS RI4): one state per session and symbol, from the QA and repair records. No price is read.

Sources, all read-only through the confined FileCache under `results/`:
- NQ.V.0: `screens/za_v0_rejected_days.json` (days the session gate rejected in the vendor bars) and
  `screens/za_v0_repaired_rejected_days.json` (days still rejected after the repair); the skipped reasons in
  `repair_report.json`; sessions are the NYSE sessions from 2010-09-28 (exchange_calendars XNYS, the calendar the
  repair records key their sessions by); per-year structural counts from `qa_report.json`.
- every other symbol: its futures repair sidecar, `repair_provenance_futures_v2/<SYM>.json` first for the eight v2
  symbols (as `nq_lab.data.provenance_path`), else `repair_provenance_futures/<SYM>.json`; per-year counts from
  `qa_report_futures_1m.json`.

States: vendor (never a candidate or never rejected); gated_out (a candidate of a symbol whose repair failed its
validation: the day keeps its collapsed vendor bars and research drops it); rejected (an NQ day the gate rejected
with no repair record); rebuilt (rebuilt from trade prints and served); unrepairable (the repair was tried on the day
and failed). Nothing dated after 2021-12-31 is served.
"""
from __future__ import annotations

import functools
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Mapping

import exchange_calendars as xc

from nq_terminal.models.dq import DayState, DqCalendar, DqCounts, DqDay, DqIndex, DqQaYear, DqSymbol
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError

LABEL = ("[POST HOC] descriptive: day states read from the QA reports and repair records, counted by the terminal; "
         "no price is read")
FENCE = "2021-12-31"
NQ = "NQ.V.0"
NQ_FIRST_SESSION = "2010-09-28"
V2_SYMBOLS = ("ES.V.0", "YM.V.0", "CL.V.0", "NG.V.0", "HO.V.0", "RB.V.0", "LE.V.0", "HE.V.0")
V1_DIR = "repair_provenance_futures"
V2_DIR = "repair_provenance_futures_v2"
NQ_VENDOR = "screens/za_v0_rejected_days.json"
NQ_REPAIRED = "screens/za_v0_repaired_rejected_days.json"
NQ_REPAIR_REPORT = "repair_report.json"
NQ_QA = "qa_report.json"
FUTURES_QA = "qa_report_futures_1m.json"
STATES: tuple[DayState, ...] = ("vendor", "gated_out", "rejected", "rebuilt", "unrepairable")
SIDECAR_SOURCES = ("vendor", "rebuilt", "candidate_not_repaired")
_UNREADABLE = (FileNotFoundError, FileAccessError, FileDecodeError)


class DqRecordError(ValueError):
    """A repair record holds a value the terminal does not know how to classify."""


def _rel(name: str) -> str:
    return f"results/{name}"


def _read(files: FileCache, results: Path, name: str) -> Any | None:
    try:
        return files.read_json(Path(results) / name)
    except _UNREADABLE:
        return None


def _join(items: Iterable[Any]) -> str:
    return ", ".join(str(i) for i in items)


def _vendor_flags(row: Mapping[str, Any]) -> str | None:
    flags = list(row.get("vendor_reasons") or []) + list(row.get("flags") or [])
    return f"vendor flags: {_join(flags)}" if flags else None


def _rebuilt_reason(row: Mapping[str, Any]) -> str:
    parts = ["rebuilt from trade prints"]
    if row.get("tier"):
        parts.append(f"tier {row['tier']}")
    flags = _vendor_flags(row)
    if flags:
        parts.append(flags)
    if row.get("volume_flag"):
        parts.append("volume flagged")
    return "; ".join(parts)


def _sidecar_day(date: str, row: Mapping[str, Any], repaired: bool) -> DqDay:
    source = row.get("source")
    if source == "vendor":
        return DqDay(date=date, state="vendor", reason=None)
    if source == "rebuilt":
        return DqDay(date=date, state="rebuilt", reason=_rebuilt_reason(row))
    if source == "candidate_not_repaired":
        if repaired:
            return DqDay(date=date, state="unrepairable", reason=str(row.get("reason") or "repair failed"))
        return DqDay(date=date, state="gated_out", reason=_vendor_flags(row) or "structural candidate")
    raise DqRecordError(f"unknown session source {source!r} on {date}; expected one of {SIDECAR_SOURCES}")


def classify_sidecar(doc: Mapping[str, Any]) -> list[DqDay]:
    """The sidecar's sessions up to the fence, date order, each with its state and reason."""
    repaired = doc.get("status") == "repaired"
    sessions = doc.get("sessions") or {}
    return [_sidecar_day(d, sessions[d], repaired) for d in sorted(sessions) if str(d)[:10] <= FENCE]


@functools.lru_cache(maxsize=1)
def nq_sessions() -> tuple[str, ...]:
    """The XNYS sessions from NQ's first session to the fence, built once per process."""
    sessions = xc.get_calendar("XNYS").sessions_in_range(NQ_FIRST_SESSION, FENCE)
    return tuple(s.strftime("%Y-%m-%d") for s in sessions)


def _skipped_reasons(report: Any) -> dict[str, str]:
    skipped = report.get("skipped") if isinstance(report, Mapping) else None
    out: dict[str, str] = {}
    for reason, entry in (skipped or {}).items():
        for day in (entry or {}).get("dates") or []:
            out[str(day)[:10]] = str(reason)
    return out


def classify_nq(rejected: Mapping[str, Any], still: Mapping[str, Any] | None, skipped: Mapping[str, str],
                sessions: Iterable[str]) -> list[DqDay]:
    """NQ day states: `still` None means no repair record, so every rejected day is `rejected`."""
    days = {d: DqDay(date=d, state="vendor", reason=None) for d in sessions}
    for day, why in rejected.items():
        d = str(day)[:10]
        if d > FENCE:
            continue
        if still is None:
            days[d] = DqDay(date=d, state="rejected", reason=f"gate: {why}")
        elif d in still:
            extra = f"; repair: {skipped[d]}" if d in skipped else ""
            days[d] = DqDay(date=d, state="unrepairable", reason=f"still rejected: {still[d]}{extra}")
        else:
            days[d] = DqDay(date=d, state="rebuilt", reason=f"vendor day rejected ({why}); rebuilt from trade prints")
    return [days[d] for d in sorted(days)]


def count(days: Iterable[DqDay]) -> DqCounts:
    c = Counter(d.state for d in days)
    return DqCounts(**{s: c.get(s, 0) for s in STATES}, sessions=sum(c.values()))


def _summary(symbol: str, source: str, repair: str, status: str, why: str | None, days: list[DqDay]) -> DqSymbol:
    return DqSymbol(symbol=symbol, root=symbol.split(".")[0], source=source, repair=repair, status=status,
                    why_not_repaired=why, counts=count(days), first=days[0].date if days else None,
                    last=days[-1].date if days else None)


def _nq(files: FileCache, results: Path) -> tuple[DqSymbol, list[DqDay]] | None:
    rejected = _read(files, results, NQ_VENDOR)
    if not isinstance(rejected, Mapping):
        return None
    still = _read(files, results, NQ_REPAIRED)
    still = {str(k)[:10]: v for k, v in still.items()} if isinstance(still, Mapping) else None
    days = classify_nq(rejected, still, _skipped_reasons(_read(files, results, NQ_REPAIR_REPORT)), nq_sessions())
    names = [NQ_VENDOR] + ([NQ_REPAIRED, NQ_REPAIR_REPORT] if still is not None else [])
    status = "repaired" if still is not None else "not_assessed"
    return _summary(NQ, _join(_rel(n) for n in names), "nq", status, None, days), days


def sidecar_name(symbol: str, results: Path) -> tuple[str, str]:
    """(relative name under results, repair version) as `nq_lab.data.provenance_path` picks it."""
    v2 = f"{V2_DIR}/{symbol}.json"
    if symbol in V2_SYMBOLS and (Path(results) / v2).is_file():
        return v2, "v2"
    return f"{V1_DIR}/{symbol}.json", "v1"


def _futures(files: FileCache, results: Path, symbol: str) -> tuple[DqSymbol, list[DqDay]] | None:
    name, version = sidecar_name(symbol, results)
    doc = _read(files, results, name)
    if not isinstance(doc, Mapping) or not isinstance(doc.get("sessions"), Mapping):
        return None
    days = classify_sidecar(doc)
    return _summary(symbol, _rel(name), version, str(doc.get("status")), doc.get("why_not_repaired"), days), days


def sidecar_symbols(results: Path) -> list[str]:
    found = {p.stem for d in (V1_DIR, V2_DIR) for p in (Path(results) / d).glob("*.V.0.json")}
    return sorted(found)


def _load(files: FileCache, results: Path, symbol: str) -> tuple[DqSymbol, list[DqDay]] | None:
    return _nq(files, results) if symbol == NQ else _futures(files, results, symbol)


def symbol_index(files: FileCache, results: Path) -> DqIndex:
    symbols, missing = [], []
    for symbol in [NQ, *sidecar_symbols(results)]:
        loaded = _load(files, results, symbol)
        if loaded is None:
            missing.append(_rel(NQ_VENDOR) if symbol == NQ else _rel(sidecar_name(symbol, results)[0]))
        else:
            symbols.append(loaded[0])
    return DqIndex(label=LABEL, fence=FENCE, symbols=symbols, missing=missing)


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _qa_year(year: str, row: Mapping[str, Any]) -> DqQaYear:
    dup = row.get("duplicate_ts", row.get("duplicate_timestamps"))
    return DqQaYear(year=int(year), rows=_int(row.get("rows")), ohlc_violations=_int(row.get("ohlc_violations")),
                    duplicate_ts=_int(dup), contract_changes=_int(row.get("contract_changes")),
                    rth_days_with_gaps=_int(row.get("rth_days_with_gaps")))


def qa_years(files: FileCache, results: Path, symbol: str) -> tuple[str | None, list[DqQaYear]]:
    """Per-year structural counts for the symbol, years up to the fence, from its QA report."""
    if symbol == NQ:
        name, doc = NQ_QA, _read(files, results, NQ_QA)
        years = doc.get("years") if isinstance(doc, Mapping) else None
    else:
        name, doc = FUTURES_QA, _read(files, results, FUTURES_QA)
        entry = (doc.get("symbols") or {}).get(symbol.split(".")[0]) if isinstance(doc, Mapping) else None
        years = entry.get("years") if isinstance(entry, Mapping) else None
    if not isinstance(years, Mapping):
        return None, []
    rows = [_qa_year(y, r) for y, r in sorted(years.items()) if str(y).isdigit() and f"{y}-01-01" <= FENCE
            and isinstance(r, Mapping)]
    return _rel(name), rows


def calendar(files: FileCache, results: Path, symbol: str) -> DqCalendar | None:
    """The symbol's calendar, or None for a symbol with no record."""
    if symbol != NQ and symbol not in sidecar_symbols(results):
        return None
    loaded = _load(files, results, symbol)
    if loaded is None:
        return None
    summary, days = loaded
    qa_source, years = qa_years(files, results, symbol)
    return DqCalendar(label=LABEL, fence=FENCE, symbol=summary, days=days, qa_source=qa_source, qa_years=years)
