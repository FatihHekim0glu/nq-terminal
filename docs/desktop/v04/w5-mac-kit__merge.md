# Wave w5-mac-kit: merge note

Branch `v04/w5-mac-kit`, worktree `E:/projects/nq-lab/wt-w5`, base `569f011` (main with w0 and w2b) plus the w2a supply-chain branch (`36d28c7`), written 12 October 2026. The five slices (selftest-page, jsc-golden, keys-notices, webkit-windows, parity-auto) were joined and checked. Four builders (selftest-page, jsc-golden, keys-notices, webkit-windows) ended without a structured report; their files were read against their tasks and the spec, and every item was found written. Nothing is committed: the manager makes the git writes. Ready to push.

## What the merge found and fixed

Each item below was a defect that no single slice could see. The failing check is named.

| Defect | Evidence | Fix |
| --- | --- | --- |
| `mac-webkit.yml`, job `webkit-selftest`, waited for a flag the page never sets (`done === true`), served the build at `/` although the build lives under `/__selftest/`, and never clicked the page's button, so the report would have stopped at `awaiting-gesture`. On a hosted runner the job would have timed out after 120 s with nothing to read. | read the page (`web/src/selftest/report.ts`, `session.ts`, `SelfTestApp.tsx`) against the job's script | The script now serves the build under its base path, clicks "Run the clipboard and export probes", waits for `state === 'done'` and judges the report with the page's own `judgeReport`. The stream probe is printed and kept in the report with the copy and save probes, and none of the three fails the job (no backend, no person's machine); a failure of axe, of a golden, of Perspective, of dockview or of the runner does. The script was run under Playwright's WebKit on Windows first: report written, 0 problems, stream probe failed as expected (no backend), copy and save passed. |
| Guard for the above | `desktop/harness/tests/mac-webkit-workflow.test.mjs`: new `checkSelftestContract` and two tests (19 tests now, 17 before). Born failing: each of these is refused: the old wait, a missing `awaiting-gesture`, a renamed button, the base path `/`, a replaced `judgeReport`. A second test reads `report.ts` and `SelfTestApp.tsx`, and then `vite.config.ts`, so the job and the page cannot drift apart. | none needed |
| `pnpm test:types` (`tsc -b`) failed with 71 errors. `scripts/playwrightDesktopConfig.test.ts` imported the pure functions from `e2e/desktop/parityAuto.ts`, which drags page-evaluating code into the node project, together with `app.ts`, `perf/pages.ts` and `orientation.ts` (all written against the DOM types). | `tsc -b`: `e2e/desktop/parityAuto.ts`, `app.ts`, `perf/pages.ts` errors TS2304 and TS7006 | The pure part (rows, comparison, gate log, record, output) moved to the new `web/e2e/desktop/parityRecord.ts` (221 lines, no browser import). `parityAuto.ts` (624 lines) re-exports it, so both specs are unchanged. The test imports `parityRecord.ts`. Both files are now under the 800-line ceiling the slice had broken. `tsc -b` clean, `tsc -p e2e/desktop/tsconfig.json` clean, the 39 config tests pass. |
| `scripts/shellBudget.test.ts` failed: the shell grew to 110,169 B gzip against the pin of 110,000, then, once the pin moved, the 5 kB of room under the ceiling was 4,831 B. The growth is `CommandLine.keys.ts` (the keys table, D7.4), which the shell reads on every key. | `shellBudget.test.ts`: "stays at the shell diet 4 target", then `expected 4831 to be greater than or equal to 5000` | Target 110,000 to 110,200, ceiling 115,000 to 115,200 in `shellBudget.test.ts` and `BUNDLE_BUDGET.shellGzip` in `bundleCheck.ts`, with the reason written beside each, as the file's own rule asks. The 5 kB of room is kept. |
| `src/theme/noBrand.test.ts` ("ships no font file other than Bergoom") failed once `web/dist-selftest` held the @fontsource files. `scripts/lineEndings.test.ts` walks the same tree. | `noBrand.test.ts` | `dist-selftest` added to both skip lists, beside `dist-gallery`. |
| HELP still read the PC key rows and had no link to the notices file. | wiring item 2 of the keys-notices note | `HelpScreen.keymap.tsx` (`KeyTable`, `KeyboardDrawing`), the two count lines in `screens/help/HelpScreen.tsx` and `chrome/HelpScreen.tsx` read `helpKeysFor(detectKeysTable())` and `helpKeyboardFor(...)`; the two `Licences` blocks (`HelpIndex.tsx`, `chrome/HelpScreen.tsx`) render the notices heading and text, then a new-tab link that carries the screen-reader note. New file `web/src/screens/help/HelpScreen.platform.test.tsx` (3 tests): PC names and count, Mac names (Cmd+K, Cmd+[, Option+1..9) and count, the link. Born failing: with the notices block and the platform lookup taken out, two of the three fail. |

## Wiring done (files the slices do not own)

| File | Change |
| --- | --- |
| `web/.gitignore` | `dist-selftest` |
| `web/package.json` | scripts `notices`, `check:notices`, `e2e:offline:webkit` (`build:selftest` and `axe-core` 4.13.0 were the slice's) |
| `docs/TESTING.md` | the `offline-webkit` and `offline-webkit-demo` projects in the offline table (opt-in, need `playwright install webkit`, own baselines) |
| `docs/desktop/checks/README.md` | the automated weekly parity list row and the sentence that rows 10 to 12 and the real F10 and F11 stay with the owner |
| `docs/desktop/03_appendix_a_addendum.md` | seven rows for the wave (see "Appendix A" below) |
| `scripts/smoke_real.ps1` | one help sentence: `parity.app.ts` runs in `-Mode App` only with `NQT_PARITY_REAL=1` and `-Grep 'weekly parity list, real lab'` |
| `docs/desktop/v04/w5-mac-kit__jsc-golden.md`, `__parity-auto.md` | the self-test contract correction and the `parityRecord.ts` split |

Not wired, on purpose: a CI step or a `check.ps1` line for the two notices checks. `ci.yml` is wave w2b's, and both checks already run as tests that CI runs (`thirdPartyNotices.test.ts` in the web Vitest step, `rust-notices.test.mjs` in the `desktop/scripts/tests` step), so a step would only repeat them. `pnpm --dir web build:selftest` is not added to the web job either: the desktop spec and `mac-webkit.yml` build the page.

## Notices regenerated

The selftest-page slice changed the lockfile (the `axe-core` importer entry, a dev dependency). Both generators were run after integrating: `node web/scripts/thirdPartyNotices.mjs` (116 packages) and `node desktop/scripts/rust-notices.mjs --offline` (473 crates). Both files came out byte for byte identical to the slices' files, as expected (a dev dependency is not in the shipped closure). `--check` for both: match. The page notices were generated from a `web/node_modules` of junctions into the main tree's store, not from a fresh install.

## Release checks

Slots: HEAVY for the full Vitest, PLAYWRIGHT for every browser run (one at a time, each taken and released by a script that names the holder pid). Logs are in `D:/dev/v04/w5-mac-kit/merge/`. `web/node_modules/.bin` was given the three `.cmd` shims of w2a's working set so that `pnpm exec vite` finds its binary (the Playwright web server uses it); no install was run.

| Check | Result |
| --- | --- |
| `tsc -b` (test:types) | clean (after the `parityRecord.ts` split) |
| `test:e2e-types` (six projects) | clean |
| `gen-api --check` | in sync |
| full Vitest with the CI exclusions (`startPs1.test.ts`, `sessionPage.browser.test.ts`, the banner copy test) | first full run (before the fixes to the budget, to `noBrand` and to the split): 529 files, 526 passed, 7,962 tests passed, 48 skipped, 2 failed (`shellBudget` and `noBrand`, both fixed below) and 1 file that cannot load (`radixPrimitiveStub.test.tsx`, see "Not verified"). The second full run could not start: both HEAVY slots were held by other waves for the whole of the merge, so it was stopped, not forced. In its place, one run of the 42 files that cover everything changed since the first run (`shellBudget`, `bundleCheck`, `playwrightDesktopConfig`, `lineEndings`, `thirdPartyNotices`, `jscGolden`, `playwrightOffline`, `src/selftest`, `noBrand`, `src/screens/help`, `src/copy`, `CommandLine.keys`): 482 tests, all pass. A second full run is a post-merge check |
| `pnpm build` equivalent (`vite build`, `bundleCheck dist`, `buildStamp`) | shell 110.2 of 115.2 kB gzip; perspective 86.1 of 100.0, echarts 201.6 of 230.0, lightweight-charts 61.4 of 75.0, uplot 22.1 of 30.0, tanstack-grid 18.7 of 45.0; the self-test build is absent from the production bundle (rule 9, and `isolation.test.ts`) |
| `build:selftest` (`vite build --mode selftest`, `bundleCheck dist-selftest --selftest`) | shell 73.1 of 75.0 kB gzip |
| `e2e` (chromium project, fixture backend) | 619 passed, 22.9 min |
| `e2e:perf` alone | 3 passed |
| `e2e:offline` | first run 103 passed, 87 failed with "A snapshot doesn't exist ... writing actual" (this machine had no `offline-win32` baselines; they are git-ignored and per machine); second run against the baselines the first wrote: 190 passed, 3 skipped (the 3 that TESTING.md says are skipped) |
| `e2e:desktop` (hidden smoke build, fixture lab, `NQT_SMOKE_EXE=D:/dev/targets/w5-mac-kit/release/nq-lab-terminal.exe`, `NQT_APP_RUNS=D:/dev/v04/w5-mac-kit/merge/app`) | 63 passed, 2.2 min, the window watch of the set-up clean. Includes `06-selftest-page` (axe 0 violations, goldens 4 of 4, five probes) and `80-parity-auto` (18 tests) |
| `node --test desktop/harness/tests/*.test.mjs` | 444 tests, 442 pass, 1 skipped, 1 fail: `ci-workflow.test.mjs` "every PowerShell release-script test file is run by a step ...", `record_green.tests.ps1` is not in `ci.yml`. Inherited from wave w2a's merge note (it names the two lines that `ci.yml`, w2b's file, needs); not touched here. `mac-webkit-workflow.test.mjs` 19 of 19 |
| `node --test desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 276 tests, 276 pass |
| `scripts/tests/smoke_real.tests.ps1`, `smoke_real.ps1 -SelfTest` | 16 of 16; self-test passed |
| actionlint 1.7.12 over `.github/workflows` | clean |
| `bun web/scripts/jscGolden.mjs` (Bun 1.3.9) | 4 of 4 goldens at 1e-9 relative (100, 291 / 322 / 296 comparisons, one per golden); PROVISIONAL, Bun's JavaScriptCore is not Safari's |
| self-test page under Playwright's WebKit on Windows (the workflow's own script) | report written, 0 problems; stream probe fails (no backend), copy and save pass |
| prose lint on the changed `.md` files, `copyRules.test.ts` | the notes and the checks README pass; `docs/TESTING.md` warns for 14 list triads and the addendum for 34, the same counts `HEAD` has; `copyRules` is part of the full Vitest run |
| changed files scanned for em and en dashes, control characters, non-ASCII outside Markdown, tool attribution | clean, apart from licence texts quoted in the two generated notices files (dashes) and test data (accented key characters, `\u0000` in `bundleCheck.test.ts` as in `HEAD`) |
| free space on C: | 425 GB free at the start, 424 GB at the end (a fall of 1 GB or less, from other lanes; this merge wrote nothing on C: apart from small scratch files of its first minutes, moved to D: when found) |

## G1 items 1 and 2: PROVISIONAL

The workflow has not run on a hosted runner yet; it first runs when the manager pushes the branch (the push trigger is limited to its own file). Nothing is recorded as passed until that run is read.

| Item | What is known now | Hosted run |
| --- | --- | --- |
| G1 item 1: JavaScriptCore goldens | Bun 1.3.9 (WebKit build `0ddf6f47af0a9782a354f61e06d7f83d097d9f84`) on Windows: 4 of 4. The same script passes under V8. No `jsc` shell exists on this PC. | NOT RUN: to be filled by the post-push loop from the `jsc-golden` job |
| G1 item 2: WebKit | Playwright WebKit 26.6 on Windows: the offline suite 190 passed, 3 skipped (webkit-windows slice; defect list in `webkit_windows_defects.md`, which is not WKWebView); the self-test page: 0 problems with the workflow's script. | NOT RUN: to be filled from the `webkit-offline` and `webkit-selftest` jobs |

The post-push loop reads the first branch run (up to 3 fix rounds). If a job still fails after that, each failing job goes into this section as a G1 item 1 or 2 finding and G1 reads FAILED PROVISIONAL with the list; the workflow stays. Points where the first run may differ from here: the path of the `jsc` shell on `macos-26` (the job falls back to Bun and says FALLBACK), whether the bundle runs unchanged in `jsc`, whether Playwright 1.63.0's WebKit installs on `macos-26`, and the offline baselines, which the job writes on first run.

## Appendix A (new files and their fate)

The seven rows are in `docs/desktop/03_appendix_a_addendum.md`. New and kept: `web/src/selftest/**`, `web/e2e/desktop/06-selftest-page.desktop.ts`, `web/scripts/jscGolden.mjs` and its test, `.github/workflows/mac-webkit.yml` and its guard test, `web/scripts/thirdPartyNotices.mjs` and test, `desktop/scripts/rust-notices.mjs` and test, `web/public/third-party-notices.txt`, `desktop/src-tauri/THIRD_PARTY_NOTICES.txt`, `web/e2e/desktop/parityAuto.ts`, `parityRecord.ts`, `80-parity-auto.desktop.ts`, `parity.app.ts`, `web/scripts/playwrightDesktopConfig.test.ts`, `web/src/screens/help/HelpScreen.platform.test.tsx`, the six slice notes, `webkit_windows_defects.md` and `docs/desktop/checks/2026-10-12_weekly-parity-auto.md`. Generated and git-ignored: `web/dist-selftest/`, `web/e2e/__screenshots__/offline-win32` and `offline-webkit-win32`. No route and no backend or Rust module was added.

## Not verified, said plainly

- Nothing in this wave has run on a Mac or on a hosted runner: `mac-webkit.yml` is checked by actionlint and its guard test, and by the pieces run here: Bun, and Playwright WebKit on Windows.
- The Mac keys table is tested as pure maps and under jsdom only (whether Cmd+[ and Cmd+] reach a WKWebView page, and what Fn+arrow sends, are for the owner's Mac).
- The parity list's real mode has not run: `smoke_real.ps1 -Mode App` refuses a worktree. It is the post-merge agent's check, by the command in `w5-mac-kit__parity-auto.md`, with the gate snapshot taken first and the UTC start and end appended to `D:/dev/v04/measure/w5-mac-kit/windows.jsonl`. No real backend was started in this merge, so there is no line for `windows.jsonl`.
- `src/vendor/radixPrimitiveStub.test.tsx` cannot load in this worktree (a Vite "Denied ID" for a path in the main tree's store, reached through the junctions). It is an effect of the borrowed `node_modules`, not of this wave, and is a post-merge check on a proper install, as are the `axe-core`-dependent builds (here `axe-core` came through a junction).
- The desktop run used a copy of the 11 October smoke build (no Rust file changed in this wave), not a fresh build.
- Two generated notices files carry licence text with dashes, as published by the packages.

## Release check after the fixers (12 October, second pass)

Five fixers changed the tree after the merge note above was written. The release check ran again over the result and found these defects. Logs are in `D:/dev/v04/w5-mac-kit/rel/logs/`.

| Defect | Evidence | Fix |
| --- | --- | --- |
| Ten files had been rewritten with CRLF line endings (`mac-webkit.yml`, `parityRecord.ts`, `SelfTestApp.tsx`, `HelpScreen.tsx`, `HelpScreen.css`, `help.ts`, `help.examples.test.ts`, `HelpIndex.tsx`, `HelpScreen.platform.test.tsx`, `NoticesDisclosure.tsx`). The repository stores LF, so each showed as a whole-file change (`HelpScreen.tsx` read as 737 changed lines for 9 real ones) and `lineEndings.test.ts` would fail. | byte count of CR in each changed file against `HEAD` | converted to LF; no changed file holds a CR now |
| `pnpm test:types` failed: `HelpScreen.platform.test.tsx` read `mock.calls[0][0]` of a mock typed with no arguments. | `tsc -b`, TS2493 | the mock is typed with its one argument |
| The shell measured 110,452 B gzip, over the 110,200 pin: the toolbars' accessible names and the message-line sentences now read the platform through `copy/platformKeys.ts`. | `shellBudget.test.ts`, "stays at the shell diet 4 target" | target 110,200 to 110,600 and ceiling 115,200 to 115,600 in `shellBudget.test.ts` and `BUNDLE_BUDGET.shellGzip`, reason written beside each; the 5 kB of room is kept |
| The desktop self-test spec failed: axe could not decide two rules, because the page had two real faults. A bare `pre` carried `aria-label` (aria-prohibited-attr), and dockview's empty floating-group host lay over the pane text (colour contrast, `bgOverlap`; found by hiding the host: undecided 2 to 0). | `06-selftest-page.desktop.ts`, then a diagnosis script under Chromium and WebKit | the report block has `role="region"`; `selftest.css` leaves the host out (`display: none` under `.selftest-dock`); no allowlist entry was added. Both engines now give 0 violations and 0 undecided. `SelfTestApp.test.tsx` has two born-failing tests for these |
| `api/client.test.ts` ("only src/api/client.ts calls fetch") failed: `NoticesDisclosure.tsx` called `fetch`. | full Vitest | it reads the file with the client's `fetchAsset`, the same-origin GET for a build's own static file |
| Two toolbar tests (`KeyToolbar.test.tsx`, `NavToolbar.test.tsx`) held a raw backspace byte in a regular expression where the word-boundary escape was meant, so they asserted nothing about whole words. | scan for control characters in changed files | the escape is written out; the 19 tests still pass |
| `thirdPartyNotices.test.ts` held an en dash and an em dash as literal characters in a regular expression. | dash scan | the expression names them by code point (U+2013, U+2014) |

Results of the second pass (all on the final tree unless stated):

| Check | Result |
| --- | --- |
| `tsc -b`, the six e2e type projects, `tsconfig.node.json` | clean |
| full Vitest with the CI exclusions | 531 of 532 files, 7,999 tests passed, 48 skipped; the one file that cannot load is `radixPrimitiveStub.test.tsx` (borrowed `node_modules`, see above) |
| production build, `bundleCheck dist`, build stamp | shell 110.5 of 115.6 kB gzip, perspective 86.1, echarts 201.6, lightweight-charts 61.4, uplot 22.1, tanstack-grid 18.7; no `selftest` string in `dist` |
| `build:selftest` | shell 73.1 of 75.0 kB gzip |
| `e2e` (chromium) | first full run 617 passed, 2 failed (`reflow-200` COST and `reflow-menus-200` volmanaged_v0 EQ: the page did not load within 45 s while other waves loaded the PC); both passed on their own, 141 of 141 for the two files; after the last source changes the five specs that touch HELP (home, keys, panels, shell, contrast-modes) passed again, 121 of 121 |
| `e2e:perf` | 3 passed |
| `e2e:offline` | 190 passed, 3 skipped |
| `e2e:desktop` (hidden smoke build, fixture lab) | first run 61 passed, 3 failed: the self-test page (fixed above), `90-look` LIVE dropdown (one 412 on `/api/workspaces/watch`, not seen again in three later runs) and the window watch (an Arma Reforger Workbench window of another program took the foreground, owner not traced). Final run on the final tree: 64 of 64 passed, window watch clean |
| `node --test desktop/harness/tests/*.test.mjs` | 444 tests, 442 pass, 1 skipped, 1 fail: `ci-workflow.test.mjs` wants `record_green.tests.ps1` run by a step of `ci.yml` (wave w2b's file, inherited, not touched); `mac-webkit-workflow.test.mjs` 19 of 19 |
| `node --test desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 276 of 276 |
| actionlint 1.7.12 over `.github/workflows` | clean |
| both notices checks | match `pnpm-lock.yaml` and `Cargo.lock` |
| `bun web/scripts/jscGolden.mjs` | 4 of 4 goldens at 1e-9 relative (PROVISIONAL) |
| free space on C: | 424 GB at the start, 425 GB at the end |

Files outside the slices' `owns` lists that this wave changed, each a consumer of the key tables or of the build rather than a new feature: `docs/TESTING.md`, `docs/desktop/03_appendix_a_addendum.md`, `docs/desktop/checks/README.md`, `scripts/smoke_real.ps1`, `web/.gitignore`, `web/scripts/lineEndings.test.ts`, `web/scripts/shellBudget.test.ts`, `web/src/theme/noBrand.test.ts`, `web/src/chrome/CommandLine.dispatch.ts`, `KeyToolbar.tsx`, `NavToolbar.tsx` (and their tests), `HelpScreen.css`, `HelpScreen.keymap.tsx`, `HelpScreen.tsx`, `web/src/export/grab/run.ts`, `web/src/export/prepare.ts`, `web/src/screens/help/HelpIndex.tsx`, `HelpScreen.tsx`, and the new `NoticesDisclosure.tsx`, `HelpScreen.platform.test.tsx`, `web/src/copy/platformKeys.ts` and its test, `web/e2e/desktop/65-help-notices.desktop.ts`, `parityRecord.ts`, `web/scripts/selftestBuild.ts` and its test. The new files are kept; none is a route or a backend module.

## Release check, third pass (release fix 2)

Two failures were open after the second pass. Logs are in `D:/dev/v04/w5-mac-kit/rel2/logs/`.

| Failure | Cause | Fix |
| --- | --- | --- |
| `ci-workflow.test.mjs`, "every PowerShell release-script test file is run by a step that fails the job on a non-zero exit": `scripts/tests/record_green.tests.ps1` was run by no step of `ci.yml`. | The coverage slice of wave w2a added the test and wave w2b owns `ci.yml`; this tree is the first to hold both, so the two lines that the w2a merge note ("Wiring for the merge step") reserves for the merge step are added here. | `ci.yml`, step "Release script self-tests": the `record_green.tests.ps1` line and its exit-code check, after the `smoke_real.tests.ps1` pair, in the form the test requires. `docs/desktop/ci.md`: the file is named in the self-test row (the row was the only part of the w2a text this tree needs; the two supply-chain sections of the w2a text stay with the manager's merge of that wave's docs). The test was run first and failed (`scripts/tests/record_green.tests.ps1 is run by a step of ci.yml`), then passed: 15 of 15. `record_green.tests.ps1` itself: 30 passed, 0 failed. |
| `git status` listed paths outside the slices' `owns` and the `merge_owns`. | Not a defect to remove. These are the consumers of the key tables, the notices and the self-test build, and the splits the fixers made. Each is named in this note with its reason, and none can be dropped without losing an exit criterion (PC and Mac key tables used by the app, notices reachable from HELP, `dist-selftest` out of the tree walks, the parity record split that keeps `tsc -b` clean). | Listed in "Ownership, for the manager" below. The manager accepts them or moves their ownership; nothing was dropped. |

Results on the final tree (nothing else changed since the second pass):

| Check | Result |
| --- | --- |
| `tsc -b`, `tsconfig.node.json`, the six e2e type projects, `gen-api --check` | clean, clean, six OK, in sync |
| full Vitest with the CI exclusions | 531 of 532 files, 7,999 tests passed, 48 skipped; the one file that cannot load is `radixPrimitiveStub.test.tsx` (borrowed `node_modules`, as before) |
| production build, `bundleCheck dist`, build stamp | shell 110.5 of 115.6 kB gzip, perspective 86.1, echarts 201.6, lightweight-charts 61.4, uplot 22.1, tanstack-grid 18.7 |
| `build:selftest` | shell 73.1 of 75.0 kB gzip |
| `e2e` (chromium, PLAYWRIGHT slot) | 619 passed, 21.1 min, no failure |
| `e2e:perf` alone | 3 passed |
| `e2e:offline` | 190 passed, 3 skipped |
| `e2e:desktop` (hidden smoke build, fixture lab) | 64 of 64 passed, 4.5 min, window watch clean |
| `node --test desktop/harness/tests/*.test.mjs` | 444 tests, 443 pass, 1 skipped, 0 fail |
| `node --test desktop/scripts/tests/*.test.mjs scripts/tests/*.test.mjs` | 276 of 276 |
| actionlint 1.7.12 over `.github/workflows` | clean |
| both notices checks | match `pnpm-lock.yaml` and `Cargo.lock` |
| `bun web/scripts/jscGolden.mjs` | 4 of 4 goldens (PROVISIONAL, Bun's JavaScriptCore is not Safari's); the hosted `macos-26` run is still to come |
| prose lint on the 12 changed `.md` files | pass; `TESTING.md` (14 triads) and the addendum (34) warn exactly as `HEAD` does |
| changed files scanned for carriage returns, long dashes (em and en), control characters, tool attribution, and non-ASCII outside Markdown | clean, apart from licence text in the two generated notices files, accented key characters in key-table test data and in `NavToolbar.tsx` (as in `HEAD`), `\u0000` in `bundleCheck.test.ts` (as in `HEAD`); all LF |
| free space on C: | 424.8 GB at the start, 424.5 GB at the end |

## Ownership, for the manager

`git status` lists 30 paths outside the `owns` of the five slices and the `merge_owns` of the wave. The spec's last release check cannot read "only owned files" for this tree; the manager has to accept the list or move ownership. Reasons:

- Not this wave's by origin: `.github/workflows/ci.yml` and `docs/desktop/ci.md` (wave w2b's files; the two lines and the one table cell above, the merge step the w2a note reserves).
- Wiring of the tables and notices into the app: `web/src/chrome/CommandLine.dispatch.ts`, `HelpScreen.css`, `HelpScreen.keymap.tsx`, `HelpScreen.tsx`, `KeyToolbar.tsx`, `KeyToolbar.test.tsx`, `NavToolbar.tsx`, `NavToolbar.test.tsx`; `web/src/screens/help/HelpIndex.tsx`, `HelpScreen.tsx`, `NoticesDisclosure.tsx`, `HelpScreen.platform.test.tsx`; `web/src/copy/platformKeys.ts` and its test; `web/src/export/grab/run.ts` and `prepare.ts` (platform key names in messages); `web/e2e/desktop/65-help-notices.desktop.ts`.
- Build and test plumbing for `dist-selftest`: `web/.gitignore`, `web/scripts/lineEndings.test.ts`, `web/src/theme/noBrand.test.ts` (skip lists), `web/scripts/shellBudget.test.ts` (shell pin, the key table's growth), `web/scripts/selftestBuild.ts` and its test.
- Splits that keep `tsc -b` clean and files under 800 lines: `web/e2e/desktop/parityRecord.ts`.
- Documentation and help text of the wave's features: `docs/TESTING.md`, `docs/desktop/03_appendix_a_addendum.md`, `docs/desktop/checks/README.md`, `scripts/smoke_real.ps1` (one help sentence; the file is 918 lines, one more than `HEAD`, an existing excess).

Nothing is committed. Ready to push.

## Release check after the fixers (third pass)

Two failures came back from the second pass. Logs are in `D:/dev/v04/w5-mac-kit/rel3/logs/`.

| Failure | Cause | Outcome |
| --- | --- | --- |
| The worktree holds 30 paths outside the owns lists and `merge_owns`. | The lists name each slice's own files and nothing else. The wave also had to change the code that reads the key tables, the HELP screens, the build skip lists and the testing and checks docs, and a hosted-CI gap that the w2a base left. None of these can go to a slice without breaking a check, and `waves.json` is read-only to the wave. The list was not shortened by moving code into owned folders to satisfy the check: that would put production code under `web/src/selftest/**` or fold `parityRecord.ts` back into a file over the 800-line ceiling. | Not a defect of the tree. The manager must accept the 30 paths below or move their ownership. Each has its reason; none is a route, a backend module or a Rust file. |
| `src/vendor/radixPrimitiveStub.test.tsx` cannot load. | Vite refuses (`Denied ID`) the `?raw` import of `cmdk`, because the borrowed `node_modules` reaches the main tree's store by junction, outside the dev server's file allow list. | Environment artefact, shown by running the file with `server.fs.strict` off through a scratch config that was deleted again: 7 of 7 tests pass. On a proper install it loads unchanged. A post-merge check. |

One real defect was found and fixed while checking: the help text added to `scripts/smoke_real.ps1` named the spec as `webe2edesktopparity.app.ts` (the backslashes of the path had been eaten). It now reads `web/e2e/desktop/parity.app.ts`. `smoke_real.tests.ps1` (16 of 16) and `smoke_real.ps1 -SelfTest` pass. No test was added for a help sentence: a new test file would be a thirty-first path outside the lists.

### The 30 paths outside the owns lists

Wiring and build plumbing (the same list as above, with the reason once each):

| Path | Why it is outside, and why it stays |
| --- | --- |
| `.github/workflows/ci.yml`, `docs/desktop/ci.md` | One step and one table cell: `record_green.tests.ps1` was missing from the release-script step, the one inherited failure of `ci-workflow.test.mjs` in the w2a base. Without them "all pass" for `node --test desktop/harness/tests` cannot hold. They belong to w2b and w2a; if the manager takes them from there, revert these two and that test reports its inherited failure again. |
| `docs/TESTING.md`, `docs/desktop/checks/README.md`, `docs/desktop/03_appendix_a_addendum.md`, `scripts/smoke_real.ps1` | Documentation of the wave's new projects, the parity record and the new files. The addendum is read by `backend/tests/test_desktop_tree.py` (9 of 9 pass) and by `docs-claims.test.mjs`. |
| `web/.gitignore`, `web/scripts/lineEndings.test.ts`, `web/scripts/shellBudget.test.ts`, `web/src/theme/noBrand.test.ts` | `dist-selftest` is git-ignored and skipped by the two tree walks; the shell budget moved by the keys table, with its reason beside it. |
| `web/src/chrome/CommandLine.dispatch.ts`, `KeyToolbar.tsx`, `NavToolbar.tsx` and their two tests, `HelpScreen.css`, `HelpScreen.keymap.tsx`, `HelpScreen.tsx`; `web/src/export/grab/run.ts`, `prepare.ts`; `web/src/screens/help/HelpIndex.tsx`, `HelpScreen.tsx` | Consumers of the key tables: they read the platform's names instead of the PC's. |
| New: `web/src/copy/platformKeys.ts` and its test, `web/src/screens/help/NoticesDisclosure.tsx`, `HelpScreen.platform.test.tsx`, `web/e2e/desktop/65-help-notices.desktop.ts`, `web/e2e/desktop/parityRecord.ts`, `web/scripts/selftestBuild.ts` and its test | Pure platform lookup, the HELP notices block, its desktop spec, the parity record split, and the self-test build helper. |

## Third pass results

All on the final tree (the only edit since the second pass is the help sentence above, a comment in a PowerShell script).

| Check | Result |
| --- | --- |
| `tsc -b`, `tsconfig.node.json`, the six e2e type projects, `gen-api --check` | clean, clean, 6 of 6 clean, in sync |
| full Vitest with the CI exclusions | 531 of 532 files, 7,999 tests passed, 48 skipped; the one file is `radixPrimitiveStub.test.tsx` (above), 7 of 7 with the allow list off |
| production build and `bundleCheck dist` | shell 110.5 of 115.6 kB gzip; perspective 86.1, echarts 201.6, lightweight-charts 61.4, uplot 22.1, tanstack-grid 18.7; no `selftest` string in `dist` |
| `build:selftest` | shell 73.1 of 75.0 kB gzip |
| `e2e` (chromium) | 619 passed, 21.6 min |
| `e2e:perf` alone | 3 passed |
| `e2e:offline` | 190 passed, 3 skipped, 6.3 min |
| `e2e:desktop` (hidden smoke build, fixture lab) | first run 64 passed and the window watch failed: a Windows Terminal window (pid 8708, started from explorer, not in this run's app tree) came to the front. Run again alone under the slot: 64 of 64, window watch clean |
| `node --test desktop/harness/tests` | 444 tests, 443 pass, 1 skipped, 0 fail |
| `node --test desktop/scripts/tests scripts/tests` | 276 of 276 |
| `record_green.tests.ps1`, `smoke_real.tests.ps1`, `smoke_real.ps1 -SelfTest` | 30 of 30, 16 of 16, passed |
| actionlint 1.7.12 over `.github/workflows` | clean |
| both notices checks | match `pnpm-lock.yaml` and `Cargo.lock` |
| `bun web/scripts/jscGolden.mjs` | 4 of 4 goldens at 1e-9 relative (PROVISIONAL) |
| prose lint on the 12 changed `.md` files | pass, except `TESTING.md` (14 triads) and the addendum (34 triads), the same counts `HEAD` has; `copyRules.test.ts` ran in the full Vitest |
| scans of the changed files | no CR, no em or en dash outside the two notices files (licence text), no control character beyond the NUL in `bundleCheck.test.ts` that `HEAD` holds, no tool attribution (the word "generated" in the notices headers names the generator command) |
| free space on C: | 425 GB at the start and at the end |
