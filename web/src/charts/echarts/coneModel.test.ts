import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from '../theme'
import { coneKey, coneOption, coneTable, describeCone, type ConeInput } from './coneModel'

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
})
