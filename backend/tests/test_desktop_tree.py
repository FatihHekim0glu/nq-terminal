"""The desktop tree after the D4 merge (integration wave INT1): what a merge must keep true.

- No conflict marker in any tracked-looking text file of the terminal.
- .gitignore keeps the shell's generated folder and every Rust target folder out of the repository, and the
  repository holds no target or node_modules folder under desktop/ (build output lives on D:).
- Text files of the shell are stored with LF line endings, like the rest of the terminal (test_line_endings.py).
- docs/desktop/03_appendix_a_addendum.md keeps every wave's preflight section in wave order, its table of added
  modules in phase order, and a row for every shell source file and script (03 Appendix A, 04 standing rule 14).
"""
from __future__ import annotations

import re
from pathlib import Path

TERMINAL = Path(__file__).resolve().parents[2]
DESKTOP = TERMINAL / "desktop"
ADDENDUM = TERMINAL / "docs" / "desktop" / "03_appendix_a_addendum.md"
SKIP_PARTS = {"__pycache__", ".pytest_cache", ".venv", ".dumps", "node_modules", "dist", "dist-demo", "dist-gallery",
              ".mypy_cache", ".ruff_cache", "test-results", "playwright-report", "target"}
TEXT_SUFFIXES = {".py", ".md", ".json", ".toml", ".ps1", ".txt", ".cfg", ".ini", ".rs", ".mjs", ".ts", ".tsx",
                 ".html", ".css", ".lock", ".yaml", ".yml"}
# Built from parts so that this file holds no line that starts with a marker itself.
MARKERS = ("<" * 7 + " ", ">" * 7 + " ")


def _text_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*")
            if p.is_file() and p.suffix in TEXT_SUFFIXES and not SKIP_PARTS.intersection(p.relative_to(root).parts)]


def test_no_conflict_marker_in_the_terminal_sources() -> None:
    roots = [TERMINAL / name for name in ("backend", "contract", "desktop", "docs", "qa", "scripts")]
    roots.append(TERMINAL / "web" / "src")
    files = [path for root in roots for path in _text_files(root)] + [TERMINAL / "README.md", TERMINAL / "start.ps1"]
    assert len(files) > 500
    hits = [f"{p.relative_to(TERMINAL)}:{n}" for p in files
            for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), start=1)
            if line.startswith(MARKERS)]
    assert hits == []


def _ignore_lines() -> list[str]:
    text = (TERMINAL / ".gitignore").read_text(encoding="utf-8")
    return [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]


def test_gitignore_keeps_generated_and_target_folders_out() -> None:
    lines = _ignore_lines()
    assert "desktop/src-tauri/gen/" in lines
    assert "target/" in lines, "a Rust target folder must never reach the repository, wherever it is made"
    assert "node_modules/" in lines
    # The records of the release scripts (state/release) and the advisory last-seen date (state/desktop) sit in the
    # git-ignored state folder; a harness run folder or an installer that strays into the repository stays out too.
    assert "/state/" in lines
    assert "desktop/harness/runs/" in lines
    assert "*-setup.exe" in lines


def test_harness_and_release_output_roots_are_on_the_d_drive() -> None:
    paths = (DESKTOP / "harness" / "lib" / "paths.mjs").read_text(encoding="utf-8")
    roots = re.findall(r"export const (?:RUNS|TARGETS|RELEASE|TMP)_(?:ROOT|DIR) = '([^']+)'", paths)
    assert len(roots) == 4, roots
    assert all(re.match(r"d:\\+dev\\+", r, flags=re.IGNORECASE) for r in roots), roots  # the source spells each \ twice


def test_no_target_or_node_modules_folder_under_desktop() -> None:
    found = [p for p in DESKTOP.rglob("*") if p.is_dir() and p.name in {"target", "node_modules"}]
    assert found == []


def test_desktop_text_files_use_lf_only() -> None:
    files = _text_files(DESKTOP)
    assert len(files) > 60
    crlf = [str(p.relative_to(TERMINAL)) for p in files if b"\r\n" in p.read_bytes()]
    assert crlf == []


def _addendum() -> str:
    return ADDENDUM.read_text(encoding="utf-8")


def test_preflight_sections_are_in_wave_order() -> None:
    waves = re.findall(r"^## Preflight of [^(]*\(wave (W\d[A-B]?),", _addendum(), flags=re.MULTILINE)
    assert waves[:5] == ["W0A", "W1A", "W2A", "W3B", "W4A"]
    assert waves == sorted(waves, key=lambda w: (int(w[1]), w[2:])), waves


def test_added_module_table_is_in_phase_order_and_keeps_every_wave() -> None:
    rows = re.findall(r"^\| (D\d) \((W\d[A-B]?|INT\d)\) \|", _addendum(), flags=re.MULTILINE)
    assert rows, "the table of added modules has no row"
    phases = [int(phase[1]) for phase, _ in rows]
    assert phases == sorted(phases), "rows must follow the phase order D1, D2, D3, D4"
    seen = {wave for _, wave in rows}
    assert {"W1B", "W2A", "W3B", "W4A", "W4B"} <= seen


def test_every_shell_source_file_and_script_has_a_row() -> None:
    text = _addendum()
    # Every shell source, every script and every script test (a folder is not a row: its files are), and the harness
    # entry files; the harness folders are rows of their own as globs (`lib/`, `modes/`, `tests/`).
    scripts = [p for p in sorted((DESKTOP / "scripts").rglob("*")) if p.is_file() and not SKIP_PARTS.intersection(p.parts)]
    harness = [p for p in sorted((DESKTOP / "harness").glob("*")) if p.is_file() and p.suffix == ".mjs"]
    files = [*sorted((DESKTOP / "src-tauri" / "src").rglob("*.rs")), *scripts, *harness]
    assert len(files) > 25
    missing = [p.name for p in files if f"{p.name}`" not in text]  # named in a row, bare or as a path
    assert missing == []
    for folder in ("lib", "modes", "tests"):
        assert f"desktop/harness/{folder}/" in text, f"no row names the harness folder {folder}/"


def test_check_templates_do_not_demand_the_whole_evidence_check_of_a_single_purpose_folder() -> None:
    """`report.mjs DIR --check` fails unless both builds carry every row (a one-purpose folder never does), so a
    template must read the folder with the plain table or --json and must not make that check a pass rule."""
    offenders = []
    for path in sorted((TERMINAL / "docs" / "desktop" / "checks").glob("*.md")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if "report.mjs" in line and "--check" in line:
                offenders.append(f"{path.name}:{number} runs report.mjs with --check")
            if "report's `--check` passes" in line:
                offenders.append(f"{path.name}:{number} makes report.mjs --check a pass rule")
    assert not offenders, offenders
