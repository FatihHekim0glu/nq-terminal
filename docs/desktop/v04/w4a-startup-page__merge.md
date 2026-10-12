# Wave w4a-startup-page: merge note

Merged on 12 October 2026 in the worktree `E:/projects/nq-lab/wt-w4a` (branch `v04/w4a-startup-page`, from `9d2cd62` plus the
w1-startup-backend merge `e7eaffd`). Two slices: `page-cache` (cache headers on the page's files, and a preferred desktop port behind
a setting that stays off) and `resident-design` (a design document for owner decision O6, no code). Every timing in this note is
PROVISIONAL: other waves, a QuantPad download and two pytest sessions shared the PC throughout, and the CPU gate read 11.8 to 37.6 %
against its 10 % limit on every counted launch.

## What the merge wired

| Wiring | Where | Test |
| --- | --- | --- |
| The preferred-port record is a fifth sanctioned writer: `PORT_PREF` joins `WRITE_ALLOWED`, and `CONFINED_WRITERS` confines its `write_text` and `os.replace` to names bound by `_record_file(...)` and `_record_temp(...)`. The module docstring's write rule says so. | `backend/tests/test_safety_ast.py` | `test_real_tree_passes[prod]` failed on the two record writes before the wiring (the slice saw the same), passes after. Four new banned cases (an unconfined `write_text`, an `os.replace` to a foreign target, a write beside the confined name, an unconfined write outside the module) and one allowed case (the temp-then-replace form) pin the confinement; the roster test names the five writers and the two confining names. |
| The write allow-list roster in the job-safety test names the fifth writer. | `backend/tests/test_p2_jobs_safety.py` | `test_only_the_service_the_cache_the_lock_the_workspace_store_and_the_port_pref_may_be_on_the_allow_list` (renamed) failed on the new member, passes after. |

No middleware layer, mount, route, model, environment variable or shell file was added by the wave, so the middleware order checked by
`test_route_refusal_walk.py`, the one-plain-StaticFiles-mount rule and the shell's environment are unchanged.

## Fixes to slice files, and why

1. `backend/nq_terminal/desktop/port_pref.py` (page-cache): `backend/tests/test_ib_readonly_ast.py::TestBypassShapes::test_the_real_production_tree_has_no_bypass_shape`
   failed in the first full run: the module imported `socket` (only for the type of the bound socket), and the IB read-only scan allows
   `import socket` in `__main__.py` alone, `desktop/*.py` included. The module no longer imports it: `BoundSocket = Any` stands for the
   socket that `__main__.bind_socket` makes, with a comment saying why. Behaviour is unchanged; the guard was not touched. After the fix
   the 112 slice cases, the IB scan and the safety scan pass (624 passed across those five files).
2. `backend/nq_terminal/desktop/port_pref.py` (release check): `remember()` left `last_port.json.tmp` in the state folder when `os.replace` failed,
   against the module's promise that a write problem leaves nothing behind. It now removes the temporary file and returns False; four new tests
   in `test_port_pref.py` pin the research-folder refusal, both write failures and the start path going on, and two real-process tests check
   that a second real backend reports the same port in `NQT-READY`, in its listening socket and in the record. The two files `port_pref.py` and
   `test_port_pref.py` had been saved with CRLF line endings (the tree is LF, `.gitattributes` stores bytes as written); both were converted to LF.
3. Nothing else in a slice-owned file was changed.

## What was added, for the 03 Appendix A addendum

| Item | Kind | Fate |
| --- | --- | --- |
| `backend/nq_terminal/desktop/port_pref.py` | new module | kept; the preferred desktop port, off by default (O19) |
| `<state>/port_pref.json` | new state-folder file, read only by the backend | kept; written by the owner or by a harness run in its own run folder |
| `<state>/last_port.json` (and its `.tmp`) | new state-folder file, written by the backend | kept; only with the setting on, only when the bound port changed |
| `security.page_cache_control`, `security.is_hashed_asset`, `ASSET_CACHE_CONTROL`, `PAGE_CACHE_CONTROL` | new functions and constants in `security.py` | kept; the rule runs inside `SecurityHeadersMiddleware` |
| `backend/tests/test_asset_cache_headers.py` (54 cases), `backend/tests/test_port_pref.py` (64 cases) | new tests | kept |
| `PORT_PREF` in `test_safety_ast.py` | new constant in a guard test | kept |
| `docs/desktop/v04/resident_backend_design.md` | new design document | kept; the O6 design |
| `docs/desktop/v04/w4a-startup-page__page-cache.md`, `__resident-design.md`, `__merge.md` | notes | kept |
| the resident design's proposed items (`--host`, `--retire`, presence and retire routes, `proof2` and its stamp, `Mismatch::Stamp`, the HKCU Run value, `host.log`, two harness modes) | proposed | proposed, not built; they wait for O6 (see the slice note's addendum table) |

## Checks

All backend commands ran from `C:/Users/Fatih Hekimoglu/nq-lab` with `PYTHONPATH=E:/projects/nq-lab/wt-w4a/backend`; `nq_terminal.__file__` read
back under the worktree. `TEMP` and `TMP` were `D:/dev/tmp/v04-w4a-startup-page-merge`, caches on D:. The web commands ran as
`node node_modules/<tool>` through a junction from `web/node_modules` to `wt-w2a`'s (git-ignored; `pnpm` itself is not used here, as in the w1 merge).

| Check | Result |
| --- | --- |
| `pytest backend/tests -n 3`, HEAVY slot, first run (before fix 1) | 5,133 tests: 5,122 passed, 9 skipped, 2 failed (`test_ib_readonly_ast` on the `socket` import, fixed above; `test_p2_jobs_safety` roster, wired above) |
| second run (after both) | 5,133 tests: 5,129 passed, 3 skipped, 1 failed: `test_desktop_lock.py::test_two_starts_racing_on_a_stale_lock_give_one_backend_and_one_attach`, a 120 s wait for the first `NQT` line of two real backends while the PC was loaded; the file alone then passed (28 of 28) and the one test passed three more times in a row. Not a wave defect: the first run passed it |
| third run (after the A/B, HEAVY slot, 5 min 07 s) | 5,133 tests: 5,130 passed, 3 skipped, 0 failed, 0 errors; the skips are environmental, as in w1. The gatecheck below was read after it and passed again |
| `uv run --project qa python -m crosscheck --strict` | PASS 2,495, FAIL 0, SKIP 0, INFO 104. A first run read PASS 2,135 because three `qa/.dumps/nqt_p11_vcone_*_synthetic.json` files are written by the backend suite and the fresh worktree had none; after the suite ran it was 2,495, the same as `wt-w1` |
| web `gen-api --check`, `tsc -b`, the six `test:e2e-types` projects | contract sha256 `d286ea6a...` in sync; all exit 0 |
| web vitest (524 files, `--maxWorkers=6`) | 7,828 passed, 47 skipped, 1 file failed: `src/vendor/radixPrimitiveStub.test.tsx` ("Denied ID ...cmdk/dist/index.mjs?raw"), the same environment fault the w1 merge recorded (the shared `node_modules` junction points into another tree, outside Vite's `server.fs.strict` root). It includes `src/copy/copyRules.test.ts`: pass |
| `vite build`, `bundleCheck`, `buildStamp` | pass; shell 110.0 of 115.0 kB gzip (unchanged from w1), uplot 22.1 of 30.0, lightweight-charts 61.4 of 75.0, echarts 201.6 of 230.0, tanstack-grid 18.7 of 45.0, perspective 86.1 of 100.0; 213 files in `web/dist` |
| `node --test desktop/harness/tests` | 466 tests, 465 passed, 1 skipped, 0 failed. A first run read 464 passed and 1 failed (`check-preflight.test.mjs`, "a newer test file does not make the dist stale": the preflight said its scratch `web/dist` was missing); that file alone passed twice, and the full rerun passed. The scratch folder is shared by every wave that runs the file, so a concurrent run is the likely cause |
| `node --test desktop/scripts/tests` | 226 passed (with `TEMP` on D:) |
| release re-run after the fixes (12 October, 04:27 to 05:26 UTC, HEAVY slot, `-n 4`) | pytest, second run: 5,139 tests, 5,136 passed, 3 skipped, 0 failed, 0 errors (3 min 52 s). The first run read 5,141 entries with 0 failed and 2 errors, both the session research-file guard's teardown (one per worker): it saw 141 `terminal` lines appended to the shared lab's `oos_access_log.jsonl` between 04:28 and 04:31, and all 141 fall inside other lanes' run windows (w4b's A/B launches; `D:/dev/v04/measure/*/windows.jsonl`), none from this suite. crosscheck PASS 2,495, FAIL 0. Web: `gen-api --check`, `tsc -b`, six e2e-types projects exit 0; vitest 7,828 passed, 47 skipped, 1 file failed (`radixPrimitiveStub.test.tsx`, the junction's `fs.strict` fault above); that file alone passes (7 of 7) under a scratch config outside the repo with `server.fs.strict` off; build, bundleCheck (shell 110.0 of 115.0 kB) and buildStamp pass. `node --test` harness 466 (465 passed, 1 skipped), scripts 255 (`desktop/scripts/tests` and `scripts/tests`) all passed. gatecheck PASS again (1,645 lines in this wave's windows, all caller terminal). C: 434,673 MB free, no fall. |
| `gatecheck.py check` (snapshot taken before the first real run, lab `ablabw4a`) | PASS: `ledger.csv`, `registry.csv`, `oos_openings.json` same; the first 47,381,676 bytes of `oos_access_log.jsonl` hash as before; 34 windows, none open; 1,645 lines appended inside the windows, all caller `terminal`; 1,081 outside, all `terminal`, counted not judged. `gatecheck.py links --lab D:/dev/ablab033` also passed |
| C: free space | 433,694 MB at the start, 434,299 MB at the end; no fall |
| prose lint | `resident_backend_design.md` PASS; `w4a-startup-page__resident-design.md` PASS; `w4a-startup-page__page-cache.md` WARN (three list-of-three warnings, not a fail; the slice's file, left as written); this note: PASS (2,273 words) |
| dash and line-ending scans, and an attribution scan, over the changed files | clean |
| `git status` against the owned lists | every changed path is in a slice's owns, in `merge_owns`, or one of the three files named above (`test_safety_ast.py`, named by the builder's wiring; `test_p2_jobs_safety.py` and `port_pref.py`, fixed because a full suite failed) |

## The A/B (PROVISIONAL)

Run on 12 October 2026 (02:26 to 03:20 UTC) through A/B labs with `D:/dev/v04/tools/ab.mjs`, hidden, under the HEAVY slot, 0.3.3's smoke exe
(`D:/dev/release/0.3.3/payload/smoke/nq-lab-terminal.exe`) on every arm. Arms: `base033` over `D:/dev/ablab033` (its terminal the worktree at
`desktop-v0.3.3`), `candw4a` over `D:/dev/ablabw4a` (built by `ensure-ablab.ps1 -Name w4a -TerminalJunction E:\projects\nq-lab\wt-w4a`, its terminal a junction to
this worktree, `web/dist` built from it), both with the preferred port off, and `candw4aon`, the same candidate lab with
`{"preferred_port": true}` written to the run folder's own `state/port_pref.json` before its warm-up (never the owner's state folder).
Every record names its exe, lab and backend identity, and the side check passed on all of them (backend 0.3.3, root and `nq_terminal` under the lab asked for).
One warm-up per arm and phase, then rounds of five with the arm order rotating each round. Launches the window watch failed (the app's own 6 by 6 pixel
off-screen message window, class `Tao Thread Event Target`, caught by the enumeration; no visible window) do not count, so four extra launches
brought each arm to five counted ones (`ab_topup.log`). Free memory (MemFree) was read before every launch: 5.9 to 10.6 GB, with a 315 s wait at the start for 10 GB; the PC
never stayed above 10 GB, so the run went ahead below the owner's wait threshold of 10 GB. **The owner's 8 GB free-RAM floor was broken on 12 of the 34 launches**
(MemFree 7.7, 7.9, 7.4, 5.9, 7.9, 7.2, 7.9, 7.3, 6.6, 7.9, 6.9 and 7.5 GB; lowest 5.9 GB; `memlog.txt`): the per-launch gate waited up to 300 s for 6 GB and then launched anyway, and
each launch added about 235 MB of shell tree and backend. The main block ran at 5.9 to 9.9 GB and the top-up block at 9.2 to 10.6 GB, so memory pressure is a further
confound on every timing here. The drivers now wait for 10 GB and skip a launch under 8 GB (`memgate.sh`, tested by `test_memgate.sh`); the figures above were taken before that change. Records, run folders and `windows.jsonl`
(34 windows) are in `D:/dev/v04/measure/w4a-startup-page/`.

| Row, median (min to max), n = 5 | Base 0.3.3 | Candidate, port off | Candidate, port on |
| --- | ---: | ---: | ---: |
| first launch `cold_home` | 4,661 ms (3,618 to 6,185) | 3,731 ms (2,879 to 4,595) | not run |
| first launch `backend_ready` | 2,403 ms (1,693 to 2,982) | 1,898 ms (1,319 to 2,623) | not run |
| usual launch `cold_home` | 3,035 ms (2,930 to 3,400) | 3,072 ms (2,774 to 3,778) | 2,855 ms (2,326 to 4,010) |
| usual launch `splash_painted` | 381 ms | 389 ms | 326 ms |
| CPU gate, all counted launches | 12.8 to 25.9 % | 11.8 to 37.6 % | 13.4 to 27.7 % |
| asset requests (`GET /assets/...`) per usual launch, from `backend.log` | 107 on every launch | 107 on every launch | 107 on the warm-up, then 0 on all 7 launches |

What the figures say, and do not say:

- **Exit criterion 1 is met.** With the preferred port on, every launch after the warm-up made 0 asset requests to the backend (7 of 7). The backend
  bound the same port, 61396, on all 8 launches of the run folder; `GET /` came back 304 each time (the page is revalidated) and `favicon.svg` was served from
  WebView2's cache. With the port off, a usual launch still fetched all 107 files, exactly like 0.3.3, because the origin changes each launch.
- **The time saving on a usual launch is small and inside the noise.** The port-on median is 180 ms under the base and 217 ms under the port-off candidate, with a
  range (2,326 to 4,010 ms) that spans both. The load (CPU gate 13 to 38 %) is far above what a timing claim needs; no figure here is a result. The saving the
  files not served should give cannot be separated from the load by five launches. A quiet-machine rerun is the way to size it.
- **The first-launch difference (candidate 930 ms under the base) is PROVISIONAL and not a result.** The two ranges overlap (3,618 to 6,185 ms against
  2,879 to 4,595 ms); a Mann-Whitney test on the five counted values per arm gives U = 20 of 25, one-sided p about 0.075 and two-sided about 0.15, so it is not
  significant. The candidate arm ran under heavier CPU load (gate up to 37.6 % against 25.9 %), and one of its five counted launches was a top-up taken 30 minutes
  after its paired base launches, with more free RAM. Its cause is not measured: the candidate is main 9d2cd62 (all of v0.4 merged so far) plus w1 plus w4a, set
  against 0.3.3, so the A/B cannot attribute any gain to w1, to w4a or to the other merged work. The page cache changes nothing on a first launch (fresh run
  folder, empty cache), but that is a design argument, not a measurement. Sizing it, and attributing it, waits for the quiet-machine rerun, with a main@9d2cd62 arm
  if attribution matters.
- The `backend_ready` row of a usual launch is invalid in this A/B: the usual launches append to one `shell.log`, and `ab.mjs` timed each launch against the
  warm-up's events. `ab.mjs` now keeps only the events at or after the launch's spawn time (`launchEvents`), and the summary flags records read from a reused
  `shell.log` and does not count their `backend_ready` (`ab_summary.txt` was regenerated; the old files are kept as `.bak-reused-shelllog`). The five usual
  records per arm cannot be repaired without measuring again. It is left out of the table above. `cold_home` is a page-side
  measure and is not affected.

Per-launch asset counts: `D:/dev/v04/measure/w4a-startup-page/asset_counts.json`, made by `D:/dev/v04/w4a-startup-page/count_assets.py` (a read-only parser that cuts
`backend.log` at each `NQT-READY` line). The drivers are `run_ab.sh` and `run_ab_topup.sh` in `D:/dev/v04/w4a-startup-page/`.

## Exit criteria

| Criterion | Status |
| --- | --- |
| With the preferred port on, a second launch makes 0 asset requests to the backend; the default stays off (O19) | MET (7 of 7 launches after the warm-up; the setting is a file that is absent by default) |
| Cold and usual launches against 0.3.3 recorded in an interleaved PROVISIONAL A/B through A/B labs | MET, labelled PROVISIONAL (five counted launches per arm and phase) |
| Resident backend design ready for the owner | MET: `resident_backend_design.md`, eight questions in its section 13 |

## Open items

- **Owner decision O19 (the preferred port), unchanged:** the setting stays off. Before it is turned on by default, review `web/src/state/remoteStore.ts` and the
  other web stores: with a stable origin `localStorage` and IndexedDB survive launches, and `remoteStore.ts` assumes the desktop cache starts empty. The A/B shows
  the page loading from the cache; it did not exercise the stores.
- **Owner decision O6 (the resident backend):** the design's eight questions (its section 13) are open. The cost and the memory with the window closed are estimates, not
  measurements.
- **A heuristic-freshness risk on a downgrade:** a 0.3.3 or older backend sends no `Cache-Control` on `index.html`; if one landed on the same preferred port
  (about 1 in 16,000 launches) WebView2 could keep its page. A downgrade test should clear the WebView2 cache or keep the setting off.
- **The time saving needs a quiet machine.** The usual-launch rows should be taken again with the CPU gate under 10 %, and with `warm_home` on both arms (still owed from w1).
- **The harness's window watch** fails an otherwise clean launch when it catches the shell's own 6 by 6 pixel off-screen message window (4 of 34 launches here). It is not
  visible, but it costs extra launches; a tolerance for that class in the watch would remove the retries.
- **`backend_ready` for a reused run folder:** fixed in `ab.mjs` for future runs (above); the usual rows of this A/B stay invalid until measured again.
- **The shell budget** is as w1 left it (110.0 kB gzip, with the thin room w1 reported against its 110,000 byte target). This wave changed no web file.
- **Post-merge checks** (`smoke_real.ps1 -Mode App` on the main tree with the merged tree's smoke build, the second `gatecheck.py check`) belong to the post-merge agent.
