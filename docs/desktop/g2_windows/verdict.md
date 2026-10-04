# G2 on Windows: automated verdict (release 0.1.1, the re-measure of 4 October 2026)

Evidence: `results.md` in this folder (sections A1 to A7), built from raw records under `D:/dev/w6/measure-runs`. Tree `656a964` (which merges `519a3cb`, the thread-cap fix) plus the uncommitted version bump to 0.1.1 (the tracked diff hashes to the stamp of every record; `results.md` section A1), fresh GNU builds of that tree, the GNU smoke build against the real lab for every app row. The measure artefact was built but not run against the real lab, because port 8765 was listening (the owner's terminal). Every counted run passed the 60 second CPU gate (2.9 to 4.9%, 0 rejected) with its GPU reading recorded (9 to 15%), the W0B anchor held (the harness digest is unchanged since the W5C reproduction), and the slot was quiet by the manager's lock, not an owner-named window. All app rows ran at the shipped desktop caps of 512 and 128 MiB. Targets are not recalibrated here; ceilings are as in 04 D5. This verdict replaces the 0.1.0 one (W5C, kept below as history) and the W5B one before it.

## Verdict

**AUTOMATED PASS, OWNER ROWS PENDING.** Every automated row of G2 that was measured on 0.1.1 is inside its ceiling, the release row included: whole-app idle memory at HOME reads 477.3 MB (453.0 to 484.4 MB over the six counted launches, `report.mjs` within-ceiling ACCEPTED) against the 500 MB ceiling, with 15.6 MB of headroom at the worst launch; it was 505.4 MB, over the ceiling, on 0.1.0. It is still above the 400 MB target (by 77.3 MB). The fix is the thread caps of release 0.1.1 (`threadcaps.py`: OpenBLAS, OpenMP, MKL and NumExpr pools capped at 2 in the backend server); measured with an attach driver it took the backend from 68 threads to 13, committed private bytes from 1,790 to 369 MB and its working set from 262.6 to 246.1 MB. At the official reading point the interpreter still holds 24 to 28 threads, because the prewarm workers are alive then (17 threads 33 s after spawn in the warm-up run), so the attach driver's 13 is not the figure of the row. The rows that were not re-run in 0.1.1 (the soak, the simulated minimise, T8, the stage 1 rows) stand on their 0.1.0 readings, which are history and were all inside their ceilings; the measure-artefact rows and the owner-attended rows are pending.

**M4 (provisional).** The Windows app is built, packaged, installable and correct through the app-launched backend. Provisional because: the soak ran 2 h on 0.1.0, not all day, and was not repeated on 0.1.1; the measure artefact was not run against the real lab; the quiet slot was the manager's lock, not an owner-named window; and the owner-attended rows are all still pending. It becomes final when the owner-attended rows are done and the owner accepts the idle row's distance from its 400 MB target.

### The row that was over its ceiling on 0.1.0, now inside

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Whole app idle at HOME, private working set | **477.3 MB** (453.0 to 484.4; rows series 484.4, 475.4, 482.6; first-launch series 453.0, 479.2, 470.8); 0.1.0 505.4 MB (492.4 to 508.4); W5B 1,082 MB | 400 MB (not met) | 500 MB | App harness `rows` and first-launch series, `report.mjs` over `D:/dev/w6/measure-runs` | Real lab, app-launched | 3 plus 3 launches |

Breakdown (informational, median of six): backend 275.6 MB (297.3 MB on 0.1.0), UI tree 195.4 MB (198.2 MB), shell 4.3 MB. The backend's interpreter ran 24 to 28 threads at the reading point (26, 25, 26, 24, 28, 27) plus the venv launcher's 3; its private bytes there were 398 to 642 MB, mostly 400 to 460 MB. The warm-up launch (488.0 MB) was not counted. The reading point is unchanged since W0B: HOME ready plus a 2.5 second idle check, before the prewarm's later tasks finish (`results.md` sections A4 and 9).

### Rows within their ceiling

Each row names where its reading came from. "App harness" is the harness `rows` mode (`D:/dev/w6/measure-runs/rows`) on the GNU smoke build, which launches the app and reads the page probe. "Stage 1" is `docs/desktop/stage1/measure_stage1.mjs`: headless Chromium against the standalone real backend on port 8797, with no shell. "Real lab, app-launched" means the smoke build started its own backend on the real lab, with a temporary state folder and `NQT_JOBS=off`. n is the number of accepted runs behind the figure. Rows marked "carried from 0.1.0" were not re-run in 0.1.1; their reading is the W5C one.

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Backend ready | 1,401.5 ms (1,378 to 1,412) | 1,500 ms (met) | 2,500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 6 launches |
| Splash | 316.7 ms (301.2 to 327.4) | 500 ms (met) | 1,000 ms | App harness, median, 0.1.1 | Real lab, app-launched | 6 launches |
| Cold HOME, usual launch (state filled) | 2,797 ms (2,777 to 2,829) | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs` (kept outside the repository), median after one priming launch, 0.1.1 | Real lab, app-launched | 3 launches |
| Warm HOME | 537.6 ms (534.0 to 558.8) | 1,000 ms (met) | 1,500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| `volmanaged_v0 EQ`, warm, desktop caps (Enter unit) | 653 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| `REG`, warm, desktop caps (Enter unit) | 452 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| Grid open, 8,411 fills | 65.9 ms (61.5 to 72.3) | 100 ms (met) | 500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| GIP pan and zoom p95, 20,000 bars (T5) | 6.2 ms (5.8 to 6.4) | 16.7 ms (met) | 25 ms | App harness, median, 0.1.1 (bars tiled from the real response) | Real lab, app-launched | 3 launches |
| 20,000-point data hop (T5), 17,097 points, warm | 15.2 ms (largest 34.4) | n/a | 100 ms | Hop series of `t4t5.mjs` over the debugging protocol, carried from 0.1.0 | Real lab, app-launched | 5 fetches, 1 series |
| Keystroke to paint, p95 | 8.3 ms (8.2 to 8.3) | 50 ms (met) | 100 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| Eight routes, worst repeat, desktop caps | 12 ms | 100 ms (met) | 300 ms | Stage 1, one run, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 1 run |
| Installer | 3.1 MB (3,253,511 bytes for the measuring build; the shipped installer is a rebuild after the commit) | 15 MB (met) | 30 MB | Build output and artefact check of `D:/dev/w6/release-m/0.1.1`; the harness `installer` mode was not run | Not applicable | 1 file |
| T8 drift run, attached smoke build, desktop project | 14 passed, 0 failed; WebView2 154.0.4258.53 (carried from 0.1.0) | n/a | clean run | Playwright desktop project against the smoke build, carried from 0.1.0 | Offline demo server, port 4373 | 1 run |

The app's own second-run readings for the two Enter units are 38.4 ms for EQ and 56.9 ms for REG on 0.1.1 (0.1.0: 41.3 ms and 57 ms; W5B: 39 ms and 58 ms). They differ from the stage 1 rows above because the harness repeats the line in one session. The first run of the line, in a fresh app, is not a row of the 0.1.1 record; on 0.1.0 it read a median of 597.3 ms for EQ and 345.7 ms for REG (W5B series B: 600 ms and 345 ms). The decision register judges the stage 1 Enter unit; neither app figure is a separate pass line.

The 20,000-point hop could not be taken at exactly 20,000 points (the route returns whole buckets); the largest answer at or under 20,000 points is 17,097 points.

### First launch re-measured, and the rows carried from 0.1.0

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Cold HOME with data, **first launch** (empty state folder) | 3,192.5 ms (3,164 to 3,210; rows series 3,210, 3,194, 3,201; first-launch mode 3,164, 3,183, 3,191, median 3,183); 0.1.0 3,172.5 ms; W5B 5,048 ms | 3,500 ms (met; the first-launch target of 4,500 ms met too) | 5,000 ms | App harness, median, 0.1.1; `report.mjs` over the folder | Real lab, app-launched | 3 plus 3 launches |
| Simulated minimise with LIVE, stream back after 30 minutes hidden | 0 ms; the controller hidden at engine level (`controller-file`); carried from 0.1.0 (not run on 0.1.1) | n/a | 30,000 ms | Harness `minimise-sim` mode, 0.1.0 | Fixture backend, app-launched | 1 run |
| Whole app, 2 h soak at the shipped caps (largest sample), PARTIAL | 705.8 MB (first sample 698.7 MB, median 674.8 MB, slope over the last hour +25.9 MB per hour); carried from 0.1.0 (not run on 0.1.1); W5B 1,577.4 MB (3 h) | 1,000 MB (met) | 1,500 MB | External whole-tree sampler on 0.1.0, `D:/dev/w5c/measure-runs/soak-outside.jsonl` | Real lab, app-launched | 25 samples, 1 run |

### Correctness set on this tree

The release suites of the 0.1.1 tree were green on their final runs: backend 4,155 passed; crosscheck strict PASS 2,495, FAIL 0, SKIP 0; QA tests 333 passed; vitest 7,394 passed (47 skipped); `test:types` and `test:e2e-types` clean; web build OK with every bundle budget met; `check.ps1` 29 of 29 steps; harness node tests 172 passed; Playwright e2e 539 passed, offline 190 passed (3 declared skips), desktop 42 passed, perf 3 passed (`results.md` section A6). One real failure came out of the version bump (the generated API contract hash was stale and `web/dist` with it) and was fixed at the cause; the other failures were load or invocation noise and passed on rerun without a code change. The real-data smoke and `crosscheck.served` are not in the 0.1.1 suite summary above, and the dated records of all four release checks need the manager's commit. Every gate log line of the measuring runs has caller `terminal` and a window inside the fence (521 new lines, timestamped inside the run).

### Provisional rows

None by the CPU gate: every counted run sat at a 60 second reading of 4.9% or lower (2.9 to 4.9%), with no rejected reading. Two labels apply all the same so that nothing reads as more than it is: (1) the quiet slot was the manager's lock, not an owner-named window; (2) the rows carried from 0.1.0 (the soak, which was 2 h and PARTIAL by the 8 hour rule, the simulated minimise, T8 and the stage 1 rows) were not re-measured on 0.1.1. The reproduction held, so no figure carries UNREPRODUCED.

### Pending, not run

| Item | Why | Where it is picked up |
| --- | --- | --- |
| Backend ready, splash, cold HOME and idle memory on the **measure artefact**, real lab, 3 runs each; the very first launch after install on the measure build; the smoke and measure agreement test | Port 8765 listening (pid 46084): decision 11. The 0.1.1 measure installer is built at `D:/dev/w6/release-m/0.1.1` and not installed | `docs/desktop/checks/2026-10-03_pending-measurements.md` |
| Soak, simulated minimise and T8 on 0.1.1 | Not run, as instructed; the 0.1.0 readings are history | A repeat before the dual run starts, if the owner wants the 0.1.0 figures confirmed on 0.1.1 |
| The idle row against its 400 MB target | The row is inside its ceiling and 77.3 MB above the target (`results.md` section A4) | The manager and the owner |
| All-day soak | The 2 h run is PARTIAL; the all-day run is an owner check on a day the PC can be left alone | `docs/desktop/checks/2026-10-03_all-day-soak.md` |
| Owner-attended: reboot first launch, visible run, real minimise and restore, keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest, SmartScreen first run, 200% zoom by eye, custom install folder | Owner-attended | `docs/desktop/checks/` (the templates are dated 3 October and name the 0.1.0 installer; use the 0.1.1 values of the hand-over, section 2) |
| Release check on a clean commit | The check needs a commit, and a commit changes the stamp | After the manager's commit: the dated records, a build in the default folder, then `release_check.ps1` |

## Safety checks held during every run

No window of the app under test appeared and the foreground never changed because of it; no TWS or gateway was configured or contacted (the backend ran under its allow-listed environment); no order surface exists; port 8765 and its backend, pid 39464 and every process not started by the run were never touched; `jobs.json`, `backtests/output`, the research files and `terminal/state` were unchanged (the gate log grew only by caller `terminal` lines inside the fence); every launch had a PATH without the MinGW and cargo folders; the browsers were headless; the QuantPad runners were not touched (the quiet lock was held 16:39:55 to 16:56:42).

## The earlier verdicts, kept as history

**0.1.0 (wave W5C, 4 October 2026, commit `8122c87`).** The automated part of G2 was not passed: one automated row was over its ceiling, whole-app idle memory at HOME at 505.4 MB (492.4 to 508.4 MB over six counted launches) against 500 MB, with first-launch cold HOME at 3,167 ms (rows series; 3,172.5 ms pooled), the 2 h soak at 705.8 MB largest sample, the simulated minimise at 0 ms and T8 at 14 of 14, all inside their ceilings. Trigger T4 fired on equal terms with the browser terminal (412.5 MB). M4 was provisional. The figures and the conditions are in `results.md` sections 1 to 14.

**W5B (3 to 4 October 2026, commit `09a660d`).** Three automated rows were over their ceilings: idle at HOME 1,082 MB, first-launch cold HOME 5,048 ms and the soak's first sample 1,577.4 MB (3 h). Section 13 of `results.md` sets W5B beside W5C.
