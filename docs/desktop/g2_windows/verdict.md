# G2 on Windows: automated verdict (the release 0.3.1 re-measure of 7 October 2026, before its tag; the release 0.3.0 re-measure, taken under load; release 0.2.1, the latest stated verdict, and releases 0.2.0, 0.1.2 and 0.1.1 below)

The 0.3.1 re-measure comes first. Every row in it is inside its ceiling at CPU gates under 10%, but the W0B reproduction did not reproduce, so it states no G2 verdict for 0.3.1 yet (its reading says what would). The 0.3.0 re-measure follows. It was taken under load and states no G2 verdict for 0.3.0 (its reading says why). Release 0.3.0 has been published since 7 October 2026 (tag `desktop-v0.3.0`); because its re-measure states no G2 verdict, the 0.2.1 verdict that follows it stays the latest stated G2 verdict, and the 0.2.0 verdict after that is the verdict of the release before it. The 0.1.2 and 0.1.1 verdicts follow unchanged, with the 0.1.0 and W5B verdicts as history.

## Release 0.3.1: the re-measure of 7 October 2026, before the tag

Evidence: `results.md` in this folder (sections F1 to F6), built from raw records under `D:/dev/v031/measure-runs`. Tree: the 0.3.1 commit `710eb81`, clean (the `git diff HEAD` and untracked hashes are the empty sha256 in every record, and HEAD did not move during the run); `web/dist` rebuilt from that tree first, and fresh GNU builds of it in the default folder `D:/dev/release/0.3.1`, which passed the artefact check with its build-machine path scan; the GNU smoke build against the real lab for every app row. No quiet slot was set (the owner's full-speed order), but no build, test or Playwright workflow ran during the measuring; the owner's installed 0.2.1 app and the paper-trading TWS session were open throughout. Every counted launch passed the 60 second CPU gate at its 10% limit (6.8 to 9.6%; 0 rejected, nothing PROVISIONAL), with the GPU at 11 to 47%. The harness code changed in 0.3.1, and the W0B reproduction reproduced both memory figures but not launch to HOME ready (927 ms against a band that ends at 918 ms, the whole miss before the spike's page starts), so the harness labels the rows UNREPRODUCED. All app rows ran at the shipped desktop caps of 512 and 128 MiB. Until the 0.3.1 tag exists, 0.3.0 is the published release and the 0.2.1 verdict stays the latest stated G2 verdict.

### The 0.3.1 reading

**NOT STATED: EVERY ROW INSIDE ITS CEILING, THE W0B REPRODUCTION NOT REPRODUCED.** Every automated row re-measured on 0.3.1 is inside its ceiling at the median and in every single launch, at CPU gates under 10%, so on its own readings 0.3.1 meets both conditions behind the earlier stated verdicts. The release row, whole-app idle memory at HOME, reads 210.4 MB (204.2 to 213.3 MB over seven counted launches; `report.mjs` within-target ACCEPTED), against 209.3 MB on 0.3.0 and 196.1 MB on 0.2.1, at the same reading point (73 s after HOME ready, once the backend's working set has dropped). Cold HOME on a first launch reads 3,989 ms (3,940 to 4,045 ms; within-ceiling ACCEPTED): back inside the 5,000 ms ceiling that 0.3.0 missed under load at 6,116 ms, and inside the 4,500 ms first-launch target, though over the 3,500 ms target and about 685 ms above the 3,304 ms of 0.2.1. The usual launch reads 3,745 ms, inside its ceiling and over its target. Warm HOME 745.3 ms, EQ 40.8 ms and REG 89.6 ms are inside their 1,000 ms targets, and the reliability run checked 40 of 40 hidden launches with no refusal, the first proof 3.1 ms after READY at the median and 4.7 ms at most. The prewarm's HOME stage, which HOME's data waits on, took 2.28 s against 4.30 s on 0.3.0, with the run list at 0.34 s of it (`results.md` F3). What keeps the verdict from being stated is the anchor. Every stated verdict before (0.1.2, 0.2.0 and 0.2.1) rested on a W0B reproduction that reproduced; both reproductions of this run read launch to HOME ready at 927 and 935 ms against a band that ends at 918 ms (both memory figures reproduced), the whole miss before the page of a spike shell that runs no 0.3.1 code, so the harness labels the rows UNREPRODUCED. To state G2 for 0.3.1, either a reproduction must reproduce and the rows be taken behind it (for example in a slot with the owner's trading platform and installed app closed, which this run left open), or the owner or the manager must decide to re-anchor the W0B reference to today's machine; on the rows of this run, either would read AUTOMATED PASS, OWNER ROWS PENDING. No soak was run: the partial soaks of 0.2.0 and 0.1.2 stand and the 2 h soak of 0.1.0 stays the G2 soak evidence. M4 stays provisional, for the reasons given under the 0.1.1 verdict below.

### The 0.3.1 rows

"App harness" is the harness `rows` mode and its first-launch mode on the GNU smoke build of `D:/dev/release/0.3.1`, real lab, app-launched, trim on. n is the number of counted launches behind the figure. Every counted gate read under 10%; the rows carry the harness's UNREPRODUCED label (above).

| Row | 0.3.1 reading | 0.3.0 reading (PROVISIONAL) | 0.2.1 reading | Target | Ceiling | Source | n |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Whole app idle at HOME, private working set | **210.4 MB** (204.2 to 213.3), read 73 s after HOME ready | 209.3 MB | 196.1 MB | 400 MB (met) | 500 MB | App harness, rows and first-launch series | 6 plus 1 launches |
| The same tree's private bytes (informational, not a row) | 728.9 MB (723.8 to 751.9) | 808.1 MB | 692.8 MB | n/a | n/a | The same samples | 7 launches |
| Cold HOME, first launch (empty state folder) | **3,989 ms** (3,940 to 4,045) | 6,116 ms (over the ceiling) | 3,304 ms | 3,500 ms (missed; first-launch target 4,500 ms met) | 5,000 ms | App harness, rows and first-launch series | 6 plus 1 launches |
| Cold HOME, usual launch (state filled) | 3,745 ms (3,725 to 3,771) | 3,750 ms | 2,845 ms | 3,500 ms (missed) | 5,000 ms | Tool `t4t5.mjs usual-app`, after one priming launch | 3 launches |
| Warm HOME | 745.3 ms (734.0 to 750.5) | 735.1 ms | 550.7 ms | 1,000 ms (met) | 1,500 ms | App harness | 6 launches |
| `volmanaged_v0 EQ`, second run of the line | 40.8 ms (38.5 to 41.9) | 40.6 ms | 41.3 ms | 1,000 ms (met) | 1,500 ms | App harness | 6 launches |
| `REG`, second run of the line | 89.6 ms (77.7 to 99.9) | 86.8 ms | 56.7 ms | 1,000 ms (met) | 1,500 ms | App harness | 6 launches |
| Backend ready | 1,495 ms (1,457 to 1,500) | 1,596 ms | 1,407.5 ms | 1,500 ms (met) | 2,500 ms | App harness | 7 launches |
| Splash | 327.5 ms (311.3 to 330.0) | 358.4 ms | 311.3 ms | 500 ms (met) | 1,000 ms | App harness | 7 launches |
| Grid open, 8,411 fills | 82.1 ms (80.1 to 161.9) | 140.0 ms | 64.8 ms | 100 ms (met) | 500 ms | App harness | 6 launches |
| GIP pan and zoom p95, 20,000 bars | 6.4 ms (6.1 to 7.0) | 6.4 ms | 5.9 ms | 16.7 ms (met) | 25 ms | App harness | 6 launches |
| Keystroke to paint, p95 | 8.1 ms (8.1 to 8.3) | 8.3 ms | 8.2 ms | 50 ms (met) | 100 ms | App harness | 6 launches |
| Launch reliability, READY to the first identity proof (informational) | 3.1 ms median, 4.6 ms p95, 4.7 ms largest; 40 checked, 0 refused, 0 late-proof retries | 3.2 ms median, 4.7 ms p95, 4.8 ms largest; 40 checked, 0 refused | 3.1 ms median, 3.2 ms p95, 4.7 ms largest; 120 checked, 0 refused | n/a | 2,000 ms for the first try, then three more tries of 5 s | Harness `reliability` mode, real backend (`results.md` F5) | 40 launches |

### Not re-measured on 0.3.1

The measure-artefact rows and the smoke against measure agreement stay pending (they run the lab's backend on `terminal/state`, which the owner's open app holds; the 0.3.1 measure installer is built and not installed). No cold HOME A/B of 0.2.1 against 0.3.1 was run, so the 685 ms that the first launch still reads above 0.2.1 is placed by the order of events, not by an A/B (`results.md` F3). No soak was run: the partial soaks of 0.2.0 and 0.1.2 stand and the 2 h soak of 0.1.0 stays the G2 soak evidence. The minimise and hidden readings of 0.2.0, the trim-off series of 0.1.2, T8, the stage 1 Enter units, the eight routes and the 20,000-point hop were not run on 0.3.1. The owner-attended rows are pending, as listed under the 0.1.1 verdict, and a real JOBS backtest started from the launcher is among them. The installer size of the release is written after the tag; the measuring build's release installer is 3,259,352 bytes, 3.1 MB against the 30 MB ceiling.

## Release 0.3.0: the re-measure of 7 October 2026, under load, before the tag

Evidence: `results.md` in this folder (sections E1 to E6), built from raw records under `D:/dev/v030/measure-runs`. Tree: the 0.3.0 commit `51294c5`, clean (the `git diff HEAD` and untracked hashes are the empty sha256 in every record, and HEAD did not move during the run); fresh GNU builds of that tree in the default folder `D:/dev/release/0.3.0`, which passed the artefact check with its build-machine path scan; the GNU smoke build against the real lab for every app row. The owner's order for this release is full speed: there was no quiet slot, and the 0.3.1 work ran in its own worktree at the same time. The 60 second CPU load read 8.9 to 22.9% at the gate of the counted launches and 12.1 to 21.1% before the blocks, the GPU 11 to 44%. The harness code changed in 0.3.0, and the W0B reproduction under that load reproduced both memory figures but not launch to HOME ready (966 ms against 834.5 ms, +15.8%), so the harness labels every figure UNREPRODUCED; every 0.3.0 figure is also PROVISIONAL. Two launches that met a backend pytest session of the 0.3.1 worktree were left out (`results.md` E1). All app rows ran at the shipped desktop caps of 512 and 128 MiB. Release 0.3.0 has been published since 7 October 2026 (tag `desktop-v0.3.0`); the 0.2.1 verdict below stays the latest stated G2 verdict.

### The 0.3.0 reading

**PROVISIONAL, NOT STATED: COLD HOME OVER ITS CEILING UNDER LOAD.** On this reading the automated part of G2 is not stated for 0.3.0. Cold HOME on a first launch reads 6,116 ms at the median (5,835 to 6,680 ms over five counted launches, every one above the 5,000 ms ceiling), against 3,304 ms on 0.2.1 in a quiet slot, and the usual launch reads 3,750 ms against 2,845 ms, inside its ceiling but over its 3,500 ms target. HOME's first paint is about 365 ms later than on 0.2.1; the rest is the page waiting for the backend's HOME data, which waits on the prewarm's HOME stage (4.62 s in the first launch, from the backend's own log, new in 0.3.0). Load is not the whole cause (a first launch after a 60 s load of 11.1%, with no pytest session running, read 6,264 ms), and the run did not separate the machine, the WebView2 runtime update, the lab's growth since 5 October and its move behind the junction on 6 October from the 0.3.0 changes, whose backend HOME path is that of 0.2.1 apart from log lines and the path redaction (`results.md` E3). Every other row re-measured is inside its ceiling at the median: the release row, whole-app idle memory at HOME, reads 209.3 MB (198.2 to 212.8 MB), against 196.1 MB, inside the 400 MB target; warm HOME 735.1 ms, EQ 40.6 ms and REG 86.8 ms are inside their 1,000 ms targets; and the reliability run checked 40 of 40 hidden launches with no refusal, the first proof 3.2 ms after READY at the median and 4.8 ms at most. To state G2 for 0.3.0, cold HOME needs a quiet re-measure, or an A/B of 0.2.1 against 0.3.0 on today's lab in the same conditions; the first says whether 0.3.0 is inside the ceiling, the second whether 0.3.0 itself moved it. No soak was run: the partial soaks of 0.2.0 and 0.1.2 stand and the 2 h soak of 0.1.0 stays the G2 soak evidence. M4 stays provisional, for the reasons given under the 0.1.1 verdict below.

### The 0.3.0 rows

"App harness" is the harness `rows` mode and its first-launch mode on the GNU smoke build of `D:/dev/release/0.3.0`, real lab, app-launched, trim on, under load. n is the number of counted launches behind the figure. Every 0.3.0 reading is PROVISIONAL and UNREPRODUCED.

| Row | 0.3.0 reading (PROVISIONAL) | 0.2.1 reading | Target | Ceiling | Source | n |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Whole app idle at HOME, private working set | **209.3 MB** (198.2 to 212.8), read 73 s after HOME ready | 196.1 MB (179.8 to 199.9), read at the same point | 400 MB (met) | 500 MB | App harness, rows and first-launch series | 4 plus 1 launches |
| The same tree's private bytes (informational, not a row) | 808.1 MB (789.9 to 812.8) | 692.8 MB (689.4 to 722.9) | n/a | n/a | The same samples | 5 launches |
| Cold HOME, first launch (empty state folder) | **6,116 ms** (5,835 to 6,680; over the ceiling in every launch) | 3,304 ms (3,133 to 3,354) | 3,500 ms (missed; first-launch target 4,500 ms missed) | 5,000 ms | App harness, rows and first-launch series | 4 plus 1 launches |
| Cold HOME, usual launch (state filled) | 3,750 ms (3,612 to 3,881) | 2,845 ms | 3,500 ms (missed) | 5,000 ms | Tool `t4t5.mjs usual-app`, after one priming launch | 4 launches |
| Warm HOME | 735.1 ms (727.8 to 765.3) | 550.7 ms | 1,000 ms (met) | 1,500 ms | App harness | 4 launches |
| `volmanaged_v0 EQ`, second run of the line | 40.6 ms (39.9 to 42.6) | 41.3 ms | 1,000 ms (met) | 1,500 ms | App harness | 4 launches |
| `REG`, second run of the line | 86.8 ms (84.2 to 87.4) | 56.7 ms | 1,000 ms (met) | 1,500 ms | App harness | 4 launches |
| Backend ready | 1,596 ms (1,490 to 1,757) | 1,407.5 ms | 1,500 ms (missed) | 2,500 ms | App harness | 5 launches |
| Splash | 358.4 ms (328.3 to 391.8) | 311.3 ms | 500 ms (met) | 1,000 ms | App harness | 5 launches |
| Grid open, 8,411 fills | 140.0 ms (77.2 to 143.3) | 64.8 ms | 100 ms (missed) | 500 ms | App harness | 4 launches |
| GIP pan and zoom p95, 20,000 bars | 6.4 ms (5.8 to 6.6) | 5.9 ms | 16.7 ms (met) | 25 ms | App harness | 4 launches |
| Keystroke to paint, p95 | 8.3 ms (8.3 to 8.4) | 8.2 ms | 50 ms (met) | 100 ms | App harness | 4 launches |
| Launch reliability, READY to the first identity proof (informational) | 3.2 ms median, 4.7 ms p95, 4.8 ms largest; 40 checked, 0 refused, 0 late-proof retries | 3.1 ms median, 3.2 ms p95, 4.7 ms largest; 120 checked, 0 refused | n/a | 2,000 ms for the first try, then three more tries of 5 s | Harness `reliability` mode, real backend (`results.md` E5) | 40 launches |

### Not re-measured on 0.3.0

No quiet re-measure and no cold HOME A/B of 0.2.1 against 0.3.0 were run, by the owner's full-speed order; one of them is needed before G2 can be stated for 0.3.0. The measure-artefact rows and the smoke against measure agreement stay pending (they run the lab's backend on `terminal/state`, which this release keeps untouched; the 0.3.0 measure installer is built and not installed). No soak was run. The minimise and hidden readings of 0.2.0, the trim-off series of 0.1.2, T8, the stage 1 Enter units, the eight routes and the 20,000-point hop were not run on 0.3.0. The Windows contrast themes were checked by the release check's Playwright spec in emulation over every screen; a look under a real Windows contrast theme in the installed app is an owner check. The owner-attended rows are pending, as listed under the 0.1.1 verdict, and a real JOBS backtest started from the launcher is among them. The installer size of the release is written after the tag; the measuring build's release installer is 3,256,924 bytes, 3.1 MB against the 30 MB ceiling.

## Release 0.2.1 (the published release): the re-measure of 5 October 2026, before the tag

Evidence: `results.md` in this folder (sections D1 to D6), built from raw records under `D:/dev/v021/measure-runs`. Tree: the 0.2.1 release commit `56d8eb9`, clean (the `git diff HEAD` and untracked hashes are the empty sha256 in every record, and no commit landed during the slot); fresh GNU builds of that tree in the default folder `D:/dev/release/0.2.1`, which passed the artefact check with its new build-machine path scan; the GNU smoke build against the real lab for every app row. The harness code changed in 0.2.1 (the reliability mode, and `trimSeen` read from the backend's trim), so the W0B anchor was reproduced first (`reproduced: true`; launch to HOME ready 876 ms against 834.5 ms). Every counted launch passed the 60 second CPU gate (2.9 to 4.4%; 0 rejected) with its GPU reading recorded (9 to 17%); the slot was quiet by the manager's locks (`QUIET_MEASURE` and `QUIET`), not an owner-named window. All app rows ran at the shipped desktop caps of 512 and 128 MiB. The measure artefact was built but not run against the real lab, because port 8765 was listening (the owner's terminal). Until the 0.2.1 tag exists, the 0.2.0 verdict below is the verdict of the published release.

### The 0.2.1 reading

**AUTOMATED PASS, OWNER ROWS PENDING.** Every automated row re-measured on 0.2.1 is inside its ceiling at the median and in every single launch. The release row, whole-app idle memory at HOME, reads 196.1 MB (179.8 to 199.9 MB over eight counted launches) (`report.mjs` within-target ACCEPTED), against 197.1 MB on 0.2.0, at the same reading point (73 s after HOME ready, once the backend's working set has dropped) and by the same method; the private bytes at the same samples are 692.8 MB (686.6 MB on 0.2.0). 0.2.1 changes the order of the start to end the stop on the shell's identity check that about 1 start in 240 met on 0.2.0, and the start rows moved with it: the shell checks the backend sooner (backend ready 1,407.5 ms against 1,447 ms) and HOME paints sooner, while HOME's data is in a little later, so cold HOME on a first launch reads 3,304 ms (3,133 to 3,354 ms) against 3,257 ms and the usual launch 2,845 ms against 2,818 ms, all inside their targets. In 120 hidden launches of the new reliability mode on the real backend none was refused and none needed the shell's new retry: the first proof came 3.1 ms after READY at the median and 4.7 ms at most, against 16.1 and 59.8 ms in 30 launches of 0.2.0 and the 2,000 ms the shell allows for the first try. A run of 120 cannot show a 1 in 240 rate gone by counting alone, and it held no first start after a Defender signature update; the margin and the retry behind it are the evidence. No soak was run, because 0.2.1 does not change how memory behaves: the partial soaks of 0.2.0 and 0.1.2 stand and the 2 h soak of 0.1.0 stays the G2 soak evidence. M4 stays provisional, for the reasons given under the 0.1.1 verdict below.

### The 0.2.1 rows

"App harness" is the harness `rows` mode and its first-launch mode on the GNU smoke build of `D:/dev/release/0.2.1`, real lab, app-launched, trim on. n is the number of counted launches behind the figure.

| Row | 0.2.1 reading | 0.2.0 reading | Target | Ceiling | Source | n |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Whole app idle at HOME, private working set | **196.1 MB** (179.8 to 199.9), read 73 s after HOME ready | 197.1 MB (190.0 to 199.4), read at the same point | 400 MB (met) | 500 MB | App harness, rows and first-launch series | 5 plus 3 launches |
| The same tree's private bytes (informational, not a row) | 692.8 MB (689.4 to 722.9) | 686.6 MB (680.0 to 711.5) | n/a | n/a | The same samples | 8 launches |
| Cold HOME, first launch (empty state folder) | 3,304 ms (3,133 to 3,354) | 3,257 ms (3,168 to 5,084; one launch of nine above the ceiling) | 3,500 ms (met; first-launch target 4,500 ms met) | 5,000 ms | App harness, rows and first-launch series | 5 plus 3 launches |
| Cold HOME, usual launch (state filled) | 2,845 ms (2,831 to 2,856) | 2,818 ms | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs usual-app`, after one priming launch | 3 launches |
| Warm HOME | 550.7 ms (538.3 to 563.1) | 548.6 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| `volmanaged_v0 EQ`, second run of the line | 41.3 ms (37.9 to 49.0) | 38.2 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| `REG`, second run of the line | 56.7 ms (53.4 to 57.4) | 56.9 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| Backend ready | 1,407.5 ms (1,361 to 1,439) | 1,447 ms | 1,500 ms (met) | 2,500 ms | App harness | 8 launches |
| Splash | 311.3 ms (307.1 to 338.8) | 317.8 ms | 500 ms (met) | 1,000 ms | App harness | 8 launches |
| Grid open, 8,411 fills | 64.8 ms (62.7 to 67.1) | 65.8 ms | 100 ms (met) | 500 ms | App harness | 5 launches |
| GIP pan and zoom p95, 20,000 bars | 5.9 ms (5.7 to 6.1) | 5.9 ms | 16.7 ms (met) | 25 ms | App harness | 5 launches |
| Keystroke to paint, p95 | 8.2 ms (8.1 to 8.2) | 8.2 ms | 50 ms (met) | 100 ms | App harness | 5 launches |
| Launch reliability, READY to the first identity proof (new, informational) | 3.1 ms median, 3.2 ms p95, 4.7 ms largest; 120 checked, 0 refused, 0 late-proof retries | the 0.2.0 launch probe: 16.1, 58.7 and 59.8 ms; 30 checked, 0 refused | n/a | 2,000 ms for the first try, then three more tries of 5 s | Harness `reliability` mode, real backend (`results.md` D5) | 120 launches |

### Not re-measured on 0.2.1

The measure-artefact rows and the smoke against measure agreement stay pending (port 8765 listening, decision 11; the 0.2.1 measure installer is built and not installed). No soak was run, because 0.2.1 does not change how memory behaves: the 30 min partial soak of 0.2.0 and the 45 min partial soak of 0.1.2 stand, the 2 h soak of 0.1.0 stays the G2 soak evidence and the all-day soak stays an owner check. The minimise and hidden readings of 0.2.0 (the memory target), the trim-off series of 0.1.2, T8, the stage 1 Enter units, the eight routes and the 20,000-point hop were not run on 0.2.1. The owner-attended rows are pending, as listed under the 0.1.1 verdict, and a real JOBS backtest started from the launcher is among them. The installer size of the release is written after the tag; the measuring build's release installer is 3,257,677 bytes, 3.1 MB against the 30 MB ceiling.

## Release 0.2.0 (the previous release): the re-measure of 5 October 2026, before the tag

Evidence: `results.md` in this folder (sections C1 to C7), built from raw records under `D:/dev/v020/measure-runs`. Tree: `d1abef7`, clean, which is the 0.2.0 commit `6cac154` plus three commits for the hosted CI runner that landed during the slot and change no backend, shell, contract or page source (`results.md` C1); fresh GNU builds of that tree in the default folder `D:/dev/release/0.2.0`; the GNU smoke build against the real lab for every app row. The harness code is that of 0.1.2 (digest unchanged) and the W0B anchor was reproduced first (`reproduced: true`; launch to HOME ready 874 ms against 834.5 ms). Every counted launch passed the 60 second CPU gate (2.8 to 5.0%; the minimise launches 4.3 to 5.2%; 0 rejected) with its GPU reading recorded (9 to 16%); the slot was quiet by the manager's locks (`QUIET_MEASURE` and `QUIET`), not an owner-named window. All app rows ran at the shipped desktop caps of 512 and 128 MiB. The measure artefact was built but not run against the real lab, because port 8765 was listening (the owner's terminal). Until the 0.2.0 tag exists, the 0.1.2 verdict below is the verdict of the published release.

### The 0.2.0 reading

**AUTOMATED PASS, OWNER ROWS PENDING.** Every automated row re-measured on 0.2.0 is inside its ceiling at the median. The release row, whole-app idle memory at HOME, reads 197.1 MB (190.0 to 199.4 MB over nine counted launches) (`report.mjs` within-target ACCEPTED), against 199.0 MB on 0.1.2, at the same reading point (73 s after HOME ready, once the backend's working set has dropped) and by the same method; the private bytes at the same samples are 686.6 MB (693.8 MB on 0.1.2). The launcher, the job indicator and the anchor badge cost nothing measurable at idle; in these smoke launches the indicator reads the job list once and stops, because the smoke build runs its backend with the runner off, and a separate check shows that the installed app's 15 s read of the list does not hold off the trim. Two single launches are new and are named here: one first launch read cold HOME 5,084 ms, above the 5,000 ms ceiling (the median of nine is 3,257 ms, and the fourth first launch, taken to check it, read 3,227 ms), and one rows launch of six ended on the shell's stopped page because the backend did not answer the shell's 2 s identity check in time; neither was seen in the 0.1.2 or 0.1.1 records. The new WebView2 memory target works as designed: 60 s after a simulated hide the UI tree's private working set is 42.7 MB on the 0.2.0 shell against 149.6 MB on the 0.1.2 shell, and 60 s after a real minimise on screen 2 it is 83.5 MB against 148.9 MB; the UI tree's private bytes do not change, and the stream came back at once in all four. The 30 min partial soak at 0.2.0 peaked at 619.9 MB, its first sample (target 1,000 MB, ceiling 1,500 MB); 30 minutes is too short for the private-bytes leak rule, which was not evaluated, and an outside sampler read between rounds saw the private bytes climb in shrinking steps (890.3 to 960.8 MB over 25 minutes), as on 0.1.2, so the all-day soak decides. It is partial, and the 2 h soak of 0.1.0 stays the G2 soak evidence. M4 stays provisional, for the reasons given under the 0.1.1 verdict below.

### The 0.2.0 rows

"App harness" is the harness `rows` mode and its first-launch mode on the GNU smoke build of `D:/dev/release/0.2.0`, real lab, app-launched, trim on. n is the number of counted launches behind the figure.

| Row | 0.2.0 reading | 0.1.2 reading | Target | Ceiling | Source | n |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Whole app idle at HOME, private working set | **197.1 MB** (190.0 to 199.4), read 73 s after HOME ready | 199.0 MB (192.8 to 202.8), read at the same point | 400 MB (met) | 500 MB | App harness, rows and first-launch series | 5 plus 4 launches |
| The same tree's private bytes (informational, not a row) | 686.6 MB (680.0 to 711.5) | 693.8 MB (678.6 to 713.5) | n/a | n/a | The same samples | 9 launches |
| Cold HOME, first launch (empty state folder) | 3,257 ms (3,168 to 5,084; one launch of nine above the ceiling) | 3,186.5 ms (3,152 to 3,209) | 3,500 ms (met at the median; first-launch target 4,500 ms met at the median) | 5,000 ms | App harness, rows and first-launch series | 5 plus 4 launches |
| Cold HOME, usual launch (state filled) | 2,818 ms (2,806 to 2,828) | 2,773 ms | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs usual-app`, after one priming launch | 3 launches |
| Warm HOME | 548.6 ms (543.0 to 562.5) | 543.1 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| `volmanaged_v0 EQ`, second run of the line | 38.2 ms (30.7 to 41.9) | 32.1 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| `REG`, second run of the line | 56.9 ms (52.7 to 59.3) | 53.5 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches |
| Backend ready | 1,447 ms (1,407 to 1,621) | 1,397.5 ms | 1,500 ms (met) | 2,500 ms | App harness | 9 launches |
| Splash | 317.8 ms (309.2 to 509.4) | 312.7 ms | 500 ms (met) | 1,000 ms | App harness | 9 launches |
| Grid open, 8,411 fills | 65.8 ms (61.8 to 206.3) | 63.3 ms | 100 ms (met) | 500 ms | App harness | 5 launches |
| GIP pan and zoom p95, 20,000 bars | 5.9 ms (5.7 to 6.1) | 6.0 ms | 16.7 ms (met) | 25 ms | App harness | 5 launches |
| Keystroke to paint, p95 | 8.2 ms (8.1 to 8.3) | 8.1 ms | 50 ms (met) | 100 ms | App harness | 5 launches |
| UI tree 60 s after a hide or minimise, private working set (new, informational) | 42.7 MB after a simulated hide; 83.5 MB after a real minimise on screen 2 | the 0.1.2 shell in the same session: 149.6 MB and 148.9 MB | n/a | n/a | Harness `minimise-sim` and `minimise-real` with an outside sampler (`results.md` C4) | 1 launch each |
| Stream back in stream mode after the restore | 1 ms (simulated), 0 ms (real minimise) | the 0.1.2 shell in the same session: 1 ms and 1 ms | n/a | 30,000 ms | Harness minimise modes, LIVE open | 1 launch each |
| 30 min partial soak at 0.2.0, largest sample | 619.9 MB (the first sample; from 900 s at most 583.3 MB; last 458.6 MB); private bytes 1,116.5 to 1,324.0 MB, leak rule not evaluated (too short); PARTIAL, 30 min | 0.1.2, 45 min: 641.9 MB, leak rule pass | 1,000 MB (met) | 1,500 MB | Harness `soak` mode, trim on | 7 samples, 1 run |

### Not re-measured on 0.2.0

The measure-artefact rows and the smoke against measure agreement stay pending (port 8765 listening, decision 11; the 0.2.0 measure installer is built and not installed). The trim-off series of 0.1.2 (B4, B5) was not repeated, because the trim is unchanged; T8, the stage 1 Enter units, the eight routes and the 20,000-point hop were not run on 0.2.0. The 2 h soak of 0.1.0 stays the G2 soak evidence and the all-day soak stays an owner check. The owner-attended rows are pending, as listed under the 0.1.1 verdict, and a real JOBS backtest started from the launcher is among them. The installer size of the release is written after the tag; the measuring build's release installer is 3,256,218 bytes, 3.1 MB against the 30 MB ceiling.

## Release 0.1.2: the re-measure of 5 October 2026, before the tag

Evidence: `results.md` in this folder (sections B1 to B7), built from raw records under `D:/dev/v012/measure-runs`. Tree: the 0.1.2 release commit `31baa14`, clean (the `git diff HEAD` and untracked hashes are the empty sha256 in every record), fresh GNU builds of that tree in the default folder `D:/dev/release/0.1.2`, the GNU smoke build against the real lab for every app row. The harness code changed in 0.1.2, so the W0B anchor was reproduced first (`reproduced: true`; launch to HOME ready 873 ms against 834.5 ms). Every counted launch passed the 60 second CPU gate (2.9 to 3.4%, 0 rejected) with its GPU reading recorded (7 to 18%); the slot was quiet by the manager's locks (`QUIET_MEASURE` and `QUIET`), not an owner-named window. All app rows ran at the shipped desktop caps of 512 and 128 MiB. The measure artefact was built but not run against the real lab, because port 8765 was listening (the owner's terminal).

### The 0.1.2 reading

**AUTOMATED PASS, OWNER ROWS PENDING.** Every automated row re-measured on 0.1.2 is inside its ceiling. The release row, whole-app idle memory at HOME, reads 199.0 MB (192.8 to 202.8 MB over eight counted launches; `report.mjs` within-target ACCEPTED) against the 400 MB target and the 500 MB ceiling, the first reading inside the target. Two facts go with that figure wherever it is quoted. It is read 73 s after HOME ready, once the backend's working set has dropped, not at the 0.1.1 point (HOME ready plus 2.5 s, where 0.1.1 read 477.3 MB). And it is a working-set figure: the backend's trim (`memtrim.py`) moves untouched pages to the standby list, so the whole tree's private bytes at the same samples stay at 693.8 MB (678.6 to 713.5 MB). With the trim off, at the same 73 s point, the row reads 404.4 MB (401.9 to 405.3 MB) and the private bytes 689.5 MB. The trim makes no warm row slower: warm HOME 543.1 ms with it against 544.3 ms without, EQ 32.1 against 42.3 ms, REG 53.5 against 56.8 ms. The 45 min partial soak at 0.1.2 peaked at 641.9 MB (target 1,000 MB, ceiling 1,500 MB) and its private bytes passed the leak rule (24.3 MB an hour and 12.1 MB over the settled window); an outside sampler read between rounds saw the private bytes still climbing slowly (about 33 MB from 15 to 40 minutes, flattening), so the all-day soak decides. It is partial, and the 2 h soak of 0.1.0 stays the G2 soak evidence. M4 stays provisional, for the reasons given under the 0.1.1 verdict below.

### The 0.1.2 rows

"App harness" is the harness `rows` mode and its first-launch mode on the GNU smoke build of `D:/dev/release/0.1.2`, real lab, app-launched, with the trim on unless the row says off. n is the number of counted launches behind the figure.

| Row | 0.1.2 reading | 0.1.1 reading | Target | Ceiling | Source | n |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Whole app idle at HOME, private working set | **199.0 MB** (192.8 to 202.8), read 73 s after HOME ready | 477.3 MB (453.0 to 484.4), read at HOME ready plus 2.5 s | 400 MB (met) | 500 MB | App harness, rows and first-launch series | 5 plus 3 launches |
| The same tree's private bytes (informational, not a row) | 693.8 MB (678.6 to 713.5) | not recorded | n/a | n/a | The same samples | 8 launches |
| Whole app idle at HOME with the trim off (`NQT_MEMTRIM=0`), same point | 404.4 MB (401.9 to 405.3); private bytes 689.5 MB | n/a | 400 MB (not met) | 500 MB | App harness, `--memtrim off` | 3 launches |
| Cold HOME, first launch (empty state folder) | 3,186.5 ms (3,152 to 3,209) | 3,192.5 ms | 3,500 ms (met; first-launch target 4,500 ms met) | 5,000 ms | App harness, rows and first-launch series | 5 plus 3 launches |
| Cold HOME, usual launch (state filled) | 2,773 ms (2,753 to 2,778) | 2,797 ms | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs usual-app`, after one priming launch | 3 launches |
| Warm HOME | 543.1 ms (533.4 to 565.7); trim off 544.3 ms | 537.6 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches (off: 3) |
| `volmanaged_v0 EQ`, second run of the line | 32.1 ms (29.5 to 40.6); trim off 42.3 ms | 38.4 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches (off: 3) |
| `REG`, second run of the line | 53.5 ms (48.7 to 57.1); trim off 56.8 ms | 56.9 ms | 1,000 ms (met) | 1,500 ms | App harness | 5 launches (off: 3) |
| Backend ready | 1,397.5 ms (1,376 to 1,410) | 1,401.5 ms | 1,500 ms (met) | 2,500 ms | App harness | 8 launches |
| Splash | 312.7 ms (300.6 to 328.9) | 316.7 ms | 500 ms (met) | 1,000 ms | App harness | 8 launches |
| Grid open, 8,411 fills | 63.3 ms (62.6 to 129.5) | 65.9 ms | 100 ms (met) | 500 ms | App harness | 5 launches |
| GIP pan and zoom p95, 20,000 bars | 6.0 ms (5.6 to 6.2) | 6.2 ms | 16.7 ms (met) | 25 ms | App harness | 5 launches |
| Keystroke to paint, p95 | 8.1 ms (8.0 to 8.2) | 8.3 ms | 50 ms (met) | 100 ms | App harness | 5 launches |
| 45 min partial soak at 0.1.2, largest sample | 641.9 MB (first 545.9, last 495.8 MB); private bytes 1,147.7 to 1,355.0 MB, leak rule pass (24.3 MB an hour); PARTIAL, 45 min | not run on 0.1.1 (0.1.0, 2 h: 705.8 MB) | 1,000 MB (met) | 1,500 MB | Harness `soak` mode, trim on | 10 samples, 1 run |

### Not re-measured on 0.1.2

The measure-artefact rows and the smoke against measure agreement stay pending (port 8765 listening, decision 11; the 0.1.2 measure installer is built and not installed). The simulated minimise, T8, the stage 1 Enter units, the eight routes and the 20,000-point hop were not run on 0.1.2; their 0.1.0 readings below are history. The 2 h soak of 0.1.0 stays the G2 soak evidence and the all-day soak stays an owner check. The owner-attended rows are pending, as listed under the 0.1.1 verdict. The installer size of the release is written after the tag; the measuring build's release installer is 3,254,722 bytes, 3.1 MB against the 30 MB ceiling.

## Verdict (release 0.1.1, the previous release)

Evidence: `results.md` in this folder (sections A1 to A7), built from raw records under `D:/dev/w6/measure-runs`. Tree `656a964` (which merges `519a3cb`, the thread-cap fix) plus the uncommitted version bump to 0.1.1 (the tracked diff hashes to the stamp of every record; `results.md` section A1), fresh GNU builds of that tree, the GNU smoke build against the real lab for every app row. The measure artefact was built but not run against the real lab, because port 8765 was listening (the owner's terminal). Every counted run passed the 60 second CPU gate (2.9 to 4.9%, 0 rejected) with its GPU reading recorded (9 to 15%), the W0B anchor held (the harness digest is unchanged since the W5C reproduction), and the slot was quiet by the manager's lock, not an owner-named window. All app rows ran at the shipped desktop caps of 512 and 128 MiB. Targets are not recalibrated here; ceilings are as in 04 D5. This verdict replaces the 0.1.0 one (W5C, kept below as history) and the W5B one before it.

**AUTOMATED PASS, OWNER ROWS PENDING.** Every automated row of G2 that was measured on 0.1.1 is inside its ceiling, the release row included: whole-app idle memory at HOME reads 477.3 MB (453.0 to 484.4 MB over the six counted launches, `report.mjs` within-ceiling ACCEPTED) against the 500 MB ceiling, with 15.6 MB of headroom at the worst launch; it was 505.4 MB, over the ceiling, on 0.1.0. It is still above the 400 MB target (by 77.3 MB). The fix is the thread caps of release 0.1.1 (`threadcaps.py`: OpenBLAS, OpenMP, MKL and NumExpr pools capped at 2 in the backend server); measured with an attach driver it took the backend from 68 threads to 13, committed private bytes from 1,790 to 369 MB and its working set from 262.6 to 246.1 MB. At the official reading point the interpreter still holds 24 to 28 threads, because the prewarm workers are alive then (17 threads 33 s after spawn in the warm-up run), so the attach driver's 13 is not the figure of the row. The rows that were not re-run in 0.1.1 (the soak, the simulated minimise, T8, the stage 1 rows) stand on their 0.1.0 readings, which are history and were all inside their ceilings; the measure-artefact rows and the owner-attended rows are pending.

**M4 (provisional).** The Windows app is built, packaged, installable and correct through the app-launched backend. Provisional because: the soak ran 2 h on 0.1.0, not all day, and was not repeated on 0.1.1; the measure artefact was not run against the real lab; the quiet slot was the manager's lock, not an owner-named window; and the owner-attended rows are all still pending. It becomes final when the owner-attended rows are done and the owner accepts the idle row's distance from its 400 MB target.

### The row that was over its ceiling on 0.1.0, now inside

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Whole app idle at HOME, private working set | **477.3 MB** (453.0 to 484.4; rows series 484.4, 475.4, 482.6; first-launch series 453.0, 479.2, 470.8); 0.1.0 505.4 MB (492.4 to 508.4); W5B 1,082 MB | 400 MB (not met) | 500 MB | App harness `rows` and first-launch series, `report.mjs` over `D:/dev/w6/measure-runs` | Real lab, app-launched | 3 plus 3 launches |

Breakdown (informational, median of six): backend 275.6 MB (297.3 MB on 0.1.0), UI tree 195.4 MB (198.2 MB), shell 4.3 MB. The backend's interpreter ran 24 to 28 threads at the reading point (26, 25, 26, 24, 28, 27) plus the venv launcher's 3; its private bytes there were 398 to 642 MB, mostly 400 to 460 MB. The warm-up launch (488.0 MB) was not counted. The reading point is unchanged since W0B: HOME ready plus a 2.5 second idle check, before the prewarm's later tasks finish (`results.md` sections A4 and 9).

### Rows within their ceiling

Each row names where its reading came from. "App harness" is the harness `rows` mode (`D:/dev/w6/measure-runs/rows`) on the GNU smoke build, which launches the app and reads the page probe. "Stage 1" is `docs/desktop/stage1/measure_stage1.mjs`: headless Chromium against the standalone real backend on port 8797, with no shell. "Real lab, app-launched" means the smoke build started its own backend on the real lab, with a temporary state folder and `NQT_JOBS=off`. n is the number of accepted runs behind the figure. Rows marked "carried from 0.1.0" were not re-run in 0.1.1; their reading is the W5C one.

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Backend ready | 1,401.5 ms (1,378 to 1,412) | 1,500 ms (met) | 2,500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 6 launches |
| Splash | 316.7 ms (301.2 to 327.4) | 500 ms (met) | 1,000 ms | App harness, median, 0.1.1 | Real lab, app-launched | 6 launches |
| Cold HOME, usual launch (state filled) | 2,797 ms (2,777 to 2,829) | 3,500 ms (met) | 5,000 ms | Tool `t4t5.mjs` (kept outside the repository), median after one priming launch, 0.1.1 | Real lab, app-launched | 3 launches |
| Warm HOME | 537.6 ms (534.0 to 558.8) | 1,000 ms (met) | 1,500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| `volmanaged_v0 EQ`, warm, desktop caps (Enter unit) | 653 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| `REG`, warm, desktop caps (Enter unit) | 452 ms | 1,000 ms (met) | 1,500 ms | Stage 1, median, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 5 runs |
| Grid open, 8,411 fills | 65.9 ms (61.5 to 72.3) | 100 ms (met) | 500 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| GIP pan and zoom p95, 20,000 bars (T5) | 6.2 ms (5.8 to 6.4) | 16.7 ms (met) | 25 ms | App harness, median, 0.1.1 (bars tiled from the real response) | Real lab, app-launched | 3 launches |
| 20,000-point data hop (T5), 17,097 points, warm | 15.2 ms (largest 34.4) | n/a | 100 ms | Hop series of `t4t5.mjs` over the debugging protocol, carried from 0.1.0 | Real lab, app-launched | 5 fetches, 1 series |
| Keystroke to paint, p95 | 8.3 ms (8.2 to 8.3) | 50 ms (met) | 100 ms | App harness, median, 0.1.1 | Real lab, app-launched | 3 launches |
| Eight routes, worst repeat, desktop caps | 12 ms | 100 ms (met) | 300 ms | Stage 1, one run, carried from 0.1.0 | Standalone real backend, port 8797, headless Chromium, no app | 1 run |
| Installer | 3.1 MB (3,253,511 bytes for the measuring build; the shipped installer is a rebuild after the commit) | 15 MB (met) | 30 MB | Build output and artefact check of `D:/dev/w6/release-m/0.1.1`; the harness `installer` mode was not run | Not applicable | 1 file |
| T8 drift run, attached smoke build, desktop project | 14 passed, 0 failed; WebView2 154.0.4258.53 (carried from 0.1.0) | n/a | clean run | Playwright desktop project against the smoke build, carried from 0.1.0 | Offline demo server, port 4373 | 1 run |

The app's own second-run readings for the two Enter units are 38.4 ms for EQ and 56.9 ms for REG on 0.1.1 (0.1.0: 41.3 ms and 57 ms; W5B: 39 ms and 58 ms). They differ from the stage 1 rows above because the harness repeats the line in one session. The first run of the line, in a fresh app, is not a row of the 0.1.1 record; on 0.1.0 it read a median of 597.3 ms for EQ and 345.7 ms for REG (W5B series B: 600 ms and 345 ms). The decision register judges the stage 1 Enter unit; neither app figure is a separate pass line.

The 20,000-point hop could not be taken at exactly 20,000 points (the route returns whole buckets); the largest answer at or under 20,000 points is 17,097 points.

### First launch re-measured, and the rows carried from 0.1.0

| Row | Reading | Target | Ceiling | Source | Backend | n |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Cold HOME with data, **first launch** (empty state folder) | 3,192.5 ms (3,164 to 3,210; rows series 3,210, 3,194, 3,201; first-launch mode 3,164, 3,183, 3,191, median 3,183); 0.1.0 3,172.5 ms; W5B 5,048 ms | 3,500 ms (met; the first-launch target of 4,500 ms met too) | 5,000 ms | App harness, median, 0.1.1; `report.mjs` over the folder | Real lab, app-launched | 3 plus 3 launches |
| Simulated minimise with LIVE, stream back after 30 minutes hidden | 0 ms; the controller hidden at engine level (`controller-file`); carried from 0.1.0 (not run on 0.1.1) | n/a | 30,000 ms | Harness `minimise-sim` mode, 0.1.0 | Fixture backend, app-launched | 1 run |
| Whole app, 2 h soak at the shipped caps (largest sample), PARTIAL | 705.8 MB (first sample 698.7 MB, median 674.8 MB, slope over the last hour +25.9 MB per hour); carried from 0.1.0 (not run on 0.1.1); W5B 1,577.4 MB (3 h) | 1,000 MB (met) | 1,500 MB | External whole-tree sampler on 0.1.0, `D:/dev/w5c/measure-runs/soak-outside.jsonl` | Real lab, app-launched | 25 samples, 1 run |

### Correctness set on this tree

The release suites of the 0.1.1 tree were green on their final runs: backend 4,155 passed; crosscheck strict PASS 2,495, FAIL 0, SKIP 0; QA tests 333 passed; vitest 7,394 passed (47 skipped); `test:types` and `test:e2e-types` clean; web build OK with every bundle budget met; `check.ps1` 29 of 29 steps; harness node tests 172 passed; Playwright e2e 539 passed, offline 190 passed (3 declared skips), desktop 42 passed, perf 3 passed (`results.md` section A6). One real failure came out of the version bump (the generated API contract hash was stale and `web/dist` with it) and was fixed at the cause; the other failures were load or invocation noise and passed on rerun without a code change. The real-data smoke and `crosscheck.served` are not in the 0.1.1 suite summary above, and the dated records of all four release checks need the manager's commit. Every gate log line of the measuring runs has caller `terminal` and a window inside the fence (521 new lines, timestamped inside the run).

### Provisional rows

None by the CPU gate: every counted run sat at a 60 second reading of 4.9% or lower (2.9 to 4.9%), with no rejected reading. Two labels apply all the same so that nothing reads as more than it is: (1) the quiet slot was the manager's lock, not an owner-named window; (2) the rows carried from 0.1.0 (the soak, which was 2 h and PARTIAL by the 8 hour rule, the simulated minimise, T8 and the stage 1 rows) were not re-measured on 0.1.1. The reproduction held, so no figure carries UNREPRODUCED.

### Pending, not run

| Item | Why | Where it is picked up |
| --- | --- | --- |
| Backend ready, splash, cold HOME and idle memory on the **measure artefact**, real lab, 3 runs each; the very first launch after install on the measure build; the smoke and measure agreement test | Port 8765 listening (pid 46084): decision 11. The 0.1.1 measure installer is built at `D:/dev/w6/release-m/0.1.1` and not installed | `docs/desktop/checks/2026-10-03_pending-measurements.md` |
| Soak, simulated minimise and T8 on 0.1.1 | Not run, as instructed; the 0.1.0 readings are history | A repeat before the dual run starts, if the owner wants the 0.1.0 figures confirmed on 0.1.1 |
| The idle row against its 400 MB target | The row is inside its ceiling and 77.3 MB above the target (`results.md` section A4) | The manager and the owner |
| All-day soak | The 2 h run is PARTIAL; the all-day run is an owner check on a day the PC can be left alone | `docs/desktop/checks/2026-10-03_all-day-soak.md` |
| Owner-attended: reboot first launch, visible run, real minimise and restore, keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest, SmartScreen first run, 200% zoom by eye, custom install folder | Owner-attended | `docs/desktop/checks/` (the templates are dated 3 October and name the 0.1.0 installer; use the 0.1.1 values of the hand-over, section 2) |
| Release check on a clean commit | The check needs a commit, and a commit changes the stamp | After the manager's commit: the dated records, a build in the default folder, then `release_check.ps1` |

## Safety checks held during every run

No window of the app under test appeared and the foreground never changed because of it; no TWS or gateway was configured or contacted (the backend ran under its allow-listed environment); no order surface exists; port 8765 and its backend, pid 39464 and every process not started by the run were never touched; `jobs.json`, `backtests/output`, the research files and `terminal/state` were unchanged (the gate log grew only by caller `terminal` lines inside the fence); every launch had a PATH without the MinGW and cargo folders; the browsers were headless; the QuantPad runners were not touched (the quiet lock was held 16:39:55 to 16:56:42).

## The earlier verdicts, kept as history

**0.1.0 (wave W5C, 4 October 2026, commit `8122c87`).** The automated part of G2 was not passed: one automated row was over its ceiling, whole-app idle memory at HOME at 505.4 MB (492.4 to 508.4 MB over six counted launches) against 500 MB, with first-launch cold HOME at 3,167 ms (rows series; 3,172.5 ms pooled), the 2 h soak at 705.8 MB largest sample, the simulated minimise at 0 ms and T8 at 14 of 14, all inside their ceilings. Trigger T4 fired on equal terms with the browser terminal (412.5 MB). M4 was provisional. The figures and the conditions are in `results.md` sections 1 to 14.

**W5B (3 to 4 October 2026, commit `09a660d`).** Three automated rows were over their ceilings: idle at HOME 1,082 MB, first-launch cold HOME 5,048 ms and the soak's first sample 1,577.4 MB (3 h). Section 13 of `results.md` sets W5B beside W5C.
