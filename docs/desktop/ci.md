# Continuous integration

The first workflow of this repository is `.github/workflows/ci.yml` (REL-03 of the release research). It runs the checks that need no private lab data, on a hosted Windows runner, for every push and every pull request to `main`. It is a safety net for the web app and the desktop scripts. It builds no installer, signs nothing and publishes nothing.

## What runs

One job, `windows`, on `windows-latest`, with a 30 minute limit. The steps, in order:

| Step | Command (from the repository folder) | What it proves |
|---|---|---|
| Check out | `actions/checkout` into a folder named `terminal` | The tree as pushed. |
| Set up pnpm and Node | `pnpm/action-setup` (version from `web/package.json`), `actions/setup-node` 24 with the pnpm store cached | The pinned toolchain. |
| Prepare scratch folder | creates `D:\dev\tmp` | Some tests write scratch files there. |
| Install | `pnpm install --frozen-lockfile` in `web` | The lockfile is complete and the install is reproducible. |
| Web type checks | `pnpm test:types`, then `pnpm test:e2e-types` | `tsc -b` for the app and the type projects of every end-to-end suite. |
| Contract hash | `pnpm check:api` | The generated API types match `contract/openapi.json`. |
| Vitest | `vitest run`, minus three tests that need the lab (below) | The unit and component suites, about 7,400 tests. |
| Web build | `pnpm build` | `tsc -b`, the Vite build, the bundle budgets and the build stamp. |
| Desktop script tests | `node --test desktop/scripts/tests/*.test.mjs` | The artefact check, the dist scan, the installer hooks and the bootstrapper check. |
| Stand-in lab | `python -m venv` under the runner's temp folder, `NQT_LAB` pointing at it | The harness runs the lab's interpreter for its window watch, a standard-library script. The folder holds no lab data. |
| Desktop harness tests | `node --test desktop/harness/tests/*.test.mjs` | The measurement harness's own tests. |
| Release script self-tests | `scripts/tests/release_check.tests.ps1` and `desktop/scripts/install-test.ps1 -SelfTest` | The born-failing tests of the release scripts. They install nothing. |

The same commands are the local stand-in: `desktop/scripts/check.ps1 -Web` runs the web group and the Rust set on the lab PC.

## What does not run

| Left out | Why |
|---|---|
| The backend suites, the crosscheck and the real-data smoke | The backend imports the private `nq_lab` package, which is not in this repository. |
| `scripts/start/startPs1.test.ts` and `scripts/start/sessionPage.browser.test.ts` | Both start the lab's backend through `start.ps1`. |
| The test "reads src/nq_lab/paper_plumbing.py and finds the same text" in `src/grids/JournalTable.model.test.ts` | It reads a Python source file of the lab. The other tests of that file run. |
| Playwright (`e2e`, `e2e:offline`, `e2e:perf`, `e2e:desktop`) | Browser downloads and timing budgets belong to a quiet machine, not a shared runner. |
| The Rust set, the NSIS build and the install test | Planned as REL-07 (a Rust job with the Cargo registry cached, then the installer built and installed as a standard user). |
| Measurements (gate G2) | They need the owner's PC, alone, in a quiet window. |

The three excluded tests are named in the workflow, so a change that renames them shows up in review. Every other vitest test still runs.

## Rules the workflow keeps

These follow decision C3-2 and the supply-chain notes of the release research.

- `permissions: contents: read` for the whole workflow, and no job widens it.
- No secrets. The workflow reads none and the checkout does not keep the token (`persist-credentials: false`).
- Every action is pinned by its full commit SHA, with the release in a trailing comment. A tag is never used.
- A newer push to the same branch or pull request cancels the run it supersedes (`concurrency` with `cancel-in-progress`).
- Nothing is signed, uploaded or released. The workflow writes only inside the runner.

To move a pin, resolve the new tag to its commit (`gh api repos/<owner>/<name>/git/ref/tags/<tag>`, and for an annotated tag read the tag object once more), change the SHA and the comment together, and run the check below.

## Two things the layout depends on

- The checkout folder is named `terminal`, which is where the lab keeps this tree as `nq-lab/terminal`. The web tests no longer depend on the name (the dev proxy's state folder and the fixture folder of the end-to-end config are checked relative to the tree), but the QA test that expects its folder's parent to be named `terminal` still does, so the workflow keeps the name.
- The scratch tests use `D:\dev\tmp`. The hosted image has a `D:` drive. If it ever has none, the step substitutes the runner's temp folder for it.

## Checking the workflow locally

1. Lint it: `actionlint .github/workflows/ci.yml` (a release build of actionlint is enough; on the lab PC one sits under `D:\dev`). Without it, parse the file with any YAML reader.
2. Run the same commands from a clean copy of the tree named `terminal`, with the lab hidden: set `USERPROFILE` to an empty folder and `NQT_LAB` to a folder holding a plain virtual environment, then run the steps in the table. The `terminal` name matters for the QA test, as above.
3. The tree must be a Git repository: two harness tests and the release script tests read `git rev-parse HEAD`.

## Known limits

- The workflow has not yet run on a hosted runner at the time of writing. Its commands were run locally in the way step 2 describes, on Node 24.13, where the hosted `24` resolves to a later 24.x that `jsdom` requires (`^24.15`).
- `windows-latest` is the Windows Server image, which GitHub moves forward from time to time. A move can change the pre-installed Python or the `D:` drive, and the two steps that depend on them fail with a clear message.
- The shipped installer is still built on the lab PC with the GNU toolchain. This workflow proves the source and the scripts, not the binary.
