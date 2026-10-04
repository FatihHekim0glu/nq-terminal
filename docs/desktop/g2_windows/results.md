# G2 on Windows: measured results (wave W5B, step 2 of D5)

Taken on the night of 3 to 4 October 2026 on the owner's PC (host `DESKTOP-FM5O3JM`). This file is the evidence behind the verdict in `verdict.md`. Every figure below was read back from a raw record under `D:\dev\d5\` (the folders are named in each section); nothing here was typed from memory.

## 1. Read this first

- **Tree and builds.** Commit `f2e03bf2a159d4e792634e7a4c288cc007a6b86e`, working tree clean for every record (`git diff HEAD` sha256 `e3b0c442...b855`, which is the hash of the empty input, and no untracked file). The builds are the ones recorded in `D:\dev\release-b\0.1.0` (the GNU host build, unsigned, labelled "GNU local build" by owner decision 4): smoke exe sha256 `7c661f7a387073995ebc978abc43a87b81141e2b9a472e6218681cbf63294416`, measure exe sha256 `16e022df550e94c114e3e71c879f206f2c17bf118f0239bc6ae090a2017d5bba`, release installer `nq-lab terminal_0.1.0_x64-setup.exe` (3,253,192 bytes, sha256 `9fb1c339971adc280dc7d4e085c92ea82c88d598ef9470b01bb58ab104f71ee0`). Nothing was rebuilt or re-recorded during the measuring. The merge step on 4 October (section 12) fixed three defects in the drift-run and report tooling, rebuilt the release folder as `D:\dev\release-c\0.1.0` from the resulting tree and re-recorded the dated records; the measured figures in sections 2 to 9 were taken on the `release-b` builds before that and are unchanged by it (the Rust sources and `web/dist` are byte-identical: the dist hash did not change).
- **GNU stands in for MSVC.** The plan's MSVC measure artefact does not exist on this PC. Every "measure" figure in this file would be the GNU measure artefact; none was taken (section 6). The MSVC agreement stays open.
- **Quiet machine, as far as it could be.** The owner's GPU training job and the overnight soak app were resident throughout, by design. Every harness run sat behind the 60 second CPU gate (limit 10%, enforced); the gate reading is printed beside each series. All runs of the two smoke series, the usual-launch series, the memory series, the hop series and the stage 1 series were taken with a gate reading at or under 10%, so none is labelled PROVISIONAL by the gate. One kind of label does apply to all of them: **no owner-named quiet window was used** (plan decision 3), so the stage 1 record keeps its own `provisional: true`, and the harness could not reproduce the W0B figure for HOME ready (section 2), so every counted figure carries the harness label UNREPRODUCED. The reproduction run itself had 9 rejected gate readings (kept).
- **GPU load: unknown per series.** Only a bracket exists: 97% at the start of the work (11,392 MiB, the training job), 11% at the end (2,145 MiB). No series, slot or run of this wave has a GPU reading, so the GPU state of series A and of series B is **unknown** and the table in section 3 says so. The two series differ most on rows that can depend on the GPU and the compositor (GIP pan and zoom, cold HOME, splash), and nothing here separates GPU contention from CPU load as the cause. The harness now samples the GPU (utilisation and memory used, from the driver's tool) after the gate reading and again after each run and writes both into every slot record, rejected ones included (`gpu.atGate`, `gpu.afterRun`; a reading that cannot be taken is recorded as unavailable). Any re-measure taken from now on carries its GPU beside its CPU gate; these two series stay unknown.
- **Windows.** No window of the apps under test appeared and the foreground never changed because of them in any run (smoke slots, usual-launch series, memory series, hop series, T8, minimise). Other programs' windows were noted, never counted as ours: a Task Manager tooltip and foreground changes between the terminal and the Logitech software while the owner used the PC (slot 3 of the first smoke series), a Steam notification toast during the stage 1 home group, and a Logitech Options+ helper window during the repeat of that group. The stage 1 script judges any new window anywhere, so its `watchClean` reads false for those two groups; the cause is those foreign windows and no process of this run opened one (its browsers are headless).
- **Backends.** Smoke rows: the real lab through the smoke build (`--lab`, a temporary `--state-dir`, `NQT_JOBS=off`), desktop caps (512 MiB bars, 128 MiB files). Stage 1 and the browser baseline: the real backend on port 8797 with its own temporary state folder. The measure build did not run against the real lab (section 6). Port 8765 and its backend (pid 46084) were never touched and was still listening, with the same pid, at the last check.
- **Research gate.** Between the two prechecks (about 22:10 and 00:12 local time) the gate log grew by 2,099 lines, all caller `terminal`, none after the fence. The four research files (`ledger.csv`, `registry.csv`, `oos_openings.json`; `oos_access_log.jsonl` only grew) were not written. `jobs.json` sha256 unchanged (`44CAE38A...72D4`), no queued or running job, `backtests/output` unchanged (229 entries, same list), no new entry under `terminal/state`.
- **Disk.** C: free 97,766 MB at the start of the measuring, 96,262 MB after (a drop of 1,504 MB). Every output of this wave is on D: (free 167,570 MB before, 161,901 MB after); the C: movement came from other programs and is recorded, as manager decision 4 says. The reproduction run alone saw a 254 MB drop on C:.

## 2. Reproduction of the W0B figures (first, as 04 D5.1 asks)

Folder `D:\dev\d5\runs\w5b2-reproduce`. The spike shell against the fixture backend on 8800, three figures, each judged within 10% of the W0B median or inside its min to max range.

| Figure | W0B median (range) | This run, median of 2 counted | Within |
| --- | ---: | ---: | --- |
| Private memory at HOME | 164.9 MB (159.7 to 168.4) | 164.1 MB | yes |
| Private memory after the heavy set | 369.5 MB (363.1 to 375.2) | 363.4 MB | yes |
| Launch to HOME ready | 834.5 ms (814 to 892) | 949.5 ms (938 and 961) | **no, +13.8%** |

Counted runs: 2 (slot 2 on its 4th attempt at gate 9.8%, slot 4 on its 3rd attempt at gate 9.2%). Slot 3 ran only after 5 rejected readings and is kept as PROVISIONAL and not counted. Rejected readings kept: 9 (10.2 to 12.7%).

The breakdown puts the difference before the page starts, not in the shell: spawn to the HOME document +63 ms (277 against 214 ms) and first frame +38 ms (178 against 140 ms), while HOME ready since navigation is inside the range (672.75 against 618.6 ms). The W0B run had no session token, so it had no launch page and no redeem hop; the spike now opens a one-time launch page first (the harness README says so). The harness therefore did not mark the reproduction as done, and the rows were taken with `--allow-unreproduced`, which labels every counted figure UNREPRODUCED. The standalone backend ready of the real backend (informational) read 1,212 ms against 1,566 ms at W0B.

## 3. The budget rows on the GNU smoke build

Two series, real data, desktop caps, the harness's `rows` mode, one warm-up launch then three accepted launches each, one fresh state folder per launch (so the cold HOME is a first launch). The harness's own report is `node desktop\harness\report.mjs <folder>`; the second column of the table is read from the raw records by `report.mjs`, and `--check` found no figure that differed from its raw record.

- Series A: `D:\dev\d5\runs\w5b-smoke`, started 21:27 UTC, gate readings 8.2, 8.0, 9.1%.
- Series B (repeat, quieter machine): `D:\dev\d5\runs-repeat\w5b-smoke2`, started 23:07 UTC, gate readings 3.8, 3.5, 4.3%.

| Row | Target | Ceiling | A: median (min to max) | B: median (min to max) | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| Backend ready | 1,500 ms | 2,500 ms | 1,610 (1,579 to 2,124) | 1,378 (1,373 to 1,383) | within ceiling; target met in B only |
| Splash (first contentful paint) | 500 ms | 1,000 ms | 339 (309 to 359) | 308 (300 to 313) | within target |
| Cold HOME, first launch, with data | 3,500 ms | 5,000 ms | **5,583 (5,434 to 5,826)** | **5,048 (5,030 to 5,060)** | **over the ceiling in both series** |
| Warm HOME | 1,000 ms | 1,500 ms | 714 (704 to 742) | 652 (652 to 675) | within target |
| `volmanaged_v0 EQ`, warm (second run of the line) | 1,000 ms | 1,500 ms | 33 (31 to 40) | 39 (39 to 44) | within target |
| `REG`, warm | 1,000 ms | 1,500 ms | 57 (53 to 111) | 58 (57 to 61) | within target |
| Grid open, 8,411 fills | 100 ms | 500 ms | 131 (130 to 146) | 132 (66 to 137) | within ceiling; target met in 1 launch of 6 |
| GIP pan and zoom p95, 20,000 bars | 16.7 ms | 25 ms | 10.3 (7.5 to 11.4) | 6.4 (6.3 to 6.5) | within target |
| Keystroke to paint, p95 | 50 ms | 100 ms | 8.2 (8.1 to 8.2) | 8.2 (8.1 to 8.3) | within target |
| Whole app idle at HOME (private working set) | 400 MB | 500 MB | **1,102 (1,086 to 1,206)** | **1,082 (1,067 to 1,099)** | **over the ceiling in both series** |
| Installer (`nq-lab terminal_0.1.0_x64-setup.exe`) | 15 MB | 30 MB | 3.1 MB (3,253,192 bytes) | | within target |

Method (from `desktop/harness/README.md`): cold HOME is the page probe's HOME ready mark from the spawn instant; backend ready is spawn to `supervise_checked` in the shell log; splash is first contentful paint over the debugging protocol; memory is the whole-tree private working set from the performance counters, the median of three samples two seconds apart, after HOME and an 8 second settle. The GIP row reads a 20,000-bar series that the harness tiles from the real response (the record says `barsSynthetic: true`, base 1,364 bars); the 8,411 fills are the real run `nt_dtsmom_v0_lo0` (the row is the Fills tab click to the painted grid). Provenance on every figure: head `f2e03bf2...`, empty diff and untracked hashes, `web/dist/index.html` sha256 `518b248f...`. The shell log reads the same builds as `dev.nqlab.terminal.smoke`; every teardown closed gracefully with 0 survivors; 14 new files appeared under each run's own temporary state folder and none under `terminal/state`.

Two readings that need a plain statement:

- **Cold HOME on a first launch is over the 5,000 ms ceiling** (5,048 ms in the quiet series, +0.96%, and 5,583 ms in the first). The T3 cap for a first launch (6,000 ms, target 4,500 ms) is not exceeded, and register 1.1 of `owner_decisions_windows.md` says the 5,000 ms G2 ceiling governs. As the harness enforces it, this row fails. The stage 1 reading below (headless Chromium, no shell) is 4,260 to 4,639 ms for the same first launch, so about 0.8 to 1.0 s of the app's figure is the shell's own start (backend spawn and handshake, splash, window, page load).
- **Whole-app idle memory is more than twice the ceiling.** See T4 (section 8).

### The usual launch (state folder already filled), in the app

Folder `D:\dev\d5\t4t5\2026-10-03T23-02-08-950Z-usual-app`. One priming launch (cold HOME 5,073 ms, not counted), then three launches on the same state, config and WebView2 folders. Cold HOME 3,321, 3,337 and 3,321 ms, **median 3,321 ms** (gate 3.4, 3.4, 4.0%): within the 3,500 ms target, 1,679 ms under the ceiling and under the stage 1 regression reference of 4,508 ms. Method: the probe's HOME ready mark from spawn, the same as the table. (The first attempt at this series, folder `...22-57-09-728Z-usual-app`, failed three times with "no page target" because a stale `DevToolsActivePort` file in the reused profile named the previous run's port; the second series removes that file before each launch. The first attempt is kept. The shell-log milestones in these records read as negative numbers because the reused config folder keeps one log across launches; only the probe's figure is used.)

## 4. Stage 1 figures re-taken alone: first launch, usual launch, the eight routes at both caps, EQ and REG

Tool: `docs/desktop/stage1/measure_stage1.mjs` (headless Chromium over the real backend on 8797, temporary state, `NQT_JOBS=off`), `--max-rejects 4`. Folders: `D:\dev\d5\stage1-w5b\2026-10-03T21-56-48-525Z` (all groups) and `D:\dev\d5\stage1-w5b-home2\2026-10-03T22-15-58-100Z` (the home group again, because the first run's home group saw a foreign window). Every run was accepted by the gate; the record's `provisional: true` is for the missing owner-named window only.

| Series | Target | Ceiling | Runs, first record (gate %) | Median | Repeat of the home group (gate %) | Median |
| --- | ---: | ---: | --- | ---: | --- | ---: |
| Backend ready, browser form | 1,500 ms | 2,500 ms | 1,344; 1,251; 1,345 | 1,344 | | |
| Backend ready, desktop form | 1,500 ms | 2,500 ms | 1,394; 1,272; 1,236 (7.3, 6.9, 8.1) | 1,272 | | |
| Cold HOME, first launch (the T3 reading) | 4,500 ms | 5,000 ms (G2); cap 6,000 ms | 4,554; 4,653; 4,639 (6.6, 7.3, 6.5) | 4,639 | 4,213; 4,350; 4,260 (3.9, 4.3, 3.9) | 4,260 |
| Cold HOME, usual launch | 3,500 ms | 5,000 ms | 3,439; 3,247; 3,413 | 3,413 | 3,235; 3,115; 3,296 (5.6, 6.2, 8.0) | 3,235 |
| Eight routes, worst repeat, browser caps | 100 ms | 300 ms | 6 | 6 | | |
| Eight routes, worst repeat, desktop caps | 100 ms | 300 ms | 73 | 73 | | |
| `volmanaged_v0 EQ` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 628; 634; 636; 613; 652 | 634 | | |
| `volmanaged_v0 EQ` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 779; 623; 630; 502; 628 | **628** | | |
| `REG` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 287; 281; 418; 269; 429 | 287 | | |
| `REG` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 416; 415; 427; 427; 428 | **427** | | |

T3 does not fire on either record (`fires: false`): first launch 4,639 ms (4,260 ms in the repeat) against the 6,000 ms cap, usual launch 3,413 ms (3,235 ms) against the 3,757 ms of W3B and the 4,508 ms regression reference. The first launch met its 4,500 ms target in the repeat (4,260 ms) and missed it in the first record (4,639 ms): the two records differ by 379 ms, so the target is not reliably met. The script compared the eight cold bodies across the two caps: six are byte-equal and two (two-day, seasonality) differ, which stage 1 already recorded as by design (they differ only in the gate bookkeeping fields `cached` and `reads_this_process`); that cause was not re-diffed in this run. After a restart on the same state folder the bodies equal the first process's for every route the script lists. The research files were byte-equal after the run and the gate log grew by 622 and 322 lines, all caller `terminal`, all inside the fence; no new entry under `terminal/state`.

The EQ unit that G2 judges at desktop caps is the Enter unit: 628 ms, under the 1,000 ms target without raising either cap (register 4.1 of `owner_decisions_windows.md`). The 33 and 39 ms in section 3 are the harness's second run of the same line (a page-cache hit) and are not the figure of record for that decision.

## 5. T5: pan and zoom, and the 20,000-point data hop

- **Pan and zoom p95** at 20,000 bars: 10.3 ms (series A) and 6.4 ms (series B) against 25 ms. Zoom and pan separately in series B: 6.3 to 6.5 ms and 4.5 to 5.0 ms. T5 does not fire on this row.
- **Data hop**, in the smoke build over the debugging protocol, real data, desktop caps: the page fetches `/api/bars` (symbol `NQ.V.0`, 1-minute, vendor variant, from 2018-01-02, `max_points=20000`) and parses the JSON; the clock runs from the request to the parsed object. The route sizes its answer in whole buckets, so it did not return exactly 20,000 points for any window tried; seven windows ending between 2018-03-01 and 2019-01-01 gave 7,617 to 17,097 points. Folder `D:\dev\d5\t4t5\2026-10-03T21-55-13-668Z-hop` (gate 8.6%): the largest, **17,097 points (875,675 bytes), warm median 14.9 ms (14.9, 17.7, 20.8, 14.9, 14.9), first fetch of that window 15.9 ms** (the first fetch of any window in the session was 36.1 ms). The earlier series `...21-53-41-694Z-hop` (11,376 points) read a warm median of 10.9 ms (maximum 17.4) and a first fetch of 37.3 ms. Against the 100 ms limit this is a margin of about five times. Extrapolating linearly from 17,097 to 20,000 points gives about 17 to 24 ms; that is an estimate and is labelled so. The hop is a loopback transfer and parse, not a render. T5 does not fire.

## 6. The measure artefact: installed and seeded, real-lab rows pending

- **Install (step 1).** The measure installer of `D:\dev\release-b\0.1.0` (3,219,653 bytes, sha256 `b42ce24b...2f43`) was installed silently with `/S /NS /D=` into `D:\dev\d5\measure\app` (the folder created first with inheritance removed, as `install-test.ps1` does), after the earlier install there (built from an older tree) was removed with its own silent uninstaller. Installed files: `nq-lab-terminal.exe`, `WebView2Loader.dll`, `uninstall.exe`. The installed exe is byte-identical to the measure payload (sha256 `16e022df...5bba`). The global window watch saw 0 new windows and 0 foreground changes. Record: `D:\dev\d5\w5b\install-measure-b.json`.
- **Seed (step 2).** The harness seeds the measure build's own settings and WebView2 folders per launch under the run folder (`NQT_MEASURE_DIR`, a settings file with the real lab, a `wv` folder), all on D:; no folder under the roaming profile is written. No separate `D:\dev\d5\wv-measure` folder was needed.
- **Prechecks (step 3), `D:\dev\d5\w5b\precheck-before2.json` and `precheck-after.json`.** Before the first run: port 8765 listening (pid 46084, the owner's backend), `backend.lock` absent, no queued or running job, `jobs.json` sha256 `44CAE38A...72D4`, `backtests/output` 229 entries. **8765 listens, so the measure-artefact real-lab rows were skipped and are pending (plan decision 11)**, and the process rows were taken on the smoke build with the real lab, a temporary state folder and `NQT_JOBS=off`. After every run the same checks read: 8765 still pid 46084, lock absent, jobs hash unchanged, `backtests/output` unchanged. No spawn-or-attach check applies to a measure run that did not happen.
- **Informational only, not counted.** The harness's dry mode ran the installed measure build three times on a derived lab with no data (`D:\dev\d5\runs\w5b-measure-dry`, gate 8.2, 8.1, 8.8%, status `dry`): backend ready 2,927; 2,344; 2,523 ms, splash 395; 278; 258 ms (load event), home painted 3,375; 2,869; 2,898 ms, idle memory 240.5 to 241.2 MB. These are not comparable with the real-lab rows (no data, no prewarm, a derived lab whose source copy has no compiled caches, so imports are slower), and they do not enter any median or any agreement test. They show only that the installed measure build starts, paints and closes cleanly with the engine settings read back off.

## 7. Minimise, T8 and the soak

### Simulated minimise with LIVE (NOT TESTED at engine level)

Folder `D:\dev\d5\runs\w5b-minimise-sim`, gate 5.4%, the fixture backend (no real data, no IB), 1,800 second hold (30 minutes, the low end of 04's 30 to 60). The page reported `hidden` for the whole hold (30 of 30 minute samples), the stream read "live, server events" in every sample, and **stream back 0 ms** after the restore against a 30,000 ms ceiling. Memory at the sampling points fell from 809.6 MB (first minute) to 646 to 648 MB for the rest of the hold. Driver: of the three tried, `controller-file` and `wm-size` did not hide the page; `page-override` did. **This row is NOT TESTED and does not count as within ceiling.** `page-override` only changes what `document.visibilityState` reports; the web app has no visibility-driven stream logic (its one `visibilitychange` listener flushes the store), so the unbroken "live, server events" reading and the 0 ms stream-back follow by construction. The engine's throttling of a hidden or minimised WebView2, the real risk, was never exercised (`engineLevel: false`). The harness now fails such a run with a NOT TESTED problem. It stays pending until a smoke-only visibility hook exists in the shell and the 30 minute hold is repeated. The real minimise and restore is not run (owner decision 10 keeps it with the owner's visible run).

### T8, the drift run, once

Folder `D:\dev\d5\runs\w5b-t8c`, gate 6.3%. The smoke build attached to the offline demo server on 4373, then the desktop Playwright project against it. **WebView2 runtime 154.0.4258.53** (engine string `Edg/154.0.4258.53`, registry `pv` 154.0.4258.53). Result: **12 passed, 2 failed**. Both failures are in `10-walk.desktop.ts` and have one cause: the walk asserts "no failed API answers" and the offline demo server answers 404 for six workspace-store routes (`/api/workspaces/workspaces`, `layouts`, `linkGroups`, `watch`, `history`, `prefs`) that D3 added and the demo API does not serve. That is a gap in the T8 stand-in, not a change in the engine. The harness's `t8` mode also refused to start from its documented command (`node run.mjs --mode t8 --playwright`) because its "another Playwright run is alive" check matches the harness's own `--playwright` flag; the run was started from a one-line script (`D:\dev\d5\tools\run-t8.mjs`) that calls the same mode with the same arguments.

**Second run, after the merge fixes (4 October, folder `D:\dev\d5\runs\2026-10-03T23-55-25-354Z-t8`, gate accepted, started from the documented command).** The walk's answer check now ignores an answer that carries the offline demo's own refusal header (the demo declining a route it holds no body for; the fixture and real backends never set it), and the mode's self-match is fixed (section 12). Result: **14 passed, 0 failed**, WebView2 runtime 154.0.4258.53 again, 0 new windows. T8 reads clean on this runtime. It is a drift check against one runtime, so it says nothing about a later runtime update.

### The 3 hour soak (finished, PARTIAL)

The soak ran from 20:15 to 23:15 UTC (3 hours, the harness's soak mode, real lab, the smoke build at the shipped caps of 512 and 128 MiB; sampled every 5 minutes; labelled **PARTIAL, 3 hours, not an all-day run**). It had finished by the time this file was written, so its figures are final; W6 reads them and does not repeat them. Records: `D:\dev\d5\soak\soak-smoke-s01-a1-measure.json` (the harness's own samples, 37) and `D:\dev\d5\soak\samples.jsonl` (an outside sampler of the same shell, 36 samples, same method, a few seconds apart). The soak ran the smoke exe of `D:\dev\release\0.1.0`, which is byte-identical to the smoke exe measured here (sha256 `7c661f7a...4294`); its provenance stamp carries the head the harness was started on (`e0834c15...`), with an empty diff and no untracked file.

| Reading (whole-tree private working set) | Harness samples | Outside sampler |
| --- | ---: | ---: |
| First sample (start-up, 0 minutes) | **1,577.4 MB** | 1,509.8 MB |
| Minutes 5 and 10 | 1,463.3; 1,446.8 | 1,457.9; 1,432.7 |
| Minutes 15 to 30 | 1,269.7 to 1,292.2 | 1,201.4 to 1,260.4 |
| Minutes 35 and 40 (the working set is trimmed) | 978.3; 805.2 | 885.9; 706.0 |
| Minute 45 to the end | 679.0 to 748.8 (last 704.5) | 582.3 to 648.1 (last 648.1 at 176 minutes) |
| Private bytes (committed) | up to 3,814.9 MB | 3,285 to 3,622 MB |
| JavaScript heap | 29.2 to 56.8 MB | |

The row is the **largest sample, 1,577.4 MB, which is 77.4 MB (5.2%) over the 1,500 MB ceiling** (1,509.8 MB, 9.8 MB over, by the outside sampler). Both are the first sample, taken during the start-up peak; the largest sample after minute 15 is 1,292.2 MB (under the ceiling, over the 1,000 MB target), and after minute 45 it is 748.8 MB. As the harness defines the row, it is over the ceiling; whether a start-up transient belongs in a steady-state soak row is for the merge and the owner to decide, and the 3 hour run does not settle the all-day question. Memory did not grow without bound: the page's JavaScript heap stayed between 29 and 57 MB, and the working set after minute 45 drifted up by about 60 to 70 MB over 2 hours (the committed memory is flat to slightly up). No workload error, the shell closed gracefully at the end (exit 0, no survivor).

The harness classed this record `window-fail`: its watch saw 54 new windows and 57 foreground changes over the three hours, all from other programs (Chrome, Task Manager, Performance Monitor, Explorer, the Logitech helper, a Steam toast and a credential prompt broker; the owner was using the PC), **0 of them in the soak app's own process tree**. The harness rule since 3 October 2026 judges only the run's own tree, under which these are notes; the soak started on the earlier code and kept the older verdict.

## 8. T4: memory, and the browser terminal in the same session

Method for the app: the table in section 3 and the time series below. Method for the browser terminal: the real backend in its browser form (browser caps, 2 GiB of bars), headless Chromium on HOME with the same four panels settled, an 8 second settle, three samples two seconds apart, the whole-tree private working set of the backend tree plus the browser tree, three runs behind the gate (7.4 to 7.9%). Folder `D:\dev\d5\t4t5\2026-10-03T21-37-50-055Z-browser-home`. An earlier series in `...21-33-21-953Z-browser-home` lost the browser's root process (its command-line match was wrong) and holds the backend alone (737 to 758 MB); it is kept and not used.

| Tree at HOME, idle | Backend | UI (WebView2 or Chromium) | Whole tree |
| --- | ---: | ---: | ---: |
| Browser terminal, median of 3 | 741.8 MB (719 to 750) | 177.5 MB (176 to 184) | **917.6 MB** (897 to 934) |
| App, smoke build, series A median of 3 | | | 1,101.7 MB |
| App, smoke build, series B median of 3 | | | 1,081.9 MB |

The same app launch followed for 10 minutes (`D:\dev\d5\t4t5\2026-10-03T21-42-20-309Z-app-mem`, gate 8.5%, real data): whole tree 1,114.0 MB at 9 s, 1,097.7 at 31 s, 1,085.8 at 61 s, 1,081.9 at 121 s, then **920.5 MB at 301 s and 919.4 MB at 601 s**. The backend interpreter was 911.8 MB at the start and 766.6 MB from 301 s; the WebView2 processes together about 200 MB, falling to about 150 MB; private bytes (committed memory) stayed near 2.6 GB for the backend and did not fall. The step at about 5 minutes is the working set being trimmed, not memory returned. The all-day soak shows the same shape (section 7).

Reading against 02 section 6.5, trigger T4 ("idle above 550 MB or above the browser terminal's HOME in the same session, or a heavy session above 1.5 GB"): **T4 fires on both counts at the harness's reading point.** The app at HOME idles at about 1.08 to 1.10 GB (about 920 MB once trimmed, still above 550 MB), against 918 MB for the browser terminal in the same session. The difference sits in the backend: 912 MB at desktop caps with the HOME prewarm and the persisted result cache, against 742 MB in browser form. The UI tree is not the cost (WebView2 about 200 MB against 178 MB for Chromium; the 350 MB UI-tree test of 02 is passed with room). The roadmap's response is to lower the caps and re-check route times; that is a decision for the merge and the owner, not made here. The heavy-session leg (above 1.5 GB) was not measured in the app; the soak (section 7) is its nearest reading.

## 9. Agreement of the two builds, and the pending list

| Test | State |
| --- | --- |
| Smoke against measure within noise: backend ready, cold HOME, idle memory | **Pending** (no real-lab measure run) |
| Backend ready, splash, cold HOME, idle memory on the measure artefact (3 runs each, real lab) | **Pending**: port 8765 listening; command in `docs/desktop/checks/2026-10-03_pending-measurements.md` |
| All-day soak at the shipped caps | The 3 hour run is PARTIAL and its largest sample (1,577.4 MB, start-up) is over the ceiling (section 7); the all-day run stays an owner check |
| Real minimise and restore, stream back within 30 s | Owner-attended (visible run) |
| First launch after a reboot | Owner-attended |
| Keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest | Owner-attended |
| T8 drift run | Passed 14 of 14 on the second run (WebView2 154.0.4258.53); the first run's 2 failures were the answer check meeting the demo's refusals (section 7) |
| Records for the release check | Re-recorded on 4 October on the tree of the merge (section 12). `release_check.ps1` passes every check except the clean-tree check, which needs a commit; the commit changes HEAD, so W6 records and builds again on the committed tree and runs the check on the default release folder |

`node desktop\harness\report.mjs D:\dev\d5\runs --check` finds no figure that differs from its raw record. It exits 1 and names exactly the rows above that were not measured (the four measure-build rows, the soak row, which the report cannot read because the soak record sits outside that folder, the real minimise check, and the simulated minimise, which the report now reads as not tested because only a page-level driver hid the view), and nothing else. The folder also holds earlier dry and self-test records from the build night, which the report ignores; its reproduction line reads the first reproduction record it finds (an earlier dry one), so the real verdict is the one in section 2.

## 10. Findings for the merge (nothing here was changed in `terminal/`)

1. **Cold HOME on a first launch is 48 ms over its ceiling in the quiet series** (and 583 ms over in the first). Decide whether the 5,000 ms ceiling or the 6,000 ms first-launch cap is the G2 row for a first launch; the register says 5,000 ms.
2. **T4 fires.** The backend at desktop caps with the prewarm holds 912 MB (742 MB in browser form); the UI tree is fine. 02 section 6.5 says lower the caps and re-check route times. The cheapest first look is the prewarm's peak and the result cache's resident size, since the figure falls by about 150 MB after five minutes of idle without any request.
3. **Soak row by the largest-sample rule** reads over the ceiling because of the first sample. If the rule should start after the settle period, change it in the soak mode and report; otherwise the row fails.
4. **Fixed in the merge (section 12).** **`modes/t8.mjs`, `otherTestRuns`:** the check "another Playwright or vitest run is alive" matches the harness's own command line (`node run.mjs --mode t8 --playwright`), so the documented command always refuses itself. It should skip its own process and its parents.
5. **Resolved in the merge (section 12), in the walk rather than the demo.** **The offline demo API** (`web/e2e/offline`) does not serve the six `/api/workspaces/*` store routes, so the attach-mode walk in `web/e2e/desktop/10-walk.desktop.ts` fails on 404s. Add the routes to the demo API (or make the walk tolerate them in attach mode), then repeat T8.
6. **Fixed in the merge (section 12).** **`report.mjs`** reads the first `reproduce` record in a folder, which can be an older dry one; it should read the newest non-dry verdict (`reproduce-verdict.json` at the folder root of the real run is the right one).
7. **`measure_stage1.mjs`** fails its window watch on any new window anywhere (a Steam toast, a Logitech helper window), unlike the D5 harness since 3 October; give it the own-tree rule.
8. **The reproduction gate** cannot pass while the spike's reference omits the launch-page hop. Either re-baseline `reference/w0b-tauri.json` with the hop (its breakdown shows where the 115 ms sit) or accept that every figure carries UNREPRODUCED.
9. **No usual-launch row in the harness.** The harness's rows always use a fresh state folder; the usual launch of the app was taken by `D:\dev\d5\tools\t4t5.mjs usual-app` (a primed state, three launches). It belongs in the harness as a row if G2 keeps both launch readings.
10. **Resolved in the merge (section 12).** **Same-day records.** The records in `terminal/state/release` are dated 2026-10-03; the release check refuses a record from another day, and the date is now 4 October.
11. **Measure artefact rows.** When 8765 is free (the owner closes the launcher), run `node desktop\harness\run.mjs --build measure --rows backend_ready,splash_painted,cold_home,idle_mem_home --runs 3 --real-data --measure-exe D:\dev\d5\measure\app\nq-lab-terminal.exe` from `terminal`, after the manual lab preconditions listed in `docs/desktop/checks/2026-10-03_pending-measurements.md` (the harness does not check them), then the smoke and measure agreement test in `report.mjs`.

## 11. What changed in the world during the run

During the measuring nothing in `terminal/` was edited (the tree stayed clean at `f2e03bf` until this folder was written); the merge step's edits are listed in section 12. The tools written for this wave are not part of the repository: `D:\dev\d5\tools\reinstall-measure-b.mjs` (the install), `t4t5.mjs` (browser baseline, app memory over time, usual launch, data hop), `run-t8.mjs`, `facts.mjs` and `facts2.mjs` (they print the figures above from the raw files).

## 12. The merge step (4 October 2026)

Done after the measuring, on the tree of `f2e03bf` plus the edits below. Logs are under `D:\dev\d5\w5b-merge\`.

### Edits (each test first)

1. **Walk answer check** (`web/e2e/desktop/app.ts`, `failedAnswers`). It now leaves out an answer that carries the offline demo's refusal header. This is the cause of the two T8 failures of section 7: the demo declined the workspace store routes on purpose, because the page keeps its own copy. The fixture and real backends never set the header, so their runs are as strict as before. Born failing: two new cases in `web/scripts/playwrightOffline.test.ts` (the refusal is dropped; a 404 without the header, a header with another value and a 500 stay). The demo API itself was not changed.
2. **T8 self-match** (`desktop/harness/modes/t8.mjs`). The "another run is alive" check counted the harness's own `--playwright` flag. It now leaves out the harness process and its parents (`testRunPids`). Born failing: a case in `desktop/harness/tests/t8.test.mjs`. The documented command (`node run.mjs --mode t8 --playwright`) now starts.
3. **Reproduction line of the report** (`desktop/harness/report.mjs`, `newestReproduction`). The report took the first reproduction verdict in a folder, which could be an earlier dry one. It now takes the newest real verdict and falls back to a dry one only when no other exists. Born failing: a case in `desktop/harness/tests/report.test.mjs`.

Two defects listed for this step were already gone: the offline demo test (`e2e:offline` passes) and the missing temporary state folder in `smoke_real.ps1` (it sets `NQT_STATE_DIR` and `NQT_JOBS=off` itself).

### Checks, run once on this tree

| Check | Result |
| --- | --- |
| Backend suite, through `record_green.ps1 -Check backend` | 4,065 passed, 1 skipped, 86 s; record `2026-10-04_backend.json` |
| QA tests (`terminal/qa/tests`) | 333 passed |
| Crosscheck strict, then `crosscheck.served`, through `record_green.ps1 -Check crosscheck` | strict: 2,495 pass, 0 fail, 0 skip (104 info); served through the app-launched backend: 8 of 8 routes equal (6 byte-equal, 2 equal before the gate block with only `cached` and `reads_this_process` differing); record `2026-10-04_crosscheck.json` |
| `test:types`, `test:e2e-types`, `gen-api --check` | all exit 0 |
| vitest | 496 files, 7,383 passed, 47 skipped |
| Playwright `e2e` | 539 passed (14.9 min) |
| Playwright `e2e:offline` | 190 passed, 3 skipped |
| Playwright `e2e:desktop` (smoke build of `release-b`, clean PATH) | 42 passed, window watch clean |
| Playwright `e2e:perf`, alone | 3 passed (HOME first render median 614 ms against 1,500; fills grid opens in 67 ms against 500; GIP pan and zoom p95 17.8 ms and 18.1 ms at 60 frames a second) |
| T8 (section 7) | 14 passed |
| Harness node tests | 119 passed (118 before the three new cases of this step) |
| `desktop\scripts\check.ps1` | exit 0, 30 steps PASS (fmt, clippy for three feature sets, cargo tests for three, deny, deny plant 64 of 64, audit, advisories, dist scan, scripts tests 163, harness tests 119, release-check tests, install-test self-test, order scan, look css, module scope, release-profile smoke build, PE and loader checks); the born-failing no-show proof was not run (it needs screen 2) |
| `smoke_real.ps1`, browser mode, through `record_green.ps1 -Check smoke` | passed; research files unchanged; record `2026-10-04_smoke.json` |
| `smoke_real.ps1 -Mode App`, through `record_green.ps1 -Check smoke-app` | passed; record `2026-10-04_smoke-app.json` |
| `web/dist` | rebuilt; same hash as before (`cb41280e...d55d`) |
| `build-release.ps1 -Version 0.1.0 -OutRoot D:\dev\release-c`, target `D:\dev\targets\int1` | 0 failures; installer `nq-lab terminal_0.1.0_x64-setup.exe` 3,253,179 bytes, sha256 `6dbf8f49709fca3d7f934e94e88f657de00dad426da49e7df61a39ef4bd2eca0` (the `release-b` installer was 3,253,192 bytes: the builds differ by 13 bytes and the hash changes with every rebuild); the folder `D:\dev\release` was not touched |
| `artefact-check.mjs`, `install-test.ps1` on the new folder | artefact check passed (17 files, 2 installers); install test 52 steps, 0 failed, 0 windows |
| `report.mjs D:\dev\d5\runs --check` | exit 1, naming exactly the rows that were not measured: the four measure-build rows, the soak row (its record sits in `D:\dev\d5\soak` and carries the old `window-fail` status, so the report cannot count it) the real minimise check and the simulated minimise (not tested: page-level driver only; the report now says so, test first in `desktop/harness/tests/report.test.mjs`); no figure differs from its raw record |

### The release check

`release_check.ps1 -Tag desktop-v0.1.0 -ReleaseDir D:\dev\release-c\0.1.0 -RequireSmokeApp`: PASS for the tag name, the four records (same day, same PC, same stamp), the artefact provenance (built from this tree), the record inputs (the smoke exe is the release payload; `web/dist` and the dumps are those the checks used), `SHA256SUMS` (16 files) and the artefact check. **One FAIL: the clean-tree check** (tracked files differ from HEAD and three files are untracked), because nothing is committed yet. The `ReleaseDir` argument also makes the run a self-test by the script's own rule (a WARN), so it is not a release check in any case. The check cannot pass before the manager commits, and the commit changes HEAD and so the stamp of every record and of the artefacts: W6 records and builds again on the committed tree, then runs the check on the default folder `D:\dev\release\0.1.0` (which holds the older build the soak ran from). No tag was created.

### Safety and state, before and after

- Port 8765: still listening, pid 46084, never touched. No process outside this run was stopped.
- Research files: `ledger.csv`, `registry.csv` and `oos_openings.json` byte-equal; `jobs.json` sha256 unchanged (`44CAE38A...72D4`); `backtests/output` unchanged (139 entries at the top level).
- `oos_access_log.jsonl` grew by 281 lines (22,023 to 22,304): every new line has caller `terminal`, no window ends after 2022-01-01 (the exclusive fence), no line is torn.
- `terminal/state`: the only new files are the four dated records under `state/release` (git-ignored); nothing else.
- C: free space 96,242 MB before the merge and 95,579 MB after (663 MB): the outputs of this step are on D:, and the movement came from the browser and installer test runs and other programs; it is recorded, not a stop (manager decision 4).

### Round 2 review

Read against the raw records: the series B figures of section 3 were re-read with `report.mjs` and match (backend ready 1,378, cold HOME 5,048, idle 1,081.9); the soak's 1,577.4 MB is in its raw record; the gate readings, rejected runs and the 8765 checks are as stated in sections 1 to 6. Nothing was found that changes a figure. The wording of the verdict was tightened on three points: the soak row is stated by the harness's largest-sample rule and also as the steady figure; the first-launch row is reported against the 5,000 ms ceiling that governs (register 1.1) and not against the 6,000 ms cap; T4 is reported as firing, with the decision (lower the caps and re-check route times) left to the owner.

## 13. The release check after the review fixes (4 October 2026)

Done on the tree of `f2e03bf` plus the merge edits, the review fixes and the two defect fixes below. Logs are under `D:\dev\d5\w5b-final\`. Nothing was rebuilt and no figure of sections 2 to 9 was re-measured; this pass re-ran the suites and re-recorded the dated records.

### Defect fixed in this pass

- **The report read the page-level simulated minimise as within ceiling.** The harness verdict already refused such a run (NOT TESTED), but `report.mjs` still read its raw figure (0 ms, `engineLevel: false`) and printed `within-ceiling`. It now reads `not-tested` and `--check` names it as a problem. Born failing first: two cases in `desktop/harness/tests/report.test.mjs` (the page-level run reads not tested; an engine-level run still reads within ceiling).
- **The installer figure in the verdict named the wrong build.** It gave 3,253,179 bytes (the `release-c` self-test build); the harness read 3,253,192 bytes from `release-b`. Corrected, with the range of the three builds (3,253,179 to 3,253,317 bytes, all 3.1 MB).

### Results

| Check | Result |
| --- | --- |
| Harness node tests | 143 passed |
| Backend suite (`-n 16 --dist loadfile`) | 4,075 passed, 1 skipped (4,065 before the ten cases of the two new documentation tests) |
| QA tests | 333 passed |
| vitest | 496 files, 7,383 passed, 47 skipped |
| `test:types`, `test:e2e-types` | exit 0 |
| Playwright `e2e` (8 workers) | 538 passed, 1 failed: `reflow-200.spec.ts` EQ-run, page not mounted within 45 s while the type checks and vitest ran beside it; the whole file (133 tests) passed alone on the rerun |
| Playwright `e2e:offline` | 190 passed, 3 skipped |
| Playwright `e2e:desktop` (smoke build of `release-b`, clean PATH) | 42 passed |
| Playwright `e2e:perf`, alone | 3 passed, CPU 3.1% over the 30 seconds before |
| `report.mjs D:\dev\d5\runs --check` | exit 1, naming the four measure-build rows, the soak row, the real minimise check and the simulated minimise (not tested); no figure differs from its raw record |

### The release check

`release_check.ps1 -Tag desktop-v0.1.0` on the default folder `D:\dev\release\0.1.0`, run after the records of this pass: it fails the clean-tree check (nothing is committed) and the artefact provenance check (that folder was built from an older commit, `e0834c1`, and is the one the soak ran from). It cannot pass before the manager commits; the commit changes HEAD, so W6 records and builds again on the committed tree and then runs it on the default folder. No tag was created.
