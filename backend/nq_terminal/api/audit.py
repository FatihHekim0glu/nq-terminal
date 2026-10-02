"""Audit endpoints (GET only): the OOS access log, the openings with their pin status, and spec hashes.

- `/api/audit/oos-log?caller=&since=&limit=&offset=`: whole-log counts (by key set and caller, terminal and sealed
  reads) plus one page of the entries that match the filters: `offset` counts back from the newest (0 is the newest
  window), entries oldest first inside the page; `matched` counts every matching entry. The parsed log is cached on the file's (mtime, size)
  through `FileCache`, so a research workflow appending lines only costs a re-parse.
- `/api/audit/openings`: the openings file, its sha256, the sealed-line digest and the gate's pin checks
  (`oos_gate.check_openings_pin`, `check_sealed_log_pin` via `api.system.sealed_status`), next to the pinned values.
- `/api/audit/spec-hashes`: every registry spec and every sealed-window confirmation re-hashed now.

Files come from `settings.data_root` (the fixture folder in fixture mode); nothing is written.
"""
from __future__ import annotations

import threading
from types import ModuleType

from fastapi import APIRouter, HTTPException, Query, Request

from nq_lab import guards
from nq_lab.config import IS_END
from nq_terminal.api.system import sealed_status
from nq_terminal.models.audit import (
    LineProblem,
    OosLog,
    OosLogEntry,
    OosLogFilters,
    Openings,
    Pinned,
    SealedLogDigest,
    SeverityLevel,
    SpecHashes,
)
from nq_terminal.models.common import DEFAULT_LIMIT, MAX_LIMIT, error_responses
from nq_terminal.services import audit
from nq_terminal.services.files import FileCache, file_cache, sanitise
from nq_terminal.services.research import ResearchDataError
from nq_terminal.settings import Settings

router = APIRouter(prefix="/api/audit", tags=["audit"], responses=error_responses(422, 503))

_STATE_KEY = "audit_files"
_LOCK = threading.Lock()
_EMPTY = audit.ParsedLog(entries=(), errors=(), partial_tail=False)
MAX_FILTER_CHARS = 128


def _oos_gate() -> ModuleType:
    """`nq_lab.oos_gate`, imported on first use so the start path does not load it (D1.1)."""
    from nq_lab import oos_gate

    return oos_gate


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _files(request: Request) -> FileCache:
    """One FileCache per app, created on first use and confined to the data root."""
    state = request.app.state
    with _LOCK:
        cache = getattr(state, _STATE_KEY, None)
        if cache is None:
            cache = file_cache(_settings(request).file_cache_bytes, roots=(_settings(request).data_root,))
            setattr(state, _STATE_KEY, cache)
    return cache


def read_log(request: Request) -> tuple[audit.ParsedLog, bool]:
    """The parsed OOS log and whether the file exists (a missing log is an empty audit, not an error)."""
    try:
        parsed = _files(request).get(_settings(request).oos_log_path, audit.parse_oos_log_bytes, kind="oos-log")
    except FileNotFoundError:
        return _EMPTY, False
    return parsed, True


@router.get("/oos-log", response_model=OosLog)
def oos_log(
    request: Request,
    caller: str | None = Query(default=None, max_length=MAX_FILTER_CHARS),
    since: str | None = Query(default=None, max_length=MAX_FILTER_CHARS),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0, description="entries to skip back from the newest"),
) -> OosLog:
    """Counts over the whole OOS access log, and the latest matching entries (oldest first)."""
    try:
        floor = audit.parse_since(since) if since else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    parsed, present = read_log(request)
    matched = audit.filter_entries(parsed.entries, caller=caller, since=floor)
    entries = audit.select_entries(matched, caller=None, since=None, limit=limit, offset=offset)
    callers = audit.caller_counts(parsed.entries)
    return OosLog(
        log_present=present,
        total=len(parsed.entries),
        returned=len(entries),
        matched=len(matched),
        partial_tail=parsed.partial_tail,
        parse_errors=[LineProblem(line_no=e.line_no, message=e.message) for e in parsed.errors],
        key_sets=audit.key_set_counts(parsed.entries),
        counts_by_caller=callers,
        terminal_reads=callers.get(audit.TERMINAL_CALLER, 0),
        sealed_reads=sum(1 for e in parsed.entries if e["is_sealed"]),
        severity_levels=[SeverityLevel(level=level, meaning=text) for level, text in audit.SEVERITY_LEVELS],
        severity_counts=audit.severity_counts(parsed.entries),
        fence_end=IS_END.date().isoformat(),
        filters=OosLogFilters(caller=caller, since=since, limit=limit, offset=offset),
        entries=[OosLogEntry.model_validate(dict(e)) for e in entries],
    )


def _sealed_digest(settings: Settings) -> SealedLogDigest | None:
    try:
        return SealedLogDigest(**_oos_gate().sealed_log_digest(settings.oos_log_path))
    except (OSError, ValueError):
        return None


def _load_openings(settings: Settings) -> list[dict]:
    try:
        return sanitise(_oos_gate().load_openings(settings.openings_path))
    except (OSError, ValueError, AttributeError):
        return []


@router.get("/openings", response_model=Openings)
def openings(request: Request) -> Openings:
    """The openings file, its hash and the gate's own pin checks against `guards.SEALED_GATE_PINS`."""
    settings = _settings(request)
    status = sealed_status(settings)
    pins = guards.SEALED_GATE_PINS
    return Openings(
        openings=_load_openings(settings),
        openings_pin_ok=status.openings_pin_ok,
        sealed_log_pin_ok=status.sealed_log_pin_ok,
        openings_closed=status.openings_closed,
        openings_sha256=audit.sha256_or_none(settings.openings_path),
        sealed_log=_sealed_digest(settings),
        pinned=Pinned(openings_sha256=pins["openings_sha256"], sealed_log_lines=pins["sealed_log_lines"],
                      sealed_log_sha256=pins["sealed_log_sha256"]),
        label=audit.SEALED_LABEL,
    )


@router.get("/spec-hashes", response_model=SpecHashes)
def spec_hashes(request: Request) -> SpecHashes:
    """Every registry spec and sealed-window confirmation spec, re-hashed now against its recorded sha256.

    503 while results/registry.csv is half written (a rebuild in progress), never a verdict over a short list."""
    root = _settings(request).data_root
    try:
        registry = audit.read_registry(root)
    except ResearchDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    rows = audit.spec_hash_rows(root, registry or ())
    registry_ok = registry is not None and all(r.rehash_ok for r in rows if r.kind == "registry")
    return SpecHashes(rows=rows, all_ok=bool(rows) and registry_ok and all(r.rehash_ok for r in rows),
                      registry_present=registry is not None)
