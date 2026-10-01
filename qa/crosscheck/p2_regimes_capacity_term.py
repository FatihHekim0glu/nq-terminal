"""References for the P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12;
ANALYTICS_CATALOG sections 9 to 11), dumped by `terminal/backend/tests/test_dump_for_qa_p2_rct.py`.

- `p2trend` (RG2): pandas `rolling(window).mean()` of the close on its session index, each session labelled from the
  last close dated before it ("above" when strictly above its mean, else "below"; no label without a full window);
  per regime n, mean, Sharpe (sd ddof 1, sqrt P) and hit rate over the non-zero sessions; Welch's t and its degrees
  of freedom from statsmodels `ttest_ind(usevar="unequal")`. The dump's `nautilus` side carries Nautilus
  `SharpeRatio` on each regime's sessions, the third implementation.
- `p2capacity` (EX5): a plain Python walk. Each leg's session is the New York date of its epoch second
  (`zoneinfo`), contracts are quantity times the instrument's factor, summed per (root, session); the ratio is
  contracts over the session's volume where that volume is above zero; per root the mean (`statistics.fmean`),
  median, 95th percentile (`statistics.quantiles(method="inclusive")`, numpy's linear rule), maximum and its session.
- `p2term` (MV6): a plain Python walk over the two legs' rows before 2022-01-01, the void reasons in the documented
  order, the last trading days from the CME rules written out here over the dumped NYSE business days (independent
  of `nq_lab.carry_expiry`), and `carry = (F1 - F2) / (F2 x days / 365.25)`.
- `p2expiry`: the same written-out rules for every root and contract month in the dump, against the terminal's
  expiries (the lab's pinned table); dates compare as words, exactly.

Wiring (the merge step): `P2_RCT_INPUTS` into `dumps.BUNDLE_INPUTS` and `P2_RCT_REFERENCES` into
`compare.BUNDLE_REFERENCES`. This module only reads; it never imports the backend or nq-lab.
"""
from __future__ import annotations

import bisect
import datetime as dt
import math
import statistics
import warnings
from zoneinfo import ZoneInfo

import pandas as pd

with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    from statsmodels.stats.weightstats import ttest_ind

from crosscheck.reference import Ref

FENCE = "2022-01-01"
NEW_YORK = ZoneInfo("America/New_York")
MIN_VOLUME = 10.0
DAYS_PER_YEAR = 365.25
VOID_ORDER = ("missing_front", "missing_next", "unresolved", "order", "thin", "price")
MONTH_CODES = "FGHJKMNQUVXZ"
# CME last trading day rules, transcribed from CME Group's contract specifications (the same wording as the lab's
# rule table documents); written here independently of `nq_lab.carry_expiry.RULES`.
RULE_OF = {
    **dict.fromkeys(("ES", "NQ", "YM"), "third_friday"), **dict.fromkeys(("ZT", "ZF", "LE"), "last_bd"),
    **dict.fromkeys(("ZN", "ZB"), "last_bd_minus_7"), **dict.fromkeys(("6E", "6J", "6B", "6A", "6S"), "third_wed_2"),
    "6C": "third_wed_1", "CL": "cl_25th", "NG": "three_before_first", "HO": "last_bd_prior", "RB": "last_bd_prior",
    **dict.fromkeys(("GC", "SI", "HG"), "third_last_bd"), **dict.fromkeys(("ZC", "ZS", "ZW", "ZL", "ZM"), "before_15th"),
    "HE": "tenth_bd",
}
P2TREND_INPUTS = ("dates", "r", "close_dates", "close", "window", "periods")
P2CAPACITY_INPUTS = ("legs", "volume")
P2TERM_INPUTS = ("root", "front", "next", "business_days")
P2EXPIRY_INPUTS = ("contracts", "business_days")


# ---------------------------------------------------------------- RG2


def _regime_values(part: pd.Series, periods: int) -> dict:
    n = len(part)
    sd = float(part.std(ddof=1)) if n > 1 else math.nan
    nonzero = int((part != 0).sum())
    return {"n": float(n), "mean": float(part.mean()) if n else math.nan,
            "sharpe": float(part.mean() / sd * math.sqrt(periods)) if sd > 0 else math.nan,
            "hit_rate": float((part > 0).sum() / nonzero) if nonzero else math.nan}


def trend_labels(inputs: dict) -> list:
    close = pd.Series([math.nan if v is None else float(v) for v in inputs["close"]],
                      index=pd.DatetimeIndex(pd.to_datetime(inputs["close_dates"])))
    mean = close.rolling(int(inputs["window"])).mean()
    labels = []
    for t in pd.DatetimeIndex(pd.to_datetime(inputs["dates"])):
        before = close.index[close.index < t]
        if not len(before) or not (math.isfinite(close[before[-1]]) and math.isfinite(mean[before[-1]])):
            labels.append(None)
            continue
        labels.append("above" if close[before[-1]] > mean[before[-1]] else "below")
    return labels


def trend_references(inputs: dict) -> dict:
    labels = trend_labels(inputs)
    r = pd.Series([float(v) for v in inputs["r"]], index=pd.DatetimeIndex(pd.to_datetime(inputs["dates"])))
    periods = int(inputs["periods"])
    codes = pd.Series(labels, index=r.index, dtype=object)
    src = "pandas rolling mean of the close at the session before; plain per-regime statistics"
    out = {"labels": Ref([lab if lab is not None else "none" for lab in labels], src),
           "unlabelled": Ref(float(sum(lab is None for lab in labels)), src)}
    for name in ("above", "below"):
        for key, value in _regime_values(r[codes == name], periods).items():
            out[f"{name}_{key}"] = Ref(value, src)
    above, below = r[codes == "above"].to_numpy(), r[codes == "below"].to_numpy()
    t, df = math.nan, math.nan  # undefined with fewer than two sessions on either side
    if len(above) > 1 and len(below) > 1:
        t, _, df = ttest_ind(above, below, usevar="unequal")
    out["welch_t"] = Ref(float(t), "statsmodels ttest_ind(usevar='unequal')")
    out["welch_df"] = Ref(float(df), "statsmodels ttest_ind(usevar='unequal')")
    return out


# ---------------------------------------------------------------- EX5


def _session(epoch: float) -> str:
    return dt.datetime.fromtimestamp(float(epoch), tz=NEW_YORK).date().isoformat()


def capacity_walk(inputs: dict) -> dict:
    """{root: {session: contracts}} from the legs [instrument root or None, epoch seconds, quantity, factor]."""
    out: dict[str, dict[str, float]] = {}
    for root, epoch, qty, factor in inputs["legs"]:
        if root is None:
            continue
        day = _session(epoch)
        out.setdefault(root, {})
        out[root][day] = out[root].get(day, 0.0) + float(qty) * float(factor)
    return out


def _root_refs(root: str, sessions: dict, volume: dict, src: str) -> tuple[dict, list]:
    ratios, kept = [], []
    for day in sorted(sessions):
        v = volume.get(day)
        if v is not None and math.isfinite(v) and v > 0:
            ratios.append(sessions[day] / v)
            kept.append((day, v))
    contracts = [sessions[d] for d in sorted(sessions)]
    top = max(range(len(ratios)), key=lambda i: (ratios[i], -i)) if ratios else None
    refs = {"sessions": float(len(sessions)), "sessions_with_volume": float(len(ratios)),
            "void": float(len(sessions) - len(ratios)), "contracts_total": math.fsum(contracts),
            "contracts_mean": statistics.fmean(contracts),
            "ratio_mean": statistics.fmean(ratios) if ratios else math.nan,
            "ratio_median": statistics.median(ratios) if ratios else math.nan,
            "ratio_p95": (statistics.quantiles(ratios, n=20, method="inclusive")[18] if len(ratios) > 1
                          else (ratios[0] if ratios else math.nan)),
            "ratio_max": ratios[top] if top is not None else math.nan,
            "volume_median": statistics.median([v for _, v in kept]) if kept else math.nan}
    out = {f"{root}.{key}": Ref(value, src) for key, value in refs.items()}
    out[f"{root}.ratio_max_session"] = Ref([kept[top][0] if top is not None else "none"], src)  # a word, as a list
    return out, ratios


def capacity_references(inputs: dict) -> dict:
    src = "plain Python: New York dates by zoneinfo, sums per root and session, statistics"
    walked = capacity_walk(inputs)
    out, best = {}, []
    for root in sorted(walked):
        volume = {d: float(v) for d, v in (inputs["volume"].get(root) or {}).items()}
        refs, ratios = _root_refs(root, walked[root], volume, src)
        out.update(refs)
        best.extend(ratios)
    out["max_ratio"] = Ref(max(best) if best else math.nan, src)
    return out


# ---------------------------------------------------------------- MV6 and the expiry rules


class Calendar:
    """NYSE business days (ISO strings from the dump) with the few lookups the rules need."""

    def __init__(self, days) -> None:
        self.days = [dt.date.fromisoformat(d) for d in days]

    def month(self, year: int, month: int) -> list[dt.date]:
        return [d for d in self.days if d.year == year and d.month == month]

    def before(self, day: dt.date, k: int) -> dt.date:
        """The k-th business day strictly before `day`."""
        return self.days[bisect.bisect_left(self.days, day) - k]

    def on_or_before(self, day: dt.date) -> dt.date:
        return self.days[bisect.bisect_right(self.days, day) - 1]

    def is_day(self, day: dt.date) -> bool:
        at = bisect.bisect_left(self.days, day)
        return at < len(self.days) and self.days[at] == day


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _prior(year: int, month: int) -> tuple[int, int]:
    return (year - 1, 12) if month == 1 else (year, month - 1)


def last_trading_day(cal: Calendar, root: str, year: int, month: int) -> dt.date:
    rule = RULE_OF[root]
    days = cal.month(year, month)
    if rule == "third_friday":
        return cal.on_or_before(_nth_weekday(year, month, 4, 3))
    if rule == "last_bd":
        return days[-1]
    if rule == "last_bd_minus_7":
        return cal.before(days[-1], 7)
    if rule in ("third_wed_2", "third_wed_1"):
        return cal.before(_nth_weekday(year, month, 2, 3), int(rule[-1]))
    if rule == "cl_25th":
        d25 = dt.date(*_prior(year, month), 25)
        return cal.before(d25, 3 if cal.is_day(d25) else 4)
    if rule == "three_before_first":
        return cal.before(dt.date(year, month, 1), 3)
    if rule == "last_bd_prior":
        return cal.month(*_prior(year, month))[-1]
    if rule == "third_last_bd":
        return days[-3]
    if rule == "before_15th":
        return cal.before(dt.date(year, month, 15), 1)
    return days[9]  # tenth_bd


def _key_month(key, root: str) -> tuple[int, int] | None:
    text = key if isinstance(key, str) else ""
    if len(text) != 7 or text[:2] != root or text[2] not in MONTH_CODES or not text[3:].isdigit():
        return None
    return int(text[3:]), MONTH_CODES.index(text[2]) + 1


def _rows(leg: dict) -> dict:
    rows = {}
    for day, c, v, h, low, key in zip(leg["dates"], leg["c"], leg["v"], leg["h"], leg["l"], leg["contract"],
                                      strict=True):
        if str(day) < FENCE:
            rows[str(day)] = {"c": c, "v": v, "h": h, "l": low, "contract": key}
    return rows


def _void(cal: Calendar, root: str, a, b) -> tuple[str | None, tuple]:
    if a is None:
        return "missing_front", ()
    if b is None:
        return "missing_next", ()
    m1, m2 = _key_month(a["contract"], root), _key_month(b["contract"], root)
    if m1 is None or m2 is None:
        return "unresolved", ()
    e1, e2 = last_trading_day(cal, root, *m1), last_trading_day(cal, root, *m2)
    if e2 <= e1:
        return "order", ()
    liquid = all(x["v"] is not None and x["v"] >= MIN_VOLUME and x["h"] > x["l"] for x in (a, b))
    if not liquid:
        return "thin", ()
    f1, f2 = a["c"], b["c"]
    if f1 is None or f2 is None or not (math.isfinite(f1) and math.isfinite(f2)) or f2 <= 0:
        return "price", ()
    return None, (e1, e2, float(f1), float(f2))


def term_walk(inputs: dict) -> dict:
    root, cal = str(inputs["root"]), Calendar(inputs["business_days"])
    front, nxt = _rows(inputs["front"]), _rows(inputs["next"])
    void = dict.fromkeys(VOID_ORDER, 0)
    rows = []
    for day in sorted(set(front) | set(nxt)):
        reason, found = _void(cal, root, front.get(day), nxt.get(day))
        if reason is not None:
            void[reason] += 1
            continue
        e1, e2, f1, f2 = found
        tau = (e2 - e1).days / DAYS_PER_YEAR
        rows.append({"date": day, "expiry_front": e1.isoformat(), "expiry_next": e2.isoformat(), "tau": tau,
                     "spread": f1 - f2, "carry": (f1 - f2) / (f2 * tau)})
    return {"rows": rows, "void": void}


def term_references(inputs: dict) -> dict:
    walked = term_walk(inputs)
    rows = walked["rows"]
    src = "plain Python: CME rules over the dumped NYSE days, (F1 - F2) / (F2 x days / 365.25)"
    carry = [r["carry"] for r in rows]
    out = {key: Ref([r[key] for r in rows], src) for key in ("date", "expiry_front", "expiry_next")}
    out.update({key: Ref([r[key] for r in rows], src) for key in ("tau", "spread", "carry")})
    out["void"] = Ref({k: float(v) for k, v in walked["void"].items()}, src)
    out["n"] = Ref(float(len(carry)), src)
    if carry:
        out.update(mean=Ref(statistics.fmean(carry), src), median=Ref(statistics.median(carry), src),
                   min=Ref(min(carry), src), max=Ref(max(carry), src),
                   share_backwardation=Ref(sum(c > 0 for c in carry) / len(carry), src))
    return out


def expiry_references(inputs: dict) -> dict:
    cal = Calendar(inputs["business_days"])
    days = [last_trading_day(cal, root, int(y), int(m)).isoformat() for root, y, m in inputs["contracts"]]
    return {"expiries": Ref(days, "CME last trading day rules written out over the dumped NYSE days"),
            "count": Ref(float(len(days)), "contracts in the dump")}


P2_RCT_INPUTS = {"p2trend": P2TREND_INPUTS, "p2capacity": P2CAPACITY_INPUTS, "p2term": P2TERM_INPUTS,
                 "p2expiry": P2EXPIRY_INPUTS}
P2_RCT_REFERENCES = {"p2trend": trend_references, "p2capacity": capacity_references, "p2term": term_references,
                     "p2expiry": expiry_references}
