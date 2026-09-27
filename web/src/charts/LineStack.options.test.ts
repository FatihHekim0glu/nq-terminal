import type uPlot from 'uplot'
import { describe, expect, it } from 'vitest'
import { FENCE_TIME } from './fence'
import { paneOptions, paneUplotData, type PaneBuild } from './LineStack.options'
import { fakePlot } from './LineStack.testUtil'
import { DEFAULT_CHART_TOKENS, canvasFont, makeUplotTheme } from './theme'
import type { LineStackPane } from './LineStack.types'

const DAY = 86_400
const t = Array.from({ length: 10 }, (_, i) => FENCE_TIME - (10 - i) * DAY)
const EQ: LineStackPane = {
  id: 'eq',
  logAllowed: true,
  zero: 'white',
  series: [
    { name: 'Strategy', style: 'primary', values: [] },
    { name: 'Benchmark', style: 'benchmark', values: [] },
  ],
}
const DD: LineStackPane = { id: 'dd', unit: '%', zero: 'white', series: [{ name: 'Underwater', style: 'underwater', values: [] }] }
const DIFF: LineStackPane = { id: 'diff', signed: true, series: [{ name: 'Difference', style: 'perfDiff', values: [] }] }
const RR: LineStackPane = {
  id: 'rr',
  zero: 'grey',
  series: [
    { name: '63', style: 'rollShort', values: [] },
    { name: '252', style: 'rollLong', values: [] },
    { name: 'Vol', style: 'rollVol', values: [] },
  ],
}
const cursorSync = { key: 'nqt-link-A', scales: ['x', null] as ['x', null], filters: { pub: () => true, sub: () => true } }
const syncPlugin = { hooks: {} }

function build(overrides: Partial<PaneBuild> = {}): uPlot.Options {
  const pane = overrides.pane ?? EQ
  return paneOptions({
    pane,
    data: pane.series.map(() => t.map((_, i) => 1 + i / 10)),
    t,
    isBottom: true,
    showFenceLabel: true,
    tokens: DEFAULT_CHART_TOKENS,
    width: 800,
    height: 300,
    log: false,
    view: () => [t[0]!, FENCE_TIME],
    sync: { cursorSync, plugin: syncPlugin },
    fence: FENCE_TIME,
    pxRatio: 1,
    ...overrides,
  })
}

describe('pane options from the charts theme (look spec 6.3)', () => {
  it('takes the axes, padding and fonts from makeUplotTheme', () => {
    const theme = makeUplotTheme(DEFAULT_CHART_TOKENS)
    const o = build()
    expect(o.padding).toEqual([...theme.padding])
    const [x, y] = o.axes!
    expect(y).toMatchObject({ side: 1, gap: 2, stroke: '#FFFFFF', font: canvasFont(DEFAULT_CHART_TOKENS) })
    expect(y!.border).toEqual({ show: true, stroke: '#FFFFFF', width: 1 })
    expect(y!.ticks).toMatchObject({ show: true, size: 6 })
    expect(x).toMatchObject({ side: 2, size: 45, show: true })
    expect(o.legend).toEqual({ show: false })
  })

  it('shows the time axis on the bottom pane only', () => {
    expect(build({ isBottom: false }).axes![0]).toMatchObject({ show: false })
  })

  it('styles every series from lineStackSeries and never spans a gap', () => {
    const eq = build().series
    expect(eq[1]).toMatchObject({ label: 'Strategy', width: 0, fill: '#031D38', spanGaps: false })
    expect(eq[2]).toMatchObject({ label: 'Benchmark', stroke: '#F06000', width: 1.5, spanGaps: false })
    expect(eq[2]!.fill).toBeUndefined()
    expect(eq[3]).toMatchObject({ label: 'Strategy', stroke: '#FFFFFF', width: 1.5, spanGaps: false })
    expect(eq[3]!.fill).toBeUndefined()
    const dd = build({ pane: DD }).series[1]!
    expect(dd).toMatchObject({ stroke: '#FFFFFF', width: 1, fill: '#6A1020', fillTo: 0, spanGaps: false })
    const rr = build({ pane: RR }).series
    expect(rr.slice(1).map((s) => s.stroke)).toEqual(['#FFFFFF', '#F06000', '#00B5F7'])
  })

  it('draws an interval bound (the SV5 bootstrap band on RR) as a thin dashed amber line', () => {
    const band: LineStackPane = { id: 'band', series: [{ name: 'Bootstrap 95% low', style: 'ciBound', values: [] }] }
    const s = build({ pane: band, data: [t.map(() => 0.5)] }).series[1]!
    expect(s).toMatchObject({ label: 'Bootstrap 95% low', stroke: '#FFA028', width: 1, dash: [4, 3], spanGaps: false })
    expect(s.fill).toBeUndefined()
  })

  it('born failing: draws the primary line last, over the benchmark, with its area fill under every line', () => {
    // uPlot draws series in index order: the area first, the benchmark, then the strategy line on top.
    const eq = build().series.slice(1)
    expect(eq.map((s) => [s.label, s.stroke === undefined ? null : s.width, s.fill === undefined ? 'line' : 'area'])).toEqual([
      ['Strategy', 0, 'area'],
      ['Benchmark', 1.5, 'line'],
      ['Strategy', 1.5, 'line'],
    ])
    const strategy = [1, 2]
    const bench = [3, 4]
    expect(paneUplotData([10, 20], EQ, [strategy, bench])).toEqual([[10, 20], strategy, bench, strategy])
    // A drawdown pane with a benchmark underwater curve draws the white underwater line last too.
    const ddPair: LineStackPane = { ...DD, series: [DD.series[0]!, { name: 'Benchmark underwater', style: 'benchmark', values: [] }] }
    const dd = build({ pane: ddPair, data: [t.map(() => -1), t.map(() => -2)] }).series.slice(1)
    expect(dd.map((s) => [s.label, s.width, s.fill === undefined ? 'line' : 'area'])).toEqual([
      ['Underwater', 0, 'area'],
      ['Benchmark underwater', 1.5, 'line'],
      ['Underwater', 1, 'line'],
    ])
    expect(dd[0]!.fillTo).toBe(0)
    // A pane with no lead line keeps its own order.
    expect(build({ pane: RR }).series.slice(1).map((s) => s.label)).toEqual(['63', '252', 'Vol'])
    expect(paneUplotData([10], RR, [[1], [2], [3]])).toEqual([[10], [1], [2], [3]])
  })

  it('born failing: raises the value range so the curve under the legend is never hidden by it', () => {
    // The legend covers the top-left 200 x 40 CSS px of an 800 x 400 plot; the curve peaks at 2 at the start.
    const data = [t.map((_, i) => (i === 0 ? 2 : 1)), t.map(() => 1)]
    const o = build({ data, legendBox: () => ({ left: 8, top: 8, width: 200, height: 40 }) })
    const u = { ...fakePlot({ xMin: t[0]!, xMax: FENCE_TIME }), bbox: { left: 8, top: 8, width: 800, height: 400 } }
    const range = o.scales!.y!.range as (u: unknown, lo: number, hi: number) => [number, number]
    const [lo, hi] = range(u, 1, 2)
    const peakPx = ((hi - 2) / (hi - lo)) * 400
    expect(peakPx).toBeGreaterThanOrEqual(40)
    // With the peak on the right, away from the legend, the range is the plain padded one.
    const late = [t.map((_, i) => (i === t.length - 1 ? 2 : 1)), t.map(() => 1)]
    const o2 = build({ data: late, legendBox: () => ({ left: 8, top: 8, width: 200, height: 40 }) })
    expect((o2.scales!.y!.range as typeof range)(u, 1, 2)).toEqual([0.95, 2.05])
  })

  it('fills the primary area down to the pane bottom and the difference area from zero', () => {
    const fillTo = build().series[1]!.fillTo as (u: unknown, i: number, lo: number, hi: number) => number
    expect(fillTo({ scales: { y: { min: 0.42 } } }, 1, 0, 1)).toBe(0.42)
    const diff = build({ pane: DIFF }).series[1]!
    expect(diff.fillTo).toBe(0)
    expect(typeof diff.fill).toBe('function')
  })

  it('shares the crosshair through the given sync, with no drag zoom and no hover points', () => {
    const o = build()
    expect(o.cursor!.sync).toBe(cursorSync)
    expect(o.cursor!.drag).toEqual({ x: false, y: false, setScale: false })
    expect(o.cursor!.points).toMatchObject({ show: false })
    expect(o.plugins).toContain(syncPlugin)
  })

  it('reads the x window from the stack and pads the value range', () => {
    const o = build({ view: () => [5, 50] })
    const xRange = o.scales!.x!.range as (u: unknown, lo: number, hi: number) => [number, number]
    expect(o.scales!.x!.time).toBe(true)
    // Look spec 6: about 2.5% of padding between the last bar and the value axis.
    expect(xRange(null, 0, 100)).toEqual([5, 50 + 45 * 0.025])
    const yRange = o.scales!.y!.range as (u: unknown, lo: number, hi: number) => [number, number]
    expect(yRange(null, 0, 10)).toEqual([-0.5, 10.5])
    expect(o.scales!.y!.distr).toBe(1)
  })

  it('switches the value scale to log only where the pane allows it', () => {
    expect(build({ log: true }).scales!.y!.distr).toBe(3)
    expect(build({ log: true, pane: DD }).scales!.y!.distr).toBe(1)
  })

  it('draws the underwater zero line after the series, so the drawdown fill cannot cover it', () => {
    const o = build({ pane: DD, data: [t.map(() => -1)] })
    expect(o.hooks!.drawAxes ?? []).toEqual([])
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: -2, yMax: 1, data: [t, t.map(() => -1)] })
    for (const hook of o.hooks!.draw!) hook?.(u as unknown as uPlot)
    const zeroY = Math.round(u.valToPos(0, 'y', true)) + 0.5
    expect(u.ctx.calls).toContainEqual(['moveTo', u.bbox.left, zeroY])
    expect(u.ctx.calls).toContainEqual(['lineTo', u.bbox.left + u.bbox.width, zeroY])
  })

  it('draws the fence and reports where it went', () => {
    const drawn: { fenceX: number | null }[] = []
    const o = build({ onDraw: (_u, info) => drawn.push(info) })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2, data: [t, t.map(() => 1), t.map(() => 1)] })
    for (const hook of o.hooks!.draw!) hook?.(u as unknown as uPlot)
    expect(u.ctx.calls.some((c) => c[0] === 'fillText' && c[1] === 'IS | 2022+ SPENT')).toBe(true)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.fenceX).toBeCloseTo(u.over.clientWidth, 6)
  })

  it("spaces value-axis ticks by the plot's CSS height, before uPlot has sized the canvas", () => {
    const o = build({ pxRatio: 2 })
    // A 400 CSS px plot at 2x is 800 canvas px; the canvas is still the 300px default.
    const u = { ...fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, pxRatio: 2 }), bbox: { left: 16, top: 16, width: 1200, height: 800 } }
    u.ctx.canvas.width = 300
    const splits = o.axes![1]!.splits as (u: unknown, i: number, lo: number, hi: number) => number[]
    // 400 CSS px over a range of 1 at 28px spacing: steps of 0.1.
    expect(splits(u, 1, 0, 1)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
  })

  it('blanks a label near a tag even before uPlot has sized the canvas', () => {
    const o = build({ data: [t.map(() => 1), t.map(() => 1.5)] })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2 })
    u.ctx.canvas.width = 300
    const values = o.axes![1]!.values as (u: unknown, splits: number[]) => (string | null)[]
    // 0.95 is about 9px from the tag at 1: the label would touch it.
    expect(values(u, [0, 0.95, 1.9])).toEqual(['0.00', null, '1.90'])
  })

  it('keeps the 57px gutter for short values', () => {
    const o = build({ data: [t.map(() => 1), t.map(() => 1.5)] })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2 })
    const y = o.axes![1]!
    const labels = (y.values as (u: unknown, splits: number[]) => (string | null)[])(u, [0, 0.5, 1, 1.5, 2])
    expect((y.size as (u: unknown, v: unknown) => number)(u, labels)).toBe(57)
  })

  it('born failing: widens the value axis so a 7-digit last-value tag is never cut (5778540.28)', () => {
    const big = 5778540.28
    const o = build({ data: [t.map(() => big)] , pane: { id: 'eq', series: [{ name: 'Equity', style: 'primary', values: t.map(() => big) }] } })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 5_000_000, yMax: 6_000_000 })
    const y = o.axes![1]!
    const labels = (y.values as (u: unknown, splits: number[]) => (string | null)[])(u, [5_000_000, 5_500_000, 6_000_000])
    const size = (y.size as (u: unknown, v: unknown) => number)(u, labels)
    // The fake context measures 0.55em per character; the tag is its text plus 3px padding each side
    // plus the 5px arrow, so the gutter must hold all of '5778540.28' at 12px.
    const text = '5778540.28'
    const font = DEFAULT_CHART_TOKENS.font.size
    expect(size).toBeGreaterThanOrEqual(Math.ceil(text.length * font * 0.55 + 6 + 5))
  })

  it('blanks a value-axis label that a last-value tag covers', () => {
    const o = build({ data: [t.map(() => 1), t.map(() => 1.5)] })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2 })
    const values = o.axes![1]!.values as (u: unknown, splits: number[]) => (string | null)[]
    expect(values(u, [0, 0.5, 1, 1.5, 2])).toEqual(['0.0', '0.5', null, null, '2.0'])
  })
})
