import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS, readChartTokens, type StyleSource } from './chartTokens'
import { collectColours } from './themeTestUtil'
import { lineStackSeries, makeUplotTheme, uplotTheme, uplotWithGrid } from './uplotTheme'

const C = DEFAULT_CHART_TOKENS.color
const TOKEN_VALUES = new Set(Object.values(C))
const FONT = '13px "Bergoom", "Source Sans 3", system-ui, sans-serif'

describe('uplotTheme (look spec 6.3, LineStack)', () => {
  it('puts a white bordered value axis on the right, 57px gutter, 2px label gap', () => {
    const y = uplotTheme.axes[1]!
    expect(y).toMatchObject({ scale: 'y', side: 1, size: 57, gap: 2, stroke: C.chartAxis, font: FONT })
    expect(y.border).toEqual({ show: true, stroke: C.chartAxis, width: 1 })
    expect(y.ticks).toEqual({ show: true, stroke: C.chartAxis, width: 1, size: 6 })
  })

  it('draws the time axis at the bottom with a white 1px baseline (6.1)', () => {
    const x = uplotTheme.axes[0]!
    expect(x).toMatchObject({ side: 2, size: 45, stroke: C.chartAxis, font: FONT })
    expect(x.border).toEqual({ show: true, stroke: C.chartAxis, width: 1 })
    expect(x.ticks).toEqual({ show: true, stroke: C.chartAxis, width: 1, size: 6 })
  })

  it('has the grid off by default on both axes, dotted #505050 when switched on', () => {
    for (const axis of uplotTheme.axes) {
      expect(axis.grid).toEqual({ show: false, stroke: C.chartGrid, width: 1, dash: [2, 2] })
    }
    const on = uplotWithGrid(uplotTheme)
    for (const axis of on.axes) expect(axis.grid.show).toBe(true)
    expect(uplotWithGrid(on, false).axes.every((a) => !a.grid.show)).toBe(true)
  })

  it('keeps 26px between the last bar and the axis, and hides the built-in legend', () => {
    expect(uplotTheme.padding).toEqual([8, 26, 0, 8])
    expect(uplotTheme.legend).toEqual({ show: false })
  })

  it('draws the primary white 1.5px over the flat area fill, the benchmark orange', () => {
    expect(uplotTheme.series).toEqual([
      {},
      { stroke: C.chartS1, width: 1.5, fill: C.chartArea },
      { stroke: C.accent2, width: 1.5 },
    ])
  })

  it('syncs the cursor by link group only when a key is given, never drawing cursor points', () => {
    expect(uplotTheme.cursor).toEqual({ points: { show: false } })
    expect(makeUplotTheme(DEFAULT_CHART_TOKENS, 'A').cursor).toEqual({ sync: { key: 'A' }, points: { show: false } })
  })

  it('uses a token value for every colour (no stray hex)', () => {
    for (const found of [...collectColours(uplotTheme), ...collectColours(lineStackSeries())]) {
      expect(TOKEN_VALUES.has(found.value), found.path).toBe(true)
    }
  })

  it('follows live tokens', () => {
    const style: StyleSource = { getPropertyValue: (n) => (n === '--chart-area' ? '#010203' : '') }
    const theme = makeUplotTheme(readChartTokens(style))
    expect(theme.series[1]).toMatchObject({ fill: '#010203' })
  })

  it('returns fresh objects, since uPlot writes into its options', () => {
    const a = makeUplotTheme()
    const b = makeUplotTheme()
    expect(a).toEqual(b)
    expect(a.axes).not.toBe(b.axes)
    expect(a.axes[0]!.grid).not.toBe(b.axes[0]!.grid)
    const before = JSON.stringify(uplotTheme)
    uplotWithGrid(uplotTheme)
    expect(JSON.stringify(uplotTheme)).toBe(before)
  })
})

describe('lineStackSeries (look spec 6.2, 7.5)', () => {
  it('fills the performance difference green above and dark red below, with a white outline', () => {
    const s = lineStackSeries()
    expect(s.perfDiff).toEqual({ stroke: C.chartS1, width: 1, fillPos: C.perfPos, fillNeg: C.perfNeg })
    expect(s.underwater).toEqual({ stroke: C.chartS1, width: 1, fill: C.perfNeg })
    expect(s.zero).toEqual({ stroke: C.chartS1, width: 1 })
  })

  it('draws rolling Sharpe white and orange over a grey zero line, rolling volatility blue', () => {
    const s = lineStackSeries()
    expect(s.rollShort).toEqual({ stroke: C.chartS1, width: 1.5 })
    expect(s.rollLong).toEqual({ stroke: C.accent2, width: 1.5 })
    expect(s.rollZero).toEqual({ stroke: C.zeroLine, width: 1 })
    expect(s.rollVol).toEqual({ stroke: C.rollVol, width: 1.5 })
  })

  it('marks the fence as a 1px dashed amber line', () => {
    expect(lineStackSeries().fence).toEqual({ stroke: C.fence, width: 1, dash: [4, 3] })
  })
})
