"""FastAPI app for the nq-lab terminal: read-only, GET only, loopback only, one origin.

Run: `python -m nq_terminal` from terminal/backend (binds 127.0.0.1 in code; see `__main__.py`).

- Middleware, outermost first: security headers; loopback peers only (`LoopbackOnlyMiddleware`, 403 for a
  client or local address that is not loopback); `TrustedHostMiddleware` for 127.0.0.1 and localhost (DNS
  rebinding control); `SameOriginApiMiddleware` (403 for a cross-site GET under /api). There is no CORS
  middleware, because the built SPA is served from the same origin (PRD DL13). See `security.py`.
- Every registered route must be GET; `create_app` refuses to build an app that registers anything else.
  The one mount allowed is a plain `StaticFiles` at `/` serving exactly `settings.web_dist`; any other
  mount (a sub-app, a StaticFiles subclass, another path or folder) is refused, so data/ or results/ can
  never be served around the gate and FileCache.
- `web/dist` is mounted at `/` only when it exists (after the API routes, so `/api` always wins).
- Interactive docs are off (they load scripts from a CDN); the schema is at /api/openapi.json.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.routing import BaseRoute, Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from nq_terminal import __version__
from nq_terminal.api import system
from nq_terminal.api import audit, commands, live  # 2.4
from nq_terminal.api import research  # 2.2
from nq_terminal.api import runs  # 2.1
from nq_terminal.api import data  # 2.3
from nq_terminal.security import (
    LoopbackOnlyMiddleware,
    SameOriginApiMiddleware,
    SecurityHeadersMiddleware,
    terminal_origins,
)
from nq_terminal.settings import ALLOWED_HOSTS, DEV_PORT, Settings, load_settings

READ_METHODS = frozenset({"GET", "HEAD"})


class GetOnlyError(RuntimeError):
    """Raised when the app registers a route that is not GET (P0 and P1 are read-only, DL5)."""


def _mount_problems(route: Mount, path: str, web_dist: Path | None) -> list[str]:
    """[] only for a plain StaticFiles at `/` whose one folder is `web_dist`."""
    static = route.app
    if not isinstance(static, StaticFiles):
        return [f"MOUNT {path}"]
    folders = [Path(d).resolve() for d in getattr(static, "all_directories", [static.directory]) if d is not None]
    exact = type(static) is StaticFiles and path == "" and web_dist is not None
    if exact and folders == [web_dist.resolve()]:
        return []
    return [f"STATIC {path or '/'} -> {', '.join(str(f) for f in folders) or '?'}"]


def _route_problems(route: BaseRoute, path: str, methods: set[str] | None, web_dist: Path | None) -> list[str]:
    if isinstance(route, WebSocketRoute):
        return [f"WEBSOCKET {path}"]
    if isinstance(route, Mount):
        return _mount_problems(route, path, web_dist)
    if isinstance(route, Route):
        if methods is None:
            return [f"ANY {path}"]
        return [f"{m} {path}" for m in sorted(set(methods) - READ_METHODS)]
    return [f"{type(route).__name__.upper()} {path}"]


def non_get_routes(app: FastAPI) -> list[str]:
    """Every registered route that could answer something other than GET or HEAD.

    Walks included routers the way FastAPI's own OpenAPI generator does (`iter_route_contexts`; since
    FastAPI 0.14x `include_router` registers one `_IncludedRouter` node rather than copying routes), and
    flags any low-priority (frontend) route, since the terminal registers none. Mounts are checked against
    `app.state.settings.web_dist`; without settings no static mount is allowed.
    """
    web_dist = getattr(getattr(app.state, "settings", None), "web_dist", None)
    problems = [
        problem
        for ctx in iter_route_contexts(app.routes)
        for problem in _route_problems(ctx.original_route, ctx.path if ctx.path is not None else "?", ctx.methods,
                                       web_dist)
    ]
    low_priority = getattr(app.router, "_iter_low_priority_routes", None)
    if callable(low_priority):
        problems += [f"LOW-PRIORITY {getattr(r, 'path', '?')}" for r in low_priority()]
    return problems


def assert_get_only(app: FastAPI) -> None:
    problems = non_get_routes(app)
    if problems:
        raise GetOnlyError("the terminal API is GET only; refused: " + ", ".join(problems))


def _mount_web(app: FastAPI, web_dist: Path) -> None:
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else load_settings()
    app = FastAPI(
        title="nq-lab terminal",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    # add_middleware puts each new layer outside the previous one: the last added runs first.
    app.add_middleware(SameOriginApiMiddleware, origins=terminal_origins(ALLOWED_HOSTS, (settings.port, DEV_PORT)))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(ALLOWED_HOSTS), www_redirect=False)
    app.add_middleware(LoopbackOnlyMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.include_router(system.router)
    for ops in (audit, live, commands): app.include_router(ops.router)  # 2.4: audit, live, commands
    app.include_router(research.router)  # 2.2
    app.include_router(runs.router)  # 2.1
    app.include_router(data.router)  # 2.3
    from nq_terminal.api import analytics; app.include_router(analytics.router)  # noqa: E702  3.3
    from nq_terminal.api import instruments; app.include_router(instruments.router)  # noqa: E702  8 (A1)
    from nq_terminal.api import live_stream; app.include_router(live_stream.router)  # noqa: E702  9.2 (SSE)
    _mount_web(app, settings.web_dist)
    assert_get_only(app)
    return app


app = create_app()
