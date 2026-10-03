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

- Two specs of the desktop project are expected failures (`test.fail`): at 200% zoom in a 1366x768 and a 1024x640 window, a maximised GP panel leaves a body too short for its controls. They are a known limit of the layout, not a regression, and an owner decision.
- `release_check.ps1` needs a clean commit, so it stays open. Run on the uncommitted tree it passes the four records, the checksums and the artefact check and refuses only because the tree is not a clean commit. After the commit, build the release, check and install it, record the four checks with the release folder's smoke exe and run `release_check.ps1 -Tag desktop-v0.1.0 -RequireSmokeApp`. The records of this wave describe the uncommitted tree and are refused after the commit by design.
- Everything D5 step 1 listed as open stays open: the W0B reproduction gate of the harness, the engine-level minimise proof, a live T8 run, the real-data harness rows, the three workflow files and the MSVC leg, and the owner-only checks.
- An installer hook that strips inherited broad write rights when the install folder lies outside the profile (a user picking `D:\Apps`) would change `installer.nsi` and the artefact check; it needs an owner decision. Until then the install test covers the per-user default layout only.
- T3 (cold-HOME reading) belongs to the owner; the stage 1 and splash numbers stay provisional for D5 step 2.
