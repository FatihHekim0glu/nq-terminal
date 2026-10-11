# Check: the installed app under a real Windows contrast theme

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

The release check runs the app's screens in a browser that emulates the Windows contrast themes, so every screen is covered on every run. An emulation is not the real thing: Windows replaces the colours of the window itself, and an app that sets its own colours can lose text, borders, focus rings or chart lines under a real theme. This check looks at the installed app under a real Windows contrast theme, screen by screen, with your own eyes.

Source: `docs/desktop/g2_windows/verdict.md`, the 0.3.0 section ("Not re-measured on 0.3.0"): the contrast themes were checked by the release check's Playwright spec in emulation, and a look under a real Windows contrast theme in the installed app is an owner check. Every top-level screen of the app and each panel of Options must be readable and usable under the theme. A control that disappears, text you cannot read, or focus you cannot see is a finding.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installed tag and release commit | installed tag and release commit (desktop/scripts/owner-session.ps1 fills this) |
| Installed into | |
| Contrast theme used (name as Windows shows it) | |
| Theme you were using before the run (to put back) | |

## Preconditions

- The release is installed by the runbook (`docs/desktop/handover_windows.md`), with the checksum verified.
- Neither door is running. Check: `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue` prints nothing.
- Write down the contrast theme you use now, so that you can put it back at the end.
- You have about 30 minutes. Changing the theme changes how Windows draws every window, so save any work in other programs first.

## Steps

1. [ ] Note the current contrast theme (Settings, Accessibility, Contrast themes) in the build table. Then choose one of the built-in contrast themes that you can read most easily, and apply it. Wait for Windows to finish the change.
2. [ ] Start the installed app from the Start menu. Wait for HOME to show its data.
3. [ ] Look at HOME. Tick: [ ] all text is readable, [ ] every button and field has a visible edge, [ ] a focus ring shows when you press Tab, [ ] no chart or table line disappears into the background.
4. [ ] Open each top-level screen the frame strip offers, one at a time, and tick the same four points on each. Note the screen's name in the findings. Use the keyboard to move around (Tab, arrow keys, Enter), and check that the focus ring is visible on each control you reach.
5. [ ] Open Options and go through each of its panels. Tick the same four points. Turn the IB snapshot (read only) switch's note into view and read it (do not change the switch).
6. [ ] Open the research launcher (the Start from form) and check that its fields, its buttons and its messages are readable. Close it without starting a job.
7. [ ] Put the contrast theme back to the one you noted in the build table. Wait for Windows to finish the change, and close the app.

## Readings

| Reading | Rule | Value | Pass |
| --- | --- | --- | --- |
| HOME: text, edges, focus ring, chart lines | step 3 | | [ ] |
| Each top-level screen: text, edges, focus ring | step 4 | | [ ] |
| Each Options panel: text, edges, focus ring | step 5 | | [ ] |
| Research launcher: fields, buttons, messages | step 6 | | [ ] |
| Original theme restored | step 7 | | [ ] |

## Pass rule

PASS when every reading is ticked and steps 1 to 7 are ticked. A text or control that cannot be read or reached under the theme, a focus ring that cannot be seen, or a value that is shown by colour alone is a FAIL and is filed the same day, with the screen name, the theme name and a screenshot. A border or colour that looks slightly different from the normal theme, but is still clear, is a non-blocking finding: write it down.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_real-contrast-theme\`: one screenshot per screen checked (the address bar and any launch link blacked out), and the name of the theme. Do not save a screenshot of the IB snapshot note with an account number on it.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Each screen with what you found, and whether the same screen looked right under the normal theme.
