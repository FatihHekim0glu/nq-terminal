# Testing

Which suites run where, and what the offline Playwright suite leaves out. The commands and suite sizes are in the
[README](../README.md) (Analytics and QA); this file holds what is too long for it. Every command is run from the
repository folder with Node 24, and `corepack pnpm --dir web` stands for pnpm in `web/`.

## Suites at a glance

| Suite | Runs on | Needs the nq-lab checkout | Command |
|---|---|---|---|
| Vitest, after the contract check | macOS, Linux, Windows | No, except one test (below) | `corepack pnpm --dir web test` |
| Types | macOS, Linux, Windows | No | `corepack pnpm --dir web test:types`, `test:e2e-types` |
| Builds and bundle budgets | macOS, Linux, Windows | No | `corepack pnpm --dir web build`, `build:gallery`, `build:demo` |
| Launcher tests | macOS, Linux, Windows | No | Part of Vitest: `web/scripts/start/*.test.ts` |
| Docs drift test | macOS, Linux, Windows | No | Part of Vitest: `web/scripts/docsSync.test.ts` |
| qa reference tests | Any machine with uv | No, except one test (below) | `cd qa`, then `uv run --frozen --offline pytest` |
| Backend pytest | The nq-lab virtual environment | Yes | See the README, Test commands |
| Coverage | The nq-lab virtual environment (backend); Node 24 (web) | Backend: yes | `scripts\record_green.ps1 -Check backend -Coverage`; web: `test:coverage`. See Coverage below |
| P2 fakes | Any machine with the nq-lab virtual environment | Yes | Part of backend pytest: a fake IB server on a loopback socket and a fake `run_base.py`; no test connects to a real TWS or Gateway |
| Playwright against the fixture backend | Windows | Yes | `corepack pnpm --dir web e2e`, `e2e:perf` |
| Playwright against the demo layer | macOS, Linux (not tried on Windows) | No | `corepack pnpm --dir web e2e:offline`, `e2e:offline:perf`, `e2e:offline:baseline` |

Two tests assume the nq-lab layout and fail outside it, on any machine: `web/src/grids/JournalTable.model.test.ts`
reads nq-lab's `src/nq_lab/paper_plumbing.py`, and qa's `test_the_default_dump_folder_is_under_terminal_qa` expects the
qa folder's parent to be named `terminal`.

## Coverage

Coverage is measured per area and recorded here, so that it can be held. Three areas, three tools. The figures are
line coverage (branch coverage is off everywhere), and they are readings: no script or CI job fails on a figure yet.

| Area | Tool | How to measure | Where the output goes |
|---|---|---|---|
| Backend (`backend/nq_terminal`) | pytest-cov 7.1.0 (coverage 7.16.1), installed in the lab virtual environment | `powershell -NoProfile -File scripts\record_green.ps1 -Check backend -Coverage` | `D:\dev\v04\coverage\` (`backend.coverage.json`, `backend.coverage`), and a `coverage` block in the dated backend record |
| Web (`web/src`) | `@vitest/coverage-v8` through the `test:coverage` script | `corepack pnpm --dir web test:coverage --coverage.reportsDirectory=D:/dev/v04/coverage/web --coverage.reporter=json-summary --coverage.reporter=text-summary` | `D:\dev\v04\coverage\web` (`coverage-summary.json`); the main tree needs `pnpm --dir web install --frozen-lockfile` once to get the package |
| Rust (`desktop/src-tauri`) | cargo-llvm-cov, on the MSVC leg of CI (wave w2b); not installed on this machine and not measured here | The CI job | The CI job's artefact |

`-Coverage` runs the same backend check as before (the same tests, in parallel when xdist is importable) and adds
`--cov=nq_terminal` and a JSON report. The dated record keeps naming the plain serial command, so `release_check.ps1`
accepts it as the backend record of its tree; it gains a `coverage` block with the percent, the statement counts (covered,
missing, total), the number of files, a percent per area and the report path. Nothing is written inside the repository or the
lab: the data file (`COVERAGE_FILE`) and the report go to `-CoverageDir`, and a folder that resolves inside either (by `..`,
a junction or a link) is refused with exit 2 before anything runs. A report left by an earlier run is deleted first, and a
pass whose report is missing or unreadable writes no record. The record is only written for a tree that did not change
while the tests ran, as for every record.

### Baselines

| Area | Line coverage | Statements (covered of total) | Files | Taken |
|---|---|---|---|---|
| Backend | 96.54% | 16,094 of 16,671 (577 missing) | 143 | 11 October 2026, base `16f56ec`, 4,950 passed and 9 skipped in 248 s with `-n 16` |
| Web (`web/src`) | 97.03% | 21,859 of 22,914 (95.40%); branches 88.39%, functions 93.67% | 779 | 11 October 2026, base `16f56ec` plus the w2a-supply-chain branch, 7,805 passed and 52 skipped in 158 s; the three lab-only tests left out, as in CI |
| Rust | not yet recorded | | | Wave w2b, from the MSVC leg |

The whole web report, which also counts the `scripts/` and `e2e/` files that the unit tests load, reads 94.45% of lines over 883
files (statements 92.82%, branches 86.59%, functions 91.65%). The baseline above is the `web/src` part, because the rule below is
about the app. The area under `web/src` with the lowest line coverage is `perspective` (83.57%); every other one is 94% or more.
The run was made in a copy of the tree (its `node_modules` installed from the lock), so the figure is a reading of the branch;
the main tree repeats it after the merge and replaces the row if it differs.

Backend by area (the first folder under `nq_terminal`, or `(root)` for the modules directly in it):

| Area | Files | Statements | Line coverage |
|---|---|---|---|
| `(root)` | 9 | 907 | 94.49% |
| `analytics` | 26 | 2,640 | 96.02% |
| `api` | 26 | 2,229 | 96.01% |
| `desktop` | 10 | 830 | 91.20% |
| `models` | 25 | 2,742 | 99.74% |
| `services` | 47 | 7,323 | 96.55% |

One module with 20 or more statements is under 80%: `desktop/fixture_main.py`, 67.3% of 49. The run that took these
figures was a measurement of the working tree while two other slices edited files outside `backend/`, so no stamped record
exists for it; the merge agent repeats it on the committed tree and replaces this table if the figures differ.

### The rule

**Coverage may not fall; new modules 80% or more.**

- A change may not lower an area's line coverage below the baseline above. If it must (code that is deleted together with
  its tests, for example), the change says why and lowers the baseline in the same commit.
- A coverage that rises moves the baseline up in the same commit, so that the table is always the last good reading.
- A new module (a new file under `backend/nq_terminal` or `web/src`) is covered to 80% of its lines or more by its own tests.
  Read it from the report: `files[<path>].summary.percent_covered` in `backend.coverage.json`.
- The owner's rule is 80% as the minimum. The baselines are above it; the rule exists to keep them there.

### Limits of the figure

- `backend/nq_terminal/services` has no `__init__.py`, so coverage.py does not list a module there that no test imports; it
  would be missing from the denominator instead of counting as 0%. The count of files in the report (143) must equal the
  number of `.py` files under `backend/nq_terminal` (143 on the base). A difference is a module nobody tests.
- The web report lists every non-test `.ts` and `.tsx` file under `web/src` (checked on the baseline run: none is missing), so a
  module that no test imports shows as 0% instead of dropping out. The report also counts the `scripts/` and `e2e/` files that
  the tests load, which is why the whole-report figure differs from the `web/src` one.
- Line coverage says a line ran, not that its result was checked. It is the floor of the test suite, not its measure.
- The report has empty property names (the module-level entry under `classes` and `functions`), which Windows PowerShell 5.1
  `ConvertFrom-Json` refuses; `record_green.ps1` reads it with `JavaScriptSerializer`. A script of your own should use
  Python's `json` module.

## Session token

Every `/api` path, the live stream included, is behind a session cookie (03 section 4.2), so a test reaches the app in
one of three ways. The backend tests use the shared client in `backend/tests/conftest.py` (`api_client(app)` or the
`authed_client` fixture), which holds a live session; `bare_client` has none and is for the refusal, proof and session
route tests only, and `test_route_refusal_walk.py` walks the app's own route list and counts the gaps (none). A backend
that a test starts in a process of its own gets its own temporary `NQT_STATE_DIR` and `NQT_JOBS=off`, and is reached
with `open_session(port, token)`. The Playwright projects that drive a backend redeem a one-time code in a global
set-up (`e2e/session.setup.ts`, `e2e/perf/session.setup.ts`) and keep the cookie as storage state; `smoke_real.ps1`
does the same from its own backend's lock. The offline projects need no token.

## P2 suites

- **Backtest queue.** `test_p2_jobs_models.py` (JobSpec refusals, pinned to `run_base.FEEDS`, the strategy registry and the fence), `test_p2_jobs_service.py` (queue cap, one worker, exit codes, the state file, a fake `run_base` round trip through the real `Popen` under a path with a space), `test_p2_jobs_api.py` (header, content type, origin, loopback and status codes) and `test_p2_jobs_safety.py` (static bans over the three JOBS files). `test_actions_params.py`, `test_actions_presets.py`, `test_actions_service.py` and `test_actions_api.py` cover the launch routes (named parameters and ranges, the in-sample window through the gate, the exact runner argv, MATCH and MISMATCH, 401, 403, 413, 415, 422, 503 and a byte snapshot of `results/` that stays unchanged). `test_app.py` and `test_openapi_contract.py` pin the write routes to exactly `POST /api/jobs`, `DELETE /api/jobs/{job_id}`, `POST /api/jobs/actions` and `PUT /api/workspaces/{doc}` and plant any other non-GET route born failing. The browser side is `web/e2e/launch.spec.ts` (the Start from form) and `web/e2e/jobsbar.spec.ts` (the job indicator, the finish notice and the anchor badge).
- **IB snapshot.** `backend/tests/ib_fake_server.py` is a loopback fake IB server (protobuf wire format, server version 213) with modes normal, silent, no_executions_end and client_id_in_use. `test_ib_readonly_client.py`, `test_ib_snapshot.py` and `test_ib_api.py` run over it; `test_ib_readonly_ast.py` is the order-name and import scan. No test may connect to a real TWS or Gateway.
- **Served estimators.** `test_p2_neff*.py` (SV3b and SV8's effective number, pinned to `qa/golden/p12_neff.json`; `test_p2_neff_bridge.py` writes `qa/golden/p2_neff_served.json`, the values the backend serves for the seeded golden panel and 8 correlation matrices, and fails when the file is stale: rewrite it with `NQT_UPDATE_NEFF_BRIDGE=1`) and `test_lv6_expectation*.py` with `test_dump_for_qa_lv6.py` (LV6 and LV6b, pinned to `qa/golden/p12_expectation.json`). The browser keeps the old estimators as test references (`web/src/quant/neffReference.ts`, `linalg.ts`, `cluster.ts`, `trials.ts`, `web/src/screens/live/expectationReference.ts`): `neffMirror.test.ts` requires them to equal the served golden to 1e-12 relative, and `src/quant/importGuard.test.ts` fails if a production file imports one.
- **Analytics.** `test_p2_spa*.py`, `test_p2_risk_extras*.py`, `test_p2_trend_regime.py`, `test_p2_capacity.py`, `test_p2_term_structure.py` and `test_p2_rct_api.py`, with their QA dump writers (`test_dump_for_qa_p2_*.py`) and references (`qa/crosscheck/p2_*.py`, registered in `dumps.py` and `compare.py`; `qa/tests/test_p2_dump_kinds.py` pins the input names).
- **Browser.** `e2e/flows/p2.spec.ts` opens every P2 surface against the fixture backend (MT 88, the RET and RR cards, a run's capacity, ROLL term structure, the LIVE IB panel over a fake snapshot, the JOBS submit and stop flow against a fake runner, the amber classic theme), with axe at both viewport sizes and in both looks, keyboard flows and screenshots with a black mask colour. `e2e/flows/safety.spec.ts` allows exactly the two JOBS writes.
- **LIVE cone toggle.** `e2e/flows/lv6.spec.ts` opens LIVE against the fixture backend (a two session paper book: the backtest-start cone is drawn, the live-start cone is refused in words), drives the Backtest start / Live start toggle with the arrow keys, Space and Enter, and runs axe at both viewport sizes and in both looks (standard and amber classic), with card screenshots under a black mask colour.
- **Baselines.** The 26 baselines of `p2.spec.ts` were taken on one Windows machine on 2026-10-01, with the JOBS table and log (a shared queue with server times) masked. The older baselines of the screens that P2 changes on purpose (RR and RR-run with the trend regime card, RET, EQ-run and EXPO with their new cards, LIVE with the IB panel, ROLL 2) Market) were not rewritten: renew them with `--update-snapshots` on the machine that owns them. Screenshot baselines are tied to a machine's text rendering: on a machine whose rendering differs, the same specs fail at the commit before P2 as well, so compare a run with the commit before it, or point `snapshotPathTemplate` at an empty folder and run with `--update-snapshots=all` so that every other assertion of a spec runs to its end.

## The workspace store and the desktop seams

The page keeps its saved state in the backend's workspace store (`web/src/state/remoteStore*.ts`, started from `web/src/main.tsx`).
Its unit tests are in `web/src/state/remoteStore*.test.ts(x)` and `web/src/demo/store.test.ts` (merge rules, the 500 ms debounce,
the pagehide flush, the per-origin import, the 404 fallback and the demo), and the backend's in `backend/tests/test_workspaces_*.py`.

Two Playwright specs prove it end to end, each against a fixture backend and a page server of its own, with its own temporary
state folder (nothing touches `terminal/state` or port 8765):

- `e2e/workspace-import.spec.ts`: ten keys seeded on a stand-in origin are imported once into six documents, `meta.imports`
  lists the origin, a reload repeats nothing, a load on another port with empty storage adopts the stored look and writes no
  file, and a backend that answers 404 leaves the page working from its cache.
- `e2e/desktop-seams.spec.ts`: a saved workspace loads after the backend is restarted on a new port with the same state
  folder; a launch code opens the terminal once and a reused code is refused; export and GRAB go through the shell bridge.

The shared Playwright run does not start the store: the gallery build leaves it off unless a spec sets `window.__NQT_STORE__`
before the page loads (`src/main.tsx`), because the run's tests share one fixture backend and a store shared by every browser
context would carry one test's layouts, theme and saved workspaces into the next. The two specs above set it, and so
do the HOME budget loads of `pnpm e2e:perf` (`e2e/perf/storeOn.ts`), so that figure includes the store step. In the
production build the store always starts. The stage 1 figures are taken by `docs/desktop/stage1/measure_stage1.mjs` and
recorded in `docs/desktop/stage1/stage1_numbers.md`.

## The offline Playwright suite

`e2e:offline` runs the Windows specs against a Node-side copy of the demo API, so a Mac or Linux box with no Python and
no backend can run them. `playwright.config.ts` (the Windows run) is untouched; `playwright.offline.config.ts` is the
offline one.

| Project | What it runs | Command |
|---|---|---|
| `offline` | `flows/safety`, `flows/keyboard`, `flows/scan` and `flows/rules`, `shell.spec.ts`, the `gallery-*.spec.ts` files and `visual/screens.spec.ts`, against the gallery build; at most two workers | `e2e:offline` |
| `offline-demo` | `e2e/offline/demo.offline.ts`, against the in-page demo build (the API served by the page, not over HTTP) | `e2e:offline` |
| `offline-perf` | `perf/budgets.spec.ts` alone, with one worker | `e2e:offline:perf` |
| `offline-webkit`, `offline-webkit-demo` | the same specs as `offline` and `offline-demo` under Playwright's WebKit (the `Desktop Safari` descriptor, the same page settings). Opt-in: `e2e:offline` never reaches them, they need `playwright install webkit`, and they write their own baselines (`offline-webkit-<platform>`) on the first run. The Windows defect list is `docs/desktop/v04/webkit_windows_defects.md` | `e2e:offline:webkit` |

- **Servers.** The config builds the gallery bundle and the demo bundle into `web/node_modules/.tmp` and serves them with
  `vite preview` on 127.0.0.1:4373 and 4374. The demo route table (`src/demo/serve.ts`) is served over HTTP as
  `GET /api/*` on the first, so `page.on('request')`, `page.route` and `page.request` see real traffic. Set
  `NQT_E2E_OFFLINE_PORT` and `NQT_E2E_DEMO_PORT` to move them; 8765, 5173 and 5174 are refused, and the two must differ.
- **Browser.** The bundled Chromium; when that is missing, the installed Google Chrome. `NQT_E2E_CHANNEL` forces a
  channel.
- **Baselines.** Screenshot baselines are this machine's own, in `web/e2e/__screenshots__/offline-<platform>`
  (git-ignored) and never compared with the Windows ones. `e2e:offline:baseline` is `e2e:offline` with
  `--update-snapshots=all`: run it once on a new machine, or after a screen or the demo data changes on purpose.
  Committing the baselines is the owner's decision.
- **Excluded by design.** Two probes of a real backend, "no backend route ..." and "the backend answers every write
  method ...", never run offline: the demo API has no write-method surface (its own refusals are pinned by
  `src/demo/serve.test.ts`).
- **Types.** `test:e2e-types` checks `e2e`, `e2e/offline`, `e2e/flows`, `e2e/perf` and `e2e/visual`.

## What the offline run skips

A test skip is `test.skip(OFFLINE, reason)` and shows as skipped in the run. A step skip is `leaveOutOffline(reason)`
(`e2e/flows/support.ts`): the step is left out, the rest of the test runs and passes, the reason is kept in the test's
annotations and one `[offline-skip] <title>: <reason>` line is printed to the run output. Every reason says the body is
"not in the demo dataset".

| Spec file | Test | Kind | Why |
|---|---|---|---|
| `e2e/flows/keyboard.spec.ts` | keyboard flows > NQ GIP 2019-03-14: Left and Right from the panel's Tab stop reach the chart | Test skip. Only the GIP iteration of the data-driven loop; the NQ GP iteration runs | 1m bars are not in the demo dataset (`src/demo/data/market.ts` serves daily vendor bars only). The missing body is `GET /api/bars` with timeframe 1m |
| `e2e/perf/budgets.spec.ts` | performance budgets > GIP pan and zoom run near 60 fps | Test skip | The same 1m bars |
| `e2e/flows/rules.spec.ts` | rule flows > the fence: GP, GIP, DES, MON and CORR serve nothing past 2021-12-31; a date past it is refused | Step skip. Opening NQ GIP 2019-03-14 and waiting for a 200 `/api/bars` answer is left out; GP, DES, MON, CORR and the refused 2022 date still run | The same 1m bars |

The step skip prints an `[offline-skip]` line; the run of 2026-09-29 printed this one (the reason is cut short here):

```text
[offline-skip] the fence: GP, GIP, DES, MON and CORR serve nothing past 2021-12-31; a date past it is refused: 1m bars are not in the demo dataset (...)
```

`e2e:offline` lists 190 tests in 14 files (`--list`). With the demo dataset as it is, two are skipped (the GIP iteration
above, and the session probe of `e2e/flows/safety.spec.ts`, because the demo layer has no session) and one leaves a step
out. `e2e:offline:perf` lists 3 tests in 1 file and skips one (GIP pan and zoom). On a Mac
(Node 24, Chrome channel, 2026-09-29) the performance project read: HOME first render median 554 ms against a 1,500 ms
budget, and the 8,411-fill grid opened in 65 ms, sorted in 34 ms and paged in 32 ms against 500 ms each. A screen or
demo data change moves the screenshots, and `e2e:offline` then fails those baseline comparisons until
`e2e:offline:baseline` rewrites them.

## Screens the offline list changes

The offline screen list is derived from the Windows one (`e2e/visual/screens.ts`, `SCREENS` itself untouched).

- **Left out: GIP**, at both viewports. 1m bars are not in the demo dataset. It is removed by
  `SCREENS.filter(name !== 'GIP')`; `SCREENS` itself is untouched.
- **Kept, under the demo's own line.** RUN opens `nt_dtsmom_v0_fixture_ts1 RUN`: the trades, fills and log tables are held
  for that run only. RR-run opens `nt_volmanaged_v0_fixture_m1 RR`: run analytics are held for that run and for
  `smoke_2015_01`.
- **Kept, with a different chart count.** LIVE draws 3 charts offline where the fixture draws 1: the target and exposure
  chart, the paper against model tracking chart and the LV6 expectation cone. EQ-run draws 1 (the equity chart of
  `smoke_2015_01`; its run books say the demo holds no trades, costs, exposure or extended body for it). RR-run draws 3.
  EQ-run and RR-run were skipped by name while the demo lacked the run records; they run now.
- **Kept, after the screen's own fields are set.** SEAS and EVT open on requests the demo refuses (From 2010 for SEAS,
  5 sessions before and after for EVT); the spec picks From 2020 and 2 sessions, which the demo holds, and each draws one
  chart.
- **New entries that run.** VCONE (1 chart), ROLL (0), DES-robustness (DES tab 5, 7 charts), REG-evidence, REG-costs
  and REG-map (REG 92, 93 and 94: 2, 3 and 3 charts; 91 is the default board), MT-replication (MT 86, 1 chart) and
  RUNS-compare (RUNS 90, 1 chart).
- **MT-trials (MT 87) draws its one chart.** The demo's deflated view carries the captured `effective_n` (`EFFECTIVE_N_REAL`,
  the real files' 15 daily trials), so the served correlation heatmap is drawn offline. It was the screen that drew nothing
  before the effective number of trials was served by the backend.
- **The chart counts are exact.** `screens.spec.ts` asserts each one, at both viewports, with axe clean.

## Substitutions, not skips

- `TEAR_SUBJECT` (`e2e/flows/support.ts`) is `volmanaged_v0` offline and `nt_volmanaged_v0_fixture_m1` on Windows. Only
  `keyboard.spec.ts` uses it (Left and Right in a focused grid or chart; the runs session's tear sheet). The hypothesis
  tear sheet has the same tabs, numbered keys and `[POST HOC]` tiles. The rules flow does not substitute: it opens
  `nt_volmanaged_v0_fixture_m1 EQ` itself and checks its `[POST HOC]` tiles offline too, because the demo now holds that
  run's record and analytics.
- `keyboard.spec.ts`, registry session, offline only: after the first Down the walk continues to `volmanaged_v0`. The
  demo registry lands on the check `za_v0_C3_gao_momentum`, whose DES reads `[CHECK]` and not `[PRE-REG]`.
- `e2e/perf/pages.ts` `watch()` records console errors as `<text> <url>` and, when it reads them, drops the "Failed to
  load resource" lines of URLs the demo refused (response header `x-nqt-demo: not-in-dataset`). Against the fixture
  backend nothing carries the header, so nothing is dropped and the budgets spec is as strict as before
  (`scripts/playwrightOffline.test.ts` pins both).
- `budgets.spec.ts`, HOME test: `if (!OFFLINE) await warmBackend(request)`. There is no backend to warm offline; the
  budget still judges the median of three cold loads.

## Not run on Windows since these changes

This Mac has no fixture backend, so none of these ran on Windows:

1. `keyboard.spec.ts`, runs session: after LEDG replaced a panel inside the RUNS layout, the status line keeps naming
   the layout (`Screen RUNS* edited`); the step now asserts the LEDG panel and the "Opened LEDG" message. It follows the
   current UI and weakens nothing, but it is unrun on Windows.
2. `e2e/perf/pages.ts`, the watcher that drops the load-failure lines of URLs the demo refused. It should drop nothing
   there.
