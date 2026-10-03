"""One cold-HOME ceiling governs G2, and the register, the stage 1 record and the harness agree on which.

04 D5 and the harness fix the G2 ceiling at 5,000 ms. The stage 1 record derived 4,508 ms; it must be named in the
register as a regression reference, not left as a second competing pass line.
"""
from __future__ import annotations

import re
from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
REGISTER = TERMINAL / "docs/desktop/owner_decisions_windows.md"
STAGE1 = TERMINAL / "docs/desktop/stage1/stage1_numbers.md"
HARNESS_README = TERMINAL / "desktop/harness/README.md"
ROWS = TERMINAL / "desktop/harness/lib/rows.mjs"


def _register_row_11() -> str:
    text = REGISTER.read_text(encoding="utf-8")
    start = text.index("### 1.1 T3")
    return text[start : text.index("### 1.2", start)]


def test_register_names_the_governing_ceiling_and_the_stage1_figure():
    row = _register_row_11()
    assert "4,508" in row
    assert "Which ceiling governs G2" in row
    assert "5,000 ms" in row


def test_stage1_record_does_not_claim_g2_tests_against_4508():
    text = STAGE1.read_text(encoding="utf-8")
    assert not re.search(r"G2 tests (the app )?against 4,508", text)
    assert "owner_decisions_windows.md" in text


def test_harness_readme_and_rows_use_the_governing_ceiling():
    assert "ceiling: 5000" in ROWS.read_text(encoding="utf-8").split("id: 'cold_home'")[1].split("\n")[0]
    readme = HARNESS_README.read_text(encoding="utf-8")
    assert "4,508" in readme
    assert "regression reference" in readme
