# Stage 1 numbers (M3, wave W3B)

The stage 1 release figures: backend ready, the cold HOME launch and its ceiling, the eight cached routes at the browser caps and at the desktop caps, and EQ and REG on real data. The T3 verdict (02 section 9) is at the end. `README.md` in this folder says what each series is; `measure_stage1.mjs` takes them.

**Read this first.** These figures come from one complete run of the release check, taken on 3 October 2026 (it started at 04:37 UTC) on the owner's PC, with the other builds on the machine idle but in no owner-named quiet window (manager decision 2). Every run sat behind a 60 second reading of the whole machine's CPU with a limit of 10%, and every reading passed (2.4% to 8.0%), so every series is labelled ACCEPTED. The script still marks the T3 verdict `provisional: true`, because no quiet window was named and the cold-HOME reading is unratified (see T3). The figures are therefore listed in the last section for the quiet re-measure of W5B. The machine was not silent: the CPU during the runs averaged 5% to 14%, and the figure is printed next to every series. No budget or threshold was loosened. This run replaces two earlier runs of the same wave, taken beside the shell build's compiles; their records stay on D: and are not quoted here.

## Method

- Machine: AMD Ryzen 9 9950X3D2, 32 logical processors, 31.6 GB memory, Windows 11; Node 24.13.1; the nq-lab virtual environment's Python 3.12 by full path.
- Backend: the real one on port 8797 (never 8765), real files, the page build `web\dist` current (the backend reported `dist: current` for every run), a state folder of its own under `D:\dev\tmp`, `NQT_JOBS=off`, a hidden window, stopped by identity afterwards (no survivors, no answer left on the port). The backend's environment is the allow list the shell passes (`nq_terminal.desktop.envlist.backend_env`), not the parent's.
- Browser: headless Chromium at 1920 by 1080, a fresh context per open, the session bought the way the shell buys it (token, then origin, then cookie). The workspace store is on in the production page; the screen series answer the store routes 404 (as an older backend would) so that the panel one open adds is not saved for the next to find.
- Gate: 60 seconds of whole-machine CPU before each run, limit 10%, at most 2 rejected readings per run. No reading was rejected in this run. CPU during the run is sampled as well.
- Watches: a window and foreground watch over all processes ran around every group (0 new windows, 0 changes of the foreground window). The four research files were hashed before and after (`ledger.csv`, `registry.csv`, `oos_openings.json` byte-equal) and the gate log grew only by lines of caller `terminal` inside the fence (622 new lines in the run, 0 bad; the smoke run before it added 66, also all caller `terminal`); no new entry under `terminal\state`.
- Record: `D:\dev\spikes\w3b\stage1\2026-10-03T04-37-38-080Z\` holds `stage1_results.json`, `stage1_table.md`, one record per run, the group watch files and the backends' logs.
- Provenance: HEAD `976a64c62fffdafe34b2546baf144879d1ce4bcd`; sha256 of `git diff HEAD` `5bfe42253de43750018127e30ad8935c7844cf4712acca20e9d00b86b35da25e`; sha256 of the 24 untracked files `baa5590598ebe63338d4a1214ca10c677ee1435063e5900a5d3e090cd782b03d`.

## Backend ready (target 1.5 s, T3 ceiling 2.5 s)

Process start to the first 200 from the proof route, polled every 10 ms. The route stands in for `/api/health`, which needs a session now; the app is fully built before it listens, so both answer at the same moment.

| Form | Runs (ms) | Median (ms) | Gate CPU per run (%) | CPU during the run (%) | Label |
|---|---|---:|---|---|---|
| Browser (`python -m nq_terminal`) | 1,168; 1,168; 1,182 | 1,168 | 3.0; 2.7; 2.4 | 8.9; 5.4; 5.4 | ACCEPTED |
| Desktop (`NQT_DESKTOP=1`, `TOKEN` and `NONCE` on stdin, `NQT-READY` line verified) | 1,183; 1,279; 1,169 | 1,183 | 2.6; 2.9; 2.6 | 5.0; 6.4; 5.3 | ACCEPTED |

D1 measured 1,061 ms on a quiet machine; these figures are 10 to 12% above it and about 22% under the 1,500 ms target.

## Cold HOME (target 4.5 s; ceiling fixed here)

The clock starts before the backend is spawned (desktop form, port 8797) and stops when the four HOME panels show their data, nothing is loading and two frames have been painted. Headless Chromium and its context exist before the clock, as the shell's window does.

| Launch | Runs (ms) | Median (ms) | Gate CPU per run (%) | CPU during the run (%) | Label |
|---|---|---:|---|---|---|
| Usual launch, a state folder an earlier launch filled (`home-disk`) | 3,757; 3,709; 3,813 | 3,757 | 6.3; 5.5; 6.5 | 10.2; 9.4; 13.6 | ACCEPTED |
| First launch, an empty state folder (`home-fresh`) | 6,439; 6,435; 6,603 | 6,439 | 2.6; 5.4; 4.5 | 6.9; 7.9; 13.2 | ACCEPTED |

**The cold-HOME ceiling (02 section 4.1, item 3): median of 3 cold launches plus 20%, never above 6 s: 3,757 ms x 1.2 = 4,508 ms.** The G2 ceiling is 5,000 ms and 4,508 ms stays as the stage 1 regression reference (register 1.1 in `owner_decisions_windows.md`); the median of 3,757 ms meets the target of 4.5 s with 0.7 s to spare. The cold launches the ceiling rests on are the usual launch, the one the persisted result cache serves (02 section 4.1, item 1); a first launch has no cache yet and is reported beside it, not gated, as are launches after the lab's result files change. On the first launch the slowest answers were the hypothesis panel (4.0 to 4.1 s after the start of the page), the ledger (3.8 to 4.0 s), the universe (3.2 to 3.4 s) and the hypothesis list (3.2 to 3.3 s); on the usual launch they are the hypothesis panel (1.9 to 2.0 s), the universe (1.5 s), the run index (1.4 s) and the 22-day universe (1.4 s), and the ledger is no longer among them. The backend itself was ready after 1.1 to 1.3 s in every launch. A first launch at 6.4 s is above the 4.5 s target and above the 6 s cap; it is the open question in the last section and decides T3 (below).

The page's own cost of the workspace store (seven reads at start, parallel after the first) is inside these figures; the backend's state folder after a usual launch held `workspaces\linkGroups.json` and `workspaces\watch.json`, the two documents a plain HOME load writes through the store.

## The eight cached routes, repeat calls (target 100 ms, ceiling 300 ms)

Per route a cold call and three repeats, three passes over all eight in turn (every entry has to stay cached together), then a restart on the same state folder. Browser caps are 2 GiB of bars; desktop caps (`NQT_DESKTOP=1`) are 512 MiB of bars and 128 MiB of files. In desktop form the HOME prewarm starts with the process, so its cold figures are taken with it in flight; the repeat figures are what the caps are judged on.

| Route | Browser caps: cold, repeats (ms) | Desktop caps: cold, repeats (ms) |
|---|---|---|
| `/api/runs/compare` | 606; 2, 1, 1 | 658; 88, 6, 3 |
| `/api/ledger` | 2,210; 6, 5, 5 | 2,335; 10, 25, 12 |
| `/api/market/two-day` | 603; 2, 2, 2 | 1,002; 3, 3, 2 |
| `/api/analytics/hypothesis/volmanaged_v0/bootstrap` | 951; 1, 1, 1 | 902; 2, 1, 1 |
| `/api/analytics/run/{id}/bootstrap` | 912; 1, 1, 1 | 881; 2, 1, 1 |
| `/api/analytics/deflated` | 1,173; 2, 2, 2 | 2 (prewarm or disk); 1, 2, 2 |
| `/api/seasonality/instrument/NQ` | 1,273; 2, 1, 1 | 1,177; 2, 1, 1 |
| `/api/analytics/spa` | 2,151; 2, 2, 1 | 2,173; 2, 1, 1 |
| **Worst repeat of 48** | **6 ms** | **88 ms** |
| Gate CPU, CPU during the run (%) | 7.7, 12.0 (ACCEPTED) | 8.0, 12.1 (ACCEPTED) |

Both configurations are within the 100 ms target on every repeat. The desktop worst repeat of 88 ms is the first repeat of `/api/runs/compare` (the next two took 6 and 3 ms), taken while the HOME prewarm was still running in that process; the other 47 repeats took 25 ms or less. After a restart on the same state folder the routes that read no prices came from disk (ledger 13 and 12 ms) and every body was byte-equal to the first process's. Two routes that read prices (two-day, seasonality) are not byte-equal between a cold call and a repeat, nor across the two cap settings, and the cause was checked by diff on a backend of its own: the only differences are `gate.cached` (`false` on the computing call, `true` on a cached one, by design) and, across configurations, `gate.reads_this_process`. Repeats within a configuration are byte-equal to each other, and after a restart the body equals the first process's.

## EQ and REG on real data, warm (target 1 s, ceiling 1.5 s)

A fresh context per open, 5 warm opens after one cold open, backend warm. Two units. The W1B unit (Enter on the line, the screen HOME already holds, so part of its load is HOME's own) is the one judged: it is the unit D1 judged (EQ 412 ms, REG 223 ms, `d1_numbers.md`), and it asks the backend, which the criterion names ("backend time"). The new panel (Shift+Enter, one more panel of the screen) is reported, not judged: it opens seconds after the same screen loaded in the same page and asks for the same query keys, the page's query cache holds them (stale time 30 s), so it sends no request and its 75 to 95 ms is render time only; it would pass whatever the backend did.

| Screen, caps | New panel, warm runs (ms) | Median (ms) | Enter unit, warm runs (ms) | Median (ms) | Cold open (Enter, new panel) |
|---|---|---:|---|---:|---|
| `volmanaged_v0 EQ`, browser | 77, 75, 77, 78, 78 | 77 | 463, 444, 469, 619, 645 | 469 | 5,025; 77 |
| `REG`, browser | 89, 90, 91, 89, 93 | 90 | 391, 246, 414, 418, 596 | 414 | 960; 83 |
| `volmanaged_v0 EQ`, desktop | 76, 76, 95, 78, 77 | 77 | 1,277, 1,113, 1,168, 1,141, 1,195 | 1,168 | 5,148; 77 |
| `REG`, desktop | 95, 92, 90, 92, 91 | 92 | 765, 461, 469, 894, 864 | 765 | 892; 76 |

Gate CPU and CPU during the run: browser 7.6% and 12.9%, desktop 7.9% and 12.7%; both ACCEPTED, no page errors. The judged unit is the Enter unit. The ceiling of 1.5 s is met by every run (the largest is 1,277 ms). The 1 s target is met everywhere except `volmanaged_v0 EQ` on the desktop caps, where all five warm runs and the median (1,168 ms) are above it. The same screen on the browser caps takes 469 ms, so the gap of about 700 ms follows the desktop caps and not the machine's load; an earlier run beside the shell build's compiles gave 1,069 ms for the same series. The cause is not established (the desktop bars cap of 512 MiB evicting the bars EQ's bootstrap reads is the first suspect). Against D1, the browser Enter unit is 469 ms against 412 for EQ (+14%) and 414 ms against 223 for REG (+86%). The cold first open of EQ (5.0 to 5.1 s) is the first call of that route on a new backend and is HOME's own cold cost.

## Stage 1 exit (02 section 5), against the roadmap's list

| Criterion | Result |
|---|---|
| Backend ready on a quiet machine at most 2.5 s (target 1.5 s) | 1,168 ms browser, 1,183 ms desktop (not in a named quiet window, so provisional; see the last section) |
| Real-data EQ and REG warm at most 1,500 ms (target 1,000 ms) | Ceiling met on every run (largest 1,277 ms). Target met except desktop EQ: median 1,168 ms (see above) |
| Slow routes on repeat at most 300 ms (target 100 ms), both cap settings | 6 ms browser caps, 88 ms desktop caps (worst repeat of 48 each) |
| Cold-HOME ceiling fixed | 4,508 ms (usual launch; first launch 6,439 ms, not gated) |
| Browser budgets unchanged: HOME at most 1,500 ms, grid at most 500 ms, shell at most 114.9 kB gzip, library chunks within budget | `e2e:perf` (3 passed): HOME median 616 ms with the store started as in production (loads 924, 616 and 607 ms), fills grid opens in 68 ms, sorts in 32 ms, pages in 35 ms, GIP pan and zoom at 60 fps; shell 109,894 B gzip of 114,900 B, under the diet-4 target of 109,900 B, which was not raised; perspective 86.1 of 100 kB, echarts 201.6 of 230, lightweight-charts 61.4 of 75, uplot 22.1 of 30, tanstack-grid 18.7 of 45 |
| Real-data smoke passes: every screen opens on real files, every new gate line `caller="terminal"`, research files unchanged | `smoke_real.ps1` passed (18 tests, 66 new gate lines, all caller `terminal` inside the fence, files unchanged) |
| 3 write routes exactly; 0 shell IPC uses in `web/src` | the backend app test and the IPC scan are green |
| Every automated check green; screenshot baselines unchanged | backend 3,877 passed and 1 skipped; crosscheck strict PASS 2,495, FAIL 0; QA tests 299; vitest 7,321 passed and 47 skipped (492 files); type checks clean; Playwright 398; offline 190 passed and 3 skipped; no baseline rewritten |

## T3 (02 section 9, end of D3): does not fire on the usual-launch reading

T3 fires if backend ready is above 2.5 s, or the cold HOME is above its ceiling (at most 6 s), on the quiet-machine median.

- Backend ready: 1,168 ms (browser) and 1,183 ms (desktop) against 2,500 ms. Not above.
- Cold HOME, usual launch: median 3,757 ms against the cap of 6,000 ms and the target of 4,500 ms. Not above.

The verdict is `fires: false` on the usual-launch reading, and it is **provisional** (`provisional: true`): the script marks a verdict provisional while the reading is unratified and while no owner-named quiet window was used (every series was ACCEPTED, so no series adds a reason).

**The reading is a provisional default (manager decision 3).** 02 section 4.1 item 3 says "median of 3 cold launches" and the plan says T3 fires if "the cold-HOME median is above the 6 s ceiling"; neither names which launch. The script gates the usual launch (a state folder an earlier launch filled: 3,757 ms) and reports the first launch on an empty state folder beside it, not gated: 6,439, 6,435 and 6,603 ms, median 6,439 ms, which is above the 6 s cap. **Under the first-launch reading T3 fires** and the chain would stop. The owner must ratify one reading; until then T3 is recorded as does not fire, provisional. The first-launch figure stays on the W5B owner list below.

## For the quiet re-measure of W5B

- Take every series again in an owner-named quiet window (no series was rejected here, but the run was not in a named window, and the machine's own CPU during the runs was 5% to 14%).
- The desktop `volmanaged_v0 EQ` Enter unit (median 1,168 ms, above the 1 s target, under the 1.5 s ceiling) is reproducible, so profile it as well as re-measuring it: the browser caps give 469 ms for the same screen.
- The cold-HOME series (`home-disk` and `home-fresh`): the ceiling of 4,508 ms is the stage 1 regression reference; G2 passes or fails against 5,000 ms (`docs/desktop/owner_decisions_windows.md`, register 1.1).
- Open question for the owner: a first launch on an empty state folder (the first start after an install) takes 6.4 s. The ceiling rule reads as the usual launch; if a first launch must also meet 6 s, the ledger (3.8 to 4.0 s on a first call) is the cost to attack, for example by building its cache during the installer's first run.
- The helper libraries (CPU gate, window watch, identity-checked stop) are machine-local in `D:\dev\spikes\t2\lib` and are not tracked.
