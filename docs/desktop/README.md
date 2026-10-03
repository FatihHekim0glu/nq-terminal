# Desktop terminal: documents

The plan to turn the nq-lab terminal from a local web app into native apps for Windows and macOS. Read in order. Each document builds on the ones before it, and all of them were written on 2 October 2026 against HEAD `c7f9e61` (v2), so a later change to the terminal may need the inventories and the module map run again.

## The decision in three lines

1. Keep today's React page and the lab's own Python backend, and wrap them in a thin Tauri 2 shell written in Rust, on Windows and on macOS. No native UI rewrite and no Rust backend.
2. Most of the speed comes from the backend (lazy imports, a result cache, one backend per lab), and it ships to the browser terminal before any shell code is written.
3. The Mac attaches to the PC's lab over an SSH tunnel by default. If the Mac WebKit gate (G1) fails, or Electron measures clearly lighter or faster on this PC (T2), the app uses Electron on both systems instead.

## Documents

| Document | What it is |
|---|---|
| [00_inventory_backend.md](00_inventory_backend.md) | Every backend module, route, dependency and QA piece as it stands, with measured route times and start-up costs. |
| [00_inventory_frontend.md](00_inventory_frontend.md) | Every front-end screen, component folder, dependency, test suite and stored key, counted by script from the repository. |
| [00_spike_webview2.md](00_spike_webview2.md) | The terminal measured inside WebView2 on this PC against headless Edge: per-screen times, memory and backend cold start. |
| [00_spike_rust.md](00_spike_rust.md) | The Rust toolchain on drive D:, a Tauri shell and a native egui chart and grid, built and measured on this PC. |
| [research/L1_webview_shells.md](research/L1_webview_shells.md) | Web view shells compared (Tauri, Wails, Electron and others), and whether the page behaves the same in WKWebView and WebView2. |
| [research/L2_native_ui.md](research/L2_native_ui.md) | What a native UI rewrite would cost, toolkit by toolkit, including accessibility on grids. |
| [research/L3_backend_compute.md](research/L3_backend_compute.md) | What runs the backend in a desktop app: the Python sidecar, embedded Python, a Rust port or a mix. |
| [research/L4_distribution.md](research/L4_distribution.md) | Installers, signing, notarisation, updates, CI and crash reports, with their yearly costs. |
| [research/L5_performance.md](research/L5_performance.md) | The data plane, wire formats, published shell benchmarks and the budgets the desktop build should meet. |
| [research/L6_prior_art.md](research/L6_prior_art.md) | How other trading tools and data terminals are built, and which migrations worked. |
| [research/L7_security_a11y.md](research/L7_security_a11y.md) | The attack surface, supply chain, secrets, the read-only IB and research-gate guarantees, and accessibility on the desktop. |
| [01_options.md](01_options.md) | End-to-end architectures scored against fixed weighted criteria, with a lead option and a runner-up. |
| [02_decision.md](02_decision.md) | The decision, "light and fast" in numbers, the stages, the gates G0 to G3, the triggers T1 to T11, and a verdict on every challenge finding. |
| [03_migration_plan.md](03_migration_plan.md) | How to build it: process model, every route in its desktop form, the gate, saved state, keys, packaging, tests, CI, budgets, rollback, 39 work items and a fate for every module and dependency. |
| [04_roadmap.md](04_roadmap.md) | The build in phases D0 to D8: slices with file ownership, QA gates, exit numbers, effort, the owner's decisions and actions, and a milestone timeline. |
| [05_risks_costs.md](05_risks_costs.md) | What can go wrong, as a risk register with an owner for each risk, and what the plan costs in money and in the owner's time, one-off and yearly. |

## Supporting folders

| Folder | What it holds |
|---|---|
| [research/](research/) | The seven research lenses listed above. |
| `nq-lab/desktop_research/spike_webview2/` | Scripts and raw output of the WebView2 spike. |
| `nq-lab/desktop_research/spike_rust/` | Scripts, shell and chart source, and raw output of the Rust spike. |
| `nq-lab/desktop_research/tools/` | Scripts that build the inventory tables and, in `tools/plan/gen_03_tables.py`, the route table and appendices of the migration plan. |

The last three folders are scripts and raw output, not documents, so they sit outside the terminal repository, in `nq-lab/desktop_research/` beside it.

## Status

Windows build in progress. The plan is decided, and the Windows build follows `04_roadmap.md` in phases. Built and merged: D0 (the spikes), D1 (lazy imports and the result cache), D2 (the desktop seam of the backend: lock, handshake, session and proof), D3 stage A (the workspace store and the page bridge), the complete D4 shell (the Tauri 2 window, the supervisor, keys, the write module, downloads and crash handling, with its `smoke` and `measure` builds) and, as building only, D5 step 1: the measurement harness (`desktop/harness`), the desktop Playwright project and the served-JSON comparison (`web/e2e/desktop`, `qa/crosscheck/served.py`), the app mode of the real-data smoke, the supply-chain checks (`deny.toml`, the dist secret scan, the advisory check, the order-name scan), the per-user NSIS package without administrator rights, the artefact check, the dated green-record writer and `release_check.ps1`.

Nothing of gate G2 is measured yet: the measuring is the next step (W5B), alone, in a quiet window. D3 stage B (the page on the workspace store, portable links) is built beside this and is not part of this status. macOS is out of scope for this build. The pitch deck is still to come: it is the last step and is not in this folder yet. When it is written it will be listed in the table above, and it must state the memory and size figures plainly (see risk O01 in `05_risks_costs.md`). The owner's open decisions are listed in `04_roadmap.md`, section "Owner decisions".
