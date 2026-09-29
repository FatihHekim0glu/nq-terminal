import { describe, expect, it } from 'vitest'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS } from '../theme'
import { coneHasRealised, coneKey, coneOption, coneTable, describeCone, type ConeInput, type ConeOverlay } from './coneModel'

const INPUT: ConeInput = {
  name: 'volmanaged_v0 cone',
  label: 'resampled history, not a forecast',
  unit: '%',
  decimals: 2,
  steps: [1, 2, 3],
  bands: [
    { p: 5, values: [-1.7, -2.5, -3.2] },
    { p: 25, values: [-0.7, -1.2, -1.6] },
    { p: 50, values: [-0.1, -0.3, -0.5] },
    { p: 75, values: [0.4, 0.5, 0.5] },
    { p: 95, values: [1.3, 1.4, 1.7] },
  ],
  realised: [0.2, 0.8, 1.5],
  realisedDates: ['2011-04-25', '2011-04-26', '2011-04-27'],
}

type Series = { id: string; data: Array<[number, number | null]>; stack?: string; stackStrategy?: string; areaStyle?: unknown }

describe('cone model', () => {
  it('stacks the outer and inner bands on their lower percentile whatever the sign', () => {
    const series = coneOption(INPUT, DEFAULT_CHART_TOKENS).series as Series[]
    const base = series.find((s) => s.id === 'outer-base')!
    const band = series.find((s) => s.id === 'outer-band')!
    expect(base.data).toEqual([[1, -1.7], [2, -2.5], [3, -3.2]])
    expect(band.data.map(([, v]) => Number(v!.toFixed(10)))).toEqual([3, 3.9, 4.9])
    expect(band.stack).toBe(base.stack)
    // born failing: ECharts' default 'samesign' stacking puts a positive width on the positive stack, away from
    // a negative p5, so the band would float; 'all' stacks it on the p5 line.
    expect(band.stackStrategy).toBe('all')
    expect(band.areaStyle).toBeTruthy()
  })

  it('draws the five percentile lines and the realised path, named in a key under the chart, not over the axis', () => {
    const series = coneOption(INPUT, DEFAULT_CHART_TOKENS).series as Array<Series & { endLabel?: unknown; lineStyle?: { color: string } }>
    const lines = ['p5', 'p25', 'p50', 'p75', 'p95', 'realised'].map((id) => series.find((s) => s.id === id)!)
    expect(lines.every((s) => s.endLabel === undefined)).toBe(true)
    expect(series.find((s) => s.id === 'realised')!.data).toEqual([[1, 0.2], [2, 0.8], [3, 1.5]])
    const key = coneKey(DEFAULT_CHART_TOKENS)
    expect(key.map((k) => k.label)).toEqual(['p5 and p95', 'p25 and p75', 'Median', 'Realised'])
    expect(key.map((k) => k.fill)).toEqual([lines[0]!.lineStyle!.color, lines[1]!.lineStyle!.color, lines[2]!.lineStyle!.color, lines[5]!.lineStyle!.color])
  })

  it('names the last step, the median and the realised value in its summary', () => {
    expect(describeCone(INPUT)).toBe(
      'volmanaged_v0 cone: resampled history, not a forecast; 3 steps; at the last step the 5th percentile is -3.20%, the median -0.50% and the 95th +1.70%; realised +1.50% at 2011-04-27.',
    )
  })

  it('gives every percentile by step in its table view', () => {
    const table = coneTable(INPUT)
    expect(table.columns.map((c) => c.label)).toEqual(['Step', 'Realised date', 'p5', 'p25', 'Median', 'p75', 'p95', 'Realised'])
    expect(table.caption).toBe('volmanaged_v0 cone, pointwise percentiles of the resampled paths at each step, not a band that whole paths stay inside')
    expect(table.rows[2]).toEqual({ step: '3', date: '2011-04-27', p5: '-3.20%', p25: '-1.60%', p50: '-0.50%', p75: '+0.50%', p95: '+1.70%', realised: '+1.50%' })
  })

  it('flags the realised-date column as the row header, not the numeric step column (D38)', () => {
    const table = coneTable(INPUT)
    expect(table.columns.find((c) => c.key === 'step')?.rowHeader).toBeFalsy()
    expect(table.columns.find((c) => c.key === 'date')?.rowHeader).toBe(true)
  })
})

// ---------------------------------------------------------------- overlays: the paper and model paths on the cone

const PAPER: ConeOverlay = { id: 'paper', label: 'Paper', values: [null, 0.1, 0.3], tone: 'accent2' }
const MODEL: ConeOverlay = { id: 'model', label: 'Model', values: [null, 0.15, null], tone: 'cyanChart' }
const NO_REALISED: ConeInput = { ...INPUT, realised: [null, null, null] }
type Line = Series & { z?: number; lineStyle?: { color: string; width: number }; name?: string }
const seriesOf = (input: ConeInput, tokens = DEFAULT_CHART_TOKENS) => coneOption(input, tokens).series as Line[]
const yAxisOf = (input: ConeInput) => {
  const { min, max, interval } = coneOption(input, DEFAULT_CHART_TOKENS).yAxis as { min: number; max: number; interval: number }
  return { min, max, interval }
}
/** An option as plain data: the axis label formatter is a new closure per call, so it is compared by what it returns. */
const plain = (input: ConeInput) => {
  const option = coneOption(input, DEFAULT_CHART_TOKENS)
  const format = (option.yAxis as { axisLabel: { formatter: (v: number) => string } }).axisLabel.formatter
  return { data: JSON.parse(JSON.stringify(option)) as unknown, labels: [-2, 0, 1.5].map(format) }
}

describe('cone overlays (LV6, [POST HOC]: a path placed on the cone, not resampled)', () => {
  it('draws one line per overlay, in its token colour at the primary width, above the percentile lines', () => {
    const withOverlays = seriesOf({ ...INPUT, overlays: [PAPER, MODEL] })
    const [paper, model] = ['overlay-paper', 'overlay-model'].map((id) => withOverlays.find((s) => s.id === id)!)
    expect(paper!.data).toEqual([[1, null], [2, 0.1], [3, 0.3]])
    expect(model!.data).toEqual([[1, null], [2, 0.15], [3, null]])
    expect(paper!.lineStyle).toMatchObject({ color: DEFAULT_CHART_TOKENS.color.accent2, width: CHART_GEOMETRY.primaryWidth })
    expect(model!.lineStyle).toMatchObject({ color: DEFAULT_CHART_TOKENS.color.cyanChart, width: CHART_GEOMETRY.primaryWidth })
    expect([paper!.z, model!.z]).toEqual([5, 5])
    expect(paper!.name).toBe('Paper')
    const percentileZ = withOverlays.find((s) => s.id === 'p50')!.z!
    expect(paper!.z!).toBeGreaterThan(percentileZ)
  })

  it('reads the colour from the tokens it is given, not from a literal', () => {
    const tokens = { ...DEFAULT_CHART_TOKENS, color: { ...DEFAULT_CHART_TOKENS.color, accent2: 'var(--test-a)', cyanChart: 'var(--test-b)' } }
    const lines = seriesOf({ ...INPUT, overlays: [PAPER, MODEL] }, tokens)
    expect(lines.find((s) => s.id === 'overlay-paper')!.lineStyle!.color).toBe('var(--test-a)')
    expect(lines.find((s) => s.id === 'overlay-model')!.lineStyle!.color).toBe('var(--test-b)')
  })

  it('keeps the overlay ids clear of the percentile, realised and zero series', () => {
    const ids = seriesOf({ ...INPUT, overlays: [{ ...PAPER, id: 'realised' }, { ...MODEL, id: 'p50' }] }).map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts the overlays after the realised line and before the zero line, and leaves the rest in order', () => {
    const ids = seriesOf({ ...INPUT, overlays: [PAPER, MODEL] }).map((s) => s.id)
    expect(ids).toEqual(['outer-base', 'outer-band', 'inner-base', 'inner-band', 'p5', 'p25', 'p50', 'p75', 'p95', 'realised', 'overlay-paper', 'overlay-model', 'zero'])
  })

  it('widens the y range to hold an overlay that leaves the bands, above and below', () => {
    const base = yAxisOf(INPUT)
    const high = yAxisOf({ ...INPUT, overlays: [{ ...PAPER, values: [0, 6.5, 9] }] })
    const low = yAxisOf({ ...INPUT, overlays: [{ ...PAPER, values: [0, -7.5, -9] }] })
    expect(high.max).toBeGreaterThanOrEqual(9)
    expect(high.min).toBe(base.min)
    expect(low.min).toBeLessThanOrEqual(-9)
    expect(low.max).toBe(base.max)
  })

  it('leaves the y range alone for an overlay inside the bands', () => {
    expect(yAxisOf({ ...INPUT, overlays: [PAPER, MODEL] })).toEqual(yAxisOf(INPUT))
  })

  it('adds a key swatch per overlay in its colour, after the four cone entries', () => {
    const key = coneKey(DEFAULT_CHART_TOKENS, [PAPER, MODEL])
    expect(key.map((k) => k.label)).toEqual(['p5 and p95', 'p25 and p75', 'Median', 'Realised', 'Paper', 'Model'])
    expect(key.slice(4).map((k) => k.fill)).toEqual([DEFAULT_CHART_TOKENS.color.accent2, DEFAULT_CHART_TOKENS.color.cyanChart])
    const lines = seriesOf({ ...INPUT, overlays: [PAPER, MODEL] })
    expect(key.slice(4).map((k) => k.fill)).toEqual(['overlay-paper', 'overlay-model'].map((id) => lines.find((s) => s.id === id)!.lineStyle!.color))
  })

  it('names the overlays in the summary with their last value and its step, and skips one with no value', () => {
    const summary = describeCone({ ...INPUT, overlays: [PAPER, MODEL, { ...PAPER, id: 'none', label: 'Empty', values: [null, null, null] }] })
    expect(summary).toBe(`${describeCone(INPUT)} Paper +0.30% at step 3. Model +0.15% at step 2.`)
  })

  it('adds one table column per overlay after Realised, with the values in the cone unit and dashes for gaps', () => {
    const table = coneTable({ ...INPUT, overlays: [PAPER, MODEL] })
    expect(table.columns.map((c) => c.label)).toEqual(['Step', 'Realised date', 'p5', 'p25', 'Median', 'p75', 'p95', 'Realised', 'Paper', 'Model'])
    expect(table.columns.slice(8).every((c) => c.numeric)).toBe(true)
    expect(table.rows.map((r) => [r['overlay-paper'], r['overlay-model']])).toEqual([['--', '--'], ['+0.10%', '+0.15%'], ['+0.30%', '--']])
    expect(table.columns.find((c) => c.key === 'overlay-paper')).toBeDefined()
  })

  it('keeps a table row per step whatever the overlay length', () => {
    expect(coneTable({ ...INPUT, overlays: [{ ...PAPER, values: [0.1] }] }).rows.map((r) => r['overlay-paper'])).toEqual(['+0.10%', '--', '--'])
  })
})

describe('the realised line is drawn only when it has a finite value', () => {
  it('leaves it out when every value is null, and the key stops naming it', () => {
    const ids = seriesOf(NO_REALISED).map((s) => s.id)
    expect(ids).not.toContain('realised')
    expect(ids).toContain('p50')
    expect(coneHasRealised(NO_REALISED)).toBe(false)
    expect(coneKey(DEFAULT_CHART_TOKENS, [], coneHasRealised(NO_REALISED)).map((k) => k.label)).toEqual(['p5 and p95', 'p25 and p75', 'Median'])
  })

  it('leaves it out when every value is not finite', () => {
    expect(seriesOf({ ...INPUT, realised: [Number.NaN, Number.POSITIVE_INFINITY, null] }).map((s) => s.id)).not.toContain('realised')
  })

  it('draws it when only one value is finite, keeping the gaps as gaps', () => {
    const realised = seriesOf({ ...INPUT, realised: [null, 0.8, null] }).find((s) => s.id === 'realised')!
    expect(realised.data).toEqual([[1, null], [2, 0.8], [3, null]])
    expect(coneHasRealised({ ...INPUT, realised: [null, 0.8, null] })).toBe(true)
  })

  it('still says what the summary said before when there is nothing realised', () => {
    expect(describeCone(NO_REALISED)).toBe(
      'volmanaged_v0 cone: resampled history, not a forecast; 3 steps; at the last step the 5th percentile is -3.20%, the median -0.50% and the 95th +1.70%.',
    )
  })

  it('does not take the range from a realised path that is not drawn', () => {
    expect(yAxisOf(NO_REALISED)).toEqual(yAxisOf({ ...INPUT, realised: [0.2, 0.8, 1.5] }))
  })
})

describe('without overlays every output is what it was before', () => {
  const tokens = DEFAULT_CHART_TOKENS
  it.each([['undefined', undefined], ['an empty list', [] as ConeOverlay[]]])('is deep-equal with overlays %s', (_label, overlays) => {
    const given: ConeInput = { ...INPUT, overlays }
    expect(plain(given)).toEqual(plain(INPUT))
    expect(coneKey(tokens, overlays)).toEqual(coneKey(tokens))
    expect(describeCone(given)).toBe(describeCone(INPUT))
    expect(coneTable(given)).toEqual(coneTable(INPUT))
  })

  it('keeps the series, in order, as before', () => {
    expect(seriesOf(INPUT).map((s) => s.id)).toEqual(['outer-base', 'outer-band', 'inner-base', 'inner-band', 'p5', 'p25', 'p50', 'p75', 'p95', 'realised', 'zero'])
  })
})
