# Contributing

Thank you for looking at this project. The terminal is a personal research tool that is shared publicly. Contributions
are welcome, and they are reviewed by one maintainer ([@FatihHekim0glu](https://github.com/FatihHekim0glu)), so a
review can take a while. Small, focused pull requests get a faster answer than large ones.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For the licence, see [LICENSE](LICENSE).

## Before you start

- **Bugs and ideas.** Open an issue with the form that fits. For a larger change, open an issue first and say what you
  want to change, so that a pull request does not arrive for something the project will not take.
- **Security problems.** Do not open a public issue. Follow [SECURITY.md](SECURITY.md), which uses GitHub's private
  vulnerability reporting under the Security tab.
- **Questions about how something works.** Start with the [README](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
  [docs/UI_SPEC.md](docs/UI_SPEC.md) and [docs/TESTING.md](docs/TESTING.md).

## What this project is, and what it never does

These rules are the project's own, and a pull request that breaks one will not be merged.

1. **It is read only.** The terminal never places, modifies or cancels an order and never connects to a real broker.
   There is no order path and none may be added, not behind a flag, not "for later". The only writes the backend
   serves are four: the two backtest queue routes, `POST /api/jobs` and `DELETE /api/jobs/{job_id}`, the launch action,
   `POST /api/jobs/actions`, and the workspace store, `PUT /api/workspaces/{doc}`. A syntax-tree test
   ([`backend/tests/test_safety_ast.py`](backend/tests/test_safety_ast.py)) scans the code for write calls, order-style
   names and direct file reads of prices, and the browser safety spec
   ([`web/e2e/flows/safety.spec.ts`](web/e2e/flows/safety.spec.ts)) checks that every request is a GET apart from those
   three. Do not edit those tests to make a change pass. If you think a rule in them is wrong, open an issue.
2. **Prices come through the data gate, and never past its date fence.** Every price read goes through
   `nq_lab.data.serve` with caller `terminal`, and nothing after 2021-12-31 is served. Do not read parquet files
   directly, do not add a second way to reach prices, and do not widen the window.
3. **Local only.** The server binds 127.0.0.1 and every `/api` path is behind the session token. Do not loosen that.
4. **LF line endings.** The repository stores bytes as they are (`.gitattributes` has `* -text`), so a file saved
   with CRLF shows up as a whole-file change. [`.editorconfig`](.editorconfig) asks for LF, and tests enforce it
   (`backend/tests/test_line_endings.py`, `web/scripts/lineEndings.test.ts`).
5. **No em or en dashes in user-facing copy, and UK spelling.** User-facing text lives in `web/src/copy/`. A unit test
   there checks every copy module for em dashes, en dashes and US spellings, and another fails when a screen or chrome
   file holds a prose string of its own. Write new text in that folder. Use a comma, a colon, brackets or a new
   sentence instead of a dash. Write documentation in the same style.
6. **WCAG 2.2 AA.** The target is WCAG 2.2 AA (see section 9 of [docs/UI_SPEC.md](docs/UI_SPEC.md)). Every
   interactive element works from the keyboard, text pairs hold 4.5:1 and graphic pairs 3:1
   (`web/src/theme/contrast.test.ts`), and a canvas chart carries a data summary and a table view. The Playwright
   specs run axe, and a new screen or control needs to pass it.
7. **The contract is pinned.** `contract/openapi.json` is compared with the app's own OpenAPI document, and the
   front end's API types are generated from it. When the API changes on purpose, regenerate both together (see
   [Changing the API](#changing-the-api)).

## Set up

You need Node 24 or later and pnpm 11 through corepack (`web/.nvmrc` says 24, and `web/package.json` sets
`engines`). Corepack may ask once to download pnpm 11.5.1.

From the repository folder:

```sh
corepack pnpm --dir web install
corepack pnpm --dir web demo
```

Open http://127.0.0.1:5174. This is the demo: it needs no backend, no Python and no research files, and it is enough
for most front-end work. On macOS or Linux, `./start.sh --demo` does the same and `./start.sh doctor` says what your
machine can run. On Windows, [`start.ps1`](start.ps1) starts the full terminal; its options are in the README.

The backend needs the research project this terminal belongs to. The folder sits at `nq-lab\terminal`, and the backend
runs in the research project's virtual environment (`nq-lab\.venv`), which provides `nq_lab`, `nautilus_trader`,
FastAPI and uvicorn. That project and its data are not in this repository, so a contributor without it can work on
the front end, the demo, the documentation and the cross-check, and the maintainer runs the backend suites on the pull
request. Say in your pull request which suites you could not run.

The cross-check (`qa/`) needs [uv](https://docs.astral.sh/uv/), which builds its own environment there and never
touches the research project's.

The desktop app (`desktop/`) is a Tauri shell for Windows. Working on it needs the Rust toolchain that
`desktop/src-tauri/rust-toolchain.toml` pins, and [`desktop/README.md`](desktop/README.md) says how it is built.

## Branches and commits

- **Branch.** Branch from `main` and name the branch `<type>/<topic>`, for example `fix/ledger-empty-state` or
  `docs/readme-install`. Keep one change to a branch.
- **Commit messages.** Use a conventional type, an optional scope in brackets, a colon and a short lower-case summary
  with no full stop: `feat: ...`, `fix: ...`, `docs: ...`, `perf: ...`, `test: ...`, `refactor: ...`, `chore: ...`.
  The history has scoped forms too, such as `fix(workspace): ...`, `feat(demo): ...` and `test(e2e): ...`. Add a body
  when the reason is not obvious from the subject.
- **Commit messages are plain text about the change.** Do not add tooling or attribution trailers, and no generated
  boilerplate.
- **Pull requests.** Target `main`. Keep the diff to what the title says, and do not mix a refactor with a fix.

## Tests first

Write the test that fails for the right reason before you change the code, then make it pass, then tidy. A bug fix
comes with a test that fails without it. A new screen, route or analytic comes with tests at the level it lives at: a
Vitest test for a view model or a component, a pytest test for a backend service or route, a Playwright spec for a
flow that crosses them. Born-failing tests (a test that plants the fault it guards against and shows it is caught) are
the project's habit for the safety and drift checks. Follow it there.

Backend tests reach the app only through the shared client in `backend/tests/conftest.py` (`api_client(app)` or the
`authed_client` fixture), because every `/api` path is behind a session cookie. Do not build a `TestClient` yourself.
No test may connect to a real TWS or Gateway.

## What must pass before a pull request

Run the suites that your change can affect, and run them all when you are unsure. Every command below is from the
repository folder unless it says otherwise. [docs/TESTING.md](docs/TESTING.md) describes each suite in full.

| Change | Suites |
|---|---|
| Any front-end change | `corepack pnpm --dir web test` (the contract check, then Vitest), `corepack pnpm --dir web test:types`, `corepack pnpm --dir web build` |
| Any change to a screen, chrome, a chart or a control | The above, plus the Playwright suite that fits your machine: `corepack pnpm --dir web e2e` on Windows against the fixture backend, or `corepack pnpm --dir web e2e:offline` on macOS or Linux, and `corepack pnpm --dir web test:e2e-types` when you touch a spec |
| Any backend change | The backend pytest, the cross-check's tests and the strict cross-check (below) |
| A change to the shell in `desktop/` | `desktop\scripts\check.ps1` (below) |
| A change to `README.md` or the files in `docs/` | `corepack pnpm --dir web test`, which includes the docs drift test (`web/scripts/docsSync.test.ts`) |

First run on a new machine: `corepack pnpm --dir web exec playwright install chromium`.

The backend and cross-check commands run from the research project's folder (`nq-lab`), in PowerShell:

```powershell
# Backend. It also writes the JSON dumps that the cross-check reads, into terminal\qa\.dumps
& .venv\Scripts\python.exe -m pytest -p no:warnings -o addopts="" -q terminal\backend\tests

# Cross-check: its own tests, then every dumped value against the reference libraries
uv run --project terminal\qa python -m pytest -q terminal\qa\tests
uv run --project terminal\qa python -m crosscheck --strict
```

`crosscheck --strict` must report no FAIL. Run it after the backend tests, because it reads the dumps they write.

The desktop check runs the crate's formatting, Clippy, tests, supply-chain and artefact checks. From the repository
folder, in PowerShell:

```powershell
powershell -NoProfile -File desktop\scripts\check.ps1
```

Add `-Web` to run the web checks as well and `-SupplyChainOnly` for the supply-chain steps alone. Its defaults put
the build output and logs on drive D: (`-TargetDir` and `-LogRoot` move them), and the full run takes a while.

Two tests assume the research project's layout and fail outside it: the Vitest test
`web/src/grids/JournalTable.model.test.ts` and, in the cross-check's pytest suite,
`test_the_default_dump_folder_is_under_terminal_qa` in `qa/tests/test_crosscheck_trades.py`. Treat those as known
when you run outside it, and every other failure as yours.

Playwright screenshot baselines depend on the machine's text rendering. Do not commit regenerated Windows baselines
unless the maintainer has asked for them.

## Changing the API

When a backend change alters the API on purpose, regenerate the contract and the front end's types together, from the
research project's folder in PowerShell:

```powershell
$env:NQT_UPDATE_CONTRACT = "1"
& .venv\Scripts\python.exe -m pytest -p no:warnings -o addopts="" -q `
  terminal\backend\tests\test_openapi_contract.py
Remove-Item Env:NQT_UPDATE_CONTRACT
pnpm --dir terminal\web gen:api
```

Commit `contract/openapi.json` and the generated types in the same change as the route. `pnpm test` fails first when
they differ. The route set is pinned as well: a new write route is refused by the tests, by design.

## Code style

- Follow the code around yours. The backend is Python with a 120 column limit; imports are ordered with
  ruff's import rule (`ruff check --select I --fix backend`, with the settings in `backend/ruff.toml`). The front end is TypeScript in strict mode.
- Prefer small files and small functions, and prefer returning a new value to changing one in place.
- Name things for what they hold. Give meaningful numbers a name.
- Handle errors where they happen and say what went wrong in words a user can act on. Never swallow an error.
- Do not leave debugging output or commented-out code in a change.
- Do not commit secrets, tokens, local paths, personal details or the research project's data. Do not add an email
  address anywhere. Contact goes through GitHub.
- Keep documentation to what the repository does. A command, path, script or setting that you write about has to exist,
  and a measured figure needs its source linked.

## Review

One maintainer reviews every pull request, so please keep these in mind.

- A pull request that is small, has its tests and its checklist filled in is the quickest to review.
- You may be asked to split a pull request, to add a test, or to drop a change that breaks a project rule above.
- A change that adds a dependency needs a reason in the description. The desktop shell's supply-chain checks
  (`cargo deny`, `cargo audit`) apply to its crates, and the web lock file is installed with
  `--frozen-lockfile`.
- Be patient and polite. A review comment is about the code. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to
  everyone, the maintainer included.
- The maintainer may close a pull request that does not fit the project, with a reason. That is not a judgement of
  you.

The pull request template lists the checks. Fill it in honestly: a box left empty with a note is better than a box
ticked for a suite that did not run.
