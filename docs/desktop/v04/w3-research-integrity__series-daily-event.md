# w3 series-daily-event: four daily and eight event rows

Slice of wave `w3-research-integrity`. Module `backend/nq_terminal/series_sources/daily_event.py` exports `SOURCES` (8 rows) and `NOT_LEARNABLE` (4 rows, each with its reason). The tests are `backend/tests/test_series_daily_event.py` with synthetic fixtures under `backend/tests/fixtures/results/screens/daily_event/`.

## Result

| Row | Verdict | Kind | Dated at | Value column per cost (0, 1, 2 ticks) | Unit |
|---|---|---|---|---|---|
| fedflow_tsy_v0 | learned | trades | `day` (intraday window) | `net_bp_0`, `net_bp_1`, `net_bp_2` | basis points of capital per trade |
| lhrev_letf_v0 | learned | daily | `date` (the mark) | `r_0`, `r_1`, `r_2`; benchmark `lo_net1` at 1 tick | return on capital per session |
| tsyauct_intra_ml_v0 | learned | trades | `date` (auction day, intraday legs) | `r_ml_0tick`, `r_ml_1tick`, `r_ml_2tick` | return on capital per trade |
| cropsmooth_v0 | learned | trades | `R` (report date, close of R) | `net_0tick_bp`, `net_1tick_bp`, `net_2tick_bp` | basis points of capital per trade |
| fomcdrift_tsy_v0 | learned | trades | `exit` (E+15, where the return is realised) | `r0`, `r1`, `r2` | return on capital per trade |
| fomcfx_v0 | learned | trades | `D` (entry at the close of the session before) | `r0`, `r1`, `r2` | return on capital per trade |
| fomcpc_fx_v0 | learned | trades | `day` | `r0_bp`, `r1_bp`, `r2_bp` | basis points of capital per trade |
| pretra_tsy_v0 | learned | trades | `P` (pre-refunding Friday; entry at the close before) | `r0`, `r1`, `r2` | return on capital per trade |
| hvix_nd_v0 | NOT_LEARNABLE | | | | |
| apieia_ho_v0 | NOT_LEARNABLE | | | | |
| dburst_rev_v1 | NOT_LEARNABLE | | | | |
| xfut_tcn120_v0 | NOT_LEARNABLE | | | | |

Confirmed per row: the event rows reuse the summed-per-session `trades` kind of C1, and the one daily file with a value on every mark (lhrev_letf_v0) is used as recorded.

### Why `trades` for events

`hypothesis_series` sums events per session and puts them on every session of the window with 0 where there is none (SV3a step 2), as the calendar rows tom_v0, prefomc_v0 and fomctone_v0 already are. Reading eight or so events a year as a `daily` series would annualise them at 252 sessions and flatter the Sharpe that the Deflated Sharpe compares. The screens themselves annualise events by the square root of events per year (fomcdrift_tsy_v0, fomcpc_fx_v0, tsyauct_intra_ml_v0), which is not an option of C2 (P is 252 or 12).

### Mapping notes

- Voids are left out, never zeroed: cropsmooth_v0 (two warm-up dates) and fomcfx_v0 (two dates with six void roots) have empty values, and the screen's n excludes them (32 and 86).
- Dating is the session the return is realised. fomcdrift_tsy_v0 is dated at `exit`, because `date` is the statement day 15 sessions earlier; the born-failing date test builds E+15 from the NYSE calendar. fomcfx_v0 and pretra_tsy_v0 enter at the close of the session before the dated day.
- No benchmark is mapped to a `trades` row. `hypothesis_series` lines a benchmark column up with the summed session series row for row, which fails for a per-event column (tested: `test_a_per_event_benchmark_cannot_line_up_with_the_summed_session_series`). The controls the screens record (fomcdrift `lo1`, tsyauct `r_unc_1tick`, `r_plc_1tick`, `r_ridge_1tick`) therefore stay unmapped.
- tsyauct_intra_ml_v0 records no serve window, so the zero fill ran over the default window (2010-09-28 to the fence) before the fix. The walk-forward tests from 2013 on, so the 2010 to 2012 sessions are padding with 0 that the screen's n (621 test auction days) does not have. `SeriesSource.window_start` now starts the zero fill at 2013-01-02 (T = 2267, served Sharpe within 1e-4 of headline.sharpe, a lab-only anchor), and fedflow_tsy_v0 at its frozen effective start 2010-12-02. The raw rows reproduce n, mean and sd at 1e-9.
- The cost columns are not price columns (`constants.PRICE_COLUMN`, tested). No `_raw` folder was opened.

### Sample end and the fence

| Row | Recorded sample end | Where |
|---|---|---|
| fedflow_tsy_v0, lhrev_letf_v0, hvix_nd_v0, apieia_ho_v0, cropsmooth_v0, fomcdrift_tsy_v0, fomcfx_v0, fomcpc_fx_v0, pretra_tsy_v0 | 2022-01-01 exclusive | `serve` or `serves` in the screen JSON |
| tsyauct_intra_ml_v0, dburst_rev_v1, xfut_tcn120_v0 | 2021-12-31 | no serve window in the screen JSON; the spec and the registry verdict say in-sample only (`dburst_rev_v1` max window end 2022-01-01, `xfut_fence_utc` 2022-01-01) |

None passes the fence, so none was left out for "sample passes the fence". The lab test `test_every_row_ends_inside_the_fence` re-reads this.

### NOT_LEARNABLE, with the reason and the test that keeps it honest (lab tree)

- **hvix_nd_v0.** The headline is 100 spike sessions inside a 2,827 session file (`headline` True on them) while `r_net1_bp` is filled on 2,193. A source keeps every filled row and cannot keep only the rows where a column is True. Test: `test_hvix_headline_is_a_row_filter_the_source_cannot_express`.
- **apieia_ho_v0.** One file holds the event rows and two control weekday groups; the headline (n 426) is the event rows with an empty `void`. Test: `test_apieia_headline_is_the_event_rows_with_an_empty_void`.
- **dburst_rev_v1.** The headline is the mean of the legs inside each of 413 episodes; summing per session gives a different statistic (mean -5.25 against the screen's -1.83). Test: `test_dburst_headline_is_the_mean_of_each_episode_not_a_session_sum`.
- **xfut_tcn120_v0.** The trade file holds `gross` and `cost0..2` in USD; net is gross less cost over a K of 100 million USD that the file lacks, and the screen's book is a 2,267 session daily book. Test: `test_xfut_headline_is_gross_less_cost_over_a_capital_the_file_lacks`.

Two of these (hvix, apieia) would become learnable with one new `SeriesSource` field that keeps only the rows where named columns hold named values (hvix: `headline` True; apieia: `kind` equal to `event` and `void` empty). That is a decision for series-core and the statistics reviewer; it is not made here.

## Anchors

Positive controls on the fixture copy (synthetic JSON at the lab's own paths) and on the lab tree (real JSON, 1e-9):
- n, mean and sd at 1 tick against `headline` (sd absent for cropsmooth_v0);
- the 0 and 2 tick means against the cost ladder where the screen records it (tsyauct_intra_ml_v0 has only the 0 tick);
- the benchmark of lhrev_letf_v0 against `controls_alone.LO_net_1tick` (n and mean);
- dates: independent calendar facts for fomcdrift_tsy_v0 (E+15), fomcfx_v0 (session before D), pretra_tsy_v0 (Friday, session before), lhrev_letf_v0 (first and last mark), fedflow_tsy_v0 (first valid event), cropsmooth_v0 (dates with both legs void absent, one leg void present). tsyauct_intra_ml_v0 and fomcpc_fx_v0 have none that a one session shift would break reliably (fomcpc's events per year are checked), so their date tests are named regression guards.

## Born failing

| Case | Test | Shown failing |
|---|---|---|
| a series dated one session late fails its date anchor | `test_a_series_dated_one_session_late_fails_its_date_anchor` (6 rows) | the mapping with fomcdrift_tsy_v0 dated at `date` fails `test_the_dates_meet_their_anchor` and this test's positive control |
| the 2-tick (or 0-tick) column read for 1 tick fails its anchor | `test_a_wrong_tick_column_read_for_one_tick_fails_its_anchor` (8 rows, 2 wrong columns) | pretra_tsy_v0 with `r2` for 1 tick fails `test_the_headline_is_reproduced` |
| a void event kept instead of left out fails n | `test_a_void_event_is_left_out_not_zeroed_or_kept` (cropsmooth_v0, fomcfx_v0) | filled void rows move n from 32 and 86 |
| a planted 2022 row | see below | |

Red runs recorded in the report: with the module removed every test fails to import; with the two mutations above, 5 tests fail and the other 97 pass.

**The planted 2022 row (third born-failing item).** The mapping cannot drop a row by date; the fence for these rows is `ResearchService.series` alone. `test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_check` (8 rows) is therefore named a regression guard, and `test_with_the_shared_check_stubbed_the_mapping_alone_does_not_drop_a_2022_row` records the limit (with `IS_END` stubbed, the 2022 row passes through). Likewise `test_regression_guard_an_event_on_a_non_session_is_refused_by_the_series_builder` relies on `hypothesis_series`.

## Fixtures

Synthetic. Each CSV copies the column layout of its lab file (header line only, checked against the lab by `test_fixture_layout_is_the_labs_layout`) with seeded made-up values on arbitrary NYSE sessions of 2012 and 2013 (not the real event calendars). Each JSON is marked `"synthetic": true` and carries only the paths the anchors read. They were written by a seeded script that is not kept.

## Appendix A addendum (new files and their fate)

| File | Fate |
|---|---|
| `backend/nq_terminal/series_sources/daily_event.py` | new module, kept; merged by `series_sources/__init__.py` (`PARTS`) |
| `backend/tests/test_series_daily_event.py` | new test file, kept |
| `backend/tests/fixtures/results/screens/daily_event/*.csv` (8) and `*.json` (8) | new synthetic fixtures, kept |
| this note | new, kept |

No route, no write path, no gate call, no price read. Real data read: the lab tree's screen JSON and the eight CSVs plus the four refused rows' CSVs, in-sample only (every row dated before 2022).

## Release fix 3 update: hvix_nd_v0 and apieia_ho_v0 are learned

The new `SeriesSource.keep_where` field says both samples: hvix_nd_v0 keeps the rows where `headline` is True (100), apieia_ho_v0
the rows where `kind` is `event` and `void` is empty (426). hvix_nd_v0 reads `exit_ts` and `r_fee_bp`, `r_net1_bp`,
`r_net2_bp` (basis points, 0, 1 and 2 ticks) with the zero fill moved from the NQ data start (2010-09-28) to the first valid session, 2010-10-11;
apieia_ho_v0 reads `date` and `n0`, `n1`, `n2` with the zero fill from the file's first row, 2010-10-05. Both are anchored at
1e-9 on the lab tree (n, mean and sd at 1 tick, the ladder at 0 and 2 ticks, and an exit or event date that equals the next
session after the signal day for every kept row). The two start dates are judgement calls for the statistics reviewer. Ten
of the twelve rows are learned; `dburst_rev_v1` and `xfut_tcn120_v0` stay `NOT_LEARNABLE` with the reasons above.
