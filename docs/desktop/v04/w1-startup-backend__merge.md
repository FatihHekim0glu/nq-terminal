# Wave w1-startup-backend: merge note

Merged on 11 October 2026 in the worktree `E:/projects/nq-lab/wt-w1` (branch `v04/w1-startup-backend`, from `16f56ec`). Three slices
(`home-window`, `pre-ready`, `start-rows`) finished without a structured report; every file they own was read, checked against
the spec and tested. Every timing in this note is PROVISIONAL: other waves, a QuantPad download and the release finisher shared
the machine throughout, and the CPU load was far above the 10 % limit.

## What the merge wired

| Wiring | Where | Test |
| --- | --- | --- |
| The per-request timing window closes when the HOME tasks stage ends (`request_timing.close_window(app)` in the prewarm's stage hook). `close_window` also accepts an app object without `state`. | `backend/nq_terminal/api/home_prewarm.py` (`_trim_after`), `backend/nq_terminal/desktop/request_timing.py` | `test_home_prewarm.py::test_born_failing_the_stage_hook_closes_the_request_timing_window_when_the_home_tasks_stage_ends` (failed before the hook) |
| The start rows are read back from the run folder a record names, at report time: `startRowsOfRecord` reads `<run>/config/logs/shell.log` and `<run>/state/logs/backend.log` of a smoke record (the measure build has no state folder of its own, so it is not read back). No launch path carries them (release fix 3 removed the `launch-run.mjs` wiring, which no slice owned) | `desktop/harness/lib/startrows.mjs` (`startRowsOfRecord`), `desktop/harness/report.mjs` | `startrows.test.mjs`: a seeded run folder read back, a record carrying its own `startRows` kept, the measure build not read back |
| The in-process import reading is taken once per run set by `node desktop/harness/lib/startrows.mjs import-time OUTDIR` (the HEAVY slot; it starts only the lab interpreter) and written to `OUTDIR/importtime/import-time.json`; `startRowsOfRecord` stamps it onto every record file of that folder (`startRows.import`). A run set that skips the command has no import row (release fix 3 removed the `modes/rows.mjs` wiring, which no slice owned) | `desktop/harness/lib/startrows.mjs` (`writeImportRow`, `startRowsOfRecord`, the `import-time` command) | `startrows.test.mjs`: the import row beside a record reaches its rows and the summary (born failing), an unreadable file is named in `problems`, `writeImportRow` writes where the reader looks; the command itself was run once by hand (933 ms median over three runs after one warm-up, `D:/dev/v04/w1-startup-backend/fix3/importtime`, PROVISIONAL) |

## Fixes to slice files, and why

Each is a change the merge made because a full suite failed, or because a guard of the wave could not hold.

1. `desktop/harness/lib/importtime.py` (start-rows): `backend/tests/test_safety_ast.py::test_real_tree_passes[other]` failed on three
   file writes in it (lines 120, 149, 150: `.mkdir()` and `.write_text()`). The script no longer writes a file: the result is one
   JSON line on stdout, `--out` is gone, and `runImportTime` (JavaScript) makes the scratch folder. The script refuses when the
   scratch folder is missing. `startrows.mjs` and `startrows.test.mjs` follow. The guard was not touched.
2. `desktop/harness/tests/startrows.test.mjs` (start-rows): the "refuses an unsafe prefix" case started a real interpreter with its
   bytecode prefix inside the repository, and the interpreter wrote `desktop/pyc-x/` there before the script refused. It now runs with
   `-B`, and asserts that nothing was written. The folder the earlier run left was removed (git-ignored).
3. `web/src/screens/gp/useGpData.ts` and its tests (home-window): the builder gated GP's `/api/runs` with `useQuietReady`. That made
   `chrome/useQuietReady` a module shared by two lazy chunks, so it became a chunk of its own and the shell's dependency map gained one
   entry: the shell went from about 109,996 to 110,015 bytes gzip and `scripts/shellBudget.test.ts` ("stays at the shell diet 4
   target", 110,000) failed. GP now passes `deferRuns` to the hook until the picker is opened, and a deferred request asks only when a run is chosen (a caller that does not defer, such as the DES preview and the demo's read check, asks at mount as before). The record watch's reader
   (already gated by `useQuietReady`) loads the same cache entry once the page is quiet, so the list is normally there before the
   picker opens. `useGpData.test.ts` and `GpScreen.test.tsx` were changed to the new rule (a born-failing case each: no `/api/runs`
   at mount nor later until the picker opens; the list another reader loaded is shown). The rule "no `/api/runs` before HOME's last
   data response" still holds and is covered by the GP plus RecordWatch case.
4. `web/src/demo/gp.reads.test.tsx` (owned by no slice): the first merge changed it, because its "runs have all answered" case expected the hook to ask for the list at
   mount. The release fix 2 reverted that: the opt-in prop became an opt-out (`deferRuns`, GP passes it), so a caller that says nothing keeps 0.3.3's behaviour and the
   file is byte-equal to `HEAD` again.
5. `web/src/screens/gp/GpScreen.tsx` (home-window): `fromFillsPicker` shortened to one expression with the same behaviour. Its effect
   on the shell budget is only through chunk hashes (see the open items).
6. Notes: `w1-startup-backend__home-window.md` and `w1-startup-backend__start-rows.md` say what 3 and 1 changed.

## Files, routes and modules for the 03 Appendix A addendum

No route, model, serialiser, state-folder file or environment variable was added by the wave.

| Item | Kind | Fate |
| --- | --- | --- |
| `backend/nq_terminal/desktop/request_timing.py` | new module | kept; one INFO line per request while the HOME window is open |
| `handshake.DistWalk` (daemon thread `nqt-dist-walk`), `dist_status(newest_ms=, contract_sha=)`, `handshake.schedule_dist_check` | new class, new keyword arguments, new function | kept (see the decision below) |
| `app.__getattr__` (lazy `app`), `ResponseModel` `defer_build=True`, `api/regimes_capacity_term._service` | changes | kept |
| `home_prewarm.home_tasks` / `later_tasks` | `runs` moved to the later tasks | kept |
| `desktop/harness/lib/startrows.mjs`, `desktop/harness/lib/importtime.py` | new harness modules | kept |
| `START_ROWS` in `desktop/harness/lib/rows.mjs`; `startRows` in `report.mjs` (read back from the run folder of each record) | new informational rows | kept; no gate |
| `desktop/harness/tests/fixtures/startrows/*.txt` | four log excerpts, no local path | kept |
| `backend/tests/test_ready_payload_walk.py`, `test_import_budget.py`, `test_request_timing.py`, `web/src/screens/gp/useGpData.test.ts`, `desktop/harness/tests/startrows.test.mjs` | new tests | kept |
| `docs/desktop/v04/w1-startup-backend__*.md` (four notes) | docs | kept |
| `GpRequest.deferRuns` | optional prop, internal to GP | kept |

## Decision for the owner (from the pre-ready slice, unchanged by the merge)

The READY line's `dist` field stays the exact `dist_status`: the shell refuses a READY whose `dist` is not `current` and then
offers its rebuild (`supervise_check.check_ready`, `stale_page::hook`), so a file edited deep under `web/src` or `web/public`
after the last build must still give `stale`. The pre-ready slice first answered it from a few stats only
(`dist_status_quick`), which said `current` in that case and let the shell serve the old page with no rebuild prompt; the fix
round removed that check. The walk of the 736 web sources (27 to 34 ms) stays off the READY path instead: `serve` starts it
on a daemon thread (`handshake.DistWalk`) before the token wait and the app build, and `ready_payload` reads its result
(it walks inline only when the walk failed or gave no answer within `DIST_WALK_WAIT_S`). A daemon thread walks once more 5 s
after READY and logs a warning when a source changed since; `/api/health` keeps the exact answer.

## Checks

The merge's own run is the first table; the release check (the same day, later) reran every item and is the second. All in the worktree with
`PYTHONPATH=E:/projects/nq-lab/wt-w1/backend` (`nq_terminal.__file__` read back under the worktree). C: free space was 429 GB at the start and at the end of the
merge, and 426 GB at the release check.

| Check (merge) | Result |
| --- | --- |
| `pytest backend/tests` (HEAVY slot) | 5,005 tests: 4,995 passed, 9 skipped, 1 failed. The failure (`test_safety_ast.py::test_real_tree_passes[other]`, file writes in `importtime.py`) was fixed (fix 1) and the file re-run: pass. The research-files guard ended clean. |
| `pnpm --dir web test` | `gen-api --check` in sync (sha256 d286ea6a...); vitest 524 files, 7,820 passed, 47 skipped, 1 file failed (below) |
| `pnpm --dir web test:types` | 4 errors, all in files this wave did not touch; see the release check below |
| `e2e`, `e2e:perf`, `e2e:offline` | 619 passed; 3 passed; offline 190 passed against baselines the candidate tree wrote itself (so not a comparison with 0.3.3; done at the release check) |

| Check (release check) | Result |
| --- | --- |
| `pytest backend/tests` (HEAVY slot, from `C:/Users/Fatih Hekimoglu/nq-lab`) | release fix 2: 5,011 passed, 3 skipped, 0 failed (5,014 tests, 15 min 02 s; the skips are environmental: 8.3 names off on this volume, no real state folder, and the lock test's child-session case); the first release check read the same 5,014 with 2 skipped; the research-files guard notes show `oos_access_log.jsonl`, `ledger.csv`, `registry.csv` and `oos_openings.json` unchanged. `qa/golden/home_panels_v031.json` through the app is `test_home_panel_lazy_relative.py`, in that run |
| `uv run --project qa python -m crosscheck --strict` | PASS 2495, FAIL 0, SKIP 0, INFO 104 |
| `pnpm --dir web test` | `gen-api --check` in sync (sha256 d286ea6a...); vitest 524 files: 7,821 passed, 47 skipped, 1 file failed (`radixPrimitiveStub.test.tsx`, environment, below); that file alone with Vite's `server.fs.strict` off: 7 of 7 passed |
| `pnpm --dir web test:types` | `tsc -b` exit 0, clean. The 4 errors the merge saw did not recur. `pnpm` itself refuses to start here (jsdom 30.1.1 wants node ^24.15, this PC has 24.13.1, and the worktree's `node_modules` has no `.bin`), so every web script ran as `node node_modules/<tool>` |
| `pnpm --dir web test:e2e-types` | all six projects clean (exit 0) |
| `pnpm --dir web build` | `tsc -b`, `vite build`, `bundleCheck.ts dist` and `buildStamp.mjs` pass: shell 110.0 kB gzip of 115.0, uplot 22.1 of 30.0, lightweight-charts 61.4 of 75.0, echarts 201.6 of 230.0, tanstack-grid 18.7 of 45.0, perspective 86.1 of 100.0 |
| `pnpm --dir web check:api` | contract unchanged (sha256 d286ea6a...) |
| `e2e` (PLAYWRIGHT slot, spare ports 8896 and 4376, `pnpm exec vite` through the shim in `D:/dev/v04/w1-startup-backend/bin`) | release fix 2, one run, 8 workers, PLAYWRIGHT slot held: 619 passed, 0 failed, 0 flaky (11.4 min). The first release check read 617 passed and 2 failed (`flows/p2.spec.ts:165`, `reflow-200.spec.ts:201`, page-mount timeouts while another lane's A/B and a pytest ran; both passed alone) |
| `e2e:perf` alone (1 worker) | 3 passed again in release fix 2 (the first release check: HOME first render median 674 ms against the 1,500 ms budget) |
| `e2e:offline`, against 0.3.3's own baselines | 190 passed, 3 skipped, no screenshot difference, again in release fix 2 (see the A/B section for how the baselines were made) |
| `node --test desktop/harness/tests/*.test.mjs` | 377 tests, 376 passed, 1 skipped, 0 failed |
| `node --test desktop/scripts/tests/*.test.mjs` | 226 passed (with `TEMP` on D: the three path-refusal cases of `install-hooks.test.mjs` fail; with the default `TEMP` all 226 pass, so that is the test's own assumption about the temp folder, not the wave) |
| `gatecheck.py check` with `gate_before.json` and the A/B's `windows.jsonl` | PASS: `ledger.csv`, `registry.csv`, `oos_openings.json` same; the first 45,646,964 bytes of `oos_access_log.jsonl` hash as before; 8 windows, none open; 376 lines appended inside the windows, all caller `terminal`; 3,154 outside, all caller `terminal`, counted not judged |
| prose lint on the four notes, banned-term and dash scan of the 38 changed files, Markdown LF | PASS; two Python files had CRLF endings (`request_timing.py`, `test_request_timing.py`) and were converted to LF (`.gitattributes` stores bytes as they are; the rest of the tree is LF) |
| `git status` against the owned lists | MET after release fix 3. Release fix 2 moved four of the six files into owned files (`test_announce_dist_check.py` into `test_ready_payload_walk.py`, `test_merge_note_home_estimate.py` into `test_import_budget.py`, `startrows-wiring.test.mjs` into `startrows.test.mjs`, `gp.reads.test.tsx` back to `HEAD`). Release fix 3 took the last two out: `desktop/harness/lib/launch-run.mjs` and `desktop/harness/modes/rows.mjs` are back to `HEAD`, and the rows they carried now live in `startrows.mjs` (the launch rows are read back from the run folder at report time; the import row has its own command). Every changed path is in a slice's owns or in `merge_owns` |

### Release fix 3: the two files outside the owned lists

`desktop/harness/lib/launch-run.mjs` and `desktop/harness/modes/rows.mjs` were the only changed paths in no slice's owns and not in `merge_owns`. Both are back to `HEAD`.
The cause was the design, not the files: the launch rows needed no launch path (`startRowsOfRecord` already reads a smoke record's run folder), and the import
row needed only a place to run once per run set. `startrows.mjs` now has `writeImportRow`, the `import-time OUTDIR` command and the record-side pickup, tested first
(the new cases failed on the missing export, then passed); the three tests that drove `launchRun`, `openSmoke`, `runSlots` and `slotsFor` were removed with
the wiring, and `startRowsForRun`, which only that wiring used, was removed with them. The command was run once: 933 ms median over three runs after a 6,133 ms warm-up,
1,130 modules, 976 checked, none without current bytecode, tree under `wt-w1/backend` (PROVISIONAL, shared machine).

Release checks rerun after it, all in the worktree (`nq_terminal.__file__` read back under `wt-w1`):

| Check | Result |
| --- | --- |
| `pytest backend/tests` (HEAVY slot) | 5,014 tests, 5,011 passed, 3 skipped, 0 failed, 0 errors (junit, 829 s). A first run of the same tree ended with 5,011 passed and one session-teardown error from the research-files guard: 97 `terminal` lines in `oos_access_log.jsonl` between 22:02:55 and 22:04:25 UTC, all inside two run windows of wave w3's A/B (22:02:51 to 22:03:21 and 22:04:22 to 22:04:48). The guard fails a full run on foreign terminal lines whenever `test_research_guard.py` has told the session guard about a real-data child, so a concurrent A/B lane can fail an otherwise green run; the rerun had no overlap and the guard notes read all four research files unchanged. The first run's log is kept as `D:/dev/v04/w1-startup-backend/fix3/pytest-run1-guard-race.log` |
| `crosscheck --strict` | PASS 2495, FAIL 0, SKIP 0, INFO 104 |
| web `gen-api --check`, `tsc -b`, six `test:e2e-types` projects | sha256 d286ea6a unchanged; all exit 0 |
| web vitest (HEAVY slot) | 524 files: 7,821 passed, 47 skipped; the one failing file is `radixPrimitiveStub.test.tsx` (environment, above) |
| `vite build`, `bundleCheck`, `buildStamp`, `copyRules.test.ts`, `shellBudget.test.ts` | pass; shell 110.0 of 115.0 kB gzip; 61 tests |
| `e2e` (PLAYWRIGHT slot, 8 workers) / `e2e:perf` | 619 passed, 0 failed (12.4 min) / 3 passed. The first attempt did not start: the Git Bash PATH put the real `pnpm` before the shim; it ran after the shim directory was given first |
| `e2e:offline` against 0.3.3's baselines | 190 passed, 3 skipped. A first run read 189 passed and 1 failed (`rules.spec.ts:86`, the page mounted no panel within 10 s while the machine was loaded); the full rerun passed |
| `node --test desktop/harness/tests` / `desktop/scripts/tests` | 374 tests, 373 passed, 1 skipped, 0 failed / 226 passed |
| `gatecheck.py check` | PASS: research files same; log prefix ok; 8 windows none open; 376 in-window lines all terminal; 3,530 outside counted not judged |
| prose lint, dash, banned-term and CRLF scans over the 33 changed files | clean |
| `git status` against the owned lists | every changed path is in a slice's owns or in `merge_owns` |

vitest's one failing file is `src/vendor/radixPrimitiveStub.test.tsx`: "Denied ID .../cmdk/dist/index.mjs?raw". Vite refuses a `?raw` read outside
the project root, and the mesh's junctions point into the main tree's `.pnpm` store. It is the environment, not the wave.

## The start rows, read against startup.md (merge-time reading, not a test)

`startrows.mjs` over the seven counted 0.3.2 first launches (rows runs 2 to 7 and the first-launch smoke run, `D:/dev/v032/evening-runs/20261007-2244-0.3.2/on`):

| Row | Read | startup.md | Difference |
| --- | ---: | ---: | ---: |
| spawn to READY | 1,581 ms | 1,581 ms | 0 |
| HOME stage | 1,917 ms | 1,917 ms | 0 |
| spawn offset | 499 ms | 500 ms (521 less the 21 ms `start` line) | 1 |
| page files served | 196 (107 on the first page load) | 107 | the rows runs reload the page |

The per-request rows read `missing` for these launches, as they must: the 0.3.2 backend wrote no timing line.

In-process import time, once under the merged tree (lab interpreter, `-E -s -X utf8`, bytecode prefix and scratch state under
`D:/dev/v04/w1-startup-backend/importtime-merge`): warm-up 8,059 ms, then a median of 1,238 ms over four runs, 1,130 modules loaded, 976 source
modules checked, none without current bytecode. PROVISIONAL: the machine was loaded and the CPU load was not read (the label is set by hand).
The target is 0.95 s on an idle machine.

## The A/B: run at the release check

Run on 11 October 2026 (19:47 to 19:57 UTC) through A/B labs with `D:/dev/v04/tools/ab.mjs`: 0.3.3's smoke exe
(`D:/dev/release/0.3.3/payload/smoke/nq-lab-terminal.exe`) over `D:/dev/ablab033` (base, its terminal the worktree at `desktop-v0.3.3`, `bb5b9a6`) and over
`D:/dev/ablabw1` (candidate, built by `ensure-ablab.ps1 -Name w1 -TerminalJunction E:\projects\nq-lab\wt-w1`, its terminal a junction to this worktree). Both
backends reported version 0.3.3 and named their own lab in the side check (`sideOk` true on every record). Hidden launches, HEAVY slot, one warm-up and three
interleaved first launches per arm (`base033` then `candw1`, three rounds). Records and run folders are in `D:/dev/v04/measure/w1-startup-backend/ab/`, the
eight run windows in `windows.jsonl` there. PROVISIONAL: the CPU gate read 8.1 to 11.6 % against its 10 % limit (a QuantPad downloader and other waves were
running), so five of the six counted launches carry the provisional label.

| Row (first launch) | Base 0.3.3, median (min to max) | Candidate, median (min to max) | Change |
| --- | ---: | ---: | ---: |
| `cold_home` (the probe's HOME ready, definition unchanged) | 3,629 ms (3,452 to 3,669) | 2,983 ms (2,979 to 3,059) | -646 ms |
| `backend_ready` | 1,546 ms (1,540 to 1,629) | 1,357 ms (1,352 to 1,439) | -189 ms |
| READY to HOME ready (`cold_home` less `backend_ready`, per launch) | 2,040 ms (1,906 to 2,089) | 1,626 ms (1,620 to 1,627) | -414 ms |
| spawn to READY (shell log) | 1,255 ms (1,249 to 1,359) | 1,090 ms (1,066 to 1,090) | -165 ms |
| HOME stage (task list differs: the base build includes `runs`) | 2,053 ms (1,853 to 2,212) | 1,452 ms (1,415 to 1,498) | -601 ms |
| `splash_painted` | 345 ms | 328 ms | -17 ms |
| page files served | 107 | 107 | 0 |
| `/api/runs` before HOME ready (page's own timing) | 914, 1,594 and 984 ms, inside the HOME window | not requested before HOME ready, in all three launches | moved |
| last HOME data response (page clock) | 2,908 ms | 2,629 ms | -279 ms |

The per-request rows exist for the candidate only (the 0.3.3 backend wrote no timing line). Its slowest request inside the HOME window is `GET /api/health`, 582 to
770 ms wall and 844 to 1,250 ms of process CPU, then `GET /api/market/universe` (427 ms) and `GET /api/analytics/hypothesis/.../panel` (213 ms). The wave did not change
`api/system.py`, and the base arm has no timing line to compare, so whether that health cost is new is not known; it is the first thing to read in the next pass.

"HOME stage 1.0 s or less on a first launch" is NOT met: the candidate's stage is 1.45 s (1.42 to 1.50). The shortfall is explained, not closed. The stage fell
by 0.60 s, inside startup.md 7.3's 0.5 to 0.9 s from the run index alone. What remains is the serial task chain `warm` 0.39 to 0.45 s, `two_day` 0.86 to 0.97 s and
`universe` 0.11 to 0.12 s. `two_day` took 0.01 to 0.19 s on the base arm because it ran after `runs`, when the page's own two-day requests had already built the
answers; without `runs` in front of it, its work now falls inside the stage. The pre-READY work (import plus app build, 1.293 s to 1.090 s in the pre-ready
slice's in-process reading, PROVISIONAL) shortens spawn to READY, not the HOME stage: the prewarm stage starts after READY and the first proof (startup.md section
3), so those 0.2 s cannot be spent in it. The HOME window instead gains the deferred model builds: `defer_build=True` moves the schema builds of the response
models HOME touches into it, about 16 ms (median of 8 in-process `model_rebuild` runs over the 25 response models behind HOME's routes, PROVISIONAL, FastAPI's
own TypeAdapter builds extra and not measured).

Exit criterion 5, as restated: the HOME stage row cannot decide the A/B alone, because the two arms run different task lists (the 0.3.2 stage includes
`runs`, 1.06 s on a first launch, startup.md section 3; this tree's does not). The verdict rows are `cold_home` and READY to HOME ready, and both fall on every
launch of the candidate (the ranges do not overlap: 2,979 to 3,059 ms against 3,452 to 3,669 ms, and 1,620 to 1,627 ms against 1,906 to 2,089 ms). The run index
cost was moved, not hidden: in the candidate's backend logs `GET /api/runs` arrives after the HOME stage ended in all three launches (RecordWatch's quiet-gated
read; in the third launch the later task `runs` had built the index first, in 2.94 s, and the request read it). It is still 1 to 3 s of work on a first launch, now
after HOME ready. The criterion's last condition,
`warm_home` no worse (`node run.mjs --build smoke --rows warm_home` on each arm), was NOT run: it needs the harness rows mode on two builds, and the machine was
shared. It stays owed; nothing in the A/B contradicts it, but nothing shows it either.

The `e2e:offline` comparison with 0.3.3 was done at the release check. The `offline-win32` baselines are git-ignored (`web/.gitignore`), so a first run in
any tree fails every screenshot test with "a snapshot doesn't exist". The 0.3.3 web sources are in `D:/dev/v04/w1-startup-backend/base-web/web` (all 1,647
files hash equal to `desktop-v0.3.3`'s `web/` tree). Its `e2e:offline:baseline` run wrote 110 baselines (190 passed, 3 skipped); they were copied into this tree's
`web/e2e/__screenshots__/offline-win32/` (the tree's own earlier ones were moved to `D:/dev/v04/w1-startup-backend/offline-win32-w1-selfwritten`), and
`pnpm e2e:offline` here then passed: 190 passed, 3 skipped, no screenshot difference. The GP root's new `onClick` and `onKeyDown` capture handlers and the run list
no longer requested at mount did not move a pixel on any offline screen.

## Open items

- The shell budget target (110,000 bytes gzip) has about 1 to 4 bytes of room; the shell is 109,996 bytes on the 0.3.3 sources and 109,999 to
  110,001 on this tree depending on the content hashes of lazy chunks, which the shell's dependency map lists. Any change to a lazy chunk can
  tip it over. The next wave that touches web code should either free a few hundred bytes in the shell or raise the target on purpose.
- The radix test (`src/vendor/radixPrimitiveStub.test.tsx`) needs a `node_modules` whose real path is inside the project root; it passes here when Vite's
  `server.fs.strict` is off (7 of 7), which is a different config, not the shipped one. Run it on the main tree after the release finisher's install.
- The HOME stage is 1.45 s on the candidate against the 1.0 s target (see the A/B). The next cut is the serial chain `warm`, `two_day`, `universe` and the first
  `GET /api/health`, which takes 0.58 to 0.77 s inside the window.
- `warm_home` on both arms is owed (the last condition of exit criterion 5, as restated).
- The READY line's `dist` decision above is the owner's.
- `services/research.py` imports `nq_lab.sessions` (and through it `exchange_calendars`, 80 ms) at module level; moving that import is the one change
  left from startup.md 7.4(d) and belongs to the owner of that file.
- First use of a deferred response model builds its schema on the worker thread that serves the request; Pydantic does not document that build as
  thread safe (a double build is idempotent).
- Post-merge checks (`smoke_real.ps1 -Mode App` on the main tree, the second `gatecheck.py check`) are the post-merge agent's.
