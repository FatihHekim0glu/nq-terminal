# D1 numbers: backend ready, the eight slow routes and the HOME prewarm (wave W1B)

Taken on 2 October 2026 against the real backend on port 8797 (never 8765) and the real lab data, first between 13:30 and 14:05 local time and then again by the release check between 15:25 and 15:37 on the final tree, after the review fixes (the gate block of a hit, the price-free persistence, the first-paint prewarm list). The figures below are the release check's; the first set is in the raw records under `D:\dev\spikes\w1b\`, the second under `D:\dev\spikes\w1b\rc\`. D1's exit criteria (04, phase D1) are judged against these figures; the W0B baseline is `../baseline/backend_ready.md`.

## Verdict against the D1 exit criteria

| Criterion (04 D1 exit) | Target | Ceiling | Measured | Result |
|---|---|---|---|---|
| Backend ready, median of 3, quiet machine | 1.5 s | 2.5 s | **1,061 ms** (1,066, 1,061, 1,059); the first set gave 1,042 ms and, with the prewarm switched on, 1,044 ms | met; T3 does not fire |
| Repeat calls to the eight routes on real data | 100 ms | 300 ms | **1 to 6 ms** (three repeats of each, all eight) | met |
| Real-data EQ and REG warm | 1,000 ms | 1,500 ms (held at the D3 exit) | screen settle, median of 5, warm backend, headless Chromium on the page the backend serves: **EQ 412 ms** (412, 416, 481, 411, 412), **REG 223 ms** (272, 209, 214, 223, 229); first open on a cold backend 4,741 and 835 ms | met against the target; the ceiling check stays with D3 |
| Browser budgets unchanged | HOME 1,500 ms, grid 500 ms, shell 114.9 kB gzip | | HOME 614 ms (fixture), 643 ms (real data); fills grid open 46 ms, sort 26 ms, page 34 ms (fixture) and 80, 32, 66 ms (real data); shell 109.5 kB gzip | met |
| All automated checks green; four research files unchanged | | | see Checks | met |

Backend ready is 505 ms under the W0B baseline of 1,566 ms (32% lower) and 439 ms under the 1.5 s target.

## Release check 2: fixes and re-run (2 October 2026, 16:02 to 17:20 local time)

Two release-check findings were answered, then the whole checklist and the measurements were run again on the same tree.

1. **The system drive.** The stop rule counts a drop of 100 MB or more, and the first release check saw 361 MB. The cause inside this wave was the Playwright runs: each builds the app into `web\node_modules\.tmp\e2e-<kind>-<port>` and nothing removed it, so every run on a new port left about 9 MB behind (20 stale folders, 176 MB, were there). A global teardown (`web/scripts/e2eTeardown.ts`, registered in both Playwright configs, born-failing tests in `web/scripts/e2eTeardown.test.ts`) now removes the run's own folders, and refuses any path that is not `node_modules/.tmp/e2e-*`. The 20 stale folders were removed once. After the full e2e, perf and offline runs `node_modules/.tmp` held no `e2e-*` build folder. The terminal tree's own writes in this check were 28 MB (rebuilt page folders and replaced dumps) plus 2.6 MB of gate log lines, against 176 MB removed, so the wave's net effect on the drive is a reduction. The whole-drive figure still fell, from 123,845 MB (16:02) to 122,906 MB (17:20), a drop of 939 MB, and none of that was written by this wave: a scan of files changed in the window found the desktop VM disk of the build harness (8.8 GB file, rewritten), game-capture clips under the user's temp folder (about 900 MB in three files written during the window), the session transcript (169 MB) and a recorder log of another tool. The drive has 122 GB free. The stop rule as worded (whole-drive drop) cannot tell those writers from the wave's own, so this record reports the wave's own writes (net negative) and leaves the wording of the rule to the owner.
2. **Eight of eight byte-equal.** Six routes are byte-equal to a cold computation (compare, ledger, both bootstraps, deflated, spa). Two-day and seasonality end with a gate block that reports the process, so a hit differs from the cold body by the one byte of `cached` false to true and is byte-equal to a repeat computation made with the cache off. That is the reviewed design (a hit must never hide that reads were made by the process), and it is now written into the exit criteria of 04 and the cache rules of 03, so the wording and the behaviour agree. The pinning tests are `test_result_cache_gate.py` and `test_result_cache_routes.py`.

Re-run results on the final tree:

| Check | Result |
|---|---|
| Backend suite | 3,272 passed, 1 skipped, 0 failed (469 s) |
| QA tests; `crosscheck --strict` | 299 passed; PASS 2,495, FAIL 0, SKIP 0, INFO 104 |
| `test:types`, `test:e2e-types`, `build` | clean; shell 109.5 kB gzip of 114.9 kB |
| Vitest | 468 files, 6,936 passed, 45 skipped (the teardown test file adds 1 file and 6 tests) |
| e2e | 387 passed (13.9 min, 2 workers, ports 8953 and 4953, own output folder) |
| e2e:perf (alone) | 3 passed; HOME median 680 ms (budget 1,500), fills grid open 72 ms, sort 35 ms, page 58 ms (budget 500) |
| e2e:offline | 188 passed, 1 skipped, 0 failed |
| `smoke_real.ps1` | passed on the third attempt: 18 tests, 67 new log lines, all caller `terminal` and inside the fence. The first two attempts each failed one test with `net::ERR_NO_BUFFER_SPACE` on a single loopback request; at that time 2,600 sockets sat in TIME_WAIT on the game's own web-map port 8111 (a recorder polls it) on top of the run's own, and the third attempt, started with none of this run's ports in TIME_WAIT, passed. The cause is outside the wave; the tests failed on the client socket, not on a served number |
| Research files | `ledger.csv`, `registry.csv`, `oos_openings.json` byte-identical; `oos_access_log.jsonl` append-only, every new line caller `terminal` |
| `terminal\state` | only the original `jobs.json`; nothing created |
| Owner's 8765 backend | owning pid 46084 before and after, untouched |

Measurements, same method as below, real backend on 8797 (raw records `D:\dev\spikes\w1b\rc2\`). **The machine was not quiet:** the owner was running a game, the 60-second CPU gate read 7.5 to 14.1% and rejected 8 backend-ready attempts, so the figures marked PROVISIONAL were taken above the 10% limit (manager decision 2) and are kept for a quiet-window re-measure. Both timings are still inside the targets.

| Measurement | Result | Gate | Label |
|---|---|---|---|
| Backend ready, median of 3 (target 1.5 s, ceiling 2.5 s) | **1,162 ms** (1,220, 1,167, 1,156) | 11.3%, 10.0%, 8.6% | PROVISIONAL (one run above the limit after 5 attempts) |
| Eight routes, repeat calls (target 100 ms, ceiling 300 ms) | **1 to 7 ms** (compare 2, ledger 7, two-day 2, hypothesis bootstrap 1, run bootstrap 1, deflated 2, seasonality 2, spa 2) | 7.5% | ACCEPTED |
| Eight routes, cold | compare 642, ledger 2,498, two-day 672, hypothesis bootstrap 1,046, run bootstrap 1,041, deflated 1,296, seasonality 1,498, spa 2,457 ms | 7.5% | ACCEPTED |
| Disk hit after a restart | ledger 14 ms, deflated 12 ms; the other six recompute (memory only by design); all eight restart bodies byte-equal to the first process | 7.5% | ACCEPTED |
| Real-data EQ warm, median of 5 (target 1,000 ms) | **492 ms** (492, 461, 473, 494, 524); first open 5,967 ms | 14.1% | PROVISIONAL |
| Real-data REG warm, median of 5 | **251 ms** (244, 252, 250, 251, 303); first open 932 ms | 14.1% | PROVISIONAL |
| HOME burst, fresh state, prewarm off and on, no head start | 5,399 and 5,620 ms; 54 gate lines each, all caller `terminal` | 7.5% | ACCEPTED |

The first EQ attempt of this set timed out in the script, not the app: the command was pressed before the command list had loaded under load, so the screen never opened. The screens were measured again alone and that run is the one reported. The window watch saw 0 new windows and 0 foreground changes in the backend-ready and routes runs.

## Method

- **Backend.** `C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe -E -s -X utf8 -m nq_terminal`, working directory `terminal\backend`, started hidden (CREATE_NO_WINDOW), real files (not fixture mode), port 8797. `NQT_STATE_DIR` a fresh folder under `D:\dev\tmp`; `NQT_JOBS` unset for the route timings (the eight routes start no job) and `off` in the W0B-style ready runs; the IB settings blanked; `NQT_PREWARM`, `NQT_DESKTOP` unset unless a row says otherwise. Stopped one creation-time-checked pid at a time; 0 survivors and port 8797 closed after every run.
- **Backend ready.** The W0B script unchanged (`D:\dev\spikes\t2\runs\backend_ready.mjs`, `--runs 3`): process start to the first 200 from `/api/health`, polled every 10 ms.
- **Routes.** Per route four calls on one backend: the first is cold (empty memory, empty state folder), the next three are repeats; wall time of the whole response including the body, measured in Node. Then the backend is stopped and started again on the same state folder, and each route is called once (the restart column). Bodies are compared by sha256: six of the eight repeats are byte-equal to the cold body. The two that end with a gate block (two-day and seasonality) differ from it in that block alone: `cached` goes from false to true (the repeat is one byte shorter), which is what a repeat computation made after another gated read says as well (03 section 15.2, `test_result_cache_gate.py`). All eight restart bodies are byte-equal to the first process's body. Queries: `runs/compare?ids=nt_dtsmom_v0_lo0,nt_dtsmom_v0_lo1`, `/api/ledger`, `/api/market/two-day` (all 27 symbols), `hypothesis/volmanaged_v0/bootstrap?cost=1`, `run/nt_dtsmom_v0_lo0/bootstrap`, `/api/analytics/deflated`, `/api/seasonality/instrument/NQ`, `/api/analytics/spa`.
- **HOME burst.** The 25 requests HOME makes that touch the cached or price-reading code, all sent at once after an optional head start, as a page would: the 19 single-symbol two-day requests of the rows MON shows at first paint (`?symbols=<root>.V.0`, the page's own keys), the universe window 252, GP bars NQ 1d, the EQ panel, EQ bootstrap, the ledger and deflated; wall time to the last response. Two repeats of each of 8 cells: state fresh (empty state folder) or warm (the two disk entries a previous launch would have left), prewarm off or on (`NQT_PREWARM=1`), head start 0 or 1,000 ms after the backend answers `/api/health`.
- **EQ and REG screen settle.** The backend serves the built page itself (`web\dist`). Headless Chromium (the web package's own Playwright, no window), a fresh browser context per run (empty HTTP cache), 1920x1080, a warm backend: the first open of each screen primes the backend and is reported as the cold figure, then five timed opens. Each open loads the page, waits for the command line, types the screen's line (`volmanaged_v0 EQ`, `REG`) and times from Enter to the screen settled: its panel exists, nothing is loading or aria-busy, the tear sheet figures and charts (EQ) or the populated grid (REG) are present, and two frames have painted. This is the unit the 1,000 ms target and the W0B baseline (2,330 and 1,248 ms) use, in the same page and engine but not in the Tauri window; the shell's own figure is a W5 measurement. Script `D:\dev\spikes\w1b\screens.mjs`. The API-time bursts of the first set (EQ about 105 ms and REG about 28 ms of backend time over request lists that differ from the screens') are superseded by this.
- **CPU gate.** The total CPU load was read for 60 s before every measurement from the OS tick counters (limit 10%, enforced). Every measurement below was taken under the limit (ACCEPTED, 0 rejected, 0 PROVISIONAL). No build, cargo, Playwright or pytest process was alive during the measurements. The machine was not in an owner-named quiet window (O16 was not named for this wave); the gate reading is the evidence of quiet.
- **Window watch.** The global window and foreground watch ran around every measurement: 0 new visible windows, 0 foreground changes.
- **Gate log.** Every price read was served through `nq_lab.data.serve` by the backend: 987 new lines in `results/oos_access_log.jsonl` between the start of the release check and its end (the smoke run and the measurements), all caller `terminal`, all windows inside [2010-01-01, 2022-01-01). The first 7,118 lines are byte-identical to the start of the release check. Nothing was served from the sealed window.

| Measurement | CPU gate, 60 s average (maximum second) |
|---|---|
| Backend ready, prewarm off | 2.6%, 2.4%, 2.7% |
| Eight routes (cold, repeat, restart) | 2.3% |
| HOME burst matrix | 2.8% |
| EQ and REG screen settle | 2.5% |

## Backend ready

| Setting | Runs (ms) | Median |
|---|---|---|
| W0B baseline (before D1) | 1,595, 1,560, 1,566 | 1,566 |
| D1, prewarm off, first set | 1,046, 1,038, 1,042 | 1,042 |
| D1, `NQT_PREWARM=1`, first set | 1,063, 1,021, 1,044 | 1,044 |
| D1, prewarm off, release check | 1,066, 1,061, 1,059 | **1,061** |

The prewarm starts after the listening port is bound, so it does not lengthen backend ready (1,044 against 1,042 ms in the first set is inside the run to run spread of 42 ms). The saving over W0B is the lazy imports of stage A (no `scipy.stats`, no `nautilus_trader`, no `nq_lab.oos_gate` at start).

## The eight routes on real data

| Route | Cold (ms) | Repeats (ms) | After a restart (ms) | Body bytes | Served from |
|---|---|---|---|---|---|
| `/api/runs/compare` | 588 | 1, 1, 2 | 646 | 138,857 | memory only |
| `/api/ledger` | 2,153 | 6, 5, 5 | **13** | 10,401 | memory, and disk after a restart |
| `/api/market/two-day` | 563 | 2, 2, 2 | 600 | 26,142 (repeat 26,141) | memory only (it reads prices) |
| `hypothesis/{name}/bootstrap` | 873 | 1, 1, 1 | 865 | 35,593 | memory only |
| `run/{run_id}/bootstrap` | 844 | 1, 1, 1 | 829 | 36,662 | memory only |
| `/api/analytics/deflated` | 1,159 | 2, 1, 2 | **10** | 19,004 | memory, and disk after a restart |
| `/api/seasonality/instrument/NQ` | 1,237 | 2, 1, 1 | 1,214 | 9,447 (repeat 9,446) | memory only |
| `/api/analytics/spa` | 2,075 | 2, 1, 1 | 2,415 | 19,842 | memory only |

Only the two routes on the disk allow list (deflated and ledger) come back from disk after a restart, and they come back in 10 to 13 ms instead of 1.2 and 2.2 s, byte-equal to the first process. The other six recompute after a restart by design: they read prices or are not on the allow list, and nothing price-derived is stored on disk. After the first process the state folder held exactly two files, `cache\<digest>.bin` for deflated and for the ledger. The two-day and seasonality repeats are one byte shorter than the cold body because their gate block then says `cached` true; nothing else in the body moves.

## HOME burst, wall time to the last response (ms; two runs per cell)

Measured with the requests the page sends: 19 single-symbol two-day requests (the rows MON shows at first paint on the 2x2 HOME at 1920x1080, `HOME_MON_ROWS`) next to the other six reads. The prewarm warms those same 19 keys.

| State | Prewarm | Head start 0 ms | Head start 1,000 ms |
|---|---|---|---|
| Fresh (first launch) | off | 5,672, 5,299 | 5,361, 5,327 |
| Fresh | on | 5,348, 5,734 | **4,854, 4,535** |
| Warm (disk entries present) | off | 2,427, 2,677 | 2,721, 2,617 |
| Warm | on | 2,561, 2,212 | **1,093, 1,099** |

What this shows:

1. The prewarm helps only as far as it has a head start before the page asks: with no head start it gives nothing (the page's requests and the prewarm tasks share one interpreter and finish together), and with 1,000 ms it saves about 0.7 s on a first launch (5.3 to 4.7 s) and about 1.5 s with the disk entries present (2.7 to 1.1 s). The desktop shell's splash and page load supply that head start; that part is measured in W5, not here.
2. With the disk entries present and a head start, the HOME burst is 1.1 s against 5.3 s on a fresh first launch with the prewarm off, because the ledger and deflated (3.3 s together on a cold backend) come back in about 10 ms each and the 19 two-day reads are already in memory.
3. **The disk entries are now written under HOME's own load**: 2 cache files after every one of the 8 cells, fresh ones included (the first set of measurements, before the price-free rule, left 0 files after every fresh cell). Deflated and the ledger read no prices, so their computations ignore price reads made elsewhere in the process; their own recorder still keeps one off disk if it reads a gated frame itself.
4. A first launch costs about 5 s of HOME API time after ready (19 separate 1m reads for the two-day cells, the universe window, the EQ panel). The single request for all 27 symbols that the first set used was 4.7 s; the page's real pattern costs a little more because each cell reads its own symbol.

## EQ and REG, real data, screen settle (ms)

| Screen | First open on a cold backend | Warm runs (5) | Warm median | Target |
|---|---|---|---|---|
| `volmanaged_v0 EQ` | 4,741 | 412, 416, 481, 411, 412 | **412** | 1,000 |
| `REG` | 835 | 272, 209, 214, 223, 229 | **223** | 1,000 |

Both warm medians are under the 1,000 ms target (the W0B baseline was 2,330 and 1,248 ms before the result cache and the lazy imports). The cold figure for EQ is the bootstrap and the tear sheet computing for the first time; after the first open it is a cache hit for the bootstrap and the tear sheet itself recomputes in about 100 ms. Measured in headless Chromium against the page the real backend serves; the same figure in the Tauri window is a W5 reading. The first open on the cold backend added no gate line (the EQ and REG screens read result files, not prices). The window watch saw 0 new windows and 0 foreground changes. Raw record `D:\dev\spikes\w1b\rc\screens\screens.json`.

From the real-data smoke run (page side, CDP): HOME on a cold backend settled at 4,743 ms after navigation (the slowest request was the EQ panel at 4,694 ms), and HOME with a warm backend settled at a median of 643 ms (730, 622, 643).

## T3

Backend ready is 1,061 ms, below the 2.5 s ceiling and below the 1.5 s target. T3 does not fire. The chain does not stop for T3.

## Checks of this wave (release check, final tree)

| Check | Result |
|---|---|
| Backend suite | 3,263 passed, 1 skipped, 0 failed (3,264 collected; W1A: 3,096 passed, 1 skipped) |
| QA tests | 299 passed |
| `crosscheck --strict` | PASS 2,495, FAIL 0, SKIP 0, INFO 104 (baseline PASS 2,455: 40 new rows for the cached routes); the cached take of the two gated routes is compared with a repeat take made with the cache off, the restart take with the fresh one |
| `test:types`, `test:e2e-types`, `build` | clean; shell 109.5 kB gzip of 114.9 kB, every library chunk within its limit |
| Vitest | 467 files, 6,930 passed, 45 skipped |
| e2e | 387 passed (11.2 min, 2 workers) |
| e2e:perf (alone) | 3 passed (HOME median 614 ms, GIP pan 59.5 fps and zoom 60.0 fps, 0 missed frames, grid under 50 ms) |
| e2e:offline | 188 passed, 1 skipped, 0 failed. The earlier failure (the demo build's RET screen shows "Risk extras not available: not in the demo dataset", an alert the test did not expect) is closed by teaching the test the demo's own refusal: the one alert on that screen must be that text, every other screen must still have none. The demo routes still answer 404 for risk extras, as `routes.test.ts` pins |
| `smoke_real.ps1` | passed: 18 tests, 66 new log lines, all caller `terminal` and inside the fence; ledger, registry, openings files byte-identical |
| `contract/openapi.json` | unchanged (`git status` clean for `contract`); `gen:api --check` passes inside `test` |
| `terminal\state` | no new file or folder (only `jobs.json`, created 1 October 2026 23:15); the fixture backend, the pytest suite and the smoke run all used their own temporary state folders |
| Owner's 8765 backend | listening before and after, owning pid 49476 |
| Research files | `ledger.csv`, `registry.csv`, `oos_openings.json` byte-identical; `oos_access_log.jsonl` append-only (first 7,118 lines identical), new lines all caller `terminal` |
| C: free space | 123,839 MB at the start of the first release check, 123,479 MB after: a drop of 360 MB, of which the terminal tree's own writes are 52 MB (page builds, replaced on each run) and about 206 MB is the session transcript and cost log of the build harness; about 100 MB is not attributed. Release check 2 found the cause inside the wave (Playwright build folders left behind) and fixed it; see above |

## Provenance

Repository head `af2f16458e3a1b0a7077b2ee5bfc7662573351b2`. `git diff HEAD` (without this folder) sha256 `c5cd2c0e175a98b658e8673752419bd784ec3b1ce1102e873c10ec633589416a`. Untracked files (12, without this folder, sorted names and contents) sha256 `4ab32092e24083711a69180735d37e68bfdf762b7f87465c1fe2d3c47eeff020`. Both digests were taken after the last code change of the release check and before this document was last edited. Raw records: the first set under `D:\dev\spikes\w1b\` (`backend-ready`, `backend-ready-prewarm`, `slow-routes`, `home-burst`, `eq-reg`), the release check's under `D:\dev\spikes\w1b\rc\` (`backend-ready`, `slow-routes`, `home-burst`, `screens`), with the scripts `slow_routes.mjs`, `home_burst.mjs`, `eq_reg.mjs` and `screens.mjs` beside them.

## Open items for D1

- **A hit's gate block is current, not frozen.** The two routes that end with a gate block (two-day, seasonality) answer a hit with `cached` true and the reads this process has made so far, as a repeat computation would. If the bar service evicts a frame while the result entry survives, a recomputation would say `cached` false where the hit says true; that is the one known difference, and a single-flight waiter also gets `cached` true while the leader's body says false when the bar cache was cold. The exit criterion "8 of 8 routes byte-equal cached against fresh" is therefore read as: six byte-equal to a cold computation, two equal to it before the gate block and equal to a repeat computation after it. That reading is now written into the exit criteria of 04.
- **The price-free flag is a caller's assertion.** Deflated and the ledger pass `price_free` to the cache, so a price read made in a worker thread inside them would not be seen. They read no prices today; a test pins the flag on both callables, and a future change that gives either a bar service must drop it.
- **The first-paint list is a 1920x1080 figure.** `HOME_MON_ROWS` is 19, the rows MON shows on the 2x2 HOME at that size. A smaller window shows fewer rows (the prewarm reads a few the user never sees); a larger one shows more (the page asks for those itself). The matrix above was measured with those 19 requests.
- **The shell's head start.** With no head start the prewarm gives nothing, and a first launch still costs about 5 s of HOME API time after ready. The shell's real head start, and the EQ and REG settle inside the Tauri window, are W5 measurements.
- **The code stamp covers only `nq_terminal` sources and the version.** It does not cover `nq_lab` or third-party libraries, and if a later packaging step ships bytecode only the stamp falls back to the version, so a release would then need a version bump to invalidate the disk entries.
- **Seasonality, spa, compare, two-day and the bootstraps recompute after every start** (0.6 to 2.4 s each) because they are memory only by design.
