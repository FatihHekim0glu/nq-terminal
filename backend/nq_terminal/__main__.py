"""Start the terminal on 127.0.0.1 only: `python -m nq_terminal` with `terminal/backend` on the path.

The bind host is `settings.BIND_HOST` in code, never a command-line flag. The `Server` header is off and proxy headers
are ignored (nothing sits in front of the terminal, so an `X-Forwarded-For` must not rewrite the client address that
`LoopbackOnlyMiddleware` checks).

The start path (03 sections 2.2 and 2.4, Appendix A row 2):

0. Before the app's imports load numpy, scipy or pyarrow, cap their native thread pools for this process only
   (`threadcaps.py`; 0.1.1 idle memory). Backtest children keep every core: their allow list drops the cap names.
1. A live lock in the state folder (`desktop/lock.py`) means another backend serves this lab: print
   `NQT-ATTACH {"port": P}` and exit 0 without binding anything. A lock whose owner or rights are not this user's
   (planted by another principal) is never attached to or replaced: exit `EXIT_UNTRUSTED_LOCK` naming the file.
2. In desktop mode (NQT_DESKTOP=1, the app) or launcher mode (NQT_STDIN_CONTROL=1, start.ps1), read `TOKEN <hex>` and
   `NONCE <hex>` once each from stdin on a daemon thread; end of file there calls `watchdog.on_eof()`, which stops the
   server. Otherwise stdin is never read and the token is a fresh random one. The token never appears in argv, the
   environment, a URL or a log.
3. Bind 127.0.0.1 here with exclusive use in every mode (port 0 in desktop mode, `NQT_PORT` otherwise, 8765 for the
   launchers) and hand the socket to uvicorn, so the port is known before the app is built and its same-origin list
   names it, and a busy port is refused rather than shared.
4. The app's start-up takes the lock (`desktop/lifecycle.py`); once the server is up, print one `NQT-READY {json}`
   line (`desktop/handshake.py`). Losing a race for the lock in the start-up also ends in `NQT-ATTACH` and exit 0.

A shutdown waits at most `SHUTDOWN_GRACE_S` for open responses. Without the bound, an open live stream
(`/api/live/stream`) would hold the shutdown until its lifetime ends; with it, the stream is cut and the browser
reconnects to the next server with `Last-Event-ID` (tests/test_live_stream_server.py).

Uvicorn started directly (`uvicorn nq_terminal.app:create_app`, the fixture and Playwright backends) never runs this
file, so it never reads stdin; the lock is still taken by the app's start-up.
"""
from __future__ import annotations

import os
import socket
import sys
from collections.abc import Callable
from dataclasses import replace
from typing import Any, Mapping

import uvicorn
from fastapi import FastAPI

from nq_terminal.threadcaps import cap_native_pools

# Before numpy, scipy or pyarrow loads (nq_terminal.app imports them): small native thread pools for the server process
# only, an explicit setting still winning (threadcaps.py; 0.1.1 idle memory).
cap_native_pools(os.environ)

from nq_terminal.app import create_app  # noqa: E402
from nq_terminal.desktop import handshake, lifecycle, lock, watchdog  # noqa: E402
from nq_terminal.desktop.handshake import StdinChannel  # noqa: E402
from nq_terminal.desktop.lifecycle import Runtime  # noqa: E402
from nq_terminal.services.prewarm import PORT_BOUND_KEY  # noqa: E402
from nq_terminal.settings import BIND_HOST, Settings, load_settings  # noqa: E402

SHUTDOWN_GRACE_S = 2
TOKEN_WAIT_S = 10.0
STDIN_FD = 0
EXIT_ATTACHED = 0
EXIT_NO_TOKEN = 2
EXIT_UNTRUSTED_LOCK = 4
SERVER_OPTIONS: Mapping[str, Any] = {
    "server_header": False,
    "proxy_headers": False,
    "timeout_graceful_shutdown": SHUTDOWN_GRACE_S,
}
AppBuilder = Callable[[Settings], FastAPI]


def _say(line: str) -> None:
    print(line, flush=True)


def bind_socket(settings: Settings) -> socket.socket:
    """127.0.0.1 on the settings' port (0 in desktop mode, 8765 for the launchers), with exclusive use.

    Uvicorn's own bind sets SO_REUSEADDR, which on Windows lets a second socket share the port; an exclusive bind is
    refused instead (WinError 10048), so a busy port fails loudly in every mode."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind((BIND_HOST, settings.port))
    except OSError:
        sock.close()
        raise
    return sock


def _channel(settings: Settings) -> StdinChannel | None:
    """The stdin reader, only in desktop or launcher mode; its end of file runs the watchdog.

    It reads an unbuffered view of file descriptor 0, not `sys.stdin.buffer`: a daemon thread blocked inside the
    buffered reader holds its lock, and the interpreter's shutdown would then abort on that lock."""
    if not settings.reads_stdin:
        return None
    return StdinChannel(watchdog.PollingStdin(STDIN_FD), on_eof=watchdog.on_eof).start()


def _announce_when_started(server: Any, app: FastAPI, nonce: str | None) -> None:
    """Print NQT-READY once uvicorn's start-up (the lifespan, so the lock) has finished and the socket listens."""
    original = getattr(server, "startup", None)
    if original is None:
        return

    async def startup(sockets: Any = None) -> None:
        await original(sockets=sockets)
        held, current = lifecycle.held_lock(app), lifecycle.runtime(app)
        if server.started and held is not None:
            _say(handshake.ready_line(handshake.ready_payload(
                app.state.settings, token=current.token, nonce=nonce, port=current.port, pid=current.pid)))

    server.startup = startup


def _run(server: Any, sock: socket.socket, app: FastAPI, channel: StdinChannel | None) -> int:
    def stop() -> None:  # the watchdog's close hook
        server.should_exit = True

    watchdog.add_close_hook(stop)
    if channel is not None and channel.closed:  # the parent went away while the app was being built
        stop()
    if channel is not None:
        watchdog.arm_hard_exit()  # 03 2.4: an end of file on stdin ends the process within STOP_WITHIN_S
    try:
        server.run(sockets=[sock])
    except SystemExit:
        if lifecycle.attach_info(app) is None:
            raise
    finally:
        watchdog.remove_close_hook(stop)
        watchdog.disarm_hard_exit()  # the hard exit belongs to the run of the server, not to the process that hosts it
    attached = lifecycle.attach_info(app)
    if attached is not None:
        _say(handshake.attach_line(attached.port))
    return EXIT_ATTACHED


def serve(settings: Settings, build: AppBuilder) -> int:
    """The start path shared by `python -m nq_terminal` and the fixture entry; returns the exit code."""
    try:
        live = lock.probe(settings.state_dir)
    except lock.LockUntrusted as untrusted:  # a lock this user did not make: neither attach nor replace
        print(f"nq_terminal: {untrusted}", file=sys.stderr, flush=True)
        return EXIT_UNTRUSTED_LOCK
    if live is not None:
        _say(handshake.attach_line(live.port))
        return EXIT_ATTACHED
    channel = _channel(settings)
    credentials = channel.wait(TOKEN_WAIT_S) if channel is not None else (lifecycle.new_token(), None)
    if credentials is None:
        print("nq_terminal: no TOKEN and NONCE lines on stdin; not serving", file=sys.stderr, flush=True)
        return EXIT_NO_TOKEN
    token, nonce = credentials
    sock = bind_socket(settings)
    port = sock.getsockname()[1]
    app = build(replace(settings, port=port))
    lifecycle.install(app, app.state.settings)
    lifecycle.set_runtime(app, Runtime(token=token, port=port, pid=os.getpid(), nonce=nonce, mode=settings.mode))
    server = uvicorn.Server(uvicorn.Config(app, host=BIND_HOST, port=port, **SERVER_OPTIONS))
    # uvicorn runs the lifespan startup before it starts listening, so the HOME prewarm polls this and begins only once
    # the port is bound (services/prewarm.py, api/home_prewarm.py).
    setattr(app.state, PORT_BOUND_KEY, lambda: server.started)
    _announce_when_started(server, app, nonce)
    return _run(server, sock, app, channel)


def main(env: Mapping[str, str] | None = None) -> int:
    return serve(load_settings(env), lambda settings: create_app(settings))


if __name__ == "__main__":
    sys.exit(main())
