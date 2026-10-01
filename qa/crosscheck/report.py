"""Plain-text report of the comparison rows (ASCII only, for the Windows console)."""
from __future__ import annotations

import math
from collections import Counter

from crosscheck.compare import FAIL, INFO, PASS, SKIP, Row

STATUSES = (PASS, FAIL, SKIP, INFO)


def _num(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, (list, tuple, dict)):
        return f"<{len(value)} values>"
    if isinstance(value, str):  # a word reference (for example the SPA superior set), compared exactly
        return value
    value = float(value)
    return "nan" if math.isnan(value) else f"{value:.17g}"


def _diff(row: Row) -> str:
    if row.status == SKIP or (isinstance(row.diff, float) and math.isnan(row.diff) and row.value is None):
        return "-"
    label = "max diff" if isinstance(row.ref, (list, tuple, dict)) else "diff"
    return f"{label} {row.diff:+.3e}"


def _line(row: Row) -> str:
    text = (f"  {row.status:<4}  {row.metric:<30} {row.side:<15} value {_num(row.value):<24} "
            f"ref {_num(row.ref):<24} {_diff(row)}")
    detail = f"[{row.source}]" + (f" {row.note}" if row.note else "")
    return f"{text}  {detail}"


def lines(rows: list[Row]) -> list[str]:
    out, current = [], None
    for row in rows:
        if row.case != current:
            current = row.case
            out.append(f"== {current}")
        out.append(_line(row))
    counts = Counter(row.status for row in rows)
    out.append("summary: " + ", ".join(f"{status} {counts.get(status, 0)}" for status in STATUSES))
    return out


def documented(rows: list[Row]) -> list[str]:
    """One line per distinct documented difference, for the end of the report."""
    seen = {}
    for row in rows:
        if row.status == INFO and row.note:
            seen.setdefault(row.source, row.note)
    return [f"  {source}: {note}" for source, note in sorted(seen.items())]
