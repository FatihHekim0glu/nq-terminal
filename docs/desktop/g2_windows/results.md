# G2 on Windows: measured results (release 0.1.1 re-measure; the 0.1.0 and W5B records follow as history)

Taken on 4 October 2026, in a slot from 16:39 to 16:57 BST, on the owner's PC (host `DESKTOP-FM5O3JM`), after the thread-cap fix of release 0.1.1 (commit `519a3cb`, merged as `656a964`). Sections A1 to A7 are the 0.1.1 record, written from the raw records under `D:/dev/w6/measure-runs` (named in A7). Sections 1 to 14 below them are the 0.1.0 record of wave W5C, unchanged, and section 13 sets W5B beside W5C; they stay as history and are the evidence for every row that 0.1.1 did not re-run. The verdict is in `verdict.md`.

## A1. Read this first

- **What 0.1.1 is for.** On 0.1.0 the release row whole-app idle memory at HOME read 505.4 MB (median of six launches, ceiling 500 MB, target 400 MB) and varied from 487 to 513 MB between launches. 0.1.1 caps the maths thread pools of the desktop backend server, and this file records the official re-measure of that row and of the rows beside it.
- **Result.** Idle memory at HOME reads **477.3 MB** (453.0 to 484.4 MB over six counted launches), inside the 500 MB ceiling with 15.6 MB of headroom at the worst launch, and still 77.3 MB above the 400 MB target. Every other row that was re-measured stayed inside its ceiling. The automated part of G2 is therefore passed; the owner-attended rows are pending (`verdict.md`).
- **Tree and builds.** Head `656a964` plus the uncommitted version bump to 0.1.1 (tracked diff: `git diff HEAD` sha256 `2ee6d04a2a203f4e1fe725fdb5a685f65fd25561088ee1be6ae535f4a7211361`, plus the untracked `backend/tests/test_release_version.py`); the stamp was the same before and after the builds. The three GNU builds were made fresh from this tree before any measuring by `desktop/scripts/build-release.ps1 -Version 0.1.1 -TargetDir D:/dev/target/nqt/w5c -OutRoot D:/dev/w6/release-m -LogRoot D:/dev/w6/build-logs` (0 failures; the target folder is W5C's incremental one, and all three builds were rebuilt from this tree) and passed `artefact-check.mjs` (17 files, 2 installers). Smoke exe sha256 `88ff116fff5da5c814123f9677042f107d701bad73e3a7307e59613eeacacfdd`. The release installer of that folder is 3,253,511 bytes and the measure installer 3,219,784 bytes; the shipped installer is a rebuild after the manager's commit, so its size and hash are the placeholders of the hand-over and differ from these.
- **The quiet slot.** `D:/dev/locks/QUIET` was created at 16:39:55 and deleted at 16:56:42, after the last launch; the QuantPad runners were not touched. Before starting there was no backend pytest, Playwright, cargo or other build running, and CPU read 2.0 to 3.3%. The slot was set by the manager, not named by the owner.
- **The CPU gate.** Every counted launch sat behind the 60 second CPU gate at a 10% limit. Readings were 3.0 to 3.1% for the rows and first-launch series and 2.9 to 4.9% for the usual launches, so 0 runs were rejected. GPU load was 9 to 15%.
- **Reproduction held.** The harness digest `7148ac0d...` is unchanged since the W5C reproduction, so the rows ran without `--allow-unreproduced` and no figure carries the UNREPRODUCED label.
- **Launch conditions.** Rows ran on the smoke build with real data: `harness rows --build smoke --rows all --runs 3 --warmup 1 --real-data`, then `--first-launch --build smoke` three times, then `t4t5.mjs usual-app --runs 3`. Each launch had a fresh temporary state folder (except the usual launch, as designed), the shipped caps, hidden windows and the harness's clean PATH. The window watch showed 0 new windows and 0 foreground changes in every run, and every teardown left 0 survivors.
- **Port 8765 was listening (pid 46084, the owner's terminal)**, so the harness's real-lab guard would refuse any measure-artefact real-lab launch. Measure-build rows were not run (they are not needed for the smoke rows) and nothing at that port or in that process was touched. A second backend, pid 39464 (`.venv` python, started 2 October), was already running and was left alone.
- **Not run, as instructed.** Soak, minimise and T8. Their 0.1.0 figures stand as history and are not claimed for 0.1.1.
- **Research gate and lab state.** The read-only lab check before and after: `jobs.json` sha256 `44CAE38A...` both times, 0 active jobs, `backtests/output` 229 entries unchanged, the `terminal/state` listing unchanged, and `ledger.csv`, `registry.csv` and `oos_openings.json` byte-equal. The gate log grew by 521 lines, all caller `terminal`, all ending at or before 2022-01-01, timestamped 15:43:29 to 15:56:26 UTC, so all inside the run. `backend.lock` read present-not-held before and after (W5C read it as absent); nothing here created it.
- **Host.** Not freshly booted (up about 2,930 minutes), so the first-launch records say `firstAfterBoot` false, as in W5C.

## A2. What changed in 0.1.1, and why

numpy, scipy (OpenBLAS), OpenMP and Arrow size their worker pools to the logical CPU count when they load, and each worker holds its own private memory. On this 32-thread host the idle backend carried dozens of threads and a large committed arena that the server's small maths (one HOME page of tables and charts) never uses. `backend/nq_terminal/threadcaps.py` now sets `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS` and `NUMEXPR_MAX_THREADS` to 2, only where the name is absent so an explicit setting still wins, and `backend/nq_terminal/__main__.py` calls it before the app imports numpy, scipy or pyarrow. The caps stay in the server process: a backtest child gets the allow list of `desktop/envlist.py`, which does not carry these names, so a job still sizes its pools to every core. The change was measured first with an attach driver against a backend serving the real HOME page:

| Backend reading (attach driver) | Before | After |
| --- | ---: | ---: |
| Threads | 68 | 13 |
| Committed private bytes | 1,790 MB | 369 MB |
| Working set, median | 262.6 MB | 246.1 MB |

In short, the backend went from 68 to 13 threads, its committed private bytes from 1,790 to 369 MB and its median working set from 262.6 to 246.1 MB. The attach driver reads the backend alone, long after start-up. The official row below reads the whole app at the harness's reading point (HOME ready plus a 2.5 second idle check). The attach-driver projection for the official row was about 490 MB and had not been measured; the official reading, 477.3 MB, came out about 13 MB lower. The version bump to 0.1.1 is the only other change in the tree (backend `__version__`, the three Tauri configurations, `Cargo.toml` and `Cargo.lock`, the OpenAPI contract with its regenerated hash in `web/src/api`, and `backend/tests/test_release_version.py`).

## A3. The rows, 0.1.1 against 0.1.0

All readings are the whole-app smoke build, real lab, shipped desktop caps (512 MiB bars, 128 MiB files). "0.1.0" is the W5C reading of section 3 (the `report.mjs` pooled median where the row had more than one series, the rows series otherwise). Medians; the range or the counted values are in the next column.

| Row | Target | Ceiling | 0.1.0 (W5C) | 0.1.1 median (counted values) | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| Whole-app idle at HOME, private working set (the release row) | 400 MB | 500 MB | 505.4 MB (492.4 to 508.4), over | **477.3 MB** (453.0 to 484.4; n = 6: rows series 484.4, 475.4, 482.6; first-launch series 453.0, 479.2, 470.8) | within ceiling, above target |
| Cold HOME, first launch, empty state folder | 4,500 ms (usual 3,500) | 5,000 ms | 3,172.5 ms (3,148 to 3,225) | 3,192.5 ms (3,164 to 3,210; n = 6: rows 3,210, 3,194, 3,201; first-launch mode 3,164, 3,183, 3,191; first-launch mode alone 3,183 ms) | within target |
| Cold HOME, usual launch (state filled) | 3,500 ms | 5,000 ms | 2,750 ms | 2,797 ms (2,829, 2,777, 2,797; one priming launch of 3,243 ms not counted; gate 3.1, 2.9, 4.9%) | within target |
| `volmanaged_v0 EQ`, second run of the line | 1,000 ms | 1,500 ms | 41.3 ms | 38.4 ms (38.4, 33.3, 45.4) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 537.2 ms | 537.6 ms (558.8, 537.6, 534.0) | within target |
| `REG`, second run of the line | 1,000 ms | 1,500 ms | 57 ms | 56.9 ms (60.6, 56.9, 56.6) | within target |
| Backend ready (informational) | 1,500 ms | 2,500 ms | 1,413.5 ms | 1,401.5 ms (1,412, 1,407, 1,396, 1,378, 1,395, 1,412) | within target |
| Splash painted (informational) | 500 ms | 1,000 ms | 321.9 ms | 316.7 ms (301.2, 327.4, 314.8, 309.5, 324.3, 318.5) | within target |
| Grid open (rows series, informational) | 100 ms | 500 ms | 63.3 ms | 65.9 ms (61.5, 65.9, 72.3) | within target |
| GIP pan and zoom p95 (rows series, informational) | 16.7 ms | 25 ms | 6.0 ms | 6.2 ms (5.8, 6.2, 6.4) | within target |
| Keystroke to paint p95 (rows series, informational) | 50 ms | 100 ms | 8.3 ms | 8.3 ms (8.2, 8.3, 8.3) | within target |

`report.mjs` over the folder reports `idle_mem_home` on the smoke build as 477.3 MB (453 to 484.4) and marks it **within-ceiling ACCEPTED**; it reports cold HOME as 3,192.5 ms (3,164 to 3,210), within target. The first launch of the first-launch series reads the same process rows at the same points as the rows series; the warm-up launch of the rows run (idle 488.0 MB, cold HOME 3,413 ms, backend ready 1,533 ms) was not counted.

## A4. Idle memory in detail

The breakdown (informational, `idleBreakdown`), median of the six counted launches, against the 0.1.0 rows series:

| Part of the tree | 0.1.0 (W5C) | 0.1.1 | Note |
| --- | ---: | ---: | --- |
| Backend interpreter | 297.3 MB | 275.6 MB | per launch 280.8, 273.8, 278.7, 253.1, 277.4, 271.1 MB |
| UI tree (WebView2 and its helpers) | 198.2 MB | 195.4 MB | 194.6 to 198.3 MB; renderer 109.4, GPU process 37.9, browser 34.3, network 9.9, storage 3.1, crashpad 1.6 |
| Shell | 4.2 MB | 4.3 MB | 4.1 to 4.3 MB |

The fix moved the backend share, as designed (about 22 MB lower) and nothing else; the UI tree is unchanged and far below the 350 MB of the T4 canvas clause (`uiOver350` false in every run). The whole row is about 28 MB lower than on 0.1.0, and the spread between launches is narrower (453.0 to 484.4 MB against 492.4 to 508.4 MB), so the worst launch now has 15.6 MB of headroom where three of the six 0.1.0 launches were over the ceiling.

**The thread count at the reading point is not the attach driver's 13.** The harness's sampler counts the backend interpreter's threads at the reading point (the median of its samples): 26, 25, 26, 24, 28 and 27 over the six counted launches (range 24 to 28), plus the three threads of the virtual-environment launcher process. That is well below the 68 of the uncapped backend, but it is not 13, because the prewarm workers are still alive at HOME ready plus 2.5 seconds; the attach driver reads long after start-up. The warm-up launch, followed longer, read 17 interpreter threads 33 s after spawn. Interpreter private bytes at the reading point were 398 to 642 MB, mostly 400 to 460 MB (committed, not working set). So the thread figure depends on when it is read, and the 13 should not be quoted as the figure of the official row.

**Why the row is not at the 400 MB target.** The reading point catches the app while the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) are still running; the 0.1.0 record (section 9) showed the whole tree falling to 453.8 MB after an 8 second settle and 388.6 MB after five minutes. The caps lower the part the backend keeps at that moment but do not change when the prewarm runs. The row is reported as the harness reads it, the W0B reading point, unchanged since W5B.

## A5. Not re-run in 0.1.1, and still pending

| Item | State |
| --- | --- |
| Measure-artefact rows (backend ready, splash, cold HOME, idle memory) and the smoke against measure agreement | **Pending**: port 8765 was listening (pid 46084). The 0.1.1 measure installer is built at `D:/dev/w6/release-m/0.1.1` but is not installed. |
| Soak | Not run. The 0.1.0 reading (2 h, PARTIAL, largest sample 705.8 MB, section 8) is history. |
| Simulated minimise, T8 | Not run. The 0.1.0 readings (stream back 0 ms at engine level; 14 of 14 on WebView2 154.0.4258.53) are history. |
| Stage 1 rows (EQ and REG Enter units, eight routes, 20,000-point hop) | Not re-run. The 0.1.0 readings (section 4) are history; the app's own second-run readings for EQ and REG are in A3. |
| Installer row of the harness (`installer` mode) | Not run. The release installer built for the measuring is 3,253,511 bytes (3.1 MB against the 30 MB ceiling), from the build output. |
| Owner-attended rows | Pending, as on 0.1.0 (`verdict.md`). |

`node desktop/harness/report.mjs D:/dev/w6/measure-runs --check` exits 1 only on these missing readings (the four measure rows, the soak, the installer row and both minimise checks), none of them a defect of a measured row; the rows are in `D:/dev/w6/measure-runs/report-check.txt`.

## A6. Checks of the 0.1.1 tree

All release suites were green on their final runs, with no git write:

| Check | Result |
| --- | --- |
| Backend pytest (`-n 16 --dist loadfile`) | 4,155 passed (first run 4,154 passed and 1 load timeout, see below) |
| Crosscheck, strict | PASS 2,495, FAIL 0, SKIP 0 (INFO 104) |
| QA tests | 333 passed |
| Vitest (with the `gen-api --check` step) | 497 files, 7,394 passed, 47 skipped |
| `test:types`, `test:e2e-types` | clean |
| Web build | OK, all bundle budgets met |
| `desktop/scripts/check.ps1` | 29 of 29 steps, 0 failed |
| Harness node tests | 172 passed, 0 failed |
| Playwright e2e, functional chromium | 539 passed |
| e2e offline | 190 passed, 3 skipped (declared skips), 0 failed |
| e2e desktop (one worker, smoke exe from `check.ps1`) | 42 passed |
| e2e perf (one worker) | 3 passed |

One real failure came out of the version bump: `web/src/api/schema.d.ts` and `web/src/api/openapi.sha256` are generated from `contract/openapi.json`, and the bump of `info.version` made the contract hash stale, so the `gen-api --check` step of `pnpm test` failed. It was fixed at the cause with `pnpm gen:api`, which rewrote only the sha256 line of both files. The same change left `web/dist` stale against its sources, which explains two more failures (the first `check.ps1` run failed `test-smoke` with "HOME never became ready", and the desktop e2e could not start, both because the supervisor refuses a stale page build); a fresh `pnpm build` cleared both. The remaining failures were load or invocation noise, not code defects: `test_result_cache_singleflight[seasonality]` timed out at 10 s while pytest ran beside vitest, Playwright and Rust builds and passed on the quiet rerun; one gallery-focus spec failed once under load and passed alone and in the full quiet rerun; and a desktop e2e run with `--workers=8` failed 14 of 42 because the desktop project shares one app window and must run with one worker.

## A7. Findings for the manager, and the evidence

1. **Idle at HOME passes its ceiling and misses its target.** 477.3 MB against 500 MB (target 400 MB). The row is within the ceiling by 22.7 MB at the median and 15.6 MB at the worst launch. Reaching the target needs the prewarm's working memory kept out of the reading window, or an owner decision on the reading point (A4).
2. **The shipped installer is a rebuild.** The builds above used a measuring output folder (`D:/dev/w6/release-m`) and the uncommitted tree. A rebuild after the manager's commit changes the provenance stamp, because the `git diff HEAD` hash will differ, so the installer size and SHA256 of release 0.1.1 are the placeholders of the hand-over, filled after that build.
3. **A cold result cache on the first run.** The version bump changes the backend code stamp, so the first 0.1.1 launch recomputes what 0.1.0 had cached.
4. **Preconditions the commands do not state.** `e2e:desktop` needs a smoke exe in `NQT_SMOKE_EXE` and one worker, and `web/dist` must be rebuilt after any change to web sources; running `check.ps1` at the same time as `pnpm build` or `gen:api` can race on `web/dist`. A bare clone has no `web/dist`, so a CI job needs `pnpm build` first.
5. **The singleflight test has a 10 s wait** that can time out when `-n 16` shares the machine with other heavy runs. It is a load flake, not a regression.
6. **Documents.** The hand-over, the README and the 0.1.0 owner-check templates still name the 0.1.0 installer where they are dated records of 3 October; the current values are in the hand-over, section 2.

Evidence (all under `D:/dev/w6`): `measure-runs/report-check.txt`, `measure-runs/report.json`, `measure-runs/facts.json`, `measure-runs/rows/rows-smoke-s01-a1-warmup.json`, `measure-runs/rows/rows-smoke-s02-a1-measure.json`, `measure-runs/rows/rows-smoke-s03-a1-measure.json`, `measure-runs/rows/rows-smoke-s04-a1-measure.json`, `measure-runs/rows/rows-summary.json`, `measure-runs/first-launch-smoke-1/first-launch-smoke-s01-a1-measure.json` (and `-2`, `-3`), `measure-runs/t4t5/2026-10-04T15-52-48-108Z-usual-app/usual-s1.json` (and `usual-s2.json`, `usual-s3.json`), `measure-runs/backend-threads.jsonl`, `measure-runs/precheck-before.json`, `measure-runs/precheck-after.json`, `measure-runs/gate-log-new-lines.jsonl`, `chain.log`, `build-release.log`, `artefact-check.log`, `release-m/0.1.1/PROVENANCE.json`, `release-m/0.1.1/SHA256SUMS`, `release-m/0.1.1/payload/smoke/nq-lab-terminal.exe`, and the tools `tools/chain.sh`, `tools/backend-sampler.ps1` and `tools/facts.mjs`. The read-only external sampler `backend-sampler.ps1` logged the smoke shell's python descendants once a second for the thread counts; it polls only `Get-Process` and was not running during the gates in any way that mattered.

## The 0.1.0 record (wave W5C, the re-measure after W5B)

Taken on the morning of 4 October 2026 on the owner's PC (host `DESKTOP-FM5O3JM`), after the W5C performance changes. Sections 1 to 14 are the evidence behind the 0.1.0 verdict, which the 0.1.1 verdict in `verdict.md` replaced; they replaced the W5B figures in their turn (the W5B version of this file is in commit `09a660d`; section 13 sets the two side by side). Words such as "this tree", "the verdict" and "the idle row" in sections 1 to 14 mean the 0.1.0 tree and its verdict. Every figure below was read back from a raw record under `D:/dev/w5c/measure-runs` (the folders are named in each section); the exploratory readings that are not rows sit apart in `D:/dev/w5c/explore-runs`. Nothing here was typed from memory.

## 1. Read this first

- **Tree and builds.** Head `dd286fd1c12635f3a2a99abc8ea6f72c67551a7e` plus the W5C tree (committed afterwards as `8122c87`; the tracked diff between the two hashes to the value below): `git diff HEAD` sha256 `34046e2606d8e4d807cd4c236761826b78da1e4857041f0cfe31542b9fd1de6c` and 11 untracked files (harness stamp `dfedc110...7749`), the same for every record of this file; `web/dist/index.html` sha256 `a6dec56c...5655`. The three GNU builds were made fresh from this tree before any measuring by `desktop/scripts/build-release.ps1 -Version 0.1.0 -TargetDir D:\dev\target\nqt\w5c -OutRoot D:\dev\w5c\release-m` (0 failures, the stamp the same before and after) and passed `artefact-check.mjs` (17 files, 2 installers). Smoke exe sha256 `a5e2b6cbc2e5ac54fff007b0749ec2cb5075e2932d10a8b152b178fb6ba52f12`; measure payload `425c41e97eae3b1a7081a1c6f1559ae5439ced2ff201714bb5b9e92684d2d666`; release installer `nq-lab terminal_0.1.0_x64-setup.exe` 3,253,071 bytes; measure installer 3,219,647 bytes.
- **GNU stands in for MSVC.** There is no MSVC measure artefact on this PC; the MSVC agreement stays open.
- **The quiet slot.** The lock `D:/dev/locks/QUIET` was created at 07:14:45 and removed at 09:10:19 local time (BST), after the last timing row; the QuantPad download runners start no new job while it exists. No backend test session, Playwright run, cargo or other build of this wave ran beside any timing row. Every counted run sat behind the 60 second CPU gate (limit 10%): the readings were 2.6 to 4.7% across every series, so **no run was rejected** (0 rejected readings in total) and none is PROVISIONAL by the gate. The slot was set by the manager, not named by the owner, so the stage 1 record keeps its own `provisional: true` for that reason only.
- **GPU load, per run.** Every harness slot carries its GPU reading at the gate and after the run (`gpu.atGate`, `gpu.afterRun`): 8 to 15% utilisation and 2,059 to 2,097 MiB used throughout (the owner's training job was not running). The tools outside the harness (`t4t5.mjs`, the stage 1 script) do not read the GPU; their series ran between harness slots that read 9 to 15%.
- **Reproduction held.** The W0B anchor reproduced first (section 2), so no figure of this file carries the UNREPRODUCED label (W5B's all did).
- **Windows.** No window of any app under test appeared and the foreground never changed because of one, in any run; every harness and tool watch reads clean (0 new windows, 0 foreground changes, 0 foreign notes in the counted runs). Browsers were headless.
- **Backends.** App rows: the real lab through the GNU smoke build (`--lab`, a fresh temporary `--state-dir` per launch, `NQT_JOBS=off`) at the shipped desktop caps (512 MiB bars, 128 MiB files). Stage 1 and the browser comparator: the real backend on port 8797 with its own temporary state folder. The minimise and T8 runs: the fixture backend and the offline demo server.
- **Port 8765 was listening (pid 46084, the owner's terminal) at every check.** The harness's real-lab guard therefore refused every measure-artefact real-lab launch and wrote a pending record naming the reason (section 6). Port 8765 and its process were never touched.
- **Research gate and lab state.** The read-only lab check (kept outside the repository, `D:/dev/w5c/tools`) before the first run and after the last timing row: `jobs.json` sha256 `44CAE38ADB6F6E142C013AC988929B5E12F20363CB82C990A40E77C34B2172D4` both times, no queued or running job, `backtests/output` 229 entries with the same list, `backend.lock` absent, `terminal/state` with the same three entries (`desktop`, `release`, `jobs.json`). The research files `ledger.csv`, `registry.csv` and `oos_openings.json` were byte-equal; the gate log only grew, by lines of caller `terminal` inside the fence (the stage 1 script counted 660 such lines and 0 bad ones; the two real-data smoke runs 67 each). Section 12 has the after-soak check.

## 1a. What changed since W5B, and why

W5B (commit `09a660d`) measured three automated rows over their ceilings: idle at HOME 1,082 MB (ceiling 500 MB, target 400 MB), first launch 5,048 ms (ceiling 5,000 ms, target 4,500 ms) and the soak's first sample 1,577.4 MB (ceiling 1.5 GB, target 1.0 GB). Wave W5C (commit `8122c87`) treated them under roadmap trigger T4 (`docs/desktop/02_decision.md`, 6.5). T4's response is to lower the caps and re-check the route times; the profile showed that what filled the cache, not its size, was the cause, so the caps were deliberately not lowered (section 9, "The cap decision"). The changes:

- MON's two-day sparkline reads only its window in desktop mode instead of keeping a whole 1-minute year per symbol in the bar cache (the main cost of idle memory and of the soak's start-up peak).
- Arrow uses the system memory pool, so freed memory returns to the operating system.
- HOME start-up does only the work HOME shows; heavy imports are warmed afterwards (first launch).
- The audit log is cached as raw bytes plus a compact line index and weighed at its real size.
- The record-watch reader mounts once HOME's own queries are quiet (deferred).
- Harness: whole-tree memory and soak reporting; the e2e specs wait for the watch segment.

| Row | Ceiling | Before (W5B) | After (W5C) | Source |
| --- | ---: | ---: | ---: | --- |
| Idle at HOME | 500 MB | 1,082 MB | **505.4 MB (492.4 to 508.4), over** | `D:/dev/w5c/measure-runs/report.json` |
| First launch, cold HOME | 5,000 ms | 5,048 ms | 3,172.5 ms (3,148 to 3,225) | `D:/dev/w5c/measure-runs/report.json` |
| Soak, first and largest sample | 1,500 MB | 1,577.4 MB (3 h) | 705.8 MB largest, 698.7 MB first (2 h, PARTIAL) | `D:/dev/w5c/measure-runs/soak-outside.jsonl` |

Two of the three rows now pass. The idle row improved by about 580 MB and still sits 5.4 MB over the ceiling on the pooled reading (section 3). The measured build is the committed tree of `8122c87` (finding 8 in section 12).

## 2. Reproduction of the W0B figures (first, as 04 D5.1 asks)

Folder `D:/dev/w5c/measure-runs/reproduce`. The spike shell against the fixture backend on 8800, one warm-up and three counted launches, every gate reading accepted.

| Figure | W0B median (range) | This run, median of 3 | Within |
| --- | ---: | ---: | --- |
| Private memory at HOME | 164.9 MB (159.7 to 168.4) | 164.9 MB (164.7 to 165.3) | yes |
| Private memory after the heavy set | 369.5 MB (363.1 to 375.2) | 370.3 MB (368.1 to 390.0) | yes |
| Launch to HOME ready | 834.5 ms (814 to 892) | 856 ms (844 to 861) | yes, +2.6% |

The verdict reads `reproduced: true`, so the rows below were taken without `--allow-unreproduced`. The breakdown is inside its references too (spawn to the HOME document 235 ms against 214, ready since navigation 609.5 ms against 618.6, first frame 154.2 ms against 140.2).

## 3. The budget rows on the GNU smoke build

Folder `D:/dev/w5c/measure-runs/rows`: the harness's `rows` mode, `--build both --rows all --runs 3 --warmup 1 --real-data`, smoke and measure slots interleaved, one fresh state folder per launch (so every cold HOME is a first launch with an empty state folder). Gate readings 2.7, 2.6 and 2.9%; GPU 9 to 15%. The measure slots were refused by the lab guard (section 6). Three more first-launch readings on the same build come from the harness's first-launch mode, `D:/dev/w5c/measure-runs/first-launch-smoke-1` to `-3` (gate 3.5, 2.8 and 3.0%), which reads the same process rows at the same points.

| Row | Target | Ceiling | Rows series, median (min to max) | First-launch series, median (min to max) | `report.mjs` over the folder (n = 6) | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Backend ready | 1,500 ms | 2,500 ms | 1,402 (1,378 to 1,425) | 1,426 (1,387 to 1,434) | 1,413.5 ms (1,378 to 1,434) | within target |
| Splash (first contentful paint) | 500 ms | 1,000 ms | 313 (311.7 to 346) | 330.7 (307.9 to 342.2) | 321.9 ms (307.9 to 346) | within target |
| Cold HOME, first launch, with data | 3,500 ms (first launch 4,500 ms) | 5,000 ms | 3,167 (3,162 to 3,178) | 3,188 (3,148 to 3,225) | 3,172.5 ms (3,148 to 3,225) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 537.2 (530.1 to 538.7) | | | within target |
| `volmanaged_v0 EQ`, warm (second run of the line) | 1,000 ms | 1,500 ms | 41.3 (31.2 to 44.5) | | | within target |
| `REG`, warm (second run of the line) | 1,000 ms | 1,500 ms | 57 (56.9 to 57.8) | | | within target |
| Grid open, 8,411 fills | 100 ms | 500 ms | 63.3 (63 to 64.1) | | | within target |
| GIP pan and zoom p95, 20,000 bars | 16.7 ms | 25 ms | 6.0 (5.8 to 6.2) | | | within target |
| Keystroke to paint, p95 | 50 ms | 100 ms | 8.3 (8.2 to 8.3) | | | within target |
| Whole app idle at HOME (private working set) | 400 MB | 500 MB | 497.1 (492.4 to 506.7) | 506.3 (504.4 to 508.4) | **505.4 MB (492.4 to 508.4)** | **over the ceiling on the pooled reading; see below** |
| Installer (`nq-lab terminal_0.1.0_x64-setup.exe`) | 15 MB | 30 MB | 3.1 MB (3,253,071 bytes) | | | within target |

Method (from `desktop/harness/README.md` and `lib/launch-run.mjs`): cold HOME is the page probe's HOME ready mark from the spawn instant; backend ready is spawn to `supervise_checked` in the shell log; splash is first contentful paint over the debugging protocol; idle memory is the whole-tree private working set from the performance counters, the median of three samples two seconds apart, read straight after HOME is ready and a 2.5 second idle check (the W0B reading point), before any page row runs. The GIP row reads a 20,000-bar series the harness tiles from the real response (`barsSynthetic: true`); the 8,411 fills are the real run `nt_dtsmom_v0_lo0`. Every teardown closed gracefully with 0 survivors; the new files appeared only under each launch's own temporary state folder (14 in a rows launch, 11 in a first-launch launch) and none under `terminal/state`. The installer row is the harness's `installer` mode (`D:/dev/w5c/measure-runs/installer`).

**Whole-app idle memory sits on its ceiling.** The rows series alone reads 497.1 MB, 2.9 MB inside the ceiling, but one of its three launches read 506.7 MB, and the three first-launch launches of the same build, taken minutes later by the same method, read 504.4 to 508.4 MB. Four of the six counted launches are above 500 MB, and `report.mjs` over the whole folder, which pools every counted launch of the row, reads **505.4 MB (492.4 to 508.4) and marks the row over its ceiling**. The breakdown (informational, `idleBreakdown`): backend 297.3 MB, UI tree 198.2 MB (renderer 109, GPU process 38, browser 35, network 10.7, storage 3.3, crashpad 1.6), shell 4.2 MB, median of the rows series; the UI tree is far below the 350 MB of the T4 canvas clause (`uiOver350: false` in every run). The reading falls quickly after the reading point: the same build followed for ten minutes (section 9) read 455.2 MB at 9 s, 420.7 MB at 61 s and 388.6 MB at 301 s, and read by the browser comparator's method (an 8 second settle) it is 453.8 MB. The fall is in the backend (297 to 251 MB within about 10 s), which is when the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) finish and the system allocator hands their memory back. The row's reading point is unchanged from W0B and W5B, so the row is reported as the harness reads it.

### The usual launch (state folder already filled), in the app

Folder `D:/dev/w5c/measure-runs/t4t5/2026-10-04T06-33-24-434Z-usual-app` (tool `t4t5.mjs usual-app`, kept outside the repository in `D:/dev/w5c/tools`). One priming launch (cold HOME 3,161 ms, not counted), then three launches on the same state, config and WebView2 folders, a stale `DevToolsActivePort` removed before each: cold HOME 2,750, 2,746 and 2,777 ms, **median 2,750 ms** (gate 2.6, 2.8, 3.3%), within the 3,500 ms target. The shell-log milestones of these records read negative because the reused config folder keeps one log across launches; only the probe's figure is used.

## 4. Stage 1 figures re-taken alone: backend ready, both launches, the eight routes at both caps, EQ and REG

Tool: `docs/desktop/stage1/measure_stage1.mjs --max-rejects 4` (headless Chromium over the real backend on 8797, temporary state, `NQT_JOBS=off`). Folder `D:/dev/w5c/measure-runs/stage1/2026-10-04T06-47-08-881Z`. Every run accepted by the gate (2.6 to 3.5%); the window watch is clean; the research files were byte-equal after the run and the gate log grew by 660 lines, all caller `terminal`, inside the fence; no new entry under `terminal/state`.

| Series | Target | Ceiling | Runs | Median |
| --- | ---: | ---: | --- | ---: |
| Backend ready, browser form | 1,500 ms | 2,500 ms | 1,240; 1,207; 1,209 | 1,209 |
| Backend ready, desktop form | 1,500 ms | 2,500 ms | 1,201; 1,199; 1,223 | 1,201 |
| Cold HOME, first launch (the T3 reading) | 4,500 ms | 5,000 ms (G2); cap 6,000 ms | 2,681; 2,700; 2,865 | 2,700 |
| Cold HOME, usual launch | 3,500 ms | 5,000 ms | 2,439; 2,425; 2,417 | 2,425 |
| Eight routes, worst repeat, browser caps | 100 ms | 300 ms | 8 | 8 |
| Eight routes, worst repeat, desktop caps (512 and 128 MiB) | 100 ms | 300 ms | 12 | 12 |
| `volmanaged_v0 EQ` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 641; 680; 629; 646; 621 | 641 |
| `volmanaged_v0 EQ` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 662; 653; 662; 631; 653 | **653** |
| `REG` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 459; 458; 447; 462; 450 | 458 |
| `REG` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 459; 481; 421; 424; 452 | **452** |

T3 does not fire (`fires: false`): first launch 2,700 ms against the 6,000 ms cap and inside its 4,500 ms target; usual launch 2,425 ms against its W3B median of 3,757 ms and the 4,508 ms regression reference. The DEC1 decision on EQ holds at the shipped caps without raising them: 653 ms against the 1,000 ms target. The route times at the desktop caps are re-checked and the worst repeat is 12 ms (W5B: 73 ms).

## 5. T5: pan and zoom, and the 20,000-point data hop

- **Pan and zoom p95** at 20,000 bars, in the app: 6.0 ms (5.8 to 6.2) against 25 ms (section 3). In the browser budgets (`e2e:perf`, alone, one worker, fixture backend): zoom p95 18.0 ms and pan p95 18.7 ms at 60 frames a second, inside the browser budget. T5 does not fire.
- **Data hop**, in the smoke build over the debugging protocol, real data, desktop caps, folder `D:/dev/w5c/measure-runs/t4t5/2026-10-04T06-45-48-484Z-hop` (gate 2.8%): the page fetches `/api/bars` (`NQ.V.0`, 1-minute, vendor variant, from 2018-01-02, `max_points=20000`) and parses the JSON. The route answers in whole buckets; the largest answer at or under 20,000 points was again **17,097 points (875,675 bytes): first fetch 13.9 ms, warm median 15.2 ms (15.5, 34.4, 14.5, 15.2, 14.0), largest 34.4 ms**, against the 100 ms limit. T5 does not fire.

## 6. The measure artefact: installed fresh, real-lab rows pending

- **Install.** The measure installer of `D:/dev/w5c/release-m/0.1.0` was installed silently with `install-test.ps1`'s flags (`/S /NS /D=`) into the new folder `D:/dev/w5c/measure/app` (inheritance removed first), record `D:/dev/w5c/measure-runs/install-measure.json`: exit 0, files `nq-lab-terminal.exe`, `WebView2Loader.dll`, `uninstall.exe`, 0 new windows, 0 foreground changes. The installed exe (sha256 `ac46c9ff...9171`) differs from the measure payload in 3 bytes only: the bundler's bundle-type marker reads `NSS` in the installed copy and `UNK` in the payload (W5B's installed copy was byte-identical to its payload). The harness seeds the measure build's settings and WebView2 folders per launch under the run folder on D:.
- **Pending.** The harness's lab guard read port 8765 listening (pid 46084) before every measure launch: the four measure slots of the rows run and the measure first-launch record (`D:/dev/w5c/measure-runs/first-launch-measure`) are `pending` with the reason `port 8765 is listening (pid 46084): the owner's terminal is live`, and nothing was started. **Backend ready, splash, cold HOME and idle memory on the measure artefact, and the smoke against measure agreement, stay pending (decision 11).** The very first launch after install on the measure build, as DEC1 defines it, needs the same free lab and is pending with them; the smoke build's first launch with an empty state folder is in section 3.

## 7. Minimise, T8 and the browser budgets

### Simulated minimise with LIVE, at engine level

Folder `D:/dev/w5c/measure-runs/minimise-sim`, gate 4.7%, GPU 9 to 10%, the fixture backend, an 1,800 second hold (30 minutes). The first driver tried, `controller-file` (the smoke build's visibility hook: the harness writes `hidden` or `visible` to `smoke-visibility.txt` in the config folder and the shell calls `put_IsVisible`), hid the WebView2 controller itself: the page reported `hidden` 110 ms after the request and in all 30 minute samples. Over the hold the stream read "live, server events", and at its lifetime "reconnecting: the server ended the stream at its lifetime; the browser resumes after the last event it saw". After the controller was shown again the page read `visible` within 223 ms and **the stream read "live, server events" again with a stream back of 0 ms** against the 30,000 ms ceiling. `engineLevel: true`, `driverEffective: true`, verdict accepted with no problem. Memory over the hold: 325.9 MB in the first minute, 287.8 to 296.5 MB for the rest. This replaces W5B's NOT TESTED reading (page-level override only). The same run was made in W5B release round 3 (folder `D:/dev/d5/runs/w5b3-minimise-sim`, gate 9.4%, `controller-file` driver, `engineLevel: true`, `driverEffective: true`, accepted): stream back in 0 ms against 30,000 ms. Both runs are tested rows within the ceiling; neither is the real minimise. The real minimise and restore stays with the owner's visible run.

### T8, the drift run, once

Folder `D:/dev/w5c/measure-runs/t8`, gate 3.4%, started from the documented command (`node run.mjs --mode t8 --playwright`). The smoke build attached to the offline demo server on 4373, then the desktop Playwright project against it: **14 passed, 0 failed**, WebView2 runtime **154.0.4258.53** (engine `Edg/154.0.4258.53`, registry `pv` 154.0.4258.53), 0 new windows. Clean on this runtime; it says nothing about a later runtime.

### Browser budgets, unchanged

`corepack pnpm run e2e:perf` from `web`, alone, one worker, own output folder `D:/dev/w5c/pw-perf-out` (log `D:/dev/w5c/measure-runs/e2e-perf.log`), after every backend test session of the release check had ended: 3 passed. HOME first render median 611 ms against 1,500 ms; GIP zoom p95 18.0 ms, pan p95 18.7 ms, 0 missed frames; the 8,411-fill grid opens in 66.2 ms against 500 ms (sort 33.0 ms, page 37.2 ms). The release check's own run read 637 ms, 18.1 ms and 62 ms.

## 8. The soak

The soak ran from 11:14 to 13:15 local time (BST) on the smoke build, real lab, shipped caps (512 and 128 MiB), harness `soak` mode started with `--hours 3` and stopped by the manager at 13:20 after 2 h 5 min. **Label: 2 h (harness stopped at 2 h 5 min by the manager; external sampler), PARTIAL, not an all-day run.** The harness record `soak-smoke-s01-a1-measure.json` was never written (the harness holds its samples in memory until the end), so the figures below are the external whole-tree sampler's: `D:/dev/w5c/measure-runs/soak-outside.jsonl`, 25 samples of the app's whole process tree (10 processes, pid 24092 for the shell), one every 5 minutes from 11:15 to 13:15, same method as W5B's outside sampler. Window watch: `D:/dev/w5c/measure-runs/soak/soak-smoke-s01-a1-measure.watch.jsonl` (26 records: 15 new windows and 9 foreground changes, all from other programs while the owner used the PC, 0 in the app's own process tree).

| Reading (whole-tree private working set) | W5C, 2 h | W5B, 3 h (outside sampler) | Ceiling | Target |
| --- | ---: | ---: | ---: | ---: |
| First sample | 698.7 MB | 1,509.8 MB | | |
| Largest sample (the row) | **705.8 MB** (the last, at 2 h) | 1,509.8 MB (the first); 1,577.4 MB by the harness | 1,500 MB | 1,000 MB |
| Smallest sample | 622.8 MB (at 10 min) | | | |
| Median | 674.8 MB | | | |
| Slope over the last hour (12 samples, least squares) | +25.9 MB per hour (674.8 MB at 1 h to 705.8 MB at 2 h) | about 60 to 70 MB over 2 h after minute 45 | | |
| Private bytes (committed), range | 2,363.6 to 2,476.2 MB | 3,285 to 3,622 MB | | |

The row is inside its ceiling and its target. W5B's start-up peak is gone: the first sample is 698.7 MB, not 1.5 GB, because the sparkline no longer fills the bar cache with 1-minute years and the system pool returns freed memory (section 1a). The curve is flat after the first five minutes (698.7 to 624.8 MB), then climbs slowly (+25.9 MB per hour over the last hour); a 2 h run cannot say whether that climb flattens, so the all-day check stays. The sampler's first reading was taken 1 s after it found the app, about a minute after the app started, so the very first minute is not covered. The harness's own samples (workload errors, JavaScript heap, graceful close) are not available for this run. Sources: `D:/dev/w5c/measure-runs/soak-outside.jsonl` and `D:/dev/w5c/measure-runs/soak/soak-smoke-s01-a1-measure.watch.jsonl`.

## 9. T4: memory, and the browser terminal in the same session

Method for the browser terminal: the real backend in its browser form (browser caps, 2 GiB of bars), headless Chromium on HOME with the same four panels settled, an 8 second settle, three samples two seconds apart, the whole-tree private working set of the backend tree plus the browser tree, three runs behind the gate. Two forms were read, one straight after the other: **on equal terms** (`NQT_TWO_DAY_WINDOW=1`, so MON's two-day sparkline reads its exact window as the app does and keeps no 1-minute year), and **the default form** (the year kept, as `start.ps1` runs it every day).

| Tree at HOME, idle | Backend | UI (WebView2 or Chromium) | Shell | Whole tree, median of 3 (range) | Folder under `D:/dev/w5c/measure-runs/t4t5` |
| --- | ---: | ---: | ---: | ---: | --- |
| Browser terminal, equal terms | 232.9 MB | 180.4 MB | | **412.5 MB** (412.2 to 418.2), gate 3.5, 2.7, 2.9% | `2026-10-04T06-37-10-774Z-browser-home-equal-terms` |
| Browser terminal, default form (year kept) | 643.8 MB | 178.1 MB | | **820.4 MB** (819.5 to 832.7), gate 2.9, 2.8, 2.7% | `2026-10-04T06-41-29-712Z-browser-home-year-kept` |
| App, smoke build, the harness reading point (section 3) | 297.3 MB | 198.2 MB | 4.2 MB | **497.1 MB** (rows series); 505.4 MB (492.4 to 508.4) pooled | `../rows`, `../first-launch-smoke-*` |
| App, smoke build, read by the browser method (8 s settle) | 251.4 MB | 198.8 MB | 4.2 MB | **453.8 MB** (452.2 to 455.4), gate 2.7, 2.8, 2.7% | `2026-10-04T07-25-56-252Z-app-home-matched` |

The equal-behaviour citation (D8): the switch `NQT_TWO_DAY_WINDOW` is documented in `backend/nq_terminal/settings.py` ("The browser or launcher backend reads MON's two-day sparkline as the app does (its exact window, no 1m year kept), so the T4 and G2 comparison with the browser terminal's HOME is made on equal terms"); the equal-terms records carry `twoDayWindowSwitch: "1"`, the default-form records `null`.

The app followed for ten minutes after one launch (exploratory, `D:/dev/w5c/explore-runs/2026-10-04T07-14-30-980Z-app-mem`, gate accepted): whole tree 455.2 MB at 9 s, 435.7 at 31 s, 420.7 at 61 s, 420.4 at 121 s, 388.6 at 301 s and 396.8 MB at 601 s; the backend interpreter 248.2 MB at 9 s and 238 MB from 301 s; the WebView2 renderer 112.9 MB at 9 s falling to about 70 to 77 MB.

**T4 re-read (02 section 6.5: "idle above 550 MB or above the browser terminal's HOME in the same session, or a heavy session above 1.5 GB").**

- Above 550 MB: **no.** The app reads 497.1 MB (rows series) and 505.4 MB (492.4 to 508.4) pooled at the harness reading point, 453.8 MB by the browser method.
- Above the browser terminal's HOME in the same session: **against the default form, no** (820.4 MB, the app is about 320 MB lower); **on equal terms, yes** (412.5 MB: the app is 41 MB above it read by the same method, 85 to 93 MB above at the harness reading point). Read by the same method the difference splits into backend +18.5 MB, UI tree +18.4 MB (WebView2 with its GPU process against headless Chromium) and the shell's 4.2 MB. On equal terms this clause of T4 fires.
- A heavy session above 1.5 GB: **no.** The largest whole-tree working set of the 2 h soak is 705.8 MB (section 8) and the minimise hold peaked at 325.9 MB.
- The UI tree alone tops 350 MB idle: **no** (194 to 201 MB in every run), so the canvas backing stores are not the lead.

**The cap decision.** T4's response is to lower the caps and re-check the route times. An exploratory series at a 256 MiB bar cap (`NQT_CACHE_BYTES=268435456`, everything else the same, `D:/dev/w5c/explore-runs/idle-cache256`, gate 2.9, 2.7, 3.1%) read idle 494.1 MB (492.0 to 494.2) against 497.1 and 506.3 MB at 512 MiB: a difference inside the spread of the shipped-cap launches, because the bar cache holds little at HOME since the app stopped keeping the 1-minute year (W5C D1). A series with the prewarm off (`NQT_PREWARM=0`, `D:/dev/w5c/explore-runs/idle-noprewarm`) read 511.1 MB (500.7 to 511.9): without the prewarm HOME's own requests do the same work at the same moment. Lowering the caps therefore does not move the idle row, and the route times at the shipped caps are already re-checked (section 4). **Decision: the caps stay at 512 MiB (bars) and 128 MiB (files).** The profile showed that what filled the cache, not its size, was the cause: MON's two-day sparkline kept a whole 1-minute year per symbol in the bar cache. Commit `8122c87` removes that cost (the sparkline reads only its window in desktop mode) under roadmap trigger T4 (`docs/desktop/02_decision.md`, 6.5), which is the standard of decision 1.4 of `owner_decisions_windows.md`: meet a budget by removing the cost, not by moving the ceiling. With the cost gone a lower cap changes nothing measurable (494.1 MB at 256 MiB against 497.1 and 506.3 MB at 512 MiB), and a lower cap would only evict data the app still reads. The route times at the shipped caps are re-checked in section 4 (worst repeat 12 ms against 300 ms).

## 10. Correctness through the app

| Check | Result |
| --- | --- |
| `crosscheck.served` (`uv run --project terminal/qa python -m crosscheck.served`), the app-launched fixture backend of the new smoke build (`NQT_SMOKE_EXE`) | 8 of 8 routes equal: `runs_compare`, `ledger`, `bootstrap_hypothesis`, `bootstrap_run`, `deflated` and `spa` byte-equal; `two_day` and `seasonality_nq` equal before the gate block, with only `cached` and `reads_this_process` differing (as in W5B); `served: OK`, no window-watch failure |
| `smoke_real.ps1`, browser mode | First run: 16 passed, 2 failed, both on a refused Enter (`ZA_V0 DES` and `NQ GIP 2019-03-14` stayed in the command line marked invalid; `web/e2e/perf/pages.ts` `runLine` presses Enter once and waits 60 s for the line to clear, so an Enter that lands before the command index reaches the page is never repeated; the release check fixed the same race in `p11.spec.ts` only). Second run, nothing changed: **18 passed, smoke run passed**. Both runs: 67 new gate log lines, all caller `terminal` inside [2010-01-01, 2022-01-01), research files unchanged |
| `smoke_real.ps1 -Mode App` on the new smoke build | 5 passed, smoke run passed; the shell log shows a real, own-folders launch; the gate log lines all caller `terminal`, inside the fence |
| Gate log over the whole measuring | only caller `terminal` lines, none after 2021-12-31 (section 1) |

Logs: `D:/dev/w5c/measure-runs/chain2.log` (served, both first smoke runs) and `D:/dev/w5c/measure-runs/smoke-real-browser-2.log`. These runs were not made through `record_green.ps1`: the dated records must be made on the committed tree, because a commit changes the stamp.

## 11. Agreement of the two builds, and the pending list

| Test | State |
| --- | --- |
| Smoke against measure within noise: backend ready, cold HOME, idle memory | **Pending**: no measure run (port 8765 listening) |
| Backend ready, splash, cold HOME and idle memory on the measure artefact, real lab, 3 runs each; the very first launch after install on the measure build | **Pending**: port 8765 listening (decision 11); installed at `D:/dev/w5c/measure/app` |
| All-day soak at the shipped caps | **PARTIAL**: 2 h run (largest 705.8 MB), no harness record; the all-day run stays an owner check |
| Real minimise and restore, stream back within 30 s | Owner-attended (visible run) |
| First launch after a reboot | Owner-attended |
| Keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest | Owner-attended |
| T8 drift run | 14 of 14 (WebView2 154.0.4258.53) |
| Dated records and the release check | Not made here: they need the manager's commit (section 10) |

`node desktop/harness/report.mjs D:/dev/w5c/measure-runs --check`: exits 1 with six lines, none a defect of a measured row: the measure build has no reading for backend ready, splash, cold HOME and idle memory (port 8765 listening); the soak row has no reading on the smoke build (the harness record was not written); the real minimise has no reading (owner's visible run). It lists `idle_mem_home` on the smoke build as 505.4 MB (492.4 to 508.4), **over-ceiling**, and the simulated minimise as within ceiling (worst 0 ms against 30,000 ms). The rows are in `D:/dev/w5c/measure-runs/report.json`.

## 12. Findings for the manager (nothing in `terminal/` was changed by the measuring)

1. **Whole-app idle at HOME is 5.4 MB over its 500 MB ceiling on the pooled reading** (505.4 MB over six counted launches; 497.1 MB in the rows series alone, 506.3 MB in the first-launch series). Lowering the caps does not move it (256 MiB bars: 494.1 MB), because the bar cache holds little at HOME now. What does move it is time: the backend falls from about 297 MB to about 251 MB within some 10 s of HOME ready, when the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) finish, and the whole tree reads 453.8 MB by the browser comparator's 8 second settle and 388.6 MB after five minutes. The levers are a backend change that keeps those tasks' working memory out of the HOME window (or lowers their peak), or an owner decision on the reading point (the harness reads at HOME ready plus a 2.5 second idle check, the W0B point; the comparator reads after an 8 second settle). Neither was changed here.
2. **T4 on equal terms fires.** Against the browser terminal on equal terms (412.5 MB) the app is 41 MB higher by the same method: backend +18.5 MB, UI tree +18.4 MB (WebView2 with its GPU process against headless Chromium) and the shell's 4.2 MB. Against the default browser form (820.4 MB) it is about 320 MB lower. Which comparator governs the "no more than the browser terminal's HOME" condition is for the manager and the owner; this file reports both. Headless Chromium is also lighter than the headed browser the owner uses, so the equal-terms comparator is a strict one.
3. **A race in the real-data smoke's driver.** `web/e2e/perf/pages.ts` `runLine` presses Enter once and waits 60 s for the line to clear; an Enter that lands before the command index reaches the page is refused and never repeated (first browser-mode run: `ZA_V0 DES` and `NQ GIP 2019-03-14`). The release check fixed the same race in `p11.spec.ts` by waiting for the command preview; `runLine` needs the same wait. The second run passed 18 of 18.
4. **The installed measure exe is not byte-identical to its payload.** It differs in the 3-byte bundle-type marker (`NSS` installed, `UNK` in `payload/measure`), so a check that compares the installed exe with the payload hash fails on this build (W5B's pair was identical). Nothing measured depends on it; `build-release.ps1` should copy the payload after the bundler has marked the exe, or the check should compare with the marker masked.
5. **`report.mjs` pools every counted record under the folder it is given**, at any depth, so exploratory series must not sit under the evidence folder (they were moved to `D:/dev/w5c/explore-runs` before the final check).
6. **The soak harness did not write its record.** The first soak (`D:/dev/w5c/measure-runs/soak-aborted-2h`, outside sampler only, 24 samples from 09:13, first 606.3 MB, last 644.3 MB at 6,925 s) was cut short by the measuring session's own two-hour limit on a background command. The soak of record was started detached with `--hours 3` and stopped by the manager at 13:20 after 2 h 5 min, because 2 h was the planned length, so its harness record was not written either (the harness keeps its samples in memory until the end). The row rests on the external sampler (`soak-outside.jsonl`, 25 samples). The soak mode would be more robust if it appended each sample to its record as it is taken.
7. **Measure-artefact rows.** When 8765 is free, run `node desktop/harness/run.mjs --build measure --rows backend_ready,splash_painted,cold_home,idle_mem_home --runs 3 --real-data --measure-exe D:/dev/w5c/measure/app/nq-lab-terminal.exe` from `terminal` (the harness's lab guard checks the lab itself), then the smoke and measure agreement in `report.mjs`; the very first launch after install on the measure build needs the same free lab.
8. **The figures in the commit message of `8122c87` come from an earlier build of this tree and are not the measure of record.** Its spot readings (idle 451.6 MB median, first launch about 3,200 ms; `D:/dev/w5c/spot/rows-real`, three launches, taken at 05:51 to 05:54 on a build stamped `diffSha256` `7301e032...`) predate the build measured here (`diffSha256` `34046e26...`, built at 07:15). The tracked diff from `dd286fd` to `8122c87` hashes to `34046e26...`, the stamp of every record in this file, so the measured build is the committed tree. On it idle reads 505.4 MB, not 451.6 MB. The first-launch figure agrees (spot 3,201 ms median, measured 3,172.5 ms). Why the later build reads about 50 MB higher at the same reading point is not established here.

## 13. W5B against W5C

| Row | Ceiling | W5B (3 to 4 October) | W5C (4 October) |
| --- | ---: | ---: | ---: |
| Backend ready | 2,500 ms | 1,378 ms | 1,402 ms (rows), 1,413.5 ms (1,378 to 1,434) pooled |
| Splash | 1,000 ms | 308 ms | 313 ms |
| Cold HOME, first launch | 5,000 ms | **5,048 ms** (over) | 3,167 ms (rows), 3,172.5 ms (3,148 to 3,225) pooled |
| Cold HOME, usual launch | 5,000 ms | 3,321 ms | 2,750 ms |
| Warm HOME | 1,500 ms | 652 ms | 537.2 ms |
| EQ, warm, Enter unit, desktop caps (stage 1) | 1,500 ms | 628 ms | 653 ms |
| REG, warm, Enter unit, desktop caps (stage 1) | 1,500 ms | 427 ms | 452 ms |
| Eight routes, worst repeat, desktop caps | 300 ms | 73 ms | 12 ms |
| Grid open, 8,411 fills | 500 ms | 132 ms | 63.3 ms |
| GIP pan and zoom p95 | 25 ms | 6.4 ms | 6.0 ms |
| Keystroke to paint p95 | 100 ms | 8.2 ms | 8.3 ms |
| 20,000-point hop (17,097 points), warm median | 100 ms | 14.9 ms | 15.2 ms |
| Whole app idle at HOME | 500 MB | **1,082 MB** (over) | **497.1 MB** (rows), **505.4 MB (492.4 to 508.4)** pooled (over) |
| Browser terminal at HOME, same session | | 918 MB (year kept) | 820.4 MB (year kept); 412.5 MB (equal terms) |
| Soak, largest sample | 1,500 MB | **1,577.4 MB** (over, 3 h) | **705.8 MB** (within, 2 h, PARTIAL, external sampler; first sample 698.7 MB) |
| Simulated minimise, stream back | 30,000 ms | not tested | 0 ms, engine level |
| T8 | clean | 14 of 14 | 14 of 14 |
| Installer | 30 MB | 3.1 MB | 3.1 MB |

## 14. What changed in the world during the run

During the measuring nothing in `terminal/` was edited; the tree's stamp is the same in every record. The tools of this wave are outside the repository in `D:/dev/w5c/tools`: `t4t5.mjs` (a copy of the W5B tool with the output folder moved and an `app-home` mode added that reads the app by the browser method), `reinstall-measure.mjs` (the install), the read-only lab check, `chain1.sh`, `chain2.sh`, `explore.sh`, `soak-sampler.mjs` (the outside soak sampler) and `facts.mjs` (prints every figure above from the raw files into `D:/dev/w5c/measure-runs/facts.json`). C: free space 96,706 MB at the start and 96,693 MB after the timing rows; every output of this wave is on D:.
