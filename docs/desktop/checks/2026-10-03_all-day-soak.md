# Check: the all-day soak

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

G2 asks for the whole app to stay at or under 1.5 GB (target 1.0 GB) over an all-day soak at the shipped caps: 512 MiB for the bar cache and 128 MiB for the file cache in desktop mode (04, phase D5 exit table; owner decision O5). The soak of the build night is partial by design: it was a 3-hour real-data run, shorter than the 8-hour minimum of an all-day soak, so it is labelled PARTIAL ({{G2: overnight soak length}}) and this check is needed. Its result: {{W6: soak result}}. The build-night run showed a start-up peak of about 1.5 GB in its first samples, which then settled to about 0.6 GB (reported by the build's lead while the run was still going; the figures of record are in the G2 results). So read the whole memory curve, not only the largest sample: a peak at the start that falls away is the app loading its caches, while a curve that keeps rising late in the day is the finding this check exists to catch. The pass rule below still reads the largest sample.

The run opens the heavy screens in rounds (GP, GIP, `volmanaged_v0 EQ`, REG, MON, CORR, LEDG, OOS, LIVE, RUNS and MT) so that the caches fill the way a day of use fills them, and samples the whole tree's private working set every 5 minutes. The row is the largest sample. The window is hidden; nothing appears on screen. The harness runs the `smoke` build, because only it can be driven over the debugging protocol.

## Build under test

| Field | Entry |
| --- | --- |
| Run date and start time | |
| Length planned (hours) | |
| Release commit | {{W6: final release commit}} |
| Overnight soak of the build night | {{G2: overnight soak length}} and largest sample {{G2: overnight soak largest sample}} |

## Preconditions

- You can leave the PC alone for the planned length: no game, no build, no scan, no browser terminal under load. Sleep and hibernate off for the length of the run (the app would otherwise be suspended and the figure meaningless).
- Nothing else is running a Playwright or test suite.
- The run starts from the lab's own `terminal` folder; the harness refuses to measure from anywhere else.
- Length: choose the longest day you can give it, at least 8 hours (the harness default). A run shorter than 8 hours is PARTIAL and the file must say so.

## Steps

1. [ ] Delete any stop file left by an earlier run, because the harness ends the run at its first sample while that file exists and never deletes it. Then note the start time and start the soak. It prints its output folder on the first line; write it down. (`--real-data` reads the real lab; the smoke build keeps its state in a folder inside the run's output folder, not in `terminal\state`.)

   ```powershell
   Remove-Item -LiteralPath 'D:\dev\d5\soak.stop' -ErrorAction SilentlyContinue
   Set-Location (Join-Path $env:USERPROFILE 'nq-lab\terminal')
   node desktop\harness\run.mjs --mode soak --hours 8 --real-data
   ```

   Change `8` to the hours you planned.
2. [ ] Leave the PC alone. If you must stop early, create the stop file; the run then ends at its next sample and counts as PARTIAL (the label is yours to write, see the table in step 4). Delete the stop file once the command has returned, or the next run ends after its first round and first sample:

   ```powershell
   New-Item -ItemType File -Path 'D:\dev\d5\soak.stop'
   Remove-Item -LiteralPath 'D:\dev\d5\soak.stop'
   ```

   Run the second line only after the soak command has returned.

3. [ ] When the command returns, copy its last console line. It is one JSON line with a `soak` object (`n`, `maxMB`, `lastMB`, `slopeMBPerHour`) and a `partial` flag (`true` only when the stop file ended the run). Then read the figures back from the raw record, the `.json` file in the output folder.

   ```powershell
   node desktop\harness\report.mjs <the output folder from step 1>
   ```

4. [ ] Copy the soak summary into the table below. The last column says where each value comes from.

   | Reading | Rule | Value | Source |
   | --- | --- | ---: | --- |
   | Length run (hours) | planned length | | your start and end times |
   | Samples taken | one every 5 minutes | | console line, `soak.n` |
   | Largest whole-tree private working set | at most 1,500 MB, target 1,000 MB | | console line, `soak.maxMB` |
   | Last sample | for the record | | console line, `soak.lastMB` |
   | Slope (MB per hour) | for the record: still growing is a finding | | console line, `soak.slopeMBPerHour` |
   | Stopped early | no | | console line, `partial` |
   | Errors listed by the run | none | | record file, `workloadErrors` (an empty list means none) |
   | Label | ALL-DAY if the planned length ran, otherwise PARTIAL | | the owner's own wording, see below |

   The harness does not print an ALL-DAY or PARTIAL label. Both are the owner's own wording, taken from the run length: write ALL-DAY when the run reached its planned length and that length was at least 8 hours, otherwise write PARTIAL. A `partial` of `true` always means PARTIAL.

5. [ ] Confirm nothing is left running by the harness. It stops only its own processes by identity; check that no `nq-lab-terminal` process remains that you did not start:

   ```powershell
   Get-Process -Name 'nq-lab-terminal' -ErrorAction SilentlyContinue
   ```

## Pass rule

PASS when the largest sample is at or under 1,500 MB, the run completed its planned length (label ALL-DAY) and the run lists no error. A run labelled PARTIAL cannot pass this check; it is recorded as PARTIAL and the check is repeated. A slope that is still rising at the end is not a failure by itself, but it is written up as a finding: it says the caps do not bound the whole app, which feeds the open decision on one shared memory budget.

## Evidence to keep

The whole output folder under `D:\dev\d5\runs\` stays where it is. Save the console output of steps 1 to 3 in `D:\dev\d5\owner-evidence\<date>_all-day-soak\`.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

What else the PC was doing, whether it slept, and the shape of the memory curve (flat, stepped, rising).
