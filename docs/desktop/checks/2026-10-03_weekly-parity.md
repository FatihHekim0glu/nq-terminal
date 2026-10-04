# Check: the weekly parity list

Result: [ ] PASS (all 16 rows green)   [ ] FAIL (at least one red row)   Status: NOT RUN

Copy this file for each week of the dual run, and name the copy `YYYY-MM-DD_weekly-parity-week-N.md` with the date you ran it and N from 1 to 4. The file with the template date in its name stays as the blank template. The dual-run kit (`2026-10-03_dual-run-kit.md`) says when to stop and what counts as blocking.

## Purpose

The weekly parity list of 03 section 19 and 04 phase D6 (task D6.2), about 15 minutes. Each row exercises one thing the owner relies on, in the installed app, and compares it where it matters with the browser terminal on the same backend. The dual run closes (milestone M7) after four consecutive weeks with every row green and no blocking defect, on the tag that is installed at the end.

## This week

| Field | Entry |
| --- | --- |
| Week number (1 to 4) | |
| Run date | |
| Installed tag (as shown by the installer's version, and the release commit) | 8122c877bb00e4f07ce505d5ba0468d6a9858f41 |
| Which door started the backend today (app or browser) | |
| Consecutive green weeks before this one | |

## Before you start

- Start either door. Whichever starts first owns the backend; the other attaches through the lock file. Open the other door as well, so that rows can be compared.
- Take one reading of the research gate log before the week's use is judged. It reads the whole log, so it takes a moment. Any line that was written while only the terminal was running and has a caller other than `terminal`, or an end date after 2022-01-01, is a breach of the research gate and a blocking defect. If you also ran research on your own, discount the lines that belong to it by their time stamps.

```powershell
$Lab   = Join-Path $env:USERPROFILE 'nq-lab'
$Since = [datetime]::Parse('2026-10-03T00:00:00Z').ToUniversalTime()   # the date of last week's run (the first week: the day you start)
$lines = Get-Content -LiteralPath "$Lab\results\oos_access_log.jsonl" | Where-Object { $_.StartsWith('{') } | ForEach-Object { $_ | ConvertFrom-Json }
$new = @($lines | Where-Object { [datetime]$_.ts_utc -ge $Since })
'lines since: {0}; other callers: {1}; ending after the fence: {2}' -f $new.Count,
  @($new | Where-Object { $_.caller -ne 'terminal' }).Count,
  @($new | Where-Object { [datetime]$_.end -gt [datetime]'2022-01-01' }).Count
```

Write the three figures here: ____ lines, ____ other callers, ____ after the fence.

The command skips any line that does not start with `{`: the log holds two torn lines (a lone `}`, left by an old test run) that would otherwise print an error each. It was run read-only on 3 October 2026 and printed `lines since: 12607; other callers: 261; ending after the fence: 0` for a start date of that day, with no error. The other callers there were the lab's own research workflows, not the terminal, which is why the rule above says to discount research you ran yourself. A line that is not the terminal's and whose time falls while only the terminal was running is the one to look at.

## The 16 rows

For each row, tick App when it passes in the installed app. For the rows where the last column asks, repeat the same thing in the browser terminal and tick Browser when the number or the behaviour is the same. A row is green only when every tick it asks for is made. Write what you saw in the note when it is not.

| # | Row | What to do | Green when | App | Browser | Note |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | HOME with data | Start; wait for HOME | Four panels fill with data, no error line, no DEMO DATA flag | [ ] | [ ] | |
| 2 | GP and GIP, pan and zoom | Open `NQ GP 1d`; zoom and pan with the mouse and the keys; open a GIP day | The chart redraws smoothly, the readout follows, the table view (T) gives the same numbers | [ ] | | |
| 3 | REG and MT | Open both | Both fill with data; the first figure of each is the same in the browser | [ ] | [ ] | |
| 4 | RUN with the fills pivot | Open a run, open its fills and the pivot | The grid opens in under a second and the pivot totals agree with the run's own totals | [ ] | | |
| 5 | EQ to MRET tabs | Open `EQ`, then each tab to MRET | Every tab fills; the headline Sharpe is the same in the browser | [ ] | [ ] | |
| 6 | MON and CORR | Open both | Both fill; one cell of CORR matches the browser | [ ] | [ ] | |
| 7 | LEDG and OOS | Open both | LEDG shows its pivot; OOS shows the gate log, with callers `terminal` for what the terminal read | [ ] | | |
| 8 | LIVE and JRNL in stream mode | Open both | The stream line reads "live, server events", not polling | [ ] | | |
| 9 | HELP | Press F1; open the index; open one topic | The topic opens and reads correctly | [ ] | | |
| 10 | DES save | On DES, use its save action | The save dialog opens, the file is written where you chose and opens; the page says it saved | [ ] | | |
| 11 | GRAB copy and save | Grab a panel; copy it; save it | Paste the copy into an image editor: the panel is there. The saved file opens and is not empty | [ ] | | |
| 12 | Print dossier | On DES or an EQ tear sheet, Options, Print dossier | The print dialog opens with the dossier on A4 landscape; save it as PDF; the figures match the panel | [ ] | | |
| 13 | JOBS queue and stop | Queue the small run `za_orb`, variant `repaired`, 2015-01-01 to 2015-02-01 with run id `t_week<N>_parity`; stop it from its row while it is QUEUED or RUNNING | The row appears, the stop asks to confirm, then the row reads STOPPED. If it finishes first, queue a second one and stop that | [ ] | | |
| 14 | F1 and F8 to F11 | Press each with the page focused | Each does what the key map says; F10 and F11 reach the page | [ ] | | |
| 15 | SAVE and LOAD of a workspace | Type `SAVE parity<N>`; close two panels; type `LOAD parity<N>`; then open the browser terminal and type `LOAD parity<N>` there | The layout comes back in the app and the same workspace loads in the browser. Then `FORGET parity<N>` in either door | [ ] | [ ] | |
| 16 | Amber-classic look | In the Options menu's Theme group choose the amber-classic look; open HOME and REG; set the standard look again | The colours change at once, text stays readable, and the look is the same in the browser (it is shared through the files) | [ ] | [ ] | |

The stop in row 13 leaves a small run folder under the lab's `backtests\output`, named by the run id. The terminal never deletes it; the folder is yours to tidy.

Count of green rows: ____ of 16.

## Red rows

A row that is not green is a defect, filed the same day (`README.md`, how to use a template, step 8):

| Row | What happened | Same in the browser (yes or no) | Blocking (see the kit) | Filed as |
| ---: | --- | --- | --- | --- |
| | | | | |

## Pass rule

PASS when all 16 rows are green and the research gate reading shows 0 other callers and 0 lines after the fence. Anything red fails the week, and a blocking defect resets the four-week count (04, phase D6). A row that is red in both doors is an ordinary terminal bug: file it, and the week still fails that row, but the app is not blamed.

## Evidence to keep

One screenshot of HOME and one of LIVE with the stream line, the PDF of row 12, and the console output of the gate log reading, in `D:\dev\d5\owner-evidence\<date>_weekly-parity-week-N\`.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Notes

Anything slow, odd or different from last week that did not turn a row red.
