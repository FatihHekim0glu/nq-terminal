# Check: measurements left pending or provisional

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

Two kinds of G2 figure were not taken cleanly on the build night, and both need a quiet window of your choosing:

- **Pending rows.** The `measure` build's real-lab rows were not taken on the build night, because the browser terminal's backend on 8765 was listening (a live lock or a queued or running job would also rule them out). The harness checks the lab itself before each such launch (a listener on 8765, a live lock, a queued or running job; `jobs.json` and `backtests\output` are read before and after) and, when one fails, writes a pending record that names the reason and starts nothing. The commands below list the same checks so that you can read them by hand and write the values down before and after the run. On the build night the process rows were taken on the `smoke` build instead.
- **Provisional rows.** A run whose 60-second CPU average stayed above 10% is kept and labelled PROVISIONAL with the load recorded. After five rejected readings in a row the harness takes the run anyway. Provisional figures are reported apart from accepted ones and are not accepted ones.

This file lists them, and records the repeat of each in a quiet window. The two lists come from the G2 results (`docs/desktop/g2_windows/results.md`).

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Release commit | {{W6: final release commit}} |
| Pending rows to repeat | backend ready, splash, cold HOME and idle memory on the measure artefact (3 runs each) and the smoke against measure agreement test; skipped because port 8765 was listening (decision 11). The measure build is installed and checked at D:/dev/d5/measure/app; jobs.json sha256 before the repeat was 44CAE38ADB6F6E142C013AC988929B5E12F20363CB82C990A40E77C34B2172D4 and backtests/output was unchanged |
| Provisional rows to repeat | none by the CPU gate (every counted run at 9.8% or lower, 3.4 to 9.8% across the series). Labelled all the same: no owner-named quiet window; every harness figure UNREPRODUCED (HOME ready +13.8% against W0B); the soak is partial |

## Preconditions

- A quiet window: no build, no test run, no download, no scan, no game, for the length of the run. The harness reads the machine's CPU for 60 seconds before each run and refuses to count a run over 10%.
- For the measure-artefact real-lab rows, the lab must be free. The harness refuses to launch otherwise, and you can read the same facts yourself. Check these, and stop if any fails:

  ```powershell
  $Lab = Join-Path $env:USERPROFILE 'nq-lab'
  Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
  $jobs = Get-Content -Raw -LiteralPath "$Lab\terminal\state\jobs.json" | ConvertFrom-Json
  @($jobs.jobs | Where-Object { $_.state -in 'queued', 'running' }).Count
  (Get-FileHash -Algorithm SHA256 -LiteralPath "$Lab\terminal\state\jobs.json").Hash
  Get-ChildItem -LiteralPath "$Lab\backtests\output" | Select-Object -ExpandProperty Name | Measure-Object | Select-Object -ExpandProperty Count
  ```

  Expected: nothing listening on 8765; a job count of 0; then the hash of `jobs.json` and the number of entries in `backtests\output`, which you write below so you can compare after the run.

  A live lock is a further condition. Rather than read it, stop the browser terminal's backend the usual way (close the launcher window that holds it) before the run, and start it again afterwards.

| Before the run | Value |
| --- | --- |
| `jobs.json` SHA-256 | |
| Entries in `backtests\output` | |

## Steps

1. [ ] Close the browser terminal and anything else you can close. Check the preconditions above.
2. [ ] Repeat the pending rows on the `measure` build, on real data. The harness refuses to run these from anywhere but the lab's own `terminal` folder.

   ```powershell
   Set-Location (Join-Path $env:USERPROFILE 'nq-lab\terminal')
   node desktop\harness\run.mjs --build measure --rows backend_ready,splash_painted,cold_home,idle_mem_home --runs 3 --real-data
   ```

3. [ ] Repeat the provisional rows on the build and rows they name in the table above, with the same command and the `--build` and `--rows` values to match. Row names are those of `desktop\harness\README.md` (`backend_ready`, `splash_painted`, `cold_home`, `warm_home`, `eq_warm`, `reg_warm`, `grid_open`, `gip_pan_zoom_p95`, `keystroke_p95`, `idle_mem_home`).
4. [ ] Read each result back from its raw record. The table gives the row, build, accepted runs, median and its ACCEPTED or PROVISIONAL label. Do not add `--check`: it covers a whole G2 evidence folder (both builds, every row) and fails on a folder that holds only the repeated rows.

   ```powershell
   node desktop\harness\report.mjs <the output folder of step 2 or 3>
   ```

5. [ ] After the measure run, check the lab was left as it was found:

   ```powershell
   (Get-FileHash -Algorithm SHA256 -LiteralPath "$Lab\terminal\state\jobs.json").Hash
   Get-ChildItem -LiteralPath "$Lab\backtests\output" | Measure-Object | Select-Object -ExpandProperty Count
   ```

   Expected: the same hash and the same count as before. The report also lists any new file under `terminal\state` (a lock and a cache are the app's ordinary files).
6. [ ] Open the shell log of the measure run (under its output folder, `config\logs\shell.log`) and confirm the backend was started by the app, not attached: there is a `supervise_spawned` event and no `supervise_attached` event.
7. [ ] Start the browser terminal again.

## Readings

One line per row repeated.

| Row | Build | Ceiling | Target | Median of 3 | CPU load per run | Label (ACCEPTED or PROVISIONAL) | Within noise of the other build |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| | | | | | | | |

## Pass rule

PASS when every row that was pending or provisional now has three ACCEPTED runs at or under its ceiling, the measure and smoke medians of backend ready, cold start to HOME and idle memory agree within noise (10% of each other, or overlapping ranges), step 5 matches, and step 6 shows a spawn. A repeat that is again PROVISIONAL is recorded and the check stays open until a quiet window gives accepted runs. An accepted run over its ceiling is a FAIL for that row and a defect.

## Evidence to keep

The harness's output folders under `D:\dev\d5\runs\` are the raw record. Copy their names into the table below, with the console output of steps 2 to 5 saved in `D:\dev\d5\owner-evidence\<date>_pending-measurements\`.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

The CPU load you saw, and what was running.
