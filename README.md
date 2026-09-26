# nq-lab terminal

A local, read-only research terminal for the nq-lab NautilusTrader research. It shows the pre-registered
hypotheses, backtest runs, analytics, the out-of-sample audit trail and the paper book's journals in one
keyboard-driven screen.

It has four parts:

- `backend/`: a FastAPI package (`nq_terminal`) and its tests. It binds to 127.0.0.1 only.
- `web/`: a React and Vite front end with a command line and dockable panels.
- `qa/`: an independent cross-check that recomputes the headline analytics with reference libraries and never
  imports the backend.
- `contract/openapi.json`: the API contract. The front end's types are generated from it, and both sides test
  that they still match it.

Design notes live in `docs/`.

## What it needs

The terminal reads the nq-lab research package (`nq_lab`), its results, specs, journals and processed data.
None of that is in this repository. The folder is expected to sit at `nq-lab/terminal`, and the backend runs in
the nq-lab virtual environment, which provides `nq_lab`, `nautilus_trader`, FastAPI and uvicorn. Every price read
goes through the nq-lab out-of-sample gate.

The terminal never places, modifies or cancels orders. It has no order path, and a test fails if one appears.

## Run it

From the `nq-lab` folder, in PowerShell:

```powershell
# Build the front end (served by the backend from web/dist)
pnpm --dir terminal\web install --frozen-lockfile
pnpm --dir terminal\web build

# Start the backend on http://127.0.0.1:8765 (set NQT_PORT to change the port)
cd terminal\backend
& ..\..\.venv\Scripts\python.exe -m nq_terminal
```

For front-end work, `pnpm --dir terminal\web dev` runs Vite with `/api` proxied to the backend.

Fixture mode points the backend at `backend/tests/fixtures/` instead of the real research files: set
`NQT_FIXTURE_DIR` to that folder. The end-to-end tests use it, so they never touch the real audit log.

## Test it

From the `nq-lab` folder:

```powershell
# Backend
& .venv\Scripts\python.exe -m pytest -p no:warnings -o addopts="" -q terminal\backend\tests

# Front end: unit tests (with the contract check) and type checks
pnpm --dir terminal\web test
pnpm --dir terminal\web test:types

# Independent cross-check (reads the JSON dumps the backend tests write to qa/.dumps)
uv run --project terminal\qa python -m pytest -q
uv run --project terminal\qa python -m crosscheck
```

If the backend's API changes on purpose, regenerate the contract and the front-end types together:
set `NQT_UPDATE_CONTRACT=1` for one backend test run, then run `pnpm --dir terminal\web gen:api`.
