"""The owner-facing installer hash and size must come from the final build, never from a self-test build.

Every rebuild changes the installer's SHA256 and size, and only the final build's SHA256SUMS in the default folder
`D:\\dev\\release\\0.2.0` is what the owner checks. A value copied from another folder (a ReleaseDir self-test) makes
the owner's check fail and reads as a tampered copy. So the owner-facing documents carry the final build's hash.

The 0.2.0 installer was built and published as `desktop-v0.2.0`. Its SHA256 and size are the current values and
must be the same everywhere. The 0.1.0, 0.1.1 and 0.1.2 hashes are history and are the only other hashes allowed.
"""
from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[2] / "docs" / "desktop"
README = Path(__file__).resolve().parents[2] / "README.md"
HANDOVER = DOCS / "handover_windows.md"
SMARTSCREEN = DOCS / "smartscreen.md"
HISTORY_HASHES = {
    "c568be92eb49bf814f2c151ace6631b11032050f2b6028bf3b0c183a27f90e58",  # the 0.1.0 build from 49229b9
    "2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590",  # the final 0.1.0 installer
    "3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc",  # the 0.1.1 installer
    "3ab330927d6b1e1c617163a5ff8089baae8e2da4ac553b2b6527cedf4569f377",  # the 0.1.2 installer
}
CURRENT_SHA = "ff7266397131e15d101fa0b38105b0d0f7b855ba1d22f4a688906a4ef2feeb51"
CURRENT_BYTES = "3,256,246"
HEX64 = re.compile(r"\b[0-9a-fA-F]{64}\b")
VALUE = r"[0-9a-fA-F]{64}"


def _owner_documents() -> list[Path]:
    return [HANDOVER, SMARTSCREEN, *sorted((DOCS / "checks").glob("*.md"))]


RENAMED_BUILD_MARK = "renamed installer"


def _owner_facing(line: str) -> bool:
    """A line the owner checks a hash against. A row about a renamed-product build (the install and upgrade tests) is not one:
    those installers are never shipped, and their hashes are evidence, not values to verify."""
    return ("installer" in line.lower() or "Expected:" in line) and RENAMED_BUILD_MARK not in line.lower()


def _installer_lines(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if _owner_facing(line)]


def _verification_step() -> str:
    text = HANDOVER.read_text(encoding="utf-8")
    return text[text.index("2. Check the build folder") : text.index("3. For a copy that arrived")]


def _current_value() -> str:
    match = re.search(rf"Expected: `({VALUE})`", _verification_step())
    assert match, "the verification step names no expected value"
    return match.group(1)


def test_no_owner_document_carries_a_build_hash_other_than_the_history_or_the_current():
    allowed = HISTORY_HASHES | {_current_value().lower()}
    found = {
        f"{path.name}: {match}"
        for path in _owner_documents()
        for line in _installer_lines(path)
        for match in HEX64.findall(line)
        if match.lower() not in allowed
    }
    assert not found, sorted(found)


def test_owner_verification_step_expects_the_current_value_for_the_current_version():
    step = _verification_step()
    assert "D:\\dev\\release\\0.2.0" in step
    assert "nq-lab terminal_0.2.0_x64-setup.exe" in step
    assert _current_value().lower() not in HISTORY_HASHES
    assert _current_value() == CURRENT_SHA


def test_tag_message_carries_the_current_value():
    text = HANDOVER.read_text(encoding="utf-8")
    tag_line = next(line for line in text.splitlines() if "tag -a desktop-v0.2.0" in line)
    assert _current_value() in tag_line


def test_smartscreen_verification_expects_the_current_value():
    text = SMARTSCREEN.read_text(encoding="utf-8")
    assert _current_value() in text
    assert "nq-lab terminal_0.2.0_x64-setup.exe" in text


def test_readme_install_table_and_handover_name_the_same_current_value():
    readme = README.read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines() if line.startswith("| `") and "0.2.0_x64-setup.exe" in line)
    assert _current_value() in row
    assert CURRENT_BYTES in row
    assert CURRENT_BYTES in HANDOVER.read_text(encoding="utf-8") or CURRENT_BYTES in readme


def test_every_owner_document_names_the_current_hash_wherever_it_names_one():
    found = {
        match.lower()
        for path in _owner_documents()
        for line in _installer_lines(path)
        for match in HEX64.findall(line)
    }
    assert found <= HISTORY_HASHES | {_current_value().lower()}


def test_a_renamed_product_row_is_evidence_not_an_owner_value_but_any_other_installer_row_still_counts():
    other = "a" * 64
    assert not _owner_facing(f"| 0.1.2 renamed installer | built from HEAD, SHA-256 `{other}` |")
    assert _owner_facing(f"| 0.1.2 installer | SHA-256 `{other}` |")
    assert _owner_facing(f"Expected: `{other}`")
