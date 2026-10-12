# Wave w5-mac-kit, slice webkit-windows: the offline suite under WebKit on Windows

Roadmap item D8.1. The findings are in `webkit_windows_defects.md` (fidelity against WKWebView is unverified, and that file says so at the top).

## Files and their fate (for the 03 Appendix A addendum)

| File | Fate |
|---|---|
| `web/playwright.offline.config.ts` | Changed. Keep. Two opt-in projects, `offline-webkit` and `offline-webkit-demo`, on the `Desktop Safari` descriptor with the same page settings as the Chromium projects. |
| `web/scripts/playwrightOffline.test.ts` | Changed. Keep. A new block of 8 tests for the WebKit projects. |
| `docs/desktop/v04/webkit_windows_defects.md` | New. Keep until the Mac run replaces it; then fold into the parity notes. |
| `docs/desktop/v04/w5-mac-kit__webkit-windows.md` | This note. |

No backend module, route or screen folder is added, so 03 Appendix A gets no row. WebKit's browser build lives outside the repository (`E:/cache/AppData-Local/ms-playwright/webkit-2359`, 171 MB) and its baselines are ignored by git (`web/e2e/__screenshots__/offline-webkit-win32`, 15 MB).

## Config changes

* The Chrome channel fallback (`NQT_E2E_CHANNEL`, or "bundled Chromium missing, use installed Chrome") used to sit in the top-level `use`, where Playwright would hand it to WebKit and refuse it. It is now `CHROMIUM_CHANNEL`, given to `offline`, `offline-perf` and `offline-demo` only. Behaviour of those three is unchanged.
* The page settings (viewport 1920x1080, scale 1, dark, reduced motion, `en-GB`, `Europe/London`) moved into `PAGE_SETTINGS`, laid over each device descriptor, because the Safari descriptor brings a 1280x720 viewport and a scale of 2 that would win in a project's `use`.
* The `grepInvert` of the two real-backend checks is `OFFLINE_GREP_INVERT`, shared by `offline` and `offline-webkit`.
* WebKit baselines go to `offline-webkit-{platform}` through a per-project `snapshotPathTemplate`, so they never meet the Chromium ones.
* The projects are opt-in: `e2e:offline` names its projects and never reaches them.

## Tests and born-failing evidence

`web/scripts/playwrightOffline.test.ts`: 48 tests, all passing (40 before, 8 added).

Before the config changed, with the 8 tests in place: 6 failed, 42 passed. The six failures were "has an offline-webkit project that runs under the WebKit device descriptor, headless", "runs the same specs as the offline project ...", "also runs the in-page demo smoke under WebKit ...", "never hands the Chrome channel fallback to WebKit ..." (the channel was in the top-level `use`), "keeps its own baselines ..." and "gives both engines the same page settings ...".

The two other new tests passed at once and are regression guards, named so. "born failing: a config without the offline-webkit project is caught" feeds the project finder a config with the project renamed and a hand-made config, so it tests the finder; the real config is held by the six above. "is opt-in" has no package script naming the project today; it fails the day one other than `e2e:offline:webkit` does.

Also run: `tsc -p e2e/tsconfig.json` (the e2e type check that includes the offline config), clean.

## The full run

Two full runs of both projects under the PLAYWRIGHT slot are recorded in the defects file: 190 passed, 3 skipped, 0 failed on the second. No real backend started.

## Wiring for the merge step

* `web/package.json` (owned by the selftest-page slice): add the script `"e2e:offline:webkit": "playwright test -c playwright.offline.config.ts --project=offline-webkit --project=offline-webkit-demo"`. The test accepts exactly that name as the one script allowed to mention `offline-webkit`.
* `docs/TESTING.md` (not owned): a line that the WebKit projects exist, need `playwright install webkit`, are opt-in, and write their own baselines on the first run.
* `mac-webkit.yml` (jsc-golden slice) may use `--project=offline-webkit`; on macOS the same projects run Playwright's WebKit there.
