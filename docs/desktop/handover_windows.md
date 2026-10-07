# Windows hand-over: install, run, update, roll back, release

Status: brought in line with the tree at commit `f2e03bf` (main, D0 to D4, D5 step 1 and the DEC1 owner decisions) on 3 October 2026, for D6. It is still a hand-over draft in one respect: everything that gate G2 or the final regression will measure, and the last commit list, the tag line and the soak result, was a visible placeholder until the follow-up commit after the tag of 4 October 2026 filled them (section 10). Nothing in this document is a measured figure unless it says so and names where it was read. Release 0.2.1 (5 October 2026) is the current published version and the text below is written for it; the 0.2.0, 0.1.2, 0.1.1 and 0.1.0 figures are kept as history. Its three build-dependent values (the installer SHA256, the installer size and the tag) are written into sections 1, 2 and 7 since the tag. Paths with a space are quoted in every command. On 5 October 2026, for 0.1.2, sections 4 and 7 were changed to the owner upgrade script (`desktop\scripts\upgrade-owner.ps1`) and the install test's limits on a PC with the app installed were written down.

The app is a per-user Windows installer, unsigned (see [smartscreen.md](smartscreen.md)), built on the GNU host. The decisions behind it are in [owner_decisions_windows.md](owner_decisions_windows.md) and the owner checks are in [checks/](checks/README.md). No MSVC build, no CI run and no macOS build exist yet. Everything below is Windows only.

## 1. What was built

The terminal keeps its React page and the lab's own Python backend. A thin Tauri 2 shell (Rust) opens one framed window over the page and gives the page no shell command. The decision is in `02_decision.md`, the plan in `03_migration_plan.md` and the roadmap in `04_roadmap.md`.

| Phase | What it delivered | Where to read more |
|---|---|---|
| D0 | Windows toolchain on D:, WebView2 probes, the T2 comparison against Electron (it did not fire, so the shell stays Tauri) | `d0_results.md` |
| D1 | Lazy imports, a result cache, the backend's own state folder (`NQT_STATE_DIR`) | `03_migration_plan.md` section 2 |
| D2 | One backend per lab through a lock file, a challenge-response handshake, a session token on every door, an allow-listed environment for the backend | `03_migration_plan.md` sections 2 and 3 |
| D3 | The workspace store (seven documents under `terminal/state/workspaces`), the page bridge, the stage 1 release | `03_migration_plan.md` section 10 |
| D4 | The Windows shell: supervisor in a Job Object; keys and app zoom; the allow-listed write module; downloads; crash handling; the lab picker | `desktop/README.md`, `d4_integration.md` |
| D5 step 1 | The measurement harness, the desktop Playwright project, the served-JSON comparison, the supply-chain checks, the per-user NSIS package, the artefact check, the dated green records and the release check | `desktop/README.md`, `d5_integration.md` |
| DEC1 | Four owner decisions built: the first launch counted in the cold-HOME cap, the 200% zoom reflow of every maximised panel, the protected install folder with its refusals (`desktop/src-tauri/windows/nsis/hooks.nsh`), and `volmanaged_v0 EQ` inside the desktop caps | `d5_integration.md` (DEC1 sections), register entries 1.1 to 1.4 |
| D5 step 2 | The G2 measurements `4 October 2026 (0.1.1 re-measure): AUTOMATED PASS, OWNER ROWS PENDING. Whole-app idle memory at HOME reads 477.3 MB (453.0 to 484.4 MB over six counted launches) against the 500 MB ceiling and the 400 MB target: inside the ceiling, above the target; on 0.1.0 it read 505.4 MB, over the ceiling (W5B 1,082 MB). The other re-measured rows are inside their ceilings: first-launch cold HOME 3,192.5 ms (0.1.0 3,167 ms), usual-launch cold HOME 2,797 ms, backend ready, splash, warm HOME, EQ and REG, grid, GIP pan and zoom, keystroke. The soak (largest sample 705.8 MB over 2 h, PARTIAL), the simulated minimise (stream back 0 ms, engine level) and the drift run (T8, 14 of 14) are 0.1.0 readings that were not repeated. Open: the measure-artefact rows. Owner-attended rows pending` | `docs/desktop/g2_windows/results.md`, verdict in `docs/desktop/g2_windows/verdict.md` |
| 0.2.1 | A start that survives a slow first identity proof: the backend's identity route is async and reads what it needs once at start-up, the first worker thread starts before READY, and in desktop mode the HOME prewarm waits for READY and the first answered proof; the shell retries an unverified spawn-time proof with a fresh nonce inside the handshake time limit, and the stopped page's Retry starts a new supervised backend; builds remap build-machine paths out of the binaries; tag `desktop-v0.2.1`, installer 3,257,242 bytes | `docs/desktop/g2_windows/results.md`, sections D1 to D6 |
| 0.2.0 | The research launcher (the Start from form of LEDG and RUN, `POST /api/jobs/actions`, anchor re-runs), the job indicator and the anchor badge in the chrome, a retry of the shell's HOME probe and the low WebView2 memory target while the window is minimised or hidden (`desktop/src-tauri/src/memory_target.rs`); tag `desktop-v0.2.0`, installer 3,256,246 bytes | `docs/research_launcher.md`, `docs/desktop/g2_windows/results.md`, sections C1 to C7 |
| 0.1.2 | Idle memory trim of the backend working set after the HOME prewarm and in quiet periods (`backend/nq_terminal/memtrim.py`), the renamed-product install test, the 0.1.1 to 0.1.2 upgrade scenario and the owner upgrade script; tag `desktop-v0.1.2`, installer 3,254,474 bytes | `docs/desktop/g2_windows/results.md`, sections B1 to B7 |
| 0.1.1 | Thread caps for the backend server (`backend/nq_terminal/threadcaps.py`): the OpenBLAS, OpenMP, MKL and NumExpr pools are capped at 2, so that the idle-memory row of G2 fits its ceiling | `docs/desktop/g2_windows/results.md`, sections A1 to A7 |

Release 0.1.1 fixes the one automated row of 0.1.0 that was over its ceiling, whole-app idle memory at HOME (505.4 MB against 500 MB). It caps the maths thread pools of the backend server at 2 (`threadcaps.py`, called from `__main__.py`); measured with an attach driver, the backend went from 68 threads to 13, its committed private bytes from 1,790 to 369 MB and its working set from 262.6 to 246.1 MB. The official row now reads 477.3 MB (`g2_windows/verdict.md`). At the row's reading point the interpreter still holds 24 to 28 threads, because the prewarm workers are alive then, so the 13 is not the figure of the row. A backtest started by JOBS keeps every core. The first launch after an upgrade starts with a cold result cache, because the version bump changes the backend code stamp. Nothing else in the app changed. The tag, installer size and installer SHA256 of 0.1.1 are written after the build (see the placeholders in sections 2 and 7); the tag placeholder stands for the tag name, and the manager adds the commit it names.

What the 0.1.1 build is and is not (the 0.1.0 facts are kept as history):

- Built and checked: the installer, the shell, the backend handshake, the store, the write ban, the research gate and the supply-chain checks. The reference build of `f2e03bf`, at `D:\dev\release-b\0.1.0`, has an installer of 3,253,192 bytes (the ceiling is 30 MB); the artefact check, the 52-step install test and `release_check.ps1` all passed on it on 3 October 2026 (the check reported the self-test WARN that a non-default release folder always gives). The 0.1.0 final installer, built from the release commit `8122c87`, was 3,253,432 bytes, SHA256 `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590` (history). The 0.1.1 installer, built from the 0.1.1 release commit into the folder `D:\dev\release\0.1.1`, was 3,253,307 bytes, SHA256 `3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc`, tag desktop-v0.1.1 (history). The 0.1.2 installer, built from the 0.1.2 release commit into `D:\dev\release\0.1.2`, was 3,254,474 bytes, SHA256 `3ab330927d6b1e1c617163a5ff8089baae8e2da4ac553b2b6527cedf4569f377`, tag desktop-v0.1.2 on `5153496` (history). The 0.2.0 installer, built from the 0.2.0 release commit into `D:\dev\release\0.2.0`, was 3,256,246 bytes, SHA256 `ff7266397131e15d101fa0b38105b0d0f7b855ba1d22f4a688906a4ef2feeb51`, tag desktop-v0.2.0 on `19658fe` (history). The 0.2.1 installer, built from the 0.2.1 release commit into the default folder `D:\dev\release\0.2.1`, is 3,257,242 bytes, SHA256 `34144639ef1a6c633d3ced581bf80362434a3cbd35f806fc229f932a25b1cd20`, tag desktop-v0.2.1 on `3b22af0`, published on the GitHub Releases page on 5 October 2026 and marked latest. A rebuild gives another hash, so do not compare an installer with the figures of another build, a measuring build of the same tree included.
- The four records of the same day on `f2e03bf` (`terminal\state\release`, written by `record_green.ps1`): backend 4,065 passed and 1 skipped, crosscheck strict 2,495 passed and 0 failed followed by the served-JSON comparison, real-data smoke in the browser and in the app mode each with 67 new gate-log lines and the research files unchanged. They describe that tree only; the merge changes the tree, so the final records are made again on main (section 7).
- Not measured by this document: start-up times, memory, and the soak. Whole-app idle memory at HOME is `477.3 MB at HOME (453.0 to 484.4 MB over six counted launches, smoke build, real data, desktop caps, 4 October 2026, release 0.1.1; 0.1.0 read 505.4 MB and W5B 1,082 MB); inside the 500 MB ceiling by 22.7 MB and 77.3 MB above the 400 MB target; backend 275.6 MB, UI tree 195.4 MB, shell 4.3 MB`, the all-day soak peak, a 0.1.0 reading that was not repeated on 0.1.1, is `largest sample 705.8 MB (first sample 698.7 MB, median 674.8 MB, +25.9 MB per hour over the last hour); 2 h (harness stopped at 2 h 5 min by the manager; external sampler), PARTIAL; W5B read 1,577.4 MB over 3 hours`. State these plainly wherever the app is described (risk O01, `05_risks_costs.md`). The soak is a 2-hour real-data run, so it is PARTIAL by the 8-hour rule of the all-day soak template. Its result: the W5C soak ran 2 h (harness stopped at 2 h 5 min by the manager; external sampler), PARTIAL: largest sample 705.8 MB, first sample 698.7 MB, median 674.8 MB, +25.9 MB per hour over the last hour (`g2_windows/results.md`, section 8); not an all-day run.
- Owner-attended rows are still pending: the visible run, the real keyboard, the two screen readers (NVDA, Narrator), the reboot first launch, the real minimise, the real JOBS backtest, the all-day soak, the first SmartScreen run and the by-eye zoom check. G2 status: AUTOMATED PASS, OWNER ROWS PENDING (`docs/desktop/g2_windows/verdict.md`): on 0.1.1 every automated row that was measured is inside its ceiling, idle memory at HOME included (477.3 MB against 500 MB; 505.4 MB on 0.1.0), and the soak, the minimise and T8 stand on their 0.1.0 readings; the owner rows stay pending until the dated files in `checks/` and a repeat measurement say otherwise (`docs/desktop/g2_windows/verdict.md`). The eomtsy research opening is a research step of the lab, not part of the app, and is not in the checks.
- Not built: macOS, the MSVC build leg and the three CI workflows, code signing, an updater (none by design), the four-week dual run.

Release 0.2.0 (tag `desktop-v0.2.0`, published on 5 October 2026) adds the research launcher on top of 0.1.2: the Start from form of LEDG and RUN, `POST /api/jobs/actions` with presets and anchor re-runs, the job indicator in the chrome, the anchor badge and the low WebView2 memory target while the window is minimised or hidden (`desktop/src-tauri/src/memory_target.rs`). The owner-facing description is [`docs/research_launcher.md`](../research_launcher.md). The terminal still writes no ledger, has no updater and makes no outbound network call. The job indicator reads `GET /api/jobs` every 15 s with no job active and every 2 s with one; the backend counts a read of the job list as a background poll (`memtrim.py`), so the quiet-period trim of 0.1.2 still fires at HOME, and a queued or running job still holds it off. Known limitation of 0.2.0, found after the tag and fixed in 0.2.1: about 1 start in 240 stopped on the shell's identity check, because the first start after a Windows Defender signature update can take the backend longer than the shell's 2 s link budget; it existed since 0.1.x and 0.2.1 fixes it (section 8).

Release 0.2.1 (tag `desktop-v0.2.1`, published on 5 October 2026, installer 3,257,242 bytes) changes how a start proves itself and nothing the owner sees on screen. The backend answers the first identity proof from values it read once at start-up and starts its first worker thread before it announces READY; in desktop mode the HOME prewarm now waits for READY and the first answered proof (launcher and browser modes fall back after 3 s). The shell retries an unverified spawn-time proof with a fresh nonce, inside the handshake time limit, and still refuses a wrong MAC or a foreign owner at once. On 5 October 2026, 120 of 120 hidden launches of the smoke build were checked with none refused, READY to the first proof a median of 3.1 ms and at most 4.7 ms (0.2.0: median 16.1 ms, largest 59.8 ms).

### Commit list

Newest first, from `git log` of this tree up to `f2e03bf`. The final hand-over commits are added by the merge step.

| Commit | Date | Subject (shortened where needed) |
|---|---|---|
| `f67d86e, 56d8eb9, 3b22af0` | `2026-10-05` | desktop 0.2.1: the start that survives a slow first identity proof, with builds that remap build-machine paths out of the binaries and a reliability mode in the harness (`56d8eb9`, the release commit); `f67d86e` filled the 0.2.0 release values and `3b22af0` recorded the G2 re-measure for 0.2.1, the tagged commit; the release values of 0.2.1 follow in the docs-only commit after the tag |
| `b650f75, dd57054, 4b5831c, 5a8b9d5, 6cac154, b1adfe2, 5038663, c5bf39f, d1abef7, 19658fe` | `2026-10-05` | desktop 0.2.0: the research launcher, the anchor re-runs and the job indicator (`dd57054`), the merges of 0.1.2 into the 0.2.0 branch with the version set to 0.2.0 (`4b5831c`, `5a8b9d5`, `6cac154`), job list polls that no longer hold off the quiet memory trim (`b1adfe2`), the CI fixes for the hosted runner (`5038663`, `c5bf39f`, `d1abef7`), `b650f75` filled the 0.1.2 release values and `19658fe` recorded the G2 re-measure for 0.2.0, the tagged commit; the release values of 0.2.0 follow in the docs-only commit after the tag |
| `59c83ce, 31baa14, 5153496` | `2026-10-05` | desktop 0.1.2: idle memory trim after the HOME prewarm and in quiet periods (`memtrim.py`), private bytes beside the working set as the leak signal, the renamed-product install test and the 0.1.1 to 0.1.2 upgrade scenario, `upgrade-owner.ps1`, `bump-version.ps1`, `publish-release.ps1`, and the audit fixes (`31baa14`, with the version bump to 0.1.2); `59c83ce` filled the 0.1.1 release values and `5153496` recorded the G2 re-measure; the release values of 0.1.2 follow in the docs-only commit after the tag |
| `656a964, 519a3cb` | `2026-10-04` | perf: cap maths thread pools in the desktop backend server (release 0.1.1), merged by `656a964`; the version bump to 0.1.1 and these documents follow in the manager's commit |
| `8122c87, dd286fd, 09a660d, 6b0ddaf` | `2026-10-04` | the final hand-over documents, the merge and the final regression, one commit per seam |
| `f2e03bf` | 2026-10-03 | fix: desktop window watch judges only the run's own app tree; backend record in parallel |
| `e0834c1` | 2026-10-03 | Merge branch 'desktop/handover' |
| `2024d3b` | 2026-10-03 | feat: desktop owner decisions (first-launch HOME, 200% reflow, protected install folder, EQ at desktop caps) |
| `ed6edcb` | 2026-10-03 | docs: desktop W6 hand-over drafts (runbook, SmartScreen record, decision register, owner checks) |
| `49229b9` | 2026-10-03 | feat: desktop integration of D5 step 1 (installer, harness, served check) into main |
| `ed9a40c` | 2026-10-03 | Merge branch 'desktop/d4' |
| `cc62248` | 2026-10-03 | feat: desktop integration of the D4 shell with D3 (store flush on close, save outcomes, seam tests) |
| `5472d6b` | 2026-10-03 | feat: desktop D5 step 1 harness, app smoke, supply chain and NSIS package |
| `8f8fdf6` | 2026-10-03 | Merge branch 'desktop/d4' |
| `78a5e27` | 2026-10-03 | feat: desktop D3 stage B page on the store, portable links, stage 1 release |
| `76e9cc2` | 2026-10-03 | Merge branch 'main' into desktop/d4 |
| `def7723` | 2026-10-03 | feat: desktop D4 stage B Windows shell (supervision, keys, writes, downloads, crash) |
| `976a64c` | 2026-10-03 | feat: desktop D3 stage A workspace store and page bridge |
| `da2c134` | 2026-10-02 | Merge branch 'main' into desktop/d4 |
| `1bb7b58` | 2026-10-02 | feat: desktop D4 stage A Tauri shell skeleton |
| `bb2af20` | 2026-10-02 | feat: desktop D2 one backend per lab (lock file, challenge-response handshake, session token on every door) |
| `3c06235` | 2026-10-02 | feat: desktop D1 backend speed (lazy imports, result cache, state dir) |
| `af2f164` | 2026-10-02 | docs: desktop D0 Windows results (toolchain, WebView2 probes, T2 Electron comparison keeps Tauri) |
| `7f8b986` | 2026-10-02 | feat: v2.1 served effective members, LV6 placement and live-start cone |
| `84f31c3` | 2026-10-02 | docs: desktop migration research, decision, plan, roadmap, risks |

## 2. Install

### Before the first install

1. Close the terminal on `127.0.0.1:8765` if one is running. On this PC the owner's browser terminal listens there (a read-only check, `Get-NetTCPConnection -LocalPort 8765 -State Listen`, shows the process). A backend started before D2 has no lock file and no token, so the new `start.ps1` refuses to attach to it: "a terminal on 127.0.0.1:8765 has no lock file or token (an older version). Close its window, or stop that process, then start again." Close its window (or stop that process yourself), then start the browser door again with the new launcher:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\Fatih Hekimoglu\nq-lab\terminal\start.ps1'
   ```

   Keep that window open while you use the browser terminal. Closing it closes the pipe that holds the session secrets, and the backend it started stops within 5 seconds. If the app was started first, the launcher attaches to the app's backend instead and starts nothing (section 5).

2. Check the build folder, `D:\dev\release\0.2.1`: it holds the installer `nq-lab terminal_0.2.1_x64-setup.exe`, `SHA256SUMS`, `PROVENANCE.json`, `payload`, `nsis` and `config`. Check the installer's hash against `SHA256SUMS` and against the hand-over note:

   ```powershell
   Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\dev\release\0.2.1\nq-lab terminal_0.2.1_x64-setup.exe' | Format-List Algorithm,Hash
   Get-Content 'D:\dev\release\0.2.1\SHA256SUMS'
   ```

   Expected: `34144639ef1a6c633d3ced581bf80362434a3cbd35f806fc229f932a25b1cd20`. The line in `SHA256SUMS` ends with the installer's name and must carry the same hash (compare without regard to case). `PROVENANCE.json` must name version 0.2.1 and the commit that the tag desktop-v0.2.1 names; if the commit differs, the folder was built from another tree and must be rebuilt. For the record, the 0.2.0 installer read `ff7266397131e15d101fa0b38105b0d0f7b855ba1d22f4a688906a4ef2feeb51`, the 0.1.2 installer read `3ab330927d6b1e1c617163a5ff8089baae8e2da4ac553b2b6527cedf4569f377`, the 0.1.1 installer read `3b45f791bc94bf3df3a9e6c3400ff6e56fc289478f651ed59b1e95c013602efc` and the 0.1.0 installer read `2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590` and its provenance named `8122c877bb00e4f07ce505d5ba0468d6a9858f41`.

3. For a copy that arrived by download, read `smartscreen.md` first.

### Run the installer

Double-click the installer, or run it from PowerShell. It needs no administrator rights and no permission prompt appears; if one does, cancel it.

- **Folder page.** The installer offers a folder page. The default is `%LOCALAPPDATA%\Programs\nq-lab terminal`, under your own profile (the pattern of the VS Code user setup). On this PC C: is almost full, so the recommended folder is `D:\Apps\nq-lab terminal` (owner decision O7 of the roadmap, default D:). Type it into the folder page; a folder you type is used as typed, and only the installer's own default is moved under `Programs`.
- **Protection of the folder.** Whatever folder you choose, the installer creates it with a protected permission list before it writes any file: full control for the current user plus SYSTEM plus Administrators, nobody else, nothing inherited from the parent. After the files are written it reads the list of the folder and of each file back and undoes the install if it is wrong. It follows the pattern of per-user installs of VS Code and Chrome and the two weakness classes they guard against (a program folder that another user can write to, CWE-732, and a search path that another user can plant a file in, CWE-427).
- **What it refuses.** In every case nothing is written and a silent install exits with code 3 (the folder page greys out its Install button for the same targets, without a message on the page): a relative path or a path with a character Windows does not allow in a folder name; a drive root (`D:\`, `D:`, `D:/`); a network path (`\\server\share`, or a mapped network drive); a folder under `Program Files`, `Program Files (x86)` or the Windows folder; a link, a junction or an existing file; an existing folder that another account owns; an existing folder that holds anything other than this program's own files (a planted `dwmapi.dll` would load into the program on every launch); and a folder below a parent that another account could rename away or re-protect (a parent that grants another account delete-child, change-permissions, take-ownership or full control, or that another account owns). A parent that lets Authenticated Users add and change files (Modify), as `D:\` does for its child folders on this PC, is accepted, but that right includes DELETE on the parent: the parent (for example `D:\Apps`) could be renamed away by another account while the app is closed, who then creates its own `D:\Apps\nq-lab terminal\nq-lab-terminal.exe` and have the Start menu shortcut run it. The installer does not test DELETE on the parent. A folder directly below a `D:\` child folder is therefore safe only on a single-account PC. With more than one account on the PC, use the profile default (`%LOCALAPPDATA%\Programs\nq-lab terminal`), or protect the parent yourself first (the runbook command in section 6, run on the parent) so that no other account holds Modify on it. If `D:\Apps` does not exist yet, the installer creates it with the protected list. The words it prints are in the register, entry 1.3. Exit code 4 means the permission list could not be set and exit code 5 means the read-back found a wrong list; both leave nothing installed. The installer never asks to run as administrator.
- **What it creates.** The installer folder holds `nq-lab-terminal.exe`, `WebView2Loader.dll` and `uninstall.exe`, a Start menu shortcut and the uninstall entry under `HKCU`. It does not install the lab, `terminal\state` or any data. It embeds the Microsoft WebView2 bootstrapper, so a missing runtime is repaired during the install (the PC had WebView2 154.0.4258.53 on 3 October 2026).
- **Evidence for these statements.** The install test of the repository (step 4 of section 7) ran 52 steps with 0 failed against the installer of `f2e03bf` on 3 October 2026: a custom folder under a parent that grants Users Modify and Everyone write ended with exactly three entries (the current user, SYSTEM and Administrators), nothing inherited, and no broad writer on the three files; a user file and a lab stand-in beside it survived the uninstall; and seven refusals (a drive root in three spellings, a network path, a junction, Program Files, the Windows folder) each exited with code 3 and left nothing. The default folder under `%LOCALAPPDATA%\Programs` is covered by the opt-in `-DefaultFolder` run (58 steps, 0 failed, on the installer of an earlier DEC1 build). Install test on the final installer: `PASS, 52 of 52 steps on the final installer, 4 October 2026, run with the documented `-AllowForeign` flag (report `D:/dev/d5/install/run-20261004-132557.report.json`); three plain runs each failed only the "0 new visible windows, no foreground change" steps, and in each case the window belonged to another program (Task Manager, Chrome, a terminal window on screen 2), never the installer`.

A silent install uses the argument text of the install test: `/S` is silent, `/NS` skips the shortcuts, and `/D=` names the folder, must come last and has no quotes around it, even when the path has a space. The installer is a window program, so a plain `&` call does not wait for it and gives no exit code; start it and wait:

```powershell
$p = Start-Process -FilePath 'D:\dev\release\0.2.1\nq-lab terminal_0.2.1_x64-setup.exe' -ArgumentList '/S /NS /D=D:\Apps\nq-lab terminal' -Wait -PassThru
$p.ExitCode
```

0 is success; the refusals above give 3, 4 or 5. The argument text is the install test's; the two lines themselves were not run as typed here (the install test starts the installer through its own helper), so check the result with the permission check of section 6.

### After the install

Run the permission check of section 6 on the install folder now, before the first start.

## 3. Run

1. Start the app from the Start menu entry or the installed `nq-lab-terminal.exe`. The shell paints a splash, then starts the lab's backend (or attaches to a live one, section 5).
2. **First run: the lab picker.** Choose the nq-lab folder, `C:\Users\Fatih Hekimoglu\nq-lab`. The shell accepts a lab only when it holds `.venv\Scripts\python.exe`, `src\nq_lab\config.py` and `terminal\backend\nq_terminal\__main__.py`, and the backend reports that same folder as its root. It then offers the WebView2 data folder, proposed as `D:\nq-terminal\webview`. Accept it so that nothing lands on C:. The app creates the folder with a protected permission list (section 6).
3. The choices are saved in `settings.json` in the app's config folder, `%APPDATA%\dev.nqlab.terminal` (the previous version is kept as `settings.json.1`). A file that does not parse counts as absent and the picker asks again; it never falls back to a default lab.
4. **Stale page build.** If `terminal\web\dist` is older than the sources, the backend says so and the shell shows a rebuild page. Nothing is rebuilt until you click the button on it; the two steps (`pnpm install`, `pnpm build`) then run from the app with their output in `%APPDATA%\dev.nqlab.terminal\logs\rebuild.log`. pnpm must be on the PATH of your account.
5. **Closing.** Closing the window first lets the page send its unsent workspace changes to the store (up to 4 seconds), then stops the backend the app started (stdin closed, 5 seconds of grace, the job ended). When a backtest is running the app asks first. An attached backend, one that the browser door started, is never stopped by the app.
6. Zoom is the app's own: Ctrl plus, Ctrl minus and Ctrl 0 on a 25% grid from 50% to 300%, kept in `settings.json`.

### What the state folder holds

The backend's state folder is `terminal\state` in the lab (`NQT_STATE_DIR` moves it). It is git-ignored, and it is where the two doors meet.

| Item | What it is |
|---|---|
| `backend.lock` | present while a backend runs: its pid, port, the session secret and the lab root. Created owner-only. Never open it in an editor, paste it anywhere or attach it to a report: it holds a secret. |
| `workspaces\` | the seven workspace documents (the store) |
| `jobs.json` | the JOBS queue (at most 10 waiting, history of 200) |
| `cache\` | persisted result bodies of the result cache |
| `logs\backend.log` | the backend's output, rotated at 5 MB with 5 files kept |
| `release\`, `desktop\` | the dated green records of the release check, and the shell advisory acknowledgement |

The app's own files are elsewhere: `%APPDATA%\dev.nqlab.terminal` holds `settings.json`, `logs\shell.log` and `logs\rebuild.log`, and `D:\nq-terminal\webview` is the WebView2 profile. No folder of the app is ever under `results`, `data`, `live` or `backtests\output`.

## 4. Update and roll back

There is no updater by design (for 0.1.2 too: the recommended default, taken as a provisional owner decision). An update is a new installer, checked as in section 2 and installed by the owner through `desktop\scripts\upgrade-owner.ps1`, which takes the backup, runs the installer silently, verifies the result and rolls back on any failure. The script never starts the app: the first launch after an upgrade is yours.

### Before an upgrade

1. Check the new build folder as in section 2: the installer, `SHA256SUMS` and `PROVENANCE.json` naming the new version and the commit of its tag.
2. Keep the installer of the version you have now, with its checksums: it is the rollback installer, and the script refuses to act without it. Keep the copy outside the build folder, because a rebuild with `-Force` empties that folder. For the upgrade from 0.2.0 to 0.2.1:

   ```powershell
   $keep = 'D:\Apps\installers\0.2.0'
   New-Item -ItemType Directory -Force -Path $keep | Out-Null
   Copy-Item -LiteralPath 'D:\dev\release\0.2.0\nq-lab terminal_0.2.0_x64-setup.exe', 'D:\dev\release\0.2.0\SHA256SUMS', 'D:\dev\release\0.2.0\PROVENANCE.json' -Destination $keep
   ```

   The script checks the kept installer against that `SHA256SUMS` (for 0.2.0, `ff7266397131e15d101fa0b38105b0d0f7b855ba1d22f4a688906a4ef2feeb51`) and against the version `PROVENANCE.json` names, and refuses one that is not the installed version.
3. Close the app and every browser door window. The script refuses while the app runs, while any `python -m nq_terminal` backend runs (the browser door's included, with or without a lock file) and while `backend.lock` names a live process, because it compares the state folder before and after the install.

### Upgrade

First the dry run. It reads the install, runs every check, prints the plan and anything it would refuse, and changes nothing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\Fatih Hekimoglu\nq-lab\terminal\desktop\scripts\upgrade-owner.ps1' -Installer 'D:\dev\release\0.2.1\nq-lab terminal_0.2.1_x64-setup.exe' -RollbackInstaller 'D:\Apps\installers\0.2.0\nq-lab terminal_0.2.0_x64-setup.exe'
```

When it ends with "dry run: every check passed", run the same line with `-Go` added. With `-Go` the script:

1. **Refuses** on any problem, with nothing changed: no install for this user, or an install whose remembered folder (`HKCU\Software\nqlab\nq-lab terminal`) is not its `InstallLocation`; the app or a backend running (step 3 above); an installer that is not this product's release installer (a measure or smoke installer is refused by its name), or whose SHA256 matches neither `-Sha256` nor its line in `SHA256SUMS`; a missing rollback installer, or one of another version; too little free space on the install drive or on D:.
2. **Backs up** to `D:\dev\backup\nqt-<installed version>-<time>`: a copy of the install folder, of `terminal\state` (never `backend.lock`, which holds a secret) and of `%APPDATA%\dev.nqlab.terminal`, the two HKCU keys as `registry.json`, and `manifest.json` with the size and SHA256 of every file. It hashes every copy again and refuses if one differs.
3. **Installs** the new version silently for your account (`/S /NS`, no `/D=`), so it goes into the remembered folder and adds no shortcut. The installer runs hidden, with its temporary files on D:.
4. **Verifies**: exit code 0; `DisplayVersion` is the new version; `InstallLocation` and the remembered folder are unchanged; the install folder's permission list is the one of section 6 (inheritance removed, exactly you, SYSTEM and Administrators, nothing inherited, and no broad writer on `nq-lab-terminal.exe`, `WebView2Loader.dll` or `uninstall.exe`); the app was not started; no new shortcut; every state and config file hashes as in the manifest.
5. **Rolls back** on any failed check, and says so: if the install changed, the new version's uninstaller runs silently (app data kept) and the kept installer is installed with `/S /NS /D=<the same folder>` and verified the same way; any state or config file that differs from the manifest is copied back from the backup and hashed again.

Exit codes: 0 upgraded (or, without `-Go`, every check passed); 1 refused, nothing changed; 2 no installer given; 4 the upgrade failed and the old version is back; 5 the upgrade failed and the rollback did not complete. The report is `upgrade-report.json` in the backup folder; on exit code 5 restore by hand from that folder (`manifest.json` lists every file). The WebView2 folder `D:\nq-terminal\webview` is not backed up: no installer or uninstaller touches it.

After exit code 0, start the app yourself and run the first three rows of the weekly parity list (HOME with data, a workspace LOAD, the amber-classic look). The first launch after an upgrade starts with a cold result cache.

Evidence: the script's self-test (`upgrade-owner.ps1 -SelfTest`: 50 born-failing checks against fake registry keys under `HKCU\Software\nqt-upgrade-selftest-<id>`, fake folders under `D:\dev\tmp` and fake installers, among them a running app, a running backend, a hash mismatch, a missing rollback installer, a changed backup copy, and four failed installs that each end rolled back) and its tests (`desktop\scripts\tests\upgrade-owner.tests.ps1`: a dry run against the real 0.1.1 install left the HKCU keys, the install folder and its permission list unchanged) passed on 5 October 2026. `-Go` has not been run against the owner's install: the owner's first `-Go` is its first run there. The installer's own upgrade path that step 3 uses (`/S /NS` with no `/D=`) passed the install test's upgrade scenario on a renamed-product build on the same day (section 7, step 4).

### Roll back

The script rolls back by itself when its checks fail (above). To go back later by hand, for example when the first launch shows a fault: the installer allows downgrades (the Tauri default, `allowDowngrades` true in the generated script): an installer of an older version may be run over a newer install, its reinstall page offers both "uninstall before installing" and "do not uninstall", and a silent run is not stopped. Running over the top keeps the existing folder and re-checks it; on 5 October 2026 the install test's upgrade scenario ran that downgrade, and the upgrades with `/S /NS`, `/S /NS /UPDATE` and no `/D=`, on a renamed-product build ([checks/2026-10-05_install-upgrade-test.md](checks/2026-10-05_install-upgrade-test.md)), not on the shipped installer. The recommended rollback is still uninstall then install, the order the script uses too:

1. Close the app.
2. Uninstall: Settings, Apps, "nq-lab terminal", or run `uninstall.exe` from the install folder. The silent form is `& '<install folder>\uninstall.exe' /S`. Leave the "delete app data" box unticked unless you mean to reset the app: ticked, it removes `%APPDATA%\dev.nqlab.terminal` and `%LOCALAPPDATA%\dev.nqlab.terminal`. It does not remove `D:\nq-terminal\webview` (the folder the app chose), so delete that one by hand if you want it gone. The uninstaller removes only the files the installer wrote: a file you added to the install folder stays, and so does the folder around it (the install test left `notes-from-the-user.txt` in place on purpose). The silent uninstaller also leaves the registry key `HKCU\Software\nqlab\nq-lab terminal` (the folder it remembers for the next install); that is expected.
3. Install the kept installer (`D:\Apps\installers\<version>`), after checking its hash against the kept `SHA256SUMS`. The silent form is the one the script uses: `/S /NS /D=<install folder>`, started and waited for as in section 2.
4. If the workspace seems wrong, close every door (the app and any browser door), copy the backed-up files back from the script's backup folder (`D:\dev\backup\nqt-<version>-<time>\state\workspaces` into `terminal\state\workspaces`, and `config\settings.json` into `%APPDATA%\dev.nqlab.terminal`), check them against the SHA256 values in its `manifest.json`, then start again and check HOME and a workspace LOAD.

What a rollback never costs: the lab, the research files and `terminal\state` are untouched by the uninstaller. The browser door, `start.ps1`, works at every moment and is the fallback (03 section 19). Other rollback rows (a seam, the token, the store, Tauri for Electron, a WebView2 update) are in `03_migration_plan.md` section 20.

One backend per lab holds through all of this. The lock file belongs to the state folder, so an install, an uninstall or a rollback cannot create a second backend: whichever door starts first owns the backend and the other attaches. Do not delete `backend.lock` by hand while a backend runs.

## 5. Both doors at once (the dual run)

- Whichever starts first owns the backend; the other attaches through the lock after a listener check and a fresh proof of identity.
- The app spawns its backend on a free port (port 0). The browser door binds 8765 when it starts the backend itself. When the app's backend holds the lock, `start.ps1` opens the page on the port the lock names, with a one-time launch code, and starts nothing.
- Workspaces live in files, so both doors see the same state. The page's `localStorage` is a cache; in the app the origin changes with the port, so only the store carries saved state across launches.
- Defect rule: a defect in the app that the browser does not show is fixed before any new app feature. A defect in both is a normal terminal bug.
- The dual run starts when G2 on Windows passes with the owner rows recorded. It ends after four consecutive weeks with no blocking defect and every row of the weekly parity list green, then the owner decides whether the browser door stays (recommended default: keep).

## 6. Permission (ACL) runbook

Three places matter. Check each after an install, after any move of a folder and after a Windows restore.

| Folder | Expected permissions | Who sets them |
|---|---|---|
| The install folder (default `%LOCALAPPDATA%\Programs\nq-lab terminal`, recommended here `D:\Apps\nq-lab terminal`) | full control for the current user, SYSTEM, plus Administrators; no inherited entries | the installer, before it writes any file (DEC1) |
| `D:\nq-terminal\webview` | the same three, no inherited entries | the app, when it creates the folder. A folder that already exists is left as it was. |
| `terminal\state` in the lab | inherited from the lab folder under your profile today; the lock file inside it is owner-only | the backend creates the lock owner-only. An owner-only permission list on the whole default state folder is an open decision. |

### Check

```powershell
icacls 'D:\Apps\nq-lab terminal'
icacls 'D:\Apps\nq-lab terminal\nq-lab-terminal.exe'
icacls 'D:\Apps\nq-lab terminal\uninstall.exe'
(Get-Acl -LiteralPath 'D:\Apps\nq-lab terminal').AreAccessRulesProtected
icacls 'D:\nq-terminal\webview'
```

Use your own install folder in the first four lines. What correct looks like, from a run on 3 October 2026 of the grant below:

```
BUILTIN\Administrators:(OI)(CI)(F)
NT AUTHORITY\SYSTEM:(OI)(CI)(F)
DESKTOP-FM5O3JM\Fatih Hekimoglu:(OI)(CI)(F)
```

and `AreAccessRulesProtected` prints `True`. The folder shows three entries, each `(OI)(CI)(F)` and none marked `(I)` (which means inherited). The files inside it (`nq-lab-terminal.exe` and `uninstall.exe`) show the same three identities as `(I)(F)`: they inherit from the folder, so `(I)` on a file is correct and is not a fault. It is a failure if any of these appears: `Everyone`, `BUILTIN\Users`, `NT AUTHORITY\Authenticated Users` (folders on D: inherit Authenticated Users with modify rights; this was seen on `D:\dev`, and a folder that keeps inheritance picks it up), or a user that is not you. A quick test for the broad groups, which must print nothing:

```powershell
icacls 'D:\Apps\nq-lab terminal' | Select-String -Pattern 'Everyone|BUILTIN\\Users|Authenticated Users'
```

### Fix

If the install folder is wrong (for example it was made by an older installer, or copied by hand), set it. This form was run on a fresh test folder on 3 October 2026 and gave the three entries above:

```powershell
icacls 'D:\Apps\nq-lab terminal' /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)(F)" "SYSTEM:(OI)(CI)(F)" "Administrators:(OI)(CI)(F)"
```

Then repeat the check on the exe and on `uninstall.exe`. If either still carries a broad entry, run the same command once more with `/T` added so that it reaches the files inside. Do not grant anything to `Users` or `Everyone` to make an error go away; find the process that is blocked and stop it.

The install test of the repository makes the same assertion twice on a silent install: under `D:\dev\d5\install` (a folder it protects first) and in a custom folder whose parent grants Users Modify and Everyone write and which it does not protect first. In both, the folder, the exe, `WebView2Loader.dll` and `uninstall.exe` may not be writable by Everyone, Users or Authenticated Users, and in the second the folder must end with exactly the three entries above and nothing inherited. An empty folder that you created and protected yourself with the command above before the install is accepted by the installer (its owner is you); an existing folder that holds anything but this program's own files is refused.

## 7. Release procedure (owner and manager)

Order matters, because every record and every artefact carries a stamp of the exact tree (head, hash of `git diff HEAD`, hash of the untracked files). Change one file after a step and the later steps refuse. Run from the terminal folder (`C:\Users\Fatih Hekimoglu\nq-lab\terminal`), with the toolchain on D: as the scripts set it up themselves.

1. **Commit** the tree. `release_check.ps1` needs a clean commit.
2. **Build** the release build plus the measure build, the install-test build (the release feature set under the product name `nq-lab terminal installtest`) and the smoke build from that commit (output under `D:\dev\release\0.2.1`). The script refuses a folder that already holds files, so add `-Force` when the folder holds an earlier build (it empties the folder first). `-TargetDir` names the cargo target folder (the default is `D:\dev\targets\release`). The reference build of `f2e03bf` was made with `-TargetDir D:\dev\targets\int1 -Force` into `D:\dev\release-b`. For 0.1.0, the folder `D:\dev\release\0.1.0` held an older build on 3 October 2026 (an installer of 3,253,317 bytes, built from `e0834c1`); its `PROVENANCE.json` names that commit, not the tree being released, so `release_check.ps1` refuses it until it is rebuilt:

   ```powershell
   powershell -NoProfile -File desktop\scripts\build-release.ps1 -Version 0.2.1 -Force
   ```

3. **Artefact check:**

   ```powershell
   node desktop\scripts\artefact-check.mjs D:\dev\release\0.2.1
   ```

4. **Install test** (a silent per-user install and uninstall under `D:\dev\d5\install`, then a custom folder under a hostile parent and seven refusals; no administrator rights; the global window watch on, so any new visible window anywhere fails the run unless `-AllowForeign` is added, which turns the windows of other programs into warnings; 52 steps, all of which must pass). The opt-in `-DefaultFolder` adds the default folder under `%LOCALAPPDATA%\Programs` (58 steps); it writes about 3 MB on C: for a few seconds and refuses to run when the product is already installed there, so use it only when no copy is installed on this account:

   ```powershell
   powershell -NoProfile -File desktop\scripts\install-test.ps1 -Installer 'D:\dev\release\0.2.1\nq-lab terminal_0.2.1_x64-setup.exe'
   ```

   The install test refuses to run at all while any registry entry of the product exists (the HKCU or HKLM uninstall entry, or `HKCU\Software\nqlab\nq-lab terminal`), with or without `-DefaultFolder`. That refusal is right and stays: the entries belong to the product name, not to a folder, so a test install would take over the owner's uninstall entry and the test's uninstall would delete it, and an install without `/D=` would go over the owner's copy. On this PC, where the owner's 0.1.1 is installed, the install test of a new release therefore needs a renamed-product build (its own product name, identifier, registry entries and folders) or an account or PC with no copy installed. That route, its upgrade scenario and the install record that `release_check.ps1 -RequireInstall` reads are described in [checks/2026-10-05_install-upgrade-test.md](checks/2026-10-05_install-upgrade-test.md). `release_check.ps1` itself installs nothing and runs with the owner's copy installed.

   The procedure for 0.1.2 and later is run after the bump commit and the build of step 2, so that the stamp of each record equals the clean tree. The records are new files in `terminal\state\release`, written only on a pass:

   ```powershell
   # (a) the renamed-product install test on this release folder's install-test installer
   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -Installer 'D:\dev\release\0.2.1\nq-lab terminal installtest_0.2.1_x64-setup.exe' -AllowForeign
   # (b) the renamed build of the previous tag (D:\dev\release-installtest keeps it between runs)
   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -BuildRenamed desktop-v0.2.0
   # (c) the upgrade scenario, the previous renamed installer to this one
   powershell -NoProfile -ExecutionPolicy Bypass -File desktop\scripts\install-test.ps1 -Upgrade -FromInstaller 'D:\dev\release-installtest\0.2.0-19658fef56\nq-lab terminal installtest_0.2.0_x64-setup.exe' -Installer 'D:\dev\release\0.2.1\nq-lab terminal installtest_0.2.1_x64-setup.exe' -AllowForeign
   ```

   Step (d) is the `-RequireInstall` release check of step 6. Every install, upgrade and uninstall in these runs uses the renamed product, so the owner's copy is never touched: the script compares the real uninstall key, remembered folder and install folder before and after, and fails if any differ. The shipped installer's own bytes are not installed on this PC by these runs; the owner's real upgrade is step 8.

5. **Green records.** Each runs its check and writes a dated, stamped record under `terminal\state\release` only on a pass. The backend record runs the suite in parallel (`-n 16 --dist loadfile`) when the lab's venv has pytest-xdist and serially otherwise: 4,065 tests passed and 1 was skipped in 1 minute 52 seconds in parallel on 3 October 2026, where the serial run took about 9 to 10 minutes. The record always names the serial command, whichever way it ran, because `release_check.ps1` compares it with the check's own command. The crosscheck and the app smoke must use the release folder's smoke exe:

   ```powershell
   powershell -NoProfile -File scripts\record_green.ps1 -Check backend
   powershell -NoProfile -File scripts\record_green.ps1 -Check crosscheck -SmokeExe D:\dev\release\0.2.1\payload\smoke\nq-lab-terminal.exe
   powershell -NoProfile -File scripts\record_green.ps1 -Check smoke
   powershell -NoProfile -File scripts\record_green.ps1 -Check smoke-app -SmokeExe D:\dev\release\0.2.1\payload\smoke\nq-lab-terminal.exe
   ```

6. **Release check.** It refuses unless the four records are from today and from this PC, the stamps equal the tree's, the tree is a clean commit, `SHA256SUMS` lists every file with the right hash and the artefact check passes. It never creates the tag:

   ```powershell
   powershell -NoProfile -File scripts\release_check.ps1 -Tag desktop-v0.2.1 -RequireSmokeApp
   ```

   From 0.1.2 on it also takes `-RequireInstall`, which needs the two install records of step 4 (the install test and the upgrade scenario on this release folder's install-test installer, stamped with this tree, from this PC, with no failed step and the real install unchanged):

   ```powershell
   powershell -NoProfile -File scripts\release_check.ps1 -Tag desktop-v0.2.1 -RequireSmokeApp -RequireInstall
   ```

   Do not write the result into any tracked file yet: that would change `git diff HEAD` and a rerun would be refused. It is recorded after the tag (see the end of this section). Result for 0.1.0, as history: `PASS with no WARN on 4 October 2026 (`release_check.ps1 -Tag desktop-v0.1.0 -RequireSmokeApp`; same-day records on `8122c87`: backend 4,147 passed and 1 skipped, crosscheck PASS 2,495, FAIL 0, SKIP 0, INFO 104, smoke and smoke-app passed)`. Result for 0.1.2, as history: `PASS with no WARN on 5 October 2026 (`release_check.ps1 -Tag desktop-v0.1.2 -RequireSmokeApp -RequireInstall`, two NOTEs about the renamed-product install and upgrade records; same-day records: backend 4,201 passed, crosscheck PASS 2,495, FAIL 0, smoke and smoke-app passed, install test on the renamed product 54 of 54, upgrade 0.1.1 to 0.1.2 on the renamed product 105 of 105, the owner's real install unchanged)`. Result for 0.2.0, as history: `PASS with no WARN on 5 October 2026 (`release_check.ps1 -Tag desktop-v0.2.0 -RequireSmokeApp -RequireInstall`, two NOTEs about the renamed-product install and upgrade records; same-day records: backend 4,357 passed, crosscheck PASS 2,495, FAIL 0, smoke 18 and smoke-app 5 passed, QA package 333 passed, install test on the renamed product 54 of 54, upgrade 0.1.2 to 0.2.0 on the renamed product 105 of 105, the owner's real install unchanged)`. Result for 0.2.1: `PASS with no WARN on 5 October 2026 (`release_check.ps1 -Tag desktop-v0.2.1 -RequireSmokeApp -RequireInstall`, two NOTEs about the renamed-product install and upgrade records; same-day records: backend 4,377 passed, crosscheck PASS 2,495, FAIL 0, smoke 18 and smoke-app 5 passed, QA package 333 passed, install test on the renamed product 54 of 54, upgrade 0.2.0 to 0.2.1 on the renamed product 105 of 105, the owner's real install unchanged)`. The result for 0.1.1 is not repeated here.

7. **The annotated tag**, on the commit that `release_check.ps1` passed on (the release commit, which is HEAD while steps 2 to 6 run), only after step 6 passed on the same day. SemVer 0.x on purpose: the build is unsigned and the owner-attended rows are pending. The tag message names the version and the installer hash and nothing else:

   ```powershell
   git -C 'C:\Users\Fatih Hekimoglu\nq-lab\terminal' tag -a desktop-v0.2.1 -m "desktop 0.2.1 unsigned per-user installer, SHA256 34144639ef1a6c633d3ced581bf80362434a3cbd35f806fc229f932a25b1cd20"
   ```

   The tag message carries the installer's hash exactly as `SHA256SUMS` in the release folder lists it; the hash was not written into any tracked file before the tag. `release_check.ps1` checks that the tag name is free and has the form `desktop-vX.Y.Z`. The push is the owner's: `git -C 'C:\Users\Fatih Hekimoglu\nq-lab\terminal' push origin desktop-v0.2.1`. Tag result for 0.1.0, as history: `annotated tag `desktop-v0.1.0` on `8122c87`, created 4 October 2026 at 13:33 and pushed`. Tag result for 0.1.1, as history: annotated tag desktop-v0.1.1 on `777c162`, created and pushed. Tag result for 0.1.2, as history: annotated tag desktop-v0.1.2 on `5153496`, created and pushed on 5 October 2026 after step 6 passed; the GitHub Release is published and marked latest, with the installer asset `nq-lab.terminal_0.1.2_x64-setup.exe` and `SHA256SUMS`, and the re-downloaded asset hash matches. Tag result for 0.2.0, as history: annotated tag desktop-v0.2.0 on `19658fe`, created and pushed on 5 October 2026 after step 6 passed; the GitHub Release is published and marked latest, with the installer asset `nq-lab.terminal_0.2.0_x64-setup.exe` (3,256,246 bytes) and `SHA256SUMS`, and the re-downloaded asset hash matches. Tag result for 0.2.1: annotated tag desktop-v0.2.1 on `3b22af0`, created and pushed on 5 October 2026 after step 6 passed; the GitHub Release is published and marked latest, with the installer asset `nq-lab.terminal_0.2.1_x64-setup.exe` (3,257,242 bytes) and `SHA256SUMS`, and the re-downloaded asset hash matches.

8. **Owner upgrade**, after the tag and the push: the owner upgrades the installed copy with `desktop\scripts\upgrade-owner.ps1` (section 4), the dry run first and then `-Go`, with this release folder's installer as `-Installer` and the kept installer of the installed version as `-RollbackInstaller`. It is the owner's step: no scripted check runs `-Go`, because it changes the owner's install. It writes under `D:\dev\backup`, the install folder and, on a rollback, the git-ignored state folder, so nothing that the stamps of steps 1 to 6 read.

A record made on the uncommitted tree is refused after the commit, by design. If anything is committed after step 1, run steps 2 to 6 again on the new HEAD; they are scripted and take no choices.

**Recording the outcome.** The tag stays on the release commit, the one the records and `PROVENANCE.json` describe. The installer's hash and size, the install test result on that installer, the soak result, the release commit's own hash, the `release_check` result with its date and the tag result cannot be written inside that commit (section 10), so they were filled in a follow-up docs-only commit made after the tag: it changes this file, `smartscreen.md`, the register and the templates only, and the tag does not move to it. Nothing is rebuilt or rechecked after it, because the stamped artefacts belong to the tagged commit. A fix of anything beyond documents starts a new release from step 1.

## 8. Troubleshooting

| Sign | Cause | What to do |
|---|---|---|
| The app refuses to start and the message says a WebView2 policy "sets ... for this app" | A policy under `HKCU` or `HKLM` `Software\Policies\Microsoft\Edge\WebView2` sets `AdditionalBrowserArguments`, `BrowserExecutableFolder`, `ReleaseChannelPreference` or `UserDataFolder` for this exe | `reg query "HKLM\Software\Policies\Microsoft\Edge\WebView2"` and the same for `HKCU`. On 3 October 2026 neither key existed on this PC. Remove the value if it is yours; if it is managed by an organisation, the app cannot run on that PC. The shell never overrides a policy. |
| The installer or the app says the WebView2 runtime is missing | The Evergreen runtime was removed or never installed | Check the runtime: `Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' \| Select-Object pv` (it printed 154.0.4258.53 on 3 October 2026). The installer embeds the Microsoft bootstrapper, so running it again repairs the runtime. A pinned older runtime is the fix of trigger T8 only. |
| The app starts and then shows "The lab terminal has stopped" | The page engine failed twice, or the backend stopped | Close the app and open it again. Read `%APPDATA%\dev.nqlab.terminal\logs\shell.log` and `terminal\state\logs\backend.log`. The shell also keeps a diagnostics zip; it has no on-screen control yet. |
| A message that a live backend holds the lock (with a port) | Another door's backend is running for this lab. This is normal in the dual run | Use that backend: the app and `start.ps1` attach to it. To stop it, close the door that started it. If no such door is open, find the process and stop it yourself (`Get-CimInstance Win32_Process -Filter "Name='python.exe'" \| Select-Object ProcessId,CommandLine`). Do not delete the lock file while its process lives. A lock whose process is gone is cleared by the next backend. Never paste the lock file's contents. |
| `start.ps1` says the lock file is not owner-only | Another account owns it or has rights on it | It is not used. Remove it only if you did not expect it, and check the permissions of `terminal\state`. |
| `start.ps1` says port 8765 "is taken by another program" | Something other than a terminal holds 8765 | `Get-NetTCPConnection -LocalPort 8765 -State Listen` names the process id. Close that program, or start on another port with `-Port`. The app itself uses a free port and never needs 8765. |
| `start.ps1` says a terminal on 8765 "has no lock file or token (an older version)" | A pre-D2 backend is still running | Close its window or stop that process, then start again (section 2). |
| The page says the workspace store is unavailable (the backend answered 503) | The state folder cannot be read or written, or the disk is full | Nothing is imported or overwritten while it is unavailable, and your edits stay pending in the page. Check `terminal\state\workspaces` and free space, then reload. Changes pending when the window is closed are sent first, for up to 4 seconds. |
| A rebuild page appears | The page build is older than the sources | Click the rebuild button; it needs pnpm on the PATH. Output goes to `rebuild.log`. |
| The installer's Install button stays greyed out, or a silent install ends with exit code 3 and one of the messages of register entry 1.3 | The folder is one the installer refuses (section 2): a drive root, a network path, Program Files or Windows, a link, a folder that holds something other than this program's files, a folder owned by another account, or a folder inside a parent that another account could replace | Choose a new, empty folder you own, in your own profile or in a folder you created. A planted file next to the program would load into it on every launch, so the refusal is not to be bypassed. Do not make the parent writable to Everyone or Users to get past it |
| A silent install ends with exit code 4 or 5 | 4: the permission list could not be set. 5: the read-back after the install found a list that is not the protected one, and the installer removed what it wrote | Nothing is left installed. Run the install again from a normal (not elevated) shell. If it repeats, keep the exact exit code and run the permission check of section 6 on the folder before you change anything |
| Windows shows "Windows protected your PC" | The installer is unsigned and arrived with a Mark of the Web | `smartscreen.md`. |
| The app's memory in Task Manager is much lower a minute after you stop using it, or the first click after that is a moment slower | From 0.1.2 the backend trims its working set once the HOME prewarm is done and when it has been quiet for 60 seconds (`NQT_MEMTRIM=0` turns it off). This lowers the working set only, not the committed (private) bytes, which stay the leak signal. The first request afterwards pays for a few pages to be brought back, about 13 ms in the fixture measurement | Nothing to do. An open live stream or a queued or running job holds the trim off by design |
| The app shows "The lab terminal has stopped" straight after a start, with the stopped page's Retry link, and `shell.log` holds `supervise_refused` ("the backend did not answer its identity check in time") | Known limitation of 0.2.0 and earlier, found after the tag of 0.2.0 and fixed in 0.2.1: about 1 start in 240. The first start after a Windows Defender signature update can take the backend longer than the shell's 2 s link budget, although the backend did start. From 0.2.1 the backend holds its HOME prewarm until the first identity proof has been answered and starts its first worker thread before it announces itself, and the shell retries a late first proof (up to three more tries of 5 s each, inside the handshake time limit) before it refuses, so 0.2.1 fixes it (120 of 120 hidden launches checked, none refused) | On 0.2.0 and earlier, close the app and open it again; the second start is normal. From 0.2.1 the stopped page is shown only for a backend that is really wrong (a wrong proof, a foreign process) or gone. If it shows the identity message after a very slow start, the Retry link now starts a new backend and checks it again, so closing the app is no longer needed |
| The app shows "The lab terminal has stopped" at a start, and `shell.log` holds `supervise_exit_during_proof` (with the port, an exit code and the reason it replaced) | From 0.3.1 the shell tells a backend that ended during its first identity check from one that was refused. Before, a backend that exited while the shell was still asking for its proof (a crash at import, a port taken, a missing file) was reported as a refused listener, which hid the real cause and was not retried. Now an unanswered proof from a process that has ended, or that ends within 3 s, is an exit: the start is retried like any other exit and the log names the exit code. A checked answer is still a refusal with its own reason and no retry (a wrong MAC, a foreign listener or process, a wrong root or contract). A backend that is alive but has no listener is still refused, after the 3 s settle, so that refusal takes about 21.5 s, inside the 30 s handshake limit | Read the exit code in `%APPDATA%\dev.nqlab.terminal\logs\shell.log` and the last lines of `terminal\state\logs\backend.log`; the exit code is only in the shell log, the stopped page does not show it. Fix what the backend log names, then open the app again. A repeated `stopped exited` that ends in "gave up" means the backend ends every time it is started. |
| A test or measurement run reports a window of another program, for example "foreign program not on the list" or "known foreign program", or a window watch note names an image such as `logioptionsplus_agent.exe` | From 0.3.1 every global window watch (the Rust tests, `winwatch.mjs` and `web/e2e/desktop/watch.ts`) judges only the process tree of the run. A new window or a foreground change that belongs to another program is filed in the report's foreign list and never fails the run (owner decision of 3 October 2026); the list only labels it. The named list in the repository holds the Logitech Options+ agent. Another neighbour is added per PC, not in the repository, through the user environment variable `NQT_KNOWN_FOREIGN` (image names separated by semicolons). An event whose owner cannot be traced fails closed, as an own window | Nothing to fix for a foreign note. To label a recurring neighbour as known, set `NQT_KNOWN_FOREIGN` in the user environment. A failure that names the app's own tree is a real finding: read the window class and the title in the note. See `desktop/harness/README.md` (watch scope). |

## 9. Owner checks

Owner-attended checks are recorded as dated files in `docs/desktop/checks/` (`YYYY-MM-DD_<check>.md`, one file per run), from the templates there; the folder's [README](checks/README.md) gives the order and the rules for filling them in. Each needs a pass or fail ticked in the file. The "Needed for" column is as in that README.

| Check (template) | Needed for | Pass rule |
| --- | --- | --- |
| [Install into a custom folder](checks/2026-10-03_custom-install-folder.md) | G2, register 1.3 | the installer refuses a drive root, a network path, Program Files and the Windows folder; a folder you pick has a protected access list with only you, SYSTEM, plus Administrators; no administrator prompt; the uninstall leaves the lab alone |
| [First launch after a reboot](checks/2026-10-03_reboot-first-launch.md) | G2 | one harness command (`node desktop\harness\run.mjs --first-launch --build measure`); `firstAfterBoot` true, no window of the app's own process tree shown (a window of another program, such as one that starts at sign-in, is a note in the record and does not fail the run), cold start to HOME within 5 s (6 s cap for a first launch with an empty state folder) |
| [Visible run of the installed release](checks/2026-10-03_visible-run.md) | G2 | start to HOME within 5 s and within noise of the measure build's median, idle memory within 500 MB, stream mode back within 30 s of a real minimise and restore |
| [Real keyboard](checks/2026-10-03_real-keyboard.md) | G2 | 16 of 16 keys reach the page (F1, F8, F9, F10, F11, Alt+1 to Alt+9, Alt+K, Ctrl+K), the held-back keys do nothing, the app zoom keys and print work |
| [200% zoom by eye](checks/2026-10-03_zoom-200-by-eye.md) | G2, register 1.2 | every control reachable in every maximised panel at 200% in 1366 by 768 and 1024 by 640 |
| [NVDA](checks/2026-10-03_nvda.md) and [Narrator](checks/2026-10-03_narrator.md) | G2 | 0 blocking findings over the window, HOME, a grid, a chart's table view and the command line |
| [Real JOBS backtest](checks/2026-10-03_real-jobs-backtest.md) | G2 (05 X09) | one small backtest through JOBS ends OK with exit 0 under the allow-listed environment, and no gate log line beyond the fence |
| [SmartScreen first run](checks/2026-10-03_smartscreen-first-run.md) | the unsigned decision | the readings of the template match; the extra download fields are in `smartscreen.md` |
| [All-day soak](checks/2026-10-03_all-day-soak.md) | G2, only if the overnight soak was partial | largest whole-tree sample at most 1.5 GB, run labelled ALL-DAY |
| [Pending measurements](checks/2026-10-03_pending-measurements.md) | G2 | every row that was pending or provisional has three accepted runs at or under its ceiling (ceilings in `desktop/harness/README.md`) |
| [Weekly parity list](checks/2026-10-03_weekly-parity.md) | D6, weekly for four weeks | all 16 rows green: HOME with data; GP and GIP pan and zoom; REG and MT; RUN with the fills pivot; EQ to MRET tabs; MON and CORR; LEDG and OOS; LIVE and JRNL with the stream in stream mode; HELP; DES save; GRAB copy and save; print dossier; JOBS queue and cancel; F1 and F8 to F11; SAVE and LOAD of a workspace; the amber-classic look; and the research gate reading shows 0 other callers and 0 lines after the fence |
| [Four-week dual-run kit](checks/2026-10-03_dual-run-kit.md) | D6 | four consecutive green weekly files with no blocking defect, at least 28 days, then decision O8 |

Files recorded so far: none. The folder holds the README and thirteen blank templates dated 2026-10-03 (the twelve checks above, with NVDA and Narrator as two files, and the dual-run kit); every one reads NOT RUN or NOT STARTED. A file you fill in is named by the day of its run. Open owner decisions are in [owner_decisions_windows.md](owner_decisions_windows.md). The templates are dated 3 October 2026 and name the 0.1.0 installer in their header tables; for a run on 0.2.1, write the 0.2.1 installer name, size and SHA256 from section 2 into the file you fill in.

## 10. Placeholders

All placeholders were filled on 4 October 2026 in the follow-up docs-only commit after the tag, from the release folder `D:\dev\release\0.1.0` (`SHA256SUMS`, `PROVENANCE.json`), the install test report and the `release_check.ps1` result. None is left in the documents or the check templates. That statement is about the 0.1.0 documents. Release 0.1.1 repeats the procedure: its three build-dependent values (installer SHA256, installer size and tag) are visible placeholders in the README and in sections 1, 2 and 7 of this file, and the manager fills them in a follow-up docs-only commit after the 0.1.1 build and tag. Release 0.1.2 repeated this: its values were filled on 5 October 2026 in the follow-up docs-only commit after its tag, and none is left. Release 0.2.0 did the same on 5 October 2026, and none is left. Release 0.2.1 did the same on 5 October 2026, and none is left.

Already filled from the tree of `f2e03bf`, with the source named where it appears: the product folder under `Programs`, the default folder text, the refusal wording and the install test result for the reference build (register 1.3, custom-install-folder template), the zoom spec result (register 1.2, zoom template), and the list of dated files under `checks/` (section 9). The overnight soak figures of the soak template are filled from `g2_windows/results.md`.

Also check the two statements that describe the DEC1 installer (the default folder under `%LOCALAPPDATA%\Programs`, the refusals, the protected list before files are written) against the built installer: sections 2 and 6 of this file, section 1.3 of the register and the custom-install-folder template. The reference build of `f2e03bf` carries the hooks (its `artefact-check.mjs` run asserts that), so the statements hold for it; the merge step confirms them on the final build with the install test and the permission check.
