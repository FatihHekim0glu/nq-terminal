# w5-mac-kit, slice parity-auto

Status: the automated weekly parity list is built and green in fixture mode on the hidden smoke build (18 of 18 tests on the final code, and on the two runs before the last small edits). The real-lab mode is written and lists correctly, but it has not run: the script that wraps it refuses a worktree, so the post-merge agent runs it from the main tree. Nothing was committed.

## What was built

| File | Change |
| --- | --- |
| `web/e2e/desktop/parityAuto.ts` | new: the second door, the figures and the row runners (624 lines; re-exports `parityRecord.ts`) |
| `web/e2e/desktop/parityRecord.ts` | new, split out by the merge (221 lines): the rows, the comparison, the gate log reading, the record and where it is written; no browser import |
| `web/e2e/desktop/80-parity-auto.desktop.ts` | new: the fixture-mode spec (18 tests) and row 13 with its own fixture backend |
| `web/e2e/desktop/parity.app.ts` | new: the real-lab spec, opt-in with `NQT_PARITY_REAL=1` |
| `web/playwright.desktop.config.ts` | real mode now matches `smoke.app.ts` and `parity.app.ts`, and nothing else |
| `web/scripts/playwrightDesktopConfig.test.ts` | new: 20 vitest cases |
| `docs/desktop/checks/2026-10-12_weekly-parity-auto.md` | new: the blank template of the record |
| `docs/desktop/v04/w5-mac-kit__parity-auto.md` | this note |

## How it works

The app's own page is the first door. The second door is a headless Chromium launched by the run, from the browsers already installed, holding the app's own session cookie. The cookie is read over the debugging protocol from the app's page (`Network.getAllCookies`, as `served-session.ts` reads it), so no launcher is started, the owner's port 8765 is never named, and `doorOrigin` refuses any origin that is not `http://127.0.0.1` or that uses 8765.

A row reads figures from the DOM in each door (key figures, chart summaries, the first rows of grids and tables, the table view of GP) and `compareFigures` lists every difference, with both values. A door that reads nothing is a difference. A console error, a failed API answer or a request that is not a same-origin GET in either door turns the row red too.

| Row | Way | What the run does |
| ---: | --- | --- |
| 1 | both doors | the four HOME panels; no alert, placeholder or DEMO DATA flag |
| 2 | table view in both, GIP in the app | GP's table view (rows, edge rows, checksum); GIP wheel zoom and drag pan with the frame interval sampled in the page, p95 against the harness ceiling of 25 ms (a vitest case keeps the constant equal to `desktop/harness/lib/rows.mjs`) |
| 3, 5, 6, 8, 9 | both doors | REG and MT; EQ to MRET; MON and CORR; the stream line of LIVE and JRNL; HELP index and one topic |
| 4 | app | the fills grid and the pivot view show as many rows as the API holds; the fills' commissions add up to the run's own `fees_total`; the grid opens in under a second |
| 7 | both doors | LEDG and OOS as grid and pivot; the ledger pivot holds as many rows as the ledger; the gate log holds reads with caller `terminal` |
| 10 to 12 | owner | marked, with the reason |
| 13 | fixture only | queue the slow stand-in run, see the row, Stop, the confirmation, STOPPED, on a fixture backend with the fake runner |
| 14 | app | F1 and F8 to F11 over the debugging protocol, as `40-keys` does, with the dialog check kept |
| 15 | both doors | `SAVE`, change the layout, `LOAD` in the app; `LOAD` and `FORGET` in the browser; the app reloads and `LOAD` finds nothing |
| 16 | both doors | amber classic through the Options menu, reload, the same computed colours in both doors on HOME and REG; the standard look is put back |

Why row 13 is on a separate backend: every smoke build starts its backend with `NQT_JOBS=off` and builds the backend's environment from nothing (`supervise_check.rs`, `smoke_spec`), so the app's own fixture backend cannot queue a job. Row 13 starts the fixture backend with `NQT_FIXTURE_JOBS=fake` on a free port the system gives (bound to port 0, then let go; never 8765) and drives it through a door of its own. On real files the row is skipped, and the record says why.

The record: each test appends its row's result to `parity-rows-<mode>.jsonl` in the run folder (a failed test restarts the worker, which loses memory but not files). The last test reads the rows and the gate log, writes `<date>_weekly-parity-auto-<mode>.md` and `.json` into the run folder (and into `NQT_PARITY_OUT` when set, never on C:), and fails unless all 16 rows are present, none is red, rows 10 to 12 are the owner's, and the gate reading has 0 other callers and 0 lines after the fence. The gate log is read read only since the folder of the run was made; a fixture lab has none, and a real run without one fails.

## Commands

Fixture mode (from `terminal\web`, with a built and stamped `web\dist`, under the PLAYWRIGHT slot):

```powershell
$env:NQT_SMOKE_EXE = 'D:\dev\targets\<build>\release\nq-lab-terminal.exe'
pnpm e2e:desktop -- 80-parity-auto
```

Real mode, for the post-merge agent, from the main tree only, hidden, under the PLAYWRIGHT slot, with the merged smoke build and `web\dist` built and stamped. Append the start and end (UTC) of the run to `D:/dev/v04/measure/w5-mac-kit/windows.jsonl` and take the gate snapshot before it, as the wave's post-merge checks say:

```powershell
$env:NQT_PARITY_REAL = '1'
$env:NQT_PARITY_OUT = 'D:\dev\v04\measure\w5-mac-kit'
powershell -NoProfile -ExecutionPolicy Bypass -File terminal\scripts\smoke_real.ps1 -Mode App -Grep 'weekly parity list, real lab'
```

`smoke_real.ps1 -Mode App` sets `NQT_DESKTOP_MODE=real`, the smoke build, the lab and the runs folder, and keeps the temporary state folder, `NQT_JOBS=off`, the window watch and the research-file checks around the run. The record is PROVISIONAL until the owner's four items are done.

## Tests and born-failing evidence

`pnpm --dir web exec vitest run scripts/playwrightDesktopConfig.test.ts`: 20 passed. With `scripts/lineEndings.test.ts` and `scripts/playwrightConfig.test.ts` beside it, 39 passed.

`pnpm e2e:desktop -- 80-parity-auto` against the hidden smoke build (fixture lab), under the PLAYWRIGHT slot: 18 passed in about 1.3 minutes, window watch clean (the set-up's tear-down fails the run otherwise). With `40-keys`, `70-parity` and `90-look` in the same run, 32 passed, so the new spec leaves the page, the store and the look as `90-look` expects.

| Guard | Born-failing evidence |
| --- | --- |
| The real-mode config takes `parity.app.ts` | failed before the fix: the config matched `smoke.app.ts` only (`D:/dev/v04/w5-mac-kit/parity-auto-born-failing-1.txt`, 11 of 16 failed against a stub of `parityAuto.ts` and the old config) |
| A real-mode spec named `*.desktop.ts` fails; real mode matching more than the two real specs fails | `realModeViolations` is fed planted names and broader patterns and reports each. Both are regression guards on today's config, which already passes them; the guard function itself is proved by the planted cases |
| A fixture run that picks up a real spec | regression guard (the fixture pattern is `/\.desktop\.ts$/`) |
| A planted figure mismatch between the doors fails the row | unit case fails against a comparison that returns nothing (the same file); the live case (`born failing: a figure planted in one door only ...`) fails with the comparison blinded: `expected "red", received "green"` (`D:/dev/v04/w5-mac-kit/parity-auto-born-failing-2.txt`), and passes with it |
| A figure only one door has, a door that read nothing | unit cases |
| The gate log: other callers, lines after the fence, torn lines skipped | unit cases; a record with either fails; a real run whose gate log was not read fails |
| A record with a row missing, doubled or red, or a skipped row where it may not be | unit cases |
| A record folder on C:, or a parity door on 8765 or on a remote host | unit cases |
| The GIP bound equals the harness ceiling | unit case reading `rows.mjs` |

## Findings

- The two doors share one workspace store. A write that carries an old version gets a 412 from `/api/workspaces/<doc>`; the page reads again. The run waits for each door's pending writes (`__NQT_STORE_SYNC__`, the hook the shell uses before it stops the backend) before it hands the store to the other door, counts the remaining 412 answers and names their documents in the row's note, and does not count them as failures. Without the wait, rows 5 and 7 went red on 412 answers of `history` and `linkGroups`. With the wait alone, rows 2 and 9 still showed 412 answers of `history` and `watch`, so the run now counts them apart. One run recorded 50 such answers in row 2, and the documents were not named then; the run after that showed one `watch` answer, in row 15. The cause of the 50 is unexplained.
- A smoke shell shows `rebuild.html#needed` and no backend page when the stamp in `web\dist\build-stamp.json` is older than the sources. Other slices edit `src` in the same worktree, so every run here rebuilt with `vite build` and ran `node scripts/buildStamp.mjs` first.
- `resolveLab` for a worktree keeps a lab under the runs root and re-points its `terminal` junction at this checkout. The runs here used `NQT_APP_RUNS=D:/dev/v04/w5-mac-kit/app`, so the shared `D:/dev/d5/app/lab` was not touched.
- A smoke exe was not built here: `D:/dev/targets/release/release/nq-lab-terminal.exe` (11 October, 17:59) was copied with its `WebView2Loader.dll` to `D:/dev/targets/w5-mac-kit/release`.
- Opening a line in a panel replaces the panel, so a row that opens two lines reads the first before it opens the second. The first version of row 7 waited five minutes on a panel that no longer existed; every step of a row now fails after a minute instead.

## Unverified and not done

- The real mode has not run. Open questions for it: whether `fees_total` equals the fills' commissions on the run it picks (it does on the fixture run, 881.25 on both), whether REG, MT and CORR figures agree door to door on real files, and whether the OOS log holds reads with caller `terminal` at that point (the run's own display reads should put them there).
- The pivot view in row 4 is the accessible table the page opens under reduced motion, the same rows in the house grid. The interactive Perspective grid is not read. When the grid renders every fill (the fixture has 11) the Commission column is added up from the page; on a longer run only the row counts and the API sums are compared.
- Row 2's GIP figure is a frame-interval sample in the page, not the harness's trace; the harness row `gip_pan_zoom_p95` stays the measurement. The sample read 4.3 ms on an idle machine and the bound is 25 ms, so a loaded machine may need a look.
- The merge split the pure part of `parityAuto.ts` (837 lines then) into `parityRecord.ts`, because `tsc -b` type-checks `scripts/**/*.ts` under the node project, and the test that imports the pure functions pulled the page-evaluating code (which needs the DOM types) into that project: 71 errors. Both files are now under the 800-line ceiling and the specs still import `parityAuto.ts`.
- The shipped binary is not tested: it has no debugging port.

## Appendix A addendum (fate of new files)

| File or artefact | Fate |
| --- | --- |
| `web/e2e/desktop/parityAuto.ts` | new, kept: the shared module of the automated weekly parity list |
| `web/e2e/desktop/80-parity-auto.desktop.ts` | new, kept: the fixture-mode spec, in the project's file order before `90-look` |
| `web/e2e/desktop/parity.app.ts` | new, kept: the real-lab spec, not a `*.desktop.ts` file, opt-in |
| `web/scripts/playwrightDesktopConfig.test.ts` | new, kept: the layout of the desktop project and the pure rules of the list |
| `docs/desktop/checks/2026-10-12_weekly-parity-auto.md` | new, kept: the blank record template |
| `<run folder>/parity-rows-<mode>.jsonl`, `<date>_weekly-parity-auto-<mode>.md` and `.json` | written by each run under the runs root (D: only), not in the repository |
| a fixture backend for row 13 | started and ended by the row, on a free port, state in its own folder under the runs root |
| no new route, no new module in the app, no new port in the port table | none |

## Wiring for the merge step

Files this slice does not own:

1. `docs/desktop/checks/README.md`: one row in the table, after the weekly parity list, `not an owner check | The automated weekly parity list | [2026-10-12_weekly-parity-auto.md](2026-10-12_weekly-parity-auto.md) | D6, replaces 13 of the 16 rows of the weekly list | none | NOT RUN`, and one sentence that the weekly list's owner part is rows 10 to 12 and the real F10 and F11 keys. The file `2026-10-12_weekly-parity-auto.md` is outside the pattern of `desktop/harness/tests/docs-claims.test.mjs` (`2026-10-03_`, `2026-10-11_` and `README`), so its count of 18 files stays right.
2. `docs/desktop/03_appendix_a_addendum.md`: the table above.
3. `scripts/smoke_real.ps1` (optional): one line in the `-Mode App` help that `parity.app.ts` runs only with `NQT_PARITY_REAL=1` and `-Grep 'weekly parity list, real lab'`. Without that variable an ordinary `-Mode App` run lists the parity tests as skipped and changes nothing else.
4. The merge step's release checks: `pnpm --dir web e2e:desktop` runs `80-parity-auto` with the rest, in file order, before the look.
