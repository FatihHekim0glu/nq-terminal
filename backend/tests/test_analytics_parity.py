"""Second implementations and anchors for Phase 3.2 (ANALYTICS_CATALOG.md C3 and section 14).

- Nautilus 1.231.0 pyo3 statistics, fed `{ts_ns: r}` on a session index, agree with perf and drawdown within
  1e-9 relative (Sharpe, Sortino, CAGR, volatility, MaxDD, Calmar), on synthetic and real result series.
- C3 weekend bias, born failing: the analyser path (`PortfolioAnalyzer._calculate_portfolio_returns`, which
  resamples balances to calendar days and forward-fills weekends) gives the wrong Sharpe on the same book.
- Anchors read from result files (read only): volmanaged `r_m_1`/`r_bh_1` and dtsmom `r_ts_1`/`r_lo_1`
  Sharpe and max drawdown.
"""
from __future__ import annotations

import json
import math
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from nautilus_trader.analysis import (
    CAGR,
    CalmarRatio,
    MaxDrawdown,
    PortfolioAnalyzer,
    ReturnsVolatility,
    SharpeRatio,
    SortinoRatio,
)

from nq_lab.config import RESULTS
from nq_terminal.analytics import drawdown, perf

PARITY = 1e-9
ANCHOR = 1e-12
SCREENS = RESULTS / "screens"


def _session_dict(r: pd.Series) -> dict[int, float]:
    idx = pd.DatetimeIndex(r.index)
    idx = idx.tz_localize("UTC") if idx.tz is None else idx
    return {int(t.value): float(v) for t, v in zip(idx, r.to_numpy())}


def _nautilus(r: pd.Series, periods: int = 252) -> dict[str, float]:
    d = _session_dict(r)
    return {"sharpe": SharpeRatio(periods).calculate_from_returns(d),
            "sortino": SortinoRatio(periods).calculate_from_returns(d),
            "cagr": CAGR(periods).calculate_from_returns(d),
            "vol": ReturnsVolatility(periods).calculate_from_returns(d),
            "max_dd": MaxDrawdown().calculate_from_returns(d),
            "calmar": CalmarRatio(periods).calculate_from_returns(d)}


def _ours(r: pd.Series, periods: int = 252) -> dict[str, float]:
    return {"sharpe": perf.sharpe(r, periods), "sortino": perf.sortino(r, periods),
            "cagr": perf.cagr(r, "B", periods), "vol": perf.annual_volatility(r, periods),
            "max_dd": drawdown.max_drawdown(r, "B"), "calmar": perf.calmar(r, "B", periods)}


def _volmanaged(col: str) -> pd.Series:
    frame = pd.read_csv(SCREENS / "volmanaged_v0_daily.csv", usecols=["date", col]).dropna()
    return pd.Series(frame[col].to_numpy(), index=pd.to_datetime(frame["date"]))


def _dtsmom(col: str) -> pd.Series:
    frame = pd.read_csv(SCREENS / "dtsmom_v0_monthly.csv", usecols=["end", col])
    return pd.Series(frame[col].to_numpy(), index=pd.to_datetime(frame["end"]))


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_nautilus_parity_on_a_synthetic_session_index(seed):
    rng = np.random.default_rng(seed)
    r = pd.Series(rng.normal(0.0005, 0.012, 1260), index=pd.bdate_range("2015-01-02", periods=1260))
    ours, theirs = _ours(r), _nautilus(r)
    for key, value in ours.items():
        assert value == pytest.approx(theirs[key], rel=PARITY), key


@pytest.mark.parametrize("col", ["r_m_1", "r_bh_1"])
def test_nautilus_parity_on_volmanaged_sessions(col):
    r = _volmanaged(col)
    ours, theirs = _ours(r), _nautilus(r)
    for key, value in ours.items():
        assert value == pytest.approx(theirs[key], rel=PARITY), key


def test_nautilus_parity_on_the_dtsmom_monthly_book():
    r = _dtsmom("r_ts_1")
    ours, theirs = _ours(r, 12), _nautilus(r, 12)
    for key, value in ours.items():
        assert value == pytest.approx(theirs[key], rel=PARITY), key


# ---------- C3 weekend bias (born failing) ----------

def _fake_account(balances: pd.Series) -> SimpleNamespace:
    """Duck-typed account with one USD balance per session, as `_calculate_portfolio_returns` reads it."""
    usd = SimpleNamespace(code="USD")
    events = [SimpleNamespace(ts_event=int(t.value), balances=[SimpleNamespace(
        currency=usd, total=SimpleNamespace(as_double=lambda v=float(v): v))]) for t, v in balances.items()]
    return SimpleNamespace(events=events)


def _weekend_case() -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(2026)
    idx = pd.bdate_range("2016-01-04", periods=1260, tz="UTC")
    r = pd.Series(rng.normal(0.0004, 0.01, len(idx)), index=idx)
    balances = pd.concat([pd.Series([1_000_000.0], index=[idx[0] - pd.Timedelta(days=3)]),
                          1_000_000.0 * (1 + r).cumprod()])
    analyser = PortfolioAnalyzer()._calculate_portfolio_returns(_fake_account(balances))
    return r, analyser


def test_weekend_bias_analyser_path_gives_the_wrong_sharpe():
    r, analyser = _weekend_case()
    correct = perf.sharpe(r)
    assert _nautilus(r)["sharpe"] == pytest.approx(correct, rel=PARITY)  # session index: agrees
    assert len(analyser) > len(r) * 1.3  # calendar days with zero weekend returns
    assert (analyser[analyser.index.dayofweek >= 5] == 0).all()
    wrong = SharpeRatio(252).calculate_from_returns(_session_dict(analyser))
    assert wrong != pytest.approx(correct, rel=0.05)  # born failing: the analyser Sharpe misses the check
    assert wrong / correct == pytest.approx(math.sqrt(5 / 7), rel=0.03)  # the weekend-dilution signature


def test_weekend_bias_analyser_path_understates_cagr_and_vol():
    r, analyser = _weekend_case()
    assert perf.annual_volatility(analyser) < 0.9 * perf.annual_volatility(r)
    assert perf.cagr(analyser, "B") < 0.8 * perf.cagr(r, "B")


# ---------- anchors (section 14) ----------

def test_volmanaged_sharpe_anchors():
    assert perf.sharpe(_volmanaged("r_m_1")) == pytest.approx(0.9914875364356387, rel=ANCHOR)
    assert perf.sharpe(_volmanaged("r_bh_1")) == pytest.approx(0.9946882195853758, rel=ANCHOR)


def test_volmanaged_max_drawdown_anchors():
    stored = json.loads((SCREENS / "volmanaged_v0.json").read_text(encoding="utf-8"))["tails"]
    managed = -drawdown.max_drawdown(_volmanaged("r_m_1"), "A") * 100
    bh = -drawdown.max_drawdown(_volmanaged("r_bh_1"), "A") * 100
    assert managed == pytest.approx(stored["managed"]["max_drawdown_pct"], rel=ANCHOR)
    assert bh == pytest.approx(stored["bh"]["max_drawdown_pct"], rel=ANCHOR)
    assert round(managed, 1) == 22.6 and round(bh, 1) == 32.9  # the nq-lab project rules


def test_volmanaged_years():
    stored = json.loads((SCREENS / "volmanaged_v0.json").read_text(encoding="utf-8"))
    assert perf.stats_table(_volmanaged("r_m_1"), "A")["years"] == pytest.approx(stored["years"], rel=ANCHOR)


def test_dtsmom_sharpe_and_max_drawdown_anchors():
    stored = json.loads((SCREENS / "dtsmom_v0.json").read_text(encoding="utf-8"))
    ts, lo = _dtsmom("r_ts_1"), _dtsmom("r_lo_1")
    assert len(ts) == 120
    assert perf.sharpe(ts, 12) == pytest.approx(0.25493487321272734, rel=ANCHOR)
    assert perf.sharpe(lo, 12) == pytest.approx(stored["lo_headline"]["sharpe"], rel=ANCHOR)
    dd = stored["secondary"]["S9_unrounded"]["max_drawdown_pct"]
    assert -drawdown.max_drawdown(ts, "A") * 100 == pytest.approx(dd["tsmom"], rel=ANCHOR)
    assert -drawdown.max_drawdown(lo, "A") * 100 == pytest.approx(dd["lo"], rel=ANCHOR)
    assert round(dd["tsmom"], 1) == 32.9 and round(dd["lo"], 1) == 57.3  # the nq-lab project rules


def test_shifted_anchor_fails():
    """Born failing (QA protocol 4): the same series shifted by one session misses the Sharpe anchor."""
    r = _volmanaged("r_m_1")
    shifted = pd.Series(r.to_numpy()[1:], index=r.index[:-1])
    assert perf.sharpe(shifted) != pytest.approx(0.9914875364356387, rel=ANCHOR)
