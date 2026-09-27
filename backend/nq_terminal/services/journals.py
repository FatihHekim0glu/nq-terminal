"""Live monitor services, read only (ARCHITECTURE s3.5 and s7; ANALYTICS_CATALOG LV1 to LV4).

There is no IB connection and no order path here: the terminal only reads the files the paper book writes.

Journals (`live/logs/*.jsonl`, discovered, never assumed; DL11)
- `JournalTailer` keeps a byte offset per file and reads only what was appended since the last poll. It starts
  again from byte 0 when the file shrinks (truncation) or is replaced (its (st_dev, st_ino) identity changes), and
  holds back a last line with no newline until the writer finishes it. Lines are parsed with `json.loads`, which
  accepts the `NaN` tokens the book writes, then sanitised (`files.sanitise`: NaN and Inf to null, ns ints to ISO
  plus `*_epoch_s`).
- Every row is classed by its own fields with `paper_plumbing.is_plumbing`, never by the file name.
- The performance path goes through `paper_plumbing.performance_rows` (imported, never reimplemented) and then
  through `check_no_plumbing`, so a plumbing row can never reach a performance series even if the filter is
  swapped out (`performance_series(keep=...)` exists so the test can show that guard failing).
- `exposure` is `paper_plumbing.exposure_summary`, returning None while a half-written line makes the file
  unreadable.

Nautilus logs (`live/logs/*.log`): one line is `<ts>Z [LEVEL] <TRADER>.<Component>: <message>`; other lines
(banners, tracebacks) are kept with `level` None. Text is read as utf-8 with replacement (the braille banner).
IB account ids in messages are masked to their `DU`/`DF`/`U`/`F` prefix plus one `*` per remaining character. The
pattern takes up to three letters after the prefix (IB paper ids look like `DUX123456`) and is not fooled by a
lowercase word or punctuation in front (`accountU1234567`, `BROKERS-DUX123456`); the configured `IB_ACCOUNT_ID`
is also masked wherever it appears.

Kill switch: `live_guards.kill_switch_on` on `<data root>/live/KILL`, which also matches `KILL*` names (DL10). The
terminal never creates or deletes those files.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import json
import math
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence
from zoneinfo import ZoneInfo

from nq_lab import live_guards, mnq_roll, paper_plumbing
from nq_terminal.services.files import freeze, sanitise

JOURNAL_SUFFIX = ".jsonl"
LOG_SUFFIX = ".log"
BOOK_JOURNAL = "volmanaged_paper_journal.jsonl"
EXPECTED_JOURNALS = (BOOK_JOURNAL, "volmanaged_paper_journal.PLUMBING_DELAYED.jsonl")
LOGS_PARTS = ("live", "logs")
KILL_PARTS = ("live", "KILL")
FILE_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}")
DECISION_ET = "15:55:05"  # close - 5 min + 5 s (strategies/volmanaged_live.py; a test checks the constants)
ORDER_ET = "15:59:30"  # close - 30 s
NEW_YORK = ZoneInfo("America/New_York")
ACCOUNT_ID = re.compile(r"(?<![A-Z0-9])(DU|DF|U|F)([A-Z]{0,3}\d{5,10})(?![0-9])")
MIN_KNOWN_ACCOUNT_CHARS = 4
LOG_LINE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)Z \[(?P<level>[A-Z]+)\] "
                      r"(?P<trader>[^\s.]+)\.(?P<component>[^:]+): ?(?P<message>.*)$")
NOT_LOOPBACK = "set (not loopback)"


class PlumbingLeakError(RuntimeError):
    """A plumbing row reached a performance series (it must never be read as strategy performance)."""


# ---------------------------------------------------------------- paths


def logs_dir(data_root: Path) -> Path:
    return data_root.joinpath(*LOGS_PARTS)


def relative_name(name: str) -> str:
    """The display path of a file in the logs folder, e.g. `live/logs/<name>`."""
    return "/".join((*LOGS_PARTS, name))


def empty_state(name: str) -> str:
    return f"no journal yet: {relative_name(name)}"


def discover(folder: Path, suffix: str) -> tuple[Path, ...]:
    """Regular files in `folder` with `suffix` and a plain name, sorted by name; () when the folder is missing."""
    if not folder.is_dir():
        return ()
    return tuple(sorted((p for p in folder.iterdir()
                         if p.suffix == suffix and FILE_NAME.fullmatch(p.name) and p.is_file()),
                        key=lambda p: p.name))


def find(folder: Path, suffix: str, name: str) -> Path | None:
    """The discovered file called `name`, or None: names are matched against the listing, never joined raw."""
    return next((p for p in discover(folder, suffix) if p.name == name), None)


# ---------------------------------------------------------------- journal rows and the tailer


@dataclass(frozen=True)
class JournalRow:
    file: str
    line_no: int
    plumbing: bool
    data: Mapping[str, Any]


@dataclass(frozen=True)
class BadLine:
    line_no: int
    message: str


@dataclass(frozen=True)
class TailState:
    present: bool
    rows: tuple[JournalRow, ...]
    bad_lines: tuple[BadLine, ...]
    partial_pending: bool
    resets: int
    mtime_ns: int | None


def parse_row(text: str, file: str, line_no: int) -> JournalRow | BadLine:
    try:
        obj = json.loads(text)
    except ValueError:
        return BadLine(line_no, "not JSON")
    if not isinstance(obj, dict):
        return BadLine(line_no, "not a JSON object")
    return JournalRow(file, line_no, paper_plumbing.is_plumbing(obj), freeze(sanitise(obj)))


class JournalTailer:
    """Incremental reader of one journal (see the module docstring). Thread safe."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.offset = 0
        self._identity: tuple[int, int] | None = None
        self._partial = b""
        self._line_no = 0
        self._rows: list[JournalRow] = []
        self._bad: list[BadLine] = []
        self._resets = 0
        self._lock = threading.Lock()

    def _restart(self) -> None:
        self.offset, self._partial, self._line_no = 0, b"", 0
        self._rows, self._bad = [], []

    def _read_new(self, size: int) -> bytes:
        with self.path.open("rb") as fh:
            fh.seek(self.offset)
            chunk = fh.read(size - self.offset)
        self.offset += len(chunk)
        return chunk

    def _consume(self, chunk: bytes) -> None:
        pieces = (self._partial + chunk).split(b"\n")
        self._partial = pieces.pop()
        for piece in pieces:
            self._line_no += 1
            text = piece.decode("utf-8", errors="replace").strip()
            if not text:
                continue
            parsed = parse_row(text, self.path.name, self._line_no)
            (self._rows if isinstance(parsed, JournalRow) else self._bad).append(parsed)

    def poll(self) -> TailState:
        with self._lock:
            try:
                stat = self.path.stat()
            except FileNotFoundError:
                self._restart()
                self._identity = None
                return TailState(False, (), (), False, self._resets, None)
            identity = (stat.st_dev, stat.st_ino)
            if self._identity is not None and (identity != self._identity or stat.st_size < self.offset):
                self._restart()
                self._resets += 1
            self._identity = identity
            if stat.st_size > self.offset:
                self._consume(self._read_new(stat.st_size))
            return TailState(True, tuple(self._rows), tuple(self._bad), bool(self._partial.strip()), self._resets,
                             stat.st_mtime_ns)


class LiveMonitor:
    """One tailer per discovered journal under `<data root>/live/logs`, kept across requests."""

    def __init__(self, data_root: Path):
        self.data_root = Path(data_root)
        self.folder = logs_dir(self.data_root)
        self._tailers: dict[str, JournalTailer] = {}
        self._lock = threading.Lock()

    def _tailer(self, path: Path) -> JournalTailer:
        with self._lock:
            tailer = self._tailers.get(path.name)
            if tailer is None:
                tailer = self._tailers[path.name] = JournalTailer(path)
            return tailer

    def journals(self) -> list[tuple[Path, TailState]]:
        return [(p, self._tailer(p).poll()) for p in discover(self.folder, JOURNAL_SUFFIX)]

    def journal(self, name: str) -> TailState | None:
        path = find(self.folder, JOURNAL_SUFFIX, name)
        return None if path is None else self._tailer(path).poll()

    def log_path(self, name: str) -> Path | None:
        return find(self.folder, LOG_SUFFIX, name)


# ---------------------------------------------------------------- the performance path


def check_no_plumbing(rows: Iterable[Mapping[str, Any]]) -> None:
    leaked = [r for r in rows if paper_plumbing.is_plumbing(r)]
    if leaked:
        dates = ", ".join(str(r.get("date")) for r in leaked)
        raise PlumbingLeakError(f"{len(leaked)} plumbing row(s) reached a performance series: {dates}")


def _total(positions: Any) -> float | None:
    if not isinstance(positions, Mapping):
        return None
    values = [v for v in positions.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return float(sum(values)) if values else None


def _reconciled(value: Any) -> bool | None:
    return value.get("ok") if isinstance(value, Mapping) and isinstance(value.get("ok"), bool) else None


def _number(value: Any) -> float | None:
    """A finite number or None (sanitised rows already carry null for NaN; odd types are dropped, not raised)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) else None if value is None else str(value)


def _flag(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


# One close row's fields as the performance series and the last-close card read them (field -> reader).
CLOSE_FIELDS: dict[str, tuple[str, Callable[[Any], Any]]] = {
    "date": ("date", _text), "contract": ("contract", _text), "target": ("target", _number),
    "expected": ("expected", _total), "actual": ("actual", _total), "reconciled_ok": ("reconciled", _reconciled),
    "exposure": ("exposure", _number), "slippage_ticks": ("slippage_ticks", _number), "sent": ("sent", _flag),
    "refused": ("refused", _text), "error": ("error", _text), "halted": ("halted", _flag),
}
LAST_CLOSE_EXTRA: dict[str, tuple[str, Callable[[Any], Any]]] = {
    "close_px": ("close_px", _number), "blocked": ("blocked", _text),
}


def close_fields(row: Mapping[str, Any], fields: Mapping[str, tuple[str, Callable[[Any], Any]]] = CLOSE_FIELDS
                 ) -> dict[str, Any]:
    """A close row's typed fields, each through its reader (position maps become totals; odd types become None)."""
    return {name: read(row.get(key)) for name, (key, read) in fields.items()}


def performance_series(rows: Sequence[JournalRow],
                       keep: Callable[[Iterable[Mapping]], list] = paper_plumbing.performance_rows) -> dict:
    """Target against actual over the close rows that may be read as performance (LV2)."""
    data = [r.data for r in rows]
    line_of = {id(r.data): r.line_no for r in rows}
    kept = keep(data)
    check_no_plumbing(kept)
    close_rows = [r for r in kept if r.get("type") == "close"]
    closes = [close_fields(r) for r in close_rows]
    columns = {name: [c[name] for c in closes] for name in CLOSE_FIELDS}
    return {"plumbing_rows_skipped": len(data) - len(kept), **columns,
            "t": [_midnight_utc(d) for d in columns["date"]], "line_no": [line_of[id(r)] for r in close_rows]}


def _midnight_utc(date: Any) -> int | None:
    """Epoch seconds at 00:00 UTC of an ISO session date (the charts' axis), or None for a missing date."""
    try:
        day = dt.date.fromisoformat(str(date)[:10])
    except ValueError:
        return None
    return int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())


def last_close(rows: Sequence[JournalRow]) -> Mapping[str, Any] | None:
    """The latest close row that may be read as performance (plumbing rows dropped by `performance_rows`).

    The API reads it with `close_fields(row, {**CLOSE_FIELDS, **LAST_CLOSE_EXTRA})`, the performance coercion."""
    kept = paper_plumbing.performance_rows([r.data for r in rows])
    check_no_plumbing(kept)
    closes = [r for r in kept if r.get("type") == "close"]
    return closes[-1] if closes else None


def exposure(path: Path) -> dict | None:
    """`paper_plumbing.exposure_summary`, or None when the journal is missing or cannot be read yet."""
    if not path.is_file():
        return None
    try:
        return paper_plumbing.exposure_summary(path)
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------- kill switch, env and times


def kill_switch_on(data_root: Path) -> bool:
    return live_guards.kill_switch_on(str(Path(data_root).joinpath(*KILL_PARTS)))


def mask_account(account: str | None) -> str | None:
    if not account or not account.strip():
        return None
    text = account.strip()
    match = ACCOUNT_ID.fullmatch(text)
    if match:
        return match.group(1) + "*" * len(match.group(2))
    return text[:2] + "*" * max(len(text) - 2, 0)


def mask_accounts(text: str, known: Iterable[str | None] = ()) -> str:
    """Every IB-style account id masked, and every `known` account value (the configured id) as stars."""
    for value in known:
        value = (value or "").strip()
        if len(value) >= MIN_KNOWN_ACCOUNT_CHARS:
            text = text.replace(value, "*" * len(value))
    return ACCOUNT_ID.sub(lambda m: m.group(1) + "*" * len(m.group(2)), text)


def _host(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    host = value.strip()
    if host == "localhost":
        return host
    try:
        return host if ipaddress.ip_address(host).is_loopback else NOT_LOOPBACK
    except ValueError:
        return NOT_LOOPBACK


def _port(value: str | None) -> int | None:
    text = (value or "").strip()
    return int(text) if text.isdigit() and 0 < int(text) < 65536 else None


def live_env(env: Mapping[str, str]) -> dict:
    """What the paper book would run with: loopback host and port values, everything else set or unset only."""
    return {
        "ib_host": _host(env.get("IB_HOST")),
        "ib_port": _port(env.get("IB_PORT")),
        "account_masked": mask_account(env.get("IB_ACCOUNT_ID")),
        "delayed_flag_set": paper_plumbing.delayed_flag(env),
        "volman_c_set": bool((env.get("VOLMAN_C") or "").strip()),
        "base_usd_rate_set": bool((env.get("IB_BASE_USD_RATE") or "").strip()),
    }


def today_et(now: dt.datetime | None = None) -> dt.date:
    return (now or dt.datetime.now(dt.timezone.utc)).astimezone(NEW_YORK).date()


def next_times(today: dt.date) -> dict:
    """Decision and order times (ET, regular close) and the MNQ contract the book holds with its roll date."""
    contract = mnq_roll.front_month(today)
    return {"decision_et": DECISION_ET, "order_et": ORDER_ET, "contract": contract.symbol,
            "roll_date": mnq_roll.roll_date(contract).isoformat(), "today_et": today.isoformat()}


# ---------------------------------------------------------------- Nautilus logs


@dataclass(frozen=True)
class LogLine:
    line_no: int
    ts: str | None
    ts_epoch_s: int | None
    level: str | None
    trader: str | None
    component: str | None
    message: str


def _epoch_s(stamp: str) -> int | None:
    whole_seconds = stamp.partition(".")[0]
    try:
        parsed = dt.datetime.fromisoformat(whole_seconds).replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None
    return math.floor(parsed.timestamp())


def parse_log_line(text: str, line_no: int, known: Sequence[str | None] = ()) -> LogLine:
    match = LOG_LINE.match(text)
    if match is None:
        return LogLine(line_no, None, None, None, None, None, mask_accounts(text, known))
    stamp = match["ts"] + "Z"
    return LogLine(line_no, stamp, _epoch_s(match["ts"]), match["level"], match["trader"], match["component"].strip(),
                   mask_accounts(match["message"], known))


def parse_log_text(text: str, tail: int, known: Sequence[str | None] = ()) -> list[LogLine]:
    """The last `tail` non-empty lines, parsed; line numbers count every physical line."""
    numbered = [(n, line.rstrip("\r")) for n, line in enumerate(text.split("\n"), start=1) if line.strip()]
    return [parse_log_line(line, n, known) for n, line in numbered[-tail:]] if tail > 0 else []


@dataclass(frozen=True)
class LogFile:
    name: str
    size_bytes: int
    mtime_ns: int
    plumbing: bool


def log_files(data_root: Path) -> list[LogFile]:
    """The Nautilus logs under live/logs (discovered, sorted by name); a log named PLUMBING is a plumbing run."""
    out = []
    for path in discover(logs_dir(data_root), LOG_SUFFIX):
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        out.append(LogFile(path.name, stat.st_size, stat.st_mtime_ns, "PLUMBING" in path.name.upper()))
    return out
