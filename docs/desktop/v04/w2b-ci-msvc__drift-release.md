# Wave w2b, slice drift-release: the WebView2 drift watch and the dispatch-only MSVC release build

Roadmap items: D5.3 (the weekly drift workflow), D5.4 (the release workflow on MSVC with `--locked`), grade G-19 and G-22, risks T8 and T9, owner decision O20. Two workflows and one test file. Nothing here touches the shell, the backend or the lab.

## Files and their fate (for the 03 Appendix A addendum)

| File | Fate |
|---|---|
| `.github/workflows/webview2-drift.yml` | New. Keep. Weekly and on dispatch, plus a push trigger on its own path so that its first run happens on the wave branch. |
| `.github/workflows/desktop-release.yml` | New. Keep. Dispatch only. No tag trigger until the owner accepts a CI-built MSVC release (O20). |
| `desktop/harness/tests/drift-release-workflows.test.mjs` | New. Keep. 26 tests, node built-ins only. It reads the two workflows as text, runs two of their steps for real under PowerShell, and runs actionlint where the machine has it. |
| `docs/desktop/v04/w2b-ci-msvc__drift-release.md` | This note. |

No backend module, route or screen folder is added, so 03 Appendix A gets no row.

## The drift watch (`webview2-drift.yml`)

Triggers: every Monday at 06:17 UTC, `workflow_dispatch` (with an `accept` box), and a push that touches `.github/workflows/webview2-drift.yml` alone. Schedule and dispatch only ever run from the default branch (GitHub Docs, "Events that trigger workflows"), so without the push trigger the first run could not happen on the wave branch.

Job `drift`, on `windows-2025`, 15 minutes, read-only token:

1. Check out, set up Node 24.
2. Restore the last clean state from an Actions cache entry (`actions/cache/restore`, newest key with the prefix `nqt-drift-state-`).
3. `webview2` step: read the runtime version from the registry (WebView2 client id under HKLM or HKCU, else Edge stable, whose build the runtime follows). A runner with neither fails with "no WebView2 runtime"; a check that cannot read the runtime never passes.
4. `compare` step: first run records the baseline (a scheduled run that finds no state also writes a warning annotation, because an evicted cache would otherwise hide a drift); a build inside the same major is recorded and noted; a **new major fails the run** and leaves the recorded version alone. A dispatch with `accept` ticked records the new major and passes.
5. `advisories` step (runs even if step 4 failed, so one run reports both): `gh api repos/tauri-apps/tauri/security-advisories --paginate` with the job token, handed to `desktop/scripts/advisories.mjs --feed-file`, with `--state` in the carried folder. An advisory newer than the recorded date that touches IPC, capabilities or downloads fails the run (exit 1); a feed that cannot be read fails it (exit 2). The feed goes through `gh` with the job token because an anonymous call from a shared runner address is rate limited, and the script itself sends no token.
6. Save the state (`actions/cache/save`, `if: success()`). Only a clean or accepted run moves the state, so a drift stays red every week until someone accepts it.

Job `issues` (the only write job): `issues: write` and nothing else, no checkout, no action, `if` the repository variable `NQT_DRIFT_ISSUES` is `on` and the drift job failed and the event is not a push. It opens an issue titled "WebView2 or Tauri drift: the weekly watch failed" with the run address, or comments on the open one. Everything it uses comes through `env`.

The full T8 suite (the offline project in a real window, on the smoke build) stays on the lab PC; wave e1a-evidence-033 runs it on runtime 154.0.4258.62. The Playwright pass of T8 on the runner is not done here, as the slice brief says.

## The release build (`desktop-release.yml`)

Dispatch only, one input `version` (three numbers). Job `build` on `windows-2025`, 75 minutes, read-only token, no cache, no secret:

1. Check out, Node 24.
2. Version check: the input equals the version of `Cargo.toml` and `tauri.conf.json`, `createUpdaterArtifacts` is false, `Cargo.lock` holds no updater plugin (the first checks of `build-release.ps1`).
3. Install the toolchain pinned in `rust-toolchain.toml`, carried to later steps as `RUSTUP_TOOLCHAIN`; the host must read `x86_64-pc-windows-msvc`.
4. `cargo install tauri-cli --version 2.12.1 --locked` (the version of `docs/desktop/d0_results.md`), then read back.
5. Feature check with `cargo tree -e features --locked -i nq-lab-terminal` and `-i tauri`: no smoke or measure feature, no tauri devtools.
6. `cargo tauri build --bundles nsis -- --locked` with the same `--remap-path-prefix` set as `build-release.ps1` (runner temp, workspace, user profile, cargo home, rustup home, source folder, target folder).
7. Assemble the folder `build-release.ps1` would make for the release build (installer, `payload/release`, `nsis/release/installer.nsi` and `hooks.nsh`, `config/tauri.conf.json`), check the embedded WebView2 bootstrapper with `webview2-bootstrapper.ps1` under Windows PowerShell 5.1, write `PROVENANCE.json` (commit, run id, tools, bootstrapper record; no machine name).
8. `node desktop/scripts/artefact-check.mjs <folder>`; a non-zero exit fails the job.
9. `SHA256SUMS` in sha256sum style over every file, read back at once.
10. `actions/upload-artifact`, `if-no-files-found: error`, 14 days.

Not made here: a GitHub release, any signing, the three other builds of build-release.ps1. The installer a person ships is still the local one.

Job `attest` (the only write job): `id-token: write`, `attestations: write` and `contents: read`; `if` the repository variable `NQT_ATTEST` is `on`; runs exactly two actions (`actions/download-artifact`, `actions/attest-build-provenance`) over the installer, the exe and `SHA256SUMS`. The repository is public, so artefact attestations are available.

## Rules both files keep

Workflow token `contents: read`; every action pinned by its full commit SHA with the release in a trailing comment (checkout 7.0.1, setup-node 7.0.0, cache 6.1.0, upload-artifact 7.0.1, download-artifact 8.0.1, attest-build-provenance 4.1.1, each resolved with `gh api` and at least two months old); checkout without the token; no `secrets.`; no `continue-on-error`; no `${{ }}` expression inside a script (inputs reach scripts through `env` only); a time limit on every job; `cancel-in-progress: false`.

## What the owner switches on (O20)

Both gates are repository variables, unset today, so both write jobs are skipped:

- `NQT_DRIFT_ISSUES` = `on`: the drift watch opens or updates an issue.
- `NQT_ATTEST` = `on`: the release build is attested.

Setting them is a repository setting (Settings, then the Actions variables page). The release workflow gets a tag trigger only after the owner accepts a CI-built MSVC release.

## Evidence

Tests: `node --test desktop/harness/tests/drift-release-workflows.test.mjs`, 26 tests, 26 pass, none skipped on this PC. `D:/dev/tools/actionlint/1.7.12/actionlint.exe` over both workflows: clean.

Born failing. Written first; the first run failed with ENOENT on both workflows (neither existed). After the files were written the guards were fed broken copies, in the test file and by hand against the real files:

| Broken state | Guard that names it |
|---|---|
| a write permission outside the gated jobs (workflow level, in `build`, `write-all` in `drift`) | `permissionProblems`; by hand, `contents: write` in `build` failed the pin test |
| a write job without its variable gate, with an extra scope or with an extra action | `permissionProblems` |
| a tag trigger, or a release trigger, on `desktop-release.yml` | `releaseTriggerProblems`; by hand, a tag trigger failed the trigger test |
| a missing `--locked` on `cargo tauri build` or `cargo install`, or no cargo command at all | `lockedProblems`; by hand, removing it failed two tests |
| a drift workflow without its own push-path trigger, with a branch filter, with wider paths, or without a schedule | `driftTriggerProblems`; by hand, deleting the push trigger failed two tests |
| an unpinned action, a kept checkout token, a secret, `continue-on-error`, an expression in a script | `supplyProblems`, `injectionProblems` |
| a new major runtime | the `compare` step run under PowerShell: exit non-zero and the recorded version unchanged |

The real files were restored byte for byte after each by-hand mutation (compared with `cmp`).

Also run by hand against the real world, read-only: the `advisories` step's script on this PC with the real feed of `tauri-apps/tauri` (nine advisories): no newer advisory than the baseline passes, a state seeded with 1 January 2025 fails with exit 1 and names the two blocking advisories (GHSA-w28w-mhc8-qvjv, GHSA-7gmj-67g7-phm9). The version check, the checksum step and the remap-flag code of the release workflow were run on this PC with stand-in folders and variables: 0.3.3 passes, 0.3.4 and `abc` fail; five stand-in files summed and read back; seven remap flags printed in the intended order.

## Not verified, said plainly

- Neither workflow has run on GitHub. The manager's push is the first run.
- The registry read of the `webview2` step passed on this PC; whether `windows-2025` carries the WebView2 runtime or only Edge is not known. The step falls back to Edge and otherwise fails closed. The `source` output says which one was read.
- The release build has never run on MSVC. It depends on `desktop/src-tauri/build.rs` and the toolchain file after the desktop-check slice's changes; a build script written for the GNU linker would fail it, and a failure there is a finding for w2b's post-push loop, not for this file.
- `artefact-check.mjs` accepts any DLL that sits in the system folder, so a dynamic `VCRUNTIME140.dll` import passes on the runner. A user's PC may lack that runtime; whether to link the C runtime statically on MSVC is an open question for the release grade (w6).
- The installer and `SHA256SUMS` are attested by `subject-path`; the `SHA256SUMS` format was not fed to `subject-checksums`.
- The `issues` job and the `attest` job have not run: their gates are off.
- GitHub's rule that a push-path trigger runs from the pushed branch is taken from the documentation, not seen.

## Wiring for the merge step

None of these files is mine, so they are listed in the report, not done:

1. `docs/desktop/ci.md` (ci-widen's file): one paragraph each for `webview2-drift.yml` and `desktop-release.yml`, with the two variables, so that the document that says "nothing is signed, uploaded or released" stays true (the new workflows upload one artefact and, only with `NQT_ATTEST` on, attest it).
2. The register entry for O20: two of its switches are wired here (`NQT_DRIFT_ISSUES` and `NQT_ATTEST`); the CodeQL permission is not part of this slice.
3. The repository variables themselves, once the owner agrees.

## Added at merge

- The state lives in an Actions cache entry, which Actions drops after seven days without use, and a cache saved on a branch is not seen from the default branch. Either way the next scheduled run would find no state and record a new baseline without comment. The `compare` step now writes a `::warning title=No recorded WebView2 baseline` annotation when `GITHUB_EVENT_NAME` is `schedule` and there is no state; a first run on a push or dispatch stays quiet. Test first: `born failing: a scheduled run with no recorded baseline warns ...` failed against the old step (1 fail, 25 pass) and passes now (26 of 26).
- The `upload-artifact` pin in `desktop-release.yml` is unchanged (v7.0.1); `ci.yml` moved to the same pin, so the repository has one pin for that action.
