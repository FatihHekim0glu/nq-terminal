# nq-lab terminal: architecture

Status: plan, 2026-09-26. Decisions marked DLn are in `PRD.md` section 7. Facts below were read from disk on 2026-09-26 unless marked UNVERIFIED. Sections 1, 2, 4.1 and 11 refreshed on 2026-09-29 to match the code.

## 1. Stack

| Layer | Choice | Licence | Notes |
|---|---|---|---|
| Backend | FastAPI 0.141.1, uvicorn 0.54.0 (plain, not `[standard]`) | MIT, BSD-3 | Needs the user's go (U1). Dry run adds `annotated-doc 0.0.5`, `fastapi 0.141.1`, `starlette 1.7.0`, `uvicorn 0.54.0` and changes nothing else |
| Backend libs already locked | pydantic 2.13.5, orjson 3.12.0, pandas 2.3.3, pyarrow 25.0.1, numpy 2.5.3, scipy 1.18.1 | | No DuckDB, no polars (they would invite ungated parquet reads) |
| Front end | Vite 8.3.1, React 19.3.0, TypeScript 6.0.3 (gate on `tsc -b`), pnpm 11.5.1 through corepack | MIT | Node 24 or later: `engines` in `web/package.json`, `web/.nvmrc`, and `engineStrict: true` in `web/pnpm-workspace.yaml` |
| Docking | dockview-react 8.3.1 | MIT | Not `dockview-enterprise` |
| Candles | lightweight-charts 5.2.1 | Apache-2.0 | TradingView attribution required: keep `attributionLogo: true` and list it on `HELP` |
| Dense lines | uPlot 1.6.32 | MIT | Equity, underwater, rolling stats, exposure |
| Stats charts | ECharts 6.1.0 | Apache-2.0 | Heatmaps, histograms, bars, scatter, correlation, tree-shaken to bar, line, scatter and custom series |
| Grids | @tanstack/react-table 9.2.4 and @tanstack/react-virtual 3.14.13 (P0, DL3); Perspective 5.5.1 (`@perspective-dev/client`, `viewer`, `viewer-datagrid` and `server`, one version) (P1, built) | MIT, Apache-2.0 | Perspective pivots LEDG, the RUN trades and fills and the OOS log behind a Table or Pivot toggle; its WebAssembly loads only through `src/perspective/engine.ts` |
| Command line | cmdk 1.1.1, inline | MIT | |
| Keys | The terminal's own handler (`web/src/chrome/CommandLine.keys.ts`), no library | | |
| State and fetch | zustand 5.0.15 (link groups, layout), @tanstack/react-query 5.103.2 | MIT | One GET client, `web/src/api/client.ts` |
| Styling | Tailwind 4.3.3 through `@tailwindcss/vite`, every colour from `src/theme/tokens.css` | MIT | No colour literal outside `tokens.css` and `charts/theme/chartTokens.ts` |
| Fonts | Bergoom (vendored under `src/assets/fonts/bergoom`, OFL-1.1) with @fontsource Source Sans 3 5.3.0 and PT Mono 5.3.0, all self-hosted | OFL-1.1 | Works offline |
| API types | openapi-typescript 7.13.0, generated from `contract/openapi.json` | MIT | Never hand-edited |
| Tests | pytest (venv), vitest 5.0.2, @playwright/test 1.63.0 (the `chromium` and `perf` projects against the fixture backend, the `offline`, `offline-perf` and `offline-demo` projects against the demo layer), @axe-core/playwright 4.13.0 | | |
| QA references | separate uv project `terminal/qa`: quantstats, empyrical-reloaded, arch, statsmodels, scipy | Apache-2.0, NCSA, BSD | Needs U2. Never installed in nq-lab's `.venv` |

Versions came from `npm view` and `uv pip install --dry-run` on 2026-09-26. Phase 4 pinned them exactly in `package.json` and `pnpm-lock.yaml`. The front-end rows above were re-read from `web/package.json` on 2026-09-29, and `web/scripts/docsSync.test.ts` fails when a version here differs from it.

Perspective's scope, checked with `npm view` on 2026-09-27 (Phase 10 security review): `@finos/perspective` 3.8.0 is deprecated on the registry with the message "no longer maintained. Please upgrade to @perspective-dev/client"; `@perspective-dev/client` 5.5.1 points at github.com/perspective-dev/perspective and is published by timkpaine and texodus, texodus being a maintainer of `@finos/perspective` too; its `pro_self_extracting_wasm` 0.0.9 dependency (github.com/prospectiveco) is published by texodus alone; the lock's integrity hash for `@perspective-dev/client` 5.5.1 equals the registry's. The client's `ws` and `stoppable` dependencies serve its Node server mode and are not in the browser bundle's code path; the browser engine loads only through `src/perspective/engine.ts`, same-origin, under the CSP's `'wasm-unsafe-eval'`.

## 2. Folder layout

```
nq-lab/terminal/
  docs/                      this plan
  backend/
    nq_terminal/
      __main__.py            launcher: `python -m nq_terminal`, uvicorn bound to 127.0.0.1 in code, no Server header
      app.py                 FastAPI app, middleware stack, routers, static mount of web/dist (the only mount allowed)
      security.py            loopback-only peers, same-origin /api guard, security headers
      settings.py            NQT_PORT=8765, NQT_CACHE_BYTES, NQT_FIXTURE_DIR (checked); ROOT from nq_lab.config
      constants.py           fence dates, sealed column allowlists, stress windows (frozen), mnemonics list
      models/                common.py (Page[T]), runs.py, research.py, data.py, audit.py, live.py, analytics.py
      services/
        files.py             FileCache, sanitise (NaN, Inf, ns ints, Decimal strings), safe JSON and CSV reads
        runs.py              RunIndex, run detail, trades, fills, logs, equity series
        research.py          registry, screens, specs, hypothesis series, sealed results, summaries
        bars.py              GatedBarCache over an injected serve function
        catalog.py           parquet metadata only
        audit.py             OOS log, openings, pin checks
        journals.py          live journal and log tailer
        jobs.py              the backtest queue (P2): one worker, argv-list subprocess, state under terminal/state; the one module allowed to write
        ib_readonly_client.py  the one IB client (read only, client id 95); ib_snapshot.py  opt-in snapshot service
      analytics/             pure functions for every metric in ANALYTICS_CATALOG.md, split by family so no file
                             passes 800 lines: _inputs.py (input checks), perf.py, drawdown.py, rolling.py,
                             distribution.py, risk.py, relative.py, validity.py, trades.py, exposure.py; series.py
                             (Basis A and B builders) is the one module that calls the injected services
      api/                   runs.py research.py data.py analytics.py audit.py live.py system.py jobs.py ib.py spa.py risk_extras.py regimes_capacity_term.py
    tests/
      fixtures/              tiny result.json per shape, screen JSONs, CSVs, journals with NaN and plumbing rows
      test_*.py
  qa/                        separate uv project (U2): reference cross-checks, never imported by the backend
    pyproject.toml, uv.lock, crosscheck/*.py, tests/
    golden/                  p12_power, p12_expectation, p12_neff and p2_neff_served JSON: the reference values the browser-side power formula is pinned to and the backend mirrors of the effective-number and expectation estimators are tested against (p2_neff_served is written by backend/tests/test_p2_neff_bridge.py, rewrite with NQT_UPDATE_NEFF_BRIDGE=1)
  web/
    package.json, pnpm-lock.yaml, pnpm-workspace.yaml (engineStrict), .nvmrc, vite.config.ts, tsconfig.json
    playwright.config.ts     the Windows run against the fixture backend (projects chromium and perf)
    playwright.offline.config.ts  the offline run on macOS or Linux (projects offline, offline-perf and offline-demo)
    scripts/                 bundleCheck.ts (chunk budgets), shellBudget.test.ts, docsSync.test.ts (pins section 1 and the endpoint index in 4.1),
                             start/ (the launcher behind start.sh: plan, doctor, facts, node guard)
    src/
      api/schema.d.ts        generated
      api/openapi.sha256
      api/client.ts          the one GET client (apiGet, and openEventStream for the live stream); a scan fails on any other network call
      api/queries.ts         the react-query hooks the first-paint shell reads; queries.screens.ts holds every screen's hooks
      api/connection.ts      the backend connection state machine behind the connection strip
      theme/tokens.css       SIGNAL tokens plus terminal tokens (UI_SPEC.md section 3)
      copy/                  every user-facing string, as templates (UK spelling, no dashes)
      chrome/                CommandLine, ContextStrip, StatusBar, ConnectionStrip, Workspace, PanelChrome, HelpScreen, deep links, panel export
      charts/                CandleChart, LineStack, Heatmap, Distribution, BarLadder, Scatter, GlyphScatter, chart a11y wrapper
      grids/                 MonitorGrid (TanStack), JournalTable
      perspective/           the Perspective pivot grid (engine, viewer mount, Table or Pivot toggle)
      tiles/                 KpiTile, SpecCard, BalanceCheck, Countdown
      screens/               one folder per mnemonic group; screens/layouts holds the default layouts
      commands/              grammar, parser, registry of mnemonics (single source for HELP), HL search index
      state/                 link groups, layouts, named workspaces, the research record watch
      quant/                 browser-side formulas (normal cdf and quantile, minimum detectable Sharpe and power: the only live code); linalg, cluster, trials and neffReference.ts are test references that no production file imports (importGuard.test.ts), pinned by qa/golden
      export/                GRAB (panel image), the HTML evidence pack, the print dossier and their dossier model
      demo/                  the demo layer: fetch and EventSource replaced in the page, one handler per contract path, captured and seeded data
      gallery/               the component gallery, built only with `--mode gallery`
      vendor/                stubs for unused parts of cmdk (dialog, command-score)
    e2e/                     Playwright specs and screenshot baselines
    e2e/offline/             the offline-demo smoke spec and the preview config that serves the demo API over HTTP
    e2e/flows/, perf/, visual/  flow specs, performance budgets, every-screen screenshots and axe
  contract/openapi.json      snapshot of app.openapi()
  scripts/start.mjs          entry of start.sh: checks the Node version, switches to a Node 24 when it finds one, runs the launcher
  state/                     P2 only (jobs); git-ignored
  start.ps1                  the Windows start command
  start.sh                   the macOS and Linux start command (section 11)
```

The backend runs with `python -m uvicorn nq_terminal.app:app --app-dir terminal/backend`, so the `nq_lab` package layout and `uv_build` settings are untouched.

## 3. Data contracts (inputs on disk)

### 3.1 Nautilus runs: `backtests/output/<run_id>/result.json`

65 run folders today. Four shapes (`za_orb`, `overnight`, sized books `volmanaged`/`volmanaged_bh`/`tsmom`, and `dtsmom`). Files are 1 to 6.6 MB.

Top level: `run_id, config{strategy, params, variant, start, end, run_id}, nautilus_trader, created_utc, elapsed_s, data, venue, n_trades, pnl_total, fees_total, summary, balance_check, coverage_check?, strategy_skipped?, trades[], fills?[], strategy_log?`.

- `summary`: `n_trades, pnl_total, fees_total, mean_net_r|null, t_net_r|null, gross_mean_r|null, hit_rate, [mean_pnl_usd, t_pnl_usd, mean_pnl_pts], reasons{}, blocks{"2010-2013","2014-2017","2018-2021"}`.
- `balance_check`: `starting_usd, final_usd, delta_usd, realized_sum_usd, diff_usd, ok, open_positions, trade_list_sum_usd, [mtm{rows, fills, fills_after_last_snapshot, max_abs_diff_usd, net_qty_ok, lots_match, final_flat, bad_rows, n_bad, ok}]`.
- `trades[]`: `date, direction ±1, entry_ts, entry_px, stop_px?, target_px?, r_pts?, exit_ts, exit_px, reason, pnl_pts, pnl_usd, commissions_usd, net_r?`.
- `fills[]` (sized and dtsmom): `ts (int ns), instrument?, side, qty, px, commission (Decimal string), position_id, order_id, tags`.
- `strategy_log` (sized): `snapshots[] {date, ts, px, balance, unrealized, equity, net_qty, lots, lots_match}`, `closes[]`, `decisions[]`, `notes[]`. (dtsmom): snapshots with `net_qty[27]` and `px[27]`, `decisions[]`, `rolls[]`, `instruments[27]`, `book`.
- Sidecars: `compare_screen.json`, `compare_pandas.json`, `regress_check.json`, `lookahead_probe.json`; `<run_id>.log` beside the folder.

Badges: `probe` when `data.lookahead_probe` exists or the name contains `_probe_` (12 runs); `anchor` for `_regress_` and `_haltfix_`; `ledgered` by joining `results/ledger.csv.run_id`; `[UNUSABLE: BALANCE]` when `balance_check.ok` is false (rule 4).

### 3.2 Research files

- `results/registry.csv`: 16 rows (15 registered plus `za_v0_C3_gao_momentum`). Columns `name, registered, n, p, control_p, verdict, family_k, bonferroni_p, holm_p, bh_q, spec, spec_sha256, spec_sha_ok`. **Authoritative** for n, p, adjusted p and verdict. Verdict text can be free text (`dtsmom_v0` carries a bracketed note); the UI shows the first token as the badge and the rest as a note.
- `results/screens/*.json`: shapes differ per hypothesis. Served raw (sanitised) for a tree view, plus a per-screen extractor for `pass_checks`, headline label and value, `blocks`, `cost_ladder`, `break_even_ticks_per_side`. `za_v0` and `za_v0_repaired` use `passes` instead of `verdict`. Auxiliary files (`*_rejected_days.json`, `eurodrift_v0_coverage`, `eurodrift_v0_rsv`, `overnight_v0_drift_control`) attach to their parent. `*.first.*` and `*.prev_*` are shown as history.
- Series CSVs: trades (`usd_nq_{0,1,2}`, za uses `pnl_usd_nq`, fomctone adds `net_pct_1`), daily (`volmanaged_v0_daily` with `r_m_{0,1,2}` and `r_bh_{0,1,2}`, `fomccycle_v0_daily`, `eurodrift_v0_nights` with `net_bps_*`), monthly (`tsmom_v0_monthly`, `dtsmom_v0_monthly`).
- `experiments/<name>.json`: specs, re-hashed with sha256 at request time and compared with the result's `spec_sha256`.
- Summaries: `round*_summary.md`, `calendar_summary.md`, `sizing_summary.md`, rendered as markdown.
- `results/ledger.csv`: 10 data rows, append-only. Read only.

### 3.3 Sealed results: `results/sealed/`

`rebal_v1_confirm.json`, `volmanaged_oos.json`, `qa_sealed.json`, `close_check.json`, `exposure_options.json`, `SEALED_RESULT.md`, and CSVs that hold 2022+ prices. The API serves CSV columns through an **allowlist per file** (DL14), defined in `constants.py`:

- `volmanaged_oos_daily.csv`: `date, variant, roll, sigma2, c, wstar, N, n_bh, held_exposure, r_m_0, r_bh_0, r_m_1, r_bh_1, r_m_2, r_bh_2`. Dropped: `px, raw, iid`.
- `rebal_v1_confirm_trades.csv`: `month, year, mon, s, pct, x_pct, net_nq_0..2, usd_nq_0..2, net_mnq_1..2, usd_mnq_1..2`, the `long_*` P&L columns, `spans_closure, roll, rolls`. Dropped: every `*_px`, `raw_c*`, `A, S, E, X, rE, rB, dev, gross, x` and timestamps.

A test fails if any served column name matches `px|raw|price|_c$|^[OHLC]$` or if the allowlist names a column the file does not have. Every sealed view carries the label `spent window, opened 2026-09-26, descriptive only`.

### 3.4 Audit files

- `results/oos_access_log.jsonl`: about 2,790 lines in four key sets (see `ANALYTICS_CATALOG.md` RI2). Parsed read-only with tolerant models.
- `results/oos_openings.json`: one closed opening. Pin status from `oos_gate.check_openings_pin` and `check_sealed_log_pin` (read-only functions).

### 3.5 Live files

- Journals: every `live/logs/*.jsonl` (DL11). Known names: `volmanaged_paper_journal.jsonl`, `volmanaged_paper_journal.PLUMBING_DELAYED.jsonl`, and preflight journals such as `preflight2_2026-09-26_journal.PLUMBING_DELAYED.jsonl` (1 `warmup` row today). Row types `warmup`, `skipped`, `delayed_fetch`, `close`, `close` with `error`. Rows may contain `NaN` tokens.
- Nautilus logs: `live/logs/*.log`, format `YYYY-MM-DDTHH:MM:SS.fffffffffZ [LEVEL] NQLAB-PAPER.<Component>: <msg>`, read with utf-8 and `errors="replace"` (braille banner).
- Kill switch: `live_guards.kill_switch_on(str(ROOT / "live" / "KILL"))` (DL10).
- Plumbing: `paper_plumbing.is_plumbing`, `performance_rows`, `exposure_summary`, `BANNER` ("PLUMBING TEST, DELAYED DATA: not strategy performance"). Imported, never reimplemented.

### 3.6 Market data

`data/processed/` (listed by name on 2026-09-26 16:05): 1m back-adjusted vendor files for 24 roots (6A, 6B, 6C, 6E, 6J, 6S, CL, ES, GC, HG, HO, NG, NQ, RB, RTY, SI, YM, ZB, ZC, ZF, ZN, ZS, ZT, ZW; NQ 4.80M rows, ZN 5.12M), NQ 1m repaired (4.99M), and 27 daily files for the dtsmom roots (`<SYM>.V.0_1d_back.parquet`, cut at 2021-12-31; RTY has no daily file). A concurrent workflow was still processing 1m pulls at that time (HE and LE have raw 1m folders), so the Phase 2.3 catalog lists the folder instead of hard-coding it, and a catalog test must compare its listing with `tests/fakes.py` (`MINUTE_SERIES`, `DAILY_ROOTS`). By 16:50 the folder held 1m vendor files for 28 roots (four more roots: HE, LE, ZL, ZM) and `fakes.MINUTE_ROOTS` mirrors them; repaired 1m files (`<root>_1m_back_repaired.parquet`, which the futures repair workflow adds) are checked generically: each must belong to a mirrored root. 1m columns `ts (bar open, UTC), o, h, l, c, v, instrument_id, raw_c, offset`; 1d columns `ts, o_none..c_none, o_back..c_back, v, instrument_id, offset` (no `raw_c`; use `c_none`). Dtypes (parquet metadata): `ts` timestamp[ns, UTC], prices and `offset` double, **`v` double** (not an integer), `instrument_id` int32 in 1m and int64 in 1d. **The processed 1m files hold data to 2026-09-24**, so only the gate stands between the terminal and 2022+ bars.

### 3.7 Encoding hazards the backend normalises

1. Nanosecond integers exceed JavaScript's safe integer range: send ISO strings in tables and integer epoch seconds (`t`) on chart axes.
2. `NaN` and `Infinity` tokens (journals, `smoke_2015_01/result.json`): map to `null`.
3. Decimal money as strings: keep the string for tables, add a float for charts.
4. Optional keys vary with run age: tolerant pydantic models (`extra="allow"` on raw carriers) and a test that parses every real file.

## 4. API contract

All endpoints are GET except the two JOBS writes (DL5, PRD U3): `POST /api/jobs` and `DELETE /api/jobs/{job_id}`. JSON via orjson. Pagination `offset`, `limit` (default 500, max 5,000). Chart series are columnar: `{"t": [...], "v": [...]}`.

Contract rules (Phase 2 improvement run): every response model derives from `models.common.ResponseModel`, so every field is required in the schema (defaults included) and the generated types have no optional field the backend always sends. Every error a router raises is declared with the body `ErrorDetail{detail}` (a string, or FastAPI's validation list on a 422): runs 404, 422, 503; research 404, 422, 500, 503; data 403, 404, 422, 502, 503; audit 422, 503; live 404, 413, 422. `tests/test_app.py` pins the route set and GET only; `tests/test_contract_shapes.py` pins these two rules.

**System**
- `GET /api/health` → `{now_utc, nautilus_version, pins{pandas, pyarrow, quantpad_data, nautilus}, fence{is_start:"2010-01-01", is_end:"2022-01-01"}, sealed{openings_pin_ok, sealed_log_pin_ok, openings_closed}, kill_switch_on, gate_reads_this_process, cache{series, bytes}, fixture_mode}`
- `GET /api/commands` → `{grammar, mnemonics[{code, screen, priority, context}], instruments[{root, symbol, sector}], universe:["27F"], hypotheses[], confirmations[], runs[], registry_error}` for the command line and `HELP`. The mnemonic table is `constants.MNEMONICS`, pinned to UI_SPEC section 5 by `tests/test_mnemonics.py`. Instruments are the 27 dtsmom roots plus the catalog-only `constants.EXTRA_INSTRUMENTS` (RTY). Hypotheses come through the shared registry reader; while `registry.csv` is half written the list is empty and `registry_error` says why.

**Runs**
- `GET /api/runs` → `list[RunSummary{run_id, readable, error, strategy, params, variant, start, end, created_utc, elapsed_s, nautilus_trader, kind:"intraday"|"sized"|"book", n_trades, pnl_total, fees_total, hit_rate, mean_net_r?, t_net_r?, t_pnl_usd?, balance_ok, mtm_ok?, coverage_ok?, usable, is_probe, is_anchor, anchor_of, ledger{exp_id, ts_utc}|null, sidecars[]}]`
- `GET /api/runs/{run_id}` → `RunDetail` without the large arrays.
- `GET /api/runs/{run_id}/trades`, `/fills`, `/log/{decisions|closes|notes|rolls|snapshots}` → `Page[...]`, ns converted to ISO; trades also carry `entry_ts_epoch_s` and `exit_ts_epoch_s`, fills `ts_epoch_s`.
- `GET /api/runs/{run_id}/equity` → `{run_id, source:"mtm_snapshots"|"realised_trades", basis:"B", label, usable, unusable_reason, starting_usd, final_usd, n_sessions, sessions_match, t[], date[], equity[], pnl[], balance?[], unrealized?[], net_qty?[]}`. Runs without snapshots use daily realised P&L on every NYSE session of the run window (label "realised, no MTM"). **Decided in Phase 3.1 (item g):** this chart curve keeps every NYSE session, gate-rejected ones as flat points, but the Basis B return series that analytics uses (`analytics/series.py`, `run_series`) follows ANALYTICS_CATALOG C1, "one row for every gated session", and drops them: za_orb drops the sessions `qa.day_gate` rejected for the run's variant (`results/screens/za_v0_rejected_days.json` or `za_v0_repaired_rejected_days.json`); overnight keeps its nights (sessions that start a night inside the window, minus `data.skipped`). The kept count must equal the run's `data.gated_days` (and `sessions`, `rejected_days`) or `data.nights`, and a dropped session must carry no realised P&L; either failure is an error, never a silently shorter series (both born failing in `tests/test_series.py`). Equity at every kept session is identical on both paths, so the curve still ends at `pnl_total`. Snapshot runs keep their own sessions (the sizing feed already leaves out the 7 sessions without bars).
- `GET /api/runs/{run_id}/sidecar/{name}` → sanitised JSON.
- `GET /api/runs/compare?ids=a,b` → one date axis; each run's equity divided by its starting balance K with 1.0 on the day before its first session, so the line ends at 1 + `total_return`; stats `{n_trades, pnl_total, fees_total, total_return, sharpe, max_drawdown, stats_note}` on Basis B. **Decided in the Phase 3 improvement run (item c):** Sharpe and max drawdown come from the tear sheet's own series (`analytics.series.run_returns`, one row per gated session), so the RUNS table, the compare view, the anchor check and the tear sheet show one value per run (za_orb repaired: 0.6078, not the 0.6066 of zero-return rejected sessions); the chart keeps its flat points. Where that series cannot be built they are null and `stats_note` says why (an unusable run, an account whose equity reached zero, unknown gated sessions).
- `GET /api/runs/stats?ids=a,b,...` → `list[CompareStats]`, the same stats for one or more distinct runs in the order asked, without the curves (added at the Phase 6 and 7 merge: RUNS asks for every readable run at once; `/runs/compare` takes 2 to 8).
- Run detail carries `anchor{..., verdict:"IDENTICAL"|"DIFFERENT"|"NOT COMPARABLE"}`: NOT COMPARABLE when the base is missing, either run is unusable (no Sharpe) or a count is absent, since a value missing on both sides is never a match. Both Sharpe values are the tear sheet's (item c).
- Errors never carry a path: a result.json that disappears after indexing answers 503 "result.json is no longer on disk" (the operating system's text would name the full path, and with it the user name).
- `GET /api/ledger` → `{ledger_found, rows[], anchor_pairs[]}`.

**Research**
- `GET /api/registry` → `{counts{rows, registered, passed, failed, checks}, rows[]}` from the file (DL12).
- `GET /api/hypotheses` → `list[HypothesisCard{name, registered, verdict, verdict_badge, verdict_note, n, p, control_p, bonferroni_p, holm_p, bh_q, spec, spec_sha256, spec_sha_ok, spec_rehash_ok, screen, round, pass_checks, headline_label, headline_value, headline_display, headline_unit, headline_basis:"A", t_stat, t_label, series_kind, series_costs[], nautilus_runs[], confirmations[], sealed[]}]`. The headline with its unit, and the t statistic, come from the frozen per-screen table `nq_terminal/des_shapes.py`; `headline_label` is the dotted JSON path. No headline points at the sizing screens' `dsr` (the Sharpe difference, ANALYTICS_CATALOG C4). `za_v0_C3_gao_momentum` reads its own `C3_gao_momentum` block and has no pass checks of its own. `confirmations` and `sealed` link an in-sample hypothesis to its sealed-window confirmation and files (`constants.CONFIRMS`, `SEALED_BY_PARENT`).
- `GET /api/hypotheses/{name}` → `{card, des{basis:"A", blocks[{label, value}], blocks_unit, cost_ladder[{ticks_per_side, value}], cost_ladder_unit, break_even_ticks_per_side}, screen, spec, auxiliaries, history, summary_name, summary_md}`. The DES extracts are read at fixed paths, never recomputed; `break_even_ticks_per_side` only where the screen records it.
- `GET /api/hypotheses/{name}/series?cost=0|1|2` → `{name, basis:"A", cost, unit, kind, source, t[], r[], equity[], r_bench, bench_label}`; `r_bench` holds null where the benchmark has no value. `dtsmom_v0` rows are dated at the last NYSE session of their `label` month (never after `end`, which is the first session of the next month; dating by `end` put every month one month late); `eurodrift_v0` void nights are rows worth 0, the screen's own unconditional book.
- `GET /api/confirmations` → confirmations with their own alpha, the spent label, `parent`, and the confirmation spec's own `pass_bar` and `hypothesis`, verbatim. `GET /api/sealed` → the servable sealed files; `GET /api/sealed/{name}` → CSVs through the allowlist, JSON without price-like keys (`constants.PRICE_KEY_WORDS` and friends; the lowercase `c` stays because it is the exposure scale there), markdown as text; every view labelled spent. Research JSON and markdown served by the hypothesis detail, the sealed views and the QA reports pass through `files.redact_local_paths`: a path under the data root keeps only its part below the root, any other home folder becomes `~`, so no response names the user.
- `GET /api/ledger` → typed rows plus anchor pairs.
- `GET /api/multiple-testing` → registry p values with Bonferroni and Holm boundaries plus BH q values (computed and compared with the stored columns).

**Analytics** (computed by `nq_terminal/analytics/` from the series above)
- Series (Phase 3.1, `nq_terminal/analytics/series.py`): `hypothesis_series` (Basis A from the screen CSVs through the research service; `return on capital` series as recorded, P 252 daily or 12 monthly; one-contract trade series summed per exit session and zero-filled on every session of the window the screen served (`serve.start` to `serve.end`, else the NQ data start 2010-09-28 to the fence; item d of the improvement run, which replaced first to last trade), gate-rejected sessions dropped for za_v0; where the screen records its evaluated session count (za_v0 `gated_days` 2,825, mac5rev_v0 `counts.sessions` 2,836, eurodrift_v0 `counts.candidates` 2,835) the series must match it or the build fails; nights and one-contract daily series keep their recorded rows) and `run_series` (Basis B, above). `run_returns` is the same Basis B series without a benchmark, shared with the RUNS stats. Every inconsistency (an empty series, repeated sessions, a NaN return, a count mismatch) is a `SeriesError`. Benchmarks per C6: the screen's `r_bh_k` or `r_lo_k` column; the paired Nautilus run for sized books and dtsmom (`volmanaged_bh`, the tsmom `bh` book, the dtsmom `lo` book, same ticks, window and variant); NQ buy and hold close to close through the gate (1d vendor, caller `terminal`) for intraday runs, and in USD per contract for one-contract NQ screens. Anchors: `r_m_1` Sharpe 0.9914875364356387 and dtsmom `r_ts_1` 0.25493487321272734 within 1e-12 through the builder.
- `GET /api/analytics/run/{run_id}?freq=D|M` and `GET /api/analytics/hypothesis/{name}?cost=0|1|2` → `Analytics{context{kind, name, cost, freq}, basis, basis_label, unit, on_capital, capital, periods_per_year, n, kind, source, label, tag, first, last, dropped[], bench_label, kpis[{key, label, value, unit, basis, tag, note}], ci{sharpe, lo, hi, z}, equity{t[], date[], equity[], bench[]}, drawdown{dd[], bench_dd[], max_drawdown, bench_max_drawdown}, drawdown_table[], rolling{sharpe_63, sharpe_252, vol_63, vol_252}, monthly{years[], months[], grid[][], yearly[]}, distribution{histogram{edges[], counts[], normal[], var_95, var_99}, qq{theoretical[], ordered[]}, stats{PF10}}, risk{var_95, cvar_95, var_99, cvar_99, tails21}, relative{information_ratio, tracking_error, alpha, blocks}?, stored_alpha?, validity{psr, min_trl, moments, registry?, sharpe_difference_tests}}` (Phase 3.3, `api/analytics.py`, built by `services/tearsheet.py`). Every section and KPI tile names its basis and unit; tiles carry `[POST HOC]` when computed and `[PRE-REG]` when read from a registered result. `rolling{windows, window_unit, sharpe_short, sharpe_long, vol_short, vol_long}`: 63 and 252 sessions for a daily series; 12 and 36 months for a monthly one (item e; a 252-month line was always empty). The histogram names its `bin_rule` (Sturges when the interquartile range is 0, where Freedman-Diaconis gives one bin). A one-contract series gets no `alpha_annual_pct` anywhere in `relative` (P x a x 100 is a percentage only on capital). `validity.min_trl.*.reason` is `reachable`, `below_threshold` or `undefined`, and `validity.psr.at_benchmark_note` says the benchmark Sharpe is a fixed threshold (the difference tests are SV7). Every number is the part A function applied to the stage A series. The KPI row holds 13 tiles (`total_return` to `alpha_t`, in the tear sheet order of UI_SPEC section 7); a one-contract series (`on_capital` false: USD or basis points, no K) gets a null value with a note on the four tiles that need K (total return, CAGR, Calmar, annual alpha), and its equity is the cumulative P&L. BR1: where the screen records a spanning-alpha fit (`services/stored_alpha.py`, a frozen path per hypothesis and cost), the alpha tiles show it `[PRE-REG]` and `relative` keeps the terminal's own fit (`[POST HOC]`, Newey-West lags 5 and 21 daily, 4 monthly); runs always use the terminal's fit. `freq=M` compounds a run's sessions into months (P 12; a benchmark month with a missing session is null); RK2 21-session tails are null for a monthly series. SV4 (`validity.registry`) sets the registry's three stored adjusted columns beside `validity.registry_adjustments` over the family. Errors: 404 for an unknown name or run, or an unrecorded cost; 422 unusable run (rule 4), a bad parameter, or an account whose equity reaches zero or below (it cannot compound: the three lookahead probe runs, `not compoundable: equity <= 0 on 188 sessions (first 2012-02-17, ...)`; a deterministic property of the run, so not 503); 403 gate refusal; 503 a missing or inconsistent source. No detail carries a path.
- `GET /api/analytics/run/{run_id}/trades` → `RunTrades{run_id, kind, tag, unit, stats{TA1}, summary{stored}, hit_rate_matches, by_hour|null, hour_note, by_weekday, by_month, slippage{TA6}}`; `GET /api/analytics/run/{run_id}/costs` → `RunCosts{waterfall{EX3}, sensitivity{EX4}}`; `GET /api/analytics/run/{run_id}/exposure` → `RunExposure{available, note, exposure{EX1}|null, turnover{EX2}|null}` (each view carries `t[]`, epoch seconds at 00:00 UTC of each session date, beside `date[]`) (item a of the improvement run; `models/run_views.py`, built by `services/run_books.py`, apart from the tear sheet so it stays light). TA3 groups by entry hour only for intraday runs; a book enters at the session close by rule, so `by_hour` is null with `hour_note`. TA6 is real fills only: `results/quote_check_v1.json` (read only) and the paper book journal's close-row `slippage_ticks`, performance rows only (plumbing rows dropped and counted, `plumbing_banner`); backtest fills are modelled and get no distribution. **Decided in Phase 8 (TA6):** each real-fill sample shows only beside the strategy it belongs to, and the caption names it: the quote check is a 96-trade za_orb sample, so its rows (entry, and the exits by reason) show on za_orb runs only ("real fills of the za_orb quote-check sample (results/quote_check_v1.json)"); the live close rows come from the paper book, which trades volmanaged on MNQ, so they show on volmanaged runs only ("real fills of the paper book close rows (<journal>, volmanaged on MNQ)"); every other run shows no rows and says why. The API still sends every group; the choice is the tear sheet's (`screens/tear/tearBooks.ts` `slippageView`, born failing in `tearSlippage.test.ts`). EX1 values notional at the raw contract close: the sized books' own `strategy_log.closes[].raw`, dtsmom's 1d vendor `c_none` through the gate (caller `terminal`, the in-sample window, one serve per instrument root; a root that is not `[A-Z0-9]{1,6}` is refused before any serve); only without a price source is the back-adjusted snapshot price used, and `price_basis` says so. Same error mapping as the tear sheet (422 unusable run; 503 a cost, fill or snapshot inconsistency). A venue cost that changes by era (text such as eomtsy_v0's ZT `from 2010-01-01: ...; from 2019-01-14: ...`) is refused by name with 503: one cost per side per instrument cannot describe it.
- `GET /api/analytics/hypothesis/{name}/panel?cost=` and `GET /api/analytics/run/{run_id}/panel?freq=` → `HomePanel{...the series fields above, equity_unit, t[], date[], equity[], bench_equity[], underwater[], bench_underwater[], rolling_sharpe[], rolling_window, rolling_unit, rolling_unit_label, drawdown_unit, sharpe, bench_sharpe, max_drawdown, bench_max_drawdown, alpha[2 Kpi]}` for HOME `[B]` (the units and the two alpha tiles exactly as the tear sheet builds them); the rolling Sharpe uses the long window (252 sessions, or 36 months).

**Data**
- `GET /api/data/catalog` → series listed from parquet metadata only.
- `GET /api/bars?symbol=&timeframe=1m|5m|15m|1h|4h|1d&variant=vendor|repaired&start=&end=&max_points=4000` → `{symbol, timeframe, variant, bucket, ts_convention:"bar open, UTC", start, end, label, t[], o[], h[], l[], c[], v[], rolls[{t, from, to, gap_pts, gap_pct}], sessions{assessed, source, gated[], repaired[]}, gate{caller, served_years, cached, reads_this_process}}`. OHLCV bucket aggregation (true highs and lows, no LTTB on prices, DL4). **403** with the gate's own message for any window outside `[2010-01-01, 2022-01-01)`. **422** for a span over one year of 1m or three years of 5m to 4h (1d has no cap). `sessions` lists the session dates `qa.day_gate` rejected (`[GATED]`) and, on the repaired variant, the ones rebuilt from trades (`[REPAIRED]`), from the za_v0 rejected-day files; other symbols are not assessed. The year cache is keyed on the file's (mtime_ns, size), so a rewritten processed file is served again, and at most two gate serves run at once.
- `GET /api/market/universe?window=252` → the 27-future return table (1D, 1W, 1M, 3M, YTD, 12M to 2021-12-31, vol-normalised), correlation matrix and cluster order. Each row carries its contract `tick` and `tick_usd` (`nq_lab.dtsmom_universe.TABLE`), so MON prints the last close to the tick.
- `GET /api/market/pair-corr?a=&b=&window=63` → `{a, b, window, label:"[POST HOC] ...", basis, t[], date[], corr[], gate}`: the rolling correlation of two universe symbols' daily returns on the same gated, cached 1d frames (the CORR cell click-through); its last value equals the universe's windowed matrix entry.
- `GET /api/qa` → the QA and repair reports by name; `GET /api/qa/{name}` → `{name, modified_utc, fence_end, fenced_out, content}`, the content with every market time, year key and epoch after the fence removed (`services/fence.py`; process write times `*_utc` stay).

**Audit**
- `GET /api/audit/oos-log?caller=&since=&limit=&offset=` → counts over the whole log (by key set, by caller, and the terminal and sealed reads), `matched`, and one page of entries: `offset` counts back from the newest, entries oldest first inside the page.
- `GET /api/audit/openings` → openings file and pin status.
- `GET /api/audit/spec-hashes` → every spec re-hashed against its result; the registry is read through the same parser as `/api/hypotheses`, so a half-written `registry.csv` is a 503, never a verdict over a short list.

**Live** (read-only)
- `GET /api/live/status` → `{journals[{name, path, rows, plumbing_rows, performance_rows, plumbing, bad_lines, partial_line_pending, last_type, last_date, last_row_utc, last_halted}], logs[{name, path, size_bytes, modified_utc, plumbing}], expected[{name, path, present, empty_state}], kill_switch_on, kill_switch_path, exposure_summary, last_close, halted, env{ib_host, ib_port, account_masked, delayed_flag_set, volman_c_set, base_usd_rate_set}, next{decision_et:"15:55:05", order_et:"15:59:30", contract, roll_date, today_et}, banner, read_only, order_path:"none", tws:"not monitored"}`. `halted` is the book journal's latest performance close row only; per-journal flags stay in `journals[].last_halted`. Env: a loopback `IB_HOST` and a valid `IB_PORT` are shown as values, any other host as "set (not loopback)", everything else as set or unset only.
- `GET /api/live/journal?file=&type=&limit=&offset=` → rows with computed `plumbing` and ISO versions of `*_ns` fields.
- `GET /api/live/log?file=&tail=500` → parsed lines; `file` is one of `status.logs[].name`. IB account ids are masked (lettered paper forms such as `DUX123456` included, and the configured `IB_ACCOUNT_ID` wherever it appears).
- `GET /api/live/performance?file=` → target against actual from one journal's performance rows only (plumbing rows dropped and counted): `{journal, present, empty_state, basis, banner, plumbing_rows_skipped, t[], line_no[], date[], contract[], target[], expected[], actual[], reconciled_ok[], exposure[], slippage_ticks[], sent[], refused[], error[], halted[]}`. Added in Phase 2 for the LIVE step chart (LV2). `t` is epoch seconds at 00:00 UTC of each date and `line_no` the journal line of each close row, so LIVE matches its rows line for line with `/api/live/journal`.
- Live updates in P0 use react-query polling every 2 s. From P1 (TASKS 9.2), `GET /api/live/stream` sends the same data as Server-Sent Events (`fastapi.sse.EventSourceResponse`; kinds hello, status, kill_switch, journal_reset, journal_row, heartbeat, bye; each event's id is the journal cursor, sent back as Last-Event-ID on a reconnect). The web client (`web/src/api/liveStream.ts`, `useLiveStream.ts`) opens one stream while LIVE or JRNL is on screen: a status event is written into the status query's cache, a journal event refreshes the journal-derived GETs once a burst settles, and nothing polls while the stream is open. It falls back to the 2 s polling when the browser has no EventSource, the stream is refused (503 when too many are open) or a reconnect takes over 8 s, retries a refused stream after 5 to 60 s, and replaces a stream silent for three heartbeats. Only `web/src/api/client.ts` may open an EventSource (the GET-only source scan). LIVE and JRNL show the stream's state in words.

**Jobs (P2, U3)**
- `GET /api/jobs` -> `JobList{jobs[Job], queued, running, queue_cap:10, enabled}`, newest first. `enabled` is false in fixture mode.
- `GET /api/jobs/{job_id}` -> `Job{id:"j_<12 hex>", run_id, state:"queued"|"running"|"ok"|"failed"|"error"|"stopped", spec, created, started?, finished?, exit_code?, message, log_tail[<=100 lines]}`.
- `POST /api/jobs` (201, body `JobSpec{strategy, params, variant, start, end, run_id}`) queues one in-sample backtest. 403 without a loopback peer or `X-NQT: 1`, 415 unless `application/json`, 413 over 8 KB, 422 for a refused spec, 409 for a run id already used, 429 when 10 jobs already wait, 503 in fixture mode.
- `DELETE /api/jobs/{job_id}` stops a queued or running job, or drops a finished job's record; same 403 and 415 rules; it never removes run output.

**P2 views (U3)**
- `GET /api/ib/snapshot` -> `IbSnapshot{state:"ok"|"disabled"|"unavailable"|"refused", message, read_only, order_path:"none", client_id:95, accounts_masked[], server_time_utc, fetched_at_utc, cached, age_s, cache_seconds, incomplete[], truncated, notes[], summary[], positions[], open_orders[], executions[]}`. Always 200. Opt-in by `NQT_IB_READONLY=1`; one TWS read is cached 5 s; account ids are masked.
- `GET /api/analytics/spa` -> `SpaView` (SV8): the SPA, the Reality Check and StepM over the registered NQ family, with the members' differential correlation and, on both rows, the effective number of members (`effective_members`, `analytics/neff.py`).
- `GET /api/analytics/deflated` -> `DeflatedView` (SV3), which also carries SV3b as `effective_n` (`EffectiveNView`: the common window, correlation, eigenvalues, participation ratio, Li and Ji count, clusters, N total, SR0 and DSR under each N, or a refusal), built from the very trials SV3 is computed from.
- `GET /api/analytics/paper-expectation?file=` -> `PaperExpectation` (LV6, LV6b): the paper and model cumulative P&L as a fraction of K placed on the backtest-start cone (`backtest`) and on the live-start cone resampled from the paper book's own sessions (`live`), or a refusal code; no gate read, the backtest cone is cached per series. 404 for a journal that is not known, 503 for a source that cannot be read.
- `GET /api/analytics/hypothesis/{name}/risk-extras?cost=` and `GET /api/analytics/run/{run_id}/risk-extras?freq=` -> `RiskExtras` (RK4, PF11, BR5 of the tear sheet's own series; the ES, ulcer index and recovery factor on RET, Treynor on RR; 422 under four observations).
- `GET /api/analytics/hypothesis/{name}/trend-regime?cost=` and `GET /api/analytics/run/{run_id}/trend-regime` -> `TrendRegimeView` (RG2; a run only at the daily frequency).
- `GET /api/analytics/run/{run_id}/capacity` -> `RunCapacity` (EX5; 422 for an unbalanced run).
- `GET /api/market/term-structure/{root}` -> `TermStructure` (MV6).

Contract discipline: pytest dumps `app.openapi()` and compares it with `contract/openapi.json`; `pnpm gen:api` regenerates `schema.d.ts` and `openapi.sha256`; pytest asserts the sha matches, so a changed backend fails until the types are regenerated and `tsc --noEmit` passes.

### 4.1 Endpoint index

Every path of `contract/openapi.json` (75; 73 are GET only, and `/api/jobs` and `/api/jobs/{job_id}` also carry the POST and the DELETE), grouped by domain, with the screens whose code reads it. The consumers come from a search of the `useApiQuery` sites and the hooks in `web/src/api/queries.ts` and `queries.screens.ts`, so they are best effort: a view that reads a path through a shared hook can be missed, and `no screen yet` means a hook exists and no screen calls it. The demo answers all 74 (`web/src/demo/routes.ts`); a path it holds no capture for answers "not in the demo dataset". `web/scripts/docsSync.test.ts` fails when this list and the contract differ, so update it in the same change as the contract.

<!-- endpoint-index:start -->
**System**
- `GET /api/health`: the status line, the connection strip and GRAB's caption clock (chrome, every screen)
- `GET /api/commands`: the command line, HELP and `#go=` links; GP controls, DES for an instrument and the tear sheet's run books

**Runs and ledger**
- `GET /api/runs`: RUNS, GP fill markers, DES 5) Robustness forks, the record watch
- `GET /api/runs/compare`: RUNS 90) Compare
- `GET /api/runs/stats`: RUNS (table statistics and the compare basket)
- `GET /api/runs/{run_id}`: RUN, COST, EXPO and the tear sheet's run books
- `GET /api/runs/{run_id}/equity`: no screen yet (RUN's chart reads the analytics panel)
- `GET /api/runs/{run_id}/fills`: RUN fills (Table or Pivot), GP fill markers
- `GET /api/runs/{run_id}/log/{section}`: RUN log tables
- `GET /api/runs/{run_id}/sidecar/{name}`: no screen yet
- `GET /api/runs/{run_id}/trades`: RUN trades (Table or Pivot)
- `GET /api/ledger`: LEDG (Table or Pivot), the record watch

**Research**
- `GET /api/registry`: REG, MT 86) Replication, the record watch
- `GET /api/hypotheses`: REG, DES, the OOS log grid
- `GET /api/hypotheses/{name}`: DES, REG 92) Evidence, 93) Cost survival and 95) Compare, COST, BLK, SEAL, SEAS, the tear sheet
- `GET /api/hypotheses/{name}/series`: REG 95) Compare
- `GET /api/confirmations`: REG, DES, COST, SEAL, the record watch
- `GET /api/sealed`: SEAL, DES
- `GET /api/sealed/{name}`: SEAL
- `GET /api/multiple-testing`: MT 85) Family and its power panel, REG

**Analytics**
- `GET /api/analytics/deflated`: MT 85) Family and 87) Effective trials, REG (DSR column, 92) Evidence, 94) Effect map), DES profile
- `GET /api/analytics/hypothesis/{name}`: the tear sheet (EQ, DD, RET, RR, MRET), DES equity and 5) Robustness
- `GET /api/analytics/hypothesis/{name}/bootstrap`: the tear sheet (Sharpe intervals, SV6 cone, SV7 card)
- `GET /api/analytics/hypothesis/{name}/extended`: the tear sheet (P1 views)
- `GET /api/analytics/hypothesis/{name}/panel`: HOME equity panel, DES equity
- `GET /api/analytics/hypothesis/{name}/risk-extras`: the tear sheet RET and RR (RK4, PF11, BR5)
- `GET /api/analytics/hypothesis/{name}/trend-regime`: the tear sheet RR tab (RG2 trend regime)
- `GET /api/analytics/paper-expectation`: LIVE LV6 and LV6b (the paper and model paths on the backtest-start and the live-start cones, `[POST HOC]`; served by `analytics/expectation.py`, no gate read)
- `GET /api/analytics/paper-tracking`: LIVE (paper against model), also read by LV6 for its fault words
- `GET /api/analytics/spa`: MT 88) Family test (SV8)
- `GET /api/analytics/run/{run_id}`: the tear sheet, DES 5) Robustness forks
- `GET /api/analytics/run/{run_id}/bootstrap`: the tear sheet
- `GET /api/analytics/run/{run_id}/capacity`: the tear sheet's run books and EXPO (EX5 capacity)
- `GET /api/analytics/run/{run_id}/costs`: COST, the tear sheet's run books
- `GET /api/analytics/run/{run_id}/excursions`: the tear sheet's run books
- `GET /api/analytics/run/{run_id}/exposure`: EXPO, the tear sheet's exposure composition
- `GET /api/analytics/run/{run_id}/extended`: the tear sheet (P1 views)
- `GET /api/analytics/run/{run_id}/panel`: HOME equity panel, RUN chart
- `GET /api/analytics/run/{run_id}/risk-extras`: the tear sheet RET and RR (RK4, PF11, BR5)
- `GET /api/analytics/run/{run_id}/trend-regime`: the tear sheet RR tab (RG2 trend regime)
- `GET /api/analytics/run/{run_id}/trade-paths`: the tear sheet's run books
- `GET /api/analytics/run/{run_id}/trades`: the tear sheet's run books

**Market data**
- `GET /api/bars`: GP, GIP
- `GET /api/data/catalog`: GP
- `GET /api/instruments/{root}`: DES for an instrument
- `GET /api/market/pair-corr`: CORR
- `GET /api/market/paper-rolls`: ROLL 3) Paper book MNQ
- `GET /api/market/rolls`: ROLL
- `GET /api/market/term-structure/{root}`: ROLL 2) Market (MV6 term structure)
- `GET /api/market/rv`: GP RV22 pane
- `GET /api/market/two-day`: MON 2Day sparklines
- `GET /api/market/universe`: MON, CORR, GP
- `GET /api/market/vcone`: VCONE
- `GET /api/market/vcone/universe`: VCONE 27F view
- `GET /api/qa`: no screen yet
- `GET /api/qa/{name}`: no screen yet

**Audit**
- `GET /api/audit/oos-log`: OOS, DES (the read count), the event tape, the record watch
- `GET /api/audit/openings`: OOS, the record watch
- `GET /api/audit/spec-hashes`: no screen yet

**Live**
- `GET /api/live/journal`: JRNL, LIVE performance
- `GET /api/live/log`: no screen yet
- `GET /api/live/performance`: LIVE
- `GET /api/live/routes`: LIVE Routes and Fills
- `GET /api/live/status`: LIVE, JRNL
- `GET /api/live/stream`: LIVE and JRNL through the live stream client (Server-Sent Events)

**Backtest queue and IB snapshot (P2)**
- `GET /api/ib/snapshot`: LIVE (the read-only IB panel) and the status line's TWS segment; opt-in `NQT_IB_READONLY=1`, client id 95
- `GET /api/jobs`: JOBS (the queue list and the queue counts)
- `GET /api/jobs/{job_id}`: JOBS (one job and its log tail)
(`POST /api/jobs` and `DELETE /api/jobs/{job_id}` are the only writes; they are described in section 4 and section 8, not in this GET index.)

**Events, seasonality and data quality**
- `GET /api/events/calendar`: EVT
- `GET /api/events/study`: EVT
- `GET /api/seasonality/hypothesis/{name}`: SEAS for a hypothesis
- `GET /api/seasonality/instrument/{root}`: SEAS for an instrument
- `GET /api/dq/calendar/{symbol}`: DQ
- `GET /api/dq/guards`: DQ
- `GET /api/dq/symbols`: DQ
<!-- endpoint-index:end -->

## 5. OOS gate design

1. **One door.** The terminal calls only `nq_lab.data.serve(start, end, caller="terminal", reason=..., symbol, timeframe, variant)`. No new gate code; `oos_gate.py` is unchanged; `serve_sealed` is never called.
2. **Injected serve.** `BarService(serve_fn=nq_lab.data.serve)`. Tests inject a wrapper around `oos_gate.serve_bars(..., log_path=tmp, loader=synthetic)`, because `serve_bars` binds `log_path=OOS_LOG` at definition time and monkeypatching `config.OOS_LOG` would not redirect it.
3. **Year-aligned cache (DL1).** A request is widened to the calendar years it touches, clamped to `[IS_START, IS_END)`. 1m and 5m to 4h are served per year; 1d is served for the whole in-sample window in one call. A miss makes one `serve` call with reason `terminal display: <symbol> <tf> <variant> <year> (chart only, not a registered test)`. The frame is held in memory under `(symbol, timeframe, variant, year)` in an LRU capped by bytes (default 2 GB). Nothing is written to disk.
4. **Friendly refusal.** The API pre-checks the window against `nq_lab.config.IS_START` and `IS_END` to return a clean 403, but still lets the gate decide; it does not reimplement `check_window`.
5. **AST ban.** A test over `terminal/backend` fails on `read_parquet`, `pyarrow.parquet` (except `ParquetFile(...).metadata` and `.schema_arrow` in `catalog.py`), `pq.read_table`, `pyarrow.dataset`, `duckdb`, `polars`, `serve_sealed`, and any string containing `data/processed` or `data/raw`.
6. **Audit visibility.** `/api/health.gate_reads_this_process` and `OOS` show every terminal line. Typical use writes 5 to 30 lines per server process.
7. **Descriptive label.** Every analytic computed on gated bars (realised volatility, correlation, seasonality) is tagged `[POST HOC] descriptive, in-sample, not a registered test` and shows no p-values on slices the user picks.

## 6. Nautilus inside the terminal

- **P0 and P1: display only.** Existing runs from `backtests/output/`, with badges (section 3.1), balance and MTM checks, coverage, sidecars, anchor comparison (anchor pairs must match exactly on `n_trades`, `pnl_total`, `fees_total` and Sharpe; the UI shows IDENTICAL or DIFFERENT).
- **Ledger.** The terminal never writes `results/ledger.csv` and never imports `scripts.ledger_append`. For an eligible run (balance ok, coverage ok or null, not a probe, not ledgered) it shows a copy button with the command (run from the nq-lab root): `"<nq-lab root>\.venv\Scripts\python.exe" scripts\ledger_append.py backtests\output\<run_id>\result.json --exp-id <exp>`.
- **Nautilus statistics.** Used only as the second implementation in tests (DL7), fed `{ts_ns: r}` on a session index. `PortfolioAnalyzer.portfolio_returns()`, the tearsheet and `Alpha` are not used (DL19).

## 7. Live monitor (read-only)

- Tailer: polls every 1 s, keeps a byte offset per file, reopens on truncation (`size < offset`), holds back a partial last line, parses with `json.loads` (which accepts NaN) then maps NaN and Inf to `null`.
- Every plumbing row carries `plumbing: true` from `is_plumbing` and renders with the exact `BANNER` text on a hatched background. Performance views use `performance_rows` only.
- Empty states: "no journal yet" per expected file.
- The terminal shows the kill-switch state and never creates or deletes `live/KILL*`.

## 8. P2 components (U3 approved, built)

**Job runner.** `JobSpec(extra="forbid")`: `strategy` literal equal to `run_base.FEEDS` keys (test asserts equality), `params` checked against `strategies.registry.STRATEGIES`, `variant`, `start >= 2010-01-01`, `end <= 2022-01-01`, `run_id` matching `^t_[A-Za-z0-9_.-]{1,80}$`. Runs `subprocess.Popen([PY, "-u", str(ROOT/"backtests"/"run_base.py"), "--config", json.dumps(cfg)], cwd=ROOT, env={..., "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"})` in a worker thread, argv list, never `shell=True`. One worker, queue cap 10. Exit 0 ok, 1 failed checks, else error. State under `terminal/state/`. `POST` requires `X-NQT: 1` and `Content-Type: application/json`. Built in `services/jobs.py`, `models/jobs.py` and `api/jobs.py`. The queue cap counts waiting jobs (one running plus 10 waiting are accepted). `params` may name the strategy's config fields and the keys its feed consumes (`ticks` is required, 0, 1 or 2, for volmanaged, volmanaged_bh, tsmom, dtsmom and eomtsy); `lookahead_probe` and the runner-assigned instrument keys are refused. Text parameters match `[A-Za-z0-9_.:+-]{1,64}`. The state file is `terminal/state/jobs.json` (git-ignored), replaced atomically; after a restart the job that was running becomes an error and queued jobs run again. DELETE stops a queued or running job and drops a finished job's record; it never touches `backtests/output`. A run id is refused when a job or `backtests/output/<run_id>` already uses it. The service is the only module on `WRITE_ALLOWED` in `tests/test_safety_ast.py`. The app is GET only except exactly `jobs.ALLOWED_WRITE_ROUTES` (`app.assert_get_only` takes that allow list; any other non-GET route still refuses the app), and the app's shutdown closes the service so a running child is stopped. In fixture mode the runner is off: the list is empty and POST answers 503; a harness may set `app.state.jobs` to a service over a fake runner. The web client sends the two writes from `web/src/api/jobsClient.ts` alone, and the GET-only source scan allows that one file and those two methods.

**IB snapshot.** `NQT_IB_READONLY=1`, ibapi client id **95** (never 0, nor any taken id: 11, 21, 91, 93), host and port checked by `live_guards.check_ib_host`, account by `live_guards.check_account` (DU only). Calls allowed: `reqAccountSummary`, `reqPositions`, `reqAllOpenOrders`, `reqExecutions`, `reqCurrentTime` and their cancels. The client subclass overrides `placeOrder`, `cancelOrder`, `reqGlobalCancel`, `exerciseOptions` and `reqAutoOpenOrders`, and the protobuf twin of each of those five and of `reqOpenOrders` (`placeOrderProtoBuf` and the rest), to raise; an AST test bans those names and `reqOpenOrders` as calls anywhere in `terminal/`, derives the set to override from the library (every public `EClient` method whose name carries order, cancel or exercise and that is not on a reviewed read-only list), and scans for ways round the ban (computed attribute names, raw `sendMsg`, `OUT` message ids outside the allow-list, `socket` and `ssl` imports). TWS "Read-Only API" cannot be the control, because it would block the paper book's own orders. Built as `services/ib_readonly_client.py` (the only module under `terminal/` that imports `ibapi`; it holds the client subclass, client id 95 and the checks), `services/ib_snapshot.py` (opt-in, host and port guards, masking, 5 s cache with a lock), `models/ib.py` and `api/ib.py` (`GET /api/ib/snapshot`, a plain `def` so the blocking read runs in the thread pool). Four layers keep orders out: (1) the twelve order-style calls of the library (the five above, `reqOpenOrders` and the six protobuf twins) are overridden to raise `OrderPathError`; (2) `sendMsg` and `sendMsgProtoBuf` refuse any outgoing message id except start, current time, account summary and its cancel, positions and its cancel, all open orders and executions; (3) client id 95 is fixed and ids 0, 11, 21, 91 and 93 are refused by `check_client_id`; (4) every account TWS reports must pass `live_guards.check_account` (DU only) before the first request, and one live account refuses the whole read. The host must pass `live_guards.check_ib_host` with the remote flag never on (`IB_ALLOW_REMOTE` is not honoured), and the live ports 7496 and 4001 are refused. Time limits: 4 s to the account list, 5 s for the replies; a section without its end marker is listed in `incomplete`; a TWS that is absent, silent or holding client id 95 gives state `unavailable`. Tests use a fake IB server on a loopback socket speaking the modern (protobuf, server version 213) wire format; no test connects to a real TWS or Gateway. The legacy text wire format (server version below 201) is not exercised. The LIVE screen shows the snapshot as a read-only panel (`screens/live/ib`): masked accounts, net liquidation, positions, open orders (view only) and today's executions, with explicit states (off, TWS not reachable, refused, STALE older than 30 s with the last values kept and dated, a failed read). The panel polls only while LIVE is open, and the status line's TWS segment reads `TWS read-only snapshot` only while that panel holds an ok, fresh snapshot.

## 9. Security

| Risk | Control |
|---|---|
| Order placement | No order code; AST ban on order call names across `terminal/` (a def of them is allowed only in the read-only client class, where each is a bare raise); the IB library may be imported only by `services/ib_readonly_client.py` and the test fake server; the client class refuses every outgoing message id outside an 8-id read-only allowlist; safety E2E asserts every request is GET (bar the two JOBS writes) and no route or component name matches `order|submit|cancel|modify` |
| Writes to the job queue | POST and DELETE under `/api/jobs` only; `X-NQT: 1`, `Content-Type: application/json`, loopback peer, same-origin `Sec-Fetch-Site` and `Origin` checked before the body is read (8 KB cap); the spec is validated against `run_base.FEEDS`, the strategy registry and the in-sample fence; argv list, never a shell; the child writes only what `run_base` writes for an in-sample run, never the ledger |
| Gate bypass | Section 5: one door, injected serve, AST ban, metadata-only catalog |
| 2022+ leak | `serve` refuses it; sealed CSVs by allowlist; fence on every axis; E2E asserts no served point after 2021-12-31 |
| Writes to research files | AST scan (backend and any other Python under `terminal/`): no `open(..., "w"/"a"/"x")`, `io.FileIO` in a writing mode, `write_text`, `write_bytes`, `to_csv`, `to_parquet`, `nq_lab.registry.write`, `scripts.*` imports outside `terminal/state`; sha256 session fixture on `oos_access_log.jsonl` (lines only appended with caller `terminal`), `ledger.csv`, `registry.csv`, `oos_openings.json`, plus `live/KILL` presence; the in-process audit hook refuses any write, remove, rename, mkdir, link or chmod under `results/`, `backtests/output/`, `data/`, `live/` and the fixtures, with paths canonicalised (8.3 aliases, the device prefix, hardlinks) |
| Cross-site requests to localhost (DNS rebinding, CSRF) | Bind `127.0.0.1` in code (`python -m nq_terminal`) and `LoopbackOnlyMiddleware` (403 unless the peer and the local address are loopback); `TrustedHostMiddleware(allowed_hosts=["127.0.0.1", "localhost"])`; no CORS middleware; one origin (DL13); `SameOriginApiMiddleware` refuses a GET under `/api` whose `Sec-Fetch-Site` is not same-origin or none, or whose `Origin` is not the terminal (so another page cannot forge gate reads into the audit log); P2 POST needs a custom header |
| Framing, sniffing | Every response: `X-Frame-Options: DENY`, CSP `default-src 'self'` with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; no `Server` header |
| Serving files around the gate | The only mount allowed is a plain `StaticFiles` at `/` serving exactly `web/dist`; the GET-only check refuses any other mount (a data/ or results/ folder, a subclass, another path) |
| Fixture mode | `NQT_FIXTURE_DIR` is resolved strictly and refused when it is a UNC or device path, the project root or a parent of it, or a folder inside the project other than `terminal/backend/tests/fixtures` |
| Path traversal | `run_id`, hypothesis names and file names validated against the index built from disk (allowlist), never joined from raw input |
| Secrets | None served. Account ids masked to `DU` plus length. Env values reported as set or unset only |
| Half-written files | Retry once after 200 ms on JSON decode error; index skips folders without `result.json` |
| Memory | Byte-capped LRUs; pagination; bucketed bars |
| Dependency drift | Exact pins; lock diff script asserts every existing package keeps its version (section 10) |

## 10. Dependency change procedure (after U1)

1. `pyproject.toml`: `[dependency-groups] terminal = ["fastapi==0.141.1", "uvicorn==0.54.0"]` and add `"terminal"` to `[tool.uv] default-groups` (a plain `uv sync` is exact and would otherwise remove them).
2. `uv lock --dry-run`: only additions allowed.
3. Copy `uv.lock` to a temporary folder, run `uv lock`, then a `tomllib` diff script asserting that every package present before keeps its version, naming nautilus-trader 1.231.0, pandas 2.3.3, pyarrow 25.0.1, quantpad-data 0.8.0, numpy 2.5.3 and pydantic 2.13.5.
4. `uv sync --locked`, then the existing nq-lab pytest suite (without `-W error::DeprecationWarning`).

## 11. Run and test commands

All commands run from the nq-lab root, the folder that holds this repository as `terminal\`.

- Start: `powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1`. It checks that the venv imports fastapi, builds `web/dist` if older than `web/src` (`pnpm --dir terminal\web install --frozen-lockfile` then `build`), starts the backend with `python -m nq_terminal` from `terminal\backend` (uvicorn bound to `127.0.0.1` in code, port `NQT_PORT`, default 8765) with quoted paths, and opens the browser.
- Dev: `start.ps1 -Dev` runs uvicorn `--reload` and Vite on 5173 with `/api` proxied.
- Backend tests: `& .venv\Scripts\python.exe -m pytest terminal\backend\tests`
- QA cross-checks: `uv run --project terminal\qa python -m crosscheck` (reads JSON dumps produced by the backend test run; never imports the backend).
- Front end: `pnpm --dir terminal\web test:types`, `test` (vitest), `e2e` (Playwright).
- Front end without Windows: `corepack pnpm --dir web e2e:offline`, `e2e:offline:perf` and `e2e:offline:baseline` (see the macOS and Linux paragraph below).
- Copy lint: the house style lint (a local tool, not in this repo) over an extracted strings file and every markdown the terminal renders from `terminal/`.

**macOS and Linux.** `./start.sh` in the repository root does what `start.ps1` does, plus `doctor`, `--demo`, `--full` and a Node guard: it finds Node and hands over to `scripts/start.mjs`, which reads `engines` from `web/package.json`. If the default Node is older, it switches to a Node 24 it finds in a fixed list of local places (or takes `NQT_NODE`), or refuses in words instead of the `node:sqlite` crash an older Node gives; it then runs the launcher, `web/scripts/start/launcher.ts`. `./start.sh doctor` checks the machine and names the mode a plain start picks: FULL when the nq-lab venv imports FastAPI, uvicorn and `nq_lab`, FIXTURE when `NQT_FIXTURE_DIR` is also set, otherwise DEMO ONLY (Vite serves the demo on 127.0.0.1:5174; no Python). Its options are `--demo`, `--full`, `--dev`, `--port N`, `--no-browser`, `--no-build` and `--dry-run` (the last five are `start.ps1`'s `-Dev`, `-Port`, `-NoBrowser`, `-NoBuild` and `-DryRun`), and every step is an argv list run without a shell. With no nq-lab checkout at all, the demo, the unit gates (`corepack pnpm test`, `test:types`, `build`, `build:gallery` and `build:demo`, run in `web/`) and the offline E2E (`e2e:offline`, `e2e:offline:perf`, `e2e:offline:baseline`) still run: the offline projects serve the demo route table (`src/demo`) as `GET /api/*` on 127.0.0.1:4373 and 4374 (`NQT_E2E_OFFLINE_PORT`, `NQT_E2E_DEMO_PORT`), and use the installed Chrome when the bundled Chromium is missing. Screenshot baselines are local, under `e2e/__screenshots__/offline-<platform>`. What still needs nq-lab: the backend, fixture mode, `pnpm e2e` (the fixture backend imports `nq_lab`), and `web/src/grids/JournalTable.model.test.ts`, which reads nq-lab's `src/nq_lab/paper_plumbing.py`. The offline suite skips a few tests the demo dataset cannot serve; `TESTING.md` lists them.

Fixture mode: `NQT_FIXTURE_DIR` points the backend at `backend/tests/fixtures/`. The fixture folder holds a two-row registry with its specs, one ledger row, the za_v0 rejected-day files, and the fixture runs with their journals and logs, so every P0 endpoint answers. On its own, fixture mode has no price source (bars and universe answer 503) and its catalog lists `<fixture root>/data/processed`, never the real folder. The E2E harness `backend/tests/fixture_app.py` (run with `python -m uvicorn fixture_app:app --app-dir terminal\backend\tests`, `NQT_FIXTURE_DIR` set) injects the fake serve over synthetic bars with a temporary audit log and the fake catalog, and refuses to start outside fixture mode; the production package never imports it (tested). E2E and screenshots are then deterministic and never touch the real audit log.
