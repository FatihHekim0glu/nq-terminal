"""The documents of release 0.1.1 name the right version, keep the 0.1.0 figures as history and carry the real values.

0.1.1 caps the maths thread pools of the desktop backend server (`nq_terminal/threadcaps.py`). The G2 files record the
0.1.1 re-measure of 4 October 2026 next to the 0.1.0 (W5C) and W5B figures. The three build-dependent values (installer SHA256, installer bytes and tag) were filled in after the build and the
tag. They sit in the README and in sections 1, 2 and 7 of the hand-over, never in section 10
(test_handover_release_procedure.py).
"""
from __future__ import annotations

import re
from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
DOCS = TERMINAL / "docs" / "desktop"
README = TERMINAL / "README.md"
HANDOVER = DOCS / "handover_windows.md"
RESULTS = DOCS / "g2_windows" / "results.md"
VERDICT = DOCS / "g2_windows" / "verdict.md"
VALUES = ("3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc", "3,253,307", "desktop-v0.1.1")
PLACEHOLDER_PATTERN = re.compile(r"\{\{[^}]*\}\}")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_readme_names_0_1_1_as_the_current_release_and_carries_the_three_values():
    text = _text(README)
    assert "desktop-v0.1.1%20Windows" in text
    assert "desktop-v0.1.0%20Windows" not in text
    for value in VALUES:
        assert value in text, value
    assert "Next: 0.1.1" not in text


def test_readme_status_states_the_verdict_and_the_idle_figure():
    status = _text(README).split("## Status")[1].split("## Highlights")[0]
    assert "AUTOMATED PASS, OWNER ROWS PENDING" in status
    assert "477.3 MB" in status
    assert "g2_windows/verdict.md" in status
    assert "505.4 MB" in status, "the 0.1.0 reading stays as history"


def test_handover_makes_0_1_1_current_and_keeps_the_0_1_0_values_as_history():
    text = _text(HANDOVER)
    for value in VALUES:
        assert value in text, value
    assert "nq-lab terminal_0.1.1_x64-setup.exe" in text
    assert "-Version 0.1.1" in text
    assert "-Tag desktop-v0.1.1" in text
    assert "A follow-up release, 0.1.1, is planned" not in text
    assert "2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590" in text, "the 0.1.0 hash stays as history"


def test_no_placeholder_is_left_in_the_documents():
    for path in (README, HANDOVER, DOCS / "smartscreen.md", RESULTS, VERDICT):
        assert not PLACEHOLDER_PATTERN.findall(_text(path)), path.name


def test_verdict_is_an_automated_pass_with_every_row_inside_its_ceiling():
    text = _text(VERDICT)
    verdict = text.split("## Verdict")[1].split("###")[0]
    assert "**AUTOMATED PASS, OWNER ROWS PENDING.**" in verdict
    assert "477.3 MB" in verdict
    assert "500 MB" in verdict
    assert "Rows over their ceiling" not in text
    assert "is not passed" not in verdict


def test_verdict_says_what_was_not_re_run_in_0_1_1():
    pending = _text(VERDICT).split("### Pending, not run")[1].split("## ")[0]
    for needle in ("measure artefact", "soak", "minimise", "T8", "Owner-attended"):
        assert needle in pending, needle


def test_results_carry_the_0_1_1_rows_the_thread_caps_and_the_0_1_0_history():
    text = _text(RESULTS)
    head = text.split("## 1. Read this first")[0]
    assert "0.1.1" in head.splitlines()[0]
    for figure in ("477.3 MB", "453.0", "484.4", "3,192.5", "2,797", "1,401.5", "316.7", "537.6", "38.4", "56.9"):
        assert figure in head, figure
    for figure in ("68 to 13", "1,790 to 369", "262.6 to 246.1", "OPENBLAS", "NUMEXPR"):
        assert figure in head, figure
    assert "505.4 MB (492.4 to 508.4)" in text, "the 0.1.0 idle reading stays as history"
    assert "## 13. W5B against W5C" in text


def test_results_say_the_thread_count_at_the_reading_point_is_not_the_attach_driver_figure():
    head = _text(RESULTS).split("## 1. Read this first")[0]
    assert "24 to 28" in head
    assert "17" in head and "33 s" in head
    assert "port 8765" in head


def test_the_documents_carry_the_published_installer_size_and_not_the_measure_build_size():
    for path in (README, HANDOVER):
        assert "3,253,307" in _text(path), path.name
        assert "3,253,511" not in _text(path), path.name
