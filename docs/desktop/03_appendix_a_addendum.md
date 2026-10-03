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
## Rows added by later phases

Columns follow Appendix A.1: path, lines, fate (`keep`, `wrap`, `new` or `remove`), desktop form, stage, tests.

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D1 (W1B) | `backend/nq_terminal/services/prewarm.py` | 117 | new | once-per-process warm-up thread that runs zero-argument tasks in order after the port is bound; on only when `NQT_DESKTOP=1` or `NQT_PREWARM=1`; errors logged, never raised | D1 | `test_prewarm.py` |
| D1 (W1B) | `backend/nq_terminal/api/home_prewarm.py` | 108 | new | the HOME task list (deflated, ledger, two-day, universe, GP bars, EQ bootstrap) built from the cached route callables and started from the app's lifespan; skipped in fixture mode and for `NQT_PREWARM=0` | D1 | `test_home_prewarm.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/__init__.py` | 13 | new | package marker; names the seam's modules | D2 | `test_build_stamp.py`, `test_desktop_fixture_main.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/lifecycle.py` | 118 | new | the lock taken in the app's lifespan (so every start path takes it); the runtime (token, port, pid, nonce, mode); the same-origin list from the bound port, with the Vite port only under `NQT_DEV=1` | D2 | `test_desktop_lifecycle.py`, `test_app.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/build_stamp.py` | 81 | new | `dist` current, stale or missing, from `web/dist/build-stamp.json` against the newest source time and the sha256 of `contract/openapi.json` | D2 | `test_build_stamp.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/proof.py` | 33 | new | the challenge-response body: an HMAC over nonce, port and pid keyed by the token, which is never sent | D2 | `test_desktop_proof_challenge.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/fixture_main.py` | 80 | new | the test-only entry that serves the fixture lab through the same lock, stdin channel and handshake | D2 | `test_desktop_fixture_main.py` |
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
| D5 (W5A) | `desktop/harness/modes/` (`rows`, `reproduce`, `minimise`, `first-launch`, `t8`, `soak`, `installer`, `selftest`) | 83, 172, 197, 36, 118, 84, 32, 146 | new | the eight modes of the harness; the self-test plants a spin, a window and a MinGW path to prove the guards reject them | D5 | `selftest.mjs` live, plus the unit tests below |
| D5 (W5A) | `desktop/harness/lib/*.mjs`, `mem.ps1`, `probe.js`, `winctl.py`, `winwatch.py`, `plantwin.py` | 34 files | new | paths, row definitions, statistics, provenance, the gate and slot, the shell and backend launchers, the CDP client, the window watch and screen 2 guard, memory and survivor reads; every spawn hidden, a PATH with no build tools | D5 | `desktop/harness/tests/*.test.mjs` (107 tests) |
| D5 (W5A) | `desktop/harness/reference/w0b-tauri.json`, `README.md` | 68, 126 | new | the W0B spike figures the reproduction gate compares against; the harness guide | D5 | `report.test.mjs` |
| D5 (W5A) | `desktop/scripts/advisories.mjs` | 169 | new | the published Tauri advisories newer than `state/desktop/advisories.json` (D5.3, 05 X03) | D5 | `scripts/tests/advisories.test.mjs` |
| D5 (W5A) | `desktop/scripts/dist-scan.mjs` | 134 | new | no private key, signing key or PRIVATE marker in `web/dist` or a bundle folder (05 X06) | D5 | `scripts/tests/dist-scan.test.mjs` |
| D5 (W5A) | `desktop/scripts/artefact-check.mjs` | 258 | new | the release folder check: manifest, imports, execution level, updater absent, no lab data, the pinned loader | D5 | `scripts/tests/artefact-check.test.mjs` |
| D5 (W5A) | `desktop/scripts/build-release.ps1` | 273 | new | the three builds (release, measure, smoke) with `SHA256SUMS`, `PROVENANCE.json` and the config copies | D5 | the artefact check |
| D5 (W5A) | `desktop/scripts/install-test.ps1` | 511 | new | the silent per-user install and uninstall under `D:\dev\d5\install`, no admin, no window | D5 | `-SelfTest` |
| D5 (W5A) | `scripts/record_green.ps1` | 243 | new | the four dated, stamped green records; `-Stamp` is the one provenance stamp definition | D5 | `scripts/tests/release_check.tests.ps1` |
| D5 (W5A) | `scripts/release_check.ps1` | 193 | new | same-day, same-stamp records and an artefact check before a tag is allowed; never creates the tag | D5 | `scripts/tests/release_check.tests.ps1` (266 lines) |
| D5 (W5A) | `web/playwright.desktop.config.ts` | 46 | new | the desktop Playwright project: attaches over CDP to the hidden smoke build; specs are `*.desktop.ts` so the browser project never matches them | D5 | `web/e2e/desktop/05-selftest.desktop.ts` |
| D5 (W5A) | `web/e2e/desktop/` (`launch.ts`, `watch.ts`, `watch.ps1`, `quiet.ts`, `fixtures.ts`, `app.ts`, `clipboard.ts`, `browserFixture.ts`, `served-session.ts`, `setup.ts`, `run.ts`, `smoke.app.ts`) | 12 files | new | launch under the launch prelude, the global window and foreground watch, the quiet-machine guard, the derived lab outside the real lab, the app mode of the real-data smoke | D5 | the specs below |
| D5 (W5A) | `web/e2e/desktop/*.desktop.ts` (`05-selftest`, `10-walk`, `20-stream`, `30-export`, `40-keys`, `50-zoom`, `60-print`, `70-parity`, `90-look`, `99-window-watch`) | 10 specs | new | the walk, stream, export, key, zoom, print, bars-parity and look checks of the app (34 tests); the look compares read-only with `e2e/__screenshots__` | D5 | themselves |
| D5 (W5A) | `qa/crosscheck/served.py` | 284 | new | the served-JSON comparison: the cached dump bodies against what the hidden app serves; part of G2 beside `crosscheck --strict` | D5 | `qa/tests/test_served.py` |
| D5 (W5A) | `qa/tests/test_served.py` | 205 | new | 26 tests, with a planted one-byte difference | D5 | itself |
