# L5: Performance and the data plane

Research lens L5 of the desktop migration plan. It covers how data should move between the compute side and the screen in a native nq-lab terminal for macOS and Windows, which wire format to use, what the published benchmarks say about the candidate shells, and which performance budgets the desktop build should be held to.

- Evidence checked: 2 October 2026. Every external claim carries a source tag (S1, S2, ...) that resolves in the Sources list at the end. Anything not confirmed from a primary source is marked **unverified**.
- Local facts come from reading the repository at HEAD `c7f9e61` and the lab venv's installed packages, read only. No app was launched and nothing was timed for this lens; the inventory and spike steps own measurement.
- Scope: IPC between UI and compute, serialisation, zero copy into the chart and grid libraries, shell benchmarks, and budgets. Packaging and updates are covered in L4.

## 1. Bottom line

1. **At the terminal's payload sizes, the transport is not the bottleneck.** The largest routine response is a bar series capped at 20,000 points (`MAX_POINTS` in `api/data.py`, default 4,000), which is roughly 1 to 2 MB of JSON. Tauri's own measurement of a raw 150 MB command response was 70 to 80 ms on macOS and 1.8 s on Windows (S4). Scaled linearly, 2 MB costs about 1 ms on a Mac and about 24 ms on Windows (an extrapolation, **unverified**). Python serialisation and JavaScript parsing cost more than the hop itself.
2. **Keep the loopback HTTP server for phase 1.** The webview's own `fetch` and `EventSource` talk straight to FastAPI on 127.0.0.1, the same as today. That keeps SSE live streams working (WebView2 cannot stream a custom protocol response at all, S10; wry's protocol responder takes a whole body, S9), keeps the backend in one hop instead of two, and keeps the 2,325 crosscheck checks and the backend tests pointed at an unchanged API. It needs a per-launch token, a random port and the desktop origin added to the existing middleware.
3. **Do not route Python data through Rust IPC.** With a Python backend, Tauri `invoke` or a Channel adds a second hop (Python to Rust, then Rust to the webview) and a second copy. Rust IPC only pays off for compute that lives in Rust.
4. **The one format change worth making is binary columns for the heavy endpoints, and only after measuring.** A small framed format (a JSON header plus raw little-endian Float64 columns) gives `Float64Array` views with no parsing, which uPlot accepts directly (its `AlignedData` type takes typed arrays, S22). Arrow IPC is the right format for Perspective, which reads it natively in its WebAssembly engine with no coercion and calls it "the most efficient way to load data" (S23). Neither needs a new JavaScript dependency in the shell bundle. MessagePack and FlatBuffers buy little here.
5. **"Tauri uses less memory than Electron" is not a safe claim on Windows.** In the only method-described, continuously re-run benchmark found, an empty Tauri app on Windows used about 317 MB (process tree, release) against about 278 MB for Electron, and started in about 711 ms against about 206 ms (GitHub CI, S14). Earlier measurements that count shared pages correctly found Tauri on WebView2 roughly equal to Electron, and WebKit heavier than Chromium on real web apps (S15). Tauri's real wins are install size (about 3 MB against about 384 MB on Windows, S14) and no bundled browser to patch.
6. **WKWebView is not slower than WebView2 for this workload.** Safari and Chrome tie on Apple Silicon on Speedometer 3.1 and JetStream 2.2, and Safari leads MotionMark 1.3.1 by about 23% (January 2026 test, S19). Tauri's own IPC numbers were far better on macOS than on Windows (S4). The Windows side is the one to watch.
7. **Shared memory is Windows only and not exposed by Tauri.** WebView2 has `PostSharedBufferToScript` (SDK 1.0.1661.34 and later, S11); WKWebView has no equivalent, and a Tauri maintainer listed security, platform support and reported performance as reasons it is not offered (S5, S12). Not needed at these sizes.
8. **Budgets (section 8) are set relative to today's browser numbers**: HOME first render stays under 1,500 ms with a desktop target of 1,000 ms, the 8,411-row grid keeps its 500 ms ceiling with a 100 ms target; pan and zoom keep the existing rule of 54 fps and a 25 ms p95; the shell installer stays under 15 MB on Windows and 20 MB on macOS, and idle memory is judged against a browser-tab baseline that the inventory step must measure first.
9. **Perf tests change shape on the Mac.** The existing budgets read a Chrome DevTools Protocol trace. WebView2 exposes that protocol (S34); WKWebView does not, and Tauri's WebDriver bridge has had no macOS support since the request was opened in May 2023 (S35). The Mac needs an in-page frame and timing harness.

## 2. What the terminal moves today

| Fact | Value | Where it comes from |
|---|---|---|
| Server | FastAPI 0.141.1, Starlette 1.7.0, uvicorn 0.54.0, Pydantic 2.13.5 (pydantic-core 2.46.5) | Lab venv `dist-info` folders |
| JSON path | Routes declare `response_model`; FastAPI 0.141 then serialises straight to JSON bytes through pydantic-core ("Serializes directly to JSON bytes via Pydantic's Rust core, skipping the intermediate Python dict + json.dumps() step") | `fastapi/routing.py` lines 719 to 745 in the venv |
| orjson | orjson 3.12.0 is installed, but no route uses `ORJSONResponse`. ARCHITECTURE.md line 163 says "JSON via orjson"; the code does not match the doc | `grep` over `backend/nq_terminal` |
| Bar series | Columnar `{"t": [...], "o": [...], "h", "l", "c", "v"}`, `t` in whole seconds (`ts_ns // NS_PER_S`), default 4,000 points, maximum 20,000 | `services/bars.py` line 216, `api/data.py` line 100 |
| Pagination | `limit` default 500, maximum 5,000 | ARCHITECTURE.md line 163 |
| Live data | SSE through `fastapi.sse.EventSourceResponse` on `/stream` | `api/live_stream.py` line 295 |
| Perspective | 5.5.1, fed from API rows converted to columns in the browser, engine in a Web Worker | `web/src/perspective/engine.ts`, `datasets.ts` |
| Chart libraries | uPlot 1.6.32, lightweight-charts 5.2.1, ECharts 6.1.0 | `web/package.json` |
| Built front end | `web/dist` is 8.3 MB on disk in 190 files; the two largest are Perspective's `perspective-server` WebAssembly (2.46 MB) and `perspective-viewer` WebAssembly (1.55 MB) | `du` and `ls` on `web/dist` |
| Shell bundle budget | 114.9 kB gzip, pinned with 2 kB headroom | `web/scripts/bundleCheck.ts`, owner's brief |
| Perf budgets | HOME first render 1,500 ms (median of three cold loads); fills grid 500 ms each to open, sort or page; pan and zoom at least 54 fps, frame p95 at most 25 ms, no gap over 50 ms; long task 50 ms | `web/e2e/perf/trace.ts` lines 42 to 48 |
| Latest readings | HOME 647 ms and grid open 61 ms (Windows, owner's brief); HOME 554 ms, grid open 65 ms, sort 34 ms, page 32 ms (Mac, Chrome channel, 2026-09-29) | Owner's brief; TESTING.md lines 82 to 83 |
| Backend start | Not measured anywhere in the repo; `start.ps1` waits up to 90 s | `start.ps1` line 54 |

### 2.1 Payload arithmetic

These are estimates from the formats above, not measurements.

- **JSON, per bar:** `t` as a ten-digit integer plus a comma is 11 bytes. A price like `15234.25` is 9 bytes with its comma; a back-adjusted price can print as a 17-digit shortest-round-trip value such as `15234.250000000002`, about 19 bytes. Volume is a double. That gives roughly 54 to 95 bytes per bar.
- **JSON, per series:** 4,000 bars is about 0.2 to 0.4 MB; 20,000 bars is about 1.1 to 1.9 MB.
- **Binary Float64, per bar:** six columns of 8 bytes is 48 bytes, so 20,000 bars is 0.96 MB. Binary is not much smaller than JSON here. The gain is that the browser does no parsing and allocates no per-number JavaScript values.
- **Float32 is not an option.** It would halve the bytes, but back-adjusted prices would round, and the strict crosscheck compares numbers to the last bit. Keep Float64.
- **Timestamps must stay Float64 seconds, not Int64 nanoseconds.** Nanosecond timestamps (about 1.7e18) exceed 2^53, so they are not exact as JavaScript numbers, and an Arrow `Int64` column arrives as a `BigInt64Array`, which uPlot does not take. Today's seconds-as-integer choice is already correct.

## 3. IPC options between UI and compute

Two different hops exist, and they should not be confused:

- **Hop A, webview to the process that holds the data.** Today: browser `fetch` to FastAPI.
- **Hop B, Rust shell to the Python backend.** Only exists if the webview talks to Rust and Rust forwards to Python.

| Option | Binary | Server push or streaming | Both OSes | Evidence on speed | Known problems | Verdict |
|---|---|---|---|---|---|---|
| **Loopback HTTP to FastAPI (today)** | Yes (`arrayBuffer()`) | Yes: SSE and WebSocket work in both webviews | Yes | No desktop measurement found; loopback is not expected to be the limit at 2 MB (**unverified**, measure in the spike) | Needs auth (any local process can connect), CORS for the desktop origin, a port that does not collide with the owner's running 8765. WebKit still treats loopback as mixed content from HTTPS pages (WebKit bug 171934, open, S32); Tauri's `tauri://localhost` origin on macOS is not HTTPS, so this may not bite, but it must be checked. Chrome 142 added a Local Network Access prompt for public to local requests; loopback to loopback is out of its current scope (S33) | **Phase 1 choice** |
| **Tauri `invoke`, JSON** | No ("all arguments and return data must be serializable to JSON", S3) | No | Yes | A `Vec<u8>` sent this way took 8 s for 23 MB on Windows in a user report (S6) | Number precision for 64-bit integers, binary as JSON arrays (S36, issue 7706) | Only for small commands (window state, settings) |
| **Tauri `invoke` with `tauri::ipc::Response` (raw bytes)** | Yes: "To return array buffers in an optimized way, use tauri::ipc::Response" (S1) | No: one request, one response | Yes | 150 MB: macOS 70 to 80 ms, Linux 1.3 to 1.5 s, Windows 1.8 s (maintainer, June 2023, S4). User reports: 11.9 MB in about 100 ms; 9 MB in 40 ms, sometimes 700 ms (S5) | Rides on a custom protocol, which falls back to `postMessage` if a fetch fails, for example after a reload while an async command runs (issue 15435, S36) | Good if compute moves into Rust |
| **Tauri Channel** | Yes (`Channel<&[u8]>`) | Yes, ordered; "the recommended mechanism for streaming data" (S1) | Yes | In the 2.12.1 source, payloads over 8,192 bytes of JSON or 1,024 raw bytes are not pushed: the shell evaluates a small script that makes the page fetch the data back over the IPC protocol (S7), so each large message is two trips | Same transport caveats as above | For Rust-side streams only |
| **Tauri events (`emit`)** | No: "Event payloads are always JSON strings" | Yes | Yes | "The event system is not designed for low latency or high throughput situations" (S2). One user measured 200 ms for 3 MB (S5) | High call rates crashed apps (issue 8177, open); `PostMessage failed; is the messages queue full?` panic in wry on Windows (issue 10546, open) (S36) | Lifecycle signals only |
| **Custom URI scheme (`register_asynchronous_uri_scheme_protocol`)** | Yes | **No.** wry 0.57.0's responder takes the whole body as `Cow<'static, [u8]>` (S9); WebView2 delivers a custom response all at once and reads response streams on one background thread (S10, open since May 2023) | Yes | A wry maintainer called it "probably the most performant data exchange mechanism we have so far" (S12) | No SSE, no chunked reads on Windows | Useful as a binary GET endpoint served by Rust; not for live data |
| **WebSocket** | Yes (binary frames) | Yes, both ways | Yes | No method-described desktop benchmark found | One user found it slower than Tauri IPC for frames (S5) | Optional replacement for SSE if live data ever needs binary frames |
| **Shared memory** | Yes, zero copy | Push only | **Windows only.** WebView2 `PostSharedBufferToScript`, SDK 1.0.1661.34 and later; a read-only buffer written by script crashes the renderer (S11) | None published | Not exposed by wry or Tauri (wry issue 1110, open since December 2023, S12). A Tauri maintainer cited security concerns, Windows-only support and reported poor performance (S5) | No |
| **Electron IPC (for comparison)** | Structured clone, so typed arrays are copied, not transferred | `postMessage` can only transfer `MessagePort` objects (S30) | Yes | None used here | Chromium shipped with the app | Not needed |

## 4. Published IPC numbers, with their caveats

| Measurement | Result | Method and caveats | Source |
|---|---|---|---|
| Raw 150 MB command response, Tauri 2 alpha | macOS 70 to 80 ms; Linux 1.3 to 1.5 s; Windows 1.8 s; iOS 70 to 100 ms; Android 700 to 800 ms | A maintainer's own runs, file embedded with `include_bytes!`, June 2023, hardware not stated. Before the custom protocol IPC the same response took "almost 50 seconds" | S4 |
| Implied throughput | macOS about 2 GB/s; Windows about 83 MB/s | Derived from the row above (**unverified** for current WebView2 154) | S4 |
| 11.9 MB via `ipc::Response` | About 100 ms | One user, OS not stated, includes their app's work | S5 |
| 9 MB stream | 40 ms, with spikes to 700 ms | One user, method not shared | S5 |
| 3 MB over events | 200 ms | One user, events are JSON | S5 |
| 23 MB `Vec<u8>` as JSON argument | 8 s on Windows | One user, before switching to raw bodies | S6 |
| Channel thresholds | 8,192 B JSON is "roughly 2x faster through eval than through fetch on WebView2 v135"; 1,024 B raw is "roughly 30% faster through eval than through fetch on macOS" | Comments in Tauri's own source, 2.12.1 | S7 |

What these numbers say for the terminal: a 4,000-bar chart is a few hundred kilobytes, and a 5,000-row grid page is of the same order. Even the slow Windows path moves that in a few milliseconds. The Windows numbers are the weak point, but they are about ten times worse than macOS, not ten times worse than what the terminal needs.

## 5. Serialisation formats

| Format | Python side (already in the venv or needed) | JavaScript side | Zero copy into typed arrays | Exact for Float64 | Fits | Verdict |
|---|---|---|---|---|---|---|
| **JSON via pydantic-core (today)** | Built in | `JSON.parse`, then arrays of numbers | No | Yes: shortest round-trip printing parses back to the same double | Everything | Keep for small and mixed responses |
| **JSON via orjson** | orjson 3.12.0 installed (Apache-2.0 or MIT) | Same | No | Yes | Everything | Only if profiling shows pydantic-core is slow; the route would lose response validation |
| **Raw framed columns** (a JSON header describing each column, then 8-byte aligned Float64 blocks) | numpy `tobytes()`, no new package | About 30 lines, no dependency: `new Float64Array(buf, offset, n)` | **Yes** | Yes | uPlot series such as equity lines and histograms | **Recommended for chart series** |
| **Apache Arrow IPC stream** | pyarrow 25.0.1 installed (Apache-2.0) | Perspective reads it inside its WebAssembly engine: no JS Arrow library needed for grids. For charts, the `apache-arrow` JS package (21.2.0, Apache-2.0) would be a new dependency | Yes in principle: the format is "relocatable without pointer swizzling, allowing for true zero-copy access" and buffers are padded to 8 or 64 bytes (S25) | Yes | Perspective grids and pivots; any table with mixed types and real datetimes | **Recommended for Perspective**, lazy-loaded with the grid chunk |
| **MessagePack** | Needs `msgpack` or `ormsgpack` (new) | msgpackr (MIT) or similar, a new dependency | No for plain arrays; typed arrays only with extensions | Yes | Mixed objects | No: msgpackr's own benchmark shows `unpack` at 21,926 op/s against `JSON.parse` at 18,125 op/s without shared structures (Node 15, i7-4770, S27), a small gain for a new dependency on both sides |
| **FlatBuffers** | Needs `flatbuffers` (new), plus schema compiler | Generated code | Yes for scalar vectors | Yes | Fixed schemas | No: a schema compiler and generated code on both sides for no gain over raw columns; current release v25.12.19 (S28) |

Notes:

- Perspective's coercion rules matter for correctness. JSON input is coerced and `date` and `datetime` "cannot be inferred from JSON input", so a schema is required; Arrow "comes with its own schema and has no need for coercion" (S23). Moving the heavy grids to Arrow removes a class of type bugs as well as parse time.
- Perspective's 64-bit WebAssembly build raises its heap cap from 4 GB to 16 GB "in browsers which support it" (S23). Safari supports Memory64 only behind a flag (Technology Preview 251, WebAssembly feature table updated 29 September 2026, S29). On the Mac the terminal will run the 32-bit build. At the terminal's row counts this is not a limit.
- A binary format must not become a second source of truth. The crosscheck should compare the binary decode with the JSON response for the same request, number by number, so both paths stay identical.

## 6. Getting data into each library without copies

| Library | Input it wants | Zero copy possible | What to do |
|---|---|---|---|
| uPlot 1.6.32 (MIT) | `AlignedData = TypedArray[] \| [xValues: number[] \| TypedArray, ...yValues]` (S22) | **Yes**, a `Float64Array` view straight from the response buffer | Serve framed Float64 columns for line and band charts. Nulls cannot be represented in a `Float64Array` except as `NaN`; check how the gap handling in `LineStack` treats `NaN` before switching |
| lightweight-charts 5.2.1 (Apache-2.0) | Arrays of objects (`{ time, open, high, low, close }`), see `CandleChart.engine.ts` | No | Build the objects from the typed arrays; 20,000 small objects is a few milliseconds (**unverified**) |
| ECharts 6.1.0 (Apache-2.0) | Arrays or `dataset` sources | Partly (it accepts typed arrays in some series types, **unverified**) | Leave on JSON; ECharts screens use small, aggregated data |
| Perspective 5.5.1 (Apache-2.0) | Arrow bytes, CSV, JSON rows or columns | **Yes**, Arrow `ArrayBuffer` into the worker; transfer it rather than copy it | Serve Arrow for the fills grid, the trades grid and the ledger |
| TanStack grid (current fills grid) | Row objects | No | Unchanged; its budget is already met (61 ms against 500 ms) |

uPlot's own benchmark shows how little room there is to gain in rendering: 166,650 points rendered in 34 ms cold on a Ryzen 7 PRO 5850U with Chrome 113 (README, March 2023, S22). The terminal's charts hold 4,000 to 20,000 points.

## 7. Shell benchmarks: what is measured and what is marketing

### 7.1 Tauri against Electron

The most useful public benchmark is `Elanis/web-to-desktop-framework-comparison` (MIT, last pushed 1 October 2026, S14). Its method is published: each app is spawned through a shell on GitHub-hosted runners, start time is taken when the app prints "App started and loaded !", and memory is the sum over the process tree from `pidusage`, plus the drop in system free memory. The README warns the numbers carry "a margin of error". Empty app, release builds:

| Metric | Electron | Tauri | Wails | Source |
|---|---|---|---|---|
| Build size, Windows x64 | about 384 MB | about 3 MB | about 11 MB | S14 |
| Build size, macOS arm64 | about 319 MB | about 5 MB | about 8 MB | S14 |
| Memory, process tree, Windows | about 278 MB | about 317 MB | about 323 MB | S14 |
| Memory, process tree, macOS arm64 | about 369 MB | about 95 MB | about 100 MB | S14 |
| Free-memory drop, Windows | about 104 MB | about 204 MB | about 201 MB | S14 |
| Free-memory drop, macOS arm64 | about 103 MB | about 77 MB | about 69 MB | S14 |
| Start, Windows | about 206 ms | about 711 ms | about 559 ms | S14 |
| Start, macOS arm64 | about 640 ms | about 2,044 ms | about 1,740 ms | S14 |

Other evidence:

- Tauri issue 5889 (closed in May 2024, S15) measured real web apps with shared memory counted properly. postman.com on Windows 10: Tauri 399 MB, Electron 318 MB; on macOS 12.6: Tauri 421 MB, Electron 337 MB, Safari 471 MB. USS and PSS of the default apps on Ubuntu: Electron 118 MB and 207 MB, Tauri 125 MB and 185 MB. A Tauri maintainer said the project's own benchmark page "need[s] to be taken with a good handful of salt" and is "only ... a smoke test / regression test".
- A 2022 real-app comparison (Authme, Windows 11, i5-4570) found Tauri at about 80 MB idle and 2 s start against Electron at about 120 MB and 4 s, and its author says "This is not a scientific test" (S16).
- WebView2 starts several processes per environment (browser, renderer, GPU among them), and Microsoft's guidance is to share one environment, avoid WebView2 for splash screens because of cold start cost, and use `MemoryUsageTargetLevel` Low or `TrySuspendAsync` for inactive views. If Edge is running with a matching version, "the required WebView2 binaries are already in memory, improving launch performance" (S13, updated 2 September 2026).

**Marketing to discount:**

| Claim | Where | What the evidence says |
|---|---|---|
| "a minimal Tauri app can be less than 600KB in size" | Tauri start page (S17) | True for a bare binary; the CI benchmark's real bundles are 3 to 5 MB (S14), and the terminal's own assets are 8.3 MB |
| Tauri uses a fraction of Electron's memory | Many blog posts found in search, for example a 2026 post claiming 42 MB idle against 168 MB, with no method | On Windows, WebView2 is Chromium; measured process-tree memory is equal or higher than Electron (S14, S15). On macOS the empty-app gap is real (95 MB against 369 MB) but closes on heavy pages (S15) |
| Tauri starts faster | Same posts | Empty-app CI numbers show the opposite on both Windows and macOS (S14) |

What does hold: install and update size (S14), no Chromium to ship and patch, and a Rust core where native compute is possible.

### 7.2 WKWebView against WebView2

- **JavaScript.** A January 2026 run on an M2 MacBook Air 15", macOS Tahoe 26.2, three runs each, averaged: Speedometer 3.1 Chrome 143 42.7, Safari 26.2 41.9, Edge 143 40.8; JetStream 2.2 Chrome 419.2, Safari 436.8, Edge 413.3 (S19, reporting Magic Lasso's test, S20; Magic Lasso sells a Safari ad blocker, so read with care). Google reported Chrome 139 at 52.35 on Speedometer 3.1 on an M4 MacBook Pro, macOS 15, June 2025 (S21, as quoted in S19; the post itself was not read).
- **Graphics.** MotionMark 1.3.1 in the same January 2026 run: Safari 8,088.73, Chrome 6,582.95, Edge 6,003.25 (S19). MotionMark exercises canvas and SVG drawing, which is what the chart libraries do.
- **Caveats.** WKWebView runs the same WebKit and JavaScriptCore as Safari, but settings and process limits differ, and it is versioned with macOS rather than updated on its own (**unverified** for current macOS). WebView2 on this PC is runtime 154 (L4) and updates on its own. Mac and Windows numbers cannot be compared with each other here: the owner's PC and Mac are different hardware.
- **WebAssembly.** Chrome has Memory64 (133), threads (74) and fixed-width SIMD (91); Safari has threads (14.1) and SIMD (16.4) but Memory64 only behind a flag (S29). Perspective's 32-bit build covers both.

### 7.3 Canvas memory, the hidden cost of ten panels

A canvas backing store costs width times height times the square of the device pixel ratio times 4 bytes. A 1,000 by 500 CSS pixel chart panel is 2 MB at a ratio of 1, 4.5 MB at 1.5 (a 4K display at 150%) and 8 MB at 2 (a Retina Mac). Charts often keep more than one canvas layer, for example a crosshair overlay (layer counts per library **unverified**). Ten chart panels at a ratio of 2 with two layers each is about 160 MB before any data or JavaScript heap. This is arithmetic, not a measurement, and it is why the ten-panel memory budget below is several times the idle budget.

## 8. Proposed desktop budgets

Principles: every budget has a measurement method that runs without a visible window; budgets are per platform; desktop must be no worse than the same build in a browser tab on the same machine; and the existing browser budgets stay in force unchanged.

| Metric | Today (browser) | Desktop target | Ceiling (fails the build) | Rationale |
|---|---|---|---|---|
| Cold start to shell painted (window chrome and panels laid out, no data) | Not measured; the browser path waits up to 90 s for the backend | 800 ms on both | 1,500 ms | Empty Tauri app on CI: 711 ms Windows, 2,044 ms macOS (S14). Hosted runners are slow; the owner's machines should do better. Measure first, then tighten |
| Cold start to HOME with data, backend cold | Not measured | 3,000 ms | 5,000 ms | Dominated by Python start and NautilusTrader imports, which nobody has timed (open question Q1). A disk snapshot of HOME to show sooner is not allowed for prices (PRD DL1: in-memory only) |
| Warm start to HOME with data (backend already running) | HOME first render 647 ms Windows, 554 ms Mac, budget 1,500 ms | 1,000 ms | 1,500 ms (today's budget) | The webview adds process start (S13); keep today's ceiling |
| Idle memory, UI process tree, HOME open, 60 s after load | Not measured | Browser-tab baseline + 50 MB | Baseline + 100 MB, and 350 MB absolute | The empty-app CI numbers (S14) put the shell floor near 100 MB on macOS and near 300 MB on Windows by the sum-of-trees measure; measure private working set (Windows) and physical footprint (macOS), not summed resident sets, which overcount shared pages (S15) |
| Idle memory, backend process | Not measured | Baseline | Baseline + 10% | Reported separately so shell and Python are judged on their own |
| Memory, ten panels open (two charts at 20,000 points, candle chart, ECharts distribution, Perspective grid, fills grid, four light screens) | Not measured | 600 MB UI tree | 900 MB | Canvas backing stores alone can reach about 160 MB at a pixel ratio of 2 (section 7.3) |
| Chart frame time during pan and zoom on the 1m GIP chart | Budget: at least 54 fps, p95 at most 25 ms, no gap over 50 ms (test currently skipped offline) | p95 at most 16.7 ms | Today's rule | The libraries are canvas-bound; Safari's MotionMark lead (S19) suggests the Mac will pass first |
| Grid open, 8,411 fills | 61 ms Windows, 65 ms Mac, budget 500 ms | 100 ms | 500 ms | Already met in the browser; the desktop must not regress |
| Data hop, 20,000-bar series, request to typed arrays ready, warm server cache | Not measured | 40 ms Windows, 25 ms macOS | 100 ms | About 24 ms of raw transfer on Windows by the S4 scaling, much less on macOS |
| Live event latency, server emit to painted value | Not measured | p95 at most 50 ms | 150 ms | SSE over loopback; event rates are low |
| Shell installer (no Python) | Not applicable | 15 MB Windows, 20 MB macOS | 30 MB | 8.3 MB of front-end assets plus a 3 to 5 MB runtime (S14) |
| Bundled engine (Python runtime and packages), later phase | The lab venv is 723 MB (L4) | 400 MB installed, 150 MB download (**provisional**) | Set after the trimming spike | L4 recommends shipping the shell first and the engine later |
| Shell update | Not applicable | 15 MB per release | 30 MB | Tauri's updater downloads the whole artefact (L4) |
| Shell JavaScript budget | 114.9 kB gzip | Unchanged | Unchanged | Assets are local in a desktop build, but parse and compile time still grows with bytes |
| WebView data folder | Not applicable | 100 MB | 250 MB | Drive C: on the owner's PC has about 30 GB free; the WebView2 data folder sits under the user profile by default (S13) |

### 8.1 How each budget gets measured without showing a window

- **Windows:** create the window hidden, attach to WebView2 over the Chrome DevTools Protocol by setting `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` and a separate `WEBVIEW2_USER_DATA_FOLDER` per run (S34), and reuse the existing trace parsers in `web/e2e/perf/trace.ts`. Memory from the process tree's private working set. Whether WebView2 paints and produces frame events while its window is hidden is **unverified**; if it does not, frame time must be measured in a minimised or off-screen state approved by the owner, or only on the Mac.
- **macOS:** no DevTools Protocol and no WebDriver (S35). Use an in-page harness: `performance.mark` around the same milestones the CDP trace uses, `requestAnimationFrame` deltas for frame time, and a result posted back to the shell. WebKit may throttle timers and animation frames in hidden windows (**unverified**), which would make hidden-window frame budgets meaningless there.
- **Both:** run each budget three times, judge the median, as the browser budgets do today.

## 9. Risks and known bugs

| Risk | Evidence | Mitigation |
|---|---|---|
| Windows IPC is about 25 times slower than macOS for large raw responses | S4 | Keep payloads small; keep the heavy data on loopback HTTP |
| Event system floods crash or panic on Windows | Issues 8177 and 10546, both open (S36) | Never push market data through `emit` |
| IPC falls back to `postMessage` after a reload during a long async command | Issue 15435, closed May 2026 (S36) | Avoid reloads in production; prefer HTTP for long jobs, which the JOBS queue already does |
| Memory creep with frequent large `invoke` returns | Issue 4026, open since 2022 (S36) | Same: heavy data stays on HTTP |
| No streaming custom protocol on Windows | WebView2Feedback 3519, open (S10) | SSE stays on loopback HTTP |
| Loopback HTTP from the desktop origin blocked by mixed content or Local Network Access rules | WebKit bug 171934 (S32); Chrome LNA scope (S33) | Test in the spike on both OSes before committing; the fallback is a Rust-served custom protocol for GETs plus a Channel for live data |
| Loopback server reachable by other local processes | Inherent to TCP on 127.0.0.1 | Random port, a per-launch token in a header, the existing middleware (loopback only, trusted host, same origin) extended to the desktop origin |
| Perf budgets cannot run the same way on macOS | S35 | In-page harness (section 8.1) |
| WebAssembly compile cache may not apply to custom-protocol assets, so Perspective's 4 MB of WebAssembly compiles on every launch | **Unverified** | Measure in the spike; Perspective already loads lazily |
| Binary transport drifts from JSON | Design risk | The crosscheck compares both decodes, number by number |

## 10. What this means for the nq-lab terminal

1. **Phase 1 changes nothing in the data plane.** The desktop shell loads the existing React build and points it at the existing FastAPI backend on a random loopback port with a per-launch token. Every function screen behaves exactly as today; so do SSE, the JOBS queue and the research gate, and the backend tests and the crosscheck run unchanged because the API is unchanged.
2. **The speed the owner will feel comes from start-up and the backend, not from IPC.** Nobody has timed the Python start. That is the first number the inventory step must produce, because it decides whether cold start can meet 3 s.
3. **Phase 2 adds binary only where measurements show it pays.** Candidates: `/api/bars` and the analytics series as framed Float64 columns for uPlot, and the fills grid, the trades grid and the ledger as Arrow for Perspective. Content negotiation (`Accept` header) keeps JSON as the default and the reference, so the browser build and the tests keep working.
4. **Rust IPC is for Rust compute.** If a later phase moves hot paths (resampling, rolling statistics) into Rust, `tauri::ipc::Response` with the same framed columns is the transport, and the same budgets apply.
5. **The Windows build is the one to watch.** WebView2 is Chromium, so memory will look like a Chrome tab, not like the small numbers in Tauri marketing; IPC there is the slowest of the platforms measured. The Mac build is likely to be the faster and lighter of the two.
6. **Correctness rules for any new format:** Float64 only, seconds not nanoseconds, no Float32, and a crosscheck that compares binary and JSON for the same request.
7. **Keep the existing browser budgets.** The desktop budgets are added beside them, never in place of them.

## 11. Open questions

- **Q1.** How long does the backend take from process start to first answer, both cold and warm, on each machine? (Inventory step.)
- **Q2.** What does the terminal use in a browser tab today: memory at idle on HOME and with ten panels? The desktop memory budgets are relative to this baseline.
- **Q3.** Can WebView2 and WKWebView `fetch` and `EventSource` a token-protected `http://127.0.0.1:<port>` from the Tauri origin on current runtimes without prompts? (Spike.)
- **Q4.** Does a hidden WebView2 window still produce frames and trace events, so frame budgets can run without a visible window?
- **Q5.** Does WebView2 cache compiled WebAssembly for assets served through Tauri's protocol on Windows?
- **Q6.** Is the 150 MB raw-response gap between macOS and Windows (S4, 2023) still that large on WebView2 154 and Tauri 2.12.1?
- **Q7.** Which Mac does the owner have (chip, display pixel ratio, refresh rate)? This sets the 120 Hz frame target and the canvas memory figures.

## Sources

All checked on 2 October 2026.

- S1. Tauri 2, Calling Rust from the Frontend (raw `Response`, raw request bodies, Channels): https://v2.tauri.app/develop/calling-rust/
- S2. Tauri 2, Calling the Frontend from Rust (events "not designed for low latency or high throughput", Channels "designed to be fast and deliver ordered data"): https://v2.tauri.app/develop/calling-frontend/
- S3. Tauri 2, Inter-Process Communication (JSON-RPC-like protocol, JSON-serialisable arguments): https://v2.tauri.app/concept/inter-process-communication/
- S4. tauri-apps/tauri pull request 7170, "refactor(core): use webview's URI schemes for IPC", merged 10 August 2023; benchmark comments from 8 to 13 June 2023: https://github.com/tauri-apps/tauri/pull/7170
- S5. tauri-apps/tauri issue 13405, "Additionally support pushing array buffers with the event system", open (maintainer comments 9 and 10 May 2025; user measurements July and October 2025): https://github.com/tauri-apps/tauri/issues/13405
- S6. tauri-apps/tauri issue 9322, "how to use new ipc in windows" (23 MB in 8 s; maintainer answer on `ipc::Request` and `ipc::Response`): https://github.com/tauri-apps/tauri/issues/9322
- S7. Tauri 2.12.1 source, `crates/tauri/src/ipc/channel.rs` (thresholds and fetch-back delivery): https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/ipc/channel.rs
- S8. Tauri 2.12.1 source, `crates/tauri/scripts/ipc-protocol.js` (custom protocol fetch with `postMessage` fallback): https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/scripts/ipc-protocol.js
- S9. wry 0.57.0 (released 8 September 2026), `RequestAsyncResponder::respond` takes `Into<Cow<'static, [u8]>>`: https://docs.rs/wry/latest/wry/struct.RequestAsyncResponder.html
- S10. MicrosoftEdge/WebView2Feedback issue 3519, "Stream HTTP responses to WebView2", open, last activity 12 May 2026: https://github.com/MicrosoftEdge/WebView2Feedback/issues/3519
- S11. Microsoft Learn, WebView2 Win32 `ICoreWebView2_17::PostSharedBufferToScript`, introduced in 1.0.1661.34: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_17
- S12. tauri-apps/wry issue 1110, "Add PostSharedBufferToScript for making streaming possible", open: https://github.com/tauri-apps/wry/issues/1110
- S13. Microsoft Learn, "Performance best practices for WebView2 apps", updated 2 September 2026: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance
- S14. Elanis/web-to-desktop-framework-comparison (MIT), README benchmark tables and `runner/runner.js` method, last pushed 1 October 2026: https://github.com/Elanis/web-to-desktop-framework-comparison
- S15. tauri-apps/tauri issue 5889, "Memory benchmark might be incorrect: Tauri might consume more RAM than Electron", opened 21 December 2022, closed 17 May 2024: https://github.com/tauri-apps/tauri/issues/5889
- S16. Levminer, "Tauri VS. Electron - Real world application", 22 August 2022: https://www.levminer.com/blog/tauri-vs-electron
- S17. Tauri 2, What is Tauri (the "less than 600KB" claim): https://v2.tauri.app/start/
- S18. Tauri 2, App Size (release profile settings, `removeUnusedCommands` from 2.4): https://v2.tauri.app/concept/size/
- S19. Supa Sidebar, "The Fastest Browser for Mac in 2026", reporting Magic Lasso's January 2026 runs (secondary source): https://supasidebar.com/blog/fastest-browser-mac-2026
- S20. Magic Lasso, "The Best Web Browser in 2026" (the primary for S19; not read directly, **unverified**): https://www.magiclasso.co/insights/best-web-browser-2026/
- S21. Google, "Chrome achieves highest score ever on Speedometer 3.1", June 2025 (quoted via S19; not read directly): https://blog.google/chromium/chrome-achieves-highest-score-ever-on/
- S22. leeoniya/uPlot (MIT), README performance section and `dist/uPlot.d.ts` at 1.6.32 (`AlignedData` accepts typed arrays): https://github.com/leeoniya/uPlot
- S23. perspective-dev/perspective (Apache-2.0), docs `explanation/table/loading_data.md` and `use_cases/large_datasets.md`: https://github.com/perspective-dev/perspective/tree/master/docs/md
- S24. Perspective benchmarks page (suite and environment; GitHub-hosted ubuntu-22.04 runner): https://github.com/perspective-dev/perspective/blob/master/docs/md/benchmarks.md
- S25. Apache Arrow, Columnar Format specification (alignment, zero copy): https://arrow.apache.org/docs/format/Columnar.html
- S26. Apache Arrow JavaScript documentation, version 21.2.0 (release of 21 July 2026): https://arrow.apache.org/docs/js/
- S27. kriszyp/msgpackr (MIT), README benchmarks (Node 15, V8 8.6, Windows, i7-4770): https://github.com/kriszyp/msgpackr
- S28. google/flatbuffers (Apache-2.0), latest release v25.12.19, published 6 February 2026: https://github.com/google/flatbuffers/releases
- S29. WebAssembly feature status table, `features.json`, last commit 29 September 2026: https://github.com/WebAssembly/website/blob/main/features.json
- S30. Electron, `ipcRenderer` API (structured clone, transfer list of `MessagePort` only): https://www.electronjs.org/docs/latest/api/ipc-renderer
- S31. Release pages: Tauri 2.12.1 (30 September 2026) and 3.0.0-alpha.4 (1 October 2026), https://github.com/tauri-apps/tauri/releases ; Electron 44.5.1 (30 September 2026), https://github.com/electron/electron/releases. Licences from the repositories: Tauri Apache-2.0 or MIT (two licence files), wry Apache-2.0, Electron MIT, orjson Apache-2.0 or MIT, lightweight-charts and ECharts Apache-2.0.
- S32. WebKit bug 171934, "Don't treat loopback addresses ... as mixed content", status NEW: https://bugs.webkit.org/show_bug.cgi?id=171934
- S33. Chrome for Developers, "Local Network Access" (prompt from Chrome 142; loopback-to-loopback outside current scope), updated 29 September 2025: https://developer.chrome.com/blog/local-network-access
- S34. Playwright, WebView2 (connection over the DevTools Protocol, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, `WEBVIEW2_USER_DATA_FOLDER`): https://playwright.dev/docs/webview2
- S35. tauri-apps/tauri issue 7068, "MacOSX Support for tauri-driver", open since 26 May 2023, last updated 30 March 2026: https://github.com/tauri-apps/tauri/issues/7068
- S36. Tauri issues: 7706 "Deprecate JSON in IPC" (open), https://github.com/tauri-apps/tauri/issues/7706 ; 8177 "Event emit crashes app with high call rate" (open), https://github.com/tauri-apps/tauri/issues/8177 ; 10546 "PostMessage failed ; is the messages queue full?" (open), https://github.com/tauri-apps/tauri/issues/10546 ; 4026 "High memory usage when invoking commands" (open), https://github.com/tauri-apps/tauri/issues/4026 ; 15435 IPC custom protocol failure after reload (closed 25 May 2026), https://github.com/tauri-apps/tauri/issues/15435
