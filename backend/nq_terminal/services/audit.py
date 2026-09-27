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
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from nq_lab.config import IS_END
from nq_terminal.models.audit import SpecHash
from nq_terminal.models.research import RegistryRow
from nq_terminal.services.files import freeze
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
    return freeze({
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
    })


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
    """For `FileCache.get`: utf-8 with replacement, so a multi-byte character cut by a live append cannot fail it."""
    return parse_oos_log(raw.decode("utf-8", errors="replace"))


def key_set_counts(entries: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    return dict(Counter(e["key_set"] for e in entries))


def caller_counts(entries: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    return dict(Counter(e["caller"] for e in entries))


def parse_since(text: str) -> datetime:
    """An ISO date or date-time; a naive value is read as UTC. ValueError for anything else."""
    stamp = _when(text.strip())
    if stamp is None:
        raise ValueError(f"since must be an ISO date or date-time, got {text!r}")
    return stamp


def filter_entries(entries: Sequence[Mapping[str, Any]], *, caller: str | None,
                   since: str | datetime | None) -> list[Mapping[str, Any]]:
    """Every entry from `caller` written at or after `since`, in file order."""
    floor = parse_since(since) if isinstance(since, str) else since
    return [e for e in entries
            if (caller is None or e["caller"] == caller)
            and (floor is None or ((stamp := _when(e["ts_utc"])) is not None and stamp >= floor))]


def select_entries(entries: Sequence[Mapping[str, Any]], *, caller: str | None, since: str | datetime | None,
                   limit: int, offset: int = 0) -> list[Mapping[str, Any]]:
    """One page of matching entries, oldest first: the `limit` entries that come `offset` entries before the
    newest (offset 0 is the newest window, offset = limit the one before it)."""
    kept = filter_entries(entries, caller=caller, since=since)
    stop = len(kept) - max(offset, 0)
    return kept[max(stop - limit, 0):stop] if limit > 0 and stop > 0 else []


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
