# D1 preflight: static baseline (wave W0A)

Recorded on 2 October 2026 between 04:53 and 05:10 (local time) by the W0A baseline slice, from the committed tree plus nothing else. This is the static part of the baseline of 04 (D1 preflight, standing rules 13 and 14). The suites (backend tests, QA tests, crosscheck, vitest, Playwright, e2e:perf, e2e:offline, build bundle figures) are not run here: the merge runs them once every cargo build has finished and adds their counts under "Suite counts (added by the merge)" at the end of this file. Raw outputs are in `docs/desktop/baseline/raw/`.

**STOP-CHAIN: not raised.** The command line of the process on port 8765 has no `--reload` (section 6), so no hot-reload session can pick up half-built code.

## Provenance stamp

| Item | Value |
|---|---|
| HEAD of the terminal repository | `7f8b986202f46bd81c5517180bbe096a2ec7d8fb` (`feat: v2.1 served effective members, LV6 placement and live-start cone`) |
| `git diff HEAD` sha256 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (the digest of empty input: no tracked file differs from HEAD) |
| Untracked files other than `docs/desktop/baseline/` | none (digest of empty input, same value) |
| `git status --short` at the start | only `?? docs/desktop/baseline/` (this slice's own folder) |

The tree was therefore clean at HEAD when every figure below was taken. The 132 paths of other build work that 04 D1 lists as a precondition are already in HEAD.

Conditions: the machine was not in an owner-named quiet window. A single CPU reading at 05:00 was 9 %, but node and python processes of the other W0A slices and the owner's work were running, so the timings in section 5 are a loaded-machine reference, not a budget figure (standing rule 15). Counts, hashes and import lists are not affected by load.

## 1. Appendix A generator (03 item 0, standing rule 14)

Command (from `nq-lab`): `& $PY desktop_research\tools\plan\gen_03_tables.py terminal D:\dev\tmp\gen03.md` with the nq-lab venv Python.

Result: `backend 110, screens 25, support 24, other 35, unmapped 0`. The full output is kept as `raw/gen03_tables_output.md` (no UNMAPPED text in it) and the one-line result as `raw/gen_03_tables.txt`.

| Check | Result |
|---|---|
| Unmapped rows | 0 |
| Route rows in the generated table | 78 (76 GET, 1 POST, 1 DELETE), equal to the 78 (method, path) pairs of the built app (section 3) |
| Module counts against 03's own record of 2 October 2026 | the same: 110, 25, 24, 35 |
| Module and folder names in the generated Appendix A.1 to A.4 against 03's Appendix A | identical sets, apart from `backend/tests/fixture_app.py`, which 03 carries as a hand-added row and the generator does not emit |
| New modules needing a fate | none |

So no addendum rows are needed this wave; `docs/desktop/03_appendix_a_addendum.md` records that and holds the table that later phases extend. One caution from 03 stands: 03's hand corrections to generated rows (listed in its "Generated parts" note) are not in the generator's rule text, so a regenerated file must be read against 03 and never pasted over it.

## 2. Research files (standing rule 3, read-only)

Taken with `Get-FileHash -Algorithm SHA256` from `C:\Users\Fatih Hekimoglu\nq-lab`; raw in `raw/research_files.txt`.

| File | sha256 | Bytes | Last write (local) |
|---|---|---:|---|
| `results/oos_access_log.jsonl` | `42521E2F30FC1074119FBFD92F61A661E9E932E4DF13434C454731DEDFE5E648` | 1,788,655 | 02/10/2026 03:49:47 |
| `results/ledger.csv` | `3132B5A90E4DCE50425FFFBF79ABE1181C356D9469DB4A111CA5A5A07CB7B98E` | 3,059 | 27/09/2026 01:24:45 |
| `results/registry.csv` | `E56E6AEAB52F2398A118EC0FEFDA7C5B20DDEFE4FEF8BC6B44A99E124A66F202` | 5,103 | 01/10/2026 20:44:45 |
| `results/oos_openings.json` | `3FEEF9AB9491B901D282493935A77A049B7784959EF4537EDDBE9B6DCAA1E4B0` | 639 | 26/09/2026 12:15:20 |

OOS access log line count (`(Get-Content results\oos_access_log.jsonl).Count`): **5,799**.

Nothing in this slice reads prices: every command here reads source, imports modules or lists files, and the import profile and app build ran with `NQT_JOBS=off` and a temporary state folder under `D:\dev\tmp`.

## 3. App shape

`create_app` was built in a subprocess with `NQT_FIXTURE_DIR` pointing at `backend/tests/fixtures`, `NQT_JOBS=off` and a temporary `NQT_STATE_DIR` (the current code reads neither of the last two; a search of `nq_terminal` finds no use of them, so they are set only for the later phases). Raw in `raw/app_shape.txt`.

| Figure | Value |
|---|---:|
| Distinct (method, path) pairs in the route list, HEAD and OPTIONS excluded | **78** |
| Non-GET pairs | 2: `POST /api/jobs`, `DELETE /api/jobs/{job_id}` |
| Distinct paths in the route list | 76 (75 in the contract plus `/api/openapi.json`, which the schema leaves out) |
| `contract/openapi.json` paths | **75** (77 operations) |
| `app.openapi()` equal to `contract/openapi.json`, whole document | yes |
| Contract file | 621,581 bytes, sha256 `83fe536eb39f1c2aa259da4a3a0d6de2389ee0ecaf62bd944a40fb315b76d497` |

**Method note for the route-list test of D1.1.** The installed FastAPI is 0.141.1. Since 0.14x, `include_router` registers one `_IncludedRouter` node per router instead of copying routes, so `len(app.routes)` is **23** (one plain route, 21 included-router nodes and one static mount) and says nothing about the API. Routes must be listed the way the app's own `non_get_routes` does, through `fastapi.routing.iter_route_contexts(app.routes)` (79 contexts, 78 distinct pairs). A test that compared `len(app.routes)` or read `route.methods` on the top-level list would see 1 pair, not 78. The baseline route list for the test is the 78 pairs plus the contract's 75 paths.

## 4. Test clients and the safety bans

Raw in `raw/test_clients_safety.txt`.

| Figure | Value |
|---|---:|
| `TestClient(` occurrences in `backend/tests` | **68** |
| Files holding them | 39 (of 118 `test_*.py` files) |
| `TestClient(` outside `backend/tests` (package, `qa`) | 0 |
| Largest users | `test_app.py` 7, `test_p2_rct_api.py` 6, `test_live_stream.py` 5, `test_fixture_mode.py` 4 |

`test_safety_ast.py` still bans `serve_sealed`: it is the fifth entry of `RULES` (`"parquet", "dataset", "duckdb", "polars", "serve_sealed", "data_path", "write", "order_call", "ledger_append", "ib_client", "gate_door", "test_gate", "dynamic", "syntax"`), with born-failing snippets at lines 536 to 540. No slice adds the ban.

`WRITE_ALLOWED = frozenset({"backend/nq_terminal/services/jobs.py"})`. A second set, `QA_WRITE_ALLOWED`, lists six `qa` golden-file tools and tests (`qa/crosscheck/p12_expectation.py`, `p12_neff.py`, `p12_power.py` and the three matching `qa/tests` files). Any new file that writes, or calls `subprocess` or `tempfile`, under `nq_terminal` is refused unless it joins `WRITE_ALLOWED` with the ban's own tests. `test_line_endings.py` requires LF in every `.py`, `.md`, `.json`, `.toml`, `.ps1` and `.txt` file under `backend/nq_terminal`, `backend/tests`, `docs`, `qa/crosscheck`, `qa/tests` and `contract`; the files of this folder are LF.

## 5. Import profile (04 D1.1, 03 item 1.1a)

Command (cwd `terminal\backend`, nq-lab venv Python, `NQT_JOBS=off`, temporary `NQT_STATE_DIR`, no `NQT_FIXTURE_DIR`): `<py> -X importtime -c "import nq_terminal.__main__"`, three runs. Each run loaded 1,735 module entries and a final 1,750 modules in `sys.modules`. Raw logs `raw/importtime_run1.txt` to `importtime_run3.txt`; the summary table and the direct-import lists are `raw/importtime_summary.txt` and `raw/importtime_children.txt`; module-level import lines are `raw/module_level_heavy_imports.txt`; the transitive scipy chains are `raw/scipy_closure.txt`.

Importing `nq_terminal.__main__` builds the whole app, because `nq_terminal/app.py` ends with `app = create_app()`.

| Run | `nq_terminal.__main__` cumulative (ms) |
|---:|---:|
| 1 | 1,503.0 |
| 2 | 1,457.4 |
| 3 | 1,454.2 |
| median | **1,457.4** |

Where the time goes, medians of the three runs, counting only the outermost entry of each family (a family's cost is paid by whoever imports it first, so the rows overlap and do not add up to the total):

| Family | Median (ms) | Share of 1,457 | First imported by |
|---|---:|---:|---|
| scipy (all submodules) | 509.6 | 35 % | `analytics/perf.py:30` (through `services/runs.py:45`, `api/runs.py`) |
| of which `scipy.stats._stats_py` | 422.3 | 29 % | the same line (it pulls scipy.optimize 95 ms and scipy.spatial 75 ms) |
| `nq_terminal.analytics.perf` (its own cumulative) | 502.5 | 34 % | `services/runs.py:45`; self time 1.0 ms, so all of it is scipy |
| `nq_lab.oos_gate` (its own cumulative) | 267.3 | 18 % | `api/system.py:19`; self time 0.4 ms, so all of it is pandas |
| pandas | 266.8 | 18 % | `nq_lab/oos_gate.py:12`, through `nq_lab.config` (`nq_lab/config.py:4`) |
| numpy (inside pandas and scipy) | 119.9 | 8 % | pandas |
| fastapi | 165.3 | 11 % | `app.py` (floor cost) |
| uvicorn | 96.9 | 7 % | `__main__.py` (floor cost) |
| pydantic | 73.9 | 5 % | fastapi (floor cost) |
| exchange_calendars | 78.1 | 5 % | `nq_lab/sessions.py:5`, through `services/research.py:35` |
| pyarrow | 45.8 | 3 % | `pandas.compat.pyarrow` first, then `nq_lab/data.py:9` (`pyarrow.dataset`) and `services/catalog.py:29` to 30 (`pyarrow`, `pyarrow.parquet`, 1.2 ms) |
| nautilus_trader | 0 | 0 % | not imported at start-up |
| ibapi | 0 | 0 % | not imported (`services/ib_readonly_client.py` is loaded on demand) |
| `nq_terminal` own module bodies (self time, all modules) | 283.9 | 19 % | for example `app.py` 48 ms and `models/analytics_p1.py` 29 ms (pydantic class building) |

`sys.modules` after the import (`raw/sys_modules_after_import.txt`): `scipy`, `scipy.stats`, `scipy.optimize`, `scipy.spatial`, `pandas`, `numpy`, `pyarrow`, `pyarrow.parquet`, `pyarrow.dataset`, `exchange_calendars`, `nq_lab.oos_gate`, `nq_lab.sessions`, `nq_lab.data`, `nq_terminal.analytics.perf` and `nq_terminal.services.jobs` are present; `nautilus_trader`, `ibapi` and `nq_terminal.services.ib_readonly_client` are absent.

### The single list for both W1A slices

Each row is a module-level import (found by walking the syntax tree, so imports inside functions and under `TYPE_CHECKING` are not counted). "Slice" is the owner under the wave plan: A1 owns the analytics modules, the service modules the profile names and the top-of-module import lines of `api/*.py`; A2 owns `services/result_cache.py`, `services/files.py` and `services/bars.py`.

**scipy.stats and the other scipy imports (about 510 ms).** Ten analytics modules import `from scipy import stats as sps` at module level:

| File and line | Import | Slice | `sps.` uses |
|---|---|---|---:|
| `backend/nq_terminal/analytics/perf.py:30` | `from scipy import stats as sps` | A1 | 2 |
| `backend/nq_terminal/analytics/deflated.py:32` | same | A1 | 1 |
| `backend/nq_terminal/analytics/distribution.py:23` | same | A1 | 3 |
| `backend/nq_terminal/analytics/neff.py:39` | same | A1 | 1 |
| `backend/nq_terminal/analytics/regimes.py:19` | same | A1 | 1 |
| `backend/nq_terminal/analytics/risk.py:30` | same | A1 | 2 |
| `backend/nq_terminal/analytics/risk_extras.py:40` | same | A1 | 4 |
| `backend/nq_terminal/analytics/trades.py:47` | same | A1 | 2 |
| `backend/nq_terminal/analytics/trend_regime.py:26` | same | A1 | 1 |
| `backend/nq_terminal/analytics/validity.py:28` | same | A1 | 4 |

Other scipy imports (these load `scipy.cluster` and `scipy.spatial`, which `scipy.stats` also loads, so they matter only once `sps` is lazy):

| File and line | Import | Slice |
|---|---|---|
| `backend/nq_terminal/analytics/neff.py:40` and `41` | `from scipy.cluster.hierarchy import fcluster, linkage`; `from scipy.spatial.distance import squareform` | A1 |
| `backend/nq_terminal/services/market.py:30` and `31` | `from scipy.cluster.hierarchy import leaves_list, linkage`; `from scipy.spatial.distance import squareform` | A1 (a service module the profile names) |

**Finding that changes the work: three module-level imports of `nq_lab` modules pull scipy in again.** `nq_lab/calendar_stats.py:5` and `nq_lab/sizing_stats.py` import scipy at module level, so moving only the ten terminal lines above leaves `scipy.stats` in `sys.modules`. The born-failing test of D1.1 would still fail after that change. The terminal imports that reach it (full chains in `raw/scipy_closure.txt`):

| File and line | Import | Reaches scipy through | Slice |
|---|---|---|---|
| `backend/nq_terminal/analytics/validity.py:30` | `from nq_lab.sizing_stats import sharpe` | `nq_lab.sizing_stats` (scipy directly; also `calendar_report`, `calendar_stats`) | A1 |
| `backend/nq_terminal/analytics/relative.py:25` | `from nq_lab.sizing_stats import block_alphas, spanning_alpha` | the same | A1 |
| `backend/nq_terminal/services/tearsheet.py:28` | `from nq_lab.dtsmom_stats import LAGS as MONTHLY_NW_LAG` (a constant, so the value must be read inside the function or copied with a test that it equals the source) | `nq_lab.dtsmom_stats` to `nq_lab.calendar_stats` to scipy | A1 |

These three must also move inside the functions that use them (or the maths must be reached through a lazy accessor), or `nq_lab` must change, which is outside the terminal's files. Of the 26 `nq_lab` modules loaded at start-up, four reach scipy: `calendar_stats` (`calendar_stats.py:5`), `calendar_report`, `sizing_stats` (`sizing_stats.py:14`) and `dtsmom_stats`. The other 22 (for example `carry_signal`, `eomtsy_book`, `vt_har_stats`, `dtsmom_panel`) do not.

**analytics.perf.** The module is imported at module level by `services/runs.py:45`, `services/tearsheet.py:29`, `services/tearsheet_extended.py:25` and `analytics/risk_extras.py:42` (`from nq_terminal.analytics import perf, relative`). Its own cost is only its scipy and its `validity` import (section above), so it follows once the scipy lines move; the four importers still bind `perf` at import time and need it moved inside the handlers or the service functions that call it (A1).

**nq_lab.oos_gate.** Module-level imports at `backend/nq_terminal/api/audit.py:19` (`from nq_lab import guards, oos_gate`), `backend/nq_terminal/api/system.py:19` (`from nq_lab import live_guards, oos_gate`) and `backend/nq_terminal/services/bars.py:46` (`from nq_lab import oos_gate`; `bars.py` is A2's, `api/*.py` is A1's). Moving these lines alone saves almost nothing (self time 0.4 ms), because the 267 ms is pandas, and pandas is also imported at module level by `nq_lab/config.py:4`, `nq_lab/data.py:8` and `nq_lab/sessions.py:6` and by 47 terminal modules (every analytics module, `services/bars.py:44`, `services/files.py:52`, `services/catalog.py` and others; see `raw/module_level_heavy_imports.txt`). **Profile verdict on pandas: deferral does not pay inside the terminal's files.** It would need every one of those 47 modules and three `nq_lab` modules to go lazy, and the numerical code is written against `pd` at import time. Leave pandas and numpy as they are; the target of the born-failing test is `scipy.stats` and `nautilus_trader`.

**nautilus_trader.** Already absent at start-up. The only references in the package are `models/jobs.py:81` (inside a function) and field names in `models/runs.py:40` and `services/runs.py:479`. The "no `nautilus_trader` in `sys.modules`" half of the D1.1 test therefore passes on today's tree; only the `scipy.stats` half is born failing.

**exchange_calendars (78 ms).** Module-level: `backend/nq_terminal/services/dq.py:24` (`import exchange_calendars as xc`). It is also reached through `nq_lab.sessions`, which five terminal files import at module level: `analytics/series.py:57`, `api/data.py:35`, `services/research.py:35`, `services/runs.py:43` and `services/seasonality.py:32` (`from nq_lab.sessions import nyse_sessions`). The first importer in the profile is `services/research.py:35`. All six lines would have to move for the library to leave start-up; whether that is wanted is a D1.1 decision, since 78 ms is 5 % of the import.

**pyarrow (46 ms).** `backend/nq_terminal/services/catalog.py:29` to 30 (`import pyarrow as pa`, `import pyarrow.parquet as pq`) and `backend/nq_terminal/services/catalog.py:33` (`from nq_lab.data import processed_path`); the first load is by pandas, so no gain from moving these.

**Estimate of the prize (not measured as a change).** scipy is 510 ms of 1,457 ms (35 %) and is the only family that both costs real time and can leave start-up inside the terminal's own files plus three `nq_lab` import lines. The floor that stays (fastapi, uvicorn, pydantic, pandas, numpy, the terminal's own module bodies) is about 950 ms in this profile. Backend ready was 2.6 to 3.1 s in 02, so the import is about half of it; W0B records the backend-ready baseline.

## 6. The process on port 8765 (read-only)

Raw in `raw/owner_8765.txt`. Nothing was stopped, signalled or contacted.

| Item | Value |
|---|---|
| `Get-NetTCPConnection -LocalPort 8765 -State Listen` | `127.0.0.1:8765`, owning pid **49476** |
| Pid 49476 created | 2 October 2026 04:04:15 |
| Command line of 49476 (Win32_Process) | `"C:\Users\Fatih Hekimoglu\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe" -m nq_terminal` |
| Parent pid 47620 | `"C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe" -m nq_terminal` (the venv launcher) |
| Children of 49476 | none |
| Contains `--reload` | **no** |
| Other processes matching `pytest\|playwright\|vite\|cargo\|uvicorn` and `nq-lab` | pid 31860, `uvicorn fixture_app:app --app-dir backend/tests --host 127.0.0.1 --port 8796` (a W0A probe fixture backend on a spare port from the port table; no `--reload`) |

## 7. `terminal/state` and JOBS (read-only)

Raw in `raw/state_and_screens.txt`. The listing was taken before and after this slice's commands and did not change.

| Path | Length | Last write (local) | Created (local) |
|---|---:|---|---|
| `state\jobs.json` | 1,072 | 01/10/2026 23:15:18 | 01/10/2026 23:15:15 |

No other file or folder exists under `state`. `jobs.json` is version 1 with one job: `j_0ae1f6183dcc`, run `t_v2_release_check`, state `ok`, exit code 0, started 2026-10-01T22:15:15+00:00 and finished three seconds later. Status counts (the field is named `state`): **queued 0, running 0**, ok 1. Nothing is queued or running, so a JOBS precheck in later waves starts from an idle queue.

## 8. Screenshots and free space

| Figure | Value |
|---|---:|
| PNG baselines (`git ls-files '*.png'`, all under `web/e2e/__screenshots__`) | **210** (03 recorded 204 on 2 October 2026; the tree holds 210, so W1A and later compare against 210) |
| of which `flows` 32, `visual` 46, `p1.spec.ts` 28, `p11.spec.ts` 18 | the rest are per-spec folders, listed in `raw/state_and_screens.txt` |
| Free space on C: at the start of this slice (04:57) | 125,058 MB (122.13 GB) |
| Free space on D: at the start of this slice (04:57) | 233,557 MB (228.08 GB) |
| Free space on C: at the end of this slice (05:10) | 125,054 MB, a fall of 4 MB (other processes also write to C:; the 100 MB rule is checked by the merge across the whole wave) |

After the slice the four research file hashes, the OOS log line count (5,799), the `terminal/state` listing and the owner of port 8765 (pid 49476) were read again and had not changed.

## 9. What this slice did not do

- No test suite, no Playwright, no build and no timing of backend ready was run. Those are the merge's work and W0B's.
- No tracked file other than this folder and the addendum was touched; no state, results, data or live file was written.
- The import timings are from a machine in ordinary use (section "Conditions"); W1A should read its own start-up figure on a quiet machine with the same command.

## Suite counts (added by the merge)

Run by the W0A merge on 2 October 2026 between 05:36 and 06:20 UK time, one suite at a time, at repository head `7f8b986` with no tracked file changed (the wave added only untracked files under `docs/desktop`). Environment: the plan's prelude with `TEMP` and `TMP` on D:, the venv Python by full path, Playwright headless, the e2e fixture backend and preview on 8795 and 4273, and no use of 8765. The machine was in ordinary use, so every timing is a loaded-machine reading.

| Suite | Result | Detail |
|---|---|---|
| Backend pytest (`terminal/backend/tests`) | **2,989 passed, 1 skipped**, 0 failed | 235 s; the research guard notes report all four research file hashes and the kill switch file unchanged |
| QA tests (`terminal/qa/tests`) | **299 passed**, 0 failed | the quiet reporter prints no summary line; 299 is the count of progress marks, all passes |
| `crosscheck --strict` | **PASS 2,455, FAIL 0, SKIP 0, INFO 104**, "crosscheck: OK" | the nine documented differences print as INFO and never fail |
| `test:types` (`tsc -b`) | passed, 0 errors | |
| `test:e2e-types` | passed, 0 errors | all five e2e tsconfigs |
| `test` (contract check then vitest, `--maxWorkers=8`) | **467 files passed; 6,930 tests passed, 45 skipped** (6,975) | 64 s; `gen-api --check` passed, so the contract and generated types are current |
| `build` (tsc, vite, bundle check) | passed | bundle check, gzip against budget: shell 109.5 of 114.9 kB, uplot 22.1 of 30.0, lightweight-charts 61.4 of 75.0, echarts 201.6 of 230.0, tanstack-grid 18.7 of 45.0, perspective 86.1 of 100.0 |
| `e2e` (Playwright, project chromium, 1 worker) | **387 passed**, 0 failed | 11.5 min. A first attempt was stopped by the merge's own background time limit at test 361 with 0 failures and was discarded; this is the full second run |
| `e2e:perf` (alone, one worker) | **3 passed**, 0 failed | loaded-machine reference (CPU averaged 15.3% over 10 s before the run, above the plan's 10% limit): HOME first render median ready 593 ms against the 1,500 ms budget; GIP pan and zoom 60.0 fps, p95 frame 18.1 ms, 0 missed; 8,411-fill grid opens in 70 ms, sorts in 32 ms, pages in 36 ms (budget 500 ms each) |
| `e2e:offline` | **100 passed, 1 skipped, 88 failed** | state on this machine, not a regression: see below |

**`e2e:offline` state.** 87 of the 88 failures are `toHaveScreenshot` calls that found no baseline ("A snapshot doesn't exist ... offline-win32"). The offline project keeps this machine's own baselines in the git-ignored folder `web/e2e/__screenshots__/offline-win32`, which has never existed here (the offline project's baselines are made on purpose with `pnpm e2e:offline:baseline`). The run wrote 110 "actual" images into that folder as new baselines; the merge deleted the folder afterwards, because keeping it would make later runs pass against unreviewed images. The one other failure is `demo.offline.ts:70`, `in-page demo build > volmanaged_v0 RET settles with no alert`: after the panel settles, `[data-nqt-panel] [role="alert"]` resolves to one element where zero are expected. Re-run once alone (project `offline-demo`, `-g "volmanaged_v0 RET settles"`) it failed the same way, so it is recorded as baseline state at this head, not as a flake. The wave changed no code. Whether the alert is a real fault in the demo build's RET screen or an expectation that went stale is for W1A's owner to settle; the regression comparison for later waves is "100 passed, 1 skipped, the same 88 failing, no new failure".

**Checks around the suites.** `terminal/state` listing before and after: unchanged (only `jobs.json`, 1,072 bytes, last write 01/10/2026 23:15:18). The four research file hashes and the OOS log line count (5,799) are identical to section 2. Port 8765 owner is still pid 49476. After the suites no process listens on 8795, 4273, 8796 or 8800. `test_line_endings.py` and `test_safety_ast.py` pass with the new Markdown in place (213 passed). The `e2e` run kept its traces under the git-ignored `web/e2e/.results` and removed them on pass; the `e2e:offline` run left the git-ignored `node_modules/.tmp/e2e-offline-results` folder.

**Provenance stamp (taken at the end of the merge).** Head `7f8b986202f46bd81c5517180bbe096a2ec7d8fb`; tracked diff empty (0 bytes, sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, taken through a Python subprocess; the plan's PowerShell pipe form re-encodes the pipe and printed a different value, `f1945cd6...adfc5`, for the same empty input, so later waves should hash `git diff HEAD` bytes from Python, not through a PowerShell pipe); untracked stamp in `d0_results.md` section 8.
