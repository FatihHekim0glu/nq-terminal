"""The workspace store's routes (03 section 10.3, D3.1): the page's saved state as seven documents.

- `GET /api/workspaces`: the seven documents with their versions.
- `GET /api/workspaces/{doc}`: one document (`doc` is one of the seven names; any other name is 404). A document never
  written answers its default at version 0. The `ETag` header repeats the version.
- `PUT /api/workspaces/{doc}`: the third write route of the terminal (`jobs.ALLOWED_WRITE_ROUTES`). Body
  `{"data": ...}`, header `If-Match: <version>` (the version the page's copy was made from, 0 for a document never
  written). 200 with the stored document and the new version; 404 for a name outside the seven; 412 when the version is
  stale or not a whole number (the `ETag` header carries the current one); 413 over a cap (the body is capped before it
  is parsed); 415 for a content type that is not `application/json`; 422 for a body or document that is not the schema's
  (for `meta`: anything but one added import entry for the caller's own session origin); 428 without `If-Match`; 503
  when the files could not be written (or, on a GET, read: the same 503, never an empty document). It writes only `<state_dir>/workspaces/` (`services/workspaces.py`).

A write refuses (403) a request that is not from a loopback peer or lacks `X-NQT: 1`. Its Origin and cookie are checked
by the session middleware before the route runs (`security.py`, 03 section 4.2). No answer or log line carries a path.
"""
from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError

from nq_terminal.desktop import lifecycle, sessions
from nq_terminal.models.common import ErrorDetail
from nq_terminal.models.workspaces import (
    DOC_NAMES,
    DocumentError,
    InvalidDocument,
    TooLarge,
    UnknownDocument,
    WorkspaceDocument,
    WorkspaceEntry,
    WorkspaceIndex,
    WorkspaceWrite,
    body_limit,
)
from nq_terminal.security import is_loopback
from nq_terminal.services.workspaces import StoredDocument, StoreError, VersionConflict, WorkspaceStore

STATE_KEY = "workspaces"
NQT_HEADER = "x-nqt"
JSON_MEDIA_TYPE = "application/json"
NO_STORE = "no-store"
VERSION_TEXT = re.compile(r"\d{1,12}")
_LOCK = threading.Lock()

ERROR_TEXT = {
    403: "not a loopback peer, the X-NQT: 1 header is missing, or the origin is not the session's",
    404: "a name outside the seven documents",
    412: "the version is stale or not a whole number; the ETag header is the current version",
    413: "the document or the body is over its cap",
    415: "the content type is not application/json",
    422: "the body or document is not the schema's (meta: not one added import for the caller's own origin)",
    428: "the If-Match header is missing",
    503: "the workspace files could not be written",
}
router = APIRouter(prefix="/api/workspaces", tags=["workspaces"],
                   responses={code: {"model": ErrorDetail, "description": text} for code, text in ERROR_TEXT.items()
                              if code in (403, 404)})
# The body is read by hand (it is capped before it is parsed), so its schema is written out rather than referenced.
_PUT_BODY = {"requestBody": {"required": True, "content": {JSON_MEDIA_TYPE: {"schema": {
    "type": "object", "title": "WorkspaceWrite", "required": ["data"], "additionalProperties": False,
    "properties": {"data": {"title": "Data", "description": "The document's new content (shape per document)"},
                   "saved_at": {"anyOf": [{"type": "string"}, {"type": "null"}], "title": "Saved At",
                                "description": "Accepted and ignored: the backend stamps its own time"}}}}}}}


def get_store(request: Request) -> WorkspaceStore:
    """One store per app, on the settings' state folder, made on first use (a test may set `app.state.workspaces`)."""
    state = request.app.state
    with _LOCK:
        store = getattr(state, STATE_KEY, None)
        if store is None:
            store = WorkspaceStore(state.settings.state_dir)
            setattr(state, STATE_KEY, store)
    return store


def _refuse(status: int, detail: str | list[dict[str, Any]], headers: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=headers)


def _etag(version: int) -> str:
    return f'"{version}"'


def _known(doc: str) -> str:
    if doc not in DOC_NAMES:
        raise _refuse(404, "unknown document")
    return doc


def _answer(stored: StoredDocument, response: Response) -> WorkspaceDocument:
    response.headers["ETag"] = _etag(stored.version)
    response.headers["Cache-Control"] = NO_STORE
    return WorkspaceDocument(doc=stored.doc, schema_version=stored.schema_version, version=stored.version,
                             saved_at=stored.saved_at, data=stored.data)


def _write_guard(request: Request) -> None:
    if not (is_loopback(request.client) and is_loopback(request.scope.get("server"))):
        raise _refuse(403, "the terminal serves loopback clients only")
    if request.headers.get(NQT_HEADER) != "1":
        raise _refuse(403, "the X-NQT: 1 header is required")
    media = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if media != JSON_MEDIA_TYPE:
        raise _refuse(415, "the content type must be application/json")


def _session_origin(request: Request) -> str | None:
    """The origin of the live session the request's cookie names (the session middleware has already required one)."""
    try:
        port = lifecycle.runtime(request.app).port
        return sessions.store(request.app).origin_of(request.cookies.get(sessions.cookie_name(port)))
    except AttributeError:
        return None


def _version_from(header: str | None, current: Callable[[], int]) -> int:
    if header is None:
        raise _refuse(428, "the If-Match header is required")
    text = header.strip()
    text = text[1:-1] if len(text) >= 2 and text[0] == text[-1] == '"' else text
    if VERSION_TEXT.fullmatch(text) is None:
        raise _refuse(412, "the If-Match version is not a whole number", {"ETag": _etag(current())})
    return int(text)


async def _body(request: Request, limit: int) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise _refuse(413, "the body is larger than this document's cap")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise _refuse(413, "the body is larger than this document's cap")
        chunks.append(chunk)
    return b"".join(chunks)


def _envelope(body: bytes) -> WorkspaceWrite:
    try:
        return WorkspaceWrite.model_validate(json.loads(body))
    except (ValueError, RecursionError, ValidationError):
        raise _refuse(422, "the body must be a JSON object with a data field") from None


def _readable(read: Callable[[], Any]) -> Any:
    """`read()`, with a file that could not be read answered as 503 (never as an empty document or a 500)."""
    try:
        return read()
    except StoreError as exc:
        raise _refuse(503, "the workspace files could not be read") from exc


_READ_503 = {503: {"model": ErrorDetail, "description": "the workspace files could not be read"}}


@router.get("", response_model=WorkspaceIndex, responses=_READ_503)
def list_documents(request: Request, response: Response) -> WorkspaceIndex:
    """The seven documents with their versions and last write times (a never-written one is version 0)."""
    response.headers["Cache-Control"] = NO_STORE
    documents = _readable(get_store(request).index)
    return WorkspaceIndex(documents=[WorkspaceEntry(doc=s.doc, version=s.version, saved_at=s.saved_at)
                                     for s in documents])


@router.get("/{doc}", response_model=WorkspaceDocument, responses=_READ_503)
def read_document(request: Request, response: Response, doc: str) -> WorkspaceDocument:
    """One document, or its default at version 0 when it was never written."""
    known = _known(doc)
    return _answer(_readable(lambda: get_store(request).read(known)), response)


@router.put("/{doc}", response_model=WorkspaceDocument, openapi_extra=_PUT_BODY,
            responses={code: {"model": ErrorDetail, "description": text} for code, text in ERROR_TEXT.items()
                       if code not in (403, 404)})
async def write_document(request: Request, response: Response, doc: str,
                         if_match: str | None = Header(default=None, alias="If-Match",
                                                       description="The version the page's copy was made from")
                         ) -> WorkspaceDocument:
    """Store `data` as the next version of the document, made from the `If-Match` version."""
    _write_guard(request)
    _known(doc)
    store = get_store(request)
    version = _version_from(if_match, lambda: _readable(lambda: store.read(doc)).version)
    envelope = _envelope(await _body(request, body_limit(doc)))
    try:
        stored = await run_in_threadpool(store.write, doc, envelope.data, version, session_origin=_session_origin(request))
    except UnknownDocument as exc:
        raise _refuse(404, str(exc)) from exc
    except TooLarge as exc:
        raise _refuse(413, str(exc)) from exc
    except InvalidDocument as exc:
        raise _refuse(422, str(exc)) from exc
    except VersionConflict as exc:
        raise _refuse(412, str(exc), {"ETag": _etag(exc.current)}) from exc
    except (StoreError, DocumentError) as exc:
        raise _refuse(503, "the workspace files could not be written") from exc
    return _answer(stored, response)
