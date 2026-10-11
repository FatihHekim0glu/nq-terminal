# Check: a minimised start, closed from the taskbar

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

An app started minimised (from a shortcut set to run minimised, or with `Start-Process -WindowStyle Minimized`) must open minimised, must not take focus, and must come back as it was saved when you restore it. This check covers one path that the automated runs cannot show on a real screen: start the installed app minimised with a saved maximised window, close it from the taskbar without restoring it, then start it normally. The window must come back maximised.

The check follows item 3 of the 0.3.2 audit: start the release minimised with a saved maximised window, close it from the taskbar without restoring, start normally, and confirm it comes up maximised. Section 8 of `docs/desktop/handover_windows.md` describes the minimised start.

This check does not cover a minimise followed by a close from a window that was already maximised and open. The fix does not cover that case, so do not count it here.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installed tag and release commit | installed tag and release commit (desktop/scripts/owner-session.ps1 fills this) |
| Installed into | |
| Path of the installed executable (from Settings, Apps) | |
| Saved window state before the run (maximised, or not) | |

## Preconditions

- The release is installed by the runbook (`docs/desktop/handover_windows.md`), with the checksum verified.
- Neither door is running. Check: `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue` prints nothing.
- The app is not running. Check: `Get-Process -Name 'nq-lab-terminal' -ErrorAction SilentlyContinue` prints nothing.
- You have a few minutes with the PC to yourself. No other window needs your attention during the steps.

## Steps

1. [ ] Start the installed app normally from the Start menu. Maximise its window with the maximise button. Wait for HOME to show its data.
2. [ ] Close the app with its close button. Wait until `Get-Process -Name 'nq-lab-terminal' -ErrorAction SilentlyContinue` prints nothing. The window state is now saved as maximised.
3. [ ] Start the app minimised, in a PowerShell window, with the full path of its executable:

   ```powershell
   Start-Process -FilePath '{{path of the installed executable (desktop/scripts/owner-session.ps1 fills this)}}' -WindowStyle Minimized
   ```

   Tick: [ ] the app appears on the taskbar only, [ ] no window is shown on the screen, [ ] the window you were using keeps the focus (type a few characters in a text box, if you have one open, to check it).
4. [ ] Wait 20 seconds, so that HOME has time to load. Then close the app from the taskbar: right-click its taskbar button and choose Close, or click the middle mouse button on it. Do not restore the window first. Tick: [ ] the app closes, [ ] it did not come back on the screen while closing.
5. [ ] Confirm nothing of the app is left: `Get-Process -Name 'nq-lab-terminal' -ErrorAction SilentlyContinue` prints nothing.
6. [ ] Start the app normally from the Start menu. Tick: [ ] it comes up maximised, [ ] it comes up on the screen at the same size as in step 1, [ ] nothing flashed or asked a question you did not expect.
7. [ ] Close the app with its close button.

## Readings

| Reading | Rule | Value | Pass |
| --- | --- | ---: | --- |
| Minimised start: on the taskbar only, no window shown | step 3 | | [ ] |
| Minimised start: the focus stayed where it was | step 3 | | [ ] |
| Close from the taskbar without restoring | step 4 | | [ ] |
| No process of the app left after the close | step 5 | | [ ] |
| Normal start after the minimised close comes up maximised | step 6 | | [ ] |

## Pass rule

PASS when every reading is ticked and steps 1 to 7 are ticked. A normal start that comes up in its default size instead of maximised, a minimised start that takes focus or shows a window, or a process of the app left after the close is a FAIL, and is filed as a defect the same day.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_minimised-close\`: a screenshot of the taskbar after step 3 and a screenshot of the app after step 6 (address bar and any launch link blacked out), and the output of the `Get-Process` commands in steps 2 and 5.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

The state of the screen at each step, and anything that looked wrong.
