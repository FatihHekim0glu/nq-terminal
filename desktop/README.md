# desktop: the Windows shell of the nq-lab terminal

The shell is a Tauri 2.12 app in `src-tauri/`. It opens one framed window over the page that the lab's own backend serves, and gives the page no shell command. The plan is in `docs/desktop/02_decision.md`, `03_migration_plan.md` (sections 2, 3, 6, 7, 11, 13, 15 and 17) and `04_roadmap.md` (phase D4). Stage A (D4.1) laid the skeleton, every shared declaration and the checks; stage B (D4.2 to D4.5) filled the modules behind those signatures and stage C (D4.6) merged them: the lab picker and settings, the keys, the guards, the supervisor with its job-contained spawn and the challenge-response proof, the allow-listed write module and downloads, and crash handling. The release is never launched by an automated run; the owner-only checks (real keys, the screen reader pass, the first-run dialogs) are listed under Known limits.

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

`src-tauri/src/smoke_options.rs` holds the one `SmokeOptions` struct, parsed only in smoke builds. It is unchanged since stage A; the behaviour behind each field lives in the module that owns it.

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

Two test variables sit beside the switches, both compiled only into smoke builds. `NQT_TEST_POLICY_ROOT` must start with `Software\nq-terminal-test\` and moves the WebView2 policy check from the real policy keys to `HKCU\<root>\hkcu` and `HKCU\<root>\hklm`, so a test can plant a policy without touching the machine; any other value stops the start. `NQT_SMOKE_FORCE_PANIC` makes a helper thread panic, so a test can see the panic report.

## Modules and hooks

`main.rs` calls the hooks in this order: `window::scrub_env` first, before any thread exists; `window::policy_check`; then, on the built window, `keys::install`, `window::setup`, `supervise::start` (with the stale-page hook), `writes::on_download_starting` and `crash::install`; `smoke::browser_args`, which can only act on the window builder and so is read just before the build; and `smoke::after_build` last. A window close runs the supervisor's `shutdown` (a confirmation first when a backtest runs; then stdin closed, five seconds of grace, the job ended); the exit runs it again.

| Module | What it does |
| --- | --- |
| `window.rs` (with `window_folders.rs`, `window_policy.rs`, `window_rebuild.rs`) | scrubs `WEBVIEW2_*` first; refuses to start under a WebView2 policy for this exe; fixes the lab (the picker on first run, the check on every start), the WebView2 data folder (with a protected DACL) and the zoom from the settings file; installs the page bridge, the new-window rule and the stale-page rebuild |
| `keys.rs` | accelerator keys and zoom keys off in the engine, app zoom on the 25% grid, F5, F12, Ctrl+F, Ctrl+P and Ctrl+R left alone |
| `dialogs.rs` | every native dialog, and the only module that calls rfd; fail closed in smoke and measure |
| `supervise.rs` (with `supervise_check.rs`, `supervise_run.rs`, `supervise_shell.rs`) | the shell's one `CreateProcessW`: the venv launcher in a kill-on-close Job Object, the stdin secrets, the handshake and its checks, attach to a live lock, the exit watch and restarts, the navigation check, the stopped page, the close; `run_tool` runs one rebuild tool the same way |
| `stale_page.rs` | the supervisor's answer to a stale or missing page build: rebuild.html, the owner's click, the two rebuild steps through `run_tool` |
| `link.rs` | the only TCP module: `127.0.0.1` only, the listener and peer ownership check, the proof and session calls |
| `writes.rs` | the allow-listed, handle-checked write module (`append`, `write_new`, `rotate`, `choose`) and the `DownloadStarting` handler |
| `reads.rs` | `read_lock` (owner and DACL checked on the handle it reads through, as the backend's lock.py does), `read_settings`, `read_log_tail`, each with a size cap |
| `crash.rs` (with `crash/`) | the shell log, the panic report, backend.log rotation, the renderer recovery, the hung-page offer and the diagnostics zip |
| `smoke.rs` (with `smoke_screen2.rs`) | the debugging port with Tauri's default switches re-added in one list; the controller made visible; the `--screen2` placement guard |

## Static bans

`clippy.toml` bans `std::net::TcpStream` (and the other socket types), the `std::fs` read and write functions, `std::process::Command::new`, their raw Win32 counterparts and the window `show()` methods across the crate. The only allow sites are single functions: `get` in `link.rs` (TCP), `read_capped`, `read_lock` and `read_log_tail` in `reads.rs`, `make_parents`, `open`, `move_file` and `delete_by_handle` in `writes.rs`, `ensure_data_dir` in `window_folders.rs` (the WebView2 data folder, created with its protected DACL before the write module is configured), the one `CreateProcessW` in `supervise.rs`, the smoke-only screen 2 helpers in `smoke_screen2.rs` and the release-only `show()` sites in `window.rs`. Test files and `build.rs` carry their own allow with a reason. `deny.toml` takes crates from crates.io only and bans by name the parquet, Arrow, Polars, DuckDB and DataFusion crates, the broker client crates and `tauri-plugin-updater`. A renamed crate is not caught by a name ban; lockfile changes are reviewed.

## Checks

Every command keeps its toolchain, caches and output under `D:\dev`.

- `powershell -NoProfile -File desktop\scripts\check.ps1` runs rustfmt, Clippy with `-D warnings` for the release, smoke and measure feature sets, `cargo test` for the release and smoke sets (the smoke set includes the hidden-window launch), `cargo deny`, `cargo audit`, the `look.css` check, the module scope scan, the release-profile smoke exe through `cargo-tauri`, the `pe-info` import and manifest check of each feature set's debug exe and of the smoke release exe, the pinned `WebView2Loader.dll`, the manifest-warning scan of the build logs, and the check that no `target` or `node_modules` folder exists under `desktop/`. Logs go to `D:\dev\tmp\w4a-check\<time>`.
- `powershell -NoProfile -File desktop\scripts\plant-check.ps1` copies the crate to `D:\dev\tmp\w4a-plant`, plants each forbidden use and expects Clippy to fail on that lint (and pass on the clean copy), plants a ban in `deny.toml`, and runs the module scope scan with its own planted cases.
- `cargo test --no-default-features --features smoke --test hidden_window -- --ignored` is the born-failing proof of the hidden-window test: a copy of the crate that makes its window visible (inside the second monitor's work area, without activation, closed at once) must be caught by the global watch. It refuses to run unless that monitor exists and is not the primary one.
- `node desktop\scripts\copy-tokens.mjs` regenerates `look.css` from `web/src/theme/tokens.css`; never edit `look.css` by hand.
- `node desktop\scripts\pe-info.mjs <exe> [--json | --check [--no-loader]]` reads an exe's manifest, execution level and imports.

The hidden-window test needs the lab's virtual environment (`NQT_LAB`, default `%USERPROFILE%\nq-lab`), a built `web/dist` and Node on the PATH. It does not use the owner's lab folder for the backend: the shell accepts a lab only when the backend reports that lab as its ROOT, and ROOT is read from where `nq_lab` is installed, so the test builds a derived lab under `D:\dev\d4\hw\<run>` (the owner's venv launcher and package sources, copied, with one `.pth` file; `terminal` is a junction to this worktree). The smoke exe is started with `--fixture` over it, so the supervisor spawns this tree's real `nq_terminal.desktop.fixture_main` on port 0 in its Job Object, takes the handshake and the session cookie, reaches HOME and closes; the measure build gets a stand-in backend that only waits for its stdin. The exe starts with a PATH that holds no MinGW or cargo folder, and the test watches every top-level window of every process and the foreground window every 100 ms. Tao's event-target window is visible but never drawn (a layered window with no attributes), so the watch judges windows as drawn or not, as W0A found. The watch is global, so another program's window (a game overlay, a game bar) can fail a run that the shell did not cause: such a run is repeated, and the failing window's process is named in the report.

The smoke tests use these loopback ports, one launch at a time per test binary: 8810 (window tests), 8811 (supervisor, unused), 8812 (writes and downloads), 8813 (crash tests). Backends always take port 0.

## Known limits

- Owner-only checks, never run by an automated run: the real keyboard (app zoom through the engine's accelerator hook, F10 against the system menu, Alt with a digit), the screen reader pass, and the release's first-run dialogs (the lab picker, the WebView2 folder choice, the browser update offer). The release's attribution link and its stale-page rebuild click are covered by unit tests and by the smoke build's mocks only.
- There is no menu bar, so the diagnostics export (`crash::export_diagnostics`) and the IB snapshot checkbox have no on-screen control yet: a menu bar changes how F10 and Alt behave, which only the owner's keyboard check can judge. The IB snapshot is a `settings.json` key (`ib_snapshot`) until then.
- The directory-symlink case of the write tests is skipped while developer mode is off (creating the link fails with error 1314), and the 8.3 case is checked only against `C:\PROGRA~1` because `D:` makes no short names; both print their reason.
- The GNU host links `WebView2Loader.dll` dynamically (only the MSVC target links the static loader). The import check allows exactly that file, and `check.ps1` pins its hash and Microsoft signature.
- `longPathAware` is left out of the manifest; the write module normalises long paths itself.
- The release build is never launched by an automated run. Its window is shown once the splash has loaded, through the one `show()` in `window.rs`.
