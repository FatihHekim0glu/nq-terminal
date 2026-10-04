"""The G2 verdict table says where each reading came from: source, backend and sample size.

Round 2 QA asks that a reader can tell which backend and method produced every figure. A blanket
"smoke build, median of 3" header hid that several rows came from the stage 1 script, another tool or the
fixture backend.
"""
from __future__ import annotations

from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
VERDICT = TERMINAL / "docs/desktop/g2_windows/verdict.md"


def _text() -> str:
    return VERDICT.read_text(encoding="utf-8")


def _within_ceiling_table() -> list[str]:
    lines = _text().split("### Rows within their ceiling")[1].split("###")[0].splitlines()
    return [line for line in lines if line.startswith("|")]


def test_table_has_source_backend_and_n_columns():
    header = [cell.strip() for cell in _within_ceiling_table()[0].strip("|").split("|")]
    assert header[-3:] == ["Source", "Backend", "n"]


def test_every_row_fills_the_provenance_cells():
    rows = _within_ceiling_table()[2:]
    assert len(rows) == 13
    for row in rows:
        cells = [cell.strip() for cell in row.strip("|").split("|")]
        assert len(cells) == 7, row
        assert all(cells[-3:]), row


def test_header_and_summary_no_longer_claim_one_method():
    text = _text()
    assert "Reading (smoke build, median of 3)" not in text
    assert "Measurements on the GNU smoke build against the real lab, desktop caps." not in text


def test_the_methods_that_differ_are_named():
    table = "\n".join(_within_ceiling_table())
    for needle in ("Stage 1", "8797", "t4t5", "Offline demo", "app-launched"):
        assert needle in table, needle


def test_the_apps_own_eq_and_reg_readings_appear():
    text = _text()
    for figure in ("39 ms", "58 ms", "600 ms", "345 ms"):
        assert figure in text, figure
