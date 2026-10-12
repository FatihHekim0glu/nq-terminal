# w4b-startup-spawn, slice spawn-first

Status: the shell now starts its supervisor, and with it the backend's spawn, before the window and its WebView2 are built (startup.md 7.2; 03 section 2.2 step 4, "in parallel with step 3"). The two new log lines are in, the harness reads them, and `report.mjs` fails a G2 launch whose spawn comes more than 150 ms after the shell's start line. The slice's tests pass. Measurements here are PROVISIONAL (see below); the A/B and the reliability run belong to the merge and the post-merge agent.

## What changed

- `main.rs`, `setup`: after the settings read (`window::resolve`), the write policy and the `start` line, `supervise::begin` starts the supervision loop; only then is the window built. Once the window and its hooks exist (`keys::install`, `window::setup`), `Early::attach` installs the navigation check and the health check and hands the window's sink to the loop. The rest of the order is unchanged. Two small helpers keep `setup` under 50 lines (`configure_writes`, `stale_hook`), and `lab_may_start` keeps a lab the lab check refuses from ever being spawned: the supervisor stays idle and `window::setup` refuses the start with its own `lab_refused` line and exit code 1, as before.
- `supervise_shell.rs`:
  - `begin(app, launch) -> Early` does what `start` did before the window existed: the smoke page server, the spec from the window options (or the smoke switches), the venv interpreter check (a refusal before any thread, as before), the contract range from the app's config, `Shared`, and the loop thread.
  - `start_loop(shared) -> Arc<Handoff>` spawns the `nqt-supervise` thread, whose first line is `supervise_thread_began`.
  - `Handoff` is the loop's sink until the window exists. Every call the loop makes before then (READY, a refusal, an exit) waits there and goes on to the window's sink, in order, once `give` hands it over. `abandon` answers fail closed: nothing shown, no rebuild, Quit. Only the first `give` or `abandon` counts.
  - `Early::attach(window, stale) -> Supervisor` replaces `start` on the built window. If a step fails, or the window is never built, dropping `Early` stops the loop and abandons the handoff, so the backend ends with the loop instead of waiting behind a fatal dialog.
  - The two repeat threads of the stopped page (the announcement and the exit note) share one helper, `eval_again`. Their behaviour is unchanged, and it kept the file under 800 lines.
- `supervise_run.rs`: the hung-page health check moved here as `health_check(shared)` (it reads `Shared` only), unchanged. `serve` now logs `supervise_ready` after `sink.ready` returns, not before it. The line keeps its meaning, "the window has the backend": with the handoff, `sink.ready` waits for the window. The hidden tests use it as their sign that the window is on the backend (close_confirm_event.rs, close_relay_seam.rs, hidden_window.rs, int1_seams.rs).
- `main.rs` manages the `Supervisor` as soon as `attach` returns, before the download hook, `crash::install` and `smoke::after_build`. The window can already be on the backend by then, so a close must find the supervisor's shutdown and its backtest question.
- `supervise.rs`: a `supervise_create_process` line just before `CreateProcessW` (after the job and the two pipes); the re-export is now `begin`. A `supervise_create_returned` line is logged the moment `CreateProcessW` returns (before any resume step on the fallback route), so the time inside the call reads as `supervise_create_returned` less `supervise_create_process`.
- The Job Object, the handshake, the proof, the refusal pages, the close relay, the shutdown and the single-instance behaviour are untouched. The single-instance plugin is set up in `Builder::build` (`initialize_plugins`, tauri 2.12.1 `app.rs:2607`), before the setup hook runs, so a second launch still exits before it could spawn anything.

## The 190 to 235 ms before the spawn

The old start had the supervise thread log `supervise_spawned` 190 to 235 ms after WebView2 was built. The new lines place the time before `CreateProcessW`, not the gap itself: the merge A/B did not reproduce the gap in the old order (see "not yet placed" in the merge note), and the slow spawns that remain are inside `CreateProcessW`. In a hidden smoke launch of this tree (fixture lab, close relay test, 12 October 2026 00:03 UTC). Other waves were loading the machine and no CPU gate was taken, so the reading is PROVISIONAL:

| Line | ms after `start` |
| --- | ---: |
| `supervise_thread_began` | 6 |
| `supervise_create_process` | 15 |
| `supervise_spawned` | 49 |
| `keys_installed` (WebView2 built) | 258 |

The spawn now lands before WebView2 is built. The thread start, the lock read, the job and the pipes took 15 ms, and `CreateProcessW` 34 ms, while the UI thread was building WebView2 at the same time. So the time before `CreateProcessW` is small, 15 ms here; where the old 190 to 235 ms went is not placed by this reading. Loader-lock contention, or scanning of the new process, add at most the 34 ms seen here. The sharper split needs the A/B launches of the merge (five each, interleaved, with the CPU gate).

All ten hidden smoke launches of the slice's test runs (fixture labs under `D:/dev/d4/hw`, 00:03 to 00:10 UTC, PROVISIONAL, no CPU gate), in ms after `start`:

| Launch | thread began | before CreateProcessW | spawned | WebView2 built |
| --- | ---: | ---: | ---: | ---: |
| closeask 00:03:41 | 5 | 11 | 111 | 376 |
| closerelay 00:03:47 | 6 | 15 | 49 | 258 |
| closeask 00:07:37 | 8 | 18 | 35 | 377 |
| closerelay 00:07:38 | 8 | 15 | 66 | 491 |
| smoke 00:07:46 | 8 | 17 | 59 | 286 |
| closeask 00:09:56 | 6 | 13 | 26 | 419 |
| closeask 00:10:01 | 5 | 11 | 132 | 363 |
| closeask 00:10:07 | 6 | 14 | 28 | 243 |
| closerelay 00:10:16 | 6 | 14 | 53 | 269 |
| smoke 00:10:21 | 6 | 11 | 50 | 312 |

Spawn offset: median 51.5 ms, range 26 to 132 ms, none over 150 ms. The time to the line before `CreateProcessW` stays at 11 to 18 ms. The spread is in `CreateProcessW` itself (15 to 121 ms), while the UI thread builds WebView2. That points at process creation contending with WebView2's start (loader lock, or scanning of the new process), not at the code before it. The two slow launches (111 and 132 ms) are the ones to watch in the gated A/B.

## The report check

- `lib/shelllog.mjs`: `milestones()` also returns `superviseThreadBeganMs`, `createProcessMs`, `spawnedMs` and `spawnOffsetMs` (`supervise_spawned` less `start`, both on the shell's clock). A line the log does not hold is `null`, never 0.
- `report.mjs`: `spawnOffsetCheck(records)` reads the counted G2 launches (modes `rows` and `first-launch`) and gives readings, the median, the worst, the launches over 150 ms and a verdict (`missing`, `over-ceiling`, `within-ceiling`, `within-target` with the target a median of 120 ms or less). The CLI puts it on the report as `spawnOffset`, prints a `check spawn_offset` line beside the other checks, and `overCeiling` adds one failure per launch over 150 ms, so `--check --strict` exits 4 on it. A launch whose log has no spawn line counts as unread, not as 0 ms. The edits are additive: new functions, one line in `overCeiling`, one in `reportLines` and one in the CLI.

## Tests

Born failing, run before the fix (outputs in `D:/dev/v04/w4b-startup-spawn/`):

- `born-failing-default.txt`: `cargo test --test supervise_spawn_early` against the 0.3.3 `main.rs` and a handoff stub that drops calls made before the window. 6 failed, 58 passed. The order scan failed with "the supervisor starts after the window build, so the spawn waits on WebView2". The refusal test failed with "timed out waiting for the refusal to reach the window's sink". The early-loop test failed with "timed out waiting for READY to reach the sink", and the three handoff cases failed too.
- `born-failing-node.txt`: `node --test` of the two harness test files against stub exports: 5 failed, 31 passed. Among them: "a launch with supervise_spawned 151 ms after start is flagged; one at 150 ms is not", and both shelllog cases (`undefined !== 30`, `undefined !== null`).

After the fix:

- `cargo test --test supervise_spawn_early`: 64 passed (default set), 67 passed (smoke set), under the HEAVY slot.
- `node --test desktop/harness/tests/shelllog.test.mjs desktop/harness/tests/report.test.mjs`: 36 passed. `node --test desktop/harness/tests/*.test.mjs`: 430 passed.
- `cargo clippy --all-targets --locked -- -D warnings` on all three feature sets (default, plus smoke or measure on their own): clean. `cargo fmt`: clean.
- The existing tests of the supervisor, the close and the window (HEAVY slot, `--no-fail-fast`, logs `smoke-suite-2.log` and `smoke-suite-3.log`): smoke set, every `supervise_*`, `close_*`, `window_*`, `hidden_window`, `setup_refused`, `link_host` and `source_size` test binary: 1,001 passed, 1 failed. The failure was `close_confirm_event`. That test waits for `supervise_ready` and then closes, and `supervise_ready` was logged before the window existed, so the close came while setup was still running and no supervisor was managed yet: no question, then the exit's shutdown. Fixed by the two changes above (`supervise_ready` after `sink.ready`, the supervisor managed at once). After the fix: `close_confirm_event` passed 3 runs of 3. The smoke group (close relay, hidden window, supervise_app, supervise_spawn_early, supervise_restart, supervise_spawn, window_lab, setup_refused, source_size) passed. The default set, every `supervise_*`, `close_*`, `link_host` and `source_size` binary, passed. In all, 1,135 passed and 0 failed.
- The hidden smoke tests need a page build in the tree they junction (`web/dist`). The worktree had none, so the first run failed `close_relay_seam` on `supervise_refused dist`. I built it once (`vite build` and `scripts/buildStamp.mjs`, `web/node_modules` a junction to the w2a tree). Both `web/dist` and the junction are ignored by git.

What `tests/supervise_spawn_early.rs` pins:

1. `main_starts_the_supervisor_after_the_settings_read_and_before_the_window_build`: the order inside `setup` (a scan of its source; the order cannot be driven without a window).
2. `the_loop_spawns_and_proves_its_backend_with_no_window`: with no window, a real fake backend gets through its spawn and its proof (`supervise_checked`). READY then reaches the sink given later, and the three lines come in order: thread began, then the line before `CreateProcessW`, then spawned.
3. `a_refusal_made_before_the_window_exists_reaches_the_window_built_later`: an HMAC refusal logged before any sink exists is shown (`stopped hmac`) once the sink is given.
4. Three handoff cases: calls before `give` wait and arrive in order; an abandoned handoff shows nothing, rebuilds nothing and answers Quit; a given sink answers for the window.
5. `refused_lab::a_lab_the_lab_check_refuses_is_never_spawned` (smoke set only; it starts the hidden smoke exe under the window watch): for each of the three required lab files taken away in turn, the start exits with the run code, logs `lab_refused` naming that file, logs none of `supervise_thread_began`, `supervise_create_process` and `supervise_spawned`, and its `setup_failed` error is not the supervisor's own "has no .venv". Born failing: with the guard in `main.rs` (`lab_may_start`) mutated to always allow the start, the test fails on the first lab ("no lab_refused", the error is the supervisor's "has no .venv"); with the guard it passes (79 passed in the smoke set). This case lived in `window_lab.rs` and `setup_refused.rs` until release fix 2 moved it here, because those two files are not in this slice's `owns`.

## Appendix A addendum (fate of new items)

| Item | Fate |
| --- | --- |
| `desktop/src-tauri/tests/supervise_spawn_early.rs` | new test file, kept |
| `supervise::shell::{begin, Early, Handoff, start_loop}` | new, replace `supervise::start`; kept |
| `supervise::run::health_check` | moved from `supervise_shell.rs`, unchanged; kept |
| shell log lines `supervise_thread_began`, `supervise_create_process` | new, kept (read by `lib/shelllog.mjs`) |
| `report.mjs` `SPAWN_OFFSET`, `spawnOffsetCheck`, `spawnOffsetFailures`, `spawnOffsetLine`; report key `spawnOffset` | new, kept |
| `lib/shelllog.mjs` `spawnMilestones` | new, kept |

No route and no Cargo dependency is added.

## Not done or unverified

- The A/B against 0.3.3 through A/B labs, the five gated hidden launches for the exit criterion (median 120 ms or less, none over 150 ms) and the 120-launch reliability run are merge and post-merge steps. The ten readings above are PROVISIONAL, ungated and from the smoke build on fixture labs.
- A close sent while the window is still being built (WebView2's creation runs a nested message loop) finds no supervisor and goes through without the backtest question. The backend has been spawned by then but is far from READY (about 1.5 s on the real lab), so it cannot be running a job yet. The exit ends it through the job, and dropping `Early` stops the loop. This edge is new with this change and is not covered by a test.
- `desktop/README.md` and `desktop/harness/README.md` are not this wave's files, so they are not edited; the text to paste is in the next section.

## Docs the change makes stale (for the manager)

Neither file is in the wave's `owns` or `merge_owns`, and the release check allows no other file in `git status`. When the manager owns them, make these two edits.

1. `desktop/README.md`, section "Modules and hooks", the paragraph that starts `main.rs` calls the hooks in this order. It names `supervise::start`, which no longer exists. Replace the part from `window::policy_check` to `writes::on_download_starting` with: `window::policy_check`; then the settings read and `supervise::begin`, so the backend's spawn runs while the window is built; then, on the built window, `keys::install`, `window::setup`, `Early::attach` (with the stale-page hook; it hands the calls the loop held back to the window, in order), `writes::on_download_starting`.
2. `desktop/harness/README.md`, after the paragraph that ends "keeps provisional figures apart from accepted ones.", add a paragraph: `report.mjs` also adds `check spawn_offset`: a counted rows or first-launch launch whose `supervise_spawned` comes more than 150 ms after start fails `--check --strict` (exit 4); the target is a median of 120 ms or less. The check is read per build, and a counted launch with no spawn reading, or a build with fewer than `--min-runs` readings, also fails it (a lost shell log cannot pass). The shell log carries two lines for it, `supervise_thread_began` and `supervise_create_process`, the second written just before `CreateProcessW`.
