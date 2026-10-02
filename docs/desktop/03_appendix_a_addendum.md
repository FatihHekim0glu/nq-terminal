# Addendum to 03, Appendix A: modules added after the appendix was written

03's Appendix A gives a fate to every backend module and every front-end folder. This file holds the fate of any module that appeared after that appendix was generated, so that the preflight of every desktop phase (04, standing rule 14) ends with 0 unmapped rows. A phase that adds a module adds one row here in the same change; the next preflight reads this file together with 03.

## Preflight of 2 October 2026 (wave W0A, stage A of D0)

`nq-lab/desktop_research/tools/plan/gen_03_tables.py` was run on the tree at commit `7f8b986` with the nq-lab venv Python (output kept in `docs/desktop/baseline/raw/gen03_tables_output.md`).

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders, QA, launcher and contract rows | 110, 25, 24 and 35, the counts 03 recorded |
| Unmapped rows | 0 |
| Route rows | 78 (76 GET, 1 POST, 1 DELETE), the same as the 78 (method, path) pairs of the built app |
| Module and folder names against 03's Appendix A | identical, apart from `backend/tests/fixture_app.py`, a hand-added row in 03 that the generator does not emit |
| Rows to add to this addendum | none |

`api/paper_expectation.py` and `services/paper_expectation.py` (the modules that were uncommitted when 03 was written) are already in 03 as rows 41 and 95 of Appendix A.1 with the fate `keep`, and the route `GET /api/analytics/paper-expectation` is in the generated route table; they need no addendum row.

## Preflight of 2 October 2026 (wave W1A, stage A of D1)

`gen_03_tables.py` was run on the tree at commit `af2f164` with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 111, 25, 24 and 35 |
| Unmapped rows | 0 |
| New module in this wave | `services/result_cache.py` (522 lines), already row 98 of 03, fate `keep` |
| New test files in this wave | `test_startup_imports.py`, `test_result_cache.py`, `test_result_cache_persist.py` (tests carry no addendum row) |
| Rows added to this addendum | `services/prewarm.py` (written in W1B) and `api/home_prewarm.py` (added in W1B), below |
| Other build workflows on the repository | none (only the owner's 8765 backend, without `--reload`) |

## Preflight of 2 October 2026 (wave W2A, stage A of D2)

`gen_03_tables.py` was run on the tree at commit `3c06235` plus this wave's uncommitted tree, with the nq-lab venv Python.

| Check | Result |
|---|---|
| Backend modules, screen folders, support folders and contract rows | 124, 25, 24 and 35 |
| Rows the generator cannot map by itself | 10, all under `desktop/`: `lock.py`, `handshake.py`, `watchdog.py`, `sessions.py` and `envlist.py` are rows of 03's A.4; `__init__.py`, `lifecycle.py`, `build_stamp.py`, `proof.py` and `fixture_main.py` are added below, so 0 are left unmapped |
| `api/desktop.py` | mapped by the `api/` rule and by the A.4 row; its 4 routes are in 03's route table (`/api/desktop/proof` by hand, the three session routes under stage 1.4) |
| Routes of the built app | 82 (80 GET, 1 POST, 1 DELETE); the contract has 79 paths |
| Other build workflows on the repository | none (only the owner's 8765 backend, pid 46084, without `--reload`) |
| Owner reminder (manager decision 11, 04) | stop the 8765 backend before relying on the lock; the old process holds none, so a second backend would not see it |

## Rows added by later phases

Columns follow Appendix A.1: path, lines, fate (`keep`, `wrap`, `new` or `remove`), desktop form, stage, tests.

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D1 (W1B) | `backend/nq_terminal/services/prewarm.py` | 117 | new | once-per-process warm-up thread that runs zero-argument tasks in order after the port is bound; on only when `NQT_DESKTOP=1` or `NQT_PREWARM=1`; errors logged, never raised | D1 | `test_prewarm.py` |
| D1 (W1B) | `backend/nq_terminal/api/home_prewarm.py` | 108 | new | the HOME task list (deflated, ledger, two-day, universe, GP bars, EQ bootstrap) built from the cached route callables and started from the app's lifespan; skipped in fixture mode and for `NQT_PREWARM=0` | D1 | `test_home_prewarm.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/__init__.py` | 13 | new | package marker; names the seam's modules | D2 | `test_build_stamp.py`, `test_desktop_fixture_main.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/lifecycle.py` | 118 | new | the lock taken in the app's lifespan (so every start path takes it); the runtime (token, port, pid, nonce, mode); the same-origin list from the bound port, with the Vite port only under `NQT_DEV=1` | D2 | `test_desktop_lifecycle.py`, `test_app.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/build_stamp.py` | 81 | new | `dist` current, stale or missing, from `web/dist/build-stamp.json` against the newest source time and the sha256 of `contract/openapi.json` | D2 | `test_build_stamp.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/proof.py` | 33 | new | the challenge-response body: an HMAC over nonce, port and pid keyed by the token, which is never sent | D2 | `test_desktop_proof_challenge.py` |
| D2 (W2A) | `backend/nq_terminal/desktop/fixture_main.py` | 80 | new | the test-only entry that serves the fixture lab through the same lock, stdin channel and handshake | D2 | `test_desktop_fixture_main.py` |

The new modules that 03 already plans (`services/result_cache.py`, `desktop/lock.py`, `desktop/sessions.py`, `desktop/envlist.py`, the workspace models and service, and the others in its stage 1 list) are rows of 03 itself and are not repeated here. Only a module that 03 does not name belongs in this table, for example `services/prewarm.py` and `desktop/fixture_main.py`, which the wave plan adds; the phase that creates them adds their rows.
