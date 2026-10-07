"""The workspace store (03 section 10.3, D3.1): seven documents as files under `<state_dir>/workspaces/`.

This is the terminal's third write (02 section 7.2, risk G03), so it is small and confined:

- Names. Only the seven names of `models.workspaces.DOC_NAMES` exist; anything else is `UnknownDocument` (404) on
  read and write. Every path is built by `_workspace_file(name)`, which accepts nothing but `<doc>.json`,
  `<doc>.json.1` to `.5` and `<doc>.json.tmp` and checks that the file resolves inside `_workspace_folder()`, and every
  write below targets a name bound by those two (`test_safety_ast.py` enforces it for this module).
- Versions. A document never written is version 0; every write adds 1. A write names the version it was made from
  (`If-Match`); a different current version is `VersionConflict` (412) and nothing changes. One lock covers every read
  and write of the store, so two writers with the same version get one winner (and a reader never holds a file open
  while a replace needs it, which Windows refuses).
- Time. `saved_at`, and the `at` of a new import entry, come from this module's clock, never from the page (05 T12).
- Writes. The document is written to `<doc>.json.tmp`, flushed to disk and renamed over `<doc>.json`; first the
  previous file is copied to `<doc>.json.1` after the older copies moved up (`.1` to `.2` and so on, five kept), so a
  bad write can be undone by hand. A damaged current file reads as a document never written and is kept as `.1` by
  the next write. A file that cannot be read (a sharing violation, access denied) is not damaged: it is `StoreError`
  (503), so the version never goes back.
- `meta` (03 section 10.2): a write may only add one import entry whose origin is the origin the caller's session is
  bound to, and the schema is the backend's constant, never the page's.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nq_terminal.desktop import sessions
from nq_terminal.models import workspaces as models
from nq_terminal.models.workspaces import DOC_NAMES, SCHEMA, DocumentError, InvalidDocument, UnknownDocument
from nq_terminal.settings import inside_research_folder

LOG = logging.getLogger(__name__)

FOLDER = "workspaces"
KEPT_COPIES = 5
TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
FILE_NAME = re.compile(r"(?:" + "|".join(DOC_NAMES) + r")\.json(?:\.[1-5]|\.tmp)?")


class StoreError(RuntimeError):
    """The store's folder or file could not be used or written; the text carries no path."""


class VersionConflict(Exception):
    """The write was made from a version that is no longer the current one."""

    def __init__(self, current: int) -> None:
        super().__init__("the document changed since this version")
        self.current = current


@dataclass(frozen=True)
class StoredDocument:
    doc: str
    schema_version: int
    version: int
    saved_at: str | None
    data: Any


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorkspaceStore:
    def __init__(self, state_dir: Path, clock: Callable[[], datetime] = _utc_now) -> None:
        self._state_dir = Path(state_dir)
        self._clock = clock
        self._lock = threading.RLock()

    # ---- the confining calls: every write path in this module is bound by one of them (test_safety_ast.py)

    def _workspace_folder(self) -> Path:
        """<state_dir>/workspaces, resolved; refused when it resolves into a research folder or off the state folder."""
        from nq_lab.config import ROOT

        state = self._state_dir.resolve()
        folder = (state / FOLDER).resolve()
        root = ROOT.resolve()
        if folder.parent != state or inside_research_folder(folder, root):
            raise StoreError("the workspace folder may not be there")
        return folder

    def _workspace_file(self, name: str) -> Path:
        """One of the store's file names directly inside the workspace folder; anything else is refused."""
        if not isinstance(name, str) or FILE_NAME.fullmatch(name) is None:
            raise StoreError("not a workspace store file name")
        folder = self._workspace_folder()
        path = folder / name
        if path.resolve().parent != folder:
            raise StoreError("a workspace store file resolves outside its folder")
        return path

    # ---- reads

    def index(self) -> list[StoredDocument]:
        with self._lock:
            return [self.read(doc) for doc in DOC_NAMES]

    def read(self, doc: str) -> StoredDocument:
        """The stored document, or the default of one never written (version 0)."""
        if doc not in DOC_NAMES:
            raise UnknownDocument("unknown document")
        with self._lock:
            return self._load(doc) or StoredDocument(doc, SCHEMA, 0, None, models.default_data(doc))

    def _load(self, doc: str) -> StoredDocument | None:
        path = self._workspace_file(f"{doc}.json")
        try:
            raw = json.loads(path.read_bytes())
            version = raw["version"]
            if (not isinstance(raw, dict) or isinstance(version, bool) or not isinstance(version, int)
                    or version < 1 or not isinstance(raw["saved_at"], str)):
                raise ValueError("not a stored document")
            return StoredDocument(doc, SCHEMA, version, raw["saved_at"], models.clean(doc, raw["data"]))
        except FileNotFoundError:
            return None
        except (ValueError, KeyError, TypeError, RecursionError, DocumentError):
            LOG.warning("the workspace document %s is damaged and is read as empty", doc)
            return None
        except OSError as exc:  # a sharing violation or access denied is not a damaged file: the version must not reset
            LOG.warning("the workspace store could not read %s: %s", doc, type(exc).__name__)
            raise StoreError("the workspace store could not be read") from exc

    # ---- writes

    def write(self, doc: str, data: Any, expected_version: int, *, session_origin: str | None = None
              ) -> StoredDocument:
        """Store `data` as the next version of `doc`, made from `expected_version`.

        Raises `UnknownDocument`, `TooLarge`, `InvalidDocument` (the document is refused whatever the version),
        `VersionConflict`, or `StoreError` when the files could not be read or written."""
        cleaned = models.clean(doc, data)
        with self._lock:
            current = self._load(doc)
            version = current.version if current else 0
            if expected_version != version:
                raise VersionConflict(version)
            stamp = self._clock().strftime(TIME_FORMAT)
            if doc == "meta":
                before = current.data if current else models.default_data("meta")
                cleaned = self._meta_next(before, cleaned, session_origin, stamp)
            stored = StoredDocument(doc, SCHEMA, version + 1, stamp, cleaned)
            self._persist(stored)
            return stored

    def _meta_next(self, before: dict[str, Any], proposed: dict[str, Any], origin: str | None, stamp: str
                   ) -> dict[str, Any]:
        """`before` plus the one import entry for `origin`; every other change is `InvalidDocument` (422)."""
        if origin is None:
            raise InvalidDocument("meta may be written only by a page with a session")
        if proposed["schema"] != SCHEMA:
            raise InvalidDocument("the schema is written by the backend alone")
        kept, sent = before["imports"], proposed["imports"]
        added = [entry for entry in sent if entry not in kept]
        known = {entry["origin"] for entry in kept}
        untouched = all(entry in sent for entry in kept)
        if not (untouched and len(added) == 1 and len(sent) == len(kept) + 1):
            raise InvalidDocument("meta may only gain one import entry; none may be removed or edited")
        if not sessions.same(added[0]["origin"], origin) or origin in known:
            raise InvalidDocument("the import entry must be for this session's own origin, once")
        return {"schema": SCHEMA, "imports": [*kept, {"origin": origin, "at": stamp}]}

    def _persist(self, stored: StoredDocument) -> None:
        envelope = {"schema_version": stored.schema_version, "version": stored.version, "saved_at": stored.saved_at,
                    "data": stored.data}
        payload = models.compact(envelope).encode("ascii")
        try:
            self._prepare_folder()
            self._rotate(stored.doc)
            self._write_atomic(stored.doc, f"{stored.doc}.json", payload)
        except OSError as exc:
            LOG.warning("the workspace store could not write %s: %s", stored.doc, type(exc).__name__)
            raise StoreError("the workspace store could not be written") from exc

    def _prepare_folder(self) -> None:
        folder = self._workspace_folder()
        folder.mkdir(parents=True, exist_ok=True)

    def _rotate(self, doc: str) -> None:
        """Move the kept copies up one place and copy the current file to `.1` (the oldest falls off)."""
        for index in range(KEPT_COPIES - 1, 0, -1):
            older = self._workspace_file(f"{doc}.json.{index}")
            newer = self._workspace_file(f"{doc}.json.{index + 1}")
            if older.exists():
                os.replace(older, newer)
        current = self._workspace_file(f"{doc}.json")
        if current.exists():
            self._write_atomic(doc, f"{doc}.json.1", current.read_bytes())

    def _write_atomic(self, doc: str, name: str, payload: bytes) -> None:
        """Write `payload` to the document's temporary file, flush it to disk and rename it over `name`."""
        tmp = self._workspace_file(f"{doc}.json.tmp")
        final = self._workspace_file(name)
        try:
            with open(tmp, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, final)
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
