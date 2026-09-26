"""Response models for the audit endpoints: the OOS access log, the openings with their pins, and spec hashes.

Log entries are tolerant carriers (`extra="allow"`): the four key sets of `results/oos_access_log.jsonl` differ, and
a key the gate adds later passes through instead of failing the parse. The raw keys keep their names; `start` and
`end` are sent as ISO 8601 UTC (`2010-09-28T00:00:00+00:00`), or as recorded when they do not parse. The fields
the terminal adds are `line_no`, `key_set`, `is_sealed`, `past_fence` and the `*_epoch_s` axis values.
"""
from __future__ import annotations

from typing import Any

from pydantic import ConfigDict, Field

from nq_terminal.models.common import ResponseModel


class OosLogEntry(ResponseModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    ts_utc: str
    caller: str
    reason: str
    start: str
    end: str
    rows: int | None = None
    symbol: str | None = None
    timeframe: str | None = None
    variant: str | None = None
    sealed: bool | None = None
    spec_sha256: str | None = None
    line_no: int = Field(ge=1)
    key_set: str
    is_sealed: bool
    past_fence: bool | None
    ts_epoch_s: int | None
    start_epoch_s: int | None
    end_epoch_s: int | None


class LineProblem(ResponseModel):
    line_no: int = Field(ge=1)
    message: str


class OosLogFilters(ResponseModel):
    caller: str | None
    since: str | None
    limit: int
    offset: int = 0


class OosLog(ResponseModel):
    """`total`, `key_sets`, `counts_by_caller`, `terminal_reads` and `sealed_reads` describe the whole log;
    `matched` counts the entries the filters keep; `entries` is one page of them (see `offset`), oldest first."""

    log_present: bool
    total: int = Field(ge=0)
    returned: int = Field(ge=0)
    matched: int = Field(ge=0)
    partial_tail: bool
    parse_errors: list[LineProblem]
    key_sets: dict[str, int]
    counts_by_caller: dict[str, int]
    terminal_reads: int = Field(ge=0)
    sealed_reads: int = Field(ge=0)
    fence_end: str
    filters: OosLogFilters
    entries: list[OosLogEntry]


class SealedLogDigest(ResponseModel):
    lines: int = Field(ge=0)
    sha256: str


class Pinned(ResponseModel):
    openings_sha256: str
    sealed_log_lines: int
    sealed_log_sha256: str


class Openings(ResponseModel):
    """The openings file and the gate's own pin checks (True, False, or None when a file cannot be read)."""

    openings: list[dict[str, Any]]
    openings_pin_ok: bool | None
    sealed_log_pin_ok: bool | None
    openings_closed: bool | None
    openings_sha256: str | None
    sealed_log: SealedLogDigest | None
    pinned: Pinned
    label: str


class SpecHash(ResponseModel):
    """One spec re-hashed now (`actual_sha256`) against the hash its result recorded (`recorded_sha256`)."""

    model_config = ConfigDict(frozen=True)

    name: str
    kind: str  # "registry" or "confirmation"
    registered: bool | None
    spec: str
    spec_path: str | None
    recorded_sha256: str | None
    actual_sha256: str | None
    registry_spec_sha_ok: bool | None
    rehash_ok: bool
    note: str | None = None


class SpecHashes(ResponseModel):
    rows: list[SpecHash]
    all_ok: bool
    registry_present: bool
