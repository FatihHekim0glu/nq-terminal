# Wave w3-research-integrity, slice dd3: every drawdown episode and its time to recovery

Catalogue row: `docs/ANALYTICS_CATALOG.md` DD3 (P1), "time-to-recovery histogram, longest time under water, from DD2".
Roadmap: `research_ux.md` item 9. This slice closes the catalogue's DD3 gap on the backend side and removes the
"DD3 is not served" note from the tear sheet.

## What is served

`GET /api/analytics/{hypothesis,run}/...` (the full tear sheet) now carries `drawdown.episodes`, a `DrawdownEpisodes`
body. The HOME panel route does not build it: `drawdown_view(s, u)` leaves `episodes` null unless
`with_episodes=True`, and only `build()` passes it. HOME's window therefore does not grow, and
`qa/golden/home_panels_v031.json` is unchanged (`test_home_panel_lazy_relative.py` passes; a spy test proves
`home_panel` never calls `episode_summary`).

| Field | Meaning |
|---|---|
| `unit` | `sessions` for a daily series, `months` for a monthly book (by position in the series, never calendar days) |
| `episodes` | every episode, in time order, no top-10 cut; the same row as DD2 (`peak`, `trough`, `recovery`, `depth`, `peak_to_trough`, `trough_to_recovery`, `length`, `open`) |
| `n_episodes`, `n_recovered`, `n_open` | counts; `n_recovered + n_open = n_episodes`, and only the last episode can be open |
| `recovery_median`, `recovery_max` | over the recovered episodes only; null when none has recovered |
| `histogram` | fixed inclusive bins of the time to recovery (below), counts over the recovered episodes only |
| `longest` | the episode with the most sessions under water (the earliest on a tie), `length` from its peak to its recovery, or to the last session while it is open |

Definitions, written once so a reviewer can sign the mapping (name, time rule, unit, void handling, anchor):

- Name: DD3. Time rule: an episode is a maximal run of sessions strictly below the running peak; the peak of the
  curve starts at the baseline (0 on Basis A, 1 on Basis B), so an opening loss is an episode from the baseline
  (`peak` null). A session back at the peak exactly (`E_t >= E_peak`) is the recovery.
- Time to recovery: recovery position minus trough position. Time under water (`length`): recovery position (or the
  last position while open) minus peak position, the baseline peak sitting at position -1. Unit: sessions, or months
  for a monthly series.
- Void handling: an open episode is never a recovery. It is left out of the recovery times, their median and
  maximum and the histogram, is counted in `n_open`, and still counts for `longest`. A series with no drawdown gives
  zero episodes, null median, maximum and `longest`, and a histogram of zeros. NaN or infinite returns are refused
  upstream (`returns_series`), as for DD1 and DD2.
- Bins (inclusive): daily 1, 2-5, 6-10, 11-21, 22-63, 64-126, 127-252, 253 and over; monthly 1, 2-3, 4-6, 7-12,
  13-24, 25-60, 61-120, 121 and over. Recovery times are heavy tailed, so the bins widen; the edges follow the
  trading calendar (about a month, a quarter, half a year, a year).
- Anchor: DD2's golden. The 10-session hand table in `backend/tests/test_drawdown_episodes.py` extends it (exact
  binary values, so equality holds to 1e-15): three episodes, recovered after 1 and 3 sessions, one open.

## What is drawn

The DD tab keeps the equity, underwater and lanes chart and the top-drawdowns table, and adds a DD3 group under the
lanes note: a facts table (episodes, recovered, still under water, median and longest time to recovery, longest time
under water with its dates), a histogram table whose count cells carry a bar (the bar is decorative and hidden from
assistive technology; the number is the content), and the rule in words. The web side draws what was served: it
computes nothing. The lanes still draw the deepest ten rows of DD2; when DD3 counts more episodes than the lanes
draw, a line says "The lanes draw 10 of the 41 episodes; DD3 below counts all 41." The "DD3 is not served" sentence
is gone from the lanes copy (`web/src/copy/tear.ts`, `lanesNote` and `lanesNoteOne`).

The web code reads `drawdown.episodes` through a small structural type in `tearCharts.ts` (`servedEpisodes`), so it
compiles and runs both before and after `src/api/schema.d.ts` is regenerated, and a body without the field (an older
backend, a fixture) draws no DD3 block.

## Files

Changed: `backend/nq_terminal/analytics/drawdown.py` (DD3 functions), `backend/nq_terminal/models/analytics.py`
(`RecoveryBin`, `LongestUnderWater`, `DrawdownEpisodes`, `DrawdownView.episodes`),
`backend/nq_terminal/services/tearsheet.py` (`drawdown_view(..., with_episodes)`, `drawdown_episodes`),
`web/src/screens/tear/tearCharts.ts` (`dd3View`, `laneNotes`), `web/src/screens/tear/TearViews.tsx` (`Dd3Block`),
`web/src/copy/tear.ts` (`TEAR_DD3`, lanes copy), `web/src/screens/tear/tearCharts.test.ts`,
`web/src/screens/tear/TearViews.test.tsx`.

New: `backend/tests/test_drawdown_episodes.py`, `qa/tests/test_dd3_reference.py`, this note.

## Appendix A addendum records (new modules, routes and files, and their fate)

| Item | Kind | Fate |
|---|---|---|
| `analytics.drawdown.all_episodes`, `recovery_histogram`, `episode_summary`, `BINS`, `LENGTH_UNIT` | new functions in an existing module | kept; the DD3 reference (`qa/tests/test_dd3_reference.py`) pins the same definitions |
| `models.analytics.RecoveryBin`, `LongestUnderWater`, `DrawdownEpisodes`; `DrawdownView.episodes` | new response models, one new field on an existing one | kept; changes the OpenAPI contract and the generated types (see wiring) |
| `services.tearsheet.drawdown_episodes`; `drawdown_view(..., with_episodes=False)` | new function, new keyword (default keeps HOME unchanged) | kept |
| `screens/tear` `dd3View`, `Dd3Block`, `TEAR_DD3`, `TEAR_DD.lanesOf` | new web functions, component and copy | kept |
| route | none | no new route: DD3 rides the existing full tear-sheet routes |
| `backend/tests/test_drawdown_episodes.py`, `qa/tests/test_dd3_reference.py` | new test files | kept |

## Tests and born-failing evidence

- `backend/tests/test_drawdown_episodes.py`: 19 tests. Written first and run against the unchanged tree: 18 of 18
  (the then-current set) failed on a missing function or field. The born-failing guards, each also proved by a
  mutation of the implementation: an open episode counted as recovered (mutation: open rows take their length as a
  time; 7 tests fail), an off-by-one trough to recovery (mutation: minus one; 9 tests fail), the recovery rule
  `>=` against a session one hair short (mutation: one session late; 2 tests fail).
- `qa/tests/test_dd3_reference.py`: 16 tests, a loop against a vectorised reference written from the definition (the
  QA package never imports the backend), the hand table, the open-episode mutant, histogram bin edges, and
  quantstats `drawdown_details` as INFO on a series that opens with a gain. The loop and the vectorised reference
  agree on 4 parameter sets of 12 random series each. Mutations of the references (`<=` for `<`, `>` for `>=`) fail
  3 and 7 tests. These are reference tests, so they cannot fail on today's backend tree: they are regression guards
  for the definitions, and the backend test file carries the same hand table so the two stay tied.
- `web/src/screens/tear`: 20 new or changed cases fail against the unchanged source (`git show HEAD` copies of
  `tearCharts.ts`, `TearViews.tsx`, `tear.ts` put back for the run, then restored byte for byte), 454 pass with the
  change (20 files in the folder).

## Wiring for the merge step (files this slice does not own)

1. `contract/openapi.json`: regenerate with `NQT_UPDATE_CONTRACT=1` for `backend/tests/test_openapi_contract.py`.
   Until then `test_openapi_contract.py::test_contract_matches_the_app` and
   `test_startup_imports.py::test_openapi_equals_the_contract_file` fail, as they must for a model change.
2. `web/src/api/schema.d.ts` and `web/src/api/openapi.sha256`: `pnpm gen:api`.
3. After step 2 the `drawdown` object of `Schemas['Analytics']` has a required `episodes` field, so the captured
   fixtures need `"episodes": null` after `"bench_max_drawdown": ...` inside each `"drawdown": {...}`:
   `web/src/screens/tear/tear.fixtures.ts` (3 constants) and `web/src/screens/tear/tearP1.fixtures.ts` (1 constant).
   Not needed for the tests to pass; needed for `pnpm test:types`.
4. e2e: the fixture backend now serves episodes, so the DD tab shows the DD3 group in the browser. The DD height
   check in `web/e2e/tear.spec.ts` compares the body with the tab screen, which grows with its content, so no change is
   expected; it was not run here (one Playwright run at a time, owned by the merge step).

## Not verified here

- No browser run, no `pnpm test:types`, no `pnpm build` bundle budget (the bundle grows by one small component and
  about 40 lines of copy).
- The full backend suite and the strict crosscheck run at merge. `qa/crosscheck/dumps.py` and `reference.py` are not
  touched: DD3 has no crosscheck dump kind, the QA reference is the pytest file above.
