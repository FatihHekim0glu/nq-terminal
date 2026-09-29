import { describe, expect, it } from 'vitest'
import {
  cleanValues,
  formatValue,
  periodEndIndexes,
  rangeWindow,
  readoutText,
  seriesStats,
  stackSummary,
  stackTable,
  stepCrosshair,
  tableBucket,
  timeLabel,
  visibleIndexRange,
  yRange,
  yRangeClearOfLegend,
  zoomView,
} from './LineStack.model'
import type { LineStackPane } from './LineStack.types'

const DAY = 86_400
const utc = (y: number, m: number, d = 1, h = 0) => Date.UTC(y, m - 1, d, h) / 1000
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

describe('series values', () => {
  it('turns NaN, Infinity and undefined into gaps (null), so no line crosses them', () => {
    expect(cleanValues([1, Number.NaN, 2, Number.POSITIVE_INFINITY, undefined, null, -3])).toEqual([1, null, 2, null, null, null, -3])
  })

  it('gives the last, high, low and average of the visible part, skipping gaps', () => {
    const v = [5, null, 1, 9, null, 3]
    expect(seriesStats(v, 0, 5)).toEqual({ last: { index: 5, value: 3 }, high: { index: 3, value: 9 }, low: { index: 2, value: 1 }, mean: 4.5 })
    expect(seriesStats(v, 1, 2)).toEqual({ last: { index: 2, value: 1 }, high: { index: 2, value: 1 }, low: { index: 2, value: 1 }, mean: 1 })
    expect(seriesStats([null, null], 0, 1)).toBeNull()
  })

  it('formats values with fixed decimals, ASCII minus, an optional plus and -- for a gap', () => {
    expect(formatValue(1.23456, 2, '')).toBe('1.23')
    expect(formatValue(-3.25, 1, '%')).toBe('-3.3%')
    expect(formatValue(0.5, 2, '', true)).toBe('+0.50')
    expect(formatValue(-0.0001, 2, '')).toBe('0.00')
    expect(formatValue(null, 2, '%')).toBe('--')
  })

  it('groups thousands in legend, tag and table text, as the side panels and KPI tiles do', () => {
    expect(formatValue(5778540.28, 2, '')).toBe('5,778,540.28')
    expect(formatValue(-1001053.1234, 2, '', true)).toBe('-1,001,053.12')
    expect(formatValue(14411.9895, 2, '')).toBe('14,411.99')
    expect(formatValue(999.5, 1, '%', true)).toBe('+999.5%')
  })

  it('labels daily times as dates and intraday times with the minute', () => {
    expect(timeLabel(utc(2019, 3, 14), false)).toBe('2019-03-14')
    expect(timeLabel(utc(2019, 3, 14, 14) + 1800, true)).toBe('2019-03-14 14:30')
  })
})

describe('range buttons 1D 3D 1M 6M YTD 1Y 5Y Max (look spec 6.4)', () => {
  const first = utc(2010, 1, 4)
  const last = utc(2021, 12, 31)

  it('ends every window at the last point', () => {
    expect(rangeWindow('1D', first, last)).toEqual([last - DAY, last])
    expect(rangeWindow('3D', first, last)).toEqual([last - 3 * DAY, last])
    expect(rangeWindow('Max', first, last)).toEqual([first, last])
  })

  it('counts months and years on the calendar, clamping the day to the month length', () => {
    expect(iso(rangeWindow('1M', first, last)[0])).toBe('2021-11-30')
    expect(iso(rangeWindow('6M', first, last)[0])).toBe('2021-06-30')
    expect(iso(rangeWindow('1Y', first, last)[0])).toBe('2020-12-31')
    expect(iso(rangeWindow('5Y', first, last)[0])).toBe('2016-12-31')
    expect(iso(rangeWindow('1M', first, utc(2021, 3, 31))[0])).toBe('2021-02-28')
    expect(iso(rangeWindow('YTD', first, last)[0])).toBe('2021-01-01')
  })

  it('never starts before the first point', () => {
    expect(rangeWindow('5Y', utc(2019, 1, 2), last)).toEqual([utc(2019, 1, 2), last])
  })
})

describe('visible window', () => {
  const t = [10, 20, 30, 40, 50]
  it('finds the first and last index inside [min, max]', () => {
    expect(visibleIndexRange(t, 15, 45)).toEqual([1, 3])
    expect(visibleIndexRange(t, 0, 100)).toEqual([0, 4])
    expect(visibleIndexRange(t, 20, 20)).toEqual([1, 1])
    expect(visibleIndexRange(t, 21, 29)).toBeNull()
    expect(visibleIndexRange([], 0, 1)).toBeNull()
  })

  it('pads the value range by 5% and keeps a log range positive', () => {
    expect(yRange(0, 10, false)).toEqual([-0.5, 10.5])
    expect(yRange(2, 2, false)).toEqual([1.9, 2.1])
    expect(yRange(0, 0, false)).toEqual([-1, 1])
    expect(yRange(null, null, false)).toEqual([0, 1])
    const [lo, hi] = yRange(1, 4, true)
    expect(lo).toBeCloseTo(1 / 1.05, 12)
    expect(hi).toBeCloseTo(4 * 1.05, 12)
  })

  it('raises the top of the range so the highest value under the legend sits below it', () => {
    // The legend covers the top 20% of the plot; the peak 10 under it must land at 20% or lower.
    const [lo, hi] = yRangeClearOfLegend([-0.5, 10.5], 10, 0.2, false)
    expect(lo).toBe(-0.5)
    expect((hi - 10) / (hi - lo)).toBeCloseTo(0.2, 12)
    // A peak already clear of the legend, no legend, or a legend too tall to clear leaves the range alone.
    expect(yRangeClearOfLegend([-0.5, 10.5], 5, 0.2, false)).toEqual([-0.5, 10.5])
    expect(yRangeClearOfLegend([-0.5, 10.5], null, 0.2, false)).toEqual([-0.5, 10.5])
    expect(yRangeClearOfLegend([-0.5, 10.5], 10, 0, false)).toEqual([-0.5, 10.5])
    expect(yRangeClearOfLegend([-0.5, 10.5], 10, 0.6, false)).toEqual([-0.5, 10.5])
  })

  it('clears the legend in log space on a log scale', () => {
    const [lo, hi] = yRangeClearOfLegend([1, 100], 100, 0.25, true)
    expect(lo).toBe(1)
    expect((Math.log10(hi) - 2) / (Math.log10(hi) - 0)).toBeCloseTo(0.25, 12)
  })
})

describe('keyboard crosshair (UI_SPEC section 5: Left and Right step one bar, Home and End jump to the ends)', () => {
  const t = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
  const view: [number, number] = [20, 60]

  it('places the crosshair on the first or last visible bar when there is none', () => {
    expect(stepCrosshair('ArrowRight', null, t, view)).toEqual({ idx: 2, view })
    expect(stepCrosshair('ArrowLeft', null, t, view)).toEqual({ idx: 6, view })
  })

  it('steps one bar, and pans the view when the bar is outside it', () => {
    expect(stepCrosshair('ArrowRight', 3, t, view)).toEqual({ idx: 4, view })
    expect(stepCrosshair('ArrowLeft', 3, t, view)).toEqual({ idx: 2, view })
    expect(stepCrosshair('ArrowRight', 6, t, view)).toEqual({ idx: 7, view: [30, 70] })
    expect(stepCrosshair('ArrowLeft', 2, t, view)).toEqual({ idx: 1, view: [10, 50] })
  })

  it('jumps to the data ends with Home and End', () => {
    expect(stepCrosshair('Home', 5, t, view)).toEqual({ idx: 0, view: [0, 40] })
    expect(stepCrosshair('End', 5, t, view)).toEqual({ idx: 9, view: [50, 90] })
  })

  it('leaves Left at the first bar and Right at the last bar unhandled, so focus can move on', () => {
    expect(stepCrosshair('ArrowLeft', 0, t, [0, 40])).toBeNull()
    expect(stepCrosshair('ArrowRight', 9, t, [50, 90])).toBeNull()
    expect(stepCrosshair('ArrowUp', 3, t, view)).toBeNull()
    expect(stepCrosshair('ArrowRight', null, [], view)).toBeNull()
  })

  it('zooms about a centre, keeping the view inside the data', () => {
    expect(zoomView([0, 100], 0.5, 50, [0, 100], 1)).toEqual([25, 75])
    expect(zoomView([0, 100], 0.5, 90, [0, 100], 1)).toEqual([45, 95])
    expect(zoomView([25, 75], 2, 50, [0, 100], 1)).toEqual([0, 100])
    expect(zoomView([90, 100], 2, 100, [0, 100], 1)).toEqual([80, 100])
    // Never narrower than the minimum width.
    expect(zoomView([40, 44], 0.5, 42, [0, 100], 10)).toEqual([37, 47])
  })
})

const t5 = [utc(2019, 1, 1), utc(2019, 1, 2), utc(2019, 1, 3), utc(2019, 1, 4), utc(2019, 1, 7)]
const PANES: LineStackPane[] = [
  {
    id: 'eq',
    summaryDrawdown: { value: '-12.00%', basis: 'Basis A' },
    series: [
      { name: 'Strategy', style: 'primary', values: [1, 1.1, 0.99, null, 1.2] },
      { name: 'Benchmark', style: 'benchmark', values: [1, 1.01, 1.02, 1.03, 1.04] },
    ],
  },
  { id: 'dd', unit: '%', decimals: 1, series: [{ name: 'Underwater', style: 'underwater', values: [0, 0, -10, null, 0] }] },
]

describe('accessible summary, readout and table view (UI_SPEC section 9)', () => {
  it('born failing: states no drawdown for a primary series whose pane passes none (exposure, contract counts)', () => {
    const exposure: LineStackPane[] = [{ id: 'x', series: [{ name: 'Gross exposure', style: 'primary', values: [0.02, 0.01, 0, 0, 0] }] }]
    expect(stackSummary(t5, exposure)).not.toMatch(/drawdown/)
    const target: LineStackPane[] = [{ id: 'x', series: [{ name: 'Target (ct)', style: 'primary', values: [1, 1, 1, 1, 1] }] }]
    expect(stackSummary(t5, target)).not.toMatch(/drawdown/)
  })

  it('summarises the first series of every pane, with the drawdown the equity pane passes and its basis', () => {
    const label = stackSummary(t5, PANES)
    expect(label).toBe(
      'Strategy: 4 points from 2019-01-01 to 2019-01-07; first 1.00, last 1.20, low 0.99, high 1.20; max drawdown -12.00% (Basis A). ' +
        'Underwater: 4 points from 2019-01-01 to 2019-01-07; first 0.0%, last 0.0%, low -10.0%, high 0.0%.',
    )
  })

  it('describes every series of a pane that sets summaryAll, in series order, joined like the panes', () => {
    const peers: LineStackPane[] = [
      {
        id: 'rebased',
        summaryAll: true,
        series: [
          { name: 'Run A', style: 'compare1', values: [1, 1.1, 0.99, null, 1.2] },
          { name: 'Run B', style: 'compare2', values: [1, 1.01, 1.02, 1.03, 1.04] },
        ],
      },
    ]
    expect(stackSummary(t5, peers)).toBe(
      'Run A: 4 points from 2019-01-01 to 2019-01-07; first 1.00, last 1.20, low 0.99, high 1.20. ' +
        'Run B: 5 points from 2019-01-01 to 2019-01-07; first 1.00, last 1.04, low 1.00, high 1.04.',
    )
  })

  it('gives the pane drawdown to the first series only, when summaryAll describes several', () => {
    const peers: LineStackPane[] = [
      {
        id: 'eq',
        summaryAll: true,
        summaryDrawdown: { value: '-12.00%', basis: 'Basis A' },
        series: [
          { name: 'Run A', style: 'compare1', values: [1, 1.1, 0.99, null, 1.2] },
          { name: 'Run B', style: 'compare2', values: [1, 1.01, 1.02, 1.03, 1.04] },
        ],
      },
    ]
    const label = stackSummary(t5, peers)
    expect(label.match(/max drawdown/g)).toHaveLength(1)
    expect(label).toContain('high 1.20; max drawdown -12.00% (Basis A). Run B:')
  })

  it('describes only the first series of a pane that does not set summaryAll, and skips an empty pane', () => {
    const plain: LineStackPane[] = [
      { id: 'one', series: PANES[0]!.series },
      { id: 'empty', summaryAll: true, series: [] },
    ]
    expect(stackSummary(t5, plain)).toBe('Strategy: 4 points from 2019-01-01 to 2019-01-07; first 1.00, last 1.20, low 0.99, high 1.20.')
  })

  it('summarises a quarter of a million points without spreading them into arguments', () => {
    const n = 250_000
    const t = Array.from({ length: n }, (_, i) => utc(2019, 1, 2) + i * 60)
    const v = Array.from({ length: n }, (_, i) => 1 + i / n)
    expect(stackSummary(t, [{ id: 'eq', series: [{ name: 'Equity', style: 'primary', values: v }] }])).toMatch(/^Equity: 250000 points from 2019-01-02 00:00 to /)
  })

  it('reads every series at the crosshair, with -- for a gap', () => {
    expect(readoutText(t5, PANES, 3)).toBe('2019-01-04: Strategy --, Benchmark 1.03, Underwater --')
    expect(readoutText(t5, PANES, 2)).toBe('2019-01-03: Strategy 0.99, Benchmark 1.02, Underwater -10.0%')
  })

  it('shows every point when there are few, else period ends', () => {
    expect(tableBucket(t5, 400)).toBe('all')
    const daily = Array.from({ length: 3000 }, (_, i) => utc(2010, 1, 4) + i * DAY)
    expect(tableBucket(daily, 400)).toBe('month')
    const minutes = Array.from({ length: 20_000 }, (_, i) => utc(2019, 1, 2) + i * 900)
    expect(tableBucket(minutes, 400)).toBe('day')
    expect(tableBucket(daily, 5)).toBe('year')
    expect(periodEndIndexes(t5, 'all')).toEqual([0, 1, 2, 3, 4])
    expect(periodEndIndexes([utc(2019, 1, 30), utc(2019, 1, 31), utc(2019, 2, 1), utc(2019, 2, 4)], 'month')).toEqual([1, 3])
  })

  it('builds the table with a date column and one column per series', () => {
    const table = stackTable('Equity and drawdown', t5, PANES, 400)
    expect(table.caption).toBe('Equity and drawdown, every point')
    expect(table.columns.map((c) => c.label)).toEqual(['Date', 'Strategy', 'Benchmark', 'Underwater'])
    expect(table.rows[2]).toEqual({ time: '2019-01-03', s0: '0.99', s1: '1.02', s2: '-10.0%' })
    expect(table.rows[3]).toEqual({ time: '2019-01-04', s0: '--', s1: '1.03', s2: '--' })
  })
})
