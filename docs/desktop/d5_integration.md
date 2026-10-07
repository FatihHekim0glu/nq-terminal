# D5 step 1 integration: the harness, the packages and the app checks in the main tree (wave INT2)

Status: written by the INT2 merge on 3 October 2026. The branch `desktop/d4` (D5 step 1, commit `5472d6b`) was merged into main on top of the INT1 result `cc62248` as `ed9a40c`. This wave checked that merge, reconciled what the two sides had left to each other, and ran from the main tree every check that could not run in the worktree the step was built in. D5 step 1 is building only: nothing here measures a figure of gate G2.

## What the merge check found

- No conflict marker anywhere. The two README conflicts of the merge had been resolved by keeping the main tree's text only; the D5 step 1 content (the script and harness rows, the check and release commands, the new known limits) is now in `desktop/README.md` beside the main tree's newer status, and the status paragraph of `docs/desktop/README.md` names D5 step 1.
- `.gitignore` kept `desktop/src-tauri/gen/`, `target/` and the whole `state/` folder (so `state/release` and `state/desktop`) out. It gains `desktop/harness/runs/` and `*-setup.exe`, so a harness run folder or an installer that strays into the repository stays out; the harness and release scripts themselves write only under `D:\dev`. `test_desktop_tree.py` now checks all of this.
- The addendum to Appendix A lacked rows for `webview2-bootstrapper.ps1` and two script tests, and `test_desktop_tree.py` did not look into `scripts/tests`. The test now requires a row for every file under `desktop/scripts` (folders included) and for the harness entry files and folders; it failed first, then the rows were added. Stale line and test counts of the D5 rows were corrected, and the INT2 preflight section is in wave order.
- Files both sides touched: `conftest.py` keeps the guard for the lab's `terminal/state` (the shared folder that an older conftest could leave `nqt-planted.txt` in) and now also the note of a backend started on real data; `test_research_guard.py` gains a test of both state folders. `check.ps1` keeps the seam requirement of INT1 and the supply-chain, release and web steps of D5. `test_safety_ast.py`, `smoke_real.ps1`, the Playwright configs and the `tauri.conf.json` bundle section had been changed by one side only and merged unchanged. `smoke_real.ps1` already gives its backend a temporary `NQT_STATE_DIR` and `NQT_JOBS=off`, so that open item of INT1 is closed.

## What was wired

- `check.ps1 -Web` ran its pnpm steps from the terminal folder, where this pnpm refuses the web folder's workspace file (`packages field missing or empty`), so all four web steps failed. They now run from the web folder; a script test pins it.
- The desktop Playwright project opened HOME as a first-time viewer by clearing the page's storage only. Since D3 stage B the app keeps the workspace, the link groups and the look in its state folder, so a panel or a theme left by one spec (the HELP index of the key spec, the amber look) came back in the next: eight specs failed on five panels instead of four, or on the wrong look. `openHome` and `clearStorage` now put the store's six data documents back to their defaults through the page's own versioned write (the page's one deliberate write, which the clean checks already allow), keep the import record, and hold the orientation dismissal in the store where the page reads it. A new spec in the walk leaves HELP open and fails without the reset.
- `build-release.ps1` builds into the INT1 target folder (`-TargetDir`); the smoke exe of its payload is the one every app check of this wave launched.

## What the release check of this wave fixed

- The store reset of the desktop specs changed the store's version under a page that still held unsent changes, so the page's last-moment send (which never retries) logged three 412 answers and the LEDG look spec failed on its console check, every run. The reset now lets the page send what it holds first, through the same hook the shell calls before it stops the backend, and only then resets the store and the page's storage. The look spec failed before the change and passes after it.
- The T8 mode of the harness started its Playwright run from the terminal folder, where this pnpm refuses `--dir web`; it now runs `corepack pnpm e2e:desktop` from the web folder (`playwrightSpawn`, three harness tests). The command in `desktop/README.md` says the same.
- `record_green.ps1` now treats any lab other than the parent of terminal as a self-test hook (an explicit records folder, `self_test` true), and `release_check.ps1` compares each record's command with the exact command of its check instead of a pattern, so a record made with another lab's interpreter is refused. The smoke exe a record names is exported as `NQT_SMOKE_EXE` to the check, so the exe that ran is the exe in the record.
- `install-test.ps1` made the install folder's ACL a check: the run folder is created protected (no inherited rights, only the user, SYSTEM and Administrators), and the run fails if the folder, the exe, the loader or the uninstaller can be written by Everyone, Users or Authenticated Users (matched by SID and by the rights bitmask). The parent folder's ACL is recorded as the contrast. A user who picks a folder that inherits broad write rights, such as `D:\Apps`, is covered only by the runbook until an installer hook exists (open below).

## Results on the merged tree

| Check | Result |
| --- | --- |
| Backend suite | 3935 passed, 1 skipped (INT1: 3886; the first run's single failure was the missing script rows) |
| Crosscheck strict | PASS 2495, FAIL 0; served-JSON comparison through the app-launched backend: 8 of 8 routes equal |
| QA tests | 333 passed |
| `test:types`, `test:e2e-types`, `build` | clean; the shell bundle is 109.9 kB gzip, the same as before |
| vitest | 7345 passed, 47 skipped |
| Playwright e2e | 398 passed |
| e2e:perf (alone) | 3 passed |
| e2e:offline | 190 passed, 3 skipped |
| e2e:desktop (alone) | 41 passed (40 of the step plus the store reset spec); two of them are the expected failures below |
| `check.ps1 -ShowProof` | 31 of 31 steps (its four web steps ran as the separate rows above); Rust tests default 375, smoke 500, measure 384; deny-plant 64 of 64 banned names caught; the order-name scan 40 passed; script tests 101, harness tests 113, release-check tests 63, install-test self-test 21 |
| `build-release.ps1 -Version 0.1.0` | release, measure and smoke builds; installer 3,246,958 bytes; no failures |
| `artefact-check.mjs` | passed on release, measure and smoke |
| `install-test.ps1` | 21 of 21: per-user, no administrator rights, 0 new windows, install folder and binaries not writable by Everyone, Users or Authenticated Users |
| `record_green.ps1` | backend, crosscheck, smoke and smoke-app records written, each from a passing run |
| Real-data smoke, browser and app mode | both passed; the research files are unchanged and the new access-log lines are all `terminal` display reads that end before 2022 |

## Open

- The two zoom specs that were expected failures (`test.fail`) are fixed and now plain tests; see the DEC1 section below.
- `release_check.ps1` needs a clean commit, so it stays open. Run on the uncommitted tree it passes the four records, the checksums and the artefact check and refuses only because the tree is not a clean commit. After the commit, build the release, check and install it, record the four checks with the release folder's smoke exe and run `release_check.ps1 -Tag desktop-v0.1.0 -RequireSmokeApp`. The records of this wave describe the uncommitted tree and are refused after the commit by design.
- Everything D5 step 1 listed as open stays open: the W0B reproduction gate of the harness, the engine-level minimise proof, a live T8 run, the real-data harness rows, the three workflow files and the MSVC leg, and the owner-only checks.
- The installer hooks (protected install folder, refusals, default under `%LOCALAPPDATA%\Programs`) are built and tested; see the DEC1 section. The owner-only step of protecting `D:\dev` or `D:\` as machine configuration is not part of them and stays the owner's.
- T3 is decided (the first launch is the reading); the stage 1 and splash numbers stay provisional until W5B re-measures them alone in a quiet window.


## DEC1: four owner decisions resolved (3 October 2026, wave DEC1)

The owner delegated four decisions that this document and 02 had listed as waiting. Each was resolved to the current standard, built test first and measured; the merge of the four slices is on the main tree at `49229b9` plus this wave's uncommitted tree. The release tag stays the manager's step at the very end.

### 1. First-launch cold HOME (T3; 02 section 4.1 item 3)

- **Decision.** The strict reading: the cold-HOME cap of 6 s (target 4.5 s) applies to every launch, including the very first launch after an install with an empty state folder. The usual launch is held to the same cap and must not regress against its W3B ceiling of 4,508 ms. `measure_stage1.mjs` gates both (`HOME_READING` is `first-launch`, `HOME_READING_RATIFIED` is true).
- **Standard.** A start-up budget is read on the worst realistic start, not the warmed one, and for an installed application that is the first launch after the install: it is the one launch every user makes, and the one they judge the product by.
- **Change.** The equity curve reads only the fields it draws, sanitised and frozen in one pass and decoded by orjson with an exact `json.loads` fallback (`services/run_curves.py`); the run index is the ninth cached, persisted, price-free route (`/api/runs`), and the ledger and the index are rebuilt from a fresh listing, never a stale one (a run folder added inside the 5 s rescan interval had been missing from the listing and from the ledger's anchor pairs, a latent bug); the prewarm runs what HOME asks for first (ledger, run index, two-day, universe, GP bars) and the tasks no HOME panel asks for (deflated Sharpe, EQ bootstrap) once the process is quiet or after 20 s.
- **Evidence.** First launch median 5,034 ms (W3B 6,439 ms) against the cap of 6,000 ms, under the strict reading; the 4,500 ms target is not met (PROVISIONAL, taken beside other load); usual launch 3,581 ms, not regressed; `fires: false`, `provisional: true`. The born-failing cases: whole-section parse, 840,634 sanitiser calls against a budget of 25,000, 2.59 s against 1.0 s on the heavy synthetic lab, 13 prewarm order tests, the missing index cache, the stale listing, and orjson silently turning a 30-digit integer into a float (the fallback now catches it). Equality guards: the projected curve equals the whole-section curve for every fixture run, the real lab's ledger body is byte-equal under both paths, and all 139 real `result.json` files parse the same under both decoders. Figures: `stage1/stage1_numbers.md`, DEC1 section.

### 2. 200% zoom reflow (WCAG 2.2 SC 1.4.4 and 1.4.10)

- **Decision.** At 200% zoom in 1,366 by 768 and 1,024 by 640 windows every maximised panel keeps every control reachable and operable without clipping.
- **Standard.** WCAG 2.2 AA: 1.4.4 Resize Text and 1.4.10 Reflow (content reflows to 320 CSS px wide without two-dimensional scrolling, except data tables, which are the stated exception).
- **Change.** A maximised panel is marked in CSS only, by its pressed maximise toggle (the shell chunk has no byte to spare): `PanelChrome.css` sets `--panel-maximised`, the fold rules of GP, MON, REG and DES live inside `@container not style(--panel-maximised: 1)` (pinned by `PanelChrome.maximised.css.test.ts`), and the stacked layout of a narrow window (`Workspace.css`) gives a maximised panel the viewport. The two `test.fail` specs of `50-zoom.desktop.ts` are plain tests now; `e2e/reflow.ts` holds the shared detectors and `e2e/reflow-200.spec.ts` surveys 44 panels in three windows.
- **Evidence.** The survey failed 75 of 89 cases before the fixes and passes 133 of 133 after (a planted detector case plus 44 panels in 3 windows); the real-engine specs of the desktop project pass at 200% in both small windows for the four HOME panels. Wide data grids (MON, REG, LIVE, JRNL, RUNS, JOBS) still scroll sideways inside the panel body: that is the 1.4.10 data-table exemption, accepted. The shell bundle is 109.9 kB gzip, unchanged.

### 3. Protected install folder (CWE-427 and CWE-732)

- **Decision.** The VS Code user-setup and Chrome per-user pattern: the default folder is `%LOCALAPPDATA%\Programs\nq-lab terminal`, and any chosen folder (for example `D:\Apps\nq-lab terminal`) is given a protected DACL before the first file is written: the current user, SYSTEM and Administrators with full control, inheritance removed, no other principal. Unsafe targets are refused.
- **Standard.** A program folder that inherits write rights for Users or Authenticated Users lets another local account replace the exe or `WebView2Loader.dll` (CWE-732 incorrect permission assignment; CWE-427 uncontrolled search path element). Per-user installers that follow the pattern keep the folder writable only by its owner.
- **Change.** `desktop/src-tauri/windows/nsis/hooks.nsh` (`bundle.windows.nsis.installerHooks` in the release, smoke and measure configurations): a refusal of a relative path, a drive root, a network or mapped network path, Program Files, Windows, a link or junction and an existing file (exit code 3, nothing written; the folder page greys out Install for the same targets); `NSIS_HOOK_PREINSTALL` sets the DACL with the full path of icacls and its exit code read (code 4); `NSIS_HOOK_POSTINSTALL` reads the DACL of the folder and the three files back and undoes the install when it is wrong (code 5); the bundler's own default `%LOCALAPPDATA%\<product>` moves under `Programs` on the folder page (`MUI_CUSTOMFUNCTION_GUIINIT`, because MUI2 owns `.onGUIInit`) and in a silent install with no `/D=`. The uninstaller removes only what the installer wrote. `artefact-check.mjs` fails a release whose configuration lacks the hooks, whose installer script does not include them or whose hooks lose any of these rules; `build-release.ps1` keeps the compiled hooks file beside `installer.nsi`; `install-test.ps1` gained the custom-folder, refusal and (opt-in, `-DefaultFolder`) default-folder cases.
- **Evidence.** `install-hooks.test.mjs` (18 tests) compiles a stub installer that includes the hooks the way the template does and proves each rule born failing, with a planted parent that grants Users Modify and Everyone write. `install-test.ps1` against the built installer: 58 steps, 0 failed: a custom folder under that hostile parent ends with exactly the user, SYSTEM and Administrators, nothing inherited, and no broad writer on the exe, the loader or the uninstaller; a file the user added and a lab stand-in beside it survive the uninstall; a drive root (three spellings), a network path, a junction, Program Files and Windows each exit with code 3 and leave nothing; the default install lands under `%LOCALAPPDATA%\Programs` and is protected. The installer is 3,251,931 bytes (3,246,693 before the hooks).

### 4. EQ Enter unit at the desktop caps

- **Decision.** The `volmanaged_v0` EQ Enter unit meets its 1,000 ms target at the shipped desktop caps (512 MiB of bars, 128 MiB of files) without raising them.
- **Standard.** A cache is sized by what it keeps, not by the files it read from: the weigher of Caffeine and the `getsizeof` of cachetools charge an entry its retained size.
- **Change.** The bars cache was not the cause (opening EQ makes no bar read). `GET /api/runs` was: the run index's file cache charged each run's parsed head (0.7 MB of JSON for 72 runs) at its whole `result.json` (162,872,018 bytes), so one pass overflowed the cap and every call re-parsed all 72 files (631 to 674 ms warm at the desktop caps against 15 to 28 ms at the browser caps). `FileCache` now charges an entry what it keeps (`retained_bytes`, `entry_weight`); anything it cannot weigh keeps the old charge; nothing served changes.
- **Evidence.** Born failing: 5 of 9 tests of `test_file_cache_weight.py` failed against the old rule (eviction pin 0 hits, 16 misses instead of 8 and 8; the index made 12 misses instead of 6). Desktop caps EQ Enter median 638 ms (W3B 1,168 ms; the browser caps give 641 ms) and REG 421 ms (W3B 765 ms); the strict crosscheck is byte-equal. All DEC1 figures are PROVISIONAL (machine not quiet) and W5B takes them again alone.

### What the merge wired

- The addendum to Appendix A: the rows of the new and changed modules, the changed text of the prewarm and `home_prewarm` rows, and a DEC1 preflight section (`gen_03_tables.py`, 0 unmapped); `stage1/README.md` and `stage1_numbers.md` carry the decided reading and the new figures; 02 sections 4.1 and 6.3, 03 section 13.1 and the O7 row of 04 record the decisions.
- The smoke and measure configurations carry `installerHooks` like the release one (`identity_split.rs` requires the three to differ only in identity), and `build-release.ps1` keeps `hooks.nsh` in `nsis\release|measure`.
- `60-print.desktop.ts` runs in an app of its own, retried twice: emulating print media on a live page left the engine's page unresponsive when the media went back in 3 of 8 runs of the spec alone and in every full run of the first hours of the merge (with the web code of the tree before this wave as well, so not a DEC1 change), and in the shared app that took every later spec down with it. Later runs of the whole desktop project, with the machine less busy, passed it every time (3 of 3, 41 of 41).
- **The gate log.** Two threads of one process (the terminal's bar loads run two at a time) could each seek to the end of `results/oos_access_log.jsonl` and write at the same offset: on Windows an append is a seek and a write, so the shorter line overwrote the longer one and left its tail (`}`) on a line of its own, and an entry was lost. The `int1_seams` test caught it on the real lab (two torn lines in the real log, below). `nq_lab.oos_gate.serve_bars` now takes one lock around its append (`tests/test_oos_gate.py`, born failing with a racy append path); the measurement run that followed added 622 lines with none bad. This is a change to the lab's own source, outside the terminal repository, and is listed as an open item.

### The release check (3 October 2026, evening)

- **A row the lab registers after a release is a plain row.** The lab registered hypotheses 23 (`gotobi6j_v0`) and 24 (`tsyauction_mid_v0`) during the check, with more rounds to follow. The Deflated Sharpe view refused with a 503 because a registered row had no series source (`UnknownNameError` from `ResearchService.series`), which took MT's panel, the real-data smoke and nine backend tests down with it, and three more tests required every live registry row to be learned. `registry_trials` (`api/analytics.py`) now leaves a registered row without a `SeriesSource` out of the trials and names it in the view's N note (`tearsheet_extended.unlearned_note`); a learned row whose series cannot be built still refuses the view. The tests that read the live registry check that each such row is a plain row (a card with no series, a 404 for its series, the SPA family's named exclusion, the N note) instead of failing until a release learns it, and no test counts the live registry. `test_registry_new_rows.py` plants a new registration and a new sealed-test opening in a copy of the fixture tree: born failing (3 of 5, the 503), green after. A draft that taught the terminal rows 23 and 24 was set aside, not merged: learning a row stays a change of its own.
- **The real access log is read as the gate reads it.** The audit and health tests built their fixtures with `json.loads` on every line of the real log and pinned the openings to `rebal_v1_confirm`, so the two torn lines below, and any new opening, broke them. They now take entries and fragments from `oos_gate.parse_log`, require the terminal's parse errors to be exactly the gate's torn fragments, and compare the openings with the file. The lab changed `oos_gate` during the check so that a torn fragment that cannot be a sealed line no longer voids the sealed-log pin; the terminal's half-written-line test now writes a line that could be a sealed one and requires the pin never to read ok.
- **A regression the DES baseline had recorded.** The DEC1 rule that lets a narrow pane's legend name wrap also caught the shared DES chart at 1,366 by 768 (its pane is about 430 px wide). There the wrapped legend grew past the share of the plot the y range keeps clear (45%) and covered the curve's last two years and its last-value tag, and the updated DES baseline had taken that in. The rule now applies only inside a maximised panel (`@container style(--panel-maximised: 1)` in `LineStack.css`), pinned by `LineStack.css.test.ts` (born failing); the DES screenshot equals the baseline of `49229b9` again, and the 200% survey still passes.
- **Visual baselines.** The screenshot suite never read the live registry: the main run's backend is the fixture app over `backend/tests/fixtures` (two registry rows), which `scripts/playwrightConfig.test.ts` now pins, with planted cases. The fifteen HOME, REG and P2 baselines that differ from `49229b9` differ only in REG's compact note, whose copy DEC1 changed (`copy/reg.ts`: the columns hidden at 200% zoom, DSR among them, and where DES shows them).
- **The real-data smoke beside other workflows.** `smoke_real.ps1` checked every new access-log line as the terminal's, so a research workflow reading at the same moment failed the run. A line with another caller whose reason is not one of the terminal's is now counted as another workflow's; a line with no caller, or with the terminal's reason under another caller, is still a problem (self-test, born failing).

### Results on the integrated tree

| Check | Result |
| --- | --- |
| Backend suite | First full run: 4,032 passed, 1 skipped. After the `int1_seams` runs tore two lines of the real access log, the second full run: 4,013 passed, 1 skipped, and 5 failed plus 14 errors, every one a test that parses the real log (`test_audit.py`, `test_system.py`); see Open |
| Crosscheck strict | PASS 2,495, FAIL 0; the served-JSON comparison through the app-launched backend (`crosscheck.served`): every route equal |
| QA tests | 333 passed |
| `test:types`, `test:e2e-types`, `build` | clean; the shell bundle is 109.9 kB gzip of 114.9 kB, unchanged; every library chunk within budget |
| vitest | 7,355 passed, 47 skipped (495 files) |
| Playwright e2e | 531 passed (the 398 of INT2 and the 133 of the new reflow survey) |
| e2e:perf (alone) | 3 passed (HOME median 676 ms of 1,500; fills grid opens in 74 ms; GIP pan and zoom at 60 fps) |
| e2e:offline | 190 passed, 3 skipped (two runs); two later runs, with the machine busier, each had one timing failure in a different test (ROLL's empty state, the lazy chart libraries), each passing alone and in a repeat of 3 |
| e2e:desktop (alone) | 41 passed in three consecutive runs, with the two former `test.fail` zoom specs passing as plain tests; earlier runs the same session failed `60-print` (the engine hang below) and once a 412 on the store |
| `check.ps1 -ShowProof -Web` | 35 steps. The first run failed three Rust test steps: `identity_split.rs` (the smoke and measure configurations lacked `installerHooks`) and `int1_seams.rs` (the torn log line). Both fixed; the second run passed 34 of 35, the one failure being the offline timing failure above. Script tests 151, harness tests 113, deny-plant 64 of 64 names caught, 0 advisories in the Windows graph |
| `build-release.ps1 -Version 0.1.0 -TargetDir D:\dev\targets\int1 -Force` | 0 failures; release installer 3,251,931 bytes, measure installer 3,217,988 bytes |
| `artefact-check.mjs` | passed on release, measure and smoke, hooks included |
| `install-test.ps1` | 52 steps, 0 failed; with `-DefaultFolder`, 58 steps, 0 failed (custom folder under a hostile parent, uninstall keeping a user file and the lab stand-in, seven refusals with exit code 3, the default under `%LOCALAPPDATA%\Programs`) |
| Real-data smoke, browser and app mode | 18 and 5 passed; 67 new gate lines, all caller `terminal` inside the fence; the research files unchanged |
| DEC1 measurements (PROVISIONAL, alone but not quiet) | first launch 5,034 ms; usual launch 3,581 ms; EQ Enter at the desktop caps 638 ms; REG 421 ms; backend ready 1,390 ms; T3 does not fire (`stage1/stage1_numbers.md`) |

### Results of the release check (one pass after its fixes)

| Check | Result |
| --- | --- |
| Backend suite | 4,049 passed, 1 skipped; the lab registered round 19 (`apieia_ho_v0`) and other workflows added 38 access-log lines during the run, and nothing failed |
| Crosscheck strict | PASS 2,495, FAIL 0, SKIP 0 |
| QA tests | 333 passed |
| `test:types`, `test:e2e-types`, `build` | clean; the shell bundle is 109.9 kB gzip, inside the 109,900 B ratchet |
| vitest | 7,381 passed, 47 skipped (496 files), the contract hash included |
| Playwright e2e | 539 passed |
| e2e:offline | 190 passed, 3 skipped |
| e2e:desktop (alone) | 41 passed, against the rebuilt smoke build |
| e2e:perf (alone, last) | 3 passed (HOME median 638 ms of 1,500; fills grid opens in 69 ms; GIP pan and zoom at 60 fps) |
| `check.ps1 -ShowProof` | 31 steps, 0 failed; its `-Web` group (the four pnpm scripts above) ran on its own |
| `build-release.ps1 -Force`, `artefact-check.mjs` | 0 failures; release installer 3,253,361 bytes, measure installer 3,219,478 bytes; the check passed on release, measure and smoke |
| `install-test.ps1` | 52 steps, 0 failed (the custom folder under a hostile parent, seven refusals with exit code 3) |
| Real-data smoke, browser and app mode | 18 and 5 passed; 67 new gate lines each, all caller `terminal` inside the fence, none from another workflow; the research files unchanged |

No timing series was taken in this pass: the quiet slot takes them.

### Open after DEC1

- **The first-launch target of 4.5 s is not shown to be met** (5,034 ms, PROVISIONAL). The next costs on HOME: the uncached hypothesis panel request (the slowest request of both launches), the `/api/health` walk of `web/src` for the build stamp (cacheable per process), and the gated session sets of the ledger. The retained-bytes weighing of the file cache costs about 10% of a cold ledger in a profile and is worth a look.
- **Three registered rows are plain rows until a release learns them:** `gotobi6j_v0`, `tsyauction_mid_v0` and `apieia_ho_v0` have no `SeriesSource` or `Shape`, so they have no series, no tear-sheet figures and no place among the Deflated Sharpe trials (the N note names them). A draft that teaches the terminal the first two was set aside outside the repository; learning a row is a change of its own, with its own born-failing series checks.
- **All DEC1 figures are PROVISIONAL** (the machine was not quiet; 10 of 16 series records read above the 10% CPU gate). W5B takes the first-launch, usual-launch, EQ and REG series again alone.
- **Two torn lines remain in `results/oos_access_log.jsonl`** (lines 17724 and 17858, each a lone `}`), made by the `int1_seams` runs before the lock existed. They fail five tests of the lab's own `tests/test_sealed_pins.py` (they parse every line) and show as "not JSON" on the OOS screen. The log is append-only and the terminal never writes under `results/`, so they were left for the owner: deleting those two lines (the entries they belonged to were already lost) restores the tests. The terminal's own tests read the log as the gate does since the release check, so they no longer fail on them, and the lab's gate now skips a torn fragment that cannot be a sealed line.
- **`60-print.desktop.ts` is load dependent** (the engine hang above): it is contained and retried, not understood to the root. If it fails all three attempts the run is red for that one spec only. A rare 412 on the workspace store's `linkGroups` document (the page's last-moment send after a reset) failed one look spec once in five full runs, the known race of the INT2 store reset, and passed on the next three runs.
- The first run of `/api/runs` is the ninth cached route; `measure_stage1.mjs` still times the eight D1 routes (add it to `routeTable` if it should be timed). The run FileCache's `max_entries` of 512 would make the run index thrash by entry count above about 500 runs (72 today). `measure_stage1.mjs` is 877 lines and `install-test.ps1` over 800, each on purpose (one runnable scenario list and its self-test); a split of the T3 and self-check part of the first is possible.
- Not done by design: macOS; the owner-only checks; the release tag.
