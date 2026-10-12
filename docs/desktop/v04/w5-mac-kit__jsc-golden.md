# w5-mac-kit, slice jsc-golden: the JavaScriptCore goldens and mac-webkit.yml

Written 12 October 2026. Refs D7.1, G1 items 1 and 2 (state.md 11.1 and 11.2). Every figure below is a demo figure (the goldens
are fixtures, not research data) and PROVISIONAL (one engine build, one machine).

## What was built

`web/scripts/jscGolden.mjs` runs the four goldens of `qa/golden` through the browser's own maths at 1e-9 relative:

| Golden | Compared through | Comparisons |
|---|---|---|
| `p12_power` | `normalCdf`, `normalQuantile`, `minimumDetectableSharpe`, `powerAtSharpe` (`web/src/quant`) | 322 |
| `p12_neff` | `pearsonMatrix`, `symmetricEigenvalues`, `averageLinkage`, `flatClusters`, `participationRatio`, `liJiCount`, `expectedMaxSr0`, `probabilisticSharpe`, `sessionSharpe` (`web/src/quant`) | 291 |
| `p12_expectation` | `pathOnCone` (`web/src/screens/live/expectationReference.ts`, which imports nothing; the task names `web/src/quant` but this one function lives in `screens/live`) | 100 |
| `p2_neff_served` | `referenceEffectiveN`, `referenceMembers` (`web/src/quant/neffReference.ts`) against the served SV3b and SV8 views | 296 |

A number passes when `|got - want| <= 1e-9 * max(|got|, |want|)`. There is no absolute floor, so a value near zero is held to
the same relative distance (the first run needed none). Integers, names, cluster labels and band names must be equal. A golden
that compares nothing, or is not loaded, or has the wrong shape, fails with a message and never throws.

The script reads no file at run time: the goldens are imported as JSON, so the same source runs

- under Bun directly: `bun web/scripts/jscGolden.mjs` (exit 0 for 4 of 4, exit 1 otherwise);
- as a bundle in the `jsc` shell, which has neither `process` nor `fs`: `bun build web/scripts/jscGolden.mjs --target=browser
  --format=iife --outfile=<file>` (the script throws instead of setting an exit code when there is no `process`);
- as a library under vitest, when `globalThis.__NQ_JSC_GOLDEN_AS_LIBRARY__` is set before the import.

`.github/workflows/mac-webkit.yml` has three jobs, all on `macos-26`, with a read-only token (`contents: read`, no job sets its
own permissions), every action pinned by full SHA, Bun pinned to 1.3.9, Node only (no Python, pip or uv):

1. `jsc-golden`: Bun on macOS always; then the system `jsc` shell on a bundle of the same script, when a shell is found and runs.
   If none is found the run says FALLBACK and the reading is Bun's JavaScriptCore on macOS, which is a WebKit build and not
   Safari's. No dependency is installed (the quant files import only each other).
2. `webkit-offline`: `playwright install webkit`, then the `offline-webkit` and `offline-webkit-demo` projects of
   `web/playwright.offline.config.ts` (the gallery build and the in-page demo build, `dist-demo`, behind `vite preview` with the
   Node-side demo API), `--workers=2 --update-snapshots=all` as `ci.yml` does for its offline job.
3. `webkit-selftest`: `pnpm build:selftest`, then a script written to `web/node_modules/.tmp` opens the page in Playwright's
   WebKit from `vite preview` and reads `window.__selftest`.

Triggers: weekly (Monday 06:17 UTC), dispatch, and a push whose paths are exactly `.github/workflows/mac-webkit.yml`, so the first
run happens on the wave branch (a schedule or dispatch trigger runs only from the default branch).

## Files and their fate (for the 03 Appendix A addendum)

| File | Fate |
|---|---|
| `web/scripts/jscGolden.mjs` | new script, kept; run by hand, by the workflow and by its test |
| `web/scripts/jscGolden.test.ts` | new vitest file, kept (22 cases; the last one starts Bun when it is installed and is skipped where it is not) |
| `.github/workflows/mac-webkit.yml` | new workflow, kept; first run on the branch after the manager pushes |
| `desktop/harness/tests/mac-webkit-workflow.test.mjs` | new `node --test` file, kept (17 cases) |
| `docs/desktop/v04/w5-mac-kit__jsc-golden.md` | this note |

Nothing else was created. Scratch output (a bundle and a tampered copy used to try the failing path) is under
`D:/dev/v04/w5-mac-kit/jsc/` and is not part of the tree.

## Born failing

- `jscGolden.test.ts`: first run, before the script existed, 1 suite failed to load (`Cannot find module .../scripts/jscGolden.mjs`),
  0 tests ran. After the script: 22 of 22 pass. The cases that feed a broken golden: a minimum detectable Sharpe row, a CDF value
  at 4.9e-198, a correlation, an eigenvalue, a linkage height, a participation ratio, the paper example DSR, a placement fraction, a
  served estimate, a served correlation and a served participation figure, each shifted by 1e-6 relative, each makes its golden
  fail; a shift of 5e-10 passes and 5e-9 fails (the tolerance is pinned from both sides); a changed cluster label, linkage child,
  band name, beyond count, served cluster and served name fail; an empty case list, a missing golden and a golden without its
  `mde` table fail.
- `mac-webkit-workflow.test.mjs`: first run, before the workflow existed, the file-exists case and the clean-copy case failed
  (for example `top-level permissions must be exactly "contents: read", found: none`). After the workflow: 17 of 17 pass. The
  cases feed the broken state to each guard: the push trigger removed, a push trigger with no paths or an extra path, a missing
  schedule or dispatch trigger, `pull_request_target`, `contents: write` at the top, a write scope in a job, an action pinned by
  tag, branch or with no release comment, a Linux runner, `macos-latest`, a missing job, a Python action and command, `uv`,
  `continue-on-error`, `|| true`, a missing timeout, a checkout that keeps the token, an event field in a script, Bun unpinned or
  at 1.3.x, a missing install, offline-project, self-test or golden command, and figures without the demo or PROVISIONAL label or the
  named FALLBACK. A last case runs every guard on the clean text, so a guard that always complains cannot satisfy the cases above.

## The first reading, here

Bun 1.3.9, WebKit build `0ddf6f47af0a9782a354f61e06d7f83d097d9f84`, Windows, 12 October 2026:

```
jsc-golden:   p12_expectation ok (100 comparisons)
jsc-golden:   p12_neff ok (291 comparisons)
jsc-golden:   p12_power ok (322 comparisons)
jsc-golden:   p2_neff_served ok (296 comparisons)
jsc-golden: 4 of 4 goldens pass at 1e-9 relative (demo data, PROVISIONAL: this engine's JavaScriptCore is not Safari's)
```

The same script under vitest (V8) also passes 4 of 4. The bundle was run in a Node `vm` context with only `console` (no
`process`, no `fs`) and printed 4 of 4; a copy with one golden value edited printed 3 of 4 and threw, under Bun it exited 1.
That shows the bundle needs nothing from Node. It does not show the `jsc` shell runs it: no `jsc` binary is on this PC.

## Unverified

- The path of the `jsc` shell on a `macos-26` image. The step tries `JavaScriptCore.framework/Versions/A/Helpers/jsc`,
  `.../Resources/jsc`, `/usr/local/bin/jsc`, `command -v jsc`, `xcrun --find jsc` and a `find` under the framework, and the shell
  must run `print('jsc shell reachable')`. If none works the job still passes on Bun and the summary says FALLBACK. A pass is then
  Bun's JavaScriptCore, not Safari's.
- Whether the `jsc` shell prints through `console.log` or `print`: the script uses `console.log` when it exists and `print` otherwise.
- Whether `bun build --format=iife` output runs unchanged in the `jsc` shell (it runs in a bare V8 context; JavaScriptCore itself is untried).
- The self-test step was written against a guessed contract (`done === true`, the page at `/`), which the merge found wrong when it read the page: the report carries `state` ('running', 'awaiting-gesture', 'done'), the page waits for one click, and the build lives under `/__selftest/`. The merge rewrote the step to match (it serves the build under its base path, clicks the button, waits for `state === 'done'` and judges the report with the page's own `judgeReport`), proved the script by running it under Playwright's WebKit on Windows, and added a guard case (`checkSelftestContract`). What is still unproven is the same script on `macos-26`.
- That Playwright 1.63.0's WebKit installs and runs on `macos-26`, and that the two `offline-webkit` projects (written by the
  webkit-windows slice) keep those names. The workflow names them exactly.
- The weekly schedule and a dispatch cannot run before the workflow is on the default branch; only the push trigger runs on the branch.
- `actionlint` 1.7.12 passes over all of `.github/workflows` (including this file), which checks syntax and expressions, not behaviour.
