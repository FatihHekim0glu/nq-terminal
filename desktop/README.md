# desktop: the Windows shell of the nq-lab terminal

The shell is a Tauri 2.12 app in `src-tauri/`. It opens one framed window over the page that the lab's own backend serves, and gives the page no shell command. The plan is in `docs/desktop/02_decision.md`, `03_migration_plan.md` (sections 2, 3, 6, 7, 11, 13, 15 and 17) and `04_roadmap.md` (phase D4). This is stage A (D4.1): the skeleton, every shared declaration and the checks. Stage B fills the modules behind the signatures fixed here.

## Layout

| Path | What it holds |
| --- | --- |
| `src-tauri/Cargo.toml`, `Cargo.lock` | the crate, every dependency, the features `shell-plugins` (default), `smoke` and `measure` |
| `src-tauri/rust-toolchain.toml` | Rust 1.99.0 with Clippy and rustfmt |
| `src-tauri/.cargo/config.toml` | no static-link flag is needed on the GNU host (W0A P5) |
| `src-tauri/build.rs` | the build identity and the one combined manifest (W0A P4) |
| `src-tauri/windows/app.manifest` | Common-Controls 6.0, PerMonitorV2, asInvoker |
| `src-tauri/tauri.conf.json` | the release identity `dev.nqlab.terminal`, product name `nq-lab terminal` |
| `src-tauri/tauri.smoke.conf.json`, `tauri.measure.conf.json` | the test identities, `dev.nqlab.terminal.smoke` and `dev.nqlab.terminal.measure` |
| `src-tauri/capabilities/main.json` | the main window's capability: no permission at all |
| `src-tauri/assets/` | the shell's own pages: `splash.html` and the generated `look.css` |
| `src-tauri/clippy.toml`, `deny.toml` | the static bans and the supply-chain rules |
| `src-tauri/src/` | `main.rs` and one module per concern (below) |
| `src-tauri/tests/` | `capability_empty.rs`, `identity_split.rs`, `hidden_window.rs` |
| `scripts/` | `check.ps1`, `plant-check.ps1`, `pe-info.mjs`, `copy-tokens.mjs` |

No `target` folder and no `node_modules` folder ever exist under `desktop/`. The scripts use Node built-ins only, and the Tauri command line is the cargo-installed `cargo-tauri` under `D:\dev\cargo\bin`.

## Build identities

| Build | Command (from `desktop/`) | Identifier | Plugins | Window |
| --- | --- | --- | --- | --- |
| release | `cargo tauri build --bundles nsis -- --locked` | `dev.nqlab.terminal` | single instance, window state | shown once the splash has loaded |
| smoke | `cargo tauri build --no-bundle --features smoke --config src-tauri\tauri.smoke.conf.json -- --locked --no-default-features` | `dev.nqlab.terminal.smoke` | none | never shown |
| measure | `cargo tauri build --bundles nsis --features measure --config src-tauri\tauri.measure.conf.json -- --locked --no-default-features` | `dev.nqlab.terminal.measure` | none | never shown |

`build.rs` merges the smoke or measure file over `tauri.conf.json` whenever that feature is on, so a plain `cargo build --features smoke` already carries the smoke identity. A test build passes `--no-default-features`, so the two release plugins are not even compiled in; `main.rs` registers them only under `cfg(all(feature = "shell-plugins", not(any(feature = "smoke", feature = "measure"))))` in any case. The window state comes back with every flag except visibility.

Smoke and measure are separate builds and may not be combined. In both, every native dialog fails closed (it logs the event and returns Quit, Cancel or no path), the stale-page rebuild is refused, and the WebView2 controller is made visible behind the hidden window so the page runs at the display rate with nothing on screen (W0A P0).

## Smoke switches (frozen)

`src-tauri/src/smoke_options.rs` holds the one `SmokeOptions` struct, parsed only in smoke builds. Stage B fills behaviour behind these fields and never changes the struct.

| Switch | Meaning |
| --- | --- |
| `--fixture` | start the fixture backend through the full handshake |
| `--attach-url <url>` | load a running page server, `http://127.0.0.1:<port>/` only, never port 8765 |
| `--state-dir <dir>` | the backend's state folder |
| `--save-dir <dir>` | downloads and the diagnostics zip land here, with no dialog |
| `--lab <dir>` | the lab, with no picker |
| `--webview-data-dir <dir>` | the WebView2 profile folder (required) |
| `--config-dir <dir>` | the shell's settings and logs (required) |
| `--zoom <percent>` | 50 to 300 in steps of 25 |
| `--size <w>x<h>` | at least 1024x640 |
| `--remote-debugging-port <port>` | default 0: the engine picks a port and writes `DevToolsActivePort` in the profile folder |
| `--screen2` | owner decision 10 only |

Unknown, repeated or out-of-range switches are refused before anything starts.

## Modules and hooks

`main.rs` calls the hooks in this order: `window::scrub_env` first, before any thread exists; `window::policy_check`; then, on the built window, `keys::install`, `window::setup`, `supervise::start`, `writes::on_download_starting` and `crash::install`; `smoke::browser_args`, which can only act on the window builder and so is read just before the build; and `smoke::after_build` last.

| Module | Stage A state | Filled by |
| --- | --- | --- |
| `window.rs` | `scrub_env` complete; `resolve` reads the smoke switches; the policy check, picker, settings and window setup are stubs | w4b-window-keys |
| `keys.rs` | stub | w4b-window-keys |
| `dialogs.rs` | complete for the fail-closed rule; plain rfd dialogs in the release | w4b-window-keys |
| `supervise.rs` | stub, except the smoke `--attach-url` navigation | w4b-supervise-link |
| `link.rs` | host and port rules complete; `get` is a stub | w4b-supervise-link |
| `writes.rs` | interface final; the check is the stage A prefix rule (inside the lab only `terminal/state/**`) | w4b-writes-downloads |
| `reads.rs` | complete: `read_lock`, `read_settings`, `read_log_tail`, each with a size cap | none |
| `crash.rs` | the shell log complete; `install` is a stub | w4b-crash-smoke |
| `smoke.rs` | the debugging port with Tauri's default switches re-added in one list; the controller made visible | w4b-crash-smoke |

## Static bans

`clippy.toml` bans `std::net::TcpStream` (and the other socket types), the `std::fs` read and write functions, `std::process::Command::new` and the window `show()` methods across the crate. The only allow sites are the module-level allows in `link.rs` (TCP), `reads.rs` (reads) and `writes.rs` (writes), and the one release-only `show()` in `window.rs`. Test files and `build.rs` carry their own allow with a reason. `deny.toml` takes crates from crates.io only and bans by name the parquet, Arrow, Polars, DuckDB and DataFusion crates, the broker client crates and `tauri-plugin-updater`. A renamed crate is not caught by a name ban; lockfile changes are reviewed.

## Checks

Every command keeps its toolchain, caches and output under `D:\dev`.

- `powershell -NoProfile -File desktop\scripts\check.ps1` runs rustfmt, Clippy with `-D warnings` for the release, smoke and measure feature sets, `cargo test` for the release and smoke sets (the smoke set includes the hidden-window launch), `cargo deny`, `cargo audit`, the `look.css` check, the module scope scan, the release-profile smoke exe through `cargo-tauri`, the `pe-info` import and manifest check of the debug and smoke exes, the pinned `WebView2Loader.dll`, the manifest-warning scan of the build logs, and the check that no `target` or `node_modules` folder exists under `desktop/`. Logs go to `D:\dev\tmp\w4a-check\<time>`.
- `powershell -NoProfile -File desktop\scripts\plant-check.ps1` copies the crate to `D:\dev\tmp\w4a-plant`, plants each forbidden use and expects Clippy to fail on that lint (and pass on the clean copy), plants a ban in `deny.toml`, and runs the module scope scan with its own planted cases.
- `cargo test --no-default-features --features smoke --test hidden_window -- --ignored` is the born-failing proof of the hidden-window test: a copy of the crate that makes its window visible (inside the second monitor's work area, without activation, closed at once) must be caught by the global watch. It refuses to run unless that monitor exists and is not the primary one.
- `node desktop\scripts\copy-tokens.mjs` regenerates `look.css` from `web/src/theme/tokens.css`; never edit `look.css` by hand.
- `node desktop\scripts\pe-info.mjs <exe> [--json | --check [--no-loader]]` reads an exe's manifest, execution level and imports.

The hidden-window test needs the lab's virtual environment (`NQT_LAB`, default `%USERPROFILE%\nq-lab`), a built `web/dist` and Node on the PATH. It starts the fixture backend on port 8796 with its own state folder and `NQT_JOBS=off`, launches the smoke exe with a PATH that holds no MinGW or cargo folder, and watches every top-level window of every process and the foreground window every 100 ms. Tao's event-target window is visible but never drawn (a layered window with no attributes), so the watch judges windows as drawn or not, as W0A found.

## Known limits of stage A

- The GNU host links `WebView2Loader.dll` dynamically (only the MSVC target links the static loader). The import check allows exactly that file, and `check.ps1` pins its hash and Microsoft signature.
- `longPathAware` is left out of the manifest; the write module normalises long paths itself.
- The release build is never launched by an automated run. Its window is shown once the splash has loaded, through the one `show()` in `window.rs`.
