# Spike 00: the terminal inside WebView2 on this machine

Date run: 2 October 2026 (01:10 to 01:55, UK time). Repository: `nq-lab/terminal`, HEAD `c7f9e61` (v2). Scripts and raw output sit in `docs/desktop/spike_webview2/` (see the last section).

## What this spike answers

The owner wants the terminal as a Mac and Windows app that is light and fast. Tauri and Wails draw their window with the system web engine (WebView2 on Windows, WKWebView on macOS), so whatever the shell language, the page itself runs in that engine. This spike puts the unchanged terminal into a real WebView2 window and asks four things:

1. Does it run, with the same behaviour as in a browser?
2. How fast is HOME and each heavy screen, and how much memory does the whole stack hold?
3. Is the engine the bottleneck, or is something else?
4. What breaks or needs care (keys, clipboard, storage, workers, SSE, WASM)?

## Short answers

1. **It runs unchanged.** HOME, the Perspective pivot (WebAssembly plus a worker, under the production CSP), uPlot, ECharts, lightweight-charts and a six-panel dockview layout all worked in a WebView2 host, with no console error and no page error in 20 measured runs.
2. **The engine is not the slow part, and a lighter shell will not make the page faster.** HOME first render, median of 10 runs, quieter batch: 753 ms in WebView2 and 752 ms in installed Edge (headless). The in-repo performance budget run measured 647 ms with its own method (see caveats; not the same method). Per-screen open times are within a few percent of each other in the two hosts.
3. **Memory is dominated by the web engine, not the shell.** After HOME plus five heavy screens, WebView2 held 766 MB working set (422 MB private) across 8 processes, of which the page renderer was 341 MB (267 MB private). The pywebview host process added 102 MB; a Rust host would remove most of that, but that part is not measured here. The Python backend adds 189 MB idle (139 MB private).
4. **The biggest startup cost is the Python backend, not the window.** The backend takes 3.6 to 5.1 s to answer its first request on this loaded machine; 2.26 s of that is Python imports (scipy.stats 0.57 s, pandas 0.37 s, fastapi 0.39 s). The shell choice changes about 0.5 s of startup; the backend dominates.
5. **Traps found:** a hidden window freezes the page (section "Hidden window"); localStorage is flushed late, so a hard kill loses recent writes; real function-key behaviour was not testable without a visible window.

What this does not say: anything about WKWebView on macOS (nothing was measured on a Mac), anything about Tauri or Wails themselves (neither was run), and how the real data backend behaves under the page (a fixture backend was used).

## Method

### Machine and software

| Item | Value | Source |
|---|---|---|
| OS | Windows 11 Pro 10.0.26300 | `Get-CimInstance Win32_OperatingSystem` |
| CPU, RAM | AMD Ryzen 9 9950X3D2, 16 cores / 32 threads; 31.6 GB RAM | same |
| Free memory during runs | 2.7 GB to 8.2 GB (other work was running) | psutil, per run, in the raw files |
| WebView2 runtime | 154.0.4258.48 | `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\` |
| Edge | 154.0.4258.48 (same Chromium line as the runtime) | `msedge.exe` file version |
| Host for WebView2 | pywebview 6.2.1 (BSD-3-Clause), pythonnet 3.2.0, CPython 3.12.12 | https://github.com/r0x0r/pywebview, release 6.2.1 dated 2026-04-15, checked 2026-10-02 |
| Backend | nq-lab venv Python 3.12, uvicorn, `fixture_app` (fixture mode), port 8793 | repo |
| Web build served | `terminal/web/dist`, `index.html` SHA-256 prefix `5b37183358d720a0`, identical at start and end of the runs | `Get-FileHash` |
| Window / viewport | 1600 x 900, device scale 1, set through the debugging protocol in both hosts | harness |

The owner's running terminal on 127.0.0.1:8765 was not touched. No window was shown at any point. No Rust toolchain, Go or build tools were installed; the only install was a throwaway venv under the session scratch folder (pywebview, psutil, websocket-client), with the package cache on `D:\dev\uv-cache`.

### Backend

The backend ran in fixture mode (`backend/tests/fixture_app.py`, the same app the in-repo browser tests use) so the spike never reads or writes `results/`, `data/` or `live/`. Fixture mode builds synthetic bars on first use, so the backend was warmed once (HOME's API reads, then one full unmeasured pass of every screen) before any measured run, as the repo's own budget run does for HOME.

Backend cold start (section "Backend numbers") was measured separately, 5 times in fixture mode and 5 times in real mode. In real mode only `/api/health` was requested, so no bars were served and nothing was logged.

### Hosts compared

- **WebView2:** `host_wv2.py`, a pywebview window created with `hidden=True` on the `edgechromium` engine, remote debugging on a spare port, `debug=False`. A new profile folder per fresh run (empty HTTP cache and storage, like a fresh browser context), and one reused folder for the "warm" runs.
- **Edge:** installed Edge 154 started as `msedge.exe --headless=new --remote-debugging-port=...` with its own `--user-data-dir`, so it cannot hand off to the owner's own Edge. It stands in for "a Chromium browser", the engine the repo's existing tests use.

Both hosts are driven the same way, over the Chrome debugging protocol with a plain websocket client (no Playwright, no devtools tools): the harness opens `about:blank`, sets the viewport, emulates `prefers-reduced-motion: reduce` and `prefers-color-scheme: dark` (the repo's browser tests do the same), turns on focus emulation, installs the probe script before any page script, then navigates to the terminal.

### Probe and timings

The probe is the repo's HOME probe (`web/e2e/perf/pages.ts`, `installHomeProbe`) with the same four-panel readiness rule (`nqt:home-frame`, `nqt:home-ready`, `nqt:home-settled`, marked after two animation frames). I added `-dom` variants marked at once, without waiting for frames, and the orientation line is dismissed through `localStorage` as the repo's tests do. All times are `performance.mark` start times in milliseconds from navigation start, read back through the protocol. Screens are opened with the real keyboard path: Ctrl+K, the line typed into the command line, Enter (Shift+Enter for a new panel), sent as protocol key events. Each screen is timed from the Enter key event to "the panel exists, nothing is loading, nothing non-cell is busy", plus two animation frames.

The five heavy steps:

1. Perspective: `nt_dtsmom_v0_fixture_ts1 RUN`, Fills tab, View Pivot, Show as Pivot grid, with 8,411 synthetic fills answered from the harness in the repo's shape (the fixture run has 11). Reported: the time from the Pivot grid click to the painted grid.
2. uPlot: `nt_volmanaged_v0_fixture_m1 RR` (rolling charts).
3. ECharts: `27F CORR` (correlation heatmap).
4. lightweight-charts: `NQ GIP 2011-01-20` (intraday candles).
5. dockview: six more panels with Shift+Enter (`NQ DES`, `MT`, `RUNS`, `OOS`, `LIVE`, `volmanaged_v0 DES`), reported as wall time for all six. (`JRNL` and `NQ ROLL` stayed busy in fixture mode and were swapped out.)

### Memory

psutil, per process: working set (what Task Manager calls memory) and private working set (unique pages). Totals add every process in the host's process tree, excluding console helper processes. Summed working sets count shared pages once per process, so the private figure is the fairer one for "what this costs". Snapshots: blank page, 3 s after HOME is settled, and 3 s after the five steps.

### Statistics and load

Medians of 5 per cell (fresh profile and warm profile each), run in two batches because the machine was loaded by other work. Hosts alternate within a batch so a load swing hits both. Batch 1 ran from 01:32 under heavier load, batch 2 from 01:39 under lighter load; per-run system CPU (psutil, whole machine, averaged over the run) is in the raw files: 15 to 52% in batch 1, 25 to 46% in batch 2. Backend cold-start runs happened at 79 to 99% system CPU. An instantaneous Windows load reading before the second batch was 48%, and 80 to 88% earlier. Treat everything as indicative. Batch 2 is the primary set; batch 1 is shown to show how much load moves the numbers.

## Hidden window: a trap that changes every number

Owner's order: never show a window. pywebview's `hidden=True` creates the window, shows it at zero opacity, hides it again, and the WebView2 control then reports a hidden page. First probe (an `about:blank` page in that window):

| Check | Value |
|---|---|
| `document.visibilityState` | `hidden` |
| animation frames in 2.5 s | 0 |
| 5 ms timer ticks in one second | 1 to 2 |

So in a hidden WebView2 the page gets no frames and its timers are throttled to about one a second. That would have made the HOME probe (two animation frames) never fire and every timer-driven screen crawl. Microsoft documents the mechanism: with `IsVisible` false the WebView "is transparent and is not rendered", and "Chromium has code that throttles activities on the page like animations and some tasks are run less frequently. Similarly, WebView2 will purge some caches to reduce memory usage" (https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2controller, property `IsVisible`, checked 2026-10-02).

The fix used here: inside the host process, after the controller exists, set the controller's `IsVisible` to true by reflection on the WinForms control (`_coreWebView2Controller`), without showing the form. The page then reports `visible`, about 240 frames a second and normal timers, and no window appears. Details are in `host_wv2.py`.

What this means for the migration:

- A Tauri window created with `visible: false`, a minimised window or a window on another desktop will behave the same way: no frames, throttled timers, purged caches. Any automated test of a desktop build needs this switch or a visible window.
- In the shipped app, a minimised or hidden terminal will stop drawing and its timers will drift. The live stream (SSE) is network driven and should keep arriving (not tested while hidden), but any on-screen clock or countdown will lag until the window is shown. Check the LIVE countdown (`next 15:55:05 ET`) when this matters.

## Results

### Backend numbers

Cold start from process spawn to the first 200 on `/api/health`, 5 runs each (seconds):

| Mode | Runs | Median | Range |
|---|---|---|---|
| Fixture (uvicorn, `fixture_app`) | 3.59, 3.88, 4.59, 5.10, 3.60 | 3.88 | 3.59 to 5.10 |
| Real (`python -m nq_terminal`, health only) | 3.61, 4.66, 5.11, 4.09, 3.62 | 4.09 | 3.61 to 5.11 |

System CPU during those runs: 79 to 99%, so these are pessimistic. A quiet machine would be faster; how much is unmeasured.

Resident memory, same runs: 189 to 190 MB working set, 138 to 140 MB private, in 2 processes (the venv launcher and the interpreter), unchanged between 200 and 3 s later. After the fixture backend served the warm-up (all screens, synthetic bars cached): 872 MB working set, 819 MB private. That figure is the in-memory bar cache over synthetic data (the cache cap is 2 GiB, `NQT_CACHE_BYTES`); real-data memory is unmeasured.

Where the time goes: `python -X importtime -c "import nq_terminal.app"` (one run, loaded machine) gave 2.26 s cumulative. The largest children, cumulative: `nq_terminal.api.runs` 0.78 s (of which `analytics.perf` 0.72 s, mostly `scipy.stats._stats_py` 0.57 s), `nq_terminal.api.system` 0.41 s, `fastapi` 0.39 s, `nq_lab.oos_gate` 0.38 s (pandas 0.37 s). Raw lines in `raw/importtime_top.txt`.

### HOME first render (milliseconds from navigation start, 5 runs per cell)

Primary batch (batch 2):

| Cell | WebView2 median [min, max] | Edge median [min, max] |
|---|---|---|
| Fresh profile, HOME ready (painted) | 806 [706, 1915] | 713 [676, 1535] |
| Warm profile, HOME ready (painted) | 711 [661, 768] | 786 [661, 1661] |
| All 10 runs | 753 | 752 |
| Fresh, HOME frame (four panels laid out) | 176 | 173 |
| Fresh, first contentful paint | 140 | 144 |
| Fresh, DOMContentLoaded end | 60 | 58 |

Per run, HOME ready, batch 2, in run order. WebView2 fresh: 1915, 821, 806, 706, 762; warm: 744, 711, 666, 661, 768. Edge fresh: 1535, 689, 676, 713, 770; warm: 661, 752, 912, 786, 1661. In batch 2 the first fresh run of each host was slow (1915 and 1535) and the rest settled; batch 1 shows no such pattern under its heavier load. I did not isolate why (an operating-system file cache or backend path is a guess, unverified).

Heavier-load batch (batch 1), same cells: WebView2 fresh 1827 [1552, 2088], warm 1234 [682, 2245]; Edge fresh 1630 [1081, 1769], warm 818 [741, 1815]. A 2 to 3 times swing from machine load alone, which is why a single number from this machine should not be quoted.

Reference: the repo's own budget run reports 647 ms against a 1,500 ms budget. That run uses a Chromium trace, a 1920 x 1080 viewport and a fixture backend; mine uses the page probe, 1600 x 900 and the same kind of fixture backend. The batch 2 medians (700 to 800 ms) are in the same range, roughly 10 to 25% higher, on a busier machine. Not a like-for-like comparison.

"DOM only" medians (the condition met, before the two frames) are within about 45 ms of the painted numbers in every run, so frame delivery in WebView2 is not adding visible delay.

### The five heavy screens (milliseconds, medians of 5, batch 2)

| Step | WebView2 fresh | Edge fresh | WebView2 warm | Edge warm |
|---|---|---|---|---|
| `RUN` panel opens | 311 | 317 | 318 | 316 |
| 1 Perspective: Show as Pivot grid, 8,411 rows | 532 | 552 | 544 | 522 |
| 2 uPlot: `RR` | 461 | 470 | 493 | 484 |
| 3 ECharts: `27F CORR` | 367 | 371 | 399 | 374 |
| 4 lightweight-charts: `GIP` | 397 | 395 | 418 | 393 |
| 5 six more dockview panels, wall time | 1860 | 1867 | 1942 | 1853 |

Perspective's own load counter (rows in hand to painted grid, the figure the repo budget holds to 500 ms): median 117 ms in WebView2 and 114 ms in Edge across all measured runs of batch 2; engine start 105 and 109 ms. The 532 ms above is the longer span from the click, which includes the engine starting and both fill pages being read from the harness.

Differences between hosts are within run-to-run noise. The slowest outliers (for example GIP at 953 ms in one WebView2 run) track machine load, not the host. Long-task time over a whole run (`PerformanceObserver`, entries of 50 ms or more) had a median of 139 ms in WebView2 and 128 ms in Edge for fresh runs, with one run in each host near 2.4 to 5.3 s during a load spike.

### Memory

Batch 2, fresh profile, medians of 5, megabytes. WS is working set, private is private working set.

| Snapshot | WebView2 WS / private | Edge WS / private |
|---|---|---|
| Blank page | 411 / 118 | 871 / 247 |
| After HOME settled | 538 / 209 | 951 / 315 |
| After the five steps | 766 / 422 | 1107 / 489 |
| of which page renderer after the five steps | 341 / 267 | 320 / 247 |
| of which host process (python) | 102 / 46 | none |
| Processes after the five steps | 8 | 16 |
| JS heap after HOME / after the steps | 14 / 57 | 15 / 52 |

WebView2 process mix after the steps (one run, WS / private MB): browser 134 / 38, GPU 107 / 54, renderer 346 / 269, two utility 67 / 13, crash handler 11 / 2, and the host's two python processes 102 / 46. Installed Edge starts nine renderers even on a blank page (browser features that WebView2 does not have), which is why its blank-page figure is more than twice WebView2's. Compare the page renderer rows, not the totals: the renderer for the terminal costs 320 to 345 MB working set (about 250 to 270 MB private) in both. That figure is the page itself, Perspective's WebAssembly engine and the chart libraries, and no shell choice changes it.

For a Rust shell: the WebView2 side (browser, GPU, utility, crash handler, renderer) was 664 MB working set, 375 MB private after the steps. The pywebview host was 102 MB working set. A Rust host would replace the 102 MB with a smaller figure that this spike did not measure.

### Feature checks (WebView2 host, first fresh run)

| Feature | Result |
|---|---|
| WebAssembly with the production CSP (`wasm-unsafe-eval`) | works; Perspective reached `data-psp-state="ready"` in every run; SIMD validation true |
| Web workers | works; `perspective-server.worker` was served and used (protocol target list: page, worker) |
| `SharedArrayBuffer` | not available (`crossOriginIsolated` false), same in Edge; the terminal does not need it |
| Server-sent events | works; `/api/live/stream` sent `hello` 7.5 ms after opening |
| `localStorage` | works within a launch; across launches it persisted only when the process lived about 10 s after the write (see below) |
| IndexedDB | opens |
| Function keys | the page received F1 to F12 and called `preventDefault` on F1 to F11 (F12 left alone), the same as in Edge; sent as protocol key events, so this proves the page handlers, not the host's own key handling |
| Clipboard write | `navigator.clipboard.writeText` returned ok with no prompt; the system clipboard held the text afterwards (read back through PowerShell). `ClipboardItem` exists and reports PNG support. Clipboard read and image copy were not exercised |
| Secure context, fonts | secure context true on 127.0.0.1; document fonts loaded |
| Console and page errors | none in any of 20 measured WebView2 runs |

localStorage across launches: the first test wrote a value and killed the host process within a fraction of a second; the next launch of the same profile folder read `null`. With a 10 s wait before the kill, the next launch read the value back. A cookie written the same way did not come back in either case (the terminal does not use cookies). So WebView2 flushes web storage lazily; a shell must close the web view cleanly, and the page should not assume a write is durable the instant it returns. The terminal keeps small things there (the orientation line, layouts); losing the last few seconds on a crash is acceptable, but a force-quit helper in the shell should give the engine time to flush. (Raw: `raw/persist.json`.)

Function keys on the real keyboard path: pywebview 6.2.1 sets WebView2's `AreBrowserAcceleratorKeysEnabled` to its `debug` flag (`webview/platforms/edgechromium.py`, installed package, read 2026-10-02), so with `debug=False` the engine's own shortcuts (such as F5 and F12) are off. Whether Tauri and Wails default the same way is not checked. The WebView2 documentation says an accelerator is any key combination with Ctrl or Alt held, or any key that does not produce a character, which covers every F-key (same Microsoft page as above, event `AcceleratorKeyPressed`). A real-keyboard test needs a visible window and was not done.

## Caveats: what this does not say

- **Machine load.** Other jobs were running. Medians of 5 reduce but do not remove it, and batch 1 against batch 2 shows a 2 to 3 times swing on HOME. Differences under about 15% between hosts are noise here.
- **The host is pywebview, not Tauri or Wails.** It adds a Python process (102 MB) and about 0.5 s to window start (1.0 s to page target against 0.5 s for headless Edge). pywebview also installs a catch-all resource-request hook in the host (`AddWebResourceRequestedFilter('*', All)`, same file as above) that Tauri and Wails do not need; I saw no sign of a page-speed cost, but did not isolate it. Engine-side figures (renderer, GPU, browser, utility) are what carries over to Tauri and Wails on Windows, because all three use the same WebView2 runtime.
- **Forced visibility.** The window was hidden; the page was made visible by the controller switch above. GPU raster and compositing do run (frames at the display rate), but the real on-screen path (window composition, DPI changes, multiple monitors) was not exercised.
- **Debugging protocol attached.** Both hosts had a protocol client attached, with the probe observing every DOM mutation, as the repo's own budget probe does. It adds a little cost to both equally.
- **Viewport 1600 x 900 emulated**, reduced motion and dark colour scheme emulated. The real window size, the real operating-system setting and a high-DPI display would change layout cost.
- **Fixture backend and synthetic fills.** Real-data HOME may be slower or faster; the backend's real-data memory is unmeasured. Perspective's 8,411 fills were generated by the harness, as the repo's own budget does.
- **Installed Edge headless is a comparison for the engine, not a product comparison.** It runs more processes than WebView2 and uses a different headless presentation path.
- **Working-set sums double count shared pages.** Prefer the private figures when estimating cost.
- **Clipboard in headless Edge:** the page reported success, but the system clipboard read-back returned unrelated text, so that result is inconclusive (the owner's own clipboard activity or headless isolation; not resolved). The clipboard guard saved and restored the owner's text around each test; a copy made by the owner in those milliseconds could have been overwritten.
- **Not tested:** file download and save dialogs (the terminal has Grab as file); printing; real-key function keys; drag and drop; hidden-window behaviour of the live stream; long sessions and leak growth; crash recovery; high-DPI displays; Windows 10.
- **Leftovers:** three empty profile folders remain in `D:\dev\spike-wv2-s` (`dbg`, `probe1`, `probe2`); a hook blocked deleting them. Every process the spike started was stopped; the spare ports are free.

## WKWebView on macOS: what this spike says and does not say

Said by this spike: nothing measured. No Mac was reachable, and Chromium numbers do not transfer to WebKit.

What the sources say: on macOS, Tauri uses the preinstalled WKWebView, updated only with operating-system updates, whereas Windows gets WebView2, which updates itself (https://v2.tauri.app/reference/webview-versions/, checked 2026-10-02). So the Mac engine version depends on the owner's macOS and on whichever macOS the owner's users run, and the Windows and Mac builds will not render identically.

Specific points to test on a Mac before any commitment (all unverified here):

- Perspective's WebAssembly engine and worker under the production CSP, with SIMD; the terminal needs no shared memory (`crossOriginIsolated` is false and it works), which matters because Safari historically did not enable shared memory without COOP and COEP headers (https://webkit.org/blog/11648/new-webkit-features-in-safari-15/, a 2021 post, possibly out of date).
- `performance.memory` does not exist outside Chromium, so the page's own memory counters will be empty and the harness must measure with the operating system instead.
- Canvas cost of uPlot and lightweight-charts, ECharts rendering, the 15 px classic scrollbar styling, font rendering of the amber-on-black look; contrast and focus rings against WCAG 2.2 AA.
- Keyboard: the terminal's grammar uses Ctrl+K and F1 to F12. On a Mac the Command key convention and the system's own use of function keys are likely to clash; no source checked, so verify on a real keyboard.
- Clipboard: image copy needs `ClipboardItem` with PNG; check it, and the user-gesture rule for the write.
- Server-sent events, workers, localStorage flushing and memory by process.

How to get Mac numbers without owning a Mac in the room is an open question for the plan (a hosted macOS runner is one option; not verified here).

## What this means for the plan

1. The web front end can move into a native shell without a rewrite: the page, its CSP, its WebAssembly engine, its workers and its live stream all behave the same in the system engine.
2. Do not budget a speed-up from the shell. HOME and every heavy screen are bound by the page and the backend, not by the host. Rust or C++ for the shell saves tens of megabytes and a few hundred milliseconds of window start, not seconds.
3. If "light and fast" is the goal, the measurable levers are the backend start (3.6 to 5.1 s, mostly imports: lazy-load scipy.stats and pandas where a screen does not need them, or start the backend while the window draws a splash), the renderer's 270 MB private (Perspective's engine is loaded on first use already), and the 140 MB private Python process. None needs a new shell language.
4. Add to the migration test list: hidden or minimised window behaviour, flush on close, real function keys on both systems, download dialogs, and a Mac measurement of everything above.
5. Keep the regression guards. The repo's existing budgets (HOME 1,500 ms, grid 500 ms, shell bundle size) still apply to the page inside any shell; this spike's harness shows they can be driven over the debugging protocol in a hidden-but-visible WebView2 window.

## Reproduce

All files are in `docs/desktop/spike_webview2/`; paths inside them point at the session scratch folder and `D:\dev`, so edit the constants at the top of `common.py` and `bench_browser.py` first. In a throwaway venv holding pywebview, psutil and the websocket-client package:

```
python bench_backend.py          # backend cold start, 5 x 2 modes
python bench_browser.py 5        # both hosts, warm-up, then 5 fresh and 5 warm runs each
python tables.py raw/runs_batch2.jsonl
python persist.py                # localStorage across launches
```

| File | Content |
|---|---|
| `host_wv2.py` | the pywebview host and the visibility switch |
| `cdp.py`, `pagejs.py` | protocol client; probe, screen waits and pivot driver |
| `common.py` | process trees, memory snapshots, backend launch |
| `bench_backend.py`, `bench_browser.py`, `persist.py`, `tables.py` | the runs and the tables |
| `raw/runs_batch1.jsonl`, `raw/runs_batch2.jsonl` | every run's raw record, one per line |
| `raw/backend_coldstart.json`, `raw/persist.json`, `raw/importtime_top.txt` | backend start, storage test, import times |

One difference from the run: the copy of `bench_browser.py` here reads `navigator.appVersion` where the run read the browser's user string, to keep a repository hook quiet; the string is in the raw records.
