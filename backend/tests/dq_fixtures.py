"""A tiny results tree for the DQ tests (RI4, RI5), written under a pytest tmp_path; never under the real results.

Layout, shaped like the real files (keys copied from results/ on 2026-09-27, values invented and small):
- screens/za_v0_rejected_days.json and za_v0_repaired_rejected_days.json (NQ, `{date: reason}`);
- repair_report.json (NQ repair, `skipped` reasons with dates);
- qa_report.json (NQ, per-year structural counts, with a 2022 year that must never be served);
- qa_report_futures_1m.json (per root, per-year counts);
- repair_provenance_futures/<SYM>.json (v1 sidecars) and repair_provenance_futures_v2/<SYM>.json (v2, read first
  for the eight v2 symbols);
- guard_constants.json (the CONSTANTS fingerprint record).
"""
from __future__ import annotations

import json
from pathlib import Path

from nq_lab import guards

NQ_REJECTED = {"2010-09-28": "no bars", "2014-06-12": "no bars", "2015-03-02": "only 300 of 390 RTH bars",
               "2020-03-09": "opening range bar missing", "2022-01-03": "no bars"}
NQ_STILL_REJECTED = {"2014-06-12": "no bars", "2020-03-09": "opening range bar missing"}
NQ_SKIPPED = {"RepairError: no trades": {"n": 1, "dates": ["2014-06-12"]},
              "gate after repair: opening range bar missing": {"n": 1, "dates": ["2020-03-09"]}}

GC_SESSIONS = {
    "2011-01-03": {"source": "vendor"},
    "2011-01-04": {"source": "rebuilt", "vendor_reasons": ["one_bar_heavy", "few_bars"], "volume_flag": True},
    "2011-01-05": {"source": "candidate_not_repaired", "reason": "RepairError: contract carries two offsets",
                   "vendor_reasons": ["one_bar_heavy"]},
    "2011-01-06": {"source": "vendor"},
    "2022-01-03": {"source": "rebuilt", "vendor_reasons": ["few_bars"]},
}
ES_V1_SESSIONS = {"2011-01-03": {"source": "vendor"},
                  "2011-01-04": {"source": "candidate_not_repaired", "reason": "symbol not repaired: v1",
                                 "vendor_reasons": ["one_bar_heavy"]}}
ES_V2_SESSIONS = {
    "2011-01-03": {"source": "vendor"},
    "2011-01-04": {"source": "candidate_not_repaired", "reason": "symbol not repaired in v2: validation FAIL",
                   "tier": "H", "flags": ["c2", "c5"]},
    "2011-01-05": {"source": "candidate_not_repaired", "reason": "symbol not repaired in v2: validation FAIL",
                   "tier": "D", "flags": ["c6"]},
}
ES_WHY = "validation FAIL: failed checks ['H']"


def _dump(path: Path, doc: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1), encoding="utf-8")


def _sidecar(symbol: str, status: str, sessions: dict, why: str | None = None, **extra: object) -> dict:
    counts: dict[str, int] = {"vendor": 0, "rebuilt": 0, "candidate_not_repaired": 0}
    for row in sessions.values():
        counts[row["source"]] += 1
    return {"symbol": symbol, "root": symbol.split(".")[0], "status": status, "why_not_repaired": why,
            "counts": {**counts, "sessions": len(sessions)}, "sessions": sessions, **extra}


def write_dq_results(root: Path) -> Path:
    """Write the tree under `root/results` and return that results folder."""
    results = root / "results"
    _dump(results / "screens" / "za_v0_rejected_days.json", NQ_REJECTED)
    _dump(results / "screens" / "za_v0_repaired_rejected_days.json", NQ_STILL_REJECTED)
    _dump(results / "repair_report.json", {"broken_days": 4, "repaired": 2, "skipped": NQ_SKIPPED})
    years = {"2011": {"rows": 1000, "ohlc_violations": 0, "duplicate_timestamps": 0, "rth_days_with_gaps": 3},
             "2022": {"rows": 999, "ohlc_violations": 0, "duplicate_timestamps": 0, "rth_days_with_gaps": 0}}
    _dump(results / "qa_report.json", {"symbol": "NQ.V.0", "years": years})
    fut_years = {"2011": {"rows": 500, "ohlc_violations": 1, "duplicate_ts": 0, "contract_changes": 4}}
    _dump(results / "qa_report_futures_1m.json", {"symbols": {"GC": {"symbol": "GC.V.0", "years": fut_years}}})
    v1 = results / "repair_provenance_futures"
    _dump(v1 / "GC.V.0.json", _sidecar("GC.V.0", "repaired", GC_SESSIONS))
    _dump(v1 / "ES.V.0.json", _sidecar("ES.V.0", "not_repaired", ES_V1_SESSIONS, "validation FAIL: v1"))
    _dump(v1 / "index.json", {"symbols": {}})
    _dump(results / "repair_provenance_futures_v2" / "ES.V.0.json",
          _sidecar("ES.V.0", "not_repaired", ES_V2_SESSIONS, ES_WHY, spec_name="repair_futures_v2"))
    _dump(results / "guard_constants.json", {"sha256": guards.fingerprint(), "constants": guards.CONSTANTS})
    return results
