"""Session quality flags for the GP chart (UI_SPEC s7 GP: `[GATED]` and `[REPAIRED]`; ARCHITECTURE s3.2).

`qa.day_gate` rejected sessions are recorded per variant by the za_v0 screens, as `{date: reason}` files under
`results/screens/`; nothing here reads a price. For NQ.V.0:
- vendor bars: gated = the vendor rejected days; nothing is repaired in the vendor series;
- repaired bars: gated = the days still rejected after the repair; repaired = the vendor rejected days that the
  repair rebuilt from trades (in the vendor list, not in the repaired one).
Other symbols have no session QA file and are reported as not assessed. Dates are session dates (YYYY-MM-DD)
inside the served window.

Session exclusions for the screens that read 1m bars (SEAS buckets, EVT intraday), `default_exclusions`: NQ.V.0 from
the files above; every other symbol from its futures repair provenance (`nq_lab.data.excluded_sessions`, which also
checks the merged file's sha256; memoised per symbol and variant, never read in fixture mode). A symbol with neither
record is not assessed.
"""
from __future__ import annotations

import datetime as dt
import functools
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

import pandas as pd

from nq_lab.config import IS_END, IS_START
from nq_terminal.services.files import FileAccessError, FileCache, FileDecodeError

SESSION_QA: Mapping[str, Mapping[str, str]] = MappingProxyType({
    "NQ.V.0": MappingProxyType({"vendor": "za_v0_rejected_days.json",
                                "repaired": "za_v0_repaired_rejected_days.json"}),
})
SOURCE = "qa.day_gate, from results/screens/{files}"


def _days(files: FileCache, screens: Path, name: str) -> set[str] | None:
    try:
        doc = files.read_json(screens / name)
    except (FileNotFoundError, FileAccessError, FileDecodeError):
        return None
    return {str(day)[:10] for day in doc} if isinstance(doc, Mapping) else None


def _inside(days: set[str], start: pd.Timestamp, end: pd.Timestamp) -> list[str]:
    lo, hi = start.tz_convert("UTC").strftime("%Y-%m-%d"), end.tz_convert("UTC")
    return sorted(d for d in days if lo <= d and pd.Timestamp(d, tz="UTC") < hi)


def session_flags(files: FileCache, results_dir: Path, symbol: str, variant: str, start: pd.Timestamp,
                  end: pd.Timestamp) -> dict:
    """{assessed, source, gated, repaired} for the served window (see the module docstring)."""
    names = SESSION_QA.get(symbol)
    screens = Path(results_dir) / "screens"
    vendor = _days(files, screens, names["vendor"]) if names else None
    if vendor is None:
        return {"assessed": False, "source": None, "gated": [], "repaired": []}
    if variant == "vendor":
        gated, repaired, used = vendor, set(), names["vendor"]
    else:
        still = _days(files, screens, names["repaired"])
        if still is None:
            return {"assessed": False, "source": None, "gated": [], "repaired": []}
        gated, repaired, used = still, vendor - still, f"{names['vendor']} and {names['repaired']}"
    return {"assessed": True, "source": SOURCE.format(files=used), "gated": _inside(gated, start, end),
            "repaired": _inside(repaired, start, end)}


# ---------------------------------------------------------------- exclusions for 1m screens

DAY_GATE_PREFIX = "qa.day_gate"
PROVENANCE_SOURCE = "futures repair provenance (nq_lab.data.excluded_sessions, variant {variant})"


@dataclass(frozen=True)
class Exclusions:
    """Sessions to drop from 1m work; `assessed` False means no record exists (no 1m view)."""

    assessed: bool
    days: frozenset[dt.date]
    source: str | None

    @property
    def day_gate(self) -> bool:
        return bool(self.source) and self.source.startswith(DAY_GATE_PREFIX)


ExclusionFn = Callable[[str, str], Exclusions]
NOT_ASSESSED = Exclusions(assessed=False, days=frozenset(), source=None)


@functools.lru_cache(maxsize=64)
def provenance_exclusions(symbol: str, variant: str) -> Exclusions:
    from nq_lab import data as nq_data  # lazy: nq_lab.data imports the gate and pyarrow.dataset (D1.1)

    try:
        days = nq_data.excluded_sessions(symbol, variant)
    except (nq_data.DataLayoutError, FileNotFoundError, ValueError, KeyError):
        return NOT_ASSESSED
    return Exclusions(assessed=True, days=frozenset(days), source=PROVENANCE_SOURCE.format(variant=variant))


def default_exclusions(files: FileCache, results_dir: Path, *, fixture_mode: bool) -> ExclusionFn:
    """NQ from its session QA files; other symbols from their repair provenance (never in fixture mode, whose
    runs must not depend on the real results folder)."""

    def exclusions(symbol: str, variant: str) -> Exclusions:
        if symbol in SESSION_QA:
            flags = session_flags(files, results_dir, symbol, variant, IS_START, IS_END)
            if not flags["assessed"]:
                return NOT_ASSESSED
            days = frozenset(dt.date.fromisoformat(d) for d in flags["gated"])
            return Exclusions(assessed=True, days=days, source=flags["source"])
        return NOT_ASSESSED if fixture_mode else provenance_exclusions(symbol, variant)

    return exclusions
