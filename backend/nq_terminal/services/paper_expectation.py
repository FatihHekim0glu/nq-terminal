"""LV6 and LV6b on LIVE, served (ANALYTICS_CATALOG section 13; `analytics/expectation.py` holds the arithmetic).

Reads, all of them already served elsewhere and none of them a write:
- the paper tracking of a journal (LV5, performance rows only: `tearsheet_trades.paper_tracking_view`);
- the hypothesis card of the registered hypothesis that owns the journal (its recorded costs and Nautilus runs) and
  the run list (probe, balance and readable badges), to find K's run as the browser did;
- K: the capital of that run's account series (`series.run_series(..., bars=None)`: the starting balance needs no
  price, so no gate read is made for it; a run the analytics route answers with 422 has no K here either);
- the backtest-start cone: the SV6 cone of `/api/analytics/hypothesis/{name}/bootstrap` at the default cost, through
  the same series builder (`hypothesis_series`; the caller passes no bar service, since the bars only add a benchmark
  and the cone resamples the series alone, so no gate read is made) and the same `tearsheet_extended.bootstrap_view`.
  Its replications are kept in a small in-process cache keyed by the series' own bytes, because LIVE re-reads this
  view while the paper journal grows and the cone does not change;
- the live-start cone: SV6's resampling of the paper book's own daily P&L as a fraction of K (LV6b).

Every number is [POST HOC] and descriptive: no alarm, no verdict, no threshold.
"""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np

from nq_terminal.analytics import bootstrap, expectation
from nq_terminal.analytics.series import SeriesNotCompoundable, SeriesUnusable, SessionSeries
from nq_terminal.models.analytics import Context
from nq_terminal.models.analytics_p1 import BootstrapView, ConeView
from nq_terminal.models.expectation import (
    ConePlacement,
    ExpectationCone,
    ExpectationRefusal,
    PaperExpectation,
    PathPlacement,
)
from nq_terminal.services import journals, tearsheet_extended, tearsheet_trades

LABEL = ("the paper book's and the rule's cumulative P&L as a fraction of K, placed pointwise on the SV6 cone of the "
         "hypothesis that owns the journal (backtest start) and on a cone resampled from the paper book's own "
         "sessions (live start); descriptive, no verdict")
BASIS = ("paper P&L is contracts held x the change of each contract's close, before costs (LV5); the backtest-start "
         "cone is the backtest net of the recorded cost per side; the live-start cone resamples the paper P&L "
         "itself, before costs")
BACKTEST_SOURCE = "{name} backtest series (Basis A) at {cost} per side, SV6"
LIVE_SOURCE = "the paper book's daily P&L (LV5, before costs) over K, from its first session with a value"
CACHE_SIZE = 4

HypothesisSeries = Callable[[str, int], SessionSeries]
RunCapital = Callable[[str], Any]


# ---------------------------------------------------------------- the backtest cone, cached by the series' bytes


class _ConeCache:
    """A small LRU of bootstrap views keyed by (hypothesis, cost, sha256 of the series): same series, same cone."""

    def __init__(self, size: int = CACHE_SIZE) -> None:
        self._size = size
        self._items: OrderedDict[tuple, BootstrapView] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: tuple, build: Callable[[], BootstrapView]) -> BootstrapView:
        with self._lock:
            if key in self._items:
                self._items.move_to_end(key)
                return self._items[key]
        found = build()
        with self._lock:
            self._items[key] = found
            self._items.move_to_end(key)
            while len(self._items) > self._size:
                self._items.popitem(last=False)
        return found

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


CONES = _ConeCache()


def _fingerprint(s: SessionSeries) -> str:
    digest = hashlib.sha256()
    digest.update(np.ascontiguousarray(s.r.to_numpy(dtype=float)).tobytes())
    digest.update(np.asarray(s.r.index.asi8 if hasattr(s.r.index, "asi8") else np.arange(len(s.r))).tobytes())
    digest.update(f"{s.basis}|{s.periods}|{s.on_capital}|{s.unit}|{s.kind}".encode())
    return digest.hexdigest()


def backtest_bootstrap(s: SessionSeries, name: str, cost: int) -> BootstrapView:
    """The hypothesis's SV5 and SV6 view, exactly as its bootstrap route serves it (cached per series)."""
    context = Context(kind="hypothesis", name=name, cost=cost, freq="D")
    return CONES.get((name, cost, _fingerprint(s)), lambda: tearsheet_extended.bootstrap_view(s, context))


# ---------------------------------------------------------------- assembly


def _refusal(found: Mapping[str, Any] | None) -> ExpectationRefusal | None:
    return None if found is None else ExpectationRefusal(code=found["code"], params=dict(found["params"]))


def _placement(found: Mapping[str, Any]) -> ConePlacement:
    return ConePlacement(horizon=found["horizon"], first_index=found["first_index"], anchor_date=found["anchor_date"],
                         paper=PathPlacement(**found["paper"]), model=PathPlacement(**found["model"]),
                         latest_step=found["latest_step"], latest_date=found["latest_date"], beyond=found["beyond"])


def _cost_words(cost: int) -> str:
    return f"{cost} tick" if cost == 1 else f"{cost} ticks"


def _iso(stamp: Any) -> str:
    return stamp.strftime("%Y-%m-%d") if hasattr(stamp, "strftime") else str(stamp)


def backtest_cone(tracking: Mapping[str, Any], capital: float, s: SessionSeries, name: str, cost: int
                  ) -> ExpectationCone:
    """LV6 on the backtest-start cone: the hypothesis's SV6 cone, or the words for why it takes no path."""
    common = {"start": "backtest", "source": BACKTEST_SOURCE.format(name=name, cost=_cost_words(cost)),
              "source_n": len(s.r), "source_start": _iso(s.r.index[0]) if len(s.r) else None,
              "source_end": _iso(s.r.index[-1]) if len(s.r) else None, "reps": bootstrap.REPS, "seed": bootstrap.SEED}
    try:
        boot = backtest_bootstrap(s, name, cost)
    except ValueError as exc:  # too few sessions or no spread: the bootstrap route answers 422
        return ExpectationCone(**common, refusal=_refusal({"code": "no_bootstrap", "params": {"detail": str(exc)}}),
                               cone=None, block=None, placement=None)
    cone = boot.cone
    refused = expectation.cone_refusal({"unit": cone.unit, "how": cone.how})
    placed = None if refused else _placement(expectation.placement(tracking, capital, cone.model_dump()))
    return ExpectationCone(**{**common, "reps": boot.reps, "seed": boot.seed}, refusal=_refusal(refused), cone=cone,
                           block=boot.block.stationary, placement=placed)


def live_cone(tracking: Mapping[str, Any], capital: float) -> ExpectationCone:
    """LV6b: the cone resampled from the paper book's own sessions since its start, with both paths placed on it."""
    found = expectation.live_start_cone(tracking.get("date") or [], tracking.get("paper") or [], capital)
    cone = None
    placed = None
    if found["quantiles"] is not None:
        cone = ConeView(label=found["label"], unit=found["unit"], how=found["how"], horizon=found["horizon"],
                        steps=found["steps"], percentiles=list(bootstrap.CONE_PERCENTILES),
                        quantiles=found["quantiles"], realised=found["realised"],
                        realised_dates=found["realised_dates"])
        placed = _placement(expectation.live_placement(tracking, capital, found))
    return ExpectationCone(start="live", refusal=_refusal(found["refusal"]), cone=cone, source=LIVE_SOURCE,
                           source_n=found["n"], source_start=found["start_date"], source_end=found["end_date"],
                           block=found["block"], reps=found["reps"], seed=found["seed"], placement=placed)


def _runs(summaries: Sequence[Any]) -> list[dict]:
    return [s.model_dump() if hasattr(s, "model_dump") else dict(s) for s in summaries]


def expectation_view(monitor: journals.LiveMonitor, file: str, *, card: Callable[[str], Any],
                     run_summaries: Callable[[], Sequence[Any]], run_capital: RunCapital,
                     hypothesis_series: HypothesisSeries) -> PaperExpectation:
    """LV6 and LV6b for one journal. Sources are passed in, so the order of reads is the browser's: nothing past the
    first refusal is read (no card for a journal no hypothesis owns, no run for a hypothesis without a cost)."""
    tracking = tearsheet_trades.paper_tracking_view(monitor, file).model_dump()
    hypothesis = expectation.paper_book_hypothesis(file)
    out: dict[str, Any] = {"journal": file, "tag": expectation.TAG, "label": LABEL, "basis": BASIS,
                           "hypothesis": hypothesis, "cost": None, "run_id": None, "capital": None,
                           "backtest": None, "live": None}
    refused = expectation.gate(tracking, hypothesis, None, None, None)
    if refused["code"] in ("empty", "no_book"):
        return PaperExpectation(**out, refusal=_refusal(refused))
    found = card(hypothesis)
    cost = expectation.default_cost(list(found.series_costs))
    run_id = expectation.capital_run(list(found.nautilus_runs), _runs(run_summaries())) if cost is not None else None
    capital = run_capital(run_id) if run_id is not None else None
    out.update(cost=cost, run_id=run_id, capital=expectation.as_finite(capital))
    refused = expectation.gate(tracking, hypothesis, cost, run_id, capital)
    if refused is not None:
        return PaperExpectation(**out, refusal=_refusal(refused))
    k = float(capital)
    out.update(backtest=backtest_cone(tracking, k, hypothesis_series(hypothesis, cost), hypothesis, cost),
               live=live_cone(tracking, k))
    return PaperExpectation(**out, refusal=None)


def run_capital(build: Callable[[str], SessionSeries]) -> RunCapital:
    """K of a run: its account series' capital, or None when the run is unusable (the analytics route's 422)."""
    def capital(run_id: str) -> Any:
        try:
            return build(run_id).capital
        except (SeriesUnusable, SeriesNotCompoundable):
            return None
    return capital
