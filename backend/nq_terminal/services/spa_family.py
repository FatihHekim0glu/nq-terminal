"""SV8 family and view (ANALYTICS_CATALOG SV8 and its construction; TASKS Phase 12). Read only; descriptive.

Construction (written in the catalogue before the route served real data):
1. *Family.* Every row of `results/registry.csv` with `registered` True whose series source (`constants.SERIES_SOURCES`)
   is on one NQ contract in USD (`series.ONE_NQ` in its unit) and daily (P = 252). Every other registered row is
   listed as excluded with its reason (a row with no series source yet is named too, never silently dropped, and
   never takes the view down): a monthly book has no daily series; a series in another unit (return on
   capital, basis points per night, a portfolio in sd units) has a differential against one NQ contract in another
   unit, and arch's statistic (the maximum mean differential, not studentised) needs one unit across the family.
   Unregistered checks and sealed confirmations are not hypotheses of the family.
2. *Series.* Each member's Basis A series at 1 tick per side exactly as the tear sheet builds it
   (`series.hypothesis_series`): USD per session on one NQ contract, zero on sessions without a trade, za_v0's
   gate-rejected sessions dropped. One member that cannot be built refuses the whole view.
3. *Common index.* The sessions every member has (the intersection), less the sessions where the benchmark has no
   close-to-close change (counted as `bench_missing`; cash has none). Each member's own sessions outside it are
   counted, and so are those that carried P&L.
4. *Benchmarks, two rows (amended 2026-10-01 before any real family was served).* The primary row is cash, `r_0 = 0`,
   so `d_i = r_i`: the null is that no member has a positive mean, the null the registrations, MT power and the
   deflated Sharpe use, and its correlation of the differentials is MT 87's correlation of the returns. The second row
   is NQ buy and hold on one contract, close to close in USD, no costs (`series.nq_buy_and_hold`, the 1d vendor series
   through the gate, caller "terminal"): a different, much harder null, because one contract held earned about +$96 a
   session, so a member that is out of the market most sessions has a negative mean differential whatever its quality.
   It is nested in the primary view as `buy_and_hold`.
5. *Test.* `analytics.spa.family_test` for each row: losses `-r_i` against `-r_0` (zero for cash, `-r_bh` for buy and
   hold), the stationary bootstrap at the mean Politis-White block length, seed 20260927, 10,000 replications,
   StepM at size 0.05.
The result is cached in memory by a sha256 of the aligned inputs and the settings, so a repeat request costs the
series builds only.
"""
from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, NamedTuple

import numpy as np
import pandas as pd

from nq_lab.config import IS_END
from nq_terminal.analytics import series, spa
from nq_terminal.constants import SERIES_SOURCES
from nq_terminal.models.spa import SpaCritical, SpaExcluded, SpaMember, SpaPValues, SpaView
from nq_terminal.services.research import ResearchDataError, UnknownNameError
from nq_terminal.services.tearsheet import POST_HOC, num

if TYPE_CHECKING:
    from nq_terminal.services.bars import BarService
    from nq_terminal.services.research import ResearchService

COST = 1  # ticks per side: the one cost every screen records
UNIT = "USD per session, one NQ contract"
CONSTRUCTION = "ANALYTICS_CATALOG section 7, SV8 construction"
LABEL = ("Family test over the pre-registered NQ hypotheses against NQ buy and hold: an extra view only; it never "
         "overrides a frozen pass bar and gives no verdict on any single hypothesis")
LABEL_CASH = ("Family test over the pre-registered NQ hypotheses against cash, the null that no member has a positive "
              "mean: an extra view only; it never overrides a frozen pass bar and gives no verdict on any single "
              "hypothesis")
FAMILY_NOTE = ("The family is fixed by a rule on the registry (every registered hypothesis on one NQ contract with a "
               "daily series), not picked on screen, so its p-values are family-wise over pre-registered hypotheses")
LOSS = "loss L_i = -r_i against the benchmark's L_bh = -r_bh; differential d_i = L_bh - L_i = r_i - r_bh"
LOSS_CASH = "loss L_i = -r_i against cash's L_0 = 0; differential d_i = L_0 - L_i = r_i, the member's own return"
BENCHMARK_CASH = "Cash: zero return every session (r_0 = 0), no costs; no price is read for it"
STATISTIC = ("max over the members of mean(d_i), as arch 8.0.0 computes it: not studentised (White's form, not "
             "Hansen's studentised statistic), so it favours members with a large spread and a strong quiet member "
             "can be hidden by a noisy one; the kernel variances set only the consistent recentring")
BLOCK_RULE = ("mean of the members' Politis-White stationary block lengths of d_i (Patton, Politis and White "
              "correction, arch's variant); the draws and the variance kernel use it")
NOTE = ("Reading: a small consistent p-value says at least one member beat holding NQ on one contract after costs; "
        "StepM names which, with the family-wise error held at the size. A large p-value says the family shows no "
        "hypothesis beating buy and hold. Arithmetic mean USD per session; in-sample only, to 2021-12-31")
NOTE_CASH = ("Reading: a small consistent p-value says at least one member has a positive mean per session after costs, "
             "the null the registrations, MT power and the deflated Sharpe ratio use; StepM names which, with the "
             "family-wise error held at the size. A large p-value says the family shows no hypothesis with a positive "
             "mean. Arithmetic mean USD per session; in-sample only, to 2021-12-31. It does not compare with holding "
             "NQ: the buy and hold row does")
CORRELATION_NOTE_CASH = ("Correlation of the members' returns on the common index (against cash the differential is the "
                         "return, so this is the series the bootstrap resamples and the matrix of MT 87); a member "
                         "that does not vary has none")
CORRELATION_NOTE = ("Correlation of the members' loss differentials d_i = r_i - r_bh on the common index (the series the "
                    "bootstrap resamples): the dependence the maximum statistic runs over. Every d_i holds -r_bh, so "
                    "for a low-exposure member (a sparse calendar book) the correlation is pulled towards 1; it is "
                    "not the number of independent hypotheses, so read it beside the returns' correlation of MT 87; "
                    "a member that does not vary has none")
MONTHLY_REASON = "a monthly book: its result files hold no daily series, so it has no session on the common index"
UNIT_REASON = ("its series is in {unit}, not USD per session on one NQ contract, so its differential against one NQ "
               "contract has another unit (the statistic compares raw mean differentials, one unit across the family)")
NO_SOURCE_REASON = ("no series source yet: the terminal has not learned this registration (add its SeriesSource to "
                    "SERIES_SOURCES in nq_terminal/constants.py), so it is not a member until it has one")
CASH = "cash"
NQ_BUY_AND_HOLD = "nq_buy_and_hold"
BENCHMARKS = (CASH, NQ_BUY_AND_HOLD)
CACHE_SIZE = 8
FENCE = IS_END.tz_convert(None)  # 2022-01-01 as a tz-naive session date


class FamilyError(ValueError):
    """The family cannot be built: a member failed, no member is left, or no price source is configured."""


@dataclass(frozen=True)
class MemberInfo:
    name: str
    sessions: int
    left_out: int
    left_out_with_pnl: int


@dataclass(frozen=True)
class FamilyInputs:
    names: tuple[str, ...]
    index: pd.DatetimeIndex
    bench: pd.Series
    models: pd.DataFrame
    bench_missing: int
    info: tuple[MemberInfo, ...]
    excluded: tuple[tuple[str, str], ...]
    benchmark: str = NQ_BUY_AND_HOLD


class _Members(NamedTuple):
    names: list[str]
    excluded: list[tuple[str, str]]
    own: list[pd.Series]
    shared: pd.DatetimeIndex


def exclusion_reason(name: str) -> str | None:
    """None for a family member (step 1), else why the registered row is not one."""
    source = SERIES_SOURCES.get(name)
    if source is None:  # a new registration is named, not fatal: the lab registers rows the terminal learns later
        return NO_SOURCE_REASON
    if series.PERIODS_BY_KIND.get(source.kind) != series.PERIODS_DAILY:
        return MONTHLY_REASON
    if series.ONE_NQ not in source.unit:
        return UNIT_REASON.format(unit=source.unit.replace("per trade", "per session"))
    return None


def _split(research: ResearchService) -> tuple[list[str], list[tuple[str, str]]]:
    members, excluded = [], []
    for row in research.registry_rows():
        if not row.registered:
            continue
        reason = exclusion_reason(row.name)
        if reason is None:
            members.append(row.name)
        else:
            excluded.append((row.name, reason))
    if not members:
        raise FamilyError("no registered hypothesis has a daily series on one NQ contract")
    return members, excluded


def _build(research: ResearchService, names: Sequence[str]) -> list[pd.Series]:
    built = []
    for name in names:
        try:
            s = series.hypothesis_series(research, name, COST)
        except (series.SeriesError, ResearchDataError, UnknownNameError, ValueError) as exc:
            raise FamilyError(f"the family test needs every member; {name} could not be built: {exc}") from exc
        if s.unit != UNIT or s.periods != series.PERIODS_DAILY:
            raise FamilyError(f"{name}: built in {s.unit} at P = {s.periods}, not {UNIT} daily")
        built.append(s.r)
    return built


def _shared(own: Sequence[pd.Series]) -> pd.DatetimeIndex:
    index = own[0].index
    for r in own[1:]:
        index = index.intersection(r.index)
    if not len(index):
        raise FamilyError("the members share no session")
    return pd.DatetimeIndex(index, name="session")


def _members(research: ResearchService) -> _Members:
    """Steps 1 to 3's members: the family rule, each member's series and the sessions they share."""
    names, excluded = _split(research)
    own = _build(research, names)
    return _Members(names, excluded, own, _shared(own))


def _benchmark(members: _Members, bars: BarService, version: tuple[int, int] | None, benchmark: str) -> pd.Series:
    if benchmark == CASH:
        return pd.Series(0.0, index=members.shared)
    if benchmark == NQ_BUY_AND_HOLD:
        return series.nq_buy_and_hold(bars, members.shared, usd=True, version=version)
    raise ValueError(f"unknown benchmark {benchmark!r}; expected one of {BENCHMARKS}")


def _aligned(members: _Members, bench_all: pd.Series, benchmark: str) -> FamilyInputs:
    keep = bench_all.notna().to_numpy()
    index = members.shared[keep]
    if len(index) and index[-1] >= FENCE:
        raise FamilyError("a session at or after the fence reached the family")
    info = tuple(MemberInfo(name=n, sessions=len(r), left_out=int(len(r) - len(index)),
                            left_out_with_pnl=int((r.drop(index) != 0).sum()))
                 for n, r in zip(members.names, members.own))
    models = pd.DataFrame({n: r.reindex(index).to_numpy() for n, r in zip(members.names, members.own)}, index=index)
    return FamilyInputs(names=tuple(members.names), index=index, bench=bench_all[keep], models=models,
                        bench_missing=int((~keep).sum()), info=info, excluded=tuple(members.excluded),
                        benchmark=benchmark)


def _need_prices(bars: BarService | None) -> BarService:
    if bars is None:
        raise FamilyError("the family test needs NQ prices through the gate for its buy and hold row, and no price "
                          "source is configured")
    return bars


def family_inputs(research: ResearchService, bars: BarService | None, version: tuple[int, int] | None,
                  benchmark: str = NQ_BUY_AND_HOLD) -> FamilyInputs:
    """Steps 1 to 4: the members' returns and one benchmark on the common index, with the counts."""
    need = _need_prices(bars)
    members = _members(research)
    return _aligned(members, _benchmark(members, need, version, benchmark), benchmark)


# ---------------------------------------------------------------- the test, cached


_CACHE: OrderedDict[str, dict] = OrderedDict()
_LOCK = threading.Lock()


def _key(fam: FamilyInputs, reps: int, seed: int, size: float) -> str:
    h = hashlib.sha256()
    h.update(repr((fam.names, reps, seed, size)).encode("utf-8"))
    h.update(fam.index.asi8.tobytes())
    h.update(np.ascontiguousarray(fam.bench.to_numpy(dtype=float)).tobytes())
    h.update(np.ascontiguousarray(fam.models.to_numpy(dtype=float)).tobytes())
    return h.hexdigest()


def run_test(fam: FamilyInputs, *, reps: int = spa.REPS, seed: int = spa.SEED, size: float = spa.SIZE) -> dict:
    """Step 5, from the cache when the aligned inputs and settings are unchanged."""
    key = _key(fam, reps, seed, size)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    found = spa.family_test(fam.bench.to_numpy(dtype=float), fam.models.to_numpy(dtype=float), reps=reps, seed=seed,
                            size=size)
    with _LOCK:
        _CACHE[key] = found
        while len(_CACHE) > CACHE_SIZE:
            _CACHE.popitem(last=False)
    return found


# ---------------------------------------------------------------- the view


def _steps(found: dict) -> dict[int, int]:
    return {i: step for step, rejected in enumerate(found["stepm"]["per_step"], start=1) for i in rejected}


def _member(i: int, info: MemberInfo, fam: FamilyInputs, found: dict, steps: dict[int, int]) -> SpaMember:
    return SpaMember(name=info.name, sessions=info.sessions, left_out=info.left_out,
                     left_out_with_pnl=info.left_out_with_pnl,
                     mean_return=num(float(fam.models.iloc[:, i].mean())),
                     mean_differential=num(found["mean_differential"][i]),
                     long_run_variance=num(found["variance"][i]), block=num(found["block_per_column"][i]),
                     in_consistent_set=found["consistent_set"][i], rejected=i in steps, step=steps.get(i))


_TEXT = {
    CASH: {"label": LABEL_CASH, "benchmark": BENCHMARK_CASH, "loss": LOSS_CASH, "note": NOTE_CASH,
           "correlation_note": CORRELATION_NOTE_CASH},
    NQ_BUY_AND_HOLD: {"label": LABEL, "benchmark": series.NQ_BH_USD_LABEL, "loss": LOSS, "note": NOTE,
                      "correlation_note": CORRELATION_NOTE},
}


def _row(fam: FamilyInputs, buy_and_hold: SpaView | None) -> SpaView:
    """One benchmark's view (steps 4 and 5): the primary row nests the buy and hold row, which nests none."""
    found = run_test(fam)
    steps = _steps(found)
    crit = found["critical_values"]
    text = _TEXT[fam.benchmark]
    return SpaView(tag=POST_HOC, label=text["label"], family_note=FAMILY_NOTE, construction=CONSTRUCTION, basis="A",
                   cost=COST, unit=UNIT, benchmark_id=fam.benchmark, benchmark=text["benchmark"], loss=text["loss"],
                   statistic=STATISTIC,
                   n_sessions=len(fam.index), first=fam.index[0].strftime("%Y-%m-%d"),
                   last=fam.index[-1].strftime("%Y-%m-%d"), bench_missing=fam.bench_missing, block=found["block"],
                   block_rule=BLOCK_RULE, reps=found["reps"], seed=found["seed"], size=found["size"],
                   pvalues=SpaPValues(**found["pvalues"]), reality_check=found["reality_check"],
                   critical_values=SpaCritical(**{k: num(v) for k, v in crit.items()}),
                   stepm_steps=found["stepm"]["steps"],
                   superior=[fam.names[i] for i in found["stepm"]["superior"]],
                   members=[_member(i, info, fam, found, steps) for i, info in enumerate(fam.info)],
                   correlation=[[num(v) for v in row] for row in found["correlation"]],
                   correlation_note=text["correlation_note"],
                   excluded=[SpaExcluded(name=n, reason=r) for n, r in fam.excluded], note=text["note"],
                   buy_and_hold=buy_and_hold)


def family_view(research: ResearchService, bars: BarService | None, version: tuple[int, int] | None) -> SpaView:
    """SV8 over the family (steps 1 to 5): the cash row, with the NQ buy and hold row nested as `buy_and_hold`."""
    need = _need_prices(bars)
    members = _members(research)
    held = _aligned(members, _benchmark(members, need, version, NQ_BUY_AND_HOLD), NQ_BUY_AND_HOLD)
    cash = _aligned(members, _benchmark(members, need, version, CASH), CASH)
    return _row(cash, _row(held, None))
