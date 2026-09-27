import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from '../theme'
import { cleanPoints, describeXyScatter, xyScatterOption, xyScatterTable, type XyScatterInput } from './xyScatterModel'

const INPUT: XyScatterInput = {
  name: 'volmanaged_v0 against NQ',
  x: { label: 'NQ', unit: '%', decimals: 2 },
  y: { label: 'Strategy', unit: '%', decimals: 2 },
  points: [
    { x: -1.5, y: -0.9, label: '2020-03-16' },
    { x: 0.5, y: 0.25, label: '2020-03-17' },
    { x: 2, y: 1.1, label: '2020-03-18' },
  ],
  line: { slope: 0.55, intercept: 0.01, label: 'OLS' },
}

type Series = { id: string; type: string; data: unknown[]; itemStyle?: unknown }

describe('xyScatter model', () => {
  it('born failing: drops a point with a missing coordinate instead of drawing it at zero', () => {
    const points = cleanPoints([{ x: 1, y: 2 }, { x: Number.NaN, y: 1 }, { x: 3, y: Number.POSITIVE_INFINITY }, { x: 0, y: 0 }])
    expect(points).toEqual([{ x: 1, y: 2 }, { x: 0, y: 0 }])
  })

  it('draws every point and the fitted line across the x range', () => {
    const option = xyScatterOption(INPUT, DEFAULT_CHART_TOKENS)
    const series = option.series as Series[]
    const points = series.find((s) => s.id === 'points')!
    expect(points.type).toBe('scatter')
    expect(points.data).toHaveLength(3)
    const line = series.find((s) => s.id === 'line')!
    expect(line.data).toEqual([[-1.5, 0.01 + 0.55 * -1.5], [2, 0.01 + 0.55 * 2]])
  })

  it('draws a hollow point for the second kind, so the kind is not carried by colour alone', () => {
    const option = xyScatterOption({ ...INPUT, kinds: { solid: 'win', hollow: 'loss' }, points: [{ x: 1, y: 1 }, { x: 2, y: -1, hollow: true }] })
    const data = (option.series as Series[]).find((s) => s.id === 'points')!.data as Array<{ itemStyle: { color: string; borderColor: string } }>
    expect(data[0]!.itemStyle.color).toBe(DEFAULT_CHART_TOKENS.color.chartS1)
    expect(data[1]!.itemStyle.color).toBe(DEFAULT_CHART_TOKENS.color.bg)
    expect(data[1]!.itemStyle.borderColor).toBe(DEFAULT_CHART_TOKENS.color.chartS1)
  })

  it('names the range, the line and the kinds in its summary', () => {
    expect(describeXyScatter(INPUT)).toBe(
      'volmanaged_v0 against NQ: 3 points; NQ from -1.50% to +2.00%, Strategy from -0.90% to +1.10%; OLS slope 0.5500, intercept +0.01%.',
    )
    expect(describeXyScatter({ ...INPUT, line: { ...INPUT.line!, slopeUnit: '% per unit z' } })).toContain('OLS slope 0.5500% per unit z,'
    )
    const kinds = describeXyScatter({ ...INPUT, line: null, kinds: { solid: 'win', hollow: 'loss' }, points: [{ x: 1, y: 1 }, { x: 2, y: -1, hollow: true }] })
    expect(kinds).toContain('1 win (solid), 1 loss (hollow)')
  })

  it('says so when there is nothing to draw', () => {
    expect(describeXyScatter({ ...INPUT, points: [] })).toBe('volmanaged_v0 against NQ: no points.')
  })

  it('gives the same numbers in its table view', () => {
    const table = xyScatterTable({ ...INPUT, kinds: { solid: 'win', hollow: 'loss' } })
    expect(table.columns.map((c) => c.label)).toEqual(['Point', 'NQ', 'Strategy', 'Kind'])
    expect(table.rows[0]).toEqual({ label: '2020-03-16', x: '-1.50%', y: '-0.90%', kind: 'win' })
  })
})
