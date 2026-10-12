"""Reference values for the DQ dumps (TASKS Phase 11: RI4 data quality calendar, RI5 guard fingerprint status).

RI4 has no library equivalent; the reference counts the day states with set arithmetic over the raw record, a
different path from the terminal's per-day classifier:
- a futures sidecar (`dq_sidecar`): the sessions up to the fence split by source; candidates that were not rebuilt
  are unrepairable when the symbol was repaired, gated out when its repair failed validation;
- NQ (`dq_nq`): rebuilt = rejected minus still rejected, unrepairable = still rejected, rejected = every rejected
  day when there is no repair record, vendor = the remaining sessions; all up to the fence.
- the universe matrix (`dq_universe`): the same sets per root, split by year and by variant (repaired: vendor plus
  rebuilt usable; vendor: only vendor days usable, a rebuilt day dropped), plus the first and last bar of each root's
  QA report with a last bar past the fence replaced by the sealed text;
RI5: the fingerprint written out with hashlib and json (sorted keys, UTF-8), and the status from the record
(None: NO RECORD; equal: OK; else MISMATCH). Inputs are plain JSON, so nq_lab is never imported here.
"""
from __future__ import annotations

import hashlib
import json

from crosscheck.reference import Ref

STATES = ("vendor", "gated_out", "rejected", "rebuilt", "unrepairable")
SOURCES = ("vendor", "rebuilt", "candidate_not_repaired")
SET_SOURCE = "set arithmetic over the raw record, sessions up to the fence"


def _counts(**sets: set[str]) -> dict[str, int]:
    out = {state: len(sets.get(state, set())) for state in STATES}
    return {**out, "sessions": sum(out.values())}


def _sidecar_sets(inputs: dict) -> dict[str, set[str]]:
    """The sidecar's sessions up to the fence as sets by state."""
    fence = inputs["fence"]
    by_source: dict[str, set[str]] = {s: set() for s in SOURCES}
    for day, source in inputs["sessions"].items():
        if source not in by_source:
            raise ValueError(f"unknown source {source!r} on {day}")
        if day <= fence:
            by_source[source].add(day)
    candidates = by_source["candidate_not_repaired"]
    repaired = inputs["status"] == "repaired"
    return {"vendor": by_source["vendor"], "rebuilt": by_source["rebuilt"],
            "unrepairable": candidates if repaired else set(), "gated_out": set() if repaired else candidates}


def _nq_sets(inputs: dict) -> dict[str, set[str]]:
    """NQ's sessions up to the fence as sets by state."""
    fence = inputs["fence"]
    sessions = {d for d in inputs["sessions"] if d <= fence}
    rejected = {d for d in inputs["rejected"] if d <= fence}
    if inputs["still"] is None:
        return {"vendor": sessions - rejected, "rejected": rejected}
    still = {d for d in inputs["still"] if d <= fence} & rejected
    return {"vendor": sessions - rejected, "rebuilt": rejected - still, "unrepairable": still}


def dq_sidecar_references(inputs: dict) -> dict:
    """inputs: {"status", "fence", "sessions": {date: source}}."""
    return {"counts": Ref(_counts(**_sidecar_sets(inputs)), SET_SOURCE)}


def dq_nq_references(inputs: dict) -> dict:
    """inputs: {"fence", "sessions": [dates], "rejected": [dates], "still": [dates] or None}."""
    return {"counts": Ref(_counts(**_nq_sets(inputs)), SET_SOURCE)}


def fingerprint(values: dict) -> str:
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode("utf-8")).hexdigest()


def guards_references(inputs: dict) -> dict:
    """inputs: {"groups": {name: values}, "records": {name: sha256 or None}}."""
    live = {name: fingerprint(values) for name, values in inputs["groups"].items()}
    records = inputs["records"]

    def status(name: str) -> str:
        recorded = records.get(name)
        return "NO RECORD" if recorded is None else ("OK" if recorded == live[name] else "MISMATCH")

    source = "hashlib.sha256 of json.dumps(values, sort_keys=True), UTF-8"
    return {"live_sha256": Ref(live, source), "status": Ref({n: status(n) for n in live}, source)}


UNIVERSE_FIELDS = ("sessions", "usable", "gated_out", "unrepairable", "rejected")
SEALED_LAST = "2021-12-31 or later, sealed"
UNIVERSE_SOURCE = "set arithmetic over each root's raw record, grouped by year, sessions up to the fence"


def _universe_cell(sets: dict[str, set[str]], year: str, variant: str, nq: bool) -> dict[str, int]:
    """One root, year and variant. Repaired: vendor plus rebuilt are usable. Vendor: only vendor days are; a rebuilt
    day is dropped (gated out for a futures root, rejected by the session gate for NQ)."""
    def of(state: str) -> set[str]:
        return {d for d in sets.get(state, set()) if d[:4] == year}
    repaired = variant == "repaired"
    dropped = set() if repaired else of("rebuilt")
    usable = of("vendor") | (of("rebuilt") if repaired else set())
    gated = of("gated_out") | (set() if nq else dropped)
    rejected = of("rejected") | (dropped if nq else set())
    cell = {"usable": len(usable), "gated_out": len(gated), "unrepairable": len(of("unrepairable")),
            "rejected": len(rejected)}
    return {"sessions": sum(cell.values()), **cell}


def _bar_text(value: object, fence: str, first: bool) -> str | None:
    date = value[:10] if isinstance(value, str) and len(value) >= 10 else None
    if date is None:
        return None
    if first:
        return date if date <= fence else None
    return date if date <= fence else SEALED_LAST


def dq_universe_references(inputs: dict) -> dict:
    """inputs: {"fence", "years": [int], "roots": {root: {"kind": "sidecar" | "nq", ..the root's record.., "first_ts",
    "last_ts"}}}. The cells are flat: `ROOT|variant|year|field` for every year of the grid; the repaired variant
    exists where the repair passed (a sidecar with status repaired, an NQ with a repaired-days file)."""
    fence, cells, first, last = inputs["fence"], {}, {}, {}
    for root, rec in inputs["roots"].items():
        nq = rec["kind"] == "nq"
        sets = _nq_sets({**rec, "fence": fence}) if nq else _sidecar_sets({**rec, "fence": fence})
        repaired = rec.get("still") is not None if nq else rec["status"] == "repaired"
        for variant in ("vendor", "repaired") if repaired else ("vendor",):
            for year in inputs["years"]:
                for field, n in _universe_cell(sets, str(year), variant, nq).items():
                    cells[f"{root}|{variant}|{year}|{field}"] = n
        first[root], last[root] = _bar_text(rec.get("first_ts"), fence, True), _bar_text(rec.get("last_ts"), fence, False)
    return {"cells": Ref(cells, UNIVERSE_SOURCE),
            "first_bar": Ref({r: v for r, v in first.items() if v is not None}, UNIVERSE_SOURCE),
            "last_bar": Ref({r: v for r, v in last.items() if v is not None}, UNIVERSE_SOURCE)}


P11_DQ_REFERENCES = {"dq_sidecar": dq_sidecar_references, "dq_nq": dq_nq_references,
                     "dq_universe": dq_universe_references, "guards": guards_references}
