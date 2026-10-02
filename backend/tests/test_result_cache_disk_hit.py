"""The crosscheck through the cache: a disk hit after a restart (04 D1.4; 02 section 4.1 item 1; 03 section 15.2).

The ledger and the deflated Sharpe are on the allow list and read no prices, so their bodies reach `<state>/cache/`.
A new process (a subprocess, so nothing is shared in memory) builds the same fixture app on the same state folder and
serves both from disk: 0 serve calls, 0 gate lines, the same bytes the first process computed. A price route is not
on the list, so the new process serves its prices again. Any change to an input, or to the code stamp, falls back to
computing.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from nq_terminal.services import result_cache as rc
from nq_terminal.settings import TERMINAL_DIR

from test_result_cache_routes import CASES, Lab

BACKEND = Path(__file__).resolve().parents[1]
TESTS = BACKEND / "tests"
PERSISTED = ("ledger", "deflated")
NOT_PERSISTED = ("two_day", "compare", "spa", "seasonality")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

CHILD = textwrap.dedent(
    """
    import hashlib, json, os, sys
    from pathlib import Path

    sys.path[:0] = [{backend!r}, {tests!r}]
    from conftest import api_client  # the shared authenticated client, in the child process too
    from fixture_app import create_fixture_app
    from nq_terminal.api import data
    from nq_terminal.services import result_cache as rc
    from test_result_cache_routes import CountingServe

    if os.environ.get("W1B_TEST_STAMP"):
        rc.code_stamp = lambda: os.environ["W1B_TEST_STAMP"]

    env = {{"NQT_FIXTURE_DIR": {root!r}, "NQT_STATE_DIR": {state!r}}}
    app = create_fixture_app(env, log_dir=Path({log!r}))
    serve = CountingServe(app.state.serve_fn)
    app.state.serve_fn = serve
    client = api_client(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))
    out = {{}}
    for name, url in {urls!r}.items():
        response = client.get(url)
        out[name] = [response.status_code, hashlib.sha256(response.content).hexdigest()]
    stats = data.get_result_cache(app.state).stats()
    log = app.state.fixture_log
    print(json.dumps({{"bodies": out, "serve_calls": serve.calls, "disk_hits": stats.disk_hits,
                       "misses": stats.misses, "hits": stats.hits, "disk_writes": stats.disk_writes,
                       "gate_lines": len(log.read_text(encoding="utf-8").splitlines()) if log.exists() else 0}}))
    """
)


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def run_child(lab: Lab, names: tuple[str, ...], tmp_path: Path, extra_env: dict[str, str] | None = None) -> dict:
    """A new process over the same fixture copy and state folder, asked for `names`."""
    script = CHILD.format(backend=str(BACKEND), tests=str(TESTS), root=str(lab.root), state=str(lab.state),
                          log=str(tmp_path / "child-log"), urls={n: CASES[n]["url"] for n in names})
    env = {**os.environ, "NQT_FIXTURE_DIR": str(lab.root), "NQT_STATE_DIR": str(lab.state), **(extra_env or {})}
    done = subprocess.run([sys.executable, "-X", "utf8", "-c", script], capture_output=True, text=True, env=env,
                          cwd=str(BACKEND), timeout=300, creationflags=NO_WINDOW)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout.strip().splitlines()[-1])


@pytest.fixture()
def lab(tmp_path: Path) -> Lab:
    return Lab(tmp_path).build()


def computed(lab: Lab, names: tuple[str, ...]) -> dict[str, str]:
    out = {}
    for name in names:
        response = lab.client.get(CASES[name]["url"])
        assert response.status_code == 200, name
        out[name] = digest(response.content)
    return out


def disk_files(lab: Lab) -> list[Path]:
    folder = lab.state / rc.CACHE_FOLDER
    return sorted(folder.glob("*.bin")) if folder.is_dir() else []


# ---------------------------------------------------------------- the restart


def test_allow_listed_routes_are_written_and_served_from_disk_after_a_restart(lab, tmp_path):
    first = computed(lab, PERSISTED)
    assert len(disk_files(lab)) == 2, "each allow-listed body is on disk"
    assert lab.cache.stats().disk_writes == 2

    child = run_child(lab, PERSISTED, tmp_path)
    assert child["serve_calls"] == 0 and child["gate_lines"] == 0, "a disk hit makes no serve call and no gate line"
    assert (child["disk_hits"], child["misses"], child["disk_writes"]) == (2, 0, 0)
    assert {n: v[1] for n, v in child["bodies"].items()} == first, "byte-equal to what the first process computed"
    assert all(v[0] == 200 for v in child["bodies"].values())


def test_a_recomputation_in_a_new_process_gives_the_bytes_the_disk_held(lab, tmp_path):
    first = computed(lab, PERSISTED)
    for entry in disk_files(lab):
        entry.unlink()
    again = run_child(lab, PERSISTED, tmp_path)
    assert again["disk_hits"] == 0 and again["misses"] == 2
    assert {n: v[1] for n, v in again["bodies"].items()} == first


def test_a_price_route_is_not_written_so_a_new_process_serves_prices_again(lab, tmp_path):
    first = computed(lab, ("two_day",))
    assert disk_files(lab) == [], "nothing price-derived reaches the disk"
    calls = lab.serve.calls
    assert calls >= 1
    child = run_child(lab, ("two_day",), tmp_path)
    assert child["serve_calls"] == calls and child["gate_lines"] >= 1 and child["disk_hits"] == 0
    assert child["bodies"]["two_day"][1] == first["two_day"]


@pytest.mark.parametrize("name", [n for n in NOT_PERSISTED if n != "two_day"])
def test_only_the_allow_list_is_written(name, lab):
    computed(lab, (name,))
    assert disk_files(lab) == [], f"{name} is not on the allow list"


# ---------------------------------------------------------------- what makes a disk entry unusable


@pytest.mark.parametrize("name", PERSISTED)
@pytest.mark.parametrize("by", ["mtime", "size"])
def test_an_input_changed_while_the_backend_was_down_forces_a_recompute(name, by, lab, tmp_path):
    first = computed(lab, (name,))
    for relative in CASES[name]["files"]:
        lab.touch(relative, size=by == "size")
    child = run_child(lab, (name,), tmp_path)
    assert (child["disk_hits"], child["misses"]) == (0, 1)
    assert child["bodies"][name][1] == first[name], "the recomputed body is the same bytes"


def test_a_new_code_stamp_discards_the_disk_entries(lab, tmp_path):
    computed(lab, PERSISTED)
    child = run_child(lab, PERSISTED, tmp_path, extra_env={"W1B_TEST_STAMP": "another-build"})
    assert (child["disk_hits"], child["misses"]) == (0, 2)


def test_a_damaged_disk_entry_is_not_served(lab, tmp_path):
    first = computed(lab, ("ledger",))
    (entry,) = disk_files(lab)
    raw = entry.read_bytes()
    entry.write_bytes(raw[:-1] + (b"X" if raw[-1:] != b"X" else b"Y"))
    child = run_child(lab, ("ledger",), tmp_path)
    assert (child["disk_hits"], child["misses"]) == (0, 1) and child["bodies"]["ledger"][1] == first["ledger"]


def test_the_disk_folder_is_inside_the_fixture_state_folder_only(lab):
    computed(lab, PERSISTED)
    real = (TERMINAL_DIR / "state").resolve()
    files = disk_files(lab)
    assert files and all(p.resolve().is_relative_to(lab.state.resolve()) for p in files)
    assert not any(p.resolve().is_relative_to(real) for p in files)
