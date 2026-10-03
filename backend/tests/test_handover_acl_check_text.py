"""The ACL check in the hand-over runbook describes the folder and the files inside it separately.

A protected folder shows `(OI)(CI)(F)` with no `(I)`; the files inside inherit those three entries and so
show `(I)(F)`. Telling the owner that no line may carry `(I)` makes a correct install look wrong.
"""
from __future__ import annotations

from pathlib import Path

DOC = Path(__file__).resolve().parents[2] / "docs" / "desktop" / "handover_windows.md"


def _check_section() -> str:
    text = DOC.read_text(encoding="utf-8")
    start = text.index("### Check")
    return text[start : text.index("### Fix", start)]


def test_acl_check_does_not_forbid_inherited_marker_on_files():
    section = _check_section()
    assert "none of them carrying `(I)`" not in section


def test_acl_check_says_files_inside_show_inherited_full_control():
    section = _check_section()
    assert "(I)(F)" in section
    assert "files inside" in section.lower()
