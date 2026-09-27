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
- `SecurityHeadersMiddleware`: every response gets `X-Frame-Options: DENY`, a CSP with
  `frame-ancestors 'none'` (fonts and scripts are self-hosted), `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: no-referrer`.
"""
from __future__ import annotations

import ipaddress
from typing import Iterable

from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

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
