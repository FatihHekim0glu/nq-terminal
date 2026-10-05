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
| `src-tauri/windows/nsis/hooks.nsh` | the installer hooks (`bundle.windows.nsis.installerHooks`): refuse unsafe install folders, create the chosen folder with a protected DACL for the user, SYSTEM and Administrators in the same call (no inherited window), refuse an existing folder that holds anything but product files, read the folder and its entries back, default to `%LOCALAPPDATA%\Programs` (CWE-427, CWE-732) |
| `src-tauri/assets/` | the shell's own pages: `splash.html` and the generated `look.css` |
| `src-tauri/clippy.toml`, `deny.toml` | the static bans and the supply-chain rules |
| `src-tauri/src/` | `main.rs` and one module per concern (below) |
| `src-tauri/tests/` | one file per concern (`hidden_window.rs`, `supervise_*.rs`, `writes_allow.rs`, `downloads.rs`, `ipc_refusal.rs`, `crash_*.rs`, `keys_cdp.rs`, `int1_seams.rs` and the others); `hidden_support/` holds what the hidden-window files share |
| `scripts/` | `check.ps1`, `plant-check.ps1`, `pe-info.mjs`, `copy-tokens.mjs`, and from D5 `advisories.mjs`, `dist-scan.mjs`, `artefact-check.mjs`, `build-release.ps1`, `install-test.ps1`, and from 0.1.2 `bump-version.ps1`, `publish-release.ps1` and `upgrade-owner.ps1` (their tests are in `scripts/tests/`) |
| `harness/` | the measurement harness of gate G2 (D5): `run.mjs`, `report.mjs`, `modes/`, `lib/`, `tests/`; see `harness/README.md` |

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

`main.rs` calls the hooks in this order: `window::scrub_env` first, before any thread exists; `window::policy_check`; then, on the built window, `keys::install`, `window::setup`, `supervise::start` (with the stale-page hook), `writes::on_download_starting` and `crash::install`; `smoke::browser_args`, which can only act on the window builder and so is read just before the build; and `smoke::after_build` last. A window close is held first while `flush.rs` has the page send its pending workspace changes (below); the close then goes on to the supervisor's `shutdown` (a confirmation first when a backtest runs; then stdin closed, five seconds of grace, the job ended); the exit runs it again.

| Module | What it does |
| --- | --- |
| `window.rs` (with `window_folders.rs`, `window_policy.rs`, `window_rebuild.rs`) | scrubs `WEBVIEW2_*` first; refuses to start under a WebView2 policy for this exe; fixes the lab (the picker on first run, the check on every start), the WebView2 data folder (with a protected DACL) and the zoom from the settings file; installs the page bridge, the new-window rule and the stale-page rebuild |
| `keys.rs` | accelerator keys and zoom keys off in the engine, app zoom on the 25% grid, F5, F12, Ctrl+F, Ctrl+P and Ctrl+R left alone |
| `dialogs.rs` | every native dialog, and the only module that calls rfd; fail closed in smoke and measure |
| `supervise.rs` (with `supervise_check.rs`, `supervise_run.rs`, `supervise_shell.rs`) | the shell's one `CreateProcessW`: the venv launcher in a kill-on-close Job Object, the stdin secrets, the handshake and its checks, attach to a live lock, the exit watch and restarts, the navigation check, the stopped page, the close; `run_tool` runs one rebuild tool the same way |
| `stale_page.rs` | the supervisor's answer to a stale or missing page build: rebuild.html, the owner's click, the two rebuild steps through `run_tool` |
| `link.rs` | the only TCP module: `127.0.0.1` only, the listener and peer ownership check, the proof and session calls |
| `flush.rs` | holds the first close request while the page's unsent workspace changes reach the store: it runs the page's hook `window.__NQT_STORE_SYNC__` (a call from the shell into the page; the page calls no command) every 150 ms until nothing is pending, the store is off or unavailable, or 4 s have passed, logs `store_flush` with the outcome, and closes the window again |
| `save_outcome.rs` | the pure parts of the download handler: the `nqt:save-outcome` script that tells the page how a save ended (`saved`, `cancelled`, `failed`; bridgeVersion 2) and the mapping from a refused decision to a word |
| `writes.rs` | the allow-listed, handle-checked write module (`append`, `write_new`, `rotate`, `choose`) and the `DownloadStarting` handler |
| `reads.rs` | `read_lock` (owner and DACL checked on the handle it reads through, as the backend's lock.py does), `read_settings`, `read_log_tail`, each with a size cap |
| `crash.rs` (with `crash/`) | the shell log, the panic report, backend.log rotation, the renderer recovery, the hung-page offer and the diagnostics zip |
| `memory_target.rs` | release 0.2.0: asks WebView2 for its low memory usage target while the main window is minimised or hidden and for the normal one when it comes back (focus alone changes nothing; a window never shown counts as visible; a runtime without the setting is logged once); in the smoke build `smoke.rs` tells it about the harness's simulated minimise, so the minimise mode of the harness exercises it |
| `smoke.rs` (with `smoke_screen2.rs`) | the debugging port with Tauri's default switches re-added in one list; the controller made visible; the `--screen2` placement guard |

## Static bans

`clippy.toml` bans `std::net::TcpStream` (and the other socket types), the `std::fs` read and write functions, `std::process::Command::new`, their raw Win32 counterparts and the window `show()` methods across the crate. The only allow sites are single functions: `get` in `link.rs` (TCP), `read_capped`, `read_lock` and `read_log_tail` in `reads.rs`, `make_parents`, `open`, `move_file` and `delete_by_handle` in `writes.rs`, `ensure_data_dir` in `window_folders.rs` (the WebView2 data folder, created with its protected DACL before the write module is configured), the one `CreateProcessW` in `supervise.rs`, the smoke-only screen 2 helpers in `smoke_screen2.rs` and the release-only `show()` sites in `window.rs`. Test files and `build.rs` carry their own allow with a reason. `deny.toml` takes crates from crates.io only and bans by name the parquet, Arrow, Polars, DuckDB and DataFusion crates, the broker client crates and `tauri-plugin-updater`. A renamed crate is not caught by a name ban; lockfile changes are reviewed.

## Checks

Every command keeps its toolchain, caches and output under `D:\dev`.

- `powershell -NoProfile -File desktop\scripts\check.ps1` runs rustfmt, Clippy with `-D warnings` for the release, smoke and measure feature sets, `cargo test` for the release and smoke sets (the smoke set includes the hidden-window launch), `cargo deny`, `cargo audit`, the `look.css` check, the module scope scan, the release-profile smoke exe through `cargo-tauri`, the `pe-info` import and manifest check of each feature set's debug exe and of the smoke release exe, the pinned `WebView2Loader.dll`, the manifest-warning scan of the build logs, and the check that no `target` or `node_modules` folder exists under `desktop/`. Logs go to `D:\dev\tmp\check\<time>` and the build target is `D:\dev\targets\check`; `check.ps1 -Web` adds the web group of `desktop-check.yml` (`pnpm test:types`, `pnpm test` with the contract hash and vitest, `pnpm test:e2e-types` and `pnpm e2e:offline`, the last one waiting for any other Playwright or vitest run to end). Without `-Web` the script runs none of those; they stay on the BASELINE list of the build plan.
- `powershell -NoProfile -File desktop\scripts\plant-check.ps1` copies the crate to `D:\dev\tmp\w4a-plant`, plants each forbidden use and expects Clippy to fail on that lint (and pass on the clean copy), plants a ban in `deny.toml`, and runs the module scope scan with its own planted cases.
- `cargo test --no-default-features --features smoke --test hidden_window -- --ignored` is the born-failing proof of the hidden-window test: a copy of the crate that makes its window visible (inside the second monitor's work area, without activation, closed at once) must be caught by the global watch. It refuses to run unless that monitor exists and is not the primary one.
- `cargo test --no-default-features --features smoke --test int1_seams -- --nocapture` is the seam run (integration wave INT1) on the lab this tree sits in (`NQT_LAB`, default the `nq-lab` folder of the user profile; it prints a skip with its reason when `terminal` is another tree, unless `NQT_REQUIRE_SEAMS=1`, which `scripts\check.ps1` sets in the lab's own tree and which turns that skip, and the page-source skip of `save_outcome.rs`, into a failure; in another tree `check.ps1` notes that the seam tests prove nothing there). It starts the smoke exe hidden with no `--fixture`, so the real backend starts through the lock, the handshake, the proof and the session, with its state, save, profile and config folders under `D:\dev\tmp\int1`. One launch checks that HOME loads, that the page's store answers on the session, that the injected shell object is the one the page reads and `port_fixed` is false, that GRAB saves a PNG through the page's real bridge into the save folder and nothing else, and that a change made 0.1 s before the close is in the store's file after the backend has stopped (the flush). A second launch on the same state folder, on a new port, finds the saved workspace in the page. A separate test starts a real backend by hand, lets the shell attach to it through the real lock file, and checks that closing the shell does not stop it. Every run is under the global window watch and ends with a lab scan (nothing new under results, data, live or backtests\output but the gate's own access log, nothing new in `terminal\state`, no profile folder on C:). It needs a built, current `web\dist` (`corepack pnpm run build` in `terminal\web`; a stale build makes the backend say so and the shell refuse it).
- `node desktop\scripts\copy-tokens.mjs` regenerates `look.css` from `web/src/theme/tokens.css`; never edit `look.css` by hand.
- `node desktop\scripts\pe-info.mjs <exe> [--json | --check [--no-loader]]` reads an exe's manifest, execution level and imports.

D5 step 1 (building only; nothing here measures a gate figure):

- `check.ps1` also runs the supply-chain steps (`-SupplyChainOnly` runs only those): `cargo deny check`, the born-failing `deny-plant` (a stub crate for every banned name, the updater included, must each fail), `lock-names` (a name pattern over `Cargo.lock`), `cargo audit` (any advisory in the Windows graph fails), `advisories.mjs`, `dist-scan.mjs`, the node tests of `scripts/tests` and `harness/tests`, the tests of the release scripts (`scripts\tests\release_check.tests.ps1`, `install-test.ps1 -SelfTest`, `install-test.tests.ps1` and `upgrade-owner.tests.ps1`) and the order-name scan of `src\*.rs` in `backend\tests\test_safety_ast.py`. The advisory step needs the network and fails (exit 2) when it cannot run. A full run ends with `parity` (the harness start-path parity check: the fixture backend started the shell's way and the plain way must hold the same private working set and thread count; no window). Before anything is built a preflight checks that `web\dist` is current and that no other build holds the target folder (exit 3; `-SkipPreflight` turns it off). `-ShowProof` adds the born-failing no-show proof for the smoke and measure builds; it shows one window on screen 2 for a moment.
- `node desktop\scripts\advisories.mjs [--ack]` lists the Tauri repository's published advisories newer than `state\desktop\advisories.json` (git-ignored); `--ack` records that the owner has read them.
- `node desktop\scripts\dist-scan.mjs [--bundle <folder>]...` fails on a private key, a signing key name or a PRIVATE marker in `web\dist` and in each bundle folder.
- `powershell -NoProfile -File desktop\scripts\build-release.ps1 -Version 0.1.2` builds the release, measure and smoke installers (targets under `D:\dev\targets`), copies the configs and writes `SHA256SUMS` and `PROVENANCE.json` into `D:\dev\release\0.1.1`. It checks the feature sets of each build with `cargo tree -e features -i nq-lab-terminal` (the plain `cargo tree` never lists the root crate's own features) and fails when the tree changed while it ran.
- `node desktop\scripts\artefact-check.mjs D:\dev\release\0.1.2` checks the release folder: one manifest with Common-Controls 6.0, PerMonitorV2 and `asInvoker`; the import allow list; the WebView2 loader hash; no updater (03 section 14 is enforced here: `createUpdaterArtifacts` false, no `plugins.updater`, no updater token in the exe); no smoke-only string in the release or measure exe; an installer script with a folder page, per-user mode and no lab data. Tauri 2 compiles its configuration into the exe as Rust data, so the embedded configuration is checked through the copied config files, the identifier and token scans.
- `powershell -NoProfile -File desktop\scripts\install-test.ps1 -Installer <name>_x64-setup.exe` runs a silent per-user install and uninstall under `D:\dev\d5\install` with no administrator rights and expects 0 windows. The silent installer makes shortcuts unless `/NS` is passed, which the script does; the uninstaller leaves `HKCU\Software\nqlab\nq-lab terminal`, which the script removes. The installed folder inherits the ACL of `D:`, so the owner's runbook still protects `D:\Apps\nq-lab terminal`.
- `node desktop\harness\run.mjs --mode <mode>` and `node desktop\harness\report.mjs <folder> --check` are the measurement harness (see `harness\README.md`); the measuring is W5B.
- `corepack pnpm e2e:desktop` (from the `web` folder; this pnpm refuses `--dir web` from the terminal folder) runs the desktop Playwright project against the hidden smoke build (alone: it waits for any other Playwright or vitest run). Its specs are named `*.desktop.ts` on purpose, so the browser project, which takes every `*.spec.ts` under `e2e`, never matches them. Its window watch (`web\e2e\desktop\watch.ts`, also behind `crosscheck.served` and `smoke_real.ps1 -Mode App`) fails a run only on a window or foreground change of the launched app's own process tree; other programs' are notes in the run's `record.json` (owner decision, 3 October 2026). The look test compares read-only with the baselines in `web\e2e\__screenshots__`, and the project writes only under `D:\dev\d5\app`. Outside the real lab it builds a lab of its own there (the shell refuses a backend whose lab root is not the picked lab).
- `uv run --project qa python -m crosscheck.served` launches the hidden smoke build and compares the bytes it serves with the cached dump bodies of `qa`. Gate G2 needs this and `python -m crosscheck --strict`; neither passes alone.
- `powershell -NoProfile -File scripts\smoke_real.ps1 -Mode App` is the real-data smoke driven through the hidden desktop build (`-SmokeExe` names the exe, `-SelfTest` runs its own born-failing cases). It must run from the nq-lab folder's own terminal folder: the backend confines its reads to the real paths under the lab, so in a worktree it refuses to start and says why. The default browser mode does run in a worktree (the lab comes from `NQT_REAL_LAB`, then `nq-lab` under the profile folder).
- `powershell -NoProfile -File scripts\record_green.ps1 -Check backend|crosscheck|smoke|smoke-app` writes a dated, stamped record to `state\release` (git-ignored) only on a pass with an unchanged tree. `powershell -NoProfile -File scripts\release_check.ps1 -Tag desktop-v0.1.1` accepts only same-day, same-stamp records and a passing artefact check; it never creates the tag.

The hidden-window test needs the lab's virtual environment (`NQT_LAB`, default `%USERPROFILE%\nq-lab`), a built `web/dist` and Node on the PATH. It does not use the owner's lab folder for the backend: the shell accepts a lab only when the backend reports that lab as its ROOT, and ROOT is read from where `nq_lab` is installed, so the test builds a derived lab under `D:\dev\d4\hw\<run>` (the owner's venv launcher and package sources, copied, with one `.pth` file; `terminal` is a junction to this worktree). The smoke exe is started with `--fixture` over it, so the supervisor spawns this tree's real `nq_terminal.desktop.fixture_main` on port 0 in its Job Object, takes the handshake and the session cookie, reaches HOME and closes; the measure build gets a stand-in backend that only waits for its stdin. The exe starts with a PATH that holds no MinGW or cargo folder, and the test watches every top-level window of every process and the foreground window every 100 ms. Tao's event-target window is visible but never drawn (a layered window with no attributes), so the watch judges windows as drawn or not, as W0A found. The watch is global, so another program's window (a game overlay, a game bar) can fail a run that the shell did not cause: such a run is repeated, and the failing window's process is named in the report.

The smoke tests use these loopback ports, one launch at a time per test binary: 8810 (window tests), 8811 (supervisor, unused), 8812 (writes and downloads), 8813 (crash tests). Backends always take port 0.

## Known limits

- Owner-only checks, never run by an automated run: the real keyboard (app zoom through the engine's accelerator hook, F10 against the system menu, Alt with a digit), the screen reader pass, and the release's first-run dialogs (the lab picker, the WebView2 folder choice, the browser update offer). The release's attribution link and its stale-page rebuild click are covered by unit tests and by the smoke build's mocks only.
- There is no menu bar, so the diagnostics export (`crash::export_diagnostics`) and the IB snapshot checkbox have no on-screen control yet: a menu bar changes how F10 and Alt behave, which only the owner's keyboard check can judge. The IB snapshot is a `settings.json` key (`ib_snapshot`) until then.
- The directory-symlink case of the write tests is skipped while developer mode is off (creating the link fails with error 1314), and the 8.3 case is checked only against `C:\PROGRA~1` because `D:` makes no short names; both print their reason.
- The GNU host links `WebView2Loader.dll` dynamically (only the MSVC target links the static loader). The import check allows exactly that file, and `check.ps1` pins its hash and Microsoft signature.
- `longPathAware` is left out of the manifest; the write module normalises long paths itself.
- The release build is never launched by an automated run. Its window is shown once the splash has loaded, through the one `show()` in `window.rs`.
- D5 step 1 builds the measuring tools and measures nothing: no gate figure exists yet. The reproduction of the W0B figures is not yet achieved on launch to HOME ready, so the harness refuses a non-dry row run until its reproduction gate has passed (or labels the figures UNREPRODUCED).
- The simulated minimise reaches only the page-level visibility override: `WM_SIZE` does not hide the WebView2 page and the smoke build has no `smoke-visibility.txt` hook (a polling thread in `smoke.rs` calling `SetIsVisible`), so the engine-level proof is still open. In a smoke build a real minimise leaves `visibilityState` visible.
- The harness's t8 mode hands its shell to the desktop Playwright project through `NQT_DESKTOP_ATTACH_CDP` and `NQT_DESKTOP_ATTACH_URL`; only the self-test and walk specs run in that mode. The pairing is covered by the project's self-test and a type check; a live t8 run with `--playwright` has not yet been made (another Playwright run kept the machine busy), so W5B runs it once and lists which specs pass against the demo server.
- Real-data rows (`eq_warm`, `reg_warm`, the 8,411-fill run, the real GIP day) and the measure build on real data are refused from a worktree outside the lab path and belong to W5B.
- Owner-only and still open: keyboard and screen reader checks on the five release dialogs, zoom 50 to 300% on the installed release, the real print dialog, a real minimise, the real keys (CDP key events skip the host accelerator path), a monitor with a different scale, and the first-launch run after a reboot.
- Open from W4B and not changed by D5: the async failure of `AddScriptToExecuteOnDocumentCreated` only logs (it should fail closed), the UI thread can wait up to 500 ms for a slow proof, and the junction and 8.3 resolution in `window_folders.rs` has no automated test.
- Open: only one workflow exists, `.github/workflows/ci.yml` (web checks and script tests; see `docs/desktop/ci.md`), so three are still unwritten: `desktop-check.yml` (D4.1; `check.ps1 -Web` is its local stand-in), `webview2-drift.yml` (D5.3) and `desktop-release.yml` (D5.4). The MSVC build leg is therefore unbuilt and every figure so far comes from the GNU host; the shipped artefact is meant to come from MSVC, so the first MSVC run belongs to the owner's CI step before G2 closes.
