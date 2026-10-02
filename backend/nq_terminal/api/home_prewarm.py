"""The HOME prewarm tasks and the switch that starts them (02 section 4.1 item 2; 03 section 15.2; 04 D1.4).

`start_home_prewarm(app)` is called from the app's lifespan. It starts `services/prewarm.py` with the tasks below when the
process is a desktop or launcher process, and never otherwise: pytest, the fixture backend (fixture mode) and the
real-data smoke build apps that do not prewarm. A task is a zero-argument callable that resolves its services only when it
runs on the prewarm thread, so building the list costs nothing at start-up and no price source is touched before the port
is bound.

The tasks call the route callables the routes themselves call (`cached_*`), with the query the HOME page sends (for the
two-day cells, one request per symbol, only for the rows MON shows at first paint), so they share the result cache's
keys and its single-flight: a page request that races a task for the same key waits for the one computation (one serve
call, one gate line). The two price reads that have no result cache entry (the universe panel and the
GP bars) go through the same route functions and the bar service's own cache; the page's later reads are hits there.

Order: the two disk-eligible entries first (deflated and the ledger are price-free routes, so they persist to disk even
while the page's own price requests overlap them; the order only gets them done early), then the price-reading tasks in
the order the page needs them: MON two-day and universe, GP bars, EQ bootstrap.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable

from fastapi import FastAPI

from nq_terminal.services.prewarm import ENV_PREWARM, PORT_BOUND_KEY, Task, start_prewarm

LOG = logging.getLogger(__name__)

HOME_GP_SYMBOL = "NQ.V.0"  # layouts: HOME [A] GP NQ 1d
HOME_GP_TIMEFRAME = "1d"
HOME_GP_VARIANT = "vendor"
HOME_EQ_HYPOTHESIS = "volmanaged_v0"  # layouts: HOME [B] EQ
HOME_EQ_COST = 1
HOME_UNIVERSE_WINDOW = 252  # the universe route's own default, which MON asks for
HOME_MON_ROWS = 19  # grid rows MON shows at first paint on the 2x2 HOME at 1920x1080 (MonHome.gallery.tsx)
OFF_VALUE = "0"  # NQT_PREWARM=0 is an explicit off even when NQT_DESKTOP=1


def _named(name: str, fn: Callable[[], object]) -> Task:
    fn.__name__ = name
    return fn


def two_day_symbols() -> list[str]:
    """The symbols MON's first paint asks the two-day route for: its first HOME_MON_ROWS rows in row order.

    The universe table is already in the monitor's sector order, so the first rows of the table are the first rows of
    the grid. Rows below the fold are the page's own requests (each cell asks only once it has been on screen)."""
    from nq_lab.dtsmom_universe import TABLE
    return [f"{c.root}.V.0" for c in TABLE[:HOME_MON_ROWS]]


def _two_day(state: Any) -> Task:
    """One cached request per first-paint symbol, as MON's cells send them (`?symbols=<one>`): the page's own keys."""
    def run() -> object:
        from nq_terminal.api import data
        return [data.cached_two_day(state, {"symbols": symbol}) for symbol in two_day_symbols()]
    return _named("two_day", run)


def _universe(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import data
        return data.market_universe(window=HOME_UNIVERSE_WINDOW, services=data.services_for(state))
    return _named("universe", run)


def _gp_bars(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import data
        return data.get_bars(symbol=HOME_GP_SYMBOL, timeframe=HOME_GP_TIMEFRAME, variant=HOME_GP_VARIANT, start=None,
                             end=None, max_points=data.DEFAULT_MAX_POINTS, services=data.services_for(state))
    return _named("gp_bars", run)


def _eq_bootstrap(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import analytics
        return analytics.cached_hypothesis_bootstrap(state, {"name": HOME_EQ_HYPOTHESIS, "cost": HOME_EQ_COST})
    return _named("eq_bootstrap", run)


def _deflated(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import analytics
        return analytics.cached_deflated(state)
    return _named("deflated", run)


def _ledger(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import runs
        return runs.cached_ledger(state)
    return _named("ledger", run)


def home_tasks(state: Any) -> list[Task]:
    """The prewarm tasks for the HOME layout, in order; none of them runs until the prewarm thread calls it."""
    return [_deflated(state), _ledger(state), _two_day(state), _universe(state), _gp_bars(state), _eq_bootstrap(state)]


def home_prewarm_allowed(app: FastAPI, environ: dict[str, str] | None = None) -> bool:
    """False in fixture mode (no gated price source exists there) and when NQT_PREWARM is exactly "0"."""
    env = os.environ if environ is None else environ
    if app.state.settings.fixture_mode:
        return False
    return env.get(ENV_PREWARM) != OFF_VALUE


def start_home_prewarm(app: FastAPI):
    """Start the prewarm thread for `app` when this is a desktop or launcher process; return it, or None. Never raises."""
    try:
        if not home_prewarm_allowed(app):
            return None
        return start_prewarm(home_tasks(app.state), ready=getattr(app.state, PORT_BOUND_KEY, None))
    except Exception:  # noqa: BLE001 - the prewarm must never stop the app from starting
        LOG.exception("the HOME prewarm could not be started")
        return None
