"""The research-file guard: each broken state must be flagged (born failing), and other workflows'
legitimate writes, made from another process, must be tolerated."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import RESEARCH_FILES, WATCHED_FILES
from research_guard import APPEND, APPEND_LOG, PRESENCE, REBUILT, STRICT, TEST_MARKER, ResearchGuard, note_child

LOG_LINE = json.dumps({"caller": "rebal_v0", "reason": "screen read"}) + "\n"


@pytest.fixture
def files(tmp_path: Path) -> dict[str, Path]:
    paths = {
        "log": tmp_path / "oos_access_log.jsonl",
        "ledger": tmp_path / "ledger.csv",
        "registry": tmp_path / "registry.csv",
        "openings": tmp_path / "oos_openings.json",
    }
    paths["log"].write_text(LOG_LINE, encoding="utf-8")
    paths["ledger"].write_text("run_id,exp_id\nnt_a,exp1\n", encoding="utf-8")
    paths["registry"].write_text("name,p\nza_v0,0.3\n", encoding="utf-8")
    paths["openings"].write_text('{"openings": []}', encoding="utf-8")
    return paths


@pytest.fixture
def guard(files):
    kinds = {"log": APPEND_LOG, "ledger": APPEND, "registry": REBUILT, "openings": STRICT}
    g = ResearchGuard({files[k]: kinds[k] for k in files}).start()
    yield g
    g.stop()


def other_process(code: str) -> None:
    """Write from a child process, which the in-process hook cannot see (another workflow)."""
    subprocess.run([sys.executable, "-c", code], check=True)


def append_code(path: Path, text: str) -> str:
    return f"open({str(path)!r}, 'a', encoding='utf-8').write({text!r})"


def test_untouched_files_pass(guard):
    assert guard.verify().problems == []


def test_reading_is_allowed(guard, files):
    assert files["log"].read_text(encoding="utf-8") == LOG_LINE
    assert guard.verify().problems == []


@pytest.mark.parametrize("mode", ["a", "w", "r+", "x"])
def test_in_process_open_for_writing_is_refused(guard, files, mode):
    with pytest.raises(PermissionError):
        open(files["ledger"], mode, encoding="utf-8")
    assert files["ledger"].read_text(encoding="utf-8") == "run_id,exp_id\nnt_a,exp1\n"
    assert guard.verify().problems


def test_in_process_write_text_replace_and_unlink_are_refused(guard, files, tmp_path):
    with pytest.raises(PermissionError):
        files["registry"].write_text("x", encoding="utf-8")
    other = tmp_path / "other.csv"
    other.write_text("y", encoding="utf-8")
    with pytest.raises(PermissionError):
        os.replace(other, files["registry"])
    with pytest.raises(PermissionError):
        files["openings"].unlink()
    with pytest.raises(PermissionError):
        os.open(files["log"], os.O_WRONLY | os.O_APPEND)
    assert len(guard.verify().problems) >= 4


def test_other_process_append_of_research_line_is_tolerated(guard, files):
    other_process(append_code(files["log"], LOG_LINE))
    report = guard.verify()
    assert report.problems == []
    assert any("gained 1 line" in n for n in report.notes)


TERMINAL_LINE = json.dumps({"caller": "terminal", "reason": "terminal display: NQ 1m 2019"}) + "\n"


def test_terminal_line_from_another_workflow_is_a_note(guard, files):
    """The real-data smoke of another checkout writes terminal lines while this suite runs; nothing here read real data."""
    other_process(append_code(files["log"], TERMINAL_LINE))
    report = guard.verify()
    assert report.problems == []
    assert any("terminal line" in n and "another workflow" in n for n in report.notes)


def test_terminal_line_is_flagged_when_a_test_backend_ran_on_real_data(guard, files):
    other_process(append_code(files["log"], TERMINAL_LINE))
    guard.note_real_data_child("-m nq_terminal")
    assert any("terminal line" in p for p in guard.verify().problems)


def test_terminal_line_is_flagged_after_an_in_process_refusal(guard, files):
    with pytest.raises(PermissionError):
        open(files["ledger"], "a", encoding="utf-8")
    other_process(append_code(files["log"], TERMINAL_LINE))
    assert any("terminal line" in p for p in guard.verify().problems)


def test_a_backend_started_without_the_fixture_is_recorded(guard, files):
    note_child(["-m", "nq_terminal"], {"NQT_PORT": "0"})
    other_process(append_code(files["log"], TERMINAL_LINE))
    assert any("terminal line" in p for p in guard.verify().problems)


def test_a_backend_started_on_the_fixture_is_not_recorded(guard, files):
    note_child(["-m", "nq_terminal"], {"NQT_FIXTURE_DIR": "D:/fixtures"})
    other_process(append_code(files["log"], TERMINAL_LINE))
    assert guard.verify().problems == []


def test_a_marker_line_is_flagged_even_from_another_workflow(guard, files):
    other_process(append_code(files["log"], json.dumps({"caller": "terminal", "reason": TEST_MARKER}) + "\n"))
    assert any("test marker" in p for p in guard.verify().problems)


def test_marker_line_in_ledger_is_flagged(guard, files):
    other_process(append_code(files["ledger"], f"t_{TEST_MARKER},exp9\n"))
    assert any("test marker" in p for p in guard.verify().problems)


def test_rewritten_append_only_file_is_flagged(guard, files):
    other_process(f"open({str(files['ledger'])!r}, 'w', encoding='utf-8').write('run_id,exp_id\\n')")
    assert any("earlier bytes changed" in p for p in guard.verify().problems)


def test_changed_openings_is_flagged(guard, files):
    other_process(f"open({str(files['openings'])!r}, 'w', encoding='utf-8').write('{{}}')")
    assert any("byte-identical" in p for p in guard.verify().problems)


def test_registry_rebuild_by_other_process_is_a_note(guard, files):
    other_process(f"open({str(files['registry'])!r}, 'w', encoding='utf-8').write('name,p\\nza_v0,0.31\\n')")
    report = guard.verify()
    assert report.problems == []
    assert any("attributed to another workflow" in n for n in report.notes)


def test_registry_rebuild_with_marker_is_flagged(guard, files):
    other_process(f"open({str(files['registry'])!r}, 'w', encoding='utf-8').write('name\\n{TEST_MARKER}\\n')")
    assert any("test marker" in p for p in guard.verify().problems)


def test_session_guard_covers_the_real_research_files(research_files_guard):
    for path in RESEARCH_FILES:
        assert research_files_guard.would_block("open", (str(path), "a", 0)) is not None
        assert research_files_guard.would_block("open", (str(path), "r", 0)) is None
        assert research_files_guard.would_block("os.rename", ("elsewhere.tmp", str(path), None, None))
    assert set(RESEARCH_FILES) | set(WATCHED_FILES) == set(research_files_guard.policies)


# ---------------------------------------------------------------- improvement run 1: aliases and folders

DEVICE_PREFIX = chr(92) * 2 + "?" + chr(92)  # the Win32 device-path prefix, written without escapes


def short_path(path: Path) -> str:
    """The 8.3 alias of an existing path, or the path itself when 8.3 names are disabled."""
    import ctypes

    buf = ctypes.create_unicode_buffer(1024)
    n = ctypes.windll.kernel32.GetShortPathNameW(str(path), buf, len(buf))
    return buf.value if 0 < n < len(buf) else str(path)


@pytest.fixture
def long_files(tmp_path: Path) -> dict[str, Path]:
    folder = tmp_path / "a long folder name for aliases"
    folder.mkdir()
    ledger = folder / "ledger_with_a_long_name.csv"
    ledger.write_text("run_id,exp_id\n", encoding="utf-8")
    live = tmp_path / "live"
    live.mkdir()
    (live / "KILL").write_text("", encoding="utf-8")
    return {"folder": folder, "ledger": ledger, "live": live, "kill": live / "KILL"}


@pytest.fixture
def dir_guard(long_files):
    g = ResearchGuard({long_files["ledger"]: APPEND}, protected_dirs=[long_files["live"]]).start()
    yield g
    g.stop()


@pytest.mark.skipif(sys.platform != "win32", reason="8.3 aliases are a Windows feature")
def test_a_write_through_the_8dot3_alias_is_refused(dir_guard, long_files):
    alias = short_path(long_files["ledger"])
    if alias == str(long_files["ledger"]):
        pytest.skip("8.3 names are disabled on this volume")
    assert dir_guard.would_block("open", (alias, "a", 0)) is not None
    with pytest.raises(PermissionError):
        open(alias, "a", encoding="utf-8")
    assert long_files["ledger"].read_text(encoding="utf-8") == "run_id,exp_id\n"


@pytest.mark.skipif(sys.platform != "win32", reason="device paths are a Windows feature")
def test_a_write_through_the_device_prefix_is_refused(dir_guard, long_files):
    alias = DEVICE_PREFIX + str(long_files["ledger"])
    assert dir_guard.would_block("open", (alias, "a", 0)) is not None
    with pytest.raises(PermissionError):
        open(alias, "a", encoding="utf-8")
    assert dir_guard.would_block("open", (DEVICE_PREFIX + short_path(long_files["ledger"]), "w", 0)) is not None


def test_removing_the_kill_switch_is_refused(dir_guard, long_files):
    with pytest.raises(PermissionError):
        os.remove(long_files["kill"])
    with pytest.raises(PermissionError):
        long_files["kill"].unlink()
    assert long_files["kill"].exists()
    assert dir_guard.verify().problems


@pytest.mark.parametrize("action", ["create", "mkdir", "rmtree", "rename_in", "chmod", "utime"])
def test_any_change_inside_a_protected_folder_is_refused(dir_guard, long_files, tmp_path, action):
    import shutil

    live = long_files["live"]
    outside = tmp_path / "outside.txt"
    outside.write_text("x", encoding="utf-8")
    actions = {
        "create": lambda: open(live / "KILL_2", "w", encoding="utf-8"),
        "mkdir": lambda: os.mkdir(live / "logs2"),
        "rmtree": lambda: shutil.rmtree(live),
        "rename_in": lambda: os.rename(outside, live / "moved.txt"),
        "chmod": lambda: os.chmod(long_files["kill"], 0o444),
        "utime": lambda: os.utime(long_files["kill"], (1, 1)),
    }
    with pytest.raises(PermissionError):
        actions[action]()
    assert sorted(p.name for p in live.iterdir()) == ["KILL"]


def test_linking_a_guarded_file_to_a_new_alias_is_refused(dir_guard, long_files, tmp_path):
    with pytest.raises(PermissionError):
        os.link(long_files["ledger"], tmp_path / "alias.csv")
    assert not (tmp_path / "alias.csv").exists()


def test_a_write_through_a_hardlink_made_elsewhere_is_refused(long_files, tmp_path):
    alias = tmp_path / "hardlink_alias.csv"
    other_process(f"import os; os.link({str(long_files['ledger'])!r}, {str(alias)!r})")
    g = ResearchGuard({long_files["ledger"]: APPEND}).start()
    try:
        with pytest.raises(PermissionError):
            open(alias, "a", encoding="utf-8")
    finally:
        g.stop()
    assert long_files["ledger"].read_text(encoding="utf-8") == "run_id,exp_id\n"


def test_writes_outside_the_protected_folders_are_allowed(dir_guard, tmp_path):
    path = tmp_path / "scratch" / "x.json"
    path.parent.mkdir()
    path.write_text("{}", encoding="utf-8")
    os.replace(path, tmp_path / "y.json")
    assert dir_guard.verify().problems == []


@pytest.mark.parametrize("change", ["appears", "disappears"])
def test_kill_switch_toggled_by_another_process_is_a_note(tmp_path, change):
    kill = tmp_path / "live" / "KILL"
    kill.parent.mkdir()
    if change == "disappears":
        kill.write_text("", encoding="utf-8")
    g = ResearchGuard({kill: PRESENCE}).start()
    g.stop()
    code = f"open({str(kill)!r}, 'w').close()" if change == "appears" else f"import os; os.remove({str(kill)!r})"
    other_process(code)
    report = g.verify()
    assert report.problems == []
    assert any("KILL" in n and "another workflow" in n for n in report.notes)


def test_session_guard_covers_the_research_folders(research_files_guard):
    from nq_lab.config import ROOT

    for path in (ROOT / "live" / "KILL", ROOT / "results" / "screens" / "za_v0.json", ROOT / "results" / "registry.md",
                 ROOT / "backtests" / "output" / "x" / "result.json", ROOT / "live" / "logs" / "j.jsonl",
                 ROOT / "data" / "text" / "fomc" / "x.txt"):
        assert research_files_guard.would_block("open", (str(path), "w", 0)) is not None, path
        assert research_files_guard.would_block("os.remove", (str(path), None)) is not None, path
        assert research_files_guard.would_block("open", (str(path), "r", 0)) is None, path
    assert research_files_guard.would_block("os.mkdir", (str(ROOT / "results" / "new"), 0o777, None))


def test_session_guard_covers_the_spec_folder(research_files_guard):
    """`experiments/` holds the specs the presets hash on every listing; nothing in the session may write there."""
    from nq_lab.config import ROOT

    spec = ROOT / "experiments" / "overnight_v0.json"
    for path in (spec, spec.with_suffix(".sha256"), ROOT / "experiments" / "new_v0.json"):
        assert research_files_guard.would_block("open", (str(path), "w", 0)) is not None, path
        assert research_files_guard.would_block("os.remove", (str(path), None)) is not None, path
        assert research_files_guard.would_block("open", (str(path), "r", 0)) is None, path
    assert research_files_guard.would_block("os.mkdir", (str(ROOT / "experiments" / "cache"), 0o777, None))


def test_an_in_process_write_under_the_spec_folder_raises_permission_error(tmp_path):
    """The same folder rule, end to end on a stand-in spec folder (the session guard records any refusal it makes, so
    the real folder is checked with `would_block` above and never written to)."""
    specs = tmp_path / "experiments"
    specs.mkdir()
    guard = ResearchGuard({}, protected_dirs=[specs]).start()
    try:
        with pytest.raises(PermissionError):
            (specs / "x_v0.sha256").write_text("x", encoding="utf-8")
    finally:
        guard.stop()
    assert not (specs / "x_v0.sha256").exists()


def test_session_guard_covers_both_state_folders(research_files_guard):
    """The checkout's terminal/state and the shared lab's (ROOT/terminal/state, the owner's live folder, which is a
    different folder in a worktree): an older conftest let a test leave nqt-planted.txt in the shared one."""
    from conftest import MAIN_STATE_DIR, REAL_STATE_DIR
    from nq_lab.config import ROOT

    assert MAIN_STATE_DIR == ROOT / "terminal" / "state"
    for folder in (MAIN_STATE_DIR, REAL_STATE_DIR):
        for path in (folder / "nqt-planted.txt", folder / "release" / "x.json", folder / "workspaces" / "w.json"):
            assert research_files_guard.would_block("open", (str(path), "w", 0)) is not None, path
            assert research_files_guard.would_block("os.remove", (str(path), None)) is not None, path
            assert research_files_guard.would_block("open", (str(path), "r", 0)) is None, path
        assert research_files_guard.would_block("os.mkdir", (str(folder / "cache"), 0o777, None))


def test_a_backend_with_the_prewarm_off_and_no_fixture_is_not_recorded(guard, files):
    """The handshake and lock tests start the app's own backend with NQT_PREWARM=0 and only ask the proof and health routes."""
    note_child(["-m", "nq_terminal"], {"NQT_DESKTOP": "1", "NQT_PREWARM": "0"})
    other_process(append_code(files["log"], TERMINAL_LINE))
    assert guard.verify().problems == []


def test_a_backend_with_the_prewarm_on_is_recorded(guard, files):
    note_child(["-m", "nq_terminal"], {"NQT_DESKTOP": "1", "NQT_PREWARM": "1"})
    other_process(append_code(files["log"], TERMINAL_LINE))
    assert any("terminal line" in p for p in guard.verify().problems)
