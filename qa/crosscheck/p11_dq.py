"""Reference values for the DQ dumps (TASKS Phase 11: RI4 data quality calendar, RI5 guard fingerprint status).

RI4 has no library equivalent; the reference counts the day states with set arithmetic over the raw record, a
different path from the terminal's per-day classifier:
- a futures sidecar (`dq_sidecar`): the sessions up to the fence split by source; candidates that were not rebuilt
  are unrepairable when the symbol was repaired, gated out when its repair failed validation;
- NQ (`dq_nq`): rebuilt = rejected minus still rejected, unrepairable = still rejected, rejected = every rejected
  day when there is no repair record, vendor = the remaining sessions; all up to the fence.
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


def dq_sidecar_references(inputs: dict) -> dict:
    """inputs: {"status", "fence", "sessions": {date: source}}."""
    fence = inputs["fence"]
    by_source: dict[str, set[str]] = {s: set() for s in SOURCES}
    for day, source in inputs["sessions"].items():
        if source not in by_source:
            raise ValueError(f"unknown source {source!r} on {day}")
        if day <= fence:
            by_source[source].add(day)
    candidates = by_source["candidate_not_repaired"]
    repaired = inputs["status"] == "repaired"
    counts = _counts(vendor=by_source["vendor"], rebuilt=by_source["rebuilt"],
                     unrepairable=candidates if repaired else set(), gated_out=set() if repaired else candidates)
    return {"counts": Ref(counts, SET_SOURCE)}


def dq_nq_references(inputs: dict) -> dict:
    """inputs: {"fence", "sessions": [dates], "rejected": [dates], "still": [dates] or None}."""
    fence = inputs["fence"]
    sessions = {d for d in inputs["sessions"] if d <= fence}
    rejected = {d for d in inputs["rejected"] if d <= fence}
    if inputs["still"] is None:
        counts = _counts(vendor=sessions - rejected, rejected=rejected)
    else:
        still = {d for d in inputs["still"] if d <= fence} & rejected
        counts = _counts(vendor=sessions - rejected, rebuilt=rejected - still, unrepairable=still)
    return {"counts": Ref(counts, SET_SOURCE)}


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


P11_DQ_REFERENCES = {"dq_sidecar": dq_sidecar_references, "dq_nq": dq_nq_references, "guards": guards_references}
