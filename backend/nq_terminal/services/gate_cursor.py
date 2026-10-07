"""The gate log's sealed digest from a cursor: parse only what was appended since the last call (V032G, growth fix 1).

`oos_gate.sealed_log_digest` re-parses the whole gate log, which only grows. The gate's source file is pinned by sha256
in the frozen experiment specs, so the reader lives here, built from the gate's own public pieces: `parse_log` (one
call per line, exactly as `sealed_log_digest` makes them), `check_fragments` (the fail-closed rule for torn lines) and
the pins of `guards.SEALED_GATE_PINS`. backend/tests/test_gate_cursor.py proves every answer equal to the gate's
whole-file functions, refusals included.

How it stays exact. A `SealedLogCursor` covers whole lines only: it ends just after the last LF byte, so the text before
it decodes and splits exactly as it does inside the whole file (an LF byte never sits inside a UTF-8 sequence, and the
CR of a CRLF comes before its LF). Bytes after the last LF (a half-written line, or a lone CR) are evaluated on every
call but never committed. Each call re-hashes the bytes before the cursor (streamed, about 27 ms on the 43 MB log,
linear in it; only the appended bytes are held and parsed); an edit, a truncation or a shrink there forces a full pass.
The text is decoded as the gate reads it (strict UTF-8, universal newlines); bytes that are not UTF-8 are
refused with the whole-file read's own error.

Reads only; the gate module is imported on first use so the start path does not load it (D1.1).
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

NL = "\n"
_EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
_HEX = frozenset("0123456789abcdef")
HASH_CHUNK = 1 << 20  # the prefix is verified in pieces of this size, so no call holds a copy of the log


def _gate() -> ModuleType:
    from nq_lab import oos_gate

    return oos_gate


@dataclass(frozen=True)
class SealedLogCursor:
    """How far a reader got: the byte offset just after the last LF it committed, the line number that follows, the
    sealed lines before the offset, the first fragment there that `check_fragments` refuses (if any), and the sha256 of
    the bytes before the offset."""

    offset: int = 0
    next_line: int = 1
    sealed: tuple[str, ...] = ()
    flagged: tuple[tuple[int, str], ...] = ()
    prefix_sha256: str = _EMPTY_SHA256

    def as_dict(self) -> dict:
        return {"offset": self.offset, "next_line": self.next_line, "sealed": list(self.sealed),
                "flagged": [list(item) for item in self.flagged], "prefix_sha256": self.prefix_sha256}

    @classmethod
    def from_dict(cls, doc: dict) -> "SealedLogCursor":
        """The cursor `as_dict` wrote; ValueError for anything else."""
        try:
            offset, next_line, digest = doc["offset"], doc["next_line"], doc["prefix_sha256"]
            sealed = tuple(doc["sealed"])
            flagged = tuple((number, text) for number, text in doc["flagged"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"not a sealed log cursor: {exc!r}") from exc
        numbers = (offset, next_line, *(number for number, _ in flagged))
        ok = (all(type(n) is int for n in numbers) and offset >= 0 and next_line >= 1 and len(flagged) <= 1
              and isinstance(digest, str) and len(digest) == 64 and set(digest) <= _HEX
              and all(isinstance(s, str) for s in sealed) and all(isinstance(t, str) for _, t in flagged))
        if not ok:
            raise ValueError("not a sealed log cursor")
        return cls(offset, next_line, sealed, flagged, digest)


@dataclass(frozen=True)
class SealedLogScan:
    """One read of the log: the cursor to pass next time (whole lines only), every sealed line and the first refused
    fragment of the whole log (unfinished tail included), and whether the whole log had to be read."""

    cursor: SealedLogCursor
    sealed: tuple[str, ...]
    flagged: tuple[tuple[int, str], ...]
    full_pass: bool

    def digest(self, log_path: Path) -> dict:
        """`oos_gate.sealed_log_digest`'s answer for the log as read: the same count and sha256, or the same refusal."""
        _gate().check_fragments(list(self.flagged), log_path)
        return {"lines": len(self.sealed), "sha256": hashlib.sha256(NL.join(self.sealed).encode("utf-8")).hexdigest()}


def _log_text(raw: bytes) -> str:
    """Bytes of the log as the gate decodes them (`read_text`): strict UTF-8, universal newlines (CRLF and CR read as
    LF)."""
    return raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def _refused(fragment: tuple[int, str], log_path: Path) -> bool:
    gate = _gate()
    try:
        gate.check_fragments([fragment], log_path)
    except gate.OOSAccessError:
        return True
    return False


def _scan_text(text: str, first: int, log_path: Path) -> tuple[int, list[str], list[tuple[int, str]]]:
    """(line count, sealed lines, first refused fragment) of `text`, its first line numbered `first`: the per-line rule
    of `oos_gate.sealed_log_digest`."""
    parse_log = _gate().parse_log
    lines = text.splitlines()
    sealed: list[str] = []
    flagged: list[tuple[int, str]] = []
    for number, line in enumerate(lines, first):
        entries, frag = parse_log(line)
        if frag:
            if not flagged and _refused((number, line), log_path):
                flagged.append((number, line))
        elif entries and entries[0].get("sealed") is True:
            sealed.append(line)
    return len(lines), sealed, flagged


def _hash_prefix(handle, length: int):
    """A sha256 of the first `length` bytes of the open file, read in `HASH_CHUNK` pieces into one reused buffer (no
    copy of the log), or None when the file ends sooner."""
    hasher = hashlib.sha256()
    buffer = bytearray(min(HASH_CHUNK, max(length, 1)))
    view = memoryview(buffer)
    handle.seek(0)
    remaining = length
    while remaining:
        got = handle.readinto(view[:min(len(buffer), remaining)])
        if not got:
            return None
        hasher.update(view[:got])
        remaining -= got
    return hasher


def _resume(handle, cursor: SealedLogCursor | None):
    """(where to start, a sha256 of the bytes before it, full pass?): the cursor when its prefix is unchanged."""
    if cursor is not None and cursor.offset > 0:
        hasher = _hash_prefix(handle, cursor.offset)
        if hasher is not None and hasher.hexdigest() == cursor.prefix_sha256:
            return cursor, hasher, False
    elif cursor is not None and cursor.prefix_sha256 == _EMPTY_SHA256:
        return cursor, hashlib.sha256(), False
    return SealedLogCursor(), hashlib.sha256(), True


def _read_from_start(path: Path, cursor: SealedLogCursor | None):
    """(raw bytes from the start point, start cursor, hasher, full pass?): the file is opened once, its prefix is hashed
    in chunks and only the bytes after the verified cursor are held."""
    with open(path, "rb") if path.exists() else io.BytesIO() as handle:
        start, hasher, full = _resume(handle, cursor)
        handle.seek(start.offset)
        return handle.read(), start, hasher, full


def scan_sealed_log(log_path: Path, cursor: SealedLogCursor | None = None) -> SealedLogScan:
    """Read the log from `cursor` (from the start when it is None or its prefix no longer matches). Never refuses a
    fragment itself (`SealedLogScan.digest` does); raises what the whole-file read raises (OSError,
    UnicodeDecodeError)."""
    path = Path(log_path)
    raw, start, hasher, full = _read_from_start(path, cursor)
    last_lf = raw.rfind(b"\n")
    cut = 0 if last_lf < 0 else last_lf + 1
    try:
        body, tail = _log_text(raw[:cut]), _log_text(raw[cut:])
    except UnicodeDecodeError:
        path.read_text(encoding="utf-8")  # the whole-file read's own error, word for word
        raise
    hasher.update(memoryview(raw)[:cut])
    cut += start.offset
    count, sealed, flagged = _scan_text(body, start.next_line, path)
    committed = SealedLogCursor(offset=cut, next_line=start.next_line + count, sealed=start.sealed + tuple(sealed),
                                flagged=(start.flagged + tuple(flagged))[:1], prefix_sha256=hasher.hexdigest())
    _, tail_sealed, tail_flagged = _scan_text(tail, committed.next_line, path)
    return SealedLogScan(cursor=committed, sealed=committed.sealed + tuple(tail_sealed),
                         flagged=(committed.flagged + tuple(tail_flagged))[:1], full_pass=full)


def sealed_log_digest_from(log_path: Path, cursor: SealedLogCursor | None = None) -> tuple[dict, SealedLogCursor]:
    """(`oos_gate.sealed_log_digest`'s answer, the cursor for the next call), parsing only what follows `cursor`.
    Refuses exactly as the gate does; a caller that must keep the cursor through a refusal uses `scan_sealed_log`."""
    scan = scan_sealed_log(log_path, cursor)
    return scan.digest(log_path), scan.cursor


def check_sealed_digest_pin(got: dict, log_path: Path) -> None:
    """`oos_gate.check_sealed_log_pin` for a digest already in hand: the same comparison, the same refusal."""
    from nq_lab import guards

    pins = guards.SEALED_GATE_PINS
    want = {"lines": pins["sealed_log_lines"], "sha256": pins["sealed_log_sha256"]}
    if got != want:
        raise _gate().OOSAccessError(f"sealed lines of {log_path} are {got}, not the pinned {want} "
                                     "(guards.SEALED_GATE_PINS)")
