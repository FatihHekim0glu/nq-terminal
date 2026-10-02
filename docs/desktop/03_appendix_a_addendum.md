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

## Rows added by later phases

Columns follow Appendix A.1: path, lines, fate (`keep`, `wrap`, `new` or `remove`), desktop form, stage, tests.

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| (none yet) | | | | | | |

The new modules that 03 already plans (`services/result_cache.py`, `desktop/lock.py`, `desktop/sessions.py`, `desktop/envlist.py`, the workspace models and service, and the others in its stage 1 list) are rows of 03 itself and are not repeated here. Only a module that 03 does not name belongs in this table, for example `services/prewarm.py` and `desktop/fixture_main.py`, which the wave plan adds; the phase that creates them adds their rows.
