# Stage 1 measurement and seam tests (wave W3B)

This folder holds the record of the stage 1 numbers. `d1_numbers.md` is the D1 record (backend start, the eight slow routes, the HOME prewarm). `measure_stage1.mjs` takes the stage 1 release numbers, and `stage1_numbers.md` (M3) is the record of the run: the figures it wrote, the method, the CPU load next to each number, the cold-HOME ceiling and the T3 verdict. The two Playwright specs that prove the seams end to end live with the other specs, in `web/e2e`:

| Spec | What it proves |
|---|---|
| `desktop-seams.spec.ts` | A workspace is saved, the backend is stopped and started again on a new port with the same state folder, and a page on a new origin with empty storage loads it. A launch code opens the terminal once, never appears in a request line, and a reused code is refused. Export (a CSV) and GRAB (a PNG, saved and copied) go through the bridge, with the page told by the injected shell object that it runs in the Windows app, and read nothing from the API. |
| `workspace-import.spec.ts` | The one-time per-origin import (03 section 10.4): the ten keys are seeded on port 8798 (the stand-in for the owner's 8765), all six documents appear in the fixture backend's own state folder with the seeded values, `meta.imports` lists that origin, a reload repeats nothing, and a load on another port with empty storage adopts the stored look and changes no file. The ten keys are seeded with the value HOME itself puts in link group B, so that HOME's own write does not look like a change to the imported document. A third test removes the store routes (an older backend answering 404) and shows that the same checker then finds nothing, and that the page keeps working from its cache. |

Both specs run in the main Playwright project (`pnpm e2e`). Each starts a fixture backend of its own with its own temporary state folder, and puts the run's own page build and `/api` on one origin through a small server of the spec, so a page and its API share an origin as in the app. The session is bought the way the shell buys it: the token from the backend's lock, `GET /api/session` with the origin, the cookie set in a headless context. Nothing touches the terminal's own `state` folder or port 8765. The harness is restated in both files because a spec cannot import another spec; the merge may move it to a shared support file.

## The page and the store in the shared run

The gallery build that `pnpm e2e` serves does not start the workspace store unless a spec sets `window.__NQT_STORE__` first (`web/src/main.tsx`): the run's tests share one backend, and a store shared by every browser context would carry one test's saved layouts, theme and workspaces into the next. These two specs and the HOME budget loads (`web/e2e/perf/storeOn.ts`) set it, so the 1.5 s figure includes the store step; the production build always starts the store.

## Taking the numbers

Run `measure_stage1.mjs` alone, in a quiet window: no build, cargo, Playwright or pytest run, and the owner's PC idle. The merge of the wave runs it after its own checks.

1. Build the page first (`corepack pnpm --dir terminal\web build`): the backend serves `web\dist`, and the run records the `dist` state the backend reports (`current` is required for the HOME and screen figures to mean anything).
2. Run the dry mode once: `node measure_stage1.mjs --dry`. It checks the script's own rules (each beside a case that must fail), the READY line reader, the session and timed GET code against a stand-in server, the series writer, and the page steps on a stand-in page in headless Chromium, with the window watch and a 2 s CPU reading around it. It starts no backend and writes `dry\dry-run.json`.
3. Run the real measurement: `node measure_stage1.mjs`. Options are listed at the top of the script. Records go to `D:\dev\spikes\w3b\stage1\<timestamp>\` (nothing is written on the system drive, and the script refuses an output or temporary folder outside `D:\dev`).

The helpers (CPU gate, window watch, identity-checked stop, slot policy) are the machine-local tools of the T2 harness in `D:\dev\spikes\t2\lib`; `--libs` names another folder. They are not tracked in the repository, and the D5 harness replaces them for the app itself.

## What each figure is

| Series | Definition | Reading |
|---|---|---|
| `ready-browser` | Process start to the first 200 from the proof route, polled every 10 ms; the backend in its browser form (`python -m nq_terminal`, no stdin channel). The route stands in for `/api/health`, which now needs a session; the app is fully built before it listens, so both answer at the same moment. | target 1.5 s, T3 ceiling 2.5 s; D1 measured 1,061 ms |
| `ready-desktop` | Process start to the `NQT-READY` line, with `NQT_DESKTOP=1` and the `TOKEN` and `NONCE` lines on stdin as the shell sends them; the proof in the line is verified. | same budget |
| `home-fresh` | Cold launch: the clock starts before the backend is spawned (desktop form, port 8797) and stops when the four HOME panels show their data and nothing is loading, two frames painted. Headless Chromium and its context exist before the clock, as the shell's window does; the session is bought and its cookie set; the page then navigates. A fresh state folder each run: a first launch. | target 4.5 s; median plus 20%, never above 6 s (02 section 4.1, decided: this series fixes the ceiling and is the one T3 reads) |
| `home-disk` | The same, on a state folder an earlier launch filled (one unmeasured launch fills it): the usual double-click, where the result cache reads the ledger and the deflated board from disk. | never above 6 s; no regression above 4,508 ms (its W3B ceiling) |
| `routes-browser-caps`, `routes-desktop-caps` | The eight routes of the result cache. Per route a cold call and three repeats, then three passes over all eight in turn (every entry has to stay cached together), then a restart on the same state folder. Bodies are compared by sha256 inside a configuration and across the two. Browser caps are 2 GiB of bars; desktop caps (`NQT_DESKTOP=1`) are 512 MiB of bars and 128 MiB of files. In desktop form the HOME prewarm starts with the process, so its cold figures are taken with it in flight; the repeat figures are what the caps are judged on. | repeats target 100 ms, ceiling 300 ms |
| `screens-browser`, `screens-desktop` | EQ and REG on real data, warm backend, a fresh context per open. Two units: the W1B unit (Enter on the line, the screen HOME already holds, so part of its load is HOME's own) and a new panel (Shift+Enter, one more panel of the screen, every panel of it settled). The Enter unit is the one judged (the unit D1 judged, and it asks the backend); the new panel is reported as render time only, because the page's query cache (stale time 30 s) answers it without a request. The page answers the workspace store routes 404 in these opens, so a panel one open adds is not saved for the next. | target 1 s, ceiling 1.5 s at the D3 exit |

Each series is `--runs` runs (3; the screens series is 5 warm opens after one cold open). Every run sits behind a 60 s CPU reading of the whole machine (limit 10%). A rejected reading keeps its record (`*-rejected.json`); after `--max-rejects` readings (default 2) the run is taken anyway and labelled `PROVISIONAL`, so the script never waits for ever and never loosens a limit. The CPU load during each run is sampled too (`cpuDuringRun`). Under the manager's decision for tonight, a series with any provisional run is listed for the quiet re-measure of W5B. The T3 verdict carries `provisional: true` (with its reasons in `provisionalReasons`) when any series of any group is provisional, when no owner-named quiet window was used (`--quiet-window` says the owner named one).

## Records

- `stage1_results.json`: the whole run (configuration, machine facts, the provenance stamp, every series with its records, the T3 verdict, the research-file check, any new entry under `terminal\state`).
- `stage1_table.md`: the same figures as a table for the stage 1 record.
- `<series>-<nn>.json`: one run each, with its gate reading, CPU during the run, and its details (the four slowest API answers of a cold HOME, the stop check of every backend: survivors and a port that still answers).
- `<group>.watch.jsonl`: the window and foreground watch of the group. Any new visible window, or a change of foreground, makes `watchClean` false and the script exit with code 1 (so does a changed research file, a gate log line that is not caller `terminal` inside the fence, or a new entry under `terminal\state`).

The research files `ledger.csv`, `registry.csv` and `oos_openings.json` must be byte-equal after the run, and `oos_access_log.jsonl` may only have grown by lines of caller `terminal` whose window ends inside the fence; the verdict is in `research`.

## T3

`t3` in the results holds the stop rule of 02 section 9: backend ready above 2.5 s, or a cold HOME above 6 s, on the quiet-machine median. 02 section 4.1 item 3 is decided (DEC1, 3 October 2026, a decision the owner delegated): the cold launches are first launches after an install, with an empty state folder. So the ceiling is `homeCeilingFromFreshMs` (the first-launch median plus 20%, never above 6 s), `HOME_READING` is `first-launch` and `HOME_READING_RATIFIED` is true. The usual launch is gated by the same cap (`usualLaunchOverCap`) and checked against the ceiling recorded for it at W3B (`usualLaunchRegressed`, above 4,508 ms). A run without the first-launch series leaves `fires` null. `--only home --home fresh` takes the first launch alone. Each HOME record carries `apiTimeline`, every API request placed on the launch clock (diagnosis only; the headline is unchanged).

## Limits

- The page is run in headless Chromium, which is the same engine as WebView2 but not the Tauri window; the shell's own figure is a D5 measurement.
- Backend ready now answers the proof route, not `/api/health`; the first health answer with a session is recorded beside it.
- Figures taken while another build is running are provisional by construction and are never compared with a budget as if they were quiet.
