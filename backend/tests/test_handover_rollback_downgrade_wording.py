"""The rollback section must describe the built installer truthfully.

The generated installer script defines ALLOWDOWNGRADES "true" (the Tauri default), so an older installer may be run
over a newer install: the reinstall page offers both "uninstall before installing" and "do not uninstall", and a silent
downgrade is not aborted. Uninstall then install stays the recommended rollback.
"""
from __future__ import annotations

from pathlib import Path

RUNBOOK = Path(__file__).resolve().parents[2] / "docs" / "desktop" / "handover_windows.md"


def _rollback_section() -> str:
    text = " ".join(RUNBOOK.read_text(encoding="utf-8").split())
    start = text.index("### Roll back")
    return text[start : text.index("What a rollback never costs", start)]


def test_rollback_does_not_claim_the_installer_refuses_an_older_version():
    assert "does not offer to install over a newer one" not in _rollback_section()


def test_rollback_says_downgrades_are_allowed_and_both_choices_are_offered():
    section = _rollback_section()
    assert "downgrade" in section
    assert "allows downgrades" in section
    assert '"uninstall before installing" and "do not uninstall"' in section


def test_rollback_still_recommends_uninstall_then_install():
    section = _rollback_section()
    assert "recommended" in section
    assert "uninstall then install" in section
