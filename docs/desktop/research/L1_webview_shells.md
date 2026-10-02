# L1: Webview shells for the desktop terminal

Research lens L1 of the desktop migration plan. It compares the shells that wrap a web front end in a native window (Tauri 2, Wails v3, Electron, Electrobun, Neutralinojs, CEF, plus the small webview libraries), then checks, item by item, whether this terminal's React front end will behave the same inside WKWebView on macOS and WebView2 on Windows.

- Evidence checked: 2 October 2026. Every external claim carries a source tag (S1, S2, ...) listed at the end. Anything not confirmed from a primary source is marked **unverified**.
- Local facts (tagged L1 to L9) were read from the terminal's own source at HEAD, read only. No application was launched and nothing was measured for this lens; measurement belongs to the spike step, and section 9 lists what it should measure.
- Scope: the shell and the web engine. Packaging and signing (with updates) are covered in depth by lens L4; the Python backend's lifecycle is touched on only where it changes the shell choice.

## 1. Bottom line

1. **On Windows the risk is close to zero; on macOS it is real.** WebView2 is Chromium (the runtime on this PC is 154, and it updates itself, S41). The whole test suite today runs on Chromium only (L8). WKWebView is the system WebKit, frozen to the macOS version (S41), and this front end has never been run on WebKit by any automated test.
2. **The decisive design choice is not the shell, it is the page origin.** If the window simply loads `http://127.0.0.1:<fixed port>/` from the existing FastAPI server, the page keeps its same-origin `/api` contract, its CSP, its EventSource stream and its Perspective worker exactly as today. If the page is instead served from a custom scheme (`tauri://localhost`, `http://tauri.localhost`, `wails://`), three things break or need rewriting: server-sent events cannot stream through Tauri's custom protocol (the response is one complete buffer, S10), cross-origin isolation is unreliable on macOS (S11), and the `/api` calls become cross-origin. Recommended: load from the loopback server, with `NSAllowsLocalNetworking` set on macOS because ATS blocks raw IP addresses by default since macOS 14 (S39).
3. **Tauri 2 is the best fit of the shells looked at.** Stable 2.12.1 (30 September 2026, S1), dual MIT or Apache-2.0, about 2.8 MB for a hello-world binary on Windows and macOS (S9), mature plugins for updater, dialog, clipboard, single instance, window state and global shortcuts (S16), a capability system that can grant a localhost page narrow IPC rights (S6), and a sidecar mechanism for the Python process. It is Rust, which matches the owner's wish.
4. **"Light" is mostly marketing once the page is heavy.** The shell binary shrinks from roughly 130 to 160 MB compressed (Electron 44 runtime, S20) to about 3 MB (Tauri, S9), but memory is dominated by the web engine and the page. An independent CI benchmark measured a release Tauri empty app on Windows at 317 MB of process memory against 278 MB for Electron (S30), and on macOS at 95 MB against 369 MB. Expect a real saving on the Mac, little or none on Windows, and no change at all to the Python backend's footprint, which is the biggest part of the terminal.
5. **Electron is the safe fallback, not the goal.** It gives the same Chromium on both systems, so zero rendering or API drift from today's tests, at the cost of about 130 MB more per install and a 8-week major cadence with only three supported majors (S21). Keep it as the documented plan B if the WebKit spike fails.
6. **Wails v3, Electrobun or Neutralinojs: not ready for this job.** Wails v3 is still a beta with automated nightly releases (beta.27 on 1 October 2026, S17) and its Windows asset server cannot stream a response (S19). Electrobun ships quickly but its maintainer states that issues and pull requests may not be reviewed (S24). Neutralinojs is tiny but its benchmark numbers on Windows are poor and its native layer is thin (S26, S30).
7. **The Mac keyboard needs its own keymap.** The terminal's sector keys F8 to F11 are media keys on a Mac by default, and F11 (with Fn) is the system "Show desktop" shortcut (S35, S36). No shell can fix that; the Mac build needs alternative bindings or an owner setting change.
8. **Two front-end seams need a desktop adapter, nothing else should change.** File export (`<a download>` with a blob, L6) silently does nothing in WKWebView without a native handler (S13, S42); route it to a native save dialog. Image copy to the clipboard needs a native fallback on macOS until proven in the spike. Everything else in the front end uses features that WebKit on macOS 26 supports (section 5.10).

## 2. What this front end asks of a webview

Read from the terminal source at HEAD c7f9e61, 2 October 2026.

| Tag | Fact | Where |
|---|---|---|
| L1 | Perspective 5.5.1 is loaded on demand: viewer WebAssembly (1.55 MB), server WebAssembly (2.46 MB; a 2.51 MB memory64 variant also ships), engine worker bundled by Vite as a same-origin `?worker` file. The code picks the wasm32 server explicitly. | `web/src/perspective/engine.ts`, `node_modules/@perspective-dev/*/dist/wasm` |
| L2 | No `SharedArrayBuffer`, `crossOriginIsolated` or `Atomics.wait` anywhere in the Perspective client, server, viewer or datagrid builds, and none in the terminal's own source. | text search of those folders |
| L3 | Production CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; ... frame-ancestors 'none'`, served by the backend. | `backend/nq_terminal/security.py` |
| L4 | Every request is a same-origin relative GET under `/api` (plus POST and DELETE on `/api/jobs`), redirects refused; a test scans the sources to keep it so. The live stream is one EventSource on `/api/live/stream` with a polling fallback when the stream is refused or missing. | `web/src/api/client.ts`, `web/src/api/liveStream.ts` |
| L5 | Persistent state lives in `localStorage` (workspaces, layouts, link groups, command history, event tape, record watch, frame scheme) behind a safe wrapper that tolerates an empty or throwing store; workspaces listen for `storage` events to sync across tabs. | `web/src/state/*.ts`, `web/src/chrome/*.ts` |
| L6 | Export writes a file through a blob object URL and a synthetic `<a download>` click; image copy uses `navigator.clipboard.write` with a `ClipboardItem`, started inside the click because Safari refuses it after an await. | `web/src/chrome/download.ts`, `web/src/chrome/panelExport.ts`, `web/src/export/grab/run.ts` |
| L7 | Keys: F1 help; F2 to F7 held back from the browser; F8 to F11 jump to sectors (EQUITY, COMDTY, INDEX, CURNCY); PageUp, PageDown, End; Alt+1 to Alt+9 focus a panel; Alt+K opens the keymap. Alt keys read `e.code` first, so the Mac Option key's special characters do not matter. | `web/src/chrome/CommandLine.keys.ts` |
| L8 | Every end-to-end project (Chromium, perf, offline) runs on Chromium. There is no WebKit project. | `web/playwright.config.ts`, `web/playwright.offline.config.ts` |
| L9 | Modern CSS in use (count of source files): `popover` 38, `font-variant-numeric` 30, `inert` 25, `@container` 19, `oklch` 18, `:has(` 13, `scrollbar-color` 7, `dvh` 5, `color-mix` 5, `text-wrap` 1, `-webkit-font-smoothing` 1. `requestIdleCallback` is feature-detected. Dockview popout windows are refused when a layout asks for them, so `window.open` is never used. | text search of `web/src` |

## 3. The shells side by side

Release facts from the GitHub API on 2 October 2026 unless another source is given.

| | Tauri 2 | Wails v3 | Electron | Electrobun | Neutralinojs | CEF (direct) |
|---|---|---|---|---|---|---|
| Latest stable | 2.12.1, 30 Sep 2026 (S1) | v2.14.0, 10 Aug 2026; v3 only as beta.27, 1 Oct 2026 (S17) | 44.5.1, 43.7.7, 42.11.10, all 30 Sep 2026 (S20) | 2.0.2, 29 Sep 2026 (S24) | 6.9.0, 24 Jul 2026 (S26) | 154.0.32, 29 Sep 2026 (S28) |
| Host language | Rust | Go | Node.js (JavaScript) | TypeScript on its own JSC runtime or Bun; Zig, Objective-C, C++ native layer (S24) | C++ core, JavaScript client; other languages via extension processes (S27) | C or C++ |
| Engine on Windows / macOS | WebView2 / WKWebView | WebView2 / WKWebView | bundled Chromium 152.0.7977.130 on both (S20) | system webview by default, optional bundled CEF (S24) | system webview (S27) | bundled Chromium 154.0.8037.58 (S28) |
| Licence | MIT or Apache-2.0 (licence files in repo) | MIT | MIT | MIT | MIT (S26) | BSD-style (LICENSE.txt; GitHub reports it as unrecognised) |
| Shell size | hello world 2.84 MB Windows, 2.88 MB macOS (S9) | about 11 MB Windows, 8 MB macOS empty app (S30) | runtime zip 158.0 MB Windows x64, 130.3 MB macOS arm64 (S20) | "small self-extracting bundles", no number published (S24, S25) | release zip of all platforms 8.05 MB (S26); about 2 MB per app (S30) | minimal distribution 172.8 MB Windows, 132.2 MB macOS arm64, compressed (S28) |
| IPC | JSON commands and events; `ipc::Response` for raw bytes; Channels for ordered streams (S4, S5) | HTTP long poll and send over its own asset server; frames chunked because WebView2 caps request bodies near 2 MB (S18) | `invoke`/`handle`, `send`/`on`, structured clone, MessagePorts (S23) | typed RPC between main and webview processes (S24) | WebSocket to the local core (S27) | your own (message router or custom scheme) |
| Permission model | capabilities per window; remote URLs can be granted named commands (S6) | none comparable found in this pass (**unverified**) | `contextBridge` and context isolation (S23) | process isolation (S24) | token for extensions; details not checked (S27) | none built in |
| Multi-window, tray | yes; tray plus menus built in; plugins for window state and single instance (S16) | yes, system tray package in v3 source (S17) | yes | yes (S24) | yes (not checked in detail) | build it yourself |
| Updater | official plugin, signatures mandatory, static JSON on GitHub works (S7) | `pkg/updater` exists in v3 source; not assessed | `autoUpdater` on Squirrel.Mac (signing required) and Squirrel.Windows or MSIX (S22) | built in, binary patches, "kilobyte-scale updates" (S24) | not assessed | none |
| Cadence, 2026 | ten 2.x releases Feb to Sep; Tauri 3 alpha since 13 Sep (S1) | v3 beta nightlies, 27 betas since 2 Aug (S17) | majors every 8 weeks, three supported (S21) | nine stable releases in its last hundred tags; 2.0.2 after 2.0.1 on 22 Aug (S24) | roughly every two months (S26) | follows Chromium |
| GitHub stars / open issues and PRs | 111.5k / 1,472 | 36.4k / 362 | 123.4k / 714 | 12.9k / 127 | 8.7k / 189 | 4.8k / 206 |

Smaller webview libraries, for completeness: `webview/webview` is a single-header C and C++ library over WebKit and WebView2, MIT, last tag 0.12.0 from September 2024 and last commit 9 March 2026 (GitHub API); `saucer` is a modern C++ webview library, MIT, v8.0.0 on 28 December 2025; `wry` is Tauri's own engine layer, 0.57.0 on 8 September 2026. None of them brings an updater, dialogs or a permission model, so choosing one means rebuilding what Tauri already has. They are only worth it if the shell must be C++.

### 3.1 Tauri 2 in more detail

- **How the page is served.** By default from a custom scheme: `tauri://localhost` on macOS and `http://tauri.localhost` on Windows. The `useHttpsScheme` option switches Windows to `https://`, and the schema warns that "changing this value between releases will change the IndexedDB, cookies and localstorage location and your app will not be able to access the old data" (S2). A window can also point at any URL, including `http://127.0.0.1:<port>`.
- **Response headers.** `app.security.headers` can add COOP, COEP, CORP, `Permissions-Policy` and a few others to custom-scheme responses (S3). That does not make `SharedArrayBuffer` reliable on macOS (section 5.3).
- **Webview settings that matter here** (S2): `zoomHotkeysEnabled` (WebView2 zoom keys), `additionalBrowserArgs` (WebView2 switches), `dataDirectory` (Windows) and `dataStoreIdentifier` (macOS 14 and later) for where storage lives, `backgroundThrottling` (macOS only), `visible`, `devtools` (release builds need a feature flag), `dragDropEnabled` (must be off for HTML5 drag and drop on Windows, which dockview uses). WebView2's browser accelerator switch is in wry (`with_browser_accelerator_keys`, S10) but is not in the Tauri 2.12.1 window config list; reaching it from Tauri needs the platform webview handle (**unverified**, spike item).
- **IPC.** Commands serialise arguments and results as JSON; large data should go through `tauri::ipc::Response` and streams through Channels, which Tauri recommends over events for "ordered, high-throughput data delivery" (S4). An old open issue reports high memory when invoking commands (S14). For this terminal IPC is a side channel: the market data stays on HTTP to the Python server.
- **Plugins at v2** (S16): updater 2.13.1, dialog 2.8.1, clipboard-manager 2.4.1, single-instance 2.5.2, window-state 2.5.0 (all September or October 2026), plus global-shortcut, shell (sidecar processes), fs, autostart, log, plus a `localhost` plugin.
- **Tauri 3** is in alpha (3.0.0-alpha.0 on 13 September, alpha.4 on 1 October 2026) and adds a CEF runtime, with open bugs already filed against it (S1, S15). Not a target for this migration; worth watching because a CEF runtime would give Chromium on macOS through the same API.

### 3.2 Wails v3

Go, MIT, a good API, but still a beta whose release notes say "The API is stable, but you may still encounter issues before the final 3.0 release" (S17). Two findings from its own source matter here. The macOS response writer forwards each write to WebKit as it happens, so streaming works there; the Windows writer "accumulates into an in-memory buffer that is only handed to WebView2 in Finish", and the comment adds that "a streaming response cannot work on Windows today" (S19). Its IPC is an HTTP long poll over the same asset server, with frames chunked because "WebView2 caps body delivery around 2 MB" (S18). Go would add a third language to a Python and TypeScript codebase without a clear gain over Rust.

### 3.3 Electron

The baseline. Chromium 152 and Node 24.21.0 in 44.5.1 (S20). Its strength for this project is that the engine is the one every current test runs on (L8), on both operating systems, so the Mac build would look and behave like the Windows one. Costs: about 130 to 160 MB of compressed runtime per platform before any app code (S20), a major upgrade every 8 weeks to stay within the three supported lines (S21), and macOS auto-update requires a signed app (S22). Memory is not obviously worse than Tauri on Windows (section 4).

### 3.4 Electrobun

Fast moving and interesting: system webview by default, an optional `bundleCEF` flag, zstd self-extracting bundles and bsdiff patches that it says can produce "kilobyte-scale updates" (S24). Official support is macOS 14 and later, Windows 11 x64 and Ubuntu 24.04 (S24). The project page gives no size, start-up or memory numbers (S25). The maintainer writes that there "should be no expectation that I will review, respond to, or merge" issues and pull requests (S24). For a tool the owner depends on daily, that bus factor is the deciding risk.

### 3.5 Neutralinojs

The page is served over plain HTTP from the core's own local server and native calls go over a WebSocket (S27), which is close to the loopback design recommended in section 5.1. It is very small (about 2 MB, S30) but its native API is thin, it has no built-in permission model comparable to Tauri's, and the benchmark in S30 shows it using the most memory of the system-webview shells on Windows (497 MB process memory, release build). Not recommended.

### 3.6 CEF used directly

Chromium on both systems without Node, at 130 to 175 MB compressed per platform (S28), with a C++ API and a lot of plumbing to write (windows, menus, dialogs, updates). It only makes sense through a framework (Tauri 3's CEF runtime, Electrobun's `bundleCEF`), and both are young.

## 4. Benchmarks: what the numbers say and what they do not

**Independent CI benchmark** (Elanis, web-to-desktop-framework-comparison, last commit 4 September 2026, run on GitHub Actions, single runs; the author warns the figures "totally depend on system load and resources", S30). Empty app, release build:

| | Size Win / macOS | Process memory Win / macOS | System memory impact Win / macOS | Start-up Win / macOS |
|---|---|---|---|---|
| Electron | 384 / 319 MB | 278 / 369 MB | 104 / 103 MB | 206 / 640 ms |
| Tauri | 3 / 5 MB | 317 / 95 MB | 204 / 77 MB | 711 / 2,044 ms |
| Wails | 11 / 8 MB | 323 / 100 MB | 201 / 69 MB | 559 / 1,740 ms |
| Neutralinojs | 2 / 2 MB | 497 / 181 MB | 327 / 1 MB | not reported / 2,016 ms |

**Tauri's own benchmark data** (S9, runs on 30 September 2026 at commit 30da1fd): hello-world binary 2,838,528 bytes on Windows and 2,884,416 bytes on macOS; mean wall time of the scripted hello-world run 0.61 s on Windows and 1.99 s on macOS; a 3 MB transfer test runs in 0.63 s and 1.61 s, so the transfer cost is inside run-to-run noise. Peak memory is only recorded on Linux: 437.5 MB for the hello world. The Electron series in the same repository stopped on 24 September 2023 (166.5 MB binary, 476 MB peak memory on Linux), so it cannot be compared like for like.

What to take from this:

- The size win is real and large: 3 MB against well over 100 MB.
- The memory win is real on macOS and doubtful on Windows. WebView2 is a full Chromium process group (a browser process plus renderer and helper processes, S33), so a WebView2 app pays most of what Electron pays.
- Start-up numbers from CI runners are noisy; Tauri's 711 ms against Electron's 206 ms on Windows in S30 contradicts the usual claim. The terminal's own first render (647 ms HOME against a 1,500 ms budget) will dominate whichever shell is chosen. The spike must measure cold and warm start on the owner's machines.
- None of these benchmarks loads a page anywhere near this terminal's weight (Perspective WebAssembly, four chart libraries, dockview), and none of them includes a Python backend.

## 5. This front end in WKWebView and WebView2

### 5.1 How the page is loaded (the decision that drives the rest)

| Option | What it means | Verdict |
|---|---|---|
| A. Loopback origin | The shell starts or finds the backend, then points the window at `http://127.0.0.1:<fixed port>/`; FastAPI keeps serving `web/dist` | **Recommended.** Same origin, same CSP, same EventSource, same worker path as today. Needs `NSAllowsLocalNetworking` on macOS (S39), a fixed port (storage is per origin, port included), and Tauri's `remote` capability if the page must call any shell command (S6). |
| B. Custom scheme, proxied | Assets from `tauri://`, and a custom protocol handler forwards `/api/*` to the backend | SSE cannot stream: wry hands the whole response to the webview in one call (S10). The stream would fall back to polling without anyone noticing (L4). |
| C. Custom scheme, IPC | Assets from `tauri://`, data through Tauri commands and Channels | Rewrites `src/api/client.ts`, breaks the same-origin invariant the tests enforce (L4), duplicates the HTTP contract in Rust. Most work, least gain. |

Option A also keeps demo mode and the browser path working unchanged, so the desktop build becomes an additional way to open the same app rather than a fork.

### 5.2 Perspective WebAssembly in workers

- **WebView2:** identical to Chrome; nothing to do.
- **WKWebView:** the needed features are in WebKit: `'wasm-unsafe-eval'` since Safari 16, WebAssembly SIMD since 16.4 and exceptions since 15.2 (S34). **Memory64 is not shipped in Safari** (preview only, S34), so the explicit wasm32 choice in `engine.ts` (L1) is load-bearing and must stay; a test should pin it.
- **Workers from a custom scheme:** service workers cannot be loaded from a `WKURLSchemeHandler` scheme (WebKit bug 206741, open since January 2020, S40). Whether a dedicated module worker loads from `tauri://` was not confirmed from a primary source (**unverified**). Under option A the worker is a normal HTTP same-origin file and the question does not arise.

### 5.3 SharedArrayBuffer and cross-origin isolation

The terminal does not use `SharedArrayBuffer` today (L2), so this is a constraint on the future, not a blocker. In WKWebView it is unreliable: a 2024 test showed `SharedArrayBuffer` available in a Tauri app on macOS 14.2.1 when served through the localhost plugin (S11, comment of 2 January 2024), while a later report on macOS 14.5 could not get `crossOriginIsolated` to be true through custom-scheme headers (S11, comment of 23 September 2024). The issue has been open since April 2021. Rule for the roadmap: do not adopt multithreaded WebAssembly builds (of Perspective or anything else) for the desktop app.

### 5.4 EventSource and live data

- **Option A:** EventSource is an ordinary HTTP request in both engines (supported since Safari 5, S34). No change.
- **Custom scheme:** does not work for streaming in Tauri (S10) or on Windows in Wails (S19). Tauri's open feature request for an SSE-style command (S12) confirms there is no built-in answer.
- **Test to add:** the live stream must report its stream mode, not the polling fallback, inside the desktop window. Without that assertion a broken stream looks like a slow one.

### 5.5 Browser storage: what persists and where

- **Not shared with the browser.** The desktop window has its own profile. Workspaces and layouts saved in the owner's browser at `http://127.0.0.1:8765` will not appear in the app. A one-time export and import (the workspace store already validates imported layouts as untrusted input, `WorkspaceStorage.ts`) solves it.
- **Per origin, port included.** A backend that picks a random free port at each launch would make every launch a new origin with empty storage. Fix the port, or use a custom scheme only for a tiny loader page.
- **Windows:** storage lives in the WebView2 user data folder (S32); Tauri places it in the app's local data folder unless `dataDirectory` says otherwise (S2), so on this PC that is under the per-user local data folder on drive C:. The exact folder name was not checked (**unverified**).
- **macOS:** WKWebView uses its default website data store; `dataStoreIdentifier` selects a separate store on macOS 14 and later (S2). The on-disk path (commonly given as `~/Library/WebKit/<bundle id>`) is **unverified**.
- **Eviction on macOS:** Intelligent Tracking Prevention has been on by default in all WKWebView apps since macOS Big Sur (S37), and WebKit applies a 7-day cap on script-writable storage (localStorage, IndexedDB) after seven days of use without interaction with the site (S38). Whether this can ever hit the app's own first-party origin when it is used daily is **unverified**. Low likelihood, high annoyance: mirror workspaces and layouts to a file through the backend or the shell, and keep `localStorage` as a cache.
- **Scheme changes wipe data:** switching Tauri between `http://tauri.localhost` and `https://tauri.localhost` after release loses all stored data (S2).

### 5.6 F-keys and shortcuts

| Key or combo (L7) | WebView2 on Windows | WKWebView on macOS |
|---|---|---|
| F3, F5, F12, Ctrl+F, Ctrl+P, Ctrl+R, Ctrl+Plus, Ctrl+Minus | Browser accelerators, on by default; all switched off by `AreBrowserAcceleratorKeysEnabled = false` (S31); zoom keys separately by `zoomHotkeysEnabled` (S2). Editing keys (Ctrl+C, V, X, A, Z, Home, End, PageUp, PageDown) stay on regardless (S31). | No browser accelerators of this kind; Cmd+R reload and similar exist only if the app menu defines them. |
| F7 (caret browsing), F10 | Not listed explicitly by Microsoft; F10 in a Win32 window can activate the system menu. **Unverified**, spike item. | F7 to F10 are media keys unless Fn is held or the owner changes the setting (S36). |
| F8 to F11 sector keys | Expected to reach the page once accelerators are off (F11 has no fullscreen meaning in WebView2: **unverified**). An improvement on the browser, where F11 is fullscreen. | Top row is brightness, Mission Control and media by default (S36). Fn-F11 is "Show the desktop" (S35), so F11 never reaches the app unless the owner removes that system shortcut. |
| Alt+1 to Alt+9, Alt+K | Fine with no native menu bar; with a native menu, Alt can move focus to it (**unverified**). | Option produces special characters, but the code reads `e.code` (L7), so it works. |
| Cmd+Q, H, M, W, Tab, Space, Ctrl+Cmd+F | not applicable | Owned by the system or the app menu (S35). Cmd+C, V, X, A only work in a WKWebView if the app menu has the Edit items with those accelerators (S10). |

Conclusion: on Windows the desktop app can own every key the terminal uses, which is better than the browser. On macOS the F8 to F11 sector keys need Cmd or Ctrl based alternatives (for example Ctrl+8 to Ctrl+11, to be agreed in the keymap work), and the help overlay must show the Mac bindings.

### 5.7 Clipboard

Text and image copy use `navigator.clipboard.write` (L6), supported since Chrome 76 and Safari 13.1 (S34). WebView2 behaves like Chrome on a loopback origin. In WKWebView the API needs a user gesture (the code already starts the write inside the click, L6); whether WKWebView in a third-party app treats `http://127.0.0.1` as a secure context and allows image writes is **unverified**. Fallback if the spike fails: the Tauri clipboard-manager plugin (2.4.1, S16), which can write images natively, behind the existing `canCopyImage` check.

### 5.8 File save

- **WebView2:** a blob `<a download>` triggers WebView2's own download flow; wry installs a handler that allows every download by default (S10). Files land in Downloads with no choice of folder.
- **WKWebView:** blob URLs in an `<a download>` do nothing unless the host implements a download delegate; this is the long-standing Tauri report "File download works in Safari but does not work in Tauri on Mac" (S13) and a known WKWebView limitation (S42). wry now has a download delegate (S10) and Tauri exposes download handlers since the request in S13 was closed, but blob support through it is **unverified**.
- **Recommendation:** add a desktop branch behind `saveBlob` and `saveText` in `download.ts` (the single seam, L6) that calls the Tauri dialog plugin's save dialog and writes the bytes natively. `showSaveFilePicker` is not an option: Safari does not ship it (S34).

### 5.9 Fonts and rendering

The fonts are self-hosted (PT Mono, Source Sans 3, Bergoom), so the same glyphs load everywhere. Rasterisation will still differ: WebView2 renders text through Windows' stack and WKWebView through macOS's, so stroke weight and hinting of amber text on black will not match pixel for pixel (**unverified** in detail). `-webkit-font-smoothing` has an effect on macOS only. Practical consequences: the visual regression baselines (Chromium on Windows today) need a second, Mac-specific baseline set, and the amber-on-black contrast checks should be re-run on WebKit, because thinner strokes reduce perceived contrast even when the colour ratio is unchanged.

### 5.10 Safari gaps that could touch React 19, dockview, uPlot, lightweight-charts and ECharts

The Mac target is macOS 26 on Apple Silicon (lens L4: the NautilusTrader 1.231.0 wheel exists only as `macosx_26_0_arm64`), so the floor is the WebKit that ships with macOS 26. Against MDN's compatibility data (S34):

| Feature (L9) | Safari version | Risk on macOS 26 |
|---|---|---|
| `popover` | 17 | none |
| `inert` | 15.5 | none |
| `@container` size queries | 16 | none |
| `text-wrap` | 17.4 | none |
| `scrollbar-width` | 18.2 | none |
| `scrollbar-color` | 26.2 | needs macOS 26.2 or later; on 26.0 and 26.1 the scrollbars fall back to system colours |
| `requestIdleCallback` | preview only | feature-detected in the code, the fallback path runs |
| WebAssembly memory64 | preview only | avoided by the explicit wasm32 choice (L1) |
| `showSaveFilePicker` | not supported | not used |
| `oklch`, `color-mix`, `:has`, `dvh` | not checked in this pass | widely reported as supported in Safari 16 and later (**unverified** here) |

Library-level Safari support for the charting and layout libraries (dockview, uPlot, lightweight-charts, ECharts, the Perspective viewer) was not checked against primary sources in this pass (**unverified**). Areas worth targeted tests on WebKit: dockview drag and drop (HTML5 drag events, plus Tauri's `dragDropEnabled` on Windows, S2), canvas text metrics for uPlot axis labels, `ResizeObserver` timing during panel resizes, Perspective's custom elements and its datagrid scrolling, and React 19's form and focus handling under `inert`.

### 5.11 macOS networking rules for a loopback page

Since macOS 14, App Transport Security "no longer allows connections to IP addresses by default"; `NSAllowsLocalNetworking` re-enables unqualified names, `.local` names and IP addresses (S39). The app's `Info.plist` therefore needs `NSAllowsLocalNetworking = YES`, or the window should load `http://localhost:<port>`; whether ATS treats `localhost` as exempt on macOS 26 is **unverified**. Whether the macOS firewall prompts when an unsigned Python process listens only on loopback is also **unverified**; one Tauri user reports an "Allow incoming connections?" prompt with the localhost plugin (S11).

## 6. Known bugs and open issues worth tracking

| Issue | State on 2 Oct 2026 | Why it matters |
|---|---|---|
| tauri#1522, `SharedArrayBuffer` in the webview (S11) | open since April 2021 | No threaded WebAssembly on the desktop app |
| tauri#13069, SSE-style async command (S12) | open since March 2025 | No streaming through the custom protocol |
| tauri#4633 and #8452, downloads on macOS (S13) | closed (handlers exposed) | Blob downloads need a native save path |
| tauri#4026, high memory when invoking commands (S14) | open since May 2022 | Keep bulk data off IPC |
| tauri#15748 and #15888, CEF runtime bugs (S15) | open since July 2026 | Tauri 3 CEF runtime not ready |
| WebKit 206741, service workers on custom schemes (S40) | NEW since January 2020 | Never rely on a service worker in WKWebView |
| Wails v3 Windows response writer cannot stream (S19) | by design at commit d79d990 | Rules out custom-scheme SSE on Wails Windows |

## 7. What is marketing

- "Tiny memory footprint" for system-webview shells: true on macOS, doubtful on Windows, where WebView2 runs a full Chromium process group (S30, S33).
- "Kilobyte-scale updates" (Electrobun, S24): plausible for the shell, irrelevant if the Python runtime is bundled and changes.
- "Faster start-up than Electron": not supported by the only independent numbers found (S30); measure on the owner's machines.
- Benchmark tables that put Electron at 300 to 550 MB and Tauri at 3 MB measure disk size, not the user's experience; the Electron figure in S30 is larger than its own compressed runtime (S20) and likely includes unpacked or development files (**unverified**).

## 8. What this means for the nq-lab terminal

1. **Pick Tauri 2 (2.12.x) as the shell**, with Electron as the documented fallback if the WebKit spike fails. Do not pick Wails v3, Electrobun or Neutralinojs now; re-check Tauri 3 with its CEF runtime when it reaches release candidate.
2. **Load the page from the existing FastAPI server on a fixed loopback port (option A).** This keeps the same-origin `/api` contract, the CSP, the EventSource stream, the Perspective worker and demo mode unchanged, and it keeps the front end shared between the browser and the desktop app.
3. **Windows first.** WebView2 154 is already on this PC and is Chromium, so the existing 6,925 unit tests, 383 end-to-end tests and the numerical crosscheck carry over almost unchanged. The work is the shell itself: process lifecycle, F-key ownership, save dialog.
4. **Treat the Mac as a separate port with its own gate.** Add a WebKit project to the end-to-end suite (run on a macOS CI runner for real WKWebView behaviour), add Mac visual baselines, add a Mac keymap for F8 to F11, and re-run the accessibility checks (axe and contrast) on WebKit. The research gate and the crosscheck live in the backend and are engine independent, but the crosscheck's terminal leg must be run inside the Mac app at least once per release.
5. **Two front-end adapters, behind existing seams:** a native save path in `download.ts`, and a native image-copy fallback in the grab code. Plus one guard: a test that pins the wasm32 Perspective server.
6. **Storage:** fix the port, plan a one-time workspace import from the browser, and mirror workspaces and layouts to a file so that a profile reset, a scheme change or WebKit eviction cannot lose them.
7. **Honest expectations on "light and fast":** the shell drops from about 130 to 160 MB to about 3 MB, start-up is bounded by the backend and the first render, and memory on Windows will be close to a browser tab. The big costs (Nautilus, the Python runtime, Perspective) do not move with the shell choice.

## 9. What the spike should measure

All windows created hidden and closed at once, on drive D: only.

1. Tauri 2.12.1 window with `visible: false` loading the built `web/dist` from a loopback server: time to first paint, private working set of the whole process tree after 10 s and after opening a Perspective grid, on Windows.
2. Inside that window: EventSource reports stream mode (not polling); Perspective engine starts with the wasm32 server; the `<a download>` path; `navigator.clipboard.write` with an image.
3. Key delivery with browser accelerators off: F3, F5, F7, F10, F11, F12, Ctrl+F, Alt+digit, dispatched synthetically to the hidden window.
4. Same build as an Electron 44 hidden window, for a like-for-like memory and start-up comparison on this PC.
5. On the Mac (not reachable from here): the same list, plus F8 to F11 with and without Fn, ATS with `127.0.0.1` against `localhost`, and the firewall prompt behaviour.

## Sources

All checked on 2 October 2026.

- S1. Tauri releases (tags `tauri-v2.12.1` 30 Sep 2026, `tauri-v2.12.0` 26 Sep, `tauri-v2.11.0` 30 Apr, `tauri-v2.10.2` 4 Feb, `tauri-v3.0.0-alpha.0` 13 Sep, `tauri-v3.0.0-alpha.4` 1 Oct, `tauri-runtime-cef-v3.0.0-alpha.0` 13 Sep), GitHub API: https://github.com/tauri-apps/tauri/releases
- S2. Tauri 2.12.1 configuration schema, `WindowConfig` properties (`useHttpsScheme`, `dataDirectory`, `dataStoreIdentifier`, `zoomHotkeysEnabled`, `additionalBrowserArgs`, `devtools`, `backgroundThrottling`, `dragDropEnabled`): https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-schema-generator/schemas/config.schema.json
- S3. Tauri configuration reference, `app.security.headers`: https://v2.tauri.app/reference/config/
- S4. Tauri, Calling Rust from the frontend (`ipc::Response`, Channels): https://v2.tauri.app/develop/calling-rust/
- S5. Tauri, Inter-Process Communication: https://v2.tauri.app/concept/inter-process-communication/
- S6. Tauri, Capabilities (remote URLs): https://v2.tauri.app/security/capabilities/
- S7. Tauri updater plugin: https://v2.tauri.app/plugin/updater/
- S8. Tauri, App size (release profile advice): https://v2.tauri.app/concept/size/
- S9. Tauri benchmark results, files `tauri-recent-windows.json`, `tauri-recent-macos.json`, `tauri-recent-linux.json`, `electron-recent.json`: https://github.com/tauri-apps/benchmark_results
- S10. wry 0.57.0 source: `src/lib.rs` (download handlers, `with_browser_accelerator_keys`, macOS clipboard note) https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/lib.rs ; `src/wkwebview/class/url_scheme_handler.rs` (single `didReceiveData` then `didFinish` per response) https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/wkwebview/class/url_scheme_handler.rs ; `src/webview2/mod.rs` https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/webview2/mod.rs
- S11. tauri#1522 `SharedArrayBuffer`: https://github.com/tauri-apps/tauri/issues/1522 , comments https://github.com/tauri-apps/tauri/issues/1522#issuecomment-1874331109 and https://github.com/tauri-apps/tauri/issues/1522#issuecomment-2368725233
- S12. tauri#13069 SSE async command: https://github.com/tauri-apps/tauri/issues/13069
- S13. tauri#8452 https://github.com/tauri-apps/tauri/issues/8452 , tauri#8157 https://github.com/tauri-apps/tauri/issues/8157 , tauri#4633 https://github.com/tauri-apps/tauri/issues/4633
- S14. tauri#4026 high memory when invoking commands: https://github.com/tauri-apps/tauri/issues/4026
- S15. tauri#15748 https://github.com/tauri-apps/tauri/issues/15748 , tauri#15888 https://github.com/tauri-apps/tauri/issues/15888
- S16. Tauri plugins workspace, `v2` branch and releases (updater-v2.13.1, dialog-v2.8.1, clipboard-manager-v2.4.1, single-instance-v2.5.2, window-state-v2.5.0): https://github.com/tauri-apps/plugins-workspace/releases
- S17. Wails releases (v3.0.0-beta.27 1 Oct 2026, v3.0.0-beta.1 2 Aug 2026, v2.14.0 10 Aug 2026) and v3 source tree: https://github.com/wailsapp/wails/releases
- S18. Wails v3 `stream_transport.go`: https://github.com/wailsapp/wails/blob/master/v3/pkg/application/stream_transport.go
- S19. Wails v3 `responsewriter_windows.go` (last change d79d990, 9 Aug 2026) and `responsewriter_darwin.go`: https://github.com/wailsapp/wails/blob/master/v3/internal/assetserver/webview/responsewriter_windows.go
- S20. Electron v44.5.1 release assets (`electron-v44.5.1-win32-x64.zip` 157,998,329 bytes, `electron-v44.5.1-darwin-arm64.zip` 130,259,261 bytes) https://github.com/electron/electron/releases/tag/v44.5.1 and `DEPS` (Chromium 152.0.7977.130, Node v24.21.0) https://github.com/electron/electron/blob/v44.5.1/DEPS
- S21. Electron release timelines: https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- S22. Electron `autoUpdater`: https://www.electronjs.org/docs/latest/api/auto-updater
- S23. Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- S24. Electrobun repository README and releases (v2.0.2 29 Sep 2026): https://github.com/blackboardsh/electrobun
- S25. Electrobun site: https://framework.blackboard.sh/electrobun/
- S26. Neutralinojs releases (v6.9.0 24 Jul 2026, zip 8,050,711 bytes) and LICENSE (MIT): https://github.com/neutralinojs/neutralinojs
- S27. Neutralinojs architecture: https://neutralino.js.org/docs/contributing/architecture/
- S28. CEF automated builds index, stable 154.0.32+chromium-154.0.8037.58, 29 Sep 2026: https://cef-builds.spotifycdn.com/index.html (data from https://cef-builds.spotifycdn.com/index.json); licence https://github.com/chromiumembedded/cef/blob/master/LICENSE.txt
- S29. webview/webview: https://github.com/webview/webview ; saucer: https://github.com/saucer/saucer ; wry releases: https://github.com/tauri-apps/wry/releases
- S30. Elanis, web-to-desktop-framework-comparison (last commit 4 Sep 2026): https://github.com/Elanis/web-to-desktop-framework-comparison
- S31. WebView2 `CoreWebView2Settings` (`AreBrowserAcceleratorKeysEnabled`, `IsZoomControlEnabled`): https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2settings
- S32. WebView2, Manage user data folders: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder
- S33. WebView2, Process model: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model
- S34. MDN browser-compat-data v8.1.4 (1 Oct 2026): `css/properties/scrollbar-color.json`, `scrollbar-width.json`, `text-wrap.json`, `css/at-rules/container.json`, `html/global_attributes.json` (popover, inert), `api/Clipboard.json`, `api/ClipboardItem.json`, `api/EventSource.json`, `api/Window.json` (showSaveFilePicker, requestIdleCallback), `http/headers/Content-Security-Policy.json` (wasm-unsafe-eval), `webassembly/memory64.json`, `exception-handling.json`, `fixed-width-SIMD.json`: https://github.com/mdn/browser-compat-data
- S35. Apple, Mac keyboard shortcuts: https://support.apple.com/en-us/102650
- S36. Apple, How to use the function keys on your Mac: https://support.apple.com/en-us/102439
- S37. WebKit, App-Bound Domains: https://webkit.org/blog/10882/app-bound-domains/
- S38. WebKit, Full Third-Party Cookie Blocking and More (7-day cap on script-writable storage): https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- S39. Apple, `NSAllowsLocalNetworking`: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
- S40. WebKit bug 206741, WKWebView support for Service Workers: https://bugs.webkit.org/show_bug.cgi?id=206741
- S41. Tauri, Webview versions (WKWebView updated with macOS; WebView2 updates itself): https://v2.tauri.app/reference/webview-versions/ ; WebView2 runtime 154 on this PC from lens L4.
- S42. Apple Developer Forums, WKWebView download from blob URL (found by search, not read in full; **unverified**): https://developer.apple.com/forums/thread/671705
