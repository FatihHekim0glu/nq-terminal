# The four-week dual-run kit

Status: NOT STARTED. Written on 3 October 2026 for phase D6 (04) and 03 section 19. The run starts only when gate G2 on Windows has passed, with every owner-attended check in this folder filled in and ticked PASS.

## Purpose

Use the installed app every day for four weeks, beside the browser terminal, and find out whether the app is as correct and as dependable as the door you already trust. The kit gives you what to do each day, what to do each week, what to compare between the two doors, and when to stop.

The plan's own words (03 section 19): the run starts at the first app build that passes G2 on Windows and ends after four weeks of daily use with no blocking defect and every row of the parity list green. Then you decide (decision O8) whether the browser door stays as a fallback for good. The recommendation is to keep it: it costs nothing now that it sits behind the same session token.

## Rules of the run

- **Which build.** The installed `desktop-v0.1.0`, or a later D6 fix tag. Changes to the web source or the shell reach this install only through a new tag.
- **A fix tag for a blocking defect restarts the four-week count.** A fix tag for a non-blocking defect is installed only if you ask for it, and extends the run so that at least the last two weeks are on the final tag.
- **Defect rule.** A defect that exists in the app and not in the browser is fixed before any new app feature. A defect in both is an ordinary terminal bug.
- **Blocking defect** (04, QA gate): a red parity row, a wrong number, a breach of the research gate or of the write ban, or a crash. A blocking defect resets the count.
- **The calendar.** At least 28 days. More if a blocking defect restarts the count.
- **The ban never moves.** The app never places, changes or cancels an order and never connects to a live broker. If any screen ever offers such an action, that is a blocking defect on the day.

## How the two doors run together

- Whichever door starts first owns the backend. The other attaches through the lock file. There is never a second backend for the same lab.
- Start the browser door with `start.ps1`. It takes the lock and holds the backend, so closing its launcher window stops the backend; and it opens the browser on the running backend if the app already owns it.
- Workspaces, the look and the link groups live in files under the lab's `terminal\state`, so both doors see the same state.
- Closing the door that owns the backend stops the backend (after a confirmation if a backtest is running), and the other door then shows that its backend has stopped. Close the attached door first, or expect that. If it behaves differently, that is a finding.
- Fallback at any moment: `start.ps1` opens the browser terminal on whatever backend is running. You never lose the terminal.

## The daily checklist (two minutes)

Do it the first time you start the terminal each day, through whichever door you like.

1. [ ] HOME fills with data in a few seconds. No error line. No DEMO DATA flag.
2. [ ] Only one backend: no second console window, and the other door, if you open it, attaches instead of starting its own.
3. [ ] Whatever you did that day worked in the app as it does in the browser. If it did not, read the stop rules below before you carry on.
4. [ ] Write one line in the daily log at the bottom of this file: the date, the door, HOME ok or not, anything odd.

## The weekly checklist (about 15 minutes, once a week for four weeks)

Copy `2026-10-03_weekly-parity.md` to `YYYY-MM-DD_weekly-parity-week-N.md` and do all of it: the 16 parity rows and the gate log reading. In addition, once a week:

1. [ ] Read the app's shell log for failure-type events since last week. Read each one; some are normal (for example the rebuild offer after a web change), most are not.

   ```powershell
   $Cfg = Join-Path $env:APPDATA 'dev.nqlab.terminal'
   $bad = 'setup_failed', 'run_failed', 'supervise_gave_up', 'hung_page_gave_up', 'hung_page_offer', 'engine_gone', 'stopped_page',
          'lab_refused', 'lab_missing', 'stale_dist', 'bridge_script_failed', 'window_hooks_failed'
   $ev = Get-Content -LiteralPath "$Cfg\logs\shell.log" | ForEach-Object { $_ | ConvertFrom-Json }
   $ev | Where-Object { $_.event -in $bad -or $_.event -like '*_failed' } |
     ForEach-Object { '{0}  {1}  {2}' -f ([DateTimeOffset]::FromUnixTimeMilliseconds($_.t).ToLocalTime().ToString('s')), $_.event, ($_ | ConvertTo-Json -Compress) }
   ```

2. [ ] Free space on the drive the lab and the app sit on, and on C:. A drive that is nearly full stops caches and logs from being written.

   ```powershell
   Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{ n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } }
   ```

3. [ ] Check the installed tag is the one you expect: the version in Settings, Apps, against `{{W6: final release commit}}` and any fix tag.
4. [ ] Read the idle memory of the app at HOME once in week 1 and once in week 4, with the commands of `2026-10-03_visible-run.md`, step 4. G2's rule is at most 500 MB. A value that grows from week 1 to week 4 is a finding even if it is under the ceiling.

## What to compare between the browser terminal and the app

The two doors serve the same backend, so numbers must match exactly; most of the comparison is a look, not a calculation.

| What | How | Expect |
| --- | --- | --- |
| Numbers | Open the same screen in both: `EQ`, `REG`, `MT`, `GP` (last close), `CORR` (one cell), `LEDG` (the pivot totals) | The same digits. A difference in a served number is a wrong number, which is blocking |
| The look | Choose the amber-classic look in one door, reload the other | Both show it: the look is shared through the files |
| Workspaces | `SAVE x` in one door, `LOAD x` in the other | The same layout opens |
| Links | Copy a link (`#go=`) from one door and open it in the other | It opens the same screen with the same inputs |
| Saves and prints | Save the same export from each door; print the same dossier from each | Same content; the app uses its own save and print dialogs, so the dialogs differ and the files do not |
| Keys | F1, F8 to F11, Alt+1 to Alt+9, Alt+K, Ctrl+K in each | The same effect. Accepted differences: the app also has app zoom on Ctrl+plus, Ctrl+minus and Ctrl+0; the browser keys (reload, developer tools, find) do nothing in the app; F11 does not go full screen in the app |
| Start time | Your own sense of how fast HOME fills, from double-click or from the command | The app is not slower than the browser door. Note it if it is |
| The stream | LIVE in both | Both read "live, server events" |
| After minimise | Minimise the app with LIVE open for a while, then restore | The stream is back within 30 seconds |
| Memory | Task Manager, once in week 1 and once in week 4 | The app idle at HOME is not more than the browser terminal's HOME in the same session, and at most 500 MB |

## When to stop

**Stop at once** (close the app, carry on in the browser door, file the defect the same day; the four-week count restarts after the fix tag):

- a number in the app differs from the browser terminal on the same backend, or from a figure you know to be right;
- a gate log line from the terminal with a caller other than `terminal`, or an end date after 2022-01-01;
- a file written under the lab's `results`, `data` or `live` folders by the terminal (a download you started yourself is not that; a QuantPad download is not that);
- any screen that offers to place, change or cancel an order, or to connect to a broker;
- a request for a password, a key or a token that you did not expect;
- the app disappears, hangs for more than 15 seconds with no offer to reload, or leaves a backend running after it closes.

**A red parity row** is also a blocking defect (04, QA gate), but not an emergency: finish the week's list, file it, and carry on in the browser door for that row.

**Not blocking** (write it in the daily log and the week's notes, and carry on): wording, a one-off slow start, a layout detail, anything the browser terminal does the same way. A fix tag for these is installed only if you ask.

**The run ends** when four consecutive weeks have each been green on every row with no blocking defect, on the tag that is installed at the end, and at least 28 days have passed. Then decision O8.

**A suggestion of this kit, not a plan rule:** if the count has restarted three times, stop the run and review the cause with whoever builds the fix, before starting a fourth.

## Closing the run

1. [ ] Four weekly files exist (`YYYY-MM-DD_weekly-parity-week-N.md`, N from 1 to 4), each with all 16 rows green and a ticked PASS box, on consecutive weeks.
2. [ ] No open blocking defect.
3. [ ] The installed tag is the final tag, and weeks 3 and 4 were on it.
4. [ ] Decision O8 recorded in `docs/desktop/owner_decisions_windows.md`: keep the browser door (the default) or retire it.
5. [ ] Milestone M7, "the Windows dual run closed", noted in `docs/desktop/README.md`.

## The daily log

Copy the table into the week's file if you prefer, or keep it here.

| Day | Date | Door | HOME ok | Anything odd | Defect filed |
| ---: | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |
| 13 | | | | | |
| 14 | | | | | |
| 15 | | | | | |
| 16 | | | | | |
| 17 | | | | | |
| 18 | | | | | |
| 19 | | | | | |
| 20 | | | | | |
| 21 | | | | | |
| 22 | | | | | |
| 23 | | | | | |
| 24 | | | | | |
| 25 | | | | | |
| 26 | | | | | |
| 27 | | | | | |
| 28 | | | | | |
