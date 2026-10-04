# G2 on Windows: automated verdict (wave W5B, taken 3 to 4 October 2026)

Evidence: `results.md` in this folder, built from raw records under `D:\dev\d5\`. Tree `f2e03bf` plus the merge step's edits (`results.md` section 12), GNU host builds, the GNU measure artefact standing in for the MSVC one (installed and checked, not run against the real lab). Measurements come from more than one source and backend, named row by row in the tables below (the GNU smoke build against the real lab for the app rows, the stage 1 script against a standalone real backend, an offline demo server for T8), all at desktop caps. Targets are not recalibrated here; ceilings are as in 04 D5.

## Verdict

**The automated part of G2 is not yet passed.** Three budget rows are over their ceilings (first-launch cold HOME by 48 ms, whole-app idle memory, and the soak's start-up peak), trigger T4 fires, and the measure-artefact rows are pending. Everything else that could be measured automatically is within its ceiling, and the drift run (T8) is clean. The correctness set is green (below). The owner-attended rows are all still pending.

**M4 (provisional).** The Windows app is built, packaged, installable and correct through the app-launched backend, with the budgets above not yet met. Provisional because: no owner-named quiet window was used; every harness figure carries the UNREPRODUCED label; the measure artefact was not run; the soak is partial. It becomes final when the three rows are fixed or accepted by the owner and the owner-attended rows are done.

### Rows over their ceiling (failures to act on)

| Row | Ceiling | Reading | Note |
| --- | ---: | ---: | --- |
| Cold HOME with data, **first launch** (empty state) | 5,000 ms | **5,048 ms** (quiet series, 5,030 to 5,060); 5,583 ms in the first series | Over by 48 ms (0.96%) in the quiet series. Inside the first-launch cap of 6,000 ms (T3 does not fire). The 5,000 ms G2 ceiling governs (register 1.1). |
| Whole app, 3 hour soak at the shipped caps (largest sample) | 1,500 MB | **1,577.4 MB** (second sampler 1,509.8 MB) | The first sample, during the start-up peak. After minute 15 the largest is 1,292 MB, after minute 45 it is 749 MB. PARTIAL: 3 hours, not all day. |
| Whole app idle at HOME | 500 MB | **1,082 MB** (1,067 to 1,099); 1,102 MB in the first series | About 920 MB after five minutes, when the working set is trimmed; still above the ceiling. T4 fires (above 550 MB, and above the browser terminal's 918 MB in the same session). The backend is the cost (912 MB against 742 MB in browser form); the UI tree is not (about 200 MB). The roadmap's response, lowering the caps and re-checking route times, is the owner's decision. |

Source of the three rows above: the first-launch cold HOME and the idle memory are app harness figures (series A and B, median of 3 launches each, real lab, app-launched backend); the soak figure is the harness soak mode's sample series (37 samples at 5 minute intervals, one run) with an outside sampler beside it.

### Rows within their ceiling

Each row names where its reading came from. "App harness" is the harness `rows` mode (series B, `D:\dev\d5\runs-repeat\w5b-smoke2`) on the GNU smoke build, which launches the app and reads the page probe. "Stage 1" is `docs/desktop/stage1/measure_stage1.mjs`: headless Chromium against the standalone real backend on port 8797, with no shell. "Real lab, app-launched" means the smoke build started its own backend on the real lab, with a temporary state folder and `NQT_JOBS=off`. n is the number of accepted runs behind the figure.

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Backend ready | 1,378 ms (1,610 ms in the first series) | 1,500 ms (met in the quiet series only) | 2,500 ms | App harness, median | Real lab, app-launched | 3 launches |
| Splash | 308 ms | 500 ms (met) | 1,000 ms | App harness, median | Real lab, app-launched | 3 launches |
| Cold HOME, usual launch (state filled) | 3,321 ms | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs` (kept outside the repository, in `D:\dev\d5\tools`), median after one priming launch | Real lab, app-launched | 3 launches |
| Warm HOME | 652 ms | 1,000 ms (met) | 1,500 ms | App harness, median | Real lab, app-launched | 3 launches |
| `volmanaged_v0 EQ`, warm, desktop caps (Enter unit) | 628 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median (the Enter unit that the decision register judges) | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| `REG`, warm, desktop caps (Enter unit) | 427 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| Grid open, 8,411 fills | 132 ms | 100 ms (not met) | 500 ms | App harness, median | Real lab, app-launched | 3 launches |
| GIP pan and zoom p95, 20,000 bars (T5) | 6.4 ms | 16.7 ms (met) | 25 ms | App harness, median (bars tiled from the real response) | Real lab, app-launched | 3 launches |
| 20,000-point data hop (T5), 17,097 points, warm | 14.9 ms (largest 20.8) | n/a | 100 ms | Hop series over the debugging protocol, median of warm fetches | Real lab, app-launched | 5 fetches, 1 series |
| Keystroke to paint, p95 | 8.2 ms | 50 ms (met) | 100 ms | App harness, median | Real lab, app-launched | 3 launches |
| Eight routes, worst repeat, desktop caps | 73 ms | 100 ms (met) | 300 ms | Stage 1, one run | Standalone real backend, port 8797, headless Chromium, no app | 1 run |
| Installer | 3.1 MB (3,253,192 bytes) | 15 MB (met) | 30 MB | File size of the release installer of `D:\dev\release-b\0.1.0`, the one the harness read; the other builds of this tree are 3,253,179 to 3,253,317 bytes, so every one reads 3.1 MB | Not applicable | 1 file |
| T8 drift run, attached smoke build, desktop project | 14 passed, 0 failed (second run); WebView2 154.0.4258.53 | n/a | clean run | Playwright desktop project against the smoke build | Offline demo server, port 4373 | 1 run (second) |

The app's own readings for the two Enter units, from the same app harness series and the same real lab, are in the table of `results.md` section 3 and differ from the stage 1 rows above because the harness repeats the line in one session. The first run of the line, in a fresh app, read a median of 600 ms for EQ and 345 ms for REG (series A: 711 ms and 346 ms). The second run of the same line, a page-cache hit, read 39 ms for EQ and 58 ms for REG (series A: 33 and 57 ms). The decision register judges the stage 1 Enter unit; the app's first-run figures agree with it within the spread of the two methods, and neither app figure is a separate pass line.

The 20,000-point hop could not be taken at exactly 20,000 points (the route returns whole buckets); the largest answer tried was 17,097 points.

### Correctness set on the merged tree

Final pass on the tree after the review fixes (4 October, second pass): backend 4,075 passed, 1 skipped; QA tests 333; crosscheck strict 2,495 pass, 0 fail; served JSON through the app-launched backend 8 of 8 routes equal; vitest 7,383 passed, 47 skipped; harness tests 143 passed; types and e2e types clean; Playwright e2e 539 (the full run read 538 passed and one failed: the 200% reflow test for EQ-run timed out waiting for the page to mount under load, and the whole reflow file, 133 tests, then passed alone), offline 190 (3 skipped), desktop 42, perf 3 (alone, CPU 3.1%); real-data smoke in browser mode and in app mode passed. The merge step's `check.ps1` (30 steps PASS) and install test (52 steps, 0 failed) were not repeated: no Rust, script or web source changed after them. The research files, `jobs.json`, `backtests/output` and `terminal/state` are as the safety section says. `release_check.ps1` cannot pass on an uncommitted tree: it fails the clean-tree check and the artefact provenance check, and passes the rest; see `results.md` section 13.

### Provisional rows

None by the CPU gate: every counted run sat at a 60 second reading of 9.8% or lower (3.4 to 9.8% across the series). Three labels apply all the same and are listed so that nothing reads as quiet-window evidence: (1) no owner-named quiet window was used, so the stage 1 record stays `provisional: true`; (2) the W0B reproduction did not hold for HOME ready (+13.8%, cause traced to the added launch-page hop), so every counted harness figure carries UNREPRODUCED; (3) the soak is partial (3 hours). Its own record is labelled `window-fail`, because other programs opened windows while the owner used the PC (none in the app's own tree); that is an old-rule label, kept as found. The reproduction run kept 9 rejected gate readings and one PROVISIONAL slot, not counted.

### Pending, not run

| Item | Why | Where it is picked up |
| --- | --- | --- |
| Backend ready, splash, cold HOME and idle memory on the **measure artefact**, real lab, 3 runs each; the smoke and measure agreement test | Port 8765 listening (pid 46084): decision 11 | `docs/desktop/checks/2026-10-03_pending-measurements.md` (installed and checked, `D:\dev\d5\measure\app`) |
| Re-measure of the three rows over their ceiling after a change, in an owner-named quiet window | The change is the owner's decision (lower caps, or accept the figure) | W6 or the next measuring night |
| All-day soak | The 3 hour run finished at 00:15 local and is PARTIAL; the all-day run is an owner check | `docs/desktop/checks/2026-10-03_all-day-soak.md` |
| Simulated minimise with LIVE (30 minute hold): **NOT TESTED**, not within ceiling | No engine-level driver exists. The shell has no hook that hides the WebView2 controller (the smoke build only ever calls `SetIsVisible(true)`), and a minimised-size message had no effect. The run used a page-level override, which only changes what `document.visibilityState` reports; the web app has no visibility-driven stream logic, so the stream reading "live, server events" throughout and "stream back 0 ms" are true by construction and prove nothing about a hidden or minimised view. | Add a smoke-only visibility hook to the shell (born-failing check first: the page must report hidden within 3 s), then repeat the 30 minute hold. The owner's real minimise in the visible run stays the other route. |
| Reboot first launch, visible run, real minimise and restore, keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest, SmartScreen first run, 200% zoom by eye, custom install folder | Owner-attended | `docs/desktop/checks/` |
| Release check on a clean commit | The check needs a commit, and a commit changes the stamp | W6 records and builds again on the commit, then runs `release_check.ps1` on the default folder |

## Safety checks held during every run

No window of the app under test appeared and the foreground never changed because of it; no TWS or gateway was configured or contacted (the backend ran under its allow-listed environment); no order surface exists; port 8765 and its backend were never touched; `jobs.json`, `backtests/output`, the research files and `terminal/state` were unchanged (the gate log grew only by caller `terminal` lines inside the fence, 2,099 lines during the measuring and 281 during the merge); every launch had a PATH without the MinGW and cargo folders.
