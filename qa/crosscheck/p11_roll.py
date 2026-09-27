"""Reference for ROLL, the roll calendar (TASKS Phase 11; ANALYTICS MV10, gaps as MV2), dumped as `roll` bundles.

The terminal finds rolls with numpy (`bars.find_rolls`: positions where `instrument_id` differs from the row
before). The reference walks the rows one by one in plain Python, after putting them in time order and dropping
every row dated on or after the fence (2022-01-01):

- a roll is a row whose `instrument_id` differs from the previous kept row's;
- `gap_pts = offset_t - offset_(t-1)`; `gap_pct = 100 * gap_pts / c_none_(t-1)`, null when that close is missing,
  zero or not finite;
- `per_year` counts rolls by the calendar year of the roll row's date.

Where the dump carries `qa_rolls_total` (the count `results/qa_report_universe.json` recorded for the root), it is
a second reference for the terminal's `count` (`count_vs_qa_report`).

Wired as the `roll` kind in `dumps.BUNDLE_INPUTS` (the same inputs as `BUNDLE_INPUTS` here) and in
`compare.BUNDLE_REFERENCES` (`P11_ROLL_REFERENCES`).
"""
from __future__ import annotations

import math

from crosscheck.reference import Ref

BUNDLE_INPUTS = ("dates", "t", "instrument_id", "offset", "c_none", "qa_rolls_total")
FENCE = "2022-01-01"
SOURCE = "plain Python walk over the time-ordered rows before 2022-01-01: instrument_id changes, offset steps"
QA_SOURCE = "results/qa_report_universe.json candidates.<root>.qa.rolls_total"


def _number(value) -> float | None:
    if value is None:
        return None
    x = float(value)
    return x if math.isfinite(x) else None


def _rows(inputs: dict) -> list[tuple]:
    rows = zip(inputs["dates"], inputs["t"], inputs["instrument_id"], inputs["offset"], inputs["c_none"],
               strict=True)
    kept = [row for row in rows if str(row[0])[:10] < FENCE]
    return sorted(kept, key=lambda row: int(row[1]))


def walk(inputs: dict) -> list[dict]:
    """One dict per roll: date, t, from_id, to_id, gap_pts, gap_pct, close_before."""
    rows, out = _rows(inputs), []
    for prev, row in zip(rows, rows[1:]):
        if int(row[2]) == int(prev[2]):
            continue
        a, b, close = _number(row[3]), _number(prev[3]), _number(prev[4])
        gap = None if a is None or b is None else a - b
        pct = 100.0 * gap / close if gap is not None and close not in (None, 0.0) else None
        out.append({"date": str(row[0])[:10], "t": int(row[1]), "from_id": int(prev[2]), "to_id": int(row[2]),
                    "gap_pts": gap, "gap_pct": pct, "close_before": close})
    return out


def roll_references(inputs: dict) -> dict:
    rolls = walk(inputs)
    per_year: dict[str, int] = {}
    for r in rolls:
        per_year[r["date"][:4]] = per_year.get(r["date"][:4], 0) + 1
    refs = {"count": Ref(len(rolls), SOURCE), "per_year": Ref(per_year, SOURCE)}
    for key in ("t", "from_id", "to_id", "gap_pts", "gap_pct", "close_before"):
        refs[key] = Ref([r[key] for r in rolls], SOURCE)
    total = inputs.get("qa_rolls_total")
    if total is not None:
        refs["count_vs_qa_report"] = Ref(int(total), QA_SOURCE, against="count")
    return refs


P11_ROLL_REFERENCES = {"roll": roll_references}
