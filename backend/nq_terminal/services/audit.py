"""Audit services: the OOS access log parser, the openings digest and the spec re-hash (ARCHITECTURE s3.4, RI1, RI2).

Everything here reads; nothing writes. The pin checks themselves stay in `nq_lab.oos_gate` and are called, never
reimplemented (the API layer passes their results through).

OOS log (`results/oos_access_log.jsonl`)
- Four key sets are known (`KEY_SETS`): `basic` (the first screens), `series` (symbol, timeframe, variant), `trades`
  (symbol and schema, the eurodrift trade reads) and `sealed` (the two reads under the 2026-09-26 opening). A line
  whose keys match none of them exactly is kept as `other`, so a new gate key shows up rather than disappearing.
- A complete line that is not a JSON object with the six basic keys (right types) is a parse error with its line
  number. A last line with no newline that does not parse is a write in progress: it is held back (`partial_tail`)
  and is not an error.
- Each entry gains `line_no`, `key_set`, `is_sealed` (`"sealed": true`), `past_fence` (the window ends after
  `IS_END`), and epoch seconds for `ts_utc`, `start` and `end` (chart axes).
- Each entry also gains `severity` (1 to 4) and `alert` (severity 3 or 4), house semantics for OOS's `A` and `R`
  columns (`SEVERITY_LEVELS`): 4 a sealed read; 3 a window that ends past the fence, starts before the in-sample
  start, or cannot be read (the gate refuses such windows, so a logged one needs a look); 2 a read by any caller
  other than the terminal (a research read); 1 a terminal display read.
- The route keeps the log in a compact form (`CompactLog`, W5C D6): the file's raw bytes, one index row per entry
  (byte offset and length, line number, `ts_utc` in epoch microseconds, interned caller and symbol ids, key set,
  severity) and the whole-log counts. Only the page a request asks for is decoded, with the same `_parse_line` and
  `_annotate` as the full parser, so a served entry is the same mapping in content. A log that only grew is indexed
  from its last complete line on (`extend_oos_log`); any other change is indexed again in full. The value weighs
  what it keeps (`CompactLog.retained_bytes`): the bytes plus about 34 bytes a line, where the parsed entries kept
  about 1.6 KB a line. `parse_oos_log` stays the reference parser (the tests compare against it).
- `start` and `end` are served as ISO 8601 UTC (`2010-09-28T00:00:00+00:00`), the form `ts_utc` already has; the
  gate records them as `2010-09-28 00:00:00+00:00`, and a time without an offset is read as UTC. Text that does not
  parse is passed through unchanged, with a None epoch.

Spec hashes: the registry is read through `services.research` (one parser for every view, RI1: a half-written
`registry.csv` raises `ResearchDataError`, never a short list; a missing one reads as None). Every row re-hashes `experiments/<spec>.json` against the row's recorded
`spec_sha256`; every opening in `results/oos_openings.json` re-hashes its spec against the opening's hash and, when
present, the sealed result's. A spec name that is not a plain file stem, or a path that leaves `experiments/`, is
refused and reported, never joined.
"""
from __future__ import annotations

import hashlib
import json
import math
import numbers
import re
import sys
from array import array
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence

from nq_lab.config import IS_END, IS_START
from nq_terminal.models.audit import SpecHash
from nq_terminal.models.research import RegistryRow
from nq_terminal.services.files import FrozenDict, freeze
from nq_terminal.services.research import RegistryMissing, service_for_root

BASIC_KEYS = frozenset({"ts_utc", "caller", "reason", "start", "end", "rows"})
SERIES_KEYS = BASIC_KEYS | {"symbol", "timeframe", "variant"}
KEY_SETS: dict[str, frozenset[str]] = {
    "basic": BASIC_KEYS,
    "series": SERIES_KEYS,
    "trades": BASIC_KEYS | {"symbol", "schema"},
    "sealed": SERIES_KEYS | {"sealed", "spec_sha256"},
}
OTHER = "other"
TERMINAL_CALLER = "terminal"
TEXT_KEYS = ("ts_utc", "caller", "reason", "start", "end")
SPEC_STEM = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")
SEALED_LABEL = "spent window, opened 2026-09-26, descriptive only"
_FENCE = IS_END.to_pydatetime()
_IS_START_S = int(IS_START.timestamp())
SEVERITY_LEVELS: tuple[tuple[int, str], ...] = (
    (1, "terminal display read, inside the in-sample window"),
    (2, "research read by another caller, inside the in-sample window"),
    (3, "window past the fence, before the in-sample start, or unreadable: check it"),
    (4, "sealed read (spent window)"),
)
ALERT_FROM = 3


def severity(entry: Mapping[str, Any]) -> int:
    """The house severity of one annotated log entry (see `SEVERITY_LEVELS`)."""
    if entry.get("is_sealed"):
        return 4
    start = entry.get("start_epoch_s")
    if entry.get("past_fence") is not False or start is None or start < _IS_START_S:
        return 3
    return 1 if entry.get("caller") == TERMINAL_CALLER else 2


@dataclass(frozen=True)
class LineError:
    line_no: int
    message: str


@dataclass(frozen=True)
class ParsedLog:
    entries: tuple[Mapping[str, Any], ...]
    errors: tuple[LineError, ...]
    partial_tail: bool


# ---------------------------------------------------------------- OOS log


def key_set(entry: Mapping[str, Any]) -> str:
    keys = frozenset(entry)
    return next((name for name, known in KEY_SETS.items() if keys == known), OTHER)


def _when(text: Any) -> datetime | None:
    if not isinstance(text, str):
        return None
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    return stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp


def _epoch(stamp: datetime | None) -> int | None:
    return None if stamp is None else math.floor(stamp.timestamp())


def _iso_utc(text: Any, stamp: datetime | None) -> Any:
    """The window bound as ISO 8601 UTC, or the recorded value when it does not parse."""
    return text if stamp is None else stamp.astimezone(timezone.utc).isoformat()


def _shape_problem(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "not a JSON object"
    missing = sorted(BASIC_KEYS - set(obj))
    if missing:
        return "missing keys: " + ", ".join(missing)
    wrong = [k for k in TEXT_KEYS if not isinstance(obj[k], str)]
    rows = obj["rows"]
    if rows is not None and (isinstance(rows, bool) or not isinstance(rows, numbers.Integral)):
        wrong.append("rows")
    return "wrong types: " + ", ".join(wrong) if wrong else None


def _annotate(obj: dict[str, Any], line_no: int) -> Mapping[str, Any]:
    start, end = _when(obj["start"]), _when(obj["end"])
    entry = {
        **obj,
        "start": _iso_utc(obj["start"], start),
        "end": _iso_utc(obj["end"], end),
        "line_no": line_no,
        "key_set": key_set(obj),
        "is_sealed": obj.get("sealed") is True,
        "past_fence": None if end is None else end > _FENCE,
        "ts_epoch_s": _epoch(_when(obj["ts_utc"])),
        "start_epoch_s": _epoch(start),
        "end_epoch_s": _epoch(end),
    }
    level = severity(entry)
    return freeze({**entry, "severity": level, "alert": level >= ALERT_FROM})


def _parse_line(text: str) -> tuple[dict | None, str | None]:
    try:
        obj = json.loads(text)
    except ValueError as exc:
        return None, f"not JSON: {exc.msg}" if isinstance(exc, json.JSONDecodeError) else "not JSON"
    problem = _shape_problem(obj)
    return (None, problem) if problem else (obj, None)


def parse_oos_log(text: str) -> ParsedLog:
    """Every line of the log text, parsed (see the module docstring for the rules)."""
    lines = text.split("\n")
    complete = text.endswith("\n") or text == ""
    entries: list[Mapping[str, Any]] = []
    errors: list[LineError] = []
    partial = False
    for index, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        obj, problem = _parse_line(line)
        if obj is not None:
            entries.append(_annotate(obj, index))
        elif index == len(lines) and not complete:
            partial = True
        else:
            errors.append(LineError(index, problem or "unreadable"))
    return ParsedLog(tuple(entries), tuple(errors), partial)


def parse_oos_log_bytes(raw: bytes) -> ParsedLog:
    """The reference parser over bytes: utf-8 with replacement, so a multi-byte character cut by a live append cannot
    fail it."""
    return parse_oos_log(raw.decode("utf-8", errors="replace"))


# ---------------------------------------------------------------- OOS log, compact form (W5C D6)


NO_TS = -(2**63)  # an index row whose ts_utc does not parse: below every real stamp, and never matches a since
NO_SYMBOL = 0  # symbol id of an entry without a text symbol
_NEWLINE = b"\n"
_EPOCH_UTC = datetime(1970, 1, 1, tzinfo=timezone.utc)
_ONE_US = timedelta(microseconds=1)
_KEY_SET_NAMES: tuple[str, ...] = (*KEY_SETS, OTHER)
_KEY_SET_IDS = {name: index for index, name in enumerate(_KEY_SET_NAMES)}
SEALED_LEVEL = 4  # `severity` gives 4 exactly when an entry is sealed


def _micros(stamp: datetime) -> int:
    """Epoch microseconds of an aware stamp, exact (the order of these is the order of the stamps)."""
    return (stamp - _EPOCH_UTC) // _ONE_US


class _Index:
    """The index rows while they are built; frozen into a `CompactLog` by `finish`. Never shared between threads."""

    def __init__(self) -> None:
        self.starts, self.lengths, self.line_nos = array("q"), array("I"), array("I")
        self.ts_us, self.caller_ids, self.symbol_ids = array("q"), array("I"), array("I")
        self.key_set_ids, self.severities = array("B"), array("B")
        self.callers: list[str] = []
        self.caller_index: dict[str, int] = {}
        self.symbols: list[str | None] = [None]
        self.symbol_index: dict[str, int] = {}
        self.errors: list[LineError] = []

    @classmethod
    def prefix_of(cls, log: "CompactLog", rows: int) -> "_Index":
        """A new index holding the first `rows` rows of `log` (copies: the cached value is never changed)."""
        made = cls()
        for name in ("starts", "lengths", "line_nos", "ts_us", "caller_ids", "symbol_ids", "key_set_ids", "severities"):
            setattr(made, name, getattr(log, name)[:rows])
        made.callers, made.caller_index = list(log.callers), dict(log.caller_index)
        made.symbols = list(log.symbols)
        made.symbol_index = {name: index for index, name in enumerate(log.symbols) if index != NO_SYMBOL}
        made.errors = [e for e in log.errors if e.line_no < log.next_line_no]
        return made

    def _intern(self, table: list, index: dict, name: str) -> int:
        found = index.get(name)
        if found is None:
            found = index[name] = len(table)
            table.append(name)
        return found

    def add(self, obj: dict[str, Any], start: int, length: int, line_no: int) -> None:
        """One entry: the same window, fence and severity rules as `_annotate`, kept as numbers and ids."""
        begin, end = _when(obj["start"]), _when(obj["end"])
        level = severity({"is_sealed": obj.get("sealed") is True, "start_epoch_s": _epoch(begin),
                          "past_fence": None if end is None else end > _FENCE, "caller": obj["caller"]})
        stamp = _when(obj["ts_utc"])
        symbol = obj.get("symbol")
        self.starts.append(start)
        self.lengths.append(length)
        self.line_nos.append(line_no)
        self.ts_us.append(NO_TS if stamp is None else _micros(stamp))
        self.caller_ids.append(self._intern(self.callers, self.caller_index, obj["caller"]))
        self.symbol_ids.append(self._intern(self.symbols, self.symbol_index, symbol)
                               if isinstance(symbol, str) else NO_SYMBOL)
        self.key_set_ids.append(_KEY_SET_IDS[key_set(obj)])
        self.severities.append(level)

    def scan(self, raw: bytes, begin: int, first_line_no: int) -> tuple[bool, int, int]:
        """Index every line of `raw` from byte `begin` (just after a newline, or 0), numbered from `first_line_no`,
        by the rules of `parse_oos_log`. Returns (partial tail, end of the last complete line, next line number)."""
        pieces = raw[begin:].split(_NEWLINE)
        offset, partial = begin, False
        for position, piece in enumerate(pieces):
            line_no = first_line_no + position
            text = piece.decode("utf-8", errors="replace")
            if text.strip():
                obj, problem = _parse_line(text)
                if obj is not None:
                    self.add(obj, offset, len(piece), line_no)
                elif position == len(pieces) - 1:
                    partial = True  # a last line with no newline that does not parse: a write in progress
                else:
                    self.errors.append(LineError(line_no, problem or "unreadable"))
            offset += len(piece) + 1
        return partial, len(raw) - len(pieces[-1]), first_line_no + len(pieces) - 1

    def finish(self, raw: bytes, partial: bool, stable_end: int, next_line_no: int) -> "CompactLog":
        key_sets = {_KEY_SET_NAMES[k]: n for k, n in Counter(self.key_set_ids).items()}
        callers = {self.callers[k]: n for k, n in Counter(self.caller_ids).items()}
        levels = {str(k): n for k, n in sorted(Counter(self.severities).items())}
        return CompactLog(
            raw=raw, starts=self.starts, lengths=self.lengths, line_nos=self.line_nos, ts_us=self.ts_us,
            caller_ids=self.caller_ids, symbol_ids=self.symbol_ids, key_set_ids=self.key_set_ids,
            severities=self.severities, callers=tuple(self.callers), caller_index=FrozenDict(self.caller_index),
            symbols=tuple(self.symbols), errors=tuple(self.errors), partial_tail=partial, stable_end=stable_end,
            next_line_no=next_line_no, key_set_counts=FrozenDict(key_sets), caller_counts=FrozenDict(callers),
            severity_counts=FrozenDict(levels))


@dataclass(frozen=True, eq=False)
class CompactLog:
    """The OOS log as raw bytes plus an index row per entry (see the module docstring). Read-only once built: the
    arrays are never changed after `_Index.finish`, and `extend_oos_log` copies them."""

    raw: bytes
    starts: array  # byte offset of each entry's line
    lengths: array  # bytes in the line, without its newline
    line_nos: array
    ts_us: array  # ts_utc in epoch microseconds, NO_TS when it does not parse
    caller_ids: array  # into `callers`
    symbol_ids: array  # into `symbols`; NO_SYMBOL when the entry has no text symbol
    key_set_ids: array  # into _KEY_SET_NAMES
    severities: array
    callers: tuple[str, ...]
    caller_index: Mapping[str, int]
    symbols: tuple[str | None, ...]
    errors: tuple[LineError, ...]
    partial_tail: bool
    stable_end: int  # bytes up to and including the last newline: an append is indexed from here
    next_line_no: int  # the number of the line that starts at `stable_end`
    key_set_counts: Mapping[str, int]  # whole-log counts, keys in order of first appearance (as Counter gives them)
    caller_counts: Mapping[str, int]
    severity_counts: Mapping[str, int]  # keyed by the level as text, in level order

    def __len__(self) -> int:
        return len(self.starts)

    @property
    def entries(self) -> "LazyEntries":
        """Every entry in file order, decoded only when read."""
        return LazyEntries(self, range(len(self)))

    @property
    def sealed_reads(self) -> int:
        return self.severity_counts.get(str(SEALED_LEVEL), 0)

    def decode(self, row: int) -> Mapping[str, Any]:
        """Index row `row` as the full parser's entry: the same `_parse_line` and `_annotate` on the same text."""
        start = self.starts[row]
        obj, _ = _parse_line(self.raw[start:start + self.lengths[row]].decode("utf-8", errors="replace"))
        return _annotate(obj, self.line_nos[row])

    def rows_matching(self, caller: str | None, floor: datetime | None, rows: Sequence[int] | None = None
                      ) -> Sequence[int]:
        """The rows (of `rows`, else of the whole log) from `caller` written at or after `floor`, in file order."""
        rows = range(len(self)) if rows is None else rows
        if caller is None and floor is None:
            return rows
        wanted = None if caller is None else self.caller_index.get(caller)
        if caller is not None and wanted is None:
            return []
        least = None if floor is None else _micros(floor)
        ids, stamps = self.caller_ids, self.ts_us
        return [r for r in rows if (wanted is None or ids[r] == wanted)
                and (least is None or (stamps[r] != NO_TS and stamps[r] >= least))]

    def count_reads(self, *, caller: str, symbol: str) -> int:
        """Entries from `caller` whose symbol is `symbol` (the instrument page's count), from the index alone."""
        wanted_caller = self.caller_index.get(caller)
        wanted_symbol = next((k for k, name in enumerate(self.symbols) if k != NO_SYMBOL and name == symbol), None)
        if wanted_caller is None or wanted_symbol is None:
            return 0
        return sum(1 for c, s in zip(self.caller_ids, self.symbol_ids) if c == wanted_caller and s == wanted_symbol)

    def retained_bytes(self) -> int:
        """What this value keeps alive, for `FileCache.get(weigh=...)`: the bytes, the arrays (their allocation), the
        interned names, the errors and the count tables."""
        parts: list[Any] = [self, self.raw, self.starts, self.lengths, self.line_nos, self.ts_us, self.caller_ids,
                            self.symbol_ids, self.key_set_ids, self.severities, self.callers, self.caller_index,
                            self.symbols, self.errors, self.key_set_counts, self.caller_counts, self.severity_counts]
        parts.extend(self.callers)
        parts.extend(name for name in self.symbols if name is not None)
        parts.extend(self.severity_counts)
        for error in self.errors:
            parts.extend((error, error.__dict__, error.message))
        return sum(sys.getsizeof(part) for part in parts)


class LazyEntries(Sequence):
    """A read-only sequence of a `CompactLog`'s entries over some of its rows: an item is decoded when it is read,
    and a slice is another view (so a page decodes only its own lines)."""

    __slots__ = ("log", "rows")

    def __init__(self, log: CompactLog, rows: Sequence[int]):
        self.log, self.rows = log, rows

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index):  # type: ignore[override]
        if isinstance(index, slice):
            return LazyEntries(self.log, self.rows[index])
        return self.log.decode(self.rows[index])

    def __iter__(self) -> Iterator[Mapping[str, Any]]:
        return (self.log.decode(row) for row in self.rows)


def compact_oos_log(raw: bytes) -> CompactLog:
    """For `FileCache.get`: the whole log indexed from its first byte (the full parse)."""
    index = _Index()
    return index.finish(raw, *index.scan(raw, 0, 1))


def extend_oos_log(old: CompactLog, raw: bytes) -> CompactLog | None:
    """For `FileCache.get(extend=...)`: when `raw` is `old`'s bytes with more after them, keep `old`'s rows up to
    its last complete line and index only what follows (a half-written last line is read again); else None, and
    the cache parses `raw` in full."""
    if len(raw) <= len(old.raw) or not raw.startswith(old.raw):
        return None
    index = _Index.prefix_of(old, bisect_left(old.starts, old.stable_end))
    return index.finish(raw, *index.scan(raw, old.stable_end, old.next_line_no))


def key_set_counts(entries: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    return dict(Counter(e["key_set"] for e in entries))


def caller_counts(entries: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    return dict(Counter(e["caller"] for e in entries))


def severity_counts(entries: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """Entries per severity level over the whole log, keyed by the level as text."""
    return {str(k): v for k, v in sorted(Counter(e["severity"] for e in entries).items())}


def parse_since(text: str) -> datetime:
    """An ISO date or date-time; a naive value is read as UTC. ValueError for anything else."""
    stamp = _when(text.strip())
    if stamp is None:
        raise ValueError(f"since must be an ISO date or date-time, got {text!r}")
    return stamp


def filter_entries(entries: Sequence[Mapping[str, Any]] | CompactLog, *, caller: str | None,
                   since: str | datetime | None) -> Sequence[Mapping[str, Any]]:
    """Every entry from `caller` written at or after `since`, in file order. Over a `CompactLog` (or a view of one)
    the filters run on the index and the result is a `LazyEntries` view: nothing is decoded here."""
    floor = parse_since(since) if isinstance(since, str) else since
    if isinstance(entries, CompactLog):
        return LazyEntries(entries, entries.rows_matching(caller, floor))
    if isinstance(entries, LazyEntries):
        return LazyEntries(entries.log, entries.log.rows_matching(caller, floor, entries.rows))
    return [e for e in entries
            if (caller is None or e["caller"] == caller)
            and (floor is None or ((stamp := _when(e["ts_utc"])) is not None and stamp >= floor))]


def select_entries(entries: Sequence[Mapping[str, Any]] | CompactLog, *, caller: str | None,
                   since: str | datetime | None, limit: int, offset: int = 0) -> list[Mapping[str, Any]]:
    """One page of matching entries, oldest first: the `limit` entries that come `offset` entries before the
    newest (offset 0 is the newest window, offset = limit the one before it). Over a `CompactLog` only the page's
    lines are decoded."""
    kept = filter_entries(entries, caller=caller, since=since)
    stop = len(kept) - max(offset, 0)
    return list(kept[max(stop - limit, 0):stop]) if limit > 0 and stop > 0 else []


# ---------------------------------------------------------------- openings


def sha256_or_none(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


# ---------------------------------------------------------------- spec hashes


def _inside(path: Path, folder: Path) -> bool:
    try:
        return path.resolve().is_relative_to(folder.resolve())
    except OSError:
        return False


def spec_path(root: Path, spec: str) -> Path | None:
    """`experiments/<spec>.json` when `spec` is a plain file stem inside the folder, else None."""
    if not SPEC_STEM.fullmatch(spec) or spec.strip(".") == "":
        return None
    folder = root / "experiments"
    path = folder / f"{spec}.json"
    return path if _inside(path, folder) else None


def _relative(root: Path, path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return None


def _registry_row(root: Path, row: RegistryRow) -> SpecHash:
    spec = row.spec.strip()
    recorded = row.spec_sha256.strip() or None
    path = spec_path(root, spec)
    actual = sha256_or_none(path) if path is not None else None
    note = ("spec name is not a plain file stem" if path is None
            else "spec file missing" if actual is None
            else "no recorded hash" if recorded is None else None)
    return SpecHash(name=row.name.strip(), kind="registry", registered=row.registered,
                    spec=spec, spec_path=_relative(root, path), recorded_sha256=recorded, actual_sha256=actual,
                    registry_spec_sha_ok=row.spec_sha_ok,
                    rehash_ok=actual is not None and actual == recorded, note=note)


def read_registry(root: Path) -> tuple[RegistryRow, ...] | None:
    """The typed registry rows, or None when the file does not exist; `ResearchDataError` while it is half
    written (the same parser, cache and retry as /api/hypotheses)."""
    try:
        return service_for_root(root).registry_rows()
    except RegistryMissing:
        return None


def _sealed_result_sha(root: Path, caller: str) -> str | None:
    if not SPEC_STEM.fullmatch(caller):
        return None
    try:
        doc = json.loads((root / "results" / "sealed" / f"{caller}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    value = doc.get("spec_sha256") if isinstance(doc, dict) else None
    return value if isinstance(value, str) else None


def _confirmation_row(root: Path, opening: Mapping[str, Any]) -> SpecHash:
    caller, spec = str(opening.get("caller", "")), str(opening.get("spec", ""))
    candidate = root / spec if spec and not Path(spec).is_absolute() else None
    path = candidate if candidate is not None and _inside(candidate, root / "experiments") else None
    actual = sha256_or_none(path) if path is not None else None
    recorded = opening.get("spec_sha256") if isinstance(opening.get("spec_sha256"), str) else None
    sealed = _sealed_result_sha(root, caller)
    ok = actual is not None and actual == recorded and (sealed is None or sealed == recorded)
    note = ("spec path leaves experiments/" if path is None else "spec file missing" if actual is None
            else "sealed result records another hash" if sealed not in (None, recorded)
            else "no sealed result to compare" if sealed is None else None)
    return SpecHash(name=caller, kind="confirmation", registered=None, spec=spec, spec_path=_relative(root, path),
                    recorded_sha256=recorded, actual_sha256=actual, registry_spec_sha_ok=None, rehash_ok=ok, note=note)


def _openings(root: Path) -> list[Mapping[str, Any]]:
    try:
        doc = json.loads((root / "results" / "oos_openings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    items = doc.get("openings", []) if isinstance(doc, dict) else []
    return [o for o in items if isinstance(o, dict)]


def opening_callers(root: Path) -> list[str]:
    """The callers named in the openings file (the sealed-window confirmations), in file order."""
    return [str(o["caller"]) for o in _openings(root) if isinstance(o.get("caller"), str)]


def spec_hash_rows(root: Path, registry: Sequence[RegistryRow] | None = None) -> list[SpecHash]:
    """Registry rows first (file order), then the sealed-window confirmations from the openings file."""
    registry = read_registry(root) if registry is None else registry
    rows = [_registry_row(root, r) for r in registry or ()]
    return rows + [_confirmation_row(root, o) for o in _openings(root)]
