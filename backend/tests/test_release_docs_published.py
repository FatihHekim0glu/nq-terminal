"""The documents of the latest PUBLISHED desktop release name the right version, keep the older figures as history and
carry the real values.

This file was test_release_docs_0_1_1.py. The published release is named once, in the constants below, and every
check reads it from there: when a new release is published its version, tag and the three build-dependent values
(installer SHA256, installer bytes) are changed here and in the documents, and nothing else in this file moves except
the figures it quotes. The build that is not yet published is not read here (test_release_version.py holds that one
together).

0.3.2 is published as `desktop-v0.3.2` (the on-screen IB snapshot switch, a health check that reads only the new tail of the gate log, HOME without
`scipy.stats`, a minimised start kept minimised); 0.3.1 is the previous release and its values stay as history. 0.3.2 holds the latest stated
G2 verdict (AUTOMATED PASS, OWNER ROWS PENDING), because neither 0.3.0 nor 0.3.1 states one and 0.2.1 is the verdict before it. 0.3.1 was
published as `desktop-v0.3.1` (a faster first launch, the REG staleness line, the exit code on the stopped page), 0.3.0 as `desktop-v0.3.0`
(contrast themes, launcher fixes, carried fixes), 0.2.1 as `desktop-v0.2.1` (a
start that survives a slow first identity proof) and 0.2.0 as `desktop-v0.2.0` (research launcher, job indicator, memory target).
0.1.1 caps the maths thread pools of the desktop backend server (`nq_terminal/threadcaps.py`). The G2 files record the
0.1.1 re-measure of 4 October 2026 next to the 0.1.0 (W5C) and W5B figures. The three build-dependent values (installer SHA256, installer bytes and tag) were filled in after the build and the
tag. They sit in the README and in sections 1, 2 and 7 of the hand-over, never in section 10
(test_handover_release_procedure.py).
"""
from __future__ import annotations

import re
from pathlib import Path

PUBLISHED_VERSION = "0.3.2"
PUBLISHED_TAG = f"desktop-v{PUBLISHED_VERSION}"
PUBLISHED_SHA256 = "bed93b22d4089d269752db584e3a7f631fcfe7cfc2a238c9601ec0707edcd5fd"
PUBLISHED_BYTES = "3,268,015"
PREVIOUS_VERSION = "0.3.1"
PREVIOUS_SHA256 = "e972b9b56fcc517fd8c5c449c5612c24cd4d1cb9923ba28507945d60d1af72fc"
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


def _unfilled(path):
    return PLACEHOLDER_PATTERN.findall(_text(path))


def test_no_placeholder_is_left_in_the_documents():
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert not _unfilled(path), path.name


def test_the_finisher_placeholders_of_the_0_1_2_wave_were_all_filled():
    needle = "{{" + "V012"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    assert "59c83ce, 31baa14, 5153496" in _text(HANDOVER), "the 0.1.2 commit list is filled"


def test_the_finisher_placeholders_of_the_0_2_0_wave_were_all_filled():
    needle = "{{" + "V020"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    commits = "b650f75, dd57054, 4b5831c, 5a8b9d5, 6cac154, b1adfe2, 5038663, c5bf39f, d1abef7, 19658fe"
    assert commits in _text(HANDOVER), "the 0.2.0 commit list is filled"


def test_handover_troubleshooting_names_the_identity_check_limitation():
    troubleshooting = _text(HANDOVER).split("## 8. Troubleshooting")[1].split("## 9. ")[0]
    assert "supervise_refused" in troubleshooting
    assert "1 start in 240" in troubleshooting
    assert "0.2.1 fixes it" in troubleshooting
    assert "fixed in 0.2.1" in troubleshooting, "the 0.2.0 limitation is marked fixed, with the history kept"


def test_the_finisher_placeholders_of_the_0_2_1_wave_were_all_filled():
    needle = "{{" + "V021"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    assert "f67d86e, 56d8eb9, 3b22af0" in _text(HANDOVER), "the 0.2.1 commit list is filled"


def test_the_finisher_placeholders_of_the_0_3_0_wave_were_all_filled():
    needle = "{{" + "V030"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    assert "ec16aff, 51294c5, b85a2dc" in _text(HANDOVER), "the 0.3.0 commit list is filled"


def test_the_finisher_placeholders_of_the_0_3_1_wave_were_all_filled():
    needle = "{{" + "V031"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    assert "261150c, 66345da, 062e88f, 710eb81, 94c881d" in _text(HANDOVER), "the 0.3.1 commit list is filled"


def test_the_finisher_placeholders_of_the_0_3_2_wave_were_all_filled():
    needle = "{{" + "V032"
    for path in (README, HANDOVER, DOCS / "smartscreen.md", DOCS / "g2_windows" / "placeholders.md", RESULTS, VERDICT):
        assert needle not in _text(path), path.name
    commits = "899b7d2, b39ca54, 31938d0, 3494143, 8f95b8b, 50701d6, 06a0768, 640fbab, e948719"
    assert commits in _text(HANDOVER), "the 0.3.2 commit list is filled"


def test_the_0_3_1_reference_limitation_is_marked_closed_in_0_3_2_with_the_history_kept():
    readme = _text(README).split("## Status")[1].split("## Highlights")[0]
    assert "Known limitation of 0.3.1, closed in 0.3.2" in readme
    assert "Known limitation of 0.3.0, closed in 0.3.1" in readme, "the 0.3.0 entry stays as history"
    assert "3,966 ms" in readme, "the 0.3.2 first-launch figure"
    assert "3,989 ms" in readme, "the 0.3.1 reading stays as history"
    assert "AUTOMATED PASS, OWNER ROWS PENDING" in readme


def test_the_g2_verdict_of_0_3_2_is_stated_and_the_published_state_is_written():
    verdict_head = _text(VERDICT).split("## Release 0.3.2")[0]
    assert "has been published since 8 October 2026 (tag `desktop-v0.3.2`" in verdict_head
    assert "the latest stated G2 verdict of a published release" in verdict_head
    verdict_032 = _text(VERDICT).split("## Release 0.3.2")[1].split("## Release 0.3.1")[0]
    assert "**AUTOMATED PASS, OWNER ROWS PENDING.**" in verdict_032
    assert "Until the 0.3.2 tag exists" not in verdict_032
    assert "Release 0.3.2 has been published since 8 October 2026" in verdict_032
    results_head = _text(RESULTS).split("## G1.")[0]
    assert "Until 0.3.2 is published" not in results_head
    assert "0.3.2 has been published since 8 October 2026" in results_head


def test_the_warm_stats_fallback_decision_is_recorded_in_the_release_procedure():
    procedure = _text(HANDOVER).split("## 7. Release procedure")[1].split("## 8. ")[0]
    assert "move `warm_stats` to the end of the HOME tasks" in procedure
    assert "it was not applied" in procedure
    assert "`warm_stats` read 0.00 s in every first launch" in procedure
    assert "2,375 ms sooner than 0.2.1" in procedure


def test_the_first_launch_limitation_of_0_3_0_is_marked_closed_in_0_3_1_with_the_history_kept():
    troubleshooting = _text(HANDOVER).split("## 8. Troubleshooting")[1].split("## 9. ")[0]
    assert "Known limitation of 0.3.0, fixed in 0.3.1" in troubleshooting
    assert "3,989 ms" in troubleshooting, "the 0.3.1 first-launch figure"
    assert "6,116 ms" in troubleshooting, "the 0.3.0 reading stays as history"
    assert "PROVISIONAL" in troubleshooting
    readme = _text(README).split("## Status")[1].split("## Highlights")[0]
    assert "Known limitation of 0.3.0, closed in 0.3.1" in readme
    assert "3,989 ms" in readme
    assert "6,116 ms" in readme


def test_no_g2_verdict_is_stated_for_0_3_1_and_the_published_state_is_written():
    verdict_head = _text(VERDICT).split("## Release 0.3.1")[0]
    assert "Releases 0.3.0 and 0.3.1 have been published since 7 October 2026" in verdict_head
    assert "the 0.2.1 verdict that follows it" in verdict_head
    verdict_031 = _text(VERDICT).split("## Release 0.3.1")[1].split("## Release 0.3.0")[0]
    assert "Until the 0.3.1 tag exists" not in verdict_031
    assert "Release 0.3.1 has been published since 7 October 2026" in verdict_031
    assert "the 0.2.1 verdict stays the latest stated G2 verdict" in verdict_031
    results_head = _text(RESULTS).split("## F1.")[0]
    assert "Until 0.3.1 is published" not in results_head
    assert "0.3.1 has been published since 7 October 2026" in results_head


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
