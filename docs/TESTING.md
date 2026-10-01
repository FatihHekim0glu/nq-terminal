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
| P2 fakes | Any machine with the nq-lab virtual environment | Yes | Part of backend pytest: a fake IB server on a loopback socket and a fake `run_base.py`; no test connects to a real TWS or Gateway |
| Playwright against the fixture backend | Windows | Yes | `corepack pnpm --dir web e2e`, `e2e:perf` |
| Playwright against the demo layer | macOS, Linux (not tried on Windows) | No | `corepack pnpm --dir web e2e:offline`, `e2e:offline:perf`, `e2e:offline:baseline` |

Two tests assume the nq-lab layout and fail outside it, on any machine: `web/src/grids/JournalTable.model.test.ts`
reads nq-lab's `src/nq_lab/paper_plumbing.py`, and qa's `test_the_default_dump_folder_is_under_terminal_qa` expects the
qa folder's parent to be named `terminal`.

## P2 suites

- **Backtest queue.** `test_p2_jobs_models.py` (JobSpec refusals, pinned to `run_base.FEEDS`, the strategy registry and the fence), `test_p2_jobs_service.py` (queue cap, one worker, exit codes, the state file, a fake `run_base` round trip through the real `Popen` under a path with a space), `test_p2_jobs_api.py` (header, content type, origin, loopback and status codes) and `test_p2_jobs_safety.py` (static bans over the three JOBS files). `test_app.py` and `test_openapi_contract.py` pin the write routes to exactly `POST /api/jobs` and `DELETE /api/jobs/{job_id}` and plant any other non-GET route born failing.
- **IB snapshot.** `backend/tests/ib_fake_server.py` is a loopback fake IB server (protobuf wire format, server version 213) with modes normal, silent, no_executions_end and client_id_in_use. `test_ib_readonly_client.py`, `test_ib_snapshot.py` and `test_ib_api.py` run over it; `test_ib_readonly_ast.py` is the order-name and import scan. No test may connect to a real TWS or Gateway.
- **Analytics.** `test_p2_spa*.py`, `test_p2_risk_extras*.py`, `test_p2_trend_regime.py`, `test_p2_capacity.py`, `test_p2_term_structure.py` and `test_p2_rct_api.py`, with their QA dump writers (`test_dump_for_qa_p2_*.py`) and references (`qa/crosscheck/p2_*.py`, registered in `dumps.py` and `compare.py`; `qa/tests/test_p2_dump_kinds.py` pins the input names).
- **Browser.** `e2e/flows/p2.spec.ts` opens every P2 surface against the fixture backend (MT 88, the RET and RR cards, a run's capacity, ROLL term structure, the LIVE IB panel over a fake snapshot, the JOBS submit and stop flow against a fake runner, the amber classic theme), with axe at both viewport sizes and in both looks, keyboard flows and screenshots with a black mask colour. `e2e/flows/safety.spec.ts` allows exactly the two JOBS writes.
- **Baselines.** The 26 baselines of `p2.spec.ts` were taken on one Windows machine on 2026-10-01, with the JOBS table and log (a shared queue with server times) masked. The older baselines of the screens that P2 changes on purpose (RR and RR-run with the trend regime card, RET, EQ-run and EXPO with their new cards, LIVE with the IB panel, ROLL 2) Market) were not rewritten: renew them with `--update-snapshots` on the machine that owns them. Screenshot baselines are tied to a machine's text rendering: on a machine whose rendering differs, the same specs fail at the commit before P2 as well, so compare a run with the commit before it, or point `snapshotPathTemplate` at an empty folder and run with `--update-snapshots=all` so that every other assertion of a spec runs to its end.

## The offline Playwright suite

`e2e:offline` runs the Windows specs against a Node-side copy of the demo API, so a Mac or Linux box with no Python and
no backend can run them. `playwright.config.ts` (the Windows run) is untouched; `playwright.offline.config.ts` is the
offline one.

| Project | What it runs | Command |
|---|---|---|
| `offline` | `flows/safety`, `flows/keyboard`, `flows/scan` and `flows/rules`, `shell.spec.ts`, the `gallery-*.spec.ts` files and `visual/screens.spec.ts`, against the gallery build; at most two workers | `e2e:offline` |
| `offline-demo` | `e2e/offline/demo.offline.ts`, against the in-page demo build (the API served by the page, not over HTTP) | `e2e:offline` |
| `offline-perf` | `perf/budgets.spec.ts` alone, with one worker | `e2e:offline:perf` |

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

`e2e:offline` lists 185 tests in 14 files (`--list`). With the demo dataset as it is, one is skipped (the GIP iteration
above) and one leaves a step out. `e2e:offline:perf` lists 3 tests in 1 file and skips one (GIP pan and zoom). On a Mac
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
- **MT-trials (MT 87) draws nothing, by design.** The demo holds the daily series of `volmanaged_v0` only, and the view
  says in words that it could not read the others. It is in the list as that honest state, not skipped.
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
