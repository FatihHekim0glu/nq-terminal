// The four quant goldens of qa/golden, run by the page's own engine at 1e-9 relative. The goldens are numpy and scipy
// numbers; the page's code (src/quant, the LV6 placement) must come out within one part in 1e9 of them. Born failing: each
// golden is fed a copy with one number off by 1e-6 (and a quant module made 1e-6 wrong) and must fail, and only it.
import { beforeAll, describe, expect, it } from 'vitest'
import { GOLDEN_NAMES, GOLDEN_TOLERANCE, type GoldenName, type GoldenReport } from './report.ts'
import { readGoldenData, type GoldenData } from './goldenData.ts'
import { runGoldens } from './goldens.ts'
import { loadQuant, type QuantModules } from './quant.load.ts'

let quant: QuantModules
beforeAll(async () => {
  quant = await loadQuant()
})

const byName = (reports: readonly GoldenReport[]): Record<string, GoldenReport> => Object.fromEntries(reports.map((r) => [r.name, r]))

describe('the goldens against the page engine', () => {
  it('meets all four at 1e-9 relative, each with real work behind it', async () => {
    const reports = await runGoldens(readGoldenData(), quant)
    expect(reports.map((r) => r.name)).toEqual([...GOLDEN_NAMES])
    for (const report of reports) {
      expect(report.firstFailure, report.name).toBeNull()
      expect(report.failed, report.name).toBe(0)
      expect(report.passed, report.name).toBe(true)
      expect(report.maxRelativeError, report.name).toBeLessThanOrEqual(GOLDEN_TOLERANCE)
    }
    const checks = byName(reports)
    // 11 placement cases; 16 + 18 + 96 + 192 power rows; the 9 x 9 neff chain; the served SV3b and SV8 views.
    expect(checks.p12_expectation!.checks).toBeGreaterThanOrEqual(50)
    expect(checks.p12_power!.checks).toBe(16 + 18 + 96 + 192)
    expect(checks.p12_neff!.checks).toBeGreaterThanOrEqual(150)
    expect(checks.p2_neff_served!.checks).toBeGreaterThanOrEqual(250)
  })

  it('reads the goldens the repository holds: a case count change is noticed', () => {
    const data = readGoldenData()
    expect(data.p12_expectation.cases).toHaveLength(11)
    expect(data.p12_power.cdf).toHaveLength(16)
    expect(data.p12_neff.panel.columns).toHaveLength(9)
    expect(data.p2_neff_served.sv3b.effective_n.daily).toHaveLength(9)
  })
})

type Plant = readonly [golden: GoldenName, what: string, apply: (data: GoldenData, factor: number) => void, coupled?: true]

/** Multiplies one number of the golden, so the page's own value is no longer within tolerance of it. */
const PLANTS: readonly Plant[] = [
  ['p12_expectation', 'a placement fraction', (d, f) => { d.p12_expectation.cases[0]!.expected.fraction[0]! *= f }],
  ['p12_neff', 'the correlation', (d, f) => { d.p12_neff.correlation[0]![1]! *= f }, true], // coupled: the golden correlation is also an input of the clustering
  ['p12_neff', 'an eigenvalue', (d, f) => { d.p12_neff.eigenvalues[0]! *= f }],
  ['p12_neff', 'the participation ratio', (d, f) => { d.p12_neff.participation_ratio *= f }],
  ['p12_neff', 'a linkage height', (d, f) => { d.p12_neff.linkage[3]!.height *= f }],
  ['p12_neff', 'an SR0 case', (d, f) => { d.p12_neff.sr0_cases[0]!.value! *= f }],
  ['p12_neff', 'a PSR case', (d, f) => { d.p12_neff.psr_cases[0]!.value! *= f }],
  ['p12_power', 'a normal cdf row', (d, f) => { d.p12_power.cdf[3]!.value *= f }],
  ['p12_power', 'a normal quantile row', (d, f) => { d.p12_power.quantile[0]!.value *= f }],
  ['p12_power', 'a minimum detectable Sharpe row', (d, f) => { d.p12_power.mde[5]!.value *= f }],
  ['p12_power', 'a power row', (d, f) => { d.p12_power.power[7]!.value *= f }],
  ['p2_neff_served', 'a served eigenvalue', (d, f) => { d.p2_neff_served.sv3b.effective_n.eigenvalues[0]! *= f }],
  ['p2_neff_served', 'a served DSR', (d, f) => { d.p2_neff_served.sv3b.effective_n.dsr[0]!.served! *= f }],
  ['p2_neff_served', 'a served member participation', (d, f) => { d.p2_neff_served.sv8[0]!.served.participation! *= f }],
]

describe('born failing: a golden off by 1e-6 fails that golden and no other', () => {
  it.each(PLANTS.map((p) => [`${p[0]}: ${p[1]}`, p] as const))('%s', async (_label, [golden, , apply]) => {
    const data = readGoldenData()
    apply(data, 1 + 1e-6)
    const reports = byName(await runGoldens(data, quant))
    const hit = reports[golden]!
    expect(hit.passed).toBe(false)
    expect(hit.failed).toBeGreaterThanOrEqual(1)
    expect(hit.maxRelativeError).toBeGreaterThan(1e-7)
    expect(hit.firstFailure).not.toBeNull()
    for (const other of GOLDEN_NAMES.filter((n) => n !== golden)) expect(reports[other]!.passed, other).toBe(true)
  })

  it.each(PLANTS.filter((p) => p[3] !== true).map((p) => [`${p[0]}: ${p[1]}`, p] as const))('%s: a drift of 1e-10 is inside the tolerance', async (_label, [golden, , apply]) => {
    const data = readGoldenData()
    apply(data, 1 + 1e-10)
    const hit = byName(await runGoldens(data, quant))[golden]!
    expect(hit.passed).toBe(true)
    expect(hit.maxRelativeError).toBeGreaterThan(0)
  })
})

describe('born failing: a page engine that is 1e-6 wrong fails', () => {
  it('the normal cdf', async () => {
    const wrong: QuantModules = { ...quant, normal: { ...quant.normal, normalCdf: (x) => quant.normal.normalCdf(x) * (1 + 1e-6) } }
    const reports = byName(await runGoldens(readGoldenData(), wrong))
    expect(reports.p12_power!.passed).toBe(false)
    expect(reports.p12_expectation!.passed).toBe(true)
  })

  it('the placement', async () => {
    const wrong: QuantModules = {
      ...quant,
      pathOnCone: (input) => {
        const placed = quant.pathOnCone(input)
        return { ...placed, fraction: placed.fraction.map((v) => (v === null ? v : v * (1 + 1e-6))) }
      },
    }
    const reports = byName(await runGoldens(readGoldenData(), wrong))
    expect(reports.p12_expectation!.passed).toBe(false)
  })

  it('the eigenvalues', async () => {
    const wrong: QuantModules = { ...quant, linalg: { ...quant.linalg, symmetricEigenvalues: (m) => quant.linalg.symmetricEigenvalues(m).map((v) => v * (1 + 1e-6)) } }
    const reports = byName(await runGoldens(readGoldenData(), wrong))
    expect(reports.p12_neff!.passed).toBe(false)
  })
})

describe('a band, a count or a cluster that differs is a failure however small the numbers', () => {
  it('a placement band', async () => {
    const data = readGoldenData()
    data.p12_expectation.cases[0]!.expected.bands[0] = 'above95'
    expect(byName(await runGoldens(data, quant)).p12_expectation!.passed).toBe(false)
  })

  it('a cluster', async () => {
    const data = readGoldenData()
    data.p12_neff.clusters = [[0], ...data.p12_neff.clusters.slice(1)]
    const hit = byName(await runGoldens(data, quant)).p12_neff!
    expect(hit.passed).toBe(false)
    expect(hit.firstFailure).toContain('clusters')
  })
})
