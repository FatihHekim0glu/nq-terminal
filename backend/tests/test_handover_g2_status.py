"""The documents may not state a G2 result that no results file supports.

The G2 measurements are written to `g2_windows/results.md` by the measuring step. Until that file exists, the README
status and the hand-over must not say that G2 passed or that the measuring was done in a quiet window; they carry a
visible placeholder that the merge step fills from the actual results, and the placeholder is listed in the hand-over's
table of placeholders.
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
README = DOCS / "README.md"
HANDOVER = DOCS / "handover_windows.md"
PLACEHOLDER = "{{G2: gate status and measuring conditions}}"
BANNED = ("automated pass", "done alone, in a quiet window", "was done alone")


def _paragraph(path: Path, marker: str) -> str:
    text = path.read_text(encoding="utf-8")
    return next(line for line in text.splitlines() if marker in line)


def test_readme_status_does_not_claim_a_g2_result():
    paragraph = _paragraph(README, "Wave DEC1 (3 October 2026)")
    for phrase in BANNED:
        assert phrase not in paragraph


def test_readme_status_carries_the_g2_placeholder():
    assert PLACEHOLDER in _paragraph(README, "Wave DEC1 (3 October 2026)")


def test_handover_owner_rows_line_does_not_claim_a_g2_result():
    line = _paragraph(HANDOVER, "Owner-attended rows are still pending")
    for phrase in BANNED:
        assert phrase not in line
    assert PLACEHOLDER in line


def test_handover_lists_the_placeholder_in_its_table():
    rows = [line for line in HANDOVER.read_text(encoding="utf-8").splitlines() if line.startswith("| `{{G2: gate status")]
    assert len(rows) == 1
    assert re.search(r"g2_windows/results\.md", rows[0])
