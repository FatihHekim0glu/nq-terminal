# L2: Native UI rewrite for the desktop terminal

Research lens L2 of the desktop migration plan. It asks one question: if the React front end were thrown away and the terminal's screens were redrawn with a native UI toolkit, which toolkit could carry a dense, keyboard-driven, amber-on-black market research terminal on Windows and macOS, and what would it cost?

- Evidence checked: 2 October 2026. Every external claim carries a source in the Sources list at the end (S1, S2, ...). Anything not confirmed from a primary source is marked **unverified**.
- Method: GitHub API (repository metadata, releases, issue trackers, source trees), the crates.io, NuGet and PyPI registry APIs, official documentation and release notes, and a small number of web searches for pricing pages and third-party benchmarks. This lens ran no local apps and took no measurements of its own; numbers on size, memory and frame time come from the cited sources and must be re-measured by the spike step.
- Local facts about the terminal were read from the repository at HEAD `c7f9e61`, read only.
- Scope: the UI layer only. The FastAPI backend, the research gate (`nq_lab.data.serve`) and the Python analytics stay where they are; a native UI would talk to them over the same HTTP and SSE contract. Packaging and signing are lens L4.

## 1. Bottom line

1. **A native rewrite is a rewrite of everything the owner sees, with no code reuse.** The front end is about 77,400 lines of TypeScript and TSX outside tests, vendor and demo code, plus 5,400 lines of CSS, across 25 screen folders that carry the 30 mnemonic functions; its tests are another 73,900 lines in 453 files (measured, section 2). None of that, and none of the 383 browser end-to-end tests, carries over to any toolkit in this lens. The backend, its 2,875 tests and most of the numerical crosscheck do carry over.
2. **Accessibility is the sharpest divider, and it rules out more toolkits than performance does.** WCAG 2.2 applies to desktop software through the W3C WCAG2ICT note (S44). On Windows, Qt 6 ships UI Automation grid and table providers (S20); JUCE does too (S27); Avalonia's DataGrid has automation peers (S31). AccessKit, which every accessible Rust toolkit uses (egui, Slint, gpui, Xilem, Blitz), implements no UIA Grid or Table pattern in its Windows adapter as of 2 October 2026 (S9), so NVDA cannot announce row and column headers in a data grid. iced has had "Implement accessibility support" open since October 2020 (S12) and Dear ImGui says outright that accessibility is not supported (S24). Reaching WCAG 2.2 AA for the grids (success criterion 1.3.1) on Windows with a Rust toolkit means upstream work on AccessKit or a hand-built fallback.
3. **No toolkit ships a finance-grade chart. "Millions of points at 60 fps" is decimation, which we write ourselves in any toolkit.** ImPlot's own FAQ says "tens to hundreds of thousands of points without issue, but don't expect millions to be a buttery smooth experience" (S25). egui_plot has had a 1M to 50M point performance issue open since April 2022 (S6). Slint closed its chart widget request as "not planned" (S16). Qt Graphs in 6.12 is GPL or commercial only and lists no candlestick series (S21). Rerun made egui plots fast by sub-pixel aggregation, 30 to 120 times faster rendering (S8), which is the same min and max per pixel column trick uPlot and lightweight-charts already do for us in the browser. The only toolkit with a candlestick chart in its component kit is gpui through gpui-kit (S14).
4. **Docking and virtualised grids exist for four stacks, pivoting for none.** egui (egui_dock 0.21.1, egui_tiles 0.17.1, egui_table 0.10.0), gpui-kit (serialisable dock layout, virtual table with sorting), Qt (QDockWidget, the LGPL Advanced Docking System) and Avalonia (MIT Dock, MIT DataGrid) cover docking and grids. Slint has no docking widget (request open since October 2022, S17) and iced has only a tiling `pane_grid`. No native toolkit has a pivot grid; the Perspective 5.5.1 engine the terminal already uses is published as a Rust crate (S37), so the pivot engine could be kept and only the pivot grid redrawn.
5. **"Native" does not automatically mean light.** In a third-party macOS bake-off (September 2026, 100,000 rows, 15 runs, one author, S15) gpui, egui, Slint and Qt Widgets all drew a first frame in 150 to 200 ms and peaked at 118 to 215 MiB resident memory; plain AppKit was 124 MiB. A Linux process monitor dropped from about 135 MB with egui on the GPU to about 30 MB with Slint's software renderer (S18): the GPU pipeline and driver, not the widgets, dominate memory. The current web shell is already fast on the owner's budgets (HOME first render 647 ms against 1,500 ms; 8,411 row grid open in 61 ms against 500 ms).
6. **Most Rust toolkits are pre-1.0 and break their API every few months.** egui is at 0.36.2 and has shipped three breaking minor releases in 2026, 0.34, 0.35 and 0.36 (S4); iced 0.14.0 is ten months old with 0.15 in development (S11); gpui is consumed through exact-pinned `gpui-pre` snapshots that "may change GPUI's API" (S14); Xilem is "experimental" (S38); Blitz is "beta" (S36); Floem's last release was November 2024 (S40). Stable, versioned APIs exist in Qt 6, Slint 1.x, Avalonia 12, wxWidgets 3.3 and Dear ImGui.
7. **Licences are mostly a non-issue for a one-owner app, with three traps.** Rust toolkits are MIT or Apache-2.0, except Slint (royalty-free with an attribution duty, GPLv3, or commercial; S16). Qt's core is LGPLv3, which is fine for a dynamically linked app, but Qt Graphs (S21) and KDDockWidgets (S22) are GPL or commercial, and the commercial Qt small business licence is €546 a year per developer (S19). JUCE is AGPLv3 or commercial (S27).
8. **Effort: about 54 to 99 developer weeks for parity, before any upstream accessibility work** (estimate, section 9). That is one to two years for one full-time developer, and every week of it is spent rebuilding what already works.
9. **Verdict for this lens.** If the owner wants a native UI at all, only three toolkits survive all the filters: **Qt 6 Widgets** (best accessibility, stable, but C++ or Python and custom charts), **egui and eframe** (fastest to build in Rust, best plot, dock and table ecosystem, proven on dense data by Rerun, but the Windows grid accessibility gap), and **gpui with gpui-kit** (the closest fit for a trading terminal, used for the shipped Longbridge Pro app, but an unstable API and accessibility that only landed in May 2026). Everything else fails on accessibility, charting, docking or maturity. Section 11 sets out what this means for the plan.

## 2. Project facts that drive the answer

| Fact | Value | How it was obtained |
|---|---|---|
| Front end source, outside tests, vendor and demo | about 77,400 lines of TS and TSX | `wc -l` over `web/src`, read only |
| Front end source including vendor and demo | 79,363 lines in 652 files | same |
| Front end tests | 73,893 lines in 453 test files | same |
| CSS | 5,397 lines | same |
| Screen folders | 25 (`blk`, `corr`, `cost`, `des`, `dq`, `evt`, `expo`, `gp`, `help`, `home`, `jobs`, `layouts`, `ledg`, `live`, `mon`, `oos`, `p2rct`, `reg`, `riskextras`, `roll`, `runs`, `seal`, `seas`, `tear`, `vcone`) serving 30 functions | `ls web/src/screens` |
| UI libraries in use | dockview-react 8.3.1, lightweight-charts 5.2.1, uPlot 1.6.32, ECharts 6.1.0, Perspective 5.5.1 (client, server, viewer, datagrid), TanStack Table 9.2.4 and Virtual 3.14.13, cmdk 1.1.1, React 19.3.0 | `web/package.json` |
| Fonts | PT Mono and Source Sans 3 (Fontsource 5.3.0) | `web/package.json` |
| Chart kinds in the code | candlestick engine with overlays, linked line stacks, and ECharts heatmap, scatter, cone, distribution, bar ladder, swimlane, composition and glyph scatter views; a chart accessibility layer (`ChartA11y`) | `web/src/charts` listing |
| Maths computed in the browser | 833 lines (`quant/linalg`, `normal`, `power`, `cluster`, `trials`) | `web/src/quant` |
| Crosscheck coupling to the browser | `p12_power.py` and `p12_neff.py` pin "the browser's arithmetic" in those TypeScript files through shared golden files | `qa/crosscheck` docstrings |
| Rest of the crosscheck | reads backend dumps only; "never imports the backend" | `qa/crosscheck/dumps.py` |

Three consequences:

- A native UI must re-implement the 833 lines of browser maths in Rust or C++ and keep the P12 golden tests passing against the new code, or move that maths into the backend. Either way the crosscheck must be re-pointed; it is not automatically safe.
- Everything that makes the terminal look and feel like itself (the amber-classic tokens, the look options, the contrast and colour vision tests, the keyboard grammar, the command bar) lives in the front end and is rebuilt from nothing.
- The research gate is not at risk from a UI rewrite as long as the native UI only talks to the existing backend contract. A toolkit that tempted us to read Parquet or Nautilus catalogues directly from the UI process would bypass `nq_lab.data.serve`; that must be forbidden by design.

## 3. What the terminal asks of a toolkit

| Need | What the web stack does today | What a native toolkit must provide |
|---|---|---|
| Time series and candles | uPlot and lightweight-charts on Canvas 2D with decimation; uPlot creates a 166,650 point chart in 25 ms and streams 3,600 points at 60 fps using 10% CPU (S41) | A GPU or fast CPU line renderer, plus our own per-pixel min and max decimation, candles, crosshair, linked cursors and overlays |
| Docking | dockview with saved layouts | Tabbed docking with splits, drag and drop and serialisable layouts |
| Grids | Perspective (WASM) for pivots, TanStack for virtualised monitor and journal grids, 8,411 rows in 61 ms | Virtualised rows and columns, sort, typeahead, CSV; a pivot view |
| Text | Browser text stack with PT Mono and Source Sans 3 | Custom font loading, hinting, kerning, tabular figures, crisp small sizes |
| Theme | CSS tokens, amber-classic theme, look options | Full control over every pixel; native widget looks are a hindrance here |
| Keyboard | F-keys, mnemonics, a keyboard grammar, command bar | Raw key events with both physical and logical key, global shortcuts within the app, focus control |
| Accessibility | WCAG 2.2 AA via the browser accessibility tree | Platform accessibility APIs: UI Automation on Windows, NSAccessibility on macOS, including table semantics |

## 4. Rust toolkits

Registry figures are from the crates.io API on 2 October 2026 (S1); repository figures from the GitHub API on the same day (S2).

### 4.1 egui and eframe

- **Version and status:** egui and eframe 0.36.2, 8 September 2026; 30,790 GitHub stars; MIT or Apache-2.0 (S3, S4). About 5.7 million downloads in the last 90 days, the most used Rust GUI crate by a wide margin (S1). Immediate mode: the UI is a function called every frame, which repaints only on input or on request.
- **Charting:** egui_plot 0.37.0 (S5) draws lines, bars and box plots; candles must be built from box plots or a custom shape (request for K-line charts open since March 2025, S6b). Large data is our problem: issue "Optimize Plot" about 1M to 50M points has been open since April 2022 (S6). Rerun, built on egui, solved it with a query cache and sub-pixel aggregation, quoting 20 to 50 times faster queries and 30 to 120 times faster rendering (S8). For us that means a custom plot widget drawing pre-decimated data through a wgpu callback, which egui supports.
- **Docking:** egui_dock 0.21.1 (tabs, splits, drag tabs out into egui windows; the repository moved to `anhosh/egui_dock`) and egui_tiles 0.17.1 from Rerun (S1, S7). egui itself can open several native windows ("viewports").
- **Grids:** egui_table 0.10.0 and egui_extras `TableBuilder` give virtualised rows; sorting, typeahead and CSV are ours to write (S1).
- **Text:** since 0.34 (March 2026) egui renders fonts with skrifa and vello_cpu and supports hinting; 0.35 added harfrust for kerning and ligatures (S4). Text is grayscale anti-aliased; open issues report blur when layers are zoomed (S6c).
- **Theming:** total control; every pixel is ours. An amber-on-black look is easy.
- **Keyboard and IME:** IME composition was overhauled in 0.35 (S4). Key events carry logical and physical keys through winit.
- **Accessibility:** AccessKit is always on since 0.34 (S4); egui exposes widgets, scroll bars and pressed states. The Windows grid and table gap in section 4.10 applies.
- **Size and memory:** 9.3 MiB binary and 121.7 MiB peak RSS for a 100,000 row test on macOS (S15). The GPU pipeline costs memory; a software renderer cuts it sharply (S18).
- **Verdict:** the most productive Rust choice for a data-dense tool, with a real precedent (Rerun) for fast plots. The price is frequent breaking releases, our own chart engine, and a Windows table accessibility gap.

### 4.2 iced

- **Version and status:** 0.14.0, 7 December 2025, MIT, 31,637 stars; 0.15.0 in development (S10, S11). Elm-style architecture.
- **Charting:** a `canvas` widget and a custom shader widget; no maintained chart crate in the iced organisation (**unverified** beyond the iced_aw widget list).
- **Docking:** `pane_grid` (tiling splits). No tabbed docking in core.
- **Grids:** 0.14 added `table` and `grid` widgets (S11).
- **Keyboard and IME:** input method support arrived in 0.14 (S11).
- **Accessibility:** none. "Implement accessibility support" is open since 5 October 2020 (S12) and iced's `Cargo.toml` has no AccessKit dependency (S11b). System76's iced fork for COSMIC has AccessKit work in progress, but as of September 2026 its text input still "contributes nothing to the accessibility tree" (S13).
- **Verdict:** rejected. It cannot reach WCAG 2.2 AA today.

### 4.3 Slint

- **Version and status:** 1.18.1, 21 September 2026, 24,034 stars, stable 1.x API (S16b). Declarative `.slint` markup compiled to Rust, C++, JavaScript or Python.
- **Licence:** Royalty-free licence for desktop apps if you show that you use Slint (for example an About Slint badge); GPLv3; or commercial, with Startup and Individual, Small Enterprise and Enterprise tiers whose prices are only shown at checkout (S16, S16c, prices **unverified**).
- **Charting:** no chart widget; the request was closed as "not planned" and users are pointed to rendering plotters output into an image (S16). That is a CPU raster per frame, not a 60 fps path for millions of points.
- **Docking:** none; "Docking widgets" open since 10 October 2022 (S17).
- **Grids:** `StandardTableView` built on the `ListView` optimisation (S16b).
- **Text and rendering:** fontique and parley for text; Skia, FemtoVG and software renderers, plus an experimental Vello renderer added in 1.18 (S16b).
- **Accessibility:** AccessKit on the winit backend, or Qt's accessibility on the Qt backend (S16d). 1.18 exposed text input content and selection to assistive technology (S16b).
- **Size and memory:** 9.1 MiB binary, 117.6 MiB peak RSS in the bake-off (S15); about 30 MB for a whole process monitor with the software renderer (S18).
- **Verdict:** the most polished stable Rust toolkit for forms and embedded screens, but no charts and no docking. We would write both. Not a good fit for a terminal.

### 4.4 gpui and gpui-kit

- **What it is:** gpui is the GPU UI framework inside the Zed editor (Apache-2.0, S14b). It draws with Metal on macOS and DirectX 11 with DirectWrite text on Windows; Zed for Windows reached general availability on 15 October 2025 (S14c). gpui-kit (formerly gpui-component) by Longbridge adds 75+ components, Apache-2.0, 15,513 stars, 0.7.0 released 28 September 2026 (S14).
- **Fit for a trading terminal:** gpui-kit states it was used "to build Longbridge Pro from day one", a shipped commercial trading app (S14). It lists data tables with virtual scrolling, fixed and resizable columns, sorting and cell selection "across hundreds of thousands of rows", a serialisable dock layout, and charts including a `candlestick_chart` module (S14, source tree).
- **Performance:** in the bake-off gpui had the fastest first frame (152.5 ms median), the best p99 scroll frame of the cross-platform toolkits (8.29 ms) and a 3.8 MiB standalone binary, with 125.5 MiB peak RSS (S15). One author, one Mac; treat as indicative.
- **API stability:** poor. The crates.io `gpui` crate is still 0.2.2 from October 2025 (S1); real users depend on `gpui-pre` snapshots pinned with `=`, and gpui-kit's manifest warns that "any snapshot may change GPUI's API" (S14).
- **Accessibility:** AccessKit support was merged into gpui on 27 May 2026 (S14d), with follow-ups for landmarks, menus and identifiers in July and August 2026 (S14e). Zed's own issue "Windows: Screen reader accessibility missing completely" is still open (S14f). gpui-kit claims AccessKit roles, names and states covered by tests (S14). The AccessKit table gap applies.
- **Verdict:** the closest match to what we want to build, and the only one with a finance precedent. The risks are API churn on every snapshot, thin documentation, and accessibility that is months old.

### 4.5 Dioxus and Blitz

- Dioxus 0.7.10 (July 2026, Apache-2.0 or MIT, S1, S2) is React-like Rust. Its desktop renderer is a system web view, which puts it in the same family as Tauri and outside this lens.
- Dioxus Native renders through **Blitz**, a Rust HTML and CSS engine (Stylo, Taffy, Vello, AccessKit). Blitz says it is "currently in a **beta** state ... there are also still many bugs and missing features" (S36). blitz-dom 0.2.4, August 2026 (S1).
- It would not run our React code or our charting libraries; only the HTML and CSS ideas carry over. **Verdict:** interesting to watch, too early to bet on.

### 4.6 Xilem and Masonry

- xilem and masonry 0.4.0, 29 October 2025 (S1); the README calls it "an experimental high-level architecture" with AccessKit and Vello underneath (S38). About 2,500 downloads in 90 days. **Verdict:** research project; rejected.

### 4.7 Makepad

- MIT, 7,112 stars; makepad-widgets 1.0.0 on crates.io (May 2025) while the development branch carries 2.0.0 (S1, S39). Its own shader-based styling language. An "On Accessibility" issue is open (last updated August 2025) and no AccessKit integration was found (S39b). **Verdict:** rejected on accessibility.

### 4.8 Floem

- 0.2.0, 15 November 2024; README: "still maturing. We will make occasional breaking changes" (S40). Built for the Lapce editor. **Verdict:** rejected on maturity.

### 4.9 Vello and wgpu (renderers, not toolkits)

- wgpu 30.0.1 (22 August 2026) runs on Vulkan, Metal, D3D12 and OpenGL (S42). It is what egui, iced and parts of Slint draw through, and it is the right layer for a custom chart renderer in any Rust toolkit.
- Vello 0.10.0 (14 August 2026) now ships three renderers: vello_cpu ("the most mature choice"), vello_gpu (intended to become the production GPU renderer "as it matures"), and the original compute renderer, which "remains an experimental implementation" (S43). Useful for crisp vector drawing; not needed to draw candles and lines.

### 4.10 AccessKit, the shared accessibility layer

- accesskit 0.25.1 (25 September 2026), MIT or Apache-2.0 (S9b). Adapters for Windows (UI Automation), macOS (NSAccessibility), Unix (AT-SPI), Android and iOS; the README says the adapters "don't yet support all types of UI elements" and "don't yet support rich text or hypertext" (S9b).
- **The table gap, read from source on 2 October 2026:** the Windows adapter maps `Role::Grid` and `Role::Table` to the UIA DataGrid and Table control types, but the only control patterns it implements are ExpandCollapse, Invoke, RangeValue, ScrollItem, SelectionItem, Selection, Text, Toggle, Value and Window (S9). There is no `GridPattern`, `GridItemPattern`, `TablePattern` or `TableItemPattern`, so a screen reader cannot ask a cell for its row, column or headers. Qt's Windows plugin has all four (S20).
- This matters because the terminal is mostly grids. Under WCAG2ICT, success criterion 1.3.1 for desktop software is met "by using the accessibility services of platform software" (S44); a grid whose headers are not programmatically related to its cells fails it.

## 5. C and C++ toolkits

### 5.1 Qt 6 (Widgets and QML), and PySide6

- **Version:** Qt 6.12.0 tagged 30 September 2026 (S20b). PySide6 6.11.2 on PyPI, LGPL-3.0 or GPL (S23).
- **Licence and cost:** core modules LGPLv3 or GPL or commercial. Qt Graphs is "Commercial licenses ... GNU General Public License, version 3", not LGPL (S21); Qt Charts is marked obsolete in favour of Qt Graphs (S21b). Qt for Small Business costs **€546 a year** per developer for Application Development, for companies with at most €1 million revenue or funding, at most three such licences (S19). For one owner who does not distribute the app, GPL obligations do not bite; if the app is ever shared, the GPL modules need care.
- **Charting:** Qt Graphs 2D lists area, bar, donut, line, pie, scatter and spline, no candlesticks (S21). Realistic options are a custom QPainter or QRhi item with our decimation, Qwt 6.3 (LGPL 2.1 with static linking and subclassing exceptions, S26), QCustomPlot (GPL or commercial, **unverified** here), or in PySide6 the MIT pyqtgraph 0.14.0 (S23b).
- **Docking:** QDockWidget built in; the Qt Advanced Docking System (LGPL-2.1, 2,535 stars, S22b); KDDockWidgets (GPL 2.0 or 3.0, commercial on request, S22).
- **Grids:** QTableView with a custom model is virtualised by design and sorts through QSortFilterProxyModel; Qt has no pivot grid.
- **Text:** platform font back ends; custom fonts load through QFontDatabase. Hinting quality per platform was not checked (**unverified**).
- **Theming:** Qt Widgets fights a fully custom look: style sheets are limited and a custom QStyle or QProxyStyle is a real piece of work; QML and Qt Quick are easier to skin but need Qt Quick Controls styling.
- **Accessibility:** the strongest of all cross-platform options. On Windows Qt implements UIA Grid, GridItem, Table, TableItem, Text, Selection and other providers (S20); on macOS it has a Cocoa accessibility bridge (S20). Both Qt Widgets and Qt Quick are covered (S20c).
- **Size and memory:** Qt Widgets had the highest peak RSS in the bake-off (214.5 MiB) and needs more than 22 MiB of Qt runtime beside the binary (S15).
- **PySide6 note:** Qt for Python would let the UI run in the same language as the backend, even in the same process as `nq_terminal`, and keep the browser maths in Python next to the crosscheck. It is not "light and fast" in the owner's sense, but it is the lowest-risk native route for correctness.
- **Verdict:** the safe native choice for accessibility and maturity. The costs are C++ or Python, a custom chart, and work to get the amber look.

### 5.2 Dear ImGui with ImPlot

- Dear ImGui 1.92.9b (31 July 2026), MIT, 76,453 stars; docking lives on the separate `docking` branch (last commit 25 September 2026) (S24). ImPlot 1.0 (5 April 2026), MIT, with candlestick and heat map demos (S25).
- ImPlot's FAQ: "You can plot tens to hundreds of thousands of points without issue, but don't expect millions to be a buttery smooth experience" (S25).
- Accessibility: the README says "full internationalization (right-to-left text, bidirectional text, text shaping etc.) and accessibility features are not supported" (S24). Requests are open (S24b).
- **Verdict:** superb for an internal debug tool, rejected for this terminal: it cannot meet WCAG 2.2 AA.

### 5.3 JUCE

- JUCE 9.0.3 (28 September 2026), dual AGPLv3 or commercial JUCE 9 licence (S27). Built for audio plug-ins. It does have real accessibility, including UIA grid item providers on Windows (S27b). No docking or charting of note. **Verdict:** wrong domain; one line is enough.

### 5.4 wxWidgets

- wxWidgets 3.3.3 (7 July 2026), wxWindows Library Licence (LGPL with a binary exception) (S28). It wraps native controls, so accessibility comes largely from the platform, and wxAUI provides docking. The native look is exactly what the amber terminal does not want, and charting is custom. **Verdict:** rejected on look and charting.

## 6. Others worth a line

- **Flutter 3.47.6** (stable, 1 October 2026, BSD-3-Clause, S29). Canonical became lead maintainer of Flutter desktop in May 2026 (S29b). Multi-window support was still behind an experimental flag on the main channel as of August 2026 (S29c; status in 3.47 **unverified**). Desktop accessibility goes through its semantics tree (**unverified** for Windows table semantics). Dart, its own renderer, no first-party docking or pivot grid. Not lighter than a web view in practice (**unverified**, no measurement).
- **Avalonia 12.1.3** (22 September 2026), MIT (S30). The DataGrid is MIT and has UIA automation peers for the grid, rows, cells and column headers (S31). Dock is MIT (S32); ScottPlot 5.1.59 (MIT) has an Avalonia control and Signal plots "with millions of data points" (S33). TreeDataGrid development moved to the commercial Avalonia Accelerate, while the framework stays MIT (S34). C# and .NET, so not "Rust or C", but the most complete non-web stack in this list after Qt.
- **Compose Multiplatform 1.12.1** (22 September 2026), Apache-2.0 (S35). JVM on desktop; on Windows accessibility needs the Java Access Bridge, which is "disabled by default" (S35b). No docking or charts in the box.
- **SwiftUI plus WinUI 3, two native apps.** Best platform citizenship and accessibility, but two complete front ends in two languages to keep in step, which doubles the effort in section 9. Swift Charts gained vectorised plots for large data sets in 2024 (S45). On Windows the WinUI 3 DataGrid lives in the old Community Toolkit, whose `CommunityToolkit.WinUI.UI.Controls.DataGrid` package was last released as 7.1.2 on 18 November 2021 (S46). Windows App SDK is at 1.8.12 (S47). **Verdict:** rejected for a one-owner project.

## 7. Comparison matrix

Ratings are this lens's judgement from the evidence above. "Own work" means the toolkit gives a drawing surface and we build the feature.

| Toolkit | Charts (millions, candles) | Docking | Virtual grid and sort | Pivot | A11y on Windows | A11y on macOS | API stability | Licence | Binary and RSS (S15) |
|---|---|---|---|---|---|---|---|---|---|
| egui and eframe 0.36 | Own work on egui_plot or wgpu | Yes (egui_dock, egui_tiles) | Yes (egui_table), sort is own work | Own work | Partial: no grid or table patterns | Partial | Breaks each minor | MIT or Apache | 9.3 MiB, 122 MiB |
| iced 0.14 | Own work | Tiling only | Basic `table` | Own work | None | None | Breaks each minor | MIT | not measured |
| Slint 1.18 | Own work, no GPU chart path | None | `StandardTableView` | Own work | Partial (AccessKit) | Partial | Stable 1.x | Royalty-free with badge, GPLv3, commercial | 9.1 MiB, 118 MiB |
| gpui with gpui-kit 0.7 | Candlestick and line charts in kit | Yes, serialisable | Yes, sort built in | Own work | Partial, new (May 2026) | Partial, new | Snapshot pins, unstable | Apache-2.0 | 3.8 MiB, 126 MiB |
| Dioxus Native and Blitz | Own work | Own work | Own work | Own work | Partial (AccessKit) | Partial | Beta | Apache or MIT | not measured |
| Xilem, Makepad, Floem | Own work | Own work | Own work | Own work | Partial or none | Partial or none | Experimental | MIT or Apache | not measured |
| Qt 6 Widgets or QML | Own work or Qwt, Qt Graphs is GPL and has no candles | Yes (QDockWidget, ADS) | Yes (QTableView) | Own work | Good: grid and table providers | Good | Stable | LGPLv3, some GPL modules, €546 a year commercial small business | 0.1 MiB plus 22 MiB runtime, 215 MiB |
| Dear ImGui with ImPlot | Candles yes, millions no | Docking branch | Yes (tables) | Own work | None | None | Stable | MIT | not measured |
| Avalonia 12 | ScottPlot, millions claimed | Yes (Dock) | Yes (DataGrid) | Own work | Good (automation peers) | Good | Stable | MIT | not measured |
| Flutter 3.47 | Third-party | Third-party | Third-party | None | Partial | Partial | Stable, multi-window experimental | BSD-3 | not measured |

## 8. Cross-cutting findings

### 8.1 Charting: decimation is the work, whichever toolkit

- Drawing a million line segments every frame is wasteful on any GPU; every fast plotter reduces each pixel column to its first, last, minimum and maximum before drawing. Rerun's 30 to 120 times rendering gain came from exactly that (S8); uPlot's speed comes from Canvas 2D plus the same idea (S41).
- So the chart engine is the same job in egui, gpui, Qt or Avalonia: a decimation pass over columnar arrays, a GPU or fast CPU line and quad pass, candles as instanced quads, a crosshair and linked cursors, and the overlays the terminal already has. That is weeks of work (section 9), and it must be built test-first against the existing engine's behaviour (`CandleChart.engine.ts`, `LineStack.*`).
- What is not available natively at all: the long tail of ECharts views the terminal uses (heatmaps, cones, distributions, swimlanes and so on). Each is a custom widget.

### 8.2 Accessibility and WCAG 2.2 AA

| WCAG 2.2 AA criterion | Risk in a self-drawn toolkit | Notes |
|---|---|---|
| 1.3.1 Info and Relationships | **High** on Windows with AccessKit | No UIA grid or table patterns (S9); Qt, Avalonia and JUCE have them |
| 4.1.2 Name, Role, Value | Medium | Every custom widget (chart, grid cell, dock tab) needs a node, role, name and value written by hand |
| 2.1.1 Keyboard, 2.4.3 Focus Order, 2.4.7 Focus Visible | Low to medium | Self-drawn toolkits give full control, but focus order and focus rings are our code |
| 2.4.11 Focus Not Obscured (new in 2.2) | Medium | Docked panels and floating windows can hide the focused item; must be tested |
| 1.4.3 and 1.4.11 Contrast | Low | Our tokens and contrast tests carry over as data |
| 1.4.4 Resize Text | Medium | Must follow OS scaling and offer an in-app zoom; egui and gpui support a scale factor |
| 2.5.8 Target Size (new in 2.2) | Low | Dense terminal targets already have to meet the 24 by 24 px minimum or its spacing exception |
| Charts (1.1.1 Non-text Content) | Medium | `ChartA11y` text summaries must be rebuilt as accessible nodes |

The current accessibility proof (browser accessibility tree checks in Playwright and vitest) has no drop-in native equivalent. egui_kittest (0.36.2) and gpui-kit's headless UI tests drive the AccessKit tree (S4, S14), which is good for regression tests, but real checks need NVDA on Windows and VoiceOver on macOS, by hand.

### 8.3 Text and the amber look

- A self-drawn toolkit (egui, gpui, Slint, Qt Quick) makes the Bloomberg-style look easy, because nothing is a native control. Native-control toolkits (wxWidgets, WinUI, SwiftUI, and to a degree Qt Widgets) make it hard.
- Fonts: PT Mono and Source Sans 3 can be bundled as TTF files in all of them. egui gained hinting in 0.34 and shaping in 0.35 (S4); gpui uses DirectWrite, the platform text stack, on Windows (S14c); its macOS text path was not checked (**unverified**). Small-size crispness on a 100% scaled Windows monitor must be checked by eye in the spike, because egui's text is grayscale anti-aliased and has open blur issues (S6c).

### 8.4 Keyboard grammar and F-keys

- All shortlisted toolkits deliver raw key events with modifiers, and winit-based toolkits give both logical and physical keys, which matters for mnemonics on non-US layouts. The owner's keyboard layout is not known (open question).
- Function keys are free in all toolkits; there is no browser reserving F5, F11 or Ctrl+W, which is a small win for a native UI.

### 8.5 Size and memory, read with care

| Toolkit (bake-off, macOS, M4 Max, 100,000 rows) | First frame median | Scroll p99 | Peak RSS | Binary |
|---|---|---|---|---|
| AppKit | 155.1 ms | 7.87 ms | 124.3 MiB | 0.5 MiB |
| gpui 0.2.2 | 152.5 ms | 8.29 ms | 125.5 MiB | 3.8 MiB |
| egui with wgpu | 158.1 ms | 11.68 ms | 121.7 MiB | 9.3 MiB |
| Slint with FemtoVG | 190.2 ms | 13.82 ms | 117.6 MiB | 9.1 MiB |
| Qt 6 Widgets | 201.8 ms | 10.93 ms | 214.5 MiB | 0.1 MiB plus over 22 MiB runtime |

Source: S15, a single author's GitHub discussion; the code was not inspected and Windows was not measured. Two lessons: native toolkits are close to each other, and memory is dominated by the graphics stack (S18). Whether native is materially lighter than a WebView2 or WKWebView shell for this app must be measured in the spike, not assumed.

### 8.6 Tests and the crosscheck

- What survives: backend pytest (about 2,875), the crosscheck checks that read backend dumps, the perf budgets as targets, the real-data smoke against the backend.
- What is lost and must be rebuilt: about 6,925 vitest tests and 383 Playwright end-to-end tests, the gallery pages, and the perf harness. Native replacements exist (egui_kittest, gpui-kit's headless window tests, Qt Test), but they are new code.
- What must be re-pointed: the P12 crosscheck that pins the browser's arithmetic (`normal`, `power`, `linalg`, `cluster`, `trials`). The safest move is to put that maths in the backend before any UI rewrite, so the crosscheck checks one implementation.

## 9. Rewrite effort for about 30 screens

Assumptions: one experienced developer, full time, working with the existing automated build runs; the backend contract does not change; parity with today's terminal, not new features. These are estimates by component, not measurements, and should be recalibrated after the spike ports one real screen.

| Work package | egui or gpui (weeks) | Qt 6 (weeks) | Notes |
|---|---|---|---|
| App shell: window, docking with saved layouts, command bar, F-keys, keyboard grammar, mnemonic router | 4 to 6 | 3 to 5 | Qt has docking built in |
| Theme tokens, amber-classic, look options, contrast tests | 2 to 3 | 3 to 4 | Qt Widgets styling is harder |
| Data layer: HTTP and SSE client, caching, typed contract | 2 to 4 | 2 to 4 | |
| Candlestick engine with overlays and decimation | 4 to 6 | 4 to 6 | gpui-kit's candlestick chart may shorten this |
| Linked line stacks (uPlot replacement) | 3 to 5 | 3 to 5 | |
| ECharts views (heatmap, cone, distribution, swimlane and others) | 5 to 8 | 5 to 8 | each is a custom widget |
| Monitor and journal grids: virtualised, sort, typeahead, CSV | 3 to 5 | 2 to 4 | QTableView does more for free |
| Pivot view on the Perspective engine (Rust crate) or a backend pivot | 4 to 8 | 4 to 8 | or drop pivots from the native build |
| 30 screens at 3 to 6 days each once the parts exist | 18 to 36 | 18 to 36 | |
| Browser maths port or move to backend, with golden tests | 1 to 2 | 1 to 2 | |
| Accessibility pass: names, roles, focus order, chart summaries, NVDA and VoiceOver checks | 4 to 8 | 3 to 5 | plus 4 to 8 weeks of AccessKit table work for Rust if 1.3.1 must pass on Windows |
| Test harness: unit, UI snapshot, end-to-end, perf budgets | 4 to 8 | 4 to 8 | |
| **Total** | **54 to 99** | **52 to 95** | about 12 to 23 months either way |

Learning curve, as judgement: egui is the gentlest Rust toolkit (plain Rust, no macros or markup); gpui asks for its entity and context model and has thin documentation; Qt in C++ is large but has decades of documentation; PySide6 keeps the whole terminal in one language the owner already uses. Hiring was not researched in numbers; for a one-owner project it matters less than the volume of public examples, where Qt and egui lead.

## 10. Risks and known issues

| Risk | Where | Evidence | Mitigation |
|---|---|---|---|
| Grid accessibility fails WCAG 1.3.1 on Windows | All AccessKit toolkits | No UIA grid or table patterns (S9) | Choose Qt or Avalonia, or fund AccessKit work, or provide an accessible list fallback |
| API churn breaks the build every few months | egui, iced, gpui | egui 0.34, 0.35 and 0.36 all in 2026 (S4); gpui exact snapshot pins (S14) | Pin versions; upgrade on a schedule; keep UI code thin |
| No screen reader at all | iced, Dear ImGui, Makepad | S12, S24, S39b | Excluded |
| Chart performance below today's | Any toolkit | ImPlot FAQ (S25); egui_plot #18 (S6) | Write decimation first, with perf budgets from day one |
| GPL modules slip in | Qt Graphs, KDDockWidgets | S21, S22 | Use LGPL ADS and a custom chart, or accept GPL for a private app |
| Memory not lower than the web shell | GPU toolkits | S15, S18 | Measure in the spike before committing |
| Browser maths drift from the crosscheck | Any rewrite | `qa/crosscheck/p12_*` | Move the maths to the backend first |
| Effort runs long and the web terminal keeps moving | Any rewrite | Section 9 | Do not run two front ends in parallel for long |

## 11. What this means for the nq-lab terminal

1. **A full native UI rewrite is the most expensive way to get a desktop app, and it buys less than it seems.** It costs one to two years of rebuilding, throws away about 150,000 lines of working front end and tests, and puts accessibility, the amber look and the browser-side crosscheck at risk. The measured speed of the web front end is already well inside its budgets.
2. **If the owner still wants a native UI, the shortlist is three:** Qt 6 (C++ or PySide6) when accessibility and stability come first; egui and eframe when Rust and build speed come first; gpui with gpui-kit when the trading-terminal fit and raw performance come first and API churn is acceptable. Slint, iced, Dear ImGui, the experimental Rust toolkits, Flutter, Compose, JUCE, wxWidgets and two separate native apps are out.
3. **The better use of a native toolkit here is narrow:** a native shell around the existing web UI (lens L1), and if any one view proves too slow in a web view, a native chart surface for that view alone. That keeps the 30 screens, the tests, the look and WCAG 2.2 AA, and spends native effort where it shows.
4. **Before any native UI work, move the browser maths (`web/src/quant`) into the backend** so the crosscheck checks one implementation whatever the front end becomes.
5. **The spike should measure, not trust:** a hidden-window egui or gpui chart of one million decimated points and an 8,411 row grid, against the same budgets the web terminal meets today, plus NVDA on a native grid. If the native build is not clearly lighter and faster on the owner's machines, the rewrite case falls.

## 12. Open questions

- Q1. Does the owner need WCAG 2.2 AA on the desktop app, or only on the web build? This decides whether AccessKit toolkits are acceptable.
- Q2. Will the app ever be distributed to anyone else? This decides whether GPL modules (Qt Graphs, KDDockWidgets) and Slint's attribution duty matter.
- Q3. Which keyboard layout does the owner use on each machine? Mnemonics and the keyboard grammar depend on physical versus logical keys.
- Q4. Is Rust a requirement or a preference? PySide6 is the lowest-risk native route but is Python, not Rust or C.
- Q5. Are pivots needed in a desktop build, or can they stay web only?
- Q6. The bake-off numbers (S15) are macOS only and from one author; Windows numbers for egui, gpui and Qt are unknown until the spike.
- Q7. Flutter's multi-window status in 3.47 and Slint's commercial prices were not confirmed from primary sources.

## Sources

All checked on 2 October 2026 unless a date is given.

- S1. crates.io API, crate records for egui, eframe, egui_dock, egui_plot, egui_extras, egui_table, egui_tiles, egui_kittest, iced, slint, gpui, gpui-pre, gpui-kit, gpui-component, dioxus, blitz-dom, xilem, masonry, vello, wgpu, makepad-widgets, floem, accesskit, perspective: https://crates.io/api/v1/crates/egui (and the same path per crate)
- S2. GitHub API, repository metadata (stars, licence, last push): https://api.github.com/repos/emilk/egui (and the same path per repository named in this document)
- S3. egui repository: https://github.com/emilk/egui
- S4. egui changelog (0.34 skrifa and hinting, 0.35 harfrust and IME, AccessKit always on): https://github.com/emilk/egui/blob/main/CHANGELOG.md
- S5. egui_plot repository and 0.37.0 release: https://github.com/emilk/egui_plot
- S6. egui_plot issue 18, "Optimize Plot" (1M to 50M points, opened 12 April 2022): https://github.com/emilk/egui_plot/issues/18
- S6b. egui_plot issue 84, K-line chart request: https://github.com/emilk/egui_plot/issues/84
- S6c. egui issues 4813 "Zoomed layers result in blurry text" and 7268 "Multisampling blurs text": https://github.com/emilk/egui/issues/4813 and https://github.com/emilk/egui/issues/7268
- S7. egui_dock README (now at anhosh/egui_dock): https://github.com/anhosh/egui_dock
- S8. Rerun 0.13.0 release notes, fast time series (12 February 2024): https://github.com/rerun-io/rerun/blob/main/CHANGELOG.md and https://rerun.io/blog/fast-plots
- S9. AccessKit Windows adapter source, implemented UIA patterns: https://github.com/AccessKit/accesskit/blob/main/adapters/windows/src/node.rs
- S9b. AccessKit README and accesskit 0.25.1: https://github.com/AccessKit/accesskit
- S10. iced repository and 0.14.0 release: https://github.com/iced-rs/iced/releases/tag/0.14.0
- S11. iced changelog (0.14 table, grid, input methods): https://github.com/iced-rs/iced/blob/master/CHANGELOG.md
- S11b. iced workspace manifest (0.15.0-dev, no AccessKit): https://github.com/iced-rs/iced/blob/master/Cargo.toml
- S12. iced issue 552, "Implement accessibility support" (opened 5 October 2020): https://github.com/iced-rs/iced/issues/552
- S13. libcosmic issue 1429, text input emits no accessibility nodes: https://github.com/pop-os/libcosmic/issues/1429
- S14. gpui-kit README and manifest (Longbridge Pro, data tables, dock, AccessKit, gpui-pre pins): https://github.com/longbridge/gpui-kit
- S14b. gpui crate manifest (Apache-2.0): https://github.com/zed-industries/zed/blob/main/crates/gpui/Cargo.toml
- S14c. Zed blog, "Zed for Windows is here" (15 October 2025; DirectX 11, DirectWrite): https://zed.dev/blog/zed-for-windows-is-here
- S14d. Zed pull request 56065, "gpui: Accesskit support" (merged 27 May 2026): https://github.com/zed-industries/zed/pull/56065
- S14e. Zed pull requests 60397 (merged 13 July 2026) and 61926 (merged 7 August 2026): https://github.com/zed-industries/zed/pull/60397 and https://github.com/zed-industries/zed/pull/61926
- S14f. Zed issue 41138, "Windows: Screen reader accessibility missing completely": https://github.com/zed-industries/zed/issues/41138
- S15. "5-Toolkit GUI Bake-Off (GPUI vs. AppKit vs. Qt 6 vs. egui vs. Slint)", Zed discussion 63832 (6 September 2026, one author, code not inspected): https://github.com/zed-industries/zed/discussions/63832
- S16. Slint issue 8562, chart widget, closed as not planned: https://github.com/slint-ui/slint/issues/8562
- S16b. Slint changelog (1.18.0 and 1.18.1): https://github.com/slint-ui/slint/blob/master/CHANGELOG.md
- S16c. Slint licence file and pricing page: https://github.com/slint-ui/slint/blob/master/LICENSE.md and https://slint.dev/pricing
- S16d. Slint winit backend manifest (AccessKit feature): https://github.com/slint-ui/slint/blob/master/internal/backends/winit/Cargo.toml
- S17. Slint issue 1723, "Docking widgets" (opened 10 October 2022): https://github.com/slint-ui/slint/issues/1723
- S18. Trystan Sarrade, "How I took my Rust GUI from 135 MB to 30 MB by ditching the GPU" (3 June 2026, Linux): https://trystan-sarrade.com/article/rust-gui-135mb-to-30mb-egui-to-slint/
- S19. Qt for Small Business: https://www.qt.io/development/qt-for-small-business
- S20. Qt 6.12.0 Windows UI Automation providers and Cocoa accessibility sources: https://github.com/qt/qtbase/tree/v6.12.0/src/plugins/platforms/windows/uiautomation and https://github.com/qt/qtbase/tree/v6.12.0/src/plugins/platforms/cocoa
- S20b. qtbase tag v6.12.0 (30 September 2026): https://github.com/qt/qtbase/releases/tag/v6.12.0
- S20c. Qt 6 accessibility overview: https://doc.qt.io/qt-6/accessible.html
- S21. Qt Graphs 6.12 overview and licences: https://doc.qt.io/qt-6/qtgraphs-index.html
- S21b. Qt 6 modules list (Qt Charts obsolete): https://doc.qt.io/qt-6/qtmodules.html
- S22. KDDockWidgets README, licensing: https://github.com/KDAB/KDDockWidgets
- S22b. Qt Advanced Docking System: https://github.com/githubuser0xFFFF/Qt-Advanced-Docking-System
- S23. PySide6 on PyPI: https://pypi.org/project/PySide6/
- S23b. pyqtgraph on PyPI: https://pypi.org/project/pyqtgraph/
- S24. Dear ImGui README and releases: https://github.com/ocornut/imgui
- S24b. Dear ImGui issues 8022 and 5833 on accessibility: https://github.com/ocornut/imgui/issues/8022 and https://github.com/ocornut/imgui/issues/5833
- S25. ImPlot README and FAQ: https://github.com/epezent/implot
- S26. Qwt licence: https://qwt.sourceforge.io/qwtlicense.html
- S27. JUCE licence file and 9.0.3 release: https://github.com/juce-framework/JUCE/blob/master/LICENSE.md
- S27b. JUCE accessibility sources (UIA providers): https://github.com/juce-framework/JUCE/tree/master/modules/juce_gui_basics/native/accessibility
- S28. wxWidgets licence and 3.3.3 release: https://github.com/wxWidgets/wxWidgets/blob/master/docs/licence.txt
- S29. Flutter release index (3.47.6 stable, 1 October 2026): https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json
- S29b. OMG! Ubuntu, Canonical takes over Flutter desktop (May 2026): https://www.omgubuntu.co.uk/2026/05/flutter-desktop-canonical-maintained
- S29c. Start Debugging, multi-window in a Flutter desktop app (August 2026, secondary source): https://startdebugging.net/2026/08/how-to-enable-multi-window-support-in-a-flutter-desktop-app/
- S30. Avalonia repository and 12.1.3 release: https://github.com/AvaloniaUI/Avalonia
- S31. Avalonia DataGrid automation peers: https://github.com/AvaloniaUI/Avalonia.Controls.DataGrid/tree/master/src/Avalonia.Controls.DataGrid/Automation/Peers
- S32. Dock for Avalonia: https://github.com/wieslawsoltes/Dock
- S33. ScottPlot 5 cookbook, Signal plots: https://scottplot.net/cookbook/5/Signal/
- S34. Avalonia blog, Accelerate licensing changes: https://avaloniaui.net/blog/building-a-sustainable-future-for-avalonia and https://github.com/AvaloniaUI/Avalonia/discussions/19804
- S35. Compose Multiplatform 1.12.1 release: https://github.com/JetBrains/compose-multiplatform/releases
- S35b. Compose Multiplatform desktop accessibility: https://kotlinlang.org/docs/multiplatform/compose-desktop-accessibility.html
- S36. Blitz README, status: https://github.com/DioxusLabs/blitz
- S37. Perspective 5.5.1 on crates.io: https://crates.io/crates/perspective
- S38. Xilem README: https://github.com/linebender/xilem
- S39. Makepad repository: https://github.com/makepad/makepad
- S39b. Makepad issue 196, "On Accessibility": https://github.com/makepad/makepad/issues/196
- S40. Floem README and 0.2.0 release: https://github.com/lapce/floem
- S41. uPlot README, performance: https://github.com/leeoniya/uPlot
- S42. wgpu README and v30.0.1 release: https://github.com/gfx-rs/wgpu
- S43. Vello README, renderer status: https://github.com/linebender/vello
- S44. W3C, WCAG2ICT Group Note (11 December 2025): https://www.w3.org/TR/wcag2ict-22/
- S45. Apple WWDC24 session 10155, "Swift Charts: Vectorized and function plots": https://developer.apple.com/videos/play/wwdc2024/10155/
- S46. NuGet, CommunityToolkit.WinUI.UI.Controls.DataGrid versions (7.1.2, 18 November 2021): https://www.nuget.org/packages/CommunityToolkit.WinUI.UI.Controls.DataGrid
- S47. Windows App SDK releases (v1.8.12): https://github.com/microsoft/WindowsAppSDK/releases
