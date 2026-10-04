# Owner decisions for the Windows app: the register

Status: written on 3 October 2026 for the hand-over (wave W6) and brought in line with the tree at commit `f2e03bf`, where the four DEC1 decisions are built. It is a draft in one respect only: figures that the measuring step (G2) or the final regression (W6) produces appear as visible placeholders in double curly brackets that start with G2 or W6, and the merge step fills them from the final tree. Figures taken from the DEC1 wave, which was measured alone but not on a quiet machine, are written with the word PROVISIONAL and are not G2 figures. Nothing here says that G2 has passed. G2 and milestone M4 stay provisional until the owner-attended checks in `docs/desktop/checks/` are filled in and ticked.

This register lists every decision the Windows build needed, what was taken, the standard it follows, and what is still open. It extends 04 ("Owner decisions, with the phase that needs each") and 03 section 23, and the owner decisions of the build plan. Where a decision was taken by default, it says so, and says that it is provisional: the owner can change it, and the cost of changing it is in the row.

Status words used below:

| Word | Meaning |
| --- | --- |
| Delegated | The owner handed the decision over on 3 October 2026, to be resolved to the industry standard and built. It is recorded here with the standard it follows |
| Taken | Decided, with the default of the plan or by the owner's order |
| Provisional | The plan's recommended default was taken tonight because the build needed an answer; the owner may still change it |
| Settled by measurement | A measurement decided it |
| Open | Waits for the owner, with a recommended default |
| Deferred | Out of scope for the Windows build; waits with the work it belongs to |

## 1. Decisions delegated by the owner on 3 October 2026

The owner asked for the open decisions to be fixed to the best, industry-standard, current practice, and for the work to be sped up with parallel waves. Five decisions followed from that. Four were built in wave DEC1 (entries 1.1 to 1.4, on `main` at `2024d3b` and later) and the fifth, the tag, waits for the final release check. Each entry records what the build meets, the standard it follows, the evidence in `docs/desktop/d5_integration.md` (DEC1 sections) and the G2 reading still to come as a placeholder for the merge step. A sixth entry (1.6) records a later order of the owner, on the window watch, and a seventh (1.7) records the W5C decisions on memory and first launch.

### 1.1 T3: cold HOME, the strict reading

| | |
| --- | --- |
| Decision | The cold-HOME cap applies to every launch, including the very first launch after an install with an empty state folder. That launch is the worst case and the owner's first impression, so it is not excused |
| Numbers | Cap 6,000 ms; target 4,500 ms. Launches with data stay under the G2 ceiling of 5,000 ms as well (04, phase D5) |
| Which ceiling governs G2 | 5,000 ms governs the pass or fail of G2 for a launch with data: it is the ceiling of the G2 table in 04 (phase D5), the one the harness enforces (`desktop/harness/lib/rows.mjs`) and the one the check templates use. The 4,508 ms of the stage 1 record (median of 3,757 ms plus 20%, 02 section 4.1 item 3) is kept as a regression reference: it was read on the stage 1 build, before this wave changed the launch path, and without the shell's own start-up. A G2 reading between 4,508 ms and 5,000 ms passes G2 and is reported as above the stage 1 reference, so the owner sees the drift. A reading above 5,000 ms fails. The 6,000 ms cap is the outer limit for the first launch with an empty state folder only |
| Why it changed | The stage 1 reading (`docs/desktop/stage1/stage1_numbers.md`) gave 3,757 ms for the usual launch and 6,439 ms for a first launch, which is over the cap. The earlier reading gated only the usual launch and reported the first beside it |
| How | The ledger read starts in the backend prewarm instead of waiting for HOME to ask for it; the ledger read itself is faster and is stamped with the code that wrote it, so a stale answer cannot be reused; HOME's panels paint as their answers arrive instead of all at once |
| Standard followed | Budget the slowest launch a person will see, not the best one; paint what is ready and fill the rest progressively; keep the figure a median of three runs on a quiet machine, with the load recorded |
| Readings | First launch (empty state), W5B: 5,048 ms in the app (smoke build, quiet series; 5,583 ms in the first series), over the 5,000 ms G2 ceiling; 4,260 ms in the stage 1 reading without the shell. Usual launch, W5B: 3,321 ms in the app; 3,235 ms in the stage 1 reading. After the W5C changes (entry 1.7): first launch 3,167 ms in the app (median of 3; 3,172.5 ms over six launches; `g2_windows/results.md` section 3), 2,700 ms in the stage 1 reading; usual launch 2,750 ms in the app, 2,425 ms in the stage 1 reading |
| Status | Delegated. Built in wave DEC1 (backend prewarm order, a faster ledger read stamped with the code that wrote it, panels that paint as their answers arrive). G2 re-measures it alone in a quiet window. The by-hand reading after a reboot is in `docs/desktop/checks/2026-10-03_reboot-first-launch.md` |

### 1.2 Zoom at 200% in small windows

| | |
| --- | --- |
| Decision | At 200% zoom, in a 1366 by 768 window and in a 1024 by 640 window, every maximised panel keeps every control reachable: through an overflow menu, a scrolling body, or both, and never by clipping a control away |
| Standard followed | WCAG 2.2 AA: success criterion 1.4.4 (Resize Text) and 1.4.10 (Reflow). The dense two-dimensional panels keep the data-table exception of 1.4.10 that 03 section 12 already relies on; the criterion applied here is reachability and no loss of function |
| What it replaces | The two desktop specs that were expected failures (`test.fail`) in the D5 step 1 build, recorded as open in `docs/desktop/d5_integration.md`: a maximised GP panel left a body too short for its controls |
| Readings | The two specs are plain tests now and pass. In the desktop Playwright project, 41 passed against the rebuilt smoke build in the release check of 3 October 2026 (`docs/desktop/d5_integration.md`), and the 200% reflow survey of 44 panels in three windows passes 133 of 133 cases (it failed 75 of 89 before the fixes). The wide data grids (MON, REG, LIVE, JRNL, RUNS, JOBS) still scroll sideways inside the panel body, which is the data-table exception of 1.4.10. The final regression repeats the desktop project on the final tree |
| Status | Delegated. Built in wave DEC1. The by-eye check on the installed release is `docs/desktop/checks/2026-10-03_zoom-200-by-eye.md` |

### 1.3 Install folders

| | |
| --- | --- |
| Decision | Per-user install, with no elevation, in the pattern of the user installers of VS Code and Chrome. The default folder is `%LOCALAPPDATA%\Programs\nq-lab terminal` (the product folder name of the installer script). Any folder the owner picks gets a protected access list (the current user plus SYSTEM and Administrators, nothing inherited) before any file is written, and the lists are read back after the install (the install is undone if they are wrong). Refused, with exit code 3 for a silent install and nothing written: drive roots, network paths, Program Files, the Windows folder, links and junctions, an existing file, an existing folder owned by another account or holding anything but the program's own files, and a folder inside a parent that another account could rename away or re-protect (delete-child, change-permissions, take-ownership or full control for another account). The guard does not test DELETE on the parent: a parent that grants another account Modify (as `D:\` does to its child folders) is accepted, and on a PC with more than one account that account could rename the parent away and plant its own folder. The recommended `D:\Apps` is safe on a single-account PC only; the profile default or a parent you protected first is the safe choice elsewhere. Exit code 4 is a permission list that could not be set and exit code 5 a wrong one at the read-back |
| Standard followed | CWE-732 (incorrect permission assignment for a critical resource) and CWE-427 (uncontrolled search path element): a program folder that other local accounts can write lets them replace the executable or plant a library it loads. A per-user location plus a protected list closes both without needing administrator rights |
| What it replaces | 03 section 13.1 proposed `D:\Apps\nq-lab terminal` for this PC, and the D5 step 1 install test covered the per-user default layout only; a folder picked on `D:\` inherits Authenticated Users Modify from the drive |
| Words the installer uses | The folder page shows no text for a refused folder: its Install button stays greyed out. The words appear on the console of a silent install, and in a dialog if the guard stops an install after it began. Drive root: "The install folder cannot be the root of a drive. Choose a folder inside it." Network: "The install folder cannot be on a network location. Choose a folder on a local drive." Program Files or Windows: "The install folder cannot be under Program Files or Windows. Choose a folder in your own profile or on another drive." Link, junction or file: "The install folder cannot be a link, a junction or an existing file. Choose an ordinary folder." Not a full path: "Choose a full folder path on a local drive, such as C:\Users\you\AppData\Local\Programs\nq-lab terminal." The other messages are in `desktop/src-tauri/windows/nsis/hooks.nsh` |
| Readings | The silent install test against the installer of `f2e03bf` (`D:\dev\release-b\0.1.0`), 3 October 2026: 52 steps, 0 failed (the default per-user layout, a custom folder under a parent that grants Users Modify and Everyone write, a user file and a lab stand-in surviving the uninstall, and seven refusals with exit code 3). With the opt-in default-folder case, 58 steps, 0 failed, on an earlier DEC1 build. On the final installer: see the runbook, section 2. The by-hand check is `docs/desktop/checks/2026-10-03_custom-install-folder.md` |
| Status | Delegated. Built in wave DEC1 (`hooks.nsh`, the artefact check, the install test), tested born failing in `install-hooks.test.mjs`. The runbook (`docs/desktop/handover_windows.md`) keeps the `icacls` command as the fallback for a folder already installed |

### 1.4 `volmanaged_v0 EQ` at the desktop caps

| | |
| --- | --- |
| Decision | `volmanaged_v0 EQ` meets its 1,000 ms warm target at the desktop caps (512 MiB for bars, 128 MiB for files) without raising either cap |
| Standard followed | Meet a performance budget by removing the cost, not by raising the resource ceiling that keeps the whole app inside its memory budget. The G2 soak is measured at the shipped caps, so a raised cap would also move the memory rows |
| What changed | The bars cache was not the cause. The run index's file cache charged each run's small parsed head at its whole `result.json`, so one pass overflowed the cap and every call re-parsed all 72 files. The cache now charges an entry what it keeps; nothing served changes and no cap was raised |
| Readings | `volmanaged_v0 EQ`, warm, real data, desktop caps: 653 ms after the W5C changes (W5B 628 ms), the Enter unit, median of 5, real data, desktop caps (512 MiB bars, 128 MiB files) (target 1,000 ms, ceiling 1,500 ms); caps unchanged in W5C (entry 1.7) |
| Status | Delegated. Built in wave DEC1. G2 takes the figure again alone in a quiet window |

### 1.5 The release tag

| | |
| --- | --- |
| Decision | An annotated tag `desktop-v0.1.0` on the commit that `release_check.ps1` passed on (the release commit); the hash, the check result and the tag result are recorded in a follow-up docs-only commit after the tag, because they cannot be written into the stamped commit itself. The tag is created only after every automated gate passes: `release_check.ps1` passes with same-day records whose provenance stamps match the tree. The version is 0.x, because the build is unsigned and the owner-attended checks are still pending |
| Standard followed | Semantic Versioning 2.0.0: versions 0.y.z are initial development, and the public surface may still change; the first 1.0.0 comes when the owner-attended rows have passed, the dual run has closed and the signing question is settled. An annotated tag (not a lightweight one) records who tagged and when, and why, which is what a release needs |
| Who | Created by the build's lead, not by a build slice, and never before the gates. The plan reserved the push of the tag to the owner; creating the tag is delegated, and whether it has been pushed is recorded here: an annotated tag `desktop-v0.1.0` on `8122c87`, created 4 October 2026 at 13:33 and pushed |
| Status | Delegated. Done at the end of W6, after the final release check |

### 1.6 The window watch judges the run's own app

| | |
| --- | --- |
| Decision | During every automated launch (the desktop Playwright project, the served crosscheck, the app-mode smoke, the harness) the watch over every window on the machine fails a run only on a drawn window, an unexpected undrawn window or a foreground change that comes from the app tree that run started. Windows and foreground changes of other programs are kept as notes in the run's record. An event whose owner could not be traced still fails, and so does every event of a watch that names no launched app |
| Standard followed | Fail closed on what the run controls, and record what it does not: a check that fails because another program opened a window teaches nothing about the app |
| What it narrows | The standing rule that any new visible window anywhere fails a run (plan decision 10 still governs where a window may be shown: hidden, or on screen 2). The install test (`install-test.ps1`) keeps the strict form unless `-AllowForeign` is given |
| Status | Taken by the owner on 3 October 2026; built in `f2e03bf` (`desktop/harness/lib/winwatch.mjs`, `web/e2e/desktop/watch.ts`). The reboot check reads the app's own windows only; other programs' windows at sign-in are notes |

### 1.7 Memory and first launch under trigger T4 (wave W5C, 4 October 2026)

The W5B measurement found three automated rows over their ceilings: idle at HOME 1,082 MB (ceiling 500 MB), first launch 5,048 ms (ceiling 5,000 ms) and the soak's first sample 1,577.4 MB (ceiling 1.5 GB). Wave W5C (commit `8122c87`) fixed their causes under roadmap trigger T4 (`02_decision.md`, 6.5). The standard for every entry below is the one of 1.4: meet a budget by removing the cost, not by raising or lowering the resource ceiling that hides it. The evidence is `g2_windows/results.md` (sections 1a, 3, 8 and 9) and `g2_windows/verdict.md`.

| Decision | Standard followed | What changed | Reading (W5C, before in brackets) |
| --- | --- | --- | --- |
| Arrow uses the system memory pool | Return freed memory to the operating system instead of holding it in a private pool; one allocator for the whole process | `backend/nq_terminal/services/allocator.py`, set at start-up | Part of the idle and soak readings below |
| MON's two-day sparkline reads a narrow two-day window | Read only what the panel shows; do not cache a whole 1-minute year per symbol to serve two days | Desktop mode reads its window instead of keeping the year (the browser comparison on equal terms uses the same switch, `NQT_TWO_DAY_WINDOW`) | Soak largest sample 705.8 MB over 2 h (1,577.4 MB over 3 h); first sample 698.7 MB |
| HOME start-up does only HOME-only work | The first screen pays only for what it shows; heavy imports are warmed after HOME is ready | `home_prewarm.py` order and the deferred imports | First launch 3,167 ms in the app, 3,172.5 ms over six launches (5,048 ms) against the 5,000 ms ceiling and the 4,500 ms target |
| The audit log is kept compact | Weigh a cache entry at what it really holds: raw bytes plus a compact line index, not parsed objects | `services/audit.py` | Part of the idle reading below |
| The record-watch reader is deferred | Start background readers after the foreground queries are quiet | The reader mounts once HOME's own queries are quiet | Part of the idle reading below |
| The caps stay at 512 MiB (bars) and 128 MiB (files) | The profile showed that what filled the cache, not its size, was the cause, so a lower cap would only evict data the app still reads; T4's named response (lower the caps) was tried and did not move the row | Nothing; a test series at 256 MiB read 494.1 MB against 497.1 and 506.3 MB at 512 MiB, inside the spread | Route times at the shipped caps re-checked: worst repeat 12 ms against 300 ms |

Result and what is still open. Idle at HOME is **505.4 MB** (492.4 to 508.4 MB over six counted launches; 497.1 MB in the rows series alone; W5B 1,082 MB) against the 500 MB ceiling: over by 5.4 MB, so the automated part of G2 is not passed. It reads 453.8 MB by the browser comparison's 8 second settle and 388.6 MB after five minutes, because the prewarm's later tasks hand their memory back about ten seconds after HOME is ready. Two ways to close it are open and neither was taken: a backend change that keeps those tasks' working memory out of the HOME window, or an owner decision on the reading point (the harness reads at HOME ready plus 2.5 seconds, the W0B point). T4 still fires on equal terms with the browser terminal (app 41 MB above 412.5 MB read the same way; 320 MB below its default form, 820.4 MB). The soak was a 2 h run (harness stopped at 2 h 5 min, external sampler), so it is PARTIAL and the all-day check remains.

## 2. The decisions of the build plan

These are the fourteen owner decisions of `windows_build_plan.md`, in its order. A decision the build needed tonight took the plan's recommended default and is marked Provisional.

| # | Decision | Taken | Status | What changing it costs |
| ---: | --- | --- | --- | --- |
| 1 | Phase go: the size of each wave is stated in it | One standing go for the whole sequence, under the owner's order of 3 October 2026 | Taken | Without a go the chain stops at the next wave boundary |
| 2 | Git writes | A standing go to commit and push after each green phase, broader than the plan's recommended local commits only; one commit per seam, so 03 section 20's rollback works. The tag is under 1.5 | Taken | A narrower go means the chain pauses at each phase end |
| 3 | O16: quiet-machine windows | No named window. Measurements wait for a 60-second CPU average of at most 10%. If the load stays above that, the measurement is still taken, with the load recorded, and labelled PROVISIONAL, then listed for a re-measure in a quiet window | Provisional | `docs/desktop/checks/2026-10-03_pending-measurements.md` repeats them. G2 does not close on a provisional figure |
| 4 | Accept a locally built, GNU-host, unsigned release for own use | Accepted, labelled "GNU local build"; the manifest fix and the absence of MinGW runtime imports are proven by the artefact check. Departs from 02 C3-13 and 03 section 13.1 (MSVC in CI). The G2 row that compares against an MSVC measure artefact uses the GNU measure artefact | Provisional | The alternative is to call it a pre-release until an MSVC build exists in CI |
| 5 | Unsigned installer and SmartScreen | Unsigned accepted for own use. A locally built installer has no Mark of the Web, so SmartScreen is not invoked; a downloaded copy gets one Run anyway prompt per file; Smart App Control is off on this PC (`docs/desktop/smartscreen.md`, `docs/desktop/checks/2026-10-03_smartscreen-first-run.md`) | Provisional; still open in section 3 | A Certum OV certificate, from EUR 209 a year, is needed only if the app is shared |
| 6 | Folder ACLs | The app creates its WebView2 data folder (`D:\nq-terminal\webview`) with a protected access list, and leaves a folder that already exists as it was; decision 1.3 protects the install folder at install time and the install test proves it under a hostile parent; the runbook gives the `icacls` command for an installed folder. D:\ and D:\dev are not changed by any build run | Taken for what the app creates; D: left alone | Protecting `D:\dev` is machine configuration and stays with the owner (section 5) |
| 7 | T2 branch: Electron or Tauri | T2 did not fire; the Windows shell stays Tauri 2 (`docs/desktop/d0_results.md`). O4 at its default | Settled by measurement | Changing it means replacing `desktop/`, 3 to 5 weeks (03 section 20) |
| 8 | O5 caches; O7 drives | 512 MiB for bars and 128 MiB for files in desktop mode, 2 GiB in the browser door. The WebView2 data folder is `D:\nq-terminal\webview`. The install folder default is now the per-user one of decision 1.3; `D:\Apps\nq-lab terminal` remains a choice. Tests use `D:\dev` only | Taken | Raising a cap moves the memory rows of G2 (see 1.4) |
| 9 | O10, O11, O12, O6 | The IB snapshot checkbox off by default (a `settings.json` key until a menu exists); closing with a running backtest asks to confirm, then stops it; minimum window 1,024 by 640; no resident backend. In the release the stale-dist rebuild runs only after an explicit click, because it runs package install scripts | Provisional | A resident backend (O6) is built only if the cold-HOME cap fails after decision 1.1 |
| 10 | Screen 2 | Allowed: a window that a test needs may be shown on the second monitor only, inside its work area, with no activation and behind a guard; every other window is hidden. If the hidden route gives no frames, pan-and-zoom traces may use it. What the watch counts as a failure is narrowed by 1.6 | Taken | Without it the real minimise and restore stay owner-attended |
| 11 | The 8765 browser backend | Not stopped by any build run, which never touches it. Consequence: the `measure` build's real-lab rows are recorded as pending whenever 8765 listens or a live lock exists, and the process rows are taken on the `smoke` build with a temporary state folder instead. Restarting the browser door with the new `start.ps1` is a hand-over step (`docs/desktop/handover_windows.md`) | Provisional | The pending rows are repeated in `docs/desktop/checks/2026-10-03_pending-measurements.md` |
| 12 | The departures from 03 found by the security review | Accepted; listed in section 4 | Taken | Reverting one loses its protection |
| 13 | Soak length | A partial soak on the build night (3 hours, 36 to 37 samples, a real-data run shorter than the 8-hour all-day rule), labelled PARTIAL; the full soak is an owner check for a day when the PC can be left alone | Provisional | `docs/desktop/checks/2026-10-03_all-day-soak.md` |
| 14 | O8: the browser door after the dual run | Keep (the default), decided at the end of the dual run | Open until the run closes | Retiring it removes the fallback that costs nothing |

## 2.1 The identifiers of 03 section 23 and 04

| ID | Decision | State for Windows |
| --- | --- | --- |
| O1 | G0: which Mac | Deferred with the Mac |
| O2 | Start D4 before G1 | Taken: yes (the default), under the owner's order |
| O3 | OpenSSH server or a private network on the PC | Deferred with the Mac |
| O4 | Tauri or Electron | Taken: Tauri, T2 did not fire |
| O5 | Desktop caches | Taken: 512 MiB and 128 MiB; one shared budget is open (section 3) |
| O6 | A resident backend | Taken: not built |
| O7 | Drives | Taken, with the install folder changed by decision 1.3 |
| O8 | Browser door after the dual run | Open until the run closes; default keep |
| O9 | Mac key alternatives | Deferred with the Mac |
| O10 | IB snapshot in the app | Taken: off, a setting |
| O11 | Closing with a running backtest | Taken: confirm, then stop |
| O12 | Minimum window size | Taken: 1,024 by 640 |
| O13 | Apple Developer Program | Deferred with the Mac |
| O14 | A licence for the public repository | Open, no action: matters only for free open-source signing |
| O15 | A standing go for commits and pushes | Taken (plan decision 2); the tag is under 1.5 |
| O16 | Quiet-machine windows | Provisional (plan decision 3) |
| O17 | How the kit reaches the Mac | Deferred with the Mac |

## 3. Still open for the owner

Seven items wait for the owner. Each has a recommended default; none blocks the dual run.

| # | Open item | Why it matters | Recommended default |
| ---: | --- | --- | --- |
| 1 | Code signing certificate and SmartScreen reputation | The build is unsigned. A local installer shows no prompt and a downloaded one shows one Run anyway prompt, but an unsigned build builds no reputation from one release to the next, and Smart App Control, if ever switched on, would block it outright | Stay unsigned while the app is for your own PC. Buy a Certum OV certificate (from EUR 209 a year) only if the app is ever given to someone else; EV no longer gives a SmartScreen advantage. Reopen at once if the SmartScreen check finds Smart App Control on |
| 2 | The elevated-backend trust in `lock.py` | The lock reader accepts a lock file owned by the current user, SYSTEM or Administrators, with a protected access list of those three. Accepting Administrators lets a backend that you started from an elevated shell be found; the cost is that any process already running as administrator is trusted as a backend, and such a process can already do anything on the machine | Keep as it is. Revisit if the app is ever used on a shared machine, where the narrower rule (the current user and SYSTEM only) would apply and an elevated shell could no longer attach |
| 3 | An owner-only access list on the default state folder (`terminal\state`) | The lock file already has a protected list; the folder itself inherits from its parent. On this PC the profile folder is private, so the exposure is low. It grows if the lab ever moves to a drive such as `D:\`, which grants Authenticated Users Modify | Yes: have the backend create the state folder protected, and give the runbook one `icacls` command for the existing folder. Do it as a change with a test in a D6 defect run, not by hand on the live folder while the browser backend runs |
| 4 | One shared memory budget instead of per-cache caps | Today the bar cache holds 512 MiB and the file cache 128 MiB in desktop mode, and the browser door holds 2 GiB; each cache bounds itself, the rest of the app is not counted, and the caps add up | Keep the per-cache caps (W5C re-confirmed this, entry 1.7). Decide after the all-day soak: if its largest sample stays at or under 1.5 GB with a flat slope (the 2 h W5C run read 705.8 MB with +25.9 MB per hour over its last hour; the all-day run is an owner check on a day the PC can be left alone), change nothing; if it keeps rising, replace the caps with one budget over both caches |
| 5 | The Mac gate G1 | Deferred. G1 is recorded as pending, not run. D7, D8, the Mac dual run and decisions O1, O3, O9, O13, O17 wait with it | Keep it deferred until you choose a Mac session; the Windows dual run goes ahead meanwhile |
| 6 | Deleting the `wip/v2` branch | On origin only, one commit (`875e22b`, "wip: v2 snapshot ... not release-checked") that main does not contain; main is 17 commits ahead of it, on the day of writing | Do not delete it yet. Read what it holds with `git -C "$env:USERPROFILE\nq-lab\terminal" diff --stat main origin/wip/v2`. If nothing in it is wanted, delete it after the tag is pushed (`git push origin --delete wip/v2`); the commit stays reachable by its id on the remote until the remote collects it. Deleting is a git write and stays with you |
| 7 | Two torn lines in the lab's access log | `results/oos_access_log.jsonl` holds two lines that are a lone `}` (lines 17724 and 17858 when read on 3 October 2026), left by two seam-test runs before the log's append lock existed. They fail five tests of the lab's own `tests/test_sealed_pins.py` and show as "not JSON" on the OOS screen. The log is append-only and the terminal never writes under `results/`, so they were left alone. The weekly parity and JOBS check commands skip any line that does not start with `{`, so they are not disturbed | Delete those two lines yourself, after a copy of the log, when the lab is quiet. The entries they belonged to were already lost. The lab's gate now skips a torn fragment that cannot be a sealed line |

### 3.1 Known defects carried into the dual run

These are listed in `docs/desktop/d5_integration.md`, section "Open after DEC1". None is a decision; each is here so that the owner sees what the dual run starts with.

| Defect | What it means | Treatment |
| --- | --- | --- |
| The 4.5 s first-launch target was not met in W5B (5,034 ms, PROVISIONAL); met in W5C (3,167 ms) | The W5B finding stands as history. The costs it named are largely addressed by entry 1.7. The next costs are the uncached hypothesis panel request, the `/api/health` walk of `web/src` and the gated session sets of the ledger | G2 re-measures alone; a fix is a D6 defect run |
| Three registered rows, `gotobi6j_v0`, `tsyauction_mid_v0` and `apieia_ho_v0`, are plain rows | The terminal has no series, no tear sheet figures and no place among the Deflated Sharpe trials for them (the N note names them). A registered row is never an error | Learning a row is a change of its own, with its own born-failing series checks |
| `60-print.desktop.ts` is load dependent | Emulating print media on a live page left the engine unresponsive in some runs; the spec runs in an app of its own and is retried twice. A rare 412 on the store's link groups after a test reset passed on the next run | Contained, not understood to the root. A red run for that one spec alone is not a product failure |
| The `/api/runs` index would thrash above about 500 runs by entry count (72 today) | The run file cache holds 512 entries | Raise the entry count when the lab approaches 500 runs |

## 4. Departures from 03 accepted under decision 12

The security review of the plan found four places where the safer design departs from the text of 03. The owner accepted them under plan decision 12. The build follows the safer design.

| # | 03 says | The build does | Why |
| ---: | --- | --- | --- |
| 1 | The shell sends `Authorization: NQT <token>` to the backend it started | A challenge-response proof: the shell sends a nonce and checks the answer; the token is never sent to a listener that has not proved itself. `/api/session` is called only after a fresh proof and a listener-ownership check | A process that bound the port first would otherwise receive the token |
| 2 | The environment allow list of section 8 | The same list plus `SYSTEMDRIVE`, `PATHEXT`, `PROGRAMDATA`, `PROCESSOR_ARCHITECTURE`, `NUMBER_OF_PROCESSORS`, `USERNAME`, `COMPUTERNAME` and `OS`, and an explicit IB list (`IB_HOST`, `IB_PORT`, `IB_ACCOUNT_ID`, `IB_BASE_USD_RATE`) instead of every `IB_*` name | A backtest or the backend needs those variables to start on Windows; an explicit list means a new `IB_*` name cannot slip in |
| 3 | A deny list for the shell's writes | An allow list inside the lab: the shell writes only under `terminal\state`, with handle-based and hardlink-aware checks | An allow list fails closed; a deny list fails open on any path it did not think of |
| 4 | Downloads are written by the shell through `write_new` | Downloads go through WebView2's `DownloadStarting` event with a deferral | The bytes of a blob download are not reachable from Rust without a page command, which the shell does not give the page |

### 4.1 Other departures, forced by the order of the build or by a decision above

| Departure | From | Because |
| --- | --- | --- |
| Local GNU-host release, one combined embedded manifest, no MSVC build | 02 C3-13, 03 section 13.1 | Plan decision 4; the MSVC leg waits for CI |
| No CI workflow files; `desktop/scripts/check.ps1`, `desktop/scripts/advisories.mjs` and one local T8 run stand in | 04 D4.1, D5.3, D5.4 | No GitHub Actions tonight |
| The G2 row "GNU smoke against MSVC measure" becomes GNU smoke against GNU measure | 04 D5 exit list | Follows from the first row |
| The stale-dist rebuild needs an explicit click | 03 section 7.1 (the shell rebuilds a stale page) | It runs package install scripts; refused outright under the test builds |
| The default install folder is per-user under `%LOCALAPPDATA%\Programs`, with a protected list on any chosen folder | 03 section 13.1 (`D:\Apps\nq-lab terminal`) | Decision 1.3 |
| The cold-HOME cap holds for the first launch too | 02 section 4.1 item 3 (usual launches only) | Decision 1.1 |
| An overnight partial soak on the build night | 04 D5 (an all-day soak) | Plan decision 13; the full soak is an owner check |
| A real minimise and restore only on screen 2 behind a guard | 04 D5 | Plan decision 10 |
| The window watch fails a run only for the run's own app tree; other programs' windows are notes | The plan's rule that any new visible window anywhere fails a run | Entry 1.6 |
| The backend record of the release check runs the suite in parallel when the venv has pytest-xdist, with the serial command named in the record | 04 D5 (one serial run) | Speed, under the owner's order of 3 October 2026; the same tests, 4,065 passed and 1 skipped in 1 minute 52 seconds against about 9 to 10 minutes |
| A reference build of `f2e03bf` in `D:\dev\release-b\0.1.0` stands beside the default folder | 04 D5.4 (one release folder) | The default folder is rebuilt from the final merged tree by the merge step; `release_check.ps1` on a non-default folder reports a WARN and is not a release check |

## 5. Deferred

| Item | Waits for |
| --- | --- |
| Everything Mac: the Mac kit and session (D0.3, D0.4), G0, G1 (pending, not run), D7 (the JavaScriptCore golden run, the self-test page, the WebDriver smoke, Mac keys and menus), D8 (WebKit fixes, remote mode, `check_sshd.ps1`, the Mac package, G2 on the Mac), the Mac dual run, and milestones M2, M5, M6, M8. Decisions O1, O3, O9, O13, O17 wait with them | A Mac session |
| MSVC builds and all CI: `desktop-check.yml`, `desktop-release.yml`, `webview2-drift.yml` (the weekly drift run and the Tauri advisory issue opener), `mac-webkit.yml`. The MSVC agreement of the G2 rows stays open | The owner enabling GitHub Actions |
| Code signing (open item 1) | The app being given to someone else |
| An update server and an auto-updater: not built, by design (02 C3-2, 03 section 14). `tauri-plugin-updater` is banned in `deny.toml`, and the artefact check asserts `createUpdaterArtifacts` false and no `plugins.updater`. Each release is a stamped commit, built locally and installed by hand | A change of design |
| Access-list changes on `D:\` or `D:\dev`: the app and the installer protect only the folders they create | The owner, by hand |
| The four-week dual run (D6, milestone M7) and decision O8 at its end | Gate G2 on Windows, with every owner-attended check ticked |
| The owner-attended G2 checks, each with a template in `docs/desktop/checks/`: the first launch after a reboot, the visible run with a real minimise, the real keyboard (16 keys, print, app zoom), the zoom check by eye, the NVDA and Narrator passes, the real JOBS backtest, SmartScreen first run, the custom install folder | The owner |
| The `measure` build's real-lab rows that the 8765 backend or a live lock made pending, and every figure labelled PROVISIONAL | A quiet window (`docs/desktop/checks/2026-10-03_pending-measurements.md`) |
| The full all-day soak | A day with the PC left alone (`docs/desktop/checks/2026-10-03_all-day-soak.md`) |
| `msedgedriver` and `tauri-driver`: not needed, because WebView2 is driven over the debugging protocol. If ever wanted, both install under `D:\dev` without administrator rights | Never, unless that changes |
| Later phases (D9): the accessibility gaps (forced-colors and prefers-contrast rules), PyO3 kernels (G3), binary columns (T5), a native view, a resident backend (O6), a bundled demo engine | Evidence that one is needed |

## 6. Where the pieces are

| What | Where |
| --- | --- |
| The runbook for install, ACL steps and rollback | [handover_windows.md](handover_windows.md) |
| The SmartScreen and Smart App Control record | [smartscreen.md](smartscreen.md) |
| The owner's check templates and the dual-run kit | [checks/](checks/README.md) (start with its README) |
| The automated G2 rows and the pending list | `docs/desktop/g2_windows/results.md` (written by the G2 measuring step) |
| The roadmap's own decisions and actions | [04_roadmap.md](04_roadmap.md), sections "Owner decisions, with the phase that needs each" and "Owner actions, in order" |
