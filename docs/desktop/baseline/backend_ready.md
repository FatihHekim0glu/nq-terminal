# Backend ready: quiet-machine baseline (wave W0B)

Taken on 2 October 2026 at 08:22 to 08:25 UTC, before the second pair of T2 sessions (`../spike_electron/results/t2.md`), with no build, cargo, Playwright or pytest run alive. This is the figure that D1 (the backend cache and lazy imports) is judged against (04 D0.5, standing rule 15). It was taken with the hardened script (gate enforced before each start, identity-checked stop); an earlier run of three with the first version of the script is listed below it.

## Result

| Run | Process start to first 200 from `/api/health` | CPU gate (60 s average before the run) |
|---|---|---|
| 1 | 1,595 ms | 4.5% |
| 2 | 1,560 ms | 2.7% |
| 3 | 1,566 ms | 4.4% |
| **Median of 3** | **1,566 ms** | all three under the 10% limit; 0 rejected, status ACCEPTED |

Range 1,560 to 1,595 ms. Earlier run with the first version of the script (taken 07:28 to 07:33 UTC, gates 2.7, 2.5, 2.7%): 1,662, 1,565 and 1,584 ms, median 1,584 ms, 18 ms from the figure above. For reference: 02 section 4 measured 2.6 to 3.1 s on a busier machine before stage 1; the W0A import-time check (`python -X importtime -c "import nq_terminal.__main__"`, median of 3) was 1,457 ms, which is most of this figure. The D1 target is 1.5 s and the ceiling 2.5 s (04 D1 exit, 02 T3). The baseline sits 66 ms above the target and 934 ms under the ceiling.

## Method

- **Command.** `C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe -E -s -X utf8 -m nq_terminal`, working directory `terminal\backend`, the real backend (not the fixture backend).
- **Environment.** `NQT_PORT=8797`, `PYTHONUTF8=1`, `NQT_STATE_DIR` a fresh folder under `D:\dev\tmp` (made and deleted for each run), `NQT_JOBS=off`. The current code ignores `NQT_STATE_DIR` and `NQT_JOBS`; they are set so the same command stays valid once the code reads them. The IB and machine settings (`NQT_IB_READONLY`, `IB_HOST`, `IB_PORT`, `IB_ACCOUNT_ID`, `IB_BASE_USD_RATE`, `IB_PAPER_DELAYED_DATA`, `VOLMAN_C`) were set to empty, as the T2 harness does, so nothing could reach a broker. `PATH` without `D:\dev\mingw` and `D:\dev\cargo`.
- **Timing.** From the moment before the spawn to the first answer with status 200 from `http://127.0.0.1:8797/api/health`, polled every 10 ms. The spawn uses `windowsHide: true` (no console window). The timer is the Node process's `performance.now()`.
- **Gate.** The total CPU load read for 60 s before every run (average at most 10%); the three readings were 4.5%, 2.7% and 4.4%. A reading above the limit makes the script keep a rejected record without starting the backend and retry; after 5 rejections in a row it takes the run labelled PROVISIONAL, and the median counts accepted runs only (none of that was needed here).
- **Window watch.** The global window and foreground watch ran around every run: 0 new visible windows, 0 foreground changes in all three.
- **Stop.** One pid at a time, never `taskkill /T`: the run records the identity (pid, creation time, image name) of the venv launcher and its child interpreter, and kills only a process whose pid, creation time and image name (`python.exe`) still match. A launcher that has already exited is never killed, because its pid may have been reused. The tree is read while the launcher is still running, not at spawn, so the read does not load the CPU being timed. After 1.5 s the creation-time-checked pids were gone (0 survivors in every run) and port 8797 no longer answered. The earlier three runs used `taskkill /T /F` on the launcher pid; all three reached readiness with the launcher alive, so the change does not affect their numbers.
- **No prices.** The backend reads no prices at start: the `/api/health` body of every run shows `gate_reads_this_process: 0`, `cache` with 0 series and 0 bytes, and `fixture_mode: false`. Nothing was served through `nq_lab.data.serve`, and nothing was read from the sealed data.
- **Owner's backend untouched.** Port 8765 was listening before and after with the same owning pid (49476); the script refuses 8765 in code.
- **State.** `terminal\state` held only `jobs.json` (1,072 bytes, last written 1 October 2026 at 23:15 local time) before and after; no new file or folder.

## Provenance

Repository head `7f8b986202f46bd81c5517180bbe096a2ec7d8fb`; `git diff HEAD` empty (sha256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, the digest of empty input); the only untracked paths were the documents of this wave's slices under `docs\desktop`. Health body: `nautilus_version` 1.231.0, `pandas` 2.3.3, `pyarrow` 25.0.1, `quantpad_data` 0.8.0.

## Raw files

Under `D:\dev\spikes\t2\runs\backend-ready\`: `backend-ready-01.json` to `backend-ready-03.json` (gate readings, pid tree, health body, survivors, window watch, state check), the matching `.out.log` and `.watch.jsonl` files, and `summary.json`. The script is `D:\dev\spikes\t2\runs\backend_ready.mjs` (`node backend_ready.mjs --runs 3 --port 8797`).
