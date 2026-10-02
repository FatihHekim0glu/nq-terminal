"""ASGI middlewares that keep the terminal loopback-only and same-origin (ARCHITECTURE section 9).

- `LoopbackOnlyMiddleware`: 403 unless both the peer (`scope["client"]`) and the local address the
  request arrived on (`scope["server"]`) are loopback IP addresses. The launcher binds 127.0.0.1; this is
  the check in code for a server started with another `--host`. TrustedHost is a DNS-rebinding control,
  not a network control: a LAN host can send `Host: localhost`.
- `SameOriginApiMiddleware`: a GET or HEAD under `/api` is refused (403) when the browser marks it as not
  same-origin (`Sec-Fetch-Site` other than `same-origin` or `none`) or sends an `Origin` that is not the
  terminal (a loopback host on the terminal port, or on the Vite dev port that proxies `/api`). Another
  page's `<img src="http://127.0.0.1:8765/api/...">` would otherwise run the handler and, once bars are
  served, forge terminal lines in `results/oos_access_log.jsonl`. Other methods are left to the router,
  which answers 405. The SPA itself (outside `/api`) may still be opened from a link.
- `SessionMiddleware` (D2, 03 section 4.2): every /api request, the live stream included, needs the cookie
  `nqt_s_<port>` naming a live session, and an Origin, when sent, equal to that session's origin; a request that is
  not GET or HEAD also needs that Origin and no Sec-Fetch-Site other than same-origin, because cookies do not separate
  by port on 127.0.0.1 and SameSite counts every loopback port as the same site. The proof and the three session
  routes (`SESSION_EXEMPT`) take their own credentials. create_app adds it just outside `SameOriginApiMiddleware`,
  inside the loopback and host checks, so those refusals keep their 403 and 400.
- `SecurityHeadersMiddleware`: every response gets `X-Frame-Options: DENY`, a CSP with
  `frame-ancestors 'none'` (fonts and scripts are self-hosted), `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`.
"""
from __future__ import annotations

import ipaddress
from typing import Iterable

from starlette.datastructures import Headers
from starlette.requests import cookie_parser
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from nq_terminal.desktop import lifecycle, sessions

READ_METHODS = frozenset({"GET", "HEAD"})
SAME_ORIGIN_FETCH_SITES = frozenset({"same-origin", "none"})
API_PREFIX = "/api"
WEBSOCKET_POLICY_VIOLATION = 1008
# script-src adds 'wasm-unsafe-eval' to 'self' so the Perspective pivot engine (WebAssembly) can compile;
# it allows no JavaScript eval, and workers fall back to it (same-origin files only). tests/test_csp_wasm.py
CONTENT_SECURITY_POLICY = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                           "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                           "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", CONTENT_SECURITY_POLICY.encode("latin-1")),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
)


def is_loopback(address: tuple[str, int] | list | None) -> bool:
    """True when an ASGI (host, port) pair names a loopback IP address; names such as 'testclient' are not."""
    if not address:
        return False
    try:
        ip = ipaddress.ip_address(str(address[0]).split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_loopback


def terminal_origins(hosts: Iterable[str], ports: Iterable[int]) -> frozenset[str]:
    return frozenset(f"http://{host}:{port}" for host in hosts for port in ports)


async def _refuse(scope: Scope, receive: Receive, send: Send, text: str) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": WEBSOCKET_POLICY_VIOLATION})
        return
    await PlainTextResponse(text, status_code=403)(scope, receive, send)


class LoopbackOnlyMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        network = scope["type"] in ("http", "websocket")
        if network and not (is_loopback(scope.get("client")) and is_loopback(scope.get("server"))):
            await _refuse(scope, receive, send, "the terminal serves loopback clients only")
            return
        await self.app(scope, receive, send)


class SameOriginApiMiddleware:
    def __init__(self, app: ASGIApp, *, origins: Iterable[str]) -> None:
        self.app = app
        self.origins = frozenset(origin.lower() for origin in origins)

    def _cross_site(self, scope: Scope) -> bool:
        path = scope.get("path", "")
        if scope.get("method") not in READ_METHODS or not (path == API_PREFIX or path.startswith(API_PREFIX + "/")):
            return False
        headers = Headers(scope=scope)
        site, origin = headers.get("sec-fetch-site"), headers.get("origin")
        return (site is not None and site.strip().lower() not in SAME_ORIGIN_FETCH_SITES) or (
            origin is not None and origin.strip().lower() not in self.origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self._cross_site(scope):
            await _refuse(scope, receive, send, "cross-site requests to the terminal API are refused")
            return
        await self.app(scope, receive, send)


SESSION_EXEMPT = frozenset({"/api/desktop/proof", "/api/session", "/api/session/code", "/api/session/redeem"})
WRITE_FETCH_SITE = "same-origin"
NO_STORE = (b"cache-control", b"no-store")
NO_SESSION, WRONG_ORIGIN, WRITE_ORIGIN = ("a session is required", "the origin does not match the session",
                                          "a write needs a same-origin Origin header")


def _is_api(path: str) -> bool:
    return path == API_PREFIX or path.startswith(API_PREFIX + "/")


def write_refused(method: str, headers: Headers) -> bool:
    """True for a request that is not GET or HEAD and has no Origin, or a Sec-Fetch-Site other than same-origin.
    (The Origin it has must then equal the session's origin, checked with every other request: a cookie for
    127.0.0.1 rides along from every loopback port, which SameSite counts as the same site.)"""
    if method in READ_METHODS:
        return False
    site = headers.get("sec-fetch-site")
    return headers.get("origin") is None or (site is not None and site != WRITE_FETCH_SITE)


def _session_origin(app: object, headers: Headers) -> str | None:
    """The origin of the live session the request's `nqt_s_<port>` cookie names, else None (fails closed)."""
    try:
        port = lifecycle.runtime(app).port
        store = sessions.store(app)
    except AttributeError:  # not a terminal app: no settings, no runtime, no store
        return None
    cookies = cookie_parser(headers.get("cookie", ""))
    return store.origin_of(cookies.get(sessions.cookie_name(port)))


def session_refusal(app: object, method: str, headers: Headers) -> tuple[int, str] | None:
    """(status, reason) when an /api request outside SESSION_EXEMPT is a write without a same-origin Origin, lacks a
    live session of this app, or sends an Origin that is not the session's origin; None when it may pass."""
    if write_refused(method, headers):
        return 403, WRITE_ORIGIN
    bound = _session_origin(app, headers) if app is not None else None
    if bound is None:
        return 401, NO_SESSION
    origin = headers.get("origin")
    if origin is not None and not sessions.same(origin, bound):
        return 403, WRONG_ORIGIN
    return None


async def _refuse_json(scope: Scope, receive: Receive, send: Send, status: int, reason: str) -> None:
    if scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": WEBSOCKET_POLICY_VIOLATION})
        return
    response = JSONResponse({"detail": reason}, status_code=status)
    response.raw_headers.append(NO_STORE)
    await response(scope, receive, send)


class SessionMiddleware:
    """Every /api request, the live stream included, needs the cookie `nqt_s_<port>` naming a live session of this
    app, and, when an Origin header is present, that it equals the session's origin (03 section 4.2). A request that
    is not GET or HEAD also needs an Origin equal to the session's origin and no Sec-Fetch-Site other than
    same-origin. `SESSION_EXEMPT` (the proof, which takes no secret, and the three session routes, which check the
    token or the code themselves) needs no cookie for GET and HEAD; a write to them is refused like any other.
    Static files outside /api need nothing. A websocket under /api is closed. Nothing here logs a header value."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] not in ("http", "websocket") or not _is_api(path):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await _refuse_json(scope, receive, send, 403, NO_SESSION)
            return
        method, headers = scope.get("method", ""), Headers(scope=scope)
        if path in SESSION_EXEMPT:
            refused = (403, WRITE_ORIGIN) if method not in READ_METHODS else None
        else:
            refused = session_refusal(scope.get("app"), method, headers)
        if refused is not None:
            await _refuse_json(scope, receive, send, *refused)
            return
        await self.app(scope, receive, send)


# A live stream (text/event-stream) is never stored: the framework sends no-cache, which still lets a disk cache or a
# proxy keep journal rows; no-store replaces it.
STREAM_CACHE_HEADER = (b"cache-control", b"no-store")


def _is_event_stream(headers: list[tuple[bytes, bytes]]) -> bool:
    return any(k.lower() == b"content-type" and v.lower().startswith(b"text/event-stream") for k, v in headers)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        names = {name for name, _ in SECURITY_HEADERS}

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", ()))
                drop = names | ({b"cache-control"} if _is_event_stream(headers) else set())
                kept = [(k, v) for k, v in headers if k.lower() not in drop]
                extra = [STREAM_CACHE_HEADER] if len(drop) > len(names) else []
                message = {**message, "headers": [*kept, *SECURITY_HEADERS, *extra]}
            await send(message)

        await self.app(scope, receive, send_with_headers)
