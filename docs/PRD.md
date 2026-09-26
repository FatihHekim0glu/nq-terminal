# nq-lab terminal: product requirements

Status: plan, 2026-09-26. Companion files: `ARCHITECTURE.md`, `ANALYTICS_CATALOG.md`, `UI_SPEC.md`, `TASKS.md`.

## 1. What this is

A local, keyboard-first quant terminal in the style of a Bloomberg terminal, built on top of nq-lab and its NautilusTrader 1.231.0 engine. It shows every research output nq-lab already produces (registered hypotheses, Nautilus runs, the ledger, the OOS audit trail, gated market data and the IB paper book) and adds the standard quant analytics on top of them, each checked against a reference implementation.

"Fork the Nautilus engine" is read as "build on the engine", not as a GitHub fork. Nautilus core is not modified. The terminal lives in the `terminal/` folder of the nq-lab project and imports `nq_lab` and `nautilus_trader` as they are installed today. A literal fork, or any git action, needs the user's explicit go.

## 2. User

One user: the owner of nq-lab, a quantitative researcher who runs pre-registered tests, reads Nautilus result files and runs an IB paper book. He works on one Windows machine, on one or two monitors (1920x1080 target, 1366x768 minimum), prefers the keyboard, and already uses the SIGNAL design language on his portfolio site.

## 3. Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Every registered hypothesis, Nautilus run, ledger row and sealed result is one command away | `REG`, `DES`, `RUN`, `LEDG`, `SEAL` resolve for every item on disk; E2E test iterates all of them |
| G2 | The standard performance, risk, drawdown, distribution and trade analytics for any run or hypothesis series | Every P0 metric in `ANALYTICS_CATALOG.md` is shown and matches its reference implementation within the stated tolerance |
| G3 | Numbers the user can trust | Three-way agreement tests (own code, Nautilus pyo3, independent library) plus exact anchors to the project's own result files |
| G4 | nq-lab's research rules are visible, not just obeyed | OOS fence on every time axis, `[PRE-REG]` and `[POST HOC]` tags, plumbing rows labelled and excluded, `[UNUSABLE: BALANCE]` badge, spec hash status |
| G5 | Bloomberg feel | Command line with mnemonics, link groups, dense amber-on-black data, docking panels, no mouse needed |
| G6 | Safe by construction | No order path, GET-only API in P0 and P1, no price read outside the gate, no write to `results/` |

## 4. Scope

### P0 (first release; must be excellent)

Screens: `HOME`, `REG` (with the `MT` multiple-testing view), `DES` (hypothesis tear sheet, including blocks and cost ladder), `RUNS` and `RUN` (Nautilus run inspector), the analytics tear sheet (`EQ`, `DD`, `RET`, `RR`, `MRET`), `GP` (candles at 1m, 5m, 1h and 1d; `GIP` is `GP` for one date), `MON` and `CORR` (27 futures, daily, to 2021-12-31), `LEDG`, `OOS`, `LIVE` and `JRNL` (journal tail, read-only), `HELP`.

Analytics: the P0 rows of `ANALYTICS_CATALOG.md`: equity, returns, CAGR, volatility, Sharpe with CI, Sortino, Calmar, underwater curve and top-10 drawdown table, rolling Sharpe and volatility, return histogram, monthly heatmap, historical VaR and CVaR, 21-session loss tails, spanning alpha and beta from the result files, information ratio and tracking error, PSR, MinTRL, the registry's multiple-testing view, trade statistics, P&L by hour, weekday and month, cost waterfall and cost sensitivity, exposure and turnover, candles, roll gaps, realised volatility, the 27-future return heatmap and correlation matrix, spec hash check, OOS log timeline, ledger and anchors, live plumbing labelling, target versus actual, guard and kill-switch strip, journal table.

Platform: FastAPI read-only backend in the nq-lab venv; Vite, React 19 and TypeScript front end; one start command; Playwright E2E, axe accessibility checks and screenshot baselines; numeric QA in a separate QA environment.

### P1 (after P0 ships)

Perspective pivot grids (`LEDG` pivot, trades, fills, OOS log); `COST`, `BLK`, `EXPO` and `SEAL` as their own screens; `VCONE`, `SEAS`, `EVT`, `ROLL`, `DQ`; MAE and MFE scatter; holding time and streaks; Omega, tail ratio, gain-to-pain, QQ plot and Jarque-Bera; Cornish-Fisher VaR; rolling beta and correlation; up and down capture; stationary bootstrap CIs and the Monte Carlo cone; Deflated Sharpe over the registry; volatility regimes; stress windows; paper versus model tracking; colour-vision-deficiency theme; F-key shortcuts; data quality calendar; guard fingerprint status.

### P2 (only on request)

Backtest job runner through `backtests/run_base.py` (needs the user's go); read-only IB account snapshot (opt-in, client id 95); White's Reality Check, Hansen SPA and StepM; modified ES; ulcer index; Treynor; trend regimes; term structure; capacity; Arrow IPC wire format if a performance budget fails; `amber-classic` theme.

## 5. Non-goals

- **No order placement.** No order ticket, no `placeOrder`, `cancelOrder`, `reqGlobalCancel`, `exerciseOptions` or `reqAutoOpenOrders` anywhere in `terminal/`. The browser never talks to TWS. The terminal never toggles the kill switch.
- **No changes to Nautilus core** or to `nq_lab` source. The terminal is a consumer. (`oos_gate.py` is unchanged.)
- **No git actions** (commit, branch, push, fork) without the user's explicit go.
- **No new pass or fail verdicts.** Verdicts come only from `results/registry.csv`, the screen JSONs and `results/sealed/`. Analytics computed by the terminal are labelled descriptive.
- **No price views after 2021-12-31.** `serve` refuses 2022+. Opening it is the user's decision.
- **No writes to `results/`, `backtests/output/`, `data/` or `live/`.** The terminal's own state lives under `terminal/state/` (P2 only) and browser `localStorage` (layouts).
- **No cloud, no auth, no multi-user.** Bound to `127.0.0.1`.
- No light theme, no mobile layout, no marketing animation.

## 6. User decisions required (the build stops at each)

| # | Decision | Blocks |
|---|---|---|
| U1 | Add `fastapi==0.141.1` and `uvicorn==0.54.0` to nq-lab's `pyproject.toml` (new `terminal` dependency group; the dry run adds 4 packages and changes none) | Phase 1 |
| U2 | Create a separate QA environment `terminal/qa` (own `pyproject.toml` and lock: quantstats, empyrical-reloaded, arch, statsmodels, scipy) that never touches nq-lab's `.venv` | Phase 3 QA gate |
| U3 | Any P2 item: the job runner, the IB snapshot | Phase 10 |
| U4 | Opening 2022+ prices for display | Not planned |
| U5 | Any git action | Not planned |

## 7. Decision log (review conflicts resolved)

Three independent research reviews (analytics, UX and stack, architecture) disagreed on these points. Each is settled here and the other files follow it.

| # | Conflict | Decision | Why |
|---|---|---|---|
| DL1 | Analytics wanted a `terminal_snapshot` build step writing a derived price cache to disk; architecture wanted an in-memory cache only | **In-memory only.** Prices are served through `nq_lab.data.serve(caller="terminal")`, cached per process by (symbol, timeframe, variant, year) | A disk copy of prices is an ungated copy, the same problem as the deleted `data/sealed_cache/`. Log spam is bounded by the year-aligned cache either way |
| DL2 | Architecture proposed porting the SIGNAL TopBar and Rail; UX proposed dockview with a command line | **UX layout** (command line, dockview panels, status bar). From SIGNAL reuse tokens, class grammar, `StatusLine` segments and the `fuzzy()` matcher, not the Rail page layout | A terminal is panel based; the Rail is a website pattern |
| DL3 | Perspective in P0 for all big grids | **P0 grids use TanStack Table with react-virtual; Perspective moves to P1** | 8,411 fills and 3,603 trades virtualise easily; Perspective's WASM and worker set-up is the riskiest front-end dependency and is not needed for P0 |
| DL4 | Arrow IPC (UX) against JSON with epoch seconds (architecture) | **Columnar JSON via orjson** (`t` as integer epoch seconds, one array per field). Arrow only in P2 if a budget fails | Bars are downsampled to about 4,000 points per request, so JSON is small; one fewer dependency on each side |
| DL5 | Job runner in the architecture plan; UX said v1 is display only | **Job runner is P2 and needs the user's go.** P0 and P1 are GET only | Keeps the safety E2E simple (every request is GET) and the ledger untouched |
| DL6 | IB snapshot client id: "model on ib_lag_check" (93) against a new id 95 | **Client id 95, P2, opt-in** (`NQT_IB_READONLY=1`) | 93 belongs to `ib_lag_check`; two clients on one id clash |
| DL7 | Nautilus pyo3 statistics as the terminal's engine (analytics) against the terminal's own `analytics.py` (architecture) | **Own numpy and pandas functions are primary.** Nautilus pyo3 statistics are the second implementation in tests, fed a session-indexed series. Independent libraries are the third, in the QA environment | The formulas and the two return bases (A and B) must be explicit and owned; pyo3 still gives an independent check |
| DL8 | Rolling windows 21 and 63 (architecture) against 63 and 252 (analytics) | **63 and 252 sessions** for Sharpe and volatility; 126 for beta and correlation | A 21-session Sharpe is noise; 63 and 252 are the quarterly and annual views the screens use |
| DL9 | Deflated Sharpe over the registry in P0 | **P1.** P0 has PSR, MinTRL and the multiple-testing view | The 15 hypotheses are in different units (R, points, percent); a common daily basis must be documented and reviewed first |
| DL10 | Kill switch: the reviews said `live/KILL` exists; today it does not | **Read it live with `live_guards.kill_switch_on(ROOT / "live" / "KILL")`**, which also matches `KILL*` names | The state changes; reusing the guard avoids a second definition |
| DL11 | Architecture said no journal exists yet | **Discover `live/logs/*.jsonl`.** One exists now: `preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl`. Classify rows with `paper_plumbing.is_plumbing`, never by file name alone | Journals are created by preflights and by the node under different names |
| DL12 | UX wireframe said "PASS 0 FAIL 15" | **Counts come from `registry.csv` at runtime.** Today `overnight_v0` is PASS (14 FAIL, 1 PASS, plus 1 check row) | Hard-coded counts drift |
| DL13 | Two servers (Vite on 5173 plus API) in normal use | **One origin: uvicorn on `127.0.0.1:8765` serves the built SPA and `/api`.** Vite dev server only in `-Dev` mode | No CORS needed at all |
| DL14 | Sealed CSV price columns: drop by denylist | **Allowlist per file** of return, exposure and label columns | A new price column in a later file cannot leak by default |
| DL15 | Status bar showed `TWS 7497 RO` | **Shows `TWS: not monitored`** until the P2 snapshot is enabled | The terminal has no TWS connection in P0 or P1 |
| DL16 | F-keys in P0 | **P1 behind a Playwright test.** Esc and Ctrl+K are P0 | Browser interception of F2, F4, F8 and F9 is unverified |
| DL17 | CVD theme in P0 | **P1.** P0 always shows sign and ▲ ▼ glyphs, so colour is never the only cue | Tokens make the theme cheap later |
| DL18 | `GIP` as its own screen | **`GIP` is `GP` with a date and an intraday timeframe**, one component | Less code, same behaviour |
| DL19 | Nautilus `Alpha`, tearsheet and `PortfolioAnalyzer.portfolio_returns()` | **Not used for any displayed number.** Alpha is the project's spanning alpha from the result files | Weekend zero-fill bias and geometric annualisation (see `ANALYTICS_CATALOG.md` C3) |

## 8. Acceptance for P0

1. `start.ps1` brings the terminal up on `http://127.0.0.1:8765` from a clean clone of the current folder with one command.
2. Every P0 screen renders against the real files with no console errors and passes axe (WCAG 2.2 AA tags).
3. Every P0 metric passes its three-way check and its anchors (`ANALYTICS_CATALOG.md` section 14).
4. The born-failing checks fail on their broken inputs: a tampered spec hash, a shifted anchor, a plumbing row fed to performance, a price read that bypasses the gate, SIGNAL's `#E64343` on `#171C22`, a wrong annualisation factor.
5. sha256 of `results/oos_access_log.jsonl`, `results/ledger.csv`, `results/registry.csv` and `results/oos_openings.json` are unchanged by the test session. In normal use, `oos_access_log.jsonl` only gains lines with `caller="terminal"`.
6. All user-facing strings pass the house style check (UK spelling, no em or en dashes).
