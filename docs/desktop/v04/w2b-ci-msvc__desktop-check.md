# W2B CI and MSVC, slice desktop-check: note

This slice writes `.github/workflows/desktop-check.yml`, the shell's first MSVC leg (04 D4.1 and D4.6; REL-07's first half; grade.md G-03; critique.md finding 34), with its guard test, and makes `build.rs` link the combined manifest into the integration tests on MSVC as it already did on GNU. `ci.yml`, `webview2-drift.yml` and `desktop-release.yml` belong to the other slices of the wave.

## Changed

- `.github/workflows/desktop-check.yml` (new). On push to every branch (`branches: ['**']`) and on dispatch; `contents: read`; a newer push cancels the older run. Four jobs, all on `windows-2025`, whose hosted rustup has the MSVC host (the first step proves it from `rustc -vV`):
  - `rust`, a matrix over the release (default), smoke and measure feature sets, `fail-fast: false`: the toolchain from `rust-toolchain.toml` (clippy and rustfmt, minimal profile), the cargo registry cached by `actions/cache` keyed on `Cargo.lock`, a stand-in lab (a plain venv under the runner's temp folder, `NQT_LAB` and `NQT_LAB_VENV`, `D:\dev\tmp`, `CARGO_HOME`), for the smoke set only a page build (`pnpm install --frozen-lockfile` and `pnpm build` in `web`, because the shell refuses a lab without `web/dist`), then `cargo clippy --all-targets --locked <set> -- -D warnings` and `cargo test --locked <set> -- --exact <skips>`. Before the run it lists the set's tests and fails if a skip-list name is not one of them, so a stale skip cannot hide.
  - `supply-chain`: `cargo deny --locked check` and `cargo audit`, with cargo-deny 0.20.2 and cargo-audit 0.22.2 (the versions in `D:/dev/cargo/bin`, recorded in `D:/dev/v04/p0/READY`) installed by `taiki-e/install-action`, which checks each download's hash.
  - `exe-size`: `cargo build --release --locked --features tauri/custom-protocol` (the build `cargo tauri build` makes, without the installer), then the latest release's installer and `SHA256SUMS` are downloaded with the read-only token, the installer's hash is matched against `SHA256SUMS`, `nq-lab-terminal.exe` is read out of it with 7-Zip, and the two sizes go into the run summary. The job fails when the new exe is more than `EXE_GROWTH_LIMIT_PCT` (25) percent larger.
  - `coverage` (report only): `cargo-llvm-cov` 0.9.1 on the default set, less the same skip list, with `llvm-tools` added to the pinned toolchain; the lcov file, the JSON summary and a one-line figure are uploaded as the artefact `rust-coverage` and the figure goes into the run summary. The job carries `continue-on-error: true` and nothing waits on it, so it can never fail the run; it is the only place the workflow uses `continue-on-error`.
  - Actions, each pinned by full commit SHA resolved with `gh api` (read only): `actions/checkout` v7.0.1, `pnpm/action-setup` v6.1.0 and `actions/setup-node` v7.0.0 (the pins `ci.yml` uses), `actions/cache` v6.1.0 (`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`), `actions/upload-artifact` v7.0.1 (`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`), `taiki-e/install-action` v2.87.13 (`26e9283f268b880168bdbd2c545dfcd60ec2c6ab`, 15 September, the newest at least three weeks old; its manifests hold Windows hashes for all three tool versions).
  - Every native command in a PowerShell step is followed by its own `$LASTEXITCODE` check, since pwsh reports only the last command's code.
- `desktop/src-tauri/build.rs`: the compiled resource (the combined manifest above all) is now linked into the integration tests on every Windows target, not on GNU only. embed-resource links it into the bins only; without it an MSVC test binary that loads tauri's menu code would fail to start (TaskDialogIndirect needs Common Controls 6). The new `compiled_resource()` links whichever of `resource.lib` and `libresource.a` exists in `OUT_DIR`, because embed-resource names the file after the host its build script runs on, not the target: `resource.lib` from rc.exe on an MSVC host (the runner), `libresource.a` from windres on a GNU host, also when a GNU host builds for the MSVC target. A first version chose the name from `CARGO_CFG_TARGET_ENV`; the local MSVC-target run below failed to link with `LNK1181: cannot open input file ...\out\resource.lib`, which is how the host rule was found. The `-B` shadow of MinGW's default manifest stays GNU only.
- `desktop/harness/tests/desktop-check-workflow.test.mjs` (new), described below.
- This note.

`desktop/src-tauri/rust-toolchain.toml` is unchanged: the pinned channel works on both hosts, and `llvm-tools` is added by the coverage job only, so the lab PC's toolchain needs no new component.

## The runner skip list

The list of tests the runner leaves out is the workflow env `RUNNER_SKIPS`, one line per test: `<sets> | <exact test path> | <reason>`. Every step that runs tests expands it into `--skip <name>` with `--exact`; no test is edited or marked ignored for the runner, and nothing else in the workflow skips or un-ignores a test (the guard test fails on a `--skip` with a literal name and on running ignored tests with `--ignored` or `--include-ignored`; only `--list --ignored`, which counts them, is allowed). It is not the only way a test goes unexercised: tests that skip themselves and `#[ignore]`d tests are reported by the Tests step, below. The rust job lists each set's tests first and fails when an entry for that set names no test, so a renamed test cannot leave a dead skip behind.

| Sets | Test | Reason |
|---|---|---|
| smoke | `one_close_sent_the_dotnet_way_ends_the_app_through_its_own_close` (`tests/close_relay_seam.rs`) | starts this tree's real backend in a lab derived from the owner's `nq_lab` sources and venv (`tests/hidden_support/labs.rs`), which only the lab PC has |
| smoke | `smoke_build_stays_hidden_through_home_and_close` (`tests/hidden_window.rs`) | the same |
| smoke | `real_backend_store_export_flush_on_close_and_the_next_launch` (`tests/int1_seams.rs`) | needs the lab's own terminal folder: `lab_of_this_tree()` fails on the stand-in lab, `seam_gate` prints `SKIPPED:` and the test returns green having started no backend and checked no seam (`NQT_REQUIRE_SEAMS` is deliberately unset on the runner) |
| smoke | `a_shell_attaches_to_a_real_backend_and_never_stops_it` (`tests/int1_seams.rs`) | the same |

How the list was found: the three sets were run on the MSVC target with the runner's environment imitated (a stand-in lab with a plain venv as `NQT_LAB` and `NQT_LAB_VENV`, `USERPROFILE` set to an empty folder, no `NQT_REQUIRE_SEAMS`). Only the first two failed, both with `cannot list <stand-in lab>\src\nq_lab`. The two `int1_seams` tests passed vacuously (they print `SKIPPED:` and return), which is why they are listed too. Tests that need screen 2 or a quiet machine are `#[ignore]`d in the crate or skip themselves with a printed `SKIPPED:` line (`crash_screen2`, `hidden_window`, the screen-2 cases of `screen2_guard`) and need no entry, but they pass without checking anything, so the Tests step shows them: it runs with `--nocapture`, writes each `SKIPPED` line out as a `::warning::` and counts them in the run summary, and it lists the `#[ignore]`d tests again with `--list --ignored`, so the summary reports "listed" beside "ignored (never run)", "skipped on the runner" and "run, of which N self-skipped". The coverage job does not count them yet: its figure covers every test that ran, self-skipped ones included. A test that the hosted session's WebView2 or desktop cannot serve would be added here after the first run, with its reason.

## Tests and born-failing evidence

`desktop/harness/tests/desktop-check-workflow.test.mjs`, 14 tests (11 at first; the self-skip guard and its planted-copy test were added with the vacuous-pass fix). Each rule is a checker that returns its problems: `featureSetProblems` (exactly release, smoke and measure with their cargo arguments, clippy `-D warnings` and `cargo test --locked` over the set, `fail-fast: false`), `selfSkipProblems` (the two `int1_seams` tests on the smoke skip list with their reason; the Tests step runs with `--nocapture`, counts `SKIPPED` lines, lists `--list --ignored`, reports the self-skipped in the summary; the workflow header does not call the skip list the only one), `skipProblems` (one `RUNNER_SKIPS`, a reason of at least 20 characters per line, known sets, every name a `fn` of the crate, no other skip), `coverageProblems` (its own job with job-level `continue-on-error: true`, no `continue-on-error` or `llvm-cov` in any other job, nothing waiting on it, cargo-llvm-cov pinned to an exact version, default set, uploaded), `ruleProblems` (push to every branch and dispatch only, `contents: read`, no job permissions or secrets, `windows-2025` and a time limit on every job, `persist-credentials: false`, every action on a full SHA, every native command's exit code checked) and `stepProblems` (toolchain from the pin, the MSVC host proved, the registry cache keyed on `Cargo.lock`, deny and audit pinned and run, the release exe built with `tauri/custom-protocol` and compared with the latest release under a growth limit, the run summary, the smoke page build). A fifth test reads `build.rs`; the last two parse the file with the lab's PyYAML and run actionlint 1.7.12, each skipping itself where the tool is missing (as on the hosted runner).

Born-failing evidence (output in `D:/dev/v04/w2b-ci-msvc/evidence/desktop-check/`):

1. Before the change (`before-real.txt`): 11 tests, 7 failed (the workflow did not exist; `build.rs` linked no MSVC resource), 4 skipped (the planted-copy tests need a workflow to plant into).
2. Each guard fed its broken state, with that guard stubbed to return no problem (`stub-<checker>.test.mjs` and `.out`, made by `make-stubs.mjs`): with `featureSetProblems` stubbed, "the pin test fails on a missing feature set" fails; with `skipProblems` stubbed, "the skip guard fails on a skip without a reason, a stray skip and a stale name" fails; with `coverageProblems` stubbed, "the coverage guard fails on a coverage step that can fail the run" fails; with `ruleProblems` stubbed, the rule guard's planted case fails. One test fails in each stub run, 10 pass. With the real guards all 11 pass, so each guard catches its broken state: a missing smoke set, a wrong measure set, no `-D warnings`; a skip with an empty or missing reason, a too short reason, an unknown set, a name that is no test, a literal `--skip`, `--include-ignored`; a coverage job with `continue-on-error: false` or none, a coverage step in the rust job, an unpinned cargo-llvm-cov; a tag pin, a write token, an unchecked exit code, `windows-latest`, a `[main]` branch filter.
3. After the change: 11 of 11 pass, 0 skipped on this PC. `actionlint` 1.7.12 over `desktop-check.yml`: clean.

Regression guards (they cannot fail on today's tree without a plant): the YAML parse test and the actionlint test.

Local runs of the same cargo commands (logs under `D:/dev/v04/w2b-ci-msvc/logs/`, HEAVY slot held for each leg, each test run timed in `D:/dev/v04/measure/w2b-ci-msvc/windows.jsonl`; target `D:/dev/targets/w2b-ci-msvc`, toolchain 1.99.0 under `D:/dev/rustup`, 8 build jobs):

| Leg | Clippy `-D warnings` (release, smoke, measure) | `cargo test --locked`: release | smoke | measure |
|---|---|---|---|---|
| GNU host, lab PC as it is, final `build.rs` (`gnu-20261011T172150Z`) | clean, clean, clean | 1,105 passed, 1 ignored | 1,269 passed, 2 failed, 3 ignored | 1,118 passed, 3 ignored |
| MSVC target from the GNU host, runner environment imitated, final `build.rs` (`msvc-20261011T171350Z`) | clean, clean, clean | 1,105 passed, 1 ignored | 1,269 passed, 2 failed, 3 ignored | 1,118 passed, 3 ignored |
| The workflow's own test step, extracted from the YAML and run as written for the smoke set, MSVC target, runner environment imitated (`step-smoke-20261011T175309Z`) | | | 1,274 listed, 2 skipped by the list, 1,269 passed, 0 failed, 3 ignored, exit 0 | |

- The two GNU smoke failures are the two tests of the skip list. On the lab PC they need a page build made from this tree: the worktree had no `web/dist` ("the page build is missing"), and the main tree's `web/node_modules` held only `.pnpm` with no packages during this slice, so no build could be made; with a copy of the main tree's `web/dist` the shell called it stale ("the page build is stale"), as its source times are older than this worktree's checkout. Neither failure touches `build.rs` (both tests were built and started the shell). They are proved by check.ps1 in the lab's own tree.
- The first GNU run (`gnu-20261011T164234Z`, before the `build.rs` host fix, which does not change the GNU path) also had two timing failures under load in the smoke set (`a_swapped_backend_is_seen_by_the_exit_watch_refused_and_never_given_the_token`, "timed out waiting for the exit watch"; `a_tool_that_outlives_its_limit_is_stopped_and_the_run_says_so`, "the tool printed pid=:"); both passed in the two later runs. The machine was shared with other waves' pytest runs at the time.
- The first MSVC-target run (`msvc-20261011T170441Z`, with `build.rs` choosing the name by target) failed every test binary at link with `LNK1181`, the finding that led to `compiled_resource()`. MSVC Build Tools 2022 (14.44) and the Windows 10 SDK 26100 were already on this PC; only the `x86_64-pc-windows-msvc` standard library was added to the 1.99.0 toolchain under `D:/dev/rustup` (`rustup target add`), nothing on C:.
- `cargo deny --locked check`: `advisories ok, bans ok, licenses ok, sources ok`, exit 0. `cargo audit`: exit 0, two allowed warnings (`proc-macro-error` unmaintained, `glib` unsound), both in the Linux GTK part of the lockfile that `deny.toml`'s Windows graph leaves out.
- `cargo fmt --check`: clean.

## Expected first-run failure modes and their fixes

The MSVC target was built and tested on the lab PC (see the evidence), but from the GNU host through `--target x86_64-pc-windows-msvc`, so build scripts and proc macros ran as GNU programs and the runner image and its session were not tried. What may still go wrong on the first push, and the fix for each, in the order the jobs meet them:

| Symptom | Likely cause | Fix |
|---|---|---|
| `rust-toolchain.toml names no channel` or a rustup error | the pin moved or rustup on the image is too old | read the log; `rustup self update` is not run on purpose, so add it as a step only if the image's rustup cannot read the pin |
| `the toolchain is not on the MSVC host` | the image's rustup default host changed | install `$channel-x86_64-pc-windows-msvc` explicitly |
| `Are you sure you have RC.EXE in your $PATH` from embed-resource | the Windows SDK is not found from the registry | add a step that puts the SDK's `bin\<version>\x64` on `PATH` (or set `RC`) before cargo |
| `LNK1181` on `resource.lib` or a test exe ending with `0xc0000139` (entry point not found) | the resource is not where `compiled_resource()` looks, or not linked into the tests | read the build script's `output` file in the log; the fix is in `build.rs`, never a skip |
| Clippy findings only on MSVC | `cfg(target_env)` code paths, or lints that differ by host | fix the code; the lints are the same `-D warnings` as on the lab PC |
| A smoke or measure test times out or reports a window | the hosted session differs from the lab PC (no screen 2, a different desktop, no WebView2 runtime) | read the test's record; if the test needs the lab PC, add it to `RUNNER_SKIPS` with that reason; if WebView2 is missing, install the Evergreen runtime in a step before the tests |
| `the skip list names ..., which is not a test of the ... set` | a test was renamed or moved | change the entry, or remove it if the test now runs on the runner |
| `cargo deny` or `cargo audit` fails | a new advisory or yanked crate since the lab PC's last run | a real finding: update the crate or record the advisory as `deny.toml` requires; never widen the ignore list to make CI green |
| `7z` not found or `found 0 nq-lab-terminal.exe` | 7-Zip missing from the image, or the installer layout read differently | call `"$env:ProgramFiles\7-Zip\7z.exe"`; list the extracted tree in the log and adjust the search |
| `the release exe grew ...` | the MSVC exe differs from the GNU-built release by more than 25% | first look at the figure: if the difference is the host, record both sizes here and set the limit from the MSVC figure of the next release |
| `cargo llvm-cov` fails (coverage job red, run still green) | instrumented test timing, or `llvm-tools` missing | report only by design; fix in a later round, the figure is not on the critical path |

After three rounds the wave's fallback applies: `desktop-check.yml` becomes dispatch-only and the failure is recorded in `docs/desktop/v04/w2b-ci-msvc__merge.md`, with D4.6 left Partly.

## Wiring for the merge (files this slice does not own)

1. `docs/desktop/ci.md` (slice ci-widen): its line 81 says "Its own pin test and section of this document describe it", but there is no section yet. Add one, `## desktop-check.yml`, with: the four jobs as listed under "Changed" above; the rule that a test is skipped on the runner only through `RUNNER_SKIPS`, with the two entries and their reason; the coverage job being report-only; and a pointer to this note for the expected first-run failures.
2. `desktop/README.md` line 131 (no slice of this wave owns it; for w9): "only one workflow exists ... `desktop-check.yml` (D4.1 ...) ... The MSVC build leg is therefore unbuilt" is stale once the wave merges. Proposed text: "Workflows: `ci.yml` (see `docs/desktop/ci.md`), `desktop-check.yml` (the MSVC leg: Clippy and tests of the three feature sets, deny, audit, exe size, report-only coverage), `webview2-drift.yml` and `desktop-release.yml`. The shipped installer is still built on the GNU host of the lab PC." Line 91 also calls the `check.ps1 -Web` group "the web group of `desktop-check.yml`": those web checks run in `ci.yml`, so it should say `ci.yml`.
3. `desktop/scripts/check.ps1` lines 1 to 5 (for w9): the header says the three workflow files "are not written yet" and calls `-Web` "the web checks of desktop-check.yml"; both should point at `ci.yml` and `desktop-check.yml` as they now are. The script's behaviour is unchanged.
4. Pins: `ci.yml` (ci-widen) pins `actions/upload-artifact` v7.0.2 (`cf430e030ddbb5b0abf93d22962f4752f3646cd9`, 7 October); this workflow pins v7.0.1 (`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`, April), the older on purpose. If the merge wants one pin per action across workflows, change the one line in `desktop-check.yml`; both are full SHAs and both pass the tests.
5. No change is needed for the test to run in CI: `ci.yml` already runs `node --test desktop/harness/tests/*.test.mjs`, which picks up `desktop-check-workflow.test.mjs`; on the runner its PyYAML and actionlint cases skip themselves and the rest run.
6. Not to commit: `web/node_modules` (a junction) and `web/dist` (a copy of the main tree's page build, used by the local smoke tests) exist in the worktree; both are git-ignored.

## Files and their fate (for the 03 Appendix A addendum)

| Path | Kind | Fate |
|---|---|---|
| `.github/workflows/desktop-check.yml` | new workflow | keep: the MSVC leg named in 04 D4.1 and D4.6 |
| `desktop/harness/tests/desktop-check-workflow.test.mjs` | new test file | keep (tests carry no addendum row) |
| `desktop/src-tauri/build.rs` | changed, new function `compiled_resource` | keep |
| `docs/desktop/v04/w2b-ci-msvc__desktop-check.md` | new note | keep |

No backend module, route or front-end folder was added.

## Unverified

- The workflow has not run on a hosted runner. The MSVC leg was tried locally only as a cross build from the GNU host, so an MSVC-host build script (rc.exe, `resource.lib`) and the hosted session (WebView2 runtime, desktop, D: drive) are untried.
- The `exe-size` job: 7-Zip is not on this PC, so reading `nq-lab-terminal.exe` out of the NSIS installer was not tried; the GNU-built 0.3.2 release exe is 3,692,544 bytes (`D:/dev/release/0.3.2/payload/release`), and an MSVC exe of the same code has never been measured, so the 25% limit is a guess.
- The `coverage` job: cargo-llvm-cov is not installed here and was not run; no Rust coverage figure exists yet. Whether it works on the GNU host stays open (critique.md finding 34); this workflow does not need it to.
- The page build step of the smoke leg (`pnpm install --frozen-lockfile`, `pnpm build`) was not run in this worktree (see above); it is the same pair of commands `ci.yml`'s web job runs.
- The rust job's `--list` check of the skip list was run for the smoke set only; the release and measure sets have no entries.
