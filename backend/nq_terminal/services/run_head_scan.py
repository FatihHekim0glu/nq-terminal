"""The head of a result.json without decoding its large arrays (V031B: the cold HOME run list).

A row of the run list reads a few top-level members of a run's result.json (config, summary, balance and coverage
checks, the counts and totals, `data`) and whether its strategy log holds `instruments` or `snapshots`. The large
members (`trades`, `fills`, `strategy_log`) are nearly all of the bytes: 224 MB over 76 runs on the real lab on
7 October 2026, where a full decode of every file took about 0.5 s and the old head's sanitising of the strategy-log
metadata (exits, trades and marks) a further 1.3 s.

The research writer (`backtests/run_base.py`) writes `json.dumps(doc, indent=1, default=str, allow_nan=False)`, through
`Path.write_text`, so with LF or CRLF line ends. In that layout a JSON string never holds a raw line break, a member of
the top-level object starts a line with exactly one space before its key, a member of a depth-one object starts a line
with exactly two, and every deeper line has more. `framed_head` finds the top-level members by that mark alone, decodes
each small member on its own and only checks the frame of a large one (it opens and closes on lines of its own at one
space), so its bytes are never decoded. It answers None, and the caller decodes the whole file as before, for any other
layout or anything it cannot prove: no `{` first, a member mark that is not followed by a key and `": `, a small member
that does not decode, a large member whose frame is not the writer's, a duplicated key, bytes after the closing brace.
A member mark inside a nested value of some other layout leaves the member before it unbalanced, so that member does not
decode or its frame fails. The one thing taken on trust is the inside of a large member whose frame is intact: a file
damaged there, which a full decode calls unreadable, gives its head here. The writer never leaves one (a write cut short
loses the closing brace, and that file goes to the full decoder); the run's detail view still decodes the whole file.

Decoding a member follows `run_curves.kept_from`: orjson, unless it refuses the bytes (NaN and Infinity tokens) or the
value holds a float of magnitude at least 2**63 (an integer wider than 64 bits), when the standard decoder reads them.

Pure functions of the bytes: no I/O, no price read.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable

from nq_terminal.services.run_curves import _fast, _has_wide_float

MEMBER_MARK = b'\n "'  # a top-level member: a line with one space before its key
LOG_MEMBER_MARK = b'\n  "'  # a member of a depth-one object: two spaces
KEY_END = b'": '
WHITESPACE = b" \t\r\n"
OPENERS = {ord("["): ord("]"), ord("{"): ord("}")}
SMALL_SCALAR_BYTES = 4096  # a large member that is not an array or object is decoded when it is at most this long
MAX_KEY_BYTES = 1024


@dataclass(frozen=True)
class FramedHead:
    """The small top-level members in file order, and what the frame of the strategy log showed."""

    members: dict[str, Any]
    log_is_object: bool  # the strategy log member is an object (absent, null or a list: False)
    log_keys: frozenset[str]  # which of the asked strategy-log keys are members of it


def decode(raw: bytes) -> Any:
    """One JSON value as `kept_from` would keep it; ValueError when neither decoder reads it."""
    if _fast is not None:
        try:
            value = _fast.loads(raw)
        except _fast.JSONDecodeError:
            pass
        else:
            if not _has_wide_float(value):
                return value
    return json.loads(raw.decode("utf-8"))


def _last_byte(raw: bytes, end: int, start: int) -> int:
    """The index of the last byte before `end` that is not JSON whitespace (start - 1 when there is none)."""
    i = end - 1
    while i >= start and raw[i] in WHITESPACE:
        i -= 1
    return i


def _members(raw: bytes) -> list[tuple[str, int, int]] | None:
    """(key, value start, value end) of every top-level member, or None when the layout is not the writer's."""
    if not raw.startswith(b"{"):
        return None
    close = _last_byte(raw, len(raw), 0)
    if close < 2 or raw[close] != ord("}") or raw[close - 1] != ord("\n"):
        return None
    marks = []
    at = raw.find(MEMBER_MARK, 0, close)
    if at not in (1, 2) or raw[1:at] not in (b"", b"\r"):
        return None
    while at != -1:
        marks.append(at)
        at = raw.find(MEMBER_MARK, at + 1, close)
    out = []
    for n, mark in enumerate(marks):
        key_start = mark + 2
        key_end = raw.find(KEY_END, key_start + 1, min(key_start + MAX_KEY_BYTES, close))
        if key_end == -1:
            return None
        try:
            key = decode(raw[key_start:key_end + 1])
        except ValueError:
            return None
        if not isinstance(key, str):
            return None
        last = n == len(marks) - 1
        stop = close - 1 if last else marks[n + 1]
        end = _last_byte(raw, stop, key_end + 3) + 1
        if not last:
            if end <= key_end + 3 or raw[end - 1] != ord(","):
                return None
            end = _last_byte(raw, end - 1, key_end + 3) + 1
        if end <= key_end + 3:
            return None
        out.append((key, key_end + 3, end))
    return out


def _framed(raw: bytes, start: int, end: int) -> bool:
    """A large member's frame: `[]`/`{}`, or an opener whose closer ends a line holding one space before it."""
    opener = raw[start]
    closer = OPENERS.get(opener)
    if closer is None or raw[end - 1] != closer:
        return False
    if end - start == 2:
        return True
    return raw[start + 1] in WHITESPACE and raw[end - 3:end - 1] == b"\n "


def framed_head(raw: bytes, *, large: Iterable[str], log_key: str, log_probe: Iterable[str]) -> FramedHead | None:
    """The head of a result.json in the writer's layout (see the module docstring), or None."""
    members = _members(raw)
    if members is None:
        return None
    large, probes = frozenset(large), tuple(log_probe)
    keys = [key for key, _, _ in members]
    if len(set(keys)) != len(keys):
        return None
    kept: dict[str, Any] = {}
    log_is_object, log_keys = False, frozenset()
    for key, start, end in members:
        if key not in large or (raw[start] not in OPENERS and end - start <= SMALL_SCALAR_BYTES):
            try:
                value = decode(raw[start:end])
            except ValueError:
                return None
            if key not in large:
                kept[key] = value
            elif key == log_key:
                log_is_object = isinstance(value, dict)
                log_keys = frozenset(p for p in probes if log_is_object and p in value)
            continue
        if not _framed(raw, start, end):
            return None
        if key == log_key:
            log_is_object = raw[start] == ord("{")
            if log_is_object:
                found = _log_member_keys(raw, start, end)
                if found is None:
                    return None
                log_keys = frozenset(p for p in probes if p in found)
    return FramedHead(kept, log_is_object, log_keys)


def _log_member_keys(raw: bytes, start: int, end: int) -> set[str] | None:
    """The keys of a depth-one object's members (lines with two spaces before the key), in one pass over its bytes."""
    keys = set()
    at = raw.find(LOG_MEMBER_MARK, start, end)
    while at != -1:
        key_start = at + 3
        key_end = raw.find(KEY_END, key_start + 1, min(key_start + MAX_KEY_BYTES, end))
        if key_end == -1:
            return None
        try:
            key = decode(raw[key_start:key_end + 1])
        except ValueError:
            return None
        if not isinstance(key, str):
            return None
        keys.add(key)
        at = raw.find(LOG_MEMBER_MARK, key_end, end)
    return keys
