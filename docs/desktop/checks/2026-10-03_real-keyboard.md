# Check: real keyboard (16 of 16), print and app zoom keys

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

The automated tests send keys over the debugging protocol, which goes straight to the page and skips the window's own key handling. So they cannot show whether a key you actually press reaches the page, or is taken first by the window or by Windows. This check presses the 16 keys of G2 on the installed release with a physical keyboard, then checks printing and the app's own zoom keys.

G2 needs 16 of 16 (04, phase D5 exit list; 03 section 11.1). F10 going to the system menu is a failure to fix, not a note.

The 16 keys: F1, F8, F9, F10, F11, Alt+1 to Alt+9 (nine keys), Alt+K and Ctrl+K.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer SHA-256 | 2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590 |
| Release commit | 8122c877bb00e4f07ce505d5ba0468d6a9858f41 |
| Keyboard (make, layout, for example UK) | |
| Windows build | |
| Display scale | |

## Preconditions

- The release is installed and starts to HOME with data.
- A physical keyboard, not the on-screen keyboard, not a remote session.
- Nine panels open, so that Alt+1 to Alt+9 each have somewhere to go. Type these in the command line one after another, each followed by Enter: `GP`, `REG`, `MT`, `EQ`, `MON`, `CORR`, `LEDG`, `OOS`, `HELP`. If a mnemonic opens no new panel, use any other screen from the HELP index so that nine are open.
- Click once on a panel title so the page has the focus before you begin.

## Steps: the 16 keys

Press each key once, with the page focused. For each, tick "reached the page" only if the effect in the second column happened. Write what else happened in the last column: a window that went full screen, a Windows menu that opened, a beep, a browser find bar, a help page in another program. Anything in the last column other than the expected effect is a failure of that key.

| # | Key | Expected effect in the page | Reached the page | What else happened |
| ---: | --- | --- | --- | --- |
| 1 | F1 | Help for the focused screen opens (pressed twice quickly, the HELP index) | [ ] | |
| 2 | F8 | The command line takes the equity sector word, and the message line says there are no equities in nq-lab | [ ] | |
| 3 | F9 | The command line takes the commodity sector word | [ ] | |
| 4 | F10 | The command line takes the index sector word; the window's system menu does not open and focus does not leave the page | [ ] | |
| 5 | F11 | The command line takes the currency sector word; the window does not go full screen | [ ] | |
| 6 | Alt+1 | Panel 1 takes the focus | [ ] | |
| 7 | Alt+2 | Panel 2 takes the focus | [ ] | |
| 8 | Alt+3 | Panel 3 takes the focus | [ ] | |
| 9 | Alt+4 | Panel 4 takes the focus | [ ] | |
| 10 | Alt+5 | Panel 5 takes the focus | [ ] | |
| 11 | Alt+6 | Panel 6 takes the focus | [ ] | |
| 12 | Alt+7 | Panel 7 takes the focus | [ ] | |
| 13 | Alt+8 | Panel 8 takes the focus | [ ] | |
| 14 | Alt+9 | Panel 9 takes the focus | [ ] | |
| 15 | Alt+K | The key map overlay opens (Esc closes it) | [ ] | |
| 16 | Ctrl+K | The command line takes the focus and its text is selected | [ ] | |

The exact words for the sector keys are in the key map that Alt+K shows and in HELP; tick the box when the effect matches what the key map says that key does.

Count of ticks: ____ of 16.

## Steps: keys the window must leave alone

These are held back on purpose, so that the page has the keyboard (03 section 11.1). Press each once and tick when nothing browser-like happens.

- [ ] F5 does not reload the page.
- [ ] Ctrl+R does not reload the page.
- [ ] F12 opens no developer tools.
- [ ] Ctrl+F opens no find bar.
- [ ] Ctrl+P opens no print dialog (printing is by the Print dossier row below).
- [ ] Alt+Tab and the Windows key still work, and when you return, the page has the keyboard again.
- [ ] Alt+F4 closes the window (it is the system's key); do this last, and start the app again for the zoom steps.

## Steps: the app zoom keys

The app replaces the engine's zoom with its own, so that text can still be enlarged (WCAG 2.2 SC 1.4.4). Steps are 25% from 50% to 300%.

- [ ] Ctrl+plus (main row, `Ctrl+=`) once: the page grows to 125%. Press three more times to 200%.
- [ ] Ctrl+plus on the numeric keypad does the same.
- [ ] Ctrl+minus (main row and keypad) steps down by 25%.
- [ ] Ctrl+0 returns to 100% from any level.
- [ ] At 300% another Ctrl+plus changes nothing; at 50% another Ctrl+minus changes nothing.
- [ ] Ctrl and the mouse wheel does not zoom the page (it is off, as in a terminal).
- [ ] The plain `+`, `=` and `-` keys with a chart focused still zoom the chart, not the page (no Ctrl pressed).
- [ ] Set 150%, close the app and start it again: it comes back at 150%. Reset with Ctrl+0.

## Steps: print

- [ ] Open DES, or an EQ tear sheet. In the panel's Options menu pick "Print dossier".
- [ ] The line below the frame says "Print dialog opened for ... Choose Save as PDF to keep a copy."
- [ ] The print dialog opens and its preview shows the dossier on A4 landscape, with the charts as images.
- [ ] Print to PDF (the "Microsoft Print to PDF" printer, or Save as PDF) into `D:\dev\d5\owner-evidence\<date>_real-keyboard\`. Open the PDF: the figures match the panel.
- [ ] After the dialog closes the page has the keyboard: Ctrl+K focuses the command line.

## Pass rule

PASS when the count in the 16-key table is 16 of 16, nothing in the last column of any row is anything other than the expected effect, every box in the three step lists is ticked, and the dossier printed. Any key below 16, F10 included, is a FAIL and a defect to fix before G2 closes. If only the print or a zoom row fails, the check is still a FAIL, filed against that row.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_real-keyboard\`: the printed PDF, a screenshot of the key map overlay (key 15), and a screenshot at 200% zoom. Write any failing key and what it did in the findings below, with your keyboard layout, because some keys differ by layout.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Which keys, what happened instead, and whether the same key works in the browser terminal on 8765.
