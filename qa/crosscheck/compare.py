"""Compare each dumped value with its reference and give it a status.

- PASS: the definitions match and |value - reference| <= tolerance x max(|value|, |reference|).
- FAIL: the definitions match and the difference is larger, or only one side is NaN.
- SKIP: `ours` could not be computed (the dump says why) or the dump has no value for a referenced metric at all;
  `--strict` turns a SKIP into a failure, so a metric that silently vanished from a dump cannot pass.
- INFO: the reference library defines the metric differently (documented in `reference.py`); never fails.

Tolerances follow ANALYTICS_CATALOG section 14: 1e-9 relative for closed forms, 1e-12 for values stored
in the project's result files (anchors).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from crosscheck.dumps import SIDES, Bundle, Case, RegistryDump
from crosscheck.lv6_live_cone import LV6_REFERENCES
from crosscheck.market_reference import market_references
from crosscheck.p11_dq import P11_DQ_REFERENCES
from crosscheck.p11_evt import P11_EVT_REFERENCES
from crosscheck.p11_roll import P11_ROLL_REFERENCES
from crosscheck.p11_seas import P11_SEAS_REFERENCES
from crosscheck.p11_vcone import P11_VCONE_REFERENCES
from crosscheck.p1_reference import P1_REFERENCES
from crosscheck.p2_regimes_capacity_term import P2_RCT_REFERENCES
from crosscheck.p2_risk_extras import P2_RISK_REFERENCES
from crosscheck.p2_spa import P2_SPA_REFERENCES
from crosscheck.reference import DOCUMENTED, Ref, registry_references, series_references
from crosscheck.trade_reference import costs_references, trades_references

BUNDLE_REFERENCES = {"trades": trades_references, "costs": costs_references, "market": market_references,
                     **P1_REFERENCES,
                     # Phase 11: VCONE, SEAS, EVT, ROLL and DQ (RI4, RI5)
                     **P11_VCONE_REFERENCES, **P11_SEAS_REFERENCES, **P11_EVT_REFERENCES, **P11_ROLL_REFERENCES,
                     **P11_DQ_REFERENCES,
                     # Phase 12 (P2): SV8, RK4 with PF11 and BR5, RG2, EX5 and MV6
                     **P2_SPA_REFERENCES, **P2_RISK_REFERENCES, **P2_RCT_REFERENCES,
                     # v2.1: LV6 and LV6b served
                     **LV6_REFERENCES}

PASS, FAIL, SKIP, INFO = "PASS", "FAIL", "SKIP", "INFO"
TOL = 1e-9
TOL_STORED = 1e-12
ABS_FLOOR = 1e-15  # two values this close are equal whatever their size (e.g. 0 against 1e-17)


@dataclass(frozen=True)
class Row:
    case: str
    metric: str
    side: str
    value: object
    ref: object
    diff: float
    status: str
    source: str
    note: str = ""


def _scalar_diff(value, ref) -> tuple[float, bool]:
    """(signed difference, within the tolerance flag) with NaN and infinity handled."""
    a = math.nan if value is None else float(value)
    b = math.nan if ref is None else float(ref)
    if math.isnan(a) or math.isnan(b):
        return math.nan, math.isnan(a) and math.isnan(b)
    if math.isinf(a) or math.isinf(b):
        return (0.0, True) if a == b else (math.inf, False)
    return a - b, None


def _vector(value) -> np.ndarray:
    return np.array([math.nan if v is None else float(v) for v in value], dtype=float)


def _vector_diff(value, ref, tol: float) -> tuple[float, bool]:
    if isinstance(ref, dict):
        if not isinstance(value, dict) or set(value) != set(ref):
            return math.inf, False
        keys = sorted(ref)
        value, ref = [value[k] for k in keys], [ref[k] for k in keys]
    a, b = _vector(value), _vector(ref)
    if a.shape != b.shape or not np.array_equal(np.isnan(a), np.isnan(b)):
        return math.inf, False
    both = ~np.isnan(a)
    if not both.any():
        return 0.0, True
    diff = a[both] - b[both]
    worst = float(diff[np.argmax(np.abs(diff))])
    scale = float(np.max(np.abs(b[both])))
    return worst, abs(worst) <= max(tol * scale, ABS_FLOOR)


def _textual(ref) -> bool:
    """True for a word or hash (RI5's statuses and sha256s), or a list or dict holding one."""
    if isinstance(ref, dict):
        return any(isinstance(v, str) for v in ref.values())
    if isinstance(ref, (list, tuple)):
        return any(isinstance(v, str) for v in ref)
    return isinstance(ref, str)


def judge(value, ref, tol: float) -> tuple[float, bool]:
    if _textual(ref):  # words and hashes match exactly or not at all
        return (0.0, True) if value == ref else (math.inf, False)
    if isinstance(ref, (list, tuple, dict)):
        return _vector_diff(value, ref, tol)
    diff, settled = _scalar_diff(value, ref)
    if settled is not None:
        return diff, settled
    scale = max(abs(float(value)), abs(float(ref)))
    return diff, abs(diff) <= max(tol * scale, ABS_FLOOR)


def _row(case: str, metric: str, side: str, value, ref: Ref) -> Row:
    tol = TOL_STORED if side.split("@")[0] == "stored" else TOL
    diff, ok = judge(value, ref.value, tol)
    if ref.kind == DOCUMENTED:
        return Row(case, metric, side, value, ref.value, diff, INFO, ref.source, ref.note)
    return Row(case, metric, side, value, ref.value, diff, PASS if ok else FAIL, ref.source, ref.note)


def _matches(values: dict, target: str) -> list[tuple[str, object]]:
    """(label suffix, value) for `target` and every labelled second implementation `target@impl`."""
    found = [("", values[target])] if target in values else []
    found += [(k[len(target):], v) for k, v in sorted(values.items()) if k.startswith(target + "@")]
    return found


def _rows_for(name: str, key: str, ref: Ref, values: dict, missing: dict) -> list[Row]:
    target = ref.against or key
    rows = []
    for side in SIDES:
        found = _matches(values.get(side, {}), target)
        if found:
            rows.extend(_row(name, key, side + label, value, ref) for label, value in found)
        elif side == "ours" and ref.kind != DOCUMENTED:
            reason = str(missing[target]) if target in missing else f"the dump has no terminal value for {target}"
            rows.append(Row(name, key, side, None, ref.value, math.nan, SKIP, ref.source, reason))
    if ref.kind == DOCUMENTED and not rows:
        rows.append(Row(name, key, "reference", None, ref.value, math.nan, INFO, ref.source, ref.note))
    return rows


def compare_case(case: Case) -> list[Row]:
    rows = []
    for key, ref in series_references(case).items():
        rows.extend(_rows_for(case.name, key, ref, case.values, case.missing))
    return rows


def compare_registry(dump: RegistryDump) -> list[Row]:
    rows = []
    for key, ref in registry_references(dump.p).items():
        rows.extend(_rows_for(dump.name, key, ref, dump.values, dump.missing))
    return rows


def compare_bundle(dump: Bundle) -> list[Row]:
    """TA1 and TA3 (`trades`) or EX1 to EX4 (`costs`) of one run, or a market view (`market`), against the
    raw-input references."""
    rows = []
    for key, ref in BUNDLE_REFERENCES[dump.kind](dump.inputs).items():
        rows.extend(_rows_for(dump.name, key, ref, dump.values, dump.missing))
    return rows


def compare_any(dump) -> list[Row]:
    if isinstance(dump, RegistryDump):
        return compare_registry(dump)
    return compare_bundle(dump) if isinstance(dump, Bundle) else compare_case(dump)


def exit_code(rows: list[Row], strict: bool = False) -> int:
    bad = {FAIL, SKIP} if strict else {FAIL}
    return 1 if any(row.status in bad for row in rows) else 0
