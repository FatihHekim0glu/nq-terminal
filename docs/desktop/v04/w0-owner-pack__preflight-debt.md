# Preflight debt: three unmapped rows of 11 October (W0, slice preflight-debt)

## What was wrong

The preflight of 11 October (`D:/dev/v04/research/tools/gen03_preflight_2026-10-11.md`, lines 174, 249 and 300) found three rows that `gen_03_tables.py` cannot map, so the count of unmapped rows was not 0:

| Row | Path | Lines | Why unmapped |
|---|---|---:|---|
| backend 68 | `backend/nq_terminal/memtrim.py` | 368 | no rule covers a module at the package root that is not in `BACKEND_RULES` |
| backend 143 | `backend/nq_terminal/threadcaps.py` | 35 | same as above |
| front 46 | `web/src/jobsbar/` (support folder) | 11 non-test files, 8 test files | no entry in `FRONT_RULES` |

`memtrim.py` already has its row in the addendum (`docs/desktop/03_appendix_a_addendum.md`, the D5 (V012) row). It needs a generator rule only. `threadcaps.py` and `web/src/jobsbar` need an addendum row as well as a rule.

No file of the repository is changed by this slice. The generator and its diff live outside the repository's code paths.

## Evidence (born failing first, then fixed)

Tree: worktree `E:/projects/nq-lab/wt-w0` at `16f56ec`, clean before this slice. Generator: a copy of `C:/Users/Fatih Hekimoglu/nq-lab/desktop_research/tools/plan/gen_03_tables.py` taken before any edit (`D:/dev/v04/w0-owner-pack/gen_03_tables.orig.py`). The lab file itself was not touched.

1. Unpatched copy, nq-lab venv Python, on the worktree:
   `backend 143, screens 26, support 27, other 37, unmapped 3`
   The three UNMAPPED rows are output lines 174, 249 and 300; the footer reads `unmapped rows: 3`. This is the born-failing case.
2. The diff `docs/desktop/v04/gen03_rules.diff` applied with `patch` to a fresh copy of the original (`--dry-run` first, then applied). The result is byte-identical (`cmp`) to the edited working copy.
3. Patched copy, nq-lab venv Python, on the worktree, output to `D:/dev/v04/w0-owner-pack/preflight.md`:
   `backend 143, screens 26, support 27, other 37, unmapped 0`
   The footer reads `unmapped rows: 0`, and the word UNMAPPED does not occur in the file.
4. `diff` of the unpatched and patched outputs changes exactly four lines: the three rows (174, 249, 300) and the footer. Nothing else in the 445-line output moves.

## Generator rules added (`docs/desktop/v04/gen03_rules.diff`)

The diff is a unified diff with `a/gen_03_tables.py` and `b/gen_03_tables.py` headers, 2 hunks, 8 added lines, no removed lines. Each addition sits under a `# addendum: V04 W0` comment.

- `BACKEND_RULES`: `"memtrim.py"` (fate `new`, stage `D5`) and `"threadcaps.py"` (fate `new`, stage `D5`).
- `FRONT_RULES`: `"jobsbar"` (fate `new`, stage `D5`).

No function body changed. The file grows from 468 to 476 lines, far under the 800-line ceiling. Every new line is ASCII, with no em or en dashes.

## Rows for the Appendix A addendum (for the merge step)

Columns follow `docs/desktop/03_appendix_a_addendum.md`: Phase, Module, Lines, Fate, Desktop form, Stage, Tests. The stage label `D5` follows the rows of the same release line (V012 for `memtrim.py`). The phase labels `D5 (0.1.1)` and `D5 (0.2.0)` were taken from git history and `docs/desktop/handover_windows.md`, not from the wave plan, so the manager should confirm them.

| Phase | Module | Lines | Fate | Desktop form | Stage | Tests |
|---|---|---:|---|---|---|---|
| D5 (0.1.1) | `backend/nq_terminal/threadcaps.py` | 35 | new | caps the OpenBLAS, OpenMP, MKL and NumExpr thread pools of the server process at 2 before numpy, scipy or pyarrow load, so the idle backend holds 13 threads instead of 68 (G2 row idle_mem_home, figures from the module docstring); a name already set in the environment is left alone; `__main__.py` calls it before its first app import; the backtest child does not receive these names | D5 | `test_server_thread_caps.py` |
| D5 (0.2.0) | `web/src/jobsbar/` (20 files: 11 non-test, 1 gallery file, 8 test files) | 710 (non-test files, gallery and tests not counted) | new | the research launcher's chrome: the job indicator, the anchor badge, the anchor re-runs and their store; the job indicator reads `GET /api/jobs` every 15 s with no job and every 2 s with one | D5 | vitest `web/src/jobsbar` (8 files: `AnchorPanel.test.tsx`, `AnchorPanel.roving.test.tsx`, `AnchorRerun.test.tsx`, `JobIndicator.test.tsx`, `anchorModel.test.ts`, `jobsbar.css.test.ts`, `model.test.ts`, `useJobIndicator.poll.test.ts`) |

`memtrim.py` needs no new row: `docs/desktop/03_appendix_a_addendum.md` already has it at the D5 (V012) row. Its generator rule carries the same fate and stage.

Modules, routes and files added by this slice: none in the repository. The only new artefacts are the generator rules, the diff and this note.

## Checks run

- Generator, unpatched copy on the worktree: `unmapped 3` (born failing, shown above).
- Generator, patched copy on the worktree: `unmapped 0` (the slice's test, as specified).
- `patch --dry-run` and `patch` of the diff onto a fresh copy of the original: clean, and `cmp` identical.
- Counts of `web/src/jobsbar`: 20 entries, 8 test files, 1 gallery file, 710 lines in the non-test files, 1,016 lines in the test files.
- Line counts: `memtrim.py` 368 and `threadcaps.py` 35, both matching the 11 October preflight.
- Read-only check of the lab: no file under `experiments/*.json` mentions `gen_03`, so no experiment pins `gen_03_tables.py` by name. (The one hit in the lab, `desktop_research/windows_build_plan.json`, is a build plan, not an experiment pin.)

## Not run

- No pytest, vitest or Playwright run. The slice's tests are the generator runs above, and no HEAVY or PLAYWRIGHT slot was taken. The addendum change is text only; `backend/tests/test_desktop_tree.py`, which reads the addendum, was not run here because the addendum is not in this slice's ownership and the rows take effect only after the wiring below is merged.
- No slot taken, no process started, no backend started, no browser opened.
- `docs/desktop/03_appendix_a_addendum.md` is not edited (not owned by this slice). The rows above are the exact text for the merge.

## Wiring (exact, for the merge step)

1. Manager, before applying the diff to the lab: keep a backup of `C:/Users/Fatih Hekimoglu/nq-lab/desktop_research/tools/plan/gen_03_tables.py` (for example `gen_03_tables.py.bak`), then apply `E:/projects/nq-lab/wt-w0/docs/desktop/v04/gen03_rules.diff` with `patch -p1` run in `C:/Users/Fatih Hekimoglu/nq-lab/desktop_research/tools/plan/`. The read-only check above found no `experiments/*.json` pin, so the apply is allowed by standing rule 2.
2. Merge step, in the worktree: append to `docs/desktop/03_appendix_a_addendum.md` a new section titled `## Preflight of 11 October 2026 (wave W0, slice preflight-debt)` that repeats the preflight table of this note, followed by the two rows of the table above under `### Rows added by W0` (the `threadcaps.py` row and the `web/src/jobsbar/` row). Keep the file LF.
3. Re-run the patched generator on the merged tree and confirm `unmapped 0` and footer `unmapped rows: 0`.

## Not done

- Phase labels `D5 (0.1.1)` and `D5 (0.2.0)` are inferred from git history and the handover, not checked against the wave plan.
- The addendum edit (wiring step 2) and the lab apply (wiring step 1) are not done here.
- The preflight of the merged tree (wiring step 3) is a post-merge check, not run in this slice.
