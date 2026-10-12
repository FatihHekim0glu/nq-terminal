# w1-startup-backend, slice pre-ready: trim the work before READY

Scope: startup.md 7.4 and metrics.md 2.1. All numbers below are PROVISIONAL: the machine ran at 52 to 76 % CPU
(other waves, a QuantPad download) while they were taken, well over the 10 % limit.

## What changed

| Item | Change | Where |
| --- | --- | --- |
| (a) double build | `app.app` is a lazy module attribute (PEP 562, built once under a lock). Importing `nq_terminal.__main__` builds no app; `serve` builds the one real app. `app_module.app` and `from nq_terminal.app import app` still work. | `app.py` |
| (b) dist walk | `ready_payload` answers the exact `dist_status`, but reads the source walk's result from `handshake.DistWalk`, a daemon thread `serve` starts before the token wait and the app build; it walks inline only when that walk failed or gave no answer. A daemon thread walks once more, 5 s after READY, and logs one warning when a source changed since. (A first version answered from a few stats only, `dist_status_quick`; the fix round removed it, see below.) | `build_stamp.py`, `handshake.py`, `__main__.py` |
| (c) `defer_build` | Kept: `ResponseModel` has `defer_build=True`. | `models/common.py` |
| (d) lazy imports | `api/regimes_capacity_term.py` imports its service (and through it the three analytics modules for trend, capacity and term structure) on the first request. `services/audit.py`: no change, see below. | `api/regimes_capacity_term.py` |
| (e) instrumentation | `desktop/request_timing.py`: a pure ASGI middleware, one INFO line per HTTP request while the HOME window is open. | `request_timing.py`, `app.py` |

### Decision for the owner: the dist check at READY

The READY line has to carry `dist` (the shell refuses anything but `current`), so the walk could not simply move after
READY. Four ways were weighed:

1. Remember the verdict per build stamp in a file in the state folder. Exact after one start, but it needs a write from
   `desktop/build_stamp.py`, and `tests/test_safety_ast.py` bans writes from every production module outside
   `WRITE_ALLOWED`. That guard is not owned by this wave (the merge may only touch files its slices own), so this was
   not done.
2. Make the walk cheaper (a scandir walk with an early exit). Exact, but `ready_payload` still walks, which the exit
   criterion forbids.
3. First chosen, then dropped in the fix round: answer from the cheap checks at READY and walk afterwards.
4. Chosen in the fix round: walk on a daemon thread started early in `serve` (beside the token wait and the app build)
   and let `ready_payload` read the result. Exact, and the READY path walks nothing.

Why 3 was dropped: a file edited deep under `web/src` or `web/public` after the last build, with the top-level sources
untouched, no longer made the READY line say `stale`. The shell therefore showed no rebuild page for that
case and served the old page; the shell does not read the post-READY warning or `/api/health` before it starts. With 4
the READY line is exact again and no owner decision is left here.

### `defer_build`: measured, kept

Interleaved A/B of the same tree with and without it (12 runs, first dropped, median): 1.601 s against 1.463 s for
import plus one build, so 0.14 s less. FastAPI does not force the build at route registration: after `create_app`,
255 of 256 response models are still unbuilt. Building all of them later costs 58 to 72 ms (measured in process), and
a request builds only the models it touches, so most of that stays unspent. Every route and contract test passes with it
(`test_openapi_contract.py` among them: the OpenAPI document is byte-equal to `contract/openapi.json`). One risk is
stated plainly: the first use of a model builds its schema on whichever worker thread serves the request, and Pydantic
does not document that build as thread safe. A double build is idempotent, so the worst case is duplicated work.
`tests/test_import_budget.py` fails if FastAPI ever starts building the models early.

### `services/audit.py`: no change, on purpose

Every module-level import there is also imported on the start path by `api/audit.py` or `app.py` (`services.research`,
which brings `nq_lab.sessions` and `exchange_calendars`, the models, `services.files`). Making them lazy in `audit.py`
alone removes nothing from `sys.modules`, and `exchange_calendars` stays because `services/research.py`, which this
slice does not own, imports `nq_lab.sessions` at module level. Moving that import is the one change that would take
the 80 ms out; it belongs to whoever owns `services/research.py`.

## Measurements

Method: a copy of `research/tools/import_timing.py` (`D:/dev/v04/w1-startup-backend/import_timing_pre_ready.py`): the
venv Python with `-E -s -X utf8`, a scratch state folder, `NQT_JOBS=off`, fixtures as the data root, nothing written to
the repository. One run is `import nq_terminal.__main__` plus one `create_app(settings)`, which is what the start path
does. Before and after runs alternate (`ab.sh`) so load drifts hit both arms; the first run of each arm is dropped.

| Arm | import `__main__` | `create_app` | total | modules |
| --- | --- | --- | --- | --- |
| before (HEAD 16f56ec), n=9 | 1.214 s | 0.079 s | 1.293 s | 1180 |
| after, n=9 | 0.989 s | 0.105 s | 1.090 s | 1174 |

Median saving 0.203 s (16 %) of import plus build. `create_app` itself got slower in the table because it is now the
first build in the process (before, the import built an app and this was the second, warm build). The walk avoided at
READY: 47 ms for the 737 files of the lab tree (warm cache, under load) against 0.22 ms for the quick check.
Staged readings (separate interleaved runs, so only roughly additive): lazy app alone about 0.12 s, `defer_build` alone
about 0.14 s.

Not measured here, said plainly: the effect on the HOME stage or on a real first launch (needs the A/B labs and the
real-data modes, which this worktree may not run), and the first-request cost of the deferred models.

## Per-request timing line

Logger `nq_terminal.request_timing`, INFO (so it reaches backend.log through the stderr handler that
`prewarm.ensure_log_lines` adds):

    request timing: GET /api/ping status=200 start=107637.625000 end=107637.625000 wall_ms=6.2 event_loop_cpu_ms=0.0 process_cpu_ms=15.6

- Path only. The query string never reaches the log, and a control character in a path is escaped.
- `start` and `end` are on the monotonic clock, in seconds, like the prewarm's own lines. On Windows Python 3.12 that
  clock ticks every 15.6 ms, so a fast request can read start == end. `wall_ms` comes from `time.perf_counter()`
  (100 ns) taken at the same two points: read durations from `wall_ms`. The sample above is a real captured line
  (a 6 ms synchronous route under the test client, Windows, Python 3.12).
- `event_loop_cpu_ms` is the CPU the event-loop thread spent while the request was open. It is not the request's own
  CPU: a synchronous route (and its serialisation) runs on a worker thread and never shows here, while every other
  coroutine and request the loop ran meanwhile does. `process_cpu_ms` is the whole process over the request,
  concurrent work included. Both are load figures; neither places the GIL time of one request.
  Both CPU figures are scheduler-tick granular on Windows (about 15.6 ms): below one tick they read 0.0 or 15.6.
- The middleware is added only when the process prewarms (`prewarm_enabled`: NQT_DESKTOP or NQT_PREWARM is `1`). An app
  that does not prewarm keeps its middleware stack as it was, which `tests/test_route_refusal_walk.py` pins.
- The window closes at the first of: `request_timing.close_window(app)`, the prewarm thread having run and ended, and
  60 s after the app was built. Closed windows stay closed. With `NQT_DESKTOP=1` and `NQT_PREWARM=0` there is no stage
  to end the window, so it runs to the 60 s cap.

## Wiring for the merge (files this slice does not own)

`backend/nq_terminal/api/home_prewarm.py`, in `_trim_after`, so the window closes when the HOME tasks stage ends:

```python
from nq_terminal.desktop import request_timing
from nq_terminal.services.prewarm import STAGE_TASKS   # add STAGE_TASKS to the existing import

    def after(stage: str) -> None:
        if stage == STAGE_TASKS:
            request_timing.close_window(app)
        if stage in TRIM_STAGES:
            trim(stage)
```

Without it the window still closes by itself (prewarm thread ended, or 60 s), so nothing breaks; it only runs longer.

`backend/nq_terminal/desktop/__init__.py` docstring could list `request_timing` (cosmetic).

## 03 Appendix A addendum

| Item | Kind | Fate |
| --- | --- | --- |
| `backend/nq_terminal/desktop/request_timing.py` | new module (middleware, `TimingWindow`, `install`, `close_window`) | kept; measurement aid, silent outside the HOME window |
| `handshake.DistWalk` (daemon thread `nqt-dist-walk`), `build_stamp.dist_status` keyword arguments `newest_ms` and `contract_sha` | new class, new arguments | kept; used by the READY line (`dist_status_quick` and `top_level_newest_ms` were removed in the fix round) |
| `handshake.schedule_dist_check` | new function, daemon thread `nqt-dist-check` | kept |
| `app.__getattr__` | module attribute `app` made lazy | kept |
| `ResponseModel` `defer_build=True` | config change | kept |
| `api/regimes_capacity_term._service` | new private function | kept |
| log line `request timing: ...` | new log line, HOME window only | kept |
| log line `the READY line said the page build is ...` | new warning, only on a disagreement | kept |
| `backend/tests/test_ready_payload_walk.py`, `test_import_budget.py`, `test_request_timing.py` | new tests | kept |
| routes, state-folder files, environment variables | none added | |

## Tests and born-failing cases

See the report of the builder. Born-failing cases: importing `__main__` builds no app; `ready_payload` with a walk that
raises; the lazy modules absent from `sys.modules` after importing `nq_terminal.app`; the response models unbuilt after
`create_app`; no timing line after the window closes; no query string in the log. Regression guards (they pass on
today's tree and exist to keep behaviour): the lazy `app` builds once and equals the import form; the quick status
equals the full status when no deep source changed; the READY field order; the route and OpenAPI baselines in
`test_startup_imports.py`.
