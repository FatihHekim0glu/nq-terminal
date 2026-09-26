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
    "C:/",
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
