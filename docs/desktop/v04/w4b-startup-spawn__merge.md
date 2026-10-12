# Wave w4b-startup-spawn: merge note

Branch `v04/w4b-startup-spawn`, worktree `E:/projects/nq-lab/wt-w4b`, base `9d2cd62` (origin/main with w0, w2b, then w2a merged), written 12 October 2026. The one slice (spawn-first) was read against its task and wired into the docs; the checks and the A/B followed. Nothing is committed: the manager makes the git writes. Every A/B reading below is PROVISIONAL: the PC was loaded by other waves and every gate reading was above the 10% limit (11.5% to 48.6%).

## What this merge wired

| File | Change | Why |
| --- | --- | --- |
| `desktop/src-tauri/src/supervise_shell.rs` | One string: the parse error of `show_page_server` read `--attach-url: ...` and now reads `page server address: ...` | a fix to a slice-owned file, see below |
| `docs/desktop/v04/w4b-startup-spawn__merge.md` | This note | merge_owns |

Wiring items 1 and 2 of the slice (the hook order in `desktop/README.md` and the `check spawn_offset` paragraph in `desktop/harness/README.md`) are NOT made in this tree: neither README is in the wave's `owns` or `merge_owns`, and the release check on `git status` allows no other file. The exact replacement text is in `docs/desktop/v04/w4b-startup-spawn__spawn-first.md`, section "Docs the change makes stale (for the manager)", ready to paste once the manager owns those files.

Wiring item 3 (the merge with wave w1 in `report.mjs` and `report.test.mjs`) needs no edit here: the slice's edits there only add things, and this worktree does not hold w1's changes. The manager's later merge keeps both. The check reads `milestones.spawnOffsetMs` from `lib/shelllog.mjs`, so if w1 lands an informational spawn-offset row beside it, both stay.

### The one fix to a slice-owned file

The full check failed in `test-default` and `test-measure` on `tests/smoke_feature_absent.rs`, `the_exe_has_no_debugging_port_and_no_test_switch`: "a non-smoke exe carries smoke-only strings: [\"--attach-url\"]". Cause: the slice moved the smoke page server's load into `show_page_server`, which is no longer behind `#[cfg(feature = "smoke")]` (it is reached from `Early::attach` in every build), and its error text named the switch. The release and measure exes then held a smoke-only needle. The fix makes the text `page server address: {e}`; behaviour is the same, the text is only seen on an address that `smoke_options.rs` has already checked, and no test or harness file reads the old text. The born-failing run is the first full check (two FAIL lines, the failing test and its message above); after the fix the same test passes in all three feature sets. `supervise_shell.rs` and `supervise.rs` were later trimmed under the 800-line ceiling, see "Release check after the QA fixes".

## What was inspected

- The slice's files were read against the spawn-first task: `main.rs` (the spawn starts after the settings read and before the window build), `supervise_shell.rs` (`begin`, `Early`, `Handoff`, `start_loop`, `eval_again`), `supervise_run.rs` (`health_check`, `supervise_ready` after `sink.ready`), `supervise.rs` (`supervise_create_process`), `lib/shelllog.mjs` and `report.mjs` (`check spawn_offset`).
- The slice's own open item stands: a close that arrives while WebView2 is still being built finds no supervisor and goes through without the backtest question. The backend is spawned but far from READY, so it cannot be running a job. Not covered by a test.

## Release checks

Logs: `D:/dev/v04/w4b-startup-spawn/` (`check.log` first run, `check2.log` second run, `e2e.log`, `ab_run.log`), the per-step logs under `D:/dev/tmp/check/20261012-013648/`. Target folder `D:/dev/targets/v04-w4b-merge-check`.

| Check | Result |
| --- | --- |
| `desktop/scripts/check.ps1 -TargetDir D:/dev/targets/v04-w4b-merge-check`, first run | 2 FAIL (`test-default`, `test-measure`: the `--attach-url` string above), everything else green |
| the same, second run after the fix | every step PASS (40 of 40): fmt, Clippy `-D warnings` on three feature sets, `cargo test` default 1,183 passed, smoke 1,354 passed, measure 1,196 passed, 0 failed; deny, deny-plant (64 of 64), lock-names, audit, advisories, dist-scan, scripts-tests (226), harness-tests (430), release-script tests, order-scan, look-css, module-scope, smoke-release-build, pe-info checks, loader-pin, manifest-warning, parity |
| `node --test desktop/harness/tests/*.test.mjs desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 686 tests, 685 pass, 1 skipped, 0 fail |
| `e2e:desktop` (the config run as `node node_modules/@playwright/test/cli.js test -c playwright.desktop.config.ts`, because `pnpm` refuses to run here: it wants to reinstall and stops on the jsdom engine range, node 24.13.1 against `^24.15.0`; it changed nothing) with this wave's smoke exe, PLAYWRIGHT slot | 42 passed, 1.3 min; the window watch spec passes (no window drawn, no foreground taken) |
| `gatecheck.py check --before .../gate_before.json --windows .../windows.jsonl` (snapshot taken before the first real run) | PASS: ledger, registry and `oos_openings.json` the same, log prefix intact, 1,504 lines appended, all caller `terminal`, 24 windows, 0 open |
| prose lint on the changed `.md` files, `web/src/copy/copyRules.test.ts` | the merge note and the slice note pass; `desktop/README.md` warns for 7 list triads, the same count `HEAD` has; `desktop/harness/README.md` passes; copyRules 5 of 5 pass |
| free space on C: | 424.7 GB at the first read, 434.9 GB when the first check began (other lanes freed space), 423.5 GB at the end: 1.2 GB below the first read; the builds and logs of this wave are on D:, so the fall is other lanes' |

## Release check after the QA fixes

Written 12 October 2026, 03:00 to 03:50 UTC, by the release-check agent. The QA fixers changed the slice's files after the first merge run, so every release check ran again on the final tree. Target folder `D:/dev/targets/w4b-startup-spawn` (the wave's warm one; the wave's check folder name would have meant a cold rebuild), step logs under `D:/dev/tmp/check/20261012-024542/`, scratch under `D:/dev/v04/w4b-startup-spawn/rc/`.

### Three failures found by the first run, each fixed at its cause

| Failure | Cause | Fix |
| --- | --- | --- |
| `fmt` (and the harness test `ci-rust-job.test.mjs`, which runs `cargo fmt --check`) | `tests/window_lab.rs`: the new `assert_never_spawned` line was longer than rustfmt allows | `cargo fmt` (one assert wrapped) |
| `test-default`, `test-smoke`, `test-measure`: `source_size`, "supervise.rs: 805 lines, supervise_shell.rs: 804 lines" | the QA fixes grew both files past the 800-line ceiling (`tests/source_size.rs`, programme rule 12) | `supervise_shell.rs`: the two `eval_again` calls now fit on one line each (792 lines). `supervise.rs`: the `supervise_create_returned` line moved into `create_process`, after `create_launch` returns, and lost its `ok` and `in_job_list` fields; the closure in `start_process` is back to its two lines (800 lines, at the ceiling and not over). The log line is still written once per `CreateProcessW` call, and the test that reads it (`supervise_spawn_early.rs`) reads only the event name |
| line ends | `tests/supervise_spawn_early.rs` had CRLF line ends on all 528 lines (the repository stores LF) | converted to LF |

The first run is the born-failing evidence for the size and format guards: both fail on the tree as the fixers left it and pass after the fixes. The greps for banned terms, for dashes and for CR bytes, run over all 15 changed files, found nothing else.

### Results on the final tree

| Check | Result |
| --- | --- |
| `desktop/scripts/check.ps1 -TargetDir D:/dev/targets/w4b-startup-spawn` | 42 steps, 0 failed: fmt, Clippy `-D warnings` on the default set, the smoke set and the measure set, `cargo test` default 1,192 passed, smoke 1,363 passed, measure 1,205 passed, 0 failed (ignored: 1, 3 and 3 in that order), deny, deny-plant 64 of 64, lock-names, audit, advisories, dist-scan, scripts-tests 226, harness-tests 440, the release-script tests, order-scan, look-css, module-scope, smoke-release-build, pe-info checks, loader pin, manifest warning, parity |
| `node --test desktop/harness/tests/*.test.mjs desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 696 tests, 695 pass, 1 skipped, 0 fail |
| `e2e:desktop` with the final smoke exe (sha256 `7be82058...dedfd4`, `D:/dev/v04/w4b-startup-spawn/cand-final/`), PLAYWRIGHT slot, run as `node node_modules/@playwright/test/cli.js test -c playwright.desktop.config.ts` | 42 passed on the third run. Runs one and two passed 41 tests and failed only the window-watch spec: another lane had the Arma Reforger Workbench open on this PC, and the watch saw its windows come and go (the foreground moved to that program, then to Idle with no owner traced). No window of this app's tree was named. The third run, with the Workbench windows quiet, was clean. Logs: `rc/e2e_final.log`, `rc/e2e_final2.log`, `rc/e2e_final3.log` |
| `gatecheck.py check` | PASS: ledger, registry and `oos_openings.json` the same, log prefix intact, 4,230 lines appended since the snapshot (2,773 inside this wave's windows, all caller `terminal`; 1,457 outside them, all `terminal` too and counted, not judged), 48 windows, 0 open |
| prose lint | this note and the slice note pass; `desktop/harness/README.md` passes; `desktop/README.md` warns for 7 list triads, the count `HEAD` has; `web/src/copy/copyRules.test.ts` 5 of 5 pass |
| free space on C: | 433,894 MB when the check began, 433,875 MB when it ended (19 MB lower); far above the 10 GB stop |
| `git status` against the owned paths | NOT clean in this run (four files); clean after release fix 2 |

### Files changed outside the slice's `owns` (fixed in release fix 2, below)

The run above left four files in `git status` that neither the slice's `owns` nor `merge_owns` names: `desktop/README.md`, `desktop/harness/README.md`, `tests/setup_refused.rs` and `tests/window_lab.rs`. Release fix 2 removed all four from the tree, see "Release fix 2".

## A/B against 0.3.3 (interleaved, PROVISIONAL)

Method: `D:/dev/v04/tools/ab.mjs`, 0.3.3 smoke exe (`D:/dev/release/0.3.3/payload/smoke`) over `D:/dev/ablab033` (side `base033`) against this wave's release-profile smoke exe (sha256 `6ab6d5da574e2626...3d95`, copied to `D:/dev/v04/w4b-startup-spawn/cand/`) over `D:/dev/ablabw4b` (side `candw4b`, its terminal a junction to this worktree). One warmup launch per side and phase, then 5 measured launches each, the order alternating each round, first launches in fresh run folders and usual launches in a reused one. Both backends report 0.3.3 and the side check passed for every counted record. HEAVY slot held throughout; every launch hidden under the global window watch. Records: `D:/dev/v04/measure/w4b-startup-spawn/ab/`, windows in `windows.jsonl` (24 start and end pairs), summary in `ab_summary.txt`, per-launch shell-log milestones in `spawn_offsets_all.txt` (script `D:/dev/v04/w4b-startup-spawn/spawn_offsets.mjs`).

CPU gate readings, all over the 10% limit (so all counted launches are PROVISIONAL): first base 12.5 to 28.3%, first candidate 12.1 to 18.4%, usual base 11.5 to 48.6%, usual candidate 16.8 to 32.2%.

| Reading (median, ms) | 0.3.3 | this wave | Difference |
| --- | ---: | ---: | ---: |
| spawn offset, first launches (start line to `supervise_spawned`; n = 5 each) | 282 | 20 | -262 |
| spawn offset, usual launches (n = 5 each) | 378 | 21 | -357 |
| spawn offset, all 10 each | 322.5 | 19.5 | -303 |
| backend ready, first (record row, n = 4 and 5) | 1,624 | 1,447 | -177 |
| backend ready, usual (shell-log `supervise_checked`, n = 5) | 1,920 | 1,528 | -392 |
| cold home, first | 3,612 | 3,462 | -150 |
| cold home, usual | 3,211 | 2,867 | -344 |
| splash painted, first | 370.8 | 438.3 | +67.5 |
| splash painted, usual | 449.3 | 484.9 | +35.6 |

Spawn offsets of the 10 candidate launches (ms): 19, 19, 20, 119, 133 (first), 18, 18, 21, 112, 257 (usual). Median 19.5, 9 of 10 within the 150 ms ceiling and 8 of 10 within the 120 ms target. One launch is over the ceiling: usual launch 3, at 257 ms, with its `supervise_create_process` line at 7 ms, so the 250 ms went into `CreateProcessW` while the UI thread built WebView2 (gate 16.8 to 32.2% in that phase). The slice's own ten launches had a worst case of 132 ms and none over; under a heavier load one in ten went past. The exit criterion needs five gated launches on a quiet machine, so it is not met or failed by these readings: the ceiling breach was found with the ad hoc `spawn_offsets.mjs`, not with `report.mjs`. `report.mjs --check --strict` has not run on these records: the A/B records have modes `ab-first` and `ab-usual`, which are not in `G2_LAUNCH_MODES` (`spawnOffsetCheck` would say `missing`), and they carry no `milestones.spawnOffsetMs` because `ab.mjs` loads the pre-wave harness. So the 150 ms check has so far been exercised only by its unit test. The post-merge step is to run `report.mjs --check --strict` once on a rows-mode folder of real launch records, after the spawn-offset reading from the shell log is fixed; on a gated run a launch over 150 ms (exit 4) is the correct outcome and is why the gated rerun matters. The 190 to 235 ms gap is NOT yet placed, and this A/B does not place it. The gap was defined as `supervise_spawned` coming 190 to 235 ms after WebView2 was built (`keys_installed`). In this A/B the 0.3.3 base logs `supervise_spawned` only 20 to 25 ms after `keys_installed` in all 5 first launches (21 to 54 ms with the warmup), so that gap did not reproduce in the old order; "the base never goes below 235 ms" is measured from the start line, not from the window build, and places nothing. Where a delay does show on the base (usual launches 2 to 4: between 103 ms and 135 ms after `keys_installed`) it looks like the candidate's intermittent stall: `supervise_create_process` at 7 to 12 ms but `supervise_spawned` at 112 to 257 ms in 4 of 10 launches (119 ms and 133 ms in the first group; 112 ms and 257 ms in the usual group). That stall lives inside `CreateProcessW` (or what follows it before the line), the reorder does not remove it, and it is what put one launch over 150 ms, so the gated exit-criterion rerun is at risk from it. Open for the gated rerun: the new `supervise_create_returned` line (logged the moment `CreateProcessW` returns, before any resume step) separates `CreateProcessW` from the rest; correlate the slow launches with `msedgewebview2.exe` process starts and Defender scan time (ETW process-start events, gated launches); and consider starting the spawn before `tauri::Builder::run` (in `main`, after the policy check and the settings read) so `CreateProcessW` finishes before WebView2 starts its own processes.

The splash paints 35 to 68 ms later with the candidate. The two builds differ in what the UI thread competes with (the spawn now overlaps the window build), and the difference is inside the spread (candidate first 345 to 728 ms). It is a figure to watch on the gated rerun, not a finding.

What the readings do not show:

- One base launch (first, slot 5) was rejected by the window watch (`window-fail`): a 6 by 6 `Tao Thread Event Target` helper window was enumerated at its creation, off screen at -1320. No window was drawn on screen 1. It is the 0.3.3 exe, so it is not caused by this change; the base first group therefore counts 4 launches, not 5. The candidate had no window event in 12 launches.
- The `backend_ready` row of the usual phase in `ab.mjs summary` reads -454,848 ms (base) and -516,068 ms (candidate): the usual run folder keeps one `shell.log` across launches and the reader takes the first `start` line of the whole file as the origin. The figures above for usual `backend_ready` come from each launch's own `start` line (`spawn_offsets.mjs`). The `cold_home` and `splash_painted` rows of the usual phase look sane and are used as printed. This is a defect of `ab.mjs` (a V04 tool, not edited here).
- Nothing here is the exit criterion for "backend ready 1,500 ms or less": candidate first launches read 1,447 (record) and 1,423 (shell-log median of 5), usual 1,528, all over the 10% CPU gate.

## Second A/B on the final build (interleaved, PROVISIONAL)

Same method and labs as above, run again because the final tree differs from the exe of the first A/B (sha256 `6ab6d5da...3d95`): the final release-profile smoke exe (`cand-final/`, sha256 `7be82058...dedfd4`) over `D:/dev/ablabw4b` against the 0.3.3 smoke exe over `D:/dev/ablab033`, one warmup then 5 measured launches per side and phase, order alternating, HEAVY slot held, every launch hidden under the global window watch (no launch was rejected for a window event; all 20 counted records are PROVISIONAL, gate readings 11.9 to 26.6%). Records in `D:/dev/v04/measure/w4b-startup-spawn/ab-final/`, summary `ab_summary_final.txt`, per-launch lines in `spawn_offsets_final.txt`; windows appended to `windows.jsonl` (24 more pairs).

| Reading (median, ms) | 0.3.3 first | this wave first | 0.3.3 usual | this wave usual |
| --- | ---: | ---: | ---: | ---: |
| spawn offset (start line to `supervise_spawned`) | 397 | 152 | 443 | 140 |
| WebView2 built (`keys_installed` after start) | 244 | 482 | 233 | 416 |
| backend ready (shell-log `supervise_checked` after start) | 1,812 | 1,754 | 1,891 | 1,685 |
| cold home | 3,874 | 3,813 | 3,065 | 3,063 |
| splash painted | 363.9 | 653 | 328.9 | 635.1 |

Spawn offsets of the 10 candidate launches (ms): 152, 230, 186, 140, 18 (first) and 152, 140, 136, 159, 17 (usual). Median 146, 5 of 10 over the 150 ms ceiling, 8 of 10 over the 120 ms target. This does NOT reproduce the first A/B (median 19.5, one launch over). The time sits inside the call: `supervise_create_process` came at 8 to 15 ms in every launch, and `supervise_create_returned` (the final-build line) came at 134 to 227 ms in eight of the ten measured launches and at 15 and 17 ms in the two quiet ones. So the stall is inside `CreateProcessW`, as the earlier launches showed. A reading of the PC's CPU during this write-up gave 41 to 46% with other lanes building, and the same call timed outside the app (venv python, suspended, hidden, 60 launches at 64% CPU) gave 33 launches at 3 to 25 ms and 27 over 50 ms, up to 570 ms; `whoami.exe` at 88% CPU gave 15 of 40 over 100 ms and a worst case of 1,966 ms. So a slow `CreateProcessW` exists on this PC under load without WebView2 in the process, and no reorder inside `main.rs` removes it. It is not shown that WebView2 plays no part: in the same eight slow launches the WebView2 build was also slow (`keys_installed` at 407 to 580 ms against 220 to 375 ms for the 0.3.3 launches beside them), and the splash paints about 300 ms later with the candidate (a 35 to 68 ms difference in the first A/B). The two things move together; this A/B cannot say which causes which, or whether a process scan slows both. Backend ready is 58 ms and 206 ms better in the shell-log medians and cold home is level, so the net effect on the rows is small under this load.

What follows from it: exit criterion 1 is unverified, and the splash figure is a watch item for the gated rerun (candidate 653 ms and 635 ms against the 500 ms target and 1,000 ms ceiling, PROVISIONAL). If the gated run still shows a launch over 150 ms, take an ETW trace of its process creation before moving the spawn ahead of `tauri::Builder`.

## Release fix 2

Written 12 October 2026, 04:30 to 06:30 UTC, by the release-fix agent. Two failures were handed back: four files in `git status` outside the owned paths, and exit criterion 1 not met by anything measured. Logs and scratch under `D:/dev/v04/w4b-startup-spawn/rc2/`, step logs under `D:/dev/tmp/check/20261012-054706/`, target folder `D:/dev/targets/w4b-startup-spawn`.

### Failure 1: files outside `owns` (fixed at its cause)

The cause was that the docs and the guard tests the change needs sit in files the spec's `owns` omits. Fixed without a git write and without a change to the spec:

| File | Action | Where its content went |
| --- | --- | --- |
| `desktop/README.md`, `desktop/harness/README.md` | restored to `HEAD` byte for byte (`git show HEAD:path > path`) | the two edits to paste are written out in `docs/desktop/v04/w4b-startup-spawn__spawn-first.md`, section "Docs the change makes stale (for the manager)" |
| `tests/setup_refused.rs`, `tests/window_lab.rs` | restored to `HEAD` the same way | one test in `tests/supervise_spawn_early.rs`: `refused_lab::a_lab_the_lab_check_refuses_is_never_spawned` |

The new test starts the hidden smoke exe on a fake lab three times, each time with one required lab file taken away, under the global window watch. Each start must exit with the run code, log `lab_refused` naming that file, log none of `supervise_thread_began`, `supervise_create_process` and `supervise_spawned`, and fail with the lab check's error, not the supervisor's "has no .venv". It is compiled into the smoke set only.

Born failing: with `lab_may_start` in `main.rs` mutated to allow every lab, the test fails on the first lab (`.venv\Scripts\python.exe: no lab_refused`; the error is "refused: ... has no .venv\Scripts\python.exe", the supervisor's own). With the guard restored it passes, and `supervise_spawn_early` passes 79 of 79 in the smoke set (`rc2/guard.log`). `main.rs` was byte-compared with its saved copy after the mutation.

One more failure came from the move and was fixed at its cause: the first check run after it failed `clippy-smoke` ("file is loaded as a module multiple times: tests\hidden_support\scope.rs"), because the window harness the new test includes and `supervise_support.rs` both load that file by path. The module carries `#[allow(clippy::duplicate_mod, reason = ...)]`, as `supervise_shell.rs` does for its shared script. Clippy on the smoke set is clean after it. `git status` now lists only owned paths (below).

### Failure 2: exit criterion 1, with evidence

The criterion needs a PC under the 10% CPU gate. No reading this session was under 10% (gate 14.3 to 41.3% in every launch below, other lanes building on the same PC), so every figure is PROVISIONAL and the criterion can be neither passed nor failed on a gated reading. What was done instead:

1. **The check that enforces it was run on real launches.** `D:/dev/v04/w4b-startup-spawn/rc2/convert.mjs` turns the measured launch records of the third A/B into rows-mode and first-launch records whose milestones come from this tree's `lib/shelllog.mjs` (each launch's own start line, so the reused usual folder reads correctly), and `report.mjs` reads them. For the second A/B's launches (the same exe), `check spawn_offset` printed `over-ceiling PROVISIONAL (median 146 ms, worst 230 ms over 10 launch(es); target 120, ceiling 150)` for the candidate and `median 397.5 ms, worst 581 ms` for 0.3.3, with 5 and 10 failures named per launch (`spawnOffsetFailures`, which `--check --strict` turns into exit 4). The CLI itself exits 1 on such a folder because the other rows have no readings, so the failure path was read through the exported functions (`rc2/fail.mjs`).
2. **A third interleaved A/B on the final tree** (`rc2/run_ab_final2.sh`; the same exe as the second A/B, sha256 `7be82058...`; records in `D:/dev/v04/measure/w4b-startup-spawn/ab-final2/`, per-launch lines in `spawn_offsets_final2.txt`). One warmup then 5 measured launches per side and phase, order alternating, HEAVY slot, every launch hidden under the window watch. Two launches (one per side) were marked `window-fail` for the same reason: a 5 by 5 inert `Tao Thread Event Target` helper window of the app's own tree, off screen, enumerated at its creation. It happens on 0.3.3 as well, so it is not caused by this change; their shell logs are counted below.

| Reading (median, ms), gate 15.3 to 41.3% | 0.3.3 first | this wave first | 0.3.3 usual | this wave usual |
| --- | ---: | ---: | ---: | ---: |
| spawn offset, start line to `supervise_spawned` (n = 5 each) | 351 | 133 | 449 | 184 |
| WebView2 built (`keys_installed`) | 265 | 473 | 248 | 478 |
| backend ready (`supervise_checked`) | 1,858 | 1,739 | 2,198 | 1,847 |
| cold home (record rows) | 4,115 | 3,895 | 3,434 | 3,339 |
| splash painted (record rows) | 394.9 | 654.1 | 381.4 | 805 |

Candidate offsets (ms): 1,024, 24, 161, 133, 19 (first) and 141, 184, 187, 17, 1,037 (usual). Median of all 10: 151 ms, 5 of 10 over 150 ms, 8 of 10 over 120 ms. 0.3.3 offsets: first 351, 288, 438, 441, 315; usual 266, 578, 371, 449, 479 (median 404.5, all 10 over 150 ms). The two candidate launches at 1,024 and 1,037 ms are whole-process stalls (`keys_installed` at 1,245 and 2,132 ms in the same launches). Across the A/Bs of the final tree the candidate's offsets fall into two groups, 16 to 25 ms and 130 to 310 ms (three whole-process stalls of 700 to 1,040 ms aside), and the second group is the larger whenever the gate read above about 20%.

3. **The 190 to 235 ms gap is placed.** In the same A/B the 0.3.3 order logs `supervise_spawned` 125 to 262 ms after `keys_installed` in 8 of its 12 launches (first: 247, 125, 23, 190, 169, 29; usual: 21, 18, 262, 137, 188, 241), the "190 to 235 ms" of the research. The candidate's new lines show where a stall of that size sits: `supervise_thread_began` at 3 to 7 ms, `supervise_create_process` at 7 to 14 ms, and the rest inside `CreateProcessW` (`supervise_create_returned` came at 134 to 227 ms in the second A/B's slow launches). So the gap is one stall inside `CreateProcessW`, about 130 to 260 ms on a loaded PC and about 10 to 20 ms on a quiet one. It was there in the old order and is still there. This change moves it so that it overlaps WebView2's build instead of following it (offset median 404.5 to 151 ms, backend ready 120 to 350 ms earlier); it does not remove it. Defender real-time protection is on (`Get-MpComputerStatus`); its exclusions are not readable without administrator rights, so the scan is a suspect, not a finding. The out-of-app control of the second A/B (a suspended hidden python and `whoami.exe` under load, stalls up to 570 and 1,966 ms) says the stall exists without WebView2 in the process.
4. **One experiment on whether WebView2 contention causes the stall: not shown.** A build of this tree with a 50 ms sleep after `supervise::begin` (`cand-exp/`, temporary; `main.rs` restored and byte-compared) gave the spawn a 50 ms head start before the window build. Interleaved against the unchanged exe (`rc2/run_ab_exp.sh`, records in `ab-exp/`, gate 14.3 to 41.2%): head start first 200, 180, 187, 311, 210 (median 200), usual 250, 16, 259, 224, 23; unchanged first 702, 175, 188, 190, 221, usual 246, 272, 222, 24, 22. The stall stayed at 175 to 311 ms with the head start, so a short head start does not remove it and the change was not kept. A barrier that holds the window build until `CreateProcessW` returns would test the contention idea fully; it would delay the splash by the length of the stall, so it was not made without an owner decision.

Verdict on criterion 1: NOT VERIFIED and NOT MET by any reading under load (medians of 146 ms, 151 ms and about 205 ms in the three loaded runs; 19.5 ms and 8 of 10 within 120 ms in the first A/B, whose gate read 12.1 to 48.6%). It stays open for a gated run on a quiet PC, with the `supervise_create_returned` line and an ETW process trace ready for any launch over 150 ms.

The splash is the cost to watch: 654 and 805 ms against 395 and 381 ms for 0.3.3 in this run (target 500 ms, ceiling 1,000 ms; PROVISIONAL, the same direction as the earlier A/Bs but larger under this load).

### Release checks after release fix 2 (final tree)

| Check | Result |
| --- | --- |
| `desktop/scripts/check.ps1 -TargetDir D:/dev/targets/w4b-startup-spawn`, first run | 40 steps, 4 failed: `clippy-smoke` (the duplicate-module lint above, fixed) and three timing tests on a loaded PC: `test-default` `supervise_tool` `a_tool_that_outlives_its_limit_is_stopped_and_the_run_says_so` (the 3 s tool limit passed before the tool printed), `test-measure` `supervise_swap` `a_swapped_backend_is_seen_by_the_exit_watch_refused_and_never_given_the_token` ("timed out waiting for the exit watch"), `test-smoke` `hidden_window` `smoke_build_stays_hidden_through_home_and_close` (the foreground moved to a window with no owner while another lane had the Arma Reforger Workbench open) |
| the same, second run | 40 steps, 0 failed (the two `pytest-wait` steps only appear when the pytest lock is held): fmt, Clippy `-D warnings` on each of the three feature sets, `cargo test` default 1,192 passed, smoke 1,366 passed, measure 1,205 passed, 0 failed (ignored: 1 default, 3 smoke, 3 measure), deny, deny-plant 64 of 64, lock-names, audit, advisories, dist-scan, scripts-tests 226, harness-tests 440, release-script tests, order-scan, look-css, module-scope, smoke-release-build, pe-info checks, loader pin, manifest warning, parity. The smoke count is 3 above the last run: the new test and the 2 self-check tests of `window_harness.rs`, which now run inside `supervise_spawn_early`. The three timing tests passed on this run with no code change |
| `node --test desktop/harness/tests/*.test.mjs desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 696 tests, 695 pass, 1 skipped, 0 fail |
| `e2e:desktop` (run as `node node_modules/@playwright/test/cli.js test -c playwright.desktop.config.ts`; `pnpm` still refuses on this node), PLAYWRIGHT slot, with the exe the second check built (`cand-fix2/`, sha256 `0e8361cf...`; the build is not byte-reproducible, same source and size as the exe of the A/Bs) | 42 passed on the sixth run, window watch clean. Runs 1 and 5 failed only the watch spec, on another lane's Workbench window (a window drawn and the foreground moved, owner not traced). Runs 2 and 3 also failed `90-look` "LIVE with the dropdown open" on a console error, a 412 on `/api/workspaces/watch`. That 412 is not new and not this change: three runs with the 0.3.3 smoke exe over the same tree gave 40, then 41, then 42 passed, the first with the same dropdown failure and the same 412. A run with the A/B exe (`cand-final`) also passed 42 |
| `gatecheck.py check --before .../gate_before.json --windows .../windows.jsonl` | PASS: the ledger and the registry and `oos_openings.json` the same, log prefix intact, 6,486 lines appended since the snapshot (5,029 inside this wave's windows, 1,457 outside, all caller `terminal`), 96 windows, 0 open |
| prose lint (`ai_pattern_check.py`) on the merge note and the slice note; `web/src/copy/copyRules.test.ts` | both notes PASS; copyRules 5 of 5 |
| greps over the 11 changed files: banned terms; em dashes; en dashes; CR bytes | none |
| free space on C: | 434,699 MB at the start of this fix, 434,195 MB at its end (504 MB lower; nothing of this fix is written on C:, its temp and targets are on D:, so the fall is other lanes'); far above the 10 GB stop |
| `git status` against the owned paths | clean: the eight slice source and harness files, `tests/supervise_spawn_early.rs`, and the two notes; no other path |

## Release fix 3

Written 12 October 2026, from 05:30 UTC, by the release-fix agent. Three failures were handed back: exit criterion 1 not met by any reading and not gateable on this PC, three timing and foreign-window failures of the first check run of fix 2, and the e2e runs lost to another lane's windows and a 412. No source file changed in this fix: the tree is the one fix 2 left (the smoke release exe the check built is byte-identical to the one the earlier runs used, sha256 `0e8361cf20e24478...`). Logs and scratch under `D:/dev/v04/w4b-startup-spawn/rc3/`, step logs under `D:/dev/tmp/check/20261012-071341/`, `-072658/` and `-075319/`, target folder `D:/dev/targets/w4b-startup-spawn`.

### Failure 1: exit criterion 1, now with gated readings

The cause named in fix 2 stands: a stall inside `CreateProcessW` that depends on what else the PC is doing. What was missing was a gated reading, so one was taken by retrying the gate instead of running at once. `rc3/run_gated.sh` and `rc3/run_gated2.sh` call `ab.mjs launch` for the candidate only (first launches, fresh run folders, `--max-rejects 1000` so a launch the CPU gate rejects is not forced), one slot at a time, and try again after a rejection. HEAVY slot held, every launch hidden under the window watch (clean in all five), windows appended to `windows.jsonl`. The gate is the harness's own: the machine's CPU averaged over 60 s at 10% or less. It took 57 gate readings (about an hour) to get five launches: 52 readings were rejected (10.2 to 29.8%). Records in `D:/dev/v04/measure/w4b-startup-spawn/ab-fix3-gated/` (slots 1 to 3) and `ab-fix3-gated2/` (slots 4 and 5).

| Slot | Gate average (max) % | Spawn offset ms | `supervise_create_process` | `supervise_create_returned` | WebView2 built (`keys_installed`) | Splash painted ms | Backend ready ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 8.0 (21.7) | 52 | 15 | 51 | 379 | 456 | 1,452 |
| 2 | 5.9 (17.8) | 22 | 11 | 21 | 257 | 390 | 1,268 |
| 3 | 7.2 (19.1) | 18 | 10 | 16 | 231 | 436 | 1,353 |
| 4 | 8.5 (16.6) | 365 | 11 | 364 | 433 | 723 | 2,297 |
| 5 | 9.0 (26.5) | 293 | 10 | 291 | 816 | 884 | 2,040 |

Median spawn offset 52 ms (target 120 ms or less: met). Two of five launches are over the 150 ms ceiling (365 and 293 ms): the criterion "none over 150 ms" is NOT met, even on gate averages under 10%. The report check agrees: `report.mjs --check --strict` on these five records (converted with `rc2/convert.mjs` into `first-launch` records, `--min-runs 5`) prints `check spawn_offset: over-ceiling ACCEPTED (median 52 ms, worst 365 ms over 5 launch(es); target 120, ceiling 150)`. This is the first time the check has run on gated records and it fails the launches it should.

What the five show about the cause:

- In both slow launches the whole delay is inside the call: the line before `CreateProcessW` is at 10 and 11 ms, the line after it at 291 and 364 ms. The fast launches spend 36 ms (slot 1), 11 ms (slot 2) and 6 ms (slot 3) in the call (`supervise_create_returned` less `supervise_create_process`).
- WebView2 is not the cause in launch 4: `keys_installed` came at 433 ms, normal, while `CreateProcessW` took 353 ms. In launch 5 both were slow (816 ms), which fits a busy PC. So the earlier idea that the window build and the spawn contend is not supported here, and the barrier that would hold the window build until the spawn returns would only delay the splash.
- Both slow launches came at the top of the gate band (8.5 and 9.0%, against 5.9 to 8.0% for the fast ones), and the last gate samples before them rose to 11 to 17%. The fast launches are 18 to 52 ms, the slow ones 290 to 365 ms; nothing lies between 52 and 290 ms. That is the same two-group shape as the loaded A/Bs, and it stays a stall of the operating system's process creation (Defender real-time protection is on and its exclusions are not readable without administrator rights, so the scan is a suspect, not a finding).
- Nothing in this tree can remove it: the call is one `CreateProcessW` with the same arguments in the old and the new order, the stall also showed in the out-of-app control of fix 2 (no WebView2 in the process), and the 50 ms head start of fix 2 did not shorten it. No code change was made for it.
- The costs on the gated launches: splash painted 456, 390, 436 ms in the three quiet launches (target 500 ms), 723 and 884 ms in the two slow ones; backend ready 1,268 to 1,452 ms in the quiet launches (1,500 ms target) and 2,040 and 2,297 ms in the slow ones.

Verdict on criterion 1: the median target is met on gated launches (52 ms), and 3 of 5 launches are 18 to 52 ms; the ceiling is not met (2 of 5 over 150 ms). It cannot be closed on this PC. To close it the PC has to be quiet for the launch itself, not only for the 60 s average before it, or the stall has to be traced (an ETW trace of process creation in a slow launch, or Defender's scan log, both need administrator rights). A decision for the owner: exclude the lab's `.venv\Scripts` folder from real-time scanning, or accept a ceiling that allows the stall.

### Failure 2: timing and foreign-window failures of the check

The tests that failed in fix 2 are `supervise_tool` (a 3 s tool limit that has to pass after the tool printed), `supervise_swap` (a 1 s budget for the exit watch) and `hidden_window` (the foreground moved to a window with no owner). None is a file of this wave's `owns`, so none can be edited here, and the check must list nothing else. Fixed at the cause as far as the wave's files allow: the cause was shown, not guessed, with a flake-rate comparison against the pre-wave tree.

- A copy of `HEAD` (`git archive HEAD`, into `D:/dev/tmp/w4b-headcopy`, target `D:/dev/targets/w4b-headcopy`) and this tree ran the same two test binaries, interleaved, 20 times each, on the same loaded PC (`rc3/compare2.sh`, HEAVY slot): `supervise_swap` failed 2 of 20 on `HEAD` and 3 of 20 on this tree, with the same panic ("timed out waiting for the exit watch", plus once a window watch event on `HEAD`); `supervise_tool` failed 0 of 20 on `HEAD` and 1 of 20 on this tree ("the tool printed pid=", the 3 s limit passed first). The difference is inside the noise, so the flakes are in the tests' fixed budgets and not in this change. `supervise_swap` does not run the shell's handoff at all: it drives `run::run` with a recording sink that answers at once.
- `close_relay_seam` (this fix's first check run failed `one_close_sent_the_dotnet_way_ends_the_app_through_its_own_close` on "foreground changed to" an unowned window, with the owner's Arma Reforger running and its window ignored as foreign) passed 6 of 6 in a row on its own (`rc3/stress.sh`). The signature is the one of `hidden_window` in fix 2 and of the window watch spec in the e2e runs: a foreground change to no window, caused by the other program, not by this app.
- The check had to be run three times on this fix. Run 1 (`-071341`): 1 failed of 40, `test-smoke` (`close_relay_seam`, above). Run 2 (`-072658`): 3 failed, `supervise_swap` in all three feature sets (the 1 s exit-watch budget, three times in a row on a busy PC). Run 3 (`-075319`): 40 steps, 0 failed, with no code change between the runs.
- Proposed edits for the manager, which owns those files (not made here): in `tests/supervise_swap.rs` raise `WATCH_BUDGET` from 1 s to 10 s (the test measures that the exit is seen, not how fast); in `tests/supervise_tool.rs` give the 3 s tool limit of `a_tool_that_outlives_its_limit_is_stopped_and_the_run_says_so` a margin (10 s, with the `took` bound at 40 s); and let the shared window watch (`tests/hidden_support/scope.rs`) ignore a foreground change to a window with no process while a foreign program is on screen. None of these touches the shell.

### Failure 3: e2e

The two causes are not in this tree and cannot be fixed from its owned files: the window watch spec fails when another lane's program (here Arma Reforger and its Workbench) draws or takes the foreground during the run, and `90-look` "LIVE with the dropdown open" fails on a 412 from `/api/workspaces/watch` that 0.3.3 shows as well (fix 2: three runs of the 0.3.3 smoke exe gave 40 passed, then 41, then 42). This fix ran the suite on the final exe twice: run 1 passed 41 and failed only that `90-look` case on the same 412; run 2 passed all 42, with the window watch spec among them and clean. The PLAYWRIGHT slot was held by another wave's merge for about 50 minutes first, so the first attempt to take it gave up after 25 minutes and the second waited.

### Release checks after release fix 3 (final tree)

| Check | Result |
| --- | --- |
| `desktop/scripts/check.ps1 -TargetDir D:/dev/targets/w4b-startup-spawn`, third run (the first two as described above) | 40 steps, 0 failed: fmt, Clippy `-D warnings` on each of the three feature sets, `cargo test` default 1,192 passed, smoke 1,366 passed, measure 1,205 passed, 0 failed (ignored: 1, 3, 3), deny, deny-plant 64 of 64, lock-names, audit, advisories, dist-scan, scripts-tests 226, harness-tests 440, release-script tests, order-scan, look-css, module-scope, smoke-release-build, pe-info checks, loader pin, manifest warning, parity |
| `node --test desktop/harness/tests/*.test.mjs desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 696 tests, 695 pass, 1 skipped, 0 fail |
| `e2e:desktop` (run as `node node_modules/@playwright/test/cli.js test -c playwright.desktop.config.ts`, PLAYWRIGHT slot, exe `cand-fix3/`, sha256 `0e8361cf20e24478...`, the exe the third check built, byte-identical to `cand-fix2/`) | 42 passed on run 2 (1.3 min), window watch clean. Run 1: 41 passed, 1 failed (`90-look` dropdown, the 412 on `/api/workspaces/watch` that 0.3.3 shows too). Logs `rc3/e2e2.log`, `rc3/e2e3.log` |
| `gatecheck.py check --before .../gate_before.json --windows .../windows.jsonl` | PASS: ledger, registry and `oos_openings.json` the same, log prefix intact, 6,721 lines appended since the snapshot (5,264 inside this wave's windows, 1,457 outside, all caller `terminal`), 101 windows, 0 open |
| prose lint (`ai_pattern_check.py`) on the merge note and the slice note; `web/src/copy/copyRules.test.ts` | both notes PASS; copyRules 5 of 5 |
| free space on C: | 434,195 MB at the end of fix 2, 433,424 MB at the end of this fix (771 MB lower); nothing of this fix is written on C: (temp, targets and scratch are on D:), so the fall is other lanes'; far above the 10 GB stop |

## Born-failing evidence

The slice's evidence stands (`born-failing-default.txt`: `cargo test --test supervise_spawn_early` 6 failed against the 0.3.3 order; `born-failing-node.txt`: 5 failed against stub exports; logs in `D:/dev/v04/w4b-startup-spawn/`). This merge adds one: the first full check run failed `the_exe_has_no_debugging_port_and_no_test_switch` in two feature sets before the string fix and passes in all three after it. No other guard was added; `smoke_feature_absent.rs` is an existing guard that caught the defect.

The release check after the QA fixes adds two more: `fmt` and `source_size` (805 and 804 lines) both failed on the tree the fixers left and pass after the fixes above. The QA fixers' own born-failing cases (the early-drop test with two mutations of `Early::drop`, the `launchEvents` cases in `shelllog.test.mjs` and the per-build cases in `report.test.mjs`) are in the tree and pass in the runs above.

## New files and their fate, for the 03 Appendix A addendum

| File | Fate |
| --- | --- |
| `desktop/src-tauri/tests/supervise_spawn_early.rs` | kept (slice) |
| `docs/desktop/v04/w4b-startup-spawn__spawn-first.md`, `docs/desktop/v04/w4b-startup-spawn__merge.md` | kept; the notes of this wave |
| `supervise::shell::{begin, Early, Handoff, start_loop}` replace `supervise::start`; `supervise::run::health_check` moved | kept |
| shell log lines `supervise_thread_began`, `supervise_create_process` | kept; read by `lib/shelllog.mjs` |
| `report.mjs` `SPAWN_OFFSET`, `spawnOffsetCheck`, `spawnOffsetFailures`, `spawnOffsetLine`; report key `spawnOffset` | kept |
| scratch under `D:/dev/v04/w4b-startup-spawn/` (`run_check.sh`, `run_ab.sh`, `run_e2e.sh`, `spawn_offsets.mjs`, `cand/`) | scratch, outside the repo |
| `D:/dev/ablabw4b` | A/B lab for this wave, outside the repo; its terminal is a junction to this worktree |

No route and no Cargo dependency is added. No file under the lab's `results/`, `backtests/output/`, `data/` or `live/` was written.

## Not done, not verified

- The gated exit criterion (spawn offset median 120 ms or less in 5 hidden launches, none over 150 ms, CPU under 10%): release fix 3 took five gated launches (median 52 ms, two over the ceiling at 293 and 365 ms), so the median is met and the ceiling is not; the older text follows. It needs a quiet PC. Three PROVISIONAL A/Bs of the final tree read medians of 19.5 ms (gate 12.1 to 48.6%), 146 ms and 151 ms, with 1 launch over 150 ms in the first, 5 in each of the others, so the criterion is open and not met by anything measured so far (see "Release fix 2").
- The splash paints 250 to 420 ms later than 0.3.3 under load (654 and 805 ms against 395 and 381 ms), PROVISIONAL, and its cause is not isolated.
- `desktop/README.md` and `desktop/harness/README.md` are stale until the manager applies the two edits written in the slice note.
- `report.mjs --check --strict` has run on converted real launch logs (release fix 2) but not on a folder the harness itself wrote, and its exit 4 path is not shown end to end through the CLI (such a folder lacks the other rows, so the CLI exits 1 first). The post-merge reliability run in the main tree is its first real use.
- The 120-launch real-data reliability run, `scripts/smoke_real.ps1 -Mode App` and the second gatecheck are post-merge checks in the main tree.
- The A/B used the smoke build over fixture-less lab backends of the A/B labs, as the tool does; no measure build ran and no real-data launch was made.
- The edge noted above (a close while WebView2 is being built) has no test.
- No agent review (code-reviewer, rust-reviewer) was run from here. The three QA focuses in the wave spec are left to the QA step.
- `pnpm` itself cannot run in this worktree on node 24.13.1 (jsdom engine range); the web commands here ran through `node node_modules/...`.
