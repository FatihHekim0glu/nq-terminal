"""The HOME prewarm tasks and the switch that starts them (02 section 4.1 item 2; 03 section 15.2; 04 D1.4).

`start_home_prewarm(app)` is called from the app's lifespan. It starts `services/prewarm.py` with the tasks below when the
process is a desktop or launcher process, and never otherwise: pytest, the fixture backend (fixture mode) and the
real-data smoke build apps that do not prewarm. A task is a zero-argument callable that resolves its services only when it
runs on the prewarm thread, so building the list costs nothing at start-up and no price source is touched before the port
is bound. Under `python -m nq_terminal` the thread waits for the start gate (V021, `services/prewarm.StartGate`): the
`NQT-READY` line printed and the first identity proof answered, or, in launcher and browser modes where no proof may
come, a few seconds after READY. Uvicorn started directly hands it the port-bound check only, or nothing.

The tasks call the route callables the routes themselves call (`cached_*`), with the query the HOME page sends (for the
two-day cells, one request per symbol, only for the rows MON shows at first paint), so they share the result cache's
keys and its single-flight: a page request that races a task for the same key waits for the one computation (one serve
call, one gate line). The two price reads that have no result cache entry (the universe panel and the
GP bars) go through the same route functions and the bar service's own cache; the page's later reads are hits there.

Order (02 section 4.1 item 3, decided: the cold-HOME cap holds on the very first launch, with an empty state folder; W5C
D4: no work HOME does not show runs during the HOME window): what HOME asks for, in the order it needs it, then what
HOME never asks for. First the `warm` task, which reads no price and writes no gate line: it imports
`scipy.cluster.hierarchy` and `scipy.spatial.distance` (neither loads `scipy.stats`) and builds the XNYS calendar once
through `data.last_sessions`. Those modules stay lazy imports off the start path (D1.1). No HOME request needs
`scipy.stats` (V032): HOME's EQ panel reads the screen's stored alpha fit and builds no relative fit
(`tearsheet.home_panel`), and HOME's REG list routes (registry, hypotheses, multiple-testing, confirmations) are numpy
only. The one HOME request that imports it is REG's deflated Sharpe: a REG panel that is not compact (the owner's
2400 x 1350 window) asks for it, and the web sends that request only after the registry and the hypotheses have
answered (`deflatedRequestable`), that is after HOME's last data response, so the import (about 0.55 s) falls inside
that request and not in front of HOME's data. `scipy.stats` (with `nq_lab.sizing_stats`) otherwise loads in the first
later task, `warm_stats`, once HOME is served; a first launch that opens EQ, DES or RISK before then pays that import
once inside the request. Then the run index (price-free; HOME's GP panel requests
/api/runs through `useGpData`, and a first launch has no persisted index, so a request that raced a later task would
build it cold from the heads of the result files while HOME loads). Then the price-reading tasks: MON two-day and
universe, GP bars. Then, as `later` tasks that wait until the process is quiet (`services/prewarm.py`): `warm_stats`
(price-free, no gate line), the ledger (price-free and persisted to disk; it serves RecordWatch and LEDG, never HOME:
HOME's REG panel reads the registry, hypotheses, multiple-testing and confirmations, not the ledger), the deflated
Sharpe (a wide REG panel asks for it after HOME's data, which then finds it computed; 1.2 s cold) and EQ's bootstrap (HOME's EQ panel asks for /panel, the full EQ screen
for the bootstrap, and the EQ Enter unit of DEC1 depends on it being warm). On a first launch they would otherwise take
the interpreter from HOME's own requests while HOME loads. On a usual launch the deflated Sharpe and the ledger come
from disk at once.

After each stage (the HOME tasks, then the later tasks) the prewarm calls `memtrim.stage_hook(app)`; only the later stage
trims the backend's working set (unless a request is in flight; vnext perf-1; `memtrim.py`), because it starts once the
process is quiet, that is after HOME is served. The HOME-tasks stage does not trim: HOME's requests arrive just then.
`TRIM_STAGES` names the stages that trim; the quiet-period trim in `memtrim.py` runs either way.
"""
from __future__ import annotations

import importlib
import logging
import os
from typing import Any, Callable

from fastapi import FastAPI

from nq_terminal import memtrim
from nq_terminal.services.prewarm import (ENV_PREWARM, PORT_BOUND_KEY, STAGE_LATER, START_GATE_KEY, Task,
                                          start_prewarm)

LOG = logging.getLogger(__name__)

HOME_GP_SYMBOL = "NQ.V.0"  # layouts: HOME [A] GP NQ 1d
HOME_GP_TIMEFRAME = "1d"
HOME_GP_VARIANT = "vendor"
HOME_EQ_HYPOTHESIS = "volmanaged_v0"  # layouts: HOME [B] EQ
HOME_EQ_COST = 1
HOME_UNIVERSE_WINDOW = 252  # the universe route's own default, which MON asks for
HOME_MON_ROWS = 19  # grid rows MON shows at first paint on the 2x2 HOME at 1920x1080 (MonHome.gallery.tsx)
OFF_VALUE = "0"  # NQT_PREWARM=0 is an explicit off even when NQT_DESKTOP=1
# The prewarm stages after which the working set is trimmed. Not STAGE_TASKS: the HOME tasks end a few seconds after the
# port binds, when the page's own HOME requests arrive, and a trim there pages out what the prewarm just warmed (vnext
# perf.md: the trim must not run before HOME is served). The later stage starts only once the process is quiet.
TRIM_STAGES = frozenset({STAGE_LATER})


def _named(name: str, fn: Callable[[], object]) -> Task:
    fn.__name__ = name
    return fn


def two_day_symbols() -> list[str]:
    """The symbols MON's first paint asks the two-day route for: its first HOME_MON_ROWS rows in row order.

    The universe table is already in the monitor's sector order, so the first rows of the table are the first rows of
    the grid. Rows below the fold are the page's own requests (each cell asks only once it has been on screen)."""
    from nq_lab.dtsmom_universe import TABLE
    return [f"{c.root}.V.0" for c in TABLE[:HOME_MON_ROWS]]


def _warm(state: Any) -> Task:
    """Price-free warm-up during HOME: scipy's cluster and spatial modules (with scipy.linalg; no scipy.stats) and the
    XNYS calendar. No serve call, no gate line; `state` is not read."""
    def run() -> object:
        importlib.import_module("scipy.cluster.hierarchy")
        importlib.import_module("scipy.spatial.distance")
        from nq_terminal.api import data
        return data.last_sessions()
    return _named("warm", run)


def _warm_stats(state: Any) -> Task:
    """Price-free warm-up after HOME: `nq_lab.sizing_stats`, which loads scipy.stats (EQ's tear sheet and bootstrap,
    DES, RISK and the deflated Sharpe need it; no HOME request does). No serve call, no gate line; `state` is not
    read."""
    def run() -> object:
        return importlib.import_module("nq_lab.sizing_stats")
    return _named("warm_stats", run)


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


def _runs(state: Any) -> Task:
    def run() -> object:
        from nq_terminal.api import runs
        return runs.cached_runs(state)
    return _named("runs", run)


def home_tasks(state: Any) -> list[Task]:
    """The prewarm tasks for what the HOME layout asks for, in order; none of them runs until the prewarm thread calls it."""
    return [_warm(state), _runs(state), _two_day(state), _universe(state), _gp_bars(state)]


def later_tasks(state: Any) -> list[Task]:
    """What HOME's first paint does not wait for but the next screens do; run once HOME is served and the process is quiet.
    `warm_stats` comes first: scipy.stats is what the deflated Sharpe, EQ's bootstrap and the next screens import."""
    return [_warm_stats(state), _ledger(state), _deflated(state), _eq_bootstrap(state)]


def home_prewarm_allowed(app: FastAPI, environ: dict[str, str] | None = None) -> bool:
    """False in fixture mode (no gated price source exists there) and when NQT_PREWARM is exactly "0"."""
    env = os.environ if environ is None else environ
    if app.state.settings.fixture_mode:
        return False
    return env.get(ENV_PREWARM) != OFF_VALUE


def _trim_after(app: Any) -> Callable[[str], None]:
    """The prewarm's stage hook: trim the working set after the stages in `TRIM_STAGES` (read when the stage ends)."""
    trim = memtrim.stage_hook(app)

    def after(stage: str) -> None:
        if stage in TRIM_STAGES:
            trim(stage)
    return after


def start_check(state: Any) -> Callable[[], bool] | None:
    """What the prewarm waits for before its first task: the start gate when `python -m nq_terminal` made one, else the
    port-bound check, else nothing (start at once)."""
    gate = getattr(state, START_GATE_KEY, None)
    return gate if gate is not None else getattr(state, PORT_BOUND_KEY, None)


def start_home_prewarm(app: FastAPI):
    """Start the prewarm thread for `app` when this is a desktop or launcher process; return it, or None. Never raises."""
    try:
        if not home_prewarm_allowed(app):
            return None
        return start_prewarm(home_tasks(app.state), ready=start_check(app.state), later=later_tasks(app.state),
                             on_stage=_trim_after(app))
    except Exception:  # noqa: BLE001 - the prewarm must never stop the app from starting
        LOG.exception("the HOME prewarm could not be started")
        return None
