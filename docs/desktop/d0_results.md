# D0 results: Windows part (waves W0A and W0B)

Status: Windows part complete, written by the W0A merge and completed by the W0B merge on 2 October 2026. **T2 does not fire; the Windows shell stays Tauri 2.** G1 is recorded as PENDING (no Mac). The backend ready baseline is 1,566 ms. The Mac answers to 03 section 24 and the owner's G0 answers are not part of this note (macOS is out of scope tonight). Source notes: `spike_d0/windows/results.md` (probes), `spike_electron/harness.md` (T2 harness), `spike_electron/results/t2.md` (T2 figures), `baseline/d1_preflight.md` (static baseline) and `baseline/backend_ready.md` (backend ready).

Repository head at the start of the wave: `7f8b986` (v2.1). Everything outside the repository sits under `D:\dev`. No window was shown and nothing was focused in any run of this wave.

## 1. Toolchain

| Item | Version | Where |
|---|---|---|
| rustc and cargo | 1.99.0, host `x86_64-pc-windows-gnu` | `D:\dev\rustup`, `D:\dev\cargo` |
| GCC (winlibs) and binutils | 16.2.0 and 2.47 | `D:\dev\mingw\mingw64\bin` |
| tauri-cli | 2.12.1 (148 s to build) | `D:\dev\cargo\bin\cargo-tauri.exe` |
| cargo-deny | 0.20.2 (71 s) | `D:\dev\cargo\bin\cargo-deny.exe` |
| cargo-audit | 0.22.2 (77 s) | `D:\dev\cargo\bin\cargo-audit.exe` |
| WebView2 runtime | 154.0.4258.48 | system |
| Node | 24.13.1 | system |
| Electron (harness only) | 44.5.1 | `D:\dev\spikes\electron` |
| Crates as locked in the probe | tauri 2.12.1, tauri-runtime-wry 2.12.1, wry 0.57.0, tao 0.37.1, webview2-com 0.39.1, windows 0.62.2, tauri-build 2.7.1 | `D:\dev\spikes\d0-tauri\src-tauri\Cargo.lock` |

The three tools were installed with `cargo install --locked` and the merge re-ran their `--version` commands.

Environment correction for the plan's prelude: this Electron installer reads the lower-case `electron_config_cache`, not `ELECTRON_CACHE`. Add `$env:electron_config_cache='D:\dev\electron-cache'` wherever Electron may be installed. The first install put a 158 MB archive on C: before it was moved to D: (C: free space returned to its earlier value; an empty `Local\electron\Cache` folder remains on C:).

## 2. The Windows unknowns, answered

Twenty-one hidden probe launches ran under the global window and foreground watch: 2,935 samples at 100 ms, largest gap 102 ms, 0 drawn new windows from any process (the probe's own tree or foreign), 0 foreground changes, 0 fatal errors. The only new visible window allowed is tao's undrawn `Tao Thread Event Target` (see section 5, item 2); a drawn window from any process, a foreground change, or any other new visible window fails the run. An earlier pass of the explicit `put_IsVisible(TRUE)` row had seen a drawn window from another process on the machine, so it and the first default-route row were re-run alone and came back clean. Every run started with a fresh WebView2 data folder under `D:\dev\spikes\d0-tauri\wv`.

| Question | Answer | Evidence |
|---|---|---|
| P1: browser accelerator keys off through `with_webview` (`ICoreWebView2Settings3`) | **Yes**, by read-back (`AreBrowserAcceleratorKeysEnabled` reads `false`); keys over CDP reach the page and do nothing else | The real-key effect (F5 not reloading) cannot be shown without focus: CDP keys bypass the host accelerator path, so it stays in the owner's keyboard check (03 section 24) |
| `AcceleratorKeyPressed` with accelerators on and off | Fires in both states for keys posted to `Chrome_WidgetWin_1` (kind 0 then 1); never for CDP keys | The shell's own zoom handling can rely on it (03 section 11.1) |
| `zoom_hotkeys_enabled(false)` | **Yes**, `IsZoomControlEnabled` reads back `false` (`true` when left on) | Keyboard zoom itself not observed (no focus); owner check |
| P2: download of a blob export | **Yes, both routes.** Tauri's `on_download` fires with the `blob:` URL (86 ms); `DownloadStarting` with a deferral, the path decided on a worker thread, `put_ResultFilePath` and `put_Handled(TRUE)` finishes in 149 ms with equal bytes | Born-failing correction: the plan's case "without `put_Handled` the engine's default path is used" did NOT fail (our path was still used). The case that does fail is **without `put_ResultFilePath`**: the file goes to the engine's default folder. Also set `ICoreWebView2Profile::put_DefaultDownloadFolderPath` so a missed path cannot land in Downloads on C: |
| P3: `ProcessFailed` through `with_webview` | **Yes**: ending the renderer gives kind 1 (render process exited), reason 2 (terminated), exit code 1; one `Reload` brings up a new renderer and the page loads 60 ms after the event | The shell stays up |
| Controller route: a working, hidden-window page with `put_IsVisible(TRUE)` through `with_webview` | **Yes**, with numbers: `visible` state, 600 animation frames in 2.5 s (240 per second), 25 of 25 timer ticks, on `about:blank` and on HOME, and after 20 s idle, with none of the three spike switches. **The three-switch fallback (03 section 15.4) is not needed on this PC** and stays a smoke-only fallback in the notes | Born failing: an explicit `put_IsVisible(FALSE)` gives `hidden`, 0 frames, 2 of 25 ticks, and HOME never reaches `nqt:home-ready`. The plan's "omit the call" version does not fail, because Tauri 2.12.1 already starts the controller visible (wry calls `SetIsVisible` from its own attribute and Tauri never passes the window's `visible(false)` down). Keep an explicit `put_IsVisible(TRUE)` after build as a guard against a future wry change |
| Job-contained spawn of the venv launcher | **Yes**, through `PROC_THREAD_ATTRIBUTE_JOB_LIST` with a handle list, `CREATE_NO_WINDOW` and `EXTENDED_STARTUPINFO_PRESENT`, inside a kill-on-close job; the suspended, assign, resume route also works as a fallback | The launcher pid differs from the real interpreter pid and the job holds launcher, a `conhost.exe`, interpreter and grandchild; all end 0 to 1 ms after the job handle closes. Accept only a pid that is in `JobObjectBasicProcessIdList`. Born failing: assigning after a plain spawn leaves the grandchild alive 5 s after the close. `cargo test`: 3 passed, 0 failed |

## 3. Manifest finding and fix

- **Finding.** On the GNU host the link prints `ld.exe: .rsrc merge failure: multiple non-default manifests`. The exe holds two RT_MANIFEST leaves (id 1, language 0x0409): Tauri's (Common-Controls 6.0 only, 334 bytes) and MinGW's own `default-manifest.o` (599 bytes, asInvoker plus longPathAware). Windows binds the first leaf, so MinGW's manifest is the one dropped. A combined manifest alone still warns, because MinGW's leaf is still linked. This is the manifest warning of `00_spike_rust.md` and review 2 blocker 2.
- **Fix.** One combined manifest, `src-tauri\app.manifest` (Common-Controls 6.0, `dpiAwareness` PerMonitorV2, `dpiAware` true/pm, `requestedExecutionLevel` asInvoker), given to `tauri_build::WindowsAttributes::new().app_manifest(...)`, plus an empty 20-byte COFF object named `default-manifest.o` written to `OUT_DIR/nodefman` and found first through `cargo:rustc-link-arg-bins=-B<dir>/`. Result: 0 warnings, exactly one RT_MANIFEST with all four entries, comctl32 6.10 loaded at run time, page loaded.
- **Carry-over to W4A.** `D:\dev\spikes\d0-tauri\src-tauri\build.rs` (the "combined" mode only) and `app.manifest` carry over as they are. Whether to add `longPathAware` (MinGW's manifest had it; the plan's list leaves it out) is the W4A builder's decision, to be made if the shell must open paths over 260 characters.
- **Cold release build:** 95.3 s for `cargo tauri build --no-bundle` into an empty release folder, one reading on a loaded machine; rebuilds took 38 to 40 s.

## 4. Import finding and static-link flags

- **No MinGW runtime import.** The fixed release exe (3,262,976 bytes) imports no `libgcc_s_seh-1.dll`, `libwinpthread-1.dll` or `libstdc++-6.dll`, and it starts and loads HOME with a PATH that holds no `D:\dev\mingw` or `D:\dev\cargo` entry. No static-link flag is needed for the MinGW runtime.
- **WebView2Loader.dll is imported on the GNU host.** `webview2-com-sys` 0.39.1 links `WebView2LoaderStatic` only when `target_env = "msvc"`, so no flag alone removes it. Tauri's NSIS bundler already places the DLL beside the exe for `-gnu` targets.
- **Decision for W5A (artefact check and the `pe-info` import check in `check.ps1`).** Allow exactly one non-system import, `WebView2Loader.dll`, and pin it: Authenticode Valid, signed by Microsoft Corporation, product "Microsoft Edge Embedded Browser WebView Loader", version 1.0.3800.47, sha256 `86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5`. Everything else must be `KERNEL32`, `ntdll`, the `api-ms-win-crt` and `api-ms-win-core` sets and the usual Windows system DLLs. `D:\dev\spikes\d0-tauri\tools\pe-read.mjs` (Node built-ins only) dumps RT_MANIFEST, the import table and the delay-import table and is the base for `pe-info.mjs`.
- **Static loader with a hand-written MSVC runtime shim.** It works (system imports only, page loads with a clean PATH) but leaves four "corrupt .drectve" linker warnings, was tested in one launch, and puts a hand-made stand-in for MSVC runtime internals inside the code that loads the browser engine. Not recommended; shipping the signed 160 KB DLL beside the exe is the recommendation. The only clean fully static route is the MSVC host, which is not available here.

## 5. Carry-overs for waves W2B to W5A

1. **Browser arguments (smoke builds).** `additional_browser_args` replaces Tauri's own switches. Re-add them as ONE merged list, for example `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection[,...]`; Chromium keeps only the last copy of a repeated switch. No Chromium occlusion switch is needed.
2. **Global window watch (W4B crash-smoke, W5A harness, `release_check`).** Every Tauri launch creates tao's `Tao Thread Event Target` window. It is `WS_VISIBLE` but `WS_EX_LAYERED` with no layered attributes set, so it is never drawn; a rule of "any new visible top-level window fails" fails every launch. Use the drawn test of `src\bin\winwatch.rs` (visible, not cloaked, non-zero area, not a layered window without attributes or with alpha 0), or allow this one class from the launched pid. The watch should also tell windows of its own process tree from foreign ones, because other work on the machine shows windows too. The T2 harness classes the same window as inert (a layered, click-through, no-activate tool window of at most 5 by 5 pixels at (0, 0)).
3. **W4B writes-downloads.** Deferral route as described in section 2, always with the result path set, `put_Handled(TRUE)` and the profile default folder as a backstop. The born-failing test becomes "without `put_ResultFilePath`".
4. **W4B crash-smoke.** `add_ProcessFailed` through `with_webview`, kind 1 and reason 2 on a killed renderer, one `Reload` recovers.
5. **W4B window-keys.** `AcceleratorKeyPressed` fires with browser accelerators on and off. Keys over CDP never raise it, so the key smoke cannot prove what F5 or Ctrl plus do on a real keyboard; that proof stays in the owner's keyboard check.
6. **W2B and W4B process supervision.** `CreateProcessW` with `PROC_THREAD_ATTRIBUTE_JOB_LIST` plus a handle list, `CREATE_NO_WINDOW` and `EXTENDED_STARTUPINFO_PRESENT`, inside a kill-on-close job; accept only a pid in the job's process id list (it also contains a `conhost.exe`). Hold the process handles from the moment the pids are read and end a survivor through its own handle, never by reopening a pid after the handles are released (a recycled pid could belong to an unrelated process).

## 6. T2 harness (Electron 44 against the Tauri spike shell): built in W0A, measured in W0B (section 9)

`D:\dev\spikes\t2\t2.mjs` and its libraries launch each shell hidden against one fixture backend (port 8800, debugging ports 9351 for Electron and 9352 for Tauri), apply the 60 s CPU gate (limit 10%, rejected runs kept, `--provisional-after N` for manager decision 2), run the window and foreground watch and take memory at HOME and after the heavy set. Self-tests passed: `--verify` 6 of 6, `--throw` 5 of 5, `--watch` 3 of 3, `--gate` 4 of 4. One dry run per shell reached HOME with 0 new visible windows and 0 foreground changes. No T2 number exists yet, and the dry-run figures are ungated single runs. Reference: `spike_electron/harness.md`.

Hardening made at the release check, each with a born-failing test first: the window watch now counts an owned top-level popup (a dialog) as shown, because it used to drop any window with a parent (`--watch` 4 of 4); the tree walks and the teardown adopt a child only if it was created after its parent and kill only recorded pids whose creation time and image name still match, without `/T` (`survivors.test.mjs` 10 of 10); the probe classifier fails on a drawn window from any process, any foreground change or an unexpected undrawn window (`drive/lib.test.mjs` 9 of 9); and the job-spawn test terminates a survivor through the handle it already holds, never by reopening a pid (`cargo test --test job_spawn` 6 of 6). Re-run after these changes: `--throw` 5 of 5, `--gate` 4 of 4, `--verify` 6 of 6 and one dry run per shell (both reached HOME, 0 new windows, 0 foreground changes, no survivors).

**Finding that needed a decision before W0B (taken by default, settled in section 9).** A hidden Electron window (`show: false`, `paintWhenInitiallyHidden: true`, `backgroundThrottling: false`) reports `visibilityState` visible and runs timers normally, but `requestAnimationFrame` runs at about 0.8 a second at idle, against about 240 a second for the Tauri spike. HOME ready then comes only from the 400 ms timer fallback (about 3 s against about 1 s for Tauri), the pivot and GIP steps are 5 to 6 times slower, and the last docked panel timed out after 45 s. Three Chromium switches, `beginFrameSubscription` and `disableHardwareAcceleration` did not help. Only `--electron-mode osr` (offscreen rendering) restores 60 frames a second and HOME ready at about 0.84 s, but it reads 225 MB at HOME against 154 MB because the rendering path changes. As specified, hidden Electron figures are not comparable with Tauri. Options: keep hidden and report with the caveat (`idleHealth` is recorded per run); use `osr` and state that its memory includes the offscreen path; or allow a no-focus window on screen 2 (needs the watch relaxed and a 1080-wide viewport for both shells). Under manager decision 3 the recommended default for tonight is the first option, recorded as PROVISIONAL, with the `osr` figures taken as a labelled side row.

## 7. Static baseline

Full detail in `baseline/d1_preflight.md`. Facts taken from it:

- **Routes.** 78 distinct method and path pairs and 75 contract paths (installed FastAPI 0.141.1: list routes through `fastapi.routing.iter_route_contexts(app.routes)`, which gives 79 contexts; `len(app.routes)` is 23). Two non-GET operations: `POST /api/jobs` and `DELETE /api/jobs/{job_id}`.
- **Screenshots.** 210 PNG baselines under `web/e2e/__screenshots__` (03 recorded 204).
- **Research files.** sha256 values of `ledger.csv`, `registry.csv`, `oos_openings.json` and `oos_access_log.jsonl` recorded, 5,799 log lines, all unchanged after the wave's suites.
- **Import profile.** `python -X importtime -c "import nq_terminal.__main__"`: 1,503, 1,457 and 1,454 ms, median 1,457 ms (loaded machine). About 510 ms is `scipy`; moving the 10 `scipy.stats` lines alone will not do it, because `nq_lab.calendar_stats` and `nq_lab.sizing_stats` import `scipy` at module level and three terminal lines pull them in (`analytics/validity.py:30`, `analytics/relative.py:25`, `services/tearsheet.py:28`). These belong in W1A slice A1. Pandas deferral does not pay inside the terminal's files.
- **Owner backend.** Port 8765 owned by pid 49476, no `--reload`, unchanged through the wave; no STOP-CHAIN.
- **State.** `terminal/state` holds only `jobs.json` (queued 0, running 0).
- **Suite counts.** Section "Suite counts" of `baseline/d1_preflight.md`; the headline numbers are repeated in section 8.

## 8. Suite results at the end of the wave

Run by the merge at head `7f8b986`, with the wave adding only untracked files. Full figures and the `e2e:offline` explanation are in `baseline/d1_preflight.md`.

| Suite | Result |
|---|---|
| Backend pytest | 2,989 passed, 1 skipped, 0 failed |
| QA tests | 299 passed |
| `crosscheck --strict` | PASS 2,455, FAIL 0, SKIP 0, INFO 104 |
| `test:types`, `test:e2e-types` | both clean |
| vitest (with the contract check) | 467 files, 6,930 passed, 45 skipped |
| `build` and bundle check | passed; shell 109.5 of 114.9 kB gzip |
| `e2e` | 387 passed, 0 failed |
| `e2e:perf` (alone) | 3 passed; loaded-machine reference (CPU 15.3% against a 10% limit); HOME ready median 593 ms |
| `e2e:offline` | 100 passed, 1 skipped, 88 failed: 87 for missing `offline-win32` screenshot baselines (never made on this machine) and 1, `volmanaged_v0 RET settles with no alert`, which fails the same way when re-run alone; recorded as baseline state |

Wave checks:

- **Git.** `git status --porcelain` shows only `docs/desktop/03_appendix_a_addendum.md`, `docs/desktop/baseline/`, `docs/desktop/spike_d0/`, `docs/desktop/spike_electron/` and this note, all untracked. No tracked file changed and no git write was made. The addendum has no new rows this wave.
- **Tools.** `cargo-tauri` 2.12.1, `cargo-deny` 0.20.2 and `cargo-audit` 0.22.2 answer `--version` from `D:\dev\cargo\bin`.
- **C: free space.** 125,074 MB at the start of the probe slice, 125,070 MB at the end of the merge (a fall of 4 MB, far under 100 MB, and 125 GB is far above 10 GB). The reading dipped to 123,677 MB (1.4 GB under the start) while the `e2e` run was in progress: its Playwright traces grew to 1.3 GB under the git-ignored `web/e2e/.results` (the `--output` flag passed through `pnpm` was not honoured, so the config's own folder on C: was used), and they are removed as tests pass; the figure recovered once the run ended. The plan's stop rule (a fall of 100 MB or more) was therefore crossed transiently by the repository's own `e2e` artefacts, not by an install; it is worth giving later waves a folder on D: for these artefacts (for example through an environment-variable override of `outputDir` in the Playwright config, a change for the W1A owner to make). Nothing was installed on C:. No `EBWebView` folder was created on C: during the wave.
- **Port 8765.** The listening owner is pid 49476 before and after; it was never touched. The suite ports (8795, 4273, 8796) and 8800 had no listener after the suites.
- **Research files.** sha256 values unchanged from the wave start: `ledger.csv` `3132B5A9...B98E`, `registry.csv` `E56E6AEA...F202`, `oos_openings.json` `3FEEF9AB...E4B0`, `oos_access_log.jsonl` `42521E2F...E648` (5,799 lines).
- **`terminal/state`.** Before and after: only `jobs.json` (1,072 bytes, 01/10/2026 23:15:18). No new file or folder.
- **Prose and commit-hook scan.** The prose checker passes the new Markdown (benign warnings only: two list triads in the baseline and addendum tables, and a CDP method name in the harness note); no Markdown file has a carriage return or an em or en dash; the commit-hook word scan has 0 hits over tracked and untracked files.
- **Provenance.** Head `7f8b986202f46bd81c5517180bbe096a2ec7d8fb`; tracked diff empty (0 bytes); untracked stamp: sha256 `bfd067063df5dd04f40aada9afe9114193727f9d03371b93502d1672ef7f0783` over the sorted names (newline-terminated) and contents of the 19 untracked files other than this note, listed by `git ls-files --others --exclude-standard`. The plan's diff-hash command, run through a PowerShell pipe, mis-hashes empty input; hash the diff bytes from Python (see `baseline/d1_preflight.md`).

Release check re-run after the hardening above, same head and tree apart from this note: backend 2,989 passed and 1 skipped (the order-call ban and the line-ending tests included, 213 passed when run alone), QA 299 passed, `crosscheck --strict` PASS 2,455, FAIL 0, INFO 104, `test:types` and `test:e2e-types` clean, vitest 6,930 passed and 45 skipped, `build` passed (shell 109.5 of 114.9 kB gzip), `e2e` 387 passed, `e2e:perf` 3 passed (loaded-machine reference), `e2e:offline` 100 passed, 1 skipped, 88 failed (the same 87 missing baselines and 1 demo case as before), and the real-data smoke passed. The smoke is the only step that reads prices: it added 67 lines to `oos_access_log.jsonl` (5,799 to 5,866), all caller `terminal`, vendor or repaired variants, every window ending at or before 2022-01-01; `ledger.csv`, `registry.csv` and `oos_openings.json` are unchanged. Playwright ran with its output folder on D: (`--output`), so C: free space stayed within 25 MB of the start (125,040 to 125,015 MB at the lowest). Port 8765 stays with pid 49476, `terminal/state` still holds only `jobs.json`, no listener remains on 8795, 4273, 8796 or 8800, and no `EBWebView` or `dev.nqlab` folder was created on C:.

## 9. T2 result (wave W0B)

Full tables, every run and the method are in `spike_electron/results/t2.md`. The measurement ran alone in a quiet machine window, with no build, cargo, Playwright or pytest run of this project alive, after a gate self-test (planted spin rejected at 28.2%, control accepted at 3.0%). The figures are from the second pair of sessions, taken after a harness defect (below) made the heavy-set reading of the first pair unusable.

**Verdict: T2 does not fire.** The rule is applied as 02 section 6.5 and 04 D0.2 word it, with no new threshold. The rule-bearing row is the hidden Electron window, taken as the provisional default for tonight under manager decision 3.

| Part of the rule | Electron median | Tauri median | Gap | Needed | Met |
|---|---|---|---|---|---|
| Private memory at HOME | 150.7 MB | 164.9 MB | 8.6% lower | 15% lower | no |
| Private memory after the heavy set | 325.3 MB | 369.5 MB | 12.0% lower | 15% lower | no |
| Both memory readings (the rule says "at HOME and after the heavy set") | | | | both | **no** |
| Launch to HOME ready | 3,009.5 ms | 834.5 ms | 2,175 ms slower | 300 ms faster | **no** |

- **Runs.** Hidden session: Electron 10 accepted, Tauri 10 accepted, 0 rejected by the CPU gate, 0 provisional, 0 failed, 0 heavy-incomplete. Side session (offscreen rendering): 10 and 10 accepted, the same zeros. Every metric has 10 readings per shell in each session (`t2.mjs --verify-results`, one call per session folder, `enoughByMetric`). All 40 gated runs read 2.5 to 3.2% over 60 s (limit 10%), so no figure is provisional on load grounds. Every run saw 0 new visible windows and 0 foreground changes (the Tauri runs each record their one inert `Tao Thread Event Target` window) and left 0 survivor processes.
- **Side row, labelled (offscreen rendering).** Electron 214.9 MB at HOME against 166.6 MB (29.0% heavier), 473.4 MB after the heavy set against 373.4 MB (26.8% heavier), launch 754 ms against 832.5 ms (78.5 ms faster). It does not fire either, so the verdict does not depend on the choice of row.
- **Noise test.** Not needed for the verdict. It would have passed for both memory readings (Electron medians 150.7 and 325.3 MB under Tauri's worst runs of 168.4 and 375.2 MB) and failed for launch (3,009.5 ms against a Tauri worst of 892 ms).
- **Caveat on the hidden row.** The hidden Electron window ran `requestAnimationFrame` at 0.8 a second in all 10 runs (Tauri about 240), so HOME ready came from the 400 ms timer fallback and nothing was drawn; its memory is probably understated (JavaScript heap after the heavy set 42 MB against 57 to 63 MB for Tauri). The offscreen row, which does paint, is 27 to 29% heavier than Tauri, the other way. The verdict is the same on both.
- **Heavy-set defect (cause now known, fixed).** In the first pair of sessions the sixth docked panel, `volmanaged_v0 DES`, timed out (45 s) in all 10 hidden Electron runs and in 6 of the 10 offscreen runs; Tauri never failed it. A diagnostic launch showed that with six docked panels the panel is 198 px wide, its charts collapse to height 0 and never draw, so their `aria-busy` never clears, in Tauri as well as in Electron, with identical layouts and no script error. The strict wait of the original benchmark passed in Tauri only because it ran before those charts mounted. Forced frames did not change it, so frame starvation is not the cause. The heavy set now waits for docked panels with a height-aware test (`D:\dev\spikes\t2\lib\dockwait.mjs`, 7 cases in `dockwait.test.mjs`, written first and failing), the harness marks any run with a heavy-set error `heavy-incomplete` (`heavy.test.mjs`, 11 cases), and the second pair has no incomplete run. The first pair is kept as superseded evidence; its HOME and launch readings agree with the second pair and its verdict was the same.
- **Evaluator defect, corrected.** `evaluateT2` in the harness combined the two memory readings with "or", against the "and" of the document, so `--verify-results` printed `t2Fires: true` for the first hidden session. A born-failing synthetic case was added first (heavy-set memory 23% lower, HOME memory 7% lower: must not fire; it failed), the evaluator now requires both readings, `selftest.mjs --verify` passes 7 of 7, and `--verify-results` prints `t2Fires: false` for every session.
- **Consequence.** The W4A onward block and the owner's O4 choice are not triggered; the Tauri path continues.

## 10. G1 and O2

- **G1 is PENDING.** There is no Mac (owner's order of 2 October 2026), so the WebKit and JavaScriptCore checks of 04 D0.3 and D0.4 are not run and the Mac kit is deferred. G1 is neither passed nor failed. Nothing in this note claims a Mac result.
- **O2 is at its default (yes): Windows shell work starts before G1.** The stated risk is unchanged from 04: if G1 later fails, moving the Windows shell to the Electron variant (or a split shell under 02 section 8.3) costs about 3 to 5 weeks of Windows work already spent. The shell-neutral waves W1A to W3B carry no such risk.
- **Provisional items.** The hidden Electron row is provisional by manager decision 3 (the plan's recommended default for the owner's decision on how to read an Electron window that does not paint). If the owner chooses a visible screen-2 Electron window later, T2 can be re-read with the same harness; that row was not measured (owner decision 10).

## 11. Backend ready baseline

Full detail in `baseline/backend_ready.md`.

- **Median of 3: 1,566 ms** (1,595, 1,560 and 1,566 ms; range 1,560 to 1,595 ms), process start to the first 200 from `/api/health` on the real backend, port 8797, quiet machine, CPU gate readings 4.5, 2.7 and 4.4% (limit 10%), 0 rejected. This is the run of the hardened script (gate enforced before each start, identity-checked stop). An earlier run of three, taken with the first version of the script straight after the first T2 sessions, read 1,584 ms (1,662, 1,565, 1,584; gates 2.7, 2.5, 2.7%); the two medians are 18 ms apart.
- This is the figure D1 is judged against (04 D0.5, standing rule 15). The D1 target is 1.5 s and the ceiling 2.5 s: the baseline sits 66 ms above the target and 934 ms under the ceiling. The W0A import-time median (1,457 ms) is most of it.
- 0 survivors after each run, port 8797 freed, 0 windows, `gate_reads_this_process` 0 (no prices were read), `terminal\state` unchanged, the owner's 8765 backend (pid 49476) untouched.
- The current code ignores `NQT_STATE_DIR` and `NQT_JOBS`; they are set so the command stays valid once the code reads them. Later re-measures (W1B, W3B) use the same script, `D:\dev\spikes\t2\runs\backend_ready.mjs` (`node backend_ready.mjs --runs 3 --port 8797`), so the method matches. A re-measure whose gate reads above 10% now keeps a rejected record and retries; after 5 rejections in a row it takes the run labelled PROVISIONAL; its median counts accepted runs only.

## 12. W0B merge checks

Run after the second pair of T2 sessions, at head `7f8b986`, the wave adding only untracked files under `docs/desktop` and harness changes outside the repository. The machine was busier during the suites than during the measurements (total CPU 16 to 62% in a spot check after the suites, against 2.5 to 3.2% in the T2 gates), which matters for the two end-to-end start-up timeouts below.

| Suite | Result |
|---|---|
| Backend pytest | 2,989 passed, 1 skipped, 0 failed (224 s); the order-call ban (`test_safety_ast.py`) and the line-ending tests are inside it |
| QA tests | 299 passed |
| `crosscheck --strict` | PASS 2,455, FAIL 0, SKIP 0, INFO 104 |
| `test:types`, `test:e2e-types` | both clean |
| vitest (`--maxWorkers=8`) | 467 files, 6,930 passed, 45 skipped |
| `build` and bundle check | passed; shell 109.5 of 114.9 kB gzip |
| `e2e` (2 workers, output folder on D:) | three full runs: 386 passed and 1 failed, 386 passed and 1 failed, then **387 passed, 0 failed**. The two failures were different tests, each a 10 s start-up timeout on a busy machine (`p11.spec.ts` "evt 1920x1080": no panel appeared; `books.spec.ts` "seal 1366x768": the command line still held its text after Enter); the same spec files then passed 3 times over (78 of 78 and 45 of 45), and no source file changed |
| `e2e:perf` (alone) | 3 passed; HOME ready median 585 ms against the 1.5 s budget; GIP zoom p95 18.0 ms; 8,411-fill grid opens in 67 ms |
| `e2e:offline` | not re-run (no source file changed; the W0A baseline state of 87 missing screenshot baselines plus 1 demo case stands) |
| Real-data smoke | passed; added 67 lines to `oos_access_log.jsonl` (5,866 to 5,933), all caller `terminal`; `ledger.csv`, `registry.csv` and `oos_openings.json` unchanged |
| T2 evidence | `t2.mjs --verify-results` on `runs\main-hidden-v2`: 10 Electron and 10 Tauri accepted, 0 rejected, `t2Fires` false; on `runs\side-osr-v2`: 10 and 10, 0 rejected, `t2Fires` false; every metric 10 readings per shell; harness tests 50 of 50 (`node --test`), `selftest.mjs --verify` 7 of 7 |

- **Git.** `git status --porcelain` shows only untracked paths under `docs/desktop` (the addendum, `baseline/`, `d0_results.md`, `spike_d0/`, `spike_electron/`). No tracked file changed and no git write was made.
- **C: free space.** 124,987 MB at 09:00, 124,562 MB at the start of the T2 sessions, 124,536 MB after them, 124,528 MB after the suites and smoke, and 124,080 MB at the end. Two falls of about 425 MB and 448 MB happened outside every measurement and suite: the first in the hour before the sessions (while only diagnostic launches ran, all writing to D:), the second between the end of the smoke and the final scans (while only document edits, the prose checker, 2 backend tests and the harness unit tests ran). The free-space log taken every 20 s during the sessions stayed within 11 MB, the whole run of suites moved it by 34 MB, and a control run of the harness unit tests, of the prose checker and of the same 2 backend tests moved it by 0 MB, so the falls are not from this work; the cause was not traced (no install, the page file is fixed-size). The harness, the diagnostics and the Playwright runs all wrote to D:. Both falls cross the plan's 100 MB stop rule, so the owner should look at what else wrote to C: that morning.
- **Port 8765.** Pid 49476 before and after. No suite or measurement port (8795, 8796, 8797, 8800, 4273, 8953, 4953, 9351, 9352) has a listener left; no Electron, `nq-shell` or Node process and no Python process started after 09:00 is still running.
- **Research files.** `ledger.csv` `3132B5A9...B98E`, `registry.csv` `E56E6AEA...F202`, `oos_openings.json` `3FEEF9AB...E4B0` unchanged; `oos_access_log.jsonl` now `D79559AE...` with 5,933 lines (the smoke's 67 reads; the baseline for later waves is 5,933).
- **`terminal\state`.** Before and after: only `jobs.json` (1,072 bytes, 01/10/2026 23:15:18). No new file or folder.
- **Prose and commit-hook scan and provenance.** See section 14.

## 13. Open items

- **Owner decision, phase boundary (D0 done).** There is no standing go for local commits (owner decision 2), so the chain pauses here for the owner's commit of the D0 documents, listed in section 14. Under manager decision 1 the manager commits after a green phase and treats this tree as the base. W1A to W3B are shell-neutral and may continue on the owner's go.
- **G1 pending** until a Mac session (section 10). The Mac kit (04 D0.3) is deferred.
- **Hidden Electron frame starvation** stays the weak point of the T2 evidence (section 9): the hidden window paints nothing, so its memory is probably understated. It matters only if T2 is ever re-read; the offscreen side row is the cross-check.
- **Heavy set at six docked panels.** The `volmanaged_v0 DES` charts collapse to height 0 and stay `aria-busy` in every shell (section 9). The harness now tolerates it for both shells; the W5B harness should either keep the height-aware wait or open fewer panels.
- **`e2e:offline`** stays red as baseline state (87 missing `offline-win32` screenshot baselines and 1 demo case that also fails alone). An owner or a later wave needs to run `e2e:offline:baseline`.
- **Playwright output folder.** Point `outputDir` at D: in the Playwright config (W1A owner), so the 1.3 GB trace folder does not use C:.
- **W5A.** Allow exactly the signed `WebView2Loader.dll` beside the exe (pinned sha256 in section 4). Add a kill-on-close Job Object for teardown (W2B and W4B).
- **P1 real-key effect, keyboard zoom, the default download dialog, and the DPI effect and painting at run time:** owner keyboard check and later smoke (not observable without focus).
- **Single loaded-machine readings:** the 95.3 s cold build and the 240 frames a second are not medians.
- **Owner may delete** `D:\dev\targets\tools` (2.4 GB), the dry-run profile folders (155 MB Electron, 105 MB Tauri) and the empty `Local\electron\Cache` folder on C:.
- **Harness location.** The T2 harness and the `backend_ready.mjs` script live under `D:\dev\spikes\t2`, outside any repository; the T2 harness moves into `desktop/harness` in W5A.

## 14. Prose scan, provenance and the D0 commit list

- **Prose checker.** The owner's checker passes `d0_results.md`, `results/t2.md` and `baseline/backend_ready.md`; `harness.md` shows one benign warning (a CDP method name that the checker reads as US spelling). No changed Markdown file has a carriage return or an em or en dash. The commit-hook word scan has 0 hits over tracked files and over all 22 untracked files.
- **Provenance.** Head `7f8b986202f46bd81c5517180bbe096a2ec7d8fb`; tracked diff empty (0 bytes, sha256 `e3b0c442...b855`, the digest of empty input, hashed from Python); untracked stamp sha256 `76f927d314a2fe82f0afc71e7ea0d6de35a2bac9bfd048997c85b8327001a8d7` over the sorted names (newline-terminated) and contents of the 21 untracked files other than this note. The T2 raw records carry their own stamp (`runs\main-hidden\session.txt`).
- **Files for the owner's D0 commit** (all untracked, under `terminal/docs/desktop`): `d0_results.md`, `03_appendix_a_addendum.md`, `baseline/` (`d1_preflight.md`, `backend_ready.md`, `raw/`), `spike_d0/` and `spike_electron/` (`harness.md`, `results/t2.md`). The T2 harness, its raw runs and the backend ready script stay under `D:\dev\spikes\t2`, outside the repository.
