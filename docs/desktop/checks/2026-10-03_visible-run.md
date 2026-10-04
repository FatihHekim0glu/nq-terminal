# Check: visible run of the installed release

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Every automated run of the app is hidden, so none of them can show what a real minimise does to the live stream, or what the first double-click looks like. This check does both on the real installed release. It is the owner-attended row of G2 that 04 (phase D5) describes: install, start by double-click, leave at HOME for 2 minutes, then minimise for 30 minutes with LIVE open and restore.

Pass rules, from the 04 exit list:

- cold start to HOME ready, read from the shell log, within 5,000 ms and within noise of the measure artefact's median;
- idle whole-tree private memory within 500 MB;
- the stream back in stream mode within 30 seconds of the restore.

It also checks the first minute of use by eye: the window appears once, nothing flashes, nothing asks a question you did not expect.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Installer | `nq-lab terminal_0.1.0_x64-setup.exe`, 3,253,432 bytes |
| Installer SHA-256 | 2f4b5c4cdf37a5a520be4517d7efd725288ac9ae28b047e85b302e9f52c4b590 |
| Release commit | 8122c877bb00e4f07ce505d5ba0468d6a9858f41 |
| Installed into | |
| Measure artefact median, cold HOME | pending (the measure artefact was not run against the real lab: port 8765 was listening); for reference the GNU smoke build read 3,167 ms on a first launch and 2,750 ms on the usual launch in the W5C re-measure (W5B: 5,048 ms and 3,321 ms) |
| Whether the lab's `terminal\state` folder already held a cache | yes / no |

## Preconditions

- The release is installed by the runbook (`docs/desktop/handover_windows.md`), with the checksum verified.
- Neither door is running. If the browser terminal's backend is up, the app attaches to it and the start time is not a cold start. Check: `Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue` prints nothing.
- The PC is otherwise quiet: no build, no scan, no game. Note anything running in the findings.
- You can leave the PC alone for 45 minutes.

## Steps

1. [ ] Note the clock time. Start the app by double-click from the Start menu entry.
2. [ ] Watch the first seconds and tick what you saw: [ ] a window appeared once, [ ] no blank white flash before the splash, [ ] HOME filled with data, [ ] no error line, [ ] no dialog you did not expect, [ ] no black console window.
3. [ ] Leave HOME untouched for 2 minutes.
4. [ ] Read the whole-tree memory. The first command finds the shell, the second sums the private working set of the shell and every process below it (the page engine, the backend, the backend's helpers), as the harness does.

   ```powershell
   $Terminal = Join-Path $env:USERPROFILE 'nq-lab\terminal'
   $shell = (Get-Process -Name 'nq-lab-terminal' | Sort-Object StartTime | Select-Object -First 1).Id
   $mem = powershell -NoProfile -ExecutionPolicy Bypass -File "$Terminal\desktop\harness\lib\mem.ps1" -RootPid $shell | ConvertFrom-Json
   'processes: {0}   private working set: {1:N0} MB' -f $mem.n, ($mem.wsPrivate / 1MB)
   ```

   Write the figure in the table below. Keep the process ids for step 10:

   ```powershell
   $tree = powershell -NoProfile -ExecutionPolicy Bypass -File "$Terminal\desktop\harness\lib\mem.ps1" -RootPid $shell -WalkOnly | ConvertFrom-Json
   $tree
   ```

5. [ ] Read the start-up time from the shell log. The log holds one JSON object per line with `t` in milliseconds; the last `start` event is this launch. Cold start to HOME is `home_painted` minus `start`; `supervise_checked` is backend ready. The log is written from the shell's setup, so add the time between your double-click and the first window (a second or less) to the figure when you compare with the 5,000 ms ceiling, and say which you used.

   ```powershell
   $Cfg = Join-Path $env:APPDATA 'dev.nqlab.terminal'
   Test-Path "$Cfg\logs\shell.log"
   $ev = Get-Content -LiteralPath "$Cfg\logs\shell.log" | ForEach-Object { $_ | ConvertFrom-Json }
   $start = $ev | Where-Object event -eq 'start' | Select-Object -Last 1
   $ev | Where-Object { $_.t -ge $start.t -and $_.event -in 'start', 'page_finished', 'supervise_spawned', 'supervise_checked', 'home_painted' } |
     ForEach-Object { '{0,-20} {1,6} ms' -f $_.event, ($_.t - $start.t) }
   ```

   Expected: a `supervise_spawned` line (the app started its own backend). A `supervise_attached` event instead means the app attached to a backend that was already up: repeat from the preconditions.
6. [ ] Open LIVE next to HOME. Read the stream line: it must say "live, server events". Write down what it says.
7. [ ] Minimise the window with its own minimise button. Note the time. Leave the PC alone for 30 minutes (the owner's choice up to 60). Do not move the mouse over the taskbar thumbnail.
8. [ ] Restore the window from the taskbar. Start counting. Write down how many seconds until the stream line reads "live, server events" again. It may say it is reconnecting for a moment; it must not stay there or fall back to polling.
9. [ ] Read the memory again as in step 4 (the same commands, the shell may have a new id if it was restarted: if it was, that is a finding).
10. [ ] Close the window with its close button. Expected: it closes at once, or after a short wait for the page to send unsaved workspace changes (a few seconds at most). Then confirm nothing of the app's tree is left:

    ```powershell
    Get-Process -Id $tree -ErrorAction SilentlyContinue
    ```

    Expected: nothing printed.

## Readings

| Reading | Rule | Value | Pass |
| --- | --- | ---: | --- |
| Cold start to HOME ready, from the log | at most 5,000 ms and within noise of pending (the measure artefact was not run against the real lab: port 8765 was listening); for reference the GNU smoke build read 3,167 ms on a first launch and 2,750 ms on the usual launch in the W5C re-measure (W5B: 5,048 ms and 3,321 ms) | | [ ] |
| Backend ready, from the log | at most 2,500 ms | | [ ] |
| Idle whole-tree private memory, step 4 | at most 500 MB | | [ ] |
| Stream line text before the minimise | "live, server events" | | [ ] |
| Seconds from restore to "live, server events" | at most 30 | | [ ] |
| Memory after the restore, step 9 (for the record) | no rule, compare with step 4 | | |

If the lab's state folder was empty before the launch (the table at the top), the cap for the start time is the 6,000 ms of decision 1.1 of the register, with 4,500 ms as the target; otherwise the 5,000 ms ceiling applies.

## Pass rule

PASS when every row of the readings table is ticked, steps 1 to 10 are ticked, and no step 2 box was left unticked without a note. A stream that stays on "reconnecting" or "polling" after 30 seconds is a FAIL and a blocking defect; so is a second backend left running after step 10.

## Evidence to keep

Save in `D:\dev\d5\owner-evidence\<date>_visible-run\`: the text output of steps 4, 5 and 9, a copy of the lines of `shell.log` from the last `start` event to the end of the run, and two screenshots (HOME at step 3, LIVE at step 8). The log copy must not hold a token; the shell log does not, but read it before you save it.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Anything running in the background, anything that looked wrong on screen, what the machine was doing.
