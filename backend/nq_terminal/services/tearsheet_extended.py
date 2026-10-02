"""P1 tear sheet additions (TASKS Phase 10; ANALYTICS_CATALOG P1 rows). No formula lives here.

Turns a stage A `SessionSeries` into the P1 response models by calling the pure functions in `analytics/`
(perf PF7 to PF9, risk RK3, rolling RL3 and RL4, relative BR3 and BR4, distribution RD4, stress RK5, regimes RG1,
bootstrap SV5 and SV6, deflated SV3). The labelling rules of `services/tearsheet.py` apply: every number names its
basis and unit, everything is "[POST HOC]" and descriptive, a one-contract series (no capital K) is summed, never
compounded, and has no CAGR.

- RK5 takes its windows only from `constants.STRESS_WINDOWS` and `constants.STRESS_WINDOW_SPENT` (frozen before this
  module existed; `tests/test_p1_stress_freeze.py` checks that no window date appears here). The 2022 row exists
  only where the caller passes the sealed series (the volmanaged_v0 hypothesis: `results/sealed/` through the
  research service's allowlist), labelled spent.
- RG1 is a daily-series view; its variable (NQ's 22-session RTH realised variance) is passed in by the caller.
- SV3 is built from the trials the caller assembled (every registered hypothesis at 1 tick per side, SV3a).
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np
import pandas as pd

from nq_terminal import constants
from nq_terminal.analytics import bootstrap, deflated, distribution, regimes, relative, risk, rolling, stress
from nq_terminal.analytics._inputs import PERIODS_DAILY
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.models.analytics import Context, Kpi
from nq_terminal.models.analytics_p1 import (
    BlockLength,
    BootstrapInterval,
    BootstrapView,
    CaptureView,
    ConeView,
    CornishFisherLevel,
    CornishFisherVarView,
    DeflatedLeaveOneOut,
    DeflatedRow,
    DeflatedView,
    ExtendedAnalytics,
    JarqueBeraView,
    RegimeRow,
    RegimeView,
    RollingRelativeView,
    ScatterView,
    StressRow,
    StressView,
)
from nq_terminal.services.neff_view import effective_n_view
from nq_terminal.services.tearsheet import POST_HOC, Units, axis, num, nums, units

NO_BENCH = "no benchmark for this series, so no rolling beta, correlation, capture or scatter"
NO_CAPTURE = "capture ratios compound returns, so a one-contract P&L series (no capital K) has none"
REGIMES_MONTHLY = "volatility regimes are a daily view; a monthly book has none"
REGIMES_NO_RV = "the realised variance series (volmanaged_v0_daily.csv sigma2) could not be read"
JB_NOTE = "on the whole series, never on a slice the user picks"
CAPTURE_LABEL = "annualised geometric return over benchmark-up (down) sessions, strategy over benchmark"
CAPTURE_BASIS_A = "; compounded as Nautilus defines it, although Basis A elsewhere is summed"
CF_DOMAIN = ("Cornish-Fisher is a quantile only where its expansion rises in z: a = K/8 - S^2/6 > 0 and "
             "b^2 - 4ac <= 0 with b = S/3, c = 1 - K/8 + 5 S^2/36 (at S = 0: 0 <= K <= 8); outside it the value is "
             "not defined and the tile shows the historical VaR (RK1) beside it, the normal VaR greyed")
FROZEN_NOTE = ("windows frozen in constants.py before any stress display code: the five deepest NQ buy and hold "
               "drawdowns in sample, sessions after the peak up to the trough")
SPENT_NONE = "no spent row: the sealed daily file belongs to the volmanaged_v0 hypothesis view"
SPENT_MISSING = "no spent row: the sealed daily file {file} is not there, so only the in-sample windows are shown"
BOOT_METHOD = ("stationary bootstrap (Politis and Romano), Politis-White block length (arch's algorithm), percentile "
               "interval; resampled history, descriptive only")
CONSTRUCTION = "ANALYTICS_CATALOG section 7, SV3 construction (SV3a)"
STAT_LABELS = {"sharpe": "Sharpe", "cagr": "CAGR", "max_drawdown": "Max drawdown"}
NO_CAGR = "not defined: one-contract P&L has no capital K"
RV_SOURCE = "results/screens/volmanaged_v0_daily.csv sigma2 (nq_lab.sizing_rv, 22-session RTH realised variance)"


def _basis(s: SessionSeries) -> str:
    """The basis that aggregates: a one-contract series is summed whatever its label."""
    return s.basis if s.on_capital else "A"


def _info(s: SessionSeries, context: Context, u: Units) -> dict:
    return dict(context=context, basis=s.basis, unit=u.level, periods_per_year=s.periods, n=s.n, tag=POST_HOC)


def _kpi(s: SessionSeries, key: str, label: str, value: float, unit: str, note: str) -> Kpi:
    value = num(value)
    return Kpi(key=key, label=label, value=value, unit=unit, basis=s.basis, tag=POST_HOC,
               note=note if value is None else None)


def ratio_tiles(s: SessionSeries) -> list[Kpi]:
    """PF7 Omega(0), PF8 tail ratio, PF9 gain to pain on months."""
    from nq_terminal.analytics import perf  # lazy: the start path does not load perf (D1.1)

    return [_kpi(s, "omega", "Omega (0)", perf.omega(s.r), "ratio of summed gains to summed losses",
                 "not defined: no losing period"),
            _kpi(s, "tail_ratio", "Tail ratio", perf.tail_ratio(s.r), "ratio, abs(Q95 / Q5)",
                 "not defined: the 5th percentile is 0"),
            _kpi(s, "gain_to_pain", "Gain to pain (monthly)", perf.gain_to_pain(s.r, _basis(s), s.periods),
                 "ratio, sum of months over the sum of losing months", "not defined: no losing month")]


def cornish_fisher_view(s: SessionSeries, u: Units) -> CornishFisherVarView:
    table = risk.modified_var_table(s.r)
    first = table["95"]
    levels = [CornishFisherLevel(level=level, tail=row["tail"], z=row["z"], normal=num(row["normal"]),
                               historical=num(row["historical"]), raw_expansion=num(row["raw_expansion"]),
                               cornish_fisher=num(row["cornish_fisher"]),
                               value=num(row["value"]), in_domain=row["in_domain"], method=row["method"])
              for level, row in table.items()]
    horizon = "1 session" if s.periods == PERIODS_DAILY else "1 month"
    return CornishFisherVarView(basis=s.basis, unit=u.level, horizon=horizon, mean=num(first["mean"]),
                           sigma=num(first["sigma"]), skew=num(first["skew"]),
                           excess_kurtosis=num(first["excess_kurtosis"]), domain=CF_DOMAIN, levels=levels)


def jarque_bera_view(s: SessionSeries) -> JarqueBeraView:
    found = distribution.jarque_bera(s.r)
    return JarqueBeraView(statistic=num(found["statistic"]), p=num(found["p"]), n=found["n"], note=JB_NOTE)


def rolling_relative_view(s: SessionSeries) -> RollingRelativeView:
    window = rolling.relative_window(s.periods)
    t, dates = axis(s.r.index)
    fit = relative.alpha_beta(s.r, s.bench, periods=s.periods)
    mine, theirs, _ = relative.align_pair(s.r, s.bench)
    corr = float(np.corrcoef(mine, theirs)[0, 1]) if len(mine) > 2 else math.nan
    return RollingRelativeView(window=window, window_unit=rolling.WINDOW_UNIT[s.periods], t=t, date=dates,
                               beta=nums(rolling.rolling_beta(s.r, s.bench, window)),
                               correlation=nums(rolling.rolling_correlation(s.r, s.bench, window)),
                               full_beta=num(fit["b"]), full_correlation=num(corr))


def capture_view(s: SessionSeries) -> CaptureView:
    _, theirs, _ = relative.align_pair(s.r, s.bench)
    label = CAPTURE_LABEL + (CAPTURE_BASIS_A if s.basis == "A" else "")
    return CaptureView(label=label, up=num(relative.up_capture(s.r, s.bench, s.periods)),
                       down=num(relative.down_capture(s.r, s.bench, s.periods)), up_n=int((theirs > 0).sum()),
                       down_n=int((theirs < 0).sum()))


def scatter_view(s: SessionSeries, u: Units) -> ScatterView:
    found = relative.scatter(s.r, s.bench, s.periods)
    dates = [pd.Timestamp(d).strftime("%Y-%m-%d") for d in found["index"]]
    return ScatterView(unit=u.level, x_label=s.bench_label or "benchmark", y_label=s.label, date=dates,
                       x=[float(v) for v in found["x"]], y=[float(v) for v in found["y"]], slope=num(found["slope"]),
                       intercept=num(found["intercept"]), n=found["n"])


def _stress_row(row: dict, spent: bool) -> StressRow:
    return StressRow(label=row["label"], peak=row["peak"], trough=row["trough"], recovery=row["recovery"],
                     nq_depth=num(row["nq_depth"]), source=row["source"], spent=spent, n=row["n"],
                     covered_from=row["covered_from"], covered_to=row["covered_to"],
                     strategy_return=num(row["strategy_return"]), bench_return=num(row["bench_return"]),
                     bench_n=row["bench_n"], strategy_max_drawdown=num(row["strategy_max_drawdown"]))


def stress_view(s: SessionSeries, u: Units, spent: tuple[pd.Series, pd.Series | None] | None,
                spent_note: str | None = None) -> StressView:
    """RK5 over the frozen windows; the spent 2022 row only from the sealed series the caller passes.

    `spent_note` says why there is no spent row when the caller knows better than the default (a missing file)."""
    basis = _basis(s)
    windows = stress.window_rows(s.r, s.bench, basis, constants.STRESS_WINDOWS, periods=s.periods)
    rows = [_stress_row(row, False) for row in windows]
    if spent is not None:
        r, bench = spent
        found = stress.window_rows(r, bench, basis, (constants.STRESS_WINDOW_SPENT,))[0]
        rows.append(_stress_row(found, True))
    monthly = stress.MONTHLY_NOTE if s.periods == stress.PERIODS_MONTHLY else None
    return StressView(tag=POST_HOC, basis=s.basis, unit=u.level, frozen=FROZEN_NOTE, monthly_note=monthly, rows=rows,
                      spent_note=None if spent is not None else (spent_note or SPENT_NONE))


def regime_view(s: SessionSeries, rv: pd.Series) -> RegimeView:
    found = regimes.regime_stats(s.r, rv, s.periods)
    frame = found["frame"]
    t, dates = axis(s.r.index)
    rows = [RegimeRow(regime=row["regime"], n=row["n"], mean=num(row["mean"]), sharpe=num(row["sharpe"]),
                      hit_rate=num(row["hit_rate"])) for row in found["rows"]]
    labels = [None if pd.isna(v) else str(v) for v in frame["regime"].to_numpy()]
    return RegimeView(tag=POST_HOC, label=found["label"], source=RV_SOURCE, min_history=found["min_history"],
                      rows=rows, welch_t=num(found["welch_t"]), welch_df=num(found["welch_df"]),
                      unlabelled=found["unlabelled"], t=t, date=dates, regime=labels)



def _regimes(s: SessionSeries, rv: pd.Series | None) -> tuple[RegimeView | None, str | None]:
    if s.periods != PERIODS_DAILY:
        return None, REGIMES_MONTHLY
    if rv is None:
        return None, REGIMES_NO_RV
    return regime_view(s, rv), None


def extended(s: SessionSeries, context: Context, *, rv: pd.Series | None = None,
             spent: tuple[pd.Series, pd.Series | None] | None = None,
             spent_note: str | None = None) -> ExtendedAnalytics:
    """Every P1 series view of one tear sheet."""
    u = units(s)
    has_bench = s.bench is not None and s.bench.notna().sum() > 2
    capture = capture_view(s) if has_bench and s.on_capital else None
    relative_note = NO_BENCH if not has_bench else (None if s.on_capital else NO_CAPTURE)
    view, note = _regimes(s, rv)
    return ExtendedAnalytics(
        **_info(s, context, u), ratios=ratio_tiles(s), cornish_fisher_var=cornish_fisher_view(s, u),
        jarque_bera=jarque_bera_view(s), rolling_relative=rolling_relative_view(s) if has_bench else None,
        capture=capture, scatter=scatter_view(s, u) if has_bench else None,
        relative_note=relative_note, stress=stress_view(s, u, spent, spent_note), regimes=view,
        regimes_note=note)


# ---------------------------------------------------------------- SV5 and SV6


def _stat_unit(name: str, u: Units) -> str:
    return {"sharpe": u.ratio, "cagr": "fraction per year, compounded", "max_drawdown": u.drawdown}[name]


def _interval(name: str, found: dict | None, s: SessionSeries, u: Units) -> BootstrapInterval:
    empty = {"point": None, "lo": None, "hi": None, "median": None, "mean": None, "sd": None, "undefined": 0,
             "ruin": 0}
    data = found if found is not None else empty
    notes = [f"{data['undefined']} replications without a defined value were left out"] if data["undefined"] else []
    if data["ruin"]:
        notes.append(f"{data['ruin']} replications touch zero on the way (the book at or below zero at some "
                     "point); each counts as a CAGR of -100% (the total loss) and stays in the interval")
    note = NO_CAGR if found is None else ("; ".join(notes) or None)
    return BootstrapInterval(statistic=name, label=STAT_LABELS[name], unit=_stat_unit(name, u),
                             point=num(data["point"]), lo=num(data["lo"]), hi=num(data["hi"]),
                             median=num(data["median"]), mean=num(data["mean"]), sd=num(data["sd"]),
                             undefined=int(data["undefined"]), ruin=int(data["ruin"]), note=note)


def bootstrap_view(s: SessionSeries, context: Context) -> BootstrapView:
    """SV5 and SV6 with the fixed seed and 10,000 replications."""
    u = units(s)
    found = bootstrap.bootstrap_summary(s.r, _basis(s), s.periods, on_capital=s.on_capital)
    cone = found["cone"]
    block = found["block"]
    unit = u.level if cone["how"] == "summed" else "cumulative return from the start of the path, compounded"
    return BootstrapView(
        **_info(s, context, u), method=BOOT_METHOD,
        block=BlockLength(stationary=num(block["stationary"]), circular=num(block["circular"]), m=block["m"]),
        reps=found["reps"], seed=found["seed"], confidence=found["confidence"],
        intervals=[_interval(name, found["stats"][name], s, u) for name in bootstrap.STATISTICS],
        cone=ConeView(label=cone["label"], unit=unit, how=cone["how"], horizon=cone["horizon"], steps=cone["steps"],
                      percentiles=list(bootstrap.CONE_PERCENTILES),
                      quantiles={k: nums(v) for k, v in cone["quantiles"].items()}, realised=nums(cone["realised"]),
                      realised_dates=cone["realised_dates"]))


# ---------------------------------------------------------------- SV3


def _dominant(rows: Sequence[dict]) -> str | None:
    values = np.array([row["sr_session"] for row in rows], dtype=float)
    if len(values) < 3:
        return None
    far = int(np.argmax(np.abs(values - values.mean())))
    row = rows[far]
    return (f"{row['name']}: annualised Sharpe {row['annual_sharpe']:.2f}, the farthest from the mean, so it "
            "dominates V")


def deflated_view(trials: Sequence[deflated.Trial]) -> DeflatedView:
    found = deflated.registry_dsr(trials)
    rows = [DeflatedRow(name=row["name"], kind=row["kind"], periods=row["periods"], n=row["n"], sr=num(row["sr"]),
                        sr_session=num(row["sr_session"]), annual_sharpe=num(row["annual_sharpe"]),
                        skew=num(row["skew"]), kurt=num(row["kurt"]), sr0_own_period=num(row["sr0_own_period"]),
                        dsr=num(row["dsr"]), sr0_null_own_period=num(row["sr0_null_own_period"]),
                        dsr_null=num(row["dsr_null"])) for row in found["rows"]]
    loo = found["leave_one_out"]
    return DeflatedView(tag=POST_HOC, label=found["label"], construction=CONSTRUCTION, basis="A", cost=found["cost"],
                        monthly_note=found["monthly_note"], n_trials=found["n_trials"],
                        variance=num(found["variance"]), sr0_session=num(found["sr0_session"]),
                        sr0_annual=num(found["sr0_annual"]), variance_null=num(found["variance_null"]),
                        sr0_null_session=num(found["sr0_null_session"]),
                        sr0_null_annual=num(found["sr0_null_annual"]),
                        leave_one_out=DeflatedLeaveOneOut(name=loo["name"], variance=num(loo["variance"]),
                                                          sr0_session=num(loo["sr0_session"]),
                                                          sr0_annual=num(loo["sr0_annual"]),
                                                          n_trials=loo["n_trials"]),
                        n_note=found["n_note"], euler_gamma=found["euler_gamma"],
                        dominant=_dominant(found["rows"]), rows=rows,
                        effective_n=effective_n_view(trials, found))
