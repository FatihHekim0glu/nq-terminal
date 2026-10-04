"""The documents may not state a G2 result that no results file supports.

The G2 measurements are written to `g2_windows/results.md` and the verdict to `g2_windows/verdict.md`. The README
status and the hand-over must not say that G2 passed or that the measuring was done in a quiet window, and they must
point to those files. (The W5B wave filled the earlier G2 placeholders from them, so no placeholder is left.)
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
README = DOCS / "README.md"
HANDOVER = DOCS / "handover_windows.md"
RESULTS = "g2_windows/results.md"
VERDICT = "g2_windows/verdict.md"
BANNED = ("automated pass", "done alone, in a quiet window", "was done alone")


def _paragraph(path: Path, marker: str) -> str:
    text = path.read_text(encoding="utf-8")
    return next(line for line in text.splitlines() if marker in line)


def test_readme_status_does_not_claim_a_g2_result():
    paragraph = _paragraph(README, "Wave DEC1 (3 October 2026)")
    for phrase in BANNED:
        assert phrase not in paragraph


def test_readme_status_points_to_the_g2_results_and_verdict():
    paragraph = _paragraph(README, "Wave DEC1 (3 October 2026)")
    assert RESULTS in paragraph
    assert VERDICT in paragraph
    assert "{{G2" not in paragraph


def test_handover_owner_rows_line_does_not_claim_a_g2_result():
    line = _paragraph(HANDOVER, "Owner-attended rows are still pending")
    for phrase in BANNED:
        assert phrase not in line
    assert VERDICT in line
    assert "{{G2" not in line


def test_handover_names_the_results_document_in_its_build_table():
    rows = [line for line in HANDOVER.read_text(encoding="utf-8").splitlines() if line.startswith("| D5 step 2")]
    assert len(rows) == 1
    assert re.search(r"g2_windows/results\.md", rows[0])
    assert "{{G2" not in rows[0]
