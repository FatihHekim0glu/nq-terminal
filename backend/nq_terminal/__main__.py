"""Start the terminal on 127.0.0.1 only: `python -m nq_terminal` with `terminal/backend` on the path.

The bind host is `settings.BIND_HOST` in code, never a command-line flag; the port is `NQT_PORT`. The
`Server` header is off and proxy headers are ignored (nothing sits in front of the terminal, so an
`X-Forwarded-For` must not rewrite the client address that `LoopbackOnlyMiddleware` checks).

A shutdown waits at most `SHUTDOWN_GRACE_S` for open responses. Without the bound, an open live stream
(`/api/live/stream`) would hold the shutdown until its lifetime ends; with it, the stream is cut and the
browser reconnects to the next server with `Last-Event-ID` (tests/test_live_stream_server.py).
"""
from __future__ import annotations

from typing import Any, Mapping

import uvicorn

from nq_terminal.app import create_app
from nq_terminal.services.prewarm import PORT_BOUND_KEY
from nq_terminal.settings import BIND_HOST, load_settings

SHUTDOWN_GRACE_S = 2
SERVER_OPTIONS: Mapping[str, Any] = {
    "server_header": False,
    "proxy_headers": False,
    "timeout_graceful_shutdown": SHUTDOWN_GRACE_S,
}


def main(env: Mapping[str, str] | None = None) -> None:
    settings = load_settings(env)
    app = create_app(settings)
    server = uvicorn.Server(uvicorn.Config(app, host=BIND_HOST, port=settings.port, **SERVER_OPTIONS))
    # uvicorn runs the lifespan startup before it creates the listening socket, so the HOME prewarm polls this and
    # begins only once the port is bound (services/prewarm.py, api/home_prewarm.py).
    setattr(app.state, PORT_BOUND_KEY, lambda: server.started)
    server.run()


if __name__ == "__main__":
    main()
