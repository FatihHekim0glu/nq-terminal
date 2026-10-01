"""P2 risk extras of one tear sheet series (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). No formula lives here.

Turns a stage A `SessionSeries` into the `RiskExtras` response by calling `analytics/risk_extras.py`. The labelling
rules of `services/tearsheet.py` apply: every number names its basis and unit, everything is "[POST HOC]" and
descriptive, and a one-contract series (no capital K) is summed, never compounded, and has no CAGR, so no Treynor.
Its ulcer index is in its own unit (USD below the running peak of the summed P&L) and its recovery factor, a ratio of
two sums, needs no K.
"""
from __future__ import annotations

import math

from nq_terminal.analytics import risk_extras
from nq_terminal.analytics._inputs import PERIODS_DAILY
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.models.analytics import Context, Kpi
from nq_terminal.models.risk_extras import CornishFisherEsLevel, CornishFisherEsView, RiskExtras, TreynorView
from nq_terminal.services.tearsheet import NO_BENCH, NO_CAPITAL, POST_HOC, Units, num, units

DESCRIPTIVE = "descriptive, in sample, computed by the terminal; not a registered test and never a verdict"
ES_DOMAIN = ("modified ES rests on the Cornish-Fisher quantile, which is a quantile only where its expansion rises in "
             "z (RK3's domain: a = K/8 - S^2/6 > 0 and b^2 - 4ac <= 0 with b = S/3, c = 1 - K/8 + 5 S^2/36; at S = 0: "
             "0 <= K <= 8) and the second order Edgeworth density must be non-negative at and below the quantile "
             "(at S = 0 it is not from K = 4 at the 5% tail); outside either, or where the ES falls below zero, the "
             "value is not defined and the tile shows the historical CVaR (RK1) beside it, the Gaussian ES greyed. Where the Edgeworth tail mean lies above "
             "the quantile the ES is floored at the modified VaR (PerformanceAnalytics' operational rule)")
ULCER_LABEL = "Ulcer index"
RECOVERY_LABEL = "Recovery factor"
RECOVERY_UNIT = "ratio, total return over the deepest drawdown"
RECOVERY_UNIT_USD = "ratio, net P&L over the deepest P&L drawdown (no K needed)"
NO_DRAWDOWN = "not defined: the series never falls below its running peak"
TREYNOR_LABEL = "Treynor (CAGR / beta)"
TREYNOR_UNIT = "ratio, CAGR (fraction per year) over beta"
NO_BETA = "not defined: the beta is 0 or cannot be estimated (fewer than three paired sessions or a flat benchmark)"
NEGATIVE_BETA = "the beta is negative, so a larger ratio is not a better one; read it beside the beta"
TREYNOR_BASIS_A = "CAGR on Basis A is (1 + summed return)^(P / n) - 1; Nautilus compounds instead"


def _basis(s: SessionSeries) -> str:
    """The basis that aggregates: a one-contract series is summed whatever its label."""
    return s.basis if s.on_capital else "A"


def _kpi(s: SessionSeries, key: str, label: str, value: float | None, unit: str, note: str | None) -> Kpi:
    value = num(value)
    return Kpi(key=key, label=label, value=value, unit=unit, basis=s.basis, tag=POST_HOC,
               note=note if value is None else None)


def drawdown_tiles(s: SessionSeries, u: Units) -> list[Kpi]:
    """PF11: ulcer index (in the drawdown unit) and recovery factor."""
    basis = _basis(s)
    recovery_unit = RECOVERY_UNIT if s.on_capital else RECOVERY_UNIT_USD
    return [_kpi(s, "ulcer_index", ULCER_LABEL, risk_extras.ulcer_index(s.r, basis), u.drawdown, NO_DRAWDOWN),
            _kpi(s, "recovery_factor", RECOVERY_LABEL, risk_extras.recovery_factor(s.r, basis), recovery_unit,
                 NO_DRAWDOWN)]


def _level(level: str, row: dict) -> CornishFisherEsLevel:
    return CornishFisherEsLevel(level=level, tail=row["tail"], z=row["z"], cf_quantile=num(row["cf_quantile"]),
                           edgeworth_mean=num(row["edgeworth_mean"]), gaussian=num(row["gaussian"]),
                           historical=num(row["historical"]), raw_expansion=num(row["raw_expansion"]),
                           modified=num(row["modified"]), value=num(row["value"]), in_domain=row["in_domain"],
                           floored=row["floored"], method=row["method"])


def modified_es_view(s: SessionSeries, u: Units) -> CornishFisherEsView:
    """RK4 at 95% and 99%, one period."""
    table = risk_extras.modified_es_table(s.r)
    first = table["95"]
    horizon = "1 session" if s.periods == PERIODS_DAILY else "1 month"
    return CornishFisherEsView(basis=s.basis, unit=u.level, horizon=horizon, mean=num(first["mean"]),
                          sigma=num(first["sigma"]), skew=num(first["skew"]),
                          excess_kurtosis=num(first["excess_kurtosis"]), domain=ES_DOMAIN,
                          levels=[_level(level, row) for level, row in table.items()])


def _treynor_note(s: SessionSeries, parts: dict | None) -> str | None:
    if parts is None or parts["n_pairs"] == 0:
        return NO_CAPITAL if not s.on_capital else NO_BENCH
    if not math.isfinite(parts["value"]):
        return NO_BETA
    notes = [NEGATIVE_BETA] if parts["beta"] < 0 else []
    if s.basis == "A":
        notes.append(TREYNOR_BASIS_A)
    return "; ".join(notes) or None


def treynor_view(s: SessionSeries) -> TreynorView:
    """BR5 on the tear sheet's own benchmark (C6); null without a benchmark or a capital K."""
    usable = s.on_capital and s.bench is not None
    parts = risk_extras.treynor_parts(s.r, s.bench, s.basis, s.periods) if usable else None
    value = num(parts["value"]) if parts else None
    note = _treynor_note(s, parts)
    tile = Kpi(key="treynor", label=TREYNOR_LABEL, value=value, unit=TREYNOR_UNIT, basis=s.basis, tag=POST_HOC,
               note=note if value is None else None)
    return TreynorView(tile=tile, cagr=num(parts["cagr"]) if parts else None,
                       beta=num(parts["beta"]) if parts else None, n_pairs=parts["n_pairs"] if parts else 0,
                       bench_label=s.bench_label, note=note)


def risk_extras_view(s: SessionSeries, context: Context) -> RiskExtras:
    """RK4, PF11 and BR5 of one tear sheet series."""
    u = units(s)
    return RiskExtras(context=context, basis=s.basis, unit=u.level, periods_per_year=s.periods, n=s.n, tag=POST_HOC,
                      descriptive=DESCRIPTIVE, drawdown_tiles=drawdown_tiles(s, u),
                      modified_es=modified_es_view(s, u), treynor=treynor_view(s))
