"""RG2 for series labelled by exit date whose return window opens before the previous session's 1d close.

The vendor 1d bar is a UTC day, so the close of session s is the last trade before 00:00 UTC, 19:00 or 20:00 ET. A
trade series is labelled by its exit date: `overnight_v0`'s return for t runs from the 16:00 ET close of t-1, so t-1's
own 1d close already holds the first hours of it. Those books take the regime from the session before the entry date;
a book that holds several sessions has no regime view; every other series keeps the session before t.
"""
from __future__ import annotations

import pandas as pd
import pytest

from nq_terminal.analytics import trend_regime
from nq_terminal.analytics.series import SessionSeries
from nq_terminal.models.analytics import Context
from nq_terminal.services import regimes_capacity_term as rct

ONE_SESSION_BOOKS = ("overnight_v0", "mac5rev_v0", "preholiday_v0", "prefomc_v0")
MULTI_SESSION_BOOKS = ("tom_v0", "rebal_v0")


def planted() -> tuple[pd.Series, pd.Timestamp]:
    """Flat closes at 15010 and one 19:00 ET evening close at 15020 on session D; t = D + 1 carries the move."""
    days = pd.bdate_range("2012-01-02", periods=trend_regime.WINDOW + 3)
    close = pd.Series(15010.0, index=days)
    close[days[trend_regime.WINDOW]] = 15020.0
    return close, days[trend_regime.WINDOW + 1]


def make_series(name: str, t: pd.Timestamp, basis: str = "A") -> SessionSeries:
    days = pd.DatetimeIndex([t - pd.Timedelta(days=1), t])
    return SessionSeries(name=name, basis=basis, periods=252, r=pd.Series([0.0, 400.0], index=days),
                         unit="USD per session, one NQ contract", on_capital=False, capital=None, source="fixture",
                         kind="trades", label=name)


def regime_of(view, t: pd.Timestamp) -> str | None:
    return view.regime[view.date.index(t.strftime("%Y-%m-%d"))]


@pytest.fixture
def served(monkeypatch):
    close, t = planted()
    monkeypatch.setattr(rct, "nq_trend_close", lambda bars, version: (close, rct.Served((2012,), True)))
    return t


def context(name: str) -> Context:
    return Context(kind="hypothesis", name=name, cost=1, freq="D")


@pytest.mark.parametrize("name", ONE_SESSION_BOOKS)
def test_born_failing_an_overnight_book_is_not_labelled_by_the_evening_that_is_its_own_return(served, name):
    view, _ = rct.trend_for(make_series(name, served), context(name), object(), None)
    assert view.available is True
    assert regime_of(view, served) == "below"
    assert "entry" in view.label


@pytest.mark.parametrize("name", ["za_v0", "volmanaged_v0", "fomccycle_v0"])
def test_a_series_that_opens_after_the_close_keeps_the_session_before(served, name):
    view, _ = rct.trend_for(make_series(name, served), context(name), object(), None)
    assert regime_of(view, served) == "above"
    assert view.label == trend_regime.LABEL


def test_the_same_name_on_a_run_is_not_lagged(served):
    view, _ = rct.trend_for(make_series("overnight_v0", served, basis="B"), context("overnight_v0"), object(), None)
    assert regime_of(view, served) == "above"


@pytest.mark.parametrize("name", MULTI_SESSION_BOOKS)
def test_a_book_that_holds_several_sessions_has_no_regime_view_and_no_serve(name, monkeypatch):
    def refuse(bars, version):
        raise AssertionError("no price may be served for a book without a regime view")

    monkeypatch.setattr(rct, "nq_trend_close", refuse)
    t = pd.Timestamp("2013-03-05")
    view, served = rct.trend_for(make_series(name, t), context(name), None, None)
    assert served is None and view.available is False and view.gate is None and view.rows == []
    assert view.note and "several sessions" in view.note
    assert view.regime == [] and view.welch_t is None
