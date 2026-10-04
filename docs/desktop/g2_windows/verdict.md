# G2 on Windows: automated verdict (wave W5C, the re-measure of 4 October 2026)

Evidence: `results.md` in this folder, built from raw records under `D:/dev/w5c/measure-runs`. Tree `dd286fd` plus the W5C changes, which are the tree of commit `8122c87` (the tracked diff hashes to the stamp of every record; `results.md` section 1 and finding 8), fresh GNU builds of that tree, the GNU measure artefact standing in for the MSVC one (installed fresh, not run against the real lab because port 8765 was listening). Measurements come from more than one source and backend, named row by row in the tables below (the GNU smoke build against the real lab for the app rows, the stage 1 script against a standalone real backend, the fixture backend for the minimise, an offline demo server for T8), all at the shipped desktop caps of 512 and 128 MiB. Every counted run passed the 60 second CPU gate (2.6 to 4.7%, 0 rejected) with its GPU reading recorded (8 to 15%), the W0B anchor reproduced first, and the slot was quiet by the manager's lock, not an owner-named window. Targets are not recalibrated here; ceilings are as in 04 D5. This verdict replaces the W5B one (commit `09a660d`).

## Verdict

**The automated part of G2 is not passed: one automated row is over its ceiling. Whole-app idle memory at HOME reads 505.4 MB (492.4 to 508.4 MB over the six counted launches, `report.mjs`) against the 500 MB ceiling and the 400 MB target.** The rows series alone reads 497.1 MB, but four of the six counted launches are above 500 MB, and the report marks the row over its ceiling. The two other rows that failed in W5B are now inside their ceilings: first-launch cold HOME reads 3,167 ms (W5B 5,048 ms) and the soak's largest sample reads 705.8 MB over 2 h (W5B 1,577.4 MB over 3 h). Every other row that could be measured automatically is inside its ceiling, the drift run (T8) is clean, and the simulated minimise is now tested at engine level (stream back in 0 ms against 30,000 ms). Trigger T4 still fires on equal terms with the browser terminal (section 9 of `results.md`). The measure-artefact rows stay pending (port 8765 was listening) and the owner-attended rows are all still pending.

**M4 (provisional).** The Windows app is built, packaged, installable and correct through the app-launched backend. Provisional because: the idle row is 5.4 MB (1.1%) over its ceiling on the pooled reading; the soak ran 2 h, not all day, and its harness record was never written (the harness was stopped at 2 h 5 min), so the soak row rests on the external sampler; the measure artefact was not run against the real lab; the quiet slot was the manager's lock, not an owner-named window. It becomes final when the idle row is fixed or accepted by the owner and the owner-attended rows are done

### Rows over their ceiling (failures to act on)

| Row | Ceiling | Reading | Note |
| --- | ---: | ---: | --- |
| Whole app idle at HOME | 500 MB (target 400 MB) | **505.4 MB** (492.4 to 508.4; six counted launches) | Before (W5B): 1,082 MB. The rows series alone is 497.1 MB; the three first-launch launches are 504.4 to 508.4 MB. Over by 5.4 MB (1.1%). Read by the browser method's 8 second settle it is 453.8 MB, and 388.6 MB after five minutes (`results.md` section 9). Source: app harness `rows` and first-launch series, real lab, app-launched backend, `report.mjs` over `D:/dev/w5c/measure-runs` (n = 6). What changed since W5B and why is in `results.md` section 1a. T4 on equal terms still fires (the browser terminal reads 412.5 MB). Lowering the bar cache to 256 MiB read 494.1 MB, inside the spread, so the caps were not lowered. |

### Rows within their ceiling

Each row names where its reading came from. "App harness" is the harness `rows` mode (`D:/dev/w5c/measure-runs/rows`) on the GNU smoke build, which launches the app and reads the page probe. "Stage 1" is `docs/desktop/stage1/measure_stage1.mjs`: headless Chromium against the standalone real backend on port 8797, with no shell. "Real lab, app-launched" means the smoke build started its own backend on the real lab, with a temporary state folder and `NQT_JOBS=off`. n is the number of accepted runs behind the figure.

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Backend ready | 1,402 ms (1,426 ms in the first-launch series) | 1,500 ms (met) | 2,500 ms | App harness, median | Real lab, app-launched | 3 launches |
| Splash | 313 ms | 500 ms (met) | 1,000 ms | App harness, median | Real lab, app-launched | 3 launches |
| Cold HOME, usual launch (state filled) | 2,750 ms | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs` (kept outside the repository, in `D:/dev/w5c/tools`), median after one priming launch | Real lab, app-launched | 3 launches |
| Warm HOME | 537.2 ms | 1,000 ms (met) | 1,500 ms | App harness, median | Real lab, app-launched | 3 launches |
| `volmanaged_v0 EQ`, warm, desktop caps (Enter unit) | 653 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median (the Enter unit that the decision register judges) | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| `REG`, warm, desktop caps (Enter unit) | 452 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| Grid open, 8,411 fills | 63.3 ms | 100 ms (met) | 500 ms | App harness, median | Real lab, app-launched | 3 launches |
| GIP pan and zoom p95, 20,000 bars (T5) | 6.0 ms | 16.7 ms (met) | 25 ms | App harness, median (bars tiled from the real response) | Real lab, app-launched | 3 launches |
| 20,000-point data hop (T5), 17,097 points, warm | 15.2 ms (largest 34.4) | n/a | 100 ms | Hop series of `t4t5.mjs` over the debugging protocol, median of warm fetches | Real lab, app-launched | 5 fetches, 1 series |
| Keystroke to paint, p95 | 8.3 ms | 50 ms (met) | 100 ms | App harness, median | Real lab, app-launched | 3 launches |
| Eight routes, worst repeat, desktop caps | 12 ms | 100 ms (met) | 300 ms | Stage 1, one run | Standalone real backend, port 8797, headless Chromium, no app | 1 run |
| Installer | 3.1 MB (3,253,071 bytes) | 15 MB (met) | 30 MB | Harness `installer` mode on the release installer of `D:/dev/w5c/release-m/0.1.0` | Not applicable | 1 file |
| T8 drift run, attached smoke build, desktop project | 14 passed, 0 failed; WebView2 154.0.4258.53 | n/a | clean run | Playwright desktop project against the smoke build | Offline demo server, port 4373 | 1 run |

The app's own readings for the two Enter units come from the same app harness series and differ from the stage 1 rows above because the harness repeats the line in one session. The first run of the line, in a fresh app, read a median of 597.3 ms for EQ and 345.7 ms for REG (W5B series B: 600 ms and 345 ms). The second run of the same line, a page-cache hit, read 41.3 ms for EQ and 57 ms for REG (W5B: 39 ms and 58 ms). The decision register judges the stage 1 Enter unit; neither app figure is a separate pass line.

The 20,000-point hop could not be taken at exactly 20,000 points (the route returns whole buckets); the largest answer at or under 20,000 points is 17,097 points.

### Re-measured since W5B and now inside their ceiling

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Cold HOME with data, **first launch** (empty state folder) | 3,167 ms (rows series; 3,188 ms in the first-launch series; 3,172.5 ms (3,148 to 3,225) over the six launches); W5B 5,048 ms | 3,500 ms (met; the first-launch target of 4,500 ms met too) | 5,000 ms | App harness, median; also stage 1 (no shell): 2,700 ms | Real lab, app-launched | 3 plus 3 launches |
| Simulated minimise with LIVE, stream back after 30 minutes hidden | 0 ms; the controller hidden at engine level (`controller-file`, page `hidden` in 30 of 30 samples); W5B round 3 (`D:/dev/d5/runs/w5b3-minimise-sim`) also 0 ms at engine level; W5B first pass not tested | n/a | 30,000 ms | Harness `minimise-sim` mode | Fixture backend, app-launched | 1 run |
| Whole app, 2 h soak at the shipped caps (largest sample), PARTIAL | 705.8 MB (first sample 698.7 MB, median 674.8 MB, slope over the last hour +25.9 MB per hour); W5B 1,577.4 MB (3 h) | 1,000 MB (met) | 1,500 MB | External whole-tree sampler, `D:/dev/w5c/measure-runs/soak-outside.jsonl` (the harness stopped at 2 h 5 min; its own record was not written) | Real lab, app-launched | 25 samples, 1 run |

### Correctness set on this tree

Served JSON through the app-launched fixture backend of the new smoke build: 8 of 8 routes equal (6 byte-equal, 2 equal before the gate block with only `cached` and `reads_this_process` differing). Real-data smoke in app mode: passed (5 tests). Real-data smoke in browser mode: passed on the second run (18 tests); its first run failed 2 tests on an Enter refused before the command index reached the page, a race in the test driver `web/e2e/perf/pages.ts` (finding in `results.md` section 12). Every gate log line of these runs has caller `terminal` and a window inside the fence. Browser budgets (`e2e:perf`, alone, one worker): 3 passed, unchanged (HOME 611 ms, GIP p95 18.0 and 18.7 ms, grid 66.2 ms). The release check of this tree (run before the measuring, not repeated) read backend 4,148 passed, crosscheck strict 2,495 pass and 0 fail, vitest 7,394 passed, Playwright e2e 538 of 539 on its last full run (one environmental socket error, 36 of 36 on repeat), offline 190, desktop 42, `check.ps1` 29 of 29. `release_check.ps1` and the dated records need the manager's commit.

### Provisional rows

None by the CPU gate: every counted run sat at a 60 second reading of 4.7% or lower (2.6 to 4.7% across the series), with no rejected reading. Two labels apply all the same and are listed so that nothing reads as more than it is: (1) the quiet slot was the manager's lock, not an owner-named window, so the stage 1 record stays `provisional: true`; (2) the soak ran 2 h, not all day, so it is PARTIAL by the 8 hour rule, and its row rests on the external sampler because the harness (started for 3 h) was stopped by the manager at 2 h 5 min and wrote no record. The reproduction held, so no figure carries UNREPRODUCED.

### Pending, not run

| Item | Why | Where it is picked up |
| --- | --- | --- |
| Backend ready, splash, cold HOME and idle memory on the **measure artefact**, real lab, 3 runs each; the very first launch after install on the measure build; the smoke and measure agreement test | Port 8765 listening (pid 46084): decision 11. The exit criteria allow the measure real-lab rows to stand pending by the precheck | `docs/desktop/checks/2026-10-03_pending-measurements.md` (installed fresh at `D:/dev/w5c/measure/app`) |
| A decision on the idle row: the reading point and the governing comparator | The row sits on its ceiling (`results.md` sections 3 and 9) | The manager and the owner |
| All-day soak | The 2 h run is PARTIAL; the all-day run is an owner check on a day the PC can be left alone | `docs/desktop/checks/2026-10-03_all-day-soak.md` |
| Reboot first launch, visible run, real minimise and restore, keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest, SmartScreen first run, 200% zoom by eye, custom install folder | Owner-attended | `docs/desktop/checks/` |
| Release check on a clean commit | The check needs a commit, and a commit changes the stamp | After the manager's commit: the dated records, a build in the default folder, then `release_check.ps1` |

## Safety checks held during every run

No window of the app under test appeared and the foreground never changed because of it; no TWS or gateway was configured or contacted (the backend ran under its allow-listed environment); no order surface exists; port 8765 and its backend were never touched; `jobs.json`, `backtests/output`, the research files and `terminal/state` were unchanged (the gate log grew only by caller `terminal` lines inside the fence); every launch had a PATH without the MinGW and cargo folders; the browsers were headless.
