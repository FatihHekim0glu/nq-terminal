# nq-lab terminal

A local, read-only research terminal for the nq-lab NautilusTrader research. One keyboard-driven screen shows the
pre-registered hypotheses and the backtest runs with their analytics. It also shows the out-of-sample audit trail
and the paper book's journals.

The terminal never places, modifies or cancels an order. It has no order path, and tests fail if one appears.

## Contents of this folder

| Folder | What it holds |
|---|---|
| `backend/` | The FastAPI package `nq_terminal` and its tests. It binds to 127.0.0.1 only |
| `web/` | The front end (React 19 on Vite, in TypeScript): a command line over dockable panels |
| `qa/` | An independent cross-check that recomputes the headline analytics with reference libraries; it never imports the backend |
| `contract/openapi.json` | The API contract. The front end's types are generated from it, and both sides test that they still match it |
| `docs/` | The design notes: `PRD.md`, `ARCHITECTURE.md`, `UI_SPEC.md`, `ANALYTICS_CATALOG.md`, the look spec `BLOOMBERG_LOOK.md` and the build plan `TASKS.md` |
| `start.ps1` | The one start command |

## What it needs

The folder sits at `nq-lab\terminal`. The backend runs in the nq-lab virtual environment (`nq-lab\.venv`), which
provides `nq_lab`, `nautilus_trader`, FastAPI and uvicorn. It reads the research files next to it: results, specs,
journals and the processed data, which are not in this repository.

For the front end you need Node 24 and pnpm 11. The cross-check needs uv, which builds its own environment in
`terminal\qa` and never touches `nq-lab\.venv`.

## Start it

From the `nq-lab` folder, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1
```

The script checks that the venv imports FastAPI and uvicorn. When `web\dist` is older than the front-end sources it
rebuilds it (`pnpm install --frozen-lockfile`, then `pnpm build`). It then starts the backend on
http://127.0.0.1:8765 and opens the browser once `/api/health` answers. Ctrl+C stops everything it started. If the
terminal already answers on that port, the script opens the browser on it and starts nothing.

Options:

| Option | Effect |
|---|---|
| `-Port 8790` | Serve on another loopback port (default 8765) |
| `-NoBrowser` | Do not open the browser |
| `-NoBuild` | Serve `web\dist` as it is, even when it is older than the sources |
| `-DryRun` | Print the plan (paths, commands, port, build decision) and start nothing |
| `-Dev` | Front-end work: the backend under `uvicorn --reload` on 8765, plus the Vite dev server on 127.0.0.1:5173 with `/api` proxied to it. Port 8765 must be free, so stop the normal server first |

To see what the script would do without starting anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1 -DryRun
```

**Fixture mode** points the backend at the small test files in `backend\tests\fixtures` instead of the research
files. Nothing there is a price source, so the chart and market screens answer 503; every other screen works.

```powershell
$env:NQT_FIXTURE_DIR = "$PWD\terminal\backend\tests\fixtures"
powershell -NoProfile -ExecutionPolicy Bypass -File terminal\start.ps1 -Port 8790
Remove-Item Env:NQT_FIXTURE_DIR
```

In the browser, type a function code in the command line and press Enter (`<GO>`). `HELP <GO>` lists every function
and key. The P0 functions are `HOME`, `REG`, `MT`, `DES`, `RUNS`, `RUN`, `LEDG`, the analytics tabs `EQ`, `DD`,
`RET`, `RR` and `MRET`, the charts `GP` and `GIP`, the market screens `MON` and `CORR`, and `OOS`, `LIVE` and
`JRNL`. A context goes before the code, for example `NQ1 Index GP`, `volmanaged_v0 DES` or `27F CORR`.

## Test it

From the `nq-lab` folder, in PowerShell:

```powershell
# Backend (it also writes the JSON dumps the cross-check reads, into terminal\qa\.dumps)
& .venv\Scripts\python.exe -m pytest -p no:warnings -o addopts="" -q terminal\backend\tests

# Independent cross-check: its own tests, then every dumped value against the reference libraries
uv run --project terminal\qa python -m pytest -q terminal\qa\tests
uv run --project terminal\qa python -m crosscheck --strict

# Front end: the contract check with the unit tests, the type check and a production build
pnpm --dir terminal\web test
pnpm --dir terminal\web test:types
pnpm --dir terminal\web build
```

The Playwright tests start their own fixture backend and a preview server on two spare loopback ports (8795 and
4273 by default). Nothing they do reaches the research files or the real audit log. Choose other ports when those
are taken; port 8765 is refused:

```powershell
$env:NQT_E2E_API_PORT = "8796"; $env:NQT_E2E_WEB_PORT = "4274"
pnpm --dir terminal\web e2e
Remove-Item Env:NQT_E2E_API_PORT, Env:NQT_E2E_WEB_PORT
```

The first run on a new machine needs the browser: `pnpm --dir terminal\web exec playwright install chromium`.

When the backend's API changes on purpose, regenerate the contract and the front-end types together:

```powershell
$env:NQT_UPDATE_CONTRACT = "1"
& .venv\Scripts\python.exe -m pytest -p no:warnings -o addopts="" -q terminal\backend\tests\test_openapi_contract.py
Remove-Item Env:NQT_UPDATE_CONTRACT
pnpm --dir terminal\web gen:api
```

User-facing text lives in `web\src\copy\`. A unit test there checks every copy module for em and en dashes and US
spellings, and another fails if a screen or chrome file holds a prose string of its own.

## Safety model

The research rules of nq-lab (the nq-lab project rules) bind the backend, and the terminal is built so that it cannot
break them.

- **Read only.** Every route is GET; a test pins the route set and fails on any other method. A syntax-tree scan
  bans write calls anywhere in the backend. The ledger is never written: for an eligible run, RUN shows the
  `scripts\ledger_append.py` command for you to copy and run yourself.
- **One door to prices.** Every price read goes through `nq_lab.data.serve` with caller `terminal`, so the OOS gate
  decides and logs each read. `serve_sealed` is never called, and nothing after 2021-12-31 is served. The same
  scan bans direct parquet reads. Prices are cached in memory by calendar year, never on disk, so a normal
  session adds a handful of lines to `results\oos_access_log.jsonl`, each with caller `terminal`.
- **No order path.** No IB client exists in the terminal. A scan bans IB order calls across `terminal\`, and the
  browser tests assert that every request is a GET and that no route or component is named like an order action.
- **Local only.** The server binds 127.0.0.1 in code and refuses a peer that is not loopback. It accepts only the
  hosts 127.0.0.1 and localhost and has no CORS. A same-origin guard stops another page from triggering gate reads.
  Every response sends a strict content security policy and refuses framing.
- **No private data out.** Error bodies and served research files carry no local paths. Account ids are masked, and
  environment values are reported as set or unset.
- **Honesty on screen.** Values the terminal computes carry `[POST HOC]`; values read from a registered result
  carry `[PRE-REG]`. Sealed results show as a spent window. Plumbing rows keep the paper book's banner and never
  feed a performance chart, and a run whose balance check fails is marked unusable and not drawn.
- **Tests leave the research alone.** During the backend tests an audit hook refuses any write, removal or rename
  under `results\`, `backtests\output\`, `data\` or `live\`. A session fixture hashes `oos_access_log.jsonl`,
  `ledger.csv`, `registry.csv` and `oos_openings.json` before and after. Tests that touch the gate use a fake
  serve with a temporary log.

## Decisions

The full log is `docs/PRD.md` section 7, with later decisions in `docs/ARCHITECTURE.md` section 4 and the look
spec section 7. The ones that shape daily use:

- **One origin.** uvicorn on 127.0.0.1:8765 serves both the built front end and `/api`. The Vite server runs only in
  `-Dev` mode.
- **In-memory price cache.** A copy of prices on disk would be an ungated copy, so there is none.
- **Own analytics first.** The metrics are the terminal's own numpy and pandas functions. Nautilus statistics are a
  second implementation in the tests, and the `qa` project's reference libraries are a third. Nautilus's alpha and
  tear sheet are not used for any number on screen.
- **Two return bases, always named.** Basis A is a research screen's own series; Basis B is a Nautilus account.
  Every tile and chart names its basis and unit.
- **Counts from files.** Registry counts and verdicts, with the adjusted p values, come from `results\registry.csv` at run
  time, never from the code.
- **Real fills beside their own strategy.** The quote-check sample shows on za_orb runs only, and the paper book's
  close rows on volmanaged runs only.
- **Reduced templates.** Where the look spec asks for something the API does not send, a screen shows less and says
  so. The list is in the look spec section 7.
- **Grids and live data.** P0 grids are TanStack Table with virtual rows, and the live screens poll every 2 s. A
  Perspective viewer and server-sent events come in P1. A backtest queue and a read-only IB snapshot are P2 and
  wait for your decision.
