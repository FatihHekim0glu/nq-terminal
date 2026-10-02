"""The desktop seam of the backend (03 section 2, 04 phase D2).

- `lock`: one backend per lab, `<state>/backend.lock`, owner-only and held open for the backend's life.
- `lifecycle`: takes the lock in the app's start-up; the runtime (token, port, pid); the same-origin list from the
  bound port.
- `handshake`: the NQT-READY and NQT-ATTACH lines and the TOKEN and NONCE stdin channel.
- `proof`: the challenge-response identity proof behind GET /api/desktop/proof.
- `build_stamp`: whether `web/dist` is current, stale or missing.
- `fixture_main`: the test-only entry that serves the fixture lab through the same handshake.
- `sessions`, `watchdog`, `envlist`: the stage B modules, with their final signatures (stubs in stage A).

Nothing here is imported on the start path of a plain browser backend except through `__main__.py` and app.py.
"""
