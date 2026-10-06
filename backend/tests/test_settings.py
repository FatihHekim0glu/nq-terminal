"""Settings come from NQT_* environment variables; the project root comes from nq_lab.config."""
from __future__ import annotations

from pathlib import Path

import pytest

from nq_lab.config import ROOT
from nq_terminal.settings import (
    ALLOWED_HOSTS,
    BIND_HOST,
    DEFAULT_CACHE_BYTES,
    DEFAULT_PORT,
    WEB_DIST,
    Settings,
    SettingsError,
    load_settings,
)


def test_defaults_without_environment():
    s = load_settings({})
    assert s.root == ROOT
    assert s.port == DEFAULT_PORT == 8765
    assert s.cache_bytes == DEFAULT_CACHE_BYTES == 2 * 1024**3
    assert s.fixture_dir is None and s.fixture_mode is False
    assert s.data_root == ROOT


def test_bind_host_and_allowed_hosts_are_loopback_only():
    assert BIND_HOST == "127.0.0.1"
    assert ALLOWED_HOSTS == ("127.0.0.1", "localhost")


def test_web_dist_is_inside_the_terminal_folder():
    assert WEB_DIST == ROOT / "terminal" / "web" / "dist"
    assert load_settings({}).web_dist == WEB_DIST


def test_research_paths_follow_the_data_root(tmp_path: Path):
    s = load_settings({"NQT_FIXTURE_DIR": str(tmp_path)})
    assert s.fixture_mode is True and s.data_root == tmp_path
    assert s.oos_log_path == tmp_path / "results" / "oos_access_log.jsonl"
    assert s.openings_path == tmp_path / "results" / "oos_openings.json"
    assert s.kill_switch_path == tmp_path / "live" / "KILL"


def test_real_paths_match_nq_lab():
    from nq_lab.config import OOS_LOG
    from nq_lab.oos_gate import OPENINGS

    s = load_settings({})
    assert s.oos_log_path == OOS_LOG
    assert s.openings_path == OPENINGS
    assert s.kill_switch_path == ROOT / "live" / "KILL"


def test_port_and_cache_bytes_parse():
    s = load_settings({"NQT_PORT": "9001", "NQT_CACHE_BYTES": "1048576"})
    assert (s.port, s.cache_bytes) == (9001, 1048576)


@pytest.mark.parametrize("env", [
    {"NQT_PORT": "abc"},
    {"NQT_PORT": "0"},
    {"NQT_PORT": "70000"},
    {"NQT_CACHE_BYTES": "-1"},
    {"NQT_CACHE_BYTES": "0"},
    {"NQT_CACHE_BYTES": "lots"},
    {"NQT_FIXTURE_DIR": "Z:/no/such/folder/for/nqt"},
])
def test_bad_values_fail_fast(env):
    with pytest.raises(SettingsError):
        load_settings(env)


def test_settings_are_frozen():
    s = load_settings({})
    with pytest.raises(AttributeError):
        s.port = 1  # type: ignore[misc]
    assert isinstance(s, Settings)


# ---------------------------------------------------------------- NQT_FIXTURE_DIR is checked, not just is_dir()

SEP = chr(92)
DEVICE = SEP * 2 + "?" + SEP


@pytest.mark.parametrize("raw", [
    ROOT.anchor,  # the drive root above the project, wherever the lab lives (a junction can put it on E:)
    str(ROOT),
    str(ROOT.parent),
    str(ROOT / "results"),
    str(ROOT / "live"),
    str(ROOT / "terminal"),
])
def test_fixture_dir_may_not_be_the_project_a_parent_or_a_real_research_folder(raw):
    with pytest.raises(SettingsError):
        load_settings({"NQT_FIXTURE_DIR": raw})


def test_fixture_dir_relative_parent_of_the_project_is_refused(monkeypatch):
    monkeypatch.chdir(ROOT)
    with pytest.raises(SettingsError):
        load_settings({"NQT_FIXTURE_DIR": ".."})


@pytest.mark.parametrize("prefix", [DEVICE, SEP * 2 + "." + SEP])
def test_fixture_dir_device_paths_are_refused(tmp_path, prefix):
    with pytest.raises(SettingsError):
        load_settings({"NQT_FIXTURE_DIR": prefix + str(tmp_path)})


@pytest.mark.parametrize("raw", [SEP * 2 + "localhost" + SEP + "c$" + SEP + "nqt", "//localhost/c$/nqt"])
def test_fixture_dir_unc_paths_are_refused_before_any_network_access(raw, monkeypatch):
    def no_network(self):
        raise AssertionError("a UNC fixture folder must be refused before it is touched")

    monkeypatch.setattr(Path, "is_dir", no_network)
    monkeypatch.setattr(Path, "resolve", no_network)
    with pytest.raises(SettingsError):
        load_settings({"NQT_FIXTURE_DIR": raw})


def test_fixture_dir_is_stored_resolved_and_absolute(tmp_path, monkeypatch):
    (tmp_path / "fx").mkdir()
    monkeypatch.chdir(tmp_path)
    s = load_settings({"NQT_FIXTURE_DIR": "fx"})
    assert s.fixture_dir == (tmp_path / "fx").resolve() and s.fixture_dir.is_absolute()


def test_the_checked_in_fixtures_folder_is_accepted():
    fixtures = ROOT / "terminal" / "backend" / "tests" / "fixtures"
    s = load_settings({"NQT_FIXTURE_DIR": str(fixtures)})
    assert s.fixture_mode and s.data_root == fixtures.resolve()


# ---------------------------------------------------------------- NQT_STATE_DIR (the backend's own state folder)


def test_state_dir_defaults_to_the_terminal_state_folder():
    from nq_terminal import settings as settings_module

    assert settings_module.TERMINAL_STATE_DIR == ROOT / "terminal" / "state"
    # Under pytest the default is redirected to a per-test folder (conftest); outside it is TERMINAL_STATE_DIR.
    assert load_settings({}).state_dir == settings_module.DEFAULT_STATE_DIR.resolve()


def test_state_dir_comes_from_the_environment_resolved_strictly(tmp_path, monkeypatch):
    (tmp_path / "st").mkdir()
    monkeypatch.chdir(tmp_path)
    s = load_settings({"NQT_STATE_DIR": "st"})
    assert s.state_dir == (tmp_path / "st").resolve() and s.state_dir.is_absolute()


@pytest.mark.parametrize("raw", [SEP * 2 + "localhost" + SEP + "c$" + SEP + "nqt", "//localhost/c$/nqt",
                                 SEP * 2 + "server" + SEP + "share"])
def test_state_dir_unc_paths_are_refused_before_any_network_access(raw, monkeypatch):
    def no_network(self):
        raise AssertionError("a UNC state folder must be refused before it is touched")

    monkeypatch.setattr(Path, "is_dir", no_network)
    monkeypatch.setattr(Path, "resolve", no_network)
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": raw})


@pytest.mark.parametrize("prefix", [DEVICE, SEP * 2 + "." + SEP])
def test_state_dir_device_paths_are_refused(tmp_path, prefix):
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": prefix + str(tmp_path)})


def test_state_dir_must_exist_and_be_a_folder(tmp_path):
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(tmp_path / "missing")})
    (tmp_path / "file.txt").write_text("x", encoding="utf-8")
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": str(tmp_path / "file.txt")})


@pytest.mark.parametrize("raw", [
    ROOT.anchor,  # the drive root above the project, wherever the lab lives (a junction can put it on E:)
    str(ROOT),
    str(ROOT.parent),
    str(ROOT / "results"),
    str(ROOT / "data"),
    str(ROOT / "live"),
    str(ROOT / "backtests" / "output"),
])
def test_state_dir_may_not_be_the_project_a_parent_or_a_research_folder(raw):
    with pytest.raises(SettingsError, match="NQT_STATE_DIR"):
        load_settings({"NQT_STATE_DIR": raw})


def test_under_pytest_the_state_dir_is_a_per_test_folder_not_the_real_one(tmp_path):
    """The autouse fixture in conftest.py redirects NQT_STATE_DIR and the default; born failing without it."""
    real = (ROOT / "terminal" / "state").resolve()
    for s in (load_settings(), load_settings({})):
        assert not s.state_dir.is_relative_to(real), s.state_dir
        assert s.state_dir.is_relative_to(tmp_path.parent), s.state_dir


# ---------------------------------------------------------------- desktop and launcher modes (W2A, 04 D2.1, 02 O5)

def test_the_browser_terminal_keeps_its_defaults():
    s = load_settings({})
    assert (s.desktop, s.stdin_control, s.dev, s.jobs_enabled) == (False, False, False, True)
    assert (s.port, s.cache_bytes, s.file_cache_bytes, s.mode) == (8765, 2 * 1024**3, None, "browser")
    assert s.reads_stdin is False


def test_desktop_mode_binds_port_0_and_uses_the_desktop_caps():
    s = load_settings({"NQT_DESKTOP": "1"})
    assert (s.desktop, s.mode, s.reads_stdin, s.port) == (True, "desktop", True, 0)
    assert (s.cache_bytes, s.file_cache_bytes) == (512 * 1024**2, 128 * 1024**2)


def test_desktop_mode_accepts_an_explicit_port_and_cache_cap():
    s = load_settings({"NQT_DESKTOP": "1", "NQT_PORT": "0", "NQT_CACHE_BYTES": "1048576"})
    assert (s.port, s.cache_bytes) == (0, 1048576)
    assert load_settings({"NQT_DESKTOP": "1", "NQT_PORT": "9001"}).port == 9001


@pytest.mark.parametrize("value", ["0", "", "true", "yes", " 1", "1 "])
def test_only_exactly_1_turns_desktop_mode_on(value):
    s = load_settings({"NQT_DESKTOP": value})
    assert s.desktop is False and s.port == 8765 and s.cache_bytes == 2 * 1024**3


@pytest.mark.parametrize("env", [{"NQT_PORT": "0"}, {"NQT_PORT": "0", "NQT_STDIN_CONTROL": "1"},
                                 {"NQT_PORT": "0", "NQT_DESKTOP": "true"}, {"NQT_DESKTOP": "1", "NQT_PORT": "-1"}])
def test_port_0_is_refused_outside_desktop_mode(env):
    with pytest.raises(SettingsError, match="NQT_PORT"):
        load_settings(env)


def test_launcher_mode_reads_stdin_and_keeps_its_port():
    s = load_settings({"NQT_STDIN_CONTROL": "1", "NQT_PORT": "8765"})
    assert (s.stdin_control, s.desktop, s.mode, s.reads_stdin, s.port) == (True, False, "launcher", True, 8765)
    assert s.cache_bytes == 2 * 1024**3 and s.file_cache_bytes is None


@pytest.mark.parametrize(("value", "enabled"), [("off", False), ("OFF", False), (" off ", False), ("on", True),
                                                ("", True)])
def test_nqt_jobs_off_turns_the_queue_off(value, enabled):
    assert load_settings({"NQT_JOBS": value}).jobs_enabled is enabled


@pytest.mark.parametrize("value", ["of", "0", "false", "disabled"])
def test_an_unknown_nqt_jobs_value_is_refused(value):
    with pytest.raises(SettingsError, match="NQT_JOBS"):
        load_settings({"NQT_JOBS": value})


def test_nqt_dev_is_on_only_for_exactly_1():
    assert load_settings({"NQT_DEV": "1"}).dev is True
    assert load_settings({"NQT_DEV": "yes"}).dev is False and load_settings({}).dev is False


def test_desktop_mode_keeps_the_state_dir(tmp_path):
    assert load_settings({"NQT_DESKTOP": "1", "NQT_STATE_DIR": str(tmp_path)}).state_dir == tmp_path.resolve()


@pytest.mark.parametrize(("env", "keeps"), [
    ({"NQT_DESKTOP": "1"}, False),  # the app: the two-day sparkline reads its exact window (W5C D1)
    ({}, True),  # the browser terminal keeps the year-aligned read (PRD DL1)
    ({"NQT_STDIN_CONTROL": "1"}, True),  # the launcher too
    ({"NQT_DESKTOP": "0"}, True),
])
def test_only_desktop_mode_reads_the_two_day_window_without_keeping_the_year(env, keeps):
    assert load_settings(env).two_day_keeps_year is keeps


def test_two_day_keeps_year_follows_the_desktop_field():
    from dataclasses import replace

    base = load_settings({})
    assert replace(base, desktop=True).two_day_keeps_year is False
    assert replace(base, desktop=False, stdin_control=True).two_day_keeps_year is True


@pytest.mark.parametrize(("env", "keeps"), [
    ({"NQT_TWO_DAY_WINDOW": "1"}, False),  # measurement only: the browser form reads the same window as the app
    ({"NQT_TWO_DAY_WINDOW": "1", "NQT_STDIN_CONTROL": "1"}, False),
    ({"NQT_TWO_DAY_WINDOW": "1", "NQT_DESKTOP": "1"}, False),
    ({"NQT_TWO_DAY_WINDOW": "0"}, True),
    ({"NQT_TWO_DAY_WINDOW": "yes"}, True),
    ({"NQT_TWO_DAY_WINDOW": ""}, True),
])
def test_the_two_day_window_switch_gives_the_browser_form_the_apps_read(env, keeps):
    s = load_settings(env)
    assert s.two_day_keeps_year is keeps
    assert s.two_day_window_only is (env.get("NQT_TWO_DAY_WINDOW") == "1")
