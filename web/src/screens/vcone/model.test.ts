// VCONE model (TASKS Phase 11, ANALYTICS MV9 over MV3): the API's cone drawn as served (fractions shown as % to 1
// decimal), the table view, the ECharts option and the 27F small multiples on one shared scale.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HORIZON,
  FALLBACK_ROOT,
  UNIVERSE_ROOTS,
  coneCsv,
  coneInput,
  coneOption,
  coneTable,
  describeCone,
  pct,
  rankText,
  resolveRoot,
  smallCsv,
  smallView,
  symbolOf,
} from './model'
import { HORIZON_LIST, makeCone, makeSmall } from './vconeTestData'

describe('context', () => {
  it('covers the 27 futures and maps a root to its universe symbol', () => {
    expect(UNIVERSE_ROOTS).toHaveLength(27)
    expect(symbolOf('6E')).toBe('6E.V.0')
    expect(DEFAULT_HORIZON).toBe(21)
  })

  it('takes an instrument context in the universe and falls back to NQ otherwise', () => {
    expect(resolveRoot({ kind: 'instrument', value: 'CL' })).toEqual({ root: 'CL', asked: 'CL', known: true })
    expect(resolveRoot({ kind: 'instrument', value: 'RTY' })).toEqual({ root: FALLBACK_ROOT, asked: 'RTY', known: false })
    expect(resolveRoot(null)).toEqual({ root: FALLBACK_ROOT, asked: null, known: true })
    expect(resolveRoot({ kind: 'run', value: 'x' })).toEqual({ root: FALLBACK_ROOT, asked: null, known: true })
  })
})

describe('formatting', () => {
  it('prints annualised fractions as % to 1 decimal and ranks to 0 decimals', () => {
    expect(pct(0.18349)).toBe('18.3')
    expect(pct(null)).toBe('--')
    expect(pct(Number.NaN)).toBe('--')
    expect(rankText(61.24)).toBe('61')
    expect(rankText(null)).toBe('--')
  })

  it('rounds with the screens one rule (toDecimal), not toFixed', () => {
    expect(rankText(2.5)).toBe('3')
    expect(pct(0.0635)).toBe('6.4') // 6.35 (6.3499999... in binary): toFixed(1) prints 6.3
  })
})

describe('the cone', () => {
  const cone = makeCone()
  const input = coneInput(cone, 'NQ1 Index')

  it('keeps every horizon with history, values untouched', () => {
    expect(input.steps).toEqual([...HORIZON_LIST])
    expect(input.rows[2]).toBe(cone.horizons[2])
  })

  it('drops a horizon with no cone', () => {
    const empty = { n: 3, min: null, p10: null, p25: null, p50: null, p75: null, p90: null, max: null }
    const thin = { ...cone, horizons: cone.horizons.map((h, i) => (i === 5 ? { ...h, ...empty } : h)) }
    expect(coneInput(thin, 'NQ1 Index').steps).toEqual([5, 10, 21, 63, 126])
  })

  it('summarises the short and long horizons for the accessible name', () => {
    const text = describeCone(input)
    expect(text).toContain('NQ1 Index volatility cone')
    expect(text).toContain('at 21 sessions median')
    expect(text).toContain('at 252 sessions median')
    expect(text).toContain('latest 21.0%')
    expect(describeCone({ ...input, steps: [], rows: [] })).toContain('no horizon has enough history')
  })

  it('gives a table view with one row per horizon', () => {
    const table = coneTable(input)
    expect(table.rows).toHaveLength(6)
    expect(table.columns.map((c) => c.label)).toContain('Median %')
    expect(table.rows[2]!.p50).toBe(pct(cone.horizons[2]!.p50))
    expect(table.rows[2]!.rank).toBe('61')
  })

  it('draws the bands, the median and the latest line on a category axis of horizons', () => {
    const option = coneOption(input) as unknown as {
      series: Array<{ id: string; data: unknown[] }>
      xAxis: { data: string[] }
      animation: boolean
    }
    const ids = option.series.map((s) => s.id)
    expect(ids).toEqual(
      expect.arrayContaining(['range-base', 'range-band', 'outer-base', 'outer-band', 'inner-base', 'inner-band', 'median', 'latest']),
    )
    expect(option.xAxis.data).toEqual(['5', '10', '21', '63', '126', '252'])
    expect(option.animation).toBe(false)
    const latest = option.series.find((s) => s.id === 'latest')!
    expect(latest.data[0]).toBeCloseTo(21, 10)
    const band = option.series.find((s) => s.id === 'outer-band')!
    const row = cone.horizons[0]!
    expect(band.data[0]).toBeCloseTo((row.p90! - row.p10!) * 100, 10)
  })

  it('born failing: a cone whose bands were not converted to % would not match', () => {
    const option = coneOption(input) as unknown as { series: Array<{ id: string; data: unknown[] }> }
    const median = option.series.find((s) => s.id === 'median')!
    expect(median.data[0]).not.toBeCloseTo(cone.horizons[0]!.p50!, 5)
  })

  it('exports the table as CSV with the raw fractions', () => {
    const lines = coneCsv(cone).split('\r\n')
    expect(lines[0]).toBe('symbol,sessions,windows,first_window_end,min,p10,p25,p50,p75,p90,max,latest,latest_rank')
    expect(lines).toHaveLength(7)
    expect(lines[1]!.startsWith('NQ.V.0,5,')).toBe(true)
  })
})

describe('small multiples', () => {
  const small = makeSmall(63)
  const view = smallView(small)

  it('keeps one tile per future in the API order on one scale', () => {
    expect(view.tiles.map((t) => t.root)).toEqual(small.rows.map((r) => r.root))
    const top = Math.max(...small.rows.map((r) => (r.stats.max ?? 0) * 100))
    expect(view.scaleMax).toBeGreaterThanOrEqual(top)
    for (const tile of view.tiles) {
      for (const x of Object.values(tile.x)) {
        if (x === null) continue
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
      }
    }
  })

  it('names each tile and says when the latest value is missing', () => {
    expect(view.tiles[1]!.summary).toContain('NQ1 Index')
    expect(view.tiles[1]!.summary).toContain('63 sessions')
    expect(view.tiles[3]!.x.latest).toBeNull()
    expect(view.tiles[3]!.summary).toContain('latest --')
  })

  it('has a table view of the 27 and a CSV', () => {
    expect(view.table.rows).toHaveLength(27)
    expect(view.label).toContain('27 futures, realised volatility at 63 sessions')
    const lines = smallCsv(small).split('\r\n')
    expect(lines).toHaveLength(28)
    expect(lines[0]!.startsWith('symbol,sector,sessions,')).toBe(true)
  })
})
