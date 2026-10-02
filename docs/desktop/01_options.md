# 01: Options for the desktop terminal

Step 01 of the desktop migration plan. It turns the inventory, the two spikes and the seven research lenses into a short list of end-to-end architectures, scores each against weighted criteria fixed before scoring, and names a lead option and a runner-up.

- Date: 2 October 2026. Repository: `nq-lab/terminal`, HEAD `c7f9e61` (v2).
- Inputs, all in `docs/desktop/`: `00_inventory_backend.md`, `00_inventory_frontend.md`, `00_spike_webview2.md`, `00_spike_rust.md`, and `research/L1_webview_shells.md` to `research/L7_security_a11y.md`. Numbers marked **measured** come from the inventory or the spikes on the owner's Windows 11 PC. Numbers with an S tag come from the sources at the end, checked on 2 October 2026 (most were checked by the lens that first cited them; the release dates of Tauri and Electron, the state of the Tauri, wry, iced, Zed and egui_plot issues cited, and the AccessKit pattern list were re-checked for this step). **Estimate** marks a figure built by this plan and not measured. **Unverified** marks anything not confirmed from a primary source.
- This step ran no apps, opened no windows and took no measurements. Nothing was measured on a Mac by any step.
- Scoring arithmetic is reproducible: the scores in section 7 and the weights in section 3 give every total in sections 7 and 8.

## 1. Bottom line

1. **Lead: option A.** A Tauri 2 shell (Rust, 2.12.x) around today's React front end. The window loads the page from the existing FastAPI backend on a loopback port, and the shell starts and supervises that backend from the lab's own `.venv`. Nothing in the backend, the research gate, the crosscheck or the front end changes beyond a handful of small seams. Weighted score **84.8 of 100**.
2. **Runner-up: option E, Electron**, with the same page and the same backend. Score **83.5**. It gives Chromium on both systems, so the Mac build behaves like the Windows build, at the cost of a bundled browser of about 130 to 160 MB per platform and a major upgrade every 8 weeks. It is the documented fallback if the Mac WebKit gate (section 11) fails.
3. **The margin between A and E is narrow, and one test decides it.** A wins on lightness (a 3.2 MB exe against a 158 MB runtime) and on upkeep; E wins on Mac parity and accessibility. If the front end fails on WebKit on the Mac, A drops to 77.8 and E leads (section 8). That test is phase 0 of the plan, and it needs a Mac.
4. **Every native UI option lands far behind (51 to 62), even when speed counts double.** The reasons are measured, not taste:
   - The page already runs as fast in WebView2 as in Edge on every screen.
   - Most of the start time and much of the memory is the Python backend, which every option keeps.
   - The native routes throw away about 77,400 lines of front end and 74,000 lines of tests, and cost 52 to 147 weeks.
   - The Rust toolkits cannot yet expose grid structure to Windows screen readers, so they fail WCAG 2.2 AA on a terminal made mostly of grids.
5. **Effort for the lead: about 14 to 25 focused build weeks to working apps on both systems** (estimate, section 9): 1 to 2 weeks for the Mac gate, 7.5 to 12 for Windows, 5.5 to 10.5 for the Mac. Electron: about 10 to 18 weeks. Native options: 52 to 147 weeks.
6. **"Rust or C" has a place, but a narrow one.** In A the shell is Rust. Later, Rust enters the backend only as compiled modules behind existing Python functions, and only where a profile names a hot path (option A+). A native drawn view appears only for one screen that misses its frame budget. A full Rust backend is not reachable, because the gate, the lab helpers and the backtests are the lab's own Python code (L3).

## 2. What the inputs already settle

These facts hold whichever option is chosen, so they shape every score.

| Fact | Value | Source |
|---|---|---|
| Page speed is set by the engine and the backend, not the shell | Per-screen times in a Tauri window and in headless Edge agree within 13% on all 8 screens; HOME 753 ms in WebView2 against 752 ms in Edge on a warm fixture backend | measured, `00_spike_rust.md`, `00_spike_webview2.md` |
| The Python backend dominates start-up | 2.6 to 3.1 s to first `/api/health` (inventory), 3.6 to 5.1 s under load (WebView2 spike); about 2.3 s of it is imports (scipy.stats 0.57 s, pandas 0.37 s, fastapi 0.39 s) | measured |
| A Rust shell adds little time | Process `main` at 23 ms, window and WebView2 built at 318 ms, navigation starts at 314 ms (medians of 5) | measured, `00_spike_rust.md` |
| Backend memory | 186 MB working set at ready, about 300 MB after 16 typical routes, 1,170 MB after a sweep of every route | measured, `00_inventory_backend.md` |
| The backend cannot leave Python | 55 backend files import `nq_lab`; prices only through `nq_lab.data.serve`; JOBS runs `backtests/run_base.py` on NautilusTrader 1.231.0; the JOBS validator imports the strategy registry, which imports `nautilus_trader` | L3, read from source |
| The Mac target is fixed | NautilusTrader 1.231.0 publishes macOS wheels only as `macosx_26_0_arm64`, so the lab venv and any bundled backend need Apple Silicon on macOS 26 or later | S18 |
| The front end has never run on WebKit | Every end-to-end project runs on Chromium; 204 screenshot baselines are Windows Chromium | inventory, L1 |
| The front end is large | about 77,400 lines of TS and TSX outside tests, 5,400 lines of CSS, 73,900 test lines in 453 files, 25 screen folders for 30 functions | L2, inventory |
| Browser maths pinned by the crosscheck | 833 lines in `web/src/quant`, checked by `qa/crosscheck/p12_power.py` and `p12_neff.py` | L2 |
| Rust grid accessibility gap | AccessKit's Windows adapter implements ExpandCollapse, Invoke, RangeValue, ScrollItem, SelectionItem, Selection, Text, Toggle, Value and Window patterns, and no Grid, GridItem, Table or TableItem pattern | S7, re-checked 2 October 2026 |

## 3. Criteria and weights

Fixed before any option was scored. Weights add to 100. Each option gets a score from 1 (poor) to 5 (best) per criterion; half points are allowed. The weighted total is the sum of weight times score, divided by 5, so it reads as a mark out of 100.

| Criterion | Weight | What a 5 means | What a 1 means |
|---|---|---|---|
| Speed and lightness (the owner's headline ask) | 20 | Small install, low memory, fast start, fast interaction, all measured | A large runtime, more memory than a browser tab, slower than today |
| Correctness and the crosscheck | 15 | Backend tests, the crosscheck, the golden files, unit and end-to-end suites all run unchanged | Most proof must be rebuilt and every number re-proved |
| Research-gate safety (gate, write ban, read-only IB) | 10 | The guarantees stay in the tested Python code, with no new read paths | New code reads data or talks to the broker and must be policed from scratch |
| Accessibility, WCAG 2.2 AA (it applies to desktop software through WCAG2ICT, S17) | 10 | The existing DOM, ARIA and axe checks carry over on both systems | No screen reader support, or grids that fail 1.3.1 |
| The look (amber on black, `docs/BLOOMBERG_LOOK.md`) | 5 | Same tokens, same fonts, same pixels on both systems | Rebuilt by hand, or a toolkit that fights a custom look |
| Effort and calendar time | 15 | Working apps on both systems within 6 months of focused work | More than 18 months at the high end |
| Risk (technical and delivery) | 10 | Proven pieces, a fallback for each unknown | Stalled-rewrite pattern, immature toolkit, no fallback |
| macOS and Windows parity | 10 | Same engine and same behaviour on both | Different engines and known gaps on one side |
| Maintainability by one owner with automated build runs | 5 | Small native code, stable APIs, slow upgrade cadence | Large native codebase, frequent breaking upgrades |

Speed and lightness is itself scored from four parts, so that one measured number cannot swing it: install and download size (weight 5 of 20), memory (7), start-up to usable (4) and interaction speed (4).

Effort scale used for that criterion: 5 means at most 26 focused weeks to both platforms; 4 means up to 39; 3 up to 52; 2 up to 78; 1 beyond 78 at the high end. Half points sit between.

## 4. The options

Eight architectures are scored. Seven more were dropped before scoring (section 5).

### A. Tauri 2 shell, today's React UI, Python backend as a supervised process (lead)

```
 Tauri 2.12.x shell (Rust): window, splash, lab picker, supervisor, save dialog, no page commands
   |  spawns <lab>/.venv python -m nq_terminal on 127.0.0.1:<random port>, per-launch token on stdin
   |  Job Object (Windows) or process group (macOS) kills the whole tree
   v
 FastAPI backend, unchanged contract  <--- the page loads from here: same origin, same CSP, same SSE
   |  nq_lab.data.serve is the only price door; JOBS spawns the lab interpreter as today
   v
 WebView2 (Windows, Chromium 154) or WKWebView (macOS 26, WebKit)
```

- **What carries over unchanged:** the whole front end, the backend and its about 2,875 tests, the crosscheck (2,455 PASS on the working tree per the inventory), the golden files, the gate, the write ban, the read-only IB client, and demo mode. On Windows the unit and end-to-end suites keep their meaning because WebView2 is Chromium 154.
- **Why load the page from the backend's address:** loading from a custom scheme breaks the live stream. wry 0.57.0 hands a custom-protocol response to the webview in one piece, and its streaming request is still open (S6). Loading from loopback keeps `fetch`, `EventSource`, the CSP and the Perspective worker exactly as in the browser (L1 option A, L5, L7).
- **What changes:**
  - Shell: about 45 lines in the spike, a few hundred in production (estimate).
  - Backend: a per-launch token, the desktop origin in the allowlist, an explicit lab root and interpreter for JOBS, no-console spawn flags, and an environment that drops `QUANTPAD_API_KEY`.
  - Front end, two seams: a native save dialog behind `download.ts`, and an image-copy fallback.
  - Storage: a fixed origin, a one-time workspace import from the browser, and a mirror to file.
  - Mac: a keymap for F8 to F11, because the top row of a Mac keyboard triggers system functions unless Fn is held (S26) and Fn-F11 is Show the desktop (S41), with the defaults of F8 to F10 not checked against a primary page; and `NSAllowsLocalNetworking`, because ATS blocks raw IP addresses by default since macOS 14 (S25).
- **Measured on this PC:**
  - Size: exe 3,224,576 bytes, NSIS installer 1,195,347 bytes, built without admin.
  - Memory: 191 MB private working set at HOME and 238 MB after eight screens, in 7 processes. The heavier set in the other spike reached 422 MB private.
  - Start: launch to HOME ready 1,960 ms median with the real backend warm and a cold profile.
- **Not measured:** anything on WKWebView; a production shell with supervision, dialogs and updates. Tauri's own CI puts a hello-world binary at 2,838,528 bytes on Windows and 2,884,416 bytes on macOS (S5), so the Mac shell should be of the same size.

### A+. Option A, then Rust inside the backend where a profile says so

The same shell and page as A. In a second phase, a profiled hot path gets a Rust body compiled as a PyO3 extension module, called from the existing Python function. For one release, a shadow test computes both bodies and asserts equality at the crosscheck tolerances (1e-9 relative, 1e-12 for stored anchors). The dumps, the golden files and the API do not change (L3 section 7). Phase 2 can also add binary Float64 columns or Arrow for the heaviest endpoints, negotiated by `Accept` header so JSON stays the reference (L5).

- **Candidate targets** (measured in the inventory): `/api/ledger` 4.3 s cold, `/api/analytics/spa` 3.6 s, `/api/seasonality/instrument/{root}` 2.3 s, and bootstrap 1.4 s each. Warm time equals cold time on several of them.
- **Caution:** a Python result cache may fix those routes first, at lower risk. The numerical traps on any port are summation order (NumPy pairwise sums against sequential or compensated sums), rolling-moment conventions, `ddof` and quantile defaults, the NumPy random stream that bootstrap and SPA reproduce draw for draw, and tie order in scipy's clustering (L3).
- **Why it is scored separately:** it is the honest way to put Rust where it pays, but it adds a compiled module per platform. It only belongs in the plan once a profile names a target.

### B. Option A, then a route-by-route Rust backend (strangler)

The same shell and page. A second server in Rust (axum) takes over API routes one at a time behind the same `openapi.json` contract. Python keeps the gate, every route that needs `nq_lab`, and JOBS.

- **The hard limit:** prices may only come through `nq_lab.data.serve`. A Rust route that needs bars must either ask the Python process for them, which adds a second hop and a second copy, or read Parquet itself, which is an ungated door. L3 and L7 both say the second must be banned.
- **How far it can go:** only about a quarter of the backend is a natural port target (the 4,777 lines of `analytics`). The rest is the HTTP contract or code coupled to the lab (L3 section 5.2).
- **Cost:** two servers, two languages, routing by path, a shared token, and a crosscheck that must prove every ported route. It shortens no measured start time, because the Python process must still start before any price can be served.

### C. Native Rust UI with a Rust core; Python only for the gate and JOBS

egui with eframe is the pick among the Rust toolkits:

- The spike measured it on this PC.
- It is the most used Rust GUI crate, with dock, table and plot crates around it.
- Rerun proved it on dense data: sub-pixel aggregation made its plots 30 to 120 times faster (S35).

gpui with gpui-kit has a candlestick chart and the Longbridge Pro precedent (S13), but its API moves with every snapshot, and Zed's own Windows screen-reader issue is open (S14). iced has no screen-reader support at all (S9). Slint has no chart and no docking (S36).

- **Measured on this PC (synthetic data):**
  - Size: the egui exe is 10,761,728 bytes.
  - Memory: 77 to 84 MB private (Vulkan) or 123 to 162 MB (DX12), in one process.
  - Chart: a raw 1,000,000-point line costs 74 ms of CPU per frame (about 8 frames a second), a known egui_plot limit (S11); with per-pixel decimation that falls to 0.5 to 0.7 ms.
  - Table: 8,411 virtualised rows cost 0.54 to 0.63 ms of CPU per frame.
  - Start: first frame of a hidden window at 568 ms median, GPU set-up included.
- **What is lost:** every screen, every chart integration, the dockview layouts, the Perspective grids, the keyboard grammar code, about 6,925 unit tests, 383 end-to-end tests and the axe checks. The 833 lines of browser maths must be ported, and the Rust core's analytics must be re-proved against the crosscheck.
- **Accessibility:** AccessKit gives no table structure on Windows (S7), and egui has no live regions (L7). Both matter for grids and for streaming panels.

### C0. Native Rust UI (egui) over the unchanged Python backend

The same UI as C, but the backend stays exactly as it is and the UI talks to it over the same HTTP and SSE contract. This is the fairest form of the native route: the crosscheck and the gate stay safe, and only the UI is rebuilt. It still carries the UI effort (L2: 54 to 99 weeks) and the accessibility gap.

### D. Qt 6 in C++

Qt 6.12 Widgets or Qt Quick in C++, over the unchanged Python backend.

- **Strengths:** the strongest native accessibility. Qt ships UI Automation grid, grid item, table and table item providers on Windows, and a Cocoa bridge on macOS (S8). Docking is built in (or via the LGPL Advanced Docking System). QTableView is virtualised by design.
- **Weaknesses:**
  - Charts are custom work: Qt Graphs is GPL or commercial only and has no candlestick series (S16).
  - Qt Widgets fights a fully custom look.
  - The commercial small-business licence is €546 a year per developer (S15).
  - In a one-author macOS benchmark, Qt Widgets had the highest peak memory of the native toolkits (214.5 MiB) and needs over 22 MiB of runtime (S12).

### E. Electron (runner-up)

The same page and the same backend as A, with Electron 44 as the shell and the page loaded from the backend's loopback address.

- **Strengths:** Chromium 152 on both systems (S2), so the Mac build renders and behaves like the Windows build, and the existing suites, baselines and axe checks apply on both.
- **Costs:**
  - Size: the runtime zip is 157,998,329 bytes on Windows x64 and 130,259,261 bytes on macOS arm64 (S2).
  - Upgrades: a major every 8 weeks, with only the latest three supported (S3).
  - Security: the app owns every Chromium and Node patch; the repository lists 41 advisories published in 2026 up to 2 October (S22).
  - Signing: macOS auto-update needs a signed app (L1).
- **Memory and start:** not obviously worse on Windows, clearly worse on the Mac. On the only method-described CI benchmark, an empty release app used 278 MB (Electron) against 317 MB (Tauri) on Windows, and 369 MB against 95 MB on macOS. It started in 206 ms against 711 ms on Windows (S4, single CI runs, noisy).

### F. Qt for Python (PySide6), native UI in the backend's language

A PySide6 UI with pyqtgraph charts, in Python, either in the same process as `nq_terminal` or beside it.

- **Strengths:** Qt's accessibility; the browser maths can move into Python next to the crosscheck; a single language for the owner.
- **Weaknesses:** not "light and fast" in the owner's sense, because Python and Qt imports land in the UI process. It is still a full UI rewrite (L2's Qt line, 52 to 95 weeks, less the data layer). It is not Rust or C.

## 5. Dropped before scoring

| Candidate | Why dropped | Source |
|---|---|---|
| Wails v3 (Go) | Still beta (v3.0.0-beta.27 on 1 October 2026); its Windows asset server cannot stream a response, so SSE through it fails; Go adds a third language | S28 |
| Electrobun | The maintainer says there "should be no expectation" that issues or pull requests are reviewed; too thin a bus factor for a daily tool | S29 |
| Neutralinojs | Thin native layer; the most memory of the system-webview shells on Windows in the CI benchmark (497 MB) | S4 |
| CEF used directly | 130 to 175 MB per platform plus all the window, menu, dialog and update plumbing by hand; only sensible through a framework | L1 |
| Tauri 3 with its CEF runtime | Alpha (3.0.0-alpha.4, 1 October 2026), with open runtime bugs; would give Chromium on the Mac through the same Rust API, so it is the item to re-check when it reaches a release candidate | S1 |
| iced, Dear ImGui, Makepad | No screen-reader support; iced's request has been open since 5 October 2020 | S9, S37 |
| Slint | No chart widget (request closed as not planned) and no docking (open since October 2022) | S36 |
| Flutter, Compose Multiplatform, Avalonia | Not Rust or C, no first-party docking or pivot grid; Avalonia is the most complete of them but is C# and .NET | L2 |
| SwiftUI plus WinUI 3 (two native apps) | Two complete front ends in two languages for one owner; the WinUI DataGrid package was last released in November 2021 | L2 |
| Python embedded in the Rust shell (PyO3) | Static embedding is not first-class; a pandas crash or the 2 GiB bar cache would live inside the window process | S20 |
| Nuitka, PyOxidizer as the backend packager | Nuitka moved to AGPL-3.0 with a runtime exception and needs a C compiler this PC lacks; PyOxidizer is "effectively in a zombie state" | S30, S31 |

## 6. Evidence per option

| Option | Shell or UI binary | Install or download | UI memory | Start | Interaction | Status of the numbers |
|---|---|---|---|---|---|---|
| A, A+, B | 3,224,576 B exe | NSIS 1,195,347 B (WebView2 assumed present; the embedded bootstrapper adds about 1.8 MB, S32) | 191 MB private at HOME, 238 MB after 8 screens, 422 MB after the heavy set (Perspective pivot of 8,411 rows plus six panels) | window 318 ms; launch to HOME ready 1,960 ms on real data | screens equal to Edge; HOME 647 ms against the 1,500 ms budget; grid 61 ms against 500 ms | measured on Windows; Mac not measured |
| E | Electron runtime | 157,998,329 B zip (Windows), 130,259,261 B (macOS) | empty app 278 MB Windows, 369 MB macOS | empty app 206 ms Windows, 640 ms macOS | same page, same engine family as today | sourced (S2, S4), not measured here |
| C, C0 | 10,761,728 B egui exe | about 10 MB plus fonts (estimate) | 77 to 84 MB private demo (Vulkan); 359 MB with a raw million-point line in view | first frame 568 ms (hidden window) | decimated 1M line 1.07 to 1.22 ms a frame; 8,411-row table 1.07 to 1.16 ms (GPU free) | measured, synthetic data, offscreen frames; one Mac benchmark (S12): 158 ms first frame, 121.7 MiB peak |
| D | Qt Widgets | over 22 MiB of runtime (S12) | 214.5 MiB peak (S12) | 201.8 ms first frame (S12) | scroll p99 10.93 ms (S12) | one author, macOS only, code not inspected |
| F | PySide6 6.11.2 | not measured | not measured | Python plus Qt imports in the UI process (estimate: slower than A) | pyqtgraph, not measured | none |
| Backend, every option | lab venv | 0 MB shipped (723 MB venv already on disk) | 139 to 186 MB at ready, about 300 MB after typical use | 2.6 to 5.1 s to first answer | slowest cold routes 1.4 to 4.3 s | measured |

The last row matters more than any other: whichever shell or toolkit is chosen, the Python backend sets the cold start and adds 140 to 300 MB in normal use. A faster window does not shorten the 2.6 to 5.1 s. Lazy imports, a splash while the backend starts, and caching the slow routes do.

## 7. The matrix

### 7.1 Speed and lightness, by part

| Option | Size (5) | Memory (7) | Start (4) | Interaction (4) | Speed score |
|---|---|---|---|---|---|
| A | 5 | 3 | 3 | 4 | 3.7 |
| A+ | 5 | 3 | 3.5 | 4.5 | 3.9 |
| B | 5 | 3 | 3.5 | 4.5 | 3.9 |
| C | 4 | 4.5 | 3 | 5 | 4.2 |
| C0 | 4 | 4.5 | 3 | 5 | 4.2 |
| D | 4 | 3.5 | 3 | 4.5 | 3.7 |
| E | 1 | 2.5 | 3.5 | 4 | 2.6 |
| F | 3 | 3 | 2.5 | 3.5 | 3.0 |

Why: size is the shell or runtime the owner installs and updates. Memory weighs the measured UI process tree; Electron loses on the Mac (S4), and the native demo is the lowest. Every option scores 3 or near it on start, because the backend dominates; the A+ and B scores credit faster slow routes. Interaction credits the measured page budgets for the web options and the measured 1 ms native frames for C, which only exist once the charts are rebuilt with decimation.

### 7.2 Weighted scores

| Criterion (weight) | A | A+ | B | C | C0 | D | E | F |
|---|---|---|---|---|---|---|---|---|
| Speed and lightness (20) | 3.7 | 3.9 | 3.9 | 4.2 | 4.2 | 3.7 | 2.6 | 3.0 |
| Correctness and crosscheck (15) | 5 | 4.5 | 3.5 | 2 | 3 | 3 | 5 | 3.5 |
| Research-gate safety (10) | 5 | 5 | 3 | 3 | 4.5 | 4.5 | 4 | 4.5 |
| Accessibility (10) | 4 | 4 | 4 | 1.5 | 1.5 | 3.5 | 5 | 3.5 |
| The look (5) | 4 | 4 | 4 | 3.5 | 3.5 | 3 | 5 | 3 |
| Effort and calendar (15) | 5 | 4 | 2.5 | 1 | 1.5 | 1.5 | 5 | 1.5 |
| Risk (10) | 3.5 | 3.5 | 3 | 1.5 | 2 | 2 | 4 | 2.5 |
| Mac and Windows parity (10) | 3.5 | 3.5 | 3.5 | 4 | 4 | 4 | 5 | 4 |
| Maintainability, one owner (5) | 4 | 3.5 | 2.5 | 2 | 2 | 2 | 2 | 3 |
| **Weighted total (of 100)** | **84.8** | **80.6** | **67.1** | **51.2** | **59.7** | **61.4** | **83.5** | **62.0** |
| Rank | 1 | 3 | 4 | 8 | 7 | 6 | 2 | 5 |

### 7.3 Reasons per cell, in short

- **Correctness.**
  - A and E keep every suite and the crosscheck unchanged. A loses nothing on Windows; on the Mac the page's maths run on a different JavaScript engine and must be re-run there once, which is cheap.
  - A+ adds shadow-tested ports.
  - B ports whole routes, so every one is a new proof.
  - C rewrites the UI and the analytics core.
  - C0, D and F keep the backend proof but lose the unit and end-to-end suites, and must port or move the 833 lines of browser maths.
- **Gate.**
  - A and A+ add no read path: the shell is banned from IB, Parquet, Arrow, Polars and DuckDB crates by cargo-deny and Clippy, mirroring the Python scans (L7).
  - B and C add Rust code that needs prices, which must come through the Python gate or not at all.
  - E keeps the backend unchanged but puts Node in the main process, a larger surface to police.
- **Accessibility.**
  - E gets Chromium's tree on both systems.
  - A keeps the DOM and axe, with known caveats: NVDA does not read in a frameless Tauri window (issue open, S34, so use a framed window), WebView2's browser keys must be switched off, and the WebKit tree must be re-checked on the Mac.
  - D and F get Qt's grid and table providers, but every name, role and focus order is rebuilt by hand and axe is lost.
  - C and C0 fail 1.3.1 on Windows grids today (S7).
  - Two gaps exist in the web build whatever the choice: no `forced-colors` or `prefers-contrast` rules, and no text alternative for the canvas charts (L7).
- **Look.**
  - E renders the same on both systems.
  - A keeps the tokens and fonts, but WebKit's text rasterisation differs, and `scrollbar-color` needs Safari 26.2 (S33).
  - Self-drawn native toolkits can reproduce the look but must rebuild all of it.
  - Qt Widgets resists a custom look.
- **Effort.** See section 9. A and E both fit inside 6 months; native routes run 52 to 147 weeks.
- **Risk.**
  - A's open risk is WebKit on the Mac, which has never run this front end. GitButler is building its next client on Electron partly because of WebKit text-input bugs (S27).
  - E's risks are known and managed.
  - The native routes match the stalled-rewrite pattern: Netscape, xi-editor, and Lapce, still 0.x after eight years (S38, S39).
  - egui broke its API in three minor releases in 2026 (S10).
- **Parity.** E is the same engine on both systems. The native toolkits draw the same pixels on both, but none has been run on the Mac here. A has two engines.
- **Maintainability.**
  - A is a few hundred lines of Rust on a stable 2.x line, pinned, with security releases to track: two IPC advisories in 2026, so require 2.11.6 or later (S21).
  - E needs six major upgrades a year.
  - The native routes leave one owner with tens of thousands of lines of UI code on pre-1.0 toolkits (C, C0) or C++ (D).

## 8. How sensitive the ranking is

Each scenario changes one thing and rescales the other weights so they still add to 100. Totals are out of 100.

| Scenario | 1st | 2nd | 3rd | Best native |
|---|---|---|---|---|
| Base weights | A 84.8 | E 83.5 | A+ 80.6 | F 62.0 |
| Speed and lightness at 40 | A 82.1 | A+ 80.0 | E 75.7 | C0 65.6 |
| Mac and Windows parity at 20 | E 85.3 | A 83.2 | A+ 79.4 | F 64.0 |
| Effort nearly ignored (weight 5) | A 83.0 | E 81.5 | A+ 80.7 | F 65.8 |
| Accessibility waived (weight 0) | A 85.3 | E 81.6 | A+ 80.7 | C0 63.0 |
| All nine criteria equal | A 83.8 | E 83.6 | A+ 79.8 | F 63.3 |
| Only the four non-regression criteria count | E 95.0 | A 90.0 | A+ 87.5 | F 72.5 |
| **WebKit gate fails on the Mac** (A, A+ and B: parity 2, look 3, risk 2) | **E 83.5** | A 77.8 | A+ 73.6 | F 62.0 |

What this says:

1. **A and E trade places on two questions only:** how much Mac parity matters, and whether WebKit runs this front end. Neither is a matter of opinion once the phase 0 gate has run on a Mac.
2. **No native option reaches the top three in any scenario,** not even with speed weighted at 40 or accessibility waived. The measured page is already fast, and the Python backend sets the start time in every option. That leaves the native routes paying 52 to 147 weeks for a gain the owner would mostly not feel.
3. **A split shell is a further fallback:** Tauri on Windows and Electron on the Mac, sharing the same page and backend. The shells are thin, so this costs a second small shell rather than a second app. Use it only if WebKit fails and the owner still wants the 3 MB Windows build.

## 9. Effort by build phase

Weeks are focused build weeks for one developer working with automated build runs, built up from the work lists in L1, L3, L4, L5 and L7. They are **estimates**, not measurements; recalibrate after phase 1a. Calendar time depends on how many weeks a month the owner gives the work.

### 9.1 Option A (lead)

| Phase | Work | Weeks |
|---|---|---|
| 0. Mac gate | A Mac with macOS 26 on Apple Silicon and a synced lab venv (precondition). Run the unit suite and a WebKit end-to-end project against the unchanged front end. Check Perspective (wasm32 server, worker, CSP), dockview drag and drop, canvas text, keys, clipboard image copy, downloads, SSE in stream mode (not the polling fallback), and ATS with `127.0.0.1`. Pass or fail decides A against E. | 1 to 2 |
| 1a. Windows shell | Tauri 2.12.x on the MSVC host, or the GNU host the spike used. Framed window, single instance, window state, splash, lab folder picker and validation, navigation locked to the backend origin, no page commands, browser accelerator keys off | 1.5 to 2.5 |
| 1b. Supervision | Spawn the lab interpreter with `-m nq_terminal`; random port; per-launch token on stdin; identity check before showing the window; Job Object with kill-on-close; no console windows; restart and logs | 1.5 to 2 |
| 1c. Backend seams | Token middleware, desktop origin, explicit lab root and interpreter for JOBS, no-console flag on JOBS spawns, stripped environment; tests for each (small, inside `nq_terminal`) | 1 to 1.5 |
| 1d. Front-end seams | Native save dialog behind `download.ts`; image-copy fallback; a test pinning the wasm32 Perspective server; fixed origin, one-time workspace import, mirror of workspaces and layouts to a file, flush on close | 1.5 to 2.5 |
| 1e. Proof | A hidden-window smoke test over the debugging protocol (both spikes proved the method). The desktop budgets from L5. The crosscheck against the app-launched backend. An all-day soak. cargo-deny, cargo-audit and Clippy bans, with the existing scans extended to the shell source | 1.5 to 2.5 |
| 1f. Windows package | NSIS per-user without admin, an install-folder choice (drive C: is 99% full), WebView2 embedded bootstrapper, CI job | 0.5 to 1 |
| **Windows subtotal** | | **7.5 to 12** |
| 2a. WebKit proof | A WebKit end-to-end project on a macOS 26 runner, Mac visual baselines (204 today on Windows Chromium), axe and contrast checks re-run on WebKit | 2 to 3 |
| 2b. Mac keys | Alternatives for F8 to F11, Cmd conventions, app menu with the Edit items, help overlay showing Mac bindings | 1 |
| 2c. Mac supervision | Process group, parent-death check, `NSAllowsLocalNetworking`, folder access for the lab | 0.5 to 1 |
| 2d. WebKit fixes | Whatever phase 0 and 2a find; unknown until the gate runs | 1 to 4 |
| 2e. Mac package | Developer ID, hardened runtime, notarisation, stapled DMG, Tauri updater on GitHub Releases ($99 a year, S24; the updater signature cannot be switched off, S23) | 1 to 1.5 |
| **Mac subtotal** | | **5.5 to 10.5** |
| **Total, phases 0 to 2** | | **14 to 24.5** |

Later phases, each started only on evidence:

| Phase | Trigger | Weeks |
|---|---|---|
| 3a. Close today's accessibility gaps (`forced-colors`, `prefers-contrast`, text or table alternatives for canvas charts) | Needed in every option, browser included | 2 to 4 |
| 3b. Start-up and slow routes in Python (lazy imports, result cache for `/api/ledger`, SPA, seasonality, bootstrap) | Cold start over the L5 ceiling, or a route over its budget | 1 to 3 |
| 3c. A+: one Rust hot path as a PyO3 module, with shadow tests | A profile after 3b still names a hot path | 2 to 4 per path |
| 3d. Binary columns (Float64 frames for uPlot, Arrow for Perspective) | The 20,000-bar data hop misses its 40 ms budget on Windows | 2 to 3 |
| 3e. Bundled demo engine (python-build-standalone plus uv, about 240 to 270 MB compressed, S19) with split updates | The owner wants a build that runs without the lab | 3 to 5 |
| 3f. One native drawn view (wgpu) beside the web panels | A single screen misses its frame budget after 3d | 4 to 8 |

### 9.2 Option E (runner-up)

| Phase | Weeks | Difference from A |
|---|---|---|
| 0. Mac smoke | 0.5 to 1 | No WebKit gate: Chromium on both |
| 1. Windows (shell in TypeScript, context isolation, sandbox, fuses, supervision, seams, proof, package) | 6.5 to 11 | No Rust toolchain; the security checklist replaces the Tauri capability work |
| 2. Mac (keys, supervision, signing for auto-update, Mac baselines on Chromium) | 3 to 5.5 | No WebKit fixes |
| **Total** | **10 to 17.5** | |
| Upkeep | 6 to 12 days a year | Six Electron majors a year at 1 to 2 days each (estimate), plus Chromium security releases |

### 9.3 The other options

| Option | Weeks to both platforms | Basis |
|---|---|---|
| A+ | A plus 4 to 12 | 3b plus one or two hot paths (estimate) |
| B | A plus 20 to 40 (34 to 65) | A second server and contract tests, 4 to 8; about half of the 76 operations ported with shadow tests at 2 to 4 days each, 16 to 32 (estimate) |
| C | 78 to 147 | L2's 54 to 99 for the UI, 4 to 8 for AccessKit table work, plus 20 to 40 for the Rust core (estimate) |
| C0 | 58 to 107 | L2's 54 to 99, plus 4 to 8 for AccessKit table work |
| D | 52 to 95 | L2's Qt estimate |
| F | about 45 to 85 | L2's Qt estimate less the data layer and the maths port, which stay in Python (estimate, **unverified**) |

## 10. What must not regress, per option

| Guarantee | A | A+ | B | C | C0 | D | E | F |
|---|---|---|---|---|---|---|---|---|
| Crosscheck and golden files | kept | kept, ports shadow-tested | every ported route re-proved | re-proved, core rewritten | kept, P12 maths ported | kept, P12 maths ported | kept | kept, P12 maths moved to Python |
| Backend tests (about 2,875) | kept | kept | split across two servers | mostly replaced | kept | kept | kept | kept |
| Unit (about 6,925) and end-to-end (383) suites | kept (plus a WebKit project) | kept | kept | lost | lost | lost | kept | lost |
| Research gate and write ban | kept | kept | new Rust read paths to police | new Rust read paths to police | kept | kept | kept | kept |
| Read-only IB (client id 95, AST ban) | kept, shell banned from IB crates | kept | kept if IB stays Python | must be rebuilt with Clippy bans and a message allowlist | kept | kept | kept | kept |
| WCAG 2.2 AA | kept, Mac re-check | kept | kept | at risk (grids fail 1.3.1 on Windows) | at risk | rebuilt by hand | kept | rebuilt by hand |
| The look | kept, Mac font rendering differs | kept | kept | rebuilt | rebuilt | rebuilt, harder | kept | rebuilt, harder |
| Perf budgets (HOME 1,500 ms, grid 500 ms, shell 114.9 kB gzip) | kept, plus desktop budgets | kept | kept | replaced by native budgets | replaced | replaced | kept | replaced |
| Browser launch as a fallback | kept | kept | kept | separate code base | separate | separate | kept | separate |

## 11. Decision rule and gates

1. **G0, before any code:** the owner confirms the Mac (Apple Silicon, macOS 26 or later) and that the lab and its venv can live on it. Without that, the Mac app can only be a shell pointed at a backend elsewhere (L4).
2. **G1, the Mac WebKit gate (phase 0):** the unchanged front end passes its unit suite and a WebKit end-to-end pass on the Mac, including Perspective, dockview, the live stream in stream mode, keys, clipboard and downloads, with any failures fixable inside the 1 to 4 week budget of phase 2d.
   - **Pass:** build A.
   - **Fail:** build E with the same backend work, or the split shell of section 8.
3. **G2, Windows acceptance (end of phase 1):** the desktop budgets of L5 are met on this PC, the crosscheck passes against the app-launched backend, an all-day soak shows no growth beyond the memory ceiling, and the shell has no page commands.
4. **G3, any Rust in the backend (phase 3c):** only after a Python fix (3b) has been tried and a profile still names the path, and only with a shadow release at the crosscheck tolerances.
5. **Revisit:** Tauri 3 with its CEF runtime at release candidate (Chromium on the Mac through the same Rust shell), and Tauri's open request to bundle a Chromium renderer (S40).

## 12. Open questions for the owner

- Which Mac, which macOS version, and will the lab and its venv live on it? (G0)
- Must the desktop app itself meet WCAG 2.2 AA, or only the web build? In this matrix the answer does not change the leader, but it decides whether the native routes are even admissible.
- How much does identical behaviour on both machines matter against a 3 MB install? That single weight moves the lead between A and E (section 8).
- Is Rust a requirement or a preference? Under A it lives in the shell and, later, in profiled backend modules; it does not draw the screens.
- Will anyone else ever install the app? That decides Windows signing and whether any GPL or LGPL obligations bite (L4, L2).
- Should a build that runs without the lab (demo over fixtures) exist? It is the only reason to bundle Python (phase 3e).

## Sources

All checked on 2 October 2026.

- S1. Tauri releases (2.12.1 on 30 September 2026; 3.0.0-alpha.4 and tauri-runtime-cef 3.0.0-alpha.5 on 1 October 2026): https://github.com/tauri-apps/tauri/releases
- S2. Electron v44.5.1 release assets (`electron-v44.5.1-win32-x64.zip` 157,998,329 bytes, `electron-v44.5.1-darwin-arm64.zip` 130,259,261 bytes) and DEPS (Chromium 152.0.7977.130): https://github.com/electron/electron/releases/tag/v44.5.1 and https://github.com/electron/electron/blob/v44.5.1/DEPS
- S3. Electron release timelines (majors every 8 weeks, latest three supported): https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- S4. Elanis, web-to-desktop-framework-comparison (release builds on GitHub CI, single runs; last commit 4 September 2026): https://github.com/Elanis/web-to-desktop-framework-comparison
- S5. Tauri benchmark results: https://github.com/tauri-apps/benchmark_results
- S6. wry 0.57.0 WKWebView scheme handler (one complete response per request): https://github.com/tauri-apps/wry/blob/wry-v0.57.0/src/wkwebview/class/url_scheme_handler.rs ; wry issue 1404 "Streaming protocol", open since 28 October 2024: https://github.com/tauri-apps/wry/issues/1404
- S7. AccessKit Windows adapter, implemented UI Automation patterns: https://github.com/AccessKit/accesskit/blob/main/adapters/windows/src/node.rs
- S8. Qt 6.12.0 Windows UI Automation providers: https://github.com/qt/qtbase/tree/v6.12.0/src/plugins/platforms/windows/uiautomation
- S9. iced issue 552 "Implement accessibility support", open since 5 October 2020: https://github.com/iced-rs/iced/issues/552
- S10. egui changelog (0.34, 0.35 and 0.36 in 2026): https://github.com/emilk/egui/blob/main/CHANGELOG.md
- S11. egui_plot issue 18 "Optimize Plot", open since 12 April 2022: https://github.com/emilk/egui_plot/issues/18
- S12. Five-toolkit macOS benchmark (gpui, AppKit, Qt 6, egui, Slint; one author, code not inspected): https://github.com/zed-industries/zed/discussions/63832
- S13. gpui-kit README (Longbridge Pro, data tables, dock, candlestick chart, gpui-pre pins): https://github.com/longbridge/gpui-kit
- S14. Zed issue 41138 "Windows: Screen reader accessibility missing completely", open: https://github.com/zed-industries/zed/issues/41138
- S15. Qt for Small Business (€546 a year per developer): https://www.qt.io/development/qt-for-small-business
- S16. Qt Graphs 6.12 overview and licences: https://doc.qt.io/qt-6/qtgraphs-index.html
- S17. W3C, WCAG2ICT Group Note (11 December 2025): https://www.w3.org/TR/wcag2ict-22/
- S18. NautilusTrader 1.231.0 on PyPI (wheel tags and sizes): https://pypi.org/pypi/nautilus-trader/1.231.0/json
- S19. python-build-standalone release 20261001: https://github.com/astral-sh/python-build-standalone/releases/tag/20261001
- S20. PyO3 0.29.3 guide, building and distribution (embedding): https://pyo3.rs/v0.29.3/building-and-distribution.html
- S21. Tauri security advisories (GHSA-w28w-mhc8-qvjv fixed in 2.11.6; GHSA-7gmj-67g7-phm9 fixed in 2.11.1): https://github.com/tauri-apps/tauri/security/advisories
- S22. Electron security advisories: https://github.com/electron/electron/security/advisories
- S23. Tauri updater plugin (mandatory signatures): https://v2.tauri.app/plugin/updater/
- S24. Apple Developer Program ($99 a year): https://developer.apple.com/programs/enroll/
- S25. Apple, `NSAllowsLocalNetworking`: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
- S26. Apple, How to use the function keys on your Mac: https://support.apple.com/en-us/102439
- S27. GitButler pull request 9482 (reasons for an Electron client): https://github.com/gitbutlerapp/gitbutler/pull/9482
- S28. Wails releases (v3.0.0-beta.27, 1 October 2026) and the Windows response writer: https://github.com/wailsapp/wails/releases and https://github.com/wailsapp/wails/blob/master/v3/internal/assetserver/webview/responsewriter_windows.go
- S29. Electrobun README: https://github.com/blackboardsh/electrobun
- S30. Nuitka licence change, commit 25d9589c (28 January 2026): https://github.com/Nuitka/Nuitka/commit/25d9589c
- S31. Gregory Szorc, "My Shifting Open Source Priorities" (17 March 2024): https://gregoryszorc.com/blog/2024/03/17/my-shifting-open-source-priorities/
- S32. Tauri, Windows installer (WebView2 install modes and sizes): https://v2.tauri.app/distribute/windows-installer/
- S33. MDN browser-compat-data (Safari support for `scrollbar-color` and others): https://github.com/mdn/browser-compat-data
- S34. Tauri issue 12901, NVDA silent in a frameless window, open since 6 March 2025: https://github.com/tauri-apps/tauri/issues/12901
- S35. Rerun changelog, 0.13 fast time series: https://github.com/rerun-io/rerun/blob/main/CHANGELOG.md
- S36. Slint issues 8562 (chart widget, closed as not planned) and 1723 (docking, open since 10 October 2022): https://github.com/slint-ui/slint/issues/8562 and https://github.com/slint-ui/slint/issues/1723
- S37. Dear ImGui README (accessibility not supported): https://github.com/ocornut/imgui
- S38. Joel Spolsky, "Things You Should Never Do, Part I" (Netscape rewrite): https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/
- S39. Lapce releases (0.4.6 on 21 January 2026): https://github.com/lapce/lapce/releases
- S40. Tauri issue 14963 "Bundle chromium renderer", open since 8 November 2023: https://github.com/tauri-apps/tauri/issues/14963
- S41. Apple, Mac keyboard shortcuts (Fn-F11: Show the desktop; checked 2 October 2026): https://support.apple.com/en-us/102650

Local evidence: `docs/desktop/00_inventory_backend.md`, `00_inventory_frontend.md`, `00_spike_webview2.md`, `00_spike_rust.md` (with raw data in `spike_webview2/raw/` and `spike_rust/raw/`), and `research/L1` to `L7`.
