# W0 owner pack, slice stale-docs: note

This slice fixes the stale statements in the files that the finisher of stream A does not touch (state.md, section 10). The figures come from `g2_windows/verdict.md`, the 0.3.2 section, which is the latest stated G2 verdict of a published release.

## Changed

- `docs/desktop/README.md`, the Status paragraph: the release figures now read the 0.3.2 verdict (idle memory at HOME 206.0 MB, first-launch cold HOME 3,966 ms, AUTOMATED PASS, OWNER ROWS PENDING), with sources from `verdict.md` lines 3 to 32. The sentence "The pitch deck is still to come" is reworded to "A pitch deck, when written, will be listed in the table above, ...".
- `docs/desktop/owner_decisions_windows.md`, row 207 (accepted departures): the CI row now says `.github/workflows/ci.yml` exists and runs on each push and pull request to `main`. `gh run list --workflow ci.yml` shows successful runs on main on 7 and 11 October 2026.
- `docs/desktop/owner_decisions_windows.md`, row 149 (O14): the status now reads "Open: answered in practice by LICENSE:1-4 (all rights reserved, published for viewing and evaluation only); owner to confirm; matters only for free open-source signing". The register did not contain the wording the brief quoted, so the row was rewritten from its own text. The owner still confirms the answer.
- `desktop/harness/tests/docs-figures.test.mjs` (new): four tests. They check that the README Status quotes the idle memory and the first-launch cold HOME of the latest verdict, that it names release 0.3.2 with the verdict it states, and that it keeps no 0.1.1 reading and no "pitch deck is still to come".
- This note.

## Born-failing evidence

Before the README was changed, `node --test desktop/harness/tests/docs-figures.test.mjs` ran four tests and all four failed:

- idle memory: `actual '477.3 MB'`, `expected '206.0 MB'`;
- first-launch cold HOME: `actual '3,192.5 ms'`, `expected '3,966 ms'`;
- release: the Status does not match `/release 0\.3\.2/i` (it names release 0.1.1);
- the Status still contains `477.3 MB`, `3,192.5 ms` and "pitch deck is still to come".

After the change all four pass.

## Stale lines outside this slice (for waves w2b and w9)

Nothing below was edited. The replacement column names the source for each change. Where the source could not be checked from this slice, the row says so.

| File and line | Stale statement | Replacement or check |
| --- | --- | --- |
| `SECURITY.md:122` | "The installer (0.1 and 0.2) has no Authenticode signature" | "The installer (0.1, 0.2 and 0.3.x) has no Authenticode signature." The Status in `docs/desktop/README.md` still calls the installer unsigned. |
| `desktop/README.md:75` | The IB switch row (Options switch, `ib_snapshot` at the next start) | Not confirmed stale here. Check against O10 in `owner_decisions_windows.md` (from 0.3.2 the Options switch sets it, confirm, next start) and `desktop/src-tauri/src/ib_switch.rs`. |
| `desktop/README.md:119` | The owner-only checks named in the paragraph | Replace the list with the owner checks still pending in `docs/desktop/checks/README.md`. |
| `desktop/README.md:124` | "The release build is never launched by an automated run" | Not verified stale. Check against `desktop/src-tauri/src/window.rs`. |
| `desktop/README.md:125` | "no gate figure exists yet"; the harness refuses a row run until the reproduction passes | Stale. Replace with: "The G2 figures of release 0.3.2 are in `docs/desktop/g2_windows/verdict.md`; the harness labels rows UNREPRODUCED when its reproduction fails, as it did for 0.3.1." Sources: `verdict.md` lines 3 and 7 (the W0B reference was re-anchored on 7 October 2026 and reproduced). |
| `desktop/README.md:129` | The owner-only list of open items | Replace with the pending owner checks in `docs/desktop/checks/README.md`; the 0.3.2 verdict says owner rows are pending. |
| `desktop/README.md:130` | The open items from W4B (async script failure, UI-thread wait, junction test gap) | Not verified stale. Check against `desktop/src-tauri/src/window_folders.rs` and the window code. |
| `docs/desktop/handover_windows.md:20` | The D5 step 2 row quotes the 0.1.1 figures (477.3 MB idle, 3,192.5 ms first launch) as the G2 reading | Keep as history, or add a 0.3.2 row with the figures of `verdict.md` lines 19 to 27: idle 206.0 MB (185.3 to 206.6), first-launch cold HOME 3,966 ms (3,774 to 4,287), usual 3,098 ms, backend ready 2,038 ms. |
| `docs/desktop/handover_windows.md:388` | `start.ps1` says port 8765 "is taken by another program" | Not verified. `start.ps1` exists at the repository root; check its message before editing this row. |
| `docs/desktop/04_roadmap.md:23` | The planning basis and the M6 date (about 21 May 2027) | Re-plan from the 0.3.2 verdict. No replacement figure is proposed here. |
| `docs/desktop/04_roadmap.md:255` | "3 write routes exactly; 0 shell IPC uses in `web/src`" | Not verified. Check against the route table. |
| `docs/desktop/04_roadmap.md:283` | D4.4 names `desktop/src-tauri/tests/writes_deny.rs` | That path does not exist (checked). Point the row at the real test file. |
| `docs/desktop/04_roadmap.md:549` to `553` | The M4 to M8 date ranges | Re-plan. No replacement figure is proposed here. |
| `docs/desktop/ci.md:74` | "The workflow has not yet run on a hosted runner at the time of writing" | Stale. Replace with: "The workflow has run on hosted runners on main and passed on 7 and 11 October 2026." Source: `gh run list --workflow ci.yml`. The Node 24.13 note in the same bullet is a separate point and can stay. |

## Appendix A addendum entries

- `desktop/harness/tests/docs-figures.test.mjs`: new test file, a harness test. Fate: kept. The CI desktop harness step (`node --test desktop/harness/tests/*.test.mjs`) runs it.
- `docs/desktop/v04/w0-owner-pack__stale-docs.md`: this note. Fate: kept under `docs/desktop/v04/`. It is not a module or a route.

No module or route was added or removed.

## Checks run

- `node --test desktop/harness/tests/docs-figures.test.mjs`: 4 of 4 pass after the change (4 of 4 failed before).
- `node --test desktop/harness/tests/docs-claims.test.mjs`: 2 of 4 pass. The two failures are "no owner check template names a release commit, an installer hash or the 0.1.0 release" and "every session step in session_order.json names an existing owner template". Both belong to the checks-refresh slice, which owns that file and the checks folder. This slice did not touch them.
- `CI=true node node_modules/vitest/vitest.mjs run scripts/docsSync.test.ts` from `web/`: 38 of 38 pass.
- The prose lint (`ai_pattern_check.py`, run with the nq-lab venv Python on the changed files): no FAIL. The warnings are the same as on the HEAD versions of the two files.

## Not done or not verified

- The roadmap dates (`04_roadmap.md` lines 23 and 549 to 553) need a re-plan. No figure was changed.
- The rows marked "not verified" above were not checked against code or other sources.
- `web/node_modules` is a directory junction to the main tree's `web/node_modules`, made for the vitest run. It is ignored by git through `web/.gitignore`. Nothing was installed.
