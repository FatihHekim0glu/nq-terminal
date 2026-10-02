"""Shell-facing routes (03 sections 2.2, 4.2 and 4.4): the identity proof and the three session routes.

- `GET /api/desktop/proof?nonce=<64 hex>`: the challenge-response proof. It takes no Authorization header and no
  secret; the answer is useful only to a caller that knows the token (`desktop/proof.py`).
- `GET /api/session`: `Authorization: NQT <token>` and `X-NQT-Origin: http://127.0.0.1:<port>` (or localhost) buy a
  session cookie bound to that origin. The shells call it and set the cookie in their webview.
- `GET /api/session/code`: `Authorization: NQT <token>` mints a single-use launch code for the browser door.
- `GET /api/session/redeem`: `X-NQT-Code: <code>` swaps a code for a session bound to the page's origin: the Origin
  header when the browser sends one, else the Host the page was loaded from (a same-origin GET carries no Origin).
  A fetch the browser marks as anything but same-origin is refused, so only the session page itself can redeem.

Only `/api/session` and `/api/session/code` read the token header. All four are GETs that change in-memory state
only; every answer is `Cache-Control: no-store`. The cookie is `nqt_s_<port>` with exactly HttpOnly, SameSite=Strict
and Path=/api; `security.SessionMiddleware` requires it on every other /api path.

`shell_schema(openapi)` is the part of the contract the shell itself calls (these four routes and `/api/health`), in
canonical form; `contract/desktop_version.json` pins its sha256 beside the desktop contract number (03 section 4.4,
tests/test_desktop_contract_version.py).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel

from nq_terminal.desktop import lifecycle, sessions
from nq_terminal.desktop.proof import NONCE_PATTERN, proof_body

router = APIRouter(prefix="/api", tags=["desktop"])

NO_STORE = {"Cache-Control": "no-store"}
TOKEN_HEADER = re.compile(r"^NQT ([0-9a-f]{64})$")
LOOPBACK_ORIGIN = re.compile(r"^http://(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$")
MAX_PORT = 65535
SAME_ORIGIN_FETCH = "same-origin"
SHELL_ROUTES = ("/api/desktop/proof", "/api/session", "/api/session/code", "/api/session/redeem", "/api/health")
PROSE_KEYS = frozenset({"description", "summary"})
REF_PREFIX = "#/components/schemas/"


class DesktopProof(BaseModel):
    proof: str
    root: str
    prefix: str
    contract: int
    pid: int


class SessionIssued(BaseModel):
    ok: bool
    cookie: str


class LaunchCode(BaseModel):
    code: str
    expires_in_s: int


def _refuse(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=NO_STORE)


def _require_token(request: Request, authorization: str | None) -> None:
    match = TOKEN_HEADER.match(authorization or "")
    token = lifecycle.runtime(request.app).token
    if match is None or not hmac.compare_digest(match.group(1).encode("ascii"), token.encode("ascii")):
        raise _refuse(401, "not authorised")


def _loopback_origin(text: str | None) -> str | None:
    match = LOOPBACK_ORIGIN.match((text or "").strip())
    return match.group(0) if match and int(match.group(2)) <= MAX_PORT else None


def _with_cookie(request: Request, response: Response, value: str) -> SessionIssued:
    name = sessions.cookie_name(lifecycle.runtime(request.app).port)
    response.set_cookie(name, value, **sessions.COOKIE_FLAGS)
    response.headers.update(NO_STORE)
    return SessionIssued(ok=True, cookie=name)


@router.get("/desktop/proof", response_model=DesktopProof)
def desktop_proof(request: Request, nonce: Annotated[str, Query(pattern=NONCE_PATTERN)]) -> Response:
    """The challenge-response proof: no Authorization header, no secret in or out."""
    body = proof_body(request.app.state.settings, lifecycle.runtime(request.app), nonce)
    return Response(content=DesktopProof(**body).model_dump_json(), media_type="application/json", headers=NO_STORE)


@router.get("/session", response_model=SessionIssued)
def open_session(request: Request, response: Response,
                 authorization: Annotated[str | None, Header()] = None,
                 x_nqt_origin: Annotated[str | None, Header()] = None) -> SessionIssued:
    """The token and one loopback origin buy a session cookie bound to that origin (the shells)."""
    _require_token(request, authorization)
    origin = _loopback_origin(x_nqt_origin)
    if origin is None:
        raise _refuse(400, "X-NQT-Origin must be http://127.0.0.1:<port> or http://localhost:<port>")
    return _with_cookie(request, response, sessions.store(request.app).create(origin))


@router.get("/session/code", response_model=LaunchCode)
def launch_code(request: Request, response: Response,
                authorization: Annotated[str | None, Header()] = None) -> LaunchCode:
    """The token mints a single-use launch code that lives 60 s (the browser launchers)."""
    _require_token(request, authorization)
    response.headers.update(NO_STORE)
    return LaunchCode(code=sessions.store(request.app).mint_code(), expires_in_s=sessions.CODE_TTL_S)


@router.get("/session/redeem", response_model=SessionIssued)
def redeem_code(request: Request, response: Response,
                x_nqt_code: Annotated[str | None, Header()] = None,
                origin: Annotated[str | None, Header()] = None,
                sec_fetch_site: Annotated[str | None, Header()] = None) -> SessionIssued:
    """A launch code, sent by the session page, buys a session bound to that page's origin; the code dies."""
    if not sessions.well_formed(x_nqt_code):
        raise _refuse(401, "a launch code is required")
    if sec_fetch_site is not None and sec_fetch_site != SAME_ORIGIN_FETCH:
        raise _refuse(403, "only the session page itself may redeem a code")
    page_origin = _loopback_origin(origin) if origin is not None else _loopback_origin(
        f"http://{request.headers.get('host', '')}")
    if page_origin is None:
        raise _refuse(400, "the page origin is not a loopback origin")
    value = sessions.store(request.app).redeem(x_nqt_code, page_origin)
    if value is None:
        raise _refuse(401, "the code is unknown, used or expired")
    return _with_cookie(request, response, value)


# ---------------------------------------------------------------- the shell-facing part of the contract (03 4.4)

def _without_prose(node: Any) -> Any:
    if isinstance(node, dict):
        return {k: _without_prose(v) for k, v in node.items() if k not in PROSE_KEYS}
    if isinstance(node, list):
        return [_without_prose(v) for v in node]
    return node


def _refs(node: Any) -> set[str]:
    if isinstance(node, dict):
        found = {node["$ref"][len(REF_PREFIX):]} if isinstance(node.get("$ref"), str) else set()
        return found.union(*(_refs(v) for v in node.values())) if node else found
    if isinstance(node, list):
        return set().union(*(_refs(v) for v in node)) if node else set()
    return set()


def shell_schema(openapi: dict[str, Any]) -> dict[str, Any]:
    """The GET operations of SHELL_ROUTES and every component schema they reach, without prose (descriptions and
    summaries), so a reworded docstring does not move the contract but any change of shape does."""
    paths = {path: {"get": openapi["paths"][path]["get"]} for path in SHELL_ROUTES}
    components = openapi.get("components", {}).get("schemas", {})
    reached: set[str] = set()
    todo = _refs(paths)
    while todo:
        name = todo.pop()
        if name not in reached:
            reached.add(name)
            todo |= _refs(components[name])
    return _without_prose({"paths": paths, "schemas": {name: components[name] for name in sorted(reached)}})


def shell_schema_sha256(openapi: dict[str, Any]) -> str:
    """The full sha256 of `shell_schema(openapi)` serialised canonically (sorted keys, no spaces, UTF-8)."""
    text = json.dumps(shell_schema(openapi), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
