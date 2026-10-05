# G2 on Windows: measured results (release 0.2.0 re-measure, taken before its tag; the 0.1.2 record of the previous release and the 0.1.1, 0.1.0 and W5B records follow as history)

Sections C1 to C7 are the 0.2.0 record: taken on 5 October 2026, in a quiet slot from 07:17 to 09:11 BST, on the owner's PC, on the 0.2.0 tree before its tag (C1 names the commit), written from the raw records under `D:/dev/v020/measure-runs` (named in C7). Now that 0.2.0 is published, the 0.1.2 record below is the record of the previous release. Sections B1 to B7 are the 0.1.2 record: taken on 5 October 2026, in a quiet slot from 04:25 to 06:02 BST, on the owner's PC, on the 0.1.2 release commit before its tag, written from the raw records under `D:/dev/v012/measure-runs` (named in B7). Sections A1 to A7 are the 0.1.1 record: taken on 4 October 2026, in a slot from 16:39 to 16:57 BST, on the owner's PC (host `DESKTOP-FM5O3JM`), after the thread-cap fix of release 0.1.1 (commit `519a3cb`, merged as `656a964`), written from the raw records under `D:/dev/w6/measure-runs` (named in A7). Sections 1 to 14 below them are the 0.1.0 record of wave W5C, unchanged, and section 13 sets W5B beside W5C; they stay as history and are the evidence for every row that no later record re-ran. The verdict is in `verdict.md`.

## C1. Read this first (release 0.2.0)

- **What 0.2.0 changes for G2.** 0.2.0 adds the research launcher (a backtest of a registered strategy started from a ledger preset, and a regression anchor re-run, through the JOBS queue; `docs/research_launcher.md`), a global job indicator, an anchor badge, a retry of the shell's HOME probe and, in the Windows shell, the WebView2 memory usage target: Low while the main window is minimised or hidden, Normal when it returns (`desktop/src-tauri/src/memory_target.rs`). Two of these reach the rows. The job indicator reads the job list (`GET /api/jobs`) every 15 s with no job active and every 2 s with one; `memtrim.py` counts that read as a background poll (`BACKGROUND_PATHS`), so it does not hold off the quiet trim (checked in C5). The memory target is measured here for the first time (C4). The trim, the idle reading point and the harness code are those of 0.1.2 (harness digest `1a050eb2...`, unchanged).
- **Result.** Idle memory at HOME reads **197.1 MB** (190.0 to 199.4 MB over nine counted launches), against 199.0 MB (192.8 to 202.8) on 0.1.2: the same within noise, inside the 400 MB target and the 500 MB ceiling. The private bytes of the whole tree at the same samples are 686.6 MB (680.0 to 711.5 MB), against 693.8 MB. Every re-measured row is inside its ceiling at the median, and the automated part of G2 stays passed; the owner-attended rows are pending (`verdict.md`). Two single launches are named in C2 because they are new: one first launch read cold HOME 5,084 ms, above the 5,000 ms ceiling, and one rows launch ended on the shell's stopped page because the backend did not answer the shell's identity check in time. With the window hidden or minimised the 0.2.0 shell sets the Low target, and 60 s later the UI tree's private working set is 42.7 MB after a simulated hide and 83.5 MB after a real minimise on screen 2, against 149.6 and 148.9 MB on the 0.1.2 shell, with its private bytes unchanged (C4). The 30 min partial soak at 0.2.0 peaked at 619.9 MB, its first sample (target 1,000 MB, ceiling 1,500 MB); 30 minutes is too short for the private-bytes leak rule (C6).
- **Tree and builds.** The slot began on `6cac154`, the 0.2.0 commit of the brief, clean. Three commits for the hosted CI runner landed on `main` during it: `5038663` (07:23:05), `c5bf39f` (07:25:41) and `d1abef7` (07:34:57). They change the vitest section of `web/vite.config.ts`, the waits of one test file and one step of `.github/workflows/ci.yml`; no backend, shell, contract or page source differs between `6cac154` and `d1abef7`. `web/vite.config.ts` is an input of the page build stamp, so from 07:22:48 the page build counted as stale and the first rows launches of the slot (the warm-up and the first counted launch) landed on the shell's rebuild page (shell event `stale_dist`); that block was stopped, its records were set aside (`measure-runs/aborted-stale-page`, not counted), the page was rebuilt with `pnpm build`, and the four builds were made again from `d1abef7` by `desktop/scripts/build-release.ps1 -Version 0.2.0 -Force` into the default folder `D:/dev/release/0.2.0` (target folder `D:/dev/targets/release`, 0 failures, the stamp the same before and after; a build started on `c5bf39f` in between was refused by the script's own stamp check when `d1abef7` landed during it). The builds passed `artefact-check.mjs` (23 files, 3 installers). Every counted launch below ran on `d1abef7` with a clean tree (`git diff HEAD` and the untracked files hash to the empty sha256 in every record), and before every block the chain logged HEAD and the page stamp: neither moved after 07:40. The release installer of that build is 3,256,218 bytes. The shipped installer is a rebuild after the manager's docs commit, which changes the stamp, so its size and SHA256 are written after the tag.
- **The quiet slot.** `D:/dev/locks/QUIET_MEASURE` and `D:/dev/locks/QUIET` (the second also pauses the QuantPad download runners) were created at 07:17:16 BST and held through the stopped block, the reruns, the minimise block and the soak to 09:03:31, when the chain removed them; the tail took them again 1.2 s later and held them from 09:03:32 to 09:10:55 for the two last launches (C2). Before the slot nothing was building and no backend pytest, Playwright or vitest run was alive; before each block the chain checked again for a pytest session and found none. The commits above did not come from the slot; when it was stopped at 07:30, no test, build or Playwright process was running. The slot was set by the manager, not named by the owner.
- **The CPU gate.** The 60 second CPU load read before each block: 4.6% (reproduction), 3.1% (rows), 3.7, 3.4 and 3.1% (the three first launches), 3.0% (usual launch), 4.2% (minimise), 4.4% (soak), 4.4% (the extra rows launch) and 2.6% (the fourth first launch). Every counted launch also sat behind the harness's own 60 second gate at a 10% limit and read 2.8 to 5.0% (the four minimise launches 4.3 to 5.2%), so 0 runs were rejected and no figure is PROVISIONAL. GPU load was 9 to 16%.
- **Reproduction first.** `run.mjs --mode reproduce --runs 3` ran from 07:18 to 07:22 on `6cac154`, before the page went stale: private memory at HOME 166.4 MB (W0B 164.9 MB, +0.9%), after the heavy set 371.0 MB (W0B 369.5 MB, +0.4%), launch to HOME ready 874 ms (W0B 834.5 ms, +4.7%), all within 10%, verdict `reproduced: true`. The gate is bound to the harness digest, which did not change, so it stands for the launches on `d1abef7`, and no figure carries the UNREPRODUCED label. The breakdown's spawn to HOME document read 246 ms against 214 ms, outside its own reference by 32 ms; it is informational and does not gate (0.1.2 read 242 ms).
- **Launch conditions.** As in B1: the smoke build with real data, a fresh temporary state folder for every launch except the usual launch, the shipped caps, hidden windows (the real minimise on screen 2 only, C4) and the harness's clean PATH. The commands, in order: `run.mjs --build smoke --rows all --runs 5 --warmup 1 --real-data --memtrim on`; `run.mjs --first-launch --build smoke` three times; `t4t5.mjs usual-app --runs 3`; the minimise block (C4); the soak (C6); then one more rows launch (`--runs 1 --warmup 0`) and one more first launch (C2). Every launch named the smoke exe of `D:/dev/release/0.2.0`, except the 0.1.2 comparison launches of C4. The window watch showed 0 new windows and 0 foreground changes in every launch but the real minimise, whose one window on screen 2 the watch expected, and every teardown left 0 survivors.
- **The job indicator in these launches.** The smoke build starts its backend with `NQT_JOBS=off` (the smoke spec, 03 section 8), so in every launch here the indicator is mounted as shipped, reads the job list once, finds the runner off and stops polling. In the installed app the runner is on and the list is read every 15 s; C5 checks that this read does not hold off the trim.
- **Port 8765 was listening (pid 46084, the owner's terminal)**, so the measure-artefact real-lab rows were not run. Nothing at that port or in that process was touched.
- **Research gate and lab state.** The read-only lab check before the slot (07:17) and after it (09:10): `jobs.json` sha256 `44CAE38A...` both times, `backtests/output` 139 entries both times, the `terminal/state` listing unchanged (`cache`, `desktop`, `logs`, `release`, `workspaces`, `backend.lock`, `jobs.json`), and `ledger.csv`, `registry.csv` and `oos_openings.json` byte-equal. The gate log grew by 905 lines, all caller `terminal`, all ending at or before 2022-01-01, timestamped 06:41:09 to 08:09:29 UTC, so all inside the slot (`measure-runs/gate-log-new-lines.jsonl`).
- **Host.** Not freshly booted (up about 64 hours), so the first-launch records say `firstAfterBoot` false.

## C2. The rows, 0.2.0 against 0.1.2

All readings are the whole-app smoke build, real lab, shipped desktop caps, trim on. "0.1.2" is the B3 reading. Medians, with the counted values or the range beside them.

| Row | Target | Ceiling | 0.1.2 | 0.2.0 median (counted values) | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| Whole-app idle at HOME, private working set (the release row) | 400 MB | 500 MB | 199.0 MB (192.8 to 202.8), read 73 s after HOME ready | **197.1 MB** (190.0 to 199.4; n = 9: rows series 199.1, 199.4, 196.3, 197.1, 193.8; first-launch series 199.3, 190.0, 198.8, 193.0), read 73 s after HOME ready | within target |
| The tree's private bytes at the same samples (informational) | | | 693.8 MB (678.6 to 713.5) | 686.6 MB (680.0 to 711.5; rows 687.7, 686.6, 684.0, 686.7, 711.5; first launch 707.2, 686.3, 685.3, 680.0) | not a row |
| Cold HOME, first launch, empty state folder | 4,500 ms (usual 3,500) | 5,000 ms | 3,186.5 ms (3,152 to 3,209) | 3,257 ms (3,168 to 5,084; n = 9: rows 3,221, 3,168, 3,189, 3,281, 3,468; first-launch mode 5,084, 3,261, 3,257, 3,227) | within target at the median; one launch above the ceiling |
| Cold HOME, usual launch (state filled) | 3,500 ms | 5,000 ms | 2,773 ms | 2,818 ms (2,828, 2,818, 2,806; one priming launch of 3,245 ms not counted; gate 3.2, 3.8, 3.4%) | within target |
| `volmanaged_v0 EQ`, second run of the line | 1,000 ms | 1,500 ms | 32.1 ms | 38.2 ms (35.8, 38.2, 30.7, 41.9, 41.4) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 543.1 ms | 548.6 ms (545.8, 548.6, 543.0, 556.2, 562.5) | within target |
| `REG`, second run of the line | 1,000 ms | 1,500 ms | 53.5 ms | 56.9 ms (57.1, 56.9, 53.0, 59.3, 52.7) | within target |
| Backend ready (informational) | 1,500 ms | 2,500 ms | 1,397.5 ms | 1,447 ms (1,407 to 1,621; n = 9) | within target |
| Splash painted (informational) | 500 ms | 1,000 ms | 312.7 ms | 317.8 ms (309.2 to 509.4; n = 9) | within target |
| Grid open (rows series, informational) | 100 ms | 500 ms | 63.3 ms | 65.8 ms (66.5, 65.8, 61.8, 206.3, 62.1) | within target |
| GIP pan and zoom p95 (rows series, informational) | 16.7 ms | 25 ms | 6.0 ms | 5.9 ms (5.9, 5.7, 6.1, 5.7, 6.0) | within target |
| Keystroke to paint p95 (rows series, informational) | 50 ms | 100 ms | 8.1 ms | 8.2 ms (8.2, 8.2, 8.1, 8.3, 8.1) | within target |

`report.mjs` over the trim-on folder reports `idle_mem_home` on the smoke build as 197.1 MB (190 to 199.4, n = 9) and marks it **within-target ACCEPTED**, and cold HOME as 3,257 ms (3,168 to 5,084), within target; it prints the private bytes as 686.6 MB beside a working set of 197.1 MB. The rows series has five counted launches: four from the first rows run and one from a later run of one launch (`on/rows-extra`), which replaced the failed sixth launch of the first run (C7, finding 3). The first-launch series has four: the three of the plan and one more, taken to see whether the 5,084 ms of its first launch would repeat (it read 3,227 ms). The warm-up launch (idle 192.1 MB, cold HOME 3,316 ms, the drop seen at 79.1 s) was not counted.

Against 0.1.2, idle memory, the warm rows, the grid, pan and zoom and the keystroke are the same within noise, and every median is inside its target. Three readings moved a little later: backend ready by about 50 ms (1,447 against 1,397.5 ms, and the ranges barely overlap), the cold HOME median by about 70 ms and the usual launch by about 45 ms. The 0.2.0 backend serves three more routes (`test_startup_imports.py` pins 88 route pairs, 85 before) and imports the launcher's routes at start-up, a plausible part of it; it was not profiled here. Single readings out of line: the first launch of 5,084 ms (C7, finding 4); a grid of 206.3 ms in the fourth rows launch, above the 100 ms target and inside the 500 ms ceiling (0.1.2 had one such reading, 129.5 ms); and in the extra rows launch, whose harness gate read 5.0%, the highest of the series, a splash of 509.4 ms, 9.4 ms above its target, and a backend ready of 1,621 ms.

## C3. Idle memory in detail

The figure and its reading point are those of 0.1.2 (B2): the private working set of the whole tree, the median of three samples two seconds apart, taken once the backend's working set has dropped by at least 30 MB and 10% and settled, looking from 66 s after HOME ready every 5 s up to a 120 s cap. Every counted launch was read 73.07 to 73.15 s after HOME ready, never at the cap, with the drop seen. The backend's working set read 255.1 to 297.9 MB at HOME ready (394.8 MB in the slow first launch) and 22.8 to 30.4 MB at 66 s. Breakdown medians are informational (`idleBreakdown`).

| Reading | 0.2.0 (n = 9) | 0.1.2, trim on (n = 8, B4) |
| --- | ---: | ---: |
| Whole tree, private working set (the row) | **197.1 MB** (190.0 to 199.4) | 199.0 MB (192.8 to 202.8) |
| Whole tree, private bytes (committed) | 686.6 MB (680.0 to 711.5) | 693.8 MB (678.6 to 713.5) |
| Backend interpreter | 29.7 MB (22.9 to 30.5) | 29.9 MB (23.7 to 30.1) |
| UI tree (WebView2 and its helpers) | 164.4 MB (160.2 to 166.1) | 165.8 MB (160.1 to 169.8) |
| Shell | 4.1 MB | 4.1 MB |
| UI tree by type: renderer, GPU process, browser process, network, storage, crashpad | 80.6, 36.7, 33.5, 9.3, 3.1 and 1.8 MB | 81.1, 36.6, 33.6, 9.2, 3.1 and 1.8 MB |

The breakdown is the 0.1.2 breakdown to within 1.4 MB in every part, so the launcher, the job indicator and the anchor badge add nothing measurable at idle in these launches. The UI tree is far below the 350 MB of the T4 canvas clause (`uiOver350` false in every launch). The memory target of C4 does not act here: these windows are never shown, and a window never shown counts as visible.

## C4. Minimised or hidden: the WebView2 memory target (new in 0.2.0)

When the main window is minimised or hidden, the 0.2.0 shell sets the WebView2 memory usage target to Low, and back to Normal when the window returns; the shell log records each change (`memory_target`, with the level and the window state). A window that has never been shown counts as visible, so the hidden launches of C2 and C3 never set it. The smoke build's simulated minimise hides the WebView2 controller rather than the window, and `smoke.rs` tells the memory target about it.

Four launches, one after another, each with LIVE open and streaming and a 90 s hold, through the harness's own modes (`run.mjs --mode minimise-sim` and `--mode minimise-real`, `--hold-seconds 90 --sample-seconds 30 --real-data`): each mode once on the 0.2.0 smoke exe and once on the 0.1.2 smoke exe of `D:/dev/release/0.1.2` (built from `5153496`, the commit of the tag `desktop-v0.1.2`), which has no memory target. Both shells started the same backend and served the same page from this tree, so the shell is the only difference. The real minimise put the window on screen 2 behind the harness's guard: its frame was inside the second monitor's work area before and after, the only show commands were SW_SHOWMINNOACTIVE and SW_SHOWNOACTIVATE, the foreground window never changed, the watch saw that one expected window and nothing else, and nothing was shown on screen 1. A read-only outside sampler (`D:/dev/v020/tools/minimise-sampler.mjs`) read the tree every 5 s and split it with the harness's own `classifyTree` into backend, UI tree and shell, as private working set and as private bytes, next to the window state (the simulated hide from `smoke-visibility.txt`, the real minimise from the window's iconic flag). The figure is the first sample 60 s or more after the sampler first saw the hidden or minimised state, so 60 to 65 s after the hide. The live stream holds the backend's trim off by design, so the backend sits at about 234 MB in all four and the difference is in the UI tree.

| Reading 60 s after the hide or minimise | Simulated, 0.1.2 shell | Simulated, 0.2.0 shell | Real minimise, 0.1.2 shell | Real minimise, 0.2.0 shell |
| --- | ---: | ---: | ---: | ---: |
| UI tree, private working set | 149.6 MB | **42.7 MB** | 148.9 MB | **83.5 MB** |
| Renderer, GPU process and browser process within it | 68.4, 33.2 and 33.8 MB | 14.2, 5.7 and 15.3 MB | 65.8, 35.0 and 33.7 MB | 48.7, 11.8 and 15.6 MB |
| UI tree, private bytes | 260.4 MB | 260.9 MB | 252.4 MB | 250.6 MB |
| Whole tree, private working set | 387.4 MB | 280.3 MB | 388.2 MB | 321.4 MB |
| Backend, private working set | 233.7 MB | 233.5 MB | 235.1 MB | 233.7 MB |
| `memory_target` in the shell log | none (0.1.2 has none) | low on the hide, normal on the show | none | low (minimised) on the minimise, normal on the restore |
| Stream back in stream mode after the restore (ceiling 30,000 ms) | 1 ms | 1 ms | 1 ms | 0 ms |
| Harness record, 60 s CPU gate | accepted, 5.2% | accepted, 4.5% | accepted, 4.3% | accepted, 4.8% |

Against the 0.1.2 shell at the same point, the Low target takes 106.9 MB (72%) off the UI tree's private working set in the simulated hide and 65.4 MB (44%) in the real minimise. Like the backend's trim it lowers the working set, not the committed memory: the UI tree's private bytes are equal within 2 MB. The 0.2.0 series moves in steps rather than settling once: in the simulated hide the UI tree fell from 194.6 to 98.0 MB in the first 5 s, to 15.2 MB 30 s in, and was back at 42.7 MB by 60 s while LIVE kept streaming; in the real minimise it fell from 193.1 to 109.5 MB within 5 s, rose to about 165 MB, fell to 56.2 MB 35 s in and read 83.5 MB at 60 s. The 0.1.2 shell drifted from about 200 to 149 MB in both modes. The real minimise falls less than the simulated hide: in a smoke build the page reported `visible` all through the real minimise (an observation the harness README records), while the simulated hide also makes the page report `hidden`. After the show, the 0.2.0 UI tree read 72.0 MB 5 s later in the simulated case. These are single launches, not medians, and neither reading has a ceiling of its own; the stream-back check passed in all four. The 0.1.0 simulated minimise (section 7, fixture backend, 30 minute hold) read 287.8 to 296.5 MB for the whole tree; it is not comparable (another backend and hold).

## C5. The job indicator and the trim (informational, not a row)

The 15 s read of the job list in the installed app is not in C2, because the smoke build's backend runs with the runner off. It was checked apart at 07:11 to 07:15 BST, before the slot, on the lab's own backend started alone (`-m nq_terminal` from this tree's backend folder, a temporary state folder, `NQT_JOBS=on`, `NQT_MEMTRIM=1` for the quiet thread of a launcher process, port 8797), after a GET-only warm-up of HOME's reads, with `/api/health` read every 2 s and `/api/jobs` every 15 s for 100 s (`D:/dev/v020/tools/jobspoll-check.mjs`, record `measure-runs/jobspoll-check.json`). The backend tree's private working set fell from 763.8 MB at 61 s to 17.1 MB at 66 s and stayed near 21 MB to the end, with the job list read six times: the trim fired on time. The contrast run was the same with a foreground GET (`/api/data/catalog`) every 15 s besides; it never trimmed (766.7 MB, then 703.0 MB from 76 s to the end, when the prewarm handed memory back), so the check is born failing. Two limits: the backend ran in the browser form (2 GiB bar cache, the year-aligned sparkline), so its figures are larger than the app's; and its job runner was off as well, because only the lab's own backend, on `terminal/state` and holding that folder's lock, runs jobs (`services/jobs.py`, `jobs_refusal`), and the owner's terminal holds that lock. The check therefore covers the poll itself (`GET /api/jobs` is a background read), not a live queue; a queued or running job holds the trim off by design.

## C6. The 30 min partial soak at 0.2.0

The soak ran from 08:31:30 to 09:02:53 BST on the smoke build of `D:/dev/release/0.2.0`, real lab, shipped caps (512 and 128 MiB), trim on, through the harness's `soak` mode with `--hours 0.52`: the samples, one every 5 minutes straight after each workload round, run from 6 s to 30 min (1,802 s). **Label: 30 min partial soak at 0.2.0.** It is not the G2 soak row of record: the 2 h soak of 0.1.0 (section 8) stays the G2 soak evidence, and the all-day soak stays an owner check. The harness wrote its record (`soak/soak-smoke-s01-a1-measure.json`): status accepted, 7 samples, 0 workload errors, 0 new windows, 0 foreground changes and 0 survivors. The CPU load before the block was 4.4%.

| Reading (whole tree) | 0.2.0, 30 min, harness | 0.1.2, 45 min, harness (B6) | Ceiling | Target |
| --- | ---: | ---: | ---: | ---: |
| Largest sample, private working set (the soak row) | **619.9 MB** (the first, at 6 s) | 641.9 MB (at 20 min) | 1,500 MB | 1,000 MB |
| Largest sample from 900 s | 583.3 MB (at 20 min) | | | |
| Last sample | 458.6 MB (at 30 min) | 495.8 MB (at 45 min) | | |
| Median of the samples | 480.5 MB | 510.4 MB | | |
| Private bytes (committed), range | 1,116.5 to 1,324.0 MB | 1,147.7 to 1,355.0 MB | | |
| Private bytes, leak rule | **not evaluated**: 4 settled samples over 900 s, and the rule needs at least 4 over 1,800 s from 900 s, so a 30 min run cannot be judged | pass (24.3 MB an hour, 12.1 MB over the settled window) | | |
| Private bytes from 900 s (descriptive, not the rule) | 1,295.1, 1,319.5, 1,324.0 and 1,300.8 MB: a least-squares slope of 25.9 MB an hour and 5.7 MB from first to last | | | |
| Backend and UI tree, first and last sample | backend 356.4 and 319.9 MB; UI tree 288.8 and 318.2 MB | backend 277.2 and 325.2 MB; UI tree 285.2 and 318.1 MB | | |

The harness samples straight after each round, while the backend has just served the eleven screens, so the soak row is the working set under use. A read-only outside sampler (`soak-outside.jsonl`: the same whole-tree counters once a minute, 32 samples, `D:/dev/v020/tools/minimise-sampler.mjs`) read 224.2 to 276.7 MB of private working set between rounds, which is the trim at work, and 532.3 to 597.1 MB at the minute of each round. Its private bytes between rounds climbed in shrinking steps: 890.3 MB at 2 min, then 922.7, 941.2, 952.0, 957.1 and 960.8 MB at 27 min (+32.4, +18.5, +10.8, +5.1 and +3.7 MB a round), much as on 0.1.2 (B6: about 33 MB in 25 minutes, flattening). 30 minutes cannot say whether that climb stops, so the all-day soak stays the check that decides. Against the 0.1.2 soak the figures are lower or equal everywhere; the start-up sample is the largest here because the first round runs straight after launch.

## C7. Not re-run, findings and evidence

| Item | State |
| --- | --- |
| Measure-artefact rows (backend ready, splash, cold HOME, idle memory) and the smoke against measure agreement | **Pending**: port 8765 was listening (pid 46084). The 0.2.0 measure installer is built in `D:/dev/release/0.2.0` and is not installed. |
| Idle memory and the warm rows with the trim off | Not repeated: the trim is the 0.1.2 trim, and B4 and B5 stand. |
| All-day soak | An owner check. The 30 min soak of C6 is partial, and the 2 h soak of 0.1.0 (section 8) stays the G2 soak evidence. |
| T8, the stage 1 rows, the 20,000-point hop | Not run on 0.2.0. The 0.1.0 readings are history. |
| Installer row of the harness (`installer` mode) | Not run. The release installer of the measuring build is 3,256,218 bytes (3.1 MB against the 30 MB ceiling). |
| A backtest started from the launcher | Not part of G2. The smoke build's runner is off by design, and the runner runs only in the lab's own backend on `terminal/state`, whose lock the owner's terminal held (C5). |
| Owner-attended rows | Pending, as on 0.1.2 (`verdict.md`). |

Findings for the manager:

1. **The release row is unchanged by 0.2.0.** 197.1 MB (190.0 to 199.4) against 199.0 MB on 0.1.2, with the same breakdown within 1.4 MB (backend 29.7 against 29.9 MB, UI tree 164.4 against 165.8 MB, shell 4.1 against 4.1 MB) and the same reading point (73.1 s after HOME ready in every counted launch). The launcher, the job indicator and the anchor badge add nothing measurable at idle.
2. **The memory target works as designed and shows only in the working set** (C4): 42.7 against 149.6 MB for the UI tree 60 s after a simulated hide, 83.5 against 148.9 MB after a real minimise, with the UI tree's private bytes unchanged. Each cell is one launch.
3. **One launch of six in the rows series ended on the shell's stopped page** (`stopped.html#unverified`, shell event `supervise_refused`: "the backend did not answer its identity check in time"). The shell spawned the backend and refused it 4.3 s later; the backend did start (its log has the ready line) but did not answer the identity proof within the shell's 2 s link budget (`LINK_TIMEOUT`, `supervise_run.rs`), and the stopped page then offers its Retry link. It is not counted, and one more rows launch replaced it. No launch of the 0.1.2 or 0.1.1 records ended this way. The cause is not established here; a slow cold start of the backend on this PC is the likeliest, since the launch before and the launch after it were normal. A first-time user would see the stopped page.
4. **One first launch read cold HOME 5,084 ms, above the 5,000 ms ceiling** (first-launch series, launch 1). Backend ready (1,447 ms) and the first paint were normal; HOME's own data took 3,630 ms from navigation against about 1,750 ms in the other launches, and the backend held 394.8 MB at HOME ready against 255.1 to 297.9 MB in the others. Its harness gate read 4.9%, the highest of the series. The fourth first launch read 3,227 ms and the extra rows launch 3,468 ms, so it did not repeat. The median is inside the 3,500 ms target and `report.mjs` accepts the row; the single reading is above the ceiling and belongs beside the median wherever the first launch is quoted.
5. **A quiet slot needs a commit freeze.** A test-only edit of `web/vite.config.ts` made the page build stale, because the stamp compares source times and `vite.config.ts` is one of its inputs; every launch then lands on the rebuild page. The first rows block of this slot was lost that way and repeated (C1).

Evidence (all under `D:/dev/v020`): `measure-runs/reproduce/` (with `reproduce-verdict.json`), `measure-runs/on/rows/rows-smoke-s01-a1-warmup.json` to `rows-smoke-s06-a1-measure.json` (s06 the failed launch), `measure-runs/on/rows-extra/`, `measure-runs/on/first-launch-smoke-1/first-launch-smoke-s01-a1-measure.json` (and `-2`, `-3`, `-4`), `measure-runs/on/t4t5/2026-10-05T07-14-22-057Z-usual-app/usual-s1.json` (and `usual-s2.json`, `usual-s3.json`), `measure-runs/minimise/sim-012/`, `sim-020/`, `real-012/`, `real-020/` with their `.sampler.jsonl`, `measure-runs/jobspoll-check.json`, `measure-runs/soak/soak-smoke-s01-a1-measure.json`, `measure-runs/soak-outside.jsonl`, `measure-runs/aborted-stale-page/` (the stopped block, not counted), `measure-runs/gate-log-new-lines.jsonl`, `measure-runs/report-on.txt`, `report-soak.txt` and their `.json` forms, `measure-runs/cpu-before-blocks.jsonl` (and `cpu-before-blocks-run1.jsonl`), `measure-runs/precheck-before.json`, `precheck-after-final.json`, `measure-chain.log`, `build-release-3.log`, `artefact-check-3.log`, and the tools under `tools/` (`measure.ps1`, `tail.ps1`, `labcheck.ps1`, `stale-check.mjs`, `minimise-sampler.mjs`, `jobspoll-check.mjs`, `facts.mjs`), with the build itself in `D:/dev/release/0.2.0` (`PROVENANCE.json`, `SHA256SUMS`).

## B1. Read this first (release 0.1.2)

- **What 0.1.2 changes for G2.** On Windows the backend now trims its own working set (`backend/nq_terminal/memtrim.py`, `K32EmptyWorkingSet` on its own process). The trim runs once per quiet period, after 60 s in which the backend served no foreground request (it looks every 5 s, and never trims while a request is in flight, a job is queued or running, or the prewarm thread is working). In this tree it also runs when the prewarm's later stage ends, unless a request is in flight then (`TRIM_STAGES` in `backend/nq_terminal/api/home_prewarm.py`). `NQT_MEMTRIM=0` switches all of it off. A trim moves the pages the backend has not touched lately to the standby list: the working set falls and the committed memory (private bytes) does not. The 0.1.2 harness therefore reads the idle row once the backend's working set has dropped, and reads the private bytes beside it (B2).
- **Result.** Idle memory at HOME reads **199.0 MB** (192.8 to 202.8 MB over eight counted launches), inside the 500 MB ceiling and, for the first time, inside the 400 MB target. The private bytes of the whole tree at the same samples are 693.8 MB (678.6 to 713.5 MB); the trim does not lower them. Read at the same point with the trim off (`--memtrim off`), the row is 404.4 MB (401.9 to 405.3 MB) and the private bytes 689.5 MB (683.2 to 715.7 MB). So the trim takes about 205 MB off the counted working set, all of it in the backend (233.5 MB down to 29.9 MB), and leaves the committed memory where it was. The warm rows are no slower with the trim on (B5). Every other re-measured row stayed inside its ceiling, so the automated part of G2 stays passed; the owner-attended rows are pending (`verdict.md`).
- **Not the reading point of 0.1.1.** The 0.1.1 row (477.3 MB) was read at HOME ready plus a 2.5 second idle check. The 0.1.2 harness waits for the backend's working set to drop by at least 30 MB and 10% and to settle, looking from 66 s after HOME ready every 5 s up to a 120 s cap (`desktop/harness/lib/idle-trim.mjs`); every launch here was read at 73 s. The 0.1.1 and 0.1.2 figures are therefore not a like-for-like pair. The comparison that isolates the trim is the trim on against off at the same 73 s point (B4).
- **Tree and builds.** HEAD `31baa144017b626b969dd259ba273d05379c3735`, version 0.1.2 in every file, a clean tree: `git diff HEAD` and the untracked files both hash to the empty sha256 (`e3b0c442...b855`) in every record. The four builds (release, measure, installtest and smoke) were made fresh from this tree by `desktop/scripts/build-release.ps1 -Version 0.1.2 -Force` into the default folder `D:/dev/release/0.1.2` (target folder `D:/dev/targets/release`, 0 failures, the stamp the same before and after) and passed `artefact-check.mjs` (23 files, 3 installers). The release installer of that build is 3,254,722 bytes. The shipped installer is a rebuild after the manager's docs commit, which changes the stamp, so its size and SHA256 are written after the tag.
- **The quiet slot.** `D:/dev/locks/QUIET_MEASURE` and `D:/dev/locks/QUIET` (the second also pauses the QuantPad download runners, which a disk floor had already paused) were created at 04:25:15 BST and removed at 06:02:26, after the soak. Before the slot nothing was building and no backend pytest, Playwright or vitest run was alive; before each block the chain checked again for a pytest session and found none. The slot was set by the manager, not named by the owner.
- **The CPU gate.** The 60 second CPU load read before each block: 5.2% (reproduction), 3.2% (rows, trim on), 3.2, 3.2 and 2.9% (the three first launches), 3.8% (usual launch), 2.9% (rows, trim off) and 3.9% (soak). Every counted launch also sat behind the harness's own 60 second gate at a 10% limit and read 2.9 to 3.4%, so 0 runs were rejected and no figure is PROVISIONAL. GPU load was 7 to 18%.
- **Reproduction first.** The harness code changed in 0.1.2 (digest `1a050eb2...`), so the W0B anchor was reproduced before any row (`run.mjs --mode reproduce --runs 3`): private memory at HOME 167.6 MB (W0B 164.9 MB), after the heavy set 387.0 MB (W0B 369.5 MB, +4.7%), launch to HOME ready 873 ms (W0B 834.5 ms, +4.6%), all within 10%, verdict `reproduced: true`. No figure carries the UNREPRODUCED label. The breakdown's spawn to HOME document read 242 ms against 214 ms, outside its own reference by 28 ms; it is informational and does not gate.
- **Launch conditions.** As in A1: the smoke build with real data, a fresh temporary state folder for every launch except the usual launch, the shipped caps, hidden windows and the harness's clean PATH. The commands, in order: `run.mjs --build smoke --rows all --runs 5 --warmup 1 --real-data --memtrim on`; `run.mjs --first-launch --build smoke` three times; `t4t5.mjs usual-app --runs 3`; `run.mjs --build smoke --rows idle_mem_home,warm_home,eq_warm,reg_warm --runs 3 --warmup 1 --real-data --memtrim off` (a launch reads every row whatever the list says); then the soak (B6). Every launch named the smoke exe of `D:/dev/release/0.1.2`. The window watch showed 0 new windows and 0 foreground changes in every launch, and every teardown left 0 survivors.
- **Port 8765 was listening (pid 46084, the owner's terminal)**, so the measure-artefact real-lab rows were not run. Nothing at that port or in that process was touched.
- **Research gate and lab state.** The read-only lab check before the slot (04:25) and after it (06:03): `jobs.json` sha256 `44CAE38A...` both times, `backtests/output` 139 entries both times, the `terminal/state` listing unchanged (`cache`, `desktop`, `logs`, `release`, `workspaces`, `backend.lock`, `jobs.json`), and `ledger.csv`, `registry.csv` and `oos_openings.json` byte-equal. The gate log grew by 864 lines, all caller `terminal`, all ending at or before 2022-01-01, timestamped 03:31:43 to 04:15:35 UTC, so all inside the run (`measure-runs/gate-log-new-lines.jsonl`). `backend.lock` read present before and after, as on 0.1.1; nothing here created it.
- **Host.** Not freshly booted (up about 61 hours), so the first-launch records say `firstAfterBoot` false.

## B2. How the idle row is read in 0.1.2

The figure is unchanged in kind: the private working set of the whole process tree from the performance counters, the median of three samples two seconds apart, taken before any page row runs. What moved is the moment. The harness reads the backend's working set at HOME ready, then from 66 s (the 60 s quiet period, one 5 s poll and a second of margin) every 5 s, and takes the samples once the backend has dropped by at least 30 MB and 10% from its peak and the last two readings agree, or at the 120 s cap. Each figure carries `trimSeen`, `trimCapped` and `trimWaitedMs`.

| Series | Backend working set at HOME ready | At 66 s | Waited | Capped |
| --- | ---: | ---: | ---: | --- |
| Trim on, rows and first launches (n = 8) | 252.3 to 294.9 MB | 23.4 to 30.1 MB | 73.06 to 73.10 s | never |
| Trim off (n = 3) | 277.5 to 285.2 MB | 233.0 to 234.5 MB | 73.08 to 73.13 s | never |

With the trim off the backend still falls by 44 to 52 MB within the first minute, as the 0.1.0 record showed (section 9: the prewarm's later tasks finish and hand their memory back). That fall clears the harness's 30 MB and 10% threshold, so the trim-off launches were read at the same 73 s as the trim-on launches and both records say `trimSeen` true. The flag means that a drop was seen, not that the trim ran; the trim-off figure is the backend after its own release, the trim-on figure the backend after `K32EmptyWorkingSet`.

## B3. The rows, 0.1.2 against 0.1.1

All readings are the whole-app smoke build, real lab, shipped desktop caps, trim on. "0.1.1" is the A3 reading. Medians, with the counted values or the range beside them.

| Row | Target | Ceiling | 0.1.1 | 0.1.2 median (counted values) | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| Whole-app idle at HOME, private working set (the release row) | 400 MB | 500 MB | 477.3 MB (453.0 to 484.4), read at HOME ready plus 2.5 s | **199.0 MB** (192.8 to 202.8; n = 8: rows series 199.4, 202.8, 192.8, 194.9, 194.3; first-launch series 199.4, 199.6, 198.5), read 73 s after HOME ready | within target |
| The tree's private bytes at the same samples (informational) | | | not recorded for the whole tree | 693.8 MB (678.6 to 713.5; rows 695.0, 707.6, 678.6, 689.2, 692.6; first launch 686.1, 696.1, 713.5) | not a row |
| Cold HOME, first launch, empty state folder | 4,500 ms (usual 3,500) | 5,000 ms | 3,192.5 ms (3,164 to 3,210) | 3,186.5 ms (3,152 to 3,209; n = 8: rows 3,209, 3,196, 3,192, 3,169, 3,167; first-launch mode 3,181, 3,200, 3,152, median 3,181) | within target |
| Cold HOME, usual launch (state filled) | 3,500 ms | 5,000 ms | 2,797 ms | 2,773 ms (2,773, 2,778, 2,753; one priming launch of 3,204 ms not counted; gate 3.2, 3.1, 3.3%) | within target |
| `volmanaged_v0 EQ`, second run of the line | 1,000 ms | 1,500 ms | 38.4 ms | 32.1 ms (39.5, 40.6, 29.5, 29.9, 32.1) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 537.6 ms | 543.1 ms (540.2, 565.7, 533.4, 551.6, 543.1) | within target |
| `REG`, second run of the line | 1,000 ms | 1,500 ms | 56.9 ms | 53.5 ms (57.1, 56.7, 48.7, 52.9, 53.5) | within target |
| Backend ready (informational) | 1,500 ms | 2,500 ms | 1,401.5 ms | 1,397.5 ms (1,376 to 1,410; n = 8) | within target |
| Splash painted (informational) | 500 ms | 1,000 ms | 316.7 ms | 312.7 ms (300.6 to 328.9; n = 8) | within target |
| Grid open (rows series, informational) | 100 ms | 500 ms | 65.9 ms | 63.3 ms (64.5, 62.9, 129.5, 63.3, 62.6) | within target |
| GIP pan and zoom p95 (rows series, informational) | 16.7 ms | 25 ms | 6.2 ms | 6.0 ms (5.6, 6.2, 6.1, 6.0, 5.8) | within target |
| Keystroke to paint p95 (rows series, informational) | 50 ms | 100 ms | 8.3 ms | 8.1 ms (8.1, 8.2, 8.0, 8.2, 8.0) | within target |

`report.mjs` over the trim-on folder reports `idle_mem_home` on the smoke build as 199 MB (192.8 to 202.8, n = 8) and marks it **within-target ACCEPTED**, and cold HOME as 3,186.5 ms (3,152 to 3,209), within target. It prints the private bytes as 695.6 MB beside a working set of 199.3 MB, because it pools every sample of the eight launches; the figure above is the median of each launch's own figure. One grid reading, 129.5 ms in the fourth rows launch, is above the 100 ms target and inside the 500 ms ceiling; the trim-off series has one such reading too (192.4 ms), so it is not tied to the trim. The warm-up launch (idle 199.1 MB, cold HOME 3,254 ms) was not counted.

## B4. Idle memory with the trim on and off

The same build, method and reading point (73 s after HOME ready); only `NQT_MEMTRIM` differs. Breakdown medians are informational (`idleBreakdown`).

| Reading | 0.1.2, trim on (n = 8) | 0.1.2, trim off (n = 3) | 0.1.1 at its own reading point (n = 6) |
| --- | ---: | ---: | ---: |
| Whole tree, private working set (the row) | **199.0 MB** (192.8 to 202.8) | 404.4 MB (401.9 to 405.3) | 477.3 MB (453.0 to 484.4) |
| Whole tree, private bytes (committed) | 693.8 MB (678.6 to 713.5) | 689.5 MB (683.2 to 715.7) | not recorded |
| Backend interpreter | 29.9 MB (23.7 to 30.1) | 233.5 MB (232.9 to 234.5) | 275.6 MB |
| UI tree (WebView2 and its helpers) | 165.8 MB (160.1 to 169.8) | 166.7 MB (165.6 to 166.7) | 195.4 MB |
| Shell | 4.1 MB | 4.1 MB | 4.3 MB |

The trim lowers the counted working set by about 205 MB, and all of it is in the backend; the private bytes are equal within noise (693.8 against 689.5 MB), as the trim's design says they must be. Without the trim the row reads 404.4 MB at the late point, 4.4 MB above the 400 MB target and inside the ceiling. Against 0.1.1, the first 73 MB of the fall (477.3 to 404.4 MB) comes from reading later: the prewarm's memory is handed back (backend 275.6 to 233.5 MB) and the WebView2 tree settles (195.4 to 166.7 MB). The trim takes the next 205 MB. The UI tree is far below the 350 MB of the T4 canvas clause (`uiOver350` false in every launch); its largest parts are the renderer (81.1 MB), the GPU process (36.6 MB) and the browser process (33.6 MB).

## B5. Warm rows with the trim on and off

The page rows run after the idle samples, so with the trim on they start on a trimmed backend and pay for the pages they touch again.

| Row | Ceiling | Trim on (n = 5) | Trim off (n = 3) | Slower with the trim? |
| --- | ---: | --- | --- | --- |
| Warm HOME | 1,500 ms | 543.1 ms (533.4 to 565.7) | 544.3 ms (540.3, 549.5, 544.3) | no |
| `volmanaged_v0 EQ`, second run of the line | 1,500 ms | 32.1 ms (29.5 to 40.6) | 42.3 ms (42.3, 45.3, 40.8) | no |
| `REG`, second run of the line | 1,500 ms | 53.5 ms (48.7 to 57.1) | 56.8 ms (56.8, 59.5, 52.5) | no |
| Cold HOME (first launch, before any trim) | 5,000 ms | 3,192 ms (rows series) | 3,219 ms (3,219, 3,176, 3,231) | not affected |

The trim does not make the warm rows slower: each trim-on median is equal to or below its trim-off median, and the ranges overlap. The rows that run before the idle reading (backend ready, splash, cold HOME) cannot see the trim at all; their trim-off readings (1,419 ms, 320.5 ms and 3,219 ms) sit inside the spread of the trim-on ones.

## B6. The 45 min partial soak at 0.1.2

The soak ran from 05:15:26 to 06:02:26 BST on the smoke build of `D:/dev/release/0.1.2`, real lab, shipped caps (512 and 128 MiB), trim on, through the harness's `soak` mode with `--hours 0.78`: the samples, one every 5 minutes straight after each workload round, run from 5 s to 45 min (2,702 s), which gives the private-bytes rule its 30 minute settled window. **Label: 45 min partial soak at 0.1.2.** It is not the G2 soak row of record: the 2 h soak of 0.1.0 (section 8) stays the G2 soak evidence, and the all-day soak stays an owner check. The harness wrote its record (`soak/soak-smoke-s01-a1-measure.json`): status accepted, 10 samples, 0 workload errors over the 11 lines of each round, 0 new windows, 0 foreground changes and 0 survivors. The CPU load before the block was 3.9%.

| Reading (whole tree) | 0.1.2, 45 min, harness | 0.1.0, 2 h, external sampler (section 8) | Ceiling | Target |
| --- | ---: | ---: | ---: | ---: |
| Largest sample, private working set (the soak row) | **641.9 MB** (at 20 min) | 705.8 MB | 1,500 MB | 1,000 MB |
| First sample | 545.9 MB (at 5 s) | 698.7 MB | | |
| Last sample | 495.8 MB (at 45 min) | 705.8 MB | | |
| Median of the samples | 510.4 MB | 674.8 MB | | |
| Slope of the private working set | -104.5 MB per hour (all samples) | +25.9 MB per hour (last hour) | | |
| Private bytes (committed), range | 1,147.7 to 1,355.0 MB | 2,363.6 to 2,476.2 MB | | |
| Private bytes, leak rule (samples from 900 s) | **pass**: 24.3 MB an hour, 12.1 MB over the settled window (7 samples over 1,800 s; the rule fails a series only above both 30 MB an hour and 50 MB) | not judged | | |
| Backend and UI tree, first and last sample | backend 277.2 and 325.2 MB; UI tree 285.2 and 318.1 MB | | | |

The harness samples straight after each round, while the backend has just served the eleven screens, so the trim has not run at those moments: the soak row is the working set under use. A read-only outside sampler (`soak-outside.jsonl`: the same whole-tree counters, 9 samples, each about 150 s after a round, when the backend had been quiet for more than 60 s) read 230.7 to 286.1 MB of private working set, which is the trim at work between rounds. Its private bytes are lower than the harness's (907.6 to 1,007.3 MB; memory that a round uses is handed back after it) and they still climbed: 974.2 MB at 15 min to 1,007.3 MB at 40 min, in steps of 3.9, 18.6, 2.9, 6.5 and 1.2 MB, about 33 MB in 25 minutes and flattening. The harness's rule passes on its own samples; 45 minutes cannot say whether that climb stops, so the all-day soak stays the check that decides. Against the 0.1.0 soak the private bytes are about 1.1 GB lower, which is the thread caps of 0.1.1. The UI tree read 350.1 MB at 15 min under the workload; the T4 canvas clause is about idle and is not affected.

## B7. Not re-run, findings and evidence

| Item | State |
| --- | --- |
| Measure-artefact rows (backend ready, splash, cold HOME, idle memory) and the smoke against measure agreement | **Pending**: port 8765 was listening (pid 46084). The 0.1.2 measure installer is built in `D:/dev/release/0.1.2` and is not installed. |
| All-day soak | An owner check. The 45 min soak of B6 is partial, and the 2 h soak of 0.1.0 (section 8) stays the G2 soak evidence. |
| Simulated minimise, T8, the stage 1 rows, the 20,000-point hop | Not run on 0.1.2. The 0.1.0 readings are history. |
| Installer row of the harness (`installer` mode) | Not run. The release installer of the measuring build is 3,254,722 bytes (3.1 MB against the 30 MB ceiling). |
| Owner-attended rows | Pending, as on 0.1.1 (`verdict.md`). |

Findings for the manager:

1. **The release row meets its target by a trim of the working set, at a later reading point.** 199.0 MB against 400 MB, with the private bytes at 693.8 MB and unchanged by the trim. The reading point moved from HOME ready plus 2.5 s (0.1.1) to after the drop, 73 s here; read at that point without the trim the row is 404.4 MB. Both facts belong beside the figure wherever it is quoted. Task Manager's memory column shows the same private working set, so the owner will see the lower figure about a minute after the app goes quiet.
2. **The post-prewarm trim stage is still in the tree.** The brief for this re-measure says only the quiet trim exists, but HEAD `31baa14` still names the later prewarm stage in `TRIM_STAGES` (`backend/nq_terminal/api/home_prewarm.py`, line 61) and the prewarm calls the stage hook after it (`services/prewarm.py`). The figures above cannot say which of the two trims ran first: both land before the 66 s look, and the backend log does not carry the memtrim module's INFO lines. If the stage is meant to be gone, the code and the module docstring of `memtrim.py` need the change; the measured figures would not move, because the quiet trim fires before the reading point either way.
3. **`trimSeen` does not mean that the trim ran.** With `NQT_MEMTRIM=0` the backend's own release after the prewarm (44 to 52 MB) clears the harness's drop threshold, so the trim-off records also say `trimSeen` true (B2). The figure still carries `memtrim`, which is the field to read.
4. **One slow grid reading in each series** (129.5 ms with the trim on, 192.4 ms with it off), both above the 100 ms target, inside the 500 ms ceiling and in a launch whose other rows were normal.

Evidence (all under `D:/dev/v012`): `measure-runs/reproduce/`, `measure-runs/on/rows/rows-smoke-s01-a1-warmup.json` to `rows-smoke-s06-a1-measure.json`, `measure-runs/on/first-launch-smoke-1/first-launch-smoke-s01-a1-measure.json` (and `-2`, `-3`), `measure-runs/on/t4t5/2026-10-05T03-59-17-033Z-usual-app/usual-s1.json` (and `usual-s2.json`, `usual-s3.json`), `measure-runs/off/rows/rows-smoke-s01-a1-warmup.json` to `rows-smoke-s04-a1-measure.json`, `measure-runs/soak/soak-smoke-s01-a1-measure.json`, `measure-runs/soak-outside.jsonl`, `measure-runs/gate-log-new-lines.jsonl`, `measure-runs/report-on.txt`, `report-off.txt`, `report-soak.txt` and their `.json` forms, `measure-runs/cpu-before-blocks.jsonl`, `measure-runs/precheck-before.json`, `measure-runs/precheck-after.json`, `build-release.log`, `artefact-check.log`, and the tools `tools/measure.ps1`, `tools/cpu60.mjs`, `tools/labcheck.ps1`, `tools/gatecheck.mjs`, `tools/soak-outside.mjs` and `tools/facts.mjs`, with the build itself in `D:/dev/release/0.1.2` (`PROVENANCE.json`, `SHA256SUMS`).

## A1. Read this first

- **What 0.1.1 is for.** On 0.1.0 the release row whole-app idle memory at HOME read 505.4 MB (median of six launches, ceiling 500 MB, target 400 MB) and varied from 487 to 513 MB between launches. 0.1.1 caps the maths thread pools of the desktop backend server, and this file records the official re-measure of that row and of the rows beside it.
- **Result.** Idle memory at HOME reads **477.3 MB** (453.0 to 484.4 MB over six counted launches), inside the 500 MB ceiling with 15.6 MB of headroom at the worst launch, and still 77.3 MB above the 400 MB target. Every other row that was re-measured stayed inside its ceiling. The automated part of G2 is therefore passed; the owner-attended rows are pending (`verdict.md`).
- **Tree and builds.** Head `656a964` plus the uncommitted version bump to 0.1.1 (tracked diff: `git diff HEAD` sha256 `2ee6d04a2a203f4e1fe725fdb5a685f65fd25561088ee1be6ae535f4a7211361`, plus the untracked `backend/tests/test_release_version.py`); the stamp was the same before and after the builds. The three GNU builds were made fresh from this tree before any measuring by `desktop/scripts/build-release.ps1 -Version 0.1.1 -TargetDir D:/dev/target/nqt/w5c -OutRoot D:/dev/w6/release-m -LogRoot D:/dev/w6/build-logs` (0 failures; the target folder is W5C's incremental one, and all three builds were rebuilt from this tree) and passed `artefact-check.mjs` (17 files, 2 installers). Smoke exe sha256 `88ff116fff5da5c814123f9677042f107d701bad73e3a7307e59613eeacacfdd`. The release installer of that folder is 3,253,511 bytes and the measure installer 3,219,784 bytes; the shipped installer is a rebuild after the manager's commit, so its size and hash are the placeholders of the hand-over and differ from these.
- **The quiet slot.** `D:/dev/locks/QUIET` was created at 16:39:55 and deleted at 16:56:42, after the last launch; the QuantPad runners were not touched. Before starting there was no backend pytest, Playwright, cargo or other build running, and CPU read 2.0 to 3.3%. The slot was set by the manager, not named by the owner.
- **The CPU gate.** Every counted launch sat behind the 60 second CPU gate at a 10% limit. Readings were 3.0 to 3.1% for the rows and first-launch series and 2.9 to 4.9% for the usual launches, so 0 runs were rejected. GPU load was 9 to 15%.
- **Reproduction held.** The harness digest `7148ac0d...` is unchanged since the W5C reproduction, so the rows ran without `--allow-unreproduced` and no figure carries the UNREPRODUCED label.
- **Launch conditions.** Rows ran on the smoke build with real data: `harness rows --build smoke --rows all --runs 3 --warmup 1 --real-data`, then `--first-launch --build smoke` three times, then `t4t5.mjs usual-app --runs 3`. Each launch had a fresh temporary state folder (except the usual launch, as designed), the shipped caps, hidden windows and the harness's clean PATH. The window watch showed 0 new windows and 0 foreground changes in every run, and every teardown left 0 survivors.
- **Port 8765 was listening (pid 46084, the owner's terminal)**, so the harness's real-lab guard would refuse any measure-artefact real-lab launch. Measure-build rows were not run (they are not needed for the smoke rows) and nothing at that port or in that process was touched. A second backend, pid 39464 (`.venv` python, started 2 October), was already running and was left alone.
- **Not run, as instructed.** Soak, minimise and T8. Their 0.1.0 figures stand as history and are not claimed for 0.1.1.
- **Research gate and lab state.** The read-only lab check before and after: `jobs.json` sha256 `44CAE38A...` both times, 0 active jobs, `backtests/output` 229 entries unchanged, the `terminal/state` listing unchanged, and `ledger.csv`, `registry.csv` and `oos_openings.json` byte-equal. The gate log grew by 521 lines, all caller `terminal`, all ending at or before 2022-01-01, timestamped 15:43:29 to 15:56:26 UTC, so all inside the run. `backend.lock` read present-not-held before and after (W5C read it as absent); nothing here created it.
- **Host.** Not freshly booted (up about 2,930 minutes), so the first-launch records say `firstAfterBoot` false, as in W5C.

## A2. What changed in 0.1.1, and why

numpy, scipy (OpenBLAS), OpenMP and Arrow size their worker pools to the logical CPU count when they load, and each worker holds its own private memory. On this 32-thread host the idle backend carried dozens of threads and a large committed arena that the server's small maths (one HOME page of tables and charts) never uses. `backend/nq_terminal/threadcaps.py` now sets `OPENBLAS_NUM_THREADS`, `OMP_NUM_THREADS`, `MKL_NUM_THREADS` and `NUMEXPR_MAX_THREADS` to 2, only where the name is absent so an explicit setting still wins, and `backend/nq_terminal/__main__.py` calls it before the app imports numpy, scipy or pyarrow. The caps stay in the server process: a backtest child gets the allow list of `desktop/envlist.py`, which does not carry these names, so a job still sizes its pools to every core. The change was measured first with an attach driver against a backend serving the real HOME page:

| Backend reading (attach driver) | Before | After |
| --- | ---: | ---: |
| Threads | 68 | 13 |
| Committed private bytes | 1,790 MB | 369 MB |
| Working set, median | 262.6 MB | 246.1 MB |

In short, the backend went from 68 to 13 threads, its committed private bytes from 1,790 to 369 MB and its median working set from 262.6 to 246.1 MB. The attach driver reads the backend alone, long after start-up. The official row below reads the whole app at the harness's reading point (HOME ready plus a 2.5 second idle check). The attach-driver projection for the official row was about 490 MB and had not been measured; the official reading, 477.3 MB, came out about 13 MB lower. The version bump to 0.1.1 is the only other change in the tree (backend `__version__`, the three Tauri configurations, `Cargo.toml` and `Cargo.lock`, the OpenAPI contract with its regenerated hash in `web/src/api`, and `backend/tests/test_release_version.py`).

## A3. The rows, 0.1.1 against 0.1.0

All readings are the whole-app smoke build, real lab, shipped desktop caps (512 MiB bars, 128 MiB files). "0.1.0" is the W5C reading of section 3 (the `report.mjs` pooled median where the row had more than one series, the rows series otherwise). Medians; the range or the counted values are in the next column.

| Row | Target | Ceiling | 0.1.0 (W5C) | 0.1.1 median (counted values) | Verdict |
| --- | ---: | ---: | ---: | --- | --- |
| Whole-app idle at HOME, private working set (the release row) | 400 MB | 500 MB | 505.4 MB (492.4 to 508.4), over | **477.3 MB** (453.0 to 484.4; n = 6: rows series 484.4, 475.4, 482.6; first-launch series 453.0, 479.2, 470.8) | within ceiling, above target |
| Cold HOME, first launch, empty state folder | 4,500 ms (usual 3,500) | 5,000 ms | 3,172.5 ms (3,148 to 3,225) | 3,192.5 ms (3,164 to 3,210; n = 6: rows 3,210, 3,194, 3,201; first-launch mode 3,164, 3,183, 3,191; first-launch mode alone 3,183 ms) | within target |
| Cold HOME, usual launch (state filled) | 3,500 ms | 5,000 ms | 2,750 ms | 2,797 ms (2,829, 2,777, 2,797; one priming launch of 3,243 ms not counted; gate 3.1, 2.9, 4.9%) | within target |
| `volmanaged_v0 EQ`, second run of the line | 1,000 ms | 1,500 ms | 41.3 ms | 38.4 ms (38.4, 33.3, 45.4) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 537.2 ms | 537.6 ms (558.8, 537.6, 534.0) | within target |
| `REG`, second run of the line | 1,000 ms | 1,500 ms | 57 ms | 56.9 ms (60.6, 56.9, 56.6) | within target |
| Backend ready (informational) | 1,500 ms | 2,500 ms | 1,413.5 ms | 1,401.5 ms (1,412, 1,407, 1,396, 1,378, 1,395, 1,412) | within target |
| Splash painted (informational) | 500 ms | 1,000 ms | 321.9 ms | 316.7 ms (301.2, 327.4, 314.8, 309.5, 324.3, 318.5) | within target |
| Grid open (rows series, informational) | 100 ms | 500 ms | 63.3 ms | 65.9 ms (61.5, 65.9, 72.3) | within target |
| GIP pan and zoom p95 (rows series, informational) | 16.7 ms | 25 ms | 6.0 ms | 6.2 ms (5.8, 6.2, 6.4) | within target |
| Keystroke to paint p95 (rows series, informational) | 50 ms | 100 ms | 8.3 ms | 8.3 ms (8.2, 8.3, 8.3) | within target |

`report.mjs` over the folder reports `idle_mem_home` on the smoke build as 477.3 MB (453 to 484.4) and marks it **within-ceiling ACCEPTED**; it reports cold HOME as 3,192.5 ms (3,164 to 3,210), within target. The first launch of the first-launch series reads the same process rows at the same points as the rows series; the warm-up launch of the rows run (idle 488.0 MB, cold HOME 3,413 ms, backend ready 1,533 ms) was not counted.

## A4. Idle memory in detail

The breakdown (informational, `idleBreakdown`), median of the six counted launches, against the 0.1.0 rows series:

| Part of the tree | 0.1.0 (W5C) | 0.1.1 | Note |
| --- | ---: | ---: | --- |
| Backend interpreter | 297.3 MB | 275.6 MB | per launch 280.8, 273.8, 278.7, 253.1, 277.4, 271.1 MB |
| UI tree (WebView2 and its helpers) | 198.2 MB | 195.4 MB | 194.6 to 198.3 MB; renderer 109.4, GPU process 37.9, browser 34.3, network 9.9, storage 3.1, crashpad 1.6 |
| Shell | 4.2 MB | 4.3 MB | 4.1 to 4.3 MB |

The fix moved the backend share, as designed (about 22 MB lower) and nothing else; the UI tree is unchanged and far below the 350 MB of the T4 canvas clause (`uiOver350` false in every run). The whole row is about 28 MB lower than on 0.1.0, and the spread between launches is narrower (453.0 to 484.4 MB against 492.4 to 508.4 MB), so the worst launch now has 15.6 MB of headroom where three of the six 0.1.0 launches were over the ceiling.

**The thread count at the reading point is not the attach driver's 13.** The harness's sampler counts the backend interpreter's threads at the reading point (the median of its samples): 26, 25, 26, 24, 28 and 27 over the six counted launches (range 24 to 28), plus the three threads of the virtual-environment launcher process. That is well below the 68 of the uncapped backend, but it is not 13, because the prewarm workers are still alive at HOME ready plus 2.5 seconds; the attach driver reads long after start-up. The warm-up launch, followed longer, read 17 interpreter threads 33 s after spawn. Interpreter private bytes at the reading point were 398 to 642 MB, mostly 400 to 460 MB (committed, not working set). So the thread figure depends on when it is read, and the 13 should not be quoted as the figure of the official row.

**Why the row is not at the 400 MB target.** The reading point catches the app while the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) are still running; the 0.1.0 record (section 9) showed the whole tree falling to 453.8 MB after an 8 second settle and 388.6 MB after five minutes. The caps lower the part the backend keeps at that moment but do not change when the prewarm runs. The row is reported as the harness reads it, the W0B reading point, unchanged since W5B.

## A5. Not re-run in 0.1.1, and still pending

| Item | State |
| --- | --- |
| Measure-artefact rows (backend ready, splash, cold HOME, idle memory) and the smoke against measure agreement | **Pending**: port 8765 was listening (pid 46084). The 0.1.1 measure installer is built at `D:/dev/w6/release-m/0.1.1` but is not installed. |
| Soak | Not run. The 0.1.0 reading (2 h, PARTIAL, largest sample 705.8 MB, section 8) is history. |
| Simulated minimise, T8 | Not run. The 0.1.0 readings (stream back 0 ms at engine level; 14 of 14 on WebView2 154.0.4258.53) are history. |
| Stage 1 rows (EQ and REG Enter units, eight routes, 20,000-point hop) | Not re-run. The 0.1.0 readings (section 4) are history; the app's own second-run readings for EQ and REG are in A3. |
| Installer row of the harness (`installer` mode) | Not run. The release installer built for the measuring is 3,253,511 bytes (3.1 MB against the 30 MB ceiling), from the build output. |
| Owner-attended rows | Pending, as on 0.1.0 (`verdict.md`). |

`node desktop/harness/report.mjs D:/dev/w6/measure-runs --check` exits 1 only on these missing readings (the four measure rows, the soak, the installer row and both minimise checks), none of them a defect of a measured row; the rows are in `D:/dev/w6/measure-runs/report-check.txt`.

## A6. Checks of the 0.1.1 tree

All release suites were green on their final runs, with no git write:

| Check | Result |
| --- | --- |
| Backend pytest (`-n 16 --dist loadfile`) | 4,155 passed (first run 4,154 passed and 1 load timeout, see below) |
| Crosscheck, strict | PASS 2,495, FAIL 0, SKIP 0 (INFO 104) |
| QA tests | 333 passed |
| Vitest (with the `gen-api --check` step) | 497 files, 7,394 passed, 47 skipped |
| `test:types`, `test:e2e-types` | clean |
| Web build | OK, all bundle budgets met |
| `desktop/scripts/check.ps1` | 29 of 29 steps, 0 failed |
| Harness node tests | 172 passed, 0 failed |
| Playwright e2e, functional chromium | 539 passed |
| e2e offline | 190 passed, 3 skipped (declared skips), 0 failed |
| e2e desktop (one worker, smoke exe from `check.ps1`) | 42 passed |
| e2e perf (one worker) | 3 passed |

One real failure came out of the version bump: `web/src/api/schema.d.ts` and `web/src/api/openapi.sha256` are generated from `contract/openapi.json`, and the bump of `info.version` made the contract hash stale, so the `gen-api --check` step of `pnpm test` failed. It was fixed at the cause with `pnpm gen:api`, which rewrote only the sha256 line of both files. The same change left `web/dist` stale against its sources, which explains two more failures (the first `check.ps1` run failed `test-smoke` with "HOME never became ready", and the desktop e2e could not start, both because the supervisor refuses a stale page build); a fresh `pnpm build` cleared both. The remaining failures were load or invocation noise, not code defects: `test_result_cache_singleflight[seasonality]` timed out at 10 s while pytest ran beside vitest, Playwright and Rust builds and passed on the quiet rerun; one gallery-focus spec failed once under load and passed alone and in the full quiet rerun; and a desktop e2e run with `--workers=8` failed 14 of 42 because the desktop project shares one app window and must run with one worker.

## A7. Findings for the manager, and the evidence

1. **Idle at HOME passes its ceiling and misses its target.** 477.3 MB against 500 MB (target 400 MB). The row is within the ceiling by 22.7 MB at the median and 15.6 MB at the worst launch. Reaching the target needs the prewarm's working memory kept out of the reading window, or an owner decision on the reading point (A4).
2. **The shipped installer is a rebuild.** The builds above used a measuring output folder (`D:/dev/w6/release-m`) and the uncommitted tree. A rebuild after the manager's commit changes the provenance stamp, because the `git diff HEAD` hash will differ, so the installer size and SHA256 of release 0.1.1 are the placeholders of the hand-over, filled after that build.
3. **A cold result cache on the first run.** The version bump changes the backend code stamp, so the first 0.1.1 launch recomputes what 0.1.0 had cached.
4. **Preconditions the commands do not state.** `e2e:desktop` needs a smoke exe in `NQT_SMOKE_EXE` and one worker, and `web/dist` must be rebuilt after any change to web sources; running `check.ps1` at the same time as `pnpm build` or `gen:api` can race on `web/dist`. A bare clone has no `web/dist`, so a CI job needs `pnpm build` first.
5. **The singleflight test has a 10 s wait** that can time out when `-n 16` shares the machine with other heavy runs. It is a load flake, not a regression.
6. **Documents.** The hand-over, the README and the 0.1.0 owner-check templates still name the 0.1.0 installer where they are dated records of 3 October; the current values are in the hand-over, section 2.

Evidence (all under `D:/dev/w6`): `measure-runs/report-check.txt`, `measure-runs/report.json`, `measure-runs/facts.json`, `measure-runs/rows/rows-smoke-s01-a1-warmup.json`, `measure-runs/rows/rows-smoke-s02-a1-measure.json`, `measure-runs/rows/rows-smoke-s03-a1-measure.json`, `measure-runs/rows/rows-smoke-s04-a1-measure.json`, `measure-runs/rows/rows-summary.json`, `measure-runs/first-launch-smoke-1/first-launch-smoke-s01-a1-measure.json` (and `-2`, `-3`), `measure-runs/t4t5/2026-10-04T15-52-48-108Z-usual-app/usual-s1.json` (and `usual-s2.json`, `usual-s3.json`), `measure-runs/backend-threads.jsonl`, `measure-runs/precheck-before.json`, `measure-runs/precheck-after.json`, `measure-runs/gate-log-new-lines.jsonl`, `chain.log`, `build-release.log`, `artefact-check.log`, `release-m/0.1.1/PROVENANCE.json`, `release-m/0.1.1/SHA256SUMS`, `release-m/0.1.1/payload/smoke/nq-lab-terminal.exe`, and the tools `tools/chain.sh`, `tools/backend-sampler.ps1` and `tools/facts.mjs`. The read-only external sampler `backend-sampler.ps1` logged the smoke shell's python descendants once a second for the thread counts; it polls only `Get-Process` and was not running during the gates in any way that mattered.

## The 0.1.0 record (wave W5C, the re-measure after W5B)

Taken on the morning of 4 October 2026 on the owner's PC (host `DESKTOP-FM5O3JM`), after the W5C performance changes. Sections 1 to 14 are the evidence behind the 0.1.0 verdict, which the 0.1.1 verdict in `verdict.md` replaced; they replaced the W5B figures in their turn (the W5B version of this file is in commit `09a660d`; section 13 sets the two side by side). Words such as "this tree", "the verdict" and "the idle row" in sections 1 to 14 mean the 0.1.0 tree and its verdict. Every figure below was read back from a raw record under `D:/dev/w5c/measure-runs` (the folders are named in each section); the exploratory readings that are not rows sit apart in `D:/dev/w5c/explore-runs`. Nothing here was typed from memory.

## 1. Read this first

- **Tree and builds.** Head `dd286fd1c12635f3a2a99abc8ea6f72c67551a7e` plus the W5C tree (committed afterwards as `8122c87`; the tracked diff between the two hashes to the value below): `git diff HEAD` sha256 `34046e2606d8e4d807cd4c236761826b78da1e4857041f0cfe31542b9fd1de6c` and 11 untracked files (harness stamp `dfedc110...7749`), the same for every record of this file; `web/dist/index.html` sha256 `a6dec56c...5655`. The three GNU builds were made fresh from this tree before any measuring by `desktop/scripts/build-release.ps1 -Version 0.1.0 -TargetDir D:\dev\target\nqt\w5c -OutRoot D:\dev\w5c\release-m` (0 failures, the stamp the same before and after) and passed `artefact-check.mjs` (17 files, 2 installers). Smoke exe sha256 `a5e2b6cbc2e5ac54fff007b0749ec2cb5075e2932d10a8b152b178fb6ba52f12`; measure payload `425c41e97eae3b1a7081a1c6f1559ae5439ced2ff201714bb5b9e92684d2d666`; release installer `nq-lab terminal_0.1.0_x64-setup.exe` 3,253,071 bytes; measure installer 3,219,647 bytes.
- **GNU stands in for MSVC.** There is no MSVC measure artefact on this PC; the MSVC agreement stays open.
- **The quiet slot.** The lock `D:/dev/locks/QUIET` was created at 07:14:45 and removed at 09:10:19 local time (BST), after the last timing row; the QuantPad download runners start no new job while it exists. No backend test session, Playwright run, cargo or other build of this wave ran beside any timing row. Every counted run sat behind the 60 second CPU gate (limit 10%): the readings were 2.6 to 4.7% across every series, so **no run was rejected** (0 rejected readings in total) and none is PROVISIONAL by the gate. The slot was set by the manager, not named by the owner, so the stage 1 record keeps its own `provisional: true` for that reason only.
- **GPU load, per run.** Every harness slot carries its GPU reading at the gate and after the run (`gpu.atGate`, `gpu.afterRun`): 8 to 15% utilisation and 2,059 to 2,097 MiB used throughout (the owner's training job was not running). The tools outside the harness (`t4t5.mjs`, the stage 1 script) do not read the GPU; their series ran between harness slots that read 9 to 15%.
- **Reproduction held.** The W0B anchor reproduced first (section 2), so no figure of this file carries the UNREPRODUCED label (W5B's all did).
- **Windows.** No window of any app under test appeared and the foreground never changed because of one, in any run; every harness and tool watch reads clean (0 new windows, 0 foreground changes, 0 foreign notes in the counted runs). Browsers were headless.
- **Backends.** App rows: the real lab through the GNU smoke build (`--lab`, a fresh temporary `--state-dir` per launch, `NQT_JOBS=off`) at the shipped desktop caps (512 MiB bars, 128 MiB files). Stage 1 and the browser comparator: the real backend on port 8797 with its own temporary state folder. The minimise and T8 runs: the fixture backend and the offline demo server.
- **Port 8765 was listening (pid 46084, the owner's terminal) at every check.** The harness's real-lab guard therefore refused every measure-artefact real-lab launch and wrote a pending record naming the reason (section 6). Port 8765 and its process were never touched.
- **Research gate and lab state.** The read-only lab check (kept outside the repository, `D:/dev/w5c/tools`) before the first run and after the last timing row: `jobs.json` sha256 `44CAE38ADB6F6E142C013AC988929B5E12F20363CB82C990A40E77C34B2172D4` both times, no queued or running job, `backtests/output` 229 entries with the same list, `backend.lock` absent, `terminal/state` with the same three entries (`desktop`, `release`, `jobs.json`). The research files `ledger.csv`, `registry.csv` and `oos_openings.json` were byte-equal; the gate log only grew, by lines of caller `terminal` inside the fence (the stage 1 script counted 660 such lines and 0 bad ones; the two real-data smoke runs 67 each). Section 12 has the after-soak check.

## 1a. What changed since W5B, and why

W5B (commit `09a660d`) measured three automated rows over their ceilings: idle at HOME 1,082 MB (ceiling 500 MB, target 400 MB), first launch 5,048 ms (ceiling 5,000 ms, target 4,500 ms) and the soak's first sample 1,577.4 MB (ceiling 1.5 GB, target 1.0 GB). Wave W5C (commit `8122c87`) treated them under roadmap trigger T4 (`docs/desktop/02_decision.md`, 6.5). T4's response is to lower the caps and re-check the route times; the profile showed that what filled the cache, not its size, was the cause, so the caps were deliberately not lowered (section 9, "The cap decision"). The changes:

- MON's two-day sparkline reads only its window in desktop mode instead of keeping a whole 1-minute year per symbol in the bar cache (the main cost of idle memory and of the soak's start-up peak).
- Arrow uses the system memory pool, so freed memory returns to the operating system.
- HOME start-up does only the work HOME shows; heavy imports are warmed afterwards (first launch).
- The audit log is cached as raw bytes plus a compact line index and weighed at its real size.
- The record-watch reader mounts once HOME's own queries are quiet (deferred).
- Harness: whole-tree memory and soak reporting; the e2e specs wait for the watch segment.

| Row | Ceiling | Before (W5B) | After (W5C) | Source |
| --- | ---: | ---: | ---: | --- |
| Idle at HOME | 500 MB | 1,082 MB | **505.4 MB (492.4 to 508.4), over** | `D:/dev/w5c/measure-runs/report.json` |
| First launch, cold HOME | 5,000 ms | 5,048 ms | 3,172.5 ms (3,148 to 3,225) | `D:/dev/w5c/measure-runs/report.json` |
| Soak, first and largest sample | 1,500 MB | 1,577.4 MB (3 h) | 705.8 MB largest, 698.7 MB first (2 h, PARTIAL) | `D:/dev/w5c/measure-runs/soak-outside.jsonl` |

Two of the three rows now pass. The idle row improved by about 580 MB and still sits 5.4 MB over the ceiling on the pooled reading (section 3). The measured build is the committed tree of `8122c87` (finding 8 in section 12).

## 2. Reproduction of the W0B figures (first, as 04 D5.1 asks)

Folder `D:/dev/w5c/measure-runs/reproduce`. The spike shell against the fixture backend on 8800, one warm-up and three counted launches, every gate reading accepted.

| Figure | W0B median (range) | This run, median of 3 | Within |
| --- | ---: | ---: | --- |
| Private memory at HOME | 164.9 MB (159.7 to 168.4) | 164.9 MB (164.7 to 165.3) | yes |
| Private memory after the heavy set | 369.5 MB (363.1 to 375.2) | 370.3 MB (368.1 to 390.0) | yes |
| Launch to HOME ready | 834.5 ms (814 to 892) | 856 ms (844 to 861) | yes, +2.6% |

The verdict reads `reproduced: true`, so the rows below were taken without `--allow-unreproduced`. The breakdown is inside its references too (spawn to the HOME document 235 ms against 214, ready since navigation 609.5 ms against 618.6, first frame 154.2 ms against 140.2).

## 3. The budget rows on the GNU smoke build

Folder `D:/dev/w5c/measure-runs/rows`: the harness's `rows` mode, `--build both --rows all --runs 3 --warmup 1 --real-data`, smoke and measure slots interleaved, one fresh state folder per launch (so every cold HOME is a first launch with an empty state folder). Gate readings 2.7, 2.6 and 2.9%; GPU 9 to 15%. The measure slots were refused by the lab guard (section 6). Three more first-launch readings on the same build come from the harness's first-launch mode, `D:/dev/w5c/measure-runs/first-launch-smoke-1` to `-3` (gate 3.5, 2.8 and 3.0%), which reads the same process rows at the same points.

| Row | Target | Ceiling | Rows series, median (min to max) | First-launch series, median (min to max) | `report.mjs` over the folder (n = 6) | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Backend ready | 1,500 ms | 2,500 ms | 1,402 (1,378 to 1,425) | 1,426 (1,387 to 1,434) | 1,413.5 ms (1,378 to 1,434) | within target |
| Splash (first contentful paint) | 500 ms | 1,000 ms | 313 (311.7 to 346) | 330.7 (307.9 to 342.2) | 321.9 ms (307.9 to 346) | within target |
| Cold HOME, first launch, with data | 3,500 ms (first launch 4,500 ms) | 5,000 ms | 3,167 (3,162 to 3,178) | 3,188 (3,148 to 3,225) | 3,172.5 ms (3,148 to 3,225) | within target |
| Warm HOME | 1,000 ms | 1,500 ms | 537.2 (530.1 to 538.7) | | | within target |
| `volmanaged_v0 EQ`, warm (second run of the line) | 1,000 ms | 1,500 ms | 41.3 (31.2 to 44.5) | | | within target |
| `REG`, warm (second run of the line) | 1,000 ms | 1,500 ms | 57 (56.9 to 57.8) | | | within target |
| Grid open, 8,411 fills | 100 ms | 500 ms | 63.3 (63 to 64.1) | | | within target |
| GIP pan and zoom p95, 20,000 bars | 16.7 ms | 25 ms | 6.0 (5.8 to 6.2) | | | within target |
| Keystroke to paint, p95 | 50 ms | 100 ms | 8.3 (8.2 to 8.3) | | | within target |
| Whole app idle at HOME (private working set) | 400 MB | 500 MB | 497.1 (492.4 to 506.7) | 506.3 (504.4 to 508.4) | **505.4 MB (492.4 to 508.4)** | **over the ceiling on the pooled reading; see below** |
| Installer (`nq-lab terminal_0.1.0_x64-setup.exe`) | 15 MB | 30 MB | 3.1 MB (3,253,071 bytes) | | | within target |

Method (from `desktop/harness/README.md` and `lib/launch-run.mjs`): cold HOME is the page probe's HOME ready mark from the spawn instant; backend ready is spawn to `supervise_checked` in the shell log; splash is first contentful paint over the debugging protocol; idle memory is the whole-tree private working set from the performance counters, the median of three samples two seconds apart, read straight after HOME is ready and a 2.5 second idle check (the W0B reading point), before any page row runs. The GIP row reads a 20,000-bar series the harness tiles from the real response (`barsSynthetic: true`); the 8,411 fills are the real run `nt_dtsmom_v0_lo0`. Every teardown closed gracefully with 0 survivors; the new files appeared only under each launch's own temporary state folder (14 in a rows launch, 11 in a first-launch launch) and none under `terminal/state`. The installer row is the harness's `installer` mode (`D:/dev/w5c/measure-runs/installer`).

**Whole-app idle memory sits on its ceiling.** The rows series alone reads 497.1 MB, 2.9 MB inside the ceiling, but one of its three launches read 506.7 MB, and the three first-launch launches of the same build, taken minutes later by the same method, read 504.4 to 508.4 MB. Four of the six counted launches are above 500 MB, and `report.mjs` over the whole folder, which pools every counted launch of the row, reads **505.4 MB (492.4 to 508.4) and marks the row over its ceiling**. The breakdown (informational, `idleBreakdown`): backend 297.3 MB, UI tree 198.2 MB (renderer 109, GPU process 38, browser 35, network 10.7, storage 3.3, crashpad 1.6), shell 4.2 MB, median of the rows series; the UI tree is far below the 350 MB of the T4 canvas clause (`uiOver350: false` in every run). The reading falls quickly after the reading point: the same build followed for ten minutes (section 9) read 455.2 MB at 9 s, 420.7 MB at 61 s and 388.6 MB at 301 s, and read by the browser comparator's method (an 8 second settle) it is 453.8 MB. The fall is in the backend (297 to 251 MB within about 10 s), which is when the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) finish and the system allocator hands their memory back. The row's reading point is unchanged from W0B and W5B, so the row is reported as the harness reads it.

### The usual launch (state folder already filled), in the app

Folder `D:/dev/w5c/measure-runs/t4t5/2026-10-04T06-33-24-434Z-usual-app` (tool `t4t5.mjs usual-app`, kept outside the repository in `D:/dev/w5c/tools`). One priming launch (cold HOME 3,161 ms, not counted), then three launches on the same state, config and WebView2 folders, a stale `DevToolsActivePort` removed before each: cold HOME 2,750, 2,746 and 2,777 ms, **median 2,750 ms** (gate 2.6, 2.8, 3.3%), within the 3,500 ms target. The shell-log milestones of these records read negative because the reused config folder keeps one log across launches; only the probe's figure is used.

## 4. Stage 1 figures re-taken alone: backend ready, both launches, the eight routes at both caps, EQ and REG

Tool: `docs/desktop/stage1/measure_stage1.mjs --max-rejects 4` (headless Chromium over the real backend on 8797, temporary state, `NQT_JOBS=off`). Folder `D:/dev/w5c/measure-runs/stage1/2026-10-04T06-47-08-881Z`. Every run accepted by the gate (2.6 to 3.5%); the window watch is clean; the research files were byte-equal after the run and the gate log grew by 660 lines, all caller `terminal`, inside the fence; no new entry under `terminal/state`.

| Series | Target | Ceiling | Runs | Median |
| --- | ---: | ---: | --- | ---: |
| Backend ready, browser form | 1,500 ms | 2,500 ms | 1,240; 1,207; 1,209 | 1,209 |
| Backend ready, desktop form | 1,500 ms | 2,500 ms | 1,201; 1,199; 1,223 | 1,201 |
| Cold HOME, first launch (the T3 reading) | 4,500 ms | 5,000 ms (G2); cap 6,000 ms | 2,681; 2,700; 2,865 | 2,700 |
| Cold HOME, usual launch | 3,500 ms | 5,000 ms | 2,439; 2,425; 2,417 | 2,425 |
| Eight routes, worst repeat, browser caps | 100 ms | 300 ms | 8 | 8 |
| Eight routes, worst repeat, desktop caps (512 and 128 MiB) | 100 ms | 300 ms | 12 | 12 |
| `volmanaged_v0 EQ` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 641; 680; 629; 646; 621 | 641 |
| `volmanaged_v0 EQ` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 662; 653; 662; 631; 653 | **653** |
| `REG` Enter, warm, browser caps | 1,000 ms | 1,500 ms | 459; 458; 447; 462; 450 | 458 |
| `REG` Enter, warm, **desktop caps** | 1,000 ms | 1,500 ms | 459; 481; 421; 424; 452 | **452** |

T3 does not fire (`fires: false`): first launch 2,700 ms against the 6,000 ms cap and inside its 4,500 ms target; usual launch 2,425 ms against its W3B median of 3,757 ms and the 4,508 ms regression reference. The DEC1 decision on EQ holds at the shipped caps without raising them: 653 ms against the 1,000 ms target. The route times at the desktop caps are re-checked and the worst repeat is 12 ms (W5B: 73 ms).

## 5. T5: pan and zoom, and the 20,000-point data hop

- **Pan and zoom p95** at 20,000 bars, in the app: 6.0 ms (5.8 to 6.2) against 25 ms (section 3). In the browser budgets (`e2e:perf`, alone, one worker, fixture backend): zoom p95 18.0 ms and pan p95 18.7 ms at 60 frames a second, inside the browser budget. T5 does not fire.
- **Data hop**, in the smoke build over the debugging protocol, real data, desktop caps, folder `D:/dev/w5c/measure-runs/t4t5/2026-10-04T06-45-48-484Z-hop` (gate 2.8%): the page fetches `/api/bars` (`NQ.V.0`, 1-minute, vendor variant, from 2018-01-02, `max_points=20000`) and parses the JSON. The route answers in whole buckets; the largest answer at or under 20,000 points was again **17,097 points (875,675 bytes): first fetch 13.9 ms, warm median 15.2 ms (15.5, 34.4, 14.5, 15.2, 14.0), largest 34.4 ms**, against the 100 ms limit. T5 does not fire.

## 6. The measure artefact: installed fresh, real-lab rows pending

- **Install.** The measure installer of `D:/dev/w5c/release-m/0.1.0` was installed silently with `install-test.ps1`'s flags (`/S /NS /D=`) into the new folder `D:/dev/w5c/measure/app` (inheritance removed first), record `D:/dev/w5c/measure-runs/install-measure.json`: exit 0, files `nq-lab-terminal.exe`, `WebView2Loader.dll`, `uninstall.exe`, 0 new windows, 0 foreground changes. The installed exe (sha256 `ac46c9ff...9171`) differs from the measure payload in 3 bytes only: the bundler's bundle-type marker reads `NSS` in the installed copy and `UNK` in the payload (W5B's installed copy was byte-identical to its payload). The harness seeds the measure build's settings and WebView2 folders per launch under the run folder on D:.
- **Pending.** The harness's lab guard read port 8765 listening (pid 46084) before every measure launch: the four measure slots of the rows run and the measure first-launch record (`D:/dev/w5c/measure-runs/first-launch-measure`) are `pending` with the reason `port 8765 is listening (pid 46084): the owner's terminal is live`, and nothing was started. **Backend ready, splash, cold HOME and idle memory on the measure artefact, and the smoke against measure agreement, stay pending (decision 11).** The very first launch after install on the measure build, as DEC1 defines it, needs the same free lab and is pending with them; the smoke build's first launch with an empty state folder is in section 3.

## 7. Minimise, T8 and the browser budgets

### Simulated minimise with LIVE, at engine level

Folder `D:/dev/w5c/measure-runs/minimise-sim`, gate 4.7%, GPU 9 to 10%, the fixture backend, an 1,800 second hold (30 minutes). The first driver tried, `controller-file` (the smoke build's visibility hook: the harness writes `hidden` or `visible` to `smoke-visibility.txt` in the config folder and the shell calls `put_IsVisible`), hid the WebView2 controller itself: the page reported `hidden` 110 ms after the request and in all 30 minute samples. Over the hold the stream read "live, server events", and at its lifetime "reconnecting: the server ended the stream at its lifetime; the browser resumes after the last event it saw". After the controller was shown again the page read `visible` within 223 ms and **the stream read "live, server events" again with a stream back of 0 ms** against the 30,000 ms ceiling. `engineLevel: true`, `driverEffective: true`, verdict accepted with no problem. Memory over the hold: 325.9 MB in the first minute, 287.8 to 296.5 MB for the rest. This replaces W5B's NOT TESTED reading (page-level override only). The same run was made in W5B release round 3 (folder `D:/dev/d5/runs/w5b3-minimise-sim`, gate 9.4%, `controller-file` driver, `engineLevel: true`, `driverEffective: true`, accepted): stream back in 0 ms against 30,000 ms. Both runs are tested rows within the ceiling; neither is the real minimise. The real minimise and restore stays with the owner's visible run.

### T8, the drift run, once

Folder `D:/dev/w5c/measure-runs/t8`, gate 3.4%, started from the documented command (`node run.mjs --mode t8 --playwright`). The smoke build attached to the offline demo server on 4373, then the desktop Playwright project against it: **14 passed, 0 failed**, WebView2 runtime **154.0.4258.53** (engine `Edg/154.0.4258.53`, registry `pv` 154.0.4258.53), 0 new windows. Clean on this runtime; it says nothing about a later runtime.

### Browser budgets, unchanged

`corepack pnpm run e2e:perf` from `web`, alone, one worker, own output folder `D:/dev/w5c/pw-perf-out` (log `D:/dev/w5c/measure-runs/e2e-perf.log`), after every backend test session of the release check had ended: 3 passed. HOME first render median 611 ms against 1,500 ms; GIP zoom p95 18.0 ms, pan p95 18.7 ms, 0 missed frames; the 8,411-fill grid opens in 66.2 ms against 500 ms (sort 33.0 ms, page 37.2 ms). The release check's own run read 637 ms, 18.1 ms and 62 ms.

## 8. The soak

The soak ran from 11:14 to 13:15 local time (BST) on the smoke build, real lab, shipped caps (512 and 128 MiB), harness `soak` mode started with `--hours 3` and stopped by the manager at 13:20 after 2 h 5 min. **Label: 2 h (harness stopped at 2 h 5 min by the manager; external sampler), PARTIAL, not an all-day run.** The harness record `soak-smoke-s01-a1-measure.json` was never written (the harness holds its samples in memory until the end), so the figures below are the external whole-tree sampler's: `D:/dev/w5c/measure-runs/soak-outside.jsonl`, 25 samples of the app's whole process tree (10 processes, pid 24092 for the shell), one every 5 minutes from 11:15 to 13:15, same method as W5B's outside sampler. Window watch: `D:/dev/w5c/measure-runs/soak/soak-smoke-s01-a1-measure.watch.jsonl` (26 records: 15 new windows and 9 foreground changes, all from other programs while the owner used the PC, 0 in the app's own process tree).

| Reading (whole-tree private working set) | W5C, 2 h | W5B, 3 h (outside sampler) | Ceiling | Target |
| --- | ---: | ---: | ---: | ---: |
| First sample | 698.7 MB | 1,509.8 MB | | |
| Largest sample (the row) | **705.8 MB** (the last, at 2 h) | 1,509.8 MB (the first); 1,577.4 MB by the harness | 1,500 MB | 1,000 MB |
| Smallest sample | 622.8 MB (at 10 min) | | | |
| Median | 674.8 MB | | | |
| Slope over the last hour (12 samples, least squares) | +25.9 MB per hour (674.8 MB at 1 h to 705.8 MB at 2 h) | about 60 to 70 MB over 2 h after minute 45 | | |
| Private bytes (committed), range | 2,363.6 to 2,476.2 MB | 3,285 to 3,622 MB | | |

The row is inside its ceiling and its target. W5B's start-up peak is gone: the first sample is 698.7 MB, not 1.5 GB, because the sparkline no longer fills the bar cache with 1-minute years and the system pool returns freed memory (section 1a). The curve is flat after the first five minutes (698.7 to 624.8 MB), then climbs slowly (+25.9 MB per hour over the last hour); a 2 h run cannot say whether that climb flattens, so the all-day check stays. The sampler's first reading was taken 1 s after it found the app, about a minute after the app started, so the very first minute is not covered. The harness's own samples (workload errors, JavaScript heap, graceful close) are not available for this run. Sources: `D:/dev/w5c/measure-runs/soak-outside.jsonl` and `D:/dev/w5c/measure-runs/soak/soak-smoke-s01-a1-measure.watch.jsonl`.

## 9. T4: memory, and the browser terminal in the same session

Method for the browser terminal: the real backend in its browser form (browser caps, 2 GiB of bars), headless Chromium on HOME with the same four panels settled, an 8 second settle, three samples two seconds apart, the whole-tree private working set of the backend tree plus the browser tree, three runs behind the gate. Two forms were read, one straight after the other: **on equal terms** (`NQT_TWO_DAY_WINDOW=1`, so MON's two-day sparkline reads its exact window as the app does and keeps no 1-minute year), and **the default form** (the year kept, as `start.ps1` runs it every day).

| Tree at HOME, idle | Backend | UI (WebView2 or Chromium) | Shell | Whole tree, median of 3 (range) | Folder under `D:/dev/w5c/measure-runs/t4t5` |
| --- | ---: | ---: | ---: | ---: | --- |
| Browser terminal, equal terms | 232.9 MB | 180.4 MB | | **412.5 MB** (412.2 to 418.2), gate 3.5, 2.7, 2.9% | `2026-10-04T06-37-10-774Z-browser-home-equal-terms` |
| Browser terminal, default form (year kept) | 643.8 MB | 178.1 MB | | **820.4 MB** (819.5 to 832.7), gate 2.9, 2.8, 2.7% | `2026-10-04T06-41-29-712Z-browser-home-year-kept` |
| App, smoke build, the harness reading point (section 3) | 297.3 MB | 198.2 MB | 4.2 MB | **497.1 MB** (rows series); 505.4 MB (492.4 to 508.4) pooled | `../rows`, `../first-launch-smoke-*` |
| App, smoke build, read by the browser method (8 s settle) | 251.4 MB | 198.8 MB | 4.2 MB | **453.8 MB** (452.2 to 455.4), gate 2.7, 2.8, 2.7% | `2026-10-04T07-25-56-252Z-app-home-matched` |

The equal-behaviour citation (D8): the switch `NQT_TWO_DAY_WINDOW` is documented in `backend/nq_terminal/settings.py` ("The browser or launcher backend reads MON's two-day sparkline as the app does (its exact window, no 1m year kept), so the T4 and G2 comparison with the browser terminal's HOME is made on equal terms"); the equal-terms records carry `twoDayWindowSwitch: "1"`, the default-form records `null`.

The app followed for ten minutes after one launch (exploratory, `D:/dev/w5c/explore-runs/2026-10-04T07-14-30-980Z-app-mem`, gate accepted): whole tree 455.2 MB at 9 s, 435.7 at 31 s, 420.7 at 61 s, 420.4 at 121 s, 388.6 at 301 s and 396.8 MB at 601 s; the backend interpreter 248.2 MB at 9 s and 238 MB from 301 s; the WebView2 renderer 112.9 MB at 9 s falling to about 70 to 77 MB.

**T4 re-read (02 section 6.5: "idle above 550 MB or above the browser terminal's HOME in the same session, or a heavy session above 1.5 GB").**

- Above 550 MB: **no.** The app reads 497.1 MB (rows series) and 505.4 MB (492.4 to 508.4) pooled at the harness reading point, 453.8 MB by the browser method.
- Above the browser terminal's HOME in the same session: **against the default form, no** (820.4 MB, the app is about 320 MB lower); **on equal terms, yes** (412.5 MB: the app is 41 MB above it read by the same method, 85 to 93 MB above at the harness reading point). Read by the same method the difference splits into backend +18.5 MB, UI tree +18.4 MB (WebView2 with its GPU process against headless Chromium) and the shell's 4.2 MB. On equal terms this clause of T4 fires.
- A heavy session above 1.5 GB: **no.** The largest whole-tree working set of the 2 h soak is 705.8 MB (section 8) and the minimise hold peaked at 325.9 MB.
- The UI tree alone tops 350 MB idle: **no** (194 to 201 MB in every run), so the canvas backing stores are not the lead.

**The cap decision.** T4's response is to lower the caps and re-check the route times. An exploratory series at a 256 MiB bar cap (`NQT_CACHE_BYTES=268435456`, everything else the same, `D:/dev/w5c/explore-runs/idle-cache256`, gate 2.9, 2.7, 3.1%) read idle 494.1 MB (492.0 to 494.2) against 497.1 and 506.3 MB at 512 MiB: a difference inside the spread of the shipped-cap launches, because the bar cache holds little at HOME since the app stopped keeping the 1-minute year (W5C D1). A series with the prewarm off (`NQT_PREWARM=0`, `D:/dev/w5c/explore-runs/idle-noprewarm`) read 511.1 MB (500.7 to 511.9): without the prewarm HOME's own requests do the same work at the same moment. Lowering the caps therefore does not move the idle row, and the route times at the shipped caps are already re-checked (section 4). **Decision: the caps stay at 512 MiB (bars) and 128 MiB (files).** The profile showed that what filled the cache, not its size, was the cause: MON's two-day sparkline kept a whole 1-minute year per symbol in the bar cache. Commit `8122c87` removes that cost (the sparkline reads only its window in desktop mode) under roadmap trigger T4 (`docs/desktop/02_decision.md`, 6.5), which is the standard of decision 1.4 of `owner_decisions_windows.md`: meet a budget by removing the cost, not by moving the ceiling. With the cost gone a lower cap changes nothing measurable (494.1 MB at 256 MiB against 497.1 and 506.3 MB at 512 MiB), and a lower cap would only evict data the app still reads. The route times at the shipped caps are re-checked in section 4 (worst repeat 12 ms against 300 ms).

## 10. Correctness through the app

| Check | Result |
| --- | --- |
| `crosscheck.served` (`uv run --project terminal/qa python -m crosscheck.served`), the app-launched fixture backend of the new smoke build (`NQT_SMOKE_EXE`) | 8 of 8 routes equal: `runs_compare`, `ledger`, `bootstrap_hypothesis`, `bootstrap_run`, `deflated` and `spa` byte-equal; `two_day` and `seasonality_nq` equal before the gate block, with only `cached` and `reads_this_process` differing (as in W5B); `served: OK`, no window-watch failure |
| `smoke_real.ps1`, browser mode | First run: 16 passed, 2 failed, both on a refused Enter (`ZA_V0 DES` and `NQ GIP 2019-03-14` stayed in the command line marked invalid; `web/e2e/perf/pages.ts` `runLine` presses Enter once and waits 60 s for the line to clear, so an Enter that lands before the command index reaches the page is never repeated; the release check fixed the same race in `p11.spec.ts` only). Second run, nothing changed: **18 passed, smoke run passed**. Both runs: 67 new gate log lines, all caller `terminal` inside [2010-01-01, 2022-01-01), research files unchanged |
| `smoke_real.ps1 -Mode App` on the new smoke build | 5 passed, smoke run passed; the shell log shows a real, own-folders launch; the gate log lines all caller `terminal`, inside the fence |
| Gate log over the whole measuring | only caller `terminal` lines, none after 2021-12-31 (section 1) |

Logs: `D:/dev/w5c/measure-runs/chain2.log` (served, both first smoke runs) and `D:/dev/w5c/measure-runs/smoke-real-browser-2.log`. These runs were not made through `record_green.ps1`: the dated records must be made on the committed tree, because a commit changes the stamp.

## 11. Agreement of the two builds, and the pending list

| Test | State |
| --- | --- |
| Smoke against measure within noise: backend ready, cold HOME, idle memory | **Pending**: no measure run (port 8765 listening) |
| Backend ready, splash, cold HOME and idle memory on the measure artefact, real lab, 3 runs each; the very first launch after install on the measure build | **Pending**: port 8765 listening (decision 11); installed at `D:/dev/w5c/measure/app` |
| All-day soak at the shipped caps | **PARTIAL**: 2 h run (largest 705.8 MB), no harness record; the all-day run stays an owner check |
| Real minimise and restore, stream back within 30 s | Owner-attended (visible run) |
| First launch after a reboot | Owner-attended |
| Keys 16 of 16 plus print, NVDA, Narrator, the real JOBS backtest | Owner-attended |
| T8 drift run | 14 of 14 (WebView2 154.0.4258.53) |
| Dated records and the release check | Not made here: they need the manager's commit (section 10) |

`node desktop/harness/report.mjs D:/dev/w5c/measure-runs --check`: exits 1 with six lines, none a defect of a measured row: the measure build has no reading for backend ready, splash, cold HOME and idle memory (port 8765 listening); the soak row has no reading on the smoke build (the harness record was not written); the real minimise has no reading (owner's visible run). It lists `idle_mem_home` on the smoke build as 505.4 MB (492.4 to 508.4), **over-ceiling**, and the simulated minimise as within ceiling (worst 0 ms against 30,000 ms). The rows are in `D:/dev/w5c/measure-runs/report.json`.

## 12. Findings for the manager (nothing in `terminal/` was changed by the measuring)

1. **Whole-app idle at HOME is 5.4 MB over its 500 MB ceiling on the pooled reading** (505.4 MB over six counted launches; 497.1 MB in the rows series alone, 506.3 MB in the first-launch series). Lowering the caps does not move it (256 MiB bars: 494.1 MB), because the bar cache holds little at HOME now. What does move it is time: the backend falls from about 297 MB to about 251 MB within some 10 s of HOME ready, when the prewarm's later tasks (ledger, deflated Sharpe, EQ bootstrap) finish, and the whole tree reads 453.8 MB by the browser comparator's 8 second settle and 388.6 MB after five minutes. The levers are a backend change that keeps those tasks' working memory out of the HOME window (or lowers their peak), or an owner decision on the reading point (the harness reads at HOME ready plus a 2.5 second idle check, the W0B point; the comparator reads after an 8 second settle). Neither was changed here.
2. **T4 on equal terms fires.** Against the browser terminal on equal terms (412.5 MB) the app is 41 MB higher by the same method: backend +18.5 MB, UI tree +18.4 MB (WebView2 with its GPU process against headless Chromium) and the shell's 4.2 MB. Against the default browser form (820.4 MB) it is about 320 MB lower. Which comparator governs the "no more than the browser terminal's HOME" condition is for the manager and the owner; this file reports both. Headless Chromium is also lighter than the headed browser the owner uses, so the equal-terms comparator is a strict one.
3. **A race in the real-data smoke's driver.** `web/e2e/perf/pages.ts` `runLine` presses Enter once and waits 60 s for the line to clear; an Enter that lands before the command index reaches the page is refused and never repeated (first browser-mode run: `ZA_V0 DES` and `NQ GIP 2019-03-14`). The release check fixed the same race in `p11.spec.ts` by waiting for the command preview; `runLine` needs the same wait. The second run passed 18 of 18.
4. **The installed measure exe is not byte-identical to its payload.** It differs in the 3-byte bundle-type marker (`NSS` installed, `UNK` in `payload/measure`), so a check that compares the installed exe with the payload hash fails on this build (W5B's pair was identical). Nothing measured depends on it; `build-release.ps1` should copy the payload after the bundler has marked the exe, or the check should compare with the marker masked.
5. **`report.mjs` pools every counted record under the folder it is given**, at any depth, so exploratory series must not sit under the evidence folder (they were moved to `D:/dev/w5c/explore-runs` before the final check).
6. **The soak harness did not write its record.** The first soak (`D:/dev/w5c/measure-runs/soak-aborted-2h`, outside sampler only, 24 samples from 09:13, first 606.3 MB, last 644.3 MB at 6,925 s) was cut short by the measuring session's own two-hour limit on a background command. The soak of record was started detached with `--hours 3` and stopped by the manager at 13:20 after 2 h 5 min, because 2 h was the planned length, so its harness record was not written either (the harness keeps its samples in memory until the end). The row rests on the external sampler (`soak-outside.jsonl`, 25 samples). The soak mode would be more robust if it appended each sample to its record as it is taken.
7. **Measure-artefact rows.** When 8765 is free, run `node desktop/harness/run.mjs --build measure --rows backend_ready,splash_painted,cold_home,idle_mem_home --runs 3 --real-data --measure-exe D:/dev/w5c/measure/app/nq-lab-terminal.exe` from `terminal` (the harness's lab guard checks the lab itself), then the smoke and measure agreement in `report.mjs`; the very first launch after install on the measure build needs the same free lab.
8. **The figures in the commit message of `8122c87` come from an earlier build of this tree and are not the measure of record.** Its spot readings (idle 451.6 MB median, first launch about 3,200 ms; `D:/dev/w5c/spot/rows-real`, three launches, taken at 05:51 to 05:54 on a build stamped `diffSha256` `7301e032...`) predate the build measured here (`diffSha256` `34046e26...`, built at 07:15). The tracked diff from `dd286fd` to `8122c87` hashes to `34046e26...`, the stamp of every record in this file, so the measured build is the committed tree. On it idle reads 505.4 MB, not 451.6 MB. The first-launch figure agrees (spot 3,201 ms median, measured 3,172.5 ms). Why the later build reads about 50 MB higher at the same reading point is not established here.

## 13. W5B against W5C

| Row | Ceiling | W5B (3 to 4 October) | W5C (4 October) |
| --- | ---: | ---: | ---: |
| Backend ready | 2,500 ms | 1,378 ms | 1,402 ms (rows), 1,413.5 ms (1,378 to 1,434) pooled |
| Splash | 1,000 ms | 308 ms | 313 ms |
| Cold HOME, first launch | 5,000 ms | **5,048 ms** (over) | 3,167 ms (rows), 3,172.5 ms (3,148 to 3,225) pooled |
| Cold HOME, usual launch | 5,000 ms | 3,321 ms | 2,750 ms |
| Warm HOME | 1,500 ms | 652 ms | 537.2 ms |
| EQ, warm, Enter unit, desktop caps (stage 1) | 1,500 ms | 628 ms | 653 ms |
| REG, warm, Enter unit, desktop caps (stage 1) | 1,500 ms | 427 ms | 452 ms |
| Eight routes, worst repeat, desktop caps | 300 ms | 73 ms | 12 ms |
| Grid open, 8,411 fills | 500 ms | 132 ms | 63.3 ms |
| GIP pan and zoom p95 | 25 ms | 6.4 ms | 6.0 ms |
| Keystroke to paint p95 | 100 ms | 8.2 ms | 8.3 ms |
| 20,000-point hop (17,097 points), warm median | 100 ms | 14.9 ms | 15.2 ms |
| Whole app idle at HOME | 500 MB | **1,082 MB** (over) | **497.1 MB** (rows), **505.4 MB (492.4 to 508.4)** pooled (over) |
| Browser terminal at HOME, same session | | 918 MB (year kept) | 820.4 MB (year kept); 412.5 MB (equal terms) |
| Soak, largest sample | 1,500 MB | **1,577.4 MB** (over, 3 h) | **705.8 MB** (within, 2 h, PARTIAL, external sampler; first sample 698.7 MB) |
| Simulated minimise, stream back | 30,000 ms | not tested | 0 ms, engine level |
| T8 | clean | 14 of 14 | 14 of 14 |
| Installer | 30 MB | 3.1 MB | 3.1 MB |

## 14. What changed in the world during the run

During the measuring nothing in `terminal/` was edited; the tree's stamp is the same in every record. The tools of this wave are outside the repository in `D:/dev/w5c/tools`: `t4t5.mjs` (a copy of the W5B tool with the output folder moved and an `app-home` mode added that reads the app by the browser method), `reinstall-measure.mjs` (the install), the read-only lab check, `chain1.sh`, `chain2.sh`, `explore.sh`, `soak-sampler.mjs` (the outside soak sampler) and `facts.mjs` (prints every figure above from the raw files into `D:/dev/w5c/measure-runs/facts.json`). C: free space 96,706 MB at the start and 96,693 MB after the timing rows; every output of this wave is on D:.
