# Check: first launch after a reboot

Result: [ ] PASS   [ ] FAIL   Status: NOT RUN

## Purpose

G2 asks for cold double-click to HOME with data to stay within 5,000 ms, "including the first launch after a reboot" (04, D5 exit table; 02 section 6.3). Straight after a boot the disk cache is empty and start-up work competes for the machine, so this is the slowest launch the app will ever see on a normal day. The harness takes the reading with one command, with the window hidden, so nothing appears on your screen.

Decision 1.1 of the register (`docs/desktop/owner_decisions_windows.md`, "T3: cold HOME, the strict reading") applies here: the cold-HOME cap holds for every launch, so a launch after a reboot is not excused. The cap is 6,000 ms and the target 4,500 ms for the very first launch after an install with an empty state folder; the G2 ceiling of 5,000 ms is for a launch with data.

## Build under test

| Field | Entry |
| --- | --- |
| Run date | |
| Build read | the `measure` build (the default of the command) |
| Release commit | {{W6: final release commit}} |
| Machine up time at the run (the harness prints it) | |
| Measure artefact median for cold HOME, for the "within noise" comparison | pending (the measure artefact was not run against the real lab: port 8765 was listening); for reference the GNU smoke build read 5,048 ms on a first launch and 3,321 ms on the usual launch |

## Preconditions

- You have just restarted Windows and signed in. Do this check before you open anything else: no browser terminal, no app, no game launcher, no builds.
- Nothing is listening on 8765. If the browser terminal's backend came up at sign-in, the command would attach to it and the reading would not be a cold start. Check, and stop here if anything is printed:

  ```powershell
  Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
  ```

- The `measure` build keeps its state in the lab's own `terminal\state` folder, as the installed app does, so this run leaves the app's ordinary lock and cache files there (the harness lists any new file it finds and records it).
- The build is installed or built where the harness finds it (the newest `measure` build under `D:\dev\targets`, or name one with `--exe`). The harness refuses to run from anywhere but the lab's own `terminal` folder.

## Steps

1. [ ] Open PowerShell and run the one command. It waits up to ten minutes for the machine to settle (the boot is busy), then takes the launch anyway and labels it PROVISIONAL with the load recorded. Do not touch the PC while it runs.

   ```powershell
   Set-Location (Join-Path $env:USERPROFILE 'nq-lab\terminal')
   node desktop\harness\run.mjs --first-launch --build measure
   ```

2. [ ] Write down the folder it prints on its first line (`output D:\dev\d5\runs\...`), and the JSON line at the end: `status`, `uptimeSeconds`, `firstAfterBoot`, `quiet`, `windows`.
3. [ ] Read the figures back from the raw record. The report recomputes every number from the files, so this is the figure of record. Do not add `--check` here: that check covers a whole G2 evidence folder (both builds, every row) and always fails on a one-launch folder.

   ```powershell
   node desktop\harness\report.mjs <the output folder from step 2>
   ```

4. [ ] Copy the four process rows into the table below.

   | Row | Ceiling | Target | Reading |
   | --- | ---: | ---: | ---: |
   | Backend ready | 2,500 ms | 1,500 ms | |
   | Shell painted (splash) | 1,000 ms | 500 ms | |
   | Cold start to HOME | 5,000 ms | 3,500 ms | |
   | Whole app idle at HOME | 500 MB | 400 MB | |

5. [ ] Start the browser terminal as you normally do (`start.ps1`). The harness stopped only its own processes, so nothing of yours was touched.

## Pass rule

PASS when all of these hold:

- `firstAfterBoot` is true (the machine had been up 30 minutes or less). If it says false, the reading is a normal cold launch, not a post-boot one: file it as such and repeat after the next reboot.
- `windows` is 0: no window of the app's own process tree appeared at any point. The harness hides the window and watches every window on the machine, but it counts only the ones that belong to the app it launched. A window of another program, such as one that starts at sign-in, does not fail the run: it is listed under `watch.notes` in the run's JSON record in the output folder, and you write it in the findings below. A window that the watch could not trace to an owner does fail the run.
- Every row in the table is at or under its ceiling.
- Cold start to HOME is within noise of the measure artefact's median pending (the measure artefact was not run against the real lab: port 8765 was listening); for reference the GNU smoke build read 5,048 ms on a first launch and 3,321 ms on the usual launch. Noise is 10% of the median, or inside the min to max range of the three accepted measure runs.

A reading the harness labels PROVISIONAL (it could not get a quiet CPU reading in ten minutes) does not fail the check, but it is not accepted either: list it in `2026-10-03_pending-measurements.md` and repeat it in a quiet window.

If a row is over its ceiling, the check is a FAIL and is a defect: the shell log of that run (under the output folder's `config\logs`) says where the time went (`start`, `supervise_checked`, `home_painted`).

## Evidence to keep

The whole output folder under `D:\dev\d5\runs\` stays where it is (it is the raw record). Copy its name into the table, and save the console output of steps 1 to 3 in `D:\dev\d5\owner-evidence\<date>_reboot-first-launch\`.

| File | SHA-256 | What it shows |
| --- | --- | --- |
| | | |

## Findings and notes

Anything slow that you saw on screen before the run, other programs that started at sign-in, and the CPU load the harness recorded.
