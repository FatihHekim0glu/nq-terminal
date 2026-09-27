// SEAS model (TASKS Phase 11): scaling, the one-standard-error band, the grid rows, the heatmap layout,
// the CSV and the request shape. Born-failing cases: a band drawn at two standard errors, or a USD book
// scaled to percent, would change the numbers these tests pin.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import { SEAS } from '../../copy/seas'
import { excludedText, gridRows, heatCsv, heatInput, ladderInput, panelCsv, panelOf, pickText, scaleOf, yearOptions } from './model'
import { makeSeasonality } from './seasTestData'
import { seasRequest } from './useSeasonality'

describe('SEAS scale', () => {
  it('shows fractions in percent with 2 decimals and USD books in USD with 0', () => {
    expect(scaleOf({ fraction: true, kind: 'instrument', unit: 'fraction' })).toMatchObject({ factor: 100, unit: '%', decimals: 2, note: SEAS.unitsPercent })
    expect(scaleOf({ fraction: true, kind: 'hypothesis', unit: 'return on capital per session' }).note).toBe(SEAS.unitsCapital)
    expect(scaleOf({ fraction: false, kind: 'hypothesis', unit: 'USD per session' })).toMatchObject({ factor: 1, decimals: 0 })
  })

  it('shows the 30-minute panel of an instrument in basis points with 2 decimals, so small bucket means stay apart', () => {
    const inst = { fraction: true, kind: 'instrument', unit: 'fraction' } as const
    expect(scaleOf(inst, 'intraday')).toMatchObject({ factor: 10000, unit: ' bp', decimals: 2 })
    expect(scaleOf(inst, 'weekday')).toMatchObject({ factor: 100, unit: '%', decimals: 2 })
    // NQ 2010 to 2021 (repaired, real file): 15:00 mean -0.079 bp, 09:30 standard error about 0.4 bp
    const row = { id: 'intraday-12', label: '15:00', n: 2800, mean: -0.079, se: 0.412, lo: -0.491, hi: 0.333, hit: 49.6 }
    expect(pickText(row, scaleOf(inst, 'intraday'))).toBe('Row 15:00: mean -0.08 bp, one standard error 0.41 bp, hit rate 49.6%, n 2800.')
  })

  it('scales the 30-minute grid, bars and band in basis points (born failing: percent read 0.00 or 0.001)', () => {
    const data = makeSeasonality()
    const intraday = panelOf(data, 'intraday')!
    const row = gridRows(data, intraday)[5]!
    expect(row.mean).toBeCloseTo(0.0001 * 10000, 9) // 1 bp, not 0.01%
    expect(row.se).toBeCloseTo(0.5, 9)
    expect(row.lo).toBeCloseTo(0.5, 9)
    expect(row.hi).toBeCloseTo(1.5, 9)
    const input = ladderInput(data, intraday)
    expect(input.unit).toBe('bp')
    expect(input.decimals).toBe(2)
    expect(input.bars[5]!.value).toBeCloseTo(1, 9)
    expect(input.bars[5]!.lo).toBeCloseTo(0.5, 9)
    // the other panels and the heatmap stay in percent
    expect(gridRows(data, panelOf(data, 'weekday')!)[0]!.mean).toBeCloseTo(0.1, 12)
    expect(heatInput(data).unit).toBe('%')
  })

  it('says in the panel note that the 30-minute panel is in basis points', () => {
    expect(SEAS.intradayScale).toMatch(/basis points/)
    expect(SEAS.intradayScale).toMatch(/1 bp is 0\.01%/)
  })

  it('offers the in-sample years only', () => {
    const years = yearOptions().map((o) => o.value)
    expect(years[0]).toBe('2010')
    expect(years.at(-1)).toBe('2021')
    expect(years).toHaveLength(12)
  })
})

describe('SEAS ladder and grid', () => {
  const data = makeSeasonality()
  const weekday = panelOf(data, 'weekday')!

  it('draws each mean with a band of plus and minus one standard error, in percent', () => {
    const input = ladderInput(data, weekday)
    const mon = input.bars[0]!
    expect(mon.label).toBe('Mon')
    expect(mon.value).toBeCloseTo(0.1, 12)
    expect(mon.lo).toBeCloseTo(0.1 - 0.05, 12)
    expect(mon.hi).toBeCloseTo(0.1 + 0.05, 12)
    expect(mon.n).toBe(100)
    expect(input.ci).toBe(SEAS.whiskers)
    // a group with one value has a mean but no band
    const fri = input.bars[4]!
    expect(fri.value).toBeCloseTo(-0.2, 12)
    expect(fri.lo).toBeNull()
    expect(fri.hi).toBeNull()
  })

  it('gives the grid the same numbers and the hit rate in percent', () => {
    const rows = gridRows(data, weekday)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ label: 'Mon', n: 100 })
    expect(rows[0]!.hit).toBeCloseTo(55, 12)
    expect(rows[3]).toMatchObject({ n: 0, mean: null, se: null, hit: null })
  })

  it('writes a readout for a picked row, and says when a group is empty', () => {
    const rows = gridRows(data, weekday)
    const s = scaleOf(data)
    expect(pickText(rows[0]!, s)).toBe('Row Mon: mean +0.10%, one standard error 0.05%, hit rate 55.0%, n 100.')
    expect(pickText(rows[3]!, s)).toBe('Row Thu: no value (n 0).')
  })

  it('keeps a USD book in USD (born failing: percent scaling would multiply by 100)', () => {
    const usd = makeSeasonality({ fraction: false, unit: 'USD per session, one NQ contract', kind: 'hypothesis' })
    const bar = ladderInput(usd, panelOf(usd, 'weekday')!).bars[0]!
    expect(bar.value).toBeCloseTo(0.001, 12)
    expect(ladderInput(usd, panelOf(usd, 'weekday')!).unit).toBe('USD') // withUnit adds the one space
  })
})

describe('SEAS heatmap and exports', () => {
  const data = makeSeasonality()

  it('puts the newest year first with months across, blanks kept', () => {
    const heat = heatInput(data)
    expect(heat.kind).toBe('mret')
    expect(heat.rows).toEqual(['2021', '2020'])
    expect(heat.columns).toHaveLength(12)
    expect(heat.values[0]![0]).toBeCloseTo(-1, 12)
    expect(heat.values[1]![0]).toBeCloseTo(2, 12)
    expect(heat.values[0]![11]).toBeNull()
  })

  it('exports the panel at full precision and the heatmap by year', () => {
    const csv = panelCsv(data, panelOf(data, 'weekday')!)
    expect(csv.split('\r\n')[1]).toBe('Mon,100,0.001,0.0005,0.55')
    expect(heatCsv(data).split('\r\n')[1]!.startsWith('2020,0.02')).toBe(true)
  })

  it('names the sessions the 30-minute buckets left out', () => {
    expect(excludedText(panelOf(data, 'intraday')!)).toBe('4 sessions left out of the 30-minute buckets (qa.day_gate).')
    expect(excludedText(panelOf(data, 'month')!)).toBeNull()
  })
})

describe('SEAS request', () => {
  it('asks for an instrument by root with its variant and years, and a hypothesis by name with its cost', () => {
    const inst = seasRequest({ kind: 'instrument', subject: 'NQ', startYear: 2015, endYear: 2021, variant: null, cost: 1 })
    expect(inst).toEqual({ kind: 'instrument', root: 'NQ', query: { start_year: 2015, end_year: 2021, variant: undefined } })
    const hyp = seasRequest({ kind: 'hypothesis', subject: 'volmanaged_v0', startYear: 2010, endYear: 2021, variant: 'vendor', cost: 2 })
    expect(hyp).toEqual({ kind: 'hypothesis', name: 'volmanaged_v0', query: { start_year: 2010, end_year: 2021, cost: 2 } })
  })
})

describe('SEAS copy', () => {
  it('passes the house copy rules and names no test statistic', () => {
    expect(findCopyViolations(SEAS)).toEqual([])
    const text = JSON.stringify(SEAS).toLowerCase()
    expect(text).not.toMatch(/welch|t-stat|z-score|significan/)
  })
})
