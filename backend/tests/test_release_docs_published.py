"""The documents of the latest PUBLISHED desktop release name the right version, keep the older figures as history and
carry the real values.

This file was test_release_docs_0_1_1.py. The published release is named once, in the constants below, and every
check reads it from there: when a new release is published its version, tag and the three build-dependent values
(installer SHA256, installer bytes) are changed here and in the documents, and nothing else in this file moves except
the figures it quotes. The build that is not yet published is not read here (test_release_version.py holds that one
together).

0.1.1 caps the maths thread pools of the desktop backend server (`nq_terminal/threadcaps.py`). The G2 files record the
0.1.1 re-measure of 4 October 2026 next to the 0.1.0 (W5C) and W5B figures. The three build-dependent values (installer SHA256, installer bytes and tag) were filled in after the build and the
tag. They sit in the README and in sections 1, 2 and 7 of the hand-over, never in section 10
(test_handover_release_procedure.py).
"""
from __future__ import annotations

import re
from pathlib import Path

PUBLISHED_VERSION = "0.1.1"
PUBLISHED_TAG = f"desktop-v{PUBLISHED_VERSION}"
PUBLISHED_SHA256 = "3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc"
PUBLISHED_BYTES = "3,253,307"
PREVIOUS_VERSION = "0.1.0"
PREVIOUS_SHA256 = "2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590"
INSTALLER = f"nq-lab terminal_{PUBLISHED_VERSION}_x64-setup.exe"

TERMINAL = Path(__file__).resolve().parents[2]
DOCS = TERMINAL / "docs" / "desktop"
README = TERMINAL / "README.md"
HANDOVER = DOCS / "handover_windows.md"
RESULTS = DOCS / "g2_windows" / "results.md"
VERDICT = DOCS / "g2_windows" / "verdict.md"
VALUES = (PUBLISHED_SHA256, PUBLISHED_BYTES, PUBLISHED_TAG)
PLACEHOLDER_PATTERN = re.compile(r"\{\{[^}]*\}\}")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_readme_names_the_published_release_as_current_and_carries_the_three_values():
    text = _text(README)
    assert f"{PUBLISHED_TAG}%20Windows" in text
    assert f"desktop-v{PREVIOUS_VERSION}%20Windows" not in text
    for value in VALUES:
        assert value in text, value
    assert f"Next: {PUBLISHED_VERSION}" not in text


def test_readme_status_states_the_verdict_and_the_idle_figure():
    status = _text(README).split("## Status")[1].split("## Highlights")[0]
    assert "AUTOMATED PASS, OWNER ROWS PENDING" in status
    assert "477.3 MB" in status
    assert "g2_windows/verdict.md" in status
    assert "505.4 MB" in status, f"the {PREVIOUS_VERSION} reading stays as history"


def test_handover_makes_the_published_release_current_and_keeps_the_previous_values_as_history():
    text = _text(HANDOVER)
    for value in VALUES:
        assert value in text, value
    assert INSTALLER in text
    assert f"-Version {PUBLISHED_VERSION}" in text
    assert f"-Tag {PUBLISHED_TAG}" in text
    assert f"A follow-up release, {PUBLISHED_VERSION}, is planned" not in text
    assert PREVIOUS_SHA256 in text, f"the {PREVIOUS_VERSION} hash stays as history"


# The 0.1.2 wave leaves V012 placeholders (double braces, V012, a colon and a name) where release values go: the commit list of the
# hand-over and the G2 placeholder table. The finisher fills them after the tag and then deletes this allowance. Anywhere else a
# placeholder still fails.
FINISHER_PATTERN = re.compile(r"\{\{V012[^}]*\}\}")


def _unfilled(path):
    text = _text(path)
    if path == HANDOVER:
        text = FINISHER_PATTERN.sub("", text)
    return PLACEHOLDER_PATTERN.findall(text)


def test_no_placeholder_is_left_in_the_documents():
    for path in (README, HANDOVER, DOCS / "smartscreen.md", RESULTS, VERDICT):
        assert not _unfilled(path), path.name


def test_a_finisher_placeholder_is_allowed_only_in_the_handover_commit_list():
    assert FINISHER_PATTERN.findall(_text(HANDOVER)), "the commit list carries the V012 placeholders until the finisher fills them"
    for path in (README, DOCS / "smartscreen.md", RESULTS, VERDICT):
        assert not FINISHER_PATTERN.findall(_text(path)), path.name
    assert not PLACEHOLDER_PATTERN.findall(FINISHER_PATTERN.sub("", "{{V012: x}}"))
    assert PLACEHOLDER_PATTERN.findall(FINISHER_PATTERN.sub("", "{{G2: x}}")), "another placeholder is still refused"


def test_verdict_is_an_automated_pass_with_every_row_inside_its_ceiling():
    text = _text(VERDICT)
    verdict = text.split("## Verdict")[1].split("###")[0]
    assert "**AUTOMATED PASS, OWNER ROWS PENDING.**" in verdict
    assert "477.3 MB" in verdict
    assert "500 MB" in verdict
    assert "Rows over their ceiling" not in text
    assert "is not passed" not in verdict


def test_verdict_says_what_was_not_re_run_in_the_published_release():
    pending = _text(VERDICT).split("### Pending, not run")[1].split("## ")[0]
    for needle in ("measure artefact", "soak", "minimise", "T8", "Owner-attended"):
        assert needle in pending, needle


def test_results_carry_the_published_rows_the_thread_caps_and_the_previous_history():
    text = _text(RESULTS)
    head = text.split("## 1. Read this first")[0]
    assert PUBLISHED_VERSION in head.splitlines()[0]
    for figure in ("477.3 MB", "453.0", "484.4", "3,192.5", "2,797", "1,401.5", "316.7", "537.6", "38.4", "56.9"):
        assert figure in head, figure
    for figure in ("68 to 13", "1,790 to 369", "262.6 to 246.1", "OPENBLAS", "NUMEXPR"):
        assert figure in head, figure
    assert "505.4 MB (492.4 to 508.4)" in text, f"the {PREVIOUS_VERSION} idle reading stays as history"
    assert "## 13. W5B against W5C" in text


def test_results_say_the_thread_count_at_the_reading_point_is_not_the_attach_driver_figure():
    head = _text(RESULTS).split("## 1. Read this first")[0]
    assert "24 to 28" in head
    assert "17" in head and "33 s" in head
    assert "port 8765" in head


def test_the_documents_carry_the_published_installer_size_and_not_the_measure_build_size():
    for path in (README, HANDOVER):
        assert PUBLISHED_BYTES in _text(path), path.name
        assert "3,253,511" not in _text(path), path.name
