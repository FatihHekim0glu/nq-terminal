"""Start the terminal on 127.0.0.1 only: `python -m nq_terminal` with `terminal/backend` on the path.

The bind host is `settings.BIND_HOST` in code, never a command-line flag; the port is `NQT_PORT`. The
`Server` header is off and proxy headers are ignored (nothing sits in front of the terminal, so an
`X-Forwarded-For` must not rewrite the client address that `LoopbackOnlyMiddleware` checks).
"""
from __future__ import annotations

from typing import Mapping

import uvicorn

from nq_terminal.app import create_app
from nq_terminal.settings import BIND_HOST, load_settings


def main(env: Mapping[str, str] | None = None) -> None:
    settings = load_settings(env)
    uvicorn.run(create_app(settings), host=BIND_HOST, port=settings.port, server_header=False,
                proxy_headers=False)


if __name__ == "__main__":
    main()
