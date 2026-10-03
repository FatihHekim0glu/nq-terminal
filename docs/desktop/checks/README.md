# Owner checks for the Windows app

Status: templates written on 3 October 2026 for the hand-over (wave W6) and brought in line with the tree at commit `f2e03bf`. Nothing in this folder has been run by the owner yet, so every check below reads NOT RUN. Owner items that are not in this folder: the eomtsy research opening is a step of the lab's research, not of the app.

Gate G2 on Windows (04, phase D5) and the four-week dual run (04, phase D6; 03 section 19) both end in checks that only a person at the keyboard can make: a real keyboard, a screen reader, a window that is really minimised, a double-click on the installed app. The automated rows of G2 are in `docs/desktop/g2_windows/results.md`. This folder holds one dated template for each check that stays with the owner, so that each is run the same way every time and leaves a record that can be read later.

G2 and milestone M4 stay provisional until every row marked "G2" below has a filled-in file here with a ticked PASS box (04, D5 exit: every owner-run check recorded in a dated file under `docs/desktop/checks/`).

## The checks

| Check | File | Needed for | Owner time | Status |
| --- | --- | --- | --- | --- |
| Install into a custom folder (ACL and refusals) | [2026-10-03_custom-install-folder.md](2026-10-03_custom-install-folder.md) | G2, register 1.3 | 15 minutes | NOT RUN |
| First launch after a reboot | [2026-10-03_reboot-first-launch.md](2026-10-03_reboot-first-launch.md) | G2 | 5 minutes plus the reboot | NOT RUN |
| Visible run of the installed release, with a real minimise | [2026-10-03_visible-run.md](2026-10-03_visible-run.md) | G2 | about 15 minutes of attention, 30 minutes minimised | NOT RUN |
| Real keyboard (16 of 16), print and app zoom keys | [2026-10-03_real-keyboard.md](2026-10-03_real-keyboard.md) | G2 | about 15 minutes | NOT RUN |
| 200% zoom by eye in small windows | [2026-10-03_zoom-200-by-eye.md](2026-10-03_zoom-200-by-eye.md) | G2, register 1.2 | about 20 minutes | NOT RUN |
| NVDA pass | [2026-10-03_nvda.md](2026-10-03_nvda.md) | G2 | about 15 minutes | NOT RUN |
| Narrator pass | [2026-10-03_narrator.md](2026-10-03_narrator.md) | G2 | about 15 minutes | NOT RUN |
| The real JOBS backtest | [2026-10-03_real-jobs-backtest.md](2026-10-03_real-jobs-backtest.md) | G2 (05 X09) | 20 minutes | NOT RUN |
| SmartScreen first run | [2026-10-03_smartscreen-first-run.md](2026-10-03_smartscreen-first-run.md) | the unsigned decision | 10 minutes | NOT RUN |
| The all-day soak | [2026-10-03_all-day-soak.md](2026-10-03_all-day-soak.md) | G2, only if the overnight soak was partial | one day with the PC left alone | NOT RUN |
| Measurements left pending or provisional | [2026-10-03_pending-measurements.md](2026-10-03_pending-measurements.md) | G2 | 10 minutes in a quiet window | NOT RUN |
| The weekly parity list | [2026-10-03_weekly-parity.md](2026-10-03_weekly-parity.md) | D6, once a week for four weeks | about 15 minutes | NOT RUN |
| The four-week dual-run kit | [2026-10-03_dual-run-kit.md](2026-10-03_dual-run-kit.md) | D6 | a few minutes a day | NOT STARTED |

The installer, the runbook and the SmartScreen record that these checks lean on are in `docs/desktop/handover_windows.md` and `docs/desktop/smartscreen.md`. The decisions behind the pass rules are in `docs/desktop/owner_decisions_windows.md`.

## Order

1. Verify the installer and install it (the runbook), then the custom-folder check if you want the app outside the default folder.
2. The visible run. It also gives the shell log that the other checks read.
3. The real keyboard, the zoom check, NVDA, Narrator, in any order.
4. The real JOBS backtest.
5. SmartScreen first run, whenever you have a copy of the installer that came through a browser.
6. The reboot check at a time you choose: it needs a fresh boot, so do it first thing after a restart and before you open anything else.
7. The soak when you can leave the PC for a day.
8. Then, and only then, start the dual run.

## How to use a template

1. Open the file. The date in its name is the day the template was written. If you run the check on another day, rename the file to the day of the run (`YYYY-MM-DD_<check>.md`) before you fill it in.
2. Fill in the build table first. The installer name and size, and its SHA-256, are in `SHA256SUMS` in the release folder; a field written in double curly brackets, with G2 or W6 and a short description inside, is a number that the final tree fills in, and you copy it from there, you do not invent it.
3. Do the steps in order. Tick one box per step. A step that cannot be done is a FAIL for the check unless the file says otherwise, and you write down why.
4. Tick PASS or FAIL once, at the end. Do not tick PASS with an unticked step above it.
5. Keep the evidence. Put raw files (screenshots, harness output folders, copied log excerpts) in `D:\dev\d5\owner-evidence\<date>_<check>\`, never in the repository, and list the file names and their SHA-256 in the template's evidence table. Copy only short text excerpts into the template itself.
6. Never copy a session cookie, a one-time code, a token or the contents of the lock file into a record or a screenshot. Black out the address bar of any screenshot that shows a launch link.
7. Do not edit a filled-in file later. A repeat run is a new file with its own date. A failed check stays on record beside the run that fixed it.
8. A failed check is filed the same day as a defect: what you did, what happened, what you expected, and whether the same thing happens in the browser terminal. The defect rule of 03 section 19 then applies: a defect that exists in the app and not in the browser is fixed before any new app feature.

## Words used in the templates

- **Blocking finding** (screen readers and keys): something you cannot do, or cannot tell, because of how the app behaves. Examples: a control that the keyboard cannot reach, a value that is read without its name, a table read as one long line, a key that does nothing, a key that leaves the page, a focus trap, a dialog that cannot be closed from the keyboard. A word that is read oddly (a mnemonic spelled out letter by letter, a pause in the wrong place) is a non-blocking finding: write it down, it does not fail the check.
- **Blocking defect** (the dual run): as defined in 04 under the QA gate: a red parity row, a wrong number, a breach of the research gate or of the write ban, or a crash.
- **Quiet window**: no build, test run, download, scan or game running, and the 60-second CPU average of the whole machine at or under 10%. The harness checks this itself and labels a run PROVISIONAL when it cannot get a quiet reading in ten minutes.
- **Window watch**: while the harness or an automated suite launches the app, a watch over every window on the machine records each new visible window and each change of the foreground window, with the program that owns it. Only a window or a change that comes from the app's own process tree fails a run. Windows and foreground changes of other programs (a launcher that starts at sign-in, a notification, a game) are kept as notes in the run's record and do not fail it. This is owner decision 1.6 of the register. A window the watch could not trace to an owner still fails.
- **Both doors**: the app and the browser terminal. They share one backend per lab through the lock file: whichever starts first owns the backend, the other attaches.
- **1 MB** in a memory figure is 1,048,576 bytes, as the harness counts it.

## Read-only commands

Every command in these templates only reads, except the ones that start the harness or the app, which write only under `D:\dev\d5` and the app's own folders. Run them in a PowerShell window. Two shorthand variables are used throughout:

```powershell
$Terminal = Join-Path $env:USERPROFILE 'nq-lab\terminal'
$Release  = 'D:\dev\release\0.1.0'
```

The app's own settings and logs are in its config folder, normally `%APPDATA%\dev.nqlab.terminal` (the shell log is `logs\shell.log` inside it). Each template that reads the log first confirms the folder exists with `Test-Path`.
