# Wave w3-research-integrity, slice dq-universe: data usability for the whole universe

Roadmap: `research_ux.md` item 3 ("DQ universe: usability matrix for every root and year"). The question it answers
is "is this testable?" in one view, instead of opening DQ 28 times or reading the lab notes.

The slice reads records only: the per-symbol repair sidecars and the NQ rejected-days files, with the QA reports and the 1d
QA. It reads no price and never opens a data file, so it adds no line to the OOS access log.

## What is served

`GET /api/dq/universe` on the existing `/api/dq` router (GET only, 502 when a repair record holds a source the
terminal cannot classify, as `/calendar/{symbol}` does). The body is a `DqUniverse`:

| Field | Meaning |
|---|---|
| `label`, `fence`, `years` | the `[POST HOC]` label verbatim, `2021-12-31`, and the grid years 2010 to 2021 |
| `roots[]` | NQ first, then every futures root that has a sidecar, in the order of `/api/dq/symbols` |
| `roots[].repair_status` | `nq`, `v1`, `v2`, `vendor_only` (the repair failed its validation, so every candidate stays out) or `not_assessed` (NQ with no repaired-days file) |
| `roots[].rows[]` | the 1m rows: `vendor` always, `repaired` only where the repair passed. Each has 12 year cells and a total |
| cell fields | `sessions`, `usable`, `gated_out`, `unrepairable`, `rejected`, `usable_share` (null for a year with no session) |
| `roots[].first_bar`, `last_bar`, `last_sealed`, `qa_source` | the first and last 1m bar from the root's QA report (`qa_report.json` for NQ, `qa_report_futures_1m.json` for the rest) |
| `roots[].daily` | the 1d row from `qa_report_carry_1d.json` (headline rank 0): bars up to the fence, first and last bar, NYSE sessions with no bar. Null when the 1d QA has no such root |
| `roots[].blocks[]` | the known blocks, in the records' words (below) |
| `missing[]` | expected files that could not be read |

### Definitions

- Name: usable share. Time rule: per calendar year of the NYSE sessions the root's records hold, up to 2021-12-31.
  Unit: sessions. Void handling: a year with no session has `usable_share` null and prints `--`. Anchor: the
  per-symbol calendar of the same root, summed by year (`test_per_year_counts_equal_the_sum_of_the_symbol_calendar`).
- Repaired row: usable is vendor plus rebuilt. `gated_out`, `unrepairable` and `rejected` are the per-day states of
  `services/dq.py` unchanged. A `candidate_not_repaired` day is never usable, in either row.
- Vendor row: usable is vendor only, because research drops every rebuilt day when it serves the vendor variant
  (`nq_lab.data.excluded_sessions(..., "vendor")`). A rebuilt day is then counted `gated_out` for a futures root and
  `rejected` for NQ (the session gate rejects it in the vendor bars). A root whose repair failed has only this row.
- Last bar: a date up to the fence, otherwise only the text `2021-12-31 or later, sealed` and `last_sealed = true`.
  The QA report of NQ runs to 2026, so its last bar is the sealed text; the date after the fence is never in the body.
  The web model repeats the clamp, so a date after the fence cannot reach the screen even from a faulty body.
- Blocks: the sidecar's `why_not_repaired` verbatim, then each reason a day stayed out with its session count
  (`<reason>: <n> sessions`, the reason being the record's own `reason` text; for NQ the repair report's `skipped`
  keys). At most six reasons, then one line "N further reasons: M sessions". The words "Vendor only, every candidate
  excluded" are the screen's label for `vendor_only`, taken from the lab notes' description of the v2 result.
- 1d row: the 1d QA keeps totals only, so the row has no per-year counts. Its cells say so in their accessible names.

## How it is built

`services/dq.py` gains `universe(files, results, load=_load)`. `load` is the per-symbol calendar source, so the test
can feed a stub that does not filter by the fence. `year_counts` drops any day after the fence, or in a year outside
the grid, itself; the per-symbol service still filters at its own `FENCE` checks, so the two layers are independent.
Models are `DqUniverse`, `DqUniverseRoot`, `DqUniverseRow`, `DqUniverseCell`, `DqUniverseCounts`, `DqUniverseDaily`.

Web: the DQ screen gains a third tab, 87) Universe (`UniverseMatrix`, `universeModel`). It opens first when the
panel context is a universe, and on the calendar for an instrument. The matrix is a real `role="grid"` with one tab
stop. Arrow keys, Home, End, Page Up and Page Down move between cells. Each cell's accessible name carries its counts
(`GC 1m vendor 2011: 90 of 100 sessions usable, 90.0%. Gated out 8, unrepairable 2, rejected 0.`) and the same text
fills the readout line. The share is printed as a figure with a thin bar under it, so colour is never the only cue.
The share is cut down to one decimal, never rounded up, so 99.96% does not read 100.0%.

## Born-failing evidence

Each guard was shown failing on a build that lacks it (the mutation was applied to `services/dq.py`,
`qa/crosscheck/p11_dq.py` or `universeModel.ts`, the tests run, the file restored; scripts under
`D:/dev/v04/w3-research-integrity/mutate_*.py`).

| Guard | Test | Failed under the mutation |
|---|---|---|
| a stub calendar that does not filter drops a planted 2022 session | `test_the_aggregator_drops_a_planted_2022_session_itself`, `test_the_fence_check_holds_even_if_the_grid_were_extended` | fence check removed and grid extended to 2022: 4 tests fail |
| a `candidate_not_repaired` day counted usable | `test_a_candidate_not_repaired_is_never_counted_usable[ES,GC,HO,ZT]` (third path: raw sidecar json) | candidates added to usable: 12 tests fail |
| a last bar past the fence shown as a date | `test_a_last_bar_past_the_fence_is_the_sealed_text_not_a_date`, the 1d row test, the route tests | date returned: 5 tests fail |
| per-year counts differ from the sum of the per-symbol calendars | `test_per_year_counts_equal_the_sum_of_the_symbol_calendar[NQ,ES,GC,HO,ZT]` | unrepairable added to gated out: 5 tests fail |
| QA reference: candidate usable, year filter, last bar | `qa/tests/test_p11_dq.py` | 4 tests fail, then 3, then 2 |
| web clamp, fence year, share rounding | `universeModel.test.ts` | 2 tests fail, then 1, then 1 |

Regression guards (cannot fail on today's tree by construction): the route is GET only and leaks no path (the
existing router test covers the prefix; the new route inherits it), and the 502 for an unknown source.

## Appendix A addendum (new modules, routes and files, with their fate)

| Item | Fate |
|---|---|
| route `GET /api/dq/universe` | new, kept; read only, no price, no gate line |
| `services/dq.py` `universe`, `year_counts`, `repair_status`, `first_bar`, `last_bar`, `Loader` | new functions in an existing module, kept |
| `models/dq.py` `DqUniverse*`, `RepairStatus`, `UniverseVariant` | new, kept; the contract must be regenerated (wiring) |
| `backend/tests/dq_fixtures.py` `write_universe_results` | new fixture builder (HO v2, ZT v1, QA bounds, 1d QA); `write_dq_results` is unchanged, so `test_dq*.py` keep their expectations |
| `backend/tests/test_dq_universe.py` | new, kept (30 tests) |
| `qa/crosscheck/p11_dq.py` `dq_universe_references` (kind `dq_universe`) | new, kept; the shared set helpers `_sidecar_sets` and `_nq_sets` now back `dq_sidecar` and `dq_nq` too, behaviour unchanged |
| `web/src/screens/dq/UniverseMatrix.tsx`, `universeModel.ts` and their tests | new, kept |
| `DqScreen.tsx` third tab and a local `useDqUniverse` | kept; the hook moves to `queries.screens.ts` once the contract has the path (wiring) |

## Wiring needed outside this slice's files

See the final report: contract regeneration, `useDqUniverse`, the three mnemonic tables, the dump writer and
`BUNDLE_INPUTS`, and `DQ_SCREEN.accepts`.

## Not verified here

- `web/e2e/p11.spec.ts` has the new universe test (it type-checks with `test:e2e-types`) but was not run: it needs the
  PLAYWRIGHT slot and a built web, and runs at merge. No baseline screenshot was added for the universe tab (it needs
  `--update-snapshots` at merge).
- The e2e fixture results (`backend/tests/fixtures/results`) have no `qa_report_carry_1d.json` or QA bounds, so the
  fixture-mode screen shows empty bounds and a "Not read" line. This is not mine to change.
- axe and the keyboard run are for the e2e at merge; the unit tests check the roles, names, tab stop and keys.
