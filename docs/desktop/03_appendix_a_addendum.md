# Addendum to 03, Appendix A: modules added after the appendix was written

03's Appendix A gives a fate to every backend module and every front-end folder. This file holds the fate of any module that appeared after that appendix was generated, so that the preflight of every desktop phase (04, standing rule 14) ends with 0 unmapped rows. A phase that adds a module adds one row here in the same change; the next preflight reads this file together with 03.

## Preflight of 2 October 2026 (wave W0A, stage A of D0)

`nq-lab/desktop_research/tools/plan/gen_03_tables.py` was run on the tree at commit `7f8b986` with the nq-lab venv Python (output kept in `docs/desktop/baseline/raw/gen03_tables_output.md`).

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders, QA, launcher and contract rows | 110, 25, 24 and 35, the counts 03 recorded |
| Unmapped rows | 0 |
| Route rows | 78 (76 GET, 1 POST, 1 DELETE), the same as the 78 (method, path) pairs of the built app |
| Module and folder names against 03's Appendix A | identical, apart from `backend/tests/fixture_app.py`, a hand-added row in 03 that the generator does not emit |
| Rows to add to this addendum | none |

`api/paper_expectation.py` and `services/paper_expectation.py` (the modules that were uncommitted when 03 was written) are already in 03 as rows 41 and 95 of Appendix A.1 with the fate `keep`, and the route `GET /api/analytics/paper-expectation` is in the generated route table; they need no addendum row.

## Preflight of 2 October 2026 (wave W1A, stage A of D1)

`gen_03_tables.py` was run on the tree at commit `af2f164` with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 111, 25, 24 and 35 |
| Unmapped rows | 0 |
| New module in this wave | `services/result_cache.py` (522 lines), already row 98 of 03, fate `keep` |
| New test files in this wave | `test_startup_imports.py`, `test_result_cache.py`, `test_result_cache_persist.py` (tests carry no addendum row) |
| Rows added to this addendum | `services/prewarm.py` (written in W1B) and `api/home_prewarm.py` (added in W1B), below |
| Other build workflows on the repository | none (only the owner's 8765 backend, without `--reload`) |

## Preflight of 2 October 2026 (wave W2A, stage A of D2)

`gen_03_tables.py` was run on the tree at commit `3c06235` plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 124, 25, 24 and 35 |
| Rows the generator cannot map by itself | 10, all under `desktop/`: `lock.py`, `handshake.py`, `watchdog.py`, `sessions.py` and `envlist.py` are rows of 03's A.4; `__init__.py`, `lifecycle.py`, `build_stamp.py`, `proof.py` and `fixture_main.py` are added below, so 0 are left unmapped |
| `api/desktop.py` | mapped by the `api/` rule and by the A.4 row; its 4 routes are in 03's route table (`/api/desktop/proof` by hand, the three session routes under stage 1.4) |
| Routes of the built app | 82 (80 GET, 1 POST, 1 DELETE); the contract has 79 paths |
| Other build workflows on the repository | none (only the owner's 8765 backend, pid 46084, without `--reload`) |
| Owner reminder (manager decision 11, 04) | stop the 8765 backend before relying on the lock; the old process holds none, so a second backend would not see it |

## Preflight of 3 October 2026 (wave W3B, stage B of D3)

`gen_03_tables.py` was run on the tree at commit `976a64c` plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 127, 25, 26 and 35 |
| Unmapped rows | 0 |
| New modules in this wave | the four `web/src/state/remoteStore*.ts` modules (rows below); `chrome/` gains no module (copyLink, deepLink and the command line change in place) |
| Other build workflows on the repository | none besides the shell build in its own worktree |

## Preflight of 2 October 2026 (wave W4A, stage A of D4)

`gen_03_tables.py` was run on the `desktop/d4` worktree (base commit `3c06235`, the W4A tree uncommitted) with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 113, 25, 24 and 35 |
| Unmapped rows | 0 |
| New backend module in this wave | none; the generator does not scan `desktop/`, so every shell file is a row of this addendum |
| Other build workflows on this worktree | none; a second workflow builds other waves in the main tree, so this worktree has its own branch and target folder |
| Port used by the stage A hidden-window check | 8796 (the W0A probe row of the port table); the fixture backend is started and stopped by the test itself |
| Rows added to this addendum | the shell files below |
## Preflight of 3 October 2026 (integration INT1, D3 and the D4 shell in one tree)

`gen_03_tables.py` was run on the main tree at the merge commit `8f8fdf6` plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 127, 25, 26 and 35 |
| Unmapped rows | 0 |
| Conflict markers, `target` and `node_modules` folders under `desktop/`, LF line endings, wave order of this file | checked by `backend/tests/test_desktop_tree.py` |
| Shell sources and scripts without a row here | none (the same test) |
| New shell module in this wave | `flush.rs` (row below); the page gains `attachShellSync` in `state/remoteStore.ts`, no new module |
| Other build workflows on the repository | none besides the shell package build in its own worktree |

## Rows added by later phases

Columns follow Appendix A.1: path, lines, fate (`keep`, `wrap`, `new` or `remove`), desktop form, stage, tests.

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D1 (W1B) | `backend/nq_terminal/services/prewarm.py` | 202 | new | once-per-process warm-up thread that runs zero-argument tasks in order after the port is bound; later tasks run once the process is quiet (at most a quarter of one core over 0.5 s, twice) or after 20 s; on only when `NQT_DESKTOP=1` or `NQT_PREWARM=1`; errors logged, never raised; an on_stage hook runs after the HOME tasks and after the later tasks (the working-set trim of `memtrim.py`, vnext perf-1), and `prewarm_running()` says whether the thread works | D1 | `test_prewarm.py` |
| D1 (W1B) | `backend/nq_terminal/api/home_prewarm.py` | 137 | new | the HOME task list (ledger, run index, two-day, universe, GP bars) and the later tasks (deflated, EQ bootstrap) that wait for a quiet process, built from the cached route callables and started from the app's lifespan; skipped in fixture mode and for `NQT_PREWARM=0` | D1 | `test_home_prewarm.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/__init__.py` | 13 | new | package marker; names the seam's modules | D2 | `test_build_stamp.py`, `test_desktop_fixture_main.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/lifecycle.py` | 118 | new | the lock taken in the app's lifespan (so every start path takes it); the runtime (token, port, pid, nonce, mode); the same-origin list from the bound port, with the Vite port only under `NQT_DEV=1` | D2 | `test_desktop_lifecycle.py`, `test_app.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/build_stamp.py` | 81 | new | `dist` current, stale or missing, from `web/dist/build-stamp.json` against the newest source time and the sha256 of `contract/openapi.json` | D2 | `test_build_stamp.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/proof.py` | 33 | new | the challenge-response body: an HMAC over nonce, port and pid keyed by the token, which is never sent | D2 | `test_desktop_proof_challenge.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/fixture_main.py` | 80 | new | the test-only entry that serves the fixture lab through the same lock, stdin channel and handshake | D2 | `test_desktop_fixture_main.py` |
| D3 (W3B) | `web/src/state/remoteStore.ts` | 527 | new | the page's side of the workspace store: reads and writes the seven documents with If-Match, debounces writes at 500 ms, flushes on pagehide, runs the one-time per-origin import, keeps localStorage as the cache; a 404 or a missing backend leaves plain localStorage; started from `main.tsx` by a dynamic import | D3 | `remoteStore.test.ts`, `remoteStore.pages.test.tsx`, `desktop-seams.spec.ts`, `workspace-import.spec.ts` |
| D3 (W3B) | `web/src/state/remoteStore.keys.ts` | 237 | new | the ten keys, their seven documents, and the clean and default shape of each | D3 | `remoteStore.keys.test.ts` |
| D3 (W3B) | `web/src/state/remoteStore.merge.ts` | 233 | new | each document's merge rule on a 412 and the import merge (adds what the store lacks, keeps a differing entry as `<name> (imported)`, safe to repeat) | D3 | `remoteStore.merge.test.ts` |
| D3 (W3B) | `web/src/state/remoteStore.transport.ts` | 71 | new | the one module under `src/state` that calls fetch or names PUT; the GET-only source scan allows exactly this file and exactly that method | D3 | `remoteStore.transport.test.ts`, `api/client.test.ts` |
| D4 (W4A) | `desktop/src-tauri/src/main.rs` | 269 | new | builder, the fixed order of hooks (resolve, browser arguments, build, install, setup, supervise, after_build), the `Launch` record and the one `ShellError` | D4 | `identity_split.rs`, `hidden_window.rs` |
| D4 (W4A) | `desktop/src-tauri/src/smoke_options.rs` | 400 | new | the frozen `SmokeOptions` struct: every test switch, parsed only in smoke builds; stage B fills behaviour and never changes the struct | D4 | unit tests in the module |
| D4 (W4A) | `desktop/src-tauri/src/reads.rs` | 180 | new | the only module that reads files (lock, settings, complete size-capped log tail); no write call | D4 | unit tests; `plant-check.ps1 -ScopeOnly` |
| D4 (W4A) | `desktop/src-tauri/src/writes.rs` | 309 | new | the only module that writes files (`configure`, `append`, `rotate`, `write_new`); everything inside the lab but `terminal/state` refused | D4 | unit tests; `plant-check.ps1` |
| D4 (W4A) | `desktop/src-tauri/src/dialogs.rs` | 220 | new | every native dialog (lab picker, policy, fatal, restart, close-running-job, browser update, rebuild, diagnostics, download); fail closed under smoke and measure | D4 | unit tests |
| D4 (W4A) | `desktop/src-tauri/src/window.rs`, `supervise.rs`, `link.rs`, `keys.rs`, `crash.rs`, `smoke.rs` | 258, 83, 123, 38, 64, 101 | new | stubs with final signatures; `window::scrub_env` and `window::reveal` complete; stage B fills the rest | D4 | `hidden_window.rs` |
| D4 (W4A) | `desktop/scripts/pe-info.mjs` | 169 | new | Node built-ins only: RT_MANIFEST leaves, subsystem, execution level and the import allow list (WebView2Loader.dll pinned by hash) | D4 | `check.ps1` (born-failing synthetic inputs) |
| D4 (W4A) | `desktop/scripts/check.ps1` | 200 | new | the local stand-in for CI: fmt, Clippy, tests, deny, audit, token and contrast check, scope scan, smoke build, import check | D4 | itself |
| D4 (W4A) | `desktop/scripts/plant-check.ps1` | 264 | new | born-failing plants for the `TcpStream`, `std::fs`, `show()` and `Command::new` bans, the `deny.toml` ban and the module scope scan | D4 | itself |
| D4 (W4A) | `desktop/scripts/copy-tokens.mjs` | 181 | new | writes `assets/look.css` from `web/src/theme` and checks nine contrast pairs | D4 | `--check` (born failing on a hand edit and on a planted colour) |
| D4 (W4A) | `desktop/src-tauri/tests/capability_empty.rs`, `identity_split.rs`, `hidden_window.rs` | 186, 310, 919 | new | the empty capability file, the three identities and the hidden-window launch under the global window watch | D4 | the files themselves |
| D4 (W4A) | `desktop/src-tauri/tests/setup_refused.rs`, `show_scope.rs`, `windows_features.rs` | 198, 87, 70 | new | a refused setup ends with a logged fatal and exit 1; every `show()` sits under the release cfg; the declared `windows` features compile a real pipe round trip | D4 | the files themselves |
| D4 (W4B) | `desktop/src-tauri/src/window.rs`, `window_folders.rs`, `window_policy.rs`, `window_rebuild.rs`, `window_rebuild_announce.rs`, `window_fit.rs` | 777, 418, 265, 413, 44, 175 | new | the lab picker and settings, the WebView2 data folder with its protected DACL, the policy check over both hives, the stale-page rebuild and its screen-reader announcements, the window fitted to the display; the page bridge object and the new-window rule | D4 | `window_*.rs`, `reading_labels.rs` |
| D4 (W4B) | `desktop/src-tauri/src/keys.rs` | 265 | new | accelerator keys and zoom keys off in the engine, app zoom on the 25% grid, F5, F12, Ctrl+F, Ctrl+P and Ctrl+R left alone | D4 | `keys_cdp.rs` |
| D4 (W4B) | `desktop/src-tauri/src/supervise.rs`, `supervise_check.rs`, `supervise_retry.rs`, `supervise_run.rs`, `supervise_shell.rs`, `stale_page.rs` | 702, 538, 114, 491, 347, 48 | new | the shell's one `CreateProcessW` (the venv launcher in a kill-on-close Job Object), the handshake and proof checks with a message page each, attach to a live lock, the exit watch and restarts at 1, 2 and 4 s, the navigation check, the stopped page, the close, and the answer to a stale page build | D4 | `supervise_*.rs` |
| D4 (W4B) | `desktop/src-tauri/src/link.rs`, `reads.rs` | 617, 453 | new | the only TCP module (127.0.0.1, listener and peer ownership, proof and session calls) and the only read module (lock, settings, log tail, each capped) | D4 | `link_host.rs`, unit tests |
| D4 (W4B) | `desktop/src-tauri/src/writes.rs`, `writes_download.rs` | 622, 202 | new | the allow-listed, handle-checked write module and the `DownloadStarting` handler with its deferral | D4 | `writes_allow.rs`, `downloads.rs`, `ipc_refusal.rs` |
| D4 (W4B) | `desktop/src-tauri/src/dialogs.rs`, `guard.rs` | 400, 132 | new | every native dialog (fail closed in test builds) and the carrier that turns a failed `with_webview` install into a refused setup | D4 | `dialogs_*.rs`, `hooks_fail_closed.rs` |
| D4 (W4B) | `desktop/src-tauri/src/crash.rs`, `crash/diagnostics.rs`, `crash/hung.rs`, `crash/panic_report.rs`, `crash/recovery.rs` | 429, 250, 296, 204, 285 | new | the shell log, the panic report, backend.log rotation, renderer recovery, the hung-page offer and the diagnostics zip | D4 | `crash_*.rs` |
| D4 (W4B) | `desktop/src-tauri/src/smoke.rs`, `smoke_screen2.rs` | 355, 463 | new | the debugging port with Tauri's default switches, the controller made visible behind the hidden window, the screen 2 placement guard | D4 | `crash_smoke_options.rs`, `screen2_guard.rs`, `smoke_feature_absent.rs` |
| D4 (W4B) | `desktop/scripts/check.ps1`, `plant-check.ps1`, `pe-info.mjs`, `copy-tokens.mjs` | 209, 266, 169, 181 | new | the stage A scripts, extended by stage B (measure feature set, release-profile smoke exe, manifest scan) | D4 | themselves |
| D4 (INT1) | `desktop/src-tauri/src/save_outcome.rs` | 81 | new | the script by which the shell tells the page how a save ended (the `nqt:save-outcome` event of bridgeVersion 2) and the word for each refusal; the handler itself stays in `writes_download.rs` | D4 | `save_outcome.rs` unit tests, `int1_seams.rs` |
| D4 (INT1) | `desktop/src-tauri/src/flush.rs` | 302 | new | before the shell stops the backend it runs the page's flush hook (`__NQT_STORE_SYNC__`, defined by `state/remoteStore.ts`) and waits, up to a budget, until the page reports nothing pending; the page calls no shell command | D4 | `flush.rs` unit tests, `int1_seams.rs` |

The new modules that 03 already plans (`services/result_cache.py`, `desktop/lock.py`, `desktop/sessions.py`, `desktop/envlist.py`, the workspace models and service, and the others in its stage 1 list) are rows of 03 itself and are not repeated here. Only a module that 03 does not name belongs in this table, for example `services/prewarm.py` and `desktop/fixture_main.py`, which the wave plan adds; the phase that creates them adds their rows.

## Preflight of 3 October 2026 (wave W5A, step 1 of D5)

`gen_03_tables.py` was run on the `desktop/d4` worktree (base commit `76e9cc2`, the W5A tree uncommitted) with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and other rows | 127, 25, 26 and 36 |
| Unmapped rows | 0 |
| New backend module in this wave | none; the generator does not scan `desktop/`, `scripts/` or `web/e2e/`, so every file below is a row of this addendum |
| Other build workflows on this worktree | none; a second workflow builds D3 stage B in the main tree, so Playwright runs wait for each other |
| Port used by the app-smoke parity run | 8796 (the W0A probe row of the port table, free since W0A); every other port in this wave is port 0 |
| Rows added to this addendum | the harness, the release scripts, `record_green.ps1`, the desktop Playwright project and the served-JSON comparison, below |

### Rows added by W5A

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D5 (W5A) | `desktop/harness/run.mjs`, `report.mjs` | 66, 132 | new | the measurement harness entry (one mode per run, the reproduction gate, the CPU gate, a run folder under `D:\dev\d5\runs`) and the report with its strict `--check` | D5 | `desktop/harness/tests/report.test.mjs`, `gate.test.mjs` |
| D5 (W5A) | `desktop/harness/modes/` (`rows`, `reproduce`, `minimise`, `first-launch`, `t8`, `soak`, `installer`, `selftest`) | 83, 172, 197, 36, 123, 84, 32, 146 | new | the eight modes of the harness; the self-test plants a spin, a window and a MinGW path to prove the guards reject them | D5 | `selftest.mjs` live, plus the unit tests below |
| D5 (W5A) | `desktop/harness/lib/*.mjs`, `mem.ps1`, `probe.js`, `winctl.py`, `winwatch.py`, `plantwin.py` | 34 files | new | paths, row definitions, statistics, provenance, the gate and slot, the shell and backend launchers, the CDP client, the window watch and screen 2 guard, memory and survivor reads; every spawn hidden, a PATH with no build tools | D5 | `desktop/harness/tests/*.test.mjs` (110 tests) |
| D5 (W5A) | `desktop/harness/reference/w0b-tauri.json`, `README.md` | 68, 126 | new | the W0B spike figures the reproduction gate compares against; the harness guide | D5 | `report.test.mjs` |
| D5 (W5A) | `desktop/scripts/advisories.mjs` | 169 | new | the published Tauri advisories newer than `state/desktop/advisories.json` (D5.3, 05 X03) | D5 | `scripts/tests/advisories.test.mjs` |
| D5 (W5A) | `desktop/scripts/dist-scan.mjs` | 134 | new | no private key, signing key or PRIVATE marker in `web/dist` or a bundle folder (05 X06) | D5 | `scripts/tests/dist-scan.test.mjs` |
| D5 (W5A) | `desktop/scripts/artefact-check.mjs` | 295 | new | the release folder check: manifest, imports, execution level, updater absent, no lab data, the pinned loader | D5 | `scripts/tests/artefact-check.test.mjs` |
| D5 (W5A) | `desktop/scripts/build-release.ps1` | 307 | new | the three builds (release, measure, smoke) with `SHA256SUMS`, `PROVENANCE.json` and the config copies | D5 | the artefact check |
| D5 (W5A) | `desktop/scripts/install-test.ps1` | 610 | new | the silent per-user install and uninstall under `D:\dev\d5\install`, no admin, no window | D5 | `-SelfTest` |
| D5 (W5A) | `scripts/record_green.ps1` | 352 | new | the four dated, stamped green records; `-Stamp` is the one provenance stamp definition | D5 | `scripts/tests/release_check.tests.ps1` |
| D5 (W5A) | `scripts/release_check.ps1` | 311 | new | same-day, same-stamp records and an artefact check before a tag is allowed; never creates the tag | D5 | `scripts/tests/release_check.tests.ps1` (505 lines) |
| D5 (W5A) | `web/playwright.desktop.config.ts` | 51 | new | the desktop Playwright project: attaches over CDP to the hidden smoke build; specs are `*.desktop.ts` so the browser project never matches them | D5 | `web/e2e/desktop/05-selftest.desktop.ts` |
| D5 (W5A) | `web/e2e/desktop/` (`launch.ts`, `watch.ts`, `watch.ps1`, `quiet.ts`, `fixtures.ts`, `app.ts`, `clipboard.ts`, `browserFixture.ts`, `served-session.ts`, `setup.ts`, `run.ts`, `smoke.app.ts`) | 12 files | new | launch under the launch prelude, the global window and foreground watch, the quiet-machine guard, the derived lab outside the real lab, the app mode of the real-data smoke | D5 | the specs below |
| D5 (W5A) | `web/e2e/desktop/*.desktop.ts` (`05-selftest`, `10-walk`, `20-stream`, `30-export`, `40-keys`, `50-zoom`, `60-print`, `70-parity`, `90-look`, `99-window-watch`) | 10 specs | new | the walk, stream, export, key, zoom, print, bars-parity and look checks of the app (34 tests); the look compares read-only with `e2e/__screenshots__` | D5 | themselves |
| D5 (W5A) | `qa/crosscheck/served.py` | 306 | new | the served-JSON comparison: the cached dump bodies against what the hidden app serves; part of G2 beside `crosscheck --strict` | D5 | `qa/tests/test_served.py` |
| D5 (W5A) | `qa/tests/test_served.py` | 273 | new | 34 tests, with a planted one-byte difference | D5 | itself |
| D5 (W5A) | `desktop/scripts/webview2-bootstrapper.ps1` | 45 | new | the check of the WebView2 bootstrapper that the installer embeds: the path from the generated installer script and a valid Authenticode signature by Microsoft Corporation, recorded in `PROVENANCE.json` by `build-release.ps1` | D5 | `scripts/tests/webview2-bootstrapper.test.mjs`, `artefact-check.test.mjs` |
| D5 (W5A) | `desktop/scripts/tests/webview2-bootstrapper.test.mjs` | 80 | new | tests of the bootstrapper check (an unsigned file, a missing file, another publisher, the path read from the installer define, no define, the cached file signed by Microsoft) | D5 | itself |
| D5 (W5A) | `desktop/scripts/tests/check-script.test.mjs` | 57 | new | tests of the scope claims of `check.ps1`: neutral default folders, the web group, the offline step waiting for other Playwright runs, the header, the open items named in `desktop/README.md` | D5 | itself |

## Preflight of 3 October 2026 (integration INT2, D5 step 1 merged into the main tree)

`gen_03_tables.py` was run on the main tree at the merge commit `ed9a40c` (the D5 step 1 branch merged on the INT1 result `cc62248`) plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and other rows | 127, 25, 26 and 36 |
| Unmapped rows | 0 |
| Conflict markers, `target` and `node_modules` folders under `desktop/`, LF line endings, wave order of this file | checked by `backend/tests/test_desktop_tree.py` |
| New modules in this wave | none; the two README conflicts of the merge were resolved by keeping the newer status of the main tree and bringing in the D5 step 1 text |
| Other build workflows on the repository | none besides the owner's 8765 backend (pid 46084, without `--reload`) |

## Preflight of 3 October 2026 (integration DEC1, four owner decisions resolved)

`gen_03_tables.py` was run on the main tree at `49229b9` plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and other rows | 128, 25, 26 and 36 |
| Unmapped rows | 0 |
| New backend module in this wave | `services/run_curves.py`, a row below |
| Other build workflows on the repository | a docs-only workflow writes hand-over drafts in its own worktree; it runs no Playwright, no cargo and no backend |
| Rows added to this addendum | the equity curve view, the file cache weight, the reflow survey, the installer hooks and their tests, below |

### Rows added by DEC1

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D5 (DEC1) | `backend/nq_terminal/services/run_curves.py` | 171 | new | the equity curve's own view of a result.json: only the fields the curve reads, sanitised and frozen in one pass, decoded by orjson with an exact json.loads fallback; no I/O, no price read | D3 | `test_runs_ledger_first_launch.py` |
| D5 (DEC1) | `backend/nq_terminal/services/files.py` | 471 | changed | the file cache charges each entry what it keeps (`retained_bytes`, `entry_weight`), so the run index no longer overflows the 128 MiB desktop cap and thrashes; no cap is raised and no served value changes | D1 | `test_file_cache_weight.py` |
| D5 (DEC1) | `backend/nq_terminal/services/runs.py`, `api/runs.py`, `services/result_cache.py` | 47, 36, 4 changed | changed | `/api/runs` is a cached, persisted, price-free route (the ninth); the ledger and the index are rebuilt from a fresh listing, never a stale one | D1 | `test_runs_cached_index.py`, `test_result_cache_routes.py` |
| D5 (DEC1) | `web/e2e/reflow.ts`, `reflow-200.spec.ts` | 154, 189 | new | the shared overflow and clipping detectors and the survey of every panel in three windows at a device pixel ratio of 2 (WCAG 2.2 SC 1.4.4 and 1.4.10) | D5 | `reflow-200.spec.ts` (planted detector case), `50-zoom.desktop.ts` |
| D5 (DEC1) | `web/src/chrome/PanelChrome.maximised.css.test.ts` | 85 | new | pins that a maximised panel is marked in CSS only, by its pressed maximise toggle, with the fold rules inside the container query | D5 | itself |
| D5 (DEC1) | `desktop/src-tauri/windows/nsis/hooks.nsh` | 628 | new | the installer hooks: refuse unsafe targets (exit 3), give any install folder a protected DACL before the first file is written (exit 4), read the DACL back after the install (exit 5), and move the bundler's default under `%LOCALAPPDATA%\Programs` (CWE-427, CWE-732) | D5 | `scripts/tests/install-hooks.test.mjs`, `install-test.ps1` |
| D5 (DEC1) | `desktop/scripts/tests/install-hooks.test.mjs` | 371 | new | a stub installer that includes the hooks the way the template does, run silently against folders under `D:\dev\tmp`: protected DACL under a hostile parent, the refusals, the read-back, the default folder, the file's own rules | D5 | itself |
| D5 (DEC1) | `desktop/scripts/install-test.ps1` | 895 | changed | the custom-folder and refusal scenarios (a hostile parent, a lab stand-in, a SUBST drive root, a UNC path, a junction, Program Files and Windows, and with `-DefaultFolder` the default under `%LOCALAPPDATA%\Programs`); above 800 lines on purpose, one script owns one runnable scenario list and its self-test | D5 | `-SelfTest` |
| D5 (DEC1) | `desktop/scripts/artefact-check.mjs`, `build-release.ps1` | 376, 310 | changed | the installer script carries the hooks (`installerHooks` in the three configurations, the guard, the DACL calls and the default-folder rule in the hooks file that `build-release.ps1` keeps beside `installer.nsi`) | D5 | `scripts/tests/artefact-check.test.mjs` |
| D5 (DEC1) | `docs/desktop/stage1/measure_stage1.mjs` | 875 | changed | the first-launch series gates T3 under the strict reading; the usual launch is gated against the cap and its W3B ceiling; each record carries `apiTimeline`; above 800 lines on purpose, a measurement script with its own self-check | D5 | `node measure_stage1.mjs --dry` (37 checks) |
| D5 (DEC1) | `desktop/src-tauri/tauri.conf.json`, `tauri.smoke.conf.json`, `tauri.measure.conf.json` | 1 line each | changed | `bundle.windows.nsis.installerHooks` in all three (the identity test requires them to differ only in identity) | D5 | `tests/identity_split.rs` |
| D5 (DEC1) | `backend/nq_terminal/api/analytics.py`, `services/tearsheet_extended.py` | 418, 298 | changed | a registered row without a series source (a lab registration a later release learns) is no trial of the Deflated Sharpe view and is named in its N note, never a 503; a learned row whose series fails still refuses the view | D1 | `test_registry_new_rows.py`, `test_p1_api.py` |
| D5 (DEC1) | `backend/tests/test_registry_new_rows.py` | 119 | new | plants a new registration and a new sealed-test opening in a copy of the fixture tree: every research, audit and health route answers, the new row is a plain row | D1 | itself |
| D5 (DEC1) | `web/src/charts/LineStack.css` | 80 | changed | a legend name wraps in a narrow pane of a maximised panel only, so a shared pane keeps its legend short and the curve clear of it (look spec 6.1) | D5 | `LineStack.css.test.ts`, `des.spec.ts`, `reflow-200.spec.ts` |
| D5 (DEC1) | `web/scripts/playwrightConfig.test.ts` | 122 | changed | pins that the main run's screenshots read the checked-in fixture tree, never the live registry, with planted cases | D5 | itself |
| D5 (DEC1) | `scripts/smoke_real.ps1` | 851 | changed | a new access-log line with another caller and a reason that is not the terminal's is counted as another workflow's read, not a problem; over 800 lines before this change (833), one script owning the smoke and its self-test | D5 | `-SelfTest` |
| D5 (DEC1) | `web/e2e/desktop/60-print.desktop.ts` | 122 | changed | the print judgement runs in an app of its own, retried twice, so an engine hang after print emulation costs one spec and not the rest of the run | D5 | itself |
| D5 (DEC1) | `src/nq_lab/oos_gate.py`, `tests/test_oos_gate.py` | 1 lock, 1 test | changed | outside the terminal: one append at a time to the access log within a process (a torn line from two threads), born failing with a racy append path | D1 | `tests/test_oos_gate.py` |
| D4 (V020) | `desktop/src-tauri/src/memory_target.rs`, `smoke.rs`, `tests/memory_target_wiring.rs` | 321 | new, changed | the WebView2 memory target: Low while the main window is minimised or hidden, Normal when it returns (focus alone changes nothing; a window never shown counts as visible; an older WebView2 is logged once); `smoke.rs` tells it about the simulated minimise; the wiring is scanned statically | D4 | its unit tests, `memory_target_wiring.rs` |
| D5 (V012) | `backend/nq_terminal/memtrim.py` | 311 | new | vnext perf-1: Windows-only trim of the backend working set after the HOME prewarm stages (the HOME tasks, then the later tasks) and once per 60 s quiet period; no trim while a request is served, a job is queued or running or the prewarm thread works; the background polls do not start or end a quiet period; `NQT_MEMTRIM=0` turns it off; a failing call is logged, never raised; installed by `create_app` as the outermost middleware and a lifespan wrapper | D5 | `test_memtrim.py` |
| D5 (V012) | `backend/nq_terminal/services/prewarm.py`, `api/home_prewarm.py` | 202, 174 | changed | the on_stage hook (STAGE_TASKS and STAGE_LATER) and `prewarm_running()`; `home_prewarm` hands the prewarm the app's trim (`TRIM_STAGES`) | D5 | `test_prewarm.py`, `test_memtrim.py`, `test_home_prewarm.py` |
| D5 (V012) | `desktop/scripts/bump-version.ps1`, `tests/bump-version.test.mjs` | 227, 184 | new | one command moves the version in every place (tauri configs, `Cargo.toml`, `Cargo.lock`, the backend package, the OpenAPI contract and its hash, the usage lines of the release scripts) and refuses, writing nothing, when a place disagrees | D5 | its tests |
| D5 (V012) | `desktop/scripts/publish-release.ps1`, `tests/publish-release.test.mjs` | 174, 186 | new | a draft GitHub release: the release installer under its dotted name and a generated `SHA256SUMS`, downloaded again and checked; never uploads `PROVENANCE.json`, the measure or install-test installers; never publishes | D5 | its tests |
| D5 (V012) | `desktop/scripts/upgrade-owner.ps1`, `tests/upgrade-owner.tests.ps1` | 900, 152 | new | the owner's upgrade with a backup, a verify step and a rollback; a dry run by default; the self-test runs the same functions against fake registry keys, folders and installers | D5 | its tests |
| D5 (V012) | `desktop/scripts/install-test.ps1`, `tests/install-test.tests.ps1` | 1664, 162 | changed | the renamed-product install test, the 0.1.1 to 0.1.2 upgrade scenario, the stamped install record and the real-install guard (a changed uninstall key, remembered folder or install folder fails the run) | D5 | `-SelfTest`, its tests |
| D5 (V012) | `desktop/scripts/tests/build-release.test.mjs`, `desktop/scripts/build-release.ps1`, `artefact-check.mjs` | 35, 4 builds | new, changed | the fourth build, `installtest` (the release feature set under another product name and identifier, `tauri.installtest.conf.json`), and its checks | D5 | its tests, `artefact-check.test.mjs` |
| D5 (V012) | `desktop/src-tauri/src/window_settings.rs` | 246 | new | a settings file that cannot be read is logged as `settings_unreadable` (file, kind, line, column and what was done, never the content) and moved aside | D5 | its unit tests |
| D5 (V012) | `desktop/harness/lib/parity.mjs`, `modes/parity.mjs` | 83, 96 | new | perf-5: the fixture backend started as the shell starts it and the plain way holds the same private working set (within 5 MB) and thread count | D5 | `tests/parity.test.mjs` |
| D5 (V021) | `backend/nq_terminal/services/prewarm.py`, `api/home_prewarm.py`, `api/desktop.py`, `app.py`, `__main__.py` | 253, 188, 217, 201, 188 | changed | the start order of 0.2.1: `StartGate` (`mark_ready`, `mark_proof`, `fallback_s`) holds the HOME prewarm until the first identity proof has been answered; desktop mode has no fallback, the launcher and browser forms start it at the first proof or 3 s after READY (`PROOF_FALLBACK_S`); `start_check(state)` picks the gate, the port-bound check or nothing (plain uvicorn); `desktop_proof` is an `async def` that does no blocking work and answers from `remember_identity(app)`, read once when the app is built; the lifespan runs `warm_worker_pool()` before the prewarm, so anyio's asyncio backend and the first worker thread exist before NQT-READY; `serve()` calls `gate.mark_ready()` just after the READY line | D5 | `test_desktop_proof_start.py`, `test_prewarm.py`, `test_home_prewarm.py`, `test_desktop_proof.py` |
| D5 (V021) | `backend/tests/test_desktop_proof_start.py`, `test_desktop_proof.py` | 425 | new, changed | 18 tests: the proof route needs no thread pool, the identity is read at build, the gate per mode, the lifespan warm-up, the prewarm waits on the gate, `TRIM_STAGES` matches the docstrings, and three Windows tests through the real `serve()` path with hidden backends under the window watch; `test_desktop_proof.py` counts an async route's docstring as a docstring | D5 | itself |
| D5 (V021) | `desktop/src-tauri/src/supervise.rs`, `supervise_run.rs`, `supervise_shell.rs` | 784, 574, 403 | changed | a late first proof at spawn is retried (`prove_at_spawn`: the first proof keeps the 2 s `LINK_TIMEOUT`, then up to 3 more proofs of 5 s each, 0.5 s apart, all inside `HANDSHAKE_TIMEOUT`, each with a fresh nonce and the same owner checks); a wrong proof, a foreign pid and a foreign listener are still refused at once and the token goes out only after a passing proof; a Retry with no backend left starts a new supervised backend (`retry_without_backend`), at most one run loop at a time (`looping`); a spawn-time refusal that is only late updates `#unverified` in place (`still_unverified`) | D4 | `tests/supervise_spawn_proof.rs`, the existing `supervise_*.rs` |
| D5 (V021) | `desktop/src-tauri/tests/supervise_spawn_proof.rs`, `tests/fixtures/fake_backend.py` | 345, 289 | new, changed | six spawn-proof tests (a late first proof is retried and checked, a wrong proof, a foreign owner and a foreign pid are refused at once, the token is never sent before a passing proof, a Retry after a refusal starts a new backend, a Retry while the loop runs starts no second one); the fake backend gains `proof_delay_s`, `proof_lie` (`mac`, `foreign_pid`) and keeps its READY line honest | D4 | itself |
| D5 (V021) | `desktop/scripts/build-release.ps1`, `artefact-check.mjs`, `tests/machine-paths.test.mjs`, `tests/artefact-check.test.mjs` | 374, 432, 182, 648 | changed, new | cleaner binaries: every build sets `CARGO_ENCODED_RUSTFLAGS` with `--remap-path-prefix` for the D:\dev root, the profile folder, `CARGO_HOME`, `RUSTUP_HOME`, the terminal folder and the target folder; `artefact-check.mjs --paths` (and the release-folder check) fails on any `D:\dev` or `C:\Users` string, in either slash direction, ASCII or UTF-16, in a payload exe or dll and in the installer | D5 | `machine-paths.test.mjs`, `artefact-check.test.mjs` |
| D5 (V021) | `desktop/harness/modes/reliability.mjs`, `lib/reliability.mjs`, `lib/tailog.mjs`, `lib/tailog.py` | 127, 98, 31, 105 | new | `run.mjs --mode reliability`: N hidden launches of the smoke build against the real backend, each timing spawn to READY and READY to the first proof from a 1 ms read-only tail of `backend.log`; any refusal (`supervise_refused`, the stopped page) fails the run with exit code 1 | D5 | `tests/reliability.test.mjs`, `tests/tailog.test.mjs` |
| D5 (V021) | `desktop/harness/lib/idle-trim.mjs`, `modes/rows.mjs`, `report.mjs`, `tests/trimseen.test.mjs` | 65, 120, 229, 73 | changed, new | `trimSeen` follows the `memtrim` field (a run with the trim off never says a trim ran); the raw working-set fall is kept as `trimDropSeen`; the report prints the idle trim per build and memtrim state | D5 | `tests/trimseen.test.mjs` |
| D5 (V030) | `web/src/theme/forcedColors.css`, `contrastMore.css`, `contrastModes.ts`, `contrastModes.test.ts`, `index.css` | 241, 61, 189, 280 | new, changed | Windows contrast themes: every rule of `forcedColors.css` sits inside `@media (forced-colors: active)` and uses system colour keywords only (no `forced-color-adjust`); selected, pressed, current and open states are Highlight on HighlightText, the keyboard ring is an outline, chrome shadows become borders; `contrastMore.css` sits inside `@media (prefers-contrast: more)`, sets token values only (secondary text 7:1, rules and edges 3:1) for the standard and amber classic looks and leaves the colour-vision and fixed tokens alone; the default look cannot change because neither sheet has a rule outside its query | D9 | `contrastModes.test.ts` (42 tests, born failing on a renamed state selector) |
| D5 (V030) | `web/e2e/contrast-modes.spec.ts` | 240 | new | 30 mnemonics in forced colours and in more contrast (60 cases, axe and the focus ring), a coverage test against `BUILT_SCREENS`, and a born-failing test of the detectors | D9 | itself |
| D5 (V030) | `web/src/charts/theme/chartContrast.ts`, `useChartContrast.ts`, `chartTokens.ts`, `uplotTheme.ts`, `lwcTheme.ts`, `web/src/charts/echarts/shared.ts`, `coneModel.ts`, `compositionModel.ts`, `LineStack.*.ts`, `CandleChart.hooks.ts` | 289, 21 | new, changed | canvas charts that follow contrast themes: the live token reader (`readLiveChartTokens`) maps the chart tokens to system colours in forced colours and lifts the grid, zero line and year divider under more contrast; series that differ only by colour get dash cues in forced colours (`FORCED_DASHES`), candles go hollow when up; charts rebuild on a contrast change with no reload; the default option objects are unchanged | D9 | `chartContrast.test.ts`, `contrastCues.test.ts` (two files), `useChartContrast.test.tsx`, and the LineStack and CandleChart contrast-change tests |
| D5 (V030) | `web/src/charts/echarts/echarts.css`, `web/src/charts/LineStack.css` | 2 rules | changed | forced-colour opt-outs for the heat-scale steps (inline live token fill) and the uPlot cursor and selection (drawn as HTML) | D9 | `contrastModes.test.ts`, `contrast-modes.spec.ts` |
| D5 (V030) | `backend/nq_terminal/models/actions.py`, `services/presets.py`, `contract/openapi.json`, `web/src/api/schema.d.ts`, `web/src/screens/launch/*`, `web/src/copy/launchSpec.ts` | 111 | changed, new | the launcher gaps: every preset carries `spec_sha256` (sha256 of `experiments/<exp id>.json`, read only through the file cache, null when there is none), the Start from form shows it and the badge reads OFF SPEC when a parameter or the window changed or no hash backs the preset; the volmanaged_bh t0 rule is covered against the real ledger preset | D9 | `test_actions_presets.py`, `test_actions_presets_real.py` (82), the launch model, wire and form tests |
| D5 (V030) | `desktop/harness/modes/first-launch.mjs`, `lib/idle-trim.mjs`, `lib/launch-run.mjs`, `backend/nq_terminal/memtrim.py`, `services/prewarm.py`, `scripts/smoke_real.ps1`, `desktop/scripts/artefact-check.mjs` | 88, 308, 846 | changed | carried defects: the backend logs each working-set trim with the figures before and after and the prewarm start and end, the first-launch mode takes `--memtrim on or off`, smoke_real runs against a temporary state folder with jobs off, the machine-path scan is case blind and reads a folder | D9 | `first-launch-memtrim.test.mjs`, `backend-log-trims.test.mjs`, `test_memtrim.py`, `smoke_real.tests.ps1`, `machine-paths.test.mjs` |
| D5 (V030) | `.github/workflows/ci.yml`, `desktop/harness/tests/ci-workflow.test.mjs` | 72 | changed, new | every PowerShell self-test of the release scripts runs in CI, and a test fails when one is left out | D9 | itself |
| D5 (V030) | `desktop/src-tauri/src/window_folders.rs`, `src/window.rs`, `desktop/scripts/install-test.ps1`, `tests/install-hooks.test.mjs`, `backend/tests/test_settings.py`, `web/e2e/runs.spec.ts`, `web/e2e/visual/screens.spec.ts` | 441, 20, 1708, 566, 295, 274, 113 | changed | the moved big folders: `D:\dev` is a junction to `E:\dev` and the lab is reached through a junction, so the test folder rule of the measure and smoke builds checks the name on D: and the real folder only against the system drive and the research folders, the install test resolves every junction in its install, scratch and custom roots (the installer refuses a link in the path), the hook tests build their folders under the real path, the settings tests name the drive root above the project instead of `C:/`, and the RUN ledger row (it prints the machine's lab and interpreter paths) is masked in its four baselines | D9 | `window::tests` (a resolved folder may sit on another data drive, never on C: or in a research folder), `install-test.ps1 -SelfTest` (a junction in the path resolves), `install-hooks.test.mjs`, `test_settings.py` |
| D5 (V030) | `desktop/scripts/main-module.mjs`, `desktop/scripts/tests/main-module.test.mjs`, `desktop/scripts/artefact-check.mjs`, `advisories.mjs`, `dist-scan.mjs`, `pe-info.mjs`, `copy-tokens.mjs`, `desktop/harness/run.mjs`, `report.mjs` | 42, 128 | new, changed | carried defect: every guarded entry point compared `process.argv[1]` with its own URL as plain strings, so started through the lab junction (`C:\Users\...\nq-lab` is `E:\projects\nq-lab`) the comparison never matched and the gate printed nothing and exited 0; one shared helper compares real paths (case blind on Windows) and, when a file of the same name was started but not recognised, says so and exits 2 | D9 | `main-module.test.mjs` (each gate run through a junction: a planted finding exits 1, bad arguments exit 2) |
| D5 (V031) | `desktop/src-tauri/src/supervise.rs`, `supervise_run.rs` | 790, 625 | changed | the spawn-time proof retry reports an ended backend as an exit: a failed proof that carries no checked answer, from a process that has ended or ends within `EXIT_SETTLE` (3 s), is `Failure::Exited` and the shell log gets `supervise_exit_during_proof` with the port, the exit code and the reason it replaced. A checked answer (wrong MAC, foreign listener or pid, root, contract, hmac) stays a refusal with no wait; a live backend with no listener is still refused, after the settle (about 21.5 s, inside the 30 s `HANDSHAKE_TIMEOUT`). The exit code reaches only the shell log, since `Failure::Exited` in `supervise_check.rs` has no field for it. `supervise_shell.rs` is unchanged (403) | D5 | `tests/supervise_spawn_exit.rs` |
| D5 (V031) | `desktop/src-tauri/tests/supervise_spawn_exit.rs`, `tests/fixtures/fake_backend.py` | 313 | new, changed | six tests, born failing on the old code (an ended backend read as `Refused(Listener(None))`; the retry loop stopped after one exit; an exit at the retried proof logged nothing); the fixture gains `proof_exit_on`, `proof_close_on`, `proof_exit_after_s` and `proof_exit_code` | D5 | itself |
| D5 (V031) | `backend/nq_terminal/services/registry_freshness.py` | 79 | new | the registry staleness check, split out of `research.py` to keep it under 800 lines (735): `os.scandir` and `stat` only, over `results/registry.md` and the `*.json` of `results/screens` and `experiments` (no subfolder, no `.draft.` name); `stale` only when both times are known and the newest input is newer; about 0.6 ms | D5 | `test_registry_freshness.py` (12 tests) |
| D5 (V031) | `backend/nq_terminal/models/research.py`, `api/research.py`, `services/research.py`, `contract/openapi.json`, `web/src/api/schema.d.ts`, `web/src/api/openapi.sha256` | 7 | changed | `GET /api/registry` gains four required, nullable fields: `generated_at`, `newest_input_at`, `newest_input_path` and `stale`; the contract and its generated types follow | D5 | `test_openapi_contract.py`, `pnpm check:api` |
| D5 (V031) | `web/src/screens/reg/RegStaleBanner.tsx`, `regStale.ts`, `web/src/copy/regStale.ts`, `RegScreen.tsx`, `reg.css` | 30, 57, 8 | new, changed | the REG staleness line: one polite live region with an icon, empty and without height while the registry is current, no control, no write; a backend that serves none of the fields reads as current. The round rail of REG no longer scrolls inside the panel (`overflow: clip`, `min-height: min-content`), so axe reports no `scrollable-region-focusable` on HOME or REG at the size of the real registry | D9 | `RegScreen.stale.test.tsx`, `regStale.test.ts`, `reg.css.test.ts`, `web/e2e/reg-stale.spec.ts` |
| D5 (V031) | `backend/nq_terminal/services/prewarm.py`, `__main__.py`, `backend/tests/test_launcher_prewarm_timing.py`, `test_desktop_proof_start.py`, `test_memtrim.py` | 288, 230, 82 | changed, new | amends the V021 row above: from 0.3.1 the launcher form starts the prewarm on READY (`LAUNCHER_FALLBACK_S = 0.0`), because the launcher's proof poll (every 400 ms) reached the first prewarm task between 15 and 532 ms after READY in 18 starts (provisional, a busy machine) and the budget is 250 ms; the desktop form still waits for the first proof and the browser form keeps its 3 s fallback (`PROOF_FALLBACK_S`). The busy-prewarm test now calibrates its stand-in and has a born-failing case on the old start order; the `memtrim` background paths are derived from the real router | D5 | the three test files; the timing test is Windows-only and takes about 12 s |
| D5 (V031) | `desktop/src-tauri/tests/hidden_support/scope.rs`, `watch.rs`, `crash_support/mod.rs`, `window_harness.rs`, `downloads.rs`, `ipc_refusal.rs`, `watch_scope.rs`, `desktop/harness/lib/winwatch.mjs`, `web/e2e/desktop/watch.ts` | 164, 145 | new, changed | the scope rule of every global window watch: only the run's own process tree fails a run; another program's window or foreground is filed in a foreign list with a label (`known foreign program` for the named list, which holds `logioptionsplus_agent.exe`, and for `NQT_KNOWN_FOREIGN`), never a failure; an owner that cannot be traced fails closed | D5 | `watch_scope.rs` (5 tests), `winwatch.test.mjs`, `watch-ts-foreign.test.mjs` |
| D5 (V031) | `backend/tests/conftest.py`, `backend/tests/test_pytest_lock.py`, `desktop/scripts/check.ps1`, `desktop/harness/tests/check-pytest-lock.test.mjs` | 799, 82, 717, 83 | changed, new | a backend pytest session holds `D:\dev\locks\PYTEST.<pid>.lock` (stale after 2 h) and `check.ps1` waits on it before `test-smoke`, `test-measure`, `show-proof` and `parity` | D5 | `test_pytest_lock.py`, `check-pytest-lock.test.mjs` |
| D5 (V031) | `desktop/scripts/tests/upgrade-owner.tests.ps1`, `.github/workflows/ci.yml`, `docs/desktop/ci.md`, `desktop/harness/tests/ci-rust-job.test.mjs` | 246, 96 | changed, new | the upgrade dry run reads the release pair from the tree version and `D:\dev\release`; a second CI job, `rust`, runs `cargo fmt --check` only (clippy and the tests wait for a first MSVC build, REL-07) | D9 | the two tests |
