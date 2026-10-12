# Resident backend: a design for owner decision O6

Written 12 October 2026 for wave w4a-startup-page (slice resident-design). Design only: nothing here is built, and no
code changed. Figures marked *estimate* are reasoned from the evidence named beside them; figures marked *unverified*
have not been measured. Every timing from 0.3.3 is PROVISIONAL (taken under load).

## 1. The decision, and the short answer

O6 asks whether the app should keep its backend running when no window is open, so that a launch attaches to a warm
backend instead of starting one. The owner took O6 as "not built" (`owner_decisions_windows.md:141`). 02 offered it as
the answer to trigger T3 (`02_decision.md:157`, `:312`), and 05 names it as the mitigation for T10, a backtest stopped
by a close (`05_risks_costs.md:283`). Roadmap v2 asks for this design so that O6 can be reopened (`ROADMAP_V2.md:303`).

**Recommendation.** Build it as an opt-in switch with three values: Off (today's behaviour, the default), Linger (the
backend stays N minutes after the last window closes) and At sign-in (the backend is started when the owner signs in to
Windows and stays until sign-out). Ship Linger first. The backend is held by a small windowless host process (the
shell's own exe in a host mode), and every window attaches to it through the attach path that already exists. The usual
launch then drops from 3,098 ms to about 0.9 to 1.1 s on a quiet machine (*estimate*, `startup.md` 7.1), and a backtest
can finish after its window closes.

## 2. What a warm backend saves

The usual launch of 0.3.2 (two accepted launches, `startup.md` 4):

| Segment | 0.3.2 | With a warm backend (*estimate*) |
| --- | ---: | --- |
| Shell start to WebView2 built | 228 to 236 ms | unchanged, 230 to 290 ms |
| Backend spawn (after WebView2, `startup.md` 7.2) | 451 to 460 ms | not needed |
| Spawn to `supervise_checked` | 1,480 to 1,508 ms | attach, 20 to 50 ms, in parallel with WebView2 once w4b's spawn-first lands |
| HOME data window | 0.99 to 1.08 s | warm HOME, 582.4 ms on 0.3.2 (`g2_windows/results.md:36`, the 0.3.2 column) |
| **Cold HOME, usual launch** | **3,098 ms** | **about 0.9 to 1.1 s** |

Two cautions. First, warm HOME read 1,241.3 ms in the 0.3.3 G2 record under heavy load
(`g2_windows/results.md:36`), so on a loaded evening the resident usual launch is nearer 1.5 to 1.6 s (*estimate*).
Second, the first launch after an install (the G2 first-launch row, empty state folder) does not change; the first
launch after a reboot changes only with the At sign-in value.

## 3. The attach path that exists

`connect` (`desktop/src-tauri/src/supervise_run.rs:278-287`) calls `try_attach` (`:240-276`) before it would spawn.
`try_attach`:

1. reads `<state>/backend.lock` through `reads.rs`, which checks the handle's owner and the protected owner-only DACL as
   `lock.py` does; a missing lock means spawn, an untrusted one is skipped with its reason logged;
2. parses `{"v", "pid", "port", "token"}` and requires `v == 1` and that the listener on 127.0.0.1:port belongs to the
   lock's pid (`link::listener_owner`);
3. opens the pid for waiting only (`PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION`);
4. runs a fresh-nonce proof (`verify_target`): the MAC over `proof|nonce|port|pid` checked with the lock's token, the
   answering pid, then `check_place`: ROOT and prefix, then the contract number within the shell's accepted range;
5. buys a session (`link::session`), and `connect` logs `supervise_attached` with the port and pid.

Any doubt logs `supervise_attach_skipped` with the reason, and the caller spawns. An attached backend is never stopped
by the shell (`end_backend` leaves it running), and the navigation check re-runs the ownership check and a fresh proof
on every top-level navigation (`verify_now`).

The path is sound for what it was built for (a second launcher meeting a backend that `start.ps1` or another window
owns). For a resident backend it has six gaps:

| Gap | Where | Why it matters for a resident backend |
| --- | --- | --- |
| No code stamp. The proof carries the contract number only | `check_place`, `proof.py` | A new release with the same contract number would attach to an old backend whose Python code is out of date (05 T11 covers only the contract) |
| No page build check. READY requires `dist == "current"`, the attach does not | `check_ready` against `check_place` | A web rebuild while the backend lives would be served by a backend that judged the page at its own start |
| A held lock that fails the attach checks ends on the stopped page | `Mismatch::LockHeld` | An old resident backend would block every new launch until the owner ends it by hand |
| Closing asks the O11 question only for a spawned backend | `may_close` in `supervise_shell.rs` | Right for a resident backend (closing no longer stops it), but turning the switch off must bring the question back |
| The IB switch is only reported for an attached backend | `ib_gate`, `IbGate::Attached` | Every resident launch is an attach, so the O10 switch would stop working |
| The prewarm gate opens on the first identity proof | `services/prewarm.py`, `StartGate` | A host's own proof at sign-in would start the prewarm, and its gated reads, on a day the app is never opened (05 G02) |

## 4. The shape: a host, and windows that attach

### 4.1 Three ways to keep a backend alive

| Option | How | Verdict |
| --- | --- | --- |
| A. The window's shell lingers | The shell that spawned the backend stays alive with no window; a second launch reaches it through the release's single-instance plugin, which rebuilds the window in that process | Rejected. The release and the smoke or measure builds would take different paths (the plugin is release only, `main.rs:60`), so the harness could not measure the release path; a new release's exe would be handed to an old process by the plugin |
| B. A detached backend | The backend runs outside any job, ignores end of file on stdin and decides its own lifetime | Rejected. It loses the Job Object that ends a backtest child when the backend dies (05 T09), and nobody drains its stdout into `backend.log` once the window has gone (05 T08: a full pipe blocks the backend) |
| **C. A host plus attach** | A windowless process, `nq-terminal.exe --host`, spawns and supervises the backend exactly as a window does today; every window attaches through `try_attach` | **Chosen.** The spawn, the Job Object, the stdin watchdog, the log drain and the restart policy stay as they are, in the host. Windows always take one path, the attach, in every build, so the harness measures what the owner runs |

### 4.2 The processes in each mode

| Switch | Who spawns the backend | Who stops it | A window |
| --- | --- | --- | --- |
| Off (default) | the window's shell, as today | the window's shell at close (stdin closed, `STOP_GRACE_S`, then the job) | spawns, or attaches to `start.ps1`'s backend, as today |
| Linger | a host the first window starts | the host, N minutes after the last window left and no backtest runs | attaches; its close leaves the backend alone |
| At sign-in | a host started by the sign-in entry | the host, at sign-out or when the switch is turned off | attaches |

The host is the same exe with the same supervisor code (`supervise.rs`, `supervise_run.rs`): no WebView2, no visible
window, no single-instance plugin. It holds a named mutex of its own per state folder
(`Local\nq-terminal-host-<first 16 hex of sha256(state folder)>`), so a second host exits at once. The lab's lock still
decides one backend per lab. It writes its own log, `<state>/logs/host.log`, through `writes.rs`, and it drains the
backend's output into `backend.log` as the window's shell does today.

### 4.3 A launch with Linger on

1. The window's shell reads the switch from its settings file (`window_settings.rs`).
2. A live, trusted lock whose backend passes the checks of section 5: attach (`supervise_attached`). This is the usual
   launch, and the saving of section 2.
3. No live lock: the shell starts `nq-terminal.exe --host` (with `CREATE_BREAKAWAY_FROM_JOB` where the caller's job
   allows it, so a harness or launcher job does not end the host with the window), then polls the lock every 25 ms
   and attaches as soon as it is live, within `HANDSHAKE_TIMEOUT`. The host does the READY checks (`check_ready`,
   `dist == "current"`, the first proof) as the shell does today.
4. The host fails (it ends, or the lock never comes): the shell logs `resident_host_failed` with the host's exit code
   and spawns its own backend as in Off, for this launch only. A broken host never costs the owner a launch.

The first launch in Linger mode pays the host's process start and the lock poll, about 50 to 100 ms more than Off
(*estimate*, to be read in the A/B of section 11).

### 4.4 Presence: how the host knows a window is open

After it attaches, a window registers itself: `POST /api/desktop/presence` with its session cookie and its own pid. The
backend opens that pid for `SYNCHRONIZE` only and waits on the handle on one thread (at most 8 windows), so a window
that crashes leaves as surely as one that closes. `GET /api/desktop/presence` (session cookie) answers
`{"windows": n, "jobs_running": m, "idle_s": s}`, where `idle_s` is the time since the last window left. The host polls
it every 5 s; memtrim counts it as a background path (`BACKGROUND_PATHS`), so it neither starts nor ends a quiet period.

## 5. The code-stamp check

The rule: **a window attaches only to a backend started for its own build, from the code on disk now.**

**The stamp.** At its start the backend computes, on the thread that already walks the web sources
(`handshake.DistWalk`, off the READY path):

- `shell_build`: the build id of the exe that spawned it (version and commit, compiled into the exe), handed over on
  stdin beside the token and nonce;
- `contract_sha`: the sha256 of `contract/openapi.json` (already read for the READY line);
- `dist`: `web/dist/build-stamp.json` as read at start;
- `source_digest`: sha256 over (relative path, size, `mtime_ns`) of every `.py` file under `terminal/backend/nq_terminal`
  and `src/nq_lab` (about 144 and 906 files today), plus `uv.lock` and the venv's `pyvenv.cfg`.

**At attach.** The proof answer gains a `stamp` object: `shell_build`, `contract_sha`, and `fresh`, which the backend
computes on that request by walking the same files again and comparing with `source_digest`, and by re-running
`dist_status`. The MAC of the answer covers the stamp (a new proof kind, `proof2`, over
`proof2|nonce|port|pid|shell_build|contract_sha|fresh`), so a swapped listener cannot fake it. The window refuses when:

| Check | Refusal |
| --- | --- |
| `stamp` absent (a backend from before this change) | `Mismatch::Stamp("no stamp")` |
| `shell_build` differs from the window's own build id | `Mismatch::Stamp("another build")`: a new release never attaches to an old backend |
| `fresh` is false | `Mismatch::Stamp("code changed")`: a `git pull`, a lab edit, a web rebuild or a venv sync since the backend started |
| contract outside the range, ROOT or prefix differ | today's refusals, unchanged |

The re-walk costs about 30 to 60 ms for some 1,050 files (*estimate*, scaled from the web walk's 27 to 34 ms over 736
files, `startup.md` 1); *unverified* on this tree. If it reads over 50 ms, the backend keeps the digest current with a
directory change notification instead, and the attach reads a flag.

**After a refusal.** Today a held lock that fails ends on the stopped page. With a host the window instead asks the old
backend to retire: `POST /api/desktop/retire`, authenticated like the proof (a fresh nonce and a MAC with the lock's
token, which the window can read). The backend answers `{"retiring": true}` and stops through its own lifespan (the
lock released, exit code `EXIT_RETIRED`), or `409` with `{"running": n}` while a backtest runs or another window is
present. The old host sees `EXIT_RETIRED`, restarts nothing and ends. The window waits for the lock to go (an open for
DELETE that succeeds, polled every 50 ms, within `STOP_WITHIN_S`, 5 s), starts a new host and attaches. On a 409 the
stopped page says: "An older copy of the backend is finishing a backtest. The app will start when it ends." with Retry.

## 6. The prewarm rule

**Prewarm on the first attach only.** In host mode the backend's `StartGate` (`services/prewarm.py`) opens on the first
presence registration (section 4.4), never on the host's own proof. A backend started at sign-in therefore makes no
gated read, and writes no gate line, on a day the app is not opened (05 G02). Once a window has attached, the prewarm
runs once, as today (once per process), and its results stay warm after the window closes.

What the gate log then shows, and what changes:

- The lines keep their present form: caller `terminal`, the page's own reason, through `nq_lab.data.serve`. No gate
  code, caller name or reason text changes.
- A price-derived result stays in memory only and dies with the process (02 4.1 item 1), as today. A process that lives
  for days logs its first read of each window once per process, not once per day. A day on which the owner opens the
  app against a warm backend may show no gate line at all for HOME. This is a change in what the log means, and it is
  question 5 of section 13.
- The idle trim is unchanged: it hands working set back after the quiet period and never reads prices.

## 7. Linger and sign-in start

**Linger (recommended first).** The host stops the backend when all three hold: no window present, no backtest running
and `idle_s` at least N minutes (proposed N = 30). It stops it the way a window does today: stdin closed, the
backend's watchdog runs its close hooks within `STOP_WITHIN_S`, then the job. A window that attaches during the linger
resets it. A backtest running when the linger expires holds the stop until it ends; the host then stops the backend at
once.

**At sign-in.** A value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` starts
`"<install>\nq-terminal.exe" --host --at-sign-in`. The host reads the switch first and exits at once unless it says At
sign-in, so a stale Run value does nothing. It starts the backend 30 s after sign-in at below-normal priority, raised to
normal on the first presence (*estimate* of the effect on sign-in: *unverified*). The backend makes no gated read until
the first window (section 6). It stops at sign-out: the host answers `WM_QUERYENDSESSION` and `WM_ENDSESSION` on its
message-only window and closes the backend's stdin. A backtest running at shutdown is stopped, as a close stops it
today; the ledger is written only by `scripts/ledger_append.py`, so a partial run adds no row (05 T10).

**Why sign-in second.** It is the only way to help the first launch after a reboot, which has never been measured
(`startup.md` 11 item 1). It also costs a process all day on days the app is not opened. Linger gives the saving for the
usual pattern (several launches in an evening) at a fraction of that cost; measure the reboot row before choosing
sign-in.

## 8. Closing during a backtest

Today (O11, taken: "confirm, then stop") a close with a backtest running asks "A backtest is running. Closing stops it.
Close anyway?" (`dialogs.rs:226`), and a yes stops the backend and the run (05 T10).

With Linger or At sign-in the window is attached, so its close never stops the backend: the window closes without the
question, the host keeps the backend until the backtest ends, and the run's output is complete. This is 05 T10's own
mitigation. The job indicator shows the run on the next launch, as it does today for a run in progress.

Two paths keep the O11 question:

- **Stop the backend now** (Options, and the tray menu if there is one): asks the O11 question when a job runs, then
  calls the retire route with the job's stop.
- **Turning the switch to Off with a window open:** from then on that window's close retires the backend, with the O11
  question when a job runs, so Off behaves as today from the next close.

## 9. The switch

| Part | Proposal |
| --- | --- |
| Setting | Options, "Keep the backend ready": Off (default), Linger for N minutes, At sign-in. Stored in the shell's settings file through `writes.rs` |
| Sign-in entry | Written when At sign-in is chosen and removed when it is left: one Run value under HKCU, nothing under HKLM. This is a new write by the shell (registry), to be added to the write-ban review beside `writes.rs` |
| Visible sign | A tray icon while a host runs with no window (Open, Stop the backend, Settings), so a process the owner cannot see does not run all day; question 3 |
| Turning it off | Takes effect at the next window close (section 8); a host with no window and no job stops at once |
| Updates | The installer's running-app check finds the host's exe; it must end the host the way Stop the backend does (retire, then the job). A running backtest is then stopped, as a close stops it today, and the installer page says so |
| IB switch (O10) | A window attached to a host of its own build is treated as `IbGate::Started` (the stamp proves which app started it). Applying the switch ("confirm, next start") becomes: retire and restart through the host at the first moment no job runs |

## 10. Memory with the window closed

What is known: the backend's working set after the idle trim is 27.9 MB (27.2 to 29.4, `g2_windows/results.md:180`);
the trim leaves committed memory unchanged (`memtrim.py`). What is not known: the backend's private bytes after the trim
with no window, and the host's own footprint, both *unverified*. 02 estimates about 250 MB private for a backend that has
served HOME (`02_decision.md`, section 4.2), and 05 T03 records 1,170 MB working set after a heavy session at a 256 MiB
cache, with the desktop caps at 512 MiB bars and 128 MiB files (O5). So a resident backend could hold from about 0.25 GB
to over 1 GB of committed memory all day (*estimate*), depending on what the last session read.

Rows to measure before the owner decides (informational G2 rows, smoke build, hidden):

| Row | When |
| --- | --- |
| Host process: private bytes and working set | window closed + 1 min |
| Backend: private bytes and working set, trim seen in `backend.log` | window closed + 5 min and + 60 min, after a HOME-only session |
| The same after the heavy set (G2's heavy session), then the window closed | + 5 min and + 60 min: the worst case |

Proposed rule if the worst case is high: five minutes after the last window leaves, the backend drops the bar cache
entries HOME does not use, then trims. That keeps warm HOME warm and releases the rest (question 6).

## 11. Tests that would pin it

Born-failing cases first; each feeds the guard the broken state of today's tree.

**Shell (Rust unit tests).**

- `try_attach` against a proof responder whose `stamp.shell_build` differs: refused with `Mismatch::Stamp` (born
  failing: today's attach accepts any backend whose contract is in range). The same for a missing stamp and for
  `fresh: false`, and for a stamp field changed after the MAC (the MAC check fails).
- A held lock that fails the stamp: the window calls retire, waits for the lock and starts a host (born failing: today
  `Mismatch::LockHeld` ends on the stopped page). A 409 from retire shows the "older copy" page.
- Host policy with a fake clock: stops at N minutes with no window and no job; never with a job running; never with a
  window present; a window during the linger resets it.
- Close with Linger on and a job running: no O11 dialog, no stdin closed, no retire (born failing: today the close of a
  spawned backend asks). Close with the switch turned Off on an attached host backend: asks O11 and retires.
- `ib_gate` for an attached backend of the same build under a host: `Started` (born failing: `Attached` today).

**Backend (pytest).**

- In host mode the prewarm gate stays shut after the host's proof and opens on the first presence; a test backend in
  host mode with no presence for its whole run makes no gated read and adds no gate line (born failing: today the first
  proof opens the gate). The test uses the fixture lab and the existing research guard; it never touches the lab's
  `results/`.
- `/api/desktop/presence` refuses without a session; counts a registered pid; drops it when the process ends.
- `/api/desktop/retire` refuses without a valid MAC, answers 409 while a job runs or a window is present, and otherwise
  ends the process with `EXIT_RETIRED` through the lifespan (lock released).
- The proof answer carries the stamp; touching a source file after start makes `fresh` false (born failing: no stamp
  today).

**Harness (hidden smoke builds, temporary state folders).**

- `--mode usual-attach`: one launch with Linger on, a hidden close, a check that the host lives and the lock is live,
  then five counted launches: each shell log shows `supervise_attached` and no `supervise_spawned`; **cold HOME at most
  1,200 ms**, median of five accepted (PROVISIONAL under load); at the end the harness retires the host and the
  survivors check finds no process left.
- `--mode reliability --attach`: 40 hidden launches against one host: **40 of 40 attaches**, no refusal.
- A stamp row: a host of build A, then a launch of a smoke build with another build id: `supervise_attach_skipped`
  (stamp), the old backend retired, a new host, an attach.
- The idle-memory rows of section 10.
- An interleaved A/B through A/B labs of Off against Linger on the first launch, for the host's start cost (section 4.3).

## 12. Interactions and costs

| Area | Effect |
| --- | --- |
| Harness real-data modes, `smoke_real.ps1 -Mode App` | `lab-guard.mjs` refuses a launch while the lab's lock is live and records the slot as pending. A host running the owner's app makes every real-data measurement pending until it ends. No harness may stop it (the rule against ending the owner's app stands); the owner turns the switch off for a measurement window (question 7) |
| `start.ps1 -Dev` | Stops with a message while the lock is held, as today; a Linger host ends by itself, a sign-in host needs the switch off or Stop the backend |
| The scripts that rebuild or upgrade the venv, and the release script | `python.exe` and its DLLs are in use while the backend lives; the scripts must retire the host first (a `--retire` command of the exe, which calls the retire route) |
| O19 (the preferred port) | A host keeps one port for its life, so the page's origin, its HTTP cache and its web storage persist across launches even with O19 off. That is the storage change the O19 security review covers, and it applies here too |
| Restarts | The host owns them (back-off of 1 s, then 2 s, then 4 s; three crashes in 60 s stop). An attached window whose backend ends tries to attach again for up to 8 s before it shows the stopped page; it never spawns while a host holds its mutex |
| Single-instance plugin | Unchanged in windows (one window at a time); the host does not register it |
| Gate | No change to the gate's code, caller or reason; no new kind of line; fewer lines per day (section 6) |

**Build estimate.** About 3.5 to 5 days (*estimate*): the host mode and its policy 1 to 1.5 days; the stamp, proof v2,
presence and retire 1 to 1.5 days; the switch, the Run value and the tray 0.5 to 1 day; the harness modes with their rows plus the
A/B 1 day. As roadmap S2 in the next push (`ROADMAP_V2.md:324`), after w4b's spawn-first so that the attach runs in
parallel with WebView2.

**Risks.** A process that outlives its window is harder to see and to reason about (the tray and the host log answer
that). A stamp walk that misses a file kind would let a window attach to stale code (the walk list is in one place and
has its own test). A host left by a crash holds no lock once its backend has gone, because the lock goes with the
backend's handle (`lock.py`); the next launch finds a stale lock and replaces it, as today (05 T07).

## 13. The owner's questions

1. **Reopen O6?** Build the resident backend as an opt-in switch, default Off, in the next push (S2)? Recommended: yes.
2. **Which value first, and how long a linger?** Recommended: Linger only, with N = 30 minutes; At sign-in after the
   reboot first-launch row has been measured.
3. **A tray icon while the backend runs with no window?** Recommended: yes, with Open, Stop the backend and Settings.
4. **Closing during a backtest with the switch on:** let the run finish with no question (recommended, 05 T10's
   mitigation), or keep asking as O11 does today?
5. **The gate log's meaning:** with a backend that lives for days, its first read of each window is logged once per
   process, so a day's HOME may add no gate line. Accept that (recommended), or drop price-derived memory entries at
   local midnight so each day's first view logs its reads, at about 0.3 to 0.5 s on that day's first launch
   (*estimate*: the price-reading HOME tasks, `startup.md` 4)?
6. **A memory ceiling with the window closed:** for example 300 MB private, above which the backend drops the bar cache
   entries HOME does not use? To be set after the rows of section 10 are measured.
7. **Measurements and maintenance:** accept that a running host makes the real-data harness modes pending, and that
   the owner turns the switch off for a measurement window and before a venv rebuild?
8. **Sign-in entry:** if At sign-in is chosen later, accept one HKCU Run value written by the shell?

## Sources

`D:/dev/v04/research/startup.md` sections 1 and 4, 7.1, 9, 11; `D:/dev/v04/research/ROADMAP_V2.md:58`, `:272`, `:303`,
`:324`; `docs/desktop/owner_decisions_windows.md:141`; `docs/desktop/02_decision.md:150-157`, `:305-318`;
`docs/desktop/05_risks_costs.md:283` (T10), `:359` (G02) and T03, T07, T08, T09, T11 beside them;
`docs/desktop/03_migration_plan.md:94`, `:103`, `:131`, `:429`; `docs/desktop/g2_windows/results.md:30-40`, `:180`;
`desktop/src-tauri/src/supervise_run.rs:203-287`, `:409-433`; `desktop/src-tauri/src/supervise_check.rs:247-406`;
`desktop/src-tauri/src/supervise.rs:64-66`, `:126-135`; `desktop/src-tauri/src/supervise_shell.rs:460-495`;
`desktop/src-tauri/src/link.rs:600-631`; `desktop/src-tauri/src/dialogs.rs:226`; `desktop/src-tauri/src/main.rs:145-170`;
`backend/nq_terminal/desktop/lock.py`, `watchdog.py`, `proof.py`, `handshake.py:94-115`, `build_stamp.py`;
`backend/nq_terminal/services/prewarm.py:1-70`; `backend/nq_terminal/memtrim.py`; `desktop/harness/README.md:205`.
