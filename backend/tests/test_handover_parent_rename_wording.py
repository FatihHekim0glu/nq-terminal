"""The install-folder guard does not test DELETE on the parent, and the hand-over must say so.

The parent check refuses another account's delete-child, change-permissions, take-ownership or full control. It accepts a
parent that grants another account Modify, which includes DELETE: with that right (and add-subdirectory on the grandparent)
the other account can rename the parent away and plant its own folder. `D:\Apps` under `D:\` is such a parent on this PC.
The runbook, the decision register and the check template must not claim that such a parent is safe.
"""
from __future__ import annotations

from pathlib import Path

DESKTOP_DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
HOOKS = Path(__file__).resolve().parents[2] / "desktop" / "src-tauri" / "windows" / "nsis" / "hooks.nsh"


def _flat(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").split())


def test_runbook_does_not_say_the_protected_folder_is_untouched_by_the_parent_right():
    text = _flat(DESKTOP_DOCS / "handover_windows.md")
    assert "because the protected folder inside it is not touched by that right" not in text


def test_runbook_states_the_rename_limit_and_the_safe_choices():
    text = _flat(DESKTOP_DOCS / "handover_windows.md")
    assert "renamed away" in text
    assert "single-account" in text
    assert "profile default" in text


def test_register_entry_states_the_limit():
    text = _flat(DESKTOP_DOCS / "owner_decisions_windows.md")
    assert "does not test DELETE on the parent" in text


def test_check_template_states_the_limit():
    text = _flat(DESKTOP_DOCS / "checks" / "2026-10-03_custom-install-folder.md")
    assert "rename" in text
    assert "single-account" in text


def test_hooks_comment_names_the_delete_gap():
    assert "DELETE (0x10000) on the parent is not tested" in _flat(HOOKS)
