# Wave w2a-supply-chain: merge note

Branch `v04/w2a-supply-chain`, worktree `E:/projects/nq-lab/wt-w2a`, base `16f56ec`, written 11 October 2026. The three
slices (supply-chain, coverage, test-speed) were inspected and joined, then checked. Two builders (supply-chain, coverage)
ended without a structured report; their files were read against their tasks and found complete (see "What was
inspected"). Nothing is committed: the manager makes the git writes.

## What this merge wired

| File | Change | Why |
|---|---|---|
| `.github/workflows/supply-chain.yml` | New step "Scanner tests" (`node --test scripts/tests/*.test.mjs`) in the `osv` job, before the scan. | The harness glob of `ci.yml` does not reach `scripts/tests`, so `osv_scan.test.mjs` would never have run in CI. `ci.yml` belongs to wave w2b-ci-msvc, so the step lives in this wave's own workflow. |
| `desktop/harness/tests/supply-chain-workflow.test.mjs` | Two tests added: the `osv` job runs the `scripts/tests` glob before the scan without a skip pattern, and the broken forms (step removed, glob narrowed, test skipped, tests after the scan) are flagged. | A guard for the wiring above. |
| `docs/TESTING.md` | The web baseline row, the whole-report figure, the web command made definite, one triad of the coverage slice's prose rewritten. | The merge task: record the web figure. |
| `docs/desktop/v04/w2a-supply-chain__merge.md` | This note. | merge_owns. |

`.github/workflows/ci.yml` and `docs/desktop/ci.md` are NOT changed by this branch (they are w2b's; see "Ownership, for the manager"
below for the two edits the merge makes).

Wiring item 3 of the supply-chain note (a `coverage.include` of `src/**` in `web/vite.config.ts`) is not needed: the
baseline run listed every non-test `.ts` and `.tsx` file under `web/src` (none missing), so an untested module shows as 0%
and does not drop out of the denominator. `web/vite.config.ts` is unchanged by this merge.

## What was inspected

- supply-chain (no report): `supply-chain.yml`, `codeql.yml`, `osv_scan.mjs`, both test files, the lock changes and its note
  were read against the task. Every item is there: weekly and dispatch triggers plus a path-limited push trigger; cargo deny, cargo audit,
  pnpm audit, `pnpm sbom` CycloneDX, a Cargo SBOM (cargo-cyclonedx 0.5.9, chosen so all three SBOMs share one format),
  pip-audit over the qa lock, the OSV scan with the lab-name guard, SBOM uploads; CodeQL on dispatch only with
  `security-events: write` on its one job; the `source-map-js` and `pytest` bumps; `@vitest/coverage-v8` 5.0.2 and the
  `test:coverage` script. Nothing was missing, so nothing was finished.
- coverage (no report): `record_green.ps1 -Coverage`, its test script and the `docs/TESTING.md` section were read; all 30 checks
  re-run and pass.
- test-speed (reported): both speed-ups were dropped on measurement; the guard in `playwrightConfig.test.ts` and the explicit
  one-worker limits are kept.

## Checks run

All under the slots of the V04 tools where one applies (HEAVY for the full vitest, PLAYWRIGHT for every browser run).
Logs are in `D:/dev/v04/w2a-supply-chain/merge/`.

| Release check | Result |
|---|---|
| `node --test desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 246 tests, 246 pass |
| `node --test desktop/harness/tests/*.test.mjs` | 346 tests, 345 pass, 1 skipped, 0 fail (13 of them are `supply-chain-workflow.test.mjs`) |
| `pnpm test:types`, `test:e2e-types`, `check:api` | all pass |
| full vitest with the CI exclusions and `--coverage` (521 files) | 7,805 passed, 52 skipped, 0 failed, 158 s; this one run is also the "pnpm test" check and the coverage run |
| `pnpm build` with bundle budgets | pass: shell 110.0 of 115.0 kB gzip, perspective 86.1 of 100.0, echarts 201.6 of 230.0, lightweight-charts 61.4 of 75.0, uplot 22.1 of 30.0, tanstack-grid 18.7 of 45.0 |
| `uv run --frozen pytest` in qa | 333 passed, pytest 9.0.3 |
| `scripts/tests/release_check.tests.ps1`, `smoke_real.tests.ps1`, `record_green.tests.ps1` | 82 + 16 + 30 checks, all pass |
| actionlint 1.7.12 over `.github/workflows` | clean |
| `node scripts/osv_scan.mjs` against api.osv.dev | exit 0: npm 306 packages, 0 advisories; PyPI 50, 0; crates.io 473, 3 records (glib 0.18.5 twice, proc-macro-error 1.0.4), none HIGH |
| `cargo deny --locked check`, `cargo audit`, `pnpm audit --prod --audit-level high` | all four cargo deny checks ok; 2 allowed warnings (the same two crates); no known vulnerabilities |
| the three SBOMs (npm, qa, Cargo) | produced by the slice with the workflow's own commands (262 cargo, 116 npm, 50 qa components); the workflow's first run on GitHub is the proof on the hosted runner |
| prose lint on the changed `.md` files, `web/src/copy/copyRules.test.ts`, `docsSync.test.ts` | the four notes pass; `docs/TESTING.md` warns for 14 list triads, the same count `HEAD` has (the file warned before this wave; the one triad this wave added was rewritten); copyRules and docsSync pass |

The web vitest run, the type checks, the build and the qa run were made in a copy of the tree (`D:/dev/v04/w2a-supply-chain/verify/terminal`, its
`node_modules` installed from the new lock, a folder named `terminal` as the qa test needs). This worktree's `node_modules`
is a mirror of another wave's, without `@vitest/coverage-v8` and with the old `postcss`; running there would have tested the
old lock. The copy was refreshed from this worktree just before the runs.

Playwright runs (this worktree, ports 8845 and 4323 for the main project, and 4383 with 4384 for the offline one, under one PLAYWRIGHT slot hold):

| Run | Result |
|---|---|
| `pnpm e2e` (final run, slot held by a live process of mine) | 619 passed, 20.7 min (1,243 s) |
| `pnpm e2e:perf` | 3 passed, 26 s |
| `pnpm e2e:offline`, first run on this Windows PC | 87 failed, 103 passed, 3 skipped; all 87 are "A snapshot doesn't exist ... writing actual" in `visual/screens` and the gallery specs (the offline baselines are the machine's own and none existed for `offline-win32`; the folder is git-ignored) |
| `pnpm e2e:offline`, second run, with those baselines now written | 190 passed, 3 skipped, 0 failed, 8.2 min |

Two earlier full `pnpm e2e` runs are not counted, and the reason matters for the next merge. My slot lock did not hold: the
V04 slot tool's default holder is the nearest non-shell ancestor of the calling process, which here was a short-lived
process, so the tool judged my lock stale ("holder pid has ended") within seconds and another wave's Playwright run took the
slot while mine was still running. Those runs therefore overlapped another wave's browsers and backend on this PC. The first
had 618 passed and 1 failed (`home.spec` "panel 3 baseline at 1366x768": no panel titles in 10 s after `goto`); a
single-spec rerun then lost one `home.spec` test to a command line that had not got its index in 10 s, and a later rerun
lost its browser (`Target crashed`, exit code 0xC0000142) while the machine was short of resources. All three are the
10 s latency family that `w2a-supply-chain__test-speed.md` records. The final run passed 619 of 619 after I passed
`-HolderPid` of a process of my own to `slot.ps1 -Take` (a plain `node` timer, stopped after the release). Recommendation for
the tool and for later agents: always pass `-HolderPid` of a process that lives as long as the slot is needed.

The config is the same as `HEAD` in effect (one worker, as the top-level `workers: 1` already made it), so the pass count
equals the test-speed slice's base run (619).

## Coverage baselines recorded

`docs/TESTING.md` now holds the web baseline: `web/src` 97.03% of lines (779 files; statements 95.40%, branches 88.39%,
functions 93.67%); the whole report, which also counts the `scripts/` and `e2e/` files the unit tests load, 94.45% of lines over
883 files. The backend baseline from the coverage slice (96.54%, 143 files) stays. The rule "coverage may not fall; new
modules 80% or more" is in the file. The web figure came from a copy of the tree, so it is a reading of the branch; the
post-merge agent repeats it in the main tree.

## New files and their fate, for the 03 Appendix A addendum

| File | Fate |
|---|---|
| `.github/workflows/supply-chain.yml` | kept; weekly, by dispatch, and on a push limited to four paths |
| `.github/workflows/codeql.yml` | kept; dispatch only until the owner's go (O20) |
| `scripts/osv_scan.mjs` | kept; Node, no dependency |
| `scripts/tests/osv_scan.test.mjs` | kept; run by the `osv` job of `supply-chain.yml` |
| `scripts/tests/record_green.tests.ps1` | kept; to be run by `ci.yml` once the merge adds its two lines (see below) |
| `desktop/harness/tests/supply-chain-workflow.test.mjs` | kept; now also guards the "Scanner tests" step of the `osv` job |
| `docs/desktop/v04/w2a-supply-chain__{supply-chain,coverage,test-speed,merge}.md` | kept; the notes of this wave |

No backend module, route or screen was added.

## Born-failing evidence of the wiring

Release fix 2: with the two `ci.yml` hunks and the `ci.md` sections taken out, `supply-chain-workflow.test.mjs` was changed first
to look for the scanner-tests step in the `osv` job of `supply-chain.yml`. It then ran 15 tests and 2 failed (`no osv step runs
"node --test scripts/tests/*.test.mjs"`, and the fixture check of the broken-form case). After the step was added to the workflow:
15 of 15 pass, and actionlint 1.7.12 is clean. A guard that cannot fail on today's tree: none added.

## Not done, not verified

- `supply-chain.yml` and `codeql.yml` have not run on GitHub. The manager pushes the branch and the runner's post-push loop reads
  the first run of `supply-chain.yml` (up to 3 fix rounds).
- The two-worker Playwright layout and `isolate: false` were dropped by the test-speed slice with their measurements: neither reached
  three green runs, so the Playwright and vitest times stay at today's figures. The exit criterion "under 6 minutes and 60
  seconds, or the reason" is met by the reason in `w2a-supply-chain__test-speed.md`.
- No agent review (code-reviewer, security-reviewer) was run: no agent can be started from here. The three QA focuses in the wave
  spec (security, silent failures, tests) are left to the QA step.
- Rust coverage and the MSVC leg belong to wave w2b.
- fsspec 2026.2.0 in the lab venv (GHSA-27vj-qcqg-25rc, HIGH, fixed in 2026.6.0) is the owner's; reported and not touched. It is in neither
  the qa nor the web lock.

## Post-merge, in the main tree (with the 0.3.3 finisher not using `node_modules`)

1. `pnpm --dir web install --frozen-lockfile` so the main tree gets `@vitest/coverage-v8` 5.0.2, `postcss` 8.5.29 and `source-map-js`
   1.2.2. Until then `pnpm test:coverage` fails there with a missing provider.
2. `uv sync --frozen` in `qa` (or the first `uv run --frozen pytest`) for pytest 9.0.3.
3. Full `pnpm test` once: `radixPrimitiveStub.test.tsx` and the three lab-only tests need the main tree.
4. One `pnpm e2e` (one worker) and, optionally, `pnpm e2e:perf` on a quiet machine.
5. Repeat the web coverage run and replace the web baseline row if it differs.

## Release check, second pass (after the four fixer changes)

Four fixers changed `scripts/osv_scan.mjs`, `scripts/tests/osv_scan.test.mjs` and
`desktop/harness/tests/supply-chain-workflow.test.mjs` after the first pass above (a malicious-package record is CRITICAL; the
entry-point check follows a junction; a CVSS 4.0 vector reads as HIGH and `--fail-on-unrated` exists; the workflow test reads only
`run:` lines and checks each SBOM upload). No file under `web/` or `qa/` changed after the web and qa runs and the Playwright runs above
(file times checked), so those results stand and the Playwright runs were not repeated. Everything the fixes can reach was run again.
Logs: `D:/dev/v04/w2a-supply-chain/release/`.

| Check | Result |
|---|---|
| `node --test scripts/tests/*.test.mjs desktop/scripts/tests/*.test.mjs` | 254 tests, 254 pass |
| `node --test desktop/harness/tests/*.test.mjs` | 348 tests, 347 pass, 1 skipped, 0 fail |
| `scripts/tests/record_green.tests.ps1`, `release_check.tests.ps1`, `smoke_real.tests.ps1` | 30 checks, then 82, then 16, all pass |
| web `test:types`, `test:e2e-types`, `check:api`, full vitest with coverage (HEAVY slot), `pnpm build` | all pass; 521 files, 7,805 passed, 52 skipped, 0 failed, 146 s; whole-report lines 94.45%; budgets: shell 110.0 of 115.0, perspective 86.1 of 100.0, echarts 201.6 of 230.0, lightweight-charts 61.4 of 75.0, uplot 22.1 of 30.0, tanstack-grid 18.7 of 45.0 kB gzip |
| `uv run --frozen pytest` in `qa` | 333 passed |
| actionlint 1.7.12 over `.github/workflows` | clean |
| `node scripts/osv_scan.mjs` against api.osv.dev, with the new severity rules | exit 0: npm 306 packages, 0 advisories; PyPI 50, 0; crates.io 473, 3 records (glib twice, one rated MODERATE; proc-macro-error unrated); no HIGH, no MAL record; "2 unrated advisories (not gating)" |
| `pnpm audit --prod --audit-level high` | no known vulnerabilities |
| prose lint, changed notes | pass; `docs/TESTING.md` 14 list triads as before |
| changed files: banned terms, em dashes, en dashes, non-ASCII, Markdown line endings | none found; every `.md` is LF (`osv_scan.mjs` and its test were CRLF here; made LF in the fourth pass) |
| free space on C: | 425.3 GB at the end |

Documents brought in line with the fixes: the usage comment of `osv_scan.mjs` names `--fail-on-unrated`; the supply-chain note
(which carries the text for `docs/desktop/ci.md`) says how severity is read, that `MAL-` records always fail and that unrated records are counted and
not gating unless `--fail-on-unrated` is passed.

## Release check, third pass (release fix 2: the ownership of `ci.yml` and `ci.md`)

Changed since the second pass: `ci.yml` and `ci.md` restored to `HEAD`, the "Scanner tests" step in `supply-chain.yml`,
`supply-chain-workflow.test.mjs`, and the notes. No file under `web/` or `qa/`, and no script, changed (each compared with the copy
the web and qa runs were made in; only `osv_scan.mjs` differs from it, by the second pass's fixes, and its tests were run here), so
the web and qa results and the Playwright runs above stand.

| Check | Result |
|---|---|
| `node --test scripts/tests/*.test.mjs desktop/scripts/tests/*.test.mjs` | 254 tests, 254 pass |
| `node --test desktop/harness/tests/*.test.mjs` | 348 tests, 346 pass, 1 skipped, 1 fail: `ci-workflow.test.mjs`, "every PowerShell release-script test file is run by a step ..." (`record_green.tests.ps1` not in w2b's `ci.yml`; see the next section). `supply-chain-workflow.test.mjs`: 15 of 15 |
| `record_green.tests.ps1`, `release_check.tests.ps1`, `smoke_real.tests.ps1` | 30 checks, then 82, then 16, all pass |
| web `docsSync.test.ts`, `playwrightConfig.test.ts`, `copyRules.test.ts` (this worktree) | 3 files, 60 tests, all pass |
| actionlint 1.7.12 over `.github/workflows` | clean (exit 0) |
| prose lint, the four notes | pass; `docs/TESTING.md` 14 list triads as at `HEAD` |
| changed files (19 entries): banned terms, em dashes, en dashes, non-ASCII outside Markdown, control characters, Markdown CR | none found |
| `git status --short` | only files owned by a slice or `merge_owns`; `ci.yml` and `ci.md` no longer listed |
| free space on C: | 426 GB |

## Release check, fourth pass (release fix 3)

Failure given: the harness suite had one red test, `ci-workflow.test.mjs` ("every PowerShell release-script test file is run by a
step that fails the job on a non-zero exit"). Reproduced first: `scripts/tests/record_green.tests.ps1 is run by a step of ci.yml`.
The cause is `ci.yml`, which wave w2b-ci-msvc owns, and not any file of this wave, so the red test is not fixed in this branch
(editing `ci.yml` would break the ownership rule and conflict with w2b's merge). The fix is proved on a scratch copy instead: the
two lines of "Wiring for the merge step" (supply-chain note) were added to a copy of `ci.yml` by `D:/dev/v04/w2a-supply-chain/fix3/wire.mjs`.
The `ci-workflow.test.mjs` file then passes 3 of 3, and the whole harness suite in the verify copy with those lines is 348 tests, 347 pass,
1 skipped, 0 fail. The merge step still has to add the lines to the merged `ci.yml`.

One defect of this wave's own files was found and fixed test-first: `scripts/osv_scan.mjs` and `scripts/tests/osv_scan.test.mjs`
were written with CRLF line endings (every other script of the tree is LF). A test was added to `osv_scan.test.mjs` ("the scanner and
its test keep LF line endings ..."); it failed on the CRLF files (29 tests, 1 fail), then both files were converted to LF and it passes (29 of 29).

| Check | Result |
|---|---|
| `node --test scripts/tests/*.test.mjs desktop/scripts/tests/*.test.mjs` | 255 tests, 255 pass (254 plus the new one) |
| `node --test desktop/harness/tests/*.test.mjs` in this worktree | 348 tests, 346 pass, 1 skipped, 1 fail: the `ci-workflow.test.mjs` case above, which has not changed and belongs to another wave |
| the same suite in the verify copy with the two `ci.yml` lines added | 348 tests, 347 pass, 1 skipped, 0 fail |
| `record_green.tests.ps1`, `release_check.tests.ps1`, `smoke_real.tests.ps1` | 30 checks, then 82, then 16, all pass |
| web `test:types`, `test:e2e-types`, `check:api` (verify copy, HEAVY slot) | all pass |
| full vitest with coverage (verify copy) | 521 files, 7,805 passed, 52 skipped, 0 failed, 140 s; lines 94.45%, statements 92.82%, branches 86.59%, functions 91.65% |
| `pnpm build` | pass; budgets: shell 110.0 of 115.0, perspective 86.1 of 100.0, echarts 201.6 of 230.0, lightweight-charts 61.4 of 75.0, uplot 22.1 of 30.0, tanstack-grid 18.7 of 45.0 kB gzip |
| `uv run --frozen pytest` in the verify copy's `qa` | pass (333 tests, as before) |
| `pnpm e2e` (PLAYWRIGHT slot, holder pid of a live process) | 619 passed, 19.6 min (1,173 s) |
| `pnpm e2e:perf` alone | 3 passed, 26 s |
| `pnpm e2e:offline` | 190 passed, 3 skipped, 0 failed, 6.4 min |
| actionlint 1.7.12 over `.github/workflows` | clean |
| web `docsSync`, `playwrightConfig`, `copyRules` tests | 3 files, 60 tests, all pass |
| prose lint on the five changed notes | the four v04 notes pass; `docs/TESTING.md` 14 list triads as at `HEAD` |
| scan of the 19 changed entries | no banned term, em or en dash, non-ASCII outside Markdown, control character, carriage return or missing final newline |

Exit criteria: the "under 6 minutes and 60 seconds" target for Playwright and vitest is not met (19.6 min and 140 s); the reason is in
`w2a-supply-chain__test-speed.md` (both speed-ups were dropped on measurement). The live OSV scan and `pnpm audit` were not repeated:
no lock file changed since their runs. Logs: `D:/dev/v04/w2a-supply-chain/fix3/out/`.

## Ownership, for the manager (release fix 2)

`.github/workflows/ci.yml` and `docs/desktop/ci.md` are owned by wave w2b-ci-msvc. An earlier pass of this wave edited them; that
is undone, and both files are byte for byte what `HEAD` (`16f56ec`) has, so `git status` of the worktree lists only files owned by
this wave's slices or its merge_owns, and merging `v04/w2b-ci-msvc` will not conflict on them.

- The `osv_scan.test.mjs` need is met inside this wave: the `osv` job of `supply-chain.yml` runs the scanner's tests before the scan.
- One need cannot be met inside this wave. `ci-workflow.test.mjs` fails ("every PowerShell release-script test file is run by a step
  that fails the job on a non-zero exit") until `ci.yml` runs `scripts/tests/record_green.tests.ps1`, the coverage slice's file at
  the path its task fixes. That test and `ci.yml` are w2b's. In this worktree it is the one red test of the harness suite (348 tests,
  346 pass, 1 skipped, 1 fail). It is a known cross-wave item, not a defect of this wave's files.
- The merge step is therefore: merge w2b, then add to its `ci.yml` the two lines of `record_green.tests.ps1` after the `smoke_real`
  pair of the "Release script self-tests" step, and make the three `ci.md` edits (the self-test row, the two new sections and
  the first sentence under "Rules the workflow keeps"). The exact lines and the section text are in
  `w2a-supply-chain__supply-chain.md`, under "Wiring for the merge step". After that, the harness suite should be fully green; that
  run is a post-merge check.

## Disk

Free space on C: read at the start of the merge and at the end: 425.7 GB and 425.3 GB (a fall of 0.4 GB, not above the 1 GB
line). Everything written by this merge went to D: and E:; the offline Playwright baselines went under the worktree on E:.
