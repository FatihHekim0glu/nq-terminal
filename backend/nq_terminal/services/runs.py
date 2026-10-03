"""Nautilus runs from `backtests/output/` (TASKS 2.1; ARCHITECTURE sections 3.1, 4 and 6). Read only.

RunIndex
- Lists `backtests/output/<run_id>/result.json` under the data root (the project root, or the fixture folder
  in fixture mode) and rescans at most every `RESCAN_S` seconds. Folders without `result.json` (a run still
  being written) and names outside `RUN_ID_RE` are skipped. Every lookup goes through the index, so an
  unknown or crafted `run_id` is refused before any file is opened (ARCHITECTURE section 9, path traversal).
- Sidecars are the other `*.json` files in a run folder (`regress_check`, `compare_screen`, ...), listed by
  stem; only those names can be served.

Reading
- `result.json` is 1 to 6.6 MB. It is read through the Phase 1 FileCache (confinement, retry on a decode
  error, mtime and size validation) with one parser per section, so a summary does not sanitise 8,588 fills:
  `head` (everything except `trades`, `fills` and `strategy_log`, plus counts and the log metadata), `trades`,
  `fills` and `strategy_log`. Values are sanitised (NaN to None, ns ints to ISO plus epoch seconds, Decimal
  strings kept plus a float) and frozen; responses get thawed copies. The equity curve reads its own projection
  of `trades` or `strategy_log.snapshots` (`curve:trades`, `curve:snapshots`: only the fields it reads), so the
  ledger's anchor pairs and an equity line never sanitise a whole log.

Badges (ARCHITECTURE 3.1): probe when `data.lookahead_probe` exists or the name holds `_probe_`; anchor for
`_regress_` and `_haltfix_`; ledgered by joining `results/ledger.csv`; unusable when `balance_check.ok` is not
true (rule 4), in which case no equity line is served.

Equity (Basis B, ANALYTICS_CATALOG C1): MTM `strategy_log.snapshots` when present (ends at
`balance_check.final_usd`), else realised daily P&L from `trades` on every NYSE session of the run window,
zero on days without a trade (as `metrics.daily_pnl`; ends at `pnl_total`). Sessions come from
`nq_lab.sessions.nyse_sessions`, a calendar, not a price read.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path, PureWindowsPath
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping, Sequence

from nq_lab.sessions import nyse_sessions
from nq_terminal.analytics import drawdown as analytics_drawdown
from nq_terminal.analytics.series import SeriesError, SeriesUnusable, run_returns
from nq_terminal.models.common import Page
from nq_terminal.models.runs import (
    AnchorComparison,
    CompareSeries,
    CompareStats,
    EquitySeries,
    FillRow,
    LedgerCommand,
    LedgerRef,
    LedgerRow,
    LedgerView,
    RunComparison,
    RunCounts,
    RunDetail,
    RunSummary,
    TradeRow,
)
from nq_terminal.services.files import (
    FileAccessError,
    FileCache,
    FileDecodeError,
    freeze,
    sanitise,
    thaw,
)
from nq_terminal.services.research import ResearchService, service_for_root
from nq_terminal.services.run_curves import CURVE_PARSERS, CURVE_SNAPSHOTS, CURVE_TRADES
from nq_terminal.services.run_curves import kept_from

RESCAN_S = 5.0
CACHE_BYTES = 1024**3
TRADING_DAYS = 252
MAX_COMPARE = 8
RUN_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}")
EXP_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.\-]{0,199}")
ANCHOR_RE = re.compile(r"(?P<base>.+)_(?:regress|haltfix)_r\d+")
ANCHOR_MARKERS = ("_regress_", "_haltfix_")
PROBE_MARKER = "_probe_"
RESULT_FILE = "result.json"
UNUSABLE_REASON = "balance check failed: the run is unusable (rule 4)"
REGRESS_CHECK = "regress_check"
LOG_SECTIONS = ("decisions", "closes", "notes", "rolls", "snapshots")
LARGE_KEYS = ("trades", "fills", "strategy_log")
META = "__terminal_meta__"
REALISED_LABEL = "realised, no MTM"
SNAPSHOT_LABEL = "mark to market snapshots"
EXP_PLACEHOLDER = "<exp>"
_UTC = timezone.utc


class RunNotFound(LookupError):
    """The run id is not in the index built from `backtests/output/`."""


class SectionNotFound(LookupError):
    """The run has no such strategy log section."""


class SidecarNotFound(LookupError):
    """The run folder has no such JSON sidecar."""


class RunUnreadable(RuntimeError):
    """result.json exists but could not be read or decoded, even after one retry."""


# ---------------------------------------------------------------- pure helpers


def is_probe(run_id: str, data: Mapping[str, Any] | None) -> bool:
    return PROBE_MARKER in run_id or (isinstance(data, Mapping) and "lookahead_probe" in data)


def is_anchor(run_id: str) -> bool:
    return any(marker in run_id for marker in ANCHOR_MARKERS)


def anchor_base_name(run_id: str) -> str | None:
    """`x_regress_r3` and `x_haltfix_r1` name `x` as their base; None for a run that is not an anchor."""
    match = ANCHOR_RE.fullmatch(run_id)
    return match.group("base") if match else None


def run_kind(doc: Mapping[str, Any]) -> str:
    """`book` for multi-instrument logs (dtsmom), `sized` for snapshot books, else `intraday`."""
    log = doc.get("strategy_log")
    if isinstance(log, Mapping) and "instruments" in log:
        return "book"
    if isinstance(log, Mapping) and "snapshots" in log:
        return "sized"
    return "intraday"


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _iso_epoch(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return math.floor((stamp if stamp.tzinfo else stamp.replace(tzinfo=_UTC)).timestamp())


def _with_epochs(row: dict[str, Any]) -> dict[str, Any]:
    """A trade row plus integer epoch seconds for its ISO times (chart axes, ARCHITECTURE s3.7)."""
    return {**row, **{f"{key}_epoch_s": _iso_epoch(row.get(key)) for key in ("entry_ts", "exit_ts")}}


def _both_equal(mine: float | None, theirs: float | None) -> bool:
    """Exact equality of two present values (rule 3); a value missing on either side is never a match."""
    return mine is not None and theirs is not None and mine == theirs


def _base_day(curve: EquitySeries) -> tuple[str, ...]:
    """The calendar day before a usable curve's first session, where the rebased line sits at 1.0."""
    if not curve.usable or not curve.date:
        return ()
    return ((date.fromisoformat(curve.date[0][:10]) - timedelta(days=1)).isoformat(),)


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _money(row: Mapping[str, Any], key: str) -> float | None:
    """A money field as a float: the sanitiser's `<key>_float` for Decimal strings, else the number itself."""
    return _num(row.get(f"{key}_float")) if f"{key}_float" in row else _num(row.get(key))


def unreadable(run_id: str, what: str, exc: BaseException) -> str:
    """An error message without a path: the OS error text names the full path, and with it the user name."""
    if isinstance(exc, (FileDecodeError, FileAccessError)):
        return f"{run_id}: {exc}"  # these carry the file name only
    if isinstance(exc, FileNotFoundError):
        return f"{run_id}: {what} is no longer on disk"
    return f"{run_id}: {what} could not be read ({type(exc).__name__})"


def _finite(value: float) -> float | None:
    return float(value) if math.isfinite(value) else None


def _date_epoch(day: str) -> int:
    return int(datetime.fromisoformat(day).replace(tzinfo=_UTC).timestamp())


def _parse_day(value: Any) -> date | None:
    try:
        return date.fromisoformat(value[:10]) if isinstance(value, str) else None
    except ValueError:
        return None


# ---------------------------------------------------------------- equity curves


@dataclass(frozen=True)
class Curve:
    t: tuple[int, ...]
    date: tuple[str, ...]
    equity: tuple[float, ...]
    balance: tuple[float, ...] | None = None
    unrealized: tuple[float, ...] | None = None
    net_qty: tuple[Any, ...] | None = None


def snapshot_curve(snapshots: Iterable[Mapping[str, Any]]) -> Curve:
    """MTM equity from `strategy_log.snapshots` (rows without a time or an equity are left out)."""
    rows = [s for s in snapshots if isinstance(s, Mapping) and _int(s.get("ts_epoch_s")) is not None
            and _money(s, "equity") is not None]
    return Curve(t=tuple(int(s["ts_epoch_s"]) for s in rows), date=tuple(str(s.get("date")) for s in rows),
                 equity=tuple(_money(s, "equity") for s in rows),
                 balance=tuple(_money(s, "balance") or 0.0 for s in rows),
                 unrealized=tuple(_money(s, "unrealized") or 0.0 for s in rows),
                 net_qty=tuple(thaw(s.get("net_qty")) for s in rows))


def session_closes(start: Any, end: Any) -> dict[str, int]:
    """NYSE sessions in [start, end) (config dates, end exclusive) -> close time in epoch seconds."""
    first, stop = _parse_day(start), _parse_day(end)
    if first is None or stop is None or stop <= first:
        return {}
    table = nyse_sessions(first, stop - timedelta(days=1))
    return {day.isoformat(): int(close.timestamp()) for day, close in zip(table.index, table["close_utc"])}


def realised_curve(trades: Iterable[Mapping[str, Any]], closes: Mapping[str, int], starting: float) -> Curve:
    """Cumulative realised P&L by entry date on every session (zero on days without a trade), exact in decimal."""
    by_day: dict[str, Decimal] = {}
    for trade in trades:
        day, pnl = _text(trade.get("date")), _num(trade.get("pnl_usd"))
        if day is not None and pnl is not None:
            by_day[day] = by_day.get(day, Decimal(0)) + Decimal(repr(pnl))
    days = sorted(set(closes) | set(by_day))
    base, total = Decimal(repr(starting)), Decimal(0)
    equity, stamps = [], []
    for day in days:
        total += by_day.get(day, Decimal(0))
        equity.append(float(base + total))
        stamps.append(closes[day] if day in closes else _date_epoch(day) + 21 * 3600)
    return Curve(t=tuple(stamps), date=tuple(days), equity=tuple(equity))


# ---------------------------------------------------------------- index


@dataclass(frozen=True)
class RunEntry:
    run_id: str
    folder: Path
    sidecars: tuple[str, ...]
    has_log_file: bool

    @property
    def result(self) -> Path:
        return self.folder / RESULT_FILE


def _sidecars(folder: Path) -> tuple[str, ...]:
    return tuple(sorted(p.stem for p in folder.iterdir() if p.is_file() and p.suffix == ".json"
                        and p.name != RESULT_FILE and RUN_ID_RE.fullmatch(p.stem)))


def scan_output(output: Path) -> dict[str, RunEntry]:
    """Every run folder under `output` that holds a result.json, by run id."""
    if not output.is_dir():
        return {}
    entries = {}
    for folder in sorted(output.iterdir()):
        name = folder.name
        if not (folder.is_dir() and RUN_ID_RE.fullmatch(name) and (folder / RESULT_FILE).is_file()):
            continue
        entries[name] = RunEntry(name, folder, _sidecars(folder), (output / f"{name}.log").is_file())
    return entries


class RunIndex:
    """The run folders on disk, rescanned at most every `rescan_s` seconds (thread safe)."""

    def __init__(self, output: Path, *, clock: Callable[[], float] = time.monotonic, rescan_s: float = RESCAN_S):
        self.output = Path(output)
        self._clock, self._rescan_s = clock, rescan_s
        self._entries: Mapping[str, RunEntry] = MappingProxyType({})
        self._scanned_at: float | None = None
        self._lock = threading.Lock()
        self.scans = 0

    def entries(self) -> Mapping[str, RunEntry]:
        with self._lock:
            now = self._clock()
            if self._scanned_at is None or now - self._scanned_at >= self._rescan_s:
                self._scan_locked(now)
            return self._entries

    def rescan(self) -> Mapping[str, RunEntry]:
        """Scan now, whatever the interval: a body the result cache keeps must be built from the folders as they are."""
        with self._lock:
            self._scan_locked(self._clock())
            return self._entries

    def _scan_locked(self, now: float) -> None:
        self._entries = MappingProxyType(scan_output(self.output))
        self._scanned_at = now
        self.scans += 1

    def get(self, run_id: Any) -> RunEntry:
        if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id):
            raise RunNotFound(run_id)
        entry = self.entries().get(run_id)
        if entry is None:
            raise RunNotFound(run_id)
        return entry


# ---------------------------------------------------------------- section parsers


def _log_meta(log: Mapping[str, Any]) -> tuple[dict[str, int], dict[str, Any]]:
    sections = {k: len(v) for k, v in log.items() if k in LOG_SECTIONS and isinstance(v, list)}
    meta = {k: v for k, v in log.items() if k not in LOG_SECTIONS}
    return sections, meta


def parse_head(raw: bytes) -> Any:
    """Everything but the large arrays, plus their counts and the strategy log's metadata."""
    return freeze(sanitise(kept_from(raw, _head_of)))


def _head_of(doc: dict[str, Any]) -> dict[str, Any]:
    head = {k: v for k, v in doc.items() if k not in LARGE_KEYS}
    log = doc.get("strategy_log") if isinstance(doc.get("strategy_log"), dict) else {}
    sections, meta = _log_meta(log)
    head[META] = {"kind": run_kind(doc), "trades": len(doc.get("trades") or []),
                  "fills": len(doc.get("fills") or []), "log_sections": sections, "log_meta": meta,
                  "has_snapshots": "snapshots" in log}
    return head


def _section_parser(key: str) -> Callable[[bytes], Any]:
    def parse(raw: bytes) -> Any:
        return freeze(sanitise(kept_from(raw, lambda doc: doc.get(key))))

    return parse


SECTION_PARSERS = {key: _section_parser(key) for key in LARGE_KEYS}

_PARSERS: Mapping[str, Callable[[bytes], Any]] = MappingProxyType(
    {"head": parse_head, **SECTION_PARSERS, **CURVE_PARSERS})


# ---------------------------------------------------------------- ledger file


def _csv_float(text: str | None) -> float | None:
    try:
        value = float(text) if text not in (None, "") else None
    except ValueError:
        return None
    return value if value is not None and math.isfinite(value) else None


def _csv_int(text: str | None) -> int | None:
    value = _csv_float(text)
    return int(value) if value is not None and value.is_integer() else None


def _csv_params(text: str | None) -> dict[str, Any] | None:
    try:
        value = json.loads(text) if text else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def parse_ledger(raw: bytes) -> tuple[Mapping[str, Any], ...]:
    """`results/ledger.csv` rows as frozen dicts of strings (the csv module, so numbers parse exactly later)."""
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8"), newline=""))
    return freeze([{k: v for k, v in row.items() if isinstance(k, str)} for row in reader])


def _ledger_row(row: Mapping[str, Any]) -> dict[str, Any]:
    text = {k: (v if isinstance(v, str) else None) for k, v in row.items()}
    return {
        "run_id": text.get("run_id") or "", "ts_utc": text.get("ts_utc"), "exp_id": text.get("exp_id"),
        "strategy": text.get("strategy"), "params": _csv_params(text.get("params_json")),
        "params_json": text.get("params_json"), "variant": text.get("variant"), "start": text.get("start"),
        "end": text.get("end"), "n_trades": _csv_int(text.get("n_trades")),
        "pnl_total": _csv_float(text.get("pnl_total")), "fees_total": _csv_float(text.get("fees_total")),
        "mean_net_r": _csv_float(text.get("mean_net_r")), "t_net_r": _csv_float(text.get("t_net_r")),
        "hit_rate": _csv_float(text.get("hit_rate")), "balance_check": text.get("balance_check"),
        "runtime_s": _csv_float(text.get("runtime_s")), "result_created_utc": text.get("result_created_utc"),
    }


def _matches_result(row: Mapping[str, Any], head: Mapping[str, Any]) -> bool:
    """Rule 2: the ledger's numbers are the on-disk result's numbers."""
    summ = _mapping(head.get("summary"))
    return (row["n_trades"] == _int(head.get("n_trades")) and row["pnl_total"] == _num(head.get("pnl_total"))
            and row["fees_total"] == _num(head.get("fees_total")) and row["t_net_r"] == _num(summ.get("t_net_r")))


# ---------------------------------------------------------------- service


class RunService:
    """Read-only access to the runs under `<data_root>/backtests/output` and `<data_root>/results/ledger.csv`."""

    def __init__(self, *, data_root: Path, project_root: Path, cache: FileCache | None = None,
                 clock: Callable[[], float] = time.monotonic, rescan_s: float = RESCAN_S,
                 research: ResearchService | None = None):
        self.data_root = Path(data_root)
        self.project_root = Path(project_root)
        self._research = research
        self.ledger_path = self.data_root / "results" / "ledger.csv"
        self.cache = cache if cache is not None else FileCache(roots=[self.data_root], max_bytes=CACHE_BYTES)
        self.index = RunIndex(self.data_root / "backtests" / "output", clock=clock, rescan_s=rescan_s)

    # ----- reading

    def _read(self, entry: RunEntry, section: str) -> Any:
        parser = _PARSERS[section]
        try:
            return self.cache.get(entry.result, parser, kind=f"runs:{section}")
        except (FileDecodeError, FileAccessError, OSError) as exc:
            raise RunUnreadable(unreadable(entry.run_id, RESULT_FILE, exc)) from exc

    def _head(self, run_id: str) -> tuple[RunEntry, Mapping[str, Any]]:
        entry = self.index.get(run_id)
        return entry, self._read(entry, "head")

    def _ledger_rows(self) -> tuple[Mapping[str, Any], ...] | None:
        try:
            return self.cache.get(self.ledger_path, parse_ledger, kind="runs:ledger")
        except FileNotFoundError:
            return None

    def _ledger_refs(self) -> dict[str, LedgerRef]:
        rows = self._ledger_rows() or ()
        return {r["run_id"]: LedgerRef(exp_id=r.get("exp_id") or "", ts_utc=r.get("ts_utc") or "")
                for r in rows if r.get("run_id")}

    # ----- summaries and detail

    def summaries(self) -> list[RunSummary]:
        refs = self._ledger_refs()
        return [self._summary_or_error(entry, refs) for entry in self.index.entries().values()]

    def _summary_or_error(self, entry: RunEntry, refs: Mapping[str, LedgerRef]) -> RunSummary:
        try:
            head = self._read(entry, "head")
        except RunUnreadable as exc:
            return RunSummary(run_id=entry.run_id, readable=False, error=str(exc), sidecars=list(entry.sidecars),
                              is_anchor=is_anchor(entry.run_id), is_probe=PROBE_MARKER in entry.run_id)
        return self._summary(entry, head, refs.get(entry.run_id))

    def _summary(self, entry: RunEntry, head: Mapping[str, Any], ledger: LedgerRef | None) -> RunSummary:
        cfg, summ = _mapping(head.get("config")), _mapping(head.get("summary"))
        check, coverage = _mapping(head.get("balance_check")), head.get("coverage_check")
        mtm, balance_ok, anchor = check.get("mtm"), _flag(check.get("ok")), is_anchor(entry.run_id)
        return RunSummary(
            run_id=entry.run_id, strategy=_text(cfg.get("strategy")), params=thaw(_mapping(cfg.get("params"))),
            variant=_text(cfg.get("variant")), start=_text(cfg.get("start")), end=_text(cfg.get("end")),
            created_utc=_text(head.get("created_utc")), elapsed_s=_num(head.get("elapsed_s")),
            nautilus_trader=_text(head.get("nautilus_trader")), kind=head[META]["kind"],
            n_trades=_int(head.get("n_trades")), pnl_total=_num(head.get("pnl_total")),
            fees_total=_num(head.get("fees_total")), hit_rate=_num(summ.get("hit_rate")),
            mean_net_r=_num(summ.get("mean_net_r")), t_net_r=_num(summ.get("t_net_r")),
            t_pnl_usd=_num(summ.get("t_pnl_usd")), balance_ok=balance_ok,
            mtm_ok=_flag(mtm.get("ok")) if isinstance(mtm, Mapping) else None,
            coverage_ok=_flag(coverage.get("ok")) if isinstance(coverage, Mapping) else None,
            usable=balance_ok is True, is_probe=is_probe(entry.run_id, _mapping(head.get("data"))),
            is_anchor=anchor, anchor_of=self._anchor_base(entry)[0] if anchor else None, ledger=ledger,
            sidecars=list(entry.sidecars))

    def detail(self, run_id: str, *, anchor: bool = True) -> RunDetail:
        """One run without its large arrays; `anchor=False` leaves out the anchor comparison (the analytics series
        need only the run's own blocks, and the comparison itself reads their Sharpe)."""
        entry, head = self._head(run_id)
        summary = self._summary(entry, head, self._ledger_refs().get(entry.run_id))
        meta, skipped, coverage = head[META], head.get("strategy_skipped"), head.get("coverage_check")
        return RunDetail(
            summary=summary, config=thaw(_mapping(head.get("config"))), data=thaw(_mapping(head.get("data"))),
            venue=thaw(_mapping(head.get("venue"))), summary_stats=thaw(_mapping(head.get("summary"))),
            balance_check=thaw(_mapping(head.get("balance_check"))),
            coverage_check=thaw(coverage) if isinstance(coverage, Mapping) else None,
            strategy_skipped=thaw(skipped) if isinstance(skipped, (list, tuple)) else None,
            counts=RunCounts(trades=meta["trades"], fills=meta["fills"]), log_sections=thaw(meta["log_sections"]),
            log_meta=thaw(meta["log_meta"]),
            anchor=self._compare_anchor(entry) if anchor and summary.is_anchor else None,
            ledger_command=self._ledger_command(entry, summary), run_log_file=entry.has_log_file)

    # ----- pages

    def _rows(self, run_id: str, section: str) -> tuple[Any, ...]:
        rows = self._read(self.index.get(run_id), section)
        return tuple(rows) if isinstance(rows, (list, tuple)) else ()

    def trades(self, run_id: str, offset: int = 0, limit: int = 500) -> Page[TradeRow]:
        rows = self._rows(run_id, "trades")
        items = [TradeRow.model_validate(_with_epochs(thaw(r))) for r in rows[offset:offset + limit]
                 if isinstance(r, Mapping)]
        return Page[TradeRow](items=items, offset=offset, limit=limit, total=len(rows))

    def fills(self, run_id: str, offset: int = 0, limit: int = 500) -> Page[FillRow]:
        rows = self._rows(run_id, "fills")
        items = [FillRow.model_validate(thaw(r)) for r in rows[offset:offset + limit] if isinstance(r, Mapping)]
        return Page[FillRow](items=items, offset=offset, limit=limit, total=len(rows))

    def log(self, run_id: str, section: str, offset: int = 0, limit: int = 500) -> Page[dict[str, Any]]:
        entry = self.index.get(run_id)
        log = self._read(entry, "strategy_log") if section in LOG_SECTIONS else None
        rows = log.get(section) if isinstance(log, Mapping) else None
        if not isinstance(rows, (list, tuple)):
            raise SectionNotFound(f"{run_id} has no strategy log section {section!r}")
        items = [thaw(r) if isinstance(r, Mapping) else {"value": thaw(r)} for r in rows[offset:offset + limit]]
        return Page[dict[str, Any]](items=items, offset=offset, limit=limit, total=len(rows))

    def sidecar(self, run_id: str, name: str) -> Any:
        entry = self.index.get(run_id)
        if name not in entry.sidecars:
            raise SidecarNotFound(f"{run_id} has no sidecar {name!r}")
        try:
            return thaw(self.cache.read_json(entry.folder / f"{name}.json"))
        except (FileDecodeError, FileAccessError, OSError) as exc:
            raise RunUnreadable(unreadable(run_id, f"sidecar {name}.json", exc)) from exc

    # ----- equity

    def _curve(self, entry: RunEntry, head: Mapping[str, Any]) -> tuple[Curve, dict[str, Any]]:
        check, cfg = _mapping(head.get("balance_check")), _mapping(head.get("config"))
        starting = _num(check.get("starting_usd")) or _num(_mapping(head.get("venue")).get("starting_balance_usd"))
        if head[META]["has_snapshots"]:
            curve = snapshot_curve(self._read(entry, CURVE_SNAPSHOTS) or ())
            return curve, {"starting": starting, "n_sessions": len(curve.t), "sessions_match": None}
        closes = session_closes(cfg.get("start"), cfg.get("end"))
        curve = realised_curve(self._read(entry, CURVE_TRADES) or (), closes, starting or 0.0)
        expected = _int(_mapping(head.get("data")).get("sessions"))
        match = None if expected is None or not closes else len(curve.t) == expected
        return curve, {"starting": starting, "n_sessions": len(curve.t), "sessions_match": match}

    def equity(self, run_id: str) -> EquitySeries:
        entry, head = self._head(run_id)
        check = _mapping(head.get("balance_check"))
        snapshots = bool(head[META]["has_snapshots"])
        base = {"run_id": run_id, "source": "mtm_snapshots" if snapshots else "realised_trades",
                "label": SNAPSHOT_LABEL if snapshots else REALISED_LABEL, "final_usd": _num(check.get("final_usd"))}
        if check.get("ok") is not True:
            return EquitySeries(**base, usable=False, starting_usd=_num(check.get("starting_usd")), n_sessions=0,
                                sessions_match=None, t=[], date=[], equity=[], pnl=[],
                                unusable_reason=UNUSABLE_REASON)
        curve, info = self._curve(entry, head)
        starting = info["starting"] or 0.0
        return EquitySeries(
            **base, usable=True, unusable_reason=None, starting_usd=info["starting"], n_sessions=info["n_sessions"],
            sessions_match=info["sessions_match"], t=list(curve.t), date=list(curve.date), equity=list(curve.equity),
            pnl=[e - starting for e in curve.equity], balance=list(curve.balance) if curve.balance else None,
            unrealized=list(curve.unrealized) if curve.unrealized else None,
            net_qty=list(curve.net_qty) if curve.net_qty else None)

    @property
    def research(self) -> ResearchService:
        """The research service of the same data root (the za_v0 rejected-days files give za_orb its sessions)."""
        if self._research is None:
            self._research = service_for_root(self.data_root)
        return self._research

    def account_stats(self, run_id: str) -> tuple[float | None, float | None, str | None]:
        """(Sharpe, max drawdown as a positive fraction, reason when both are null) on the tear sheet's own Basis B
        series (`series.run_returns`: one row per gated session), so a run never shows two Sharpe values."""
        try:
            r = run_returns(self, self.research, run_id)
        except SeriesUnusable:
            return None, None, UNUSABLE_REASON
        except SeriesError as exc:
            return None, None, str(exc)
        from nq_terminal.analytics import perf  # lazy: the start path does not load perf (D1.1)

        return _finite(perf.sharpe(r, TRADING_DAYS)), _finite(abs(analytics_drawdown.max_drawdown(r, "B"))), None

    def _sharpe_of(self, run_id: str) -> float | None:
        return self.account_stats(run_id)[0]

    # ----- compare

    def compare(self, run_ids: Sequence[str]) -> RunComparison:
        if len(set(run_ids)) != len(run_ids) or not 2 <= len(run_ids) <= MAX_COMPARE:
            raise ValueError(f"compare needs 2 to {MAX_COMPARE} distinct run ids")
        for run_id in run_ids:
            self.index.get(run_id)  # refuse an unknown id before reading anything
        curves = [self.equity(run_id) for run_id in run_ids]
        days = sorted({d for c in curves for d in (*c.date, *_base_day(c))})
        series = [self._rebased(c, days) for c in curves]
        stats = [self._compare_stats(c) for c in curves]
        return RunComparison(t=[_date_epoch(d) for d in days], date=days, series=series, stats=stats)

    def stats(self, run_ids: Sequence[str]) -> list[CompareStats]:
        """The compare view's headline numbers for any number of runs (RUNS), without their curves."""
        for run_id in run_ids:
            self.index.get(run_id)  # refuse an unknown id before reading anything
        return [self._compare_stats(self.equity(run_id)) for run_id in run_ids]

    def _rebased(self, curve: EquitySeries, days: Sequence[str]) -> CompareSeries:
        """Equity over the starting balance K (C1), with 1.0 on the day before the first session, so the
        line ends at 1 + total_return and shares its baseline with the Sharpe and drawdown stats."""
        k = curve.starting_usd if curve.usable and curve.starting_usd else None
        by_day = {**{d: k for d in _base_day(curve)}, **dict(zip(curve.date, curve.equity))} if k else {}
        rebased = [by_day[d] / k if k and d in by_day else None for d in days]
        _, head = self._head(curve.run_id)
        return CompareSeries(run_id=curve.run_id, is_probe=is_probe(curve.run_id, _mapping(head.get("data"))),
                             usable=curve.usable, source=curve.source, rebased=rebased)

    def _compare_stats(self, curve: EquitySeries) -> CompareStats:
        _, head = self._head(curve.run_id)
        starting = curve.starting_usd
        total = curve.pnl[-1] / starting if curve.usable and curve.pnl and starting else None
        sharpe, depth, note = self.account_stats(curve.run_id) if curve.usable else (None, None, UNUSABLE_REASON)
        return CompareStats(run_id=curve.run_id, n_trades=_int(head.get("n_trades")),
                            pnl_total=_num(head.get("pnl_total")), fees_total=_num(head.get("fees_total")),
                            total_return=total, sharpe=sharpe, max_drawdown=depth, stats_note=note)

    # ----- anchors (rule 3)

    def _regress_old(self, entry: RunEntry) -> str | None:
        if REGRESS_CHECK not in entry.sidecars:
            return None
        try:
            old = self.cache.read_json(entry.folder / f"{REGRESS_CHECK}.json").get("old")
        except (FileDecodeError, FileAccessError, FileNotFoundError, AttributeError):
            return None
        return old if isinstance(old, str) else None

    def _anchor_base(self, entry: RunEntry) -> tuple[str | None, str | None]:
        """The base run of an anchor: its own regress_check, a sibling anchor's check, or its name."""
        own = self._regress_old(entry)
        if own is not None:
            return own, "regress_check"
        name_base = anchor_base_name(entry.run_id)
        entries = self.index.entries()
        for other in entries.values():
            if other.run_id != entry.run_id and name_base and anchor_base_name(other.run_id) == name_base:
                sibling = self._regress_old(other)
                if sibling is not None:
                    return sibling, "sibling_regress_check"
        return (name_base, "name") if name_base else (None, None)

    def _regress_identical(self, entry: RunEntry) -> bool | None:
        if REGRESS_CHECK not in entry.sidecars:
            return None
        try:
            identical = self.cache.read_json(entry.folder / f"{REGRESS_CHECK}.json").get("identical")
        except (FileDecodeError, FileAccessError, FileNotFoundError, AttributeError):
            return None
        return _flag(identical)

    def _compare_anchor(self, entry: RunEntry) -> AnchorComparison:
        base, source = self._anchor_base(entry)
        found = base is not None and base in self.index.entries()
        _, head = self._head(entry.run_id)
        base_head = self._head(base)[1] if found else {}
        same = {key: found and _both_equal(_num(head.get(key)), _num(base_head.get(key)))
                for key in ("n_trades", "pnl_total", "fees_total")}
        mine, theirs = self._sharpe_of(entry.run_id), self._sharpe_of(base) if found else None
        sharpe_equal = found and _both_equal(mine, theirs)
        comparable = found and mine is not None and theirs is not None and all(
            _num(doc.get(key)) is not None for doc in (head, base_head) for key in ("n_trades", "pnl_total"))
        verdict = ("IDENTICAL" if all(same.values()) and sharpe_equal
                   else "DIFFERENT" if comparable else "NOT COMPARABLE")
        return AnchorComparison(
            anchor=entry.run_id, base=base, base_source=source, base_found=found,
            n_trades_equal=same["n_trades"], pnl_total_equal=same["pnl_total"], fees_total_equal=same["fees_total"],
            sharpe_anchor=mine, sharpe_base=theirs, sharpe_equal=sharpe_equal,
            verdict=verdict, regress_check_identical=self._regress_identical(entry))

    def anchor(self, run_id: str) -> AnchorComparison | None:
        entry = self.index.get(run_id)
        return self._compare_anchor(entry) if is_anchor(run_id) else None

    # ----- ledger (rule 2: read only; the copy command is shown, never run)

    def ledger(self) -> LedgerView:
        rows = self._ledger_rows()
        entries = self.index.entries()
        typed = [self._typed_ledger_row(row, entries) for row in rows or ()]
        pairs = [self._compare_anchor(e) for e in entries.values() if is_anchor(e.run_id)]
        return LedgerView(ledger_found=rows is not None, rows=typed, anchor_pairs=pairs)

    def _typed_ledger_row(self, row: Mapping[str, Any], entries: Mapping[str, RunEntry]) -> LedgerRow:
        values = _ledger_row(row)
        entry = entries.get(values["run_id"])
        matches = None
        if entry is not None:
            try:
                matches = _matches_result(values, self._read(entry, "head"))
            except RunUnreadable:
                matches = None
        return LedgerRow(**values, run_found=entry is not None, matches_result=matches)

    def _suggest_exp(self, strategy: str | None) -> str | None:
        rows = [r for r in self._ledger_rows() or () if strategy and r.get("strategy") == strategy]
        exp = rows[-1].get("exp_id") if rows else None
        return exp if isinstance(exp, str) and EXP_ID_RE.fullmatch(exp) else None

    def _ledger_command(self, entry: RunEntry, summary: RunSummary) -> LedgerCommand:
        reasons = []
        if summary.balance_ok is not True:
            reasons.append(UNUSABLE_REASON)
        if summary.is_probe:
            reasons.append("look-ahead probe: a guard, never a result")
        if summary.coverage_ok is False:
            reasons.append("coverage check failed")
        if summary.ledger is not None:
            reasons.append("already in the ledger")
        cwd = str(self.project_root)
        if reasons:
            return LedgerCommand(eligible=False, reasons=reasons, command=None, cwd=cwd, exp_id=None,
                                 exp_id_source=None)
        exp = self._suggest_exp(summary.strategy)
        python = self.project_root / ".venv" / "Scripts" / "python.exe"
        script = PureWindowsPath("scripts", "ledger_append.py")
        result = PureWindowsPath("backtests", "output", entry.run_id, RESULT_FILE)
        command = f'"{python}" {script} {result} --exp-id {exp or EXP_PLACEHOLDER}'
        return LedgerCommand(eligible=True, reasons=[], command=command, cwd=cwd, exp_id=exp,
                             exp_id_source="ledger" if exp else "placeholder")
