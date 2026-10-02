# 00 Inventory: backend and QA

Date checked: 2026-10-02. Scope: `terminal/backend/nq_terminal`, `terminal/qa`, `terminal/scripts`, the launchers, and how the backend reaches nq-lab's data and source. This is the "what exists" half of the migration plan: every piece gets a row here so the plan can give it a fate. It decides nothing about the target stack.

## 0. How this was produced, and how far to trust it

- Source of the tables: scan scripts in `nq-lab/desktop_research/tools/backend/`, outside the terminal repository (listed in section 12). Module rows come from an AST walk of every `.py` file under `nq_terminal` (110 files), so none can be missed. Routes come from the live FastAPI app object (`iter_route_contexts` plus the generated OpenAPI document), not from reading decorators. Import tables come from `sys.modules` after the app was built and every GET route was called once (the "census").
- Code state: HEAD `c7f9e61` (v2) plus 108 uncommitted changes in the working tree made by another run while this inventory was taken (some in analytics, spa, the tests and the QA package). Line counts are the working tree on 2026-10-02; they can drift by a few lines per file. Treat module line counts as +/- 1 percent.
- Measurements were taken on the owner's Windows 11 machine (AMD Ryzen 9 9950X3D2, 16 cores, 32 GB, about 4.6 GB free at the time), which was busy with other work, so every time is indicative, not a benchmark. Nothing was shown on screen: the app was driven in process (no window, no browser) and one server was started with no console window on a spare high port, then stopped by its own process id. Port 8765 was never contacted.
- Nothing was written under `results/`, `data/` or `live/`. A guard (Python audit hook) refused any write-mode open under those folders during the sweep and recorded 0 attempts. The one write the terminal can make there, the gate's access-log line on a price read, was redirected to a scratch file in the sweep, and the live server was only sent routes that never reach the gate (checked: they leave no log line).
- Real data was used (not the test fixtures): 23 registered hypotheses, 71 Nautilus runs, the processed price files, the live journals.
- Not measured: `/api/live/stream` (a stream, read from its code), the write routes (`POST` and `DELETE /api/jobs`), the Interactive Brokers snapshot (off by default; the route answers `disabled`), and any macOS behaviour (no Mac was reachable).

## 1. Headline numbers

| Item | Value |
|---|---|
| Backend modules | 110 files in the working tree, 21,021 lines (16,757 code lines). At HEAD: 103 files, 20,012 lines. The other 7 files are new and uncommitted (in-progress LV6 expectation and effective-trials work) |
| Pure computation modules | 84 of 110 (no file, network, subprocess or IB call found in the module by the scan; the price gate is reached by injection, so `services/bars.py` is flagged separately) |
| Modules that touch the outside world | 26: file I/O 21, subprocess 1 (`services/jobs.py`), IB or network 4 |
| HTTP operations | 76 in OpenAPI: 74 GET (one is the stream), 1 POST and 1 DELETE (both on /api/jobs); plus FastAPI's own `GET /api/openapi.json`. 235 schemas |
| Streaming routes | 1 (`GET /api/live/stream`, Server-Sent Events); everything else is request and response JSON |
| Runtime third-party distributions | 33 (installed size 596 MB of 646 MB in the whole venv) |
| Largest runtime weights | nautilus_trader 317 MB (loaded only by `GET /api/jobs`), scipy 103 MB, pyarrow 83 MB, numpy 40 MB, pandas 37 MB |
| scipy surface actually used | 14 functions (see section 5) |
| nq_lab modules loaded at runtime | 45 modules, 6,886 lines |
| Cold start to first `/api/health` | 2.6 to 3.1 s (3 runs); importing the app alone takes about 2.4 s of that (plain import, one measurement) |
| Resident memory (working set) | 186 MB at ready, 299 to 300 MB after 16 typical routes (peak 319 MB); 1170 MB (peak 1464 MB) after the sweep of every GET route |
| Committed memory | 1627 MB at ready, 1739 MB after 16 routes, 2887 MB after the full sweep (virtual commit, not RAM; see section 6) |
| Backend tests | 2984 collected in 130 files (26,016 lines) |
| QA crosscheck | 85 dumps, 2,455 PASS, 0 FAIL, 0 SKIP, 104 INFO (documented differences); 296 QA tests; 4 golden files |
| Data the backend can read | processed prices 2.6 GB (9,299 files incl. repair records), results 48 MB, run folders 167 MB (71 runs), live logs under 1 MB |

Findings that matter most for the plan, each detailed below:

1. The backend is thin glue over a small numeric core. Of 110 modules, 84 are pure; the API layer, the models and the services are mostly file reads plus shaping. The numeric core is `analytics/` (4,770 lines, 26 modules) plus parts of `services/` that call it.
2. The scientific stack is used far less than its install size suggests. scipy is imported for 14 functions in the working tree and 13 at HEAD: the normal pdf, cdf, survival function and quantile, the Student t quantile, `ttest_ind`, `skew`, `kurtosis`, `jarque_bera`, `probplot`, plus hierarchical clustering helpers. It costs 103 MB on disk and about 0.65 s of start-up.
3. Two analytics modules reproduce numpy's random stream exactly (`np.random.default_rng(seed)`: `integers` then `random`, PCG64), so that the stationary bootstrap and the SPA test match the reference library draw for draw. A port in another language must reproduce that generator bit for bit, or the strict crosscheck will fail by design.
4. pandas is the real coupling: 13 modules each make more than 20 pandas references (time-zone aware indexes, rolling windows, group-bys, merge-as-of, calendars). It is the largest porting cost, not scipy.
5. The nq-lab research gate is not in the terminal. Prices come only through `nq_lab.data.serve`, which lives in the research repository and reads parquet through pyarrow. The terminal adds a catalogue (parquet footers), a year-aligned cache and a refusal layer on top.
6. `GET /api/jobs` is the only route that pulls `nautilus_trader` into the server process: in a fresh-process sweep of all 75 measured URLs, with that route last, nothing else loaded it, and none of `ibapi`, `sklearn`, `statsmodels`, `arch` or `quantstats` loaded. The cause is the strategy registry that `models/jobs.py` imports lazily to validate the stored job specs. The backtest itself runs in a child process (`backtests/run_base.py`). A native shell can drop NautilusTrader from its own process entirely and keep it as an external tool the job queue starts.
7. 8 routes take more than a second cold on this machine, and several recompute on every call (section 4).

## 2. Architecture in one page

Request path: browser or webview -> uvicorn (plain `h11`, asyncio, no `uvloop`, no `httptools`) -> four ASGI middlewares (security headers, loopback-only peer check, trusted host `127.0.0.1` and `localhost`, same-origin guard for `/api`) -> FastAPI router -> a plain `def` handler (run on the anyio worker thread pool; 75 of 77 registered handlers are sync, 2 are async: the SSE stream and FastAPI's own OpenAPI route) -> a service object held on `app.state` -> files read through `FileCache`, prices read through the injected gate function.

- Process model: one Python process. A thread pool runs the sync handlers. One daemon thread (`nqt-jobs`) runs the backtest queue. The venv's `python.exe` is a launcher stub (4 MB) that starts the real interpreter as a child, so Task Manager shows two processes per terminal.
- Read-only by construction: `create_app` refuses to build if any route other than GET and HEAD exists, except exactly `POST /api/jobs` and `DELETE /api/jobs/{job_id}`; the only mount is a plain `StaticFiles` of `web/dist`; the API docs pages are off. Tests scan the source with the AST for forbidden names (IB order calls, parquet reads outside the gate, writes outside `terminal/state`).
- State: no database. Everything is files. The terminal's own writable state is `terminal/state/jobs.json` (queue history, 200 entries) and the append-only gate log `results/oos_access_log.jsonl` (one line per price read, written by `nq_lab.oos_gate`, not by the terminal).
- Caches (all in memory, rebuilt on start): `FileCache` (entries keyed on path, validated by mtime and size, bounded by entries and bytes, parquet refused), `GatedBarCache` (year-aligned frames, byte cap `NQT_CACHE_BYTES`, default 2 GiB, set to 256 MiB in these measurements), a run index rescanned on a timer, journal monitors for the live screens.
- Contract: `terminal/contract/openapi.json` (607 kB) is generated from the app and checked in; the front end generates its TypeScript types from it and a test fails on drift. 235 schemas, most of them response bodies. Any new backend must either serve the same contract or the front end types move with it.
- Environment variables read: `NQT_PORT`, `NQT_CACHE_BYTES`, `NQT_FIXTURE_DIR`, `NQT_IB_READONLY`, `IB_HOST`, `IB_PORT`, `IB_ACCOUNT_ID`, `IB_BASE_USD_RATE`; the job runner passes `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` to the child. The bind host is a constant (`127.0.0.1`), never an option.

Layer totals (working tree):

| Layer | Files | Lines |
|---|---|---|
| `(top level)` | 7 | 922 |
| `analytics` | 26 | 4,779 |
| `api` | 22 | 3,059 |
| `models` | 23 | 3,611 |
| `services` | 32 | 8,650 |

## 3. Module table (one row per file)

Kind is derived from the module's imports and calls: `pure` means no file, network, subprocess or IB use. "pandas / numpy refs" counts attribute uses of `pd.` and `np.` in the module (a size signal for porting cost, not a quality measure). "Reached from" is the set of route modules that import the module directly or through other modules (import reachability: an upper bound, since a route module may import a service it uses for one route only).

| Module | Lines | Kind | Role (first docstring sentence) | From nq_lab / Nautilus | Third party | pandas / numpy refs | Reached from |
|---|---|---|---|---|---|---|---|
| `__init__.py` | 3 | pure | nq-lab terminal backend: a read-only FastAPI service over nq-lab's research files and gated data. | - | - | - | 16 of 21 route modules |
| `__main__.py` | 34 | pure | Start the terminal on 127.0.0.1 only: `python -m nq_terminal` with `terminal/backend` on the path. | - | uvicorn | - | start-up only |
| `analytics/__init__.py` | 9 | pure | Pure analytics functions over numpy and pandas arrays (ANALYTICS_CATALOG.md; TASKS Phase 3). | - | - | - | 8 of 21 route modules |
| `analytics/_inputs.py` | 56 | pure | Input checks shared by perf, drawdown, rolling, distribution and risk. | - | numpy, pandas | pd 7 / np 3 | 8 of 21 route modules |
| `analytics/bootstrap.py` | 272 | pure | Stationary bootstrap (ANALYTICS_CATALOG section 7: SV5 confidence intervals, SV6 cone). | - | numpy, pandas | pd 2 / np 75 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/capacity.py` | 172 | pure | EX5 capacity of a Nautilus run (ANALYTICS_CATALOG section 9). | - | numpy, pandas | pd 10 / np 6 | regimes_capacity_term |
| `analytics/deflated.py` | 134 | pure | SV3 Deflated Sharpe Ratio over the registry (ANALYTICS_CATALOG section 7, SV3 and the construction SV3a). | - | numpy, pandas, scipy | pd 1 / np 7 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/distribution.py` | 96 | pure | Return distributions (ANALYTICS_CATALOG.md section 4: RD1 histogram, RD2 monthly heatmap and yearly bars). | - | numpy, pandas, scipy | pd 4 / np 7 | 8 of 21 route modules |
| `analytics/drawdown.py` | 79 | pure | Drawdowns (ANALYTICS_CATALOG.md section 2: DD1 underwater series and max drawdown, DD2 episode table). | - | numpy, pandas | pd 3 / np 13 | 8 of 21 route modules |
| `analytics/excursions.py` | 157 | pure | TA2 maximum adverse and favourable excursion (ANALYTICS_CATALOG section 8). | - | numpy, pandas | pd 7 / np 27 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/expectation.py` (new, uncommitted) | 273 | pure | LV6 and LV6b: the paper book against its backtest expectation (ANALYTICS_CATALOG section 13). | - | numpy, pandas | pd 8 / np 3 | paper_expectation |
| `analytics/exposure.py` | 482 | pure | Exposure and costs of a Nautilus run (ANALYTICS_CATALOG.md section 9: EX1 to EX4). | calendar_effects | numpy, pandas | pd 2 / np 37 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/neff.py` (new, uncommitted) | 242 | pure | SV3b effective number of trials and SV8 effective number of members, served by the backend (ANALYTICS_CATALOG SV3b and SV8 step... | - | numpy, scipy | pd 0 / np 22 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/perf.py` | 229 | pure | Performance (ANALYTICS_CATALOG.md section 1: PF1 to PF6 and the PF10 stats table). | - | numpy, pandas, scipy | pd 6 / np 14 | 8 of 21 route modules |
| `analytics/regimes.py` | 79 | pure | RG1 volatility regimes (ANALYTICS_CATALOG section 10). | - | numpy, pandas, scipy | pd 11 / np 4 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/relative.py` | 137 | pure | Benchmark-relative analytics (ANALYTICS_CATALOG section 6: BR1 and BR2). | sizing_stats | numpy, pandas | pd 12 / np 9 | 8 of 21 route modules |
| `analytics/risk.py` | 167 | pure | Risk (ANALYTICS_CATALOG.md section 5: RK1 historical VaR and CVaR, RK2 21-session loss distribution). | - | numpy, pandas, scipy | pd 1 / np 8 | 8 of 21 route modules |
| `analytics/risk_extras.py` | 176 | pure | P2 risk extras (ANALYTICS_CATALOG RK4 in section 5, PF11 in section 1, BR5 in section 6). | - | numpy, scipy | pd 0 / np 3 | risk_extras |
| `analytics/rolling.py` | 145 | pure | Rolling statistics (ANALYTICS_CATALOG.md section 3: RL1 rolling Sharpe, RL2 rolling volatility, RL5 blocks). | - | numpy, pandas | pd 13 / np 1 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/seasonality.py` | 201 | pure | SEAS seasonality (TASKS Phase 11): descriptive grouping of a return series by calendar period. | - | numpy, pandas | pd 25 / np 29 | events, seasonality |
| `analytics/series.py` | 455 | pure | Series builders (TASKS 3.1; ANALYTICS_CATALOG C1, C2, C6; ARCHITECTURE section 4, item (g)). | calendar_effects, config, dtsmom_panel, sessions | numpy, pandas | pd 48 / np 6 | 8 of 21 route modules |
| `analytics/spa.py` | 208 | pure | SV8: White's Reality Check, a non-studentised SPA (arch's form) and Romano-Wolf StepM over a family of models (SV8). | - | numpy | pd 0 / np 67 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/stress.py` | 76 | pure | RK5 stress windows table (ANALYTICS_CATALOG section 5). | - | numpy, pandas | pd 9 / np 7 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/term_structure.py` | 146 | pure | MV6 term structure from the calendar chains (ANALYTICS_CATALOG section 11). | (pkg), carry_signal, config | numpy, pandas | pd 8 / np 2 | regimes_capacity_term |
| `analytics/tracking.py` | 124 | pure | LV5 paper against model tracking (ANALYTICS_CATALOG section 13). | (pkg) | numpy | pd 0 / np 1 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/trades.py` | 301 | pure | Trade analytics (ANALYTICS_CATALOG.md section 8: TA1, TA3, TA6). | - | numpy, pandas, scipy | pd 8 / np 24 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `analytics/trend_regime.py` | 84 | pure | RG2 trend regime (ANALYTICS_CATALOG section 10). | - | numpy, pandas, scipy | pd 11 / np 1 | regimes_capacity_term |
| `analytics/validity.py` | 279 | pure | Statistical validity (ANALYTICS_CATALOG section 7: SV1, SV2, SV4, SV7) and the PF4 Sharpe interval. | sizing_stats | numpy, pandas, scipy | pd 6 / np 38 | 8 of 21 route modules |
| `api/__init__.py` | 1 | pure | GET-only API routers. | - | - | - | live_stream |
| `api/analytics.py` | 360 | I/O | Analytics endpoints (ARCHITECTURE s4 Analytics; TASKS 3.3; UI_SPEC s7 tear sheet and HOME [B]). | - | fastapi, pandas | pd 14 / np 0 | 15 routes (below) |
| `api/audit.py` | 153 | pure | Audit endpoints (GET only): the OOS access log, the openings with their pin status, and spec hashes. | (pkg), config | fastapi | - | 3 routes (below) |
| `api/commands.py` | 92 | I/O | GET /api/commands: the mnemonic list and the context index for the command line and HELP (UI_SPEC s5). | dtsmom_universe | fastapi | - | 1 route (below) |
| `api/data.py` | 473 | I/O | Data endpoints (GET only): /api/bars, /api/data/catalog, /api/market/universe, /api/market/pair-corr, /api/market/rv (GP's RV22... | (pkg), config, dtsmom_universe, sessions | fastapi, pandas | pd 17 / np 0 | 8 routes (below) |
| `api/dq.py` | 45 | pure | DQ endpoints (GET only): the data quality calendar (RI4) and the guard fingerprint status (RI5). | - | fastapi | - | 3 routes (below) |
| `api/events.py` | 195 | pure | Event study endpoints (GET only, EVT, Phase 11): /api/events/calendar and /api/events/study. | config, dtsmom_universe | fastapi, pandas | pd 2 / np 0 | 2 routes (below) |
| `api/ib.py` | 41 | IB | The read-only IB snapshot endpoint (ARCHITECTURE s4 and s8; PRD U3). | - | fastapi | - | 1 route (below) |
| `api/instruments.py` | 50 | I/O | Instrument endpoint (GET only): `/api/instruments/{root}`, the instrument DES tabs (`services.instruments`). | - | fastapi | - | 1 route (below) |
| `api/jobs.py` | 163 | pure | JOBS endpoints (ARCHITECTURE sections 8 and 9, PRD U3): the backtest queue. | - | fastapi, pydantic | - | 4 routes (below) |
| `api/live.py` | 238 | I/O | Live endpoints, strictly read only (GET): paper book status, journals, Nautilus logs and the performance path. | (pkg), live_guards | fastapi | - | 5 routes (below) |
| `api/live_stream.py` | 309 | pure | GET /api/live/stream: the LIVE and JRNL data as Server-Sent Events (TASKS 9.2), strictly read only. | (pkg) | anyio, fastapi | - | 1 route (below) |
| `api/paper_expectation.py` (new, uncommitted) | 51 | pure | LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13): `GET /api/analytics/paper-expectation?file=`. | - | fastapi | - | paper_expectation |
| `api/regimes_capacity_term.py` | 105 | pure | P2 endpoints (GET only; TASKS Phase 12): RG2 trend regime, EX5 capacity and MV6 term structure. | - | fastapi | - | 4 routes (below) |
| `api/research.py` | 114 | pure | Research endpoints (ARCHITECTURE s4 Research), GET only. | - | fastapi | - | 8 routes (below) |
| `api/risk_extras.py` | 48 | pure | P2 risk extras routes (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). | - | fastapi | - | 2 routes (below) |
| `api/roll.py` | 95 | I/O | ROLL endpoints (GET only; TASKS Phase 11): /api/market/rolls (the roll calendar, ANALYTICS MV10, gaps as MV2) and /api/market/p... | dtsmom_universe | fastapi | - | 2 routes (below) |
| `api/runs.py` | 156 | pure | Runs endpoints (ARCHITECTURE section 4, Runs; TASKS 2.1). | - | fastapi | - | 10 routes (below) |
| `api/seasonality.py` | 157 | pure | SEAS endpoints (TASKS Phase 11), GET only, all descriptive and [POST HOC] with no p-value: - `/api/seasonality/instrument/{root... | config, dtsmom_universe | fastapi | - | 2 routes (below) |
| `api/spa.py` | 35 | pure | SV8 endpoint (ANALYTICS_CATALOG SV8; TASKS Phase 12). | - | fastapi | - | 1 route (below) |
| `api/system.py` | 90 | pure | System endpoints: GET /api/health. | (pkg), config | fastapi | - | 1 route (below) |
| `api/vcone.py` | 88 | pure | VCONE endpoints (GET only; TASKS Phase 11): the volatility cone of one universe symbol and the small multiples across the 27 fu... | dtsmom_universe | fastapi | - | 2 routes (below) |
| `app.py` | 154 | I/O | FastAPI app for the nq-lab terminal: read-only, GET only (bar the two JOBS writes), loopback only, one origin. | - | fastapi, starlette | - | every route (middleware / start-up) |
| `constants.py` | 286 | pure | Frozen tables: sealed allowlists and key rules, screen aliases, sealed-window links, rounds, series, mnemonics. | - | - | - | 12 of 21 route modules |
| `des_shapes.py` | 204 | pure | Frozen per-screen extract table for the DES tear sheet (ARCHITECTURE s3.2; UI_SPEC s6 and s7; ANALYTICS RL5, EX4). | - | - | - | 12 of 21 route modules |
| `models/__init__.py` | 1 | pure | Response models (pydantic) for the terminal API. | - | - | - | no route (helper or tests only) |
| `models/analytics.py` | 411 | pure | Response models for the analytics endpoints (ARCHITECTURE s4 Analytics; TASKS 3.3; UI_SPEC s7 tear sheet). | - | pydantic | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `models/analytics_p1.py` (edited, uncommitted) | 353 | pure | Response models for the P1 analytics (TASKS Phase 10; ANALYTICS_CATALOG sections 1 to 10 and 13, P1 rows). | - | pydantic | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `models/audit.py` | 124 | pure | Response models for the audit endpoints: the OOS access log, the openings with their pins, and spec hashes. | - | pydantic | - | audit, commands, instruments |
| `models/common.py` | 100 | pure | Shared response models: the response base, the error body, the Page[T] envelope and the health payload. | - | pydantic | - | 21 of 21 route modules |
| `models/data.py` | 202 | pure | Response models for the data API: bars, the catalog, the futures universe and the QA reports. | - | pydantic | - | 12 of 21 route modules |
| `models/dq.py` | 86 | pure | Response models for the DQ screen (ANALYTICS RI4 data quality calendar, RI5 guard fingerprint status). | - | pydantic | - | dq |
| `models/events.py` | 96 | pure | Response models for the event study (EVT, ANALYTICS MV8, descriptive, [POST HOC]). | - | pydantic | - | events |
| `models/expectation.py` (new, uncommitted) | 81 | pure | Response model of LV6 and LV6b on LIVE (ANALYTICS_CATALOG section 13): the paper book against its backtest expectation, served. | - | pydantic | - | paper_expectation |
| `models/ib.py` | 104 | IB | Response model of the read-only IB snapshot (ARCHITECTURE s8; PRD U3, DL6 and DL15). | - | pydantic | - | ib |
| `models/instruments.py` | 87 | pure | Response model for `GET /api/instruments/{root}`: the instrument DES tabs (the look spec, section 7.3). | - | pydantic | - | instruments |
| `models/jobs.py` | 244 | pure | JOBS models (ARCHITECTURE section 8): the backtest request, a job and the queue listing. | strategies.registry; nautilus_trader (lazy, typing) | pydantic | - | jobs |
| `models/live.py` | 318 | pure | Response models for the read-only live endpoints (ARCHITECTURE s4 "Live", s7; ANALYTICS_CATALOG LV1 to LV4). | - | pydantic | - | 7 of 21 route modules |
| `models/neff.py` (new, uncommitted) | 99 | pure | Response models for SV3b (the effective number of trials, on `DeflatedView.effective_n`) and SV8 step 8 (the effective number o... | - | pydantic | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `models/regimes_capacity_term.py` | 176 | pure | Response models for the P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12; ANALYTICS_CATALOG... | - | pydantic | - | regimes_capacity_term |
| `models/research.py` | 247 | pure | Response models for the research endpoints (ARCHITECTURE s4 Research). | - | pydantic | - | 12 of 21 route modules |
| `models/risk_extras.py` | 72 | pure | Response models for the P2 risk extras (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). | - | pydantic | - | risk_extras |
| `models/roll.py` | 78 | pure | Response models for ROLL, the roll calendar (TASKS Phase 11; ANALYTICS MV10, gaps as MV2), and the MNQ paper book's roll schedule. | - | pydantic | - | roll |
| `models/run_views.py` | 267 | pure | Response models for a run's trade, cost and exposure views (ANALYTICS_CATALOG TA1, TA3 to TA6, EX1 to EX4). | - | pydantic | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `models/runs.py` | 240 | pure | Response models for the Nautilus runs endpoints (ARCHITECTURE section 4, Runs; TASKS 2.1). | - | pydantic | - | 8 of 21 route modules |
| `models/seasonality.py` | 66 | pure | Response model for SEAS, seasonality (TASKS Phase 11). | - | pydantic | - | events, seasonality |
| `models/spa.py` (edited, uncommitted) | 91 | pure | Response model for SV8, the family test over the registered NQ hypotheses (ANALYTICS_CATALOG SV8; TASKS Phase 12). | - | pydantic | - | spa |
| `models/vcone.py` | 68 | pure | Response models for VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised). | - | pydantic | - | vcone |
| `security.py` | 128 | pure | ASGI middlewares that keep the terminal loopback-only and same-origin (ARCHITECTURE section 9). | - | starlette | - | every route (middleware / start-up) |
| `services/amendments.py` | 76 | I/O | Accepted amendments (`results/amendment_acceptances.md`), read only. | - | - | - | 12 of 21 route modules |
| `services/audit.py` | 331 | I/O | Audit services: the OOS access log parser, the openings digest and the spec re-hash (ARCHITECTURE s3.4, RI1, RI2). | config | - | - | audit, commands, instruments |
| `services/bars.py` | 389 | I/O by injection (gate) | Gated bars for the terminal: a year-aligned in-memory cache over an injected serve function (TASKS 2.3). | (pkg), config | numpy, pandas | pd 46 / np 38 | 13 of 21 route modules |
| `services/catalog.py` | 249 | I/O | The data catalog: processed price series listed by file name and described from parquet footers only. | config, data | pandas, pyarrow | pd 7 / np 0 | 12 of 21 route modules |
| `services/dq.py` | 233 | I/O | DQ calendar (ANALYTICS RI4): one state per session and symbol, from the QA and repair records. | - | exchange_calendars | - | dq |
| `services/dq_guards.py` | 96 | I/O | Guard fingerprint status (ANALYTICS RI5): each guard group of `nq_lab.guards` against the lab's own record. | (pkg) | - | - | dq |
| `services/events.py` | 424 | I/O | Event study (EVT, Phase 11, P1, descriptive, [POST HOC]): average cumulative return paths around scheduled macro releases, with... | config, dtsmom_panel | numpy, pandas | pd 20 / np 36 | events |
| `services/fence.py` | 93 | pure | The OOS fence applied to report content before it is served (ARCHITECTURE s9, "fence on every axis"). | config | pandas | pd 2 / np 0 | 12 of 21 route modules |
| `services/files.py` | 400 | I/O | Safe, cached, read-only file access for the terminal: FileCache, the sanitiser and frozen values. | - | pandas | pd 3 / np 0 | 20 of 21 route modules |
| `services/ib_readonly_client.py` | 392 | IB + network | The terminal's one IB client: read-only by construction (ARCHITECTURE s8 and s9; PRD U3, DL6). | live_guards | ibapi | - | ib |
| `services/ib_snapshot.py` | 219 | IB | The read-only IB snapshot behind `GET /api/ib/snapshot` (ARCHITECTURE s8 and s9; PRD U3, DL6 and DL15). | live_guards | - | - | ib |
| `services/instruments.py` | 171 | I/O | The instrument DES (the look spec, section 7.3: `3) Notes`, `4) Contracts (CT)`, related dates, data coverage). | (pkg), config, dtsmom_universe | pandas | pd 2 / np 0 | instruments |
| `services/jobs.py` | 346 | I/O + subprocess | The JOBS backtest queue (ARCHITECTURE section 8, PRD U3): one worker thread, a queue of at most 10 waiting jobs. | - | - | - | jobs |
| `services/journals.py` | 519 | I/O | Live monitor services, read only (ARCHITECTURE s3.5 and s7; ANALYTICS_CATALOG LV1 to LV4). | (pkg) | - | - | 10 of 21 route modules |
| `services/live_routes.py` | 132 | pure | LIVE's Routes and Fills sections (the look spec, section 7.11), read only from one journal's close rows. | (pkg), live_guards | - | - | 7 of 21 route modules |
| `services/market.py` | 229 | pure | The futures universe view (ANALYTICS MV4 and MV5): horizon returns, realised volatility, correlation and cluster order for the... | config, dtsmom_panel, dtsmom_universe | numpy, pandas, scipy | pd 11 / np 12 | 12 of 21 route modules |
| `services/neff_view.py` (new, uncommitted) | 57 | pure | SV3b and SV8 step 8 as response models (ANALYTICS_CATALOG SV3b and SV8): the dicts of `analytics/neff.py` with their labels. | - | - | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/paper_expectation.py` (new, uncommitted) | 194 | pure | LV6 and LV6b on LIVE, served (ANALYTICS_CATALOG section 13; `analytics/expectation.py` holds the arithmetic). | - | numpy | pd 0 / np 3 | paper_expectation |
| `services/regimes_capacity_term.py` | 285 | pure | The P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12; ANALYTICS_CATALOG sections 9, 10 and... | config, dtsmom_panel, dtsmom_universe | numpy, pandas | pd 11 / np 1 | regimes_capacity_term |
| `services/research.py` | 715 | I/O | Research files for the terminal (TASKS 2.2): registry, screens, specs, series, multiple testing, sealed. | (pkg), config, sessions | numpy, pandas | pd 19 / np 3 | 12 of 21 route modules |
| `services/risk_extras.py` | 107 | pure | P2 risk extras of one tear sheet series (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5). | - | - | - | risk_extras |
| `services/roll.py` | 222 | pure | ROLL, the roll calendar (UI_SPEC section 5, P1; ANALYTICS MV10, gaps as MV2; TASKS Phase 11). | (pkg), config, dtsmom_universe | numpy, pandas | pd 12 / np 3 | roll |
| `services/run_books.py` | 209 | I/O | Trade, cost and exposure views of a Nautilus run (ANALYTICS_CATALOG TA1, TA3 to TA6, EX1 to EX4; ARCHITECTURE s4). | (pkg), config, dtsmom_panel | numpy, pandas | pd 2 / np 3 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/runs.py` | 737 | I/O | Nautilus runs from `backtests/output/` (TASKS 2.1; ARCHITECTURE sections 3.1, 4 and 6). | sessions | - | - | 8 of 21 route modules |
| `services/seasonality.py` | 245 | pure | SEAS, seasonality (TASKS Phase 11): an instrument's or a registered hypothesis's returns grouped by calendar month, weekday, we... | config, dtsmom_panel, sessions | numpy, pandas | pd 19 / np 1 | events, seasonality |
| `services/sessions.py` | 116 | I/O | Session quality flags for the GP chart (UI_SPEC s7 GP: `[GATED]` and `[REPAIRED]`; ARCHITECTURE s3.2). | (pkg), config | pandas | pd 5 / np 0 | 13 of 21 route modules |
| `services/spa_family.py` (edited, uncommitted) | 310 | pure | SV8 family and view (ANALYTICS_CATALOG SV8 and its construction; TASKS Phase 12). | config | numpy, pandas | pd 13 / np 2 | spa |
| `services/stored_alpha.py` | 134 | pure | Stored alpha extractor (ANALYTICS_CATALOG BR1: "read from the result JSON where present"). | - | - | - | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/tearsheet.py` | 445 | pure | Tear sheet builder (TASKS 3.3; ARCHITECTURE s4 Analytics; UI_SPEC s7 tear sheet and HOME [B]). | dtsmom_stats | numpy, pandas | pd 12 / np 4 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/tearsheet_extended.py` (edited, uncommitted) | 282 | pure | P1 tear sheet additions (TASKS Phase 10; ANALYTICS_CATALOG P1 rows). | - | numpy, pandas | pd 9 / np 4 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/tearsheet_trades.py` | 127 | pure | P1 trade-path and live tracking views (ANALYTICS_CATALOG TA2 and LV5). | (pkg), config, live_guards | pandas | pd 5 / np 0 | analytics, paper_expectation, regimes_capacity_term, risk_extras, spa |
| `services/vcone.py` | 166 | pure | VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised). | config, dtsmom_panel, dtsmom_universe | numpy, pandas | pd 4 / np 19 | vcone |
| `settings.py` | 113 | I/O | Terminal settings from NQT_* environment variables; the project root comes from nq_lab.config. | config | - | - | every route (middleware / start-up) |

Notes on the table:

- Lazy imports exist in `app.py` (analytics, instruments, live_stream, p11 and p12 routers are imported inside `create_app`) and `models/jobs.py` (the strategy registry and `nautilus_trader.trading.config`, imported inside a function). They are why the census shows `nautilus_trader` loading only after the first `/api/jobs` call.
- `services/ib_readonly_client.py` is the only file that imports the Interactive Brokers library (`ibapi`, shipped as `nautilus_ibapi`), and `services/ib_snapshot.py` imports it only inside a function, so with the snapshot off (the default) it is never loaded.

## 4. API route table (every route)

Size classes (largest measured body): XS under 2 kB, S under 20 kB, M under 200 kB, L under 1 MB, XL above. Cost classes (largest cold time, in process, no HTTP): light under 50 ms, medium under 500 ms, heavy under 2 s, very heavy above. "Cold / warm" is the first and the second call of the same URL in the same process, so warm shows what the service caches save. Where a cell has two pairs the route was measured with two parameter sets (`/api/bars`: daily bars, then one month of 1m bars), written as cold / warm; the OS file cache was warm for most reads, so first-ever reads of cold files are slower. Parameters used: first registered hypothesis `za_v0`, run `nt_dtsmom_v0_lo0` (71 readable runs), root `NQ`, symbol `NQ.V.0`. Responses are uncompressed JSON (no gzip middleware).

| Method | Path | Handler | Mode | Streaming | Query (* required) | Size | Body measured | Cost | Cold / warm ms (in process) |
|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/openapi.json` | `fastapi.openapi` | async | no | - | L | 280.3 kB | heavy | 917 / 6 |
| GET | `/api/health` | `system.health` | sync | no | - | XS | 394 B | light | 28 / 34 |
| GET | `/api/audit/oos-log` | `audit.oos_log` | sync | no | caller, since, limit, offset | L | 247.0 kB | medium | 160 / 8 |
| GET | `/api/audit/openings` | `audit.openings` | sync | no | - | XS | 1.0 kB | light | 39 / 34 |
| GET | `/api/audit/spec-hashes` | `audit.spec_hashes` | sync | no | - | S | 8.2 kB | light | 19 / 14 |
| GET | `/api/live/status` | `live.status` | sync | no | - | XS | 1.6 kB | light | 4 / 3 |
| GET | `/api/live/journal` | `live.journal` | sync | no | file, type, offset, limit | XS | 520 B | light | 3 / 3 |
| GET | `/api/live/log` | `live.log` | sync | no | file*, tail | M | 51.6 kB | light | 7 / 104 |
| GET | `/api/live/performance` | `live.performance` | sync | no | file | XS | 461 B | light | 3 / 3 |
| GET | `/api/live/routes` | `live.routes` | sync | no | file | XS | 673 B | light | 4 / 2 |
| GET | `/api/commands` | `commands.commands` | sync | no | - | S | 6.1 kB | light | 12 / 11 |
| GET | `/api/registry` | `research.registry` | sync | no | - | S | 10.8 kB | light | 5 / 4 |
| GET | `/api/hypotheses` | `research.hypotheses` | sync | no | - | M | 29.7 kB | light | 40 / 37 |
| GET | `/api/hypotheses/{name}` | `research.hypothesis` | sync | no | - | S | 10.8 kB | light | 14 / 13 |
| GET | `/api/hypotheses/{name}/series` | `research.hypothesis_series` | sync | no | cost | M | 101.8 kB | light | 17 / 8 |
| GET | `/api/multiple-testing` | `research.multiple_testing` | sync | no | - | S | 7.6 kB | light | 7 / 5 |
| GET | `/api/confirmations` | `research.confirmations` | sync | no | - | XS | 887 B | light | 5 / 4 |
| GET | `/api/sealed` | `research.sealed_index` | sync | no | - | XS | 813 B | light | 5 / 3 |
| GET | `/api/sealed/{name}` | `research.sealed` | sync | no | - | XS | 1004 B | light | 6 / 4 |
| GET | `/api/runs` | `runs.list_runs` | sync | no | - | M | 42.7 kB | light | 50 / 33 |
| GET | `/api/runs/compare` | `runs.compare_runs` | sync | no | ids* | M | 135.6 kB | heavy | 1145 / 280 |
| GET | `/api/runs/stats` | `runs.run_stats` | sync | no | ids* | XS | 447 B | medium | 260 / 240 |
| GET | `/api/runs/{run_id}` | `runs.run_detail` | sync | no | - | S | 11.2 kB | light | 8 / 6 |
| GET | `/api/runs/{run_id}/trades` | `runs.run_trades` | sync | no | offset, limit | M | 172.2 kB | medium | 217 / 18 |
| GET | `/api/runs/{run_id}/fills` | `runs.run_fills` | sync | no | offset, limit | M | 128.0 kB | heavy | 535 / 12 |
| GET | `/api/runs/{run_id}/log/{section}` | `runs.run_log` | sync | no | offset, limit | L | 292.1 kB | light | 29 / 27 |
| GET | `/api/runs/{run_id}/equity` | `runs.run_equity` | sync | no | - | L | 451.8 kB | medium | 60 / 56 |
| GET | `/api/runs/{run_id}/sidecar/{name}` | `runs.run_sidecar` | sync | no | - | S | 8.3 kB | light | 8 / 6 |
| GET | `/api/ledger` | `runs.ledger` | sync | no | - | S | 10.2 kB | very heavy | 4312 / 671 |
| GET | `/api/bars` | `data.get_bars` | sync | no | symbol*, timeframe, variant, start, end, max_points | M | 154.4 kB / 98.4 kB | medium | 34 / 9; 55 / 8 |
| GET | `/api/data/catalog` | `data.data_catalog` | sync | no | - | M | 47.2 kB | light | 49 / 12 |
| GET | `/api/market/universe` | `data.market_universe` | sync | no | window | M | 47.5 kB | medium | 436 / 16 |
| GET | `/api/market/pair-corr` | `data.market_pair_corr` | sync | no | a*, b*, window | M | 123.7 kB | light | 34 / 31 |
| GET | `/api/qa` | `data.qa_index` | sync | no | - | XS | 1.7 kB | light | 9 / 7 |
| GET | `/api/qa/{name}` | `data.qa_report` | sync | no | - | S | 7.5 kB | light | 12 / 10 |
| GET | `/api/market/rv` | `data.market_rv` | sync | no | symbol*, window | M | 127.0 kB | light | 20 / 21 |
| GET | `/api/market/two-day` | `data.market_two_day` | sync | no | symbols | M | 25.5 kB | heavy | 1260 / 891 |
| GET | `/api/analytics/hypothesis/{name}` | `analytics.hypothesis_analytics` | sync | no | cost | L | 792.6 kB | medium | 390 / 178 |
| GET | `/api/analytics/hypothesis/{name}/panel` | `analytics.hypothesis_panel` | sync | no | cost | L | 263.2 kB | medium | 113 / 111 |
| GET | `/api/analytics/run/{run_id}` | `analytics.run_analytics` | sync | no | freq | L | 683.7 kB | medium | 180 / 130 |
| GET | `/api/analytics/run/{run_id}/panel` | `analytics.run_panel` | sync | no | freq | M | 199.5 kB | medium | 80 / 79 |
| GET | `/api/analytics/run/{run_id}/trades` | `analytics.run_trades` | sync | no | - | S | 4.8 kB | medium | 258 / 86 |
| GET | `/api/analytics/run/{run_id}/costs` | `analytics.run_costs` | sync | no | - | S | 3.1 kB | medium | 298 / 314 |
| GET | `/api/analytics/run/{run_id}/exposure` | `analytics.run_exposure` | sync | no | - | XL | 1.49 MB | heavy | 667 / 718 |
| GET | `/api/analytics/hypothesis/{name}/extended` | `analytics.hypothesis_extended` | sync | no | cost | L | 341.3 kB | medium | 279 / 270 |
| GET | `/api/analytics/run/{run_id}/extended` | `analytics.run_extended` | sync | no | freq | M | 79.6 kB | medium | 258 / 272 |
| GET | `/api/analytics/hypothesis/{name}/bootstrap` | `analytics.hypothesis_bootstrap` | sync | no | cost | M | 32.8 kB | heavy | 1408 / 1450 |
| GET | `/api/analytics/run/{run_id}/bootstrap` | `analytics.run_bootstrap` | sync | no | freq | M | 35.8 kB | heavy | 1405 / 1410 |
| GET | `/api/analytics/deflated` | `analytics.deflated_sharpe` | sync | no | - | S | 18.6 kB | heavy | 1062 / 459 |
| GET | `/api/analytics/run/{run_id}/trade-paths` | `analytics.run_trade_paths` | sync | no | - | XS | 1.1 kB | medium | 111 / 102 |
| GET | `/api/analytics/run/{run_id}/excursions` | `analytics.run_excursions` | sync | no | - | XS | 698 B | light | 6 / 5 |
| GET | `/api/analytics/paper-tracking` | `analytics.paper_tracking` | sync | no | file | XS | 649 B | light | 4 / 3 |
| GET | `/api/instruments/{root}` | `instruments.instrument` | sync | no | - | S | 2.9 kB | light | 17 / 12 |
| GET | `/api/live/stream` | `live_stream.stream` | async | yes | - | stream | SSE stream | - | - |
| GET | `/api/market/vcone` | `vcone.market_vcone` | sync | no | symbol* | S | 2.6 kB | medium | 228 / 22 |
| GET | `/api/market/vcone/universe` | `vcone.market_vcone_universe` | sync | no | horizon | S | 10.6 kB | medium | 308 / 320 |
| GET | `/api/seasonality/instrument/{root}` | `seasonality.instrument_seasonality` | sync | no | variant, start_year, end_year | S | 9.2 kB | very heavy | 2268 / 2066 |
| GET | `/api/seasonality/hypothesis/{name}` | `seasonality.hypothesis_seasonality` | sync | no | cost, start_year, end_year | S | 6.0 kB | medium | 249 / 48 |
| GET | `/api/events/calendar` | `events.event_calendar` | sync | no | - | M | 28.6 kB | light | 21 / 14 |
| GET | `/api/events/study` | `events.event_study` | sync | no | symbol, event, mode, pre, post | M | 35.6 kB | medium | 197 / 22 |
| GET | `/api/market/rolls` | `roll.market_rolls` | sync | no | - | L | 322.2 kB | medium | 272 / 265 |
| GET | `/api/market/paper-rolls` | `roll.market_paper_rolls` | sync | no | behind, ahead | XS | 1.5 kB | light | 4 / 4 |
| GET | `/api/dq/symbols` | `dq.symbols` | sync | no | - | S | 8.5 kB | medium | 364 / 394 |
| GET | `/api/dq/calendar/{symbol}` | `dq.calendar` | sync | no | - | M | 175.7 kB | light | 13 / 13 |
| GET | `/api/dq/guards` | `dq.guard_status` | sync | no | - | S | 3.8 kB | light | 41 / 223 |
| GET | `/api/analytics/spa` | `spa.family_spa` | sync | no | - | S | 19.4 kB | very heavy | 3575 / 307 |
| GET | `/api/analytics/hypothesis/{name}/risk-extras` | `risk_extras.hypothesis_risk_extras` | sync | no | cost | S | 2.9 kB | medium | 225 / 50 |
| GET | `/api/analytics/run/{run_id}/risk-extras` | `risk_extras.run_risk_extras` | sync | no | freq | S | 2.6 kB | medium | 87 / 55 |
| GET | `/api/analytics/hypothesis/{name}/trend-regime` | `regimes_capacity_term.hypothesis_trend_regime` | sync | no | cost | M | 137.1 kB | medium | 76 / 79 |
| GET | `/api/analytics/run/{run_id}/trend-regime` | `regimes_capacity_term.run_trend_regime` | sync | no | - | M | 123.6 kB | medium | 96 / 91 |
| GET | `/api/analytics/run/{run_id}/capacity` | `regimes_capacity_term.run_capacity` | sync | no | - | S | 12.0 kB | heavy | 647 / 618 |
| GET | `/api/market/term-structure/{root}` | `regimes_capacity_term.market_term_structure` | sync | no | - | L | 302.2 kB | heavy | 546 / 316 |
| GET | `/api/ib/snapshot` | `ib.ib_snapshot` | sync | no | - | XS | 399 B | light | 4 / 2 |
| GET | `/api/jobs` | `jobs.list_jobs` | sync | no | - | XS | 952 B | light | 2 / 2 |
| POST | `/api/jobs` | `jobs.queue_job` | sync | no | - | - | write, not called | - | - |
| GET | `/api/jobs/{job_id}` | `jobs.read_job` | sync | no | - | XS | 888 B | light | 3 / 3 |
| DELETE | `/api/jobs/{job_id}` | `jobs.remove_job` | sync | no | - | - | write, not called | - | - |

Distribution over the 74 measured GET routes (the schema route included, the stream excluded): sizes XS 18, S 23, M 22, L 10, XL 1; cost heavy 10, light 36, medium 25, very heavy 3.

Slowest cold routes (in process): `/api/ledger` 4,312 ms, `/api/analytics/spa` 3,575 ms, `/api/seasonality/instrument/{root}` 2,268 ms, `/api/analytics/hypothesis/{name}/bootstrap` 1,408 ms, `/api/analytics/run/{run_id}/bootstrap` 1,405 ms, `/api/market/two-day` 1,260 ms, `/api/runs/compare` 1,145 ms, `/api/analytics/deflated` 1,062 ms. Largest bodies: `/api/analytics/run/{run_id}/exposure` 1.49 MB, `/api/analytics/hypothesis/{name}` 792.6 kB, `/api/analytics/run/{run_id}` 683.7 kB, `/api/runs/{run_id}/equity` 451.8 kB, `/api/analytics/hypothesis/{name}/extended` 341.3 kB, `/api/market/rolls` 322.2 kB.

Fresh server over real HTTP, first call of each route after start (three starts; milliseconds, minimum to maximum). This is the number a user feels on first open; `/api/runs` builds the run index and `/api/ledger` parses the ledger on the first call:

| Route | First call, ms |
|---|---|
| `/api/health` | 24 to 26 |
| `/api/hypotheses` | 146 to 174 |
| `/api/runs` | 1318 to 1419 |
| `/api/registry` | 23 to 27 |
| `/api/commands` | 12 to 37 |
| `/api/runs/nt_dtsmom_v0_lo0` | 3 to 22 |
| `/api/data/catalog` | 54 to 69 |
| `/api/qa` | 7 to 24 |
| `/api/sealed` | 13 to 27 |
| `/api/audit/oos-log` | 134 to 163 |
| `/api/audit/openings` | 29 to 51 |
| `/api/live/status` | 313 to 352 |
| `/api/ledger` | 3846 to 4302 |
| `/api/multiple-testing` | 18 to 28 |
| `/api/runs/nt_dtsmom_v0_lo0/equity` | 495 to 532 |
| `/api/runs/nt_dtsmom_v0_lo0/trades` | 169 to 189 |

Observations for the plan:

- 41 of the measured routes return under 20 kB; the large ones are series for charts (equity, exposure, bars, analytics panels), all JSON today. Moving to a binary column format between backend and UI would shrink the biggest bodies but changes the contract.
- Warm times equal cold times for several heavy routes (`/api/market/two-day`, `/api/analytics/*/bootstrap`, `/api/seasonality/instrument/{root}`, `/api/analytics/run/{run_id}/capacity`, `/api/dq/symbols`): they recompute on every call. These are the first candidates for a native rewrite or a result cache.
- Every handler is synchronous except the stream and FastAPI's schema route. The concurrency model is therefore "thread pool of blocking calls", which maps directly onto a native thread pool.

## 5. Dependencies actually imported at runtime

Method: the census of `sys.modules` after the app was built ("app start") and after every GET route was called ("first use of a route"). Sizes are the sum of the files each distribution lists on disk (site-packages, Windows wheels, Python 3.12.12). The base interpreter (uv-managed CPython 3.12.12) is separate: 67 MB on disk. uvicorn, `h11` and `click` are added by the server entry point; they were measured in a separate import. Versions are the installed ones.

| Distribution | Version | Installed MB | Native extension | Loaded | Imported directly by |
|---|---|---|---|---|---|
| `nautilus_trader` | 1.231.0 | 317.2 | yes, 111 files (account.cp312-win_amd64.pyd, actor.cp312-win_amd64.pyd) | on first use of a route | transitive only |
| `scipy` | 1.18.1 | 103.0 | yes, 107 files (__odrpack.cp312-win_amd64.pyd, _ansari_swilk_statistics.cp312-win_amd64.pyd) | app start | analytics.deflated, analytics.distribution, analytics.neff (+8) |
| `pyarrow` | 25.0.1 | 82.5 | yes, 33 files (_acero.cp312-win_amd64.pyd, _azurefs.cp312-win_amd64.pyd) | app start | services.catalog |
| `numpy` | 2.5.3 | 40.1 | yes, 21 files (_bounded_integers.cp312-win_amd64.pyd, _common.cp312-win_amd64.pyd) | app start | analytics._inputs, analytics.bootstrap, analytics.capacity (+35) |
| `pandas` | 2.3.3 | 36.6 | yes, 45 files (aggregations.cp312-win_amd64.pyd, algos.cp312-win_amd64.pyd) | app start | analytics._inputs, analytics.bootstrap, analytics.capacity (+39) |
| `pydantic_core` | 2.46.5 | 5.2 | yes, 1 files (_pydantic_core.cp312-win_amd64.pyd) | app start | transitive only |
| `pydantic` | 2.13.5 | 1.8 | no (pure Python) | app start | api.jobs, models.analytics, models.analytics_p1 (+20) |
| `zstandard` | 0.25.0 | 1.3 | yes, 2 files (_cffi.cp312-win_amd64.pyd, backend_c.cp312-win_amd64.pyd) | on first use of a route | transitive only |
| `pytz` | 2026.4 | 1.0 | no (pure Python) | app start | transitive only |
| `exchange_calendars` | 4.13.2 | 0.8 | no (pure Python) | app start | services.dq |
| `fastapi` | 0.141.1 | 0.8 | no (pure Python) | app start | api.analytics, api.audit, api.commands (+19) |
| `fsspec` | 2026.2.0 | 0.7 | no (pure Python) | on first use of a route | transitive only |
| `charset-normalizer` | 3.5.1 | 0.6 | yes, 2 files (cd.cp312-win_amd64.pyd, md.cp312-win_amd64.pyd) | app start | transitive only |
| `tzdata` | 2026.4 | 0.6 | no (pure Python) | app start | transitive only |
| `anyio` | 4.15.1 | 0.5 | no (pure Python) | app start | api.live_stream |
| `python-dateutil` | 2.9.0.post0 | 0.4 | no (pure Python) | app start | transitive only |
| `httpx2` | 2.13.1 | 0.4 | no (pure Python) | on first use of a route | transitive only |
| `idna` | 3.20 | 0.4 | no (pure Python) | on first use of a route | transitive only |
| `msgspec` | 0.21.1 | 0.4 | yes, 1 files (_core.cp312-win_amd64.pyd) | on first use of a route | transitive only |
| `orjson` | 3.12.0 | 0.3 | yes, 1 files (orjson.cp312-win_amd64.pyd) | app start | transitive only |
| `starlette` | 1.7.0 | 0.3 | no (pure Python) | app start | app, security |
| `toolz` | 1.1.0 | 0.2 | no (pure Python) | app start | transitive only |
| `typing_extensions` | 4.16.0 | 0.2 | no (pure Python) | app start | transitive only |
| `cloudpickle` | 3.1.2 | 0.1 | no (pure Python) | app start | transitive only |
| `portion` | 2.6.2 | 0.1 | no (pure Python) | on first use of a route | transitive only |
| `pyluach` | 2.3.0 | 0.1 | no (pure Python) | app start | transitive only |
| `sortedcontainers` | 2.4.0 | 0.1 | no (pure Python) | on first use of a route | transitive only |
| `typing-inspection` | 0.4.4 | 0.1 | no (pure Python) | app start | transitive only |
| `annotated-doc` | 0.0.5 | 0.0 | no (pure Python) | app start | transitive only |
| `annotated-types` | 0.8.0 | 0.0 | no (pure Python) | app start | transitive only |
| `korean_lunar_calendar` | 0.4.0 | 0.0 | no (pure Python) | app start | transitive only |
| `six` | 1.17.0 | 0.0 | no (pure Python) | app start | transitive only |
| `sniffio` | 1.3.1 | 0.0 | no (pure Python) | app start | transitive only |

Added by `python -m nq_terminal` or by an opt-in feature (not in the census above, because the app object was driven in process or the feature was off):

| Distribution | Version | Installed MB | Native extension | When |
|---|---|---|---|---|
| `uvicorn` | 0.54.0 | 0.3 | no | server entry point; plain install, so no `uvloop` and no `httptools`: it runs on the standard asyncio loop |
| `h11` | 0.16.0 | 0.1 | no | HTTP/1.1 parser used by uvicorn |
| `click` | 8.5.0 | 0.4 | no | imported by uvicorn |
| `nautilus_ibapi` (import name `ibapi`) | 10.45.1 | 1.1 | no | only with `NQT_IB_READONLY=1`, and only inside `take_snapshot` |
| `protobuf` | 5.29.6 | 1.6 | yes, 1 file | dependency of the IB library |

Installed but not imported by the terminal: `ibapi` (`nautilus_ibapi 10.45.1`, loaded only when `NQT_IB_READONLY=1`), `scikit-learn 1.9.1` (26 MB, used by research code, not the terminal), `langchain-typesafe` and its tree, `quantpad-data`, `pytest`. The QA project has its own environment with `statsmodels 0.15.0`, `arch 8.0.0`, `quantstats 0.0.82`, `empyrical-reloaded 0.5.12` and `scipy 1.18.1` (section 9); those never run in the terminal.

What the backend uses from the heavy libraries:

- scipy (14 functions, 11 modules): `scipy.cluster.hierarchy.fcluster`, `scipy.cluster.hierarchy.leaves_list`, `scipy.cluster.hierarchy.linkage`, `scipy.spatial.distance.squareform`, `scipy.stats.jarque_bera`, `scipy.stats.kurtosis`, `scipy.stats.norm.cdf`, `scipy.stats.norm.pdf`, `scipy.stats.norm.ppf`, `scipy.stats.norm.sf`, `scipy.stats.probplot`, `scipy.stats.skew`, `scipy.stats.t.ppf`, `scipy.stats.ttest_ind`. `scipy.stats` appears in ten analytics modules (perf, risk, risk_extras, distribution, validity, regimes, trades, trend_regime, deflated, neff); clustering is in neff and `services/market.py`.
- numpy: array maths everywhere in `analytics/`; `np.linalg.eigvalsh` (neff); `np.random.default_rng` (bootstrap, spa) with the draw order of the `arch` library, which the crosscheck verifies. Any replacement generator must be PCG64 seeded the way numpy seeds it, and must draw `integers(n, size=n)` and then `random(n)` per replication in the same order.
- pandas: most used attributes (counts across the backend): Timestamp (101), DatetimeIndex (44), Timedelta (23), tz_convert (19), to_datetime (16), groupby (14), reindex (13), cumsum (11), where (10), tz_localize (10), rolling (10), dropna (9), quantile (7), cumprod (6). Heavy modules: `services.bars` (46+26), `analytics.series` (48+14), `analytics.seasonality` (25+29), `services.research` (19+22), `services.tearsheet` (12+27), `services.events` (20+13), `services.spa_family` (13+15), `services.seasonality` (19+6), `analytics.trend_regime` (11+11), `api.data` (17+5), `analytics.regimes` (11+10), `analytics.rolling` (13+8). The time-zone rules (US Eastern sessions, UTC bars, a Globex 22:00 UTC day boundary) are carried by pandas time-zone indexes.
- pyarrow: one module (`services/catalog.py`, `parquet.read_metadata`: footers only). All price rows are read inside nq_lab (`pyarrow.dataset` with a `ts` filter).
- exchange_calendars: one module (`services/dq.py`, the NYSE `XNYS` calendar for data-quality day states, from 2010-09-28). It pulls `pyluach`, `korean_lunar_calendar`, `toolz` and `pytz`.
- orjson: imported at start by FastAPI's response module when installed; no terminal code calls it. pydantic 2.13.5 with `pydantic_core` (Rust) validates every response model.

nq_lab modules loaded at runtime (45 modules; the research package has about 33,000 lines, so the terminal's real dependency on it is the set below). "Direct importers" are terminal modules that import the module by name; the rest are pulled in by other nq_lab modules.

| nq_lab module | Lines | Imports nautilus_trader | Direct importers in the terminal |
|---|---|---|---|
| `nq_lab.sizing_tsmom_report` | 352 | no | transitive |
| `nq_lab.strategies.eomtsy` | 325 | yes | transitive |
| `nq_lab.calendar_effects` | 315 | no | analytics.exposure, analytics.series |
| `nq_lab.strategies.sized_book` | 291 | yes | transitive |
| `nq_lab.eomtsy_book` | 283 | no | services.instruments |
| `nq_lab.guards` | 244 | no | api.audit, services.dq_guards |
| `nq_lab.dtsmom_book` | 240 | no | transitive |
| `nq_lab.sizing_tsmom` | 240 | no | transitive |
| `nq_lab.strategies.dtsmom` | 238 | yes | transitive |
| `nq_lab.oos_gate` | 236 | no | api.audit, api.system, services.bars |
| `nq_lab.calendar_report` | 187 | no | transitive |
| `nq_lab.sizing_stats` | 187 | no | analytics.relative, analytics.validity |
| `nq_lab.vt_har_stats` | 182 | no | services.research |
| `nq_lab.eomtsy_calendar` | 180 | no | transitive |
| `nq_lab.carry_expiry` | 170 | no | analytics.term_structure, services.instruments |
| `nq_lab.strategies.overnight` | 170 | yes | transitive |
| `nq_lab.eomtsy_load` | 169 | no | transitive |
| `nq_lab.calendar_stats` | 165 | no | transitive |
| `nq_lab.live_guards` | 163 | no | api.live, api.system, services.ib_readonly_client (+4) |
| `nq_lab.carry_chain` | 160 | no | transitive |
| `nq_lab.strategies.za_orb` | 158 | yes | transitive |
| `nq_lab.nt_daily` | 155 | yes | transitive |
| `nq_lab.calendar_seasonal` | 149 | no | transitive |
| `nq_lab.sizing_book` | 149 | no | transitive |
| `nq_lab.nt_data` | 143 | yes | transitive |
| `nq_lab.strategies.volmanaged` | 137 | no | transitive |
| `nq_lab.mnq_roll` | 134 | no | services.instruments, services.journals, services.roll |
| `nq_lab.paper_plumbing` | 134 | no | analytics.tracking, api.live, api.live_stream (+4) |
| `nq_lab.carry_signal` | 130 | no | analytics.term_structure |
| `nq_lab.data` | 130 | no | api.data, services.catalog, services.sessions |
| `nq_lab.strategies.tsmom` | 126 | no | transitive |
| `nq_lab.dtsmom_panel` | 106 | no | analytics.series, services.events, services.market (+4) |
| `nq_lab.eomtsy_guards` | 104 | no | transitive |
| `nq_lab.sizing_rv` | 100 | no | transitive |
| `nq_lab.dtsmom_guards` | 85 | no | transitive |
| `nq_lab.dtsmom_stats` | 85 | no | services.tearsheet |
| `nq_lab.carry_guards` | 79 | no | transitive |
| `nq_lab.rolls` | 75 | no | transitive |
| `nq_lab.dtsmom_universe` | 66 | no | api.commands, api.data, api.events (+8) |
| `nq_lab.strategies.registry` | 59 | yes | models.jobs |
| `nq_lab.eomtsy_nt_data` | 42 | yes | transitive |
| `nq_lab.sessions` | 28 | no | analytics.series, api.data, services.research (+2) |
| `nq_lab.config` | 13 | no | analytics.series, analytics.term_structure, api.audit (+21) |

The closure includes the strategy modules (`nq_lab.strategies.*`) and book builders (`dtsmom_*`, `eomtsy_*`, `sizing_*`, `nt_*`), most of which import `nautilus_trader`. The terminal loads them only through `/api/jobs` and some analytics services that reuse their statistics (`dtsmom_stats`, `sizing_stats`, `calendar_effects`, `carry_signal`). That is research code the terminal borrows, and the plan must decide per function whether to port, wrap or keep as a Python sidecar.

## 6. Cold start and memory

Method: `python -X importtime` on `import nq_terminal.__main__` (3 runs, wall 2752, 2724, 2963 ms); a server started with `python -m nq_terminal` on a spare port with no window, polled until `/api/health` answers (3 runs), memory read with `GetProcessMemoryInfo` on the real interpreter process (not the launcher stub), the server stopped by process id.

| Measure | Value |
|---|---|
| Bare interpreter start (`python -c pass`) | 84 ms |
| `import pandas` alone | 651 ms |
| `import scipy.stats, scipy.optimize` alone | 993 ms |
| Import of the whole app (`nq_terminal.__main__`, includes the module-level `create_app()`) | 2346 ms under `-X importtime`; 2752, 2724, 2963 ms wall for three runs with `-X importtime`; `create_app()` itself about 0.16 s |
| Modules in `sys.modules` after app start | 1,608 new modules (all third party and nq_lab; the standard library is already loaded) |
| Process start to first `/api/health` 200 | 2.63, 2.66, 3.13 s |
| Working set at ready (real interpreter) | 186, 186, 186 MB; idle after 5 s unchanged |
| Working set after 16 typical routes | 300, 300, 299 MB (peak 319, 319, 319 MB) |
| Working set after all routes incl. bars, analytics, bootstrap (256 MiB bar cache) | 1170 MB (peak 1464 MB) |
| Committed memory | 1627, 1627, 1627 MB at ready; 2887 MB after the sweep. The high commit with a low working set comes from address space the numeric libraries reserve; it is not RAM in use. |
| Launcher stub process | 4.2 MB (venv launcher that starts the interpreter) |

Where start-up time goes (self time summed per top-level package from `-X importtime`, so approximate): scipy 657 ms, the terminal's own modules and their pydantic model building 553 ms, pandas 243 ms, numpy 166 ms, fastapi 113 ms, exchange_calendars 86 ms, pydantic 75 ms, pyarrow 68 ms.

Reading it: nearly all of the 2.6 to 3.1 s to first answer is Python importing libraries and building the pydantic models (a plain import of the app took about 2.4 s in one measurement; `-X importtime` adds its own overhead). The rest is the launcher stub, the server socket and the first request. A compiled backend would not pay it. The first calls then add run-index and ledger parsing (`/api/runs` about 1.3 s, `/api/ledger` about 4 s on a fresh start), which a native rewrite would also have to make fast.

## 7. How the backend finds nq-lab's data and source

- Source: `nq-lab/.venv/Lib/site-packages/nq_lab.pth` contains the single line `C:\Users\Fatih Hekimoglu\nq-lab\src`, an editable install. The terminal package itself is not installed: `start.ps1` runs `python -m nq_terminal` with the working directory `terminal/backend`, so the current directory puts `nq_terminal` on the path. There is no `pyproject.toml` under `terminal/backend` (only `ruff.toml`).
- Root: `nq_lab.config.ROOT = Path(__file__).resolve().parents[2]`, the nq-lab folder, found from the location of the editable source. `Settings.root` is that path. `NQT_FIXTURE_DIR` replaces the root for every research and live file read (tests, demos, screenshots); settings refuse a UNC or device path, the project root or a parent of it, and any folder inside the project except `terminal/backend/tests/fixtures`.
- Folders read (all relative to the root or the fixture folder): `results/` (registry, ledger, screens, QA reports, sealed results, openings, the gate log), `backtests/output/<run_id>/` (one `result.json` plus logs and optional sidecars per run, 71 runs, 167 MB), `live/logs/` and `live/KILL` (paper journals, kill switch), `data/processed/` (parquet price files, 2.6 GB in 9,299 files counting repair-record folders; footers only through the catalogue, rows only through the gate), and `data/text/fomc/manifest.json` (a calendar cross-check). The 3.4 GB `data/raw` folder is not read.
- Prices: `nq_lab.data.serve(start, end, caller="terminal", reason=..., symbol, timeframe, variant)` -> `oos_gate.serve_bars`, which refuses any window outside [2010-01-01, 2022-01-01), appends a JSON line to `results/oos_access_log.jsonl` and loads parquet with `pyarrow.dataset`. Sealed data is never requested by the terminal.
- Python used: the launcher picks `nq-lab/.venv/Scripts/python.exe` (Python 3.12.12 from the uv-managed interpreter), and refuses to start if `fastapi` and `uvicorn` do not import. The macOS launcher (`start.sh`) hands over to a Node script that does the same checks.
- Front end: the built SPA is served by the same process from `terminal/web/dist` (a `StaticFiles` mount at `/`, after the API routes). In development Vite runs on 5173 and proxies `/api` to 8765.

## 8. Subprocess and Interactive Brokers paths

- Backtest queue (`services/jobs.py`, `api/jobs.py`, `models/jobs.py`): `POST /api/jobs` validates a `JobSpec` (strategy name from `run_base.FEEDS`, parameter names from the strategy registry, in-sample dates), queues it (cap 10, history 200), and a single worker thread starts `[python, "-u", <root>/backtests/run_base.py, "--config", <json>]` through `subprocess.Popen` with an argv list (no shell). The child writes `backtests/output/<run_id>/result.json` and gate log lines itself; the terminal tails its output (last lines), maps exit codes (0 ok, 1 failed checks, other error), persists the queue to `terminal/state/jobs.json` and stops a running child on shutdown. This is the only place the terminal starts a process, and the only place NautilusTrader runs. A native app must keep a Python (or equivalent) runtime available for this feature, or drop it.
- Interactive Brokers (`services/ib_readonly_client.py`, `services/ib_snapshot.py`, `api/ib.py`): opt-in with `NQT_IB_READONLY=1`; host and port from `IB_HOST` (default 127.0.0.1) and `IB_PORT` (default 7497, TWS paper), the live ports 7496 and 4001 refused, accounts must be paper (`DU...`), client id fixed at 95, a whitelist of request ids on the socket, every order-style method overridden to raise, account ids masked, result cached for a few seconds. One blocking socket read in a worker thread. The IB wire library is `ibapi 10.45.1` (via `nautilus_ibapi`), pure Python.
- Live screens (`api/live.py`, `api/live_stream.py`, `services/journals.py`): read the paper book's journals and logs from `live/logs/`, report the kill switch, and push changes over Server-Sent Events (bounded streams, resume by a `Last-Event-ID` position token, heartbeat, a lifetime after which the browser reconnects). No writes, no order path.

## 9. QA: the crosscheck, golden files and tests

Purpose: a strict three-way numerical check. The backend tests write JSON dumps (`terminal/qa/.dumps/`, schema `nqt-qa-dump/1`, 85 files, ~20 MB, git-ignored) holding raw inputs plus the values each implementation computed: `ours` (the terminal), `nq_lab` (the existing research helper), `nautilus` (the Nautilus Rust statistic where one exists) and `stored` (a value in a result file). `python -m crosscheck` in the separate QA environment then recomputes each metric with reference libraries (or plain Python, `decimal`, written-out rules) and compares. Tolerance: 1e-9 relative for closed forms, 1e-12 for stored values. Differences from a reference library's own definition are listed in `reference.py` as documented and shown as INFO, never failed. `--strict` turns a missing value (SKIP) into a failure. QA code never imports the backend.

Run on 2026-10-02 over the current dumps: `2,455 PASS, 0 FAIL, 0 SKIP, 104 INFO`, exit OK, about 37 s. (The brief for this work quotes about 2,325 checks; the dumps on disk now give the higher count, which fits the uncommitted QA changes in the working tree.)

| Dump kind | Dumps | PASS | INFO | Reference engine (rows compared) |
|---|---|---|---|---|
| `bootstrap` | 4 | 72 | 0 | arch (64), other / written-out rule (4), numpy (4) |
| `costs` | 3 | 57 | 0 | python decimal (49), numpy (8) |
| `deflated` | 1 | 29 | 0 | scipy (17), other / written-out rule (6), pandas (4), numpy (2) |
| `dq_nq` | 2 | 2 | 0 | set arithmetic (2) |
| `dq_sidecar` | 3 | 3 | 0 | set arithmetic (3) |
| `evt` | 3 | 33 | 0 | pandas (33) |
| `guards` | 1 | 2 | 0 | hashlib (2) |
| `lv6` | 3 | 75 | 0 | arch (52), other / written-out rule (23) |
| `market` | 1 | 3 | 0 | numpy (3) |
| `p1series` | 5 | 168 | 2 | scipy (60), statsmodels (37), empyrical (34), numpy (17) |
| `p2capacity` | 4 | 81 | 0 | plain Python (81) |
| `p2expiry` | 1 | 2 | 0 | other / written-out rule (2) |
| `p2risk` | 7 | 166 | 15 | PerformanceAnalytics formula in Python (75), scipy (30), statsmodels (18), quantstats (16) |
| `p2term` | 3 | 39 | 0 | plain Python (39) |
| `p2trend` | 2 | 28 | 0 | pandas (24), statsmodels (4) |
| `paths` | 3 | 33 | 0 | pandas (15), numpy (6), quantstats (6), statsmodels (6) |
| `regimes` | 1 | 15 | 0 | pandas (14), statsmodels (1) |
| `registry` | 1 | 6 | 0 | statsmodels (6) |
| `roll` | 3 | 24 | 0 | plain Python (24) |
| `seasonality` | 4 | 60 | 0 | plain Python (60) |
| `series` | 14 | 854 | 70 | empyrical (309), quantstats (216), statsmodels (116), other / written-out rule (109) |
| `spa` | 5 | 115 | 5 | arch (65), other / written-out rule (20), pandas (15), scipy (15) |
| `stress` | 3 | 90 | 0 | pandas (90) |
| `tracking` | 1 | 6 | 0 | pandas (6) |
| `trades` | 4 | 132 | 12 | scipy (48), numpy (40), quantstats (40), other / written-out rule (16) |
| `vcone` | 3 | 360 | 0 | Python stdlib (360) |

Reference libraries (QA environment only, pinned in `terminal/qa/pyproject.toml`): `quantstats 0.0.82`, `empyrical-reloaded 0.5.12`, `arch 8.0.0`, `statsmodels 0.15.0`, `scipy 1.18.1`; the environment is 364 MB and also holds matplotlib, seaborn and curl_cffi among others, pulled in by quantstats.

Crosscheck source files (`terminal/qa/crosscheck`):

| File | Lines | Role |
|---|---|---|
| `crosscheck/__init__.py` | 1 | Reference cross-checks for the terminal analytics. |
| `crosscheck/__main__.py` | 58 | `uv run --project terminal/qa python -m crosscheck [--dir DIR] [--strict] [--quiet]` |
| `crosscheck/compare.py` | 178 | Compare each dumped value with its reference and give it a status. |
| `crosscheck/dumps.py` | 198 | Read and validate the JSON dumps written by `terminal/backend/tests/test_dump_for_qa.py`. |
| `crosscheck/lv6_live_cone.py` | 110 | Reference values for the `lv6` dumps (ANALYTICS_CATALOG LV6 and LV6b, served): the paper path on the backtest-start and live-start cones, recompute... |
| `crosscheck/market_reference.py` | 34 | Reference values for the market views dumped as `market` bundles (MV3, GP's RV22 line). |
| `crosscheck/p11_dq.py` | 75 | Reference values for the DQ dumps (TASKS Phase 11: RI4 data quality calendar, RI5 guard fingerprint status). |
| `crosscheck/p11_evt.py` | 107 | Reference values for the event study (EVT, TASKS Phase 11), recomputed independently with pandas. |
| `crosscheck/p11_roll.py` | 72 | Reference for ROLL, the roll calendar (TASKS Phase 11; ANALYTICS MV10, gaps as MV2), dumped as `roll` bundles. |
| `crosscheck/p11_seas.py` | 139 | Reference values for SEAS, seasonality (TASKS Phase 11), for a `seasonality` bundle. |
| `crosscheck/p11_vcone.py` | 69 | Reference values for VCONE, the volatility cone (TASKS Phase 11; ANALYTICS MV9 over MV3 close to close, annualised), dumped as `vcone` bundles by `... |
| `crosscheck/p12_expectation.py` | 209 | Reference for the paper path on the SV6 cone (ROADMAP 17 step 1; ANALYTICS SV6 cone, LV6 paper path). |
| `crosscheck/p12_neff.py` | 323 | Reference for the terminal's client-side effective number of trials (roadmap #19, C8): the correlation of the registered trials, its eigenvalues, t... |
| `crosscheck/p12_power.py` | 143 | Reference for the terminal's client-side power maths (roadmap #11, C8): the normal CDF and quantile, the minimum detectable annual Sharpe ratio (MD... |
| `crosscheck/p1_reference.py` | 542 | Reference values for the P1 dumps (TASKS Phase 10), recomputed with the QA environment's libraries. |
| `crosscheck/p2_amber_classic.py` | 216 | Reference contrast audit for the amber-classic theme (TASKS Phase 12), apart from the web app's TypeScript. |
| `crosscheck/p2_regimes_capacity_term.py` | 298 | References for the P2 views RG2 (trend regime), EX5 (capacity) and MV6 (term structure) (TASKS Phase 12; ANALYTICS_CATALOG sections 9 to 11), dumpe... |
| `crosscheck/p2_risk_extras.py` | 200 | Reference values for the P2 risk extras (TASKS Phase 12; ANALYTICS_CATALOG RK4, PF11, BR5), dumped as `p2risk` bundles by `terminal/backend/tests/t... |
| `crosscheck/p2_spa.py` | 156 | Reference values for the SV8 dumps (TASKS Phase 12; ANALYTICS_CATALOG SV8), recomputed with arch 8.0.0. |
| `crosscheck/paths.py` | 37 | Where the backend's dump test writes and the cross-check reads. |
| `crosscheck/reference.py` | 276 | Reference values for every P0 scalar, recomputed with the independent libraries of the QA environment. |
| `crosscheck/report.py` | 55 | Plain-text report of the comparison rows (ASCII only, for the Windows console). |
| `crosscheck/trade_reference.py` | 177 | Reference values for the trade metrics (TA1, TA3) and the cost and exposure metrics (EX1 to EX4), recomputed from the raw rows in the dump with ind... |

Golden files (`terminal/qa/golden`): `p12_power.json` (normal CDF, quantile, minimum detectable Sharpe and power from `scipy.stats.norm`), `p12_neff.json` (correlation, eigenvalues, Li-Ji and participation-ratio effective trials, UPGMA clusters, expected-maximum Sharpe and PSR on a synthetic nine-trial panel), `p12_expectation.json` (expectation cone cases), `p2_neff_served.json` (the served neff and SV8 values). They are written by `python -m crosscheck.p12_*` and read by the TypeScript tests: the browser already carries ported copies of this maths (`web/src/quant/normal.ts`, `power.ts`), pinned to Python by these files. That is the template the migration can reuse: a golden file per ported kernel, generated from the Python reference, checked from the new language.

Tests: 2984 backend tests in 130 files plus fixtures (347 kB of tiny result files, journals and screens); 296 QA tests; the AST safety scans (`tests/test_safety_ast.py` and helpers) that ban order-style IB names, parquet reads outside the gate and non-GET routes; the contract drift test (`contract/openapi.json` against the app); the CSP test (`'wasm-unsafe-eval'` for Perspective). The front-end suites (vitest, Playwright, perf budgets, accessibility) are out of this document's scope.

What a migration must preserve here, as constraints for the plan:

- The 1e-9 and 1e-12 agreement on every dumped metric, including the RNG-dependent ones (bootstrap, SPA, lv6 cone), which pins the generator.
- The documented differences from the reference libraries (the INFO rows): the plan must keep the terminal's definitions, not adopt a library's.
- The gate behaviour: the fence [2010-01-01, 2022-01-01), one gate log line per read with `caller="terminal"`, the sealed-data refusal, and the pin checks on the sealed log and openings.
- The AST-level guarantees (no order path, no ungated parquet read, GET only) re-expressed as checks that a new code base can run.

## 10. Scripts and launchers

| File | Lines | What it does |
|---|---|---|
| `start.ps1` (Windows) | 242 | Starts the backend with the venv Python (`python -m nq_terminal`, working directory `terminal/backend`, `NQT_PORT`, `PYTHONUTF8=1`), builds `web/dist` with pnpm when sources are newer, waits for `/api/health` (up to 90 s), opens the browser, stops the tree on Ctrl+C with `taskkill /T /F`. `-Dev` runs `uvicorn --reload` plus Vite on 5173. If the port already answers as the terminal it only opens the browser. `-DryRun` prints the plan. |
| `start.sh` (macOS, Linux) | 23 | Finds Node (or `NQT_NODE`) and runs `scripts/start.mjs`. |
| `scripts/start.mjs` | 78 | Checks the Node version against `web/package.json` engines (Node 24 or newer), re-runs itself under an installed Node 24 when the default is older, then imports the TypeScript launcher. |
| `web/scripts/start/*.ts` (`launcher`, `plan`, `facts`, `doctor`, `nodeGuard`) | about 1,200 lines plus about 1,800 lines of tests | The cross-platform launcher: gathers facts (Python, deps, ports, contract sync), resolves a mode (FULL, FIXTURE or DEMO ONLY), prints a doctor checklist or the plan, runs steps as argv arrays, polls the URL, stops process groups on signals. It mirrors `start.ps1`. |
| `scripts/smoke_real.ps1` | 458 | Real-data smoke run: records hashes of the research files, builds the web app to a temporary folder, starts a second backend on 8953 and Vite preview on 4953, runs the real-data Playwright config, then checks that only terminal gate lines were appended and the research files are unchanged. |
| `web/package.json` scripts | - | `build` (tsc, vite, bundle budget check), `demo` (Vite demo mode on 5174, offline fixtures), `test` (API codegen check plus vitest), `gen:api` (types from `contract/openapi.json`), `e2e`, `e2e:perf`, `e2e:offline*`. |

Who needs what at run time today: Python 3.12 with the nq-lab venv (about 690 MB on disk), Node 24 and pnpm 11 (build and launcher only; the served app is static files), and a browser. A packaged native app removes the Node and browser requirements; the Python requirement stays unless every route and the job runner are ported.

## 11. Inventory facts that bear on the fate of each piece

Not decisions, only the evidence a plan needs. Fate options are left to the later documents.

| Piece | Size | Coupling | What decides its fate |
|---|---|---|---|
| `api/` routers (22 files) | 3,058 lines | FastAPI, pydantic | Mostly parameter parsing and calling a service; the contract in `openapi.json` is what the UI sees. |
| `models/` (23 files) | 3,610 lines | pydantic | 235 schemas; the types the front end generates from. Any new backend can emit the same JSON. |
| `services/` file readers (runs, research, audit, catalog, journals, files, instruments, events, dq, dq_guards, amendments) | 3,951 lines | pandas CSV and JSON, pathlib | Directory scans, JSON and CSV parsing, caching with mtime validation. Straightforward in any language; the sanitiser rules (NaN to null, nanosecond timestamps, decimal strings) are part of the contract. |
| `services/bars.py` and gate use | 389 lines | pandas, `nq_lab.data.serve` | The only price door. The gate and parquet loader live in nq_lab; a port either keeps calling Python or re-implements the gate semantics and the log line format. |
| `analytics/` (26 files) | 4,770 lines | numpy, pandas, scipy.stats in 10 modules | The numeric core and the crosscheck's subject. Modules with no pandas reference: `neff`, `risk_extras`, `spa`, `tracking`. |
| `services/jobs.py`, `api/jobs.py`, `models/jobs.py` and `backtests/run_base.py` | 753 lines plus the 296-line runner and the nq_lab strategy code it loads | subprocess, Nautilus | Needs Python and NautilusTrader on the machine regardless of the shell. |
| IB snapshot | 756 lines | `ibapi`, threads, SSE | Optional and off by default. The IB library is pure Python; the protocol is a documented socket protocol. |
| Live screens and SSE stream | 997 lines | journal readers, SSE | Read files from `live/logs`; the stream is plain Server-Sent Events with a resume token. |
| Security middleware | 128 lines | Starlette ASGI | Loopback, host and origin checks and headers. A native shell without a network port would make most of it unnecessary, but the checks are tested behaviour. |
| QA crosscheck | 23 files, 3 libraries | quantstats, arch, statsmodels | The oracle. It needs the Python reference libraries whatever the app is written in. |

## 12. Reproducing the tables

Scripts (in `nq-lab/desktop_research/tools/backend/`, outside the terminal repository; they read and write JSON in their own folder or the current folder, so copy them to a scratch folder before running; use the nq-lab venv Python, never a bare `python`; order: `scan_static`, `measure_routes`, `oa_params`, `dep_table`, `extra_scan`, `start_measure`, `qa_scan`, `facts`, `gen_doc`):

- `scan_static.py`: AST scan of every backend module -> `modules.json` (lines, imports by class, calls, kind, pandas and numpy reference counts).
- `measure_routes.py`: builds the app, installs the write guard, calls every GET route twice in process, records bytes and times, writes `routes.json` and `census.json`. It uses real data, a scratch gate log and a 256 MiB cache.
- `oa_params.py`: query parameters and status codes from the generated OpenAPI document.
- `dep_table.py`: maps imported top-level modules to distributions, sums installed sizes, flags native extensions -> `deps.json`.
- `extra_scan.py`: scipy functions, pandas method counts, nq_lab modules loaded -> `extra.json`.
- `start_measure.py`: starts the server on a spare port with no window, times it to health, reads memory of the real interpreter, stops it by process id -> `start_measure.json`.
- `qa_scan.py` (run in the QA environment): per dump kind PASS, FAIL, SKIP and INFO counts -> `qa.json`.
- `facts.py`: file and tree counts (data sizes, test counts, git state, scipy functions at HEAD and in the working tree) -> `facts.json`.
- `gen_doc.py`: builds this file from the JSON.

## 13. Open questions and unverified items

- Unverified: macOS start-up time and memory of the same backend (no Mac was reachable); wheels for macOS arm64 differ in size from the Windows figures here.
- The working tree held 108 uncommitted changes while this was written. Seven new modules from in-progress work (LV6 expectation, effective number of trials) are in the module table, marked as new. The `paper_expectation` router is not registered in `create_app`, so no row in the route table comes from it, and the route list should equal HEAD's; this was not checked against a clean checkout (no git writes were allowed). The schema count and the `openapi.json` size may differ at HEAD.
- Measured only in process: HTTP framing and JSON encoding add some milliseconds to the larger bodies on a real connection; cold times here also include first-call cache fills and an OS file cache warmed by earlier runs.
- `/api/live/stream` was not opened; its cost per open stream is unmeasured (bounded by `max_streams` and `lifetime_s` in code).
- Which Nautilus statistics the `nautilus` side of the crosscheck calls is read from the dump kinds and the dump writers, not traced call by call.
