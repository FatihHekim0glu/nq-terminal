"""Accepted amendments (`results/amendment_acceptances.md`), read only.

The amendment files and the result files are frozen and still say "pending"; the acceptance file is the record that
they were accepted, with each file's sha256 at acceptance. The terminal parses its table rows
(`` | `experiments/<file>.json` | `<64 hex>` | ``) and the first UTC time in the text (the acceptance time), then
re-hashes every listed file now, so a file changed after its acceptance shows `unchanged: false`. A listed path
that is not a plain `experiments/<name>.json` is never joined to the data root (its current hash is null).
Each amendment is joined to the registry rows whose `amendment_files` name it.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from nq_terminal.models.research import AcceptedAmendment, AmendmentAcceptances, RegistryRow

SOURCE = "results/amendment_acceptances.md"
ROW = re.compile(r"^\|\s*`(?P<file>[^`|]+)`\s*\|\s*`(?P<sha>[0-9a-f]{64})`\s*\|", re.MULTILINE)
UTC_TIME = re.compile(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b")
EXPERIMENT_FILE = re.compile(r"experiments/(?P<name>[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\.json)")
AMEND_MARK = re.compile(r"_amend(?:ment)?_?\d+\.json$")


@dataclass(frozen=True)
class ParsedAcceptances:
    accepted_utc: str | None
    rows: tuple[tuple[str, str], ...]


def parse_acceptances(text: str) -> ParsedAcceptances:
    """The (file, sha256) table rows in file order and the first UTC time in the text."""
    when = UTC_TIME.search(text)
    rows = tuple((m.group("file").strip(), m.group("sha")) for m in ROW.finditer(text))
    return ParsedAcceptances(accepted_utc=when.group(0) if when else None, rows=rows)


def sha256_file(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _experiment_name(file: str) -> str | None:
    match = EXPERIMENT_FILE.fullmatch(file)
    return match.group("name") if match and ".." not in file else None


def _spec_of(name: str | None) -> str | None:
    if name is None:
        return None
    stem = AMEND_MARK.sub("", name)
    return stem if stem != name else None


def _entry(root: Path, file: str, sha: str, rows: Sequence[RegistryRow],
           hasher: Callable[[Path], str | None]) -> AcceptedAmendment:
    name = _experiment_name(file)
    now = hasher(root / "experiments" / name) if name is not None else None
    users = [r.name for r in rows if name is not None and name in r.amendment_files]
    return AcceptedAmendment(file=file, spec=_spec_of(name), sha256_accepted=sha, sha256_now=now,
                             unchanged=now == sha, rows=users)


def acceptances(root: Path, text: str | None, rows: Sequence[RegistryRow],
                hasher: Callable[[Path], str | None] = sha256_file) -> AmendmentAcceptances:
    """The acceptance block for `/api/registry`; `text` is None when the file does not exist."""
    if text is None:
        return AmendmentAcceptances(found=False, source=SOURCE, accepted_utc=None, all_unchanged=True, amendments=[])
    parsed = parse_acceptances(text)
    items = [_entry(root, file, sha, rows, hasher) for file, sha in parsed.rows]
    return AmendmentAcceptances(found=True, source=SOURCE, accepted_utc=parsed.accepted_utc,
                                all_unchanged=all(a.unchanged for a in items), amendments=items)
