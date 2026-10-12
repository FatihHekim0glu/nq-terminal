"""The READY payload's `dist` is exact, and the READY path walks no source tree (startup.md 7.4; metrics.md 2.1).

`ready_payload` used to call `dist_status`, which stats every file under `web/src` (736 of them in the lab tree, 27 to
34 ms) on the READY path. The shell refuses a READY whose `dist` is not `current` and then runs its rebuild flow
(`supervise_check.check_ready`, `stale_page::hook`), so the answer must stay exact: a file edited deep under `web/src`
or `web/public` after the build must still give `stale`. The walk therefore runs earlier, on a daemon thread that
`serve` starts before it builds the app (`handshake.DistWalk`), and `ready_payload` only reads its result. Without a
walk, or when the walk gave no answer, `ready_payload` walks inline, so the answer is never weaker.

Every case runs on a small fake web folder under `tmp_path`; the walk is made to raise by patching
`build_stamp.source_files`.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from nq_terminal import __main__ as launcher
from nq_terminal.desktop import build_stamp, handshake, lifecycle
from nq_terminal.desktop.build_stamp import CURRENT, MISSING, STALE
from nq_terminal.desktop.lifecycle import Runtime
from nq_terminal.settings import Settings

T0 = 1_700_000_000.0
TOKEN = "ab" * 32
NONCE = "cd" * 32


def _touch(path: Path, when: float, text: str = "x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    os.utime(path, (when, when))
    return path


def _write_stamp(web: Path, contract: Path, *, mtime_ms: int | None = None) -> None:
    body = {"v": 1, "newest_source_mtime_ms": int(T0 * 1000) if mtime_ms is None else mtime_ms,
            "openapi_sha256": hashlib.sha256(contract.read_bytes()).hexdigest()}
    (web / "dist" / build_stamp.STAMP_NAME).write_text(json.dumps(body), encoding="utf-8")


@pytest.fixture
def lab(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    web, contract, state = tmp_path / "web", tmp_path / "contract" / "openapi.json", tmp_path / "state"
    state.mkdir()
    _touch(web / "src" / "main.ts", T0)
    _touch(web / "src" / "deep" / "view.tsx", T0)
    _touch(web / "index.html", T0)
    _touch(web / "package.json", T0, "{}")
    _touch(contract, T0, '{"openapi": "3.1.0"}')
    _touch(web / "dist" / "index.html", T0 + 10)
    _write_stamp(web, contract)
    monkeypatch.setattr(handshake, "OPENAPI", contract)
    settings = Settings(root=tmp_path, web_dist=web / "dist", state_dir=state)
    return {"web": web, "contract": contract, "state": state, "settings": settings}


def _walked(lab: dict[str, Any]) -> handshake.DistWalk:
    """A start-path walk that has finished (what `serve` hands the READY hook)."""
    walk = handshake.DistWalk.start(lab["web"])
    assert walk.newest_ms() is not None
    return walk


def _ready(lab: dict[str, Any], walk: handshake.DistWalk | None = None) -> dict[str, Any]:
    return handshake.ready_payload(lab["settings"], token=TOKEN, nonce=NONCE, port=1234, pid=99, dist_walk=walk)


def _refuse_walks(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: Any, **kwargs: Any) -> list[Path]:
        raise AssertionError("the web sources were walked")

    monkeypatch.setattr(build_stamp, "source_files", refuse)


def test_ready_payload_walks_no_source_tree(lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    """Born failing: `ready_payload` called `dist_status`, which walks `web/src` on the READY path."""
    walk = _walked(lab)
    _refuse_walks(monkeypatch)
    assert _ready(lab, walk)["dist"] == CURRENT


def test_the_test_walk_guard_can_fail(lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    """Guard for the guard: the same patch makes the full status raise, so the test above would notice a walk."""
    _refuse_walks(monkeypatch)
    with pytest.raises(AssertionError, match="walked"):
        build_stamp.dist_status(lab["web"], handshake.OPENAPI)


def test_a_deep_source_newer_than_the_stamp_is_stale_at_ready(
        lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    """Born failing (fixer): the quick check said `current` here, so the shell served the old page with no rebuild."""
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))
    walk = _walked(lab)
    _refuse_walks(monkeypatch)
    assert _ready(lab, walk)["dist"] == STALE


def test_a_deep_public_file_newer_than_the_stamp_is_stale_at_ready(lab: dict[str, Any]) -> None:
    _touch(lab["web"] / "public" / "icons" / "logo.svg", T0 + 800)
    assert _ready(lab, _walked(lab))["dist"] == STALE


def test_without_a_walk_ready_payload_walks_inline_and_stays_exact(lab: dict[str, Any]) -> None:
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))
    assert _ready(lab)["dist"] == STALE


def test_a_walk_of_another_web_folder_is_not_used(lab: dict[str, Any], tmp_path: Path) -> None:
    other = tmp_path / "other-web"
    _touch(other / "src" / "main.ts", T0)
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))
    assert _ready(lab, handshake.DistWalk.start(other))["dist"] == STALE


def test_a_walk_that_failed_falls_back_to_an_inline_walk(lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> int:
        raise OSError("disk gone")

    monkeypatch.setattr(build_stamp, "newest_source_mtime_ms", boom)
    walk = handshake.DistWalk.start(lab["web"])
    assert walk.newest_ms() is None
    monkeypatch.undo()
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))
    assert _ready(lab, walk)["dist"] == STALE


def test_the_walk_runs_on_a_daemon_thread() -> None:
    walk = handshake.DistWalk.start(Path("does-not-exist"))
    assert walk.newest_ms() == 0
    assert walk.thread is not None and walk.thread.daemon and walk.thread.name == "nqt-dist-walk"


@pytest.mark.parametrize("change", ["no dist", "no stamp", "bad stamp", "contract", "top level"])
def test_the_ready_answer_equals_the_full_status(lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
                                                 change: str) -> None:
    web, dist = lab["web"], lab["web"] / "dist"
    if change == "no dist":
        (dist / "index.html").unlink()
    elif change == "no stamp":
        (dist / build_stamp.STAMP_NAME).unlink()
    elif change == "bad stamp":
        (dist / build_stamp.STAMP_NAME).write_text("not json", encoding="utf-8")
    elif change == "contract":
        lab["contract"].write_text('{"openapi": "3.1.1"}', encoding="utf-8")
    else:
        os.utime(web / "package.json", (T0 + 900, T0 + 900))
    expected = build_stamp.dist_status(web, handshake.OPENAPI)
    walk = _walked(lab)
    _refuse_walks(monkeypatch)
    assert _ready(lab, walk)["dist"] == expected == (MISSING if change == "no dist" else STALE)


def test_the_ready_fields_and_their_order_are_unchanged(lab: dict[str, Any]) -> None:
    payload = _ready(lab, _walked(lab))
    assert list(payload) == ["v", "port", "pid", "proof", "root", "prefix", "nq_lab", "nq_terminal", "contract",
                             "openapi_sha256", "dist", "mode"]
    assert payload["openapi_sha256"] == hashlib.sha256(lab["contract"].read_bytes()).hexdigest()
    assert payload["dist"] == CURRENT


def test_the_ready_hook_hands_the_start_path_walk_to_ready_payload(
        lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from nq_terminal import __main__ as launcher
    from nq_terminal.desktop import lifecycle
    from nq_terminal.desktop.lifecycle import Runtime

    class Server:
        started = True

        async def startup(self, sockets: Any = None) -> None:
            return None

    state = SimpleNamespace(settings=lab["settings"])
    setattr(state, lifecycle.RUNTIME_KEY, Runtime(token=TOKEN, port=1234, pid=99))
    setattr(state, lifecycle.LOCK_KEY, object())
    lines: list[str] = []
    monkeypatch.setattr(launcher, "_say", lines.append)
    monkeypatch.setattr(handshake, "schedule_dist_check", lambda *a, **k: None)
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))
    walk = _walked(lab)
    _refuse_walks(monkeypatch)
    server = Server()
    launcher._announce_when_started(server, SimpleNamespace(state=state), NONCE, walk)
    asyncio.run(server.startup())
    assert len(lines) == 1
    assert handshake.parse_line(lines[0])[1]["dist"] == STALE


def _check(lab: dict[str, Any], ready_dist: str) -> None:
    thread = handshake.schedule_dist_check(lab["settings"], ready_dist, delay_s=0.0)
    assert thread is not None and thread.daemon
    thread.join(timeout=10)
    assert not thread.is_alive()


def test_the_check_after_ready_warns_when_the_full_answer_differs(
        lab: dict[str, Any], caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="nq_terminal.desktop")
    ready_dist = _ready(lab, _walked(lab))["dist"]
    os.utime(lab["web"] / "src" / "deep" / "view.tsx", (T0 + 800, T0 + 800))  # a source changes after READY
    _check(lab, ready_dist)
    messages = [r.getMessage() for r in caplog.records if r.name == "nq_terminal.desktop"]
    assert len(messages) == 1 and "current" in messages[0] and "stale" in messages[0]


def test_the_check_after_ready_is_silent_when_the_answers_agree(
        lab: dict[str, Any], caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING, logger="nq_terminal.desktop")
    _check(lab, _ready(lab, _walked(lab))["dist"])
    assert [r for r in caplog.records if r.name == "nq_terminal.desktop"] == []


def test_the_check_after_ready_never_raises(lab: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> str:
        raise OSError("disk gone")

    monkeypatch.setattr(build_stamp, "dist_status", boom)
    _check(lab, CURRENT)


# ---- `_announce_when_started` schedules the full web build check once READY is out (startup.md 7.4) -----------------------------
# `ready_payload` only answers the cheap `dist` status, so the warning "a source changed after the build, rebuild" depends on
# `handshake.schedule_dist_check` being called from the start-up hook. The cases above test the check in isolation; these pin the
# call: once, with the settings and the READY payload's `dist`, after the READY line, and never when the server did not start or
# the lock is not held.

ANNOUNCE_DIST = "stale"


class FakeServer:
    def __init__(self, *, started: bool) -> None:
        self.started = started
        self.startups = 0

    async def startup(self, sockets: Any = None) -> None:
        self.startups += 1


def _announce_app(tmp_path: Path, *, locked: bool) -> SimpleNamespace:
    settings = Settings(root=tmp_path, web_dist=tmp_path / "web" / "dist", state_dir=tmp_path / "state")
    state = SimpleNamespace(settings=settings)
    app = SimpleNamespace(state=state)
    setattr(state, lifecycle.RUNTIME_KEY, Runtime(token="ab" * 32, port=51234, pid=4242))
    if locked:
        setattr(state, lifecycle.LOCK_KEY, object())
    return app


@pytest.fixture
def announce_events(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any]]:
    seen: list[tuple[str, Any]] = []
    monkeypatch.setattr(launcher, "_say", lambda line: seen.append(("say", line)))
    monkeypatch.setattr(handshake, "ready_payload", lambda settings, **_: {"dist": ANNOUNCE_DIST, "port": 51234})
    monkeypatch.setattr(handshake, "schedule_dist_check",
                        lambda settings, dist, *a, **k: seen.append(("check", (settings, dist))))
    return seen


def _announce_start(server: FakeServer, app: SimpleNamespace) -> None:
    launcher._announce_when_started(server, app, NONCE)
    asyncio.run(server.startup(sockets=None))


def test_the_dist_check_is_scheduled_once_after_the_ready_line(tmp_path: Path, announce_events: list[tuple[str, Any]]) -> None:
    app, server = _announce_app(tmp_path, locked=True), FakeServer(started=True)

    _announce_start(server, app)

    assert [kind for kind, _ in announce_events] == ["say", "check"]
    assert announce_events[0][1].startswith(handshake.READY_PREFIX)
    assert announce_events[1][1] == (app.state.settings, ANNOUNCE_DIST)


@pytest.mark.parametrize(("started", "locked"), [(False, True), (True, False)])
def test_no_ready_line_and_no_dist_check_when_the_start_did_not_finish(
        tmp_path: Path, announce_events: list[tuple[str, Any]], started: bool, locked: bool) -> None:
    app, server = _announce_app(tmp_path, locked=locked), FakeServer(started=started)

    _announce_start(server, app)

    assert server.startups == 1 and announce_events == []
