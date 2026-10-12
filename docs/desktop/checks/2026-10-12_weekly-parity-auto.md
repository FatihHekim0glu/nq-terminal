# Check: the automated weekly parity list

Result: [ ] PASS (every automated row green, the four owner items still to do)   [ ] FAIL (a red row, another caller or a line after the fence)   Status: NOT RUN

This is the blank record of the automated half of the weekly parity list (`2026-10-03_weekly-parity.md`, 03 section 19, 04 phase D6, task D6.2). A run writes its own dated record; copy the figures of that record here, name the copy `YYYY-MM-DD_weekly-parity-auto.md` with the date of the run, and keep the file with this date in its name as the blank template. The owner's list, which stays in `2026-10-03_weekly-parity.md`, shrinks to the four items in the last section of this file.

## Purpose

The owner's list has 16 rows. Thirteen of them need no hands and no eyes, only a second door onto the same backend, so a Playwright run does them: the app's own page is the first door, and a headless Chromium holding the app's own session is the second. Each row reads figures from the page in each door and compares them. A difference between the doors, a console error, a failed API answer or a request that is not a same-origin GET turns the row red.

The run proves the tag's code on the hidden smoke build, not the shipped binary: the shipped binary has no debugging port (04, phase D5 notes). It is the same web code, the same shell and the same backend start-up as the installed app.

## The rows

| # | Row | How the run checks it | Doors |
| ---: | --- | --- | --- |
| 1 | HOME with data | The four HOME panels: key figures, chart summaries and the first grid rows; no alert, no placeholder, no DEMO DATA flag | app and browser, compared |
| 2 | GP and GIP (pan and zoom) | The table view of GP in both doors: its row count, its edge rows and a checksum of the whole table; GIP wheel zoom and drag pan with the frame interval sampled in the page, p95 judged against the harness ceiling of 25 ms for `gip_pan_zoom_p95` | table view compared; GIP in the app |
| 3 | REG and MT | The figures of both panels | app and browser, compared |
| 4 | RUN with the fills pivot | The Fills grid and the pivot view of a run: both show as many rows as the API holds, the fills' commissions add up to the run's own `fees_total`, and the grid opens in under a second | app |
| 5 | EQ to MRET tabs | The five tabs from EQ to MRET of one hypothesis, the headline Sharpe included | app and browser, compared |
| 6 | MON and CORR | The first grid rows of MON, and the chart summary and figures of CORR | app and browser, compared |
| 7 | LEDG and OOS | The grid and the pivot view of each; the ledger pivot holds as many rows as the ledger, and the gate log holds reads with the caller `terminal` | app and browser, compared |
| 8 | LIVE and JRNL in stream mode | The stream line reads "live, server events" on both | app and browser, compared |
| 9 | HELP | The index opens and one topic opens; its heading and text | app and browser, compared |
| 13 | JOBS queue and stop | Queue the slow stand-in run, see the row, press Stop, answer the confirmation, see STOPPED. Fixture backend with the fake runner only, because every smoke build starts its backend with `NQT_JOBS=off`, and the real row writes a run folder under `backtests\output`. On real files the row is skipped, and the record says so | browser door, on the fixture |
| 14 | F1 and F8 to F11 | The keys sent over the debugging protocol, as `40-keys` does: each reaches the page, the page prevents the default, the engine does nothing of its own | app |
| 15 | SAVE and LOAD of a workspace | `SAVE`, change the layout, `LOAD` in the app; `LOAD` and `FORGET` in the browser door | both |
| 16 | Amber-classic look | The Options menu's Theme group in the app; after a reload both doors report the same colours on HOME and REG; the standard look is put back | app and browser, compared |

## The four items that stay with the owner

| Item | Row | Why a run cannot do it |
| --- | --- | --- |
| DES native save | 10 | The native save dialog is the owner's own desktop; the run covers the download handler (`30-export`), not the dialog |
| GRAB pasted into an image editor | 11 | Pasting an image needs an editor on the owner's desktop; the run covers the text copy |
| Printing the dossier to PDF | 12 | The real print dialog and the PDF are the owner's; the run covers the print stylesheet (`60-print`) |
| Real F10 and F11 | 14 | Keys sent over the debugging protocol do not take the host's own accelerator path (`40-keys`), so a real keyboard is the check |

## The gate log

Each run reads the research gate's log read only, since the start of the run, as the owner's list does: lines, other callers (a caller that is not `terminal`) and lines whose end is after 2022-01-01. The record states the three figures. Another caller whose time stamp falls inside the run is a reading to look at, because another lane's research may have been running; a line after the fence is a breach and blocks.

## How to run it

Fixture mode, from `terminal\web`, with a built `web\dist` and a smoke build (`NQT_SMOKE_EXE`), hidden, under the Playwright slot:

```powershell
pnpm e2e:desktop -- 80-parity-auto
```

Real mode, from the main tree only (the script refuses app mode in a worktree), with the same smoke build and a built `web\dist`; it runs the parity spec only, inside the real-data smoke's own guards (temporary state folder, `NQT_JOBS=off`, window watch, the research files byte for byte, the gate log's new lines):

```powershell
$env:NQT_PARITY_REAL = '1'
$env:NQT_PARITY_OUT = 'D:\dev\v04\measure\w5-mac-kit'
powershell -NoProfile -ExecutionPolicy Bypass -File terminal\scripts\smoke_real.ps1 -Mode App -Grep 'weekly parity list, real lab'
```

The run writes `<date>_weekly-parity-auto-<mode>.md` and `.json` into its run folder and into `NQT_PARITY_OUT` when that is set (never on C:).

## This run

| Field | Entry |
| --- | --- |
| Run date | |
| Mode (fixture or real) | |
| Smoke build and web build | |
| Rows green, red, for the owner, skipped | |
| Gate log: lines, other callers, after the fence | |

## Red rows

| Row | The difference that was read | Same in the browser terminal alone (yes or no) | Blocking | Filed as |
| ---: | --- | --- | --- | --- |
| | | | | |

## Pass rule

PASS when every automated row is green, rows 10 to 12 are marked for the owner, row 13 is green on the fixture (skipped on real files), and the gate reading shows 0 other callers and 0 lines after the fence. The week of the dual run still needs the owner's four items.

## Notes

Anything slow, odd or different from the last run that did not turn a row red.
