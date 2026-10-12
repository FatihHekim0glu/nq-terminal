# Wave w5-mac-kit, slice selftest-page: the D7.2 self-test page

Worktree `E:/projects/nq-lab/wt-w5`, branch `v04/w5-mac-kit`, written 12 October 2026. Nothing is committed: the manager makes the git writes.

## What it is

A page that runs inside the app's own engine and reports, as one JSON object on `window.__selftest`, three things:

- axe-core over the finished page with the WCAG 2.2 AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), the same set as the Chromium specs;
- the four quant goldens of `qa/golden` (`p12_expectation`, `p12_neff`, `p12_power`, `p2_neff_served`) run through the page's own code at one part in 1e9 relative (anything that is not a number must match exactly);
- five feature probes: Perspective wasm32 (the 32-bit server only, a pivot summed and checked), dockview layout restore (save, clear, restore, compare), stream mode (the app's `LiveStream` over `/api/live/stream`, open and held for 1.5 s with no polling), text copy and blob export (both through the bridge, which is the only place the app copies or saves).

The text copy and the save want a user gesture, so the run waits for one click ("Run the clipboard and export probes") after the plain probes; `?gesture=auto` skips the wait for a driver that cannot click. Axe runs last, over the page with every probe's host still mounted.

No shell code changed, and nothing is written to the shell log (critique.md finding 6): the report is read over the debugging protocol only.

## How it is built and kept out of production

- `vite build --mode selftest` (`pnpm build:selftest`) builds `src/selftest/index.html` to `web/dist-selftest`, served under `/__selftest/`. A small plugin writes the page out as `index.html`; `publicDir` is off for this mode; axe-core is a chunk of its own, and dockview and Perspective load lazily.
- No input of any other mode reaches the page. `scripts/bundleCheck.ts` has rule 9: a production, gallery or demo bundle holding either self-test marker (`nqt-selftest`, `__selftest`) fails, and a self-test build must hold both. The self-test shell is held to a budget of 75 kB gzip (measured 73.1 kB), so a static import of axe, dockview or Perspective fails.
- `src/selftest/isolation.test.ts` fails any file outside `src/selftest` that names the page.

## How the desktop spec runs it

`web/e2e/desktop/06-selftest-page.desktop.ts` builds `dist-selftest` when it is missing or older than the page's sources, then answers the page's own requests under `/__selftest/` from that folder with `page.route`, using the Content-Security-Policy the backend itself sent (read from the app's answer, not copied). The page therefore runs on the app's origin, under the app's policy, through the app's own bridge and download handler, and the backend is untouched. It clicks the one button, waits for `state: 'done'`, judges the report with `judgeReport` (the same judge the page's tests use), then checks the other end of the two probes the page cannot see: the Windows clipboard holds the probe text, and the exported file in `--save-dir` holds the probe csv. It removes that file and restores the owner's clipboard text afterwards, so `30-export` still finds `--save-dir` as it expects.

## New files and their fate (03 Appendix A addendum)

| File | Fate |
| --- | --- |
| `web/src/selftest/index.html`, `main.tsx`, `SelfTestApp.tsx`, `selftest.css` | new, kept: the page (dev and proof build only) |
| `web/src/selftest/session.ts`, `run.ts` | new, kept: the wiring and the ordered run (goldens, plain probes, gesture wait, gesture probes, axe) |
| `web/src/selftest/report.ts` | new, kept: report types, constants and `judgeReport` (pure, shared with the desktop spec) |
| `web/src/selftest/compare.ts`, `goldens.ts`, `goldenData.ts`, `quant.load.ts` | new, kept: the golden comparison; the goldens as `?raw` text; the one file that imports the quant test references, dynamically |
| `web/src/selftest/probes.ts`, `probes.dockview.tsx`, `axe.ts` | new, kept: the probes and the axe run |
| `web/src/selftest/*.test.ts`, `report.testUtil.ts` | new, kept: tests and test support (`report.test.ts`, `goldens.test.ts`, `run.test.ts`, `isolation.test.ts`) |
| `web/e2e/desktop/06-selftest-page.desktop.ts` | new, kept: the desktop spec |
| `web/vite.config.ts` | changed: `SELFTEST_MODE`, `SELFTEST_BASE`, `SELFTEST_OUT_DIR`, `baseFor`, `buildInputs`, `outDirFor`, `chunkGroupsFor` (axe chunk), `selftestPageAtRoot`, `publicDir` off for the mode |
| `web/scripts/bundleCheck.ts`, `bundleCheck.test.ts` | changed: rule 9, `--selftest`, base-path-aware entry reading, a selftest shell budget; hand-made, real-build and planted-import cases |
| `web/package.json`, `web/pnpm-lock.yaml` | changed: `build:selftest` script, `axe-core` 4.13.0 as a dev dependency (already in the lockfile through `@axe-core/playwright`; the importer entry was added by hand and `pnpm install --lockfile-only --offline` on a copy left it unchanged) |
| `web/dist-selftest/` | generated, git-ignored once `web/.gitignore` carries it (see wiring) |

No route, no backend file and no shell file was added.

## Tests and their born-failing evidence

Every guard was written first and seen to fail on the broken state (`D:/dev/v04/w5-mac-kit/selftest-red.txt` holds the red run: three test files could not load, nine cases failed).

| Guard | Born-failing case | Where |
| --- | --- | --- |
| Production holds no self-test code | a hand-made production dist carrying either marker, a marker in the shell, and a real production build whose entry is given one extra `import('./selftest/main')` by a Vite plugin: all fail | `scripts/bundleCheck.test.ts` (rule 9) |
| A self-test build holds its markers | a self-test dist without them fails, with half of them fails | `scripts/bundleCheck.test.ts` |
| The self-test shell stays small | a shell over 75 kB gzip fails; Perspective imported statically fails | `scripts/bundleCheck.test.ts` |
| Goldens at 1e-9 | for 14 chosen numbers across the four goldens, a copy off by 1e-6 fails that golden and no other, while 1e-10 passes; an engine made 1e-6 wrong (cdf, placement, eigenvalues) fails; a changed band or cluster fails | `src/selftest/goldens.test.ts` |
| The judge | one golden off by 1e-6, a golden that says it passed but whose numbers do not, an axe violation or wrong tags, a failed, skipped or missing probe, an unfinished run, a non-report | `src/selftest/report.test.ts` and the guard test in the desktop spec |
| The run | a probe that throws, a probe that never answers, a crashed golden run, a crashed axe run: each is a failure on the report | `src/selftest/run.test.ts` |
| The desktop spec | against a copy of the build with one cdf golden changed by 1e-6, the in-app test fails and names `p12_power` (relative error 6.3e-6) | `NQT_SELFTEST_DIST=D:/dev/v04/w5-mac-kit/dist-tamper2` |
| Isolation | no file outside `src/selftest` names the page; the quant references are imported dynamically in `quant.load.ts` only | `src/selftest/isolation.test.ts` |

Regression guards (they pass on today's tree and would also pass without the new code, so they are named as such): the scan that reads the whole of `src` (it checks that it sees more than 300 files), and the check that the production shell stays under its existing budget.

## Results

- `src/selftest/*.test.ts`: report 11, goldens 34, run 10, isolation 4 (59 cases), all pass. `scripts/bundleCheck.test.ts`: 32 cases, all pass, including the real production, gallery, demo and self-test builds and the planted-import build.
- The four goldens in this machine's V8: worst relative error 0 (expectation), 9.1e-15 (neff), 5.7e-14 (power), 1.8e-14 (served), against a limit of 1e-9.
- Headless Chromium 153 against the built page (slot PLAYWRIGHT): axe 0 violations, goldens 4 of 4, Perspective wasm32 and dockview restore pass. The stream probe failed there for want of a backend and the clipboard probe for want of focus, which is why the real run is in the app.
- `pnpm e2e:desktop` for `05-selftest` and `06-selftest-page` in the hidden smoke build (`D:/dev/targets/check/release/nq-lab-terminal.exe`, fixture lab, slot PLAYWRIGHT): 13 of 13 pass, the in-app test in about 5 s: axe 0 violations, goldens 4 of 4, all five probes pass, the Windows clipboard holds the probe text, the exported file in `--save-dir` holds the probe csv. The window watch of the run was clean.
- `tsc -b` (app and node projects, apart from `e2e/` files of other slices) and `tsc -p e2e/desktop/tsconfig.json` (for this slice's files) are clean. Also green with the new code: `importGuard`, `noShellIpc`, `docsSync`, `lineEndings`, the `src/api` safety scan, `wasm32Pin`, `src/theme`, `viteConfig`.

Findings kept honest:

- `scripts/shellBudget.test.ts` ("stays at the shell diet 4 target") fails with 110,161 bytes against its 110,000 pin. It is not this slice: a production build with the unchanged `vite.config.ts` from HEAD gives the same 110.2 kB, and the growth comes from another slice's edits to `CommandLine.keys.ts` and `help.ts`. The merge agent should see it.
- `src/vendor/radixPrimitiveStub.test.tsx` cannot load in this worktree ("Denied ID ... cmdk ... ?raw"): the node_modules here is a set of junctions into the main tree, outside Vite's allowed folders. It is an environment effect and not caused by this slice.
- The app refuses to show its page while `web/dist` is older than the sources (the handshake's `dist` state), so after any edit to `web/src` the production dist must be rebuilt (`vite build`, then `node scripts/buildStamp.mjs`) before the desktop specs run. The self-test build does not need this, and the spec rebuilds `dist-selftest` itself when it is stale.

## Wiring (files this slice does not own)

1. `web/.gitignore`: add the line `dist-selftest`, beside `dist-gallery` and `dist-demo`. Until then `web/dist-selftest/` (generated by the spec, and left in this worktree) shows in `git status` and must not be committed.
2. Optional, `web/src/quant/importGuard.test.ts`: nothing is needed, because the page imports the test-reference quant modules dynamically from `src/selftest/quant.load.ts`. If the merge prefers an explicit exemption instead, allow `selftest/quant.load.ts` there.
3. CI and release checks may add `pnpm --dir web build:selftest` (builds and checks the page) to the web job; the desktop spec does not depend on it.

## Not done

- The page in a WKWebView (the Mac half of D7.2 and G1 item 2) is the Mac wave's: the page and the judge are ready, the stream probe needs a backend or the offline demo's HTTP stream, and the Mac key rows need real keys.
- `pnpm install` was not run, by instruction: the `axe-core` entry in `web/pnpm-lock.yaml` was written by hand and checked by `pnpm install --lockfile-only --offline` on a copy of the three files, which left the lock byte for byte unchanged. Tests that need `axe-core` installed (the self-test build itself) ran here through a junction to the main tree's store copy of 4.13.0 and are post-merge checks on a proper install.
