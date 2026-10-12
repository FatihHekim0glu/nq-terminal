# CI hygiene: the hosted runs that failed at random

Branch `v04/ci-hygiene`, from main at `a633b50`. The task: make main's hosted CI stop failing at random without lowering a bar. No threshold, ratio or budget is changed, no test is skipped or deleted, and no functional test is retried. What changed is how two perf figures are measured, what the smoke tests wait for, and what the desktop runner fetches before its tests.

## The runs read

Every run of `ci.yml` (43 runs, 5 to 12 October 2026) and `desktop-check.yml` (19 runs, 11 to 12 October 2026) on `main` and `v04/*`, every attempt of each (`gh api .../runs/<id>/attempts/<n>/jobs`), and the log of every failed job (`gh api .../jobs/<id>/logs`), plus the log of every offline end-to-end job that passed, for the figures it prints. 62 runs in all; the newest 60 of the two workflows are among them. The runs of main's `a633b50` (ci 38211046241, desktop-check 38211046256) were still going when the table was drawn; they finished while this branch was under way and are counted: ci failed on the MonitorGrid ratio once more, desktop-check passed.

## Failures per test

Completed attempts: 19 of the `offline end-to-end tests` job (ubuntu-latest, `--workers=2`), 18 of `clippy and tests (smoke)` and 18 of `clippy and tests (measure)` (windows-2025), 45 of `web checks and script tests` (windows-2025).

### Random failures (the subject of this branch)

| Job | Test | Failed | Failing value | Passing values | Runs (attempt) | Cause |
|---|---|---|---|---|---|---|
| offline e2e | `gallery-grids-tiles.spec.ts` MonitorGrid, 10,000 rows scroll smoothly: frames over 33.4 ms under 5 percent | 7 of 19 | 0.0823 (41 of 498), 0.0823, 0.0763 (38), 0.0723 (36), 0.0723, 0.0643 (32), 0.0622 (31), each with p95 33.400000000000546 | 0.004 to 0.046 (2 to 23 of 498) | 38207964211 (0.0823), 38197225288 attempt 1 (0.0823), 38197225288 attempt 2 (0.0763), 38207205902 (0.0723), 38211046241 on `a633b50` (0.0723), 38206827034 (0.0643), 38167043856 attempt 1 (0.0622) | measurement: float noise counted 33.4 ms frames as over 33.4 ms (below) |
| offline e2e | the same test: p95 frame under 34 ms | 1 of 19 | p95 50 ms, max 66.7, 58 frames over 33.4 ms (0.116) | p95 16.8 to 33.4 | 38208790257 (`v04/w3b-wkndshort`) | a slow runner: more than 5 percent of frames took three vsyncs |
| offline e2e | `gallery-linestack.spec.ts` 250,000 points per pane drawn in under 100 ms | 2 of 19 | builds 142.8, 30.1, 29.4 ms and 134.7, 69.9, 28.9 ms: the first (cold) build missed each time | not printed on a pass (a test annotation only) | 38197225288 (2), 38207205902 | variance of a shared runner on the cold build: the second worker runs another spec at the same time |
| desktop-check smoke | `window_env.rs` `webview2_canaries_never_reach_the_engine_or_the_shell` | 2 of 18 | `the page never loaded: {}` (window_env.rs:165) | | 38192698256 (1), the w1 merge `268112e`; 38208492133, the w4a merge | readiness: the script read the blank document (below) |
| desktop-check smoke | `window_stopped_page.rs` `each_stopped_reason_is_announced_by_title_and_focus` | 2 of 18 | `first_title: ""`, `title_exited: "nq-lab terminal: stopped"` where "The backend stopped." was due | | 38207205917, the w5 merge; 38208790266 (`v04/w3b-wkndshort`) | the same |
| desktop-check smoke | `keys_cdp.rs` `browser_keys_do_nothing_and_page_keys_reach_the_page` | 1 of 18 | `"url": "about:blank"`, `marker` null before the keys, a marker after them, so "the page reloaded" | | 38208790266 | the same |
| desktop-check smoke | `window_page.rs` `the_page_gets_the_shell_object_and_no_new_window` | 1 of 18 | `shell: null` with the page target already listed | | 38165243344 (`v04/w2b-ci-msvc`, `fa1854c`) | the same (before `f447f72` added a reload to this one test) |
| desktop-check smoke and measure | `identity_split.rs` (2 tests), `smoke_feature_absent.rs` (1), `ipc_refusal.rs` (2, smoke only) | 1 run, both sets | `failed to download tauri-plugin v2.7.1 ... --offline was specified`; `no source of tauri-plugin-single-instance 2.5.2 under ...\registry\src` | | 38168877977 (1), the w2b merge `a2113d1` | a cold cargo cache: the smoke and measure sets never build the release-only crates their tests read |
| web checks | `PowerPanel.test.tsx` is a region after the Deflated Sharpe region | 1 of 45 | `findByRole` gave up after testing-library's 1 s default (the case took 1,373 ms) | | 37691474042 | a loaded runner; already fixed on main by `555c4dc` (`asyncUtilTimeout: 5000` in that file, citing the run) |

`save_outcome` is not a failure. `save_outcome::tests::a_copy_of_the_crate_fails_when_the_seams_are_required` is a `#[should_panic]` test: its expected panic (`NQT_REQUIRE_SEAMS=1 but browser.ts cannot be read`) is printed in every smoke log, followed by `should panic ... ok`. The same holds for `int1_seams.rs` `a_tree_that_is_not_the_lab_fails_when_the_seams_are_required`.

### Failures that were not random (fixed by a later commit, for the record)

| Run | Commit | Failure | Fixed by |
|---|---|---|---|
| 38163832316 (all sets and coverage) | `c1c9ebe` | 4 tests of the built-in Administrator's SDDL | `882d8c4` |
| 38164591015 (smoke) | `882d8c4` | `zoom_and_size_reach_the_page_and_the_window`: the hosted desktop is smaller than 1280x800 | `fa1854c` (on `RUNNER_SKIPS`, with its reason) |
| 38162672294, 38168877978 (web checks) | `d4a4bd9`, `a2113d1` | the tag `desktop-v0.3.2` was not fetched | `569f011` |
| 37272364751 (web checks) | `c5bf39f` | `Get-FileHash` not found under pwsh's module path | `d1abef7` |
| 37272142344 (web checks) | `5038663` | TS2591, `process` in a test without Node types | `c5bf39f` |
| 37270559256 (web checks) | `6cac154` | the 5 s and 20 s test timeouts on the 4-core runner | `5038663` |

## The fixes

### 1. MonitorGrid: frames read at the clock's grain (a measurement bug)

Chromium gives `requestAnimationFrame` and `performance.now()` times in steps of 0.1 ms. A frame that spans two vsyncs (2 x 16.67 ms) reads 33.3 or 33.4 ms, and the budget's threshold `f > 33.4` sits just above it: two-vsync frames pass, three-vsync frames (50 ms) count. But the interval was a difference of two floats, which leaves noise in the last bits, and `33.400000000000546 > 33.4` is true while `33.399999999999636 > 33.4` is false, so a 33.4 ms frame counted or not by chance.

The runs prove it. In each of the seven failures of the ratio, p95 (the frame at index 473 of 498) was 33.400000000000546, so at most 24 frames were longer than 33.4 ms at the clock's grain. The count was 31 to 41, so 7 to 17 of the counted frames were 33.4 ms frames. Read at the grain, those runs had at most 24 frames over, 4.8 percent: under the 5 percent bar.

`web/e2e/support/perfMeasure.ts` `frameStats` rounds each interval to the 0.1 ms grain (`Math.round(ms * 10) / 10`, which gives the same double as the literal 33.4) before ranking and counting. The page now returns the raw intervals and the stats are taken in Node. The threshold (33.4 ms), the ratio (0.05) and the p95 bar (34 ms) are unchanged.

### 2. The two gallery perf figures: one quiet retry on CI, both attempts logged

`measureWithQuietRetry` (same file) takes a measurement and runs its perf-only check. On CI alone (`process.env.CI`, set by GitHub Actions), a first miss is logged with its reason and the measurement is taken once more on a fresh load of the gallery entry; the second attempt decides and is logged too. Off CI a miss fails at once, as before. Anything the measurement itself throws (a functional check, a page that does not load) is never retried.

- MonitorGrid: the retry covers the p95 and the over-33.4 ms ratio only. Enough frames (over 400) and the virtualisation (under 120 rows in the DOM) are checked on every attempt and never retried. The p95 50 ms run (38208790257) is the case it is for: a second measurement, not a different bar.
- LineStack: every build of the attempt, cold build included, is held to 100 ms; the image label is checked on every attempt. Each attempt's builds are also a test annotation.

The log lines read `perf <label>, attempt 1: {...}`, then on a miss `perf <label>, attempt 1 missed (<reason>); measuring once more, CI only` and `perf <label>, attempt 2: {...}`. The MonitorGrid line keeps its label, so the old grep for `MonitorGrid.large scroll` still finds it.

### 3. Smoke tests: wait for the page itself, not the blank document

The four smoke tests share `tests/window_harness.rs` `cdp()`, a Node script that finds the page target by its URL and waited for `document.readyState === 'complete'` before running the test's body. WebView2's debugging list names a target by the address it is navigating to while the blank document it starts with can still be the one that answers, and that document (`about:blank`) already reads complete. On a slow runner the wait passed on `about:blank` and the body read an empty page: no marker (`window_env`, `keys_cdp`, which printed `"url": "about:blank"`), no title (`window_stopped_page`, `first_title: ""`), no shell object (`window_page`). `tests/downloads.rs` had already met this and waits for both its address and `complete`.

The wait (`PAGE_WAIT`) is now `location.href.startsWith(<prefix>) && document.readyState === 'complete'`, polled every 100 ms up to the same 30 s. Every caller passes the address of the page it expects, and the stopped page's `#exited` fragment still starts with its prefix. The bodies and their assertions are unchanged. The reload `f447f72` put in `window_page.rs` is left as it is.

### 4. desktop-check: fetch every crate of the lockfile before the tests

The smoke and measure sets never build the release-only crates (the tauri plugins), yet `identity_split.rs` and `smoke_feature_absent.rs` run `cargo tree --offline` over the release graph and `ipc_refusal.rs` reads `tauri-plugin-single-instance`'s source under `CARGO_HOME`. They passed only when the restored registry cache held those crates; the first run on main after the w2b merge had a cold cache and failed both sets. The rust job now runs `cargo fetch --locked --target x86_64-pc-windows-msvc` after the cache step, so the crates are there whatever the cache held. No test changed.

## Tests added

- `web/e2e/support/perfMeasure.test.ts` (vitest, 12 cases): a 33.400000000000546 ms frame is not over 33.4 ms while 50.1 ms is; the percentiles are indexed as the spec indexed them; the worst case of a failing run (41 noisy 33.4 ms frames, 24 frames of 50 ms) reads 24 over, under 5 percent; the retry measures once when within budget, twice on a CI miss with both attempts logged, never a third time, never off CI, and never after a failure inside the measurement. Born failing: without the rounding the first case fails.
- `tests/window_harness.rs` `the_page_wait_passes_over_the_blank_document_to_the_page_itself`: node runs `PAGE_WAIT` itself against an `evaluate` that answers blank and complete twice, then the page loading, then the page loaded under `#exited`; the wait must stop at the fourth answer. Born failing: the old wait stopped at the first (checked with node on the lab PC: 1 answer before, 4 after). Being in the harness, it runs in every smoke test binary that includes it, as the harness's other self-tests do.
- `desktop/harness/tests/desktop-check-workflow.test.mjs`: the rust job must run `cargo fetch --locked` before `cargo test`, with a planted copy that drops the fetch and one that moves it after the tests, both caught.

Checked on the lab PC: the new vitest file (12 passed), `tsc -p e2e/tsconfig.json`, `node --test` of `desktop-check-workflow.test.mjs` (14 passed, actionlint and the YAML parse included) and `ci-rust-job.test.mjs` (16 passed), `rustfmt --check` of the harness, and the composed CDP script under `node --check`. Not run here: cargo clippy and cargo test (under 10 GB of free memory) and Playwright; the hosted runs below are their check.

## Hosted runs of this branch

The push of `f6a7512` started `ci` 38212618068 and `desktop-check` 38212618147; each was rerun twice (`gh run rerun`), three attempts in all.

| Attempt | ci | desktop-check | MonitorGrid scroll (at the grain) | LineStack builds, ms | Smoke tests of fix 3 |
|---|---|---|---|---|---|
| 1 | success, 6 of 6 jobs; offline e2e 190 passed in 12.9 min | success, 6 of 6 jobs | p95 33.4, max 66.7, 12 of 498 over 33.4 ms (0.024) | 65, 49.6, 17 | all pass; the harness test passes in all 9 binaries that hold it |
| 2 | success, 6 of 6; 190 passed in 13.3 min | success, 6 of 6 | p95 33.4, max 66.6, 15 over (0.030) | 76.3, 71.5, 20.1 | all pass |
| 3 | success, 6 of 6; 190 passed in 12.1 min | success, 6 of 6 | p95 33.4, max 50.1, 16 over (0.032) | 63.3, 44.6, 19.7 | all pass |

Each attempt met both perf budgets on its first measurement, so the quiet retry did not fire on the runner; its paths are covered by the unit tests. The new fetch step took about 19 s on a warm cache. The branch restored main's registry cache, so the cold-cache path of fix 4 was not met here; the guard test keeps the step in place.

## Left for the manager

1. MonitorGrid's two bars are one bar once frames are read at the grain. At a 60 Hz frame clock no frame falls between 33.4 and 34 ms, so for 498 frames a p95 under 34 ms leaves at most 24 frames (4.8 percent) over 33.4 ms, and the ratio can no longer fail without the p95 failing too. If its intent was also to limit two-vsync frames (33.3 and 33.4 ms, one dropped frame each), that is a different bar (a threshold near 17 ms and a ratio for it), which is the manager's call, not a measurement fix.
2. The source of the variance is the second worker: `offline-e2e` runs the `offline` project with `--workers=2` on a 4-core runner, so the two perf figures share the CPU with whatever spec the other worker runs. Moving the two perf tests to a one-worker project (as `offline-perf` is for the budgets) would remove it; that changes the job's layout and run time, so it is left as a choice.
3. LineStack misses only on its cold build (134.7 and 142.8 ms against warm builds of 29 to 70 ms). It stays held to 100 ms on every attempt. If misses survive the retry, the honest options are a different bar (a warm-up build before measuring, so the cold build is no longer gated) or a quieter runner; either is the manager's call.
4. Not a flake, seen while reading: `ipc_refusal.rs` waits for a target by URL only, and its verdict counts a page with no IPC object as refusing by absence. On the blank document of fix 3 that would pass without checking a command. It has not failed, so it is not changed here; the `PAGE_WAIT` condition would close it.
