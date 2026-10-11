# Wave w2a, slice supply-chain: note

Branch `v04/w2a-supply-chain`, worktree `E:/projects/nq-lab/wt-w2a`, written 11 October 2026. This slice adds the weekly
supply-chain workflow and its scanner, a manual CodeQL workflow, the two dependency bumps that clear the known advisories,
and the coverage tooling for the web tests. It builds, signs and publishes nothing.

## What changed

| File | Kind | Fate (for the 03 Appendix A addendum) |
|---|---|---|
| `.github/workflows/supply-chain.yml` | new workflow | kept. Weekly (Monday 05:23 UTC), on dispatch, and on push limited to four paths. Four jobs on `ubuntu-24.04`: `rust`, `web`, `qa`, `osv`. |
| `.github/workflows/codeql.yml` | new workflow | kept, dispatch only until the owner's go (O20). One job, three languages as a matrix, `security-events: write` on that job alone. |
| `scripts/osv_scan.mjs` | new script | kept. Reads the three lock files, asks api.osv.dev, exits 0, 1 or 2. Plain Node 24, no dependency. |
| `scripts/tests/osv_scan.test.mjs` | new test | kept. 20 cases, no network. |
| `desktop/harness/tests/supply-chain-workflow.test.mjs` | new test | kept. 15 cases. Runs in CI through the existing harness glob. It also guards the "Scanner tests" step of the `osv` job. |
| `web/package.json` | edited | `@vitest/coverage-v8` 5.0.2 (devDependency) and the script `test:coverage`. |
| `web/pnpm-lock.yaml` | edited | `postcss` 8.5.28 to 8.5.29, `source-map-js` 1.2.1 to 1.2.2, plus the coverage package and ten small dependencies it needs. |
| `qa/pyproject.toml`, `qa/uv.lock` | edited | `pytest` 9.0.2 to 9.0.3. |
| `docs/desktop/v04/w2a-supply-chain__supply-chain.md` | this note | kept. |

No module, route or backend file was added. Nothing outside the owned list was edited.

## The workflow, job by job

Rules kept, and enforced by the pin test: top-level `permissions: contents: read` and no write anywhere in
`supply-chain.yml`; every action pinned by its full SHA with its release in a comment; every tool pinned to an exact
version; checkout with `persist-credentials: false`; a timeout on every job; no `continue-on-error`, no `|| true`;
bash with `pipefail` as the default shell; `fallback: none` on the tool installer so a missing prebuilt binary fails the
job instead of building unpinned sources. No dependency is installed in any job (no lifecycle script of a package runs):
`pnpm audit` and `pnpm sbom --lockfile-only` read `pnpm-lock.yaml`, cargo reads `Cargo.lock`, `uv export` reads `uv.lock`.

| Job | Steps, in order | Artefact |
|---|---|---|
| `rust` | pinned toolchain from `rust-toolchain.toml`; install cargo-deny 0.20.2, cargo-audit 0.22.2, cargo-cyclonedx 0.5.9; Cargo SBOM (CycloneDX 1.5, target `x86_64-pc-windows-gnu`, the shipped build); upload; `cargo deny --locked check`; `cargo audit` | `sbom-cargo` |
| `web` | pnpm and Node 24; npm SBOM (`pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.5 --sbom-type application --lockfile-only --prod`); upload; `pnpm audit --prod --audit-level high` | `sbom-npm` |
| `qa` | Python 3.12; uv 0.10.2; pip-audit 2.10.1; QA SBOM (`uv export --format cyclonedx1.5`); upload; `pip-audit` over a hashed `uv export` of the lock with `--disable-pip --strict` | `sbom-qa` |
| `osv` | Node 24; `node scripts/osv_scan.mjs --out ...`; upload of the report | `osv-report` |

The SBOM step and its upload come before the audit step in each job, so a failed audit still leaves the SBOM.
Each SBOM is checked with `jq -e` (CycloneDX, at least one component) so an empty file cannot pass.

Why the push trigger. A schedule or dispatch trigger runs only from the default branch, so a workflow added on a branch
would not run before it is merged. The push trigger, limited to the workflow file and the three lock files, gives the
first run on this branch and re-checks the graphs whenever a lock file moves.

Cargo SBOM tool: cargo-cyclonedx, not cargo-sbom. It writes CycloneDX like `pnpm sbom` and `uv export` do, so all
three SBOMs share one format and one validation line; it ships prebuilt binaries whose SHA-256 the installer action
checks. Local copy for the checks of this wave:

| Item | Value |
|---|---|
| Installed at | `D:/dev/cargo/bin/cargo-cyclonedx.exe` |
| Version | 0.5.9 |
| Release archive | `cargo-cyclonedx-x86_64-pc-windows-msvc.zip`, SHA-256 `8750e00775661dcb75bc482c1a298839fd94e8a0c033b49905ba0f246ffed202` (equals the hash in the installer action's manifest) |
| Executable | SHA-256 `4715a01af8fa7b5fb8bfc211ebffdadcfdaf75f21528e41e8baee95ad87d4808` |

## Scanner: scripts/osv_scan.mjs

Reads `web/pnpm-lock.yaml`, `desktop/src-tauri/Cargo.lock` and `qa/uv.lock`; keeps registry packages only (a git, path,
tarball or private-index entry is left out); asks `POST /v1/querybatch` (500 per request, a second page is followed) and
`GET /v1/vulns/{id}` for the records; skips withdrawn records. Exit 0 when nothing is rated at the threshold (default
HIGH), 1 when something is, 2 when the scan could not be completed.

What leaves the PC: the ecosystem, the package name and the version of public packages, and advisory ids asked back.
Nothing else. Any name or npm scope that starts with `nq` is a lab package: it is dropped when the lock is read
and `buildBatch` refuses a request that still holds one (two guards). The report counts withheld packages and names none, so
the artefact on a public repository carries no lab name. A public package whose name starts with `nq` would be withheld
too; that is the safe side, and the count shows it.

Failure behaviour, each with a test: a missing lock, a lock that parses to no package, a server error after three tries,
a short batch answer, an API address that is not https (a local test server is allowed) all exit 2. Severity comes from
the record's own label, then a CVSS 3 base score computed from the vector, then a CVSS 4.0 vector (HIGH, or LOW when it names no
impact; a conservative reading, not a v4 scorer), otherwise `UNRATED`. An OpenSSF malicious-package record (`MAL-` id) is always
CRITICAL, so it fails the scan at every `--fail-on`. Unrated records (many RUSTSEC entries) are listed, counted in the output
line, the closing line and the JSON report, and do not fail the scan by default; `--fail-on-unrated` makes them fail, and
`--fail-on moderate` tightens the threshold. The workflow does not pass `--fail-on-unrated`: it would turn the weekly job red on
the two unrated crates.io records until someone reviews them.

Result on today's tree (real OSV, 11 October): npm 0 advisories, PyPI 0, crates.io 3 records for two crates that only the
non-Windows part of `Cargo.lock` pulls in (`glib` 0.18.5 unsound, `proc-macro-error` 1.0.4 unmaintained), none at HIGH.

## Bumps

| Advisory | Before | After | How |
|---|---|---|---|
| GHSA-68fv-2mgg-jv7q, `source-map-js`, HIGH, fixed in 1.2.2 | 1.2.1 via `postcss` 8.5.28 and `@tailwindcss/node` 4.3.3 | `source-map-js` 1.2.2, `postcss` 8.5.29 | `pnpm update source-map-js postcss --lockfile-only` |
| GHSA-6w46-j5rx-g56g, `pytest`, MODERATE, fixed in 9.0.3 | 9.0.2 | 9.0.3 | `qa/pyproject.toml` pin, `uv lock` (one package updated) |

Deviation from the task text, said plainly. `@tailwindcss/vite` and `tailwindcss` are already at their latest release
(4.3.3), and `postcss` is not a direct dependency, so `package.json` needed no change for them. `@tailwindcss/node` 4.3.3
asks for `source-map-js ^1.2.1`, which allows 1.2.2; `postcss` 8.5.29 asks for `^1.2.2`. Re-resolving the two names in the lock
is therefore the whole fix, and it needed no override. `pnpm-workspace.yaml` (`minimumReleaseAge` default, one exclusion)
is untouched. `engine-strict` is on in that file; the lock commands ran with `--config.engine-strict=false` only because
this PC has Node 24.13 where `jsdom` asks for 24.15 or newer. The hosted runner's Node 24 satisfies it.

`@vitest/coverage-v8` 5.0.2 is the exact version of `vitest` 5.0.2 (its peer is pinned to that version).

fsspec in the lab venv (2026.2.0, GHSA-27vj-qcqg-25rc, HIGH, fixed in 2026.6.0) is the owner's. Reported, not touched.
It is not in the `qa` or the `web` lock.

## Born-failing evidence

First run of each new test file, before its subject existed, in `D:/dev/v04/w2a-supply-chain/`:

- `osv_born_failing_1.txt`: `ERR_MODULE_NOT_FOUND` for `scripts/osv_scan.mjs`, 1 test file failed.
- `workflow_born_failing_1.txt`: `ENOENT` for `.github/workflows/supply-chain.yml`, 1 test file failed.

Mutation runs after the implementation (the guard's code removed or the workflow broken, the test must fail), in
`osv_mutations.txt` and `workflow_mutations.txt`:

| Broken state | Tests that fail |
|---|---|
| scanner: lab filter at read and the guard at build both removed | `a request never carries a lab package name`, `an nq* name never leaves the PC` |
| scanner: guard at build only removed | `a request never carries a lab package name` (the read filter still holds) |
| scanner: verdict never fails | 4 tests, among them `a planted vulnerable version is reported and fails the scan` |
| scanner: findings never collected | 5 tests |
| scanner: short answer accepted | `a short answer from the server fails the scan` |
| workflow: one action pinned by a tag | `supply-chain.yml keeps every rule`, `every workflow in the folder pins its actions by full SHA` |
| workflow: push path `qa/uv.lock` removed | `supply-chain.yml keeps every rule`, `the push trigger names the four paths ...` |
| workflow: `contents: write` added to a job | `supply-chain.yml keeps every rule`, `CodeQL covers ... holds the only write scope` |
| codeql: a push trigger added | `codeql.yml keeps every rule` |
| codeql: `contents: write` added to its job | `codeql.yml keeps every rule` |
| workflow: `continue-on-error` on cargo audit | `supply-chain.yml keeps every rule` |

The workflow test also feeds each guard a broken text in its own cases (a tag, a branch, a short SHA, a local action as
a pin; `write-all`, a top-level write, a second job in CodeQL; each push path removed; a push filter named `branches`;
a loose tool version; `fallback` other than `none`; `pip-audit>=`; a checkout that keeps the token). One of these cases
found a real hole in the first version of the `fallback` check (it passed when only one of two install steps lacked
`fallback: none`); the check now looks at every install step.

Regression guards, not born failing on today's tree: `every workflow in the folder pins its actions by full SHA` (it
guards `ci.yml` as well, which already pins), `the real lock files of this tree parse to packages` (needs the three
locks to exist).

## Commands run and results

| Command | Result |
|---|---|
| `node --test scripts/tests/osv_scan.test.mjs desktop/harness/tests/supply-chain-workflow.test.mjs` | 31 tests, 31 pass |
| `node --test` on `ci-workflow.test.mjs` and `ci-rust-job.test.mjs` as well | 1 failure, not from this slice and not fixable inside this wave: `scripts/tests/record_green.tests.ps1` (the coverage slice's file) is not run by `ci.yml`, which wave w2b owns; the exact lines to add are under "Wiring for the merge step" |
| `actionlint.exe` 1.7.12 over `.github/workflows/*.yml` | clean |
| `node scripts/osv_scan.mjs` against the real api.osv.dev | exit 0, see above |
| `cargo deny --locked check` in `desktop/src-tauri` | advisories ok, bans ok, licenses ok, sources ok |
| `cargo audit` | exit 0, 474 crates, 2 allowed warnings (the two non-Windows crates) |
| `cargo cyclonedx ...` as in the workflow | exit 0, CycloneDX 1.5, 262 components |
| `pnpm sbom ... --lockfile-only --prod` as in the workflow | CycloneDX 1.5, 116 components |
| `uv export --frozen --format cyclonedx1.5` | CycloneDX 1.5, 50 components |
| `pip-audit` over the hashed export | no known vulnerabilities; a planted `pytest==9.0.2` exits 1 and names PYSEC-2026-1845 |
| `pnpm audit --prod --audit-level high` | no known vulnerabilities |

Run in a scratch copy of the tree on D: (`D:/dev/v04/w2a-supply-chain/verify/terminal`, a copy, so the shared
`node_modules` junction of the main tree was never written; HEAVY slot held and released):

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | passes, so `package.json` and the lock agree |
| `pnpm test:types`, `pnpm test:e2e-types`, `pnpm check:api` | all pass |
| vitest, CI configuration (the three lab-only tests left out), with `pnpm test:coverage` | 521 files, 7,798 tests passed, 52 skipped, 0 failed; 185 s under load |
| coverage (v8, default configuration, files the tests load) | statements 92.82%, branches 86.59%, functions 91.67%, lines 94.46% |
| `pnpm build` | passes; bundle budgets: shell 110.0 of 115.0 kB gzip, perspective 86.1 of 100.0, echarts 201.6 of 230.0 |
| `uv run --frozen pytest` in `qa` (environment on D:) | 333 passed, pytest 9.0.3 |

## Wiring for the merge step (files this slice does not own)

`.github/workflows/ci.yml` and `docs/desktop/ci.md` belong to wave w2b-ci-msvc, so this branch leaves both exactly as they
are at `16f56ec`. The scanner's tests no longer need `ci.yml`: the `osv` job of `supply-chain.yml` runs
`node --test scripts/tests/*.test.mjs` before the scan (step "Scanner tests"), and `supply-chain-workflow.test.mjs` fails when
that step is missing, narrowed, skips a test by name or runs after the scan. Two edits remain for the merge, both made on top of
the w2b version of the files:

1. `.github/workflows/ci.yml`, the "Release script self-tests" step: add these two lines after the `smoke_real.tests.ps1`
   pair. `desktop/harness/tests/ci-workflow.test.mjs` fails ("every PowerShell release-script test file is run by a step ...")
   until they are there, because the coverage slice's `scripts/tests/record_green.tests.ps1` is a release-script self-test.

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\record_green.tests.ps1
   if ($LASTEXITCODE -ne 0) { throw "record_green.tests.ps1 exit $LASTEXITCODE" }
   ```

2. `docs/desktop/ci.md`: in the "Release script self-tests" row add `scripts/tests/record_green.tests.ps1` (the `-Coverage`
   switch, against scratch trees under `D:\dev\tmp`) after `smoke_real.tests.ps1`; add the two sections below
   before "Rules the workflow keeps"; and replace the first sentence under that heading with the one that follows them.

```markdown
## The supply-chain workflow

`.github/workflows/supply-chain.yml` (grade G-06) watches the three dependency graphs this repository owns and makes an SBOM of each. It runs every Monday at 05:23 UTC, on dispatch, and on a push that touches the workflow file or one of the three lock files (`web/pnpm-lock.yaml`, `desktop/src-tauri/Cargo.lock`, `qa/uv.lock`). The push trigger is there because a schedule or dispatch trigger runs only from the default branch, so a workflow added on a branch would otherwise not run before it is merged; it also re-checks the graphs whenever a lock file moves. Four jobs on `ubuntu-24.04`, none of which installs a dependency (so no lifecycle script of a package runs):

| Job | What it runs | Artefact kept 90 days |
|---|---|---|
| `rust` | the pinned toolchain; `cargo cyclonedx` (CycloneDX 1.5, target `x86_64-pc-windows-gnu`, the shipped build); `cargo deny --locked check`; `cargo audit` | `sbom-cargo` |
| `web` | `pnpm sbom --sbom-format cyclonedx --lockfile-only --prod`; `pnpm audit --prod --audit-level high` | `sbom-npm` |
| `qa` | `uv export` to CycloneDX 1.5; `pip-audit` over a hashed `uv export` of the lock, with `--strict` | `sbom-qa` |
| `osv` | `node --test scripts/tests/*.test.mjs` (the scanner's own tests, fixture answers, no network), then `node scripts/osv_scan.mjs`: every registry package of the three locks against api.osv.dev | `osv-report` |

Each SBOM step and its upload come before the audit step of the same job, so a failed audit still leaves the SBOM. Every tool is pinned to an exact version (cargo-deny 0.20.2, cargo-audit 0.22.2, cargo-cyclonedx 0.5.9, uv 0.10.2, pip-audit 2.10.1) and installed with `fallback: none`, so a version without a prebuilt binary fails the job instead of being compiled from unpinned sources. A job fails on a vulnerability, on a scan that could not be completed and on an empty SBOM. No step carries `continue-on-error` or `|| true`.

`scripts/osv_scan.mjs` sends api.osv.dev only the ecosystem, and the name with the version, of public packages. A name or npm scope that starts with `nq` is a lab package and is dropped when the lock is read, and the request builder refuses one that is still there. The report counts the packages it withheld and names none. Exit 0 is clean at the threshold (HIGH by default), 1 is an advisory at or above it, 2 is a scan that could not be completed. Severity comes from the record's label, then a CVSS 3 score, then a CVSS 4.0 vector (read as HIGH unless it names no impact); an OpenSSF malicious-package record (`MAL-`) is always CRITICAL. Records with no severity at all (many RUSTSEC entries) are listed, counted in the closing line and not gating, unless `--fail-on-unrated` is given.

`desktop/harness/tests/supply-chain-workflow.test.mjs` reads both new workflows as text and fails on an unpinned action, a write permission outside the CodeQL job, a missing push path, a loose tool version, a hidden failure and a missing scanner-tests step in the `osv` job. Check both files with `actionlint` as under "Checking the workflow locally".

## The CodeQL workflow

`.github/workflows/codeql.yml` analyses `javascript-typescript`, `python` and `actions` (a matrix of three, `build-mode: none`, so nothing is built or installed). It is `workflow_dispatch` only, and stays so until the owner's go (decision O20). Its one job holds `security-events: write`, which is the only write scope in the two new workflows and the only departure from the read-only rule below; the top level of the file is `contents: read`. Moving it to a push, pull-request or schedule trigger is a separate change that updates `supply-chain-workflow.test.mjs` and this page together.
```

Replacement for the first line under "Rules the workflow keeps":

```markdown
These follow decision C3-2 and the supply-chain notes of the release research. They hold for `ci.yml` and `supply-chain.yml`; `codeql.yml` keeps them except for the one scope named above.
```

3. `web/vite.config.ts` (test-speed slice): `test:coverage` works with the defaults, but the report counts only the
   files the tests load. A `test.coverage.include` of `src/**` would count untested files too; that choice is the
   coverage slice's.
4. Post-merge, in the main tree, with the 0.3.3 finisher not using `node_modules`: `pnpm --dir web install --frozen-lockfile`
   so the main tree's `node_modules` gets `@vitest/coverage-v8`, `postcss` 8.5.29 and `source-map-js` 1.2.2. Until then
   `pnpm test:coverage` fails there with a missing provider. For the QA project, `uv sync --frozen` in `qa` (or the first
   `uv run --frozen pytest`) picks up pytest 9.0.3.

## Not done or not verified

- The workflows have not run on GitHub. Each command was run locally as written, but not on `ubuntu-24.04`: the `jq`
  checks, `rustup toolchain install` on the hosted image, and the installer action's use of `fallback: none` are
  untried there. The first run on the pushed branch is the proof.
- `pnpm audit` and `pip-audit` call the npm registry and PyPI; a registry outage fails the job (that is intended).
- pip-audit's own dependencies are resolved when the tool is installed and are not hash-locked; the tool is the only
  thing that job installs.
- Dependabot alerts, secret scanning and branch protection are owner settings and were not touched.
- CodeQL has not run; it needs the owner's go, and a first dispatch will show whether `build-mode: none` suits the
  `actions` language on this repository.
- The coverage figure above is the web baseline with default settings; the backend baseline and `docs/TESTING.md`
  belong to the coverage slice and the merge step.
