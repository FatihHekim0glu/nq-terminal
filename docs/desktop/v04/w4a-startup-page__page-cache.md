# Wave w4a-startup-page, slice page-cache: the page's files out of Python

Built on 12 October 2026 in the worktree `E:/projects/nq-lab/wt-w4a` (branch `v04/w4a-startup-page`, origin/main
`9d2cd62` plus the w1-startup-backend merge `e7eaffd`). Option (a) of `startup.md` 7.5: cache headers on the page's
files, and a preferred desktop port behind a setting that stays off until the owner decides O19. No timing is claimed
here; the A/B against 0.3.3 belongs to the merge (PROVISIONAL on this loaded PC).

## What changed

| File | Change |
| --- | --- |
| `backend/nq_terminal/security.py` | `page_cache_control(path, status)` and `is_hashed_asset(path)`; `SecurityHeadersMiddleware` applies them. A hashed file under `/assets/` answered 200, 206 or 304 gets `Cache-Control: public, max-age=31536000, immutable`; every other response outside `/api` (`/`, `index.html`, `session.html`, `favicon.svg`, `build-stamp.json`, an unhashed or missing file, a 404) gets `no-cache`. Nothing under `/api` is touched: an /api answer keeps exactly the Cache-Control its route set (the proof, the session routes and the refusals keep `no-store`; the stream keeps its `no-store`). |
| `backend/nq_terminal/desktop/port_pref.py` | New module: the preferred desktop port (see the rules below). |
| `backend/nq_terminal/__main__.py` | `serve` binds through `port_pref.bind(settings, bind_socket)` and then calls `port_pref.remember(settings, port)`, both before the app is built; docstring step 3 says so. |
| `backend/nq_terminal/app.py` | Docstring only: the cache headers are a header rule in the existing layer, so the one plain StaticFiles mount at `/` is unchanged. |
| `backend/tests/test_asset_cache_headers.py`, `backend/tests/test_port_pref.py` | New tests (below). |

A hashed name is `/assets/<name>-<8 base64url characters>.<ext>` with no sub-folder: every one of the 209 files in
the current build's `web/dist/assets` matches it, including the two Perspective `.wasm` files and names whose hash holds
a `-` (`Cone-CLmF-tnY.js`). An unhashed file there would get `no-cache`, never `immutable`.

## The preferred port

- The setting: `<state>/port_pref.json`, on only when it is a JSON object whose `preferred_port` is exactly `true`.
  Absent (the default), `false`, a string, a number, another key, malformed JSON or a file over 4 KiB: off. The backend
  only reads it. In the app the state folder is `<lab>/terminal/state`; a smoke or measure run with `--state-dir` uses its
  own folder, so a harness run turns it on in its run folder's state and never in the owner's.
- The record: `<state>/last_port.json`, `{"port": N}`, written by the backend only while the setting is on, only when
  the port bound differs from the record (a usual launch on the same port writes nothing), through
  `last_port.json.tmp` and `os.replace`. A write problem is logged at WARNING and the start goes on.
- Applies only in desktop mode with port 0 asked for (the shell always sets `NQT_PORT=0`). An explicit `NQT_PORT`, the
  launchers' 8765 and the browser form are never changed.
- Allowed ports: 49152 to 65535 (the dynamic range Windows uses for port 0), never 8765, the Vite dev port 5173 or the IB
  ports 4001, 4002, 7496 and 7497. A record naming anything else is ignored and the backend binds port 0.
- The preferred port goes through the same exclusive bind as today (`bind_socket`, `SO_EXCLUSIVEADDRUSE` on
  127.0.0.1), before the app is built, so the same-origin list still names the bound port. A busy or refused preferred
  port (held by any process, with or without `SO_REUSEADDR`) falls back to port 0 at once; that port becomes the record.
- Checked by hand on this PC: an exclusive rebind of a port whose server side still holds TIME_WAIT connections
  succeeds (`D:/dev/v04/w4a-startup-page/timewait_probe.py`), so a quick relaunch keeps its port.

To turn it on for a test: write `{"preferred_port": true}` to the run folder's `state/port_pref.json` before the first
launch. To turn it off: delete that file or set `false`; the record may stay, it is ignored.

## Security notes (for the security QA and for O19)

1. **Cookies are not port-scoped.** RFC 6265 cookies for `127.0.0.1` ride to every loopback port, and SameSite counts
   every loopback port as the same site; this is already true with a random port and is why `SessionMiddleware` checks
   the Origin against the session's origin and why the cookie is named `nqt_s_<port>`. A stable port changes two things:
   the cookie name is the same from launch to launch, and a cookie the WebView2 profile kept from the last launch would
   be sent again. It names no live session (the session store is in memory and dies with the backend), so the answer is
   401 and the shell makes a new session, as it does today. The cookie stays HttpOnly, SameSite=Strict, Path=/api, with
   no expiry (a session cookie), so nothing new is written to disk by this change.
2. **The stale-page path (`desktop/src-tauri/src/stale_page.rs`) with a backend on the same port.** The shell only ever
   navigates to the port in the READY line of the backend it started, so a port squatted by another process is never
   loaded: the exclusive bind fails, the backend falls back to port 0, and READY names the new port. When the page build
   is stale the supervisor ends the backend, rebuilds, and starts a new one; with the preference on the new backend
   normally gets the same port and origin. `index.html` is `no-cache`, so the page is revalidated (a 304 or the new file)
   on every load and the rebuilt page's new hashed names are fetched; the old hashed files stay in WebView2's cache under
   names nothing refers to. Hashed files are content-addressed, so a file kept from an older build is byte-identical to
   what any build would serve under that name. One residual: a backend of 0.3.3 or older sends no Cache-Control on
   `index.html`, so if such a backend ever served the same origin (it binds a random port, so this needs it to land on the
   preferred port, about 1 in 16,000 launches), WebView2 could keep its `index.html` by heuristic freshness and show the
   old page until revalidation. A downgrade test should clear the WebView2 cache or keep the setting off.
3. **The same-origin list.** Unchanged: `lifecycle.origins(settings, port)` names the bound port only (and the dev port
   under NQT_DEV=1), because the port is still known before the app is built. The preferred port never widens it.
4. **8765 and other named ports.** `is_allowed` refuses them whatever the record says, so a planted or stale record
   cannot move the app onto the launchers' port, the dev port or an IB port.
5. **The files are not owner-checked** (unlike `backend.lock`). A file planted in the state folder by another principal
   can at most turn the setting on (web storage then persists, O19) or name a free port in 49152 to 65535, which is bound
   exclusively; the identity proof and the session checks are unchanged. The state folder's own rights are the control.
6. **Web storage persists across launches (O19).** With a stable origin, `localStorage`, `sessionStorage` (per tab, so
   not across launches) and IndexedDB of the page are kept. `web/src/state/remoteStore.ts` says the desktop cache "starts
   empty at every launch" because the origin changes; with the setting on that no longer holds: the cached keys and the
   unsent list `nqt.remote` from the last launch are there at start. The store already handles the fixed-origin door
   (the browser terminal on 8765) this way, so it should work, but this is a behaviour change to review before the
   owner turns the setting on by default.
7. **The single mount rule.** No mount, sub-app or StaticFiles subclass was added; the cache rule lives in
   `SecurityHeadersMiddleware`, so the middleware order checked by `test_route_refusal_walk.py` is unchanged.

## Tests

`backend/tests/test_asset_cache_headers.py` (54 cases) and `backend/tests/test_port_pref.py` (58 cases):
`"C:/Users/Fatih Hekimoglu/nq-lab/.venv/Scripts/python.exe" -m pytest backend/tests/test_asset_cache_headers.py
backend/tests/test_port_pref.py` with `PYTHONPATH=E:/projects/nq-lab/wt-w4a/backend`: 112 passed.

Born-failing evidence:

- Headers, before the change to `security.py`: 45 failed, 9 passed. Failing: hashed assets without `immutable` (GET,
  HEAD, 304), `index.html` and `/` without `no-cache`, unhashed, missing and other page files without `no-cache`, and
  every case of the pure rule, including `page_cache_control` under `/api` (absent function). The 9 that passed are
  regression guards on today's tree: an /api answer and /api paths shaped like assets carry no cache header, the
  refusal and the proof keep `no-store`, the security headers ride on assets, and the one plain StaticFiles mount.
- Port: before the module existed the file failed at collection (ImportError on `port_pref`). Fed a deliberately
  naive first cut (every port allowed, the setting always on, no fallback, always writing), 49 failed and 9 passed:
  8765, 5173, the IB ports and every out-of-range or non-int port accepted; a recorded 8765 or out-of-range port bound;
  with the setting off (9 forms) the recorded port bound instead of port 0 and the record rewritten; a busy preferred
  port raising instead of falling back; the start path not binding the preferred port nor recording it. The start-path
  case "setting off binds port 0 and writes nothing" is a regression guard on today's start path.

Neighbouring tests run in this slice (in process, nothing served): `test_safety_ast.py`, `test_desktop_tree.py`,
`test_app.py`, `test_route_refusal_walk.py`, `test_csp_wasm.py`, `test_session_middleware.py`, `test_line_endings.py`,
`test_live_stream.py`, `test_session_routes.py`, `test_desktop_proof.py`: 527 passed, 1 failed, the failure being
`test_safety_ast.py::test_real_tree_passes[prod]` on the two record writes in `port_pref.py` (the wiring below). The
in-process cases of `test_desktop_handshake.py` that drive `serve` and `bind_socket`: 16 passed.

## Wiring for the merge (files this slice does not own)

1. `backend/tests/test_safety_ast.py`: add `PORT_PREF = "backend/nq_terminal/desktop/port_pref.py"`, add it to
   `WRITE_ALLOWED`, and add `PORT_PREF: frozenset({"_record_file", "_record_temp"})` to `CONFINED_WRITERS`; one sentence
   in the module docstring's write rule: the preferred desktop port (`desktop/port_pref.py`, w4a) is the fifth, its
   write and replace confined to names bound by `_record_file(...)` and `_record_temp(...)`, the two record names in the
   state folder. Checked in memory with those three changes: PROD 145, TEST 215 and OTHER 49 files, 0 violations, and an
   unconfined `write_text` in that module is still flagged.

## For the 03 Appendix A addendum

| Item | Kind | Fate |
| --- | --- | --- |
| `backend/nq_terminal/desktop/port_pref.py` | new module | kept; off by default (O19) |
| `<state>/port_pref.json` | new state-folder file, read only by the backend | kept; written by the owner or a harness run in its own state folder |
| `<state>/last_port.json` (and its `.tmp`) | new state-folder file, written by the backend | kept; only with the setting on |
| `security.page_cache_control`, `security.is_hashed_asset`, `ASSET_CACHE_CONTROL`, `PAGE_CACHE_CONTROL` | new functions and constants in an existing module | kept |
| `backend/tests/test_asset_cache_headers.py`, `backend/tests/test_port_pref.py` | new tests | kept |

No route, mount, middleware layer, environment variable or model was added.

## Not done or not verified here

- No launch was measured: the exit criterion (0 asset requests to the backend on a second launch with the setting on)
  and the A/B against 0.3.3 are the merge's, through the A/B labs.
- WebView2's own behaviour (that it serves `immutable` files from cache without a request and reuses compiled code) is
  not tested in this slice; it is what the merge's backend.log count shows.
- The web storage review of note 6 (`remoteStore.ts` and the other stores) is for the owner's O19 decision; no web file
  was changed.
- The full backend suite was not run (merge, HEAVY slot).
