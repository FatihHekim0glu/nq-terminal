"""The workspace store's documents (03 sections 10.2 and 10.3, D3.1): seven fixed names, their caps and their shapes.

The page keeps its saved state (the ten `localStorage` keys of 03 section 10.2) in seven documents under
`<state_dir>/workspaces/<doc>.json`. A document is `{"schema_version", "version", "saved_at", "data"}` on disk and in
every answer; the page sends only `data` (a `saved_at` it sends is accepted and ignored: every stored time is the
backend's own, 05 T12). What `data` holds, per document:

- `workspaces`: `{"list": {name: recipe}, "last": name | null}`; at most 12 recipes of at most 20,000 characters.
  A name is 2 to 16 of A-Z, 0-9 and `_` starting with a letter (never an order-ticket word), optionally followed by
  ` (conflict)` or ` (imported)`, the copies the page's merge makes.
- `layouts`: `{screen code: layout object}`; at most 64 layouts of at most 200,000 characters.
- `linkGroups`: `{"contexts": {"A": ctx | null, "B": ..., "C": ...}}`; at most 8,192 characters.
- `watch`: one object, at most 200,000 characters.
- `history`: a list of at most 100 lines of 1 to 200 characters.
- `prefs`: an object with only the fields `tape`, `cvd`, `theme`, `orientation`, `mon`; at most 4,096 characters.
- `meta`: `{"schema": 1, "imports": [{"origin", "at"}]}`; at most 16 entries and 2,048 characters. Its write rule
  (one added entry for the caller's own session origin) lives in `services/workspaces.py`.

Sizes are the length of the compact JSON text with every non-ASCII character escaped, which is what the page's
`JSON.stringify` caps count for ASCII and a safe upper bound otherwise. `clean` checks sizes first (`TooLarge`, 413),
then shapes (`InvalidDocument`, 422), and returns a rebuilt copy. Responses derive from `ResponseModel`.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError, model_validator

from nq_terminal.models.common import ResponseModel

DOC_NAMES = ("workspaces", "layouts", "linkGroups", "watch", "history", "prefs", "meta")
SCHEMA = 1

MAX_WORKSPACES = 12
MAX_RECIPE_CHARS = 20_000
MAX_LAYOUTS = 64
MAX_LAYOUT_CHARS = 200_000
MAX_LINK_GROUPS_CHARS = 8_192
MAX_WATCH_CHARS = 200_000
MAX_HISTORY_LINES = 100
MAX_LINE = 200
MAX_PREFS_CHARS = 4_096
MAX_META_CHARS = 2_048
MAX_IMPORTS = 16
PREFS_FIELDS = ("tape", "cvd", "theme", "orientation", "mon")
BODY_MARGIN = 2_048  # the envelope around `data`, and some whitespace

WORKSPACE_NAME = re.compile(r"[A-Z][A-Z0-9_]{1,15}(?: \((?:conflict|imported)\))?")
TICKET_NAME = re.compile(r"(?:^|_)(?:ORDER|SUBMIT|CANCEL|MODIF|TRANSMIT|BUY|SELL)")
SCREEN_CODE = re.compile(r"[A-Z][A-Z0-9]{1,7}")
LINE_ALPHABET = re.compile(r"[A-Za-z0-9_. -]+")
CONTEXT_VALUE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")
CONTEXT_KINDS = ("instrument", "hypothesis", "run", "universe")
ORIGIN_LENGTH, AT_LENGTH = 200, 40


class DocumentError(ValueError):
    """Base of the refusals below; the text is safe to show (no path, no stored content)."""


class UnknownDocument(DocumentError):
    """A name outside the seven (404)."""


class TooLarge(DocumentError):
    """A document over one of its caps (413)."""


class InvalidDocument(DocumentError):
    """A document whose shape or fields are not the schema's (422)."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Context(_Strict):
    kind: Literal["instrument", "hypothesis", "run", "universe"]
    value: StrictStr = Field(pattern=f"^{CONTEXT_VALUE.pattern}$")


class Groups(_Strict):
    A: Context | None
    B: Context | None
    C: Context | None


class Panel(_Strict):
    line: StrictStr = Field(min_length=1, max_length=MAX_LINE, pattern=f"^{LINE_ALPHABET.pattern}$")
    group: Literal["-", "A", "B", "C"]
    ref: StrictInt | None = Field(ge=0)
    direction: Literal["right", "below"]


class Recipe(_Strict):
    version: Literal[1]
    panels: list[Panel] = Field(min_length=1)
    groups: Groups

    @model_validator(mode="after")
    def _parents_come_first(self) -> "Recipe":
        for index, panel in enumerate(self.panels):
            if (panel.ref is not None) if index == 0 else (panel.ref is None or panel.ref >= index):
                raise ValueError("a panel's parent must be an earlier panel; the first has none")
        return self


class WorkspacesData(_Strict):
    list: dict[str, Recipe]
    last: StrictStr | None


class LinkGroupsData(_Strict):
    contexts: Groups


class ImportEntry(_Strict):
    origin: StrictStr = Field(min_length=1, max_length=ORIGIN_LENGTH)
    at: StrictStr = Field(min_length=1, max_length=AT_LENGTH)


class MetaData(_Strict):
    schema_: StrictInt = Field(alias="schema")
    imports: list[ImportEntry]

    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=False)


def default_data(doc: str) -> Any:
    """A fresh copy of what a document that was never written holds."""
    defaults: dict[str, Any] = {
        "workspaces": {"list": {}, "last": None},
        "layouts": {},
        "linkGroups": {"contexts": {"A": None, "B": None, "C": None}},
        "watch": {},
        "history": [],
        "prefs": {},
        "meta": {"schema": SCHEMA, "imports": []},
    }
    if doc not in defaults:
        raise UnknownDocument("unknown document")
    return defaults[doc]


def compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def _size(value: Any, cap: int, what: str) -> None:
    try:
        text = compact(value)
    except (TypeError, ValueError, RecursionError) as exc:
        raise InvalidDocument("the document is not plain JSON") from exc
    if len(text) > cap:
        raise TooLarge(f"{what} is larger than {cap:,} characters")


def _validate(model: type[BaseModel], value: Any) -> dict[str, Any]:
    try:
        return model.model_validate(value).model_dump(by_alias=True)
    except ValidationError as exc:
        first = exc.errors(include_url=False, include_context=False, include_input=False)[0]
        where = ".".join(str(p) for p in first["loc"])
        raise InvalidDocument(f"the document is refused at {where or 'the top'}: {first['msg']}") from exc


def _object(value: Any, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvalidDocument(f"{what} must be an object")
    return value


def _clean_workspaces(data: Any) -> Any:
    listed = data.get("list") if isinstance(data, dict) else None
    if isinstance(listed, dict):
        if len(listed) > MAX_WORKSPACES:
            raise TooLarge(f"more than {MAX_WORKSPACES} workspaces")
        for recipe in listed.values():
            _size(recipe, MAX_RECIPE_CHARS, "a workspace recipe")
    cleaned = _validate(WorkspacesData, data)
    for name in [*cleaned["list"], *([cleaned["last"]] if cleaned["last"] is not None else [])]:
        if WORKSPACE_NAME.fullmatch(name) is None or TICKET_NAME.search(name):
            raise InvalidDocument("a workspace name is not allowed")
    return cleaned


def _clean_layouts(data: Any) -> Any:
    layouts = _object(data, "layouts")
    if len(layouts) > MAX_LAYOUTS:
        raise TooLarge(f"more than {MAX_LAYOUTS} layouts")
    for layout in layouts.values():
        _size(layout, MAX_LAYOUT_CHARS, "a layout")
    for code, layout in layouts.items():
        if SCREEN_CODE.fullmatch(code) is None or not isinstance(layout, dict):
            raise InvalidDocument("a layout is not an object under a screen code")
    return layouts


def _clean_history(data: Any) -> Any:
    if not isinstance(data, list):
        raise InvalidDocument("history must be a list of lines")
    if len(data) > MAX_HISTORY_LINES:
        raise TooLarge(f"more than {MAX_HISTORY_LINES} history lines")
    if not all(isinstance(line, str) and line.strip() and len(line) <= MAX_LINE for line in data):
        raise InvalidDocument(f"a history line must be 1 to {MAX_LINE} characters")
    return list(data)


def _clean_prefs(data: Any) -> Any:
    prefs = _object(data, "prefs")
    if set(prefs) - set(PREFS_FIELDS):
        raise InvalidDocument("prefs has a field that is not one of " + ", ".join(PREFS_FIELDS))
    return prefs


def _clean_meta(data: Any) -> Any:
    entries = data.get("imports") if isinstance(data, dict) else None
    if isinstance(entries, list) and len(entries) > MAX_IMPORTS:
        raise TooLarge(f"more than {MAX_IMPORTS} import entries")
    return _validate(MetaData, data)


def _clean_link_groups(data: Any) -> Any:
    return _validate(LinkGroupsData, data)


def _clean_watch(data: Any) -> Any:
    return _object(data, "watch")


CHECKS = {
    "workspaces": (_clean_workspaces, 0),
    "layouts": (_clean_layouts, 0),
    "linkGroups": (_clean_link_groups, MAX_LINK_GROUPS_CHARS),
    "watch": (_clean_watch, MAX_WATCH_CHARS),
    "history": (_clean_history, 0),
    "prefs": (_clean_prefs, MAX_PREFS_CHARS),
    "meta": (_clean_meta, MAX_META_CHARS),
}
# Whole-document caps for the documents whose cap is not a sum of parts (the others are counted per part above).
PART_CAPS = {"workspaces": MAX_WORKSPACES * MAX_RECIPE_CHARS + 4_096, "layouts": MAX_LAYOUTS * MAX_LAYOUT_CHARS + 4_096,
             "history": MAX_HISTORY_LINES * (MAX_LINE + 4) + 64}


def document_cap(doc: str) -> int:
    """The most characters `data` may take (a bound for the part-counted documents, the cap itself otherwise)."""
    if doc not in CHECKS:
        raise UnknownDocument("unknown document")
    return CHECKS[doc][1] or PART_CAPS[doc]


def body_limit(doc: str) -> int:
    """The most bytes a PUT body for `doc` may have: read before it is parsed."""
    return document_cap(doc) + BODY_MARGIN


def clean(doc: str, data: Any) -> Any:
    """A rebuilt copy of `data` for `doc`, or `TooLarge` or `InvalidDocument`; `UnknownDocument` for another name."""
    if doc not in CHECKS:
        raise UnknownDocument("unknown document")
    check, cap = CHECKS[doc]
    _size(data, cap or PART_CAPS[doc], "the document")
    return check(data)


class WorkspaceEntry(ResponseModel):
    """One line of the index: a document, its version (0 when never written) and its last write time."""

    doc: str
    version: int = Field(ge=0)
    saved_at: str | None


class WorkspaceIndex(ResponseModel):
    documents: list[WorkspaceEntry]


class WorkspaceDocument(ResponseModel):
    """One stored document, or the default of one never written (`version` 0, `saved_at` null)."""

    doc: str
    schema_version: int
    version: int = Field(ge=0)
    saved_at: str | None
    data: Any


class WorkspaceWrite(BaseModel):
    """The body of a PUT: the new `data`. `saved_at` is accepted and ignored (the backend stamps its own time)."""

    model_config = ConfigDict(extra="forbid")

    data: Any
    saved_at: str | None = None
