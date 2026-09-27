import { describe, expect, it } from 'vitest'
import { renderCustom, seriesOf, strayColours, tokenValues, uniqueTokens } from './echartsTestUtil'
import { describeDistribution, distributionOption, distributionTable, histogramBars, seriesTimeFormat, type DistributionInput } from './distributionModel'
import { spreadLabels } from './shared'

const T = uniqueTokens()

const base: DistributionInput = {
  name: 'Daily returns',
  unit: '%',
  edges: [-3, -2, -1, 0, 1, 2],
  counts: [1, 4, 10, 12, 3],
  normal: [1.2, 4.1, 9.5, 11.1, 3.5],
  mean: 0.05,
  sd: 1.1,
  risk: { var95: 1.8, cvar95: 2.4, var99: 2.6, cvar99: 2.9 },
}

const withSeries: DistributionInput = {
  ...base,
  series: { t: [1262563200, 1262649600, 1262736000], v: [0.4, null, -1.2] },
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const byId = (option: unknown, id: string) => seriesOf(option).find((s) => s.id === id) as Record<string, any>

describe('histogramBars', () => {
  it('gives one bar per bin, positive or negative by the bin centre', () => {
    const bars = histogramBars(base, T)
    expect(bars).toHaveLength(5)
    expect(bars[0]).toEqual({ lo: -3, hi: -2, count: 1, fill: T.color.barNeg })
    expect(bars[3]).toEqual({ lo: 0, hi: 1, count: 12, fill: T.color.barPos })
  })

  it('refuses edges that do not match the counts', () => {
    expect(() => histogramBars({ ...base, edges: [0, 1] }, T)).toThrow(/edges/)
  })
})

describe('distributionOption (look spec 7.5 RET)', () => {
  it('draws the histogram horizontally: counts along x from 0, returns up the right-hand axis', () => {
    const option = distributionOption(base, T) as Record<string, any>
    const hist = byId(option, 'hist')
    expect(hist.type).toBe('custom')
    expect(hist.data).toEqual([[1, -3, -2], [4, -2, -1], [10, -1, 0], [12, 0, 1], [3, 1, 2]])
    const x = [option.xAxis].flat()[0]
    const y = [option.yAxis].flat()[0]
    expect(x).toMatchObject({ type: 'value', min: 0 })
    expect(y).toMatchObject({ type: 'value', position: 'right', min: -3, max: 2 })
  })

  it('labels the return axis with its unit, in both layouts (a percent axis reads 1.5%, never 1.5)', () => {
    for (const input of [base, withSeries]) {
      const option = distributionOption(input, T) as Record<string, any>
      const y = [option.yAxis].flat()[0]
      expect(y.axisLabel.formatter(1.5)).toBe('1.5%')
      expect(y.axisLabel.formatter(-2)).toBe('-2%')
    }
    const plain = distributionOption({ ...base, unit: undefined }, T) as Record<string, any>
    expect([plain.yAxis].flat()[0].axisLabel.formatter(0.5)).toBe('0.5')
  })

  it('draws each bar as a rectangle from zero to its count, in the sign colour', () => {
    const option = distributionOption(base, T)
    const drawn = renderCustom(byId(option, 'hist'), 5) as { type: string; shape: Record<string, number>; style: { fill: string } }[]
    expect(drawn[0]!.type).toBe('rect')
    expect(drawn[0]!.style.fill).toBe(T.color.barNeg)
    expect(drawn[3]!.style.fill).toBe(T.color.barPos)
    // 10px per unit in the fake API: count 12 is 120px wide, the bin 0..1 is 10px tall less a 1px gap.
    expect(drawn[3]!.shape).toMatchObject({ x: 0, width: 120, height: 9 })
  })

  it('overlays the fitted normal as a curve in the distribution colour', () => {
    const normal = byId(distributionOption(base, T), 'normal')
    expect(normal.type).toBe('line')
    expect(normal.data[0]).toEqual([1.2, -2.5])
    expect(normal.lineStyle.color).toBe(T.color.distCurve)
  })

  it('marks the mean and one sigma dashed in the curve colour, VaR and CVaR dashed in amber', () => {
    const lines = byId(distributionOption(base, T), 'lines')
    const data = lines.markLine.data as { yAxis: number; name: string; lineStyle: { color: string; type: unknown } }[]
    const at = (name: string) => data.find((d) => d.name === name)!
    expect(at('Mean').yAxis).toBeCloseTo(0.05)
    expect(at('+1σ').yAxis).toBeCloseTo(1.15)
    expect(at('-1σ').yAxis).toBeCloseTo(-1.05)
    expect(at('Mean').lineStyle.color).toBe(T.color.distCurve)
    expect(at('VaR 95')).toMatchObject({ yAxis: -1.8, lineStyle: { color: T.color.data } })
    expect(at('CVaR 99')).toMatchObject({ yAxis: -2.9, lineStyle: { color: T.color.data } })
  })

  it('keeps the y range wide enough for every risk line, rounded out to a nice step', () => {
    const option = distributionOption({ ...base, risk: { ...base.risk, cvar99: 3.5 } }, T) as Record<string, any>
    expect([option.yAxis].flat()[0].min).toBe(-4)
    const wide = distributionOption({ ...base, edges: [-6.9149, -2, -1, 0, 1, 7.4291] }, T) as Record<string, any>
    expect([wide.yAxis].flat()[0]).toMatchObject({ min: -8, max: 8, interval: 2 })
  })

  it('spaces the return ticks evenly: the extent is a whole number of 1, 2 or 5 steps, at most 8', () => {
    for (const edges of [[-6.9149, 0, 7.4291], [-3.1, 0, 2.2], [-0.37, 0, 0.52], [-12.5, 0, 9.8]]) {
      const y = [(distributionOption({ ...base, edges, counts: [1, 1] }, T) as Record<string, any>).yAxis].flat()[0]
      const steps = (y.max - y.min) / y.interval
      expect(Math.abs(steps - Math.round(steps)), JSON.stringify(y)).toBeLessThan(1e-9)
      expect(steps).toBeLessThanOrEqual(8)
      expect(Math.abs(y.min / y.interval - Math.round(y.min / y.interval))).toBeLessThan(1e-9)
      const mantissa = y.interval / 10 ** Math.floor(Math.log10(y.interval))
      expect([1, 2, 5]).toContain(Number(mantissa.toPrecision(6)))
    }
  })

  it('puts every line label in a gutter right of the histogram when the series pane is shown', () => {
    const option = distributionOption(withSeries, T)
    const lines = byId(option, 'lines')
    expect((lines.markLine.data as { label: { show: boolean } }[]).every((d) => d.label.show === false)).toBe(true)
    const [group] = renderCustom(byId(option, 'lineLabels'), 1) as { children: { x: number; style: { text: string; fill: string } }[] }[]
    expect(group!.children.map((t) => t.style.text)).toEqual(['Mean', '+1σ', '-1σ', 'VaR 95', 'CVaR 95', 'VaR 99', 'CVaR 99'])
    // FAKE_PLOT is 400px wide from x = 0: every label starts just right of the pane.
    for (const t of group!.children) expect(t.x).toBeGreaterThan(400)
    expect(group!.children[0]!.style.fill).toBe(T.color.distCurve)
    expect(group!.children[3]!.style.fill).toBe(T.color.data)
  })

  it('born failing: without a series, the labels also sit in a gutter (past the value axis), spread apart', () => {
    // A tiny sd puts the mean and both sigma lines within a pixel: labels inside the pane overprint.
    const tight = { ...base, sd: 1e-6 }
    const option = distributionOption(tight, T) as Record<string, any>
    const lines = byId(option, 'lines')
    expect((lines.markLine.data as { label: { show: boolean } }[]).every((d) => d.label.show === false)).toBe(true)
    const [group] = renderCustom(byId(option, 'lineLabels'), 1) as { children: { x: number; y: number }[] }[]
    for (const t of group!.children) expect(t.x).toBeGreaterThan(400 + 57)
    const ys = group!.children.map((t) => t.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(T.font.size + 1)
  })

  it('spreads gutter labels whose lines are closer than a text line, so none overlap at any size', () => {
    const option = distributionOption(withSeries, T)
    const [group] = renderCustom(byId(option, 'lineLabels'), 1) as { children: { y: number }[] }[]
    const ys = group!.children.map((t) => t.y).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(T.font.size + 1)
  })

  it('keeps both x baselines at the pane bottom, not on return 0 (look spec 6.1)', () => {
    for (const input of [base, withSeries]) {
      const xs = [(distributionOption(input, T) as Record<string, any>).xAxis].flat()
      for (const x of xs) expect(x.axisLine).toMatchObject({ show: true, onZero: false })
    }
  })

  it('draws each bin on whole pixels, so the gap between bins is pure black', () => {
    const hist = byId(distributionOption(base, T), 'hist')
    const api = { coord: (v: number[]) => [v[0]! * 10.37 + 0.3, 200 - v[1]! * 13.61], size: () => [0, 0], value: () => 0 }
    const rects = [0, 1, 2, 3, 4].map((i) => hist.renderItem({ dataIndex: i, coordSys: {} }, api).shape as Rect)
    for (const r of rects) for (const k of ['x', 'y', 'width', 'height'] as const) expect(Number.isInteger(r[k]), k).toBe(true)
    // Neighbouring bins share an edge less the 1px gap: bin i+1 ends one pixel above bin i.
    for (let i = 1; i < rects.length; i++) expect(rects[i - 1]!.y - (rects[i]!.y + rects[i]!.height)).toBe(1)
  })

  it('puts the daily-return series on the left, sharing the return axis with the histogram', () => {
    const option = distributionOption(withSeries, T) as Record<string, any>
    expect(option.grid).toHaveLength(2)
    const [ySeries, yHist] = option.yAxis
    expect(ySeries).toMatchObject({ min: -3, max: 2, interval: 1, position: 'right', gridIndex: 0 })
    expect(yHist).toMatchObject({ min: -3, max: 2, interval: 1, gridIndex: 1, show: false })
    const returns = byId(option, 'returns')
    expect(returns.data).toEqual([[1262563200000, 0.4], [1262649600000, null], [1262736000000, -1.2]])
    expect(returns.lineStyle.color).toBe(T.color.chartS1)
    expect(byId(option, 'hist').xAxisIndex).toBe(1)
  })

  it.each([base, withSeries])('takes every colour from the tokens', (input) => {
    const option = distributionOption(input, T)
    const allowed = tokenValues(T)
    expect(strayColours(option, allowed)).toEqual([])
    expect(strayColours(renderCustom(byId(option, 'hist'), input.counts.length), allowed)).toEqual([])
    const labels = byId(option, 'lineLabels')
    if (labels !== undefined) expect(strayColours(renderCustom(labels, 1), allowed)).toEqual([])
  })
})

describe('describeDistribution and distributionTable', () => {
  it('summarises the sample, the moments and the risk lines', () => {
    expect(describeDistribution(base)).toBe(
      'Daily returns: 30 returns in 5 bins from -3.00% to +2.00%; mean +0.05%, standard deviation 1.10%; VaR 95 1.80%, CVaR 95 2.40%, VaR 99 2.60%, CVaR 99 2.90% (losses).',
    )
  })

  it('lists every bin with its count and the normal expectation', () => {
    const table = distributionTable(base)
    expect(table.columns.map((c) => c.label)).toEqual(['From', 'To', 'Count', 'Normal (expected)'])
    expect(table.rows[0]).toEqual({ from: '-3.00', to: '-2.00', count: 1, normal: '1.2' })
    expect(table.rows).toHaveLength(5)
  })
})

describe('spreadLabels (gutter label placement)', () => {
  it('leaves labels that are already a gap apart where they are, in the input order', () => {
    expect(spreadLabels([50, 10, 30], 14)).toEqual([50, 10, 30])
  })

  it('pushes a crowded run down to one gap apart', () => {
    expect(spreadLabels([100, 102, 96], 14)).toEqual([110, 124, 96])
  })

  it('pulls the run back up when it would pass the bottom of the pane', () => {
    expect(spreadLabels([290, 292], 14, 300)).toEqual([286, 300])
  })
})

describe('seriesTimeFormat: the per-period series axis (look spec 7.5 RET)', () => {
  const day = 86_400
  it('labels years over a long series, month and year over months, day and month over weeks', () => {
    expect(seriesTimeFormat([0, 12 * 365 * day])).toBe('{yyyy}')
    expect(seriesTimeFormat([0, 200 * day])).toBe('{MMM} {yy}')
    expect(seriesTimeFormat([0, 50 * day])).toBe('{dd} {MMM}')
  })
})
