# Spike 00: Rust on this machine, a Tauri shell and a native chart

Date run: 2 October 2026 (01:15 to 02:00, UK time). Repository: `nq-lab/terminal`, HEAD `c7f9e61` (v2). The scripts and source are in `docs/desktop/spike_rust/`, with the raw output (see the last section). Everything here was measured on one Windows 11 machine. Nothing was measured on a Mac.

## What this spike answers

The owner wants the terminal as a Mac and Windows app that is light and fast, with Rust or a C-family language if that helps. Two different routes sit behind that wish, and this spike puts a number on each:

1. **A Rust shell around the web page (Tauri 2).** The window and the process are Rust. The page, with all its charts and grids, still runs in the system web engine (WebView2 on Windows). Question: what does the shell cost, and what does it change?
2. **A native Rust interface (egui through eframe, with egui_plot and egui_extras).** No web engine at all. Question: does a native chart with a million points and a virtualised 8,411-row table with sorting come out light and fast, and what does it need to get there?

## Short answers

1. **The Rust toolchain installs without admin on drive D:.** rustc 1.99.0 and cargo 1.99.0 on the `x86_64-pc-windows-gnu` host, plus a MinGW-w64 compiler kit (GCC 16.2.0) that was needed alongside it. About 4.9 GB on D:, nothing on C: apart from a directory link (section "Toolchain").
2. **A Tauri 2 shell for the terminal is small and does not slow the page.** Release exe 3.2 MB (3,224,576 bytes), NSIS installer 1.14 MiB (1,195,347 bytes), made without admin. The process starts in 23 ms (median), the hidden window and WebView2 are up in 318 ms, and the page starts loading at about 314 ms after launch. Per-screen open times are the same in the Tauri window and in headless Edge (within 13 percent on every screen), because the same engine runs the same page.
3. **The Tauri stack holds 191 MB private working set at HOME and 238 MB after eight screens**, in 7 processes (the exe plus six WebView2 processes). Headless Edge holds 348 MB and 293 MB in 17 and 8 processes; that is not a fair "browser" figure (section "Caveats"). The other spike, `00_spike_webview2.md`, measured 422 MB private after a heavier set of screens (an 8,411-row Perspective pivot and six more panels) than this spike used, so treat 238 MB as the light end.
4. **A native chart and table can be very quick, but only with work that the web libraries already do.** A raw 1,000,000-point line in egui_plot costs 74 ms of CPU per frame (median) just to build the geometry, so about 8 frames a second while panning. With per-pixel min and max decimation the same view costs 0.5 to 1.5 ms of CPU, and a frame (build plus GPU, waited for) came to 1.1 to 2.8 ms on the runs where the GPU was free. The virtualised 8,411-row table costs 0.5 to 0.6 ms of CPU per frame and a sort of all rows takes 0.04 to 0.6 ms.
5. **Native memory is lower but not by an order of magnitude.** The demo holds 77 to 84 MB private (Vulkan) or 123 to 162 MB private (DX12) in one process. That is 70 to 110 MB less than the Tauri stack at idle, before the native app has any of the terminal's 30 screens, its text layout, its data layer or accessibility work. The native exe is 10.7 MB against 3.2 MB for the Tauri exe.
6. **What the spike cannot say:** anything about macOS; frame times of the existing web charts under pan (not measured here); text quality, input methods and screen readers in egui; the effort to rebuild 30 screens natively. The GPU was shared with another heavy process for most of the native runs, which wrecks frame-time medians (section "Native results").

## Method

### Machine and software

| Item | Value | Source |
|---|---|---|
| OS | Windows 11 Pro 10.0.26300 | `Get-CimInstance Win32_OperatingSystem` |
| CPU, RAM | AMD Ryzen 9 9950X3D2, 16 cores, 31.6 GB RAM, 4.6 GB free at the start | same |
| GPU | NVIDIA GeForce RTX 4080 SUPER (Vulkan and DX12 adapters both used) | wgpu adapter info in the raw files |
| Display scale | 125 percent (the Tauri page reported `devicePixelRatio` 1.25) | raw files |
| WebView2 runtime | 154.0.4258.48 | `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\` |
| Edge | 154.0.4258.37 and 154.0.4258.48 installed (same Chromium line) | `Application\` folder |
| Rust | rustc 1.99.0 (b940084d7 2026-09-28), cargo 1.99.0 (5f94df478 2026-08-27), rustup 1.29.1, host `x86_64-pc-windows-gnu`, profile minimal | `rustc -Vv`, `rustup -V` |
| C toolchain | winlibs MinGW-w64 GCC 16.2.0 (UCRT, POSIX threads, SEH), binutils 2.47, from the winlibs.com build by Brecht Sanders (r2) | `gcc --version`, `windres --version` |
| Tauri | crate `tauri` 2.12.1, `tauri-build` 2.7.1, CLI `@tauri-apps/cli` 2.12.1 run with `pnpm dlx`, NSIS 3.11 | `Cargo.lock`, build log |
| Native UI | eframe 0.36.2, egui 0.36.2, egui_plot 0.37.0, egui_extras 0.36.2, wgpu 30.0.1 | `Cargo.lock`, crates.io, checked 2 October 2026 |
| Node | 24.13.1 (the drivers use its built-in WebSocket and fetch) | `node -v` |
| Backend for the Tauri runs | the real terminal backend (`python -m nq_terminal`, nq-lab venv Python 3.12, NQT_PORT=8791), real data, web build `terminal/web/dist` as it stood | repo |

Crate versions: https://crates.io/crates/tauri, https://crates.io/crates/eframe, https://crates.io/crates/egui_plot (all checked 2 October 2026 through the crates.io API). NSIS 3.11 came from https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip, fetched by the Tauri bundler.

**Load.** Other work was running the whole time. Total CPU just before each Tauri run was 25 to 54 percent; during the native runs 8 to 58 percent. Free memory was about 4.6 GB. From about 01:46 the GPU was at 98 to 100 percent utilisation with 11.2 to 11.4 GB of video memory in use by something that is not part of this spike (`nvidia-smi`, sampled before and after each run in `raw/run-all3.log`). Medians of 5 were taken wherever possible; the native frame times need the extra reading given below.

**Nothing was shown.** Every window was created hidden. The Tauri window is built with `visible(false)` and `focused(false)`. The egui frame-time runs use no window at all (offscreen rendering), because eframe does not draw hidden windows (section "Native method"). The Edge baseline ran as `msedge.exe --headless=new`. No visible window was opened and no browser devtools tool was used; the pages were driven over the debugging protocol with a small Node script.

### Toolchain

Everything lives under `D:\dev`. Settings used by every build in this spike, from `scripts/env.ps1` (dot-sourced per process; the owner's permanent PATH and environment were not touched):

```
RUSTUP_HOME=D:\dev\rustup
CARGO_HOME=D:\dev\cargo
PATH=D:\dev\cargo\bin;D:\dev\mingw\mingw64\bin;...   (this process only)
npm_config_cache=D:\dev\npm-cache
npm_config_store_dir=D:\dev\pnpm-store
TEMP=TMP=D:\dev\tmp
```

What was installed, and how. The installer download and the unpack happened at the start of the run, before the measuring session, and the exact command lines were not logged. This is what the files on disk show:

| Step | Evidence |
|---|---|
| `rustup-init-gnu.exe` (14,686,353 bytes) run with the gnu host, minimal profile, no PATH change | `D:\dev\dl\rustup-init-gnu.exe`; `D:\dev\rustup\settings.toml` says `default_host_tuple = "x86_64-pc-windows-gnu"`, `profile = "minimal"` |
| winlibs MinGW-w64 kit (273,613,326 bytes zip) unpacked to `D:\dev\mingw\mingw64` | `D:\dev\dl\winlibs.zip`, `gcc.exe` 16.2.0 |
| Tauri CLI not installed at all: `pnpm dlx @tauri-apps/cli@latest build` fetches the prebuilt binary (2.12.1) | `scripts/build.ps1`, build log |
| NSIS 3.11 and its helper plugin cached by the Tauri bundler in the `tauri` folder of the per-user local data folder, which is a directory junction to `D:\dev\tauri-tools` (8 MB on D:) | `Get-Item` on the link |

The brief said the gnu host brings its own linker. It does bring one (`rust-lld`, a self-contained `ld.exe` and `gcc.exe` sit under `lib\rustlib\x86_64-pc-windows-gnu\bin`), but the Tauri build also compiles a Windows resource file, and that needs `windres`, which only the winlibs kit provides. Whether the self-contained tools alone would have been enough for a crate with no resource file is untested. No Visual Studio, no MSVC and nothing needing admin was installed.

Disk used on D: after the spike (`du -sm`, 2 October 2026): cargo home 1,198 MB (the registry and downloaded crates, shared with other builds on this machine, so not all of it is from this spike), rustup 886 MB, MinGW kit 939 MB, Tauri tool cache 8 MB, Tauri spike `target` 1,048 MB, egui spike `target` 875 MB. About 4.95 GB in all, plus 288 MB of download archives in `D:\dev\dl`. The Tauri tool cache is a junction, so C: gained only a link entry.

Build times (this machine, under load): Tauri shell from nothing with plain `cargo build --release`, 417 crates, 4 min 14 s; `tauri build` (release build plus NSIS bundle) 2 min 18 s of compiling and 2 min 26 s end to end; egui spike dependencies plus first build about 1 min 35 s, release rebuild with fat LTO about 1 min 31 s with 8 jobs. These are one-off numbers, not medians.

One build warning: `ld.exe: .rsrc merge failure: multiple non-default manifests`. The exe starts and WebView2 works, so the shell is usable, but it means one of two embedded manifests was dropped. Which one, and whether dialogs would then miss the version 6 common controls, was not checked. A production Tauri build on the MSVC host would not show this; the MSVC route was not tried.

### Tauri shell

Source: `scripts/tauri-main.rs` (about 45 lines), `scripts/tauri-Cargo.toml`, `scripts/tauri.conf.json`. The release profile is `opt-level = "s"`, fat LTO, one codegen unit, `panic = "abort"`, symbols stripped. The shell opens one window on `NQ_URL` (here the backend on port 8791, never 8765), hidden when `NQ_HIDDEN=1`, runs an optional init script before the page (the repo's HOME probe), and appends epoch-millisecond milestones to a file: process `main`, `setup`, window built, page load started, page load finished. It has no commands, no plugins and no security configuration beyond a null CSP, so it is the lightest possible shell and says nothing about what a production shell with IPC, a sidecar process and updates would add.

Built with `pnpm dlx @tauri-apps/cli@latest build --verbose` (`scripts/build.ps1`), which runs `cargo build --bins --features tauri/custom-protocol --release` and then the NSIS bundler with `installMode: currentUser` (no admin). The install mode and the WebView2 bootstrapper options are described at https://v2.tauri.app/distribute/windows-installer/ (checked 2 October 2026): the default `downloadBootstrapper` adds 0 MB, `embedBootstrapper` about 1.8 MB, `offlineInstaller` about 127 MB and `fixedVersion` about 180 MB. This spike used the default, so the 1.14 MiB installer assumes the WebView2 runtime is already present or can be downloaded. Windows 11 ships it; the runtime here is 154.0.4258.48.

Measurement driver: `scripts/drive.mjs`, run 5 times per target, alternating Tauri and Edge so a load swing hits both. Each run:

1. A fresh WebView2 user data folder (empty HTTP cache and storage, like a new browser context), `D:\dev\spikes\prof\...`.
2. Launch the exe hidden with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set to `--remote-debugging-port=9333 --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`. The debugging port is how the script reads the page; the other three flags stop the engine treating a hidden window as occluded. Microsoft says production apps must not use browser flags (https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags, updated 2026-08-31, checked 2 October 2026), so these exist for the measurement only. With them the page reported `visibilityState = visible` and the repo's two-frame paint marks fired. The other spike found that a hidden window without such care freezes the page.
3. Wait for the HOME probe marks (the repo's `installHomeProbe`, copied into `scripts/home-probe.js`): `nqt:home-frame` (four panels laid out and painted) and `nqt:home-ready` (all four show data, painted). Time is reported in two ways: from navigation start (the repo's budget definition) and from process launch.
4. Memory at HOME after 2.5 s idle.
5. Eight keyboard-grammar steps through Ctrl+K, the line, Enter: `LEDG`, `OOS` (both Perspective grids), `NQ GP 1d` (lightweight-charts), `volmanaged_v0 EQ` (ECharts, tear-sheet equity), `LIVE`, `27F MON` (grid with uPlot sparklines), `REG`, then `HOME` again (four panels). Each step waits until nothing is busy and records the time and the private working set 1.5 s later.
6. Memory again after 3 s idle, then `taskkill /T` on the process tree this script started.

Memory is read from the Windows performance counters (`Win32_PerfFormattedData_PerfProc_Process`) for every process in the tree below the launched exe: private working set (unique pages, what Task Manager shows as Memory), working set (shared pages counted once per process, so the sum overstates) and private bytes (committed private memory). The private working set is the fair "what does it cost" figure.

The Edge baseline is `msedge.exe --headless=new` with its own `--user-data-dir`, a 1,600 by 1,000 override and device scale 1, the same probe, the same steps, the same counters on its process tree.

Honest differences between the two sides: the Tauri window inherits the 125 percent display scale (so it draws about 56 percent more pixels than the Edge side at scale 1; this handicaps Tauri slightly), and headless Edge starts extra helper processes that a WebView2 host does not.

### Native method

Source: `scripts/egui-main.rs` (about 400 lines) and `scripts/egui-Cargo.toml`. One binary, synthetic data only: a 1,000,000-point random walk (x sorted, y a float) and 8,411 rows by 7 columns (id, symbol, side, quantity, price, profit, time). Release profile as above with `opt-level = 3`.

- **Chart.** egui_plot `Plot` with one `Line` over the borrowed point slice (no per-frame copy). Pan and zoom are driven by code, not by the mouse: each frame sets the plot bounds, with the visible span sweeping between about 1,000 and 1,000,000 points and the centre sweeping along the series. That measures drawing under pan and zoom, not the cost of mouse handling.
- **Decimated chart.** The same line, but the visible slice is found by binary search on x and reduced to the minimum and maximum of each pixel column before it is handed to egui_plot. This is what any serious native chart has to do; the web libraries do the equivalent inside uPlot.
- **Table.** `egui_extras::TableBuilder` with virtualised rows (`body.rows`), 7 resizable columns, a header button per column that sorts all 8,411 rows (sort time recorded), and a programmatic scroll through the rows at about 2,000 rows per second.
- **Modes:** `chart` (raw), `chart-dec`, `table`, `both` (raw chart over table) and `both-dec` (decimated chart over table, the realistic layout). Each run: 4 s idle, then 9 s of continuous redraw; the first 30 frames are dropped. Memory is sampled at 2.5 s (idle) and 3.5 s into the work phase.

**Why offscreen.** The first attempt created a hidden eframe window and logged frame intervals. They came out at a steady 100 to 280 ms, which is not the app's speed: eframe 0.36.2 paints invisible windows at most every 100 ms on Windows, and when the window is not visible it runs no egui pass at all (`eframe-0.36.2/src/native/run.rs`, constant `INVISIBLE_WINDOW_REPAINT_INTERVAL`; `native/wgpu_integration.rs`, `show_ui`; upstream issue https://github.com/emilk/egui/issues/7776). A hidden eframe window therefore cannot give frame times. Showing a window was not allowed, so frame times come from an offscreen harness in the same binary (`--offscreen`): the same `egui::Context` and the same draw code, rendered with `egui_wgpu::Renderer` into a 2000 by 1250 texture (1600 by 1000 points at scale 1.25, the same size as the Tauri window), submitted and waited for with `device.poll(Wait)` every frame. A frame time here is therefore the egui pass, tessellation, upload, GPU render and the wait for the GPU. It excludes the swap chain, the window manager and the display, which would add on a real window. The hidden eframe window is still used to read memory and start-up (`raw/egui-window*`), where it behaves normally.

Slint and iced were not tried: neither has a plot widget, so a one-million-point chart would be a separate piece of work, and the time went into making the egui numbers trustworthy instead.

## Tauri results (5 runs each, alternating)

### Start and first render

| Metric (median, min to max) | Tauri 2 shell, WebView2 154 | Headless Edge 154 |
|---|---|---|
| Process `main` after launch | 23 ms (16 to 49) | not applicable |
| Window and WebView2 built, after launch | 318 ms (292 to 435) | not applicable |
| Page load finished (document only), after launch | 369 ms (341 to 512) | not applicable |
| Navigation start after launch | 314 ms (286 to 428) | 386 ms (316 to 411) |
| First contentful paint, from navigation start | 208 ms (164 to 464) | 344 ms (316 to 552) |
| HOME frame mark (four panels painted), from navigation start | 213 ms (166 to 469) | 398 ms (346 to 461) |
| **HOME ready, from navigation start** | **1,642 ms (1,304 to 2,758)** | **2,026 ms (1,837 to 2,251)** |
| **Launch to HOME ready** | **1,960 ms (1,590 to 3,089)** | **2,437 ms (2,215 to 2,568)** |

Individual runs: Tauri launch to HOME ready 2,070, 3,089, 1,590, 1,743, 1,960 ms; Edge 2,215, 2,437, 2,375, 2,484, 2,568 ms. Total machine CPU just before the Tauri runs: 47, 54, 25, 33, 42 percent; before the Edge runs 39, 49, 29, 35, 18 percent.

Reading: these HOME times are not the repo budget's 647 ms and should not be compared with it. They use the real backend with real data, a cold profile and the full HOME (four panels), and most of the 1.6 to 2.0 seconds is the backend answering HOME's API reads, not the shell or the engine. The in-repo budget runs a warmed fixture backend and a different method; the other spike measured 753 ms for WebView2 and 752 ms for Edge on a warmed fixture backend, with the two hosts level. The honest conclusions from this table are about the shell: it adds about 0.3 s between launch and the page starting to load (almost all of it creating the WebView2 environment), and the engine inside it is as fast as Edge's. The Tauri side reads faster than the Edge side here; the likely causes are the headless Edge process start and profile set-up, and the gap is not claimed as a Tauri advantage (the scale difference works the other way, against Tauri).

### Memory (Windows performance counters, MB)

| Moment | Tauri private working set | Tauri working set (summed) | Tauri private bytes | Tauri processes | Edge private working set | Edge processes |
|---|---|---|---|---|---|---|
| HOME open, 2.5 s idle | 191 (188 to 195) | 479 | 435 | 7 | 348 (339 to 359) | 17 |
| After eight screens and HOME again, 3 s idle | 238 (235 to 244) | 543 | 489 | 7 | 293 (284 to 297) | 8 |

The exe itself holds about 3 MB private and 24 MB working set. Everything else is WebView2. The headless Edge figure at open is inflated by 10 extra helper processes that a WebView2 host does not start, which then exit; its later figure is closer to a like-for-like number. The other spike measured 422 MB private across 8 processes after HOME plus five heavy screens that include an 8,411-row Perspective pivot; this spike's screens are lighter (real-data LEDG and OOS grids are small), so the real figure for the owner's heaviest session is nearer 420 MB than 238 MB.

### Per screen, median of 5 (settle time in ms; private working set in MB 1.5 s after it)

| Screen | Engine | Tauri ms | Edge ms | Tauri MB | Edge MB |
|---|---|---|---|---|---|
| `LEDG` | Perspective grid | 350 | 355 | 201 | 359 |
| `OOS` | Perspective grid | 339 | 338 | 197 | 363 |
| `NQ GP 1d` | lightweight-charts | 620 | 601 | 203 | 295 |
| `volmanaged_v0 EQ` | ECharts | 2,330 | 2,322 | 221 | 307 |
| `LIVE` | panel with live stream | 356 | 323 | 221 | 304 |
| `27F MON` | grid and uPlot | 128 | 113 | 223 | 304 |
| `REG` | grid | 1,248 | 1,270 | 224 | 294 |
| `HOME` again | four panels | 722 | 710 | 242 | 294 |

All 40 steps settled in both hosts; every line opened a panel with its own title. The slow ones (`EQ`, `REG`) are backend reads. The screens run at the same speed in both hosts, which matches the other spike: the web engine, not the shell, decides page speed.

## Native results (egui, synthetic data, offscreen frame times)

### Chart and table, all runs

"CPU build" is the egui pass plus tessellation on the CPU. "Frame" adds the GPU work and the wait for it. The GPU-free and GPU-busy runs are separate because the RTX 4080 SUPER was being used at 98 to 100 percent by another process for most of the session; whenever that happened frames came out at a near constant 62 ms (about 16 per second), which is the other process's time slice, not egui's cost. Runs are called GPU-free when their median frame was under 10 ms; that is a label decided after the fact, so the all-run lists are in `raw/aggregate.md`.

| Mode | Runs | CPU build per frame, median (range over runs) | Frame, median over GPU-free runs | p95 and p99, GPU-free runs | Frames drawn in 9 s |
|---|---|---|---|---|---|
| Raw 1,000,000-point line (`chart`) | 5 | 73.9 ms (64.2 to 83.1) | 118 ms (103 to 133), all runs, no GPU-free run seen | p95 163 ms, p99 182 ms (median over runs) | 46 to 82 |
| Raw line over table (`both`) | 4 of 5 valid | 73.8 ms (67.6 to 84.2) | 118 ms (107 to 131) | p95 127 ms, p99 134 ms | 61 to 77 (one run drew only 26 frames and is dropped) |
| Decimated line (`chart-dec`) | 5 (4 GPU-free; one run at 1,340 frames was partly shared) | 0.53 to 0.67 ms (0.82 in the shared run) | 1.07 to 1.22 ms | p95 1.9 to 15 ms, p99 2.4 to 133 ms | 1,340 to 5,279 (GPU-free) |
| Virtualised table, 8,411 rows (`table`) | 5 (4 GPU-free; one at 1,152 frames was partly shared) | 0.54 to 0.63 ms | 1.07 to 1.16 ms (4.95 in the shared run) | p95 1.7 to 16 ms, p99 2.3 to 17 ms | 1,152 to 7,578 (GPU-free) |
| Decimated line over table (`both-dec`) | 13 (4 GPU-free) | 0.77 to 1.21 ms (GPU-free), 1.2 to 2.1 ms (others) | 1.44, 1.56, 2.04, 2.83 ms | p95 2.4 to 63 ms | 4,352, 382, 581, 519 (GPU-free); about 100 (the 9 others) |
| `both-dec` on DX12 | 3 | 1.0 to 1.5 ms | 1.8, 3.0, 19.7 ms | not stable | 187 to 907 |

Sorting all 8,411 rows by one column took 0.024 to 0.61 ms per sort across runs (median of medians about 0.04 ms in `both-dec`, 0.5 ms in `table`; the spread follows which column and how busy the CPU was).

What these say:

- A raw million-point polyline in egui_plot is CPU bound. The 74 ms is geometry building (every point is tessellated each frame); the rest of the 118 ms frame is drawing and waiting, and with the GPU shared the two cannot be separated. About 8 frames a second is not acceptable for pan and zoom. The library's issue tracker already lists this as a known limit: https://github.com/emilk/egui_plot/issues/18 (large data, borrowed series) and https://github.com/emilk/egui_plot/issues/22 (simplifying long lines), both open, checked 2 October 2026.
- With decimation done in the app, the same interaction costs under 1.5 ms of CPU. A native terminal would therefore need its own level-of-detail layer for every long series, as uPlot and lightweight-charts have inside them.
- A virtualised table of 8,411 rows is trivially cheap (about 0.6 ms of CPU a frame) and sorting is effectively free. Table speed was never the question for a native app; text shaping, selection, copy, column pinning and the like were not tested.

### Memory and start (one process)

| Moment | Private working set | Working set | Source |
|---|---|---|---|
| Offscreen harness, Vulkan, idle | 84 MB (82 to 85) | 130 MB | 33 runs in `raw/egui` |
| Offscreen harness, Vulkan, during `chart-dec`, `table`, `both-dec` | 83 to 87 MB | 129 to 133 MB | same |
| Offscreen, raw chart during pan | 90 to 299 MB (varies with the zoom level at the moment of sampling) | 135 to 344 MB | `chart`, `both` runs |
| Offscreen harness, DX12, `both-dec` | 123 MB idle, 126 MB working | 160 to 163 MB | 3 runs |
| Hidden eframe window, Vulkan, `both-dec` | 77 MB idle, 79 MB working | 124 to 127 MB | 3 runs |
| Hidden eframe window, DX12, `both-dec` | 162 MB idle, 165 MB working | 212 to 216 MB | 3 runs |
| Hidden eframe window, Vulkan, raw `both` | 359 MB idle (210 to 367) | 426 MB | 5 runs, see note |

Note on the last row: the earlier batch ran the raw chart in the hidden window and held 359 MB at idle, against 77 MB for the decimated layout. The window itself is therefore not what costs memory; what is drawn is. The cause of the extra 280 MB (very likely the mesh buffers for a long raw line) was not isolated.

Start: from launch to the first frame was 506 to 932 ms in the offscreen harness (median per mode; Vulkan instance and device creation plus the first frame, 1M points generated in 3 ms) and 568 ms (478 to 1,209) for the hidden eframe window. The first frame including the GPU was 9 to 15 ms in the quiet runs. These include GPU driver start-up and no backend. The Tauri shell, for comparison, had its window built at 318 ms and still needed the Python backend (3.6 to 5.1 s per the other spike) and the data reads. A native app would keep the backend, so its start would be the same as long as the backend is Python.

Files: the egui exe is 10,761,728 bytes (wgpu in, fat LTO). 431 crates in its lock file; 417 for the Tauri shell.

## What the numbers say about webview versus native for this terminal

1. **Shell language is not where the time goes.** The Tauri shell is 3.2 MB, adds about 0.3 s before the page starts, and the page then runs exactly as fast as in Edge. Swapping a Python host for a Rust host removes pywebview's process (the other spike measured it at 102 MB) and gives a clean installer; it does not make HOME or any screen faster, because the engine and the backend decide that.
2. **The memory a web engine costs is real, and the floor is about 190 MB private at HOME on this build.** That floor, not the shell, is the case for going native. A native app can sit near 80 MB for a chart and a table, but that is a demo with no text-heavy screens, no 30-screen function set, no keyboard grammar and no accessibility tree. Expect it to grow.
3. **Native is fast only if the app owns the hard parts.** The million-point chart ran at 8 frames a second until decimation was added by hand, then at about 1 ms. The web libraries the terminal uses today (uPlot, lightweight-charts, ECharts, Perspective) already contain that work. Going native means rebuilding it, plus the dockview layout, the Perspective pivot, the heatmaps and 30 screens, and then reproving the numerical cross-check, the research gate and WCAG 2.2 AA on a different stack. egui has an AccessKit feature, but accessibility was not tested here.
4. **A middle road is cheap to try and the numbers support it.** A Rust shell (Tauri) keeps all existing screens and the look, costs 3.2 MB and about 0.3 s, and can later host a native pane (for the one or two screens where the engine is the limit) beside web panes. That is a question for the roadmap, not this spike.
5. **Start-up is dominated by the backend either way.** Real HOME needed 1.3 to 2.8 s after navigation start on this loaded machine, almost all of it API reads. A faster window does not shorten that.

## Caveats

- **Windows only, gnu toolchain, no macOS.** WKWebView, Metal, notarisation, app bundles and macOS memory behaviour were not touched. Nothing here transfers to the Mac numbers.
- **GNU host, not MSVC.** The usual production Windows target is MSVC. Binary size, the manifest warning and some crates may differ. The gnu exe was fine to run, but this is not the shipping configuration.
- **Shared machine.** CPU 8 to 58 percent busy from other work; the GPU was shared with a heavy process for most native runs. Medians of 5 are used where there were 5; the native GPU-free subset is a post-hoc label and has only 3 or 4 runs per mode. The frame-time figures on a quiet machine could be better or worse.
- **Offscreen frame times exclude the swap chain, the window manager and the display**, and the hidden eframe window cannot give any (upstream behaviour above). Programmatic pan and zoom replace the mouse. No input latency was measured.
- **The WebView2 numbers need three non-production flags** (remote debugging port and two occlusion switches). The debugging port adds a little memory. The window was hidden, so real window painting, DWM composition and focus behaviour were not part of the numbers.
- **Real-data backend.** The Tauri runs used the real backend with a cold WebView2 profile each time and a warmed backend; absolute HOME times therefore differ from the repo's budget runs and from the other spike's fixture runs. The first Tauri run of the session (cold backend, 5.8 s to HOME ready) is kept in `raw/` only as a test file and is not in the medians.
- **Edge baseline is imperfect.** Headless Edge started 17 processes at HOME against 7 for Tauri, ran at scale 1 against 1.25, and so its memory and first-paint numbers flatter Tauri a little.
- **Not measured:** chart frame times of the existing web charts under pan; Perspective with 8,411 rows (the other spike did this); text quality and screen readers in egui; installer behaviour (installing and uninstalling) and auto-update; code signing; Slint and iced.
- **Two incidents.** One read-only request, `GET /api/health`, reached the owner's backend on 127.0.0.1:8765 by mistake while checking which port was alive; the answer was discarded and nothing else touched that port. The backend this spike started on 8791 (and a child process it had started) was stopped at the end; the owner's process on 8765 was not touched.
- **Unverified:** whether the self-contained gnu tools alone would build a crate without a resource file; which manifest the linker dropped; the cause of the 359 MB raw-chart window memory.

## Reproduce

All paths as used here; all in `docs/desktop/spike_rust/scripts/`.

```
# toolchain environment for this process only
. scripts\env.ps1

# Tauri shell: release exe and NSIS installer (no admin)
powershell -NoProfile -File scripts\build.ps1          # pnpm dlx @tauri-apps/cli@latest build --verbose

# backend on a spare port (never 8765)
$env:NQT_PORT='8791'; python -m nq_terminal            # from terminal\backend, with the nq-lab venv Python

# WebView2 and Edge measurement, 5 runs each, alternating
node scripts\drive.mjs tauri 1 <outDir>                # then edge 1, tauri 2, edge 2 ...

# native spike
powershell -NoProfile -File scripts\build-egui.ps1     # cargo build --release, 8 jobs
node scripts\egui-run.mjs both-dec 1 <outDir> --offscreen
node scripts\egui-run.mjs both-dec 1 <outDir>          # hidden window, for memory and start only

# tables
python scripts\aggregate.py
```

The batch scripts `run-all.sh`, `run-all2.sh` and `run-all3.sh` are the exact runs behind `raw/`; `raw/aggregate.md` has every per-run value. The source files are stored with a prefix (`tauri-main.rs`, `egui-main.rs`) so they do not look like part of the repo's own code. The spike's own working copy is `D:\dev\spikes` (outside the repo).

## Sources

- Tauri Windows installer modes and sizes: https://v2.tauri.app/distribute/windows-installer/ (checked 2 October 2026)
- WebView2 browser flags and the production warning: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags (updated 2026-08-31, checked 2 October 2026)
- WebView2 process model (one browser process per user data folder, renderer processes, and helper processes such as the GPU process): https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model (updated 2026-06-12, checked 2 October 2026)
- Crates: https://crates.io/crates/tauri, https://crates.io/crates/eframe, https://crates.io/crates/egui_plot (checked 2 October 2026)
- egui project: https://github.com/emilk/egui (Apache-2.0 per the GitHub API, checked 2 October 2026); Tauri: https://github.com/tauri-apps/tauri (Apache-2.0 per the GitHub API, checked 2 October 2026)
- egui_plot issues on large series: https://github.com/emilk/egui_plot/issues/18, https://github.com/emilk/egui_plot/issues/22 (both open, checked 2 October 2026); eframe hidden window behaviour: https://github.com/emilk/egui/issues/7776 (referenced in the eframe 0.36.2 source, not opened separately)
- The other spike: `docs/desktop/00_spike_webview2.md`
