"""Every text file of the terminal outside the sha-pinned fixtures is stored with LF line endings.

The repository keeps bytes as they are (terminal/.gitattributes: `* -text`), so a file written with CRLF
shows up as a full-file change and hides the real diff. The fixtures under backend/tests/fixtures are
left as they are, because their bytes are pinned by sha256.
"""
from __future__ import annotations

from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
ROOTS = ("backend/nq_terminal", "backend/tests", "docs", "qa/crosscheck", "qa/tests", "contract")
SUFFIXES = {".py", ".md", ".json", ".toml", ".ps1", ".txt", ".cfg", ".ini"}
SKIP_PARTS = {"__pycache__", ".pytest_cache", ".venv", ".dumps", "fixtures"}


def _text_files() -> list[Path]:
    files = [TERMINAL / "start.ps1", TERMINAL / "README.md"]
    for root in ROOTS:
        for path in (TERMINAL / root).rglob("*"):
            if path.is_file() and path.suffix in SUFFIXES and not SKIP_PARTS.intersection(path.parts):
                files.append(path)
    return files


def test_terminal_text_files_use_lf_only():
    files = _text_files()
    assert len(files) > 50
    crlf = [str(p.relative_to(TERMINAL)) for p in files if b"\r\n" in p.read_bytes()]
    assert crlf == []
