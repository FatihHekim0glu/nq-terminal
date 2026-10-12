# w1-startup-backend, slice home-window: the cold run index leaves HOME's first-launch window

Source: startup.md 7.3. On a first launch the HOME stage is 1.92 s, and `runs` is 1.06 s of it (0.72 to 1.30) as the second
of five serial prewarm tasks. HOME ready lands within 24 ms of the stage's end. No HOME-ready condition needs the run
list: the probe (`desktop/harness/lib/probe.js`) waits for GP's chart, MON's grid, EQ's figures and REG's grid.

## What changed

- `backend/nq_terminal/api/home_prewarm.py`: `runs` moved from `home_tasks` to `later_tasks`, second after `warm_stats`
  (`[warm_stats, runs, ledger, deflated, eq_bootstrap]`). `home_tasks` is now `[warm, two_day, universe, gp_bars]`.
  `services/prewarm.py` is untouched.
- `web/src/screens/gp/useGpData.ts`: GP passes `GpRequest.deferRuns` while the Fills picker has not been opened, and a deferred request asks for
  `/api/runs` only when `runId` is non-null (a run is already chosen, so the picker can show its name). It uses the same query key
  as `useRuns` (`['api', '/api/runs', {}]`), so the other screens share the cache entry. The record watch's reader, which is
  gated by `useQuietReady`, loads that entry once the page has gone quiet, so the picker's list is normally there before it
  is opened. (The builder's version gated GP itself with `useQuietReady`; the merge dropped that, see the merge note: a
  second user of the gate made it a shared chunk and put the shell 1 to 15 bytes over its 110000 byte target.)
- `web/src/screens/gp/GpScreen.tsx`: the screen root listens (capture phase) for a click or a key (not Tab) on the combobox
  labelled "Fills" and stops deferring the run list. `GpControls.tsx` and `chrome/Field.tsx` are not owned and not touched.
- `web/src/chrome/RecordWatch.live.tsx`: no change. See the finding below.

Every response body is unchanged: no route, model or serialiser was touched, and the golden test
`test_home_panel_lazy_relative.py` (which pins `qa/golden/home_panels_v031.json`) passes.

## Finding: RecordWatch holds no busy state

`RecordWatchReader` and `RecordWatchReads` both return `null`; the only element the watch renders is the status-line
segment (`WatchSegment`), which carries no `aria-busy`. `grep aria-busy` over `RecordWatch.*.tsx` finds nothing. The reader
is already behind `useIdleReady` (App) and `useQuietReady` (the reader): it sends none of its six GETs, `/api/runs`
included, until the page's queries have been quiet for 500 ms. So it cannot hold the probe's `[aria-busy="true"]:not(td)`
check. Before this change GP's request was the early one and the reader hit the cached entry; now the reader's request is
the first `/api/runs` of a HOME page, sent after HOME's last data response, and GP's picker shares it.

## Tests and born-failing evidence

| File | Case | Status on the 0.3.3 tree |
|---|---|---|
| `backend/tests/test_home_prewarm.py` | `test_born_failing_runs_is_a_later_task`, `test_home_task_order`, `test_born_failing_nothing_home_never_asks_for_waits_until_every_home_task_ran`, `test_born_failing_the_run_index_is_built_after_the_home_stage_and_before_the_ledger`, the list checks and the start-switch checks | 7 failed before the change |
| `backend/tests/test_home_first_launch_imports.py` | `test_born_failing_no_run_index_is_built_before_homes_last_data_response` (both child modes) | 2 failed before the change |
| `web/src/screens/gp/useGpData.test.ts` | no `/api/runs` at mount nor later until the picker is opened; the list another reader loaded into the shared entry is shown | failed before the change |
| `web/src/screens/gp/GpScreen.test.tsx` | the panel sends no `/api/runs` while loading; GP and the record watch send one, after the panel data; opening the picker (click, key) asks at once; another field does not; no busy state | 5 failed before the change |
| `web/src/chrome/RecordWatch.live.test.tsx` | reader sends no `/api/runs` while a HOME query is in flight and shows no `aria-busy` | regression guard (the reader was already gated) |
| `web/src/screens/gp/useGpData.test.ts` | asks at once when the picker is opened or a run is chosen; asks once | regression guards (0.3.3 asked at mount) |

The first-launch test counts builds of the run index (`runs._record_run_index`, which only a result-cache miss reaches) at
every point of the HOME window. `/api/runs` is moved out of `HOME_REQUESTS` into a request sent after the deflated Sharpe,
as the page now sends it.

## For the 03 Appendix A addendum

No new module, route or product file. New test file: `web/src/screens/gp/useGpData.test.ts`. New prop: `GpRequest.deferRuns`
(optional, internal to the GP screen). Fate of the 0.3.3 order test constants: `HOME_FIRST` and `AFTER_HOME` in
`test_home_prewarm.py` now name the new split.

## Unverified here

- The first-launch HOME stage time (target 1.0 s or less): needs the A/B labs and a real-data run, which this slice does not
  start. The saving is the estimate in startup.md 7.3 (0.5 to 0.9 s).
- `web/e2e/gp.spec.ts` (the "fills overlay from a run picked in the panel" case clicks the Fills combobox and then an option;
  the option list now fills when the answer arrives) runs at merge.
- Bundle budgets: run at merge; see the merge note (the shell target has a margin below the noise of chunk hashes).
