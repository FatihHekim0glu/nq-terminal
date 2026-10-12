// D7.1: web/scripts/jscGolden.mjs runs the four qa/golden files (p12_expectation, p12_neff, p12_power, p2_neff_served)
// through web/src/quant (and the LV6 placement reference) at 1e-9 relative, on whatever JavaScript engine starts it: Bun
// 1.3.9 here (JavaScriptCore, a first reading) and the macos-26 runner in .github/workflows/mac-webkit.yml.
// This file runs the same functions under vitest (V8), feeds them goldens that are wrong on purpose, and, when Bun is
// installed, starts the script itself. Born failing: the script did not exist. Each guard has a case that feeds it the
// broken state: a golden shifted by 1e-6, a changed integer, an empty golden, a missing golden, a changed cluster label.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(import.meta.dirname, '..')
const GOLDEN_DIR = join(WEB, '..', 'qa', 'golden')
const NAMES = ['p12_expectation', 'p12_neff', 'p12_power', 'p2_neff_served'] as const
type Name = (typeof NAMES)[number]
// A golden is a JSON object tree; the cases below edit one leaf, so the tree is read as a loose record.
type Tree = Record<string, any>
type Goldens = Record<Name, Tree>

interface Result {
  readonly name: string
  readonly checks: number
  readonly failures: readonly string[]
  readonly ok: boolean
}
interface Report {
  readonly engine: string
  readonly tolerance: number
  readonly results: readonly Result[]
  readonly passed: number
  readonly total: number
  readonly ok: boolean
}
interface Runner {
  readonly REL_TOLERANCE: number
  readonly GOLDEN_NAMES: readonly string[]
  runGoldens(goldens?: Partial<Goldens>): Report
  describeEngine(scope?: unknown): string
  formatReport(report: Report): string
  numbersClose(got: number, want: number): boolean
}

// The script runs itself when it is the entry; this flag makes it a library for the tests.
;(globalThis as Record<string, unknown>).__NQ_JSC_GOLDEN_AS_LIBRARY__ = true
const SCRIPT = new URL('./jscGolden.mjs', import.meta.url).href // a variable, so the type checker does not look for a declaration file this slice does not own
const runner = (await import(/* @vite-ignore */ SCRIPT)) as Runner

const load = (name: Name): Tree => JSON.parse(readFileSync(join(GOLDEN_DIR, `${name}.json`), 'utf8')) as Tree
const fresh = (): Goldens => Object.fromEntries(NAMES.map((name) => [name, load(name)])) as Goldens

/** The goldens with one edit made on a copy: `edit` receives the copy of the named golden. */
function edited(name: Name, edit: (golden: Tree) => void): Goldens {
  const goldens = fresh()
  edit(goldens[name])
  return goldens
}
const resultOf = (report: Report, name: Name): Result => report.results.find((r) => r.name === name) as Result

describe('the four goldens', () => {
  const report = runner.runGoldens(fresh())

  it('are the four files of qa/golden the task names, in a fixed order', () => {
    expect(runner.GOLDEN_NAMES).toEqual([...NAMES])
  })

  it('all pass at 1e-9 relative on the engine running this test', () => {
    expect(report.tolerance).toBe(1e-9)
    expect(runner.REL_TOLERANCE).toBe(1e-9)
    expect(report.results.map((r) => [r.name, r.ok, r.failures.length])).toEqual(NAMES.map((n) => [n, true, 0]))
    expect(report.passed).toBe(4)
    expect(report.total).toBe(4)
    expect(report.ok).toBe(true)
  })

  it('compare many numbers each, so a golden that read nothing cannot pass', () => {
    const counts = Object.fromEntries(report.results.map((r) => [r.name, r.checks]))
    expect(counts.p12_power).toBeGreaterThan(300) // 96 + 192 + 16 + 18
    expect(counts.p12_neff).toBeGreaterThan(250)
    expect(counts.p12_expectation).toBeGreaterThan(30)
    expect(counts.p2_neff_served).toBeGreaterThan(200)
  })

  it('run with the goldens the script loads itself when none are given', () => {
    expect(runner.runGoldens().passed).toBe(4)
  })
})

describe('born failing: a golden shifted by 1e-6 relative fails', () => {
  const shift = (value: number, relative: number): number => value * (1 + relative)

  it('p12_power: one minimum detectable Sharpe row', () => {
    const goldens = edited('p12_power', (g) => { g.mde[7].value = shift(g.mde[7].value, 1e-6) })
    const report = runner.runGoldens(goldens)
    expect(resultOf(report, 'p12_power').ok).toBe(false)
    expect(resultOf(report, 'p12_power').failures.join('\n')).toContain('mde[7]')
    expect(report.passed).toBe(3)
    expect(report.ok).toBe(false)
  })

  it('p12_power: a normal CDF value far in the tail (relative, not absolute)', () => {
    const goldens = edited('p12_power', (g) => { g.cdf[0].value = shift(g.cdf[0].value, 1e-6) })
    expect(resultOf(runner.runGoldens(goldens), 'p12_power').ok).toBe(false)
  })

  it('p12_neff: one correlation, one eigenvalue and one linkage height', () => {
    for (const edit of [
      (g: Tree) => { g.correlation[0][1] = shift(g.correlation[0][1], 1e-6) },
      (g: Tree) => { g.eigenvalues[0] = shift(g.eigenvalues[0], 1e-6) },
      (g: Tree) => { g.linkage[3].height = shift(g.linkage[3].height, 1e-6) },
      (g: Tree) => { g.participation_ratio = shift(g.participation_ratio, 1e-6) },
      (g: Tree) => { g.paper_example.dsr = shift(g.paper_example.dsr, 1e-6) },
    ]) {
      const report = runner.runGoldens(edited('p12_neff', edit))
      expect(resultOf(report, 'p12_neff').ok, edit.toString()).toBe(false)
    }
  })

  it('p12_expectation: one placement fraction', () => {
    const goldens = edited('p12_expectation', (g) => { g.cases[0].expected.fraction[0] = shift(g.cases[0].expected.fraction[0], 1e-6) })
    expect(resultOf(runner.runGoldens(goldens), 'p12_expectation').ok).toBe(false)
  })

  it('p2_neff_served: a served estimate, a served correlation and a served member count', () => {
    for (const edit of [
      (g: Tree) => { g.sv3b.effective_n.estimates[1].n_daily = shift(g.sv3b.effective_n.estimates[1].n_daily, 1e-6) },
      (g: Tree) => { g.sv3b.effective_n.correlation[0][1] = shift(g.sv3b.effective_n.correlation[0][1], 1e-6) },
      (g: Tree) => { g.sv8[0].served.participation = shift(g.sv8[0].served.participation, 1e-6) },
    ]) {
      const report = runner.runGoldens(edited('p2_neff_served', edit))
      expect(resultOf(report, 'p2_neff_served').ok, edit.toString()).toBe(false)
    }
  })
})

describe('the tolerance is 1e-9 relative, not looser and not tighter', () => {
  it('a shift of 5e-10 passes and a shift of 5e-9 fails', () => {
    const at = (relative: number) =>
      runner.runGoldens(edited('p12_power', (g) => { g.mde[7].value *= 1 + relative })).results.find((r) => r.name === 'p12_power')?.ok
    expect(at(5e-10)).toBe(true)
    expect(at(5e-9)).toBe(false)
  })

  it('numbersClose reads the relative distance, with no absolute floor that hides a small number', () => {
    expect(runner.numbersClose(1, 1 + 5e-10)).toBe(true)
    expect(runner.numbersClose(1, 1 + 5e-9)).toBe(false)
    expect(runner.numbersClose(4.9e-198, 4.9e-198 * (1 + 1e-6))).toBe(false)
    expect(runner.numbersClose(0, 0)).toBe(true)
    expect(runner.numbersClose(0, 1e-300)).toBe(false)
    expect(runner.numbersClose(Number.NaN, Number.NaN)).toBe(false)
    expect(runner.numbersClose(Infinity, Infinity)).toBe(true)
  })
})

describe('integers, labels and bands are compared exactly', () => {
  it('a changed cluster label in p12_neff fails', () => {
    const goldens = edited('p12_neff', (g) => { g.clusters[0] = [...g.clusters[0]].reverse().map((i: number) => i + 1) })
    expect(resultOf(runner.runGoldens(goldens), 'p12_neff').ok).toBe(false)
  })

  it('a changed linkage child in p12_neff fails', () => {
    const goldens = edited('p12_neff', (g) => { g.linkage[0].a += 1 })
    expect(resultOf(runner.runGoldens(goldens), 'p12_neff').ok).toBe(false)
  })

  it('a changed band name or beyond count in p12_expectation fails', () => {
    const band = edited('p12_expectation', (g) => { g.cases[0].expected.bands[0] = 'below5' })
    expect(resultOf(runner.runGoldens(band), 'p12_expectation').ok).toBe(false)
    const beyond = edited('p12_expectation', (g) => { g.cases[5].expected.beyond += 1 })
    expect(resultOf(runner.runGoldens(beyond), 'p12_expectation').ok).toBe(false)
  })

  it('a changed served cluster, served name or refusal in p2_neff_served fails', () => {
    for (const edit of [
      (g: Tree) => { g.sv3b.effective_n.clusters.reverse() },
      (g: Tree) => { g.sv3b.effective_n.daily[0] = 'renamed' },
      (g: Tree) => { g.sv8[0].served.clusters.reverse() },
    ]) {
      expect(resultOf(runner.runGoldens(edited('p2_neff_served', edit)), 'p2_neff_served').ok, edit.toString()).toBe(false)
    }
  })
})

describe('a golden that holds nothing, or is not there, is a failure', () => {
  it('an empty case list fails instead of passing on zero comparisons', () => {
    const goldens = edited('p12_expectation', (g) => { g.cases = [] })
    const result = resultOf(runner.runGoldens(goldens), 'p12_expectation')
    expect(result.ok).toBe(false)
    expect(result.checks).toBe(0)
  })

  it('a missing golden is named and counted as failed, and the others still run', () => {
    const goldens = fresh()
    const { p12_power: _dropped, ...rest } = goldens
    const report = runner.runGoldens(rest)
    expect(report.total).toBe(4)
    expect(report.passed).toBe(3)
    expect(resultOf(report, 'p12_power').failures.join('\n')).toContain('golden file not loaded')
    expect(report.ok).toBe(false)
  })

  it('a golden of the wrong shape is a failure with a message, never a thrown error', () => {
    const goldens = edited('p12_power', (g) => { delete g.mde })
    const result = resultOf(runner.runGoldens(goldens), 'p12_power')
    expect(result.ok).toBe(false)
    expect(result.failures.length).toBeGreaterThan(0)
  })
})

describe('the report', () => {
  it('names the engine and says that the reading is provisional and not Safari', () => {
    const text = runner.formatReport(runner.runGoldens(fresh()))
    expect(text).toContain('jsc-golden: 4 of 4')
    expect(text).toContain('1e-9 relative')
    expect(text).toContain('PROVISIONAL')
    expect(text).toContain('demo')
    for (const name of NAMES) expect(text).toContain(name)
  })

  it('says N of 4 and lists the first failing paths when a golden fails', () => {
    const goldens = edited('p12_power', (g) => { g.mde[7].value *= 1 + 1e-6 })
    const text = runner.formatReport(runner.runGoldens(goldens))
    expect(text).toContain('jsc-golden: 3 of 4')
    expect(text).toContain('FAIL')
    expect(text).toContain('mde[7]')
  })

  it('names Bun and its WebKit build, plain Node, and a bare JavaScriptCore shell', () => {
    expect(runner.describeEngine({ Bun: {}, process: { versions: { bun: '1.3.9', webkit: '0ddf6f47' } } })).toBe('Bun 1.3.9 (JavaScriptCore, WebKit build 0ddf6f47)')
    expect(runner.describeEngine({ process: { versions: { node: '24.13.1' } } })).toBe('Node 24.13.1 (V8)')
    expect(runner.describeEngine({ print: () => undefined })).toBe('JavaScriptCore shell (jsc)')
    expect(runner.describeEngine({})).toBe('unknown engine')
  })
})

/** The Bun on this PC, or null: the run under JavaScriptCore is skipped where there is none (the hosted web job has none). */
function bunVersion(): string | null {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return probe.status === 0 ? probe.stdout.trim() : null
}
const BUN = bunVersion()

describe.skipIf(BUN === null)('the script started by Bun (JavaScriptCore)', () => {
  it('prints 4 of 4 and exits 0', () => {
    const run = spawnSync('bun', [join(WEB, 'scripts', 'jscGolden.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 120_000, cwd: WEB })
    expect(run.stderr).toBe('')
    expect(run.stdout).toContain('jsc-golden: 4 of 4')
    expect(run.stdout).toContain('Bun ')
    expect(run.status).toBe(0)
  }, 150_000)
})
