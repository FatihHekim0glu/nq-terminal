# T2 harness: Electron 44 against the Tauri spike shell

Status: built and dry-run on 2 October 2026 (wave W0A, Windows), then used for the T2 measurement in wave W0B on the same day. The figures and the verdict are in [results/t2.md](results/t2.md); the figures quoted further down this note come from single ungated dry runs and are harness checks, not results.

## What it is

One Node script, `D:\dev\spikes\t2\t2.mjs`, that launches each shell hidden against the same fixture backend, drives the page over the Chrome debugging protocol, and writes one raw JSON file per run. It adapts `desktop_research/spike_rust/scripts/drive.mjs`, `home-probe.js` and `mem.ps1`, and copies the heavy set from `desktop_research/spike_webview2/bench_browser.py`.

| Part | Where |
|---|---|
| Electron 44.5.1 shell (one `BrowserWindow`, `show: false`, `paintWhenInitiallyHidden: true`, `backgroundThrottling: false`) | `D:\dev\spikes\electron\main.js`, `preload.js` |
| Tauri baseline, unchanged | `D:\dev\spikes\tauri-shell\src-tauri\target\release\nq-shell.exe` with its three Chromium switches |
| Fixture backend, same origin as the page | `fixture_app` on port 8800 (the harness starts it and stops it) |
| Page JavaScript (probe, wait-for-screen, pivot) | derived from `pagejs.py` by `D:\dev\spikes\t2\gen_pagejs.py`, not retyped |
| Global window and foreground watch | `D:\dev\spikes\t2\lib\winwatch.py` |
| Raw records and logs | `D:\dev\spikes\t2\raw\<session>\` |

Ports: backend 8800, Electron debugging port 9351, Tauri debugging port 9352. Port 8765 is refused in code.

## Method

Each run, in this order:

1. **CPU gate.** The total CPU load is read for 60 s (OS tick counters, one sample a second). An average above 10% rejects the run: the record is written with the readings and the run is not launched. With `--provisional-after N` the run goes ahead after N rejections in a row, labelled PROVISIONAL, with the readings kept (manager decision 2). After `--max-rejects` (default 5) the slot is recorded as abandoned.
2. **Window watch starts.** A separate process samples `EnumWindows` over all processes every 100 ms and `GetForegroundWindow`, and hooks `EVENT_OBJECT_SHOW` and `EVENT_SYSTEM_FOREGROUND` so a window shown for less than one tick is still seen. Any new visible top-level window, or any change of the foreground window, marks the run `window-fail`. Cloaked and zero-size windows are ignored. One class is recorded as inert and does not fail a run: a layered, click-through, no-activate tool window of at most 5 by 5 pixels at (0, 0), class `Tao Thread Event Target`, which Tao (the event loop under Tauri) creates at start. It cannot be seen. The watch sees every process, so inert windows made by other work on the PC also appear in the record.
3. **Launch.** `windowsHide: true`, no focus. The page loads at once and the probe runs before the page scripts (preload for Electron, initialisation script for Tauri, both in the main world). Launch to HOME ready is spawn time to the `nqt:home-ready` mark, from `performance.timeOrigin`. `nqt:home-frame` is recorded beside it. The marks are set after two animation frames, with a 400 ms timer fallback that sets `nqt:home-ready:timer`. A `-dom` variant is set at once and is recorded as `coldStartToHomeReadyDomMs`.
4. **Memory at HOME.** After 2.5 s idle, whole-tree private working set from `Win32_PerfFormattedData_PerfProc_Process` for the launched pid and every descendant. Working set and private bytes are kept. Frame and timer rates over the same 2.5 s are recorded as `idleHealth`.
5. **Heavy set**, step for step as in `bench_browser.py`: media emulation (reduced motion, dark) and focus emulation, then `nt_dtsmom_v0_fixture_ts1 RUN`, the Perspective pivot over 8,411 synthetic fills answered by the harness through `Fetch.fulfillRequest`, `RR` (uPlot), `27F CORR` (ECharts), `NQ GIP 2011-01-20` (lightweight-charts), and six docked panels with Shift+Enter. Screens are opened through Ctrl+K, the line and Enter.
6. **Memory after the heavy set**, 3 s after the last step, same counters.
7. **Teardown.** The run's own root pid is stopped, then any descendant pid recorded during the run that is still alive and whose pid, creation time and image name still match is stopped by pid (never `taskkill /T`, never a bare pid). Nothing else is touched.
8. **Window watch stops** and its events go into the record.

Order across a session: backend start, a GET-only warm-up of HOME's API reads (as `bench_browser.warm_home_api`), `--warmup` discarded runs per shell (default 1, status `warmup`), then the measured slots interleaved Electron, Tauri, Electron, Tauri. Profiles are fresh per run: `D:\dev\spikes\electron\prof\<run>` and `D:\dev\spikes\t2\prof\<run>`. The session record (`session.txt`) carries the repository head, the diff hash, the hash of `web\dist\index.html`, the Electron and Node versions and the C: free space.

Statuses in a raw file: `accepted`, `rejected`, `provisional`, `failed` (no HOME ready), `window-fail`, `abandoned`, `dry`, `warmup`. Neither dry nor warm-up runs are ever counted.

## Commands

Set the environment for the shell first (this process only): `$env:TEMP='D:\dev\tmp'; $env:TMP='D:\dev\tmp'`. Node is 24.13.1. Then, from `D:\dev\spikes\t2`:

```
node t2.mjs --dry                          # one unmeasured run per shell, gate read for 5 s but not enforced
node t2.mjs --run --runs 10 --warmup 1     # the measurement (W0B only); add --provisional-after 3 if the load stays high
node t2.mjs --verify-results <session dir> --need 10
node selftest.mjs --gate | --throw | --watch | --verify
```

Other options: `--cpu-limit 10`, `--gate-seconds 60`, `--max-rejects 5`, `--shells electron,tauri`, `--no-heavy`, `--out <dir>`, `--electron-switches`, `--electron-mode hidden|osr`.

`--verify-results` counts the runs of each status (accepted, rejected, provisional, failed, window-fail, abandoned, dry, warm-up) per shell from the raw files, lists the rejected runs that were kept, and applies the T2 rule of 02 section 6.5 twice: to accepted runs only, and to accepted plus provisional runs. The rule is read as written: Electron's median private memory at least 15% lower at HOME and after the heavy set, or its median launch to HOME ready at least 300 ms faster, and in either case Electron's median below Tauri's worst run on that metric.

Installing Electron: `npm install --save-exact electron@44.5.1` with `npm_config_cache=D:\dev\npm-cache` **and `electron_config_cache=D:\dev\electron-cache`**. This version of the installer reads the lower-case variable; `ELECTRON_CACHE` is ignored, and the first install put the 158 MB archive under the local app-data folder on C:. It was moved to `D:\dev\electron-cache` straight away (C: free space returned to its earlier value).

## Self-tests (all passed)

| Test | Result |
|---|---|
| `--gate`: a planted spin of 8 busy processes for the 60 s gate makes the next run `rejected`; the record is on disk with 60 readings; the control without the spin is `accepted` | control 3.4% (limit 10%), spin 29.1%; `--verify-results` counted 1 accepted, 1 rejected |
| `--throw`: a planted throw (from a timer, so it is a true uncaught exception) exits with code 70, writes an `uncaughtException` line, and no window or foreground change is seen; the control stays alive | 5 of 5. Born failing: the first version threw inside the ready promise, which is an unhandled rejection, and exited 71; the check failed until the throw was moved |
| `--watch`: a planted 120 by 80 tool window on screen 2 (no activate, 1.5 s) is detected (by the show hook) and fails the run; the control is clean; the watch ticks stayed at 100 ms | 3 of 3 |
| `--verify`: counts per shell, dry and warm-up excluded, T2 fires on a 25% memory gap, does not fire on a 4.8% gap, and (added at the W0B merge) does not fire when only the heavy-set memory is 15% lower | 7 of 7 |

A defect found by the first dry run and fixed before the rest: the gate function was called with an object instead of the number of seconds, so the dry gate read 0 s. The self-test gate numbers above are from after the fix.

## Dry runs

One per shell, spec configuration (`hidden`), both reaching HOME ready with 0 new visible windows and 0 foreground changes. Log: `D:\dev\spikes\t2\raw\dry-final` (earlier full run: `raw\2026-10-02T04-11-04-744Z-dry`). The backend answered on 8800 and nothing under `terminal\state` changed. C: free space before and after: 125,056 and 125,054 MB.

Self-test logs: `raw\selftest-2026-10-02T04-08-56-201Z` (gate), `raw\selftest-2026-10-02T04-17-05-942Z` (throw), `raw\selftest-2026-10-02T04-08-47-646Z` (watch), `raw\selftest-2026-10-02T04-02-52-212Z` (verify).

## Finding before W0B (settled in results/t2.md): a hidden Electron window gets almost no animation frames

In the dry runs the hidden Electron window reported `visibilityState` `visible` and ran timers at the normal rate, but `requestAnimationFrame` ran at about 0.8 a second at idle (the Tauri window, with its three switches, ran about 240 a second). Consequences seen in the dry record, not measurements:

- HOME ready was reached only through the 400 ms timer fallback (about 3 s against about 1 s for Tauri), and `home-ready-dom` came at about 2.6 s, so the page itself waited on frames.
- The heavy set was slow on the screens that wait for paint (pivot about 3.2 s against 0.6 s, GIP about 2.2 s against 0.4 s), and the last docked panel timed out after 45 s (cause found in W0B, see "Dock wait" below; it is not frame starvation).
- The three Chromium switches did not help in Electron. Attaching a frame subscription (`beginFrameSubscription`) did not help. `disableHardwareAcceleration` did not help. Raw files: `raw\diag-hidden-b`, `raw\diag-mode-subscribe`, `raw\diag-mode-nogpu`.
- Offscreen rendering (`--electron-mode osr`) is the only mode that restored frames: 60 a second, HOME ready at about 0.84 s, but 225 MB at HOME against 154 MB, because it changes the rendering path (`raw\diag-mode-osr`).

So the specified hidden Electron configuration cannot give a launch-to-HOME-ready figure that is comparable with the Tauri baseline, and its memory may be understated because nothing is being painted. This is the Electron form of the hidden-window trap in `00_spike_webview2.md`. A fair reading needs an owner decision before W0B: keep `hidden` and report the figures with this caveat, use `osr` and report that its memory carries the offscreen path, or allow a window shown without focus on screen 2 (decision 10), which the watch as specified would fail and which would need a window of the screen's width rather than 1600 by 1000. The harness records `idleHealth` in every run so the caveat is measured each time.

## Dock wait (found and fixed in wave W0B)

The wait of `bench_browser.py` for a screen (the panel title present, no `p.ws-empty`, no `aria-busy="true"` anywhere) timed out at 45 s on the sixth docked panel, `volmanaged_v0 DES`, in every hidden Electron run and in 6 of 10 offscreen runs, and never in Tauri. A diagnostic launch (`D:dev	mpdiagdiag.mjs`, not a measurement) showed the cause is in the page, not in the shell. With six panels docked the panel is 198 px wide, the chart toolbar wraps to 160 px, the chart box collapses to height 0 and uPlot never reports a first draw, so the three chart containers keep `aria-busy`; Tauri ends in the same state, with the same layout to the pixel and no script error. The strict wait passed in Tauri only because it ran before those charts mounted. A screencast, a device-metrics override and `Page.bringToFront` changed nothing in Electron. `lib/dockwait.mjs` now waits for docked panels with a test that ignores a busy container whose box has no height (and still waits for any busy container that has a height); `dockwait.test.mjs` (7 cases) was written first and failed. A run with any heavy-set error is `heavy-incomplete` (`lib/heavy.mjs`, `heavy.test.mjs`) and never feeds the heavy-set median.

`--verify-results` takes one session folder at a time: it refuses a folder that mixes Electron modes, switches, heavy flag or batches (exit 3), and counts "enough" per metric, not per run. Records written before the mode was recorded need `--assume-unrecorded-mode hidden|osr`.

## Not done in wave W0A

No gated run, no T2 figure, no medians (taken in wave W0B, see results/t2.md). The `msedgewebview2` processes left running by earlier work were not touched.

## Correction made at the W0B merge

The first version of the evaluator in `lib/records.mjs` combined the two memory readings with "or", while 02 section 6.5 says "at HOME and after the heavy set". It was changed to require both, with a born-failing synthetic case first (heavy-set memory 23% lower, HOME memory 7% lower: must not fire). `node selftest.mjs --verify` now passes 7 of 7, and the printed `fires` block carries `memHome`, `memHeavy` and `faster` separately, with `memBoth` beside them. The recorded counts were not affected. The T2 verdict in [results/t2.md](results/t2.md) was written from the document, not from the old evaluator.
