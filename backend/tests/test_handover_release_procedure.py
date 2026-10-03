"""The release procedure of the hand-over runbook may not write its own result into the stamped tree.

Steps 1 to 6 stamp HEAD, `git diff HEAD` and the untracked files, and release_check.ps1 refuses anything but a clean
commit. A result, date, tag or commit line filled into a tracked file after step 6 would dirty the tree or move HEAD, so
the runbook must say that these lines are recorded in a follow-up docs-only commit made after the tag.
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
HANDOVER = DOCS / "handover_windows.md"
REGISTER = DOCS / "owner_decisions_windows.md"
FOLLOW_UP = "follow-up docs-only commit"


def _section_7() -> str:
    text = HANDOVER.read_text(encoding="utf-8")
    start = text.index("## 7. Release procedure")
    return text[start : text.index("\n## 8.", start)]


def test_release_procedure_records_results_in_a_follow_up_commit():
    assert FOLLOW_UP in _section_7()


def test_release_procedure_does_not_loop_on_the_final_commit():
    assert "Run the whole sequence again after the final commit" not in _section_7()


def test_tag_goes_on_the_commit_release_check_passed_on():
    section = _section_7()
    assert re.search(r"commit that `?release_check(\.ps1)?`? passed on", section)


def test_register_release_tag_names_the_stamped_commit_and_the_follow_up():
    text = REGISTER.read_text(encoding="utf-8")
    start = text.index("### 1.5 The release tag")
    entry = text[start : text.index("\n## 2.", start)]
    assert FOLLOW_UP in entry
    assert "on the final release commit" not in entry
