# 04: Roadmap for the desktop terminal

Step 04 of the desktop migration. Step 02 decided what to build and step 03 said how, piece by piece. This step turns the 39 work items of 03 into phases D0 to D8 that a build workflow can run one after another, in the shape of the terminal's own build plan: each phase has a goal, tasks with file ownership per parallel build slice, a QA gate, exit criteria with numbers, effort, dependencies, and the owner's decisions and actions. A milestone table with a timeline closes it.

- Date: 2 October 2026. Repository `nq-terminal` (the `terminal` folder of nq-lab), HEAD `c7f9e61` (v2).
- Status: **roadmap**, built on `02_decision.md` and `03_migration_plan.md`, which it does not reopen. Where it adds something 03 did not name, or departs from a row of 03's Appendix A, it says so in place with the words "added by this roadmap" (among them a `smoke.rs` module for test hooks, a `window.rs` module, a hidden measurement build, a stage C in D4, a release check script, an SSH configuration check, and owner decisions about pushes, quiet-machine windows and the kit's route to the Mac).
- Labels as in 02 and 03: **measured**, **sourced**, **estimate**, **unverified**. Every effort and calendar figure here is an estimate.
- Paths are relative to `C:\Users\Fatih Hekimoglu\nq-lab\terminal` unless they start with `D:\`. `PY` means `"C:\Users\Fatih Hekimoglu\nq-lab\.venv\Scripts\python.exe"`. Item numbers such as 1.2b are the work items of 03 section 21.
- This step ran no app, opened no window, started no server and measured nothing.

## How to read this roadmap

### Units

- **Build slice:** one unit of build work that owns a set of files no other slice in the same stage may touch. A phase has at most four slices at a time. Where slices need a shared foundation, the phase runs as stage A, then stage B, as the terminal's own build plan does, and stage A writes the signatures that stage B fills, so ownership of those files passes from A to B.
- **Build run:** one build workflow (the slices of a phase, stage A then stage B where there is one, and in D4 a stage C), then one QA workflow (at most four reviewers), then an improvement run that fixes every CRITICAL and HIGH finding and every local MEDIUM one. A release phase has two QA workflows.
- **Owner session:** time the owner gives in person: a Mac session, a visible-window check on the PC, a reboot, a decision.
- **Calendar days:** elapsed days, counting weekends, from Day 1, the day phase D1 starts.
- **Phase go (added by this roadmap, from 05 S10):** before each phase starts, the lead shows the owner the planned slice count, reviewer count and expected run hours, and the phase starts only on the owner's go. Mechanical slices (file moves, the test-client rewrite, stubs) use lighter workers; the strongest setup is kept for the security and numerics reviews.

### Pace: one planning basis, and a scenario beside it

**The planning basis is the focused-week figure, as 05 section 2.3 requires:** 18 to 32.5 focused weeks of build work (02), and **32.5 focused weeks is the figure for any calendar commitment**, moved only after the first stage 2 item (D4.1) gives a real ratio of actual to estimated time. Counted as one focused week per calendar week from Day 1, the high end puts M6 (the Mac app passes G2) at about 21 May 2027 and M8 (both dual runs closed) at about 18 June 2027. Progress is reported in focused weeks, not dates (05 S09). Elapsed time may be a multiple of focused time, since the owner also runs the weekly portfolio work and the research (05 S09), so even these dates are not promises.

**A faster scenario, labelled as untested.** The terminal's own build log (`docs/TASKS.md`, local) records a much faster pace for web-only build runs: the plan was written on 26 September 2026, Phases 0 to 12 were built by 1 October. If the desktop runs went at a similar pace, a build run would take 1 to 3 calendar days (estimate) plus fixed waits, and the whole migration would close in about 54 to 85 days. That pace ratio is **untested for this kind of work**: those runs had no Rust, no CI, no owner-gated pushes and no Mac. The scenario compresses D4 (3.75 to 5.75 focused weeks) into 5 to 10 days and D7 (4.0 to 5.5 focused weeks) into 4 to 8 days, a factor of 5 to 10 that nothing measured supports yet. The scenario columns below are a hypothesis that D1 and D4 either confirm or retire.

Why the desktop work is slower per run than the web-only runs, for reasons known now:

- **Rust is new to the repository.** A cold release build of the spike shell took 4 min 14 s on this PC under load (measured, `00_spike_rust.md`), and every Clippy or deny finding costs a rebuild.
- **The release host is not on this PC.** There is no MSVC toolchain here and nothing may be installed on C:, so MSVC builds run on GitHub's hosted Windows runner. Each CI loop needs a push, and under the default of O15 (no standing go) every push waits for the owner. **Each CI loop is counted as one day of owner latency** in the scenario: 2 to 4 loops in D4 and 1 to 3 in D5 (estimate).
- **Measurement needs a quiet machine,** and the owner uses this PC, sometimes for a full-screen game. Budgets are measured only in windows the owner names.
- **Some checks are people, not scripts:** the Mac sessions, a real-keyboard check, NVDA, Narrator and VoiceOver passes, a reboot before the first-launch measurement, and two four-week dual runs. The scenario assumes each is had within a day of asking; the planning basis does not.

### Recalibration

- **End of D1 (first check, numeric rule).** If D1 took more than 4 calendar days (the scenario's slow end), the scenario columns are dropped and every remaining date is read from the planning-basis column only. If it took 4 days or fewer, the scenario stays as a hypothesis, still not a commitment.
- **End of D4.1 (05 section 2.3).** The ratio of D4.1's actual focused time to its estimate is the first real ratio for stage 2. The planning figure of 32.5 focused weeks is scaled by that ratio for the remaining phases, and the owner is told. If D4 as a whole runs past the scenario's slow end (10 days), the scenario is dropped as above.
- **After every later phase:** compare the phase's actual time with both columns and report it in focused weeks.
- After D5, replace the desktop budget targets with figures from the quiet-machine run, as 02 section 4 asks. Ceilings stay.

## Standing rules for every phase

1. Read `docs/desktop/02_decision.md`, `03_migration_plan.md` and this file, plus the terminal's architecture and UI documents, before any change.
2. TDD: write the test, see it fail, implement, see it pass. Every guard gets a born-failing case that feeds it the broken state and sees it fail.
3. Never write under `results/`, `backtests/output/`, `data/` or `live/`. Never call `serve_sealed`. Never read parquet outside `nq_lab.data.serve`.
4. **No visible windows on this PC during automated runs.** Browsers run headless; a desktop window is created hidden (Tauri `visible(false)`, Electron `show: false`, WebView2 with the controller made visible behind a hidden window, as the spike did) and closed at once. A shell build that an automated run launches is always the `smoke` build or the hidden measurement build of D4.1, in which the window's `show()` is never called; the release build is never launched by an automated run. Any check that needs a visible window or real keys is an owner action, done when the owner chooses. A launcher started by a test never opens a browser (D2.3).
5. **Nothing is installed on C:.** Toolchains, caches, spike projects, build output and WebView2 profiles live under `D:\dev`, with `RUSTUP_HOME=D:\dev\rustup`, `CARGO_HOME=D:\dev\cargo`, `CARGO_TARGET_DIR=D:\dev\targets\<phase>-<slice>` (so no `target` folder is ever written under `desktop\src-tauri` on C:), `npm_config_cache=D:\dev\npm-cache`, `npm_config_store_dir=D:\dev\pnpm-store`, `PLAYWRIGHT_BROWSERS_PATH=D:\dev\ms-playwright` and `TEMP`/`TMP` set per process. pnpm cannot hard-link from a store on D: into a project on C:, so it copies: the `desktop` folder gets no `node_modules` of its own (the Tauri command line is the cargo-installed binary under `D:\dev\cargo`). The owner's permanent PATH and environment are never changed. **C: check (05 S07, every phase from D1 on, automated):** free space on C: is read before and after each build run; if it fell by 100 MB or more, or is below 10 GB at any reading, the run stops and the lead reports what grew.
6. Never touch the owner's running terminal on `127.0.0.1:8765`. Test backends bind port 0 or a named spare port. Never stop a Python process the run did not start.
7. One Playwright run at a time on this PC; the main project keeps its two-worker cap.
8. Python only as `PY`; Rust only through `D:\dev\cargo\bin` in the run's own process.
9. `pathlib` and explicit `encoding="utf-8"`; quote every path (the home folder has a space). Files under 800 lines and functions under 50, in Rust and TypeScript as in Python.
10. **No git writes by build runs.** The owner commits, pushes and tags, unless decision O15 gives a standing go for a `desktop/` branch. CI runs only on pushed commits.
11. The page gets no shell command and no plugin permission (03 section 2.1). A source scan enforces it from D3 on.
12. Prose in tracked files: UK spelling, no em or en dashes, plain words, and no tool or vendor names that the repository's commit hook refuses.
13. **One writer for the seam files (added by this roadmap).** While a desktop phase owns backend or web files, no other terminal build workflow runs on the repository. The slice-ownership rule covers phases that run at the same time too: a file owned by a slice in one phase may not be touched by a run of another phase until that slice ends (see D6 for the order between D6 defect runs and D7 and D8).
14. **Preflight at the start of every phase** (D1 to D8, not only D1): re-run `nq-lab/desktop_research/tools/plan/gen_03_tables.py` on the committed tree (0 unmapped rows, any new module gets a fate in a short addendum to 03's Appendix A) and record a fresh baseline of the counts in the D1 preflight. A phase starts from the owner's commit of the previous phase.
15. **Measurement runs alone.** A budget or a T2 figure is measured only inside an owner-named quiet window (O16), with no build run, cargo build or Playwright run active on the PC. The harness records the CPU load before each run and rejects a run whose average CPU load over the previous 60 s was above 10%; rejected runs are kept and counted, not deleted.

## Standard QA gate for desktop phases

**Reviewers, at most four per QA workflow, chosen by what the phase touched:**

- a Python reviewer for backend changes; a TypeScript reviewer (with the React checks) for page changes; a Rust reviewer for `desktop/` from D4 on;
- a **security reviewer** on every phase that touches auth, the write routes, the environment, subprocesses, the shell, downloads or packaging (D2 to D5, D8);
- an accessibility reviewer (WCAG 2.2 AA) on every phase with UI or keys;
- a **numerics verifier** on every phase that can change a served number (D1, D3, D5, D8): cached against fresh bodies, the crosscheck, served JSON against in-process JSON;
- a **measurement reviewer** on every phase with budgets (D0, D1, D3, D5, D7, D8): hidden window, medians, whole-tree private memory, quiet machine (standing rule 15, with the CPU load recorded per run), the backend each number ran against, the method written next to each number.

**Automated checks (all must pass, by phase):**

| Check | Command or place | From |
|---|---|---|
| Backend tests | `PY -m pytest backend\tests` | D1 |
| Research files untouched | sha256 of `oos_access_log.jsonl`, `ledger.csv`, `registry.csv`, `oos_openings.json` before and after; new gate lines all `caller="terminal"` | D1 |
| Crosscheck | `uv run --project qa python -m crosscheck --strict`: FAIL 0 | D1 |
| Page | `pnpm --dir web test:types`, `test`, `test:e2e-types`, `build` (bundle budgets) | D1 |
| Browser end to end | `pnpm --dir web e2e`, then `e2e:perf` alone; `e2e:offline` | D1 |
| Real-data smoke | `scripts\smoke_real.ps1` (behind the token from D2, app mode added in D5) | D2, D3, D5, D8 |
| C: free space | before and after each build run (standing rule 5) | D1 |
| Shell | in `desktop\src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` with the bans, `cargo test`, `cargo deny check`, `cargo audit`; GNU host on this PC, MSVC in CI | D4 |
| App | `desktop\harness` budgets, the hidden-window app smoke, the served-JSON comparison | D5 |
| Mac | the JavaScriptCore golden run, the self-test page, the WebDriver smoke set | D7 |
| Prose | the house prose lint on every changed Markdown file and on `web/src/copy/*.ts` | all |

**Improvement run:** as in the terminal's build plan. A phase is done only when no CRITICAL or HIGH finding is open and every automated check is green. Screenshot baselines change only for an intended change, with the reason stated.

**Terms used in exit criteria (added by this roadmap):**

- **Within noise:** each figure within 10% of the reference median, or inside the reference's own min to max range, whichever is wider.
- **Blocking defect:** a parity row red, a wrong number (any served value that differs from the browser terminal or the crosscheck), a gate or write-ban breach, or a crash of the shell or the backend. One occurrence resets a dual run's four-week count.
- **Manual check records:** every owner-run check (keyboard, screen readers, visible runs, the SSH check) is written to a dated file under `docs/desktop/checks/` (for example `2026-11-02_nvda.md`) with the build, the steps, the count passed and any finding.

**Trigger checks at phase ends** (02 section 6.5): T3 at the end of D1 and D3; T2 at the end of D0; T1 at the end of D0 and D7; T4 and T5 at the end of D5; T8 weekly from D5; T9 continuously; T10 at the end of D8.

---

## Phase D0: toolchain and a measured spike on both systems

**Goal.** Settle the three questions that can change the shell before any shell code is written: T2 (is Electron 44 clearly lighter or faster on this PC?), G1 (does the page pass on the Mac's WebKit?), and the Windows unknowns of 03 section 24 that a hidden window can answer. Covers 03 items 0.1 to 0.3d.

**Depends on:** nothing in the repository. It can start today and its build work runs beside D1 to D3. Its slices write only under `docs/desktop/spike_*` and `D:\dev`.

**Order inside D0 (so the T2 figures are not taken on a busy machine):** stage A is W1 and W3 (building and probing); stage B is W2's build of the Electron harness, then W2's measurement alone, inside an O16 quiet window, with no other D0 slice and no D1 to D3 build run active (standing rule 15).

**Already in place** (measured, `00_spike_rust.md`): rustc and cargo 1.99.0 on the `x86_64-pc-windows-gnu` host, rustup 1.29.1, the winlibs MinGW-w64 kit (GCC 16.2.0) for `windres`, the Tauri 2.12.1 spike shell and NSIS 3.11, about 4.95 GB on D:, nothing on C: but one directory link. No MSVC and no Mac toolchain.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D0.1 (stage A) Toolchain check and Windows unknowns. Confirm the D: toolchain; add `cargo-deny` and `cargo-audit` under `D:\dev\cargo`; record free space on C: and D:. Extend a copy of the Tauri spike (hidden window, controller visible) to probe: accelerator keys off through `with_webview` (F5, F12, Ctrl+F, Ctrl+P, Ctrl+R do nothing when sent over the debugging protocol); a blob export reaching `on_download`; the `ProcessFailed` event reached through `with_webview` when a renderer process is ended; `zoom_hotkeys_enabled(false)` | W1 | `docs/desktop/spike_d0/windows/**`; `D:\dev\spikes\d0-tauri` | Each probe answers yes or no with its log; no window shown; nothing written outside the two folders; the four answers replace "unverified" for Windows in the D0 results note |
| D0.2 Electron 44 measured for T2. Same harness as the Tauri spike (`nq-lab/desktop_research/spike_rust/scripts/drive.mjs`), `show: false`, caches and profile under `D:\dev\spikes\electron`, the page from a fixture backend on a spare port, the window closed at once. Whole-tree private memory at HOME and after the heavy set (the 8,411-row pivot and six more panels), launch to HOME ready; medians of 5; the Tauri spike re-run in the same session beside it; measured alone in a quiet window (order above), the CPU load recorded before each run | W2 (stage B) | `docs/desktop/spike_electron/**`; `D:\dev\spikes\electron` | A table of both shells, five accepted runs each (runs rejected for CPU load kept and counted), raw files kept; the T2 rule applied as written in 02 (Electron at least 15% lower memory at HOME and after the heavy set, or launch to HOME ready at least 300 ms faster) |
| D0.3 The Mac kit. A folder the owner runs on the Mac: (a) a golden runner for `web/src/quant` under JavaScriptCore that looks for the system `jsc` binary and, if none is found, runs the same goldens inside a hidden WKWebView; (b) the spike shell configured for macOS (hidden window, `NSAllowsLocalNetworking`, `on_download` logging); (c) a probe script that checks the G1 feature list against the offline demo API (`e2e/offline/vite.offline.config.ts`, a Node server, so no Python is needed on the Mac); (d) the numbers runner, five runs each, which writes beside every figure the backend it ran against (`demo` or `remote`); (e) a results collector writing JSON; (f) `RUNBOOK.md` with the owner's steps below. Dry-run (c) and (e) on Windows in a hidden Tauri window against the same demo API | W3 (stage A) | `docs/desktop/spike_mac/**`; `D:\dev\spikes\mackit` | The Windows dry-run passes every probe that does not need macOS; the runbook's commands are copied from a dry-run log, not typed by hand |
| D0.4 Owner's Mac session or sessions (below) | owner | `docs/desktop/spike_mac/results/` (copied back by the owner) | The G1 table filled: maths, features, numbers, Gatekeeper |
| D0.5 Results note and verdicts | lead, after the slices | `docs/desktop/d0_results.md` | T2 and G1 recorded with numbers and the rule applied; the four Windows answers; the Mac answers to 03 section 24; the owner's G0 answers |

**The owner's Mac steps (D0.4).** About 2 to 3 hours in one or two sittings (estimate). The runbook carries exact commands; in outline:

1. **Record the machine:** chip, macOS version and memory (`sw_vers`, `uname -m`, `sysctl -n hw.memsize`); the display's refresh rate and scale from System Settings, Displays. These set the frame target and canvas memory (G0). `sw_vers` is recorded again at the start of every later Mac session (05 P03).
2. **Space:** at least 15 GB free for the command line tools, Rust, `node_modules` and one `target` folder (estimate).
3. **Install the build tools for a desktop-only Tauri build:** `xcode-select --install` (the Xcode Command Line Tools are enough when not building for iOS, R1); Rust through rustup (`curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh`, R1), then `rustup toolchain install 1.99.0`; Node 24 and pnpm 11.5.1.
4. **Get the kit:** clone the repository at the D0 commit, or copy the `terminal` folder without `node_modules` (decision O17). Then `pnpm install` in `web`.
5. **Maths:** run the golden runner. Pass: every value within 1e-9 relative of the V8 answer.
6. **Features:** run the probe in a hidden window. Pass: Perspective ready on the wasm32 server; dockview drag and drop; the live stream in stream mode, not polling; `127.0.0.1` loads under `NSAllowsLocalNetworking`; text and image copy; a blob export saved through the download handler; the proposed Mac keys (Ctrl+Option set, Option+1 to 9, Cmd+K) reach the page.
7. **Numbers:** run the numbers runner, five runs, all against the offline demo API. Pass: shell painted within 1,000 ms; warm HOME within 1,500 ms; UI physical footprint at HOME at most 350 MB; the offline perf project's 8,411-row grid open within 500 ms; pan and zoom p95 within 25 ms. If the hidden window produces no frames for pan and zoom, run that one case visibly; the runbook says how. **These are engine-only figures:** the demo API answers from fixtures after a seeded 20 to 120 ms delay, which is an easier bar than real data (Windows warm HOME on real data was 1,642 ms median in the spike, `00_spike_rust.md`). They decide whether WebKit can render the page in budget, not what the owner will see in remote mode.
8. **Gatekeeper:** open the locally built `.app` from Finder; note any prompt; record `xattr -l` and `spctl --assess --verbose` on it. This answers whether a local build needs the Apple Developer Program (D9 of 02, unverified).
9. **Copy back** `results/*.json` and the logs to `docs/desktop/spike_mac/results/` on the PC.
10. **Remote-mode HOME (required once O3 is answered):** run the warm HOME case of step 7 against the PC's backend over an SSH tunnel, five runs, labelled `remote`. If O3 is answered with an install before the Mac session, this reading is a required G1 input. If not, it becomes the first required T10 reading of D8, taken before any D8 work other than S2.
11. **Hold macOS updates (05 P03):** from this session until M8, do not update the Mac's macOS without telling the lead. If `sw_vers` shows a new version at a later session, re-run steps 5 to 7 of the kit before any D7 or D8 work continues.

**QA gate:** security reviewer (spike scripts write only under their folders and `D:\dev`, hidden windows, no lab paths, no port 8765), measurement reviewer (both shells under one harness, medians of 5, whole-tree private memory, the Tauri rerun in the same session), and the prose lint on the results note. No improvement run unless a method finding changes a verdict.

**Exit criteria.**

- T2 decided: the table holds five runs per shell per metric, and the rule of 02 is applied without a new threshold.
- G1 decided on all four items with the numbers above, each number marked with the backend it ran against (`demo` for the engine-only figures; `remote` for step 10 when O3 was answered in time).
- The WebKit fix estimate is summed. If it is over the 4 weeks of item 3.2, this is treated as T1 firing (02 section 6.5): the owner chooses between Electron on both systems and the split shell (02 section 8.3) before D4 starts.
- The four Windows unknowns answered yes or no.
- G0 recorded: which Mac, its chip and macOS version, remote mode or a second lab.
- Disk: nothing new on C: (free space recorded before and after differs by less than 100 MB, estimate of noise).

**Effort.** 02: 1.2 to 2.5 focused weeks (planning basis). Here: 1 build run (three slices, stage A then stage B) and 1 QA workflow; 1 to 2 owner Mac sessions. Scenario calendar (untested pace): the Windows part 3 to 4 days; G1 recorded by Day 5 (fast) to Day 12 (slow), set by when the owner can sit at the Mac.

**What D0 changes.** T2 fires: the Electron variant below replaces D4 to D8. G1 fails: the Electron variant replaces D4 to D8 unless the owner picks the split shell (02 section 8.3). G1 passes and T2 does not fire: the Tauri phases below. If no Mac session happens before D3 ends, decision O2 (default yes) lets D4 start on Tauri anyway.

**If G0 shows an Intel Mac or a macOS before 26 (05 P04; this branch is unverified):** remote mode only, since the lab's NautilusTrader wheels exist only for `macosx_26_0_arm64`; D7.1 and D8.3 add an `x86_64-apple-darwin` build target and the JavaScriptCore run moves to a matching Intel runner. Whether Tauri 2 supports that target, and whether such a runner is still offered, is not checked here; D0.5 records it as an open item and D7 does not start until it is answered.

**Owner decisions and actions.**

- **O1 (G0):** which Mac, and remote mode (default) or a second lab on it. Needed before the Mac session.
- **O17 (new):** how the kit reaches the Mac: a push to GitHub and a clone, or a copy by USB or AirDrop.
- **O3:** whether to install an OpenSSH server (or a private network) on the PC now. If it is installed (and `check_sshd.ps1` of D8.5 has passed, or the same three settings are checked by hand) before the Mac session, the remote-mode HOME of step 10 becomes a required G1 input; otherwise it is required at the start of D8.
- **O16 (new):** name the quiet-machine windows in which this PC may be measured (for example overnight), since the PC is also used for games.
- **Action:** the Mac session or sessions (D0.4).
- **Action, from D0 to M8:** hold macOS updates on the Mac and record `sw_vers` at every Mac session (05 P03).

---

## Phase D1: fast start and the result cache

**Goal.** Make the backend start fast and the slow screens fast, in the browser terminal first. Covers 03 items 1.1a, 1.1b, 1.2a and 1.2b. This is where most of the speed the owner will feel comes from (02 section 4).

**Depends on:** the other build workflow's uncommitted work (132 paths on 2 October 2026, including `/api/analytics/paper-expectation`) is committed by the owner. Not on D0.

**Preflight (lead, before the slices):**

- Re-run `nq-lab/desktop_research/tools/plan/gen_03_tables.py` on the committed tree; it must report 0 unmapped rows. Any new module gets a fate in a short addendum to 03's Appendix A.
- Record the baseline: backend test count, crosscheck PASS and INFO counts, vitest and Playwright counts, `e2e:perf` values, the four sha256 values, the OOS log line count, and backend ready (median of 3, quiet machine; 2.6 to 3.1 s measured in 02). For reference, 03 recorded 2,984 backend tests collected, crosscheck 2,455 PASS, 0 FAIL, 104 INFO, 204 screenshot baselines, HOME 647 ms and grid 61 ms on 2 October 2026.
- Profile the start-up imports on a quiet machine (item 1.1a) and write the list of heavy imports per file, so both stage A slices work from one list.
- `backend/tests/test_safety_ast.py` already bans `serve_sealed` by name (checked on 2 October 2026: `serve_sealed` is in its `RULES` tuple), so no slice adds it; the preflight only confirms the ban is still there.

Stage A (two slices), then stage B (two slices).

**What "lazy" means here (exact, so a build run cannot read it two ways):** every router module is still imported and registered with `include_router` when the app is built, so every route stays in the app's route list and in `openapi.json`. Only heavy imports move: `scipy.stats`, `nq_terminal.analytics.perf`, `nq_lab.oos_gate`, `nautilus_trader` and, where the profile shows it pays, `pandas` go inside handler bodies or the service functions that use them. Deferring `include_router` is not allowed.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D1.1 (A) Lazy imports (1.1b): from the preflight's import profile, move `scipy.stats`, `analytics.perf`, `nq_lab.oos_gate` and the other import-time costs the profile names into the handler bodies or service functions that use them; routers stay registered at start-up | A1 | `backend/nq_terminal/analytics/*.py` and the service modules the profile names, except the three files of A2; the top-of-module import lines of `backend/nq_terminal/api/*.py` (stage A only; the files pass to B1 for stage B); `backend/nq_terminal/app.py`; `backend/tests/test_startup_imports.py` | A fresh interpreter that imports `nq_terminal.__main__` and builds the app has neither `scipy.stats` nor `nautilus_trader` in `sys.modules`; the test fails on today's tree (born failing); the app's route list and `contract/openapi.json` are identical to the baseline (same paths, same count) |
| D1.2 (A) Result cache core (1.2a): `services/result_cache.py` with a read hook in `FileCache` and in the bar service, so the key records every file a computation read; any heavy import the profile names in these three files (for example `nq_lab.oos_gate` in `bars.py`) moves inside its functions here | A2 | `backend/nq_terminal/services/result_cache.py`, `backend/nq_terminal/services/files.py`, `backend/nq_terminal/services/bars.py`; `backend/tests/test_result_cache.py` | The key is the route, the normalised query and the (path, mtime_ns, size) of every input; 64 MiB of bodies, least recently used; a rewrite with the same mtime and a new size misses (born failing: a key without size hits); a hit makes no serve call and writes no gate line (the fake serve counts 0) |
| D1.3 (B) Wire the eight slow routes (1.2b): `/api/runs/compare`, `/api/ledger`, `/api/market/two-day`, both bootstrap routes, `/api/analytics/deflated`, `/api/seasonality/instrument/{root}`, `/api/analytics/spa` | B1 | `backend/nq_terminal/api/runs.py`, `backend/nq_terminal/api/data.py`, `backend/nq_terminal/api/analytics.py`, `backend/nq_terminal/api/seasonality.py`, `backend/nq_terminal/api/spa.py`; `backend/tests/test_result_cache_routes.py` | For each of the 8 routes, cached and fresh bodies are equal byte for byte in fixture mode (the two routes whose body ends with a gate block, two-day and seasonality, are equal to a repeat computation made with the cache off, and equal to the cold body before that block: 03 section 15.2); live and clock-dependent routes are never cached (a test lists them); the contract file is unchanged |
| D1.4 (B) The crosscheck through the cache | B2 | `backend/tests/test_dump_for_qa.py`; `qa/crosscheck/dumps.py`, `qa/crosscheck/compare.py` (the cached-route comparison only) | Dumps taken through the cache equal fresh dumps; `crosscheck --strict` FAIL 0 with PASS at least the baseline |

**QA gate:** Python reviewer, security reviewer (a cache hit must never let a read skip the gate, and the gate log keeps one line per real read), numerics verifier (8 of 8 byte-equal as the exit criteria below define it, crosscheck strict), measurement reviewer.

**Exit criteria.**

- Backend ready on a quiet machine, median of 3: target 1.5 s, ceiling 2.5 s. Above the ceiling, T3 fires: profile again, no further phase until fixed.
- Repeat calls to the eight routes on real data: target 100 ms, ceiling 300 ms.
- The eight cached routes against a fresh computation: six are byte-equal to the cold body. Two-day and seasonality end with a gate block that reports the process (`cached` and the reads made so far), so a hit is equal to the cold body before that block and byte-equal to a repeat computation made with the cache off. A disk hit after a restart is byte-equal to the body the first process served.
- Real-data `EQ` and `REG` warm: measured and recorded against the 1,000 ms target (the ceiling of 1,500 ms is held at the D3 exit).
- All automated checks green; browser budgets unchanged (HOME 1,500 ms, grid 500 ms, shell bundle 114.9 kB gzip); the four research files unchanged.

**Effort.** 02: 1.5 to 3.0 focused weeks (planning basis). Here: 1 build run in two stages, 1 QA workflow, 1 to 2 improvement runs. Scenario calendar (untested pace): 2 to 4 days. D1's actual time is the first recalibration point (above).

**Owner decisions and actions.** Commit the other workflow's work (precondition). The go for the phase with its stated size. A quiet-machine window for the start-up and route timings (O16). Commit D1 at its end.

---

## Phase D2: identity, sessions and a safe environment

**Goal.** One backend per lab, a backend that proves who it is, a token on every door, an allow-listed environment and a watchdog. Covers 03 items 1.3a, 1.3b, 1.4a, 1.4b, 1.5a and 1.5b. Everything still ships to the browser terminal.

**Depends on:** D1 exit. Decision O5 (desktop caps) before stage A; default 512 MiB for bars and 128 MiB for files in desktop mode, today's 2 GiB in the browser.

Stage A (one slice), then stage B (three slices). Paths in this phase are written in full: `desktop/` alone would mean the Tauri shell folder of D4, not the Python package.

**What stage A leaves for stage B (so each stage B slice can test against stubs, not against another slice's half-built code):** the session routes' signatures with a stub that issues a working test cookie; the wiring from the stdin reader in `__main__.py` to `watchdog.on_eof()`; the public function of `envlist` (with a stub list) and the call sites that use it; and the shared authenticated test client below.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D2.1 (A) Lock, handshake and control channel (1.3a): bind port 0; the `NQT-READY` line; `NQT-ATTACH`; the stdin channel (`TOKEN`, `NONCE`, end of file) wired to `watchdog.on_eof()`; desktop cache defaults; the lock file created with an explicit owner-only ACL (05 X02); signatures and stubs of the session store, the session routes, the watchdog and the environment module for stage B; **the shared authenticated test client:** a fixture in `backend/tests/conftest.py` that mints a session through the real session routes (stub in stage A, real after D2.2), so no test needs a bypass in the app | A1 | `backend/nq_terminal/__main__.py` (rewritten, 03 Appendix A), `backend/nq_terminal/settings.py`, `backend/nq_terminal/desktop/__init__.py`, `backend/nq_terminal/desktop/lock.py`, `backend/nq_terminal/desktop/handshake.py`; stubs of `backend/nq_terminal/desktop/sessions.py`, `backend/nq_terminal/desktop/watchdog.py`, `backend/nq_terminal/desktop/envlist.py` and `backend/nq_terminal/api/desktop.py`; `backend/tests/conftest.py` (the client fixture only); `backend/tests/test_desktop_lock.py`, `backend/tests/test_desktop_handshake.py` | `NQT-READY` is the first `NQT-` line on stdout; the HMAC verifies, a wrong nonce or token fails; a held lock makes a second start print `NQT-ATTACH` and exit 0 without binding; a stale lock (dead pid, or a failed proof) is replaced; **owner-only proven:** an `icacls` or `GetSecurityInfo` read of a lock file created in a folder under `D:\dev` shows only the owner, SYSTEM and Administrators, with inheritance off (born failing: a file created with default rights fails the check); every lock test runs in a temporary state folder, never the real `terminal/state`; a test reads the child's argv and environment and finds no token |
| D2.2 (B) Sessions and the proof route (1.3b, 1.4a, server half of 1.4b), and the switch of the existing backend tests to the shared client | B1 | `backend/nq_terminal/desktop/sessions.py`, `backend/nq_terminal/security.py`, `backend/nq_terminal/api/desktop.py`, `backend/nq_terminal/api/system.py` (contract version in health), `backend/nq_terminal/app.py`; `contract/openapi.json` and the generated web API types; `backend/tests/test_desktop_proof.py`, `backend/tests/test_session_*.py`; **the 39 files in `backend/tests` that build a `TestClient` directly** (68 uses, counted with grep on 2 October 2026, among them `test_app.py`, `test_p2_rct_api.py`, `test_live_stream.py` and `test_dump_for_qa.py`, which feeds the crosscheck), in one mechanical rewrite pass to the shared fixture; the slice re-counts them at its start and owns whatever the count finds | Every `/api` path in the app's own route list refuses a missing cookie, a wrong cookie and a foreign origin, the stream included; the cookie is `nqt_s_<port>`, HttpOnly, SameSite=Strict, `Path=/api`; values compared with `hmac.compare_digest`; a launch code works once and dies after 60 s; a log scan finds no token and no code; **the backend test count equals the D1 baseline plus the new tests, with 0 skips added**; a grep finds no `TestClient(` outside `conftest.py` and the session tests |
| D2.3 (B) The browser door behind the token (client half of 1.4b): `session.html`, the launchers, the E2E harnesses, the real-data smoke in browser mode | B2 | `web/session.html` and `web/src/session/**`; `start.ps1`; `web/scripts/start/**` with its tests `plan.test.ts`, `doctor.test.ts` and `entry.test.ts` (03 Appendix A.3 row 31: the real launcher logic for the Mac browser door); `backend/tests/fixture_app.py`; `web/vite.config.ts` (the dev proxy target only, read from the lock instead of 8765); every Playwright configuration: `web/playwright.config.ts` (main and `perf` projects), `web/playwright.offline.config.ts`, `web/e2e/perf/real.config.ts`, `web/e2e/perf/real.preview.config.ts`; `scripts/smoke_real.ps1` (browser mode behind the token, keeping its "never 8765" rule). `start.sh` and `scripts/start.mjs` stay unchanged, as 03 Appendix A.3 rows 29 and 30 say | `start.ps1 -NoBrowser` prints the one-time session URL instead of calling `Start-Process`, and every test uses it with a spare backend port, never 8765; a born-failing test asserts that no browser process is started (it fails against a version that calls `Start-Process`); the session page works from the spaced home path and removes the fragment; `start.ps1 -Dev` works behind the token: the Vite dev server proxies to the port the lock records and the dev origin gets its session through the one-time code (tested on spare ports, never 8765); `smoke_real.ps1` passes in browser mode behind the token; the offline project still needs no token. The full Playwright run behind the token, at its baseline count, is a stage-end check, not this slice's acceptance, since it needs D2.2's real session routes |
| D2.4 (B) Environment, watchdog, JOBS identity (1.5a, 1.5b, the JOBS half of 1.3b) | B3 | `backend/nq_terminal/desktop/envlist.py`, `backend/nq_terminal/desktop/watchdog.py`, `backend/nq_terminal/services/jobs.py`; `backend/tests/test_env_allowlist.py`, `backend/tests/test_desktop_watchdog.py`, `backend/tests/test_jobs_identity.py` | Canary values in two key variables reach neither the backend's environment nor a job child; end of file on stdin stops a running fake job and exits within 5 s (through the stage A wiring); JOBS is refused with a wrong `sys.prefix` and with `NQT_FIXTURE_DIR` in desktop mode; two launchers never run one job twice; the spaced-path argv test still passes |

**Stage-end check (lead, after stage B):** the full Playwright run behind the token at its baseline count, `e2e:perf` alone, `e2e:offline`, and `smoke_real.ps1` in browser mode.

**QA gate:** security reviewer (mandatory: token handling, origin binding, cookie flags, environment canaries, lock file rights), Python reviewer, TypeScript reviewer (`session.html` and the launchers), and the full Playwright run.

**Exit criteria.**

- The refusal test covers every route the app registers (78 inventory and working-tree routes plus the four new ones, at least 82) with 0 gaps.
- 0 token or code occurrences in any log line or URL in the test run.
- Watchdog: stop within 5 s.
- The eight cached routes at the desktop caps: repeat calls still within the 300 ms ceiling.
- Backend tests: the D1 baseline count plus the new tests, 0 skips added; the crosscheck strict FAIL 0 through the shared client.
- All automated checks green at baseline counts plus the new tests, the real-data smoke included; browser budgets unchanged.

**Effort.** 02: 1.75 to 3.0 focused weeks (planning basis). Here: 1 build run in two stages, 1 QA workflow. Scenario calendar (untested pace): 2 to 4 days.

**Owner decisions and actions.** The go for the phase with its stated size. O5 (caps) before stage A. Before the first D2 start, stop the browser terminal's backend on `127.0.0.1:8765` (it holds no lock file, so a new start would not see it and two backends could serve one lab, 05 G04). After D2 the browser terminal needs the one-time launch step; the owner starts it with `start.ps1` as before. **Queue one small real backtest through JOBS** with the allow-listed environment and confirm exit code 0 (05 X09: a list that is too narrow shows here, not in daily use). Commit D2 at its end.

---

## Phase D3: workspace store, page bridge and the stage 1 release

**Goal.** Saved state moves to files; the page gets its one bridge interface; stage 1 ships to the browser terminal and passes a release gate. Covers 03 items 1.6a, 1.6b and 1.7, and the stage 1 exit.

**Depends on:** D2 exit.

Stage A (two slices), then stage B (two slices).

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D3.1 (A) Workspace store in the backend (1.6a): seven documents, `If-Match` versions, caps, atomic writes, five kept versions | A1 | `backend/nq_terminal/models/workspaces.py`, `backend/nq_terminal/services/workspaces.py`, `backend/nq_terminal/api/workspaces.py`, `backend/nq_terminal/app.py`; `contract/openapi.json` and the generated web API types; `backend/tests/test_app.py` (the write allowance), `backend/tests/test_workspaces_*.py` | The app has exactly three write routes (born failing: a fourth fails `test_app.py`); a stale version gets 412, a document over its cap 413, a name outside the seven 404; a `..` name is refused; files appear only under `terminal/state/workspaces`; `.1` to `.5` kept |
| D3.2 (A) The bridge (1.7): `bridge/index.ts`, `browser.ts`, `detect.ts`; every file save routed **centrally**: `saveBlob` and `saveText` in `web/src/chrome/download.ts` (today the only object-URL anchor in `web/src`, checked on 2 October 2026) call `bridge.saveFile`, so their callers need no change; the one direct clipboard call (`navigator.clipboard` in `screens/runs/RunHeader.tsx`) moves to `bridge.copyText`; panel export and GRAB through the bridge; an IPC source scan; the wasm32 pin. **Departure from 03 Appendix A.2 (added by this roadmap):** rows 4, 16, 18, 22, 36 and 39 (`screens/des`, `oos`, `reg`, `seal`, `export`, `export/pack`) say each caller calls `bridge.saveFile`; with central routing those callers keep their `saveBlob` or `saveText` calls unchanged, which 03 section 4.5 ("in every shell `saveFile` is today's object-URL anchor") allows | A2 | `web/src/bridge/**`, `web/src/chrome/download.ts`, `web/src/chrome/exportCsv.ts` (the CSV path through `saveText`; tests only unless a change proves needed), `web/src/chrome/panelExport.ts`, `web/src/export/grab/**`, `web/src/screens/des/desGrab.ts`, `web/src/screens/tear/tearGrab.ts`, `web/src/screens/runs/RunHeader.tsx` (the clipboard call only); `web/scripts/noShellIpc.test.ts`; a wasm32 pin test beside the Perspective set-up | The browser implementation behaves as today (existing tests unchanged); a source scan finds `URL.createObjectURL` and `navigator.clipboard` only inside `web/src/bridge/**` and `chrome/download.ts` (born failing: a planted anchor in a screen fails it); the IPC scan fails on a planted `window.__TAURI__`, `invoke(` or `ipc` use (born failing) and passes on the tree; `bridgeVersion` is 0 in the browser |
| D3.3 (B) The page on the store (1.6b): `remoteStore.ts`; the ten keys moved; the one-time import; merge rules; the demo API answers the store routes | B1 | under `web/src/`: `state/remoteStore.ts`, `state/safeStorage.ts`, `state/workspaces.ts`, `state/layouts.ts`, `state/linkGroups.ts`, `state/recordWatch.store.ts`, `commands/history.ts`, `chrome/EventTape.store.ts`, `chrome/FrameStrip.scheme.ts`, `theme/look.ts`, `screens/home/HomeOrientation.tsx`, `screens/mon/MonScreen.tsx`; `web/src/demo/**` (store routes only) | A seeded browser imports all ten keys once and sets the flag; each document merges by its 03 section 10.2 rule on a 412; writes debounce at 500 ms and flush on `pagehide`; `localStorage` is still written as a cache; the demo build still runs with no backend |
| D3.4 (B) Seam flows and the stage 1 measurement | B2 | `web/e2e/desktop-seams.spec.ts`; `docs/desktop/stage1/**` (the measurement script and its raw results) | E2E: a workspace saved, the backend restarted on a new port, the workspace loads; the launch code flow; export and GRAB through the bridge; the stage 1 numbers measured on a quiet machine, median of 3 |

**QA gate (release, two QA workflows so each stays at four reviewers or fewer):** round 1 is the Python, TypeScript, security and accessibility reviewers over everything stage 1 changed; round 2 is the numerics verifier (crosscheck strict, cached against fresh) and the measurement reviewer, with the final Playwright run, `e2e:perf` and `smoke_real.ps1`. The improvement run repeats until both rounds are clean.

**Exit criteria (stage 1 exit, 02 section 5).**

- Backend ready on a quiet machine at most 2.5 s (target 1.5 s); real-data `EQ` and `REG` warm at most 1,500 ms each (target 1,000 ms); slow routes on repeat at most 300 ms (target 100 ms).
- Browser budgets unchanged: HOME at most 1,500 ms, grid at most 500 ms, shell bundle at most 114.9 kB gzip, library chunks within budget.
- The real-data smoke passes: every screen opens on real files, every new gate line has `caller="terminal"`, the research files are unchanged.
- 3 write routes exactly; 0 shell IPC uses in `web/src`.
- Every automated check green; screenshot baselines unchanged (stage 1 changes no pixels).

**Milestone M3:** stage 1 is in the browser terminal the owner uses every day.

**Effort.** 02: 1.5 to 2.25 focused weeks (planning basis). Here: 1 build run in two stages, 2 QA workflows. Scenario calendar (untested pace): 3 to 5 days.

**Owner decisions and actions.** The go for the phase with its stated size. A quiet-machine window for the stage 1 numbers. Commit stage 1. Use the browser terminal as usual; any defect found goes to the D4 improvement run.

---

## Phase D4: the Windows shell

**Goal.** The Tauri shell on Windows: window, keys, supervision, the one write module, downloads, crash handling and test hooks. Covers 03 items 2.1a to 2.1d, 2.2a, 2.2b, 2.3a and 2.3b.

**Depends on:** D3 exit; D0 verdicts (T2 not fired; G1 passed, or O2 says start anyway); the owner's push of the branch so CI can run (O15).

Stage A (one slice), then stage B (four slices), then stage C (one integration slice, added by this roadmap).

**How stage B avoids collisions in one crate.** Stage A declares everything that is shared, so no stage B slice needs `main.rs`, `Cargo.toml` or `tauri.conf.json`: every dependency (the `windows`, `hmac` and `sha2` crates, the dialog crate, the zip crate), every cargo feature (`smoke`, and `measure`, below), and every builder hook as a stub call in `main.rs` into a module function with its final signature (`keys::install`, `window::setup`, `supervise::start`, `writes::on_download`, `crash::install`, `smoke::browser_args`). It also fixes the `writes.rs` interface that other modules use for files: `append(path, bytes)`, `rotate(path, max_bytes, keep)` and `write_new(path, bytes)`, each refusing the deny list. Each stage B slice then works in **its own copy of the crate** under `D:\dev\d4\<slice>` with its own `CARGO_TARGET_DIR`, so a half-written module in one slice never stops `cargo test` in another and no two slices wait on one build-directory lock. Stage C merges the four copies back into `desktop/src-tauri`.

**The `measure` feature (added by this roadmap).** A build with `measure` is the release build (MSVC, release profile, no `smoke`, no debugging port, no fixture switch) except that the window's `show()` is never called. It exists so that budgets can be measured on the shipped code on this PC without ever showing a window (standing rule 4). Under both `smoke` and `measure`, the controller is made visible behind a hidden window, as in the spike.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D4.1 (A) Skeleton (2.1a): the crate, a framed window hidden until ready, the splash in the look, single instance (forwarded arguments ignored), window state; the capability file that grants nothing; every dependency, feature and builder hook declared as above; stubs of every module with final signatures, `writes.rs` interface included; Clippy and deny configuration; the check workflow | A1 | `desktop/src-tauri/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` (1.99.0), `tauri.conf.json`, `build.rs`, `capabilities/main.json`, `src/main.rs`, stubs of `src/supervise.rs`, `link.rs`, `writes.rs`, `keys.rs`, `window.rs` (added by this roadmap: lab picker, settings and window state, so that B1 needs no `main.rs`), `crash.rs`, `smoke.rs`; `desktop/src-tauri/assets/splash.html`, `look.css`; `desktop/scripts/copy-tokens.mjs`; `desktop/src-tauri/clippy.toml`, `deny.toml`; `desktop/README.md`; `.github/workflows/desktop-check.yml` | Builds on the GNU host under `D:\dev` and on MSVC in CI with `--locked`; the capability file has no permission (a test reads it); a planted `TcpStream` outside `link.rs` and a planted `std::fs` write outside `writes.rs` fail Clippy (born failing); `look.css` is copied from `web/src/theme`, never edited by hand; **under `smoke` and under `measure`, `show()` is never called:** a test launches the smoke build against the fixture backend and checks through `IsWindowVisible` that the top-level window stays invisible until it is closed (born failing: a build that calls `show()` fails it) |
| D4.2 (B) Window, keys and settings (2.1b, 2.1c): lab picker; WebView2 data folder on the chosen drive; accelerators off through `with_webview`; zoom keys off; devtools off in release; new windows denied except the attribution link, opened in the system browser; `WEBVIEW2_*` removed from the shell's own environment; the HKCU WebView2 policy key checked | B1 | `desktop/src-tauri/src/keys.rs`, `src/window.rs`; `desktop/src-tauri/tests/keys_*.rs`, `window_*.rs` | In a hidden window driven over the debugging protocol (smoke build): F5, F12, Ctrl+F, Ctrl+P and Ctrl+R do nothing and the page still gets F1 and F8 to F11; `window.open` is refused; the attribution link reaches the system-browser handler (mocked in the test, nothing launched); the picker refuses a folder without `.venv\Scripts\python.exe`, `src\nq_lab\config.py` and `terminal\backend\nq_terminal\__main__.py`; **05 X04:** a canary `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` set in the parent is absent from the shell's environment and from the backend child's; the policy check, pointed by the test at a test key under `HKCU\Software` (never the real policy key), refuses to start when a debugging flag is planted there (born failing) |
| D4.3 (B) Supervision and the link (2.2a, 2.2b): spawn or attach; the handshake checks; the cookie; navigation; Job Object; restart policy; the stopped page; the proof on every top-level navigation; a reader thread that drains the backend's stdout into `backend.log` through `writes::append` from the first line (05 T08) | B2 | `desktop/src-tauri/src/supervise.rs`, `src/link.rs`, `assets/stopped.html`; `desktop/src-tauri/tests/supervise_*.rs` | Spawn line exactly `-E -s -X utf8 -X faulthandler -m nq_terminal` from `terminal\backend`, with the allow-listed environment, no console window; a mismatch in HMAC, ROOT, prefix or contract range is refused with its own message; a live lock is attached and never stopped; the Job Object ends the tree within 5 s of the shell's death; restarts at 1, 2 and 4 s, and three crashes in 60 s stop the retries; `link.rs` refuses any host but `127.0.0.1`; **noisy child (05 T08):** a fake backend that prints 10 MB before and 10 MB after its `NQT-READY` line still answers `/api/health` within 1 s, and the handshake is taken only from the first `NQT-` line (stray lines that look like a handshake later are ignored); **05 G08:** a fake backend swapped for another on the same port after the handshake is refused on the next top-level navigation |
| D4.4 (B) Writes and downloads (2.3a, 2.3b): the deny list with full path resolution; `on_download` with the native save dialog; the IPC refusal test; a clipboard fallback only if D0 found the API failing | B3 | `desktop/src-tauri/src/writes.rs`; `desktop/src-tauri/tests/writes_deny.rs`, `ipc_refusal.rs` | Writes under `<lab>/results`, `data`, `live`, `backtests/output`, `.venv` and `src` are refused through each of: a junction; a directory symlink (created under `D:\dev`, which needs developer mode; if it cannot be created, the case is skipped with the reason recorded in the test output, never silently); an 8.3 alias; the `\\?\` prefix; an NTFS alternate data stream (`results:stream`); a case difference (`RESULTS`); a UNC path to the same folder (`\\localhost\C$\...\results`); and reserved device names (`NUL`, `CON`). Every case is born failing against a naive prefix check (05 X05, 03 sections 6.3 and 15.2); `append`, `rotate` and `write_new` all go through the same check; a blob export lands only at the dialog's path (a test folder under `D:\dev` in tests); every core and plugin command called from the page is refused |
| D4.5 (B) Crash handling and test hooks (2.1d, 03 section 17): panic hook, log rotation through `writes::rotate`, diagnostics export, the `smoke` cargo feature (the fixture switch and the debugging port) | B4 | `desktop/src-tauri/src/crash.rs`, `src/smoke.rs` (added by this roadmap: 03 named no home for the test hooks) | A panic writes its report through `writes::write_new`; `terminal/state/logs/backend.log` rotates at 5 MB with 5 kept through `writes::rotate`; the diagnostics zip holds the shell logs, `backend.log` and the WebView2 version and is written only where the owner picks; without the `smoke` feature the debugging port and the fixture switch do not exist (a test builds without it and checks) |
| D4.6 (C) Integration (added by this roadmap): merge the four stage B copies; any change to `main.rs`, `Cargo.toml`, `Cargo.lock` or `tauri.conf.json` that stage B found needed; the full check set; the MSVC CI loop | C1 (lead) | `desktop/src-tauri/src/main.rs`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json` | The merged crate passes fmt, Clippy with the bans, `cargo test`, `cargo deny` and `cargo audit` on the GNU host; the owner's push (O15) gives a green MSVC run with `--locked` |

**QA gate:** Rust reviewer, security reviewer (capabilities, IPC refusal, deny list, environment removal, policy key, the Clippy bans), accessibility reviewer (framed window, splash contrast against the tokens, focus handed to the page after the splash), measurement reviewer (first readings). One hidden-window launch check on the smoke build: the app starts against the fixture backend on port 0, reaches HOME and closes, and `IsWindowVisible` is false throughout.

**Exit criteria.**

- Clippy, fmt, `cargo test`, `cargo deny` and `cargo audit` clean on both hosts; 0 warnings.
- IPC refusal: every command refused, the count printed by the test.
- Deny-list tests pass on every case of D4.4 (the symlink case passed, or skipped with its recorded reason); a file scan of the lab after the launch check finds 0 new files under `results/`, `data/`, `live/` or `backtests/output/`.
- The noisy-child test and the swapped-backend test green.
- First readings, hidden window, median of 5: splash painted within 1,000 ms (target 500 ms); exe size recorded.
- C: check passed on every build run of the phase (standing rule 5).
- The browser terminal is unaffected: its automated checks green.

**Effort.** 02: 3.75 to 5.75 focused weeks (planning basis). Here: 1 build run in three stages, 1 QA workflow, 1 to 2 improvement runs (Rust is new to the repository). Scenario calendar (untested pace): 3 to 6 days of build runs plus 2 to 4 MSVC CI loops at one day of owner latency each under O15's default, so 5 to 10 days. D4.1's actual time gives the first stage 2 ratio (Recalibration).

**Owner decisions and actions.**

- The go for the phase with its stated size (three stages, five slices, four reviewers).
- **O2** (start before G1 if no Mac yet; default yes) and **O4** (Tauri on "light" and Rust, or Electron's single engine) if D0 left either open.
- **O7:** drives for the WebView2 data folder and the install folder (default `D:\nq-terminal\webview` and `D:\Apps\nq-lab terminal`).
- **O10:** the IB snapshot checkbox, off by default. **O12:** minimum window size (default 1,024 by 640).
- **O6 and O11:** an opt-in resident backend, and what closing does during a running backtest (default: confirm, then stop).
- **O15 (new):** a standing go for build runs to commit and push to a `desktop/` branch, or a push by hand at each phase end (default). Under the default, every MSVC CI loop inside D4 and D5 waits for an owner push, about a day each in the scenario; a standing go removes that wait. Enable GitHub Actions on the repository (free on public repositories, 03 section 16). Commit D4 at its end.

---

## Phase D5: Windows proof, package and gate G2

**Goal.** Prove the Windows app against every budget, the crosscheck and an all-day soak; harden the supply chain; build the installer. Covers 03 items 2.4a to 2.4d and 2.5. Ends at G2 (02 section 6.3).

**Depends on:** D4 exit.

Four slices, in two steps so that building never runs beside measuring (standing rule 15): first S2, S3 and S4 in parallel with S1 building the harness only; then, once S2 to S4 have finished, S1's measurements alone in an O16 quiet window. S2's Playwright project never runs beside another Playwright run.

**Which build each number comes from.** Page-internal figures (grid open, pan and zoom, keystroke to paint, warm HOME) are read over the debugging protocol, which only the GNU `smoke` build has (03 section 15.4). The shipped artefact is an MSVC build from CI with no debugging port, and the GNU linker dropped one of two embedded manifests in the spike (`00_spike_rust.md`; which one is unverified). So the process-level budgets are also measured on the **MSVC `measure` artefact** (D4), installed silently under `D:\dev\d5\measure`, with a method that needs no debugging protocol: start time to the handshake and to HOME ready from the shell's own log timestamps, and whole-tree private memory from Windows performance counters. The two builds must agree within noise.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D5.1 Harness and budgets (2.4a, 2.4c): the spike's harness moved into the repository; every budget of 03 section 18; first launch after a reboot; the all-day soak at the shipped caps; minimised for 30 to 60 minutes with the stream live, then restored (simulated by hiding the controller, since no window may be shown; a real minimise is the owner's visible run below); **the release-binary measurement** on the installed MSVC `measure` artefact, without the debugging protocol | S1 (harness built in step 1, measured in step 2) | `desktop/harness/**` | The harness reproduces the spike's figures within noise (each within 10% of the spike median or inside its min to max range) before measuring anything new; every figure is a median of 3 on a quiet machine with the whole-tree private memory and the CPU load recorded; for backend ready, start to HOME ready and idle memory, the GNU `smoke` figure and the MSVC `measure` figure agree within noise; raw files kept |
| D5.2 App smoke and correctness through the app (2.4b, 03 sections 15.1, 15.3 and 15.4): a Playwright project that attaches over the debugging protocol to a hidden smoke build; the served-JSON comparison; the app screenshot set; an app mode for the real-data smoke (its browser mode was done in D2.3) | S2 | `web/e2e/desktop/**`, `web/playwright.desktop.config.ts`; `qa/crosscheck/served.py`; `scripts/smoke_real.ps1` (the app mode only) | The smoke walks HOME and the eight screens of the spike, asserts stream mode, exports a blob through the download handler to a test folder, copies text, sends F-keys; every route with a dump is served byte-equal to the in-process body; **the look:** HOME, GP, REG, the LEDG pivot and LIVE in the app, plus HOME and REG in the amber-classic look, compared with the 204 Windows Chromium baselines, with 0 unexplained differences; the real-data smoke passes in app mode with only `caller="terminal"` gate lines |
| D5.3 Supply chain and drift (2.4d): cargo-deny bans and source allow list; cargo-audit; the order-name scan extended to the shell source; the weekly drift workflow, which also watches for shell advisories (05 X06) | S3 | `desktop/src-tauri/deny.toml`, `clippy.toml`; `backend/tests/test_safety_ast.py`; `.github/workflows/desktop-check.yml`, `webview2-drift.yml` | Crates for parquet, Arrow, Polars, DuckDB, DataFusion and IB banned by name, crates.io only; a planted order-style name in a Rust file fails the scan (born failing); the drift workflow runs vitest and the offline project on the runner's WebView2 and opens an issue on any change; **on the same weekly schedule** it runs `cargo audit` and reads the Tauri repository's published security advisories through the GitHub REST API (`repos/tauri-apps/tauri/security-advisories`, R2), opening an issue for any advisory newer than the last run (born failing: a run seeded with an older "last seen" date opens one) |
| D5.4 Package (2.5): NSIS per-user without admin, folder choice, embedded WebView2 bootstrapper; the release workflow on MSVC with `--locked`, building the release and the `measure` artefact from one commit; checksums; the artefact check; the release check (05 S08, added by this roadmap) | S4 | `desktop/src-tauri/tauri.conf.json` (bundle section); `.github/workflows/desktop-release.yml`; `desktop/scripts/artefact-check.mjs`; `scripts/release_check.ps1` | The release build has no `smoke` and no `measure` feature (`cargo tree -e features` checked) and devtools off; the artefact check fails on a planted `.parquet` file and on any path under `data/`, `results/` or `live/` (born failing), and reads the release exe's embedded manifest to confirm the DPI awareness and common-controls entries are both present; SHA-256 checksums attached to a draft release; `release_check.ps1` refuses a tag unless dated green records of the backend tests, the strict crosscheck and the real-data smoke, all from this PC on the same day, are present (born failing: a record from the day before is refused) |

**QA gate (release, two QA workflows):** round 1 is the Rust, security, TypeScript and accessibility reviewers over `desktop/`, the smoke project and the workflows; round 2 is the numerics verifier (crosscheck strict against the app-launched backend, the served-JSON comparison) and the measurement reviewer, with the final Playwright run and the app smoke. The improvement run repeats until both are clean.

**Exit criteria: G2 on Windows** (targets are recalibrated from the quiet-machine run; ceilings fail). Each figure is recorded with the build it came from: process-level rows (backend ready, splash, cold and warm start to HOME, memory) on both the GNU `smoke` build and the MSVC `measure` artefact, page-internal rows on the `smoke` build. A row passes only if every build it was measured on is within its ceiling.

| Budget | Target | Ceiling |
|---|---:|---:|
| Backend ready, quiet machine | 1.5 s | 2.5 s |
| Shell painted (splash) | 500 ms | 1,000 ms |
| Cold double-click to HOME with data, including the first launch after a reboot | 3.5 s | 5 s |
| Warm HOME with data | 1,000 ms | 1,500 ms |
| Real-data `EQ` and `REG`, warm | 1,000 ms | 1,500 ms |
| Grid open, 8,411 fills | 100 ms | 500 ms |
| GIP pan and zoom p95 at 20,000 bars | 16.7 ms | 25 ms |
| Keystroke to paint, command line, p95 | 50 ms | 100 ms |
| Whole app idle at HOME | 400 MB | 500 MB |
| Whole app, all-day soak at the shipped caps | 1.0 GB | 1.5 GB |
| Installer | 15 MB | 30 MB |

And, all required for G2:

- the GNU `smoke` and MSVC `measure` figures agree within noise on backend ready, start to HOME and idle memory;
- the crosscheck green against the app-launched backend; every dumped route byte-equal when served; the five-screen look comparison with 0 unexplained differences;
- the stream back in stream mode after the simulated minimise case, and after the owner's real minimise within 30 s (below);
- **the owner-attended visible run of the real release** (below) passes: cold start to HOME ready, read from the shell log, within 5 s and within noise of the `measure` artefact's median; idle whole-tree private memory within 500 MB;
- **real keyboard, 16 of 16:** F1, F8, F9, F10, F11, Alt+1 to Alt+9 and Alt+K, and Ctrl+K reach the page in the installed release (F10 going to the system menu is a failure to fix, not a note);
- **NVDA and Narrator:** 0 blocking findings in each pass over HOME, a grid, a chart's table view and the command line;
- the IPC refusal test green; the release built without `smoke` or `measure`; the drift workflow green once; the release check passed on the tagged commit; every automated check green; the browser budgets unchanged;
- every owner-run check recorded in a dated file under `docs/desktop/checks/`.

T4 (memory) and T5 (pan and zoom, data hop) are read from the same run.

**Milestone M4:** the first Windows installer from a tagged commit `desktop-v0.1.0`, installed on D:.

**Effort.** 02: 2.5 to 4.0 focused weeks (planning basis). Here: 1 build run in two steps, 2 QA workflows, one soak day. Scenario calendar (untested pace): 4 to 8 days plus 1 to 3 MSVC CI loops at one day of owner latency each, so 5 to 11 days.

**Owner decisions and actions.**

- The go for the phase with its stated size.
- A **reboot** at a time the owner chooses, after which the harness takes the first-launch reading (hidden window; the owner only runs one command).
- **The visible run of the real release**, about 15 minutes: install the draft release to D:, start it by double-click, leave it at HOME for 2 minutes, then minimise it for 30 minutes with LIVE open and restore it; the harness reads the shell log and the performance counters. Pass rules as in the exit list (start to HOME within 5 s and within noise of the `measure` median; idle memory within 500 MB; stream mode back within 30 s of the restore).
- A **real-keyboard check** on the installed release, about 15 minutes: the 16 keys above, plus print. Pass: 16 of 16 reach the page.
- An **NVDA and a Narrator pass** over HOME, a grid, a chart's table view and the command line, about 30 minutes. Pass: 0 blocking findings each.
- Record each of these in `docs/desktop/checks/`.
- **Run `release_check.ps1`, then push the tag** `desktop-v0.1.0` (O15).
- A quiet-machine window for the budgets and a day for the soak (O16).
- Commit D5 at its end.

---

## Phase D6: the Windows dual run

**Goal.** Four weeks of daily use of the app beside the browser terminal (03 section 19).

**Depends on:** G2 on Windows. Runs beside D7 and D8, under the rules below.

**Which build is in the dual run.** The dual run uses the installed `desktop-v0.1.0` (or a later D6 fix tag). D7 and D8 changes to `web/src` or the shell reach the Windows install only after M7, through a new tag. A D6 fix tag for a blocking defect restarts the four-week count (a blocking defect resets it anyway); a fix tag for a non-blocking defect, installed only if the owner asks, extends the run so that at least the last two weeks are on the final tag.

**Order between D6 defect runs and D7 and D8 (added by this roadmap, standing rule 13).** A D6 defect run may not start on a file that a D7 or D8 slice owns at that moment. When a **blocking** defect is found, D6 wins: the D7 or D8 slices that own the files it needs stop at their next stage boundary, the defect run fixes it, and they resume. A non-blocking defect queues until the current D7 or D8 stage ends. "No new app feature before the fix" applies to blocking defects only.

| Task | Who | Acceptance |
|---|---|---|
| D6.1 Daily use; whichever starts first owns the backend, the other attaches | owner | Workspaces shared through the files |
| D6.2 The weekly parity list, about 15 minutes: HOME with data; GP and GIP pan and zoom; REG and MT; RUN with the fills pivot; EQ to MRET; MON and CORR; LEDG and OOS; LIVE and JRNL in stream mode; HELP; DES save; GRAB copy and save; print dossier; JOBS queue and cancel; F1 and F8 to F11; SAVE and LOAD of a workspace; the amber-classic look | owner | Every row green each week, recorded in `docs/desktop/checks/` |
| D6.3 Defect runs, under the order above | build run | Each fix with a born-failing test |

**Exit criteria.** Four consecutive weeks with no blocking defect (as defined under the QA gate: a red parity row, a wrong number, a gate or write-ban breach, or a crash) and every parity row green, on the tag that is installed at the end; the owner's decision O8 on the browser door (default keep).

**Effort.** 0 planned build runs; budget 0 to 2 defect runs. Calendar: 28 days at least, more if a blocking defect restarts the count.

**Milestone M7:** the Windows dual run closed.

---

## Phase D7: the Mac proof harness and Mac keys

**Goal.** The tools that prove the page on WebKit on every change, and the Mac keys and menus. Covers 03 items 3.1a, 3.1b, 3.1c and 3.3.

**Depends on:** a G1 pass recorded in D0 (or the owner's choice after a T1 firing); the D5 exit (so the Windows release is not disturbed); O9 (the Mac key set); `sw_vers` on the Mac unchanged since the D0 kit run, or the kit re-run (05 P03); if G0 showed an Intel Mac, the open item of "What D0 changes" answered.

Four slices in parallel.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D7.1 The JavaScriptCore golden run in CI (3.1a) | S1 | `.github/workflows/mac-webkit.yml`; `web/scripts/jscGolden.mjs` | On pull requests touching `web/src/quant` or `qa/golden`, all four golden files agree with V8 within 1e-9 relative on the `macos-26` runner (or a matching Intel runner on the Intel branch, unverified); if the runner has no `jsc` binary (03 section 24, unverified), the job runs the goldens in a hidden WKWebView instead |
| D7.2 The in-app self-test page with axe-core (3.1b) | S2 | `web/src/selftest/**`; `web/vite.config.ts` (the `selftest` mode); `web/scripts/bundleCheck.ts` | The self-test page reports maths, features and axe results to the shell log, in the Mac app and in the Windows smoke; a production build contains no self-test code (born failing: bundleCheck fails on a planted import) |
| D7.3 The WebDriver smoke set through the embedded server, and the Mac candidate baselines (3.1c) | S3 | `desktop/mac-smoke/**` | The step list is written out and its count fixed when this task is accepted (planned at about 20: launch, HOME, the eight-screen walk, stream mode, export, copy, the Mac keys, focus back after Cmd+Tab); that fixed count is the exit figure and every step passes on the owner's Mac in a test build; the Mac screenshots are recorded as **candidate** baselines only, since D8's WebKit fixes will change pixels; they are approved at the end of D8 |
| D7.4 Mac keys and menus (3.3): the app, Edit, Window and Help menus; the Mac key table; HELP with Mac bindings and the licence notices | S4 | `desktop/src-tauri/src/keys.rs`; `web/src/chrome/CommandLine.keys.ts`; `web/src/screens/help/**`; the key strings in `web/src/copy/**` | vitest covers both key tables (`keys: 'pc'` and `'mac'`) including `defaultPrevented`; no menu item takes a key the grammar uses; HELP lists the Apache-2.0, BSD-3-Clause, MPL-2.0 and OFL-1.1 notices |

**QA gate:** TypeScript reviewer, Rust reviewer, accessibility reviewer (axe on WebKit, contrast pairs re-run on WebKit), and a visual reviewer for the Mac candidate baselines.

**Exit criteria.**

- JavaScriptCore against V8: 4 of 4 golden files within 1e-9 relative.
- Self-test page: every G1 feature check passes in the Mac app; axe clean with the WCAG 2.2 AA tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`); every contrast pair at 4.5:1 for text and 3:1 for components on WebKit.
- WebDriver smoke: N of N steps pass on the owner's Mac, N being the count fixed at D7.3's acceptance.
- **Mac keys:** every row of the Mac key table of 03 section 11.2 reaches the page on the owner's Mac, counted as rows passed of rows in the table, with none missing.
- **VoiceOver:** 0 blocking findings in a pass over HOME, a grid, a chart's table view and the command line.
- The Windows app and the browser terminal: automated checks green.
- The key and VoiceOver results recorded in a dated file under `docs/desktop/checks/`.

**Effort.** 02: 4.0 to 5.5 focused weeks (planning basis). Here: 1 build run, 1 QA workflow, 1 to 2 owner Mac sessions. Scenario calendar (untested pace): 4 to 8 days.

**Owner decisions and actions.**

- The go for the phase with its stated size.
- **O9:** the Mac key set (default: the Ctrl+Option set, Option+1 to 9, Cmd+K).
- **Mac session** (about 2 hours, estimate): record `sw_vers` first; pull the D7 commit, build a test build, run the self-test page and the WebDriver smoke, look over the candidate baselines (approval comes at the end of D8).
- A **VoiceOver pass** over HOME, a grid, a chart's table view and the command line (about 30 minutes). Pass: 0 blocking findings.
- Commit D7 at its end.

---

## Phase D8: WebKit fixes, remote mode, the Mac package and G2 on the Mac

**Goal.** Fix what G1 and D7 found, connect the Mac to the PC's lab over SSH, package the Mac app, and repeat G2 on the Mac. Covers 03 items 3.2, 3.4 and 3.5.

**Depends on:** D7 exit; O3 (an OpenSSH server or a private network on the PC) before slice S2 can be tested end to end; G0 (remote mode by default); `sw_vers` unchanged since the last kit run, or the kit re-run (05 P03).

Up to four slices in parallel. The WebKit fixes are assigned to slices at the start of the phase from the defect list, by file, so that no two slices share a file, and none shares a file with a D6 defect run in progress (D6 order rule).

**First, if D0 had no remote-mode reading:** the remote-mode warm HOME (D0.4 step 10) is taken as soon as O3 is installed and passes its check, before any D8 work other than S2.

| Task | Slice | Owner files | Acceptance |
|---|---|---|---|
| D8.1 WebKit fixes (3.2) | S1 (split into S1a and S1b if the defects fall in two disjoint areas) | the files the defect list names, assigned at phase start | Each fix with a born-failing check in the self-test page or the WebDriver smoke; Chromium suites unchanged |
| D8.2 Remote mode (3.4): read the lock over SSH; start the backend over SSH if no lock, holding the session open as its stdin; the tunnel with `ExitOnForwardFailure=yes` and `ServerAliveInterval=15`; the "PC not reachable" page | S2 | `desktop/src-tauri/src/tunnel.rs`, `src/supervise.rs` (the attach-through-tunnel path), `assets/unreachable.html`; `desktop/src-tauri/tests/tunnel_*.rs` | Unit tests against a fake `ssh`; on the owner's Mac: HOME over the tunnel, stream mode, the unreachable page when the PC is off; quitting the Mac app stops a backend it started and leaves alone one it attached to |
| D8.5 The PC's SSH configuration check (05 X07, added by this roadmap): a read-only script on the PC | S2 | `desktop/scripts/check_sshd.ps1`; `desktop/scripts/tests/sshd/**` (sample configurations and the test) | The script reads `sshd_config` and the firewall rule and changes nothing; it passes only if `PasswordAuthentication no` is set, `AllowUsers` names one account, and the inbound rule for the OpenSSH server (`OpenSSH-Server-In-TCP`, 05 R14) has a `RemoteAddress` other than `Any` (the private network or one address); born failing: run against a sample configuration that allows passwords, and one with no `AllowUsers`, it fails each. Passing it on the PC is a **precondition for any tunnel test**. Whether reading `sshd_config` under `ProgramData` needs an elevated shell is unverified; if it does, the owner runs it |
| D8.3 Mac package (3.5): `NSAllowsLocalNetworking`, `LSMinimumSystemVersion` from G1, the DMG, a local build from a tag; notarisation only if D0 found Gatekeeper blocking a local build | S3 | `desktop/src-tauri/Info.plist`; `desktop/src-tauri/tauri.conf.json` (macOS section); `desktop/scripts/build-mac.sh` | A local build from the tag opens from Finder with no prompt (or, if D0 said otherwise, after notarisation); no App Sandbox; the shell needs no extra entitlement (03 section 13.2, unverified until then) |
| D8.4 Mac harness: the D5 harness on macOS, with the in-page measurement | S4 | `desktop/harness/mac/**` | Medians of 5 in a hidden window; physical footprint of the WKWebView processes and the shell; each figure labelled with its backend (`demo` or `remote`) |

**QA gate:** Rust reviewer, security reviewer (the SSH child, the lock read, the token on the wire stays inside the tunnel, no password stored, and the SSH configuration check with its born-failing samples), accessibility reviewer (the unreachable page, VoiceOver on the fixed screens), measurement reviewer. If fixes are many, a second QA workflow after the second build run.

**Exit criteria: G2 on the Mac.**

- Engine figures against the demo API: shell painted within 1,000 ms; warm HOME within 1,500 ms; UI physical footprint at HOME at most 350 MB; the 8,411-row grid within 500 ms; pan and zoom p95 within 25 ms (hidden window, or the owner's visible run if a hidden WKWebView produces no frames).
- Over the tunnel (T10), against the PC's real backend: HOME within 5 s and at most one stream reconnect an hour over a two-hour run. Over either, T10 fires and local-lab mode is offered (O1).
- The SSH configuration check passes on the PC, recorded in `docs/desktop/checks/`.
- On the PC: every new gate line has `caller="terminal"`; the research files are unchanged; one backend, one client id 95.
- **Mac keys:** every row of the Mac key table reaches the page in the packaged app, none missing. **VoiceOver:** 0 blocking findings over HOME, a grid, a chart's table view, the command line and every screen D8.1 changed.
- **Mac baselines approved by the owner now,** after the WebKit fixes, with the visual reviewer's notes.
- The self-test page, the WebDriver smoke (N of N) and the JavaScriptCore run green; every Chromium check green.

**Milestone M6:** the Mac app passes G2.

**The Mac dual run (after M6).** Four weeks of daily use on the Mac with the D6 parity list, with the Mac key rows (the Mac key table of 03 section 11.2) in place of F1 and F8 to F11. It runs on the tag that passed M6; the D6 rules apply unchanged (blocking defect as defined, which resets the count; defect runs with a born-failing test; the order rule against any other phase). Exit: four consecutive weeks with no blocking defect and every parity row green, recorded in `docs/desktop/checks/`. **Milestone M8** closes it.

**Effort.** 02: 1.75 to 6.5 focused weeks (planning basis). Here: 1 to 2 build runs, 1 to 2 QA workflows, 2 to 4 owner Mac sessions. Scenario calendar (untested pace): 5 to 15 days, then the Mac dual run of 28 days at least.

**Owner decisions and actions.**

- The go for the phase with its stated size.
- **O3:** install the OpenSSH server on the PC (default: the built-in Windows OpenSSH server, on the owner's go) or a private network; put the Mac's SSH key on the PC and add a host alias on the Mac; **then run `check_sshd.ps1` and fix what it reports** before any tunnel test.
- **O13:** the Apple Developer Program ($99 a year, 02 S24) only if D0 found that Gatekeeper blocks a local build.
- **Mac sessions:** `sw_vers` recorded at each; one per fix round to run the kit and the smoke set; one for the G2 measurement; a VoiceOver pass on the fixed screens; approval of the Mac baselines.
- The weekly parity list on the Mac for four weeks.
- Commit D8 at its end.

---

## Phase D9: later phases, only on evidence

Not scheduled. Each starts only when its trigger or the owner asks, with its own plan in this format.

| Later phase | Trigger | Effort (02) |
|---|---|---|
| Accessibility gaps: `forced-colors`, `prefers-contrast`, canvas charts that follow contrast themes (proposed first, because the desktop makes contrast themes more likely) | owner | 2 to 4 weeks |
| One PyO3 kernel at a time | G3 met (T11) | 2 to 4 weeks each |
| Binary columns (Arrow IPC beside JSON) | T5 | 2 to 3 weeks |
| One natively drawn view | T5 still failing after binary columns | 4 to 8 weeks |
| Local-lab mode on the Mac, with the gate change | O1 or T10 | 1 to 2 weeks plus the gate change |
| A resident backend kept after the window closes | O6 or T3 | not priced in 02 |
| A bundled demo engine | owner | 3 to 5 weeks |

## The Electron variant (if T2 fires in D0, or G1 fails)

The seams of D1 to D3 are shell-neutral, so the variant changes only D4 onward.

| Phase | What changes | Effort (02, planning basis) | Scenario calendar (untested pace) |
|---|---|---|---|
| D4E | Electron 44 main process in TypeScript under `desktop/electron/` (`main.ts`, `supervise.ts`, `link.ts`, `writes.ts`, `keys.ts`, `crash.ts`, a `preload.ts` exposing only the bridge through `contextBridge`); a lint ban on `net` and `fs` outside `link.ts` and `writes.ts`; the same slice split as D4 | Windows 5 to 8.5 weeks for D4E and D5E together | 3 to 6 days |
| D5E | As D5, with Playwright's Electron class driving the real app (02 D7) in place of the debugging-protocol attach; the installer carries the Chromium runtime (130 to 158 MB per platform, 02 S2), so the installer budget is reset by the owner | | 4 to 8 days |
| D7E | No JavaScriptCore run and no WebDriver set: the same Chromium on both systems, so the Playwright suites cover the Mac too; Mac keys and menus as D7.4 | Mac 3 to 5.5 weeks for D7E and D8E together | 3 to 6 days |
| D8E | No WebKit fixes; remote mode and the Mac package as D8 | | 3 to 8 days |

If Windows is already built on Tauri when G1 fails, the owner chooses between moving Windows to Electron (about 3 to 5 weeks, one extra build run of 3 to 6 days) and the split shell (02 section 8.3). Total for Electron on both: 14 to 25 focused weeks.

## Effort summary

The focused weeks are the planning basis (05 section 2.3); the scenario days are a hypothesis built on an untested pace ratio (section "Pace").

| Phase | Covers (03 items) | 02 focused weeks (planning basis) | Build runs | QA workflows | Owner sessions | Scenario days, untested (fast to slow) |
|---|---|---|---:|---:|---|---|
| D0 | 0.1 to 0.3d | 1.2 to 2.5 | 1 | 1 | 1 to 2 Mac | 3 to 4 (Windows); G1 by Day 5 to 12 |
| D1 | 1.1, 1.2 | 1.5 to 3.0 | 1 | 1 | quiet window | 2 to 4 |
| D2 | 1.3, 1.4, 1.5 | 1.75 to 3.0 | 1 | 1 | stop the 8765 backend, one real JOBS run | 2 to 4 |
| D3 | 1.6, 1.7, stage 1 exit | 1.5 to 2.25 | 1 | 2 | quiet window | 3 to 5 |
| D4 | 2.1 to 2.3 | 3.75 to 5.75 | 1 (three stages) | 1 | decisions, pushes | 5 to 10 (3 to 6, plus 2 to 4 CI loops) |
| D5 | 2.4, 2.5 | 2.5 to 4.0 | 1 (two steps) | 2 | reboot, visible run, keys, NVDA, Narrator, tag | 5 to 11 (4 to 8, plus 1 to 3 CI loops) |
| D6 | dual run, Windows | 0 | 0 to 2 (defects) | as needed | 4 weekly checks | 28 at least |
| D7 | 3.1, 3.3 | 4.0 to 5.5 | 1 | 1 | 1 to 2 Mac, VoiceOver | 4 to 8 |
| D8 | 3.2, 3.4, 3.5 | 1.75 to 6.5 | 1 to 2 | 1 to 2 | 2 to 4 Mac, SSH install and check | 5 to 15 |
| Mac dual run | | 0 | 0 to 2 (defects) | as needed | 4 weekly checks | 28 at least |
| **Total** | 39 items | **18 to 32.5; plan on 32.5** | **8 to 9, plus 0 to 4 defect runs** | **10 to 11** | **4 to 8 Mac sessions** | **scenario only: Day 54 to 85 to the end of both dual runs** |

The stage totals match 02 and 03: stage 0 1.2 to 2.5 weeks (D0), stage 1 4.75 to 8.25 (D1 to D3), stage 2 6.25 to 9.75 (D4, D5), stage 3 5.75 to 12 (D7, D8).

## Milestones and timeline

Day 1 is the first day of D1, which waits only for the other build workflow's work to be committed; the dates assume Day 1 is Monday 5 October 2026, and if Day 1 moves, every date moves with it.

**Planning basis (the commitment, 05 section 2.3):** focused weeks from Day 1, counted as one focused week per calendar week and with the phases one after another (D0 first, a conservative choice, since its build work could overlap D1 to D3). The date column is the high end, 32.5 focused weeks to M6. Report progress against it in focused weeks (05 S09); elapsed time may still be a multiple of focused time.

**Scenario (untested pace):** the fast and slow days assume 1 to 3 calendar days per build run, one day of owner latency per MSVC CI loop, and that each decision and Mac session is had within a day of asking. It holds only while the recalibration checks pass (end of D1: 4 days or fewer; D4: 10 days or fewer); otherwise the scenario columns are dropped.

| ID | Milestone | Reached at | Focused weeks from Day 1 (low to high) | Planning date (high end) | Scenario day (fast to slow) | Scenario date (fast to slow) |
|---|---|---|---|---|---|---|
| M0 | Baseline recorded, D1 starts | D1 preflight | 0 | 5 Oct 2026 | 1 | 5 Oct 2026 |
| M1 | T2 decided (Electron measured beside Tauri) | D0, Windows part | 1.2 to 2.5 | 23 Oct 2026 | 3 to 4 | 7 to 8 Oct |
| M2 | G1 decided on the owner's Mac; G0 recorded | D0, Mac part | 1.2 to 2.5 | 23 Oct 2026 | 5 to 12 | 9 to 16 Oct |
| M3 | Stage 1 in the browser terminal | D3 exit | 6.0 to 10.75 | 19 Dec 2026 | 7 to 13 | 11 to 17 Oct |
| M4 | Windows app passes G2; first installer | D5 exit | 12.2 to 20.5 | 26 Feb 2027 | 17 to 34 | 21 Oct to 7 Nov |
| M5 | Mac proof harness green | D7 exit | 16.2 to 26.0 | 5 Apr 2027 | 21 to 42 | 25 Oct to 15 Nov |
| M6 | Mac app passes G2 | D8 exit | 18 to 32.5 | 21 May 2027 | 26 to 57 | 30 Oct to 30 Nov |
| M7 | Windows dual run closed | D6 exit, four weeks after M4 at least | 16.2 to 24.5 | 26 Mar 2027 | 45 to 62 | 18 Nov to 5 Dec |
| M8 | Mac dual run closed: the migration is done | four weeks after M6 at least | 22 to 36.5 | 18 Jun 2027 | 54 to 85 | 27 Nov to 28 Dec |

Phase windows on the planning basis (high end), one column per month:

```
Month          Oct  Nov  Dec  Jan  Feb  Mar  Apr  May  Jun
               2026           2027
D0 Win + Mac   ###
D1 to D3       ###  ###  ###
D4 and D5                ###  ###  ###
D6 Win dual                        ##   ###
D7 Mac proof                       ##   ###  #
D8 Mac finish                                ###  ###
Mac dual run                                      ##   ###
```

On the scenario's slow path the same bars would end on 28 December 2026, and on its fast path about four weeks sooner; neither is a commitment.

**What sets the calendar.** On the planning basis, the build work is the long pole: 18 to 32.5 focused weeks (about 4 to 7.5 months), plus four weeks for the last dual run. In the scenario, the build runs would stop being the long pole and the two dual runs, the Mac sessions and the quiet-machine windows would set the end date instead. Which of the two holds is what D1 and D4.1 measure first.

## Owner decisions, with the phase that needs each

Decisions O1 to O14 are those of 03 section 23; O15 to O17 are new in this roadmap.

| ID | Decision | Default | Needed before |
|---|---|---|---|
| O1 | G0: which Mac (chip, macOS, display); remote mode or a second lab | remote mode | D0 Mac session |
| O2 | Start D4 before G1 if no Mac session has happened | yes | D4 |
| O3 | OpenSSH server or a private network on the PC | built-in Windows OpenSSH server, on the owner's go, then `check_sshd.ps1` passed | D8 (or the D0 Mac session, which makes the remote-mode HOME a G1 input) |
| O4 | Tauri on "light" and Rust at an equal score, or Electron's single engine | Tauri | D4 |
| O5 | Desktop caps 512 MiB bars and 128 MiB files, or 2 GiB | 512 and 128 in desktop mode | D2 |
| O6 | An opt-in resident backend | not built; offered if T3 fires | D4 |
| O7 | Drives for the WebView2 data folder and the install folder | D: | D4 |
| O8 | Keep the browser door after the dual run | keep | end of D6 |
| O9 | Mac key alternatives | the Ctrl+Option set | D7 |
| O10 | IB snapshot in the app | off, a setting | D4 |
| O11 | Closing with a running backtest | confirm, then stop | D4 |
| O12 | Minimum window size | 1,024 by 640 | D4 |
| O13 | Apple Developer Program ($99 a year) | only if Gatekeeper blocks a local build | D8 |
| O14 | A licence for the public repository | none; matters only for free open-source signing | any time |
| O15 | A standing go for build runs to commit and push to a `desktop/` branch | no: the owner pushes at each phase end and for each MSVC CI loop (about a day of latency per loop) | D4 |
| O16 | Quiet-machine windows in which this PC may be measured | owner names them | D0 |
| O17 | How the kit reaches the Mac: push and clone, or a copy | push and clone | D0 Mac session |

## Owner actions, in order

| When | Action | Time (estimate) |
|---|---|---|
| Now | Commit the other build workflow's work so D1 can start; answer O1, O16, O17 | minutes |
| Start of every phase | Read the stated size (slices, reviewers, expected run hours) and give the go; make sure no other terminal build workflow is running on the repository (standing rule 13) | minutes |
| End of every phase | Commit the phase (each seam one commit, so 03 section 20's rollback works) | minutes |
| D0 | One or two Mac sessions: tools, kit, maths, features, numbers, Gatekeeper; copy results back; from then until M8, hold macOS updates and record `sw_vers` at every Mac session | 2 to 3 hours |
| D1 and D3 | Leave the PC quiet in the named windows for the timings | the windows only |
| D2 | Stop the backend on `127.0.0.1:8765` before the first D2 start; afterwards start the terminal with `start.ps1`; queue one small real backtest through JOBS and confirm exit code 0 | 20 minutes |
| D3 | Commit stage 1; keep using the browser terminal | minutes |
| D4 | Answer O2, O4, O6, O7, O10 to O12, O15; enable GitHub Actions; push the branch, and again for each MSVC CI loop under O15's default | 30 minutes, plus one push per loop |
| D5 | A reboot; the visible run of the real release with a real minimise; the real-keyboard check (16 keys); NVDA and Narrator passes; record each in `docs/desktop/checks/`; run `release_check.ps1`; push the tag; install from D: | about 2 hours |
| D6 | The parity list once a week for four weeks; then O8 | 15 minutes a week |
| D7 | O9; a Mac session for the self-test, the WebDriver smoke and a look at the candidate baselines; a VoiceOver pass | about 2.5 hours |
| D8 | O3 install and SSH key, then `check_sshd.ps1` until it passes; Mac sessions per fix round and for G2; VoiceOver on the fixed screens; approve the Mac baselines; O13 only if needed | 2 to 6 hours over the phase |
| After M6 | The parity list on the Mac once a week for four weeks | 15 minutes a week |

**Accounts and certificates.** None are needed on the default path: GitHub Actions are free for a public repository (03 section 16, L4-S12), the Windows installer is unsigned and installed by hand (one SmartScreen prompt per CI-downloaded file, 03 section 13.1), and a Mac app built on the Mac itself needs no Developer ID if D0 confirms Gatekeeper accepts it (unverified until then). Only if the app is ever given to someone else: a Windows signing certificate (Certum OV from €209 a year, L4-S15) and the Apple Developer Program ($99 a year).

## Phase summary

| Phase | Content | Slices | QA gate reviewers | Extra checks |
|---|---|---|---|---|
| D0 | Toolchain, Electron measured, Windows unknowns, the Mac kit and G1 | 2 then 1 (the T2 measurement alone), plus the owner's Mac session | security, measurement | T2 and G1 verdicts with numbers |
| D1 | Lazy imports, result cache | 2 then 2 | Python, security, numerics, measurement | backend ready, 8 routes byte-equal, crosscheck through the cache |
| D2 | Lock, handshake, sessions, environment, watchdog | 1 then 3 | security, Python, TypeScript | every route refuses without a session; env canaries; backend test count held with the shared client; lock ACL; smoke behind the token |
| D3 | Workspace store, bridge, stage 1 release | 2 then 2 | round 1: Python, TypeScript, security, accessibility; round 2: numerics, measurement | 3 writes exactly; IPC scan; real-data smoke |
| D4 | Windows shell | 1 then 4 (each in its own crate copy) then 1 | Rust, security, accessibility, measurement | Clippy bans born failing; IPC refusal; deny list with every bypass case; noisy child; window never shown |
| D5 | Proof, supply chain, package, G2 | 4, building first, then measuring alone | round 1: Rust, security, TypeScript, accessibility; round 2: numerics, measurement | every budget on the smoke and the MSVC measure builds; soak; served JSON byte-equal; the five-screen look; keys 16 of 16; NVDA and Narrator; the visible release run |
| D6 | Windows dual run | owner | none | weekly parity list |
| D7 | JavaScriptCore run, self-test page, WebDriver smoke, Mac keys | 4 | TypeScript, Rust, accessibility, visual | goldens at 1e-9 on WebKit; axe on WebKit; Mac key rows; VoiceOver |
| D8 | WebKit fixes, remote mode, SSH check, Mac package, G2 on the Mac | up to 4 | Rust, security, accessibility, measurement | Mac budgets; T10 over the tunnel; SSH check; Mac baselines approved |
| D9 | Later, on evidence | as planned then | as relevant | as listed |

## Sources

New in this step, checked on 2 October 2026. Other tags are those of `01_options.md`, `02_decision.md`, `03_migration_plan.md` and the research lenses.

- R1. Tauri, Prerequisites: on macOS, Xcode or, for desktop-only development, the Xcode Command Line Tools through `xcode-select --install`; Rust through `curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh`. https://v2.tauri.app/start/prerequisites/
- R2. GitHub REST API, repository security advisories (`GET /repos/{owner}/{repo}/security-advisories`): https://docs.github.com/en/rest/security-advisories/repository-advisories. Checked on 2 October 2026 by calling it read-only for `tauri-apps/tauri`, which returned published advisories, the newest `GHSA-w28w-mhc8-qvjv` of 26 September 2026.
- R3 (carried from 05 R14). Microsoft Learn, Get started with OpenSSH Server for Windows: installing the server creates and enables an inbound firewall rule named `OpenSSH-Server-In-TCP` for port 22. https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse

Local evidence: `docs/desktop/02_decision.md` (sections 4 to 6 and 10), `03_migration_plan.md` (sections 2 to 24 and the appendices), `00_spike_rust.md` (toolchain, build times), `web/playwright.offline.config.ts` and `web/vite.config.ts` (the offline demo API needs no backend), `backend/tests/test_app.py` (the write allowance), and the terminal's build log for the observed pace of build runs. Read on 2 October 2026 for this revision: `backend/tests/*.py` (39 files with 68 direct `TestClient(` uses; `conftest.py` has no client fixture), `backend/tests/test_safety_ast.py` (`serve_sealed` already in its `RULES`), `backend/nq_terminal/app.py` (routers registered with `include_router` at build time), `backend/nq_terminal/api/analytics.py` (analytics imported at module top), `scripts/smoke_real.ps1` (second backend on port 8953, `Invoke-WebRequest` with no cookie), `start.ps1` (`-Dev` needs 8765; `-NoBrowser` exists), `web/scripts/start/` (launcher, plan, facts, doctor and their tests), the Playwright configurations under `web/`, and `web/src/chrome/download.ts` (`saveBlob` and `saveText`, the only `URL.createObjectURL` use in `web/src`).

Unverified and carried from 03 section 24: the `jsc` binary path on the `macos-26` runner; the WebdriverIO Tauri service on macOS 26; blob downloads through `on_download` in WKWebView; whether Ctrl+Option+letter, F10 and Alt reach the page; Gatekeeper with a local ad hoc build; the first macOS whose WebKit meets the Safari 16.4 floor; `ProcessFailed` and the WebKit termination callback through `with_webview`; stream latency over an SSH tunnel. D0 answers the Windows ones and the Mac session answers most of the rest. Also unverified here: the 15 GB of Mac disk and the session lengths, which are estimates; whether a hidden window's simulated minimise behaves like a real one (hence the owner's visible run in D5); which manifest the GNU linker dropped; whether a silent NSIS install of the `measure` artefact stays free of any window; whether reading `sshd_config` needs an elevated shell; and the whole Intel Mac branch of D0 (Tauri target support and a matching CI runner). The scenario's pace ratio is untested by construction.
