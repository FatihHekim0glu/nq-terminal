r"""The custom-install-folder check must describe the uninstaller's "delete app data" box as the runbook does.

The box removes only %APPDATA%\dev.nqlab.terminal and %LOCALAPPDATA%\dev.nqlab.terminal. The WebView2 folder the
owner chose (D:\nq-terminal\webview) is never removed by the uninstaller, so the check may not tell the owner it is.
"""
from __future__ import annotations

from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
CHECK = DOCS / "checks" / "2026-10-03_custom-install-folder.md"
RUNBOOK = DOCS / "handover_windows.md"


def _flat(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").split())


def test_check_does_not_claim_uninstaller_removes_webview_folder():
    assert "which the uninstaller removes only if you tick that box" not in _flat(CHECK)


def test_check_states_the_two_folders_the_box_removes_and_the_manual_webview_delete():
    text = _flat(CHECK)
    assert r"%APPDATA%\dev.nqlab.terminal" in text
    assert r"%LOCALAPPDATA%\dev.nqlab.terminal" in text
    assert "delete it by hand" in text


def test_runbook_still_says_the_box_does_not_remove_the_webview_folder():
    assert r"It does not remove `D:\nq-terminal\webview`" in _flat(RUNBOOK)
