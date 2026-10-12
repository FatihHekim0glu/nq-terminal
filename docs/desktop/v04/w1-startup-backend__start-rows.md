# Wave w1, slice start-rows: the start-up rows

Informational rows for the start of the app (Roadmap v2, startup.md section 11, metrics.md recommendation 1). None of them has a target
or a ceiling in this wave, none can fail a run or `--check`, and none is in `ROWS`.

## The rows

| Row id | What it reads | Where from |
| --- | --- | --- |
| `spawn_offset_ms` | the shell's `start` line to `supervise_spawned` | shell.log, per launch |
| `spawn_to_ready_ms` | `supervise_spawned` to `supervise_checked` | shell.log, per launch |
| `home_stage_ms` | `prewarm started` to `prewarm finished`, the backend's own clock | backend.log, per launch |
| `page_files_served` | `GET /assets/` lines of the launch; `firstLoad` is the part before the second `GET /` | backend.log, per launch |
| `import_time_ms` | `import nq_terminal.app` and its app object in the lab interpreter, median after one warm-up run | `importtime.py` |
| `modules_without_bytecode` | loaded source modules whose `.pyc` is missing or stale, read in place | `importtime.py` |
| `slow_requests` | the slowest five request lines between `prewarm started` and `prewarm finished`, with their wall time (no CPU: the line's CPU is event-loop load, not the request's own) | backend.log, per launch |

A figure that a launch's own lines do not hold reads `missing` with a reason. It is never 0 and never borrowed from another launch.

## Per launch, not per file

A usual-launch run opens the same config and state folders again, so one shell.log and one backend.log hold several launches (the harness
milestones of `usual-s*.json` are negative for that reason, startup.md section 2). `startrows.mjs` splits the shell log at each `start` event
and the backend log at each `Started server process [pid]` line. The two are paired by the backend pid that `supervise_checked` names, and by
position only when a launch names no pid and that section is unclaimed. A launch with no backend section reads `missing` for the backend rows.

## The request-line contract

The parser reads the form the pre-ready slice's middleware writes (`backend/tests/test_request_timing.py` pins the same pattern):

    <date> <time> INFO nq_terminal.request_timing: request timing: GET /api/x status=200 start=1.0 end=1.5 wall_ms=500.0 event_loop_cpu_ms=12.0 process_cpu_ms=20.0

The duration is `wall_ms`, else `end` less `start`. The CPU read is `event_loop_cpu_ms` (`thread_cpu_ms` on older lines); the report does not print it. A DEBUG line, `start_ms`/`end_ms`/`cpu_ms` and `cpu` in seconds are read
as well. The path is cut at any `?`. The 0.3.2 backend wrote no such line, so the tests build theirs; the committed excerpts hold none.

## Files, and their fate (for the 03 Appendix A addendum)

| File | Fate |
| --- | --- |
| `desktop/harness/lib/startrows.mjs` | new: the splitters, the row readers, the summary, the report lines, `importTimeCommand`, `summariseImportRuns`, `runImportTime`; a small CLI (`node startrows.mjs SHELL_LOG BACKEND_LOG`) for a merge-time reading of a run folder |
| `desktop/harness/lib/importtime.py` | new: import mode (refuses without `-X pycache_prefix` outside the repository, and refuses a scratch path inside it; since the merge it writes no file: the result is one JSON line on stdout and the caller makes the scratch folder) and `--check-bytecode FILE...` |
| `desktop/harness/lib/rows.mjs` | changed: `START_ROWS` added; `ROWS`, `CHECKS` and `rowsForLaunch` untouched |
| `desktop/harness/report.mjs` | changed: `startRowsSummary`, a `startRows` key in the report JSON, and the informational lines |
| `desktop/harness/tests/startrows.test.mjs`, `report.test.mjs` | new, and added to |
| `desktop/harness/tests/fixtures/startrows/*.txt` | new: four excerpts of the 0.3.2 G2 run (shell lines `start`, `supervise_spawned`, `supervise_checked`; backend lines `Started server process`, the two prewarm stage lines, `GET /assets/` and `GET /`). No path, user name or lab name is in them. The extension is `.txt` because the repository ignores `*.log` |

Nothing is written to the repository by a run: the interpreter writes bytecode under the run folder it is given, `runImportTime` makes the scratch folder there, and `importtime.py` itself writes no file (`tests/test_safety_ast.py` bans file writes outside its allow list).

## Where the rows come from in a record

A record carries `startRows` (`{ schema: 'start-rows-1', launches, import? }`) when the launch wrote it. A smoke record without the field is read back from
its own run folder (`<run>/config/logs/shell.log` and `<run>/state/logs/backend.log`, found from `stateFolder`). A measure record is never read back:
its state folder is the lab's own, shared by every launch. Records without either source add no line.

## Reading against startup.md (a merge-time reading, not a test)

`node` over the seven counted 0.3.2 first launches and the four usual launches of the G2 run folder, read from D: once, by hand:

| Row | Rows read | startup.md |
| --- | ---: | ---: |
| spawn to READY, first launches, median | 1,581 ms | 1,581 ms (section 3) |
| HOME stage, first launches, median | 1,917 ms | 1,917 ms (section 3) |
| spawn offset, first launches, median | 499 ms | 500 ms (521 from the harness spawn less the 21 ms `start` line) |
| spawn to READY, usual launches 2 and 3 | 1,480 and 1,508 ms | 1,480 and 1,508 ms (section 4) |
| HOME stage, usual launches 2 and 3 | 992 and 1,079 ms | 0.99 s and 1.08 s (section 4) |
| page files served, usual launches | 107 each | 107 assets (section 4) |
| page files served, row runs | 196 each, 107 on the first load | the row runs reload the page for the warm-HOME reading |

The first-launch figures are within the 5 ms of the wave's exit criterion. The page-files row counts every `GET /assets/` line of a launch, as asked,
so a launch that reloads the page counts its files twice; `firstLoad` is the figure to compare with section 7.5.

## In-process import time, once

`runImportTime` under a HEAVY slot, four runs, the lab interpreter, this worktree (`nq_terminal.__file__` under `wt-w1/backend`): warm-up 4,261 ms (empty
bytecode cache), then a median of 1,556 ms over three. The machine was shared with other waves and a downloader and the CPU load was not read, so the figure is
PROVISIONAL; the research reading on an idle machine was 1,105 ms. 982 source modules were checked, all current, none missing, none stale. 1,136 modules
were loaded.

## How the rows reach a record

No launch path carries them (the spec says read existing harness outputs only, and `launch-run.mjs` and `modes/rows.mjs` are no slice's files).

1. The launch rows are read back after the launch: `startRowsOfRecord(record)` reads `<run>/config/logs/shell.log` and `<run>/state/logs/backend.log` of a smoke record, so `report.mjs` shows them with no change to the launch. A measure record is not read back (its state folder is the lab's, shared by every launch), and a record that carries its own `startRows` keeps them.
2. The import row is taken once per run set by a command of its own, under the HEAVY slot: `node desktop/harness/lib/startrows.mjs import-time OUTDIR [CPU_LOAD_PCT]`. It runs `runImportTime` (bytecode and scratch state under `OUTDIR/importtime`) and writes `OUTDIR/importtime/import-time.json`; `startRowsOfRecord` stamps it onto every record file of `OUTDIR` as `startRows.import`, marked `same`, `other` or `unknown` against this harness's backend tree. A run set without the file has no import row.
3. The pre-ready slice's logger must reach backend.log at INFO (the prewarm's `ensure_log_lines` handler does this for `nq_terminal.*` loggers); the line form above must not change.

## Not done

- A launch-time carry of the rows (and so the measure build's shell rows): it needs `launch-run.mjs`, which the slice does not own.
- No real run of the middleware lines: the pre-ready module was not complete when this slice ran, so `slow_requests` is proved on built lines only.
- `import_time_ms` has no CPU-load reading; the caller passes `cpuLoadPct` to label a run PROVISIONAL above 10%.
