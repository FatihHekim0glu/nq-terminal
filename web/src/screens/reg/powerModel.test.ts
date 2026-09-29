// powerView, powerSummary, powerCells and powerHeaders (ANALYTICS_CATALOG SV9): the minimum detectable annual Sharpe
// ratio and the power at a fixed reference Sharpe ratio for every registered trial of the served DeflatedView, against
// the scipy golden vectors of qa/crosscheck/p12_power.py and the anchors in the brief (volmanaged_v0: years 10.66,
// Sharpe +0.99, MDE 0.76 and 1.12, ratio 0.88).
import { describe, expect, it } from 'vitest'
import raw from '../../../../qa/golden/p12_power.json?raw'
import type { Schemas } from '../../api/types'
import { POWER } from '../../copy/power'
import { DEFLATED_REAL } from './deflatedFixtures'
import {
  POWER_TARGET,
  REFERENCE_SHARPE,
  powerCells,
  powerHeaders,
  powerSummary,
  powerView,
  type PowerCol,
} from './powerModel'
import { MULTIPLE_TESTING } from './regFixtures'

type MdeGolden = { n: number; periods: number; alpha: number; power: number; value: number }
type PowerGolden = { sharpe: number; n: number; periods: number; alpha: number; value: number }
const GOLDEN = JSON.parse(raw) as { mde: MdeGolden[]; power: PowerGolden[] }

const FAMILY = { alpha: MULTIPLE_TESTING.alpha, k: MULTIPLE_TESTING.k }
const ALPHA_FAMILY = 0.05 / 21

type Row = Schemas['DeflatedRow']

function rowNamed(name: string): Row {
  return DEFLATED_REAL.rows.find((r) => r.name === name)!
}

/** DEFLATED_REAL with its rows replaced by `rows`. */
function withRows(rows: readonly Row[]): Schemas['DeflatedView'] {
  return { ...DEFLATED_REAL, rows: [...rows] }
}

function relativeError(got: number, want: number): number {
  return Math.abs(got - want) / Math.max(Math.abs(want), 1e-300)
}

function goldenMde(n: number, periods: number, alpha: number): number {
  const hit = GOLDEN.mde.find((g) => g.n === n && g.periods === periods && g.alpha === alpha && g.power === 0.8)
  if (!hit) throw new Error(`no golden MDE for ${n} ${periods} ${alpha}`)
  return hit.value
}

function goldenPower(n: number, periods: number, alpha: number): number {
  const hit = GOLDEN.power.find((g) => g.n === n && g.periods === periods && g.alpha === alpha && g.sharpe === 0.5)
  if (!hit) throw new Error(`no golden power for ${n} ${periods} ${alpha}`)
  return hit.value
}

describe('constants', () => {
  it('fixes the power target at 0.8 and the reference Sharpe at 0.50', () => {
    expect(POWER_TARGET).toBe(0.8)
    expect(REFERENCE_SHARPE).toBe(0.5)
  })
})

describe('powerView over the captured SV3 view', () => {
  const view = powerView(DEFLATED_REAL, FAMILY)

  it('is [POST HOC] on Basis A', () => {
    expect(view.tag).toBe('[POST HOC]')
    expect(view.basis).toBe('A')
  })

  it('keeps the family and reads alpha/k as 0.05 / 21', () => {
    expect(view.family).toEqual({ alpha: 0.05, k: 21 })
    expect(view.alphaFamily).toBe(ALPHA_FAMILY)
  })

  it('has one row per registered trial in the served order', () => {
    expect(view.rows).toHaveLength(21)
    expect(view.rows.map((r) => r.name)).toEqual(DEFLATED_REAL.rows.map((r) => r.name))
    expect(view.rows.map((r) => r.kind)).toEqual(DEFLATED_REAL.rows.map((r) => r.kind))
  })

  it('carries the served P, n and annual Sharpe of each trial untouched', () => {
    view.rows.forEach((row, i) => {
      const served = DEFLATED_REAL.rows[i]!
      expect(row.periods).toBe(served.periods)
      expect(row.n).toBe(served.n)
      expect(row.sharpe).toBe(served.annual_sharpe)
    })
  })

  it('reads years as n over P, in the trial own period count', () => {
    expect(rowOf('volmanaged_v0').years).toBe(2686 / 252)
    expect(rowOf('tsmom_v0').years).toBe(123 / 12)
    expect(rowOf('dtsmom_v0').years).toBe(10)
  })

  it('matches the scipy golden MDE at alpha and at alpha/k for every trial, to 1e-12', () => {
    for (const row of view.rows) {
      expect(relativeError(row.mdeNominal!, goldenMde(row.n, row.periods, 0.05)), row.name).toBeLessThanOrEqual(1e-12)
      expect(relativeError(row.mdeFamily!, goldenMde(row.n, row.periods, ALPHA_FAMILY)), row.name).toBeLessThanOrEqual(1e-12)
    }
  })

  it('matches the scipy golden power at the reference Sharpe 0.50 for every trial, to 1e-12', () => {
    for (const row of view.rows) {
      expect(relativeError(row.powerNominal!, goldenPower(row.n, row.periods, 0.05)), row.name).toBeLessThanOrEqual(1e-12)
      expect(relativeError(row.powerFamily!, goldenPower(row.n, row.periods, ALPHA_FAMILY)), row.name).toBeLessThanOrEqual(1e-12)
    }
  })

  it('volmanaged_v0: MDE 0.76 at alpha and 1.12 at alpha/k, Sharpe/MDE 0.88', () => {
    const row = rowOf('volmanaged_v0')
    expect(row.mdeNominal!.toFixed(2)).toBe('0.76')
    expect(row.mdeFamily!.toFixed(2)).toBe('1.12')
    expect(row.ratio).toBeCloseTo(0.9914875364356387 / row.mdeFamily!, 12)
    expect(row.ratio!.toFixed(2)).toBe('0.88')
  })

  it('reads the ratio as the served Sharpe over the alpha/k MDE, negative for a negative Sharpe', () => {
    for (const row of view.rows) expect(row.ratio).toBeCloseTo(row.sharpe! / row.mdeFamily!, 12)
    expect(rowOf('mim_v0').ratio!).toBeLessThan(0)
  })

  it('holds the MDE within 0.74 to 0.79 at alpha and 1.09 to 1.16 at alpha/k over every trial', () => {
    const nominal = view.rows.map((r) => r.mdeNominal!)
    const family = view.rows.map((r) => r.mdeFamily!)
    expect(Math.min(...nominal).toFixed(2)).toBe('0.74')
    expect(Math.max(...nominal).toFixed(2)).toBe('0.79')
    expect(Math.min(...family).toFixed(2)).toBe('1.09')
    expect(Math.max(...family).toFixed(2)).toBe('1.16')
  })

  function rowOf(name: string) {
    return view.rows.find((r) => r.name === name)!
  }
})

describe('power is read at the fixed reference Sharpe, never at the observed effect', () => {
  it('does not move when the served Sharpe changes', () => {
    const base = rowNamed('volmanaged_v0')
    const low = powerView(withRows([{ ...base, annual_sharpe: 0.1 }]), FAMILY).rows[0]!
    const high = powerView(withRows([{ ...base, annual_sharpe: 3 }]), FAMILY).rows[0]!
    expect(high.powerNominal).toBe(low.powerNominal)
    expect(high.powerFamily).toBe(low.powerFamily)
    expect(high.mdeNominal).toBe(low.mdeNominal)
    expect(high.mdeFamily).toBe(low.mdeFamily)
    expect(high.ratio).not.toBe(low.ratio)
  })

  it('is a probability strictly between 0 and 1, larger at alpha than at alpha/k', () => {
    for (const row of powerView(DEFLATED_REAL, FAMILY).rows) {
      expect(row.powerNominal!).toBeGreaterThan(0)
      expect(row.powerNominal!).toBeLessThan(1)
      expect(row.powerFamily!).toBeLessThan(row.powerNominal!)
    }
  })
})

describe('null handling: NaN becomes null, nothing is invented', () => {
  it('gives null MDE and power for a one-observation book, and keeps the row', () => {
    const view = powerView(withRows([{ ...rowNamed('volmanaged_v0'), n: 1 }]), FAMILY)
    const row = view.rows[0]!
    expect(row.name).toBe('volmanaged_v0')
    expect(row.mdeNominal).toBeNull()
    expect(row.mdeFamily).toBeNull()
    expect(row.powerNominal).toBeNull()
    expect(row.powerFamily).toBeNull()
    expect(row.ratio).toBeNull()
    expect(row.sharpe).toBe(rowNamed('volmanaged_v0').annual_sharpe)
  })

  it('gives null years and null everything for a book with no periods per year', () => {
    const row = powerView(withRows([{ ...rowNamed('volmanaged_v0'), periods: 0 }]), FAMILY).rows[0]!
    expect(row.years).toBeNull()
    expect(row.mdeNominal).toBeNull()
    expect(row.powerFamily).toBeNull()
  })

  it('gives a null Sharpe and ratio for a missing served Sharpe, but keeps MDE and power', () => {
    const row = powerView(withRows([{ ...rowNamed('volmanaged_v0'), annual_sharpe: null }]), FAMILY).rows[0]!
    expect(row.sharpe).toBeNull()
    expect(row.ratio).toBeNull()
    expect(row.mdeFamily).not.toBeNull()
    expect(row.powerNominal).not.toBeNull()
  })

  it('gives a null Sharpe for a non-finite served Sharpe', () => {
    const row = powerView(withRows([{ ...rowNamed('volmanaged_v0'), annual_sharpe: Number.NaN }]), FAMILY).rows[0]!
    expect(row.sharpe).toBeNull()
    expect(row.ratio).toBeNull()
  })

  it('gives null alpha/k figures for an unusable k, and keeps the alpha figures', () => {
    for (const k of [0, -3, Number.NaN]) {
      const view = powerView(DEFLATED_REAL, { alpha: 0.05, k })
      expect(view.alphaFamily, `k ${k}`).toBeNull()
      for (const row of view.rows) {
        expect(row.mdeFamily).toBeNull()
        expect(row.powerFamily).toBeNull()
        expect(row.ratio).toBeNull()
        expect(row.mdeNominal).not.toBeNull()
        expect(row.powerNominal).not.toBeNull()
      }
    }
  })

  it('gives null alpha figures for an alpha outside (0, 1)', () => {
    for (const alpha of [0, 1, -0.05, Number.NaN]) {
      const view = powerView(DEFLATED_REAL, { alpha, k: 21 })
      for (const row of view.rows) {
        expect(row.mdeNominal, `alpha ${alpha}`).toBeNull()
        expect(row.powerNominal).toBeNull()
      }
    }
  })

  it('holds no rows for a view with none', () => {
    const view = powerView(withRows([]), FAMILY)
    expect(view.rows).toEqual([])
    expect(powerSummary(view)).toContain('--')
  })
})

describe('powerCells: the formatted row', () => {
  const view = powerView(DEFLATED_REAL, FAMILY)

  it('volmanaged_v0: 252, 2,686, years 10.66, Sharpe +0.99, MDE 0.76 and 1.12, ratio 0.88, power 0.50 and 0.12', () => {
    const row = view.rows.find((r) => r.name === 'volmanaged_v0')!
    expect(powerCells(row)).toEqual({
      name: 'volmanaged_v0',
      periods: '252',
      n: '2,686',
      years: '10.66',
      sharpe: '+0.99',
      mdeNominal: '0.76',
      mdeFamily: '1.12',
      ratio: '0.88',
      powerNominal: '0.50',
      powerFamily: '0.12',
    })
  })

  it('prints a negative Sharpe with an ASCII minus and no plus on a positive ratio', () => {
    const cells = powerCells(view.rows.find((r) => r.name === 'mim_v0')!)
    expect(cells.sharpe).toBe('-11.49')
    expect(cells.ratio.startsWith('-')).toBe(true)
    expect(powerCells(view.rows.find((r) => r.name === 'volmanaged_v0')!).ratio).not.toContain('+')
  })

  it('prints a monthly book with P 12 and its own years', () => {
    const cells = powerCells(view.rows.find((r) => r.name === 'tsmom_v0')!)
    expect(cells.periods).toBe('12')
    expect(cells.n).toBe('123')
    expect(cells.years).toBe('10.25')
  })

  it('prints -- for every missing figure', () => {
    const row = powerView(withRows([{ ...rowNamed('volmanaged_v0'), n: 1, annual_sharpe: null }]), FAMILY).rows[0]!
    const cells = powerCells(row)
    for (const col of ['sharpe', 'mdeNominal', 'mdeFamily', 'ratio', 'powerNominal', 'powerFamily'] as const) {
      expect(cells[col], col).toBe('--')
    }
  })

  it('has exactly the columns of the copy', () => {
    const cols = Object.keys(POWER.cols).sort()
    expect(Object.keys(powerCells(view.rows[0]!)).sort()).toEqual(cols)
    expect(Object.keys(powerHeaders()).sort()).toEqual(cols)
  })
})

describe('powerHeaders', () => {
  it('names the reference Sharpe 0.50 in both power headers and leaves the others as the copy has them', () => {
    const headers = powerHeaders()
    expect(headers.powerNominal).toBe('Power at 0.50, alpha')
    expect(headers.powerFamily).toBe('Power at 0.50, alpha/k')
    expect(headers.mdeFamily).toBe(POWER.cols.mdeFamily)
    expect(headers.name).toBe(POWER.cols.name)
    for (const col of Object.keys(headers) as PowerCol[]) expect(headers[col]).not.toMatch(/\{/)
  })
})

describe('powerSummary', () => {
  it('states the ranges over the captured view at two decimals', () => {
    expect(powerSummary(powerView(DEFLATED_REAL, FAMILY))).toBe(
      'Smallest annual Sharpe detectable with 80% power: 0.74 to 0.79 at alpha 0.05, 1.09 to 1.16 at alpha/k 0.00238 (k 21), over 9.99 to 11.25 years.',
    )
  })

  it('is one range value twice for a one-trial view', () => {
    const text = powerSummary(powerView(withRows([rowNamed('volmanaged_v0')]), FAMILY))
    expect(text).toContain('0.76 to 0.76 at alpha 0.05')
    expect(text).toContain('1.12 to 1.12 at alpha/k 0.00238')
    expect(text).toContain('10.66 to 10.66 years')
  })

  it('leaves out a trial with no figure from the ranges', () => {
    const rows = [rowNamed('volmanaged_v0'), { ...rowNamed('tsmom_v0'), n: 1 }]
    const text = powerSummary(powerView(withRows(rows), FAMILY))
    expect(text).toContain('0.76 to 0.76 at alpha 0.05')
  })

  it('prints -- where a family figure does not exist', () => {
    const text = powerSummary(powerView(DEFLATED_REAL, { alpha: 0.05, k: 0 }))
    expect(text).toContain('0.74 to 0.79 at alpha 0.05')
    expect(text).toContain('-- to -- at alpha/k --')
  })

  it('names no verdict word', () => {
    expect(powerSummary(powerView(DEFLATED_REAL, FAMILY))).not.toMatch(/\b(pass|fail|significant|reject)/i)
  })
})
