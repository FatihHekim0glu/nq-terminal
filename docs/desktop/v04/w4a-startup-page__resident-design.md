# w4a-startup-page, slice resident-design: the resident-backend design for O6

Scope: `startup.md` 7.1 and roadmap v2 item O6 (reopen). Design only: no code, no test file and no build changed, and no
backend, app or browser was started, so no run window was opened and nothing was appended to
`D:/dev/v04/measure/w4a-startup-page/windows.jsonl`.

## What was written

`docs/desktop/v04/resident_backend_design.md`, for the owner to decide O6 on. In short:

- **Shape.** An opt-in switch with three values: Off (today, the default), Linger (N minutes after the last window
  closes) and At sign-in. The backend is held by a windowless host (the shell's exe with `--host`), which keeps
  today's spawn, Job Object, stdin watchdog, log drain and restart policy; every window attaches through the existing
  `try_attach` (`supervise_run.rs:240-287`), in every build, so the harness measures the path the owner runs.
- **Saving.** Usual launch from 3,098 ms to about 0.9 to 1.1 s on a quiet machine (*estimate*, `startup.md` 7.1); nearer
  1.5 to 1.6 s under the load of the 0.3.3 G2 record (*estimate*, warm HOME 1,241.3 ms there).
- **Code stamp.** The proof answer gains a stamp (the spawning exe's build id, the contract sha256, and a `fresh` flag
  from a re-walk of the backend and lab sources, `uv.lock` and `pyvenv.cfg`), covered by the MAC. Another build, a
  missing stamp or changed code refuses the attach; the window then asks the old backend to retire (a new
  authenticated route; 409 while a backtest runs) and starts a new host.
- **Prewarm.** In host mode the prewarm gate opens on the first window's presence, never on the host's own proof, so a
  backend started at sign-in writes no gate line on a day the app is not opened (05 G02).
- **Close during a backtest.** With the switch on, a close never stops the backend, so the run finishes (05 T10's
  mitigation); the O11 question stays on Stop the backend and on the first close after the switch is turned off.
- **Tests that would pin it.** Harness `usual-attach` (cold HOME at most 1,200 ms, five accepted), reliability with
  attach (40 of 40), born-failing shell and backend cases for the stamp, the retire route, presence and the prewarm
  gate, and the idle-memory rows with the window closed.
- **Eight owner questions** close the document (section 13).

Gaps in the present attach path found while reading (section 3 of the design), none of them a defect for today's use (a
second launcher meeting a live backend): the attach checks the contract number but no code stamp and not the page
build; a held lock that fails the checks ends on the stopped page; `ib_gate` only reports the IB switch for an attached
backend; the prewarm gate opens on the first proof from any caller.

## Sources read

`D:/dev/v04/research/startup.md` (sections 1, 3, 4, 7.1, 7.5, 8, 9, 10, 11), `ROADMAP_V2.md` (O6, O19, S2, w4a),
`critique.md` finding on the w4 split; `docs/desktop/02_decision.md:150-157`, `:305-318`;
`docs/desktop/owner_decisions_windows.md:130-150`; `docs/desktop/05_risks_costs.md` (G02, T02, T03, T07 to T11);
`docs/desktop/03_migration_plan.md` (sections 2.1 to 2.3, the attach and close lines);
`docs/desktop/g2_windows/results.md:30-40`, `:180`; the shell's `supervise_run.rs`, `supervise_check.rs`,
`supervise.rs`, `supervise_shell.rs`, `link.rs`, `dialogs.rs`, `main.rs`, `close_relay.rs`, `memory_target.rs`; the
backend's `desktop/lock.py`, `watchdog.py`, `proof.py`, `lifecycle.py`, `handshake.py`, `build_stamp.py`,
`services/prewarm.py`, `memtrim.py`; `desktop/harness/README.md`; the w1 merge note.

## Tests

| Test | Result |
| --- | --- |
| Prose lint, `ai_pattern_check.py` on `resident_backend_design.md` | PASS (the first run warned on five triads, reworded) |
| Prose lint on this note | PASS |
| Born-failing tests | None: a design document (the slice's `born_failing` says so). The design lists the born-failing cases a build would need (section 11) |

## Wiring for the merge

None. No file outside this slice's two documents needs a change.

## Unverified, said plainly

- The stamp re-walk cost (about 30 to 60 ms for some 1,050 files) is an estimate scaled from the web walk; not measured.
- The host's own memory and the backend's private bytes with the window closed are not measured; the design names the
  rows to take.
- The host's start cost on the first launch in Linger mode (about 50 to 100 ms) and the build estimate (3.5 to 5 days)
  are estimates.
- The effect of a delayed, below-normal sign-in start on the owner's sign-in is not known.

## 03 Appendix A addendum

Nothing was built. Every item below is proposed by the design and waits for O6; its fate is "proposed, not built".

| Item | Kind | Fate |
| --- | --- | --- |
| `docs/desktop/v04/resident_backend_design.md` | new document | kept; the O6 design |
| `nq-terminal.exe --host`, `--host --at-sign-in`, `--retire` | proposed shell modes | proposed, not built |
| `<state>/logs/host.log` | proposed log file (through `writes.rs`) | proposed, not built |
| `POST /api/desktop/presence`, `GET /api/desktop/presence` | proposed routes | proposed, not built |
| `POST /api/desktop/retire`, exit code `EXIT_RETIRED` | proposed route and exit code | proposed, not built |
| proof kind `proof2` with a `stamp` object | proposed change to the proof route | proposed, not built |
| `Mismatch::Stamp` | proposed shell refusal | proposed, not built |
| HKCU Run value for At sign-in | proposed registry write | proposed, not built |
| harness `--mode usual-attach`, `--mode reliability --attach` | proposed harness modes | proposed, not built |
