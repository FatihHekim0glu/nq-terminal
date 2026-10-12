# w3-research-integrity, slice series-monthly-b

Ten monthly screens, one reviewed mapping each: oigrowth_v0, rateamp_tsy_v0, stmomturn_v0, termprem_cmdty_v0,
tsyauction_mid_v0, tsydemfx_v0, xsbreadth_q_v0, xsintra_w_v0, xsml_m_v0, zqcut_v0. All ten are learned. None is left
unlearned for passing the fence (every screen records a sample that ends on or before 2021-12-31) and none is
NOT_LEARNABLE, so the module's `NOT_LEARNABLE` is empty.

## New files and their fate (for the 03 Appendix A addendum)

| File | Lines | Fate | Note |
|---|---|---|---|
| `backend/nq_terminal/series_sources/monthly_b.py` | 109 | new | `SOURCES` (10 rows) and an empty `NOT_LEARNABLE`; the series-core package already lists `monthly_b` in `PARTS` and merges both |
| `backend/tests/test_series_monthly_b.py` | 521 | new | 218 cases: 132 on the fixture copy (122 pass, 10 expected failures), 86 on the lab tree under `-m lab_only` |
| `backend/tests/fixtures/results/screens/monthly_b/*.csv` (10) | 44 KB | new | synthetic: the lab file's column names and order, made-up values, 14 months each |
| `backend/tests/fixtures/results/screens/monthly_b/*.json` (10) | 16 KB | new | synthetic screen JSON holding only the keys the anchors read, at the lab's paths |
| `backend/tests/fixtures/results/screens/monthly_b/make_fixtures.py` | 174 | new | seeded generator (seed 20261012); a second run is byte-identical |
| `docs/desktop/v04/w3-research-integrity__series-monthly-b.md` | this note | new | |

No route, model, copy or contract file is touched. The lab's `results/`, `experiments/` and `data/` were read only.

## The mapping, row by row

Common to all ten: kind `monthly` (P = 12, convention C2), time rule `MONTH_END_SESSION` (the holding month is dated at
the last NYSE session of that month), unit `return on capital per month`, and the cost columns at 0, 1 and 2 era ticks
per side (plus $2.50 per side) as each file holds them. No mapping can enforce the fence by itself (see "The fence").

| Row | Time column and guard | Value columns (cost: column) | Benchmark | Void handling |
|---|---|---|---|---|
| oigrowth_v0 | `label`, guard `end` | 0, 1, 2: `r_timed_{k}` | 0, 1, 2: `r_lo_{k}` (constant 1x equal-risk long-only 14-commodity basket) | none; a flat month would be a row worth 0 (none occurs) |
| rateamp_tsy_v0 | `month`, no guard | 0, 1, 2: `r{k}` | 1: `lo1` (the W = 1 twin of the headline) | `void` (bool) drops the month; the screen's own book sets those returns to NaN, so it is dropped twice over |
| stmomturn_v0 | `label`, guard `end` | 0, 1, 2: `r_{k}` | 1: `lo20_1` (carry_v0's equal-risk long-only book of COMM and FX) | none |
| termprem_cmdty_v0 | `label`, guard `end` | 0, 1, 2: `r_{k}` | 1: `r_lo_1` (cskew_v0's long-only commodity book) | none |
| tsyauction_mid_v0 | `month`, no guard | 0, 1, 2: `r{k}` | 0, 1, 2: `lo{k}` (all-month long-only ZF, ZN, ZB, eomtsy_v0 rule 7) | `void` holds a reason text and a void month has empty returns, so empty values drop it (the fxeomhedge_v0 pattern); no `void_column` |
| tsydemfx_v0 | `month`, no guard | 0: `r_fee_only`, 1: `r_1tick`, 2: `r_2tick` | 0, 1, 2: `ctl_LO` (gross long-only control, no costs) | none |
| xsbreadth_q_v0 | `label`, guard `end` | 0, 1, 2: `r_ml_{k}` | 1: `lo_1` (equal-risk long-only book of the admitted markets) | none; `flat` months are rows worth 0 |
| xsintra_w_v0 | `label`, no guard | 0, 1, 2: `r_ml_{k}` | 1: `lo15_1` (equal-risk long-only book of the 15 traded markets) | none |
| xsml_m_v0 | `label`, guard `end` | 0, 1, 2: `r_ml_{k}` | 1: `lo21_1` (equal-risk long-only book of the 21 traded markets) | none |
| zqcut_v0 | `e`, guard `x` | 0, 1, 2: `r{k}` | 1: `cl` (constant full-weight long m+6 ZQ book) | none: a void month is a row worth 0 and stays |

### Why each choice

- **Dating.** The five `label, start, end` files and zqcut_v0 hold a window `(close of the first session of the month,
  close of the first session of the next month]`; the `end` (or `x`) column is one session after the month end, so
  dating by it puts every row one session late, and it serves as the guard (a stamp may not lie after the day the return
  is complete). The files with only a month column record the calendar month: rateamp_tsy_v0's spec says "month m+1 is
  (close d_m, close d_{m+1}]" with d the last session, xsintra_w_v0's says "the sum of daily net $ in calendar month m",
  tsydemfx_v0's book runs "from the month-end mark of m-1 to the mark of m", and tsyauction_mid_v0's two legs end inside
  the month (the post leg runs A to A + 5 sessions from an auction in calendar days 1 to 20). The last session of the
  month is the day each of those returns is complete. zqcut_v0 has no month column: `e` is the entry session, always the
  first session of the holding month (checked on every row of the lab file), and Period parsing of its date gives the
  month; `x` is the exit and the guard.
- **tsydemfx_v0 costs.** `r_fee_only` is the screen's 0-tick book (fee only, no slippage; the headline records its mean
  as `fee_only_mean`), `r_1tick` the headline and `r_2tick` the P3 cost stress (`P3.mean`). `r_gross` is gross of the fee
  as well and has no cost key. The benchmark `ctl_LO` is the screen's gross control; it is served at every cost and the
  label says gross.
- **Benchmarks.** The control book of the same legs that the screen's own control regression lists first and that has
  no timing or ranking in it (the constant or long-only book). Factor sleeves and other strategies (TSMOM, CARRY, LIN,
  UNC, CSKEW, REV1W, REV1M, the second tsydemfx controls) are not benchmarks and are left out. Each benchmark is mapped
  at the cost the screen records it at; where the file has `{k}` variants (oigrowth_v0, tsyauction_mid_v0) all three.
- **zqcut_v0 void.** The screen counts a void month as 0 ("a void there enters as 0, as every void does") and T is the
  number of months, and the lab's book writes r = 0 for it. The mapping therefore keeps those rows. No void month
  occurs in the lab file, so this cannot be seen in the anchors; a test on the fixture copy shows that dropping it
  would change T.

## Anchors (the lab file reproduces the screen JSON at 1e-9, relative)

Each row is checked, on the fixture copy and on the lab tree, against:

1. n, mean, sd (ddof 1) and Sharpe (`perf.sharpe`, P = 12) at 1 tick, from the screen's headline block;
2. the mean at 0 and 2 ticks, from the screen's cost ladder;
3. the benchmark: its recorded mean (oigrowth_v0, rateamp_tsy_v0, stmomturn_v0, tsydemfx_v0, zqcut_v0) and, where the
   screen records a control regression (stmomturn_v0, termprem_cmdty_v0, tsyauction_mid_v0, xsbreadth_q_v0,
   xsintra_w_v0, xsml_m_v0), its intercept and every coefficient, recomputed by least squares from the served return,
   the served benchmark in its place and the file's other control columns (this pins the column and its position);
4. every row's date: the last NYSE session of its holding month, from the session calendar and not from the service.

The lab run matches all ten rows on all four. The synthetic screens carry the same numbers computed from the
synthetic CSV, so the same code runs on both.

## Born failing

| Guard | Test | Evidence |
|---|---|---|
| a month dated one session late fails its anchor | `test_born_failing_a_month_dated_one_session_late_fails_its_anchor` (the six rows with a late date column) | with the anchor check neutered the test fails in 12 of 12 cases; the stub mapping (the label read as a timestamp) failed the series anchor in all 20 cases on both trees |
| a month label shifted by one month is seen | `test_born_failing_a_month_label_shifted_by_one_month_is_seen` | a guarded row is refused by the service, an unguarded row is dated a month late; independent of the anchor check |
| the 2-tick column read for 1 tick fails its anchor | `test_born_failing_the_2_tick_column_read_for_1_tick_fails_its_anchor` | fails in 20 of 20 cases with the anchor check neutered; the stub mapping (2 ticks read for 1) failed the series anchor on all 20 |
| another column read as the benchmark fails its anchor | `test_born_failing_another_column_read_as_the_benchmark_fails_its_anchor` | fails in 20 of 20 cases with the anchor check neutered |
| a flagged void month is dropped (rateamp_tsy_v0); without its `void_column` it stays | two tests | the stub mapping failed the first |
| a void month with empty returns is dropped, not zeroed (tsyauction_mid_v0) | one test | `void_as_zero=True` keeps the row |
| a void month of zqcut_v0 enters as 0; dropping it changes T | one test | `void_column="void"` drops it |
| red before the mapping existed | whole file | `ImportError: cannot import name 'monthly_b'`, then 37 failures against a deliberately wrong stub |

### The fence

`SeriesSource` has no field that drops a row by date, so no mapping can fence a 2022 row on its own: every row relies on
the shared check in `ResearchService.series` (`stamps >= IS_END` raises). The spec asks for a test where "with the
shared fence helper stubbed to pass rows through, a planted 2022 row is still dropped by your mapping". That test
cannot pass today. It is written (`test_with_the_shared_check_stubbed_a_planted_2022_row_is_still_dropped_by_the_mapping`,
10 cases) as a strict expected failure: it fails on the assertion that a 2022 stamp is present, and it turns red the day
the type grows a field that could drop it. The ten tests `test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_check`
are regression guards (they cannot fail on today's tree): a planted 2022 row is refused by the shared check on both trees.

Before any series file was used, each screen JSON's recorded sample end was read (`recorded_sample_end`): a last month in
`facts`, `counts.last_label` or `counts.last_holding` (oigrowth_v0, stmomturn_v0, xsbreadth_q_v0, xsml_m_v0), else the
exclusive end of its `serve` blocks, 2022-01-01 (rateamp_tsy_v0, tsyauction_mid_v0, tsydemfx_v0, zqcut_v0). The screens of
termprem_cmdty_v0 and xsintra_w_v0 record no dated end at all; for those two the frozen window in the lab's spec text
gives 2021-12 ("Jan 2012 to Dec 2021", "2013-01 to 2021-12"). All ten end on or before 2021-12-31.

## Wiring for the merge step (files this slice does not own)

1. `backend/tests/fixtures/manifest.json`, `files`: `test_manifest_lists_every_fixture_file_and_nothing_else` walks the
   whole fixtures folder, so add these 21 entries, each `{"source": null, "how": "synthetic", "note": "..."}`, for
   `results/screens/monthly_b/make_fixtures.py` (note: "seeded generator of the synthetic monthly_b fixtures") and, for
   each of `oigrowth_v0`, `rateamp_tsy_v0`, `stmomturn_v0`, `termprem_cmdty_v0`, `tsyauction_mid_v0`, `tsydemfx_v0`,
   `xsbreadth_q_v0`, `xsintra_w_v0`, `xsml_m_v0`, `zqcut_v0`, the two files `results/screens/monthly_b/<name>.json`
   (note: "synthetic screen JSON: only the keys the anchors read, numbers computed from the synthetic CSV") and
   `results/screens/monthly_b/<name>_monthly.csv` (note: "synthetic: the lab file's column layout, 14 made-up months").
2. Register the marker `lab_only` (`config.addinivalue_line("markers", "lab_only: needs the lab tree under
   results/screens; skipped where it is absent")` in `backend/tests/conftest.py`, or `markers` in the lab's pytest
   settings). Without it pytest prints `PytestUnknownMarkWarning` and nothing fails.
3. Optional, `backend/nq_terminal/analytics/series.py`, `RECORDED_COUNTS` (not owned by any slice): the built series has
   exactly the screen's recorded n for all ten rows (the anchors prove it), so the count guard can cover them:
   `"oigrowth_v0": ("headline", "n")`, `"rateamp_tsy_v0": ("headline", "n")`, `"stmomturn_v0": ("headline_by_ticks", "1",
   "n")`, `"termprem_cmdty_v0": ("cost_ladder", "1_tick", "n")`, `"tsyauction_mid_v0": ("headline", "n")`,
   `"tsydemfx_v0": ("headline", "n")`, `"xsbreadth_q_v0": ("headline", "n")`, `"xsintra_w_v0": ("headline", "n")`,
   `"xsml_m_v0": ("headline", "n")`, `"zqcut_v0": ("headline", "n")`. Not needed for the count of learned rows.

Nothing else: `series_sources/__init__.py` already imports `monthly_b` when it is there, and the merged table holds the
ten names with no clash (`tests/test_series_sources_registry.py`: 21 passed with this module present).

## Not done, and not verified

- Mappings are anchored where the screen records a number. The one benchmark column no screen number reaches is
  tsyauction_mid_v0's `lo0` and `lo2` (only `lo1` is anchored, through the control regression); they are mapped by the
  file's naming (`lo0`, `lo1`, `lo2`), as `r0`, `r1`, `r2` are.
- Void handling cannot be seen in the lab data (no void month in any of the ten files). The choices follow the lab
  code: rateamp_tsy_v0 sets void-month returns to NaN (`rateamp_book.run`), tsyauction_mid_v0 leaves them out of the
  frame (`tsya_screen.frame`), zqcut_v0 books them as 0 (`zqcut_book.VOID`).
- Dating of the four files without a guard column (rateamp_tsy_v0, tsyauction_mid_v0, tsydemfx_v0, xsintra_w_v0) rests
  on the specs' statements above, not on an event file that rebuilds the month, as monthly_a does for two of its rows.
- `ruff` is not installed on this machine: line length (120), unused imports and the 800-line ceiling were checked by
  hand and by a small AST script.
- The whole backend suite was not run (merge does); `tests/test_series_sources_registry.py` was run once as a check.
- No browser, no backend on a port and no Playwright were started.
