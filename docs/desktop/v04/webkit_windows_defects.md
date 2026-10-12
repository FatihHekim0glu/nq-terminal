# WebKit on Windows: early defect list for the macOS shell (D8.1)

**Fidelity warning, read first.** This list comes from Playwright's WebKit build running on Windows. It is not WKWebView on macOS, and nothing here has been checked against it. Playwright's own advice is that for the closest-to-Safari experience you should run WebKit on a Mac, and WebKit Bugzilla 261368 is why the Windows build is the only WebKit that can be driven from this PC. A pass here is a lead that the web layer is not hostile to WebKit's engine; it is never proof for macOS. A failure here may be a Windows port difference and not a Safari one. The authoritative run is the hosted macOS job (`mac-webkit.yml`) and the owner's Mac.

## What ran

| Item | Value |
|---|---|
| Playwright | 1.63.0 (`web/package.json`, pinned) |
| Browser | WebKit 26.6, Playwright build v2359, `webkit-win64.zip` (62,672,093 bytes, sha256 `b9a4d90a004b0119ff590e26fddc84e2df0bb512304823974003a79b7d0bd2db`) |
| Install | Playwright's own installer, `PLAYWRIGHT_BROWSERS_PATH=E:/cache/AppData-Local/ms-playwright` (folder `webkit-2359`, 171 MB, on E:, nothing on C:). See "Install note" below. |
| Mode | Headless, no window. Device descriptor `Desktop Safari` with the page settings of the Chromium offline run laid over it: 1920x1080, scale 1, dark, reduced motion, `en-GB`, `Europe/London`. |
| Projects | `offline-webkit` (the 14 offline spec files) and `offline-webkit-demo` (`e2e/offline/demo.offline.ts`), both in `web/playwright.offline.config.ts`, opt-in. |
| Command | `playwright test -c playwright.offline.config.ts --project=offline-webkit --project=offline-webkit-demo --workers=2` from `web/`, under the PLAYWRIGHT slot, ports 4393 and 4394 |
| Backend | None. The offline suite answers from the Node-side demo API and the in-page demo build. No real backend was started, so there is no line in `windows.jsonl`. |

193 tests are listed for the two projects, the same number as the Chromium offline and offline-demo projects list.

## Runs

| Run | Window (UTC, slot held) | Result |
|---|---|---|
| 1, no baselines yet | 00:05:45 to 00:21:21 on 12 October 2026 | 101 passed, 3 skipped, 89 failed (15.6 minutes) |
| 2, against the baselines run 1 wrote | 00:58:52 to 01:09:35 | **190 passed, 3 skipped, 0 failed** (10.7 minutes) |

Raw reports: `D:/dev/v04/w5-mac-kit/webkit-run1/` and `webkit-run2/` (`report.json`, `run.log`).

Run 1's 89 failures, triaged:

* 87 are "A snapshot doesn't exist ... writing actual". WebKit has its own baseline folder (`e2e/__screenshots__/offline-webkit-win32`, ignored by git), and the first run on a machine writes it and fails each screenshot test by design. Not defects. Run 2 compared against those files and every one matched.
* 2 are frame-time budgets (D-1 and D-2 below).

Run 2 therefore shows the WebKit render is repeatable on this machine. It says nothing about how it compares with Chromium or with WKWebView, because each engine is only ever compared with its own earlier output.

## Defect list

| ID | Test | What was seen | Triage |
|---|---|---|---|
| D-1 | `gallery-candles.spec.ts` "4,000 bars render and zoom within budget" | Run 1: mean zoom frame 46.57 ms against the 34 ms budget (render 114.0 ms). Run 2: 30.93 ms, passed. | **Load, not a defect.** Run 1 shared the PC with a backend suite and other waves; run 2 did not repeat it. Unverified: whether a quiet run is steadily under 34 ms; two samples do not say. Re-measure on the Mac before any budget is read from this. |
| D-2 | `gallery-grids-tiles.spec.ts` "10,000 rows scroll smoothly ..." | Run 1: p95 frame 34 ms (`< 34` needed), p50 31, 29 of 498 frames over 33 ms. Run 2: p95 31, p50 16, 1 frame over 33. | **Load, not a defect**, same reason. Virtualisation held in both runs (at most 75 rows mounted). |
| D-3 | none | No functional, layout, keyboard, axe or console-error failure appeared in 190 tests under WebKit 26.6 on Windows. | **No defect found.** This is the early result the item asked for, with the fidelity limit above. |

No defect is open against the web layer from this run.

## What the run did not cover

* The three skips are the Chromium offline run's own skips, with the demo reasons the specs print: the 1m GIP read (`keyboard.spec.ts`), the missing-cookie refusals and the workspace PUT refusals (`safety.spec.ts`, no session and no store in the demo API). Two further checks are filtered by `grepInvert` in both engines.
* `offline-perf` (`e2e/perf/budgets.spec.ts`) was not run under WebKit: its budgets are Chromium numbers and need one worker on a quiet machine. D-1 and D-2 are the only timing evidence.
* The Windows-only specs (`pnpm e2e`, fixture backend) and the desktop walk are Chromium and WebView2 only.
* Everything that makes WKWebView different from Playwright's WebKit: the Tauri custom-scheme origin and its ipc, the system WebKit version of the user's macOS, WKWebView's own storage and cookie rules, window and menu behaviour, and fonts (the Windows build has its own font lookup). None of these is exercised.

## Install note

Playwright 1.63.0's installer, run from Node 24.13.1 on this PC, timed out on all three download hosts (30 seconds, and again with `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=300000`), while `curl` fetched the same file from `playwright.download.prss.microsoft.com` in seconds. The zip was fetched with curl into a scratch folder on D: and served from a throwaway loopback server on port 48931 (stopped afterwards), and the installer was pointed at it with `PLAYWRIGHT_DOWNLOAD_HOST`. Playwright's own installer then unpacked it and wrote its markers (`INSTALLATION_COMPLETE`, `DEPENDENCIES_VALIDATED`); nothing was unpacked by hand. The cause of the Node timeout was not found (an IPv4-first lookup order did not change it). On a machine where the installer reaches the CDN, `playwright install webkit` is enough.

## Reproduce

```
cd web
set PLAYWRIGHT_BROWSERS_PATH=E:/cache/AppData-Local/ms-playwright
playwright install webkit
playwright test -c playwright.offline.config.ts --project=offline-webkit --project=offline-webkit-demo --workers=2
```

The first run on a machine writes the WebKit baselines and fails the screenshot tests that wrote them; run it a second time for the real result.
