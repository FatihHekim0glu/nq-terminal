# D0 Windows probes (W0A, slice w0a-probes): results

Date run: 2 October 2026, 04:53 to 05:40 UK time. Repository HEAD 7f8b986 (v2.1). Machine: Windows 11 Pro 10.0.26300, WebView2 runtime 154.0.4258.48; Rust 1.99.0 on the `x86_64-pc-windows-gnu` host with winlibs GCC 16.2.0 (binutils 2.47); Node 24.13.1. Crates as locked: tauri 2.12.1, tauri-runtime-wry 2.12.1, wry 0.57.0, tao 0.37.1, webview2-com 0.39.1, windows 0.62.2, tauri-build 2.7.1. Other build slices ran on the machine at the same time, so build times are loaded-machine figures.

Everything lives outside the repository except this note: the probe crate with its drivers sits in `D:\dev\spikes\d0-tauri` (logs in `logs\`), the target folder is `D:\dev\targets\w0a-probes`, and the tool builds used `D:\dev\targets\tools`. Paths below without a drive are relative to `D:\dev\spikes\d0-tauri`.

## Short answers

| Question | Answer | Numbers | Log |
|---|---|---|---|
| The three cargo tools under `D:\dev\cargo\bin` | Yes, all three built from source with `--locked` | tauri-cli 2.12.1 (148 s), cargo-deny 0.20.2 (71 s), cargo-audit 0.22.2 (77 s) | `logs\tools\summary.txt` |
| P0: does the controller route give a working page behind a hidden window, with none of the three spike switches? | Yes. In Tauri 2.12.1 the controller is already visible by default; `put_IsVisible(TRUE)` through `with_webview` keeps it so | `visible`, 600 animation frames in 2.5 s (240 per second), 25 of 25 timer ticks, on `about:blank` as on HOME, also after 20 s idle; 0 drawn windows | `logs\p0\` |
| P0 born failing: controller hidden | Fails as expected | `hidden`, 0 frames, 2 of 25 ticks; HOME never reaches `nqt:home-ready` | `logs\p0\p0-2-off.json` |
| P1: browser accelerator keys off through `with_webview` (`ICoreWebView2Settings3`) | Yes, the setting applies (read back `false`) | F5, F12, Ctrl+F, Ctrl+P, Ctrl+R over CDP: 0 navigations, 0 new targets, 0 `beforeprint`; F1, F8, F9, F10, F11 reach the page listener | `logs\p1\p1-2-accel-off.json` |
| P1 born failing: accelerators on, F5 reloads | Not reproducible without focus: CDP keys bypass the host accelerator path, and keys posted to the hidden, unfocused webview raise `AcceleratorKeyPressed` but go no further | 0 navigations with accelerators on; `AcceleratorKeyPressed` 0 times from CDP keys, twice per posted key (down, up) | `logs\p1\p1-1-accel-on.json`, `p1-5-accel-on-post-widget1.json` |
| `zoom_hotkeys_enabled(false)` | Yes, `IsZoomControlEnabled` reads back `false` (and `true` when left on) | CDP Ctrl+plus, Ctrl+minus and Ctrl+0 change nothing in either case | `logs\p1\` |
| P2a: Tauri's `on_download` fires for a blob export | Yes, with the `blob:` URL, and the bytes match | Requested to Finished in 86 ms | `logs\p2\p2-3-tauri.json` |
| P2b: `DownloadStarting` with a deferral, path decided off the handler, `put_ResultFilePath`, `put_Handled(TRUE)` | Yes, the bytes match and the final path is read by handle | Handler on the UI thread, path decided on a worker thread 50 ms later, completed 149 ms after the event; final path `\\?\D:\dev\spikes\d0-tauri\out\b-57908-1-probe-export.csv` | `logs\p2\p2-2-deferral.json` |
| P2 born failing | Without `put_ResultFilePath` the engine's default folder is used. Without `put_Handled` alone nothing visible changed | see section P2 | `logs\p2\p2-4-deferral-nopath.json`, `p2-1-deferral-nohandled.json` |
| P3: `ProcessFailed` through `with_webview` when the renderer is ended | Yes | kind 1 (render process exited), reason 2 (terminated), exit code 1; one reload brings up a new renderer and the page loads | `logs\p3\p3-1-renderer-kill.json` |
| P4: which manifest does the GNU link drop? | MinGW's own `default-manifest.o` (asInvoker, longPathAware) is shadowed: both manifests stay as duplicate leaves (id 1, language 0x0409) and Windows uses the first, Tauri's | `ld.exe: .rsrc merge failure: multiple non-default manifests`; the process binds comctl32 6.10 | `logs\p4\build-p4-1-tauri-default-cold.log`, `p4-2-run-tauri-default.json` |
| P4 fix: one combined manifest, 0 warnings, all entries present | Yes, with the combined manifest through `tauri_build::WindowsAttributes::app_manifest` and an empty `default-manifest.o` found first through gcc's `-B` | 0 warnings; one RT_MANIFEST with Common-Controls 6.0, PerMonitorV2, true/pm, asInvoker; comctl32 6.10 at run time | `logs\p4\build-p4-3-combined.log`, `p4-3-run-combined.json` |
| P4: one cold release build | Timed | 95.3 s for `cargo tauri build --no-bundle` into an empty release folder (loaded machine) | `logs\p4\build-p4-1-tauri-default-cold.log` |
| P5: MinGW runtime imports in the release exe | None: no libgcc_s_seh-1.dll, libwinpthread-1.dll or libstdc++-6.dll | the exe starts and loads HOME with a PATH that has no `D:\dev\mingw` or `D:\dev\cargo` folder | `logs\p4\p4-3-run-combined.json` |
| P5: WebView2Loader.dll | Imported on the GNU host (webview2-com-sys links it dynamically unless the target is MSVC). Removable only with an MSVC runtime shim, proven tonight but not recommended | see section P5 | `logs\p4\build-p5-2-static-loader-shim.log`, `p5-2-run-static-loader-shim.json` |
| P6: venv launcher started inside a kill-on-close job with `PROC_THREAD_ATTRIBUTE_JOB_LIST` | Yes; the fallback (suspended, assign, resume) also works | real interpreter pid differs from the launcher pid and is in the job list; all three processes end 0 to 1 ms after the job handle closes | `logs\p6\` |
| P6 born failing: assign after a plain spawn | Fails as expected: the interpreter is outside the job, and the grandchild survives the close | job list holds the launcher only; grandchild still alive 5 s after the close | `logs\p6\p6-1-assign-after-spawn.json` |
| Global window and foreground watch over every launch | 0 drawn windows of the probe and 0 foreground changes in 21 runs | 2,697 samples at 100 ms, largest gap 102 ms | `logs\summary.json` |

## Method common to the launches

The probe shell is a copy of `D:\dev\spikes\tauri-shell` extended into `src-tauri\src\main.rs` (window and settings) and `src-tauri\src\hooks.rs` (everything reached through `with_webview`). It is built with `#![windows_subsystem = "windows"]` in every profile, identifier `dev.nqlab.probe`, and one window built with `visible(false)`, `focused(false)`, `skip_taskbar(true)`, `devtools(false)`, 800 by 1000 at the screen 2 origin (-1080, 228), and a fresh WebView2 data folder per run under `wv\<run>`. Any `WEBVIEW2_*` variable is removed from the process at start. Behaviour is chosen by environment variables (`NQ_CTRL_VISIBLE`, `NQ_ACCEL`, `NQ_ZOOM_HOTKEYS`, `NQ_DL`, `NQ_SPIKE3`) and every hook writes JSON lines to the run's `.events.jsonl`.

Browser arguments, set through `additional_browser_args` in the probe only: `--remote-debugging-port=9341 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. `additional_browser_args` replaces wry's default string, so Tauri's three disabled features are re-added by hand. They must be merged into ONE `--disable-features` list, because Chromium keeps only the last copy of a repeated switch; the fallback row (`NQ_SPIKE3=1`) shows the merged form in the browser command line: `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion`.

The page comes from the fixture backend on 127.0.0.1:8796 (`fixture_app`, `NQT_FIXTURE_DIR=backend\tests\fixtures`, `NQT_FIXTURE_LOG_DIR` under the spike folder, `NQT_JOBS=off`), page and API on one origin. It was started once, used by every run and stopped by its own pid tree at the end. Port 8765 was never touched.

The driver is `drive\probe.mjs` with `drive\lib.mjs` (Node built-ins only, every spawn `windowsHide: true`), adapted from `desktop_research/spike_rust/scripts/drive.mjs`. Each run starts the global watch, launches the probe, attaches over CDP 9341, runs the probe body, ends the probe's own tree with `taskkill /T`, stops the watch and writes `logs\<probe>\<run>.json`.

The global watch is `src-tauri\src\bin\winwatch.rs`, a windows-subsystem exe. Every 100 ms it runs `EnumWindows` over all processes plus `GetForegroundWindow`, and records any top-level window that is visible and was not visible at the start, and any change of foreground window. Each new window is recorded with its pid and exe, its class and rectangle, and its styles (cloaking and layered attributes included), and is classed as drawn or not. The driver then splits windows into the probe's own tree and foreign processes.

**Finding for every later watch.** Every Tauri launch creates one WS_VISIBLE top-level window: tao's `Tao Thread Event Target` (style 0x94000000; its ex-style includes WS_EX_LAYERED with no layered attributes ever set, so it is never drawn). tao makes it visible on purpose (its source says it needs WS_VISIBLE to receive WM_PAINT and relies on the layered style to stay unseen). A watch that fails on "any new visible top-level window" fails every Tauri run on this window alone. The smoke and measure guards from W4A on need the drawn test used here (visible, not cloaked, non-zero area, and not a layered window without attributes or with alpha 0), or an explicit allowance for this one class from the launched pid. Foreign windows seen during the night were another slice's spike shell (the same tao window, undrawn) and a CPU-gate test window titled `t2 plant` on screen 2; neither belonged to this slice.

## P0: hidden window and the controller route

Runs, in order (`tools\run-p0.ps1`; the first run `p0-1-none` came before the late measurement and the window classifier were added and is kept as it was):

| Run | Controller | Spike switches | about:blank (state, frames, ticks) | HOME | HOME after 20 s idle |
|---|---|---|---|---|---|
| p0-1-none | default (left as Tauri sets it) | none | visible, 600, 25 | visible, 599, 25 | not measured |
| p0-2-off (born failing) | `put_IsVisible(FALSE)` | none | hidden, 0, 2 | hidden, 0, 2 (HOME never ready) | hidden, 0, 2 |
| p0-3-none | default | none | visible, 599, 25 | visible, 600, 25 (HOME ready) | visible, 600, 25 |
| p0-4-set | `put_IsVisible(TRUE)` | none | visible, 601, 25 | visible, 600, 25 (HOME ready) | visible, 600, 25 |
| p0-5-toggle | FALSE then TRUE | none | visible, 600, 25 | visible, 600, 25 (HOME ready) | visible, 600, 25 |
| p0-6-spike3 | default | the three switches (reference) | visible, 601, 25 | visible, 600, 25 (HOME ready) | visible, 600, 25 |

Each measurement is 2.5 s of `requestAnimationFrame` counting and a `setInterval(100)` tick count in the page. The pass mark is `visible` at both ends, at least 50 frames per second and at least 23 of 25 ticks. The window itself stayed hidden in every run (`IsWindowVisible` false, rectangle -1080, 228 to -262, 1275).

Why the born-failing case needed an explicit `put_IsVisible(FALSE)`: wry calls `controller.SetIsVisible(attributes.visible)` when it builds the webview, and Tauri never passes the window's `visible(false)` down to that attribute, so the controller starts visible (logged `before: true` in every run). It is the controller's visibility, not the parent window's, that decides throttling: with the controller hidden the page is frozen, with it visible the page runs at the display rate behind a hidden window. The pywebview spike froze because WinForms had hidden its control.

Answer: yes. The smoke build needs neither the three Chromium switches nor any extra call; an explicit `put_IsVisible(TRUE)` after build is harmless, and it guards against a future wry change. The three-switch fallback is not needed on this PC.

## P1: keys and zoom

Settings read back through `ICoreWebView2Settings` and `ICoreWebView2Settings3` (`settings` event in each `.events.jsonl`):

| Run | `AreBrowserAcceleratorKeysEnabled` | `IsZoomControlEnabled` | `AreDevToolsEnabled` |
|---|---|---|---|
| p1-1-accel-on (born failing) | true | true | false |
| p1-2-accel-off | false | false | false |
| p1-3-accel-off-zoom-on | false | true | false |

Keys over CDP (`Input.dispatchKeyEvent`, raw key down and key up, 500 ms apart):

- With accelerators off: F5, F12, Ctrl+F, Ctrl+P, Ctrl+R, F1, F8, F9, F10, F11, Ctrl+plus, Ctrl+minus and Ctrl+0 all reached the page's capture-phase `keydown` listener; 0 main-frame navigations, the page marker survived, 0 `beforeprint` events, the CDP target list stayed one `page`, `devicePixelRatio` stayed 1.
- With accelerators on (born failing): F5, Ctrl+R, F12, Ctrl+plus and Ctrl+0 also reached the page and did nothing else: 0 navigations. So the born-failing case cannot be shown over CDP. As expected (03 section 24), CDP key events never raised `AcceleratorKeyPressed` (0 events in every run), which means they do not pass the host accelerator path at all. Only keys that could not open a native window were sent with accelerators on (DevTools are off in the probe).

Keys posted as WM_KEYDOWN and WM_KEYUP with `PostMessage` (`src-tauri\src\bin\keypost.rs`; no focus change, plain keys only, since modifier state cannot be posted):

- To `Chrome_RenderWidgetHostHWND` or `Chrome_WidgetWin_0`: nothing at all happened.
- To `Chrome_WidgetWin_1`: `AcceleratorKeyPressed` fired for every key (kind 0 then 1, key down then key up), with accelerators on (F5) and off (F5, F1, F8, F11). Nothing reached the page and F5 did not reload, because the never-focused webview has no focused element. This confirms the 03 section 11.1 assumption that `AcceleratorKeyPressed` fires whether browser accelerators are on or off, so the shell's own zoom handling can hang on it.

Answer: accelerators off through `with_webview` and `zoom_hotkeys_enabled(false)` both apply (yes, by read-back, with no side effect on CDP keys). Their effect on real keyboard input (F5 not reloading, Ctrl+plus not zooming the engine) cannot be proven with no window and no focus; it stays in the owner's keyboard check, as 03 section 24 already says.

## P2: downloads

The page makes a CSV blob, clicks an `<a download>` and the shell logs every step. In every run the profile's default download folder was first set to `out\default` with `ICoreWebView2Profile::put_DefaultDownloadFolderPath`, so no run could write to the owner's Downloads folder on C: (checked empty of probe files before and after).

| Run | Route | Result |
|---|---|---|
| p2-1-deferral-nohandled (born failing as the plan wrote it) | deferral, `put_ResultFilePath`, no `put_Handled` | Our path was used, bytes equal, and no default download dialog event fired. The plan's expectation (the engine's default path) did not happen |
| p2-4-deferral-nopath (born failing that does fail) | deferral, no `put_ResultFilePath`, no `put_Handled` | The file went to the engine's default folder (`out\default\probe-export.csv` here; normally the user's Downloads folder on C:) |
| p2-2-deferral | deferral, path decided on a worker thread, `put_ResultFilePath`, `put_Handled(TRUE)`, `Complete` on the UI thread | Bytes equal; `GetFinalPathNameByHandleW` gives `\\?\D:\dev\spikes\d0-tauri\out\b-57908-1-probe-export.csv`; 149 ms from the event to `Completed` |
| p2-3-tauri | Tauri `on_download`, destination set, return true | `Requested` with the `blob:` URL, `Finished` with success, bytes equal, 86 ms |

The deferral route as built: `add_DownloadStarting` on `ICoreWebView2_4`, `GetDeferral`, the args and deferral parked in a thread-local map on the UI thread, a worker thread decides the path (no dialog) and hands back only an id and a path, and `AppHandle::run_on_main_thread` calls `put_ResultFilePath`, `put_Handled(TRUE)`, registers `StateChanged` and calls `Complete`. On `COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED` the file is opened with `CreateFileW` and read through the same handle. The default download dialog was watched through `add_IsDefaultDownloadDialogOpenChanged` (closed on open); it never opened in any run.

Answer: yes to both routes. For the shell: always set the result path and Handled, and also set the profile's default download folder, so a missed path can never land on C:.

## P3: renderer crash

`add_ProcessFailed` on the `ICoreWebView2` reached from the controller. The driver listed the probe's process tree, ended only its `msedgewebview2.exe --type=renderer` (pid 60708) with `taskkill /F`, and read the event: kind 1 (`COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED`), reason 2 (`TERMINATED`), exit code 1, empty description. The hook called `Reload` once. A new renderer (pid 17892) started, the page started loading 37 ms after the event and finished 60 ms after it, and the shell stayed up.

Answer: yes, `ProcessFailed` is reached cleanly through `with_webview` in Tauri 2.12.1.

## P4: the manifest on the GNU host

Reader: `tools\pe-read.mjs` (Node built-ins only) walks the resource directory and the import and delay-import tables.

- Born failing (`NQ_PROBE_MANIFEST=tauri-default`): the link prints `ld.exe: .rsrc merge failure: multiple non-default manifests`. The exe holds two RT_MANIFEST leaves, both id 1 and language 0x0409: Tauri's (334 bytes, Common-Controls 6.0 only) and MinGW's `default-manifest.o` (599 bytes: asInvoker plus longPathAware). gcc links that object through its `endfile` spec (`%:if-exists(default-manifest.o%s)`). Windows takes the first leaf: the running process binds comctl32 from the WinSxS `common-controls_6.0` folder (file version 6.10.26100), so Tauri's manifest is in force and MinGW's (with its asInvoker and longPathAware) is the one dropped. The old spike exe shows the same two leaves.
- A combined manifest alone (`combined-only`) still warns, because MinGW's leaf is still linked.
- Fix (`combined`, the default in `src-tauri\build.rs`): the combined manifest `src-tauri\app.manifest` (Common-Controls 6.0, `dpiAwareness` PerMonitorV2, `dpiAware` true/pm, `requestedExecutionLevel` asInvoker) through `tauri_build::WindowsAttributes::new().app_manifest(...)`, plus an empty 20-byte COFF object named `default-manifest.o` written to `OUT_DIR` and found first through `cargo:rustc-link-arg-bins=-B<dir>/`. Result: 0 warnings in the build log, exactly one RT_MANIFEST with all four entries, comctl32 6.10 at run time, page loaded.
- longPathAware: MinGW's manifest carried it; the combined manifest follows the plan's list and leaves it out. Add it to `app.manifest` if the shell must open paths over 260 characters.

Cold release build: 95.3 s wall time for `cargo tauri build --no-bundle` with an empty `release` folder (the registry and the debug build already present, other slices building at the same time). Rebuilds after a build-script change took 38 to 40 s.

## P5: imports of the release exe

DLLs imported by the fixed release exe (`artefacts\p4-3-combined\nq-probe.exe`, 3,262,976 bytes): KERNEL32, the api-ms-win-crt set (environment, heap, locale, math, private, runtime, stdio, string), ntdll, WebView2Loader.dll, bcryptprimitives, advapi32, api-ms-win-core-synch-l1-2-0, api-ms-win-core-winrt-error-l1-1-0, combase, comctl32, dwmapi, gdi32, imm32, ole32, oleaut32, shell32, shlwapi, user32. No delay imports.

- No MinGW runtime DLL (libgcc_s_seh-1.dll, libwinpthread-1.dll, libstdc++-6.dll) is imported, and the exe starts and loads HOME with a PATH holding no `D:\dev\mingw` or `D:\dev\cargo` entry (`p4-3-run-combined`). The Rust GNU target links libgcc statically already.
- WebView2Loader.dll is imported. webview2-com-sys 0.39.1 links `WebView2LoaderStatic` only when `target_env = "msvc"` and `WebView2Loader.dll` otherwise, so no flag alone removes it on the GNU host. The DLL beside the exe is Microsoft-signed (Authenticode Valid, "Microsoft Edge Embedded Browser WebView Loader" 1.0.3800.47, sha256 86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5), and Tauri's NSIS bundler copies it next to the exe for `-gnu` targets.
- Static link experiment (`NQ_PROBE_LOADER=static`, off by default): an import library named `libWebView2Loader.dll.a` that is really `WebView2LoaderStatic.lib`, added through `cargo:rustc-link-search`, is picked up by ld ahead of the dynamic one. The MSVC library then needs MSVC runtime pieces that MinGW lacks: `operator new` and `delete` and `std::nothrow` under MSVC names, `_Init_thread_header`, `_Init_thread_footer` and `_Init_thread_epoch` (thread-safe statics on native TLS), `__security_cookie` and `__security_check_cookie`. A shim of about 100 lines (`src-tauri\shim\wv2msvc.c`, gcc, passed as an object after the libraries) supplies them. mingw-w64 already provides `__guard_dispatch_icall_fptr` and the UCRT the rest. The resulting exe imports only system DLLs, loads no WebView2Loader.dll, starts with the clean PATH and loads HOME (`p5-2-run-static-loader-shim`). It leaves four `corrupt .drectve at end of def file` linker warnings (MSVC linker directives GNU ld does not read).

Recommendation: keep the dynamic loader and ship the signed WebView2Loader.dll beside the exe. The artefact check should then allow exactly that one non-system DLL and pin its signature and hash. The shim works, but it is a hand-made stand-in for MSVC runtime internals (the stack cookie and thread-safe statics) inside the code that loads the browser engine, and that is not worth carrying for one 160 KB signed file. The only clean fully static route is the MSVC host.

## P6: venv launcher in a job

`src-tauri\tests\job_spawn.rs` starts `nq-lab\.venv\Scripts\python.exe -E -s -c <script>` with `CreateProcessW`, `CREATE_NO_WINDOW`, `EXTENDED_STARTUPINFO_PRESENT`, a handle list holding only the stdout pipe, and a kill-on-close job (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`). The script prints `os.getpid()` and the pid of a grandchild (the base interpreter, started with `CREATE_NO_WINDOW`), then sleeps. Every process is opened for SYNCHRONIZE before the job handle is closed, and its end is timed.

| Test | Route | Job list | Ended after the close (launcher, interpreter, grandchild) |
|---|---|---|---|
| p6_1 (born failing) | plain spawn, `AssignProcessToJobObject` after the first output line | launcher only | 0 ms, 1 ms, still alive at 5 s (ended by the test afterwards) |
| p6_2 | `PROC_THREAD_ATTRIBUTE_JOB_LIST` | launcher, conhost, interpreter, grandchild | 0 ms, 1 ms, 1 ms |
| p6_3 | `CREATE_SUSPENDED`, assign, `ResumeThread` (fallback) | launcher, conhost, interpreter, grandchild | 1 ms, 1 ms, 1 ms |

The printed interpreter pid always differed from the spawned pid, so the venv launcher really is a separate process. In the born-failing route the interpreter still died with the launcher, but the grandchild escaped. That fits a launcher that holds its child in its own kill-on-close job that lets grandchildren break away silently; under our job, breakaway is refused, so the grandchild stays in. The conhost.exe in the list is the console host that `CREATE_NO_WINDOW` creates without a window.

`cargo test` (CARGO_TARGET_DIR=D:\dev\targets\w0a-probes): 3 passed, 0 failed (`logs\cargo-test.txt`, `logs\p6\cargo-test-job_spawn.txt`).

Answer: yes. The pid the shell accepts must be the one in the job list, and the spawn must use the job-list attribute (or the suspended fallback), never assign-after-spawn.

## What this means for W4A to W5A

- Re-add Tauri's default features in one merged `--disable-features` list wherever `additional_browser_args` is used (smoke only).
- The hidden-window smoke build needs no Chromium switches; keep an explicit `put_IsVisible(TRUE)` after build as a guard.
- The global window watch must class tao's undrawn event-target window, or every Tauri launch fails it.
- Accelerators off: `ICoreWebView2Settings3::put_AreBrowserAcceleratorKeysEnabled(false)` through `with_webview` works; `AcceleratorKeyPressed` on the controller is the route for the shell's own zoom keys. The real-key effect is an owner check.
- Downloads: `DownloadStarting` with a deferral, result path always set, Handled set, and the profile's default download folder set as a backstop.
- Crash: `ProcessFailed` kind 1, reason 2 on a killed renderer; one `Reload` recovers.
- Build: `src-tauri\build.rs` and `app.manifest` from the spike carry over as they are. Release imports: MinGW runtime none; WebView2Loader.dll shipped beside the exe and allowed by the artefact check.
- JOBS and backend spawn: `PROC_THREAD_ATTRIBUTE_JOB_LIST` with a kill-on-close job.

## Limitations

- No window was shown and nothing was focused, so real keyboard input (F5 or Ctrl+plus; F10 or Alt near the system menu), the visual result of DPI awareness and the default download dialog were not observed. The probe window sat on screen 2 at 100% scale (`devicePixelRatio` 1).
- The watch samples every 100 ms, so a window that appears and vanishes inside one interval could be missed.
- The download born-failing case is shown with the default folder redirected to the spike folder, not with the real Downloads folder.
- The thread-safe-statics part of the loader shim ran in one launch only; it was not stress-tested.
- Build times and the frame rate (240 per second, the display rate) are single loaded-machine readings, not medians.
- C: free space went from 125,074 MB to 125,061 MB over the slice (other slices ran too). No EBWebView or `dev.nqlab.probe` folder was created in the per-user local app-data folder.

## Reproduce

```
. D:\dev\spikes\d0-tauri\tools\env.ps1                      # env prelude for this process only
powershell -NoProfile -File D:\dev\spikes\d0-tauri\tools\install-tools.ps1
cd D:\dev\spikes\d0-tauri\src-tauri; cargo build; cargo test -- --test-threads=1
# fixture backend (from terminal\): NQT_FIXTURE_DIR=backend\tests\fixtures, NQT_PORT=8796, NQT_JOBS=off
<venv python> -m uvicorn fixture_app:app --app-dir backend/tests --host 127.0.0.1 --port 8796
powershell -NoProfile -File D:\dev\spikes\d0-tauri\tools\run-p0.ps1     # likewise run-p1.ps1, run-p2.ps1
node D:\dev\spikes\d0-tauri\drive\probe.mjs p3 p3-1-renderer-kill
powershell -NoProfile -File D:\dev\spikes\d0-tauri\tools\build-release.ps1 -Mode tauri-default -Label p4-1-tauri-default-cold
powershell -NoProfile -File D:\dev\spikes\d0-tauri\tools\build-release.ps1 -Mode combined -Label p4-3-combined
node D:\dev\spikes\d0-tauri\tools\pe-read.mjs D:\dev\spikes\d0-tauri\artefacts\p4-3-combined\nq-probe.exe
node D:\dev\spikes\d0-tauri\drive\probe.mjs p4 p4-3-run-combined --exe D:\dev\spikes\d0-tauri\artefacts\p4-3-combined\nq-probe.exe
node D:\dev\spikes\d0-tauri\tools\summarise.mjs
```
