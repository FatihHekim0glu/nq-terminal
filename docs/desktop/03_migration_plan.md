# 03: Migration plan for the desktop terminal

Step 03 of the desktop migration. Step 02 decided what to build; this step says exactly how, piece by piece, so that the work can start without another design round. It covers the process model, the repository after the move, every API route in its desktop form, the data plane, the research gate inside the packaged app, finding the lab, JOBS and the read-only IB snapshot, saved state, keys per system, accessibility, packaging, signing, updates, CI, crash handling, tests, budgets, a dual-run period, rollback and the owner's decisions. Appendix A gives a fate to every backend module and every front-end folder; Appendix B to every dependency.

- Date: 2 October 2026. Repository `nq-terminal` (the `terminal` folder of nq-lab), HEAD `c7f9e61` (v2). The working tree held 132 uncommitted paths from another build workflow while this was written; generated tables read the working tree and say so where it matters.
- Status: **plan**, built on the decision in `02_decision.md`, which it does not reopen. Where this plan adds a mechanism that 02 did not name (four session routes, the origin-bound session, the stdin control channel), the reason is given in place.
- Inputs: `00_inventory_backend.md`, `00_inventory_frontend.md`, `00_spike_webview2.md`, `00_spike_rust.md`, `01_options.md`, `02_decision.md`, `research/L1` to `L7`, and read-only reads of `backend/nq_terminal/__main__.py`, `settings.py`, `app.py`, `security.py`, `services/jobs.py`, `web/src/api/client.ts`, `web/src/chrome/download.ts`, `web/src/state/safeStorage.ts`, `web/package.json`, `qa/pyproject.toml` and `contract/openapi.json`.
- Labels as in 02: **measured** (by an inventory or a spike on the owner's Windows 11 PC), **sourced** (a URL in the sources list, checked on 2 October 2026), **estimate** (built by this plan), **unverified** (not confirmed from a primary source). Tags S1 to S40 are the sources of `01_options.md`, D1 to D12 those of `02_decision.md`, L4-Sn and L7-Sn those of the research lenses, and M1 to M11 are new here.
- This step ran no app, opened no window, started no server and measured nothing. It read files, read the GitHub API and read vendor documentation.
- Generated parts: the route table (section 4.3), Appendix A and the generated half of Appendix B come from `tools/plan/gen_03_tables.py`, which walks the repository tree and parses the inventory, so no module or folder can be missed. Run it with the nq-lab venv Python: `gen_03_tables.py <terminal folder> <output file>`. On 2 October 2026 it reported 110 backend modules, 25 screen folders, 24 support folders, 35 QA, launcher and contract rows, and 0 unmapped rows. A review on the same day corrected some generated rows by hand: route table row `PUT /api/workspaces/{doc}`; Appendix A.1 rows 2, 38, 51, 77, 80, 86 and 110; A.2 rows 4, 10, 12, 14, 15, 16, 18, 21, 22 and 32; A.3 rows 28, 31, 32 and 35, plus two new A.3 rows (36 and 37). The generator's fate text must carry the same changes before it is run again, or the next run undoes them.

## 0. Summary

1. **Nothing is rewritten.** The React page, the FastAPI backend, the gate in nq_lab, JOBS and the IB client all stay. Of 196 rows in the module map, 155 keep their code as it is, 40 are wrapped behind a small seam (each with its stage and a seam test) and 1 (`__main__.py`, 34 lines) is rewritten; none is ported or dropped.
2. **One new process, one new folder.** A Tauri 2 shell in Rust (`desktop/`, about 1,500 lines by estimate) supervises the existing backend and shows the existing page in the system web engine. Electron replaces it on both systems if gate G1 or trigger T2 fires; the seams below are shell-neutral so that swap costs about 3 to 5 weeks (02, section 5).
3. **The page talks HTTP to the backend, as today.** No page command, no IPC for data. A backend the app starts binds a random loopback port; a backend the browser launchers start keeps `127.0.0.1:8765`, where the owner's saved state lives today (section 2.1). Either way it proves its identity to the shell and accepts `/api` calls only with a session cookie bound to one origin.
4. **Stage 1 is the speed.** Lazy imports, a result cache on the eight slow routes, desktop memory caps and a file-backed workspace store ship to the browser terminal first.
5. **The gate keeps one log.** One backend per lab, enforced by a lock file; the Mac attaches over an SSH tunnel by default, so all price reads still go through the PC's `nq_lab.data.serve` and its single `results/oos_access_log.jsonl`.
6. **Three writes, all tested.** The two JOBS writes and a new workspace PUT that writes only `terminal/state/workspaces/`. The shell gets one native write module with a deny list over the lab's data folders.
7. **Tests carry over.** pytest, vitest, Playwright, the crosscheck and the real-data smoke run unchanged on Chromium; new seam tests, a hidden-window app smoke, an IPC refusal test, a JavaScriptCore golden run and a WebDriver smoke set on the Mac are added.
8. **Effort.** About 19 to 34.5 focused weeks on the Tauri path: 02's 18 to 32.5 (02, section 5) plus 1.15 to 1.95 weeks for work this plan's review added (second-backend paths, the page build check, app zoom, a drift run in the real engine, the hidden-window proof and portable links). Broken into 40 work items in section 21.
9. **Fallback for the whole period.** `start.ps1` and the browser keep working against the same backend; the app attaches when the browser door is already up, and the other way round.
10. **Owner decisions** are listed in section 23; G0 (which Mac, remote or local lab) is the one that blocks stage 3.

## 1. Scope and what must not regress

In scope: a Windows 11 app and a macOS app for one owner, built from this repository, using the lab checkout already on the PC. Out of scope: an app that runs without the lab (a bundled Python engine is a later phase, 02 section 8.6), any change inside nq_lab except the one named in G0 for local-lab mode, and any change to how research is done.

Invariants, each with the place in this plan that holds it:

| Invariant | Held in |
|---|---|
| Out-of-sample gate: nothing after 2021-12-31 served, sealed data never served, one gate log line per read with `caller="terminal"` | section 6 |
| No writes under `results/`, `data/` or `live/` by the terminal or the shell | sections 6, 8, 10, 13 |
| Read-only IB: client id 95, paper accounts only, live ports refused, every order method raising, AST ban | section 9 |
| The three-way crosscheck at 1e-9 relative and 1e-12 for stored values, including the PCG64 draw order | sections 5, 15 |
| The contract in `contract/openapi.json` and the generated TypeScript types | section 4 |
| WCAG 2.2 AA, the keyboard grammar, F-keys | sections 11, 12 |
| The amber-on-black look and amber-classic, contrast pairs tested per look and scheme | sections 12, 15 |
| Browser budgets: HOME first render 1,500 ms, grid 500 ms, shell bundle 114.9 kB gzip, library chunk budgets | section 18 |
| The browser terminal keeps working | sections 19, 20 |

## 2. Target architecture

### 2.1 Process model

Windows, local mode (the default on the PC):

```
 nq-lab terminal.exe  (Tauri 2.12.x, Rust; one process, about 3 MB private on the spike)
   | owns: window, splash, lab picker, supervision, identity checks, downloads,
   |       the one native write module, logs, menus; no page commands
   |
   |-- WebView2 (Evergreen runtime, Chromium 154 on this PC; 6 processes on the spike)
   |      page: http://127.0.0.1:<P>/   served by the backend (web/dist)
   |      cookie nqt_s_<P> (HttpOnly, SameSite=Strict, Path=/api) set by the shell
   |      fetch('/api/...') and EventSource('/api/live/stream'), same origin as today
   |
   |-- python.exe  (<lab>/.venv, -E -s -X utf8 -X faulthandler -m nq_terminal)
          working folder terminal/backend; stdin: control channel; stdout: handshake
          binds 127.0.0.1:0 -> port P; lock file terminal/state/backend.lock
          |-- nqt-jobs thread -> Popen [python, -u, backtests/run_base.py, --config, ...]
          |-- optional ibapi socket, client id 95, paper port 7497 only
          |-- nq_lab.data.serve -> oos_gate -> results/oos_access_log.jsonl
   Job Object: the shell puts the backend in a job with kill-on-close as a second guard
```

macOS, remote mode (the default for the Mac, G0):

```
 nq-lab terminal.app  (same Rust source, WKWebView)
   |-- /usr/bin/ssh -N -L 127.0.0.1:<L>:127.0.0.1:<P> <pc-alias>   (child process)
   |-- ssh <pc-alias> reads terminal/state/backend.lock -> port P, token
   |-- WKWebView page: http://127.0.0.1:<L>/  through the tunnel
   |      session cookie bound to origin http://127.0.0.1:<L>
   v
 the PC's backend, as above (started by the PC app, by start.ps1, or on demand over SSH)
```

The browser door (kept):

```
 start.ps1 or start.sh -> takes the lock and starts the backend on 127.0.0.1:8765 (NQT_PORT=8765,
   never port 0), or attaches to the backend named in the lock (port P, 8765 or the app's random port)
   -> GET /api/session/code (token header)
   -> opens http://127.0.0.1:<8765 or P>/session.html#<code> -> page redeems the code once
   -> cookie bound to that origin; fragment removed with history.replaceState
```

**Why the browser door keeps 8765.** The owner's ten `localStorage` keys (inventory 10.3) live in the storage of the origin `http://127.0.0.1:8765` and nowhere else. A page on any other port starts with empty storage, so moving the browser door to random ports before the one-time import (section 10.4) had read those keys would leave the owner's workspaces and layouts behind for good. Copied `#go=` links also name that port (section 4.6). So a backend started by the browser launchers always binds 8765, behind the token, and port 0 applies only to a backend the app starts. This narrows 02's random port (C3-4) to the app; the identity proof, the token and the sessions are the same on both. If 8765 is taken by something that is not a terminal backend, the launcher stops with a message, as `start.ps1` does today.

Rules that hold in every mode:

- **One backend per lab.** The lock file decides; a second launcher attaches. Only the process that spawned the backend ends it; an attached client never stops it. The lock is taken in the start-up of `create_app` (its lifespan), not in `__main__.py`, so every way of starting a backend takes it, including `uvicorn nq_terminal.app:create_app` and `uvicorn --reload`. The lock belongs to a state folder (`NQT_STATE_DIR`, default `<ROOT>/terminal/state`). A backend for tests or the real-data smoke runs with its own temporary state folder and `NQT_JOBS=off`, so it holds its own lock and token, never meets the owner's backend, and can start neither a real backtest nor the IB snapshot: the real JOBS runner and client 95 run only in a backend that holds the lock of `<ROOT>/terminal/state` (section 8). The exempt paths and their owner are listed in section 2.6.
- **Page and API share one origin** per client, as today, so the CSP, `SameOriginApiMiddleware`, `TrustedHostMiddleware` and the EventSource path are unchanged.
- **The page gets no shell command.** The Tauri capability file for the main window grants nothing (D10). Downloads go through the shell's download handler; the splash and "backend stopped" pages are shell assets with no script access to the shell.

### 2.2 Start-up sequence (Windows, cold)

| Step | Who | What | Budget (estimate unless marked) |
|---:|---|---|---|
| 1 | shell | `main`; read settings (lab root, data folder); single-instance check (a second launch focuses the first, arguments ignored) | 23 ms measured on the spike |
| 2 | shell | read `terminal/state/backend.lock`; if present, call `GET /api/desktop/proof` with the token; on a valid proof, attach (go to step 6) | 50 ms |
| 3 | shell | create the hidden-until-ready window with the bundled splash in the look; build WebView2 with its data folder on the owner's chosen drive | 318 ms measured for window and WebView2 |
| 4 | shell | spawn the backend with the allow-listed environment; write a 32-byte random token and a nonce on its stdin | in parallel with step 3 |
| 5 | backend | lazy imports; take the lock; bind port 0; print one handshake line; serve | 1.5 s target, 2.5 s ceiling (02, T3) |
| 6 | shell | check the handshake: HMAC, ROOT equals the picked lab, `sys.prefix` equals `<lab>/.venv`, desktop contract number between the shell's `min` and `max` (section 4.4), page build current (`dist` field, section 7.1); then `GET /api/session` with the token and origin `http://127.0.0.1:<P>`; `set_cookie` into the webview (M3) | 20 ms |
| 7 | shell | navigate from the splash to `http://127.0.0.1:<P>/` | |
| 8 | page | HOME as today | warm HOME 1,000 ms target |

Cold double-click to HOME with data: 3.5 s target, 5 s ceiling (02, section 4). The splash must be painted within 500 ms (ceiling 1,000 ms).

The handshake line is one line of JSON on stdout, prefixed so that stray output cannot be mistaken for it:

```
NQT-READY {"v":1,"port":53117,"pid":4120,"proof":"<hex HMAC-SHA256(token, nonce|port|pid)>",
           "root":"C:\\Users\\...\\nq-lab","prefix":"C:\\Users\\...\\nq-lab\\.venv",
           "nq_lab":"...\\src\\nq_lab","nq_terminal":"...\\terminal\\backend\\nq_terminal",
           "contract":3,"openapi_sha256":"<all 64 hex of the openapi.json sha256>",
           "dist":"current","mode":"desktop"}
```

A second instance that finds a live lock prints `NQT-ATTACH {"port":...}` and exits 0 without binding. A stale lock (pid gone, or the proof fails) is replaced after a check that no process holds the port.

### 2.3 Shutdown sequence

1. The window closes. If the shell spawned the backend and `GET /api/jobs` shows a running job, a native dialog asks: "A backtest is running. Closing stops it. Close anyway?" (the page is not involved).
2. The shell lets WebView2 flush storage (the spike found that a hard kill within 10 s loses `localStorage` writes, which matters less once workspaces live in files) and closes the webview.
3. The shell closes the backend's stdin. The backend's watchdog sees end of file, calls `JobService.close()` (which terminates a running child and kills it after its grace period), releases the lock and exits.
4. If the backend is still alive after 5 s, the Job Object ends the tree. On macOS the watchdog is the only guard, which is why it lives in the backend (02, C1-8).
5. In attach mode the shell only closes its window; the backend stays up for whoever owns it.

### 2.4 The stdin control channel

The backend reads its stdin on a daemon thread. Lines are `TOKEN <hex>` and `NONCE <hex>` (once, at start), and nothing else is accepted; end of file means "parent gone". The token never appears in argv, the environment or a URL, so other processes cannot read it from the process list (L7, section 5). The browser launchers, which start the backend detached, pass the token the same way and keep the pipe open for the life of the launcher window, as `start.ps1` already keeps the tree today.

### 2.5 Who owns what

| Concern | Shell (Rust) | Backend (Python) | Page (TypeScript) | Lab (nq_lab) |
|---|---|---|---|---|
| Window, menus, splash, single instance | yes | | | |
| Spawning, attaching, identity proof, restarts | yes | lock, handshake, watchdog | | |
| Auth | sets the cookie | token, sessions, origin binding | none (cookie is HttpOnly) | |
| Data | none | every route, caches | views | gate, parquet reads |
| Writes | downloads, logs, settings, diagnostics (deny list) | `jobs.json`, workspaces | none of its own | gate log line, backtest outputs |
| Keys | accelerators off, menus | | the whole grammar | |

### 2.6 Second backends: the paths that skip `__main__.py`

The repository already starts backends without `__main__.py`. Each gets a rule, and work item 1.4c owns all of them, so none is left without an owner when the token lands:

| Path | Today | After 1.3 and 1.4 | Acceptance |
|---|---|---|---|
| `scripts/smoke_real.ps1` | a second backend (`uvicorn`, `nq_terminal.app:create_app`) on 8953 against the real data root, `vite preview` on 4953 with `/api` proxied; never 8765 | same ports; the backend gets a temporary `NQT_STATE_DIR` and `NQT_JOBS=off`, so it takes its own lock and cannot run a job or the IB snapshot; the script reads the token from that lock, mints a code and hands the session page URL to Playwright | the smoke passes behind the token, and its existing checks (research hashes unchanged, only `caller="terminal"` gate lines appended) still hold |
| `web/e2e/perf/real.config.ts` | reads `NQT_SMOKE_WEB_ORIGIN`, refuses 8765 | a global set-up redeems the code on the preview origin (4953) and saves the cookie as Playwright storage state | `smoke.real.ts` loads HOME with the cookie; without it every `/api` call gets 401 |
| `backend/tests/fixture_app.py` and `web/playwright.config.ts` | fixture backend on a spare port, preview on another, fake JOBS | the fixture backend takes its own temporary state folder, lock and token (fake JOBS stays; it never reaches `run_base.py`); a global set-up redeems a code on the preview origin | the 383 Playwright tests pass with the token middleware on |
| `web/vite.config.ts` | dev proxy of `/api` to 8765 (plain form, so the `Origin` header passes unchanged); the default build input `index.html` only | `session.html` added as a second build input; the dev proxy still points at 8765 and keeps the `Origin` header, so a session can bind to the dev origin (5173) | a test builds and finds `dist/session.html`; the dev path below works |
| `start.ps1 -Dev` | `uvicorn --reload` on 8765 plus Vite on 5173 | the reloading backend takes the real lock like any other (each reload releases and retakes it; a stale pid is replaced); when the app or `start.ps1` already holds the lock, `-Dev` stops with a message instead of attaching, because it needs its own reloading backend; it mints a code and opens `http://127.0.0.1:5173/session.html#<code>` | `-DryRun` shows the plan; a launcher test covers "lock held" and "lock free" |
| Offline Playwright (`playwright.offline.config.ts`) | Node demo API, no Python | unchanged: no backend, no token | the offline project is unchanged |

The session for a proxied page is bound to the proxy's origin (4953 or 5173), which is why sessions are bound per origin (section 4.2) rather than to one fixed origin.

## 3. Repository layout after the move

New and changed paths in `nq-terminal`; everything else stays where it is.

```
terminal/
  backend/nq_terminal/
    desktop/                 NEW  handshake.py, lock.py, watchdog.py, sessions.py, envlist.py
    api/desktop.py           NEW  /api/desktop/proof, /api/session, /api/session/code, /api/session/redeem
    api/workspaces.py        NEW  GET list, GET one, PUT one
    models/workspaces.py     NEW  versioned documents, seven allowed names, size caps
    services/result_cache.py NEW  mtime-keyed result cache for the eight slow routes
    services/workspaces.py   NEW  atomic writes under terminal/state/workspaces
    __main__.py, app.py, settings.py, security.py, services/jobs.py, services/files.py,
    services/bars.py, api/jobs.py, api/system.py  CHANGED (Appendix A)
  backend/tests/fixture_app.py CHANGED  own state folder, lock and token (section 2.6)
  backend/tests/             + test_desktop_*.py, test_session_*.py, test_workspaces_*.py,
                               test_result_cache.py, test_env_allowlist.py, test_startup_imports.py
  web/
    session.html             NEW  static bootstrap page that redeems a launch code
    src/bridge/              NEW  index.ts (interface), browser.ts (today's behaviour), detect.ts
    src/state/remoteStore.ts NEW  workspace store client with localStorage as a cache
    src/selftest/            NEW  in-app self-test page, built only with `vite build --mode selftest`
  desktop/                   NEW  the shell
    src-tauri/Cargo.toml, Cargo.lock, rust-toolchain.toml, tauri.conf.json, build.rs
    src-tauri/capabilities/main.json     grants nothing to the page
    src-tauri/src/main.rs                window, menus, single instance, settings
    src-tauri/src/supervise.rs           spawn, attach, restart policy, Job Object, stdin channel
    src-tauri/src/link.rs                the only module allowed a TCP connection: 127.0.0.1 only
    src-tauri/src/writes.rs              the only module allowed file writes: deny list, full path resolution
    src-tauri/src/keys.rs                WebView2 accelerator settings, macOS menus
    src-tauri/src/tunnel.rs              macOS remote mode: ssh child, lock read
    src-tauri/src/crash.rs               panic hook, log rotation, diagnostics export
    src-tauri/assets/splash.html, stopped.html, look.css (tokens copied from web/src/theme by a build step)
    deny.toml, clippy.toml, README.md
    harness/                 hidden-window measurement harness (from spike_rust/scripts/drive.mjs)
  .github/workflows/
    desktop-check.yml        NEW  pull requests: shell lints and tests, vitest, offline Playwright
    desktop-release.yml      NEW  tag `desktop-v*`: Windows NSIS build, checksums
    webview2-drift.yml       NEW  weekly: the hidden smoke build of the shell on the current WebView2 runtime
    mac-webkit.yml           NEW  pull requests touching web/src/quant: golden tests under JavaScriptCore
  state/                     (git-ignored, as today)
    jobs.json, backend.lock, workspaces/*.json, logs/
  docs/desktop/              this plan and its tools
```

The shell sits in its own folder so that a move to Electron replaces `desktop/` and nothing else. Settings of the shell (lab root, data folder, remote host, zoom level) live in the operating system's per-user config folder (the roaming per-user data folder on Windows, `~/Library/Application Support` on macOS), small JSON, written through `writes.rs`.

## 4. The UI-to-compute contract

### 4.1 Principle

The contract stays HTTP and JSON on one origin, described by `contract/openapi.json` and turned into TypeScript types by `openapi-typescript`. The desktop adds no second channel for data:

- **Rejected: Tauri commands or channels for data** (option D of L7, section 5): it would duplicate the contract in Rust and put the IPC surface on the hot path; Tauri had two IPC advisories in 2026 (S21).
- **Rejected: a custom scheme proxy:** SSE cannot stream through wry's scheme handler (S6).
- **Kept:** relative `fetch('/api/...')` with `credentials: 'same-origin'` and `new EventSource(path)` from `api/client.ts`. A same-origin EventSource created without `withCredentials` uses the Anonymous CORS state, whose credentials mode is "same-origin", so the cookie is sent (M1). Cookies do not isolate by port (M2), so the cookie name carries the port: `nqt_s_<P>`.

### 4.2 Authentication on the loopback port

- The token (32 random bytes) is the backend's master secret. It is held in memory, in the lock file (owner-only ACL on Windows, mode 0600 on macOS) and in the memory of the shells and launchers that read it.
- `GET /api/session` exchanges the token (header `Authorization: NQT <hex>`) and an origin (header `X-NQT-Origin`) for a session value bound to that origin. `GET /api/session/code` mints a single-use code that lives 60 s; `GET /api/session/redeem` swaps the code for a session bound to the origin of the page that redeemed it. These are GETs that change only in-memory state; the write ban concerns disk, and the GET-only test treats them like any other GET.
- The middleware checks every `/api` request (the stream included) for a cookie whose value names a live session, compares with `hmac.compare_digest`, and, when an `Origin` header is present, requires it to equal that session's origin. `/api/desktop/proof`, `/api/session` and `/api/session/code` take the token header instead; `/api/session/redeem` takes the code. Static files under `/` need no cookie: they hold no data.
- Why sessions bound to an origin, and not 02's "exactly one origin": in remote mode the Mac page's origin is `http://127.0.0.1:<L>`, the tunnel's local port, which differs from the backend's own port. Binding the allowed origin to each session keeps "one origin per client" without a second allow list.

### 4.3 Every route in its desktop form

Generated from the inventory route table, plus the working-tree contract and the new routes. "Stage" points to the stage 1 or 2 item that touches the route; every route is also covered by the token middleware (1.4).

Rows: 77 from the inventory route table, 1 found only in the working-tree contract, 7 new. Inventory routes cached in stage 1.2: 8.

| # | Method | Path | Handler | Size | Cost | Cold / warm ms | Desktop form | Stage |
|---:|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/openapi.json` | `fastapi.openapi` | L | heavy | 917 / 6 | unchanged; read by the contract drift test only, never by the page | none |
| 2 | GET | `/api/health` | `system.health` | XS | light | 28 / 34 | unchanged, polled every 2 s; reports the contract version beside today's fields so the page can compare it with bridgeVersion | 1.3 |
| 3 | GET | `/api/audit/oos-log` | `audit.oos_log` | L | medium | 160 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 4 | GET | `/api/audit/openings` | `audit.openings` | XS | light | 39 / 34 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 5 | GET | `/api/audit/spec-hashes` | `audit.spec_hashes` | S | light | 19 / 14 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 6 | GET | `/api/live/status` | `live.status` | XS | light | 4 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 7 | GET | `/api/live/journal` | `live.journal` | XS | light | 3 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 8 | GET | `/api/live/log` | `live.log` | M | light | 7 / 104 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 9 | GET | `/api/live/performance` | `live.performance` | XS | light | 3 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 10 | GET | `/api/live/routes` | `live.routes` | XS | light | 4 / 2 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 11 | GET | `/api/commands` | `commands.commands` | S | light | 12 / 11 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 12 | GET | `/api/registry` | `research.registry` | S | light | 5 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 13 | GET | `/api/hypotheses` | `research.hypotheses` | M | light | 40 / 37 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 14 | GET | `/api/hypotheses/{name}` | `research.hypothesis` | S | light | 14 / 13 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 15 | GET | `/api/hypotheses/{name}/series` | `research.hypothesis_series` | M | light | 17 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 16 | GET | `/api/multiple-testing` | `research.multiple_testing` | S | light | 7 / 5 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 17 | GET | `/api/confirmations` | `research.confirmations` | XS | light | 5 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 18 | GET | `/api/sealed` | `research.sealed_index` | XS | light | 5 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 19 | GET | `/api/sealed/{name}` | `research.sealed` | XS | light | 6 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 20 | GET | `/api/runs` | `runs.list_runs` | M | light | 50 / 33 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 21 | GET | `/api/runs/compare` | `runs.compare_runs` | M | heavy | 1145 / 280 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 22 | GET | `/api/runs/stats` | `runs.run_stats` | XS | medium | 260 / 240 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 23 | GET | `/api/runs/{run_id}` | `runs.run_detail` | S | light | 8 / 6 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 24 | GET | `/api/runs/{run_id}/trades` | `runs.run_trades` | M | medium | 217 / 18 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 25 | GET | `/api/runs/{run_id}/fills` | `runs.run_fills` | M | heavy | 535 / 12 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 26 | GET | `/api/runs/{run_id}/log/{section}` | `runs.run_log` | L | light | 29 / 27 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 27 | GET | `/api/runs/{run_id}/equity` | `runs.run_equity` | L | medium | 60 / 56 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 28 | GET | `/api/runs/{run_id}/sidecar/{name}` | `runs.run_sidecar` | S | light | 8 / 6 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 29 | GET | `/api/ledger` | `runs.ledger` | S | very heavy | 4312 / 671 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 30 | GET | `/api/bars` | `data.get_bars` | M | medium | 34 / 9; 55 / 8 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 31 | GET | `/api/data/catalog` | `data.data_catalog` | M | light | 49 / 12 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 32 | GET | `/api/market/universe` | `data.market_universe` | M | medium | 436 / 16 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 33 | GET | `/api/market/pair-corr` | `data.market_pair_corr` | M | light | 34 / 31 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 34 | GET | `/api/qa` | `data.qa_index` | XS | light | 9 / 7 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 35 | GET | `/api/qa/{name}` | `data.qa_report` | S | light | 12 / 10 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 36 | GET | `/api/market/rv` | `data.market_rv` | M | light | 20 / 21 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 37 | GET | `/api/market/two-day` | `data.market_two_day` | M | heavy | 1260 / 891 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 38 | GET | `/api/analytics/hypothesis/{name}` | `analytics.hypothesis_analytics` | L | medium | 390 / 178 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 39 | GET | `/api/analytics/hypothesis/{name}/panel` | `analytics.hypothesis_panel` | L | medium | 113 / 111 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 40 | GET | `/api/analytics/run/{run_id}` | `analytics.run_analytics` | L | medium | 180 / 130 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 41 | GET | `/api/analytics/run/{run_id}/panel` | `analytics.run_panel` | M | medium | 80 / 79 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 42 | GET | `/api/analytics/run/{run_id}/trades` | `analytics.run_trades` | S | medium | 258 / 86 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 43 | GET | `/api/analytics/run/{run_id}/costs` | `analytics.run_costs` | S | medium | 298 / 314 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 44 | GET | `/api/analytics/run/{run_id}/exposure` | `analytics.run_exposure` | XL | heavy | 667 / 718 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 45 | GET | `/api/analytics/hypothesis/{name}/extended` | `analytics.hypothesis_extended` | L | medium | 279 / 270 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 46 | GET | `/api/analytics/run/{run_id}/extended` | `analytics.run_extended` | M | medium | 258 / 272 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 47 | GET | `/api/analytics/hypothesis/{name}/bootstrap` | `analytics.hypothesis_bootstrap` | M | heavy | 1408 / 1450 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 48 | GET | `/api/analytics/run/{run_id}/bootstrap` | `analytics.run_bootstrap` | M | heavy | 1405 / 1410 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 49 | GET | `/api/analytics/deflated` | `analytics.deflated_sharpe` | S | heavy | 1062 / 459 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 50 | GET | `/api/analytics/run/{run_id}/trade-paths` | `analytics.run_trade_paths` | XS | medium | 111 / 102 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 51 | GET | `/api/analytics/run/{run_id}/excursions` | `analytics.run_excursions` | XS | light | 6 / 5 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 52 | GET | `/api/analytics/paper-tracking` | `analytics.paper_tracking` | XS | light | 4 / 3 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 53 | GET | `/api/instruments/{root}` | `instruments.instrument` | S | light | 17 / 12 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 54 | GET | `/api/live/stream` | `live_stream.stream` | stream | - | - | same-origin SSE, cookie checked by the token middleware (EventSource sends same-origin cookies); app smoke asserts stream mode, not polling; minimise-and-restore case | 1.4, 2.4 |
| 55 | GET | `/api/market/vcone` | `vcone.market_vcone` | S | medium | 228 / 22 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 56 | GET | `/api/market/vcone/universe` | `vcone.market_vcone_universe` | S | medium | 308 / 320 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 57 | GET | `/api/seasonality/instrument/{root}` | `seasonality.instrument_seasonality` | S | very heavy | 2268 / 2066 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 58 | GET | `/api/seasonality/hypothesis/{name}` | `seasonality.hypothesis_seasonality` | S | medium | 249 / 48 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 59 | GET | `/api/events/calendar` | `events.event_calendar` | M | light | 21 / 14 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 60 | GET | `/api/events/study` | `events.event_study` | M | medium | 197 / 22 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 61 | GET | `/api/market/rolls` | `roll.market_rolls` | L | medium | 272 / 265 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 62 | GET | `/api/market/paper-rolls` | `roll.market_paper_rolls` | XS | light | 4 / 4 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 63 | GET | `/api/dq/symbols` | `dq.symbols` | S | medium | 364 / 394 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 64 | GET | `/api/dq/calendar/{symbol}` | `dq.calendar` | M | light | 13 / 13 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 65 | GET | `/api/dq/guards` | `dq.guard_status` | S | light | 41 / 223 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 66 | GET | `/api/analytics/spa` | `spa.family_spa` | S | very heavy | 3575 / 307 | unchanged contract plus the mtime-keyed result cache; cached and fresh dumps compared | 1.2 |
| 67 | GET | `/api/analytics/hypothesis/{name}/risk-extras` | `risk_extras.hypothesis_risk_extras` | S | medium | 225 / 50 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 68 | GET | `/api/analytics/run/{run_id}/risk-extras` | `risk_extras.run_risk_extras` | S | medium | 87 / 55 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 69 | GET | `/api/analytics/hypothesis/{name}/trend-regime` | `regimes_capacity_term.hypothesis_trend_regime` | M | medium | 76 / 79 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 70 | GET | `/api/analytics/run/{run_id}/trend-regime` | `regimes_capacity_term.run_trend_regime` | M | medium | 96 / 91 | unchanged (same GET, same JSON), token cookie checked | 1.4 |
| 71 | GET | `/api/analytics/run/{run_id}/capacity` | `regimes_capacity_term.run_capacity` | S | heavy | 647 / 618 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 72 | GET | `/api/market/term-structure/{root}` | `regimes_capacity_term.market_term_structure` | L | heavy | 546 / 316 | unchanged; profiled again after 1.1, cache only if it misses its budget | 1.1 |
| 73 | GET | `/api/ib/snapshot` | `ib.ib_snapshot` | XS | light | 4 / 2 | unchanged, opt-in (NQT_IB_READONLY=1); one backend per lab, so one client id 95 | 1.3 |
| 74 | GET | `/api/jobs` | `jobs.list_jobs` | XS | light | 2 / 2 | unchanged read; loads nautilus_trader lazily as today | 1.4 |
| 75 | POST | `/api/jobs` | `jobs.queue_job` | - | - | - | unchanged write (one of three); refused unless sys.prefix is ROOT/.venv and, in desktop mode, NQT_FIXTURE_DIR is unset; child gets the allow-listed environment | 1.3, 1.5 |
| 76 | GET | `/api/jobs/{job_id}` | `jobs.read_job` | XS | light | 3 / 3 | unchanged read; loads nautilus_trader lazily as today | 1.4 |
| 77 | DELETE | `/api/jobs/{job_id}` | `jobs.remove_job` | - | - | - | unchanged write (one of three); refused unless sys.prefix is ROOT/.venv and, in desktop mode, NQT_FIXTURE_DIR is unset; child gets the allow-listed environment | 1.3, 1.5 |
| 78 | GET | `/api/analytics/paper-expectation` | working tree only (uncommitted) | not measured | not measured | not measured | unchanged GET once committed; measured at the start of stage 1 | 1.4 |
| new | GET | `/api/desktop/proof` | new (stage 1.3) | XS | light | not built | header `Authorization: NQT <token>` and a nonce; answers the HMAC of token, nonce, port and pid, plus ROOT, sys.prefix and the contract version; re-run by the shell on every top-level navigation | 1.3 |
| new | GET | `/api/session` | new (stage 1.4) | XS | light | not built | token header plus the caller's origin; returns a session value bound to that one origin and sets the HttpOnly, SameSite=Strict cookie on Path=/api; used by the shells, which then set the cookie in the webview | 1.4 |
| new | GET | `/api/session/code` | new (stage 1.4) | XS | light | not built | token header; mints a single-use launch code that lives 60 s; used by start.ps1 and the Mac launcher | 1.4 |
| new | GET | `/api/session/redeem` | new (stage 1.4) | XS | light | not built | code in a header, sent by the static `session.html` page that read it from the URL fragment; sets the cookie bound to the browser's origin; the code dies on first use | 1.4 |
| new | GET | `/api/workspaces` | new (stage 1.6) | XS | light | not built | lists stored documents with their versions | 1.6 |
| new | GET | `/api/workspaces/{doc}` | new (stage 1.6) | XS | light | not built | reads one stored document | 1.6 |
| new | PUT | `/api/workspaces/{doc}` | new (stage 1.6) | XS | light | not built | the third write: versioned (If-Match), size-capped, schema-checked, writes only terminal/state/workspaces/<doc>.json; doc from a fixed allow list of seven names (the six documents of section 10.2 plus `meta`, with the `meta` rules given there) | 1.6 |

### 4.4 Versioning

- **Contract version:** a whole number, the desktop contract, kept in `contract/desktop_version.json` beside `openapi.json` together with the full sha256 (64 hex characters) of the part of `openapi.json` the shell itself calls: `/api/desktop/proof`, the three session routes and `/api/health`, serialised canonically. The contract drift test fails when that part changes and the number has not moved up by one in the same commit, so the number only ever grows. The page and the backend come from the same checkout, so only the shell can be out of step with them, and only on that part; a new screen route does not move the number and does not need a new shell. The handshake and `/api/health` report the number and, for logs and the page build check (section 7.1), the full 64-hex sha256 of the whole `openapi.json`; no shortened hash is used anywhere. The shell carries two numbers, `contract_min` and `contract_max`, set in `tauri.conf.json` at build time from the contract numbers of the git tags it was tested against, and accepts a backend when `contract_min <= contract <= contract_max`. Outside that it shows a "lab checkout and app are out of step" page that names the side to update.
- **Bridge version:** an integer the shell injects before any page script runs (initialization script, M3), together with `platform` (`windows`, `macos`, `browser`) and `keys` (`pc` or `mac`). The page reads it in `bridge/detect.ts`; features its shell cannot serve are turned off, never emulated. The browser build reports `bridgeVersion: 0`.

### 4.5 The bridge interface in the page

```ts
// web/src/bridge/index.ts (sketch)
export interface ShellBridge {
  readonly bridgeVersion: number          // 0 in a browser
  readonly platform: 'browser' | 'windows' | 'macos'
  readonly keys: 'pc' | 'mac'
  saveFile(name: string, data: Blob): Promise<'saved' | 'cancelled' | 'failed'>
  copyText(text: string): Promise<boolean>
  copyImage(png: Blob): Promise<boolean> // must start inside the click (Safari rule, inventory 10.4)
}
```

- In every shell `saveFile` is today's object-URL anchor; the shell's download handler (D2) turns it into a native save dialog and a write through `writes.rs`. So `saveFile` has one implementation, and the bridge only reports the outcome where the browser cannot.
- `copyText` and `copyImage` use the Clipboard API first. A native fallback command exists only if G1 or the Windows smoke finds the API failing; it would take bytes only, never a path (02, C3-1).
- A source scan test, like today's `findWriteRequests`, fails on any `window.__TAURI__`, `invoke(` or `ipc` use in `web/src`.

### 4.6 Copied links (`#go=`)

Decision: **no launch-argument deep links in the app.** The single-instance plugin ignores forwarded arguments and there is no deep-link plugin (02, C3-12; Appendix B.2), and a link that names the app's random port stops working at the next launch. Instead:

- **Copy link** (`chrome/copyLink.ts`) keeps its two rows. In the browser door on 8765 it still copies the full address, which stays valid because that port is fixed (section 2.1). `/api/health` gains a field `port_fixed` (true only for a backend a browser launcher started on 8765), and the page reads it. Everywhere else (the app, or a browser attached to the app's random port) Copy link copies the portable command string `#go=<line>` alone, and the message line says so.
- **Pasting it back:** the command line accepts a pasted `#go=...` string and runs it through the same reader as the address bar (`chrome/deepLink.ts`: at most 8 lines, the restricted alphabet, only the run, context and help actions), so a link from either side opens the same view in the other.
- **HELP** explains the portable form. `chrome/copyLink.ts`, `chrome/deepLink.ts` and the command line change in work item 1.7; tests cover the full address on the fixed origin, the bare string elsewhere, and a pasted string that the reader refuses (bad alphabet, too many lines, a forbidden action).

A launch argument (or a protocol handler) can be added later as its own item if the owner wants links from outside the app; it would pass the first launch's arguments to the page through the initialization script, never through a page command.

## 5. Data plane and serialisation

- **Transport:** HTTP/1.1 on loopback through uvicorn and `h11`, as today; no TLS (loopback only, never bound to another interface), no compression (the inventory found no gzip middleware; on loopback the encode cost would exceed the copy saved, estimate).
- **Format:** JSON for every route; the sanitiser rules in `services/files.py` (NaN to null, nanosecond timestamps, decimal strings) are part of the contract and do not change. The largest bodies are chart series: exposure 1.49 MB, hypothesis analytics 792.6 kB, run analytics 683.7 kB (measured). The longest data hop is at most 20,000 points per series (`MAX_POINTS`, 02 section 8.5).
- **Stream:** Server-Sent Events, one stream, resume by `Last-Event-ID`, heartbeat, a lifetime after which the client reconnects; unchanged. The desktop smoke asserts stream mode, not the 2 s polling fallback (L1, section 5.4).
- **Perspective:** fills and trades arrive as JSON and are loaded into the wasm32 engine in its worker; the 4.0 MB of WebAssembly is fetched once per profile and cached by the engine.
- **Binary columns:** not now. Only if trigger T5 fires (pan and zoom p95 over 25 ms at 20,000 points, or the 20,000-bar hop over 100 ms). Then Arrow IPC from pyarrow (already loaded) for the chart series routes only, behind a second media type on the same paths, with the JSON form kept for tests and the crosscheck (2 to 3 weeks, 02).
- **Caches, from the disk up:**

| Layer | Where | Key | Bound | Change |
|---|---|---|---|---|
| OS file cache | system | | | none |
| `FileCache` | backend | path, mtime, size | entries and bytes | desktop default 128 MiB (1.5) |
| `GatedBarCache` | backend | year-aligned frames per symbol, timeframe, variant | `NQT_CACHE_BYTES` | desktop default 512 MiB, browser keeps 2 GiB unless the owner chooses (1.5) |
| Result cache (new) | backend | route, normalised query, and the (path, mtime_ns, size) of every file the computation read | 64 MiB of serialised bodies, least recently used (estimate) | 1.2 |
| TanStack Query | page | query key | 30 s stale | none |

- **Result cache rules.** Inputs are recorded by a read hook in `FileCache` and in the bar service during the first computation, so the key cannot miss a file. Bar reads through the gate are keyed on the parquet file's mtime and size from the catalogue. A cache hit performs no price read and therefore writes no gate log line, exactly as a `GatedBarCache` hit does today. Results that depend on the clock (live screens) are never cached. Bootstrap and SPA results are deterministic for a given seed and input, so caching them changes no number; the crosscheck compares cached and fresh bodies byte for byte (1.2).

## 6. The research gate in the packaged app

The gate is not in the terminal and does not move. What the desktop adds is more places that must not open a second door.

1. **One door to prices.** `nq_lab.data.serve` stays the only price path; the AST scans that ban parquet reads outside the gate, order-style IB names and non-GET routes run unchanged.
2. **The shell has no data path.** Clippy `disallowed-methods` bans `std::fs` reads and writes outside `writes.rs` and `main.rs`'s settings loader, and `std::net::TcpStream` outside `link.rs`, which connects only to `127.0.0.1` on the handshake's port (a unit test feeds it another host and expects a refusal). cargo-deny bans crates for parquet, Arrow, Polars, DuckDB, DataFusion and IB by name, with a source allow list (crates.io only) and reviewed lockfile changes; banning by name does not stop a renamed crate, and the plan does not claim it does (02, section 7.2).
3. **The write deny list.** `writes.rs` resolves every destination fully (symlinks, junctions, 8.3 names, the `\\?\` prefix on Windows; `realpath` on macOS) and refuses anything under `<lab>/results`, `data`, `live`, `backtests/output`, `.venv` or `src`. Tests use a junction and an 8.3 alias on Windows and a symlink on macOS.
4. **One backend per lab** keeps one gate log and one sealed-opening pin check. Remote mode keeps it on the PC.
5. **Identity.** The handshake reports ROOT; the shell shows the lab path in the title bar and refuses a backend whose ROOT is not the picked lab. JOBS refuses to run unless `sys.prefix` is `<ROOT>/.venv`, and in desktop mode unless `NQT_FIXTURE_DIR` is unset, so a fixture backend can never start a real backtest.
6. **Sealed data.** The terminal never calls `serve_sealed`. Stage 1 adds the name `serve_sealed` (and `data.serve_sealed`) to the backend AST ban if the existing scan does not already cover it (not checked in this step), and the Rust tree has no Python bridge at all.
7. **Proof on real data.** `scripts/smoke_real.ps1` gains a mode that drives the packaged app (hidden window, section 15). It keeps its two checks: the research files' hashes are unchanged, and only gate lines with `caller="terminal"` were appended.
8. **Release check.** The release workflow fails if the artefact contains any path under `data/`, `results/` or `live/`, any `.parquet` file or any file named like a sealed result (L4, section 9).

## 7. How the app locates the lab and its data

### 7.1 Windows

- **First run:** a native lab picker (a folder dialog in the shell) proposes `%USERPROFILE%\nq-lab` when it exists. A folder is accepted only if it holds `.venv\Scripts\python.exe`, `src\nq_lab\config.py` and `terminal\backend\nq_terminal\__main__.py`.
- **Every run:** the shell spawns `<lab>\.venv\Scripts\python.exe -E -s -X utf8 -X faulthandler -m nq_terminal` with working folder `<lab>\terminal\backend`. `-E` ignores `PYTHON*` variables and `-s` the user site folder (02, C3-5); the editable `nq_lab.pth` in the venv still resolves `src`. The backend still finds ROOT from `nq_lab.config`; the shell adds no root or interpreter input, it only checks the handshake's answer (02, C3-6).
- **The page build:** `web/dist` is git-ignored (`web/.gitignore`), and today `start.ps1` rebuilds it with pnpm when the sources are newer. The app must not serve a stale page after a `git pull`, so the build writes `dist/build-stamp.json` (the newest modification time of the same source list `start.ps1` checks, and the full sha256 of `contract/openapi.json`), and the backend compares it at start-up and reports `dist` as `current`, `stale` or `missing` in the handshake and in `/api/health`. On `stale` or `missing` the shell runs the same two steps as `start.ps1` (`pnpm install --frozen-lockfile`, then `pnpm build`, in `<lab>\terminal\web`, caches on D: per process) behind a "rebuilding the page" splash. The backend serves `dist` from disk and `/api/health` re-reads the stamp, so after the build the shell checks `dist` there and navigates; no restart is needed. **Node 24 or newer and pnpm 11 therefore stay runtime prerequisites on the PC**, as they are for `start.ps1` today; the shell itself stays light, but the lab checkout is not. If Node or pnpm is missing, the shell shows a "rebuild needed" page with the command instead of a stale terminal. In remote mode the Mac shows "rebuild needed on the PC"; the PC app or `start.ps1` does the rebuild.
- **Lab picker checks** (in addition to the three files above): `terminal\web\dist\index.html` exists, or `node` and `pnpm` are on the path so that the first start can build it.
- **WebView2 data folder:** set with `data_directory` (M3) to a folder the owner picks at first run, proposed as `D:\nq-terminal\webview` on this PC because C: is 99% full. Without it Tauri uses the local app data folder on C: (L1, section 5.5).
- **Fixture and demo:** the app can be started against the fixture backend only with a `--fixture` switch compiled into test builds (the `smoke` cargo feature). The same feature adds `--attach-url <loopback URL>`, which loads a page server that is already running (the offline demo server in CI, section 16) with no backend and no handshake, and a `--zoom` value for the 200% check (section 12). Demo mode stays a browser feature (`pnpm demo`).

### 7.2 macOS, remote mode

- **Settings:** an SSH host alias (from the owner's `~/.ssh/config`) and the lab path on the PC.
- **Connect:** the shell runs the system `ssh` client as a child: first `ssh <alias> type <lab>\terminal\state\backend.lock` to read port and token; if there is no live lock it can start the backend over SSH with the same command line as 7.1, holding the SSH session open as the stdin pipe, so the watchdog stops the backend when the Mac app quits. Then `ssh -N -L 127.0.0.1:<L>:127.0.0.1:<P> <alias>` with `ExitOnForwardFailure=yes` and `ServerAliveInterval=15`.
- **Keys:** SSH authentication uses the owner's existing key; the shell stores no password. An OpenSSH server or a private network on the PC is the owner's install (G0, open question 3 of 02).
- **Unreachable PC:** a bundled "PC not reachable" page with the last error and a retry; nothing is cached on the Mac.
- **Latency:** unmeasured; trigger T10 covers it.

### 7.3 macOS, local-lab mode (only after the owner's go)

As 7.1 with `<lab>/.venv/bin/python`, plus an explicit settings file for the IB variables, because an app started from Finder does not inherit the login shell's environment (02, C1-10). It needs Apple Silicon on macOS 26 for the NautilusTrader 1.231.0 wheel (S18) and the gate change named in 02 section 6.1.

## 8. JOBS in the new world

- **Unchanged queue:** one worker thread, at most 10 waiting, history of 200, `terminal/state/jobs.json`, argv list, no shell, exit codes mapped as today.
- **One worker per lab:** the lock file means two terminals can no longer run the same queued job or race on `jobs.json` (02, C1-3). The real runner starts only in a backend that holds the lock of `<ROOT>/terminal/state`; with `NQT_JOBS=off` (the test and smoke backends of section 2.6) the service is the disabled in-memory one that fixture mode already uses (`JobService(enabled=False)`), and `POST` and `DELETE /api/jobs` answer that jobs are off in this backend. The IB snapshot follows the same rule.
- **Environment:** `_child_env` becomes an allow list (`desktop/envlist.py`, shared with the launchers):

| Passed to the backend | Passed on to a backtest child | Never passed |
|---|---|---|
| `SYSTEMROOT`, `WINDIR`, `COMSPEC`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `HOME`, the two Windows variables that name the local and the roaming per-user data folders, `PATH` (venv first), `LANG` on macOS | the same base set | any name ending in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD` |
| `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` | `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` | other `PYTHON*`, `COVERAGE_*`, `WEBVIEW2_*` |
| `NQT_PORT=0`, `NQT_CACHE_BYTES`, `NQT_DESKTOP=1`, `NQT_IB_READONLY` when the owner turns the snapshot on | no `NQT_*` | `NQT_FIXTURE_DIR` in desktop mode |
| `IB_HOST`, `IB_PORT`, `IB_ACCOUNT_ID`, `IB_BASE_USD_RATE` only with the snapshot on | no `IB_*` | `QUANTPAD_API_KEY` and every other API key |
| `NQT_STATE_DIR` and `NQT_JOBS=off` only for the test and smoke backends of section 2.6 | | |

  A test sets canary values in two key variables and checks that neither the backend's view nor a job child sees them (02, C3-3).
- **Closing the app** stops a running job (section 2.3), after the native confirmation. An opt-in resident backend that outlives the window (02, T3 and open question 6) would let jobs finish; it is an owner's choice.
- **Remote mode:** jobs run on the PC; closing the Mac app does not stop them unless the Mac app started that backend.

## 9. The read-only IB snapshot in the new world

- **Unchanged code and guarantees:** `services/ib_readonly_client.py` is still the only file importing `ibapi`; client id 95; paper accounts (`DU...`) only; ports 7496 and 4001 refused; every order-style method overridden to raise; account ids masked; the AST ban unchanged.
- **Opt-in moves to the app's settings:** a checkbox "IB snapshot (read only)" that, when ticked, makes the shell pass `NQT_IB_READONLY=1` and the `IB_*` variables (section 8). Off by default, as today.
- **One client 95:** one backend per lab means one connection; code 326 (client id in use) is already fatal in the snapshot, so a clash with another tool shows as an error, never as a second session (02, C3-10).
- **The shell has no IB code:** the Clippy `TcpStream` ban, cargo-deny, and the existing order-name scan extended to `desktop/src-tauri/src` (02, item 2.4).
- **The paper book** (`live/volmanaged_paper.py`, its runbook and journals) is outside the terminal and untouched. The LIVE and JRNL screens read its files as today.

## 10. Persistence of workspaces, looks and layouts

### 10.1 Why files

The origin changes with the port. The app's backend port is random on purpose (02, C3-4), so the app's origin storage starts empty at every launch; only the browser door keeps one origin, `http://127.0.0.1:8765`, which is where the owner's keys live today (section 2.1). WebKit can also evict script-writable storage under its 7-day rule (L1, section 5.5, unverified for a first-party origin used daily). So the ten `localStorage` keys move to files served by the backend, with `localStorage` kept as a fast cache.

### 10.2 The ten keys and their documents

| `localStorage` key | Written by | Document `terminal/state/workspaces/<doc>.json` | Size cap | Merge rule on a version clash |
|---|---|---|---|---|
| `nqt.workspaces` | `state/workspaces.ts` | `workspaces` | 12 recipes of 20,000 characters (today's cap) | per workspace name, newest wins, loser kept as `<name> (conflict)` |
| `nqt.layouts` | `state/layouts.ts` | `layouts` | 200,000 characters per layout | per mnemonic, newest wins |
| `nqt.linkGroups` | `state/linkGroups.ts` | `linkGroups` | 8 kB | whole document, newest wins |
| `nqt.watch` | `state/recordWatch.store.ts` | `watch` | 200,000 characters | whole document, newest wins |
| `nqt.cmd.history` | `commands/history.ts` | `history` | 100 lines | union by time, last 100 kept |
| `nqt.tape` | `chrome/EventTape.store.ts` | `prefs` (field `tape`) | 4 kB for `prefs` | field by field, newest wins |
| `nqt.cvd` | `chrome/FrameStrip.scheme.ts` | `prefs` (field `cvd`) | | |
| `nqt.theme` | `theme/look.ts` | `prefs` (field `theme`) | | |
| `nqt.orientation` | `screens/home/HomeOrientation.tsx` | `prefs` (field `orientation`) | | |
| `nqt.mon.defaults` | `screens/mon/MonScreen.tsx` | `prefs` (field `mon`) | | |

So seven documents: `workspaces`, `layouts`, `linkGroups`, `watch`, `history`, `prefs`, plus `meta`. The PUT route accepts only these seven names; any other name gets 404. `meta` has its own rules, because the page writes it during the import:

| Document | Fields | Size cap | Merge rule on a version clash | What a PUT may change |
|---|---|---|---|---|
| `meta` | `schema` (whole number), `imports` (a list of `{origin, at}`, at most 16 entries) | 2 kB | union of `imports` by origin, the earliest `at` kept for each origin | only `imports`, and only by adding one entry whose `origin` equals the origin the caller's session is bound to; a PUT that changes `schema`, removes or edits an entry, or adds another origin gets 422 |

`schema` is written by the backend alone (when it creates or upgrades the store), never by the page.

### 10.3 Write rules

- `PUT /api/workspaces/{doc}` with `If-Match: <version>`; the backend writes `<doc>.json.tmp`, flushes and replaces, as `jobs.json` is written today; the answer carries the new version. A stale version gets 412 and the page merges by the rule above and retries once.
- Every document is validated field by field on both sides, as the page already treats stored values as untrusted (inventory 10.3), with the same caps; a document over its cap gets 413.
- The last five versions of each document are kept as `<doc>.json.1` to `.5`, so a bad write can be undone by hand.
- The page debounces writes (500 ms) and writes immediately on `pagehide` and `visibilitychange` to hidden.

### 10.4 Migration

Stage 1.6 ships to the browser first, while the browser door still runs on 8765, and the browser door stays on 8765 afterwards (section 2.1), so the import always runs from the origin that holds the owner's keys.

- **The import is per origin.** On each load the page checks whether its own origin is listed in `meta.imports`. If it is not, and its `localStorage` holds any of the ten keys, it merges each key into its document: what the store lacks is added; where both hold a value, the store's value stays, and for `workspaces` and `layouts` a differing imported entry is kept beside it as `<name> (imported)`, while an entry equal to the stored one is skipped. The merge is therefore safe to repeat: a second tab, or a retry after a failed write, adds nothing new. Only when every document has been written does the page add its origin to `meta.imports` (PUT with `If-Match`; on 412 it re-reads `meta` and stops if the origin is already there). A page whose storage is empty (the app at every launch) adds nothing and does not add its origin, so it can never mark the 8765 keys as imported by mistake.
- **Order:** the owner's first browser load after 1.6 imports the keys from 8765. If the owner opens the app first, the app starts from an empty store, and the 8765 keys are still imported, by the merge rule above, at the next browser door load.
- **Test:** a Playwright test on the fixture backend (a spare fixed port standing in for 8765; the owner's 8765 is never used) seeds the ten keys in that origin, loads the page, and checks that all six documents appear under the fixture's `workspaces` state folder with the seeded values and that `meta.imports` lists that origin; a second load at another port, with empty storage, changes nothing. A launcher test checks that `start.ps1` and the Node launcher start the backend with `NQT_PORT=8765` and never port 0.

The browser keeps working from the same files.

### 10.5 What stays in the shell

Window size, position and monitor (the window-state plugin, M5, shell side only), the lab path, the WebView2 data folder, the remote host, the IB checkbox. Nothing the page can read or write.

## 11. Keyboard and F-key handling per system

The grammar stays in the page (`chrome/CommandLine.keys.ts`); the shell's job is to stop the engine and the system from taking keys first.

### 11.1 Windows (WebView2)

- **Browser accelerators off:** Tauri 2.12.1 exposes no option for `AreBrowserAcceleratorKeysEnabled` (a code search of `tauri-apps/tauri` found none on 2 October 2026), so the shell sets it through `with_webview` on the WebView2 settings interface (M3, M4). With it off, Find (Ctrl+F, F3), Print (Ctrl+P), Reload (Ctrl+R, F5), zoom and DevTools (F12, Ctrl+Shift+C) are disabled; editing and movement keys (Home, End, PgUp, PgDn, Ctrl+C, V, X, A, Z) stay on unless handled (M4). The engine's own zoom keys are also turned off with `zoom_hotkeys_enabled(false)` (M3), and devtools with `devtools(false)` in release builds.
- **App zoom replaces the engine's zoom (WCAG 1.4.4 Resize Text).** In the browser today the owner resizes text with Ctrl+plus and Ctrl+minus; turning the engine's zoom off must not take that away. The shell handles zoom itself, with no page command: it subscribes to the controller's `AcceleratorKeyPressed` event through `with_webview` (Tauri's `PlatformWebview::controller()`, M3), which fires for every accelerator key whether browser accelerators are on or off (M4). Ctrl+plus (and Ctrl+=), Ctrl+minus and Ctrl+0, main row and numeric keypad, are marked handled and change the zoom through Tauri's `set_zoom` (M3), which sets WebView2's `ZoomFactor`; that still works with `IsZoomControlEnabled` off, which only stops the user's own zoom gestures (M9). Steps are 25% from 50% to 300%; the level is kept in the shell's settings and restored at start. The page's own `+`, `=` and `-` keys (chart zoom in `charts/LineStack.controls.ts`) are unaffected, because they ignore any key pressed with Ctrl (checked in the source on 2 October 2026). Ctrl+mouse wheel stays off, as in a terminal.
- **What the owner gains over the browser:** F5 and F7 can no longer reload or toggle caret browsing; F11 no longer goes full screen, so F8 to F11 reach the page as sector keys.
- **F10:** in a Win32 window F10 can activate the system menu (unverified; L1, section 5.6). The window has no native menu bar on Windows, and the stage 2 smoke checks that F10 reaches the page.
- **Alt+1 to Alt+9, Alt+K:** with no menu bar, Alt does not move focus to a menu (unverified, checked in the smoke).
- **Kept by the system:** Alt+F4, Alt+Tab, the Windows key.
- **Ctrl+P and printing:** the dossier still prints through `window.print()`, which WebView2 supports with accelerators off; checked in 2.4.

### 11.2 macOS (WKWebView)

- **No browser accelerators** exist in WKWebView; Cmd shortcuts exist only if the app menu defines them (L1, section 5.6).
- **App menu:** the standard application menu (About, Hide, Quit), an Edit menu with Undo, Cut, Copy, Paste and Select All (needed for Cmd+C, V, X, A in a WKWebView, L1), a View menu with Zoom In (Cmd+plus and Cmd+=), Zoom Out (Cmd+minus) and Actual Size (Cmd+0) that call `set_zoom` from Rust with the same steps and stored level as on Windows (section 11.1; WCAG 1.4.4), a Window menu and a Help menu that runs `HELP`. No menu item takes Cmd+R, Cmd+K or any key the grammar uses. `zoom_hotkeys_enabled` stays off on the Mac too, because there it injects a script that needs a page permission (M3), and the page gets none.
- **F-keys:** the top row sends brightness, Mission Control and media actions unless Fn is held or the owner turns on "Use F1, F2, etc. keys as standard function keys" (S26); Fn+F11 shows the desktop (L1). So every F-key action gets a Mac alternative:

| Action | PC key | Mac key (proposed; final choice in 3.3 after the G1 check) | Always available |
|---|---|---|---|
| HELP | F1 | Fn+F1 or Cmd+/ | type `HELP` |
| Insert Equity | F8 | Ctrl+Option+E | type `EQUITY` |
| Insert Comdty | F9 | Ctrl+Option+C | type `COMDTY` |
| Insert Index | F10 | Ctrl+Option+I | type `INDEX` |
| Insert Curncy | F11 | Ctrl+Option+U | type `CURNCY` |
| Focus command line | Home, Ctrl+K | Cmd+K, Ctrl+K | |
| BACK, FORWARD | End, Shift+End | Fn+Right and Fn+Shift+Right (laptop End), or Cmd+[ and Cmd+] | |
| Page back and forward | PgUp, PgDn | Fn+Up, Fn+Down | |
| Focus panel n | Alt+1 to Alt+9 | Option+1 to Option+9 (the code reads `event.code`, L1) | |

  The page picks the table from the injected `keys` value; HELP and the key toolbar render the same table. Whether `Ctrl+Option+letter` reaches a WKWebView page on macOS 26 is part of G1 item 2 (unverified today).
- **Focus after Cmd+Tab:** the page must get keyboard focus back on activation (L7, section 10.3); a WebDriver smoke step checks it.

### 11.3 Tests for keys

- vitest: the global map for both tables, including `defaultPrevented` handling (unchanged suite plus a `keys: 'mac'` table).
- Windows: hidden-window smoke sends key events over the debugging protocol (proves the page handlers, as the spike did) and a one-off real-keyboard check by the owner on a visible window, because real keys need focus and this PC must not show windows during automated runs. The owner's check includes F10, Alt+1 and the app zoom keys (Ctrl+plus, Ctrl+minus, Ctrl+0); a `cargo test` covers the shell's key-to-zoom mapping without a window.
- macOS: the WebDriver smoke set (3.1) sends real key events through the embedded WebDriver server (D1).

## 12. Accessibility

| Requirement | How the app meets it | Proof |
|---|---|---|
| Screen readers on Windows | framed window, because NVDA is silent in a frameless Tauri window (S34); no `unstable` multi-webview feature (L7) | manual NVDA and Narrator pass per release |
| Screen readers on macOS | WKWebView's tree; no tray icon (a macOS bug breaks `<select>` for VoiceOver with one, L7) | manual VoiceOver pass per release |
| Keyboard only | accelerators off (11.1); focus returns to the page after app switching; every action has a typed command | Windows smoke and Mac WebDriver smoke |
| WCAG 2.2 AA markup and contrast | the same DOM, tokens and contrast tests | axe in the Chromium suite (13 files, unchanged); axe-core injected into the Mac self-test page; contrast re-run on WebKit because thinner strokes lower perceived contrast (L1, section 5.9) |
| 2.4.11 Focus Not Obscured, 2.5.8 Target Size | unchanged geometry (24 px minimum targets) | existing tests |
| 1.4.4 Resize Text | app zoom from 50% to 300% through Ctrl+plus, Ctrl+minus and Ctrl+0 on Windows (shell `AcceleratorKeyPressed` handler) and the View menu with Cmd+plus, Cmd+minus and Cmd+0 on macOS, both through `set_zoom` (sections 11.1, 11.2); the engine's own zoom keys stay off Windows smoke with the zoom set to 200% by a `smoke`-build switch (HOME, the command line, REG grid, a chart with its `ChartA11y` table: every text visible, no control lost, scrolling allowed); key events sent over the debugging protocol go to the page, probably not through the host's accelerator handler (unverified), so the keys themselves are part of the owner's keyboard check on a visible window (section 11.3); Mac WebDriver smoke step at 200% |
| 1.4.10 Reflow | the window can be resized like a browser; the minimum window size is 1,024 by 640 (estimate), the same dense two-dimensional panels as the browser, which already rely on the reflow exception for data tables | owner's decision (section 23) |
| Reduced motion | `prefers-reduced-motion` honoured in both engines (supported in Chromium 74 and Safari 10.1, L7) | existing tests plus the Mac self-test page |
| Windows contrast themes, macOS Increase contrast | **gap today in every option:** no `forced-colors` or `prefers-contrast` rules, and canvas charts do not switch colours | later phase, 2 to 4 weeks (02); the existing `ChartA11y` table view already gives a text alternative for every chart |

The desktop move makes contrast themes more likely to be used, so the later accessibility phase is proposed as the first "later" item (section 21).

## 13. Packaging, signing and notarisation

### 13.1 Windows

- **Installer:** NSIS, per-user, no admin, with a page to choose the install folder (proposed `D:\Apps\nq-lab terminal` on this PC), built by the Tauri bundler (`installMode: currentUser`, S32). The WebView2 runtime is Evergreen and already present (154.0.4258.48 measured); the installer embeds the bootstrapper (about 1.8 MB, S32) so a missing runtime is repaired. No Fixed Version runtime (02, C1-7), except as the short pin of trigger T8.
- **Build:** release builds on the MSVC host in CI (`x86_64-pc-windows-msvc`), `rust-toolchain.toml` pinned, `cargo build --locked`, Tauri 2.12.x with a floor of 2.11.6 for the 2026 IPC fixes (S21). Local spike builds keep using the GNU host under `D:\dev` only (02, C3-13).
- **Size:** under 15 MB installer (ceiling 30 MB), estimate; the spike's bare shell was a 3.2 MB exe and a 1.14 MiB installer (measured).
- **Uninstall:** the NSIS uninstaller removes the shell, its menu entries and, if the owner ticks it, the WebView2 data folder. It never touches the lab or `terminal/state`.
- **Signing:** none at first. A locally built installer carries no Mark of the Web; a CI artefact downloaded through a browser does, and gets one SmartScreen "Run anyway" prompt per new file; Smart App Control is off on this PC (L4, section 4). If anyone else ever installs it: a Certum OV certificate (from €209 a year, L4-S15), Artifact Signing through a UK company (L4-S4, S5), or the Store with MSIX, which Tauri cannot build today (L4-S24). EV gives no SmartScreen advantage any more (L4-S6).

### 13.2 macOS

- **Bundle:** `.app` in a DMG (L4-S29), architecture from G0 (`aarch64-apple-darwin` on Apple Silicon; an Intel Mac is possible in remote mode, because the macOS 26 floor comes from the NautilusTrader wheel and applies only where the lab runs, 02 section 6.1).
- **Info.plist:** `NSAllowsLocalNetworking = YES` so WKWebView may load `http://127.0.0.1` (S25); `LSMinimumSystemVersion` set from G1, not lower than the first macOS whose WebKit has Safari 16.4 features (Tailwind 4 and Vite's build target need Safari 16.4, inventory section 3; the exact macOS version is unverified). `scrollbar-color` needs Safari 26.2; earlier systems fall back to system scrollbar colours (L1, cosmetic).
- **Signing:** an app built on the Mac itself carries no quarantine attribute and needs only the ad hoc signature the Apple Silicon linker adds (L4-S9); stage 0 confirms that Gatekeeper accepts it (D9, unverified). A build downloaded from CI is quarantined and, since macOS Sequoia, needs one approval in System Settings (L4-S8).
- **Notarisation, only if stage 0 shows it is needed:** Apple Developer Program at $99 a year (S24), Developer ID Application certificate, Hardened Runtime, secure timestamp, `notarytool`, stapled DMG (L4-S2, S2b). The shell needs no entitlement beyond the defaults (unverified, L4 section 3.3). No App Sandbox: the app spawns processes and reads the lab (L4 section 3.4).
- **Python is not bundled or signed.** The backend runs from the lab's venv on the PC (remote mode) or on the Mac (local-lab mode); signing covers the shell only (02, section 7.2).

## 14. Updates

- **No automatic updater** in stages 1 to 3 (02, C3-2). A release is a tagged commit `desktop-vX.Y.Z`; the Windows installer is built by the release workflow and installed by hand; the Mac app is built on the Mac from the same tag.
- **What updates what:**

| Part | Comes from | Updated by |
|---|---|---|
| Backend | the lab's `terminal` checkout | `git pull` in the lab, as today; the next app start runs it |
| Page (`web/dist`, git-ignored) | built from the same checkout with Node and pnpm | at the next app start the backend finds `dist` stale against its build stamp, and the shell rebuilds it before showing the page, or shows "rebuild needed" when Node or pnpm is missing (section 7.1) |
| Shell | the installer or the Mac build | a new tag, only when the shell changes or the desktop contract number passes `contract_max` |
| WebView2 | Microsoft, Evergreen | itself; the shell listens for `NewBrowserVersionAvailable` and offers a restart (L7-S25) |
| WKWebView | Apple, with macOS | macOS updates; each macOS release triggers a G1 re-run (upkeep, 02 section 7.2) |
| Lab venv | `uv.lock` in nq-lab | the lab's own tooling; pinned versions are never upgraded without the owner |

- **Out of step:** the shell refuses a backend whose desktop contract number lies outside its `contract_min` to `contract_max` and says which side to update (section 4.4).
- **If an updater is ever added:** an offline signing key with two backups, a protected release environment with the owner as required reviewer, actions pinned to commits, and no secrets for pull-request jobs (02, C3-2; L4-S3, L7 section 6). The updater plugin's minisign signature is mandatory (S23).

## 15. Test strategy

### 15.1 What happens to each suite

| Suite | Today | After the move | Where it runs |
|---|---|---|---|
| Backend pytest | about 2,875 in the brief (2,984 collected in the working tree) | unchanged, plus the seam tests in 15.2 | the PC (needs the lab, which CI cannot reach: section 16) |
| QA crosscheck | about 2,325 checks in the brief (2,455 PASS, 0 FAIL, 104 INFO on 2 October 2026) | unchanged, plus a served-JSON comparison against the app-launched backend (15.3) | the PC |
| Golden files (`qa/golden`, 4) | read by vitest under V8 | also read under JavaScriptCore | CI (macOS runner) and the Mac self-test page |
| vitest | about 6,925 in the brief (6,081 static calls) | unchanged, plus bridge, store and Mac key tests | CI (Windows runner) and the PC |
| Playwright e2e | 383 in the brief (284 static calls), Chromium on Windows | unchanged on Chromium; the offline project also runs in CI; one Playwright run at a time on the PC | the PC; offline project in CI |
| Screenshots | 204 baselines, Windows Chromium | unchanged; a small app set (HOME, GP, REG, LEDG pivot, LIVE) compared with the same Windows baselines in the hidden-window smoke, since WebView2 is the same engine; a new Mac set approved by the owner on first run | the PC; the Mac |
| e2e:perf | HOME 647 ms of 1,500; grid 61 ms of 500; GIP pan and zoom rule | unchanged in the browser; desktop budgets of section 18 measured by `desktop/harness` | the PC (quiet machine), the Mac at G1 |
| Real-data smoke | `smoke_real.ps1`, browser | plus an app mode (hidden window) | the PC |
| AST safety scans | backend | plus the shell source (Clippy bans, order-name scan) | the PC and CI |

### 15.2 New tests, by seam

| Seam | Test |
|---|---|
| Start-up imports (1.1) | a fresh interpreter imports `nq_terminal.__main__` and asserts that `scipy.stats`, `nautilus_trader` and the lazy routers are absent from `sys.modules`; a time budget on a quiet machine |
| Result cache (1.2) | cached and fresh bodies equal byte for byte for every cached route in fixture mode; touching any input file (mtime or size) invalidates; a crosscheck dump taken through the cache |
| Lock and attach (1.3) | a held lock makes a second start print `NQT-ATTACH`; a stale lock is replaced; JOBS never runs twice; JOBS refused with a wrong `sys.prefix` or with `NQT_FIXTURE_DIR` in desktop mode; `uvicorn nq_terminal.app:create_app` without `__main__.py` takes the lock too; a backend with another `NQT_STATE_DIR` and `NQT_JOBS=off` starts beside a held real lock and refuses `POST /api/jobs` and the IB snapshot |
| Second backends (1.4c) | the real-data smoke, the fixture Playwright suite and `start.ps1 -Dev` each load HOME behind the token on their own origin; none touches 8765's lock |
| Page build (1.3, 2.1b) | sources newer than the stamp, or a changed `openapi.json`, give `dist: stale`; the shell rebuilds or shows "rebuild needed" |
| Handshake and proof (1.3) | the HMAC verifies; a wrong nonce or token fails; the line is the first `NQT-` line on stdout |
| Sessions (1.4) | every `/api` path (from the app's route list) refuses no cookie, a wrong cookie and a foreign origin; the stream refuses too; a code works once and expires after 60 s; the token never appears in a URL or a log line |
| Environment (1.5) | canary key values reach neither the backend's environment nor a job child |
| Watchdog (1.5) | closing stdin stops a running fake job and exits within 5 s |
| Workspace store (1.6) | version clash gives 412; caps give 413; names outside the allow list give 404; files appear only under `terminal/state/workspaces`; the GET-only test allows exactly three writes |
| Bridge (1.7) | browser implementation equals today's behaviour; the source scan bans shell IPC in `web/src`; a test pins the wasm32 Perspective server |
| Shell IPC refusal (2.3) | every core and plugin command is invoked from the page and refused |
| Write module (2.3) | deny list holds through a junction, an 8.3 alias and a symlink; writes land only where the dialog said |
| Supervision (2.2) | backend killed: restart with back-off (1, 2, 4 s), then a native dialog; three crashes in 60 s stop retries |
| Release build (2.5) | `cargo tree -e features` shows no `smoke` feature; `devtools` off |

### 15.3 Correctness through the app

The crosscheck itself reads dumps written by in-process backend tests, so it does not see the served JSON. Stage 2.4 adds a check that starts the app (hidden window) against the fixture backend, fetches every route that has a dump through the app's session, and compares each served body with the in-process body byte for byte. Equal bodies plus a green crosscheck mean the numbers on screen are the crosschecked numbers.

### 15.4 Desktop end to end

- **Windows:** WebView2 exposes the Chrome debugging protocol in test builds (the `smoke` feature sets `--remote-debugging-port` through `additional_browser_args`, M3; never in release, 02 C3-8). Playwright attaches with `connectOverCDP`, as Microsoft documents for WebView2 (M6), and runs a desktop project: HOME, the eight-screen walk of the spike, the stream mode assertion, a blob export through the download handler (to a test folder), copy text, F-keys, minimise and restore after 30 to 60 minutes with the stream live. A hidden WebView2 gets no frames and throttled timers (00_spike_webview2), so the method is named here. The window is created hidden (`visible(false)`, `focused(false)`), and in `smoke` builds only the shell then calls `ICoreWebView2Controller::put_IsVisible(TRUE)` through `with_webview` (Tauri's `PlatformWebview::controller()`, M3). That is the Tauri form of what the pywebview spike did by reflection on its WinForms control, and there it gave a `visible` page, about 240 frames a second, normal timers and no window on screen (00_spike_webview2). The Tauri spike did not use this route: it used three Chromium switches (`--disable-features=CalculateNativeWinOcclusion`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`), which Microsoft says production apps must not use (00_spike_rust). **So the controller route is not yet proven in Tauri.** Stage 0 item 0.2 proves it on this PC (page `visibilityState` is `visible`, animation frames at the display rate, timers at normal rate, no window shown) and keeps the three switches, in `smoke` builds only, as the fallback if it fails. Release builds have neither.
- **macOS:** the WebdriverIO Tauri service with its embedded WebDriver server inside a test build (D1, maturity on macOS 26 unverified) drives a smoke set of about 20 steps against the real WKWebView; the in-app self-test page reports maths, features and axe results to the shell log. **Hidden window on the Mac:** the first step of every hidden-window run (G1 item 0.3b first, then the smoke set) is an `about:blank` probe, as on Windows, that counts animation frames and timer ticks over 2.5 s in the hidden window; whether WebKit throttles a hidden or occluded window this way is unverified. If it does and nothing supported lifts it, every number of item 0.3c (shell painted, warm HOME, footprint, grid, pan and zoom), not only pan and zoom, comes from the owner's own run on a visible window, because the HOME probe marks readiness after two animation frames and would never fire in a throttled window.
- **Electron path:** Playwright's Electron class drives the real app (D7).

## 16. CI

Today the repository has no CI workflow (no `.github` folder, checked 2 October 2026). The repository is public, so GitHub-hosted runners are free (L4-S12). A hosted runner cannot reach the private lab, so backend tests, the crosscheck and the real-data smoke stay on the PC, run by the build workflow before a release tag; self-hosted runners are not used on a public repository (L4-S39).

| Workflow | Trigger | Runner | Jobs |
|---|---|---|---|
| `desktop-check.yml` | pull request, push | `windows-2025` | `cargo fmt --check`, Clippy with the bans as errors, `cargo deny check`, `cargo audit`, `cargo test` (write module, link, supervision with a fake backend); `pnpm test` (vitest and the contract hash); offline Playwright project against the Node demo API; scan of `dist` for any signing key or `PRIVATE` string (L7 section 6) |
| `mac-webkit.yml` | pull request touching `web/src/quant` or `qa/golden` | `macos-26` | golden tests of `web/src/quant` under JavaScriptCore (the system `jsc` binary of the runner, path unverified; fallback a WKWebView test harness) |
| `webview2-drift.yml` | weekly schedule, and by hand | `windows-2025` | installs the current Evergreen WebView2 runtime with Microsoft's installer (M10; the runner image of 22 September 2026 lists Microsoft Edge 153 but no WebView2 runtime line, M11, so the job does not rely on one being there); records the runtime version; builds the `smoke` build of the shell; starts the offline demo server of the offline Playwright project (page and `/api` over HTTP, no Python); starts the shell hidden with its `smoke`-only `--attach-url` switch pointed at that server (no backend, no handshake, no token, so this run tests the engine and the page, not the auth); attaches Playwright with `connectOverCDP` and runs the desktop smoke project; closes the shell. vitest and the plain offline project are not part of it, because they run in Node and in Playwright's own Chromium, not in WebView2. The run stores the runtime version and the result per test; a failure, or a test whose result changed since the last run with a different runtime version, opens an issue (T8) |
| `desktop-release.yml` | tag `desktop-v*` | `windows-2025` | MSVC release build with `--locked`, no `smoke` feature, NSIS bundle, SHA-256 checksums, the "no lab data in the artefact" check; artefact attached to a draft release |

Every action is pinned to a commit SHA; no workflow has secrets, because nothing is signed. The CI cache holds the Cargo registry and the pnpm store, not `target` folders (10 GB per repository, L4-S36).

## 17. Crash handling

- **Shell panics:** a panic hook writes a text report to `<config>/logs/shell-panic-<time>.txt`; release builds use `panic = "abort"` after the hook. Minidumps (crash-handler and minidumper crates, L4-S33) are a later option, not stage 2.
- **Backend output:** stdout after the handshake and all of stderr go to `terminal/state/logs/backend.log`, rotated at 5 MB with 5 files kept. `-X faulthandler` writes a Python stack on a native crash into the same log.
- **Backend exit:** the shell shows the bundled "backend stopped" page in the look, restarts with back-off (1, 2, 4 s), and after three failures within 60 s stops and shows a native dialog with the log path and "Restart" or "Quit". The page's state survives because workspaces live in files.
- **Page or engine crash:** on Windows the WebView2 `ProcessFailed` event, on macOS the web content process termination callback, both reached through `with_webview` (M3); the shell reloads the page once and then shows the stopped page. (Wiring through `with_webview` is unverified until stage 2.)
- **Hung page:** if `/api/health` answers but the page has not painted HOME within 15 s, the shell offers a reload.
- **Diagnostics:** a Help menu item zips the shell logs, `backend.log` and the WebView2 version into a folder the owner picks, through `writes.rs`. Nothing is uploaded; there is no telemetry (L4 section 7). WER LocalDumps stays off (it needs admin, L4-S38).

## 18. Budgets

Targets are estimates, recalibrated from a quiet-machine run at the start of stage 2; ceilings fail the build (02, section 4). Every figure is the median of 3 runs, hidden window, whole process tree private memory.

| Budget | Target | Ceiling | Measured by | Stage |
|---|---:|---:|---|---|
| Backend ready, quiet machine | 1.5 s | 2.5 s | startup import test and harness | 1 |
| Real-data `EQ` and `REG`, warm | 1,000 ms | 1,500 ms | harness on real data | 1 |
| Slow routes, repeat call | 100 ms | 300 ms | result cache test | 1 |
| Shell painted (splash) | 500 ms | 1,000 ms | harness | 2 |
| Cold double-click to HOME with data | 3.5 s | 5 s | harness, first launch after a reboot included | 2 |
| Warm HOME with data | 1,000 ms | 1,500 ms | harness | 2 |
| Grid open, 8,411 fills | 100 ms | 500 ms | harness and e2e:perf | 2 |
| GIP pan and zoom p95, 20,000 bars | 16.7 ms | 25 ms | trace in the app smoke | 2 |
| Keystroke to paint, command line, p95 | 50 ms | 100 ms | trace in the app smoke | 2 |
| Whole app idle at HOME | 400 MB | 500 MB | harness | 2 |
| Whole app, heavy session (all-day soak at shipped caps) | 1.0 GB | 1.5 GB | soak run | 2 |
| Installer | 15 MB | 30 MB | release workflow | 2 |
| Browser budgets (HOME 1,500 ms, grid 500 ms, shell 114.9 kB gzip, library chunks) | unchanged | unchanged | e2e:perf, bundleCheck | all |
| Mac: shell painted, warm HOME, UI footprint at HOME, grid, pan and zoom p95 | G1 limits | 1,000 ms, 1,500 ms, 350 MB, 500 ms, 25 ms | Mac harness | 0 and 3 |

Breaching a ceiling after release triggers T3, T4 or T5 as listed in 02, section 6.5.

## 19. The dual-run period

- **Start:** the first app build that passes G2 on Windows. **End:** four weeks of daily use with no blocking defect and every row of the parity list below green, then the owner decides (section 23) whether the browser door stays as a fallback for good. The recommendation is to keep it: it costs nothing once stage 1 has put it behind the same token.
- **How both run:** whichever starts first owns the backend; the other attaches through the lock file. Workspaces live in files, so both see the same state.
- **Parity list, checked weekly by the owner (about 15 minutes):** HOME with data; GP and GIP pan and zoom; REG and MT; RUN with the fills pivot; EQ to MRET tabs; MON and CORR; LEDG and OOS; LIVE and JRNL with the stream in stream mode; HELP; DES save; GRAB copy and save; print dossier; JOBS queue and cancel; F1 and F8 to F11; SAVE and LOAD of a workspace; the amber-classic look.
- **Defect rule:** a defect that exists in the app and not in the browser is fixed before any new app feature. A defect in both is a normal terminal bug.
- **Fallback at any moment:** `start.ps1` opens the browser on the running backend, so the owner never loses the terminal.

## 20. Rollback

| What is rolled back | How | What is lost |
|---|---|---|
| A stage 1 seam | `git revert` of its commit; each seam is one commit with its tests | nothing: workspace files stay, and `localStorage` is still written as a cache on the browser door's fixed origin (8765), so a reverted page there reads its old keys |
| The token on the browser door | revert 1.4 (and 1.4c); the launchers open `http://127.0.0.1:8765/` without a code, as today, because a backend they start always binds 8765 (section 2.1); when the app's backend holds the lock they open its port from the lock instead. The app needs sessions, so it is not used while 1.4 is reverted | the protection, knowingly |
| The workspace store | revert 1.6; the browser door on 8765 reads its own `localStorage` again (kept as a cache there throughout) | changes made only in the app since the revert point, and the app's saved state while 1.6 is reverted: the app's origin changes with its random port, so it starts empty at every launch until 1.6 returns; a one-off export of the seven documents is kept in `terminal/state/workspaces` |
| The app on Windows | uninstall with the NSIS uninstaller; use `start.ps1` | nothing; the lab and `terminal/state` are untouched |
| Tauri for Electron (T1, T2) | replace `desktop/`; the bridge, sessions, store and handshake are shell-neutral | 3 to 5 weeks of shell work (02) |
| The Mac app | delete the app; the PC is unaffected in remote mode | the Mac's window state only |
| A WebView2 update that breaks the page | pin the Fixed Version runtime for the shell while the fix is made (T8, D6) | about 180 to 250 MB of disk on D: while pinned (L4 section 4.4) |

## 21. Stages and work breakdown

Weeks are focused build weeks for one developer working with automated build runs, estimates from 02 section 5, split here into items. Each item ends with its tests green; each stage ends with its exit check.

### Stage 0: decide and measure (about 1.3 to 2.7 weeks)

| Item | Work | Weeks | Depends on |
|---|---|---:|---|
| 0.1 | Owner answers G0 (which Mac; remote or local lab; SSH or private network on the PC) | owner | |
| 0.2 | Electron 44 hidden-window measurement on this PC under `D:\dev`, medians of 5, beside the Tauri spike; feeds T2. Also proves the Tauri `smoke` build's hidden-window method (controller `put_IsVisible(TRUE)` through `with_webview`, section 15.4): page `visible`, frames at the display rate, normal timers, no window shown; if it fails, the three spike switches stay as the `smoke`-only fallback | 0.3 to 0.7 | |
| 0.3a | G1 maths: golden tests under JavaScriptCore on the Mac | 0.2 to 0.4 | 0.1 |
| 0.3b | G1 features: first the hidden-window probe (frames and timers in a hidden WKWebView, section 15.4; if throttled, items 0.3b and 0.3c move to the owner's visible run); then the self-test page in a hidden WKWebView (Perspective wasm32, dockview, stream mode, ATS on 127.0.0.1, clipboard, blob export through `on_download`, Mac key alternatives) | 0.4 to 0.8 | 0.1 |
| 0.3c | G1 numbers: shell painted, warm HOME, footprint, grid, pan and zoom | 0.2 to 0.4 | 0.3b |
| 0.3d | Gatekeeper on a locally built app; WebKit fix estimate | 0.2 to 0.4 | 0.3b |

Exit: G1 and T2 decided and recorded.

### Stage 1: shell-neutral foundation (about 5.25 to 9.15 weeks, starts now, ships to the browser)

| Item | Work | Weeks | Depends on |
|---|---|---:|---|
| 1.1a | Profile imports again on a quiet machine; list the lazy candidates | 0.1 | |
| 1.1b | Lazy `scipy.stats` in `analytics.perf` and the other nine modules; lazy routers; startup import test | 0.4 to 0.9 | 1.1a |
| 1.2a | `services/result_cache.py` with the read hook in `FileCache` and the bar service | 0.4 to 0.8 | |
| 1.2b | Wire the eight slow routes; cached against fresh body tests; crosscheck through the cache | 0.6 to 1.2 | 1.2a |
| 1.3a | `desktop/lock.py` taken in `create_app`'s start-up and keyed on `NQT_STATE_DIR`; `NQT_JOBS=off`; port 0 for a backend the app starts (the launchers keep 8765); `NQT-READY` and `NQT-ATTACH`, stdin channel | 0.4 to 0.6 | |
| 1.3b | `/api/desktop/proof`; JOBS identity assertions; `contract/desktop_version.json` and its drift test; contract number, full `openapi.json` sha256, `dist` state and `port_fixed` in the handshake and health; `dist/build-stamp.json` written by the build | 0.45 to 0.85 | 1.3a |
| 1.4a | `desktop/sessions.py` and the token middleware on every `/api` path, stream included | 0.3 to 0.6 | 1.3a |
| 1.4b | `/api/session`, `/code`, `/redeem`; `web/session.html`; `start.ps1` and the Node launcher changed (still `NQT_PORT=8765` for a backend they start) | 0.2 to 0.4 | 1.4a |
| 1.4c | The second-backend paths of section 2.6 behind the token: `scripts/smoke_real.ps1`, `web/e2e/perf/real.config.ts`, `web/vite.config.ts` (session page input, dev proxy), `start.ps1 -Dev`, `backend/tests/fixture_app.py` and `web/playwright.config.ts`; each with its acceptance check, the real-data smoke included | 0.3 to 0.5 | 1.4b |
| 1.5a | `desktop/envlist.py` in `_child_env` and the launchers; canary test | 0.2 to 0.3 | |
| 1.5b | Watchdog; desktop cache defaults; route times re-checked at the new caps | 0.3 to 0.45 | 1.3a |
| 1.6a | Workspace models, service and routes; GET-only test at three writes | 0.4 to 0.6 | 1.4a |
| 1.6b | `state/remoteStore.ts`; the ten keys moved; the per-origin import with its 8765 test (section 10.4) | 0.6 to 0.9 | 1.6a |
| 1.7 | `web/src/bridge`; `download.ts`, `panelExport.ts` and GRAB through it; IPC source scan; wasm32 pin test; portable `#go=` links and the command line reading a pasted one (section 4.6) | 0.6 to 0.95 | |

Exit: backend tests and crosscheck green; browser budgets unchanged; backend ready and the real-data screen targets met on this PC.

### Stage 2: the Windows app on Tauri (about 6.7 to 10.5 weeks)

| Item | Work | Weeks | Depends on |
|---|---|---:|---|
| 2.1a | `desktop/` skeleton on the MSVC host in CI; framed window; splash in the look; single instance; window state | 0.6 to 0.9 | stage 1 |
| 2.1b | Lab picker with the `dist` and Node checks; WebView2 data folder; settings; page rebuild on a stale `dist` or the "rebuild needed" page (section 7.1) | 0.5 to 0.8 | 2.1a |
| 2.1c | Accelerators off through `with_webview`; the engine's zoom keys off and app zoom on Ctrl+plus, Ctrl+minus and Ctrl+0 through `AcceleratorKeyPressed` and `set_zoom`, level kept in settings (section 11.1); devtools off; new windows denied except the attribution link (system browser); `WEBVIEW2_*` removed; HKCU policy check | 0.75 to 1.15 | 2.1a |
| 2.1d | `smoke` cargo feature with the test hooks; release CI refuses it | 0.4 to 0.6 | 2.1a |
| 2.2a | `supervise.rs`: spawn, attach, handshake checks, cookie, navigate | 0.5 to 0.7 | 2.1a |
| 2.2b | Job Object; restart policy; stopped page; proof on every navigation | 0.5 to 0.8 | 2.2a |
| 2.3a | `writes.rs` with the deny list and its junction, 8.3 and symlink tests | 0.4 to 0.6 | 2.1a |
| 2.3b | `on_download` with the native save dialog; IPC refusal test; clipboard fallback only if needed | 0.35 to 0.65 | 2.3a |
| 2.4a | Harness from the spike; budgets of section 18; first launch after reboot | 0.6 to 0.9 | 2.2b |
| 2.4b | CDP smoke project, the 200% zoom step included; served-JSON comparison; real-data smoke app mode | 0.6 to 0.9 | 2.2b |
| 2.4c | All-day soak at shipped caps; minimise and restore with the stream live | 0.3 to 0.5 | 2.4a |
| 2.4d | cargo-deny, cargo-audit, Clippy bans, order-name scan on the shell; the drift workflow that runs the hidden `smoke` build in WebView2 on CI (section 16) | 0.7 to 1.0 | 2.4b |
| 2.5 | NSIS per-user with folder choice; embedded bootstrapper; release workflow; checksums; artefact check | 0.5 to 1 | 2.4 |

Exit: G2 (02, section 6.3).

### Stage 3: the Mac app on Tauri after a G1 pass (about 5.85 to 12.1 weeks)

| Item | Work | Weeks | Depends on |
|---|---|---:|---|
| 3.1a | JavaScriptCore golden run in CI | 0.5 to 0.75 | G1 |
| 3.1b | In-app self-test page with axe-core; Mac visual baselines; contrast on WebKit | 1.25 to 1.75 | G1 |
| 3.1c | WebDriver smoke set through the embedded server | 1.25 to 2 | G1 |
| 3.2 | WebKit fixes from G1 and 3.1 | 1 to 4 | 3.1 |
| 3.3 | Mac key alternatives, app menu with the View menu zoom, HELP with Mac bindings | 1.1 | G1 |
| 3.4 | `tunnel.rs`: SSH lock read, tunnel, remote start, unreachable page | 0.5 to 1 | 0.1 |
| 3.5 | Local build from a tag; DMG; notarisation only if 0.3d says so | 0.25 to 1.5 | 3.2 |

Exit: G2 repeated on the Mac with the in-page harness.

### Totals and later phases

About 19 to 34.5 focused weeks on the Tauri path: 02's 18 to 32.5 plus 1.15 to 1.95 for items 0.2, 1.3b, 1.4c, 1.7, 2.1b, 2.1c, 2.4d and 3.3 as widened by this plan's review (stage sums 1.3 + 5.25 + 6.7 + 5.85 and 2.7 + 9.15 + 10.5 + 12.1). 02's other figures stand: about 14 to 25 for Electron on both after a G1 failure. Later, each only on evidence: the accessibility gaps (2 to 4 weeks, proposed first), one PyO3 kernel at a time under G3 (2 to 4 each), binary columns under T5 (2 to 3), a bundled demo engine (3 to 5), one natively drawn view (4 to 8), local-lab mode on the Mac (1 to 2 plus the gate change).

## 22. Risks specific to this plan

| Risk | Likelihood (estimate) | Effect | Mitigation |
|---|---|---|---|
| The session middleware breaks a route the tests do not call with a cookie | medium | a screen shows an error | the session test walks the app's full route list, not a hand list |
| The result cache returns a stale body after an input changes in place without an mtime change | low | wrong numbers on screen | the key includes size as well as mtime; the crosscheck runs through the cache; a "clear caches" menu item |
| WebView2 accelerator settings cannot be reached through `with_webview` | low | F5 and F12 stay live | page `preventDefault` already blocks them in the browser; a raw `webview2-com` call from the shell as a second route |
| The SSH tunnel drops the stream often | unknown | LIVE falls back to polling | T10; `ServerAliveInterval`; local-lab mode |
| The lock file left by a crash blocks start | medium | the app attaches to nothing | stale detection by pid and proof, then takeover |
| Two machines edit the same workspace in remote mode | low | a lost edit | version check, merge rules, `.1` to `.5` backups |
| C: fills during the build | medium | failed builds, a sluggish PC | every toolchain, cache and profile on D:; the release check measures artefact size |
| The other build workflow changes a seam file while stage 1 is in flight | high now | merge conflicts | stage 1 starts after that work lands; Appendix A is regenerated first |

## 23. Owner decisions

Carried from 02 (section 10), with defaults:

1. **G0:** which Mac (chip, macOS version, display), and remote mode (default) or a second lab on it.
2. **Order:** may stage 2 start before G1 if no Mac is ready when stage 1 ends? Default yes.
3. **Remote mode install:** an OpenSSH server or a private network on the PC. Default: the built-in Windows OpenSSH server, on the owner's go.
4. **The section 3.3 judgement of 02:** Tauri on "light" and Rust at an equal score, or Electron's single engine.
5. **Desktop caps:** 512 MiB bars and 128 MiB files, or today's 2 GiB.
6. **Resident backend:** opt-in, kept after the window closes so launches are warm and jobs finish.

New in this plan:

7. **Data folder drive** for the WebView2 profile and the install folder. Default D:.
8. **Browser door after the dual run:** keep (default) or retire.
9. **Mac key alternatives:** the Ctrl+Option set in section 11.2, or another set.
10. **IB snapshot in the app:** off by default (as today), turned on in settings.
11. **Closing with a running backtest:** confirm and stop (default), or always keep the backend running (needs decision 6).
12. **Minimum window size:** 1,024 by 640 (default), or none.
13. **Apple Developer Program ($99 a year):** only if stage 0 shows Gatekeeper blocks a local build.
14. **A licence for the public repository:** none today; it matters only for free open source signing (L4 section 4.1).

## 24. Unverified items and open questions

- The WebdriverIO Tauri service's embedded WebDriver on macOS 26 (D1).
- Whether WKWebView hands blob downloads to `on_download` (D2), and whether `Ctrl+Option+letter` reaches the page.
- Whether F10 or Alt in a framed Tauri window on Windows moves focus to a system menu.
- The JavaScriptCore binary path on GitHub's `macos-26` runner.
- Whether Gatekeeper lets a locally built, ad hoc signed app open without prompts on the owner's macOS (D9).
- The first macOS version whose WebKit meets Tailwind 4's Safari 16.4 floor.
- Whether `with_webview` reaches WebView2's `ProcessFailed` and WKWebView's termination callback cleanly from Tauri 2.12.
- Whether the backend AST scan already bans `serve_sealed` by name.
- Stream latency and reconnects over an SSH tunnel (T10).
- The macOS firewall prompt for a loopback-only listener (L1, section 5.11), relevant to local-lab mode only.
- Whether `put_IsVisible(TRUE)` on the controller of a hidden Tauri window gives normal frames and timers without showing the window (proved or refuted in item 0.2).
- Whether a hidden WKWebView window gets animation frames and normal timers (the first probe of item 0.3b).
- Whether key events sent over the debugging protocol reach WebView2's `AcceleratorKeyPressed` (assumed not; the zoom keys are in the owner's keyboard check).
- Whether GitHub's `windows-2025` image already carries a WebView2 runtime (its readme lists none, M11; the drift job installs one either way).

## Appendix A. Module map

Columns: path, size, fate (keep, wrap, port, rewrite, drop), target, stage, and the test that proves parity. "Today" is the role in `00_inventory_backend.md` section 3 or `00_inventory_frontend.md` section 8; it is not repeated per row to keep the tables readable, and the line counts and file counts are today's working tree. Generated by `tools/plan/gen_03_tables.py`.

Counts: 110 backend modules (keep 95, wrap 14, rewrite 1), 25 screen folders (keep 15, wrap 10), 24 support folders (keep 14, wrap 10), 37 QA, launcher, contract and test-harness rows (keep 31, wrap 6), so 196 rows: keep 155, wrap 40, rewrite 1. Nothing is ported or dropped. "Keep" means the file's code does not change; a row whose code changes at any stage is "wrap", with its stage and a seam test. The "keep" rows whose scipy import may become lazy ("if 1.1 profiling names it") become "wrap" if item 1.1a names them. The new modules are listed after the generated tables.

### A.1 Backend modules (`backend/nq_terminal`, every `.py` file)

| # | Path (`backend/nq_terminal/`) | Lines | Fate | Target | Stage | Test that proves parity |
|---:|---|---:|---|---|---|---|
| 1 | `__init__.py` | 3 | keep | unchanged | none | full backend suite and the contract drift test (no test imports it by name) |
| 2 | `__main__.py` | 34 | rewrite | binds port 0 itself (a backend the app starts; the launchers pass 8765) and hands the socket to uvicorn so the port is known before start-up; exits with `NQT-ATTACH` when a live lock exists; prints the handshake line once start-up has taken the lock; starts the stdin watchdog (the lock itself is taken in `app.py`'s start-up, section 2.1) | 1.3, 1.5 | `test_app.py`, `test_live_stream_server.py`; plus a new seam test (section 15) |
| 3 | `analytics/__init__.py` | 9 | keep | unchanged | none | `test_analytics_api.py`, `test_analytics_distribution.py` (+45) |
| 4 | `analytics/_inputs.py` | 56 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series` |
| 5 | `analytics/bootstrap.py` | 272 | keep | unchanged; never ported (reproduces NumPy's PCG64 draws; out of G3) | none | crosscheck `bootstrap`; `test_dump_for_qa_lv6.py`, `test_lv6_expectation.py` (+4) |
| 6 | `analytics/capacity.py` | 172 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `p2capacity`; `test_p2_capacity.py`, `test_p2_rct_api.py` |
| 7 | `analytics/deflated.py` | 134 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `deflated`; `test_p1_deflated.py`, `test_p2_neff.py` (+1) |
| 8 | `analytics/distribution.py` | 96 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_distribution.py` (+3) |
| 9 | `analytics/drawdown.py` | 79 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`; `test_analytics_api.py`, `test_analytics_drawdown.py` (+4) |
| 10 | `analytics/excursions.py` | 157 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `paths`; `test_p1_trade_paths.py` |
| 11 | `analytics/expectation.py` | 273 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `lv6`; `test_lv6_expectation.py`, `test_lv6_expectation_api.py` |
| 12 | `analytics/exposure.py` | 482 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `costs`; `test_exposure.py`, `test_run_views_api.py` |
| 13 | `analytics/neff.py` | 242 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | golden `p2_neff_served.json`; `test_p2_neff.py`, `test_p2_neff_api.py` (+1) |
| 14 | `analytics/perf.py` | 229 | wrap | scipy.stats imported inside the functions that need it | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_parity.py` (+11); plus a new seam test (section 15) |
| 15 | `analytics/regimes.py` | 79 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `regimes`; `test_p1_regimes_stress.py` |
| 16 | `analytics/relative.py` | 137 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`; `test_analytics_api.py`, `test_p1_metrics.py` (+4) |
| 17 | `analytics/risk.py` | 167 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`; `test_analytics_api.py`, `test_analytics_distribution.py` (+3) |
| 18 | `analytics/risk_extras.py` | 176 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `p2risk`; `test_dump_for_qa_p2_risk_extras.py`, `test_p2_risk_extras.py` (+1) |
| 19 | `analytics/rolling.py` | 145 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`, `p1series`; `test_analytics_api.py`, `test_analytics_rolling.py` (+3) |
| 20 | `analytics/seasonality.py` | 201 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `seasonality`; `test_dump_for_qa_p11_seas.py`, `test_seasonality.py` |
| 21 | `analytics/series.py` | 455 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `series`, `p1series`; `test_analytics_api.py`, `test_dump_for_qa.py` (+16) |
| 22 | `analytics/spa.py` | 208 | keep | unchanged; never ported (reproduces NumPy's PCG64 draws; out of G3) | none | crosscheck `spa`; `test_dump_for_qa_p2_spa.py`, `test_p2_neff.py` (+2) |
| 23 | `analytics/stress.py` | 76 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `stress`; `test_p1_regimes_stress.py` |
| 24 | `analytics/term_structure.py` | 146 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `p2term`; `test_dump_for_qa_p2_rct.py`, `test_p2_term_structure.py` |
| 25 | `analytics/tracking.py` | 124 | keep | unchanged maths; G3 candidate only by profile | none | crosscheck `tracking`; `test_p1_tracking.py` |
| 26 | `analytics/trades.py` | 301 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `trades`; `test_p1_trade_paths.py`, `test_run_views_api.py` (+1) |
| 27 | `analytics/trend_regime.py` | 84 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `p2trend`; `test_dump_for_qa_p2_rct.py`, `test_p2_rct_api.py` (+2) |
| 28 | `analytics/validity.py` | 279 | keep | unchanged maths; scipy import made lazy if 1.1 profiling names it; G3 candidate only by profile | 1.1 | crosscheck `series`, `registry`; `test_analytics_api.py`, `test_p1_deflated.py` (+2) |
| 29 | `api/__init__.py` | 1 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_app.py`, `test_bars_api.py` (+14) |
| 30 | `api/analytics.py` | 360 | wrap | result cache on both bootstrap routes and /api/analytics/deflated; lazy import of analytics.perf | 1.1, 1.2 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 31 | `api/audit.py` | 153 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 32 | `api/commands.py` | 92 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 33 | `api/data.py` | 473 | wrap | result cache on /api/market/two-day | 1.2 | `test_bars_api.py`; plus a new seam test (section 15) |
| 34 | `api/dq.py` | 45 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_dq_api.py` |
| 35 | `api/events.py` | 195 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_events_api.py` |
| 36 | `api/ib.py` | 41 | keep | unchanged | none | `test_ib_api.py` |
| 37 | `api/instruments.py` | 50 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 38 | `api/jobs.py` | 163 | wrap | the write allow list (`ALLOWED_WRITE_ROUTES`) gains the workspace PUT; `POST` and `DELETE` answer "jobs off" under `NQT_JOBS=off` | 1.3, 1.6 | `test_app.py`, `test_dq_api.py` (+8); plus a new seam test (section 15) |
| 39 | `api/live.py` | 238 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_live_stream.py` |
| 40 | `api/live_stream.py` | 309 | keep | unchanged; cookie checked by middleware | 1.4 | `test_app.py`, `test_live_stream.py` (+1) |
| 41 | `api/paper_expectation.py` | 51 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_lv6_expectation_api.py` |
| 42 | `api/regimes_capacity_term.py` | 105 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_p2_rct_api.py` |
| 43 | `api/research.py` | 114 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 44 | `api/risk_extras.py` | 48 | keep | unchanged handler; token cookie checked by middleware | 1.4 | `test_p2_risk_extras_api.py` |
| 45 | `api/roll.py` | 95 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 46 | `api/runs.py` | 156 | wrap | result cache on /api/ledger and /api/runs/compare | 1.2 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 47 | `api/seasonality.py` | 157 | wrap | result cache on /api/seasonality/instrument/{root} | 1.2 | `test_seasonality_api.py`; plus a new seam test (section 15) |
| 48 | `api/spa.py` | 35 | wrap | result cache on /api/analytics/spa | 1.2 | `test_p2_spa_api.py`; plus a new seam test (section 15) |
| 49 | `api/system.py` | 90 | wrap | health also reports the contract version | 1.3 | full backend suite and the contract drift test (no test imports it by name); plus a new seam test (section 15) |
| 50 | `api/vcone.py` | 88 | keep | unchanged handler; token cookie checked by middleware | 1.4 | full backend suite and the contract drift test (no test imports it by name) |
| 51 | `app.py` | 155 | wrap | takes the state folder's lock in start-up (lifespan), so every way of starting a backend takes it; registers the token middleware, the proof, session and workspace routers; assert_get_only allows exactly three writes | 1.3, 1.4, 1.6 | `test_analytics_api.py`, `test_analytics_errors.py` (+39); plus a new seam test (section 15) |
| 52 | `constants.py` | 286 | keep | mnemonic table unchanged; Mac key alternatives live in the page | none | `test_dump_for_qa_p1.py`, `test_mnemonics.py` (+9) |
| 53 | `des_shapes.py` | 204 | keep | unchanged | none | `test_research_des.py`, `test_screen_api_gaps.py` |
| 54 | `models/__init__.py` | 1 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_dump_for_qa_lv6.py` (+12) |
| 55 | `models/analytics.py` | 411 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_p2_risk_extras_api.py`, `test_p2_trend_entry_lag.py` |
| 56 | `models/analytics_p1.py` | 353 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_lv6_expectation_api.py` |
| 57 | `models/audit.py` | 124 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 58 | `models/common.py` | 100 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_models_common.py`, `test_runs_api.py` |
| 59 | `models/data.py` | 202 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py` |
| 60 | `models/dq.py` | 86 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 61 | `models/events.py` | 96 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 62 | `models/expectation.py` | 81 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_dump_for_qa_lv6.py` |
| 63 | `models/ib.py` | 104 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_ib_api.py`, `test_ib_snapshot.py` |
| 64 | `models/instruments.py` | 87 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 65 | `models/jobs.py` | 244 | keep | lazy registry import kept; nautilus_trader stays out of start-up | 1.1 | `test_p2_jobs_models.py`, `test_p2_jobs_service.py` |
| 66 | `models/live.py` | 318 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_live_stream.py` |
| 67 | `models/neff.py` | 99 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 68 | `models/regimes_capacity_term.py` | 176 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_p2_rct_types_sync.py` |
| 69 | `models/research.py` | 247 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 70 | `models/risk_extras.py` | 72 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 71 | `models/roll.py` | 78 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 72 | `models/run_views.py` | 267 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 73 | `models/runs.py` | 240 | keep | unchanged response models; contract regenerated only for the new routes | none | `test_contract_cleanups.py`, `test_screen_api_gaps.py` |
| 74 | `models/seasonality.py` | 66 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 75 | `models/spa.py` | 91 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 76 | `models/vcone.py` | 68 | keep | unchanged response models; contract regenerated only for the new routes | none | full backend suite and the contract drift test (no test imports it by name) |
| 77 | `security.py` | 128 | wrap | adds the token cookie check on every /api call (hmac.compare_digest); origin bound per session (section 4.2) | 1.4 | `test_csp_wasm.py`; plus a new seam test (section 15) |
| 78 | `services/amendments.py` | 76 | keep | unchanged service; reads only through FileCache and the gate | none | `test_registry_drift.py` |
| 79 | `services/audit.py` | 331 | keep | unchanged service; reads only through FileCache and the gate | none | `test_audit.py`, `test_contract_cleanups.py` (+2) |
| 80 | `services/bars.py` | 389 | wrap | same gate injection; the result cache's read hook records every bar file a computation reads; desktop default cap 512 MiB | 1.2, 1.5 | `test_bars.py`, `test_bars_fixes.py` (+14); plus a new seam test (section 15) |
| 81 | `services/catalog.py` | 249 | keep | unchanged service; reads only through FileCache and the gate | none | `test_catalog.py`, `test_catalog_drift.py` (+1) |
| 82 | `services/dq.py` | 233 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `dq_nq`, `dq_sidecar`; `test_dq.py`, `test_dump_for_qa_p11_dq.py` (+1) |
| 83 | `services/dq_guards.py` | 96 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `guards`; `test_dq_guards.py`, `test_dump_for_qa_p11_dq.py` |
| 84 | `services/events.py` | 424 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `evt`; `test_events_api.py`, `test_events_dump_for_qa.py` (+2) |
| 85 | `services/fence.py` | 93 | keep | unchanged service; reads only through FileCache and the gate | none | `test_qa_fence.py` |
| 86 | `services/files.py` | 400 | wrap | FileCache gains the result cache's read hook and is reused as its key scheme; desktop default cap 128 MiB | 1.2, 1.5 | `test_dq.py`, `test_dq_guards.py` (+8); plus a new seam test (section 15) |
| 87 | `services/ib_readonly_client.py` | 392 | keep | unchanged; AST ban unchanged | none | `test_fixture_mode.py`, `test_ib_api.py` (+3) |
| 88 | `services/ib_snapshot.py` | 219 | keep | unchanged; code 326 already fatal | none | `test_ib_api.py`, `test_ib_snapshot.py` |
| 89 | `services/instruments.py` | 171 | keep | unchanged service; reads only through FileCache and the gate | none | full backend suite and the contract drift test (no test imports it by name) |
| 90 | `services/jobs.py` | 346 | wrap | allow-listed _child_env; refuses unless sys.prefix is ROOT/.venv; close() called by the watchdog | 1.3, 1.5 | `test_p2_jobs_api.py`, `test_p2_jobs_service.py`; plus a new seam test (section 15) |
| 91 | `services/journals.py` | 519 | keep | unchanged service; reads only through FileCache and the gate | none | `test_contract_cleanups.py`, `test_dump_for_qa_p1.py` (+7) |
| 92 | `services/live_routes.py` | 132 | keep | unchanged service; reads only through FileCache and the gate | none | full backend suite and the contract drift test (no test imports it by name) |
| 93 | `services/market.py` | 229 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `market`; `test_bars_api.py`, `test_contract_cleanups.py` (+6) |
| 94 | `services/neff_view.py` | 57 | keep | unchanged service; reads only through FileCache and the gate | none | `test_dump_for_qa_p2_spa.py`, `test_p2_neff_bridge.py` |
| 95 | `services/paper_expectation.py` | 194 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `lv6`; `test_dump_for_qa_lv6.py`, `test_lv6_expectation_api.py` |
| 96 | `services/regimes_capacity_term.py` | 285 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p2capacity`, `p2term`, `p2trend`; `test_dump_for_qa_p2_rct.py`, `test_p2_rct_api.py` (+1) |
| 97 | `services/research.py` | 715 | keep | unchanged service; reads only through FileCache and the gate | none | `test_analytics_api.py`, `test_dump_for_qa.py` (+23) |
| 98 | `services/risk_extras.py` | 107 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p2risk`; `test_p2_risk_extras_api.py` |
| 99 | `services/roll.py` | 222 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `roll`; `test_dump_for_qa_p11_roll.py`, `test_p11_fixes.py` (+1) |
| 100 | `services/run_books.py` | 209 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `costs`, `trades`; `test_dump_for_qa.py`, `test_dump_for_qa_p1.py` (+3) |
| 101 | `services/runs.py` | 737 | keep | unchanged service; reads only through FileCache and the gate | none | `test_dump_for_qa.py`, `test_dump_for_qa_p1.py` (+7) |
| 102 | `services/seasonality.py` | 245 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `seasonality`; `test_dump_for_qa_p11_seas.py`, `test_p11_fixes.py` (+2) |
| 103 | `services/sessions.py` | 116 | keep | unchanged service; reads only through FileCache and the gate | none | `test_seasonality_service.py` |
| 104 | `services/spa_family.py` | 310 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `spa`; `test_dump_for_qa_p2_spa.py`, `test_p2_spa_api.py` |
| 105 | `services/stored_alpha.py` | 134 | keep | unchanged service; reads only through FileCache and the gate | none | `test_analytics_api.py`, `test_registry_drift.py` (+2) |
| 106 | `services/tearsheet.py` | 445 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `series`; `test_p1_bootstrap.py`, `test_p2_risk_extras_api.py` (+1) |
| 107 | `services/tearsheet_extended.py` | 282 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `p1series`; `test_dump_for_qa_p1.py`, `test_p1_api.py` (+3) |
| 108 | `services/tearsheet_trades.py` | 127 | keep | unchanged service; reads only through FileCache and the gate | none | `test_p1_api.py` |
| 109 | `services/vcone.py` | 166 | keep | unchanged service; reads only through FileCache and the gate | none | crosscheck `vcone`; `test_vcone.py`, `test_vcone_api.py` (+1) |
| 110 | `settings.py` | 113 | wrap | NQT_PORT accepts 0; NQT_DESKTOP mode flag; NQT_STATE_DIR and NQT_JOBS (section 2.6); desktop cache defaults (512 MiB bars, 128 MiB files) | 1.3, 1.5 | `test_analytics_api.py`, `test_analytics_errors.py` (+41); plus a new seam test (section 15) |

### A.2 Front-end screen and support folders (`web/src`)

| # | Path (`web/src/`) | Non-test files | Test files | Fate | Target | Stage | Test that proves parity |
|---:|---|---:|---:|---|---|---|---|
| 1 | `screens/blk` | 3 | 1 | keep | unchanged screen, same contract | none | vitest `screens/blk` (1 file); Playwright books.spec.ts; Mac smoke set (3.1) |
| 2 | `screens/corr` | 4 | 3 | keep | unchanged screen, same contract | none | vitest `screens/corr` (3 files); Playwright market.spec.ts; Mac smoke set (3.1) |
| 3 | `screens/cost` | 5 | 4 | keep | unchanged screen, same contract | none | vitest `screens/cost` (4 files); Playwright books.spec.ts; Mac smoke set (3.1) |
| 4 | `screens/des` | 29 | 21 | wrap | Save rows call bridge.saveFile instead of the anchor | 1.7 | vitest `screens/des` (21 files); Playwright des.spec.ts; Mac smoke set (3.1) |
| 5 | `screens/dq` | 6 | 3 | keep | unchanged screen, same contract | none | vitest `screens/dq` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 6 | `screens/evt` | 8 | 3 | keep | unchanged screen, same contract | none | vitest `screens/evt` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 7 | `screens/expo` | 2 | 2 | keep | unchanged screen, same contract | none | vitest `screens/expo` (2 files); Playwright books.spec.ts; Mac smoke set (3.1) |
| 8 | `screens/gp` | 12 | 6 | keep | unchanged; GIP pan and zoom traced at 20,000 bars | 2.4 | vitest `screens/gp` (6 files); Playwright gp.spec.ts, gallery-candles.spec.ts; Mac smoke set (3.1) |
| 9 | `screens/help` | 9 | 4 | wrap | shows the Mac bindings and the desktop key notes; licence list completed | 3.3 | vitest `screens/help` (4 files); Playwright keys.spec.ts, fkeys.spec.ts; Mac smoke set (3.1) |
| 10 | `screens/home` | 8 | 7 | wrap | orientation flag moves to the workspace store (nqt.orientation) | 1.6 | vitest `screens/home` (7 files); Playwright home.spec.ts, perf/budgets.spec.ts; Mac smoke set (3.1) |
| 11 | `screens/jobs` | 11 | 4 | keep | unchanged screen, same contract | none | vitest `screens/jobs` (4 files); Playwright flows/safety.spec.ts, flows/p2.spec.ts; Mac smoke set (3.1) |
| 12 | `screens/layouts` | 3 | 1 | wrap | default layouts unchanged; saved layouts read from the store | 1.6 | vitest `screens/layouts` (1 file); Playwright panels.spec.ts; Mac smoke set (3.1) |
| 13 | `screens/ledg` | 6 | 3 | keep | unchanged screen, same contract | none | vitest `screens/ledg` (3 files); Playwright perspective.spec.ts, books.spec.ts; Mac smoke set (3.1) |
| 14 | `screens/live` | 27 | 16 | wrap | countdown re-synced on visibility change after a restore | 2.4 | vitest `screens/live` (16 files); Playwright live.spec.ts, stream.spec.ts; Mac smoke set (3.1) |
| 15 | `screens/mon` | 14 | 7 | wrap | MON defaults move to the workspace store (nqt.mon.defaults) | 1.6 | vitest `screens/mon` (7 files); Playwright market.spec.ts; Mac smoke set (3.1) |
| 16 | `screens/oos` | 10 | 5 | wrap | CSV export through bridge.saveFile | 1.7 | vitest `screens/oos` (5 files); Playwright perspective.spec.ts; Mac smoke set (3.1) |
| 17 | `screens/p2rct` | 8 | 2 | keep | unchanged screen, same contract | none | vitest `screens/p2rct` (2 files); Playwright flows/p2.spec.ts; Mac smoke set (3.1) |
| 18 | `screens/reg` | 44 | 44 | wrap | Export rows call bridge.saveFile | 1.7 | vitest `screens/reg` (44 files); Playwright reg.spec.ts, flows/p2.spec.ts; Mac smoke set (3.1) |
| 19 | `screens/riskextras` | 7 | 4 | keep | unchanged screen, same contract | none | vitest `screens/riskextras` (4 files); Playwright flows/p2.spec.ts; Mac smoke set (3.1) |
| 20 | `screens/roll` | 10 | 3 | keep | unchanged screen, same contract | none | vitest `screens/roll` (3 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 21 | `screens/runs` | 19 | 11 | wrap | run id copy through bridge.copyText (clipboard API first) | 1.7 | vitest `screens/runs` (11 files); Playwright runs.spec.ts, perspective.spec.ts; Mac smoke set (3.1) |
| 22 | `screens/seal` | 2 | 1 | wrap | Save row calls bridge.saveFile | 1.7 | vitest `screens/seal` (1 file); Playwright books.spec.ts; Mac smoke set (3.1) |
| 23 | `screens/seas` | 7 | 2 | keep | unchanged screen, same contract | none | vitest `screens/seas` (2 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 24 | `screens/tear` | 26 | 20 | keep | unchanged screen, same contract | none | vitest `screens/tear` (20 files); Playwright tear.spec.ts; Mac smoke set (3.1) |
| 25 | `screens/vcone` | 9 | 4 | keep | unchanged screen, same contract | none | vitest `screens/vcone` (4 files); Playwright p11.spec.ts; Mac smoke set (3.1) |
| 26 | `(src root)` | 3 | 6 | wrap | main.tsx installs the bridge implementation chosen at start | 1.7 | vitest `(src root)` (6 files); new bridge or store tests (section 15) |
| 27 | `api` | 15 | 12 | wrap | client gains no new channel; health carries the contract version; bridgeVersion check; workspace client added beside jobsClient (the write scan allows exactly it) | 1.3, 1.6, 1.7 | vitest `api` (12 files); new bridge or store tests (section 15) |
| 28 | `assets` | 6 | 0 | keep | unchanged | none | covered through its callers' tests |
| 29 | `charts` | 31 | 26 | keep | unchanged; forced-colours drawing in the later accessibility phase | later | vitest `charts` (26 files) |
| 30 | `charts/echarts` | 28 | 18 | keep | unchanged | none | vitest `charts/echarts` (18 files) |
| 31 | `charts/theme` | 9 | 7 | keep | unchanged tokens; contrast re-run on WebKit | 3.1 | vitest `charts/theme` (7 files) |
| 32 | `chrome` | 107 | 86 | wrap | download.ts and panelExport.ts go through the bridge; key map gains Mac alternatives; no launch-argument deep links: Copy link gives a portable `#go=` string outside the fixed browser door, and the command line runs a pasted one (section 4.6) | 1.7, 3.3 | vitest `chrome` (86 files); new bridge or store tests (section 15) |
| 33 | `commands` | 12 | 14 | wrap | history moves to the store (nqt.cmd.history); Mac key alternatives in the grammar | 1.6, 3.3 | vitest `commands` (14 files); new bridge or store tests (section 15) |
| 34 | `copy` | 72 | 24 | wrap | new strings for the splash, backend stopped page and Mac keys; copy rules test | 2.1, 3.3 | vitest `copy` (24 files) |
| 35 | `demo` | 17 | 12 | keep | unchanged; ships only in the demo build; feeds the self-test page's offline mode | none | vitest `demo` (12 files) |
| 36 | `export` | 1 | 1 | wrap | saveBlob and saveText through the bridge | 1.7 | vitest `export` (1 file); new bridge or store tests (section 15) |
| 37 | `export/dossier` | 4 | 3 | keep | unchanged | none | vitest `export/dossier` (3 files) |
| 38 | `export/grab` | 4 | 4 | wrap | PNG save through bridge.saveFile; image copy through bridge.copyImage | 1.7 | vitest `export/grab` (4 files); new bridge or store tests (section 15) |
| 39 | `export/pack` | 2 | 2 | wrap | evidence pack saved through bridge.saveFile | 1.7 | vitest `export/pack` (2 files); new bridge or store tests (section 15) |
| 40 | `export/print` | 3 | 3 | keep | window.print() kept; checked in WebView2 and WKWebView | 2.4, 3.1 | vitest `export/print` (3 files) |
| 41 | `format` | 1 | 0 | keep | unchanged | none | covered through its callers' tests |
| 42 | `gallery` | 7 | 2 | keep | unchanged; screenshot gallery stays on Chromium | none | vitest `gallery` (2 files) |
| 43 | `grids` | 12 | 12 | keep | unchanged | none | vitest `grids` (12 files) |
| 44 | `perspective` | 16 | 8 | keep | wasm32 server pinned by a test; worker same-origin | 1.7 | vitest `perspective` (8 files) |
| 45 | `quant` | 6 | 6 | keep | golden tests also run under JavaScriptCore in CI | 3.1 | vitest `quant` (6 files) |
| 46 | `state` | 8 | 10 | wrap | zustand stores keep localStorage as a cache and sync to the workspace store; one-time import from browser storage | 1.6 | vitest `state` (10 files); new bridge or store tests (section 15) |
| 47 | `theme` | 11 | 10 | wrap | look and scheme move to the store (nqt.theme, nqt.cvd); forced-colors and prefers-contrast rules in the later accessibility phase | 1.6, later | vitest `theme` (10 files); new bridge or store tests (section 15) |
| 48 | `tiles` | 7 | 6 | keep | unchanged | none | vitest `tiles` (6 files) |
| 49 | `vendor` | 4 | 4 | keep | unchanged | none | vitest `vendor` (4 files) |

### A.3 QA, launchers, contract and test harness

| # | Path | Fate | Target | Stage | Test that proves parity |
|---:|---|---|---|---|---|
| 1 | `qa/crosscheck/__init__.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 2 | `qa/crosscheck/__main__.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 3 | `qa/crosscheck/compare.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 4 | `qa/crosscheck/dumps.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 5 | `qa/crosscheck/lv6_live_cone.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 6 | `qa/crosscheck/market_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 7 | `qa/crosscheck/p11_dq.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 8 | `qa/crosscheck/p11_evt.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 9 | `qa/crosscheck/p11_roll.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 10 | `qa/crosscheck/p11_seas.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 11 | `qa/crosscheck/p11_vcone.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 12 | `qa/crosscheck/p12_expectation.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 13 | `qa/crosscheck/p12_neff.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 14 | `qa/crosscheck/p12_power.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 15 | `qa/crosscheck/p1_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 16 | `qa/crosscheck/p2_amber_classic.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 17 | `qa/crosscheck/p2_regimes_capacity_term.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 18 | `qa/crosscheck/p2_risk_extras.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 19 | `qa/crosscheck/p2_spa.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 20 | `qa/crosscheck/paths.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 21 | `qa/crosscheck/reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 22 | `qa/crosscheck/report.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 23 | `qa/crosscheck/trade_reference.py` | keep | unchanged oracle; also run against the app-launched backend | 2.4 | `qa/tests`, `python -m crosscheck --strict` |
| 24 | `qa/golden/p12_expectation.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 25 | `qa/golden/p12_neff.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 26 | `qa/golden/p12_power.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 27 | `qa/golden/p2_neff_served.json` | keep | also read by the JavaScriptCore golden run | 3.1 | vitest `quant`; JavaScriptCore run |
| 28 | `start.ps1` | wrap | allow-listed environment; lock file attach; one-time launch code for the browser door; a backend it starts keeps 8765 (section 2.1); `-Dev` takes the real lock and opens the dev origin's session page (section 2.6) | 1.4, 1.4c, 1.5 | launcher plan tests (lock held, lock free, port 8765 never 0); `-DryRun` output check |
| 29 | `start.sh` | keep | unchanged hand-off to scripts/start.mjs | none | launcher tests |
| 30 | `scripts/start.mjs` | keep | unchanged Node version guard | none | `nodeGuard.test.ts` |
| 31 | `web/scripts/start/` | wrap | same changes as start.ps1 for the Mac browser door, port 8765 kept | 1.4, 1.5 | `plan.test.ts`, `doctor.test.ts`, `entry.test.ts` |
| 32 | `scripts/smoke_real.ps1` | wrap | its second backend gets a temporary state folder, `NQT_JOBS=off` and a session for the preview origin (section 2.6); later a second mode that drives the packaged app (hidden window) instead of a browser | 1.4c, 2.4 | the smoke itself: hashes unchanged, only terminal gate lines appended |
| 33 | `contract/openapi.json` | keep | regenerated once for the seven new routes | 1.3, 1.4, 1.6 | contract drift test; `pnpm test` codegen check |
| 34 | `web/scripts/bundleCheck.ts` | keep | budgets unchanged; desktop budgets live in the shell harness | none | `bundleCheck.test.ts`, `shellBudget.test.ts` |
| 35 | `web/e2e/` | wrap | specs unchanged on Chromium; `playwright.config.ts` and `perf/real.config.ts` gain a global set-up that redeems a launch code and saves the cookie (section 2.6); a desktop project reuses the specs against the app-launched backend | 1.4c, 2.4 | the suite itself, with the token middleware on |
| 36 | `web/vite.config.ts` | wrap | `session.html` as a second build input; dev proxy kept on 8765 with the `Origin` header unchanged | 1.4c | a build test finds `dist/session.html`; the `-Dev` launcher test |
| 37 | `backend/tests/fixture_app.py` | wrap | its own temporary state folder, lock and token; fake JOBS unchanged | 1.4c | the Playwright suite behind the token; a test that it never takes the lock of `<ROOT>/terminal/state` |

### A.4 New modules

| Path | Kind | Stage | Test |
|---|---|---|---|
| `backend/nq_terminal/desktop/handshake.py` | new | 1.3 | handshake and proof tests |
| `backend/nq_terminal/desktop/lock.py` | new | 1.3 | lock and attach tests |
| `backend/nq_terminal/desktop/watchdog.py` | new | 1.5 | watchdog test |
| `backend/nq_terminal/desktop/sessions.py` | new | 1.4 | session tests over the full route list |
| `backend/nq_terminal/desktop/envlist.py` | new | 1.5 | canary environment test |
| `backend/nq_terminal/api/desktop.py` | new | 1.3, 1.4 | proof and session tests |
| `backend/nq_terminal/api/workspaces.py` | new | 1.6 | store tests |
| `backend/nq_terminal/models/workspaces.py` | new | 1.6 | schema tests, contract drift |
| `backend/nq_terminal/services/workspaces.py` | new | 1.6 | atomic write and path tests |
| `backend/nq_terminal/services/result_cache.py` | new | 1.2 | cached against fresh bodies, invalidation |
| `contract/desktop_version.json` | new | 1.3 | contract drift test: the shell-facing part's sha256 matches, and the number moved up by one when it changed |
| `web/dist/build-stamp.json` (built, git-ignored) | new | 1.3 | a stale-source test and a changed-contract test both report `dist: stale` |
| `web/session.html` and its module | new | 1.4 | redeem flow test |
| `web/src/bridge/*` | new | 1.7 | bridge tests, IPC source scan |
| `web/src/state/remoteStore.ts` | new | 1.6 | store client tests, merge rules |
| `web/src/selftest/*` | new | 3.1 | runs in the Mac app and in the Windows smoke |
| `desktop/src-tauri/src/*.rs` (7 modules) | new | 2.1 to 3.4 | `cargo test`, Clippy bans, IPC refusal test |
| `desktop/harness/*` | new | 2.4 | its own runs reproduce the spike's figures within noise |

## Appendix B. Dependencies and their fate

### B.1 Generated: backend runtime, QA environment and npm

The backend list is the inventory's census (section 5) plus the four installed packages the terminal never imports. The npm lists are `web/package.json`.

| # | Python distribution (backend runtime) | Version | Installed MB | Loaded | Fate | Note |
|---:|---|---|---:|---|---|---|
| 1 | `nautilus_trader` | 1.231.0 | 317.2 | on first use of a route | keep, out of the start path | loaded only by GET /api/jobs and the JOBS child; never in the shell |
| 2 | `scipy` | 1.18.1 | 103.0 | app start | keep, lazy | imported inside the 14 functions' callers after stage 1.1; not ported |
| 3 | `pyarrow` | 25.0.1 | 82.5 | app start | keep | catalogue footers; rows only inside nq_lab |
| 4 | `numpy` | 2.5.3 | 40.1 | app start | keep | PCG64 draw order pinned by the crosscheck; never replaced |
| 5 | `pandas` | 2.3.3 | 36.6 | app start | keep | the real coupling; no port planned |
| 6 | `pydantic_core` | 2.46.5 | 5.2 | app start | keep | response validation |
| 7 | `pydantic` | 2.13.5 | 1.8 | app start | keep | response models, new workspace schemas |
| 8 | `zstandard` | 0.25.0 | 1.3 | on first use of a route | keep | transitive; follows its parent |
| 9 | `pytz` | 2026.4 | 1.0 | app start | keep | transitive; follows its parent |
| 10 | `exchange_calendars` | 4.13.2 | 0.8 | app start | keep | DQ calendar |
| 11 | `fastapi` | 0.141.1 | 0.8 | app start | keep | same contract |
| 12 | `fsspec` | 2026.2.0 | 0.7 | on first use of a route | keep | transitive; follows its parent |
| 13 | `charset-normalizer` | 3.5.1 | 0.6 | app start | keep | transitive; follows its parent |
| 14 | `tzdata` | 2026.4 | 0.6 | app start | keep | transitive; follows its parent |
| 15 | `anyio` | 4.15.1 | 0.5 | app start | keep | stream and stdin watchdog thread |
| 16 | `python-dateutil` | 2.9.0.post0 | 0.4 | app start | keep | transitive; follows its parent |
| 17 | `httpx2` | 2.13.1 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 18 | `idna` | 3.20 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 19 | `msgspec` | 0.21.1 | 0.4 | on first use of a route | keep | transitive; follows its parent |
| 20 | `orjson` | 3.12.0 | 0.3 | app start | keep | unchanged |
| 21 | `starlette` | 1.7.0 | 0.3 | app start | keep | middleware gains the token check |
| 22 | `toolz` | 1.1.0 | 0.2 | app start | keep | transitive; follows its parent |
| 23 | `typing_extensions` | 4.16.0 | 0.2 | app start | keep | transitive; follows its parent |
| 24 | `cloudpickle` | 3.1.2 | 0.1 | app start | keep | transitive; follows its parent |
| 25 | `portion` | 2.6.2 | 0.1 | on first use of a route | keep | transitive; follows its parent |
| 26 | `pyluach` | 2.3.0 | 0.1 | app start | keep | transitive; follows its parent |
| 27 | `sortedcontainers` | 2.4.0 | 0.1 | on first use of a route | keep | transitive; follows its parent |
| 28 | `typing-inspection` | 0.4.4 | 0.1 | app start | keep | transitive; follows its parent |
| 29 | `annotated-doc` | 0.0.5 | 0.0 | app start | keep | transitive; follows its parent |
| 30 | `annotated-types` | 0.8.0 | 0.0 | app start | keep | transitive; follows its parent |
| 31 | `korean_lunar_calendar` | 0.4.0 | 0.0 | app start | keep | transitive; follows its parent |
| 32 | `six` | 1.17.0 | 0.0 | app start | keep | transitive; follows its parent |
| 33 | `sniffio` | 1.3.1 | 0.0 | app start | keep | transitive; follows its parent |
| 34 | `uvicorn` | 0.54.0 | 0.3 | server entry point; plain install, so no `uvloop` and no `httptools`: it runs on the standard asyncio loop | keep | binds port 0 in desktop mode |
| 35 | `h11` | 0.16.0 | 0.1 | HTTP/1.1 parser used by uvicorn | keep | unchanged |
| 36 | `click` | 8.5.0 | 0.4 | imported by uvicorn | keep | transitive; follows its parent |
| 37 | `nautilus_ibapi` | 10.45.1 | 1.1 | only with `NQT_IB_READONLY=1`, and only inside `take_snapshot` | keep, opt-in | read-only snapshot, client id 95 |
| 38 | `protobuf` | 5.29.6 | 1.6 | dependency of the IB library | keep | transitive; follows its parent |
| 39 | `scikit-learn 1.9.1` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | research code only |
| 40 | `langchain-typesafe and its tree` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | lab text pipeline only |
| 41 | `quantpad-data 0.8.0` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | lab data pulls only |
| 42 | `pytest` | see name | not counted | never by the terminal | keep in the lab venv, never shipped | backend test runner |

| # | QA environment (pinned in `qa/pyproject.toml`) | Fate | Note |
|---:|---|---|---|
| 1 | `quantstats==0.0.82` | keep | the oracle; runs in CI on Windows; never shipped |
| 2 | `empyrical-reloaded==0.5.12` | keep | the oracle; runs in CI on Windows; never shipped |
| 3 | `arch==8.0.0` | keep | the oracle; runs in CI on Windows; never shipped |
| 4 | `statsmodels==0.15.0` | keep | the oracle; runs in CI on Windows; never shipped |
| 5 | `scipy==1.18.1` | keep | the oracle; runs in CI on Windows; never shipped |
| 6 | `pytest==9.0.2` | keep | the oracle; runs in CI on Windows; never shipped |

| # | npm production dependency | Version | Fate | Note |
|---:|---|---|---|---|
| 1 | `@fontsource/pt-mono` | 5.3.0 | keep | self-hosted; same glyphs on both engines |
| 2 | `@fontsource/source-sans-3` | 5.3.0 | keep | self-hosted |
| 3 | `@perspective-dev/client` | 5.5.1 | keep | unchanged |
| 4 | `@perspective-dev/server` | 5.5.1 | keep | wasm32 build pinned by a test (memory64 absent in Safari) |
| 5 | `@perspective-dev/viewer` | 5.5.1 | keep | unchanged |
| 6 | `@perspective-dev/viewer-datagrid` | 5.5.1 | keep | unchanged |
| 7 | `@tanstack/react-query` | 5.103.2 | keep | networkMode always kept |
| 8 | `@tanstack/react-table` | 9.2.4 | keep | unchanged |
| 9 | `@tanstack/react-virtual` | 3.14.13 | keep | unchanged |
| 10 | `cmdk` | 1.1.1 | keep | unchanged |
| 11 | `dockview-react` | 8.3.1 | keep | drag and drop stays off; checked in WKWebView at G1 |
| 12 | `echarts` | 6.1.0 | keep | Apache-2.0 notice added to HELP licences |
| 13 | `lightweight-charts` | 5.2.1 | keep | Apache-2.0 notice; attribution link opens in the system browser |
| 14 | `react` | 19.3.0 | keep | unchanged |
| 15 | `react-dom` | 19.3.0 | keep | unchanged |
| 16 | `uplot` | 1.6.32 | keep | unchanged |
| 17 | `zustand` | 5.0.15 | keep | stores sync to the workspace store |

| # | npm development dependency | Version | Fate | Note |
|---:|---|---|---|---|
| 1 | `@axe-core/playwright` | 4.13.0 | keep | also injected into the Mac self-test page (axe-core build) |
| 2 | `@playwright/test` | 1.63.0 | keep | stays the Chromium suite; drives Electron only if T1 or T2 fires |
| 3 | `@tailwindcss/vite` | 4.3.3 | keep | unchanged |
| 4 | `@testing-library/dom` | 10.4.2 | keep | unchanged |
| 5 | `@testing-library/react` | 16.3.3 | keep | unchanged |
| 6 | `@types/node` | 24.19.0 | keep | unchanged |
| 7 | `@types/react` | 19.3.0 | keep | unchanged |
| 8 | `@types/react-dom` | 19.3.0 | keep | unchanged |
| 9 | `@vitejs/plugin-react` | 6.1.1 | keep | unchanged |
| 10 | `jsdom` | 30.1.1 | keep | unchanged |
| 11 | `openapi-typescript` | 7.13.0 | keep | regenerates types for the seven new routes |
| 12 | `tailwindcss` | 4.3.3 | keep | unchanged |
| 13 | `typescript` | 6.0.3 | keep | unchanged |
| 14 | `vite` | 8.3.1 | keep | unchanged |
| 15 | `vitest` | 5.0.2 | keep | unchanged; plus a JavaScriptCore runner for `web/src/quant` golden tests |

Transitive npm packages: 100 more in the production tree (inventory 9.1), all kept. The Apache-2.0, BSD-3-Clause, MPL-2.0 and OFL-1.1 notices (ECharts, zrender, lightweight-charts, Perspective and its tree, the fonts) are added to the HELP licence list in stage 3.3, closing open question 8 of the front-end inventory.

### B.2 New: the shell and its tooling

| Dependency | Version (checked 2 October 2026) | Licence | Fate | Note |
|---|---|---|---|---|
| `tauri` | 2.12.1 (S1, M7) | MIT or Apache-2.0 | add | floor 2.11.6 for the 2026 IPC fixes (S21); 3.x only through T7 |
| `tauri-build` | 2.7.1 (measured in the spike's lockfile) | MIT or Apache-2.0 | add | |
| `@tauri-apps/cli` | 2.12.1 (S1) | MIT or Apache-2.0 | add (dev) | run through `pnpm dlx`, no global install |
| `tauri-plugin-single-instance` | 2.5.2 (M8) | MIT or Apache-2.0 | add | shell side only; forwarded arguments ignored |
| `tauri-plugin-window-state` | 2.5.0 (M8) | MIT or Apache-2.0 | add | shell side only |
| `tauri-plugin-dialog` | 2.8.1 (M8) | MIT or Apache-2.0 | add, Rust side only | save dialog and lab picker called from Rust; no capability for the page |
| `fs`, `shell`, `http`, `opener`, `clipboard-manager`, `updater`, `deep-link`, `localhost` plugins | | | never | the page gets no plugin permission (02, C3-1); `localhost` is not needed because the backend serves the page |
| `webview2-com` | as pinned by Tauri | MIT | add, Windows only | settings and `ProcessFailed` through `with_webview` |
| `hmac`, `sha2`, `getrandom` | latest at stage 2 | MIT or Apache-2.0 | add | token, nonce, proof |
| `serde`, `serde_json` | as pinned by Tauri | MIT or Apache-2.0 | add | handshake and settings |
| a minimal HTTP client for `link.rs` (for example `ureq`) | latest at stage 2 | MIT or Apache-2.0 | add | 127.0.0.1 only, enforced in code and test |
| `windows` crate (Job Object) | as pinned by Tauri | MIT or Apache-2.0 | add, Windows only | |
| cargo-deny, cargo-audit | latest at stage 2 | MIT or Apache-2.0 | add (CI) | bans, advisories, sources |
| Rust toolchain | pinned in `rust-toolchain.toml`; 1.99.0 used by the spike | MIT or Apache-2.0 | add | MSVC host in CI, GNU host under `D:\dev` for spikes |
| NSIS | 3.11 (fetched by the Tauri bundler in the spike) | zlib | add (build) | |
| WebView2 Evergreen runtime | 154.0.4258.48 on this PC | Microsoft | use, not shipped | embedded bootstrapper only |
| WKWebView | the Mac's macOS | Apple | use, not shipped | G1 per macOS release |
| OpenSSH client on the Mac, server or private network on the PC | system | | use | remote mode, owner's install |
| WebdriverIO and its Tauri service | latest at stage 3 | MIT (unverified) | add (Mac tests) | D1 |
| `axe-core` | as pinned by `@axe-core/playwright` | MPL-2.0 (unverified) | add to the self-test build | not in the production build |
| Electron 44 | 44.5.1 (S2) | MIT | only under T1 or T2 | then also Playwright's Electron class (D7) |

### B.3 Toolchains that stay

Node 24 or newer and pnpm 11.5.1 (build only), Python 3.12.12 with uv from the lab, Vite 8.3.1, TypeScript 6.0.3 and the rest of the dev list above. All caches for automated builds on this PC stay on D: (`npm_config_cache`, `npm_config_store_dir`, `CARGO_HOME`, `RUSTUP_HOME` under `D:\dev`), set per process, never in the owner's permanent environment.

## Sources

New in this step, all checked on 2 October 2026. S, D, L4-S and L7-S tags are the source lists of `01_options.md`, `02_decision.md`, `research/L4_distribution.md` and `research/L7_security_a11y.md`.

- M1. WHATWG HTML, Server-sent events, the `EventSource` constructor: without `withCredentials` the request is created with the Anonymous CORS state: https://html.spec.whatwg.org/multipage/server-sent-events.html ; and "create a potential-CORS request", where Anonymous gives the credentials mode "same-origin": https://html.spec.whatwg.org/multipage/urls-and-fetching.html#create-a-potential-cors-request
- M2. RFC 6265, HTTP State Management Mechanism, section 8.5 "Weak Confidentiality" (cookies do not provide isolation by port): https://www.rfc-editor.org/rfc/rfc6265#section-8.5
- M3. Tauri source, `crates/tauri/src/webview/mod.rs` at tag `tauri-v2.12.1`: `on_navigation`, `on_new_window`, `on_download`, `data_directory`, `additional_browser_args`, `zoom_hotkeys_enabled`, `devtools`, `initialization_script`, `with_webview`, `set_cookie`, read through the GitHub API: https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri/src/webview/mod.rs . A code search of the repository for an accelerator-key option returned nothing; wry has `with_browser_accelerator_keys` (https://github.com/tauri-apps/wry/blob/dev/src/lib.rs).
- M4. Microsoft, `ICoreWebView2Settings3`, `AreBrowserAcceleratorKeysEnabled` (which keys it disables and which stay on; default TRUE): https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings3
- M5. Tauri plugins workspace, plugin list including `single-instance`, `window-state`, `dialog`, `updater`, `localhost`: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins
- M6. Microsoft, Use Playwright to automate and test in WebView2 (points to Playwright's WebView2 page): https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/playwright and https://playwright.dev/docs/webview2 (the second page was not read in this step)
- M7. Tauri releases, read through the GitHub API (latest `tauri-v` tag is 3.0.0-alpha.4 of 1 October 2026; 2.12.1 is the current 2.x): https://github.com/tauri-apps/tauri/releases
- M9. Microsoft, `ICoreWebView2Settings`, `IsZoomControlEnabled`: "When disabled, the user is not able to zoom using Ctrl++, Ctrl+-, or Ctrl+mouse wheel, but the zoom is set using ZoomFactor API": https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings . The same check of M4 confirmed "This setting has no effect on the AcceleratorKeyPressed event. The event will be fired for all accelerator keys, whether they are enabled or not." The Tauri side (M3, same file at `tauri-v2.12.1`) has `Webview::set_zoom(scale_factor)`, `PlatformWebview::controller()` returning `ICoreWebView2Controller` on Windows, and documents that `zoom_hotkeys_enabled` maps to `IsZoomControlEnabled` on Windows and injects a polyfill needing the `core:webview:allow-set-webview-zoom` permission on macOS.
- M10. Microsoft, WebView2 download page (Evergreen Bootstrapper and Evergreen Standalone Installer): https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- M11. GitHub `actions/runner-images`, `images/windows/Windows2025-Readme.md`, image version 20260922.270.2: lists Microsoft Edge 153.0.4234.48 and no separate WebView2 runtime line (read through the GitHub API): https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md
- M8. crates.io API: `tauri-plugin-single-instance` 2.5.2, `tauri-plugin-window-state` 2.5.0, `tauri-plugin-dialog` 2.8.1: https://crates.io/crates/tauri-plugin-single-instance , https://crates.io/crates/tauri-plugin-window-state , https://crates.io/crates/tauri-plugin-dialog

Local evidence: the documents listed at the top, `tools/plan/gen_03_tables.py` and its output, and the source files read for this step.
