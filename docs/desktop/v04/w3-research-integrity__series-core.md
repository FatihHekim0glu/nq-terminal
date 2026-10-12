# W3 series-core: the series source package and the unlearned list

Wave w3-research-integrity, slice series-core. Branch v04/w3-research-integrity, built on 16f56ec.

## What changed

- `SERIES_SOURCES` moved out of `backend/nq_terminal/constants.py` into the new package
  `backend/nq_terminal/series_sources`. The 22 rows of 0.3.3 are `BASE_SOURCES`, unchanged and first; the package then
  merges the `SOURCES` dict of `monthly_a.py`, `monthly_b.py` and `daily_event.py` in that order, skipping a module
  that is not there (a module that fails inside its own import still fails the import).
- `constants.py` keeps `SeriesSource`, `PortfolioRule`, `_per_cost`, `_trades` and `USD_TRADE` (the three series
  slices build on them) and re-exports `SERIES_SOURCES` through a module `__getattr__`, so
  `analytics/series.py:59`, `services/research.py:51`, `services/spa_family.py:44` and `api/analytics.py:353` work
  unchanged. The re-export is lazy because the package imports `constants` for the type: an import at load time
  would be a cycle whichever module loads first (a test imports the package first in a clean module table).
- `NOT_LEARNABLE` maps cotliq_v0, mpslope_ym_v0, wkndgap_fx_v0, wkndshort_v0 (weekly, P = 52) and finroll_tff_v0
  (quarterly, P = 4) to "outside convention C2 (P = 252 or 12, docs/ANALYTICS_CATALOG.md:16); needs a statistics
  decision (O23)". A module may also export its own optional `NOT_LEARNABLE` dict (for example a row whose sample
  passes the fence); the package merges it.
- The package refuses to load (`SeriesRegistryError`) when a name is learned twice, learned and not learnable, an
  entry is not a `SeriesSource`, or a not learnable row has no reason.
- `DeflatedView` gains `unlearned: list[UnlearnedRow]` (name and reason), filled by `deflated_view` from the names
  `registry_trials` already collects: the NOT_LEARNABLE reason, or "no series source yet". A model validator refuses
  a view whose list and N note disagree (a name in the note missing from the list, a name in the list the note does
  not give, or a name twice). The N note text is unchanged.
- REG: `LearnedCount` sits under the DSR note in a wide panel: "N counts L of R registered rows." (L is `n_trials`,
  R adds the list) and a toggle that shows each left out row with its reason. It reads the deflated answer REG
  already asks for; no new route, and the request still waits for the registry and the hypotheses
  (`deflatedRequestable`, unchanged). The toggle is a native button and a roving item, so it adds no Tab stop.
- QA: `crosscheck/reference.py` gains the registry completeness reference: one reference per registered row (the
  word "learned or NOT_LEARNABLE"), against the coverage recomputed in QA from the dumped lists. The backend dump
  writer is in `backend/tests/test_series_sources_registry.py` (kind `registry_completeness`, prefix
  `nqt_w3_registry_`).

Not changed: the deflated maths, the SPA family rule, the SR0 lines, the deflated route.

## Lab state when this slice finished

With the three series modules as they stood at the end of this slice (monthly_a 9 learned and 1 not learnable,
monthly_b 10 learned, daily_event 8 learned and 4 not learnable, each through its own optional `NOT_LEARNABLE`), the
lab registry's 59 registered rows were all covered: 49 learned and 10 not learnable. Built on the lab tree with no
bar service, `registry_trials` gave 49 trials and 10 unlearned names, and the view with its list validated (4.2 s
cold, scipy included). The completeness dump gave 59 of 59 covered. These counts move if the series slices change
their modules before the merge.

## Appendix A addendum (new modules and files, and their fate)

| Path | Kind | Fate |
| --- | --- | --- |
| `backend/nq_terminal/series_sources/__init__.py` | new package | kept: the series source table and NOT_LEARNABLE |
| `backend/nq_terminal/models/analytics_p1.py` `UnlearnedRow` | new response model | kept: in the contract via `DeflatedView.unlearned` |
| `backend/tests/test_series_sources_registry.py` | new test and dump writer | kept |
| `qa/tests/test_registry_completeness.py` | new QA test | kept |
| `web/src/screens/reg/LearnedCount.tsx` | new component | kept |
| `web/src/screens/reg/LearnedCount.test.tsx` | new test | kept |
| dump kind `registry_completeness` | new QA dump kind | kept; needs the wiring below |

No route was added or removed.

## Wiring for the merge

1. `qa/crosscheck/dumps.py`: add `"registry_completeness": ("registered", "learned", "not_learnable")` to
   `BUNDLE_INPUTS`, and a line for it in the module docstring.
2. `qa/crosscheck/compare.py`: import `registry_completeness_references` and `registry_completeness_values` from
   `crosscheck.reference`; add `"registry_completeness": registry_completeness_references` to `BUNDLE_REFERENCES`;
   in `compare_bundle`, for that kind use
   `{**dump.values, "ours": {**dump.values.get("ours", {}), **registry_completeness_values(dump.inputs)}}` as the
   values (the same pattern as `cached_values`). Without this step every row is a SKIP and `--strict` fails.
3. Regenerate the contract (`pnpm --dir web gen:api`): `DeflatedView.unlearned` and `UnlearnedRow` are new.
4. After the regeneration, `unlearned` is a required field of `Schemas['DeflatedView']`, so add `unlearned: []` to
   `DEFLATED_REAL_BODY` in `web/src/screens/reg/deflatedFixtures.ts` and to `SYNTHETIC_VIEW` in
   `web/src/screens/reg/effectiveN.fixtures.ts` (or regenerate them from their sources), or `test:types` fails.
5. Rewrite `qa/golden/p2_neff_served.json` with `NQT_UPDATE_NEFF_BRIDGE=1` and
   `backend/tests/test_p2_neff_bridge.py` (the served view now has `"unlearned": []`); the browser mirror test reads
   the same file.
6. Nothing to add for the rows the series slices leave unlearned while they list them in their own module's
   optional `NOT_LEARNABLE` (they did at the end of this slice); a row only in a note goes into `BASE_NOT_LEARNABLE`.
7. Optional: `services/spa_family.py` `NO_SOURCE_REASON` still says to add the source "in
   nq_terminal/constants.py"; the table now lives in `nq_terminal/series_sources`.

## Unverified

- `pnpm check:api` and the full suites (merge steps).
- The strict cross-check over the lab dump, which waits on the other series slices and the wiring above.
- The web tests ran through a link farm, not the main tree's node_modules: at about 15:54 on 11 October the top level
  of `C:/Users/Fatih Hekimoglu/nq-lab/terminal/web/node_modules` lost every package link (only `.pnpm` and the
  hidden folders were left; this slice ran no pnpm command). The worktree root `node_modules` (git-ignored) holds
  one junction per direct dependency into that `.pnpm` folder, so vitest and tsc resolve; nothing was installed.
- `tsc -p tsconfig.app.json --noEmit` there reported four errors, all in files outside this slice
  (`src/chrome/Workspace.tsx` three, `src/chrome/CommandLine.sheet.tsx` one); none in the files changed here.

## Release fix 3 update

The lab registry's 59 registered rows are now 52 learned and 7 not learnable (the five outside convention C2, `dburst_rev_v1`
and `xfut_tcn120_v0`). `constants.SeriesSource` has a `keep_where` field (rows kept where named columns hold named values),
applied in `ResearchService._series_frame`; see the merge note's release fix 3 section. The figures under "Lab state when this
slice finished" are the first pass's.
