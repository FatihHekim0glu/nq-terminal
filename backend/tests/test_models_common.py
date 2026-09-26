"""Page[T]: the one pagination envelope every list endpoint uses (offset, limit default 500, max 5,000)."""
from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from nq_terminal.models.common import DEFAULT_LIMIT, MAX_LIMIT, Page, paginate


class Row(BaseModel):
    n: int


def test_limits_match_the_contract():
    assert (DEFAULT_LIMIT, MAX_LIMIT) == (500, 5000)


def test_page_holds_typed_items():
    page = Page[Row](items=[Row(n=1), Row(n=2)], offset=0, limit=2, total=10)
    assert [r.n for r in page.items] == [1, 2]
    assert page.model_dump() == {"items": [{"n": 1}, {"n": 2}], "offset": 0, "limit": 2, "total": 10}


def test_page_validates_item_type():
    with pytest.raises(ValidationError):
        Page[Row](items=[{"n": "not a number"}], offset=0, limit=1, total=1)


@pytest.mark.parametrize("kwargs", [
    {"offset": -1, "limit": 10, "total": 0},
    {"offset": 0, "limit": 0, "total": 0},
    {"offset": 0, "limit": MAX_LIMIT + 1, "total": 0},
    {"offset": 0, "limit": 10, "total": -1},
])
def test_page_rejects_bad_bounds(kwargs):
    with pytest.raises(ValidationError):
        Page[Row](items=[], **kwargs)


def test_page_rejects_more_items_than_limit():
    with pytest.raises(ValidationError):
        Page[Row](items=[Row(n=1), Row(n=2)], offset=0, limit=1, total=2)


def test_page_is_immutable():
    page = Page[Row](items=[], offset=0, limit=1, total=0)
    with pytest.raises(ValidationError):
        page.total = 5


def test_paginate_slices_and_counts():
    rows = [Row(n=i) for i in range(12)]
    page = paginate(rows, offset=5, limit=4)
    assert [r.n for r in page.items] == [5, 6, 7, 8]
    assert (page.offset, page.limit, page.total) == (5, 4, 12)


def test_paginate_past_the_end_is_empty():
    page = paginate([Row(n=1)], offset=7, limit=3)
    assert page.items == [] and page.total == 1


def test_paginate_uses_the_default_limit():
    page = paginate([Row(n=i) for i in range(DEFAULT_LIMIT + 3)])
    assert len(page.items) == DEFAULT_LIMIT and page.limit == DEFAULT_LIMIT


def test_page_schema_names_the_item_type():
    schema = Page[Row].model_json_schema()
    assert schema["properties"]["items"]["items"]["$ref"].endswith("Row")
