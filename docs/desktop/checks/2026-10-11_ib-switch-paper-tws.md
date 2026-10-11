# Check: the IB snapshot switch with paper TWS

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

The IB snapshot switch in Options turns on the read-only snapshot of your paper account in TWS. It is the one place in the installed app that reads from a broker, so this check makes sure, on the real installed release, that the switch does what it says: it turns on after you confirm, it applies at the next start, it masks the account, it refuses a live account and the live ports, and an app started minimised does not take focus. The app never places, changes or cancels an order. If any screen offers such an action, that is a blocking defect on the day.

Pass rules, from `docs/desktop/handover_windows.md` (section 7, and section 8 for the minimised start):

- the switch turns on only after you confirm in the app's own dialog, and the change applies at the next start;
- the account number is masked wherever the app shows it;
- a set value the backend would refuse (a live account that does not start with DU, port 7496 or 4001) makes the switch refuse to turn on, and the note names the setting, never its value;
- turning the switch off is the same as turning it on: confirm, restart, and the snapshot stops.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installed tag and release commit | installed tag and release commit (desktop/scripts/owner-session.ps1 fills this) |
| Installed into | |
| TWS version and mode (paper, or not running) | |
| IB port in use by TWS | |
| Whether the lab's `terminal\state` folder already held a cache | yes / no |

## Preconditions

- The release is installed by the runbook (`docs/desktop/handover_windows.md`), with the checksum verified.
- TWS is running in paper mode and logged in to the paper account, on the default port 7497. If TWS is not running, steps 3 to 5 still apply: the app then shows a plain reason it cannot read the account, and that reason is the reading you record.
- Neither door is running. Check: `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue` prints nothing.
- Nothing you did earlier sets `IB_PORT`, `IB_HOST`, `IB_ACCOUNT_ID` or `IB_BASE_USD_RATE` in your Windows environment. Check: `Get-ChildItem Env:IB_*` prints nothing. If it prints something, note it, and remove it for this run.
- You can leave the PC for about 15 minutes, with the app open.

## Steps

1. [ ] Start the installed app from the Start menu. Open Options in the frame strip. Read the switch. Note its state word (On or Off in this session) and its note.
2. [ ] Click the IB snapshot (read only) switch. Tick what you saw: [ ] a native dialog asked you to confirm, [ ] the dialog offered Cancel first, [ ] the dialog text named the IB settings it would pass, by name and never by value, [ ] the switch did not change yet.
3. [ ] Press Cancel. Tick: [ ] the switch is unchanged, [ ] the status line reads the answer line ("If you confirmed, the change applies when the terminal next starts ..."), [ ] nothing was written. (The status line is neutral by design, since the page is not told which button was pressed.)
4. [ ] Click the switch again and confirm with "Turn on". Note the time. Close the app with its close button. Start it again from the Start menu.
5. [ ] After the restart, open LIVE. Tick: [ ] LIVE reads the paper account, or shows a plain reason it cannot (TWS not running, for example), [ ] the account number is masked everywhere on the screen (the full number is never shown), [ ] no order, cancel or close control is on the screen, [ ] the switch in Options still says On in this session.
6. [ ] Turn the switch off: click it, confirm with "Turn off", close the app, start it again. Tick: [ ] LIVE no longer reads the account, [ ] the switch in Options says Off in this session.
7. [ ] Refusal, live port. Close the app. In a PowerShell window, run `$env:IB_PORT = '7496'`, then start the installed app from that same window with `Start-Process` and the full path of its executable (the path is shown in Settings, Apps). Open Options, click the switch, and try to turn it on. Tick: [ ] the switch refuses to turn on, [ ] the note names the setting `IB_PORT` and not the value 7496, [ ] no snapshot is taken. Then close the app and run `Remove-Item Env:IB_PORT`.
8. [ ] Repeat step 7 with `$env:IB_PORT = '4001'`. Same ticks. Then remove the variable.
9. [ ] Refusal, live account. Repeat step 7 with `$env:IB_ACCOUNT_ID = 'U0000000'` (an account that does not start with DU, used only to test the refusal; no account of yours is involved). Same ticks, with the note naming `IB_ACCOUNT_ID`. Then remove the variable.
10. [ ] Minimised start. Close the app. Start it with `Start-Process -WindowStyle Minimized` and the full path of its executable. Tick: [ ] the app opens minimised, [ ] it does not take focus from the window you were using, [ ] when you restore it from the taskbar, it comes back as it was saved.
11. [ ] Close the app. Check that nothing of the app is left: `Get-Process -Name 'nq-lab-terminal' -ErrorAction SilentlyContinue` prints nothing.

## Readings

| Reading | Rule | Value | Pass |
| --- | --- | --- | --- |
| Switch turns on only after confirm, applies at next start | steps 2 to 4 | | [ ] |
| Account masked on every screen | step 5 | | [ ] |
| LIVE reads the paper account, or gives a plain reason | step 5 | | [ ] |
| Switch off stops the snapshot at the next start | step 6 | | [ ] |
| Port 7496 refused, value not shown | step 7 | | [ ] |
| Port 4001 refused, value not shown | step 8 | | [ ] |
| Account not starting with DU refused, value not shown | step 9 | | [ ] |
| Minimised start does not take focus | step 10 | | [ ] |

## Pass rule

PASS when every reading is ticked and steps 1 to 11 are ticked. A full account number on any screen, an order control of any kind, a refusal that shows the value it refuses, or a switch that turns on without confirmation is a FAIL and a blocking defect. A switch that says On and reads nothing when TWS is running and logged in to paper is a FAIL, to be filed as a defect with the LIVE text.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_ib-switch-paper-tws\`: screenshots of the dialog (step 2), of LIVE after the restart (step 5, with the address bar and any launch link blacked out), and the text of the note in step 7. Do not save the value of any IB setting in a screenshot where the refused value is on show; a refusal names the setting, so crop to the note. Do not copy a token or a session cookie.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Anything that looked wrong, the TWS state at each step, and whether the app's own note matched what TWS showed.
