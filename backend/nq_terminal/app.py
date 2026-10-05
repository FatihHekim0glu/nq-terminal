"""FastAPI app for the nq-lab terminal: read-only, GET only (bar three writes), loopback only, one origin.

Run: `python -m nq_terminal` from terminal/backend (binds 127.0.0.1 in code; see `__main__.py`).

- Middleware, outermost first: security headers; loopback peers only (`LoopbackOnlyMiddleware`, 403 for a
  client or local address that is not loopback); `TrustedHostMiddleware` for 127.0.0.1 and localhost (DNS
  rebinding control); `SessionMiddleware` (401 without a live session cookie, 403 for a foreign origin or a write
  without a same-origin Origin, under every /api path, the stream included); `SameOriginApiMiddleware` (403 for a
  cross-site GET under /api). There is no CORS
  middleware, because the built SPA is served from the same origin (PRD DL13). See `security.py`.
- Every registered route must be GET; `create_app` refuses to build an app that registers anything else, except
  exactly three writes (`jobs.ALLOWED_WRITE_ROUTES`: POST /api/jobs and DELETE /api/jobs/{job_id}, PRD U3, and
  PUT /api/workspaces/{doc}, the workspace store, 03 10.3), which carry their own header, origin and content-type
  checks (`api/jobs.py`, `api/workspaces.py`). Any other non-GET route is refused.
  The one mount allowed is a plain `StaticFiles` at `/` serving exactly `settings.web_dist`; any other
  mount (a sub-app, a StaticFiles subclass, another path or folder) is refused, so data/ or results/ can
  never be served around the gate and FileCache.
- `web/dist` is mounted at `/` only when it exists (after the API routes, so `/api` always wins).
- Interactive docs are off (they load scripts from a CDN); the schema is at /api/openapi.json.
- `create_app` first makes the system allocator Arrow's memory pool (`services/allocator.py`, W5C D2), so every form
  returns freed memory to the operating system.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.routing import BaseRoute, Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from nq_terminal import __version__, memtrim
from nq_terminal.api import desktop as desktop_api  # 03 2.2, 4.2 (the proof and the session routes)
from nq_terminal.api import system
from nq_terminal.api.home_prewarm import start_home_prewarm
from nq_terminal.desktop import lifecycle, watchdog
from nq_terminal.api import audit, commands, live  # 2.4
from nq_terminal.api import research  # 2.2
from nq_terminal.services import allocator  # W5C D2: the system memory pool
from nq_terminal.services import research as research_service
from nq_terminal.api import runs  # 2.1
from nq_terminal.api import data  # 2.3
from nq_terminal.api import ib as ib_api  # 12 (U3: read-only IB snapshot)
from nq_terminal.api import jobs as jobs_api  # 12 (U3: the backtest queue, two of the three writes)
from nq_terminal.api import workspaces as workspaces_api  # 03 10.3 (D3.1: the workspace store, the third write)
from nq_terminal.api import regimes_capacity_term, risk_extras  # 12 (RK4, PF11, BR5, RG2, EX5, MV6)
from nq_terminal.api import spa as spa_api  # 12 (SV8)
from nq_terminal.api import paper_expectation as expectation_api  # 12 (LV6, LV6b)
from nq_terminal.security import (
    LoopbackOnlyMiddleware,
    SameOriginApiMiddleware,
    SecurityHeadersMiddleware,
    SessionMiddleware,
)
from nq_terminal.settings import ALLOWED_HOSTS, Settings, load_settings

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


def assert_get_only(app: FastAPI, allowed: Sequence[str] = ()) -> None:
    """Refuse every non-GET route except the exact `METHOD /path` strings in `allowed` (the three writes)."""
    problems = [problem for problem in non_get_routes(app) if problem not in allowed]
    if problems:
        raise GetOnlyError("the terminal API is GET only; refused: " + ", ".join(problems))


def _mount_web(app: FastAPI, web_dist: Path) -> None:
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=web_dist, html=True), name="web")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """On startup, begin the HOME prewarm in a desktop or launcher process (a daemon thread that waits for the bound
    port; off in tests, fixture mode and the smoke). On shutdown, stop a running backtest child (on Windows it would
    otherwise outlive the terminal)."""
    start_home_prewarm(app)
    yield
    jobs = getattr(app.state, jobs_api.STATE_KEY, None)
    if jobs is not None:
        jobs.close(kill_after_s=watchdog.JOB_KILL_AFTER_S, join_s=watchdog.JOB_JOIN_S)


def create_app(settings: Settings | None = None) -> FastAPI:
    allocator.use_system_pool()  # W5C D2: Arrow hands freed memory back to the OS, in every form
    settings = settings if settings is not None else load_settings()
    app = FastAPI(
        lifespan=_lifespan,
        title="nq-lab terminal",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    research_service.set_file_cache_cap(settings.file_cache_bytes)  # 03 2.6: the research reads share the cap
    # add_middleware puts each new layer outside the previous one: the last added runs first.
    app.add_middleware(SameOriginApiMiddleware, origins=lifecycle.origins(settings, settings.port))
    app.add_middleware(SessionMiddleware)  # 03 4.2: a live session cookie (and a same-origin write) on every /api path
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(ALLOWED_HOSTS), www_redirect=False)
    app.add_middleware(LoopbackOnlyMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    memtrim.install(app)  # vnext perf-1: outermost, so every request counts; the working-set trim after the prewarm and in quiet periods
    lifecycle.install(app, settings)  # the lock, taken in the start-up (03 2.1)
    app.include_router(system.router)
    app.include_router(desktop_api.router)
    app.include_router(workspaces_api.router)  # 03 10.3: the third write (PUT /api/workspaces/{doc})
    for ops in (audit, live, commands): app.include_router(ops.router)  # 2.4: audit, live, commands
    app.include_router(research.router)  # 2.2
    app.include_router(runs.router)  # 2.1
    app.include_router(data.router)  # 2.3
    from nq_terminal.api import analytics; app.include_router(analytics.router)  # noqa: E702  3.3
    from nq_terminal.api import instruments; app.include_router(instruments.router)  # noqa: E702  8 (A1)
    from nq_terminal.api import live_stream; app.include_router(live_stream.router)  # noqa: E702  9.2 (SSE)
    from nq_terminal.api import dq, events, roll, seasonality, vcone  # 11: DQ, EVT, ROLL, SEAS, VCONE
    for p11 in (vcone, seasonality, events, roll, dq): app.include_router(p11.router)  # noqa: E701  before the mount
    for p12 in (spa_api, risk_extras, regimes_capacity_term, ib_api, jobs_api, expectation_api):  # 12: P2, before the mount
        app.include_router(p12.router)
    _mount_web(app, settings.web_dist)
    assert_get_only(app, jobs_api.ALLOWED_WRITE_ROUTES)
    return app


app = create_app()
