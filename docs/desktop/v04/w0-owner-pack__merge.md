# Wave w0-owner-pack: merge note

Branch `v04/w0-owner-pack`, worktree `E:/projects/nq-lab/wt-w0`, base `16f56ec`. Date of the check: 11 October 2026. Installed version read from the uninstall entry: 0.3.2.

## Result in one line

Everything the wave owns passes. One release check fails for a reason outside the wave's files: `ci-workflow.test.mjs` wants the new `owner-session.tests.ps1` listed in `.github/workflows/ci.yml`, and that file is not owned by any slice or by the merge. The two-line fix is ready and was proved in a scratch copy; the manager decides who applies it.

## Release checks

| Check | Result |
| --- | --- |
| `node --test` over `desktop/harness/tests/*.test.mjs` and `desktop/scripts/tests/*.test.mjs` (the bare directory form does not work under Node 24, so the globs were used) | 565 tests, 563 pass, 1 skipped, 1 fail: `ci-workflow.test.mjs`, "every PowerShell release-script test file is run by a step ... owner-session.tests.ps1 is run by a step of ci.yml". Output: `D:/dev/v04/w0-owner-pack/release-node.txt` |
| `vitest run scripts/docsSync.test.ts src/copy/copyRules.test.ts` | 2 files, 43 tests pass |
| `owner-session.tests.ps1` | 71 passed, 0 failed |
| Prose lint on the changed `.md` files | every file rc 0. Warnings only, all of the "x, y and z" triad kind: `docs/desktop/README.md` (8) and `owner_decisions_windows.md` (3) are the same on the base; the three slice notes hold 2, 5 and 0, mostly line-number and library lists |
| Worktree status | every path inside the slices' `owns` (plus this note); nothing else changed |
| Banned terms, em and en dashes, CR characters | none in any changed file |
| Source size | `owner-session.ps1` 423 lines, longest function 34 lines |

## The ci.yml gap and its fix

`.github/workflows/ci.yml` (step "Release script self-tests") must run the new test, as `desktop/harness/tests/ci-workflow.test.mjs` and `docs/desktop/ci.md:22` require. The change, proved in a scratch copy where the test then passes 3 of 3 (`D:/dev/v04/w0-owner-pack/ci-owner-session.diff`):

```
+          powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\tests\owner-session.tests.ps1
+          if ($LASTEXITCODE -ne 0) { throw "owner-session.tests.ps1 exit $LASTEXITCODE" }
```

The `ci.md:22` row should then name the test too. Not verified: that the test runs on a hosted runner. It writes its scratch folder under `D:\dev\tmp\v04-w0` and sets an ACL deny, so check the first hosted run.

## Exit criteria

1. Every owned template names the installed tag through the fill-in field: 17 of 17 (13 from 3 October, 4 from 11 October); no template names `8122c877` or `0.1.0`. Pass rules unchanged (the diffs touch only version, installer and commit lines).
2. `owner-session.ps1 -DryRun` over the real `session_order.json` prints 14 steps in the file's order. Output: `D:/dev/v04/w0-owner-pack/dryrun_default.txt` (today's date) and `dryrun_20261012.txt` (`-Date 2026-10-12`). Tests pass (71).
3. The generator diff on a copy: patched `unmapped 0`, unpatched `unmapped 3`. The lab original is byte-identical to the saved original. The addendum rows for `threadcaps.py` and `web/src/jobsbar` are in `w0-owner-pack__preflight-debt.md`.
4. `docs/desktop/README.md` status now reads the 0.3.2 verdict figures (idle 206.0 MB, cold HOME 3,966 ms) and the pitch-deck line is gone; `owner_decisions_windows.md` lines for O14 and CI are fixed. `docs-figures.test.mjs` ties the README figures to `verdict.md`. The stale lines in files the wave may not touch are listed with replacements in `w0-owner-pack__stale-docs.md` for waves w2b and w9.

## Owner session, in order (210 minutes, 3.5 hours)

| # | Check | Minutes |
| ---: | --- | ---: |
| 1 | real-keyboard | 15 |
| 2 | nvda | 15 |
| 3 | narrator | 15 |
| 4 | ib-dialog-screen-reader | 10 |
| 5 | visible-run | 15 |
| 6 | minimised-close | 10 |
| 7 | custom-install-folder | 15 |
| 8 | zoom-200-by-eye | 20 |
| 9 | real-contrast-theme | 30 |
| 10 | ib-switch-paper-tws | 20 |
| 11 | real-jobs-backtest | 20 |
| 12 | smartscreen-first-run | 10 |
| 13 | reboot-first-launch | 5 |
| 14 | pending-measurements | 10 |

The visible run's 30 minutes minimised and the reboot itself are not counted. The all-day soak, dual-run kit and weekly parity are not session steps; the soak row can be met by the hidden 8 hour soak of wave e2-endurance-040 if the owner accepts it.

## Same-day clash (owner decision)

The four 2026-10-11 templates have the same file names as the records the script writes on 11 October, and the script never overwrites. A run today therefore refuses those four steps, exits 1 and prints `rerun with -Date 2026-10-12`. From 12 October there is no clash. Either run it tomorrow, pass `-Date 2026-10-12`, or rename the four templates (a spec change).

## New files and their fate (03 Appendix A addendum)

| File | Fate |
| --- | --- |
| `desktop/scripts/owner-session.ps1` | new, kept: the owner's guided session |
| `desktop/scripts/tests/owner-session.tests.ps1` | new, kept: its tests, to be added to `ci.yml` |
| `desktop/scripts/tests/fixtures/owner-session/` (5 files) | new, kept: fixture list, sums and templates |
| `desktop/harness/tests/docs-figures.test.mjs` | new, kept: README figures equal `verdict.md` |
| `docs/desktop/checks/session_order.json` | new, kept: the ordered session |
| `docs/desktop/checks/2026-10-11_*.md` (4) | new owner templates, kept |
| `docs/desktop/v04/gen03_rules.diff` | new, kept until the manager applies it to `gen_03_tables.py` |
| `docs/desktop/v04/w0-owner-pack__*.md` (5, with this note) | new, kept: slice and merge notes |

No module, route or backend file was added.

## Unverified

A run on the owner's PC against `D:\dev\release\0.3.3` (the worktree has no `desktop-v0.3.3` tag, so only 0.3.2 was exercised). A hosted-runner run of the new PowerShell test. The slices' QA reviews (script, silent) were not part of this check.

## Housekeeping

`web/node_modules` in the worktree is a git-ignored folder of junctions into the main tree's pnpm store (the same layout as `wt-w1`); the main tree's own `node_modules` was mid-install, so a plain junction to it did not resolve. The HEAVY slot was taken for the run and released after.
