# Faster test loops (wave w2a-supply-chain, slice test-speed)

Roadmap rank 13: Playwright 11.7 min and vitest 76.8 s slow every later merge. This note records what was measured, what was
tried, what was kept and what was dropped, each with its reason.

## Outcome in one paragraph

Neither speed-up is kept. A second Playwright worker on the run's one backend cut the full run from 26.0 to 14 to 16 minutes on
a loaded PC, but each of two full runs lost two tests (timeouts of 10 s on a page load and on a command line that had not got its
index), so the "three green runs" bar was not met. `isolate: false` for vitest cut the full run from 101 s to about 60 s, but
12 to 65 tests in 7 to 15 files failed, a different set each run. Both are dropped with their reasons below. What is kept is
the guard: a test that stops anyone putting two workers on a backend that specs write to, and an explicit one-worker limit on
the budgets project. The two-worker layout is saved as a patch so it can be applied again once each worker has a backend of its own.

## Measurements

The PC was shared with two other waves and the 0.3.3 finisher (CPU load 70 to 75 per cent, about 9 GB free), so absolute times
are slower than the quiet-machine figures of the research report (Playwright 11.7 min). Ratios are what to read. Every run took the
PLAYWRIGHT or HEAVY slot, on ports 8815 and 4293, with the worktree's own state folder.

### Playwright (`playwright test --project=chromium`, 619 tests in 42 files)

| Run | Layout | Wall time | Result |
|-----|--------|-----------|--------|
| base1 | today's: one project, one effective worker | 26.0 min (1,557 s) | 619 passed |
| w2 run 1 | `chromium-writes` (1 worker) then `chromium` (2 workers) | 14.2 min (850 s) | 617 passed, 2 failed |
| w2 run 2 | same | 16.5 min (988 s) | 617 passed, 2 failed |

The first finding is that today's `pnpm e2e` has always been one worker: the project says `workers: 2`, but the top-level
`workers: 1` caps the whole run, and Playwright prints "Running 619 tests using 1 worker".

Where the time goes (base1, sum of test durations 1,534 s): `visual/screens` 309 s, `reflow-200` 207 s, `contrast-modes` 167 s,
`flows/p2` 129 s, `p11` 62 s, `gallery-echarts` 40 s, `desktop-seams` 38 s, `gallery-grids-tiles` 37 s, the rest 33 s or less each.
The four biggest files are 812 s, 53 per cent, and all but `flows/p2` only read.

The layout that was tried, in `two-project-layout.diff` (kept beside the run logs, see "Evidence"):

- `chromium-writes`: the six specs that change what the backend holds (`flows/p2`, `flows/safety`, `flows/scan`, `launch`,
  `workspace-import`, `desktop-seams`) plus `jobsbar`, one worker, running first.
- `chromium`: every other spec, two workers, with `dependencies: ['chromium-writes']` so that `pnpm e2e` (which names only
  `--project=chromium`) still ran everything: `--list` gave the same 619 tests in 42 files.
- Run 1 timeline: writers 0 to 219 s (63 tests, 206 s of test time), readers 219 to 849 s (556 tests, 1,073 s of test time).
  Two workers gave the readers 1.7 times, not 2 times, the speed-up.

Why it was dropped: the failures were `contrast-modes` forced-colours cases (`RR`, `ROLL`, `DQ`: the command line kept
its text with `aria-invalid`, so `openScreen` waited 10 s for it to clear) and one `home.spec` case (no panel title after
`page.goto('/')` in 10 s). Both are latency timeouts on the one shared backend process, the same family as the 0.3.3 note about
page loads lost under load. None failed in the serial baseline. Three green runs in a row were not reached, so the change is
dropped, as the slice allows.

### Vitest (`vitest run`, 523 files, 7,865 tests)

| Run | Setting | Wall time | Result |
|-----|---------|-----------|--------|
| vt_base1 | isolate on (today's) | 101.5 s | 7,818 passed, 1 file failed (see below) |
| vt_base2 | isolate on | 104.6 s | same |
| vt_noiso1 | `--no-isolate` | 59.1 s | 65 tests failed in 14 files, plus the same 1 file |
| vt_noiso2 | `--no-isolate` | 63.2 s | 12 tests failed in 6 files, plus the same 1 file |

Without isolation the suite is 40 per cent faster, about 42 s on this PC (the report's "about 30 s"), but it is not correct:
the zustand stores (the workspace's panels, the command line's index), the ECharts host and the DOM left by one file reach the next
file on the same worker. The failing set changes from run to run with the order the files land on the workers, so it is not a
list that could be pinned. Resetting that state per file is `vi.resetModules()` and a fresh DOM, which is what isolation already does.
`isolate` stays on; `web/vite.config.ts` carries a comment saying so and why.

The one file that fails in every run, `src/vendor/radixPrimitiveStub.test.tsx` ("Denied ID .../cmdk/dist/index.mjs?raw"), is an
artefact of this worktree: its `node_modules` links into the main tree's `.pnpm` store, outside the worktree, and Vite's file
serving rule denies the `?raw` import. It fails in the isolated baseline too, so it is not caused by this slice. It is a
post-merge check in the main tree.

Per-file time (vt_base1, sum of file times 318 s over 8 workers): `App.test.tsx` 47 s, `scripts/start/startPs1.test.ts` 41 s,
`JrnlScreen.test.tsx` 18 s, `RegScreen.test.tsx` 17 s, `RecordWatch.live.test.tsx` 11 s. The wall time is longer than the file
times divided by eight because of the environment set-up (31 per cent) and imports (13 per cent) that each isolated file repeats.
`startPs1.test.ts` and `App.test.tsx` are two long files that set a floor under any worker count.

## What is kept

`web/scripts/playwrightConfig.test.ts` gains `sharedBackendProblems(projects, specs)` and its tests. It reads every
`e2e/**/*.spec.ts`, and fails when:

- the budgets project has no explicit `workers: 1` (or more than one);
- a project has more than one worker while a spec in it writes (a queued run, a write request, the workspace store);
- a project that has a writing spec can run beside another project that has specs (it must be a dependency of it);
- a spec is run by no project or by two, or a project has more than two workers.

Born failing, shown against today's `playwright.config.ts` (saved in `red_final.txt`):

- "a perf project with more than one worker fails": today's `perf` project sets no `workers`, so it inherits whatever the top
  level says; the check reports `perf: workers is undefined, the budgets need exactly 1`.
- "a worker without its own state folder fails": today's `chromium` project says `workers: 2` over one state folder with six
  writing specs; the check reports `chromium: 2 workers share the one state folder, and e2e/desktop-seams.spec.ts, ... write to it`.
- The old "caps the main project at two workers" test now says one, and fails on today's tree with `expected 2 to be 1`.

`web/playwright.config.ts`: `chromium` and `perf` both `workers: 1`, so `pnpm e2e --workers=4` can no longer put two workers on
the shared backend; the comment gives the measured reason. Effective behaviour of `pnpm e2e` and `pnpm e2e:perf` is unchanged.

## What a safe second worker needs

A backend and a state folder of its own for each worker, which the slice could not build inside its files:

1. A second web server pair in the config (backend on its own port and its own `e2e-state-<port>` folder, marked and cleaned
   by `e2e/support/e2eState.ts` as the first one is) and a second preview, because the preview proxies to one API origin.
2. A second session cookie: `e2e/session.setup.ts` reads one `NQT_E2E_SESSION` and writes one storage file, and `workspace-import`,
   `desktop-seams` and `reflow-200` read `NQT_E2E_SESSION` or `NQT_E2E_STORAGE_STATE` themselves.
3. A project for each lane with its own `baseURL` and `storageState`.

These touch `e2e/session.setup.ts`, `e2e/vite.preview.config.ts` and three specs, none of which this slice owns. The patch
`two-project-layout.diff` and the timing above are the starting point; with a backend per worker the readers would also lose the
latency that failed the runs.

## New files and their fate (for 03 Appendix A)

None. No module, route or file was added; the three owned files changed in place (`web/playwright.config.ts`,
`web/scripts/playwrightConfig.test.ts`, `web/vite.config.ts` comment only) and this note.

## Evidence

Run logs, JSON reports and the saved patch are under `D:/dev/v04/w2a-supply-chain/test-speed/` (not in the repository): `base1`,
`w2_run1`, `w2_run2`, `vt_base1`, `vt_base2`, `vt_noiso1`, `vt_noiso2`, `perf_final`, `red.txt`, `red_final.txt`,
`two-project-layout.diff`, `times.txt`.

## Post-merge checks

- Full `pnpm test` in the main tree: `radixPrimitiveStub.test.tsx` should pass there.
- Full `pnpm e2e` once in the main tree (still one worker): 619 passed.
