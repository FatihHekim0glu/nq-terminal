"""Tear sheet builder (TASKS 3.3; ARCHITECTURE s4 Analytics; UI_SPEC s7 tear sheet and HOME [B]).

Turns a stage A `SessionSeries` into the response models by calling the part A functions (perf, drawdown, rolling,
distribution, risk, relative, validity) on it; no formula is written here. What this module adds:
- labels: every number names its basis (C1) and unit, and carries "[POST HOC]" when computed or "[PRE-REG]" when
  read from a registered result (C7);
- the no-capital rule: a one-contract series (`on_capital` False: USD or basis points, no K) gets no total return,
  CAGR, Calmar or annual alpha, and its equity is the cumulative P&L (the Basis A running sum);
- benchmarks keep their own gaps: benchmark curves are built on the sessions where the benchmark has a value and
  shown as null elsewhere; BR1 and BR2 align the pair first (`relative.align_pair`);
- Newey-West lags: 5 and 21 for daily series (BR1); 4 for monthly books, as the tsmom_v0 and dtsmom_v0 screens
  (`nq_lab.dtsmom_stats.LAGS`);
- `to_months`: a run's sessions compounded into months (Basis B, P = 12) for the `freq=M` view;
- RK2 (21-session sums) is a daily measure: a monthly series gets none;
- rolling windows follow P (item (e)): 63 and 252 sessions, or 12 and 36 months; HOME [B] shows the long one;
- a one-contract series has no alpha in % per year anywhere (its intercept `a` stays, in the series' own unit).
Everything computed here is descriptive and never a pass or fail.
"""
from __future__ import annotations

import dataclasses
import math
from typing import Any, Sequence

import numpy as np
import pandas as pd

from nq_lab.dtsmom_stats import LAGS as MONTHLY_NW_LAG
from nq_terminal.analytics import distribution, drawdown, perf, relative, risk, rolling, validity
from nq_terminal.analytics._inputs import PERIODS_DAILY, PERIODS_MONTHLY
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.models.analytics import (
    AlphaFit,
    Analytics,
    Context,
    DistributionView,
    DrawdownRow,
    DrawdownView,
    EquityView,
    HistogramView,
    HomePanel,
    Kpi,
    MinTrlView,
    Moments,
    MonthlyView,
    PeriodSeries,
    PsrView,
    QqView,
    RegistryEntry,
    RelativeView,
    RiskView,
    RollingSharpeBand,
    RollingView,
    SharpeInterval,
    StatsTable,
    StoredAlpha,
    Tails,
    TrackRecord,
    ValidityView,
    VolExtremes,
    YearValue,
)
from nq_terminal.models.research import RegistryRow
from nq_terminal.services.stored_alpha import clean_json

POST_HOC, PRE_REG = "[POST HOC]", "[PRE-REG]"
BASIS_LABEL = {"A": "screen (arithmetic on a fixed K)", "B": "account (compounded from K)"}
DAILY_LAGS = relative.NW_LAGS
MONTHLY_LAGS = (MONTHLY_NW_LAG,)
MT_TOLERANCE = 1e-12
NO_CAPITAL = "not defined: one-contract P&L has no capital K"
NO_BENCH = "no benchmark for this series"
QQ_LABEL = "ordered returns against normal quantiles (scipy.stats.probplot)"
AGGREGATION = {"A": "sum of the session returns in the month", "B": "compounded within the month, prod(1 + r) - 1"}
MIN_TRL_NOTES = {"below_threshold": "not reachable: the Sharpe is at or below 0",
                 "undefined": "not defined: too few sessions, no spread, or a variance term that is not positive"}
PSR_BENCH_NOTE = ("the benchmark Sharpe is treated as a fixed threshold, so this is not a test of the Sharpe "
                  "difference; the Sharpe-difference tests are SV7")


# ---------------------------------------------------------------- small helpers


def num(value: Any) -> float | None:
    if value is None:
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def nums(values: Any) -> list[float | None]:
    return [num(v) for v in np.asarray(values, dtype=float)]


def axis(index: pd.DatetimeIndex) -> tuple[list[int], list[str]]:
    """Epoch seconds at 00:00 UTC of each session date, and the dates."""
    return [int(d.timestamp()) for d in index], [d.strftime("%Y-%m-%d") for d in index]


def _iso(stamp: Any) -> str | None:
    return None if stamp is None else pd.Timestamp(stamp).strftime("%Y-%m-%d")


@dataclasses.dataclass(frozen=True)
class Units:
    level: str
    equity: str
    drawdown: str
    vol: str
    ratio: str
    per: str


def units(s: SessionSeries) -> Units:
    ratio = f"ratio, annualised (P = {s.periods})"
    per = "sessions" if s.periods == PERIODS_DAILY else "months"
    if not s.on_capital:
        return Units(s.unit, f"cumulative sum of {s.unit}", f"below the running peak of the cumulative sum, {s.unit}",
                     f"sd of {s.unit} times sqrt({s.periods})", ratio, per)
    if s.basis == "A":
        return Units("fraction of K", "multiple of K (K = 1), arithmetic", "fraction of K below the running peak",
                     "fraction of K per year", ratio, per)
    return Units("fraction of the account", "USD, compounded from the starting balance K",
                 "fraction below the running peak, compounded", "fraction of the account per year", ratio, per)


# ---------------------------------------------------------------- series transforms


def to_months(s: SessionSeries) -> SessionSeries:
    """Sessions compounded (B) or summed (A) into months, dated by each month's last session; P = 12.

    A benchmark month is null when any of its sessions has no benchmark value.
    """
    idx = s.r.index
    keys = [idx.year, idx.month]
    months = distribution.monthly_returns(s.r, s.basis)
    index = pd.DatetimeIndex(pd.Series(idx, index=idx).groupby(keys).max().to_numpy(), name="session")
    bench = None
    if s.bench is not None:
        filled = distribution.monthly_returns(s.bench.fillna(0.0), s.basis).to_numpy()
        gaps = s.bench.isna().groupby(keys).any().to_numpy()
        bench = pd.Series(np.where(gaps, np.nan, filled), index=index, dtype=float)
    return dataclasses.replace(s, periods=PERIODS_MONTHLY, r=pd.Series(months.to_numpy(), index=index, dtype=float),
                               bench=bench, unit=s.unit.replace("per session", "per month"),
                               label=f"{s.label}, sessions aggregated into months")


def equity(r: pd.Series, s: SessionSeries) -> pd.Series:
    """PF1 on the series' basis; the cumulative P&L for a one-contract series."""
    if not s.on_capital:
        return pd.Series(np.cumsum(r.to_numpy()), index=r.index, dtype=float)
    return perf.equity_curve(r, s.basis, s.capital if s.basis == "B" else 1.0)


def _bench_curve(s: SessionSeries, curve) -> list[float | None] | None:
    if s.bench is None:
        return None
    present = s.bench.dropna()
    if present.empty:
        return [None] * s.n
    return nums(curve(present).reindex(s.r.index))


def _lags(s: SessionSeries) -> tuple[int, ...]:
    return DAILY_LAGS if s.periods == PERIODS_DAILY else MONTHLY_LAGS


# ---------------------------------------------------------------- sections


def info(s: SessionSeries, context: Context) -> dict[str, Any]:
    return dict(context=context, basis=s.basis, basis_label=BASIS_LABEL[s.basis], unit=s.unit,
                on_capital=s.on_capital, capital=num(s.capital), periods_per_year=s.periods, n=s.n, kind=s.kind,
                source=s.source, label=s.label, tag=POST_HOC, first=_iso(s.r.index[0]), last=_iso(s.r.index[-1]),
                dropped=list(s.dropped), bench_label=s.bench_label)


def perf_diff_unit(s: SessionSeries) -> str:
    """The unit of EQ's performance difference (`perf.performance_difference`)."""
    if not s.on_capital:
        return f"cumulative {s.unit}, strategy minus benchmark"
    how = "summed" if s.basis == "A" else "compounded"
    return f"fraction of K, strategy minus benchmark cumulative return ({how})"


def equity_view(s: SessionSeries, u: Units) -> EquityView:
    t, dates = axis(s.r.index)
    diff = perf.performance_difference(s.r, s.bench, "A" if not s.on_capital else s.basis) if s.bench is not None \
        else None
    return EquityView(unit=u.equity, t=t, date=dates, equity=nums(equity(s.r, s)),
                      bench=_bench_curve(s, lambda b: equity(b, s)), perf_diff=None if diff is None else nums(diff),
                      perf_diff_unit=None if diff is None else perf_diff_unit(s))


def drawdown_view(s: SessionSeries, u: Units) -> DrawdownView:
    t, dates = axis(s.r.index)
    present = s.bench.dropna() if s.bench is not None else None
    bench_max = drawdown.max_drawdown(present, s.basis) if present is not None and len(present) else None
    return DrawdownView(unit=u.drawdown, t=t, date=dates, dd=nums(drawdown.underwater(s.r, s.basis)),
                        bench_dd=_bench_curve(s, lambda b: drawdown.underwater(b, s.basis)),
                        max_drawdown=num(drawdown.max_drawdown(s.r, s.basis)), bench_max_drawdown=num(bench_max))


def drawdown_rows(s: SessionSeries) -> list[DrawdownRow]:
    return [DrawdownRow(peak=_iso(row["peak"]), trough=_iso(row["trough"]), recovery=_iso(row["recovery"]),
                        depth=row["depth"], peak_to_trough=row["peak_to_trough"],
                        trough_to_recovery=row["trough_to_recovery"], length=row["length"], open=row["open"])
            for row in drawdown.drawdown_table(s.r, s.basis)]


def rolling_view(s: SessionSeries, u: Units) -> RollingView:
    t, dates = axis(s.r.index)
    short, long = rolling.windows_for(s.periods)
    panel = rolling.rolling_panel(s.r, s.periods)
    return RollingView(sharpe_unit=u.ratio, vol_unit=u.vol, windows=[short, long],
                       window_unit=rolling.WINDOW_UNIT[s.periods], t=t, date=dates,
                       sharpe_short=nums(panel[f"sharpe_{short}"]), sharpe_long=nums(panel[f"sharpe_{long}"]),
                       vol_short=nums(panel[f"vol_{short}"]), vol_long=nums(panel[f"vol_{long}"]),
                       full_sharpe=num(perf.sharpe(s.r, s.periods)),
                       full_vol=num(perf.annual_volatility(s.r, s.periods)),
                       vol_extremes=[vol_extremes(panel[f"vol_{w}"], w, u.vol) for w in (short, long)],
                       sharpe_bands=[_band(s, w) for w in (short, long)],
                       band_label=rolling.BAND_LABEL)


def _band(s: SessionSeries, window: int) -> RollingSharpeBand:
    band = rolling.sharpe_band(s.r, window, s.periods)
    return RollingSharpeBand(window=window, centre=num(band["centre"]), lo=num(band["lo"]), hi=num(band["hi"]),
                             se=num(band["se"]))


def _day(stamp: Any) -> tuple[int | None, str | None]:
    if stamp is None:
        return None, None
    day = pd.Timestamp(stamp)
    return int(day.timestamp()), day.strftime("%Y-%m-%d")


def vol_extremes(line: pd.Series, window: int, unit: str) -> VolExtremes:
    """RR's Hi and Low callouts for one rolling volatility line (`rolling.extremes`)."""
    found = rolling.extremes(line)
    (hi_t, hi_date), (lo_t, lo_date) = _day(found["hi_at"]), _day(found["lo_at"])
    return VolExtremes(window=window, unit=unit, hi=num(found["hi"]), hi_t=hi_t, hi_date=hi_date,
                       lo=num(found["lo"]), lo_t=lo_t, lo_date=lo_date)


def monthly_view(s: SessionSeries, u: Units) -> MonthlyView:
    grid = distribution.monthly_heatmap(s.r, s.basis)
    yearly = distribution.yearly_returns(s.r, s.basis)
    return MonthlyView(basis=s.basis, unit=u.level, aggregation=AGGREGATION[s.basis],
                       years=[int(y) for y in grid.index], months=[int(m) for m in grid.columns],
                       grid=[nums(row) for row in grid.to_numpy()],
                       yearly=[YearValue(year=int(y), value=num(v)) for y, v in yearly.items()])


def distribution_view(s: SessionSeries, u: Units) -> DistributionView:
    hist = distribution.histogram(s.r)
    qq = distribution.qq_plot(s.r)
    table = perf.stats_table(s.r, s.basis, s.periods)
    return DistributionView(
        histogram=HistogramView(unit=u.level, bin_rule=hist["bin_rule"], edges=nums(hist["edges"]),
                                counts=[int(c) for c in hist["counts"]],
                                centres=nums(hist["centres"]), normal=nums(hist["normal"]), mean=num(hist["mean"]),
                                sd=num(hist["sd"]), var_95=num(hist["var_95"]), var_99=num(hist["var_99"])),
        qq=QqView(label=QQ_LABEL, theoretical=nums(qq["theoretical"]), ordered=nums(qq["ordered"]),
                  slope=num(qq["slope"]), intercept=num(qq["intercept"]), r=num(qq["r"])),
        stats=StatsTable(unit=u.level, **{k: (v if k == "n" else num(v)) for k, v in table.items()}),
        series=PeriodSeries(unit=u.level, t=axis(s.r.index)[0], date=axis(s.r.index)[1], r=nums(s.r)))


def risk_view(s: SessionSeries, u: Units) -> RiskView:
    table = {k: num(v) for k, v in risk.var_table(s.r).items()}
    tails = None
    if s.periods == PERIODS_DAILY:
        loss = risk.loss_distribution(s.r)
        tails = Tails(window=loss["window"], n=loss["n"], shortfall_1pct=num(loss["shortfall_1pct"]),
                      shortfall_5pct=num(loss["shortfall_5pct"]))
    horizon = "1 session" if s.periods == PERIODS_DAILY else "1 month"
    return RiskView(basis=s.basis, unit=u.level, horizon=horizon, tails21=tails, **table)


def _fit(found: dict, on_capital: bool = True) -> AlphaFit:
    """A BR1 fit; `alpha_annual_pct` (P x a x 100) is a percentage only on capital, so a USD or basis point
    series gets None there (za_v0 would show 456,513 "%")."""
    return AlphaFit(n=int(found["n"]), a=num(found["a"]), b=num(found["b"]),
                    alpha_annual_pct=num(found["alpha_annual_pct"]) if on_capital else None,
                    t={str(k): num(v) for k, v in (found.get("t") or {}).items()},
                    t_b={str(k): num(v) for k, v in (found.get("t_b") or {}).items()}, t_min=num(found["t_min"]))


def relative_view(s: SessionSeries, u: Units) -> RelativeView | None:
    if s.bench is None:
        return None
    lags = _lags(s)
    rel = relative.relative_summary(s.r, s.bench, lags, s.periods)
    return RelativeView(tag=POST_HOC, basis=s.basis, unit=u.level, bench_label=s.bench_label or "", n=rel["n"],
                        periods_per_year=s.periods, lags=list(lags),
                        information_ratio=num(rel["information_ratio"]), tracking_error=num(rel["tracking_error"]),
                        alpha=_fit(rel["alpha"], s.on_capital),
                        blocks={k: _fit(v, s.on_capital) for k, v in rel["blocks"].items()})


def _track(found: dict) -> TrackRecord:
    return TrackRecord(sessions=num(found["sessions"]), years=num(found["years"]), reachable=found["reachable"],
                       reason=found["reason"],
                       actual_sessions=found["actual_sessions"], actual_years=found["actual_years"],
                       sr_star_per_period=num(found["sr_star_per_period"]), alpha=found["alpha"])


def validity_view(s: SessionSeries, u: Units, registry: RegistryEntry | None, sv7: dict) -> ValidityView:
    plain = validity.validity_summary(s.r, None, s.periods)
    paired = validity.validity_summary(s.r, s.bench, s.periods) if s.bench is not None else None
    moments = plain["sharpe_ci"]["moments"]
    return ValidityView(
        basis=s.basis, unit="probability (PSR); sessions or months (MinTRL)",
        psr=PsrView(at_zero=num(plain["psr"]["at_zero"]),
                    at_benchmark=num(paired["psr"]["at_benchmark"]) if paired else None,
                    benchmark_sr_per_period=num(paired["psr"]["benchmark_sr_per_period"]) if paired else None,
                    at_benchmark_note=PSR_BENCH_NOTE if paired else None),
        min_trl=MinTrlView(at_zero=_track(plain["min_trl"]["at_zero"]),
                           at_benchmark=_track(paired["min_trl"]["at_benchmark"]) if paired else None),
        moments=Moments(n=moments["n"], sr=num(moments["sr"]), skew=num(moments["skew"]), kurt=num(moments["kurt"])),
        registry=registry, sharpe_difference_tests=clean_json(sv7))


# ---------------------------------------------------------------- KPI tiles


def _tile(s: SessionSeries, key: str, label: str, value: Any, unit: str, *, tag: str = POST_HOC,
          note: str | None = None) -> Kpi:
    value = num(value)
    return Kpi(key=key, label=label, value=value, unit=unit, basis=s.basis, tag=tag,
               note=note if value is None or tag == PRE_REG else None)


def _capital_tiles(s: SessionSeries, u: Units) -> list[Kpi]:
    on = s.on_capital
    total = perf.total_return(s.r, s.basis) if on else None
    cagr = perf.cagr(s.r, s.basis, s.periods) if on else None
    return [_tile(s, "total_return", "Total return", total, u.level, note=None if on else NO_CAPITAL),
            _tile(s, "cagr", "CAGR", cagr, "fraction per year, compounded", note=None if on else NO_CAPITAL)]


def min_trl_note(reason: str) -> str | None:
    """Why MinTRL is null: the Sharpe is at or below the threshold, or the moments leave it undefined."""
    return MIN_TRL_NOTES.get(reason)


def _core_tiles(s: SessionSeries, u: Units, val: ValidityView) -> list[Kpi]:
    calmar = perf.calmar(s.r, s.basis, s.periods) if s.on_capital else None
    trl = val.min_trl.at_zero
    return [_tile(s, "volatility", "Volatility", perf.annual_volatility(s.r, s.periods), u.vol),
            _tile(s, "sharpe", "Sharpe", perf.sharpe(s.r, s.periods), u.ratio),
            _tile(s, "sortino", "Sortino", perf.sortino(s.r, s.periods), u.ratio),
            _tile(s, "calmar", "Calmar (full sample)", calmar, "ratio",
                  note=NO_CAPITAL if not s.on_capital else "no drawdown"),
            _tile(s, "max_drawdown", "Max drawdown", drawdown.max_drawdown(s.r, s.basis), u.drawdown),
            _tile(s, "psr_0", "PSR (0)", val.psr.at_zero, "probability that the Sharpe exceeds 0"),
            _tile(s, "min_trl", "MinTRL (0)", trl.sessions, u.per, note=min_trl_note(trl.reason))]


def _relative_tiles(s: SessionSeries, u: Units, rel: RelativeView | None) -> list[Kpi]:
    return [_tile(s, "information_ratio", "Information ratio", rel.information_ratio if rel else None, u.ratio,
                  note=NO_BENCH),
            _tile(s, "tracking_error", "Tracking error", rel.tracking_error if rel else None, u.vol, note=NO_BENCH)]


def _alpha_tiles(s: SessionSeries, rel: RelativeView | None, stored: StoredAlpha | None) -> list[Kpi]:
    where = f"read from the screen JSON at {stored.path}" if stored else None
    if stored is not None and stored.alpha_annual_pct is not None:
        annual = _tile(s, "alpha_annual", "Alpha", stored.alpha_annual_pct, "% per year", tag=PRE_REG, note=where)
    else:
        value = rel.alpha.alpha_annual_pct if rel is not None and s.on_capital else None
        annual = _tile(s, "alpha_annual", "Alpha", value, "% per year",
                       note=NO_CAPITAL if not s.on_capital else NO_BENCH)
    if stored is not None and stored.t_min is not None:
        t = _tile(s, "alpha_t", "Alpha t", stored.t_min, "t statistic (gating, as the screen records it)",
                  tag=PRE_REG, note=where)
    else:
        t = _tile(s, "alpha_t", "Alpha t", rel.alpha.t_min if rel else None,
                  f"t statistic (smallest over Newey-West lags {', '.join(map(str, _lags(s)))})", note=NO_BENCH)
    return [annual, t]


def kpi_tiles(s: SessionSeries, u: Units, val: ValidityView, rel: RelativeView | None,
              stored: StoredAlpha | None) -> list[Kpi]:
    """The KPI row: total, CAGR, vol, Sharpe, Sortino, Calmar, max DD, PSR(0), MinTRL, IR, TE, alpha, alpha t."""
    return [*_capital_tiles(s, u), *_core_tiles(s, u, val), *_relative_tiles(s, u, rel),
            *_alpha_tiles(s, rel, stored)]


# ---------------------------------------------------------------- registry (SV4)


def registry_entry(rows: Sequence[RegistryRow], name: str) -> RegistryEntry | None:
    """SV4 for `name`: stored adjusted p values next to `validity.registry_adjustments` over the whole family."""
    row = next((r for r in rows if r.name == name), None)
    if row is None:
        return None
    adjusted = validity.registry_adjustments(pd.DataFrame([r.model_dump() for r in rows]))
    computed = adjusted["rows"].set_index("name")
    mine = computed.loc[name] if row.registered and name in computed.index else None
    diffs = {k: num(v) for k, v in adjusted["max_abs_diff"].items()}
    matches = adjusted["family_k_ok"] and all(v is not None and v <= MT_TOLERANCE for v in diffs.values())
    pick = (lambda col: num(mine[col])) if mine is not None else (lambda col: None)
    return RegistryEntry(tag=PRE_REG, name=name, registered=row.registered, p=row.p, family_k=row.family_k,
                         stored_bonferroni_p=row.bonferroni_p, stored_holm_p=row.holm_p, stored_bh_q=row.bh_q,
                         computed_bonferroni_p=pick("bonferroni_p"), computed_holm_p=pick("holm_p"),
                         computed_bh_q=pick("bh_q"), max_abs_diff=diffs, matches=bool(matches))


# ---------------------------------------------------------------- responses


def build(s: SessionSeries, context: Context, *, stored: StoredAlpha | None = None,
          registry: RegistryEntry | None = None, sv7: dict | None = None) -> Analytics:
    """The whole tear sheet for one series."""
    u = units(s)
    rel = relative_view(s, u)
    val = validity_view(s, u, registry, sv7 or {})
    lo, hi = perf.sharpe_ci(s.r, s.periods)
    ci = SharpeInterval(basis=s.basis, unit=u.ratio, sharpe=num(perf.sharpe(s.r, s.periods)), lo=num(lo),
                        hi=num(hi), z=perf.CI_Z, periods_per_year=s.periods)
    return Analytics(**info(s, context), kpis=kpi_tiles(s, u, val, rel, stored), ci=ci, equity=equity_view(s, u),
                     drawdown=drawdown_view(s, u), drawdown_table=drawdown_rows(s), rolling=rolling_view(s, u),
                     monthly=monthly_view(s, u), distribution=distribution_view(s, u), risk=risk_view(s, u),
                     relative=rel, stored_alpha=stored, validity=val)


def home_panel(s: SessionSeries, context: Context, *, stored: StoredAlpha | None = None) -> HomePanel:
    """HOME [B]: equity against the benchmark, underwater and the rolling Sharpe over the long window, with the
    tear sheet's alpha tiles (the screen's stored fit [PRE-REG] where it records one, else the terminal's own)."""
    u = units(s)
    long = rolling.windows_for(s.periods)[1]
    eq, dd = equity_view(s, u), drawdown_view(s, u)
    present = s.bench.dropna() if s.bench is not None else None
    bench_sharpe = perf.sharpe(present, s.periods) if present is not None else None
    return HomePanel(**info(s, context), equity_unit=u.equity, t=eq.t, date=eq.date, equity=eq.equity,
                     bench_equity=eq.bench, underwater=dd.dd, bench_underwater=dd.bench_dd,
                     rolling_sharpe=nums(rolling.rolling_sharpe(s.r, long, s.periods)), rolling_window=long,
                     rolling_unit=rolling.WINDOW_UNIT[s.periods], rolling_unit_label=u.ratio,
                     drawdown_unit=dd.unit, sharpe=num(perf.sharpe(s.r, s.periods)), bench_sharpe=num(bench_sharpe),
                     max_drawdown=dd.max_drawdown, bench_max_drawdown=dd.bench_max_drawdown,
                     alpha=_alpha_tiles(s, relative_view(s, u), stored))
