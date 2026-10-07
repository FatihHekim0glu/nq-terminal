"""V031: how long the launcher's proof poll holds the HOME prewarm back (V021 startup review, unmeasured until now).

Since V021 the prewarm waits for the start gate (`services/prewarm.StartGate`): in launcher mode (`start.ps1`,
NQT_STDIN_CONTROL=1) that is the first identity proof answered after READY, or `PROOF_FALLBACK_S` after READY when no
proof comes. The launcher proves by polling `/api/desktop/proof` every 400 ms (`Wait-BackendReady` in `start.ps1`) and
opens the browser only once a proof has passed, so HOME's own requests can never come before that proof. The prewarm's
lost head start, and so the most it can add before HOME data, is the time from READY to the first task.

Measured here on the fixture backend through the real start path (`python -m nq_terminal`'s `serve`, hidden, its own
state folder under D:/dev/tmp, a spare port, the prewarm's tasks replaced by a stand-in that reads nothing), with the
launcher's poll made two ways: the same loop in PowerShell (`Invoke-WebRequest`, 400 ms apart, as `start.ps1` does it)
and a plain loop in this process. The rule (V031 task 3): if the poll adds more than `ADDED_BUDGET_S` the prewarm
starts on READY in launcher mode. Measured on V021's gate (18 starts per poller, 2026-10-06, the machine busy with
another build): the PowerShell poll held it back 15 to 532 ms (mean 178 ms), the plain loop 219 to 484 ms (mean
381 ms). 532 ms is over the budget, so launcher mode now opens the gate on READY (`LAUNCHER_FALLBACK_S`); the test
holds that: READY to the first task within `ON_READY_SLACK_S` with either poll (born failing on V021's gate, where the
plain loop's starts all but never stay under it). Each run prints one `LAUNCHER-PREWARM-DELAY` line with the numbers.

Nothing here touches 127.0.0.1:8765, reads a price or starts a real prewarm task.
"""
from __future__ import annotations

import json
import secrets
import statistics
import subprocess
import sys
import threading
import urllib.request
from pathlib import Path

import pytest

from nq_terminal.services.prewarm import LAUNCHER_FALLBACK_S, PROOF_FALLBACK_S

from conftest import (
    BACKEND,
    HIDDEN,
    WindowWatch,
    desktop_env,
    fresh_lock_dir,
    remove_lock_dir,
    spawn_backend,
    wait_until,
)

TOKEN = "7c" * 32
NONCE = "a9" * 32
LAUNCHER_POLL_S = 0.4  # start.ps1 Wait-BackendReady: Start-Sleep -Milliseconds 400 between proofs
PROOF_TIMEOUT_S = 3  # start.ps1 Invoke-LoopGet: -TimeoutSec 3
ADDED_BUDGET_S = 0.5  # V031 task 3: more than this before HOME data and launcher mode starts the prewarm on READY
ON_READY_SLACK_S = 0.25  # READY to the first task when the gate opens on READY (the prewarm polls it every 50 ms)
STARTS = 3  # starts per poller
STAMP_WAIT_S = 30.0
FIXTURES = BACKEND / "tests" / "fixtures"

DRIVER = r'''
import sys
import time

import nq_terminal.__main__ as entry
from nq_terminal.api import home_prewarm
from nq_terminal.app import create_app
from nq_terminal.settings import load_settings


def stamp(label):
    print("STAMP " + label + " " + repr(time.monotonic()), flush=True)


def record():
    stamp("TASK")


# The fixture has no price source, so the app never prewarms there; the stand-in reads nothing, so allow it here.
home_prewarm.home_prewarm_allowed = lambda app, environ=None: True
home_prewarm.home_tasks = lambda state: [record]
home_prewarm.later_tasks = lambda state: []
plain_say = entry._say


def say(line):
    plain_say(line)
    if line.startswith("NQT-READY"):
        stamp("READY")


entry._say = say
sys.exit(entry.serve(load_settings(), create_app))
'''

POWERSHELL_POLL = r'''
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    try {
        $reply = Invoke-WebRequest -UseBasicParsing -TimeoutSec %(timeout)d -Uri '%(url)s'
        if ($reply.StatusCode -eq 200) { [Console]::Out.WriteLine('PROVED'); [Console]::Out.Flush(); exit 0 }
    } catch { }
    Start-Sleep -Milliseconds %(sleep_ms)d
}
exit 1
'''


def stamps(backend) -> dict[str, float]:
    found: dict[str, float] = {}
    for line in list(backend.stdout_lines):
        if line.startswith("STAMP "):
            _, label, value = line.split(" ", 2)
            found.setdefault(label, float(value))
    return found


def free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert port != 8765
    return port


def launcher_env(folder: Path, port: int) -> dict[str, str]:
    env = desktop_env(folder)
    env.pop("NQT_DESKTOP")
    env.update({"NQT_STDIN_CONTROL": "1", "NQT_PORT": str(port), "NQT_PREWARM": "1", "NQT_MEMTRIM": "0",
                "NQT_FIXTURE_DIR": str(FIXTURES)})
    return env


def proof_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/api/desktop/proof?nonce={secrets.token_hex(32)}"


class PythonPoll:
    """The launcher's loop in this process: a proof every 400 ms until one answers 200."""

    def __init__(self, port: int) -> None:
        self.port, self._stop = port, threading.Event()
        self._thread = threading.Thread(target=self._run, name="launcher-poll", daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with urllib.request.urlopen(proof_url(self.port), timeout=PROOF_TIMEOUT_S) as answer:
                    if answer.status == 200:
                        return
            except OSError:
                pass
            self._stop.wait(LAUNCHER_POLL_S)

    def start(self) -> "PythonPoll":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(PROOF_TIMEOUT_S + 2)


class PowerShellPoll:
    """`start.ps1`'s loop, in a hidden Windows PowerShell: `Invoke-WebRequest` every 400 ms until one answers 200."""

    def __init__(self, port: int) -> None:
        script = POWERSHELL_POLL % {"timeout": PROOF_TIMEOUT_S, "url": proof_url(port),
                                    "sleep_ms": int(LAUNCHER_POLL_S * 1000)}
        self._proc = subprocess.Popen(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                       "-Command", script], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, creationflags=HIDDEN)

    def start(self) -> "PowerShellPoll":
        return self

    def stop(self) -> None:
        if self._proc.poll() is None:
            try:
                self._proc.wait(timeout=PROOF_TIMEOUT_S + 5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=10)
        if self._proc.stdout is not None:
            self._proc.stdout.close()


POLLERS = {"powershell": PowerShellPoll, "python": PythonPoll}


def one_start(poller: str) -> float:
    """READY to the prewarm's first task, in seconds, for one launcher-style start with the launcher's poll running."""
    port = free_port()
    folder = fresh_lock_dir(f"v031-launcher-{poller}")
    poll = POLLERS[poller](port).start()  # start.ps1 starts its poll right after writing TOKEN and NONCE
    backend = spawn_backend(["-c", DRIVER], launcher_env(folder, port), token=TOKEN, nonce=NONCE)
    try:
        kind, payload = backend.first_nqt_line()
        assert kind == "NQT-READY", backend.stderr_text()
        assert payload["mode"] == "launcher" and payload["port"] == port != 8765
        assert wait_until(lambda: {"READY", "TASK"} <= set(stamps(backend)), STAMP_WAIT_S), backend.stderr_text()
        seen = stamps(backend)
        return seen["TASK"] - seen["READY"]
    finally:
        poll.stop()
        backend.stop()
        remove_lock_dir(folder)


windows_only = pytest.mark.skipif(sys.platform != "win32", reason="the Windows launcher start path")


@windows_only
@pytest.mark.parametrize("poller", sorted(POLLERS))
def test_born_failing_a_launcher_start_begins_the_prewarm_on_ready_whatever_the_proof_poll(poller):
    """The launcher's 400 ms poll no longer holds the prewarm back: READY to the first task stays within
    `ON_READY_SLACK_S` (and so within `ADDED_BUDGET_S`) for every start, with either form of the poll."""
    assert PROOF_FALLBACK_S > ADDED_BUDGET_S and LAUNCHER_FALLBACK_S == 0.0
    watch = WindowWatch().start()
    try:
        delays = [one_start(poller) for _ in range(STARTS)]
    finally:
        problems = watch.stop()
    print("LAUNCHER-PREWARM-DELAY " + json.dumps({
        "poller": poller, "starts": len(delays), "delays_ms": [round(d * 1000) for d in delays],
        "mean_ms": round(statistics.fmean(delays) * 1000), "max_ms": round(max(delays) * 1000),
        "budget_ms": round(ADDED_BUDGET_S * 1000), "slack_ms": round(ON_READY_SLACK_S * 1000)}))
    assert not problems, problems
    assert all(d >= 0 for d in delays), delays  # never before READY
    assert max(delays) <= ON_READY_SLACK_S <= ADDED_BUDGET_S, f"the prewarm began {max(delays):.3f} s after READY"
