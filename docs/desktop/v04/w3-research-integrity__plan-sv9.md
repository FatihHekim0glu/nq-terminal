# Wave w3-research-integrity, slice plan-sv9: PLAN and SV9 served from the backend

Catalogue row: `docs/ANALYTICS_CATALOG.md` SV9 (P1), "power of the registered tests". Roadmap: `research_ux.md` item 2.
SV9 was the last C8 client-phase exception: the browser computed the table (`web/src/quant/power.ts` and `normal.ts`)
and the backend mirror was pending. This slice serves the table, adds the pre-registration planner on the same maths,
and moves the PowerPanel on MT to the served table. It also fixes the flaky PowerPanel case.

## What is served

Both routes are GET only and sit on the existing analytics router (`api/analytics.py`). Neither reads a price or a
result file beyond the one count named below, so neither can add a line to the OOS access log.

### `GET /api/analytics/power` (SV9)

The table the browser used to compute: one row per trial of the Deflated Sharpe view, in its order, for the registry's
family alpha (0.05) and k (the registered hypotheses with a p value, as `/api/multiple-testing` counts them). The rows
come from the same cached body as `/api/analytics/deflated` (`cached_deflated`), so a trial that cannot be built refuses
this route with the same 503. Per row: `periods`, `n`, `years`, the served annual Sharpe, the minimum detectable annual
Sharpe at alpha and at alpha / k (power 0.8), the Sharpe over the alpha / k figure, and the power at the fixed reference
Sharpe 0.5 at both alphas. A figure that does not exist is null. Tag `[POST HOC]`, Basis A.

### `GET /api/analytics/plan` (the planner)

No context, no data. The inputs are query parameters, each with a bound; one step outside a bound is a 422.

| Parameter | Range | Meaning |
|---|---|---|
| `periods` | 252, 52, 12 or 4 (default 252) | observations a year; 365 is refused |
| `n` | 2 to 100000 | planned observations (events for an event design) |
| `years` | 0.5 to 100 | planned years; `n` is `years x periods` rounded up. Exactly one of `n` and `years` |
| `k` | 0 to 1000 | a typed family size: tests already in the family |
| `alpha` | 0.001 to 0.25 (default 0.05) | one-sided single-test alpha |
| `sharpe` | 0 to 5 | a typed annual Sharpe to read power at |
| `event_sd` | 0.01 to 10000 | standard deviation per event, in the unit the mean is wanted in |

Answer (`PlanView`): the book (`n`, `years`, `periods`, `alpha`), the registry's family size (`family_k_registry`, 59 on
the real files, null with a `registry_note` when the registry cannot be read), the figures at the single-test alpha
(`nominal`), and one `slot` per family size: the registry's, and the typed one when it differs.

Each slot is the next slot of its family. A family of k tests puts the planned test at slot k + 1, so:

- the Bonferroni bar is alpha / (k + 1);
- the Holm bar lies between alpha / (k + 1) (the planned test has the smallest p value of the family) and alpha (it
  has the largest and every other hypothesis was rejected first), served as `holm_strictest` and `holm_loosest`;
- `at_slot` is the design at the Bonferroni bar of the slot.

A design point (`nominal` and each `at_slot`) holds the bar and its z, the minimum detectable annual Sharpe for power
0.8, the power at the reference Sharpe 0.5 and at the typed Sharpe, the observations that give power 0.8 at each, and,
given `event_sd`, the detectable mean per event.

The wording is SV9's: best case, with normal and independent returns, one sided. The note travels in the body.

## The maths

With z the standard normal quantile, Phi its distribution function, and `years = n / periods`:

- minimum detectable Sharpe = (z(1 - alpha) + z(power)) / sqrt(years)
- power at Sharpe S = Phi(S x sqrt(years) - z(1 - alpha))
- years needed for Sharpe S = ((z(1 - alpha) + z(power)) / S) ^ 2, observations = that times `periods`, rounded up
  after rounding to nine decimals (a whole number does not tip over on float noise)
- detectable mean per event = (z(1 - alpha) + z(power)) x sd / sqrt(n)

`analytics/power.py` is standard library only. `normal_cdf` is `0.5 x erfc(-x / sqrt 2)`, so the lower tail keeps full
relative accuracy; `normal_quantile` is `statistics.NormalDist.inv_cdf`, which is Wichura's AS 241 (the algorithm of
`web/src/quant/normal.ts`). z(1 - alpha) is written as -z(alpha) so a tiny alpha keeps its digits. scipy is not
imported (the start path does not pay for it). Mapping for the statistics review: name SV9 and the planner; time rule
none (a design, not a series); unit annual Sharpe, or the event unit for the mean; void handling: n at most 1, periods
not positive, alpha or power outside (0, 1), or a non-finite input gives NaN in the function and null in the body;
anchor `qa/golden/p12_power.json` (scipy.stats.norm) at 1e-12 relative, and `qa/crosscheck/p12_plan.py` over a grid.

## PowerPanel and the flake

`PowerPanel` keeps its props (`view: DeflatedView`) and now reads the served table through `usePowerTable.ts`, which
asks `GET /api/analytics/power` once the Deflated Sharpe view it is computed from has arrived and maps the body onto the
`PowerView` that `powerModel.ts` formats. The table is unchanged, and so are its summary and its wording, except the provenance line,
which now says the table is served (`copy/plan.ts`, `POWER_SERVED`). The panel no longer reads `/api/multiple-testing`.

The flaky case 'is a region after the Deflated Sharpe region' (red on run 37691474042, green on the next run of the same
code) failed with 'Unable to find role="region"' after 1373 ms: it is the first case of the file, pays the cold start
(lazy chart stand-in, the first accessible-name queries on a large table) and the testing-library default wait for a
region is one second. The file now sets `asyncUtilTimeout` to 5000 ms, as the other lazy-screen files do, and a new case
serves the table 1200 ms late and finds the region (it fails without the setting, with the same error as CI).

## Tests and evidence

- `backend/tests/test_power.py`: 28 cases; the normal cdf and quantile, the MDE and the power equal `qa/golden/p12_power.json` at 1e-12.
- `backend/tests/test_plan_route.py`: 27 cases; bounds, the served plan equal to scipy over the whole grid (3456
  designs through the function, every 37th through HTTP), the served table equal to the golden, no price read.
- `qa/tests/test_p12_plan.py`: 9 cases (run with `uv run --frozen pytest`).
- `web/src/screens/plan/planModel.test.ts` (23 and 1 skipped until the contract lists the route),
  `PlanScreen.test.tsx` (16), `web/src/screens/reg/PowerPanel.test.tsx` (21, one of them the mirror equality of the
  served table with the browser reference to 1e-12).
- Born failing, each fed the broken state: a two-sided quantile (10 backend cases fail), 365 periods a year accepted (1),
  a Bonferroni bar for the family size instead of the next slot (5, and 6 on the route), every bound one step wider
  (1 per bound), and the slow first answer without the longer wait (the CI error).
- The PowerPanel case 'is a region after the Deflated Sharpe region' passed 50 runs in a row, each in its own vitest
  process.

## Record for the 03 Appendix A addendum

| Item | Kind | Fate |
|---|---|---|
| `backend/nq_terminal/analytics/power.py` | new module | kept; pure, standard library only |
| `backend/nq_terminal/models/power.py` | new module | kept; `PowerTable`, `PlanView`, `PeriodsPerYear` |
| `GET /api/analytics/power` | new route | kept; replaces the browser computation on MT |
| `GET /api/analytics/plan` | new route | kept; the planner |
| `registry_family_k` in `api/analytics.py` | new function | kept; the planner's one count |
| `web/src/screens/plan/` | new screen folder | kept; registered by the merge step |
| `web/src/screens/plan/servedGet.ts` | new file | temporary; goes when the contract lists the two routes |
| `web/src/screens/reg/usePowerTable.ts` | new hook | kept; its local interfaces become `Schemas['PowerTable']` |
| `web/src/copy/plan.ts` | new copy module | kept; also holds the PLAN help page text for the merge step |
| `web/src/screens/plan/powerTable.fixtures.ts` | new fixture | kept; captured from the backend's own functions |
| `qa/crosscheck/p12_plan.py`, `qa/tests/test_p12_plan.py` | new reference | kept; the merge step wires it into `compare.py` |
| `web/src/quant/power.ts`, `normal.ts` | existing | kept as test references; REG 92 Evidence (`evidenceModel.ts`, `evidenceMapModel.ts`) still imports them, so they are not yet test only |
| `copy/power.ts` `computed` and `unavailable` | existing strings | unused now; the merge step removes them |

## Wiring for the merge step

Listed in the report of this slice. In short: register PLAN (`constants.MNEMONICS`, `commands/registry.ts`,
`copy/commands.ts`, the lazy screen in `chrome/WorkspaceScreens.tsx`, a help page from `PLAN_HELP`), regenerate the
contract, answer the two routes in the demo, answer the power route in `reg/testHarness.tsx`, and update the catalogue.

## Not done here

- Playwright for PLAN by keyboard with axe (`web/e2e` is not in this slice's files). The page is built from native
  inputs, labelled groups and tables with captions and headers, and its cases check those names.
- Moving `evidenceModel.ts` and `evidenceMapModel.ts` (REG 92 Evidence) to a served figure, which would let
  `quant/power.ts` and `normal.ts` join the test-only list in `importGuard.test.ts`.
