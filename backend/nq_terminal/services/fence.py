"""The OOS fence applied to report content before it is served (ARCHITECTURE s9, "fence on every axis").

QA and repair reports are written by research scripts that may look at the whole processed series (NQ's QA runs
to 2026-09-24), so their content can hold market timestamps, per-year keys and epochs past the fence. They reach
the terminal through `/api/qa/{name}` only after `fence_filter`:

- a mapping key that is a year at or after the fence year, or a date after the fence, is dropped with its value;
- a list item that is a date or epoch after the fence, or a mapping with such a direct field, is dropped;
- any other scalar after the fence becomes null;
- keys ending `_utc` are process write times (`written_utc`, `pulled_at_utc`), not market data, and are kept;
- a value equal to the fence itself (a window's exclusive end) is not after it and is kept.

Epochs are recognised on integers only, in seconds, milliseconds or nanoseconds between 2001 and 2100, so a
float statistic is never read as a time. The function returns a new structure and the count it removed.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

import pandas as pd

from nq_lab.config import IS_END

DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}")
YEAR_KEY = re.compile(r"\d{4}")
PROCESS_TIME_SUFFIX = "_utc"
FENCE_S = int(IS_END.timestamp())
EPOCH_RANGES = ((10**9, 41 * 10**8, 1), (10**12, 41 * 10**11, 10**3), (10**18, 41 * 10**17, 10**9))


def _epoch_after(value: int) -> bool:
    for low, high, per_second in EPOCH_RANGES:
        if low <= abs(value) < high:
            return value / per_second > FENCE_S
    return False


def after_fence(value: Any) -> bool:
    """True for a date string or an integer epoch strictly after the fence (2022-01-01 00:00 UTC)."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return _epoch_after(value)
    if not isinstance(value, str) or not DATE_PREFIX.match(value):
        return False
    try:
        stamp = pd.Timestamp(value)
    except (ValueError, TypeError):
        stamp = pd.Timestamp(value[:10])
    stamp = stamp.tz_localize("UTC") if stamp.tzinfo is None else stamp.tz_convert("UTC")
    return bool(stamp > IS_END)


def _key_after(key: str) -> bool:
    if YEAR_KEY.fullmatch(key):
        return int(key) >= IS_END.year
    return after_fence(key)


def _item_after(item: Any) -> bool:
    if isinstance(item, Mapping):
        return any(after_fence(v) for k, v in item.items() if not str(k).endswith(PROCESS_TIME_SUFFIX))
    return after_fence(item)


def fence_filter(value: Any) -> tuple[Any, int]:
    """(a copy of `value` with every post-fence entry removed or nulled, the number removed)."""
    if isinstance(value, Mapping):
        out, dropped = {}, 0
        for key, item in value.items():
            text = str(key)
            if text.endswith(PROCESS_TIME_SUFFIX):
                out[key] = item
            elif _key_after(text):
                dropped += 1
            elif after_fence(item):
                out[key], dropped = None, dropped + 1
            else:
                out[key], inner = fence_filter(item)
                dropped += inner
        return out, dropped
    if isinstance(value, (list, tuple)):
        out_list, dropped = [], 0
        for item in value:
            if _item_after(item):
                dropped += 1
                continue
            kept, inner = fence_filter(item)
            out_list.append(kept)
            dropped += inner
        return out_list, dropped
    return value, 0
