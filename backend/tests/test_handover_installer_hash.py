"""The owner-facing installer hash and size must come from the final build, never from a self-test build.

Every rebuild changes the installer's SHA256 and size, and only the final build's SHA256SUMS in the default folder
`D:\\dev\\release\\0.1.0` is what the owner checks. A value copied from another folder (a ReleaseDir self-test) makes
the owner's check fail and reads as a tampered copy. So the owner-facing documents carry the final build's hash (filled after the tag on
4 October 2026). The 0.1.0 build from `49229b9` is named as history and is the only other hash allowed in them.
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
HANDOVER = DOCS / "handover_windows.md"
SMARTSCREEN = DOCS / "smartscreen.md"
HISTORY_HASHES = {"c568be92eb49bf814f2c151ace6631b11032050f2b6028bf3b0c183a27f90e58"}
FINAL_SHA = "2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590"
FINAL_BYTES = "3,253,432"
HEX64 = re.compile(r"\b[0-9a-fA-F]{64}\b")


def _owner_documents() -> list[Path]:
    return [HANDOVER, SMARTSCREEN, *sorted((DOCS / "checks").glob("*.md"))]


def _installer_lines(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line for line in lines if "installer" in line.lower() or "Expected:" in line]


def test_no_owner_document_carries_a_build_hash_other_than_the_history():
    found = {
        f"{path.name}: {match}"
        for path in _owner_documents()
        for line in _installer_lines(path)
        for match in HEX64.findall(line)
        if match.lower() not in HISTORY_HASHES | {FINAL_SHA}
    }
    assert not found, sorted(found)


def test_owner_verification_step_expects_the_final_hash():
    text = HANDOVER.read_text(encoding="utf-8")
    step = text[text.index("2. Check the build folder") : text.index("3. For a copy that arrived")]
    assert f"Expected: `{FINAL_SHA}`" in step


def test_tag_message_carries_the_final_hash():
    text = HANDOVER.read_text(encoding="utf-8")
    tag_line = next(line for line in text.splitlines() if "tag -a desktop-v0.1.0" in line)
    assert FINAL_SHA in tag_line


def test_smartscreen_carries_both_installer_values():
    text = SMARTSCREEN.read_text(encoding="utf-8")
    assert FINAL_SHA in text
    assert FINAL_BYTES in text


def test_every_owner_document_names_the_final_hash_wherever_it_names_one():
    # The only 64-digit hash besides the history entry is the final build's.
    found = {
        match.lower()
        for path in _owner_documents()
        for line in _installer_lines(path)
        for match in HEX64.findall(line)
    }
    assert found <= HISTORY_HASHES | {FINAL_SHA}
    assert FINAL_SHA in found
