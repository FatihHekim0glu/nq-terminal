# Wave w2b, merge: CI widened, the MSVC leg, the drift watch and the release build

Integration of the three slices (ci-widen, desktop-check, drift-release) on the branch `v04/w2b-ci-msvc`. The merge step wired the documents that the slices could not touch, checked the third slice (its builder left no report), ran the local release checks and made no git write. A release check then found gaps (below); they are fixed. Status: pushed and green on hosted runners (section "Post-push loop" at the end); the text above was written before the first run.

## What the merge changed

| File | Change |
|---|---|
| `docs/desktop/ci.md` | Three new sections (`desktop-check.yml`, `webview2-drift.yml`, `desktop-release.yml`). Fixed the stale lines: `e2e:desktop` no longer says the drift workflow runs it, the installer build is no longer "planned", the "Rules" list says which jobs may write, the Known limits say the three new workflows have not run. Two triads reworded so the prose lint passes. The `ci-rust-job.test.mjs` doc checks still pass. |
| `.github/workflows/ci.yml` | `actions/upload-artifact` moved from v7.0.2 (7 October) to v7.0.1 (`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`, resolved again with `gh api`), so all four workflows carry one pin for that action and the older, more settled release. Two lines. |
| `.github/workflows/webview2-drift.yml` | A scheduled run with no recorded state writes a warning annotation; the committed floor and the two-day schedule (see below). |
| `desktop/harness/tests/drift-release-workflows.test.mjs` | Born-failing tests for the lost-state warning, the committed floor, the two-day schedule, the attest ref gate and the gate guard (34 tests now). |
| `docs/desktop/v04/w2b-ci-msvc__drift-release.md` | Section "Added at merge" (the warning). Its test count (26), its Monday-only schedule and its attest condition are superseded by the section "Corrections to the slice note" below. |
| `docs/desktop/v04/w2b-ci-msvc__desktop-check.md` | One word in the fate table: the new function in `build.rs` is `compiled_resource`, not `test_resource_name`. |

### The drift watch could lose its state without saying so

Found while reading the third slice. The last-seen runtime version lives in an Actions cache entry. Actions drops an entry nobody used for seven days, and a cache saved on a branch is not visible from the default branch. A weekly run that lost its entry recorded a new baseline and passed, so a new WebView2 major that arrived in the gap was never reported. The `compare` step now writes `::warning title=No recorded WebView2 baseline` when the event is `schedule` and no state exists. A first run on a push or a dispatch stays quiet. Born failing: the new test failed against the old step (25 pass, 1 fail) and passes now. The state is still cache-only; moving it to a repository variable needs a write token, which the owner has not agreed (O20).

## Files outside ownership: none

Earlier in this merge three files that no slice owns were edited (`desktop/README.md`, `desktop/scripts/check.ps1`, `docs/TESTING.md`), and the drift fixer added a data file `desktop/webview2-baseline.json`. V04 rule 1 and the release check "git status lists only owned files" forbid that, and a waiver would have left the check failing. Both were fixed at the cause at the release check:

- The three files were restored to their committed text (read from HEAD with `git show`, no git write). `git status` shows none of them.
- The floor of the drift watch moved from the data file into the workflow, which the drift slice owns: `NQT_FLOOR_MAJOR: 154` in the `compare` step. The data file was deleted (it was never tracked). The tests and `docs/desktop/ci.md` follow.

What stays true on the pushed branch until the owners of those three files act: `desktop/README.md` still says only `ci.yml` exists and that `check.ps1 -Web` adds the web group of `desktop-check.yml`; the header of `check.ps1` says the three workflow files are not written; the Playwright row of `docs/TESTING.md` does not mention the Ubuntu run. `docs/desktop/ci.md` is the document that is right. Exact text for the owners (the README and `check.ps1` belong to the next wave that edits them, `docs/TESTING.md` to w9):

1. `desktop/README.md` line 91: replace "adds the web group of `desktop-check.yml`" with "adds the web group that `ci.yml` runs".
2. `desktop/README.md` Known limits, replace the entry beginning "Open: only one workflow exists" with: "Workflows (see `docs/desktop/ci.md`): `ci.yml` (web checks; script and harness tests; QA reference tests; offline browser tests; ruff; the performance trend; `cargo fmt --check`), `desktop-check.yml` (the MSVC leg: Clippy and tests of the three feature sets, deny, audit, exe size, report-only Rust coverage), `webview2-drift.yml` (weekly runtime and advisory watch) and `desktop-release.yml` (dispatch-only MSVC release build). The three added in v0.4 have not run on a hosted runner yet, so every figure so far still comes from the GNU host and the shipped installer is still built on the GNU host of the lab PC; the first MSVC run belongs to the CI step before G2 closes."
3. `desktop/scripts/check.ps1` header: "with -Web the web checks of ci.yml" in place of "desktop-check.yml"; and replace "and the three workflow files are not written yet (desktop\README.md, Known limits)." with "The web checks run in ci.yml, the Rust checks in desktop-check.yml (docs\desktop\ci.md)."
4. `docs/TESTING.md` Playwright table, offline row, platform cell: append "; `ubuntu-latest` in CI from v0.4, run with `--update-snapshots=all` because the offline baselines are git-ignored (`docs/desktop/ci.md`)" after "(not tried on Windows)".

## The third slice, checked

The drift-release builder returned no structured report, but its four files were complete and its note held evidence. Checked at merge:

- Against its task: a weekly cron and a dispatch trigger, plus a push trigger on its own path; `windows-2025`; runtime read, comparison, `advisories.mjs`; fail on a new major runtime or a newer Tauri advisory; the issue job holds `issues: write` alone and only runs when `NQT_DRIFT_ISSUES` is `on`. The release workflow is dispatch only, `--locked`, NSIS, `artefact-check.mjs`, `SHA256SUMS`, upload, no release and no signing; the attestation job holds `id-token: write` and `attestations: write` alone and runs only when `NQT_ATTEST` is `on`. All present.
- The four born-failing cases of the spec were fed to the real files by hand and restored byte for byte (`cmp`): `contents: write` at workflow level (2 tests fail), a tag trigger on the release workflow (1 fails), `--locked` removed from `cargo tauri build` (2 fail), the push-path trigger removed from the drift workflow (2 fail). Base 25 of 25.
- `advisories.mjs` accepts the flags the workflow passes (`--state`, `--feed-file`, `--ack`).

## Checks run

| Check | Result |
|---|---|
| `node --test desktop/harness/tests/*.test.mjs` (HEAVY slot held, stand-in lab as in `ci.yml`; the PyYAML cases ran with the lab interpreter) | 404 tests, 403 pass, 0 fail, 1 skipped by design (the real-data launch refuses outside the main tree, rule 14) |
| `node --test desktop/scripts/tests/*.test.mjs` | 226 tests, 226 pass |
| The four workflow test files, after the last edit | 16 + 15 + 34 + 14 pass (`ci-rust-job`, `ci-workflow`, `drift-release-workflows`, `desktop-check-workflow`), none skipped |
| actionlint 1.7.12 over `.github/workflows/*.yml` (four files) | clean |
| `web/src/copy/copyRules.test.ts` and `web/scripts/docsSync.test.ts` | 43 pass |
| House prose lint on `ci.md` and the four notes, and em or en dash and banned-term greps over every changed file | PASS |
| Free space on C: | 426.5 GB at the start and at the end; no fall |
| `git status` | only files owned by the slices or by `merge_owns`: `ci.yml`, `desktop-check.yml`, `webview2-drift.yml`, `desktop-release.yml`, `build.rs`, `ci.md`, the four test files and the four notes under `docs/desktop/v04/`. `web/node_modules` (junction) and `web/dist` stay git-ignored |

Notes on the run. The worktree's `web/node_modules` is a junction to the main tree's, which held no top-level packages during this step (a reinstall appeared to be in progress there). For the vitest run only, the junction was pointed at wave w2a's installed folder, read only, and then set back to the main tree's. Nothing was installed.

## Fixed at the release check

Four reports from the release check were taken at their cause. Each was real on inspection.

1. The attestation job was gated only by the variable `NQT_ATTEST`, and a dispatch from any branch runs that branch's copy of the file, so a work-in-progress build would be signed like a main build. Its `if` now also needs `github.ref == 'refs/heads/main'`. Born failing: the gate test failed before the edit; a second test strips the condition from a copy and must see it missing. `docs/desktop/ci.md` gives the verify command (`gh attestation verify ... --source-ref refs/heads/main`). A `release` environment limited to main with a required reviewer would make the rule server-side; it needs repository settings only the owner can make, so it is not added.
2. The write-job guard accepted any `if:` that contained the gate text, so `... || true` passed. `gateProblems` now splits on `&&`, needs the gate and every other required term as whole terms and rejects `||`, `!` and grouping. Born failing: `|| true` on `attest`, the reordered drift condition, a negation, a dropped push exclusion and a doubled equals are all named.
3. The drift watch kept its only baseline in an Actions cache entry; the weekly cron matched the seven-day eviction, and a missing state was only a warning, so a new WebView2 major passed green. Now the baseline is the larger of a committed floor (`NQT_FLOOR_MAJOR: 154` in the `compare` step, the major seen on the lab PC) and the saved state; a higher current major fails on any event unless `accept` is ticked, and a floor that is missing, not a number or below 1 fails closed. The cron is Monday and Thursday. Born failing: with the old step, 6 of 34 tests failed (no state and major 155 over floor 154 on schedule, push or dispatch; a missing floor; an older state outvoting the floor; the schedule and floor literal checks). After the first of these fixes a concurrent edit lost those tests; the merge step rewrote them, saw 8 fail against the file-based step and 34 of 34 pass against the final one. The major on the hosted `windows-2025` image is not known: if it is already above 154 on the first push, the first scheduled run correctly goes red and needs one `accept` run and a bump of the floor.
4. The out-of-ownership edits (section above).

One more defect of the same kind in the test file: after fix 1 two born-failing cases still replaced text that no longer existed (`vars.NQT_ATTEST == 'on' }}`), so `node --test` failed on them. They now replace the real condition and assert the replacement happened (`notEqual`).

## Corrections to the slice note

`w2b-ci-msvc__drift-release.md` was written before these fixes. Read it with these changes: the schedule is Monday and Thursday at 06:17 UTC, not Monday only; the test file has 34 tests, not 26; the `attest` job runs only when `NQT_ATTEST` is `on` and the ref is `refs/heads/main`; the `compare` step reads the committed floor `NQT_FLOOR_MAJOR` (see fix 3) and fails closed without it.

## Rust coverage figure

Rust coverage, default feature set, MSVC (report only): lines 50.83%, functions 48.41%, regions 50.11%. Read from the `coverage` job of desktop-check run 38166147800 (the same figures in runs 38164591015 and 38165243344). For w9 to fold into `docs/TESTING.md`.

## For the 03 Appendix A addendum

No backend module, route or screen folder was added by the wave. Files added or changed, with their fate:

| Path | Kind | Fate |
|---|---|---|
| `.github/workflows/ci.yml` | widened | keep |
| `.github/workflows/desktop-check.yml` | new | keep; dispatch-only fallback after three failed rounds |
| `.github/workflows/webview2-drift.yml` | new | keep |
| `.github/workflows/desktop-release.yml` | new | keep; gets a tag trigger only after the owner accepts a CI-built MSVC release (O20) |
| `desktop/src-tauri/build.rs` | changed (`compiled_resource`) | keep |
| `desktop/harness/tests/ci-workflow.test.mjs`, `ci-rust-job.test.mjs`, `desktop-check-workflow.test.mjs`, `drift-release-workflows.test.mjs` | tests | keep |
| `docs/desktop/ci.md`, `docs/desktop/v04/w2b-ci-msvc__*.md` | docs | keep |

## What the owner switches on (O20)

Both gates are repository variables, unset today, so both write jobs are skipped: `NQT_DRIFT_ISSUES` = `on` lets the drift watch open or update an issue; `NQT_ATTEST` = `on` attests the release build. Neither exists as a setting yet.

## Open items, said plainly

1. No workflow has run on GitHub. The manager pushes `v04/w2b-ci-msvc`; the post-push loop reads the first runs of `ci.yml` (qa, offline-e2e, ruff, perf-trend, the coverage step), `desktop-check.yml` and `webview2-drift.yml` (its push trigger fires only if that file is in the pushed change). `desktop-release.yml` has no push trigger and runs only by hand.
2. `desktop-check.yml`: the MSVC leg was tried only as a cross build from the GNU host. The expected first-run failures and their fixes are tabled in `w2b-ci-msvc__desktop-check.md`. After three failed rounds it becomes dispatch-only and D4.6 stays Partly. The `exe-size` job (7-Zip not on this PC, no MSVC exe ever measured, the 25 percent limit is a guess) and the `coverage` job were never run, even locally.
3. `webview2-drift.yml`: whether `windows-2025` carries the WebView2 runtime or only Edge is not known; the step falls back to Edge and otherwise fails closed. The cache-held state is the weak point described above.
4. `desktop-release.yml`: never run on MSVC. `artefact-check.mjs` accepts any DLL in the system folder, so a dynamic `VCRUNTIME140.dll` import passes on the runner; whether to link the C runtime statically is for w6. The `SHA256SUMS` format was not fed to `subject-checksums`; the attestation uses `subject-path`.
5. `ci.yml`: ruff runs only the fatal-error rules (E9, F63, F7, F82); 14 default-rule findings and 89 unsorted-import files in `backend` need a backend cleanup by someone else before it widens (then `ci.md` and `ci-workflow.test.mjs` change with it). The offline suite runs with `--update-snapshots=all`, so no pixel comparison happens in CI. The perf-trend alert is the existing budget, not a percentage over the last run. The `qa` job and a full vitest were not run on this PC.
6. Wave w2a must add a `test:coverage` script that forwards extra arguments and writes `web/coverage/coverage-summary.json` (the `json-summary` reporter); until then the coverage step prints a notice and passes.
7. Repository variables and the register entry for O20 (two of its switches are wired here, the CodeQL permission is not) are the owner's and the manager's.
8. Owner and manager settings still open: a GitHub environment named `release` (limited to main, one required reviewer) and `environment: release` on the attest job; the repository variables `NQT_DRIFT_ISSUES` and `NQT_ATTEST`. A release dispatch must be run on main for an attestation to exist.

## Post-push loop (hosted runs of v04/w2b-ci-msvc)

Runs, all at `https://github.com/FatihHekim0glu/nq-terminal/actions/runs/<id>`:

| Run | Workflow | Commit | Result |
|---|---|---|---|
| 38163832244 | ci | c1c9ebe | cancelled by the next push (every job finished so far green, offline e2e included) |
| 38163832316 | desktop-check | c1c9ebe | failure: 4 tests failed on the runner (below) |
| 38163832309 | webview2-drift | c1c9ebe | success (first branch run) |
| 38164590958 / 38164591015 | ci / desktop-check | 882d8c4 | ci cancelled by the next push; desktop-check failure: one smoke test |
| 38165243325 / 38165243344 | ci / desktop-check | fa1854c | ci success; desktop-check failure: one smoke test |
| 38166147796 / 38166147800 | ci / desktop-check | f447f72 | both success |

Fix rounds (three of four used):

1. `882d8c4` fix(desktop). On the hosted runner the user is the machine's RID 500 account, which SDDL writes as the alias `LA`. The owner-only lock check (`reads.rs`) compared the full SID only, so the user's own rights were refused (3 `reads::` tests), and the DACL test of the data folder (`window_folders.rs`) missed the trustee. `sddl_alias_of` now maps a machine SID ending in -500 to `LA`; a new test covers accept and reject. A real defect, not an environment skip: the built-in Administrator on any PC hit it.
2. `fa1854c` ci. `zoom_and_size_reach_the_page_and_the_window` asks for a 1280x800 window; the hosted desktop is smaller and the shell fits the window to it (inner 1028x749 at scale 1). Added to `RUNNER_SKIPS` with that reason (smoke set), as the failure table above foresaw; the lab PC run covers it.
3. `f447f72` ci. `the_page_gets_the_shell_object_and_no_new_window` saw no `__NQT_SHELL__`: the smoke page can start loading before the asynchronous script registration finishes. The test now waits for the `window_hooks` log line and reloads the page before it reads the object (the production shell navigates only after the backend is up, so the race is a test one). The Tests step now runs `cargo test --no-fail-fast` so one run names every failing test; the guard test and `ci.md` follow. This fix was written without a local smoke run (windres is not on this PC's PATH for the smoke build); the hosted run is its proof.

Figures from the green run: release exe 3,543,552 bytes (MSVC) against 3,698,688 bytes (desktop-v0.3.3, GNU host), change -4.2%, limit +25%. The drift watch read WebView2 runtime 153.0.4234.48 on `windows-2025` (from the HKLM key), below the committed floor 154, so a scheduled run on the hosted image stays green until the runner image moves to 154 or later.

Left as it was: nothing failed for a reason outside the repo. `desktop-check.yml` is not dispatch-only; D4.6 can move on this evidence. `desktop-release.yml` was not dispatched (its exit criterion is only that it is written).

Owner settings, none created by this loop: repository variables `NQT_DRIFT_ISSUES` = `on` and `NQT_ATTEST` = `on` (unset today, so both write jobs are skipped); a GitHub environment `release` limited to main with one required reviewer, then `environment: release` on the attest job; the O20 register entry; the web `test:coverage` script from wave w2a (the web coverage step prints a notice until then).
