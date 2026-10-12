# w3-research-integrity, slice series-monthly-a

Ten monthly screens, one reviewed mapping each: airfx_v0, cmax_v0, crushdev_v0, eqvrp_xasset_v0, fxval_ppp_v0,
gotobi6j_v0, gvzvrp_pm_v0, hi52_v0, liqbias_v0, metals_eq_ym_v1. Nine are learned; airfx_v0 is not learnable as the
source type stands, and its reason and the change that would learn it are below.

## New files and their fate (for the 03 Appendix A addendum)

| File | Lines | Fate | Note |
|---|---|---|---|
| `backend/nq_terminal/series_sources/monthly_a.py` | 100 | new | `SOURCES` (9 rows) and `NOT_LEARNABLE` (airfx_v0); the series-core package merges both |
| `backend/tests/test_series_monthly_a.py` | 580 | new | 188 cases: 103 on the fixture copy, 85 on the lab tree under `-m lab_only` |
| `backend/tests/fixtures/results/screens/monthly_a/*.csv` (10) | 440 KB | new | synthetic: the lab file's column names and order, made-up values |
| `backend/tests/fixtures/results/screens/monthly_a/*.json` (10) | 10 KB | new | synthetic screen JSON holding only the keys the anchors read |
| `backend/tests/fixtures/results/screens/monthly_a/make_fixtures.py` | 315 | new | seeded generator (seed 20261011) that writes the two kinds of file above; its output is byte-identical on a second run |
| `docs/desktop/v04/w3-research-integrity__series-monthly-a.md` | this note | new | |

No route, no model, no copy and no contract file is touched.

## The mapping, row by row

Common to all nine: kind `monthly` (P = 12), time rule `MONTH_END_SESSION` (the `YYYY-MM` label is dated at the last
NYSE session of that month), the cost columns at 0, 1 and 2 era ticks per side where the file holds them. The fence is
not enforced by any mapping (see "The fence").

| Row | Time column and guard | Value columns (cost: column) | Unit | Benchmark | Void handling |
|---|---|---|---|---|---|
| cmax_v0 | `label`, guard `end` | 0, 1, 2: `r_cmax_{k}` | return on capital per month | 1: `lo_1` (cskew_v0's long-only book) | none |
| crushdev_v0 | `month`, no guard | 0, 1, 2: `r_{k}tick` | return on capital per month | 1: `const` (constant long crush book) | none; the first three months are flat at 0 and count in the headline's 123 |
| eqvrp_xasset_v0 | `label`, guard `end` | 0, 1, 2: `r_{k}` | return on capital per month | 1: `cb_1` (constant-sign basket 6E, 6B long, 6J short) | none; `vp_missing` months keep their zero-weight return, the headline n is 120 |
| fxval_ppp_v0 | `label`, guard `end` | 0, 1, 2: `r_{k}` | return on capital per month | 1: `cb_1` (constant short-dollar basket) | none |
| gotobi6j_v0 | `month`, no guard | 1: `r` | basis points of one 6J notional per month (sum of the month's gotobi windows), not a return on capital | 1: `lo` (short 6J held all month) | none for the book; `lo` is empty in 2014-12 and 2015-01 (`lo_void` holds the reason), so the benchmark is empty in those two months and the book keeps all 132 |
| gvzvrp_pm_v0 | `label`, guard `end` | 0, 1, 2: `r_{k}` | return on capital per month | 1: `cb_1` (constant long gold and silver) | none; the void formation 2014-10 is a zero row inside the headline's 120 |
| hi52_v0 | `label`, guard `end` | 0, 1, 2: `r_hi52_{k}` | return on capital per month | 1: `lo_1` (cskew_v0's long-only book) | none |
| liqbias_v0 | `month`, no guard | 0, 1, 2: `r{k}` | return on capital per month | 1: `D` (window-specificity control, gross of costs) | none; a month with no valid event is a 0 row of the headline's 132 |
| metals_eq_ym_v1 | `label`, no guard | 0, 1, 2: `r_T_t{k}` | return on capital per month | 0, 1, 2: `r_C_t{k}` (constant 1x YM book) | `void` (True drops the month), as vrp_eq_v0 does; the lab file has none, so the headline n of 111 is every row |

### Why each choice

- **Dating.** Every file here is a calendar of holding windows: a label `m` holds `(close e_m, close e_{m+1}]`, and
  `e_{m+1}` is the first session of the next month. The reviewed rule of dtsmom_v0 dates the row at the last session of
  `m`, and the files with an `end` column use it as the guard (a stamp may not lie after the day the return is
  complete). cmax_v0, eqvrp_xasset_v0, fxval_ppp_v0, gvzvrp_pm_v0 and hi52_v0 have `end`. crushdev_v0 sums a daily book
  per calendar month, so its month closes on the month's last session. liqbias_v0 books an event in the month of its
  exit (L-1) and gotobi6j_v0 in the month of its day, and the lab-only test `test_the_event_files_prove_the_dating...`
  rebuilds the monthly column from the event files (liqbias `net1 / 1e8` by exit month: largest difference 1e-16;
  gotobi `n1` over valid XNYS gotobi days: 1e-14) and checks that no event lies after its month's last NYSE session.
  metals_eq_ym_v1 labels a holding month `h` covering `(L_m, L_{m+1}]`, which closes at the last session of `h`.
- **Costs.** All three costs where the screen records them. gotobi6j_v0 records one (1 tick) in the monthly file; its
  0 to 3 tick ladder lives in the events file and is not served.
- **Benchmarks.** The control book of the same legs that the screen's own control regression lists first: the
  long-only commodity book (cmax_v0, hi52_v0), the constant basket (eqvrp_xasset_v0, fxval_ppp_v0, gvzvrp_pm_v0), the
  constant crush book (crushdev_v0), the constant YM book (metals_eq_ym_v1), the all-month short 6J drift book
  (gotobi6j_v0). Factor sleeves and other strategies (carry, TSMOM, LOWVAR, XMOM, the second control) are not
  benchmarks and are left out. The benchmark is mapped only at the cost the screen records it at (1 tick for all but
  metals_eq_ym_v1, which has all three).
- **cmax_v0 and hi52_v0 benchmark.** Both files carry cskew_v0's long-only book as `lo_1`. The lab-only test
  `test_the_long_only_benchmark_is_cskew_v0s_own_book` compares each served benchmark with cskew_v0's served benchmark:
  same dates, equal to 1e-12.

### Choices for the statistics reviewer

1. **Dating of a return that completes on the first session of the next month.** The nine rows follow dtsmom_v0, so
   the series is dated up to one session before the return is complete, and never after it (the guard). The block
   anchors are sensitive to this by one session only at block edges.
2. **liqbias_v0 benchmark `D`.** `D` is the screen's own control (the event return less the pre-window drift, gross of
   costs), not a long-only book. It is mapped because the task names it and the screen tests it as control C1, with its
   label saying so. A reviewer may prefer no benchmark: delete the `bench` arguments of that one line.
3. **gotobi6j_v0 unit and length.** The monthly value is a sum of per-event basis points of one contract notional,
   not a return on a capital K, so the unit does not begin "return on capital" and the terminal shows no CAGR or total
   return for it. P = 12 is the monthly book's period. The screen's own monthly Sharpe (0.39785, `drift_P1b`) is on the
   130 months where `lo` exists; the series keeps the book's 132 months (the book is valid in all of them) and the
   anchor takes the Sharpe over the 130 rows where the benchmark is present. The per-event mean (headline 0.7115 bp
   over 787 events) is recovered from the series as the monthly sum over the event count.
4. **crushdev_v0 benchmark.** `const` (CONST of control C1, the first regressor) rather than `soy3` (the soy long-only
   book of the dtsmom code). Both are recorded; one is served.

## The anchors

One check runs on both trees: the served series is compared with what the screen JSON records, at 1e-9 relative.
Every row anchors at least one dated quantity, because a mean ignores dates.

| Row | Recorded quantities read (JSON paths) |
|---|---|
| cmax_v0, hi52_v0 | `headline.n`, mean at 0/1/2 ticks (`cost_stress.mean_pct_by_ticks`), `headline.sharpe`, three blocks (`blocks`: n, mean) |
| crushdev_v0 | `headline.n`, `cost_ladder.{0,1,2}_tick` mean and Sharpe, three blocks, the benchmark (`const_book`: mean, Sharpe) |
| eqvrp_xasset_v0, gvzvrp_pm_v0 | `headline.n`, `costs.mean_pct` and `costs.sharpe` at 0/1/2, three blocks, the benchmark (`constant_basket`: mean, Sharpe) |
| fxval_ppp_v0 | the same, with the benchmark mean from `control_means_pct.CB` |
| liqbias_v0 | `headline.n`, `cost_ladder_mean_pct`, `headline.sharpe_ann`, three blocks, the benchmark (`control`: mean, Sharpe) |
| metals_eq_ym_v1 | `headline.n`, `means_pct_per_month.{k}.T` and `.C` at 0/1/2, the headline regression (`headline.a`, `.b`), the 2-tick intercept (`P3_2tick.a`) and the three block intercepts (`P2_blocks`) |
| gotobi6j_v0 | `n_events`, per-event mean (`headline.mean`), per-event block means (`blocks`), `drift_P1b` (n, intercept, slope, monthly Sharpe) |

On the lab tree all nine reproduce at 1e-9 (85 lab-only cases passed). The fixture JSON is made up and computed from
the synthetic CSV, so the fixture run proves the mapping machinery (dating, guard, void, benchmark, cost column) and the
lab run proves the numbers. The fixtures copy each lab file's column names and order (a lab-only test compares the
headers) and no value.

## Born-failing evidence

Each guard has a case that feeds it the broken state, on both trees (the fixture run and, under `-m lab_only`, the real
files). Before the mapping existed the whole file failed at import (collection error: no `monthly_a`).

| Born-failing case | Broken state | What fails |
|---|---|---|
| `test_a_month_shifted_by_one_session_fails_the_block_anchor` (9 rows x 2 trees) | each month dated at the next NYSE session | a block count or mean (for example `block 2012-13 count: served 23.0, recorded 24.0`) |
| `test_the_two_tick_column_read_for_one_tick_fails_the_anchor` (8 rows x 2 trees) | cost 1 served from the cost 2 column | `mean at 1 ticks: served 0.00303828..., recorded 0.00351648...` (cmax_v0, lab) |
| `test_the_benchmark_column_read_as_the_value_fails_the_anchor` (9 x 2) | value and benchmark columns swapped | the value mean (gotobi6j_v0: refused, 130 months against 132 event rows) |
| `test_a_row_dated_after_its_guard_column_is_refused` (5 rows) | a row whose `end` precedes its dated session | `ResearchDataError`; with the guard removed the same file loads |
| `test_a_metals_void_month_is_left_out_not_zeroed` | the void flag flipped | one more row in the series |
| `test_with_the_shared_fence_stubbed_the_planted_row_is_served` (9 rows) | a planted 2022-01 row, fence stubbed to 2100 | the row is in the series: the fence, not the mapping, drops it |
| `test_a_screen_whose_sample_passes_the_fence_is_seen` | a served window ending 2022-03-01 | reported as past the fence |

Mutation runs (a scratch plugin breaking one mapping in place, not committed): cmax_v0 with the 2-tick column for 1
tick, gvzvrp_pm_v0 and fxval_ppp_v0 dated at `end`, hi52_v0 without its guard, metals_eq_ym_v1 without `void_column`
and gotobi6j_v0 with a wrong benchmark each failed the anchor or the mapping test, on the fixtures and, where run, on
the lab tree.

### The fence, and a regression guard

No `SeriesSource` field can drop a row by date, so no mapping here can "still drop" a planted 2022 row once the shared
check is gone: all nine rely on the check in `ResearchService.series` (a stamp on or after 2022-01-01 is an error).
`test_regression_guard_a_planted_2022_row_is_refused_by_the_shared_fence` (9 cases) is therefore a **regression guard**,
as the task asks to be named: it passes on today's tree. Its stubbed twin above shows it can fail. The lab-only tests
also read each file's label column (largest label below 2022-01) and each screen JSON's recorded `serve` end (not after
2022-01-01, the exclusive fence): `test_every_learned_row_has_a_recorded_sample_that_stops_at_the_fence`. No learned
row's sample passes the fence, so no row was left out for that reason ("sample passes the fence" applies to none of the
ten).

## Not learned: airfx_v0

The screen leaves out the flat month 2014-10 (`held` False, every return 0.0): headline n 118, registry n 118, 119 rows
in the file. `SeriesSource` can leave out a row only through a boolean column whose True means void (`void_column`) or
an empty value, and `held` is the opposite polarity with a literal 0.0. Mapped as it stands, the series would hold 119
months with a spurious zero. `NOT_LEARNABLE["airfx_v0"]` says so; the fixture test shows the 119 against the recorded
118, and a lab-only test confirms the one-row difference on the real file (`counts.flat_months`).

To learn it, two shared files change (neither is in this slice):

1. `backend/nq_terminal/constants.py` (`SeriesSource`): a field `keep_column: str | None = None`, "a boolean column;
   a row where it is false is left out".
2. `backend/nq_terminal/services/research.py` (`_series_frame`): add `keep_column` to `extra`, refuse a non-boolean column
   as `void_column` is, and `frame = frame.loc[frame[source.keep_column]]` beside the `void_column` block.

Then this line joins `SOURCES` (and `airfx_v0` leaves `NOT_LEARNABLE`):

```python
"airfx_v0": SeriesSource("airfx_v0_monthly.csv", "label", MappingProxyType({1: "r_air_1tick", 2: "r_air_2tick"}),
                         CAPITAL_MONTH, "monthly", time_rule=MONTH_END_SESSION, keep_column="held"),
```

No benchmark (the file's controls are the DOL, carry, TSMOM, illiquidity and transitory-impact sleeves, factors and not
a book of the same legs), no guard (no `end` column), 1 and 2 ticks only. Checked by hand on the lab file with `held`
applied: n 118, mean 0.001375011122881336 against the recorded `headline.mean` 0.0013750111228813461, 2-tick mean
0.0007844201271186253 against `checks.mean_2tick` 0.0007844201271186343. Its anchor would read `headline.n`,
`headline.mean`, `headline.sharpe_ann`, `checks.mean_2tick` and the three `blocks` (keys `2012-01_2013-12`,
`2014-01_2017-12`, `2018-01_2021-11`, fields n and mean).

## Wiring for the merge step

1. **Package merge.** Already done by the series-core package: `nq_terminal.series_sources` imports `monthly_a`; with
   this module the merged table holds 49 rows and `NOT_LEARNABLE` holds `airfx_v0` (checked by import). Nothing to add.
2. **Marker.** Register `lab_only` (for example `config.addinivalue_line("markers", "lab_only: reads the real lab
   tree, run with -m lab_only")` in `backend/tests/conftest.py` `pytest_configure`) to silence
   `PytestUnknownMarkWarning`. The tests work without it. The lab cases skip unless `-m lab_only` selects them, so the
   plain run is the fixture copy.
3. **Optional, `backend/nq_terminal/analytics/series.py` `RECORDED_COUNTS`:** the screens record their month count, which
   the anchors above already equal to the served length (n compared in every case). Add
   `cmax_v0, hi52_v0, crushdev_v0, eqvrp_xasset_v0, fxval_ppp_v0, gvzvrp_pm_v0, liqbias_v0: ("headline", "n")`
   and `metals_eq_ym_v1: ("headline", "n")`. gotobi6j_v0 has no entry (its recorded n is 787 events, not 132 months).
4. **SPA family.** None of these rows is in one NQ contract, USD, daily, so none joins the SPA family; a test that
   lists the family's new members should list none from this part.
5. **Shared-registry patch in the test.** `test_series_monthly_a.py` adds its rows to `research.SERIES_SOURCES` and
   `series.SERIES_SOURCES` itself (fixture `merged`), so it passes whether or not the package is merged; after the merge
   the patch changes nothing.

## Run

```
cd "C:/Users/Fatih Hekimoglu/nq-lab"   (PYTHONPATH=E:/projects/nq-lab/wt-w3/backend)
"C:/Users/Fatih Hekimoglu/nq-lab/.venv/Scripts/python.exe" -m pytest E:/projects/nq-lab/wt-w3/backend/tests/test_series_monthly_a.py          # 103 passed, 85 skipped
"C:/Users/Fatih Hekimoglu/nq-lab/.venv/Scripts/python.exe" -m pytest E:/projects/nq-lab/wt-w3/backend/tests/test_series_monthly_a.py -m lab_only   # 85 passed
```

`nq_terminal.__file__` was confirmed under `E:/projects/nq-lab/wt-w3`. TEMP and TMP pointed at
`D:/dev/tmp/v04-w3-research-integrity-series-monthly-a`; no slot was needed (this file only, no Playwright, no full
suite). The lab files were read only for in-sample months (labels 2011-01 to 2021-12); no row dated 2022-01-01 or later
was opened, no price was read, nothing was written under the lab's `results/`.

## Unverified

- The statistics reviewer has not signed these mappings; the four judgement calls above are flagged for that.
- The fixtures prove machinery, not numbers; the numbers are proved by the lab-only run, which needs the lab tree and so
  does not run in the public CI.
- Not run: the full backend suite and the qa crosscheck (merge steps).

## Release fix 3 update: airfx_v0 is learned

`SeriesSource.keep_where` (constants.py) and its rule in `ResearchService._series_frame` landed in the wave's release fix 3, as
this note proposed under "Not learned: airfx_v0", with one change: the field is a mapping from a column to the value it must
hold, so the line reads `keep_where={"held": True}`. `airfx_v0` is in `SOURCES`, `NOT_LEARNABLE` is empty, all ten rows are
learned and every one is anchored at 1e-9 on the lab tree. The fixture JSON now records `checks.mean_2tick`,
`headline.sharpe_ann` and the three blocks. The merged table holds 52 rows. The sections above that describe airfx_v0 as not
learnable are the record of the first pass.
