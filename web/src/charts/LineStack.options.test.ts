import type uPlot from 'uplot'
import { describe, expect, it } from 'vitest'
import { FENCE_TIME } from './fence'
import { paneOptions, type PaneBuild } from './LineStack.options'
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
    expect(y).toMatchObject({ side: 1, size: 57, gap: 2, stroke: '#FFFFFF', font: canvasFont(DEFAULT_CHART_TOKENS) })
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
    expect(eq[1]).toMatchObject({ label: 'Strategy', stroke: '#FFFFFF', width: 1.5, fill: '#031D38', spanGaps: false })
    expect(eq[2]).toMatchObject({ label: 'Benchmark', stroke: '#F06000', width: 1.5, spanGaps: false })
    expect(eq[2]!.fill).toBeUndefined()
    const dd = build({ pane: DD }).series[1]!
    expect(dd).toMatchObject({ stroke: '#FFFFFF', width: 1, fill: '#6A1020', fillTo: 0, spanGaps: false })
    const rr = build({ pane: RR }).series
    expect(rr.slice(1).map((s) => s.stroke)).toEqual(['#FFFFFF', '#F06000', '#00B5F7'])
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

  it('blanks a value-axis label that a last-value tag covers', () => {
    const o = build({ data: [t.map(() => 1), t.map(() => 1.5)] })
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2 })
    const values = o.axes![1]!.values as (u: unknown, splits: number[]) => (string | null)[]
    expect(values(u, [0, 0.5, 1, 1.5, 2])).toEqual(['0.0', '0.5', null, null, '2.0'])
  })
})
