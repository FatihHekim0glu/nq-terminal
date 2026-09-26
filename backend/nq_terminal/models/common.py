"""Shared response models: the response base, the error body, the Page[T] envelope and the health payload.

`ResponseModel` makes every field required in the response schema, defaults included, so the generated front-end
types have no optional fields the backend always sends (`json_schema_serialization_defaults_required`). Every
response model derives from it. `ErrorDetail` is the body of every declared error (`error_responses`): a string
from the terminal's own checks, or FastAPI's validation list on a 422.
"""
from __future__ import annotations

from typing import Any, Generic, Sequence, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator

T = TypeVar("T")
DEFAULT_LIMIT = 500
MAX_LIMIT = 5000
ERROR_TEXT = {
    403: "refused by the OOS gate (the gate's own message)",
    404: "unknown name, id or series",
    413: "the file is too large to show",
    422: "invalid parameters",
    500: "a frozen table no longer fits its file; nothing is served",
    502: "a report could not be decoded",
    503: "a source is missing, half written or not configured",
}


class ResponseModel(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class ErrorDetail(ResponseModel):
    detail: str | list[dict[str, Any]]


def error_responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """OpenAPI `responses` for the given status codes, each with the ErrorDetail body."""
    return {code: {"model": ErrorDetail, "description": ERROR_TEXT[code]} for code in codes}


class Page(ResponseModel, Generic[T]):
    """One page of a list: `items[offset : offset + limit]` out of `total`."""

    model_config = ConfigDict(frozen=True)

    items: list[T]
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=MAX_LIMIT)
    total: int = Field(ge=0)

    @model_validator(mode="after")
    def _items_fit_the_limit(self) -> "Page[T]":
        if len(self.items) > self.limit:
            raise ValueError(f"{len(self.items)} items exceed the page limit {self.limit}")
        return self


def paginate(rows: Sequence[T], offset: int = 0, limit: int = DEFAULT_LIMIT) -> Page[T]:
    """Slice `rows` into a Page; bounds are validated by the Page model."""
    return Page(items=list(rows[offset:offset + limit]), offset=offset, limit=limit, total=len(rows))


class Pins(ResponseModel):
    pandas: str
    pyarrow: str
    quantpad_data: str
    nautilus: str


class Fence(ResponseModel):
    is_start: str
    is_end: str


class SealedStatus(ResponseModel):
    """True or False from the gate's own pin checks; None when a file cannot be read or parsed.

    A missing log is not None: the gate counts it as zero sealed lines, which fails the pin (False).
    """

    openings_pin_ok: bool | None
    sealed_log_pin_ok: bool | None
    openings_closed: bool | None


class CacheStats(ResponseModel):
    series: int = Field(ge=0)
    bytes: int = Field(ge=0)


class Health(ResponseModel):
    now_utc: str
    nautilus_version: str
    pins: Pins
    fence: Fence
    sealed: SealedStatus
    kill_switch_on: bool
    gate_reads_this_process: int = Field(ge=0)
    cache: CacheStats
    fixture_mode: bool
