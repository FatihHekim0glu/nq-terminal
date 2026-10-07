# desktop/harness: the measurement harness of the Windows shell

The T2 harness of stage 0, moved into the repository and adapted to the real shell (04 D5.1; 03 sections 15.4 and 18; 02 section 4).
It measures the rows of gate G2, writes one raw record per run, and reports medians with their ceiling verdicts. It is built here
and measured later, alone, in a quiet window (W5B). Node built-ins only; the window watch and the window helper are two small
Python scripts run by the lab's own interpreter. Everything it writes goes under `D:\dev\d5\runs`.

## What a number is

Every figure is written with its build, its method, the CPU load of the gate before the run and the provenance stamp (head, sha256
of `git diff HEAD`, sha256 of the sorted untracked files with their contents). Every slot record also carries the GPU reading (`gpu.atGate`, `gpu.afterRun`: utilisation and memory used, or unavailable). A record is one JSON file (schema `d5-run-1`), and
`report.mjs` recomputes everything from those files. Medians are of 3 accepted runs. A run whose 60 second CPU average is above 10%
is rejected and kept; after five rejections in a row a run is taken anyway and labelled PROVISIONAL, and the report keeps provisional
figures apart from accepted ones.

## Two methods, one set of rows

| Build | How it is read | What it can read |
|---|---|---|
| GNU `smoke` build | debugging port 0, the port read from `DevToolsActivePort`, attached over CDP; a page probe is injected before HOME's document exists | every row |
| `measure` build | no debugging port; the shell's own log (`<config>\logs\shell.log`) timestamps; memory from the performance counters of the whole process tree | backend ready, splash, cold HOME, idle memory |

| Row | Target | Ceiling | Builds |
|---|---:|---:|---|
| `backend_ready` | 1,500 ms | 2,500 ms | smoke, measure (spawn to `supervise_checked` in the log) |
| `splash_painted` | 500 ms | 1,000 ms | smoke (first contentful paint over CDP), measure (`page_finished` of the splash: the load event) |
| `cold_home` | 3,500 ms | 5,000 ms | smoke (the HOME ready mark), measure (`home_painted`: the shell's own first paint signal, polled every 500 ms) |
| `warm_home` | 1,000 ms | 1,500 ms | smoke (reload, ready mark since navigation start) |
| `eq_warm`, `reg_warm` | 1,000 ms | 1,500 ms | smoke, real data only (second run of the line) |
| `grid_open` | 100 ms | 500 ms | smoke (Fills tab click to the painted 8,411-row grid) |
| `gip_pan_zoom_p95` | 16.7 ms | 25 ms | smoke (CDP trace, DrawFrame intervals, the worse of zoom and pan, at 20,000 bars) |
| `keystroke_p95` | 50 ms | 100 ms | smoke (keydown to the second animation frame) |
| `idle_mem_home` | 400 MB | 500 MB | smoke, measure (private working set of the whole tree) |
| `soak_mem` | 1.0 GB | 1.5 GB | smoke, the soak runner, every 5 minutes at the shipped caps |
| `installer_mb` | 15 MB | 30 MB | the installer file |

A row passes only if every build it was measured on is within its ceiling; the smoke and measure medians of backend ready, cold
HOME and idle memory must also agree within noise (10% of each other, or overlapping ranges).

The `cold_home` ceiling of 5,000 ms is the one that passes or fails G2 (04 D5; register 1.1 in
`docs/desktop/owner_decisions_windows.md`). The 4,508 ms of the stage 1 record (`docs/desktop/stage1/stage1_numbers.md`) is a
regression reference only: the report may note a reading above it, but it does not fail a row.

Notes on what is synthetic. On a fixture backend the 8,411 fills are answered in the page (the same synthetic rows as the browser
budgets), and the GIP series is the real response tiled out to 20,000 bars with the timestamps running on (`bars.mjs`; the record says
`barsSynthetic`). The real-data run reads the real run with 8,411 fills and the real day, and rewrites only the bar count.

## The leak signal

The soak row is the largest whole-tree private working set, which a trim of the backend working set can lower without releasing committed memory. So the soak also judges the whole-tree private bytes on their own (`LEAK_RULE` in `lib/rows.mjs`): over the settled samples (from 900 s, at least 4 samples over at least 30 minutes) a straight-line fit must not climb faster than 30 MB an hour while growing 50 MB or more across the window. A series that grows fails the soak (exit 1, and `report.mjs --check --strict` exits 4) even when the working set is flat; a series too short to judge is `not-evaluated`, never a pass. The limits are provisional until the first all-day soak. The idle sample waits on evidence, not on a fixed offset (`lib/idle-trim.mjs`): the backend's private working set is read at HOME ready and from 66 s on (`idleQuietMs`, the floor) every 5 s, and the sample is taken once it has dropped by at least 30 MB and 10 % and the last two readings agree, or at the cap (`idleCapMs`, 120 s, which covers the record watch's last foreground request 16 s after it mounts). The `idle_mem_home` figure carries `trimSeen`, `trimDropSeen`, `trimCapped` and `trimWaitedMs`; a capped wait with no trim seen is a reading to distrust, not a pass. `trimSeen` means the backend's own trim ran, so the `memtrim` field decides it: false with `--memtrim off`, and with the trim on true when the working-set fall was seen. `trimDropSeen` is the raw fall, which the backend's own release after start-up also causes with the trim off (the working-set series alone cannot tell a trim from that release). `report.mjs` reads the `memtrim` field, so an older record with `trimSeen` true beside `memtrim` off reads as not seen, and it prints how many readings per build and memtrim state saw the trim run (`idleTrim` in the JSON report). The floor: the backend trims its working set 60 s after the last foreground request and looks every 5 s (`backend/nq_terminal/memtrim.py`), and a sample taken sooner reads the untrimmed set. The background polls (`/api/health`, `/api/commands`, `/api/audit/oos-log`) do not delay the trim; an open `/api/live/stream` or a queued or running job holds it off by design. Idle figures carry the tree's private bytes beside the working set (`privateBytesMB` on the `idle_mem_home` figure; the report prints both).

The backend also says what it did in its own log. Each trim writes one line to `backend.log` (`working set trimmed (REASON) in X ms; before A MB, after B MB`, `unavailable` where the working set could not be read), and the prewarm writes one line when it starts and one when it ends. A process that never set logging up would drop those at INFO, so `services/prewarm.py` (`ensure_log_lines`) gives the two loggers a stderr handler in that case; the shell drains stderr into `backend.log`. On a smoke build the launch record carries `backendLog` (`lib/idle-trim.mjs`, `parseBackendLog`): the trims with their working set before and after, and the prewarm's first start and last end. The measure build's log sits in the lab's own state folder and is left unread.

## Commands

```
node run.mjs --build smoke|measure|both [--rows all|id,id] [--runs 3] [--warmup 1] [--real-data] [--memtrim on|off] [--dry]
node run.mjs --mode reproduce [--runs 3] [--dry]
node run.mjs --mode minimise-sim [--hold-seconds 1800]     (30 to 60 minutes for the real reading)
node run.mjs --mode minimise-real [--hold-seconds 1800]    (screen 2 only, behind the guard)
node run.mjs --first-launch [--build measure|smoke] [--memtrim on|off]   (one command for the owner, after a reboot; the memtrim state is recorded as in the rows mode)
node run.mjs --mode t8 [--playwright]
node run.mjs --mode soak [--hours 8] [--real-data]
node run.mjs --mode installer [--installer FILE]
node run.mjs --mode parity [--runs 1] [--settle-s 6]   (fixture backend started as the shell starts it and the plain way, ports 8792 and 8791; fails above 5 MB private working set or on a thread count; no window)
node run.mjs --mode reliability --smoke-exe FILE [--runs 30] [--real-data] [--hold-ms 4000] [--proof-limit-ms 2000] [--dry]   (N hidden launches of a smoke exe: refusals and the READY-to-proof distribution)
node run.mjs --mode selftest [--only spin,screen2,planted,path] [--dry-modes | --dry-only a,b]
node report.mjs DIR [--min-runs 3] [--json] [--check [--strict]]
node --test "tests/*.test.mjs"
```

`--dry` takes one unmeasured run per mode: no gate is enforced, nothing is counted, and the record is `dry`. `--exe`, `--smoke-exe`
and `--measure-exe` name a build; without them the newest exe of the kind under `D:\dev\targets` is used, and a launch refuses an exe
that is another build (the smoke exe carries the `--attach-url` switch text, the measure exe `NQT_MEASURE_DIR`).

`--memtrim off` runs every launch of the invocation with `NQT_MEMTRIM=0` (the shell passes that name on to the backend, `PASSED_NQT` in `supervise_check.rs`), so the warm rows with and without the backend working-set trim can be compared; every figure records `memtrim` (`on` or `off`).

Measurements run from the main tree only (`--real-data` and every non-dry run refuse to start elsewhere). From a worktree only
`--dry` runs, on a derived lab (`lab.mjs`): the owner's venv launcher, a copy of the research package sources and junctions to the
tree under test, never to its `state` folder and never to a data folder.

## Launch reliability

`--mode reliability` runs N hidden launches of one smoke exe, one after the other, each with a fresh temporary state folder, and reports the refusals and the distribution of READY to the first identity proof. It exists for the start-up race of 0.2.0: the shell gives the backend's first identity proof `LINK_TIMEOUT` (2 s, `supervise_run.rs`) and refuses with `unverified` past it, so READY to proof is the margin against that refusal. Per launch it reads the shell log events (`supervise_spawned`, `supervise_checked`, `supervise_refused`, `supervise_failed`) and a 1 ms read-only tail of the backend log (`lib/tailog.py`: `NQT-READY`, the proof request, the first session read), and writes one record per launch plus `reliability-summary.json` under `--out`.

`--real-data` runs the real backend (the prewarm and scipy are what race the first proof; main tree only); without it the fixture backend runs, which has no prewarm, so its proof times say nothing about the race. `--dry` is one launch, from any tree. `--runs` defaults to 30; one start in 240 was refused on 0.1.2 and 0.2.0, so a refusal rate needs a few hundred launches (the median, p95 and max of READY to proof and the count at or over the limit say how close a short run came). `--proof-limit-ms` moves the limit the report counts against, for a shell that waits longer. The run exits 1 on any refusal or failure, any launch without an outcome, a window or foreground change the watch did not allow, a survivor after teardown, or a stop before the requested count. It takes no CPU gate: the figures are a distribution of a start-up race and the machine load is part of what is measured, so note the load beside the run. No launch starts while `D:/dev/locks/RECORDS_RUNNING` exists.

## Reproduction first

`--mode reproduce` launches the spike shell of stage 0 (`D:\dev\spikes\tauri-shell`) against the fixture backend on port 8800 and reads
the three figures of the T2 result again: memory at HOME, memory after the heavy set, launch to HOME ready (`reference\w0b-tauri.json`).
Each must be within 10% of the W0B median or inside its min to max range. The verdict is bound to the digest of the harness code; a
non-dry measurement needs a verdict that says reproduced, or it must be started with `--allow-unreproduced` and every figure is then
labelled UNREPRODUCED. Since D2 the backend is behind the session token, so the spike opens a launch page (a one-time code minted from the
backend's lock) that redeems it and leaves for the terminal: one extra hop that the W0B run did not have. The verdict also carries a
breakdown (spawn to the HOME document, HOME document to ready, first frame) so a difference can be placed before or after the page starts,
and the real backend alone is read for reference (`informational`).

## Safety

- Every spawn is hidden (`windowsHide`) with a PATH that has no `D:\dev\mingw` and no `D:\dev\cargo` (`paths.mjs`), no `WEBVIEW2_*`
  variable (the spike reproduction names its own) and TEMP on D:.
- The global window and foreground watch (`winwatch.py`: EnumWindows over every process every 100 ms, a WinEvent hook, and
  GetForegroundWindow) runs around every launch, and records each event's owner process and its ancestry. A new visible window
  or a change of foreground window fails the run when its process is the launched shell or under it (its WebView2 children);
  other programs' windows and foreground changes are kept as `notes` in the record (owner decision, 3 October 2026). An event
  whose owner was not traced fails, and so does every event of a watch that names no launched shell. The shell's own inert
  5 by 5 pixel event window is recorded and ignored. The notes name each foreign owner and whether it is on the named list
  (`KNOWN_FOREIGN` in `lib\winwatch.mjs`: the Logitech Options+ agent; `NQT_KNOWN_FOREIGN` adds image names for one PC, separated
  by semicolons). The list only labels the record; it never lets an event of the launched shell's tree pass. The cargo smoke tests
  apply the same rule (`src-tauri\tests\hidden_support\scope.rs`: the test process is the root).
- A window may be shown only in the screen-2 mode: the guard (`screen2.mjs`) takes the second monitor's work area and the window's DWM
  frame, refuses any rectangle that touches the primary monitor, and the watch then expects exactly that one window. SW_SHOWMINNOACTIVE
  and SW_SHOWNOACTIVATE are the only show commands, and only for a window of the shell's own pid.
- Teardown asks the window to close (WM_CLOSE) and then ends only processes recorded in this run's own tree with the same pid,
  creation time and image name. Never `taskkill /T`, never a bare pid.
- Port 8765 is refused everywhere. Ports used: 8800 and 9352 (the spike reproduction), 8797 (the standalone backend), 4373 (the T8 demo
  server); every smoke build takes debugging port 0.
- Python is only the lab's venv interpreter by full path, always with a script path.

## Minimise

`minimise-sim` hides the controller (put_IsVisible false) for the hold, with LIVE open and streaming, then shows it, and the stream must
read "live, server events" again within 30 s. The page must really report `hidden`, or the driver is named ineffective. Three drivers
are tried in turn: `controller-file` (a smoke-only hook in the shell that does not exist yet), `wm-size` (a WM_SIZE message; the engine
does not react to it), and `page-override` (the page's own visibility overridden over CDP; it only changes `document.visibilityState`, the app has no
visibility-driven stream logic and the engine is never hidden, so it is recorded as `engineLevel: false` and the run fails with
`NOT TESTED`, never a pass). `minimise-real` minimises and restores the shell's real window on
screen 2; the page stays `visible` while minimised in a smoke build, which is recorded as an observation.

## Files

| Path | Holds |
|---|---|
| `run.mjs`, `report.mjs` | the commands and the report with `--check` |
| `modes\` | `rows`, `reproduce`, `minimise`, `first-launch`, `t8`, `soak`, `installer`, `parity`, `reliability`, `selftest` |
| `lib\paths.mjs`, `build.mjs`, `lab.mjs`, `shell.mjs`, `launch-run.mjs` | folders and ports, build identity, derived labs, the launch, one launch and its rows |
| `lib\cdp.mjs`, `page-rows.mjs`, `pagejs.mjs`, `probe.js`, `trace.mjs`, `bars.mjs`, `fills.mjs`, `dockwait.mjs`, `heavy.mjs` | the page-internal rows |
| `lib\gate.mjs`, `gpu.mjs`, `slot.mjs`, `record.mjs`, `rows.mjs`, `stats.mjs`, `provenance.mjs`, `harness.mjs` | gate, slot, records, the G2 table, statistics, the stamp, the reproduction gate |
| `lib\winwatch.*`, `winctl.*`, `screen2.mjs`, `plantwin.py` | the window watch, the window helper and the screen-2 guard |
| `lib\mem.*`, `stop.mjs`, `survivors.mjs`, `proc.mjs`, `backend.mjs`, `shelllog.mjs` | memory counters, identity-checked teardown, processes, backends, the shell log (`shelllog.mjs` also reads `keys_installed` back: a measure run whose engine reads devtools, accelerator keys or zoom control as on is marked failed) |
| `lib\reliability.mjs`, `tailog.mjs`, `tailog.py` | the launch-reliability figures (outcome, READY to proof, summary) and the backend log tail |
| `reference\w0b-tauri.json` | the W0B figures the reproduction is judged against |
| `tests\` | `node --test` unit tests, each guard with a born-failing case |

`pagejs.mjs` and `probe.js` are the page scripts of the T2 harness (the screen wait, the pivot step and the HOME marks), unchanged.

## Where the memory sits (informational, not a row)

The idle and soak rows are unchanged: `idle_mem_home` is the private working set of the whole tree after HOME has settled, and
`soak_mem` is the largest sample of the soak. Beside them the records now carry figures that say where that memory sits and when the
soak peaked. None of them has a ceiling, none changes a row's rule, ceiling or reading point, and `report.mjs` labels each line
`informational, not the row`.

| Field | Record | Meaning |
|---|---|---|
| `idleBreakdown` | rows record, at the idle reading | `backendMB` (python, its launcher and console host), `uiTreeMB` (all WebView2 processes), `shellMB` (everything else, the shell executable) and `perType` (the UI tree by process type), in MB of private working set, from one read after the three idle samples; `null` when the tree could not be read, with the reason in the record's `idleBreakdownError` (also on stderr); `commandLineError` is added when the command-line lookup failed and the WebView2 processes were counted as `unknown` |
| `perType` keys | | `browser` (the WebView2 root, no `--type`), `renderer`, `gpu-process`, `utility-network`, `utility-storage`, `utility-other`, `crashpad`, `other`, and `unknown` when a command line could not be read |
| `uiOver350` | rows record | `true` when `uiTreeMB` is above 350 MB: the T4 clause of `02_decision.md` (look at canvas backing stores per panel) |
| `soak.firstSampleAtS`, `soak.startupPeakMB` | soak record | the time and the reading of the first sample, taken after the first workload round; the start-up peak |
| `soak.settledMaxMB` | soak record | the largest sample at 900 s or later; `null` when no sample reaches 900 s |
| `soak.privateBytesMinMB`, `soak.privateBytesMaxMB` | soak record | the range of the private bytes (commit charge, not part of the row) over the samples |
| `soak.breakdown` | soak record | `{ first, last }`: the breakdown of the first and of the last sample that has one, each with its `atS` |
| `soak.breakdownFailures`, `soak.breakdownError` | soak record | present only when a sample's breakdown read failed: how many samples, and the first reason |

A `null` breakdown means not read, never not over: `report.mjs` prints `idle breakdown not read in N of M runs` and `--check` fails with `T4 canvas clause not evaluated` while any counted run lacks it, so the T4 canvas clause is never recorded as clear without being measured.

`soak.maxMB` stays the largest sample and is still the row; the start-up peak and the settled maximum sit beside it and the owner
decides how the row reads. In the same way `libmem.mjs` exports `classifyTree(processes)` (pure: each process is
`{ pid, parent, name, commandLine, wsPrivate }` with the private working set in bytes; the three parts add up to `totalMB`) and
`memTreeBreakdown(rootPid)`, which reads the tree with `mem.ps1` and joins each process with its command line from one hidden
PowerShell query. The breakdown is read for information only: if it fails, the record keeps `null` and the run carries on.

## Known limits

- The harness measures; it does not decide G2. `report.mjs --check` fails when a row, a build's readings or a figure's provenance is missing, and
  `--strict` also fails on a ceiling or a disagreement between builds.
- The measure build has no debugging port, so its HOME ready is the shell's `home_painted` (first contentful paint of the backend's page, polled
  every 500 ms), not the moment the data is in. Its idle memory is read after a settle period.
- The real-data rows (`eq_warm`, `reg_warm`, the real fills run) and the first-launch reading need the main tree and the owner's lab.

## The real-lab guard (decision 11)

The measure build with `--real-data` (and `--first-launch`, which defaults to it) runs the lab's own backend on `terminal\state` with the job queue on. `lib/lab-guard.mjs` therefore reads, before each such launch and read only: a listener on 8765, `backend.lock` (live when an open that allows delete fails), `jobs.json` (sha256 and any queued or running job) and the file list of `backtests\output`. If a listener, a live lock or an active job is found, nothing is launched and the slot is written as a `pending` record that names the reason (the measure rows stay pending and the process rows are taken on the smoke build). After a launch the shell log must show `supervise_spawned` and no `supervise_attached`, `jobs.json` must hash the same, `backtests\output` must list the same files and the lock must be gone; anything else makes the run `failed` with the problems in its record (`labCheck`).
