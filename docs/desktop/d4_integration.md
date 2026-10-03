# D4 integration: the shell and the backend and page in one tree (wave INT1)

Status: written by the INT1 merge on 3 October 2026. The branch `desktop/d4` (the Windows shell of waves W4A and W4B) was merged into main beside the D3 work at commit `8f8fdf6` (on top of `78a5e27`); this wave checked that merge, wired what the two sides had left to each other, and ran every check on the merged tree.

## What the merge check found

- No conflict marker anywhere (a source scan, now a test: `backend/tests/test_desktop_tree.py`).
- `.gitignore` kept `desktop/src-tauri/gen/` out but had no rule for a Rust `target` folder; it now has `target/`. No `target` or `node_modules` folder exists under `desktop/` (the same test).
- `03_appendix_a_addendum.md` keeps every wave's preflight section in wave order and the table of added modules in phase order; it lacked a row for the W4B shell modules and scripts, which are added, and the test now fails on any shell source file or script that has no row.
- `gen_03_tables.py`: 127 backend modules, 25 screen folders, 26 support folders and 35 contract rows, 0 unmapped. The port table has no collision (the shell tests use 8810 to 8813, the Playwright runs 8795 and 4273, the page and backend ports of the seam run are port 0).

## What was wired

1. **The flush before the close.** The page keeps a change for 500 ms before it sends it to the workspace store, and a window that closed at once took that change with it (born failing: a change made 0.1 s before the close was not in the store's file). The shell now holds the first close request and runs the page's flush hook, `window.__NQT_STORE_SYNC__` (`state/remoteStore.ts`, read only, defined once), a few times a second until the page reports nothing pending, the store is off or unavailable, or 4 s have passed; then it closes the window again and the supervisor asks about a running backtest and stops the backend. The shell calls the page; the page calls no shell command (the IPC scan stays green). Code: `desktop/src-tauri/src/flush.rs`, `main.rs`.
2. **How a save ended.** The browser bridge said `saved` at the click, so in the app a cancelled save dialog or a path the write policy refused still produced the "Saved" line. In a shell of bridgeVersion 2 the page now waits for the shell's word, one `nqt:save-outcome` event per download (`detail: { uri, outcome }`, the object URL of the link and `saved`, `cancelled` or `failed`), sent from the download handler (`writes_download.rs`, `save_outcome.rs`) when the engine has finished and the file has passed its check, or when the path was refused or the dialog cancelled. The shell injects bridgeVersion 2; a shell of version 1 keeps today's behaviour. Code: `web/src/bridge/browser.ts`, `window.rs`.
3. **The store's boot loop.** When reads worked and every write failed, the store's flush started a boot, which queued another flush, which cancelled the retry timer and booted again, with no delay (born failing: a test over a backend whose writes answer 503 never finished). The boot no longer queues a flush from inside a flush, the delay between sends doubles from 5 s to 60 s, and a new change starts the delay again. One sibling test that scripted twenty failed sends in 11 s now scripts two (it had counted the loop). Code: `state/remoteStore.ts`.
4. **503 on the workspace reads.** The page already treated 503 on a GET of the store as "unavailable" (never as an empty store); the contract did not name it. The two GET routes now list 503, the contract and the generated types are regenerated.
5. **Seam tests on the real backend** (`desktop/src-tauri/tests/int1_seams.rs`, on the lab this tree sits in, hidden, under the global window watch, with its state, save, profile and config folders under `D:\dev\tmp\int1`): HOME loads behind the session; the page's store answers; the injected shell object is the one `detect.ts` reads and `port_fixed` is false on the app's port; GRAB saves a PNG through the page's real bridge into the save folder, nothing else beside it, and the page says it saved; without a save folder the page says the save was cancelled; a change made just before the close is in the store after the close; a second launch on a new port finds the saved workspace; a shell attaches to a real backend through its real lock file and never stops it. The lab scan finds no new file under results, data, live or backtests output (the gate's own access log aside), nothing new in `terminal/state`, nothing on C:.

## Results on the merged tree

| Check | Result |
|---|---|
| `desktop/scripts/check.ps1 -TargetDir D:\dev\targets\int1` | 19 steps, 0 failed: fmt, Clippy (release, smoke, measure), `cargo test` default 325 passed and 1 ignored, smoke 441 passed and 3 ignored, measure 328 passed and 3 ignored, deny, audit, look.css, module scope, smoke release build, import checks, loader pin, manifest warnings, no target or node_modules folder |
| ipc_refusal | 171 of 171 commands refused (165 core, 3 plugin, 3 probes) |
| writes_allow | 21 of 23 cases refused for append, write_new and rotate each, 2 skipped with their reasons (directory symlink needs developer mode; D: makes no 8.3 names), 0 failed |
| downloads, hidden_window | 4 of 4 and 2 of 2 passed (1 ignored: the show-proof, which needs screen 2) |
| int1_seams (`NQT_REQUIRE_SEAMS=1`, so a missing lab fails instead of skipping) | 12 passed |
| supervise_attach, close_confirm, supervise_retry | 13, 4 plus 10 unit tests, and 16 passed |
| Backend `pytest` | 3,886 passed, 1 skipped (3,877 before this wave, plus the tree tests, the 503 contract test and the jobs `running` pin; the 4 tests that failed in the worktree because of the path pass here) |
| Crosscheck strict | PASS 2495, FAIL 0, INFO 104 |
| QA tests | 299 passed |
| `test:types`, `test:e2e-types` | clean |
| vitest | 494 files, 7,344 passed, 47 skipped |
| e2e | 398 passed |
| e2e:perf (alone) | 3 passed; HOME median 610 ms of 1,500; fills grid 65 ms of 500; GIP pan and zoom 60 fps |
| e2e:offline | 190 passed, 3 skipped |
| smoke_real.ps1 | passed, research files unchanged |
| build | shell 109.9 kB gzip, at its ratchet (no margin left) |

## Review fixes after the first full run

Nine findings from the seam, security and test review were fixed test first before the final run:

1. A close whose count of running backtests could not be read (a 401, a timeout, an answer over the size cap) no longer closes without asking: the dialog is skipped only for a count read as 0. `GET /api/jobs` is read with a 16 MiB cap (a full history of 200 records passes the old 1 MiB), and a backend test pins the `running` integer the shell relies on (`link.rs`, `supervise_shell.rs`, `close_confirm.rs`).
2. The release shell no longer refuses port 8765 by number, so it can attach to the backend a browser launcher started there (03 sections 2.1 and 2.2); it still checks the listener's owner against the lock before any connect and the proof after it. Smoke and measure builds still refuse 8765.
3. A lock the backend refuses as untrusted (exit code 4, no `NQT-` line) is one `lock-untrusted` page and no restart (`supervise.rs`, `stopped.html`).
4. The page's close-time flush now also sends a change after a failed send (inside the retry delay) or before the first read has ended, and the shell asks again a few times before it treats an unavailable store as final (`remoteStore.ts`, `flush.rs`).
5. The flush-on-close seam test holds the page's 500 ms timer instead of racing it with a fixed wait.
6. `downloads.rs` reads the page's `nqt:save-outcome` event, so a refused path can never read as saved.
7. The real-backend seam tests fail, not skip, in the lab tree (`NQT_REQUIRE_SEAMS`, set by `check.ps1`); in another tree `check.ps1` prints a note.
8. The seam scan reads what the run appended to the gate log and fails on any caller other than `terminal`, any end after 2021-12-31, or any sealed read.
9. The real backend is shown to refuse a request with no cookie, a forged cookie, a wrong token, a wrong nonce and a proof of another kind, port or pid.

## Open

- The shell bundle has no margin under its ratchet: any growth of the page's first-paint code must move something out first.
- The native save dialog and the first-run dialogs are never opened by an automated run (they fail closed under smoke); their `saved`, `cancelled` and `failed` words are proved through the smoke save folder and the cancelled path only.
- A backend that restarts under a running window (a new port) is covered by the shell's own restart tests and by the second launch above, not by one run that kills the backend under a live page.
- Another workflow's backend run in a worktree whose `conftest.py` predates the guard of the W3B wave can plant `nqt-planted.txt` in the shared `terminal/state` (its test writes a planted file into the lab's state folder and relies on the guard to refuse it). That file made this wave's backend run fail once; it was removed. The worktree must merge the guard.
