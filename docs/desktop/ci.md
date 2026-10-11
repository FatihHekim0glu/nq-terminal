# Continuous integration

The workflow `.github/workflows/ci.yml` (REL-03 of the release research, widened in v0.4) runs every check of this repository that needs no private lab data, on hosted runners. It runs for a push to any branch, for a pull request to `main` and by hand (`workflow_dispatch`). It is a safety net for the web app, the desktop scripts, the QA reference tests, the offline browser tests, the backend's syntax and the format of the Rust shell. It builds no installer, signs nothing and publishes nothing. Clippy, the Rust tests and the MSVC build are in a second workflow, `desktop-check.yml` (see "The Rust job"). Two more workflows sit beside them: `webview2-drift.yml`, a weekly watch on the WebView2 runtime and on Tauri advisories, and `desktop-release.yml`, a dispatch-only MSVC release build. Each has its own section below.

A push to a branch with an open pull request starts two runs, one for the push and one for the pull request; their concurrency groups differ, so neither cancels the other. A newer push cancels the older run of the same branch.

## What runs

Six jobs. The `windows` job, `windows-2025`, has a 30 minute limit; its steps, in order:

| Step | Command (from the repository folder) | What it proves |
|---|---|---|
| Check out | `actions/checkout` into a folder named `terminal` | The tree as pushed. |
| Set up pnpm and Node | `pnpm/action-setup` (version from `web/package.json`), `actions/setup-node` 24 with the pnpm store cached | The pinned toolchain. |
| Prepare scratch folder | creates `D:\dev\tmp` | Some tests write scratch files there. |
| Install | `pnpm install --frozen-lockfile` in `web` | The lockfile is complete and the install is reproducible. |
| Web type checks | `pnpm test:types`, then `pnpm test:e2e-types` | `tsc -b` for the app and the type projects of every end-to-end suite. |
| Contract hash | `pnpm check:api` | The generated API types match `contract/openapi.json`. |
| Vitest | `vitest run`, minus three tests that need the lab (below) | The unit and component suites, about 7,400 tests. |
| Web test coverage | `pnpm test:coverage` with the same exclusions, when `web/package.json` has that script (wave w2a adds it); until then a `::notice` says there is none and the step passes | The coverage figure. A failing run fails the job. |
| Upload coverage summary | `actions/upload-artifact` of `web/coverage/coverage-summary.json` | The summary is kept for 30 days. The step may fail without failing the run: a lost upload is not a failed test. |
| Web build | `pnpm build` | `tsc -b`, the Vite build, the bundle budgets and the build stamp. |
| Desktop script tests | `node --test desktop/scripts/tests/*.test.mjs` | The artefact check, the dist scan, the installer hooks and the bootstrapper check. |
| Stand-in lab | `python -m venv` under the runner's temp folder, `NQT_LAB` pointing at it | The harness runs the lab's interpreter for its window watch, a standard-library script. The folder holds no lab data. |
| Desktop harness tests | `node --test desktop/harness/tests/*.test.mjs` | The measurement harness's own tests, among them the pin tests of this workflow. |
| Release script self-tests | `scripts/tests/release_check.tests.ps1`, `scripts/tests/smoke_real.tests.ps1`, `desktop/scripts/install-test.ps1 -SelfTest`, `desktop/scripts/tests/install-test.tests.ps1`, `desktop/scripts/tests/upgrade-owner.tests.ps1`, `desktop/scripts/tests/close-app.tests.ps1` and `desktop/scripts/tests/owner-session.tests.ps1` | The born-failing tests of the release scripts. They install nothing. The upgrade test reads the owner's real install only when one exists for the user, which a hosted runner never has, so that part skips itself and says so. `desktop/harness/tests/ci-workflow.test.mjs` fails when a new `*.tests.ps1` under `scripts/tests` or `desktop/scripts/tests` is not listed in the workflow. |

The other five jobs run beside it:

| Job | Runner | Limit | What it runs |
|---|---|---|---|
| `qa` | `windows-2025` | 20 min | `uv run --frozen pytest` in `qa`, with uv 0.10.2 and Python 3.12 from `setup-uv`, the uv cache keyed on `qa/uv.lock`. The 333 reference tests need no lab. Windows, because the golden files were taken there. The checkout folder is named `terminal`, which the one layout-bound test (`test_the_default_dump_folder_is_under_terminal_qa`) needs. `--frozen`: a stale lockfile fails the job. |
| `offline-e2e` | `ubuntu-latest` | 30 min | `pnpm e2e:offline --workers=2 --update-snapshots=all` in `web`: the `offline` and `offline-demo` projects, about 190 tests, against the Node demo API. Chromium is installed by `playwright install --with-deps chromium`, and `~/.cache/ms-playwright` is cached by the lockfile hash. On failure the results folder is uploaded for 7 days (the upload may fail without failing the run). |
| `ruff` | `ubuntu-latest` | 10 min | `uvx ruff@0.17.0 check --select E9,F63,F7,F82 --output-format github backend` from the repository folder, so ruff finds `backend/ruff.toml` as it is. See "The ruff job". |
| `perf-trend` | `ubuntu-latest` | 30 min | `pnpm e2e:offline:perf`, report only. See "The performance trend". |
| `rust` | `windows-2025` | 15 min | `cargo fmt --check`. See "The Rust job". |

The same commands are the local stand-in: `desktop/scripts/check.ps1 -Web` runs the web group and the Rust set on the lab PC.

### Screenshot baselines on a fresh runner

The offline screenshot baselines are git-ignored and belong to one machine (`web/e2e/__screenshots__/offline-<platform>`, `docs/TESTING.md`). A fresh runner has none, and Playwright fails a screenshot that has nothing to compare with. The `offline-e2e` job therefore runs with `--update-snapshots=all`: it writes the baselines and compares nothing, and every other assertion of every spec (requests, text, roles, axe, keyboard flows) still runs and fails the job. Pixel comparison stays a job of the machine that owns the baselines. If the owner commits Linux baselines later, drop the flag and the job compares them.

## What does not run

| Left out | Why |
|---|---|
| The backend suites, the crosscheck and the real-data smoke | The backend imports the private `nq_lab` package, which is not in this repository. |
| `scripts/start/startPs1.test.ts` and `scripts/start/sessionPage.browser.test.ts` | Both start the lab's backend through `start.ps1`. |
| The test "reads src/nq_lab/paper_plumbing.py and finds the same text" in `src/grids/JournalTable.model.test.ts` | It reads a Python source file of the lab. The other tests of that file run. |
| Playwright against the fixture backend (`e2e`, `e2e:perf`, `e2e:desktop`) | `e2e` and `e2e:perf` need the lab's backend; `e2e:desktop` needs a built `smoke` shell and WebView2 (the full T8 run stays on the lab PC; `webview2-drift.yml` only watches the runtime version, see its section). The offline projects run in `offline-e2e`, and the offline timing project in `perf-trend`. |
| Pixel comparison of the offline screenshots | See "Screenshot baselines on a fresh runner". |
| Ruff's default rules and its import rule on `backend` | Not clean today; see "The ruff job". |
| Clippy, the Rust unit tests, the NSIS build and the install test | Clippy and the Rust tests run in `desktop-check.yml`; the installer build is `desktop-release.yml` (REL-07, dispatch only), and the install test is not in CI. Only `cargo fmt --check` runs here (the `rust` job). |
| Measurements (gate G2) | They need the owner's PC, alone, in a quiet window. The `perf-trend` job is a trend on a shared runner, not a measurement. |

The three excluded tests are named in the workflow, so a change that renames them shows up in review. Every other vitest test still runs.

## The ruff job

`ruff` runs `ruff check --select E9,F63,F7,F82 backend` with ruff 0.17.0, pinned, through `uvx` (uv 0.10.2 from `setup-uv`). The rules are ruff's fatal-error set: syntax and read errors (E9), invalid comparisons and assertions (F63), statements in the wrong place such as a return outside a function (F7) and undefined names (F82). The job changes nothing in `backend` and reads `backend/ruff.toml` as it is (line length 120 and the import settings, which this rule set does not use).

Why not the plain `ruff check backend`. Read on 11 October 2026 with ruff 0.15.0 and 0.17.0: the default rules report 14 findings (12 unused imports (F401) and 2 redefinitions (F811), in 12 files, most of them in `backend/tests`), and the import rule that `backend/ruff.toml` and `CONTRIBUTING.md` name (`--select I`) reports 89 files with unsorted imports. A job that is red from the start teaches nobody to read it, and the change that would make it green is a change to `backend`, which this workflow does not make. The fatal-error set passes on both versions today. When the backend is cleaned (the F401 and F811 findings are `ruff check --fix` removals, the import order is `ruff check --select I --fix backend`), widen the `--select` list, drop it for the plain command, and change this section and `ci-workflow.test.mjs` together.

## The performance trend

`perf-trend` runs `pnpm e2e:offline:perf` (the `offline-perf` project, one worker: HOME first render under 1.5 s and the 8,411-row fills grid under 500 ms, the GIP pan test skipped because the demo serves no 1-minute bars). It is report only:

- The job has `continue-on-error: true` and so does the perf step, so a miss, a timeout or a setup failure cannot fail the workflow run.
- A missed budget writes a warning annotation (`::warning title=Offline performance trend`) on the run.
- The numbers the budgets print (`perf <name>: <json>` lines) go to the run's step summary, so a trend can be read from run to run.

The alert threshold is the budget itself, the same ceilings the PC enforces (`web/e2e/perf/trace.ts`, `BUDGETS`). A shared runner is noisier than the lab PC, which is why a miss warns and never blocks. A stricter alert (a percentage over the last run, as `github-action-benchmark` does) needs somewhere to keep the last run, which a read-only workflow has not got; add it when the repository decides where the history lives.

## The Rust job

Job `rust` (`rust format check`, 15 minute limit, `windows-2025`) checks out the tree into `terminal`, installs the toolchain that `desktop/src-tauri/rust-toolchain.toml` pins (the channel is read from that file, with the `rustfmt` component and the minimal profile) and runs `cargo fmt --check` in `desktop/src-tauri`. It reads no secret, widens no permission and uses the same SHA-pinned checkout as the other jobs. The local half is the same command (`cargo fmt --check` in `desktop/src-tauri`, which `check.ps1` also runs as its `fmt` step); `desktop/harness/tests/ci-rust-job.test.mjs` runs it, parses the workflow and checks the rules below.

Why only the format check here. The crate had never been built on the hosted MSVC host when this job was written: every build so far, the shipped installers included, came from the GNU host of the lab PC, which has no MSVC and no way to try one (README, Known limits). The build script is written for the GNU linker (it hands gcc a `-B` prefix to shadow MinGW's default manifest), the tests link the same way, and a lint or test run needs the whole Tauri and WebView2 dependency tree compiled first. A first run of that job on a hosted runner could therefore fail for reasons that have nothing to do with the code, and a job that is red from the start teaches nobody to read it. So this job holds the one check that needs no build and behaves the same on either host.

Where the rest lives. `desktop-check.yml` (written in v0.4, wave w2b) carries clippy -D warnings (`cargo clippy --all-targets --locked -- -D warnings`) for the three feature sets, `cargo test --locked`, `cargo deny`, `cargo audit` and the first MSVC build, with the Cargo registry cached and a Rust coverage figure from that leg. The next section describes it, and `desktop-check-workflow.test.mjs` pins it (REL-07 is its release counterpart, `desktop-release.yml`). `ci-rust-job.test.mjs` still fails when a clippy, test or build step is added to `ci.yml`, so the two workflows do not drift into each other.

## desktop-check.yml

`.github/workflows/desktop-check.yml` is the shell's first MSVC leg (D4.1, D4.6; grade G-03). It runs on a push to any branch (`branches: ['**']`) and by hand, with `contents: read` and a newer push cancelling the older run. Four jobs, all on `windows-2025`, whose hosted rustup has the MSVC host (the first step proves it from `rustc -vV`):

| Job | What it runs |
|---|---|
| `rust` | A matrix over three feature sets (release, smoke, measure), `fail-fast: false`. For each: the toolchain from `rust-toolchain.toml`, the Cargo registry cached on `Cargo.lock`, a stand-in lab (a plain virtual environment under the runner's temp folder), `cargo clippy --all-targets --locked <set> -- -D warnings` and `cargo test --locked --no-fail-fast <set>` (so one run lists every failing test, not the first). The smoke set builds the page first (`pnpm install --frozen-lockfile`, `pnpm build`), because the shell refuses a lab with no `web/dist`. |
| `supply-chain` | `cargo deny --locked check` (0.20.2) and `cargo audit` (0.22.2), installed by a SHA-pinned `taiki-e/install-action`. |
| `exe-size` | Builds the release exe, reads the latest release's exe out of its installer and fails when the new one is more than 25 percent larger. The limit is a first guess, since no MSVC exe has been measured. |
| `coverage` | Report only: `cargo-llvm-cov` 0.9.1 on the default set, uploaded as the artefact `rust-coverage` with the figure in the run summary. It has `continue-on-error: true` and nothing waits on it. |

The runner skip list. A test is left out of the runner's run only through the `RUNNER_SKIPS` variable of the workflow, one line per test with its sets and its reason, and every test step expands it into `--skip <name>` with `--exact`. The `rust` job lists each set's tests first and fails when an entry names no test, so a rename cannot leave a dead skip behind. Today five smoke tests are listed: `one_close_sent_the_dotnet_way_ends_the_app_through_its_own_close` and `smoke_build_stays_hidden_through_home_and_close` start this tree's real backend in a lab derived from the owner's `nq_lab` sources, and `real_backend_store_export_flush_on_close_and_the_next_launch` and `a_shell_attaches_to_a_real_backend_and_never_stops_it` need the lab's own terminal folder; only the lab PC has any of these. The fifth, `zoom_and_size_reach_the_page_and_the_window`, asks for a 1280x800 window, and the hosted desktop is smaller (first run: inner 1028x749), so the shell fits the window down and the size check cannot hold there. Tests that skip themselves (a printed `SKIPPED:` and a green return) and `#[ignore]`d tests are not on the list; the Tests step counts both in the run summary. Nothing else in the workflow skips or un-ignores a test, and `desktop-check-workflow.test.mjs` fails on a literal `--skip`, on running ignored tests (`--ignored`, `--include-ignored`) and on `continue-on-error` anywhere but the coverage job.

`build.rs` now links the compiled resource (the combined manifest above all) into the integration tests on every Windows target, as it already did on GNU, so an MSVC test binary that loads Tauri's menu code starts. The `-B` shadow of MinGW's default manifest stays GNU only.

The expected first-run failures and their fixes are tabled in `docs/desktop/v04/w2b-ci-msvc__desktop-check.md`. After three failed rounds the workflow becomes dispatch-only and D4.6 stays Partly.

## webview2-drift.yml

`.github/workflows/webview2-drift.yml` (D5.3; risks T8 and T9) runs every Monday and Thursday at 06:17 UTC (twice inside the seven days after which Actions evicts an unread cache entry), by hand (with an `accept` box) and on a push that touches that file alone. Schedule and dispatch only ever run from the default branch, so the push trigger is what lets its first run happen on a branch.

Job `drift` (`windows-2025`, 15 minutes, read-only token):

- It reads the runner's WebView2 runtime version from the registry (the runtime, else Edge stable, whose build the runtime follows) and compares it with the version of the last clean run. A new major version fails the run. A runner with neither fails with "no WebView2 runtime": a check that cannot read the runtime never passes.
- It runs `desktop/scripts/advisories.mjs` over the advisory feed of `tauri-apps/tauri`, read through `gh` with the job token. A newer advisory that touches IPC, capabilities or downloads fails the run.
- The last-seen state travels in an Actions cache entry and is saved only after a clean or accepted run, so a drift stays red every week until someone runs the workflow by hand with `accept` ticked. A scheduled run that finds no state (an entry unused for seven days is evicted, and a cache saved on a branch is not seen from the default branch) writes a warning annotation and checks the runtime against the committed floor (`NQT_FLOOR_MAJOR` in the compare step of the workflow, the last accepted major): a higher major fails the run, so a lost cache entry cannot hide a new major. After accepting a new major, raise `NQT_FLOOR_MAJOR` in a commit.

Job `issues` opens or updates one issue when the watch fails. It is the only job with a write permission (`issues: write`), runs no action, never runs on a push, and exists only when the repository variable `NQT_DRIFT_ISSUES` is `on` (owner decision O20; unset today).

The full T8 suite (the offline project in a real window on the smoke build) stays on the lab PC.

## desktop-release.yml

`.github/workflows/desktop-release.yml` (D5.4; REL-07; grade G-22) runs on `workflow_dispatch` only, with one input, the version. It has no tag, push or schedule trigger until the owner accepts a CI-built MSVC release in place of the local GNU build (O20).

Job `build` (`windows-2025`, 75 minutes, read-only token, no cache, no secret): checks the version against `Cargo.toml` and `tauri.conf.json` and the lock file for an updater plugin, installs the pinned toolchain and proves the MSVC host, installs `tauri-cli` 2.12.1 with `--locked`, checks the release feature set (no smoke, measure or devtools), runs `cargo tauri build --bundles nsis -- --locked` with the same `--remap-path-prefix` set as `build-release.ps1`, assembles the folder `build-release.ps1` makes, runs `desktop/scripts/artefact-check.mjs`, writes and re-reads `SHA256SUMS`, and uploads the folder as one artefact for 14 days. It makes no GitHub release and signs nothing; the installer a person ships is still built on the lab PC.

Job `attest` signs the installer, the exe and `SHA256SUMS` by digest through GitHub's artefact attestations. It exists only when the repository variable `NQT_ATTEST` is `on` (unset today) and the run is on `refs/heads/main`, holds `id-token: write` and `attestations: write` and nothing else, and runs exactly two actions. The ref condition matters because a dispatch can be started on any branch and runs that branch's own copy of the file: without it a work-in-progress build would be signed like a main build.

To verify a downloaded file, pin the signer workflow and the source ref as well as the repository (`--repo` alone accepts an attestation from any branch):

```
gh attestation verify <file> --repo FatihHekim0glu/nq-terminal --signer-workflow FatihHekim0glu/nq-terminal/.github/workflows/desktop-release.yml --source-ref refs/heads/main
```

A GitHub environment named `release`, restricted to the `main` branch with a required reviewer, would make the same rule a server-side one; it is not set up today.

The two variables are repository settings (Settings, then the Actions variables page). Notes: `docs/desktop/v04/w2b-ci-msvc__drift-release.md`.

## Rules the workflow keeps

These follow decision C3-2 and the supply-chain notes of the release research. `desktop/harness/tests/ci-rust-job.test.mjs` holds each as a guard and feeds it the broken state it must refuse.

- `permissions: contents: read` for the whole workflow, and no job widens it.
- No secrets. The workflow reads none and the checkout does not keep the token (`persist-credentials: false`).
- Every action is pinned by its full commit SHA, with the release in a trailing comment. A tag is never used.
- A push to any branch runs the workflow, so a branch filter must keep `release/**`, `desktop/**` and every other family (`branches: ['**']`). Pull requests to `main` and `workflow_dispatch` stay.
- Every Windows job runs on `windows-2025`, the image `docs/desktop/03_migration_plan.md` names, so a change of the `windows-latest` label cannot move the runner under the project.
- A newer push to the same branch or pull request cancels the run it supersedes (`concurrency` with `cancel-in-progress`).
- No test swallows a failure. `continue-on-error` is allowed on an upload step and in the report-only `perf-trend` job, and nowhere else; `|| true` is allowed nowhere.
- Nothing is signed, uploaded for release or published by `ci.yml`. It writes only inside the runner and to the run's own artefacts. The other three workflows keep the same read-only token; their only write jobs are the two variable-gated ones above (`issues` in `webview2-drift.yml`, `attest` in `desktop-release.yml`).

To move a pin, resolve the new tag to its commit (`gh api repos/<owner>/<name>/git/ref/tags/<tag>`, and for an annotated tag read the tag object once more), change the SHA and the comment together, and run the check below.

## Two things the layout depends on

- The checkout folder is named `terminal`, which is where the lab keeps this tree as `nq-lab/terminal`. The web tests no longer depend on the name (the dev proxy's state folder and the fixture folder of the end-to-end config are checked relative to the tree), but the QA test that expects its folder's parent to be named `terminal` still does, so every job keeps the name.
- The scratch tests use `D:\dev\tmp`. The hosted image has a `D:` drive. If it ever has none, the step substitutes the runner's temp folder for it.

## Checking the workflow locally

1. Lint it: `actionlint .github/workflows/ci.yml` (a release build of actionlint is enough; on the lab PC one sits under `D:\dev\tools`). Without it, parse the file with any YAML reader.
2. Run the pin tests: `node --test desktop/harness/tests/ci-workflow.test.mjs desktop/harness/tests/ci-rust-job.test.mjs`.
3. Run the same commands from a clean copy of the tree named `terminal`, with the lab hidden: set `USERPROFILE` to an empty folder and `NQT_LAB` to a folder holding a plain virtual environment, then run the steps in the table. The `terminal` name matters for the QA test, as above.
4. The tree must be a Git repository: two harness tests and the release script tests read `git rev-parse HEAD`.

## Known limits

- The first two jobs have run on hosted runners since REL-03 (about 7 to 12 minutes a run). The jobs added in v0.4 (`qa`, `offline-e2e`, `ruff`, `perf-trend`), the coverage step and the move to `windows-2025` were checked on the lab PC only with `actionlint`, the pin tests and a local run of ruff; they have not run on a hosted runner at the time of writing, so a first run may need a round of fixes. Known unknowns: whether the QA golden comparisons hold on the hosted image, whether `playwright install --with-deps` and the `offline-e2e` specs behave on `ubuntu-latest` (the suite is documented for macOS and Linux and was last run on a Mac), and the arguments `pnpm test:coverage` accepts once it exists.
- `windows-2025` is pinned on purpose; the moving `windows-latest` label is not used. When GitHub retires the image, move the pin in one commit and let the pin test follow.
- `desktop-check.yml`, `webview2-drift.yml` and `desktop-release.yml` have not run on a hosted runner at the time of writing (see each section and the wave notes under `docs/desktop/v04/`). The `exe-size` and `coverage` jobs were not run even locally.
- Ruff's own default rules and import order are not enforced on `backend` (see "The ruff job").
- The shipped installer is still built on the lab PC with the GNU toolchain. This workflow proves the source and the scripts, not the binary.
