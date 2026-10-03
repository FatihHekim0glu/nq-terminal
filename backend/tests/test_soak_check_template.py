"""The all-day soak check template matches what the soak harness does and prints.

The harness (desktop/harness/modes/soak.mjs) stops when the stop file exists and never deletes it, prints a
console JSON line with a `soak` object and a `partial` flag, keeps `workloadErrors` only in the raw record,
and has no ALL-DAY or PARTIAL label of its own.
"""
from __future__ import annotations

from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
TEMPLATE = TERMINAL / "docs/desktop/checks/2026-10-03_all-day-soak.md"
STOP_FILE = r"D:\dev\d5\soak.stop"
DELETE = f"Remove-Item -LiteralPath '{STOP_FILE}'"


def _step(text: str, number: int) -> str:
    start = text.index(f"{number}. [ ] ")
    end = text.find(f"{number + 1}. [ ] ", start)
    return text[start:] if end == -1 else text[start:end]


def test_stop_file_is_deleted_before_the_start_and_after_an_early_stop():
    text = TEMPLATE.read_text(encoding="utf-8")
    assert DELETE in _step(text, 1)
    assert text.index(DELETE) < text.index("run.mjs --mode soak")
    assert DELETE in _step(text, 2)


def test_summary_values_name_their_source():
    text = TEMPLATE.read_text(encoding="utf-8")
    for key in ("`soak.n`", "`soak.maxMB`", "`soak.lastMB`", "`soak.slopeMBPerHour`", "`partial`", "`workloadErrors`"):
        assert key in text, key


def test_labels_are_defined_as_the_owners_wording_not_a_harness_output():
    text = TEMPLATE.read_text(encoding="utf-8")
    assert "the harness does not print an all-day or partial label" in text.lower()
    assert "owner's own wording" in text
