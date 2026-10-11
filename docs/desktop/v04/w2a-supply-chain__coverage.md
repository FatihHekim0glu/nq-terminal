# w2a-supply-chain, slice coverage

Grade G-11, metrics rank 2. Coverage is measured once in the backend and recorded; the web figure waits for the dependency
that the supply-chain slice adds. Branch `v04/w2a-supply-chain`, base `16f56ec`.

## What changed

| File | Change |
|---|---|
| `scripts/record_green.ps1` | New `-Coverage` and `-CoverageDir` parameters (backend check only). pytest runs with `--cov=nq_terminal` and a JSON report; the record gains a `coverage` block. |
| `scripts/tests/record_green.tests.ps1` | New. 30 checks of the switch, all against scratch trees under `D:\dev\tmp`. |
| `docs/TESTING.md` | A Coverage section: tools, baselines, the rule, the limits of the figure; one row in the suites table. |
| `docs/desktop/v04/w2a-supply-chain__coverage.md` | This note. |

## How `-Coverage` behaves

- Refused with exit 2, before anything runs or is created: a coverage folder that resolves inside the repository, the stamped
  tree or the lab (plain path, `..`, junction, link; whole path parts, so a sibling that shares a prefix is allowed), and any
  check other than `backend`.
- The data file (`COVERAGE_FILE`, put back afterwards) and `backend.coverage.json` live in `-CoverageDir`, default
  `D:\dev\v04\coverage`. Files named `backend.coverage*` there are deleted before the run, so a stale report is never read.
- A pass whose report is missing, unreadable or without statements writes no record (exit 1).
- The record still names the plain serial pytest command, so `release_check.ps1` accepts it. Its 82 checks still pass.
- The block holds the tool, the source package, percent, files, covered, missing and total statements, a percent per area and
  the report and data file paths. The report is parsed with `JavaScriptSerializer`, because Windows PowerShell 5.1
  `ConvertFrom-Json` refuses the empty property names that coverage.py writes under `classes` and `functions`. This was found
  on the real report, not the fixture; the fixture now has such a key.

## Baseline (backend)

96.54% line coverage, 16,094 of 16,671 statements, 143 files, no branch coverage. 4,950 passed and 9 skipped in 248 s with
`-n 16`. Areas: root 94.49, analytics 96.02, api 96.01, desktop 91.20, models 99.74, services 96.55. The only module of 20 or
more statements under 80% is `desktop/fixture_main.py` (67.3%). The report is
`D:\dev\v04\coverage\backend.coverage.json`; the run log is `D:\dev\v04\w2a-supply-chain\cov_backend_run.log`.

## Tests and born-failing evidence

`powershell -NoProfile -File scripts/tests/record_green.tests.ps1`: before the change (the first draft of the file, 24 checks)
16 failed and 6 passed, and the run then stopped on a missing log file (log:
`D:\dev\v04\w2a-supply-chain\cov_born_failing.log`; `-Coverage` was an unknown parameter, so the 6 passes are regression
guards and cases that pass vacuously); after, 30 passed, 0 failed.

| Born-failing case | Check |
|---|---|
| A `-Coverage` run that would write inside the repository is refused (the slice's named case) | plain path, repository root, `..`, a junction, the real terminal tree: exit 2, nothing run, no folder, no record |
| `-Coverage` with another check | exit 2, nothing run |
| No report after a pass; a stale report; an unreadable report; a report without totals | exit 1, no record |
| A report with empty property names, as pytest-cov writes it | read (fails with `ConvertFrom-Json`) |
| The command that is built | has `--cov=nq_terminal`, the JSON report in the folder and `COVERAGE_FILE`; no terminal table, no fail-under |

Regression guards (they pass on the old tree and keep a property): a run without `-Coverage` has no `coverage` block and no
`--cov`; a sibling folder sharing the repository's name as a prefix is not refused; `COVERAGE_FILE` is restored; nothing is
written in the tree.

## Fate of new files, for the 03 Appendix A addendum

| File | Fate |
|---|---|
| `scripts/tests/record_green.tests.ps1` | new test script; no backend module, route or screen was added |

## Unverified

- A full stamped `-Coverage` record of the real backend check. The run for the baseline refused to write one, correctly: other
  slices were editing files in the same worktree, so the stamp changed while it ran. A one-test end-to-end run through the
  `-Exe` hook on a scratch tree did write a record with the block (real pytest, real report).
- The web figure and its command line: `test:coverage` exists in `web/package.json`, but `@vitest/coverage-v8` is not
  installed here. The `--coverage.reportsDirectory` flags in `docs/TESTING.md` are untried.
- Rust: wave w2b, MSVC leg.
