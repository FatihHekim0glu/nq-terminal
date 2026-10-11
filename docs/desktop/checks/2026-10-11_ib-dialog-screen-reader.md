# Check: the IB switch's native dialog with a screen reader

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Turning the IB snapshot switch on or off opens the app's own native confirm dialog. A screen reader user has to hear what the dialog asks, answer it from the keyboard, and then hear where things stand afterwards. This check runs that path with NVDA on the installed release.

Two things are under test. First, focus: the switch's status line is updated when the dialog closes, because the page learns that the window has the focus back, not which button was pressed. Second, announcements: the switch clears its status line and, 50 milliseconds later, sets the line that asks you to answer the dialog. That short gap is deliberate, so that the polite live region announces the line on every press, including a second press with the same text. The check records whether NVDA says each line once, at the right moment, and whether focus comes back to the switch.

A focus or announcement problem that leaves you unable to tell what state the switch is in is a blocking finding. A wording or pause that is odd but still clear is a non-blocking finding. Write both down.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installed tag and release commit | installed tag and release commit (desktop/scripts/owner-session.ps1 fills this) |
| Installed into | |
| NVDA version | |
| Speech mode and voice | |
| Whether the lab's `terminal\state` folder already held a cache | yes / no |

## Preconditions

- The release is installed by the runbook (`docs/desktop/handover_windows.md`), with the checksum verified.
- NVDA is running, and you know its key commands. Note the NVDA version above.
- Neither door is running. Check: `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue` prints nothing.
- No IB setting is set in your environment (`Get-ChildItem Env:IB_*` prints nothing).
- You have about 15 minutes with the PC to yourself. Do not move the mouse during the dialog steps, so that the reader follows the keyboard.

## Steps

1. [ ] Start the installed app from the Start menu. With NVDA on, move to Options in the frame strip with the keyboard (Tab and Enter or Space). Open the Options panel.
2. [ ] Tab until NVDA reads the IB snapshot (read only) switch. Tick what NVDA said: [ ] the name "IB snapshot (read only)", [ ] the role (a switch), [ ] the state (on or off, as in this session), [ ] the note under it (it says the change asks you to confirm and takes effect when the terminal next starts).
3. [ ] Press Space to change the switch. Note the moment you pressed. Tick what NVDA said, in order:
   - [ ] the status line "Answer the app's dialog to confirm." was read, once;
   - [ ] the dialog opened and its title and text were read;
   - [ ] focus was in the dialog, and the buttons were read (when turning on, Cancel comes first and is the default, so Enter cancels).
4. [ ] Press Tab once in the dialog. Tick: [ ] the other button was read, [ ] Shift Tab returns to the first one. Then press Escape. Note what NVDA said. (Escape should cancel the dialog; if it does not, that is a finding.)
5. [ ] After the dialog closed, note where focus is. Tick: [ ] focus is back on the IB snapshot switch or on the Options panel, [ ] NVDA read the neutral status line once: "If you confirmed, the change applies when the terminal next starts. This switch shows the setting in force now.", [ ] the switch state did not change, because you cancelled.
6. [ ] Repeat steps 3 to 5 with the other value (press Space again, then Cancel). Tick the same boxes. Note whether the status line was read a second time with the same words, and whether that was clear.
7. [ ] Press Space to change the switch to the value it does not have now. In the dialog, Tab to the confirm button ("Turn on" or "Turn off") and press Enter. Close the app with its close button, and start it again (the switch applies at the next start). Tick: [ ] the status line was read once after the dialog closed, [ ] the switch shows the value you confirmed, [ ] what NVDA read after the restart.
8. [ ] Restore the switch to its original state: open Options, press Space, and answer the dialog so that the switch is back where it was at step 2. Close the app.

## Readings

| Reading | Rule | What NVDA said | Pass |
| --- | --- | --- | --- |
| Switch name, role and state read on focus | step 2 | | [ ] |
| The asking line read once on each press | steps 3, 6, 7 | | [ ] |
| The dialog title and text read on open | step 3 | | [ ] |
| Focus in the dialog, Cancel read first for "Turn on" | step 3 | | [ ] |
| Escape closes the dialog | step 4 | | [ ] |
| Focus returns to the switch or the Options panel | step 5 | | [ ] |
| The neutral line read once after the dialog closes | steps 5, 6, 7 | | [ ] |
| Nothing read twice when the words repeat | step 6 | | [ ] |

## Pass rule

PASS when every reading is ticked and steps 1 to 8 are ticked. A focus that is lost (NVDA reads nothing after the dialog closes and focus is not on the switch or the panel), an announcement that never comes, or a dialog that cannot be closed from the keyboard is a blocking finding and a FAIL. A line read twice, or read with a short pause that sounds wrong, is a non-blocking finding: write it down and keep the PASS if the rest is ticked.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_ib-dialog-screen-reader\`: NVDA's speech log if you have it turned on (NVDA's own log, not a copy of anything from the app), and a short note of what was read at each step, in your own words. Do not copy a token or a session cookie.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Each announcement in order, the timing you noticed after pressing Space, and any step where focus was not where you expected.
