"""Sealed JSON key filter (ARCHITECTURE s3.3): the project's own price key names never leave `/api/sealed/{json}`.

The sealed CSVs go through per-file allowlists. The sealed JSONs go through a key filter, which must catch the
price names the project writes (`close`, `open`, `settle`, `c_none`, `c_back`, single-letter `o`, `h`, `l`,
`A`/`S`/`E`/`X` month anchors, `entry`/`exit` prices) in any case. The lowercase `c` stays: in these files it is the
volatility-managed exposure scale (`volmanaged_oos.variants.*.c`, `exposure_options.*.c`), not a close.
"""
from __future__ import annotations

import pytest

from nq_lab.config import ROOT
from nq_terminal.services.research import (
    ResearchService,
    is_price_key,
    strip_price_keys,
)

PRICE_KEYS = ("close", "Close", "open", "high", "low", "settle", "c_none", "c_back", "o_back", "o", "h", "l", "O",
              "H", "L", "C", "A", "S", "E", "X", "entry", "exit", "entry_px", "raw_c", "price", "px", "close_px")
KEPT_KEYS = ("c", "n", "t", "p_one_sided", "headline", "verdict", "sharpe_m", "mean", "months", "closed",
             "opening", "exposure", "last_ts", "entries")


@pytest.mark.parametrize("key", PRICE_KEYS)
def test_price_keys_are_caught(key):
    assert is_price_key(key)


@pytest.mark.parametrize("key", KEPT_KEYS)
def test_other_keys_are_kept(key):
    assert not is_price_key(key)


def test_strip_removes_nested_prices_born_failing():
    doc = {"months": [{"close": 15000.25, "c_none": 15000.25, "entry": 14900.0, "A": "2022-01-03", "n": 3,
                       "c": 0.62}], "headline": {"t": 0.42}}
    assert strip_price_keys(doc) == {"months": [{"n": 3, "c": 0.62}], "headline": {"t": 0.42}}


def test_the_real_sealed_json_views_carry_no_price_key():
    service = ResearchService(ROOT)
    for item in service.sealed_index():
        if item.kind != "json":
            continue
        stack = [service.sealed(item.name).data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                assert not [k for k in node if is_price_key(k)], item.name
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
