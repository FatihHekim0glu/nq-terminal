# Check: the real JOBS backtest

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

JOBS is the one place where the terminal starts a process that does research work: a backtest, run by the lab's own interpreter as a child of the backend. Since D2 that child gets an allow-listed environment instead of the whole environment (03 section 8; risk X09). If the list is too narrow, a real backtest fails for want of a variable, and no automated test can tell, because the tests run on fixtures with the runner off. This check queues one small real backtest through the installed app and confirms it finishes with exit code 0.

Everything else the check looks at is a boundary: the run writes its own folder under `backtests\output` and its lines in the research gate log, and nothing else; the gate log shows nothing beyond the in-sample fence (the last date served is 2021-12-31); `terminal\state\jobs.json` is the queue's one deliberate write.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer SHA-256 | {{W6: installer SHA256}} |
| Release commit | {{W6: final release commit}} |
| Door used (the app, or the browser terminal) | the app |
| Strategy, data variant and window chosen | |
| Run id | |

## Preconditions

- The app is installed and open on the real lab, not a fixture or demo. The JOBS screen must not say "The backtest runner is off in this mode".
- You have the lab's research quiet: no research run of your own is writing to `backtests\output` or `results` while this check runs, or you can tell its writes from the check's.
- The PC has the time: a small backtest takes minutes, not seconds.

Set the shorthand and take the "before" readings. Keep the console open so that you can compare.

```powershell
$Lab = Join-Path $env:USERPROFILE 'nq-lab'
$T0 = Get-Date
$BeforeFolders = Get-ChildItem -LiteralPath "$Lab\backtests\output" | Select-Object -ExpandProperty Name
$BeforeJobs = (Get-FileHash -Algorithm SHA256 -LiteralPath "$Lab\terminal\state\jobs.json").Hash
$BeforeLog = (Get-Content -LiteralPath "$Lab\results\oos_access_log.jsonl" | Measure-Object -Line).Lines
'{0} entries in output, jobs.json {1}, gate log {2} lines' -f @($BeforeFolders).Count, $BeforeJobs, $BeforeLog
```

Write the three figures in the table below.

## Steps

1. [ ] Open JOBS. Read the counts line ("Running 0, queued 0, capacity ...") and the basis line. Both must show nothing running or queued before you start.
2. [ ] In the "Queue a backtest" form choose a small run, inside 2010-01-01 to 2021-12-31 (the form says the end is exclusive: use an end date no later than 2022-01-01). A run known to be small: the release check of the earlier build queued strategy `za_orb`, data variant `repaired`, from 2015-01-01 to 2015-02-01, with the parameters `or_minutes` 5 and `target_r` 10, and it finished in about 3 seconds with exit code 0. Use that, or another small run of your own; write what you chose in the table above.
3. [ ] Give it a run id of your own: it must start with `t_` (for example `t_handover_check_1`). Write it in the table above.
4. [ ] Press Queue run. The line "Queued ..." appears and the row shows QUEUED, then RUNNING.
5. [ ] Wait for the row to finish. Write down the status and the Exit column. Expected: status OK, Exit 0.
6. [ ] Use View log on the row. Read the log from the top. Expected: no line about a missing variable, a missing key or a path that cannot be found.
7. [ ] Take the "after" readings.

   ```powershell
   $AfterFolders = Get-ChildItem -LiteralPath "$Lab\backtests\output" | Select-Object -ExpandProperty Name
   'new in output:'
   Compare-Object $BeforeFolders $AfterFolders | Where-Object SideIndicator -eq '=>' | ForEach-Object InputObject
   'jobs.json changed: ' + ((Get-FileHash -Algorithm SHA256 -LiteralPath "$Lab\terminal\state\jobs.json").Hash -ne $BeforeJobs)
   $log = Get-Content -LiteralPath "$Lab\results\oos_access_log.jsonl"
   $new = @($log | Select-Object -Skip $BeforeLog | ForEach-Object { $_ | ConvertFrom-Json })
   'new gate log lines: {0}; latest end date served: {1}' -f $new.Count, (($new | Sort-Object end | Select-Object -Last 1).end)
   $new | Group-Object caller | Select-Object Name, Count
   'files under results and live newer than the start (other than the gate log):'
   Get-ChildItem -LiteralPath "$Lab\results", "$Lab\live" -Recurse -File -ErrorAction SilentlyContinue |
     Where-Object { $_.LastWriteTime -gt $T0 -and $_.Name -ne 'oos_access_log.jsonl' } | Select-Object -ExpandProperty FullName
   ```

   Expected: the new entries in output are the run's folder and its log file, named after the run id, and nothing else; `jobs.json changed: True` (the one deliberate write); the new gate log lines are the run's own, plus lines of caller `terminal` for any screen you opened meanwhile, and the latest end date is no later than `2022-01-01 00:00:00+00:00` (the window's end is exclusive); no file listed under results or live.
8. [ ] In RUN, open the finished run from its row ("Open in RUN"). It opens and shows its figures.
9. [ ] Close the app. Nothing is left running (as in the visible run, no process of the app's tree remains).
10. [ ] Optional, not part of the pass rule: queue a second run and close the window while it is running. Expected: a confirmation first ("stop it?"), and after you confirm the job reads STOPPED (decision O11). This leaves a partial run folder under `backtests\output`; skip it if you want the folder list to stay clean.

## Readings

| Reading | Rule | Value | Pass |
| --- | --- | --- | --- |
| Status of the row | OK | | [ ] |
| Exit column | 0 | | [ ] |
| Missing-variable or path error in the log | none | | [ ] |
| New entries in `backtests\output` | the run's folder and log only | | [ ] |
| Files under `results` and `live` newer than the start, other than the gate log | none | | [ ] |
| Latest end date in the new gate log lines | at most 2022-01-01 | | [ ] |
| `jobs.json` changed | yes (the queue's own write) | | [ ] |

## Pass rule

PASS when status is OK with Exit 0, every row of the readings table is ticked, and steps 1 to 9 are ticked. A job that ends ERROR or FAILED CHECKS, or whose log names a missing variable, is a FAIL and a defect: the environment allow list (`backend\nq_terminal\desktop\envlist.py`) is the first place to look, then the run's own log. Do not widen the list by hand to make a run pass; file it, and the list is changed with a test.

A gate log line beyond the fence, or a file written under `results` or `live` by the run, is a breach of the research gate: stop, do not queue another run, and file it as a blocking defect.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_real-jobs-backtest\`: a screenshot of the finished JOBS row, the run's log (View log, copied), and the console output of the "before" and "after" blocks.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Which strategy you chose and how long the run took.
