// DQ universe model (research_ux item 3): the matrix rows and their screen-reader text, the share rounding, the fence
// held on the screen side, the keyboard step and the CSV. Pure functions.
import { describe, expect, it } from 'vitest'
import { DQ } from '../../copy/dq'
import {
  barText, gridStep, matrixColumns, matrixRows, percentText, universeCsv, universeSummary, visibleYears,
  type DqUniverse, type UniverseCounts, type UniverseRoot, type UniverseRow,
} from './universeModel'

const YEARS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021]

function counts(sessions: number, usable: number, gated = 0, unrep = 0, rej = 0): UniverseCounts {
  return { sessions, usable, gated_out: gated, unrepairable: unrep, rejected: rej, usable_share: sessions === 0 ? null : usable / sessions }
}

function oneMinute(variant: 'vendor' | 'repaired', byYear: Record<number, UniverseCounts>): UniverseRow {
  const cells = YEARS.map((year) => ({ year, ...(byYear[year] ?? counts(0, 0)) }))
  const sum = (f: (c: UniverseCounts) => number) => cells.reduce((a, c) => a + f(c), 0)
  const total = counts(sum((c) => c.sessions), sum((c) => c.usable), sum((c) => c.gated_out), sum((c) => c.unrepairable), sum((c) => c.rejected))
  return { timeframe: '1m', variant, cells, total }
}

function root(over: Partial<UniverseRoot> & { root: string }): UniverseRoot {
  return {
    symbol: `${over.root}.V.0`, repair_status: 'v1', source: 'results/x.json', qa_source: 'results/qa.json',
    first_bar: '2010-09-30', last_bar: '2021-12-31', last_sealed: false, rows: [], daily: null, blocks: [], ...over,
  }
}

const GC = root({
  root: 'GC',
  rows: [oneMinute('vendor', { 2011: counts(100, 90, 8, 2) }), oneMinute('repaired', { 2011: counts(100, 98, 0, 2) })],
  daily: { source: 'results/qa_report_carry_1d.json', rows: 2860, first_bar: '2010-09-30', last_bar: '2021-12-31', last_sealed: false, missing_nyse_sessions: 6 },
})
const ES = root({
  root: 'ES', repair_status: 'vendor_only', last_bar: '2021-12-30',
  rows: [oneMinute('vendor', { 2011: counts(100, 60, 40) })], blocks: ['validation FAIL: failed checks [\'H\']', 'x: 2 sessions'],
})
const NQ = root({ root: 'NQ', repair_status: 'nq', last_bar: 'ignored', last_sealed: true, rows: [oneMinute('vendor', {})] })

const UNIVERSE: DqUniverse = { label: '[POST HOC] label', fence: '2021-12-31', years: YEARS, roots: [GC, ES, NQ], missing: [] }

describe('percentText', () => {
  it('cuts to one decimal and never rounds a short share up to 100.0', () => {
    expect(percentText(0.99996)).toBe('99.9')
    expect(percentText(1)).toBe('100.0')
    expect(percentText(0.5)).toBe('50.0')
    expect(percentText(0.57)).toBe('57.0')
    expect(percentText(0)).toBe('0.0')
  })
})

describe('matrixRows', () => {
  it('gives each root its 1m rows then a 1d row, every row as wide as the header', () => {
    const rows = matrixRows(UNIVERSE)
    expect(rows.map((r) => r.id)).toEqual(['GC|vendor', 'GC|repaired', 'GC|1d', 'ES|vendor', 'ES|1d', 'NQ|vendor', 'NQ|1d'])
    const width = matrixColumns(UNIVERSE).length
    expect(width).toBe(5 + YEARS.length + 2)
    expect(rows.every((r) => r.cells.length === width)).toBe(true)
  })

  it('prints the usable share per year and describes the counts in words', () => {
    const [vendor, repaired] = matrixRows(UNIVERSE)
    const col = 5 + YEARS.indexOf(2011)
    expect(vendor!.cells[col]!.text).toBe('90.0%')
    expect(vendor!.cells[col]!.share).toBe(0.9)
    expect(vendor!.cells[col]!.description).toBe('GC 1m vendor 2011: 90 of 100 sessions usable, 90.0%. Gated out 8, unrepairable 2, rejected 0.')
    expect(repaired!.cells[col]!.text).toBe('98.0%')
    expect(vendor!.cells[5]!.text).toBe('--')
    expect(vendor!.cells[5]!.description).toBe('GC 1m vendor 2010: no session in the records.')
    const total = vendor!.cells[5 + YEARS.length]!
    expect(total.description).toContain('GC 1m vendor, all years: 90 of 100 sessions usable')
  })

  it('shows the repair status in words and quotes the blocks on the vendor row only', () => {
    const rows = matrixRows(UNIVERSE)
    const es = rows.find((r) => r.id === 'ES|vendor')!
    expect(es.cells[2]!.text).toBe('Vendor only, every candidate excluded')
    expect(es.cells[es.cells.length - 1]!.text).toBe("validation FAIL: failed checks ['H']; x: 2 sessions")
    const gcRepaired = rows.find((r) => r.id === 'GC|repaired')!
    expect(gcRepaired.cells[gcRepaired.cells.length - 1]!.text).toBe('')
    expect(rows[0]!.cells[2]!.text).toBe('v1 repair')
  })

  it('draws the 1d row from the 1d QA, with no per-year counts', () => {
    const daily = matrixRows(UNIVERSE).find((r) => r.id === 'GC|1d')!
    expect(daily.cells[1]!.text).toBe('1d')
    expect(daily.cells[5]!.text).toBe('--')
    expect(daily.cells[5]!.description).toBe('GC 1d 2010: the 1d QA keeps no per-year count.')
    expect(daily.cells[5 + YEARS.length]!.text).toBe('2,860 bars')
    expect(daily.cells[daily.cells.length - 1]!.text).toBe('6 NYSE sessions from 2010-10 have no 1d bar.')
    const none = matrixRows(UNIVERSE).find((r) => r.id === 'ES|1d')!
    expect(none.cells[none.cells.length - 1]!.text).toBe(DQ.universe.noDaily)
    expect(none.cells[3]!.text).toBe('--')
  })

  it('says a root with no QA bound has none, in the cell name', () => {
    const rows = matrixRows({ ...UNIVERSE, roots: [root({ root: 'ZZ', first_bar: null, last_bar: null, rows: [oneMinute('vendor', {})] })] })
    expect(rows[0]!.cells[3]!.text).toBe('--')
    expect(rows[0]!.cells[3]!.description).toBe('ZZ 1m vendor First bar: No QA bound for this root.')
  })
})

describe('the fence on the screen side (born failing)', () => {
  it('shows a last bar the API flags as sealed only as the sealed text', () => {
    const nq = matrixRows(UNIVERSE).find((r) => r.id === 'NQ|vendor')!
    expect(nq.cells[4]!.text).toBe('2021-12-31 or later, sealed')
    expect(nq.cells[4]!.text).not.toContain('ignored')
  })

  it('never prints a date after the fence even if the API forgets to flag it', () => {
    expect(barText('2026-09-24', '2021-12-31', false)).toBe('2021-12-31 or later, sealed')
    expect(barText('2026-09-24 23:59:00+00:00', '2021-12-31', false)).toBe('2021-12-31 or later, sealed')
    expect(barText('2022-01-03', '2021-12-31', false)).toBe('2021-12-31 or later, sealed')
    expect(barText('2021-12-31', '2021-12-31', false)).toBe('2021-12-31')
    expect(barText('2021-12-30', '2021-12-31', false)).toBe('2021-12-30')
    expect(barText(null, '2021-12-31', false)).toBeNull()
    const leaky = matrixRows({ ...UNIVERSE, roots: [root({ root: 'HO', last_bar: '2026-03-02', rows: [oneMinute('vendor', {})] })] })
    expect(leaky[0]!.cells[4]!.text).toBe('2021-12-31 or later, sealed')
  })

  it('drops a year after the fence from the columns and the cells', () => {
    const wide: DqUniverse = { ...UNIVERSE, years: [...YEARS, 2022] }
    expect(visibleYears(wide)).toEqual(YEARS)
    expect(matrixColumns(wide)).not.toContain('2022')
    expect(matrixRows(wide)[0]!.cells).toHaveLength(5 + YEARS.length + 2)
    expect(universeSummary(wide)).toBe('3 roots, 2010 to 2021. Each year cell is the share of NYSE sessions that are usable; the readout under the table gives the counts.')
  })
})

describe('gridStep', () => {
  const at = { row: 2, col: 3 }
  it('moves one cell with the arrows and stops at the edges', () => {
    expect(gridStep(at, 'ArrowRight', 5, 8)).toEqual({ row: 2, col: 4 })
    expect(gridStep(at, 'ArrowLeft', 5, 8)).toEqual({ row: 2, col: 2 })
    expect(gridStep(at, 'ArrowDown', 5, 8)).toEqual({ row: 3, col: 3 })
    expect(gridStep(at, 'ArrowUp', 5, 8)).toEqual({ row: 1, col: 3 })
    expect(gridStep({ row: 0, col: 0 }, 'ArrowUp', 5, 8)).toEqual({ row: 0, col: 0 })
    expect(gridStep({ row: 4, col: 7 }, 'ArrowRight', 5, 8)).toEqual({ row: 4, col: 7 })
  })

  it('jumps with Home, End, Page Up and Page Down, and ignores other keys', () => {
    expect(gridStep(at, 'Home', 5, 8)).toEqual({ row: 2, col: 0 })
    expect(gridStep(at, 'End', 5, 8)).toEqual({ row: 2, col: 7 })
    expect(gridStep(at, 'PageUp', 5, 8)).toEqual({ row: 0, col: 3 })
    expect(gridStep(at, 'PageDown', 5, 8)).toEqual({ row: 4, col: 3 })
    expect(gridStep(at, 'a', 5, 8)).toBeNull()
    expect(gridStep(at, 'ArrowDown', 0, 8)).toBeNull()
  })
})

describe('universeCsv', () => {
  it('writes one line per root, series and year with the counts', () => {
    const lines = universeCsv(UNIVERSE).split('\r\n')
    expect(lines[0]).toBe('root,series,year,sessions,usable,gated_out,unrepairable,rejected,usable_share')
    expect(lines).toHaveLength(1 + 4 * YEARS.length) // GC vendor and repaired, ES vendor, NQ vendor
    expect(lines).toContain('GC,1m vendor,2011,100,90,8,2,0,0.9')
    expect(lines).toContain('GC,1m vendor,2010,0,0,0,0,0,')
    expect(lines.some((l) => l.includes('2022'))).toBe(false)
  })
})
