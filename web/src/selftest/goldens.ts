// The four quant goldens of qa/golden, checked by the page's own engine. Each check feeds the golden's inputs to the code the
// app ships (or, for the estimators the backend now serves, the browser reference that stays pinned to the same numbers) and
// compares with what numpy and scipy wrote, at one part in 1e9 relative; names, bands, counts and clusters exactly.
// The tests of those modules (src/quant/*.test.ts) read the same files at tighter tolerances under Node; this run is the one
// that happens in the page's own JavaScript engine, which is the point of it (JavaScriptCore on a Mac, V8 under WebView2).
import { createTally, type Tally } from './compare.ts'
import type { ExpectationCase, GoldenData, NeffGolden, PowerGolden, ServedGolden } from './goldenData.ts'
import type { QuantModules } from './quant.load.ts'
import type { GoldenName, GoldenReport } from './report.ts'

type Checker<T> = (tally: Tally, quant: QuantModules, golden: T) => void

const distanceOf = (correlation: readonly (readonly number[])[]): number[][] => correlation.map((row) => row.map((rho) => 1 - rho))
const largest = (values: readonly number[]): number => Math.max(...values.map((v) => Math.abs(v)))

// ---------------------------------------------------------------- p12_expectation

function checkPlacement(t: Tally, quant: QuantModules, c: ExpectationCase): void {
  const { usd, capital, quantiles, horizon } = c.input
  const got = quant.pathOnCone({ usd, capital, quantiles, horizon })
  const at = `${c.name}`
  t.exact(`${at} first index`, got.firstIndex, c.expected.first_index)
  t.exact(`${at} bands`, got.bands, c.expected.bands)
  t.exact(`${at} beyond`, got.beyond, c.expected.beyond)
  t.tree(`${at} fraction`, got.fraction, c.expected.fraction)
}

const checkExpectation: Checker<GoldenData['p12_expectation']> = (t, quant, golden) => {
  for (const c of golden.cases) checkPlacement(t, quant, c)
}

// ---------------------------------------------------------------- p12_power

const checkPower: Checker<PowerGolden> = (t, { normal, power }, g) => {
  g.cdf.forEach((row, i) => t.number(`cdf[${i}] at ${row.x}`, normal.normalCdf(row.x), row.value))
  g.quantile.forEach((row, i) => t.number(`quantile[${i}] at ${row.p}`, normal.normalQuantile(row.p), row.value))
  g.mde.forEach((r, i) => t.number(`mde[${i}]`, power.minimumDetectableSharpe(r.n, r.periods, r.alpha, r.power), r.value))
  g.power.forEach((r, i) => t.number(`power[${i}]`, power.powerAtSharpe(r.sharpe, r.n, r.periods, r.alpha), r.value))
}

// ---------------------------------------------------------------- p12_neff

function checkSpectrum(t: Tally, { linalg, trials }: QuantModules, g: NeffGolden): void {
  const correlation = linalg.pearsonMatrix(g.panel.columns)
  const eigenvalues = linalg.symmetricEigenvalues(correlation)
  t.tree('correlation', correlation, g.correlation)
  t.tree('eigenvalues', eigenvalues, g.eigenvalues)
  t.tree('eigenvalues of the golden correlation', linalg.symmetricEigenvalues(g.correlation), g.eigenvalues)
  t.number('participation ratio', trials.participationRatio(eigenvalues), g.participation_ratio)
  t.number('li and ji', trials.liJiCount(eigenvalues), g.li_ji)
  for (const c of g.eigen_cases) {
    t.tree(`${c.name} eigenvalues`, linalg.symmetricEigenvalues(c.matrix), c.eigenvalues, largest(c.eigenvalues))
    t.number(`${c.name} participation ratio`, trials.participationRatio(c.eigenvalues), c.participation_ratio)
    t.number(`${c.name} li and ji`, trials.liJiCount(c.eigenvalues), c.li_ji)
  }
}

function checkClusters(t: Tally, { cluster }: QuantModules, g: NeffGolden): void {
  const merges = cluster.averageLinkage(distanceOf(g.correlation))
  t.tree('linkage', merges, g.linkage)
  t.exact('clusters', cluster.flatClusters(merges, g.correlation.length, g.cluster_cut), g.clusters)
  for (const { cut, clusters } of g.cluster_sweep) t.exact(`clusters at cut ${cut}`, cluster.flatClusters(merges, g.correlation.length, cut), clusters)
  const inverted = g.inversion_case
  for (const { cut, clusters } of inverted.cuts) t.exact(`inverted tree at cut ${cut}`, cluster.flatClusters(inverted.merges, inverted.m, cut), clusters)
}

function checkTrials(t: Tally, { trials }: QuantModules, g: NeffGolden): void {
  g.sr0_cases.forEach((c, i) => t.number(`sr0[${i}] (N ${c.n_trials})`, trials.expectedMaxSr0(c.variance, c.n_trials, c.gamma), c.value))
  g.psr_cases.forEach((c, i) => t.number(`psr[${i}]`, trials.probabilisticSharpe(c.sr, c.sr0, c.n, c.skew, c.kurt), c.value))
  g.session_sharpe.forEach((row, i) => t.number(`session sharpe ${row.name}`, trials.sessionSharpe(g.panel.columns[i] ?? []), row.value))
}

const checkNeff: Checker<NeffGolden> = (t, quant, g) => {
  checkSpectrum(t, quant, g)
  checkClusters(t, quant, g)
  checkTrials(t, quant, g)
}

// ---------------------------------------------------------------- p2_neff_served

/** The fields of the served SV3b that the browser reference also computes (as src/screens/reg/neffMirror.test.ts compares them). */
const SERVED_FIELDS = ['refusal', 'daily', 'monthly', 'window', 'correlation', 'eigenvalues', 'clusters', 'sequence', 'estimates', 'dsr'] as const

function pick(from: object, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, (from as Record<string, unknown>)[name]]))
}

const checkServed = (panel: NeffGolden['panel']): Checker<ServedGolden> => (t, { neff }, g) => {
  const series = panel.names.map((name, i) => ({ name, date: panel.dates, r: panel.columns[i] ?? [] }))
  const reference = neff.referenceEffectiveN(g.sv3b as unknown as Parameters<typeof neff.referenceEffectiveN>[0], series)
  t.tree('sv3b', pick(reference, SERVED_FIELDS), pick(g.sv3b.effective_n, SERVED_FIELDS))
  for (const c of g.sv8) t.tree(`sv8 ${c.name}`, neff.referenceMembers(c.names, c.correlation), c.served)
}

/** Runs one golden's checks into a report row; a crash inside is a failed golden with the error as its reason. */
function run<T>(name: GoldenName, quant: QuantModules, golden: T, check: Checker<T>): GoldenReport {
  const tally = createTally()
  try {
    check(tally, quant, golden)
  } catch (error) {
    tally.exact(`${name} ran`, `threw ${error instanceof Error ? error.message : String(error)}`, 'ran to the end')
  }
  return tally.report(name)
}

/** All four goldens, in GOLDEN_NAMES order. */
export async function runGoldens(data: GoldenData, quant: QuantModules): Promise<GoldenReport[]> {
  return [
    run('p12_expectation', quant, data.p12_expectation, checkExpectation),
    run('p12_neff', quant, data.p12_neff, checkNeff),
    run('p12_power', quant, data.p12_power, checkPower),
    run('p2_neff_served', quant, data.p2_neff_served, checkServed(data.p12_neff.panel)),
  ]
}
