// D7.1: the qa/golden files run through the browser's own maths at 1e-9 relative, on whatever JavaScript engine starts
// this file. The four goldens are the ones the self-test page also reads (src/selftest):
//   p12_power         scipy: normal CDF and quantile, minimum detectable Sharpe, power          (src/quant/normal.ts, power.ts)
//   p12_neff          numpy and scipy: correlation, eigenvalues, linkage, clusters, SR0, PSR     (src/quant/linalg, cluster, trials)
//   p12_expectation   numpy searchsorted: the path on the LV6 cone                               (src/screens/live/expectationReference.ts)
//   p2_neff_served    the served SV3b and SV8 views against the browser reference                (src/quant/neffReference.ts)
// The LV6 placement sits in screens/live, not in src/quant, and is read from there: it imports nothing.
//
// Run it with Bun, whose engine is JavaScriptCore (a WebKit build, not Safari's, so a local run is a first reading):
//   bun web/scripts/jscGolden.mjs
// or bundle it (`bun build web/scripts/jscGolden.mjs --target=browser --format=iife --outfile=<file>`) and give the bundle to
// the `jsc` shell, which has neither `process` nor `fs`: nothing here reads a file at run time, the goldens are imported.
// A number passes when |got - want| <= 1e-9 * max(|got|, |want|). There is no absolute floor, so a value near zero is held to
// the same relative distance; integers, names, labels and bands must be equal. Every figure is a demo figure (the goldens
// are fixtures, not research data) and PROVISIONAL (it is one engine on one machine).
//
// Exit code 0 when all four goldens pass, 1 otherwise (under a shell with no `process` the script throws instead).
import expectationGolden from '../../qa/golden/p12_expectation.json'
import neffGolden from '../../qa/golden/p12_neff.json'
import powerGolden from '../../qa/golden/p12_power.json'
import servedGolden from '../../qa/golden/p2_neff_served.json'
import { CLUSTER_CUT, averageLinkage, flatClusters } from '../src/quant/cluster'
import { pearsonMatrix, symmetricEigenvalues } from '../src/quant/linalg'
import { referenceEffectiveN, referenceMembers } from '../src/quant/neffReference'
import { normalCdf, normalQuantile } from '../src/quant/normal'
import { minimumDetectableSharpe, powerAtSharpe } from '../src/quant/power'
import { expectedMaxSr0, liJiCount, participationRatio, probabilisticSharpe, sessionSharpe } from '../src/quant/trials'
import { pathOnCone } from '../src/screens/live/expectationReference'

export const REL_TOLERANCE = 1e-9
export const GOLDEN_NAMES = ['p12_expectation', 'p12_neff', 'p12_power', 'p2_neff_served']
const DAILY_PERIODS = 252
const FAILURES_SHOWN = 5

const LOADED = { p12_expectation: expectationGolden, p12_neff: neffGolden, p12_power: powerGolden, p2_neff_served: servedGolden }

// ---------------------------------------------------------------- comparison

/** True when both are numbers within REL_TOLERANCE of each other, relative to the larger; equal infinities are close. */
export function numbersClose(got, want) {
  if (typeof got !== 'number' || typeof want !== 'number') return false
  if (got === want) return true
  if (!Number.isFinite(got) || !Number.isFinite(want)) return false
  return Math.abs(got - want) <= REL_TOLERANCE * Math.max(Math.abs(got), Math.abs(want))
}

const isTree = (value) => value !== null && typeof value === 'object'

/** The path of the first difference between two JSON trees, or null: numbers at REL_TOLERANCE, everything else exactly. */
function firstDifference(got, want, path = '') {
  if (typeof want === 'number' || typeof got === 'number') return numbersClose(got, want) ? null : path || '<root>'
  if (Array.isArray(got) && Array.isArray(want)) {
    if (got.length !== want.length) return `${path}.length`
    for (let i = 0; i < got.length; i += 1) {
      const found = firstDifference(got[i], want[i], `${path}[${i}]`)
      if (found !== null) return found
    }
    return null
  }
  if (isTree(got) && isTree(want) && !Array.isArray(got) && !Array.isArray(want)) return firstKeyDifference(got, want, path)
  return got === want ? null : path || '<root>'
}

function firstKeyDifference(got, want, path) {
  for (const key of [...new Set([...Object.keys(got), ...Object.keys(want)])].sort()) {
    if (!(key in got) || !(key in want)) return `${path}.${key}`
    const found = firstDifference(got[key], want[key], `${path}.${key}`)
    if (found !== null) return found
  }
  return null
}

const countLeaves = (tree) => (isTree(tree) ? Object.values(tree).reduce((sum, child) => sum + countLeaves(child), 0) : 1)

/** What one golden collected: how many numbers or leaves it compared, and the paths that differed. */
function newTally() {
  const tally = { checks: 0, failures: [] }
  return {
    tally,
    close(label, got, want) {
      tally.checks += 1
      if (!numbersClose(got, want)) tally.failures.push(`${label}: got ${got}, want ${want}`)
    },
    same(label, got, want) {
      tally.checks += countLeaves(want)
      const found = firstDifference(got, want)
      if (found !== null) tally.failures.push(`${label}${found}`)
    },
  }
}

// ---------------------------------------------------------------- p12_power

function checkPower(golden, _all, t) {
  golden.mde.forEach((row, i) => t.close(`mde[${i}]`, minimumDetectableSharpe(row.n, row.periods, row.alpha, row.power), row.value))
  golden.power.forEach((row, i) => t.close(`power[${i}]`, powerAtSharpe(row.sharpe, row.n, row.periods, row.alpha), row.value))
  golden.cdf.forEach((row, i) => t.close(`cdf[${i}]`, normalCdf(row.x), row.value))
  golden.quantile.forEach((row, i) => t.close(`quantile[${i}]`, normalQuantile(row.p), row.value))
}

// ---------------------------------------------------------------- p12_neff

const distanceOf = (correlation) => correlation.map((row) => row.map((value) => 1 - value))

function checkNeffMatrix(golden, t) {
  const correlation = pearsonMatrix(golden.panel.columns)
  t.same('correlation', correlation, golden.correlation)
  const eigenvalues = symmetricEigenvalues(correlation)
  t.same('eigenvalues', eigenvalues, golden.eigenvalues)
  t.close('participation_ratio', participationRatio(eigenvalues), golden.participation_ratio)
  t.close('li_ji', liJiCount(eigenvalues), golden.li_ji)
  t.close('participation_ratio of the golden eigenvalues', participationRatio(golden.eigenvalues), golden.participation_ratio)
  t.close('li_ji of the golden eigenvalues', liJiCount(golden.eigenvalues), golden.li_ji)
  golden.eigen_cases.forEach((c, i) => {
    t.close(`eigen_cases[${i}] ${c.name} participation_ratio`, participationRatio(c.eigenvalues), c.participation_ratio)
    t.close(`eigen_cases[${i}] ${c.name} li_ji`, liJiCount(c.eigenvalues), c.li_ji)
  })
}

function checkNeffClusters(golden, t) {
  const merges = averageLinkage(distanceOf(golden.correlation))
  t.same('linkage', merges, golden.linkage)
  t.same('linkage_heights', merges.map((merge) => merge.height), golden.linkage_heights)
  t.same('clusters', flatClusters(merges, golden.correlation.length, CLUSTER_CUT), golden.clusters)
  golden.cluster_sweep.forEach((s, i) => t.same(`cluster_sweep[${i}]`, flatClusters(merges, golden.correlation.length, s.cut), s.clusters))
  const { m, merges: tree, cuts } = golden.inversion_case
  cuts.forEach((c, i) => t.same(`inversion_case.cuts[${i}]`, flatClusters(tree, m, c.cut), c.clusters))
}

function checkNeffScalars(golden, t) {
  golden.sr0_cases.forEach((c, i) => t.same(`sr0_cases[${i}]`, expectedMaxSr0(c.variance, c.n_trials, c.gamma), c.value))
  golden.psr_cases.forEach((c, i) => t.same(`psr_cases[${i}]`, probabilisticSharpe(c.sr, c.sr0, c.n, c.skew, c.kurt), c.value))
  golden.session_sharpe.forEach((row, i) => t.close(`session_sharpe[${i}] ${row.name}`, sessionSharpe(golden.panel.columns[i]), row.value))
  const paper = golden.paper_example
  const bar = expectedMaxSr0(paper.variance, paper.n_trials, paper.gamma)
  t.close('paper_example.sr0', bar, paper.sr0)
  t.close('paper_example.dsr', probabilisticSharpe(paper.sr, bar, paper.sessions, paper.skew, paper.kurt), paper.dsr)
}

function checkNeffAnchor(golden, t) {
  const a = golden.sv3_anchor
  const null0 = expectedMaxSr0(a.variance_null, a.n_trials, a.euler_gamma)
  t.close('sv3_anchor.sr0_null_session', null0, a.sr0_null_session)
  t.close('sv3_anchor.sr0_session', expectedMaxSr0(a.variance, a.n_trials, a.euler_gamma), a.sr0_session)
  a.rows.forEach((row, i) => {
    const own = null0 * Math.sqrt(DAILY_PERIODS / row.periods)
    t.close(`sv3_anchor.rows[${i}] ${row.name} bar`, own, row.sr0_null_own_period)
    t.close(`sv3_anchor.rows[${i}] ${row.name} dsr_null`, probabilisticSharpe(row.sr, own, row.n, row.skew, row.kurt), row.dsr_null)
  })
}

function checkNeff(golden, _all, t) {
  checkNeffMatrix(golden, t)
  checkNeffClusters(golden, t)
  checkNeffScalars(golden, t)
  checkNeffAnchor(golden, t)
}

// ---------------------------------------------------------------- p12_expectation

function checkExpectation(golden, _all, t) {
  golden.cases.forEach((c, i) => {
    const got = pathOnCone({ usd: c.input.usd, capital: c.input.capital, quantiles: c.input.quantiles, horizon: c.input.horizon })
    const want = { firstIndex: c.expected.first_index, fraction: c.expected.fraction, bands: c.expected.bands, beyond: c.expected.beyond }
    t.same(`cases[${i}] ${c.name}`, got, want)
  })
}

// ---------------------------------------------------------------- p2_neff_served

/** The served fields the browser reference also computes (neffMirror.test.ts reads the same ones). */
function comparable(served) {
  const { refusal, daily, monthly, window, correlation, eigenvalues, clusters, sequence, estimates, dsr } = served
  return { refusal, daily, monthly, window, correlation, eigenvalues, clusters, sequence, estimates, dsr }
}

function checkServed(golden, all, t) {
  const panel = all.p12_neff?.panel
  if (panel === undefined) throw new Error('p12_neff is needed for its panel and is not loaded')
  const series = panel.names.map((name, i) => ({ name, date: panel.dates, r: panel.columns[i] }))
  t.same('sv3b.effective_n', referenceEffectiveN(golden.sv3b, series), comparable(golden.sv3b.effective_n))
  golden.sv8.forEach((c) => t.same(`sv8 ${c.name}`, referenceMembers(c.names, c.correlation), c.served))
}

// ---------------------------------------------------------------- running

const CHECKERS = {
  p12_expectation: checkExpectation,
  p12_neff: checkNeff,
  p12_power: checkPower,
  p2_neff_served: checkServed,
}

function runOne(name, goldens) {
  const golden = goldens[name]
  if (golden === undefined || golden === null) return { name, checks: 0, failures: ['golden file not loaded'], ok: false }
  const t = newTally()
  try {
    CHECKERS[name](golden, goldens, t)
  } catch (error) {
    t.tally.failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  // A golden that compared nothing has not been read: it fails instead of passing on zero comparisons.
  const { checks, failures } = t.tally
  return { name, checks, failures, ok: checks > 0 && failures.length === 0 }
}

/** What the engine is, from its own globals (`scope` is globalThis; a test passes a stand-in). */
export function describeEngine(scope = globalThis) {
  const versions = scope.process?.versions
  if (scope.Bun !== undefined || versions?.bun !== undefined) {
    return `Bun ${versions?.bun ?? scope.Bun?.version ?? 'unknown'} (JavaScriptCore, WebKit build ${versions?.webkit ?? 'unknown'})`
  }
  if (versions?.node !== undefined) return `Node ${versions.node} (V8)`
  return typeof scope.print === 'function' ? 'JavaScriptCore shell (jsc)' : 'unknown engine'
}

/** Runs the four goldens (the imported ones, or the given ones: a test hands in goldens that are wrong on purpose). */
export function runGoldens(goldens = LOADED) {
  const results = GOLDEN_NAMES.map((name) => runOne(name, goldens))
  const passed = results.filter((r) => r.ok).length
  return { engine: describeEngine(), tolerance: REL_TOLERANCE, results, passed, total: GOLDEN_NAMES.length, ok: passed === GOLDEN_NAMES.length }
}

// ---------------------------------------------------------------- report

function resultLines(result) {
  if (result.ok) return [`jsc-golden:   ${result.name} ok (${result.checks} comparisons)`]
  const shown = result.failures.slice(0, FAILURES_SHOWN).map((line) => `jsc-golden:     ${line}`)
  const more = result.failures.length - shown.length
  const head = `jsc-golden:   ${result.name} FAIL (${result.checks} comparisons, ${result.failures.length} differences)`
  return [head, ...shown, ...(more > 0 ? [`jsc-golden:     and ${more} more`] : [])]
}

/** The text a run prints: the engine, one line per golden, and the summary that the workflow and the notes quote. */
export function formatReport(report) {
  const verdict = report.ok ? '' : ' FAIL'
  const summary = `jsc-golden: ${report.passed} of ${report.total} goldens pass at ${report.tolerance} relative${verdict}`
  const reading = "(demo data, PROVISIONAL: this engine's JavaScriptCore is not Safari's)"
  const record = { engine: report.engine, passed: report.passed, total: report.total, results: report.results.map((r) => ({ name: r.name, checks: r.checks, failed: r.failures.length })) }
  return [
    `jsc-golden: engine ${report.engine}`,
    ...report.results.flatMap(resultLines),
    `${summary} ${reading}`,
    `jsc-golden-json: ${JSON.stringify(record)}`,
  ].join('\n')
}

// ---------------------------------------------------------------- entry

function emit(text) {
  const log = globalThis.console?.log
  if (typeof log === 'function') log.call(globalThis.console, text)
  else globalThis.print(text)
}

function main() {
  const report = runGoldens()
  emit(formatReport(report))
  if (report.ok) return
  if (globalThis.process === undefined) throw new Error(`jsc-golden: ${report.total - report.passed} of ${report.total} goldens failed`)
  globalThis.process.exitCode = 1
}

// A test sets this flag before it imports the file, to use the functions above without a run.
if (globalThis.__NQ_JSC_GOLDEN_AS_LIBRARY__ !== true) main()
