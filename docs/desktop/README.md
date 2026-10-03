# Desktop terminal: documents

The plan to turn the nq-lab terminal from a local web app into native apps for Windows and macOS. Read in order. Each document builds on the ones before it, and all of them were written on 2 October 2026 against HEAD `c7f9e61` (v2), so a later change to the terminal may need the inventories and the module map run again.

## The decision in three lines

1. Keep today's React page and the lab's own Python backend, and wrap them in a thin Tauri 2 shell written in Rust, on Windows and on macOS. No native UI rewrite and no Rust backend.
2. Most of the speed comes from the backend (lazy imports, a result cache, one backend per lab), and it ships to the browser terminal before any shell code is written.
3. The Mac attaches to the PC's lab over an SSH tunnel by default. If the Mac WebKit gate (G1) fails, or Electron measures clearly lighter or faster on this PC (T2), the app uses Electron on both systems instead.

## Documents

| Document | What it is |
|---|---|
| [00_inventory_backend.md](00_inventory_backend.md) | Every backend module and route, the dependencies and the QA pieces, as they stand, with measured route times and start-up costs. |
| [00_inventory_frontend.md](00_inventory_frontend.md) | Every front-end screen, component folder, dependency, test suite and stored key, counted by script from the repository. |
| [00_spike_webview2.md](00_spike_webview2.md) | The terminal measured inside WebView2 on this PC against headless Edge: per-screen times, memory use, backend cold start. |
| [00_spike_rust.md](00_spike_rust.md) | The Rust toolchain on drive D:, a Tauri shell, and a native egui chart and grid, all built, then measured, on this PC. |
| [research/L1_webview_shells.md](research/L1_webview_shells.md) | Web view shells compared (Tauri, Wails, Electron, among others), and whether the page behaves the same in WKWebView and WebView2. |
| [research/L2_native_ui.md](research/L2_native_ui.md) | What a native UI rewrite would cost, toolkit by toolkit, including accessibility on grids. |
| [research/L3_backend_compute.md](research/L3_backend_compute.md) | What runs the backend in a desktop app: the Python sidecar, embedded Python, a Rust port or a mix. |
| [research/L4_distribution.md](research/L4_distribution.md) | Installers and signing, notarisation, updates, plus CI and crash reports, with their yearly costs. |
| [research/L5_performance.md](research/L5_performance.md) | The data plane, wire formats, published shell benchmarks and the budgets the desktop build should meet. |
| [research/L6_prior_art.md](research/L6_prior_art.md) | How other trading tools and data terminals are built, and which migrations worked. |
| [research/L7_security_a11y.md](research/L7_security_a11y.md) | The attack surface, supply chain, secrets, the read-only IB and research-gate guarantees, and accessibility on the desktop. |
| [01_options.md](01_options.md) | End-to-end architectures scored against fixed weighted criteria, with a lead option and a runner-up. |
| [02_decision.md](02_decision.md) | The decision, "light and fast" in numbers, the stages, the gates G0 to G3, the triggers T1 to T11, and a verdict on every challenge finding. |
| [03_migration_plan.md](03_migration_plan.md) | How to build it: process model, every route in its desktop form, the gate, saved state, keys, packaging, tests, CI, budgets, rollback, 39 work items and a fate for every module and dependency. |
| [04_roadmap.md](04_roadmap.md) | The build in phases D0 to D8: slices with file ownership, QA gates, exit numbers, effort, the owner's decisions and actions, and a milestone timeline. |
| [03_appendix_a_addendum.md](03_appendix_a_addendum.md) | The modules added after Appendix A was written, with the preflight of each phase and each integration wave. |
| [d0_results.md](d0_results.md) | The Windows part of D0: the WebView2 probes, the T2 comparison (it does not fire, so the shell stays Tauri 2) and the backend ready baseline. |
| [d4_integration.md](d4_integration.md) | Integration wave INT1: what was wired between the backend and page (D1 to D3) and the Windows shell (D4), and the check counts of the merged tree. |
| [d5_integration.md](d5_integration.md) | Integration wave INT2: what was reconciled when the D5 step 1 branch (harness, app checks, supply chain, NSIS package) met the main tree, and the check counts of the merged tree. |
| [05_risks_costs.md](05_risks_costs.md) | What can go wrong, as a risk register with an owner for each risk, and what the plan costs in money and in the owner's time, one-off and yearly. |
| [handover_windows.md](handover_windows.md) | The Windows hand-over (D6): what was built; install, run, update and roll back; both doors at once; the permission (ACL) runbook; the release procedure; troubleshooting; and the list of owner checks. A draft until W6 fills its placeholders. |
| [smartscreen.md](smartscreen.md) | What SmartScreen and Smart App Control do with the unsigned installer, how to verify it, how to proceed safely, the first-run record and the signing options. |
| [owner_decisions_windows.md](owner_decisions_windows.md) | The register of the owner decisions for the Windows app: those delegated on 3 October 2026 with the standard each follows, the plan's fourteen, what is still open, the accepted departures from 03 and what is deferred. |
| [checks/](checks/README.md) | One dated template for each owner-run check (custom install folder, reboot first launch, visible run, real keyboard, zoom, NVDA, Narrator, JOBS backtest, SmartScreen, soak, pending measurements, weekly parity) and the four-week dual-run kit. |

## Supporting folders

| Folder | What it holds |
|---|---|
| [research/](research/) | The seven research lenses listed above. |
| [baseline/](baseline/), [spike_d0/](spike_d0/), [spike_electron/](spike_electron/) | The D0 static baseline, the WebView2 probes and the Electron harness with its T2 figures. |
| [stage1/](stage1/) | The stage 1 measurement script, its records and the seam specs (D1 and D3 numbers, the T3 reading). |
| `../../desktop/` | The Windows shell: the Tauri crate in `src-tauri/`, the check scripts in `scripts/`, and its own README. |
| `nq-lab/desktop_research/spike_webview2/` | Scripts and raw output of the WebView2 spike. |
| `nq-lab/desktop_research/spike_rust/` | Scripts, the shell source, the chart source, and raw output of the Rust spike. |
| `nq-lab/desktop_research/tools/` | Scripts that build the inventory tables and, in `tools/plan/gen_03_tables.py`, the route table and appendices of the migration plan. |

The last three folders are scripts and raw output, not documents, so they sit outside the terminal repository, in `nq-lab/desktop_research/` beside it.

## Status

Phases D0 (Windows part) to D4 are built and merged: the backend speed work and the result cache (D1), one backend per lab with the lock, the challenge-response handshake and the session token (D2), the workspace store and the page bridge (D3), and the Windows shell (D4), whose seams with the backend and the page were wired and tested in integration wave INT1 (`d4_integration.md`). D5 step 1 is built and merged as building only (integration wave INT2): the measurement harness (`desktop/harness`), the desktop Playwright project and the served-JSON comparison (`web/e2e/desktop`, `qa/crosscheck/served.py`), the app mode of the real-data smoke, the supply-chain checks (`deny.toml`, the dist secret scan, the advisory check, the order-name scan), the per-user NSIS package without administrator rights, the artefact check, the dated green-record writer and `release_check.ps1`. Nothing of gate G2 is measured yet: the measuring is the next step (D5 step 2), alone, in a quiet window. The hand-over documents (D6) are drafted: the runbook, the SmartScreen record, the decision register and the owner check templates. They are complete except for the G2 and final-regression figures, which show as visible placeholders until wave W6 fills them, and nothing in `checks/` has been run by the owner yet. macOS is out of scope for now. The pitch deck is still to come: it is the last step and is not in this folder yet. When it is written it will be listed in the table above, and it must state the memory and size figures plainly (see risk O01 in `05_risks_costs.md`). The owner's open decisions are listed in `04_roadmap.md`, section "Owner decisions", and kept up to date for Windows in `owner_decisions_windows.md`.
