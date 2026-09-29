import type uPlot from 'uplot'
import { describe, expect, it } from 'vitest'
import { FENCE_TIME } from './fence'
import { yRange, yRangeClearOfLegend } from './LineStack.model'
import { paneOptions, paneUplotData, type PaneBuild } from './LineStack.options'
import { fakePlot, type CtxCall, type FakePlot } from './LineStack.testUtil'
import { CHART_GEOMETRY as G, DEFAULT_CHART_TOKENS, canvasFont, lineStackSeries, makeUplotTheme, seriesColor } from './theme'
import { COMPARE_STYLES, type LaneEpisode, type LineStackPane, type RibbonSpec, type StackSpan } from './LineStack.types'

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

// Compare lines (roadmap 9): a basket of up to eight runs or hypotheses on one pane.
describe('compare line styles in a pane', () => {
  const COMPARE: LineStackPane = {
    id: 'compare',
    series: COMPARE_STYLES.map((style, i) => ({ name: `Run ${i + 1}`, style, values: [] })),
  }

  it('exports eight compare styles, compare1 to compare8, all known to the charts theme', () => {
    expect(COMPARE_STYLES).toEqual(['compare1', 'compare2', 'compare3', 'compare4', 'compare5', 'compare6', 'compare7', 'compare8'])
    const known = Object.keys(lineStackSeries())
    for (const style of COMPARE_STYLES) expect(known, style).toContain(style)
  })

  it('strokes series i in seriesColor(i) at the primary width, in the order given, with no area', () => {
    const series = build({ pane: COMPARE }).series.slice(1)
    expect(series.map((s) => s.label)).toEqual(COMPARE.series.map((s) => s.name))
    series.forEach((s, i) => {
      expect(s.stroke, `series ${i}`).toBe(seriesColor(i, DEFAULT_CHART_TOKENS))
      expect(s.width).toBe(1.5)
      expect(s.spanGaps).toBe(false)
      expect(s.fill).toBeUndefined()
    })
    expect(paneUplotData([10], COMPARE, COMPARE.series.map((_, i) => [i]))).toEqual([[10], ...COMPARE.series.map((_, i) => [i])])
  })

  it('passes a 6 on, 3 off dash for compare5 to compare8 and none for compare1 to compare4', () => {
    const series = build({ pane: COMPARE }).series.slice(1)
    series.slice(0, 4).forEach((s, i) => expect(s.dash, `compare${i + 1}`).toBeUndefined())
    series.slice(4).forEach((s, i) => expect(s.dash, `compare${i + 5}`).toEqual([6, 3]))
  })

  it('gives every build its own dash arrays', () => {
    const a = build({ pane: COMPARE }).series[5]!
    const b = build({ pane: COMPARE }).series[5]!
    expect(a.dash).not.toBe(b.dash)
    a.dash!.push(99)
    expect(b.dash).toEqual([6, 3])
    expect(build({ pane: COMPARE }).series[5]!.dash).toEqual([6, 3])
  })

  it('leaves the existing styles as they were: no dash on the benchmark or rolling lines, the interval band still dashed', () => {
    for (const s of build({ pane: RR }).series.slice(1)) expect(s.dash).toBeUndefined()
    const bench = build().series.find((s) => s.label === 'Benchmark')!
    expect(bench.dash).toBeUndefined()
    const band: LineStackPane = { id: 'band', series: [{ name: 'Low', style: 'ciBound', values: [] }] }
    expect(build({ pane: band, data: [t.map(() => 0.5)] }).series[1]!.dash).toEqual([4, 3])
  })

  it('takes a compare pane with a single series (a basket of one) as a plain line', () => {
    const one: LineStackPane = { id: 'one', series: [{ name: 'Only', style: 'compare1', values: [] }] }
    const s = build({ pane: one, data: [t.map(() => 1)] }).series
    expect(s).toHaveLength(2)
    expect(s[1]).toMatchObject({ label: 'Only', stroke: '#FFFFFF', width: 1.5 })
  })
})

// Without the context layer every option object is what it was before the layer existed (RR, RUN, LIVE
// and HOME build panes with no spans, ribbon or lanes).
describe('pane options without a context layer', () => {
  const shape = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_key, x: unknown) => (typeof x === 'function' ? '[fn]' : x)))

  it('keeps the bottom equity pane exactly as it was', () => {
    expect(shape(build())).toMatchInlineSnapshot(`
      {
        "axes": [
          {
            "border": {
              "show": true,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "font": "13px "Bergoom", "Source Sans 3", system-ui, sans-serif",
            "grid": {
              "dash": [
                2,
                2,
              ],
              "show": false,
              "stroke": "#505050",
              "width": 1,
            },
            "show": true,
            "side": 2,
            "size": 45,
            "splits": "[fn]",
            "stroke": "#FFFFFF",
            "ticks": {
              "show": true,
              "size": 6,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "values": "[fn]",
          },
          {
            "border": {
              "show": true,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "font": "13px "Bergoom", "Source Sans 3", system-ui, sans-serif",
            "gap": 2,
            "grid": {
              "dash": [
                2,
                2,
              ],
              "show": false,
              "stroke": "#505050",
              "width": 1,
            },
            "scale": "y",
            "side": 1,
            "size": "[fn]",
            "splits": "[fn]",
            "stroke": "#FFFFFF",
            "ticks": {
              "show": true,
              "size": 6,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "values": "[fn]",
          },
        ],
        "cursor": {
          "drag": {
            "setScale": false,
            "x": false,
            "y": false,
          },
          "points": {
            "show": false,
          },
          "sync": {
            "filters": {
              "pub": "[fn]",
              "sub": "[fn]",
            },
            "key": "nqt-link-A",
            "scales": [
              "x",
              null,
            ],
          },
        },
        "height": 300,
        "hooks": {
          "draw": [
            "[fn]",
          ],
          "setCursor": [],
          "setScale": [],
        },
        "legend": {
          "show": false,
        },
        "padding": [
          8,
          26,
          0,
          8,
        ],
        "plugins": [
          {
            "hooks": {},
          },
        ],
        "scales": {
          "x": {
            "range": "[fn]",
            "time": true,
          },
          "y": {
            "auto": true,
            "distr": 1,
            "range": "[fn]",
          },
        },
        "series": [
          {},
          {
            "fill": "#031D38",
            "fillTo": "[fn]",
            "label": "Strategy",
            "points": {
              "show": false,
            },
            "spanGaps": false,
            "stroke": "#FFFFFF",
            "width": 0,
          },
          {
            "label": "Benchmark",
            "points": {
              "show": false,
            },
            "spanGaps": false,
            "stroke": "#F06000",
            "width": 1.5,
          },
          {
            "label": "Strategy",
            "points": {
              "show": false,
            },
            "spanGaps": false,
            "stroke": "#FFFFFF",
            "width": 1.5,
          },
        ],
        "width": 800,
      }
    `)
  })

  it('keeps an upper drawdown pane exactly as it was', () => {
    expect(shape(build({ pane: DD, isBottom: false, showFenceLabel: false }))).toMatchInlineSnapshot(`
      {
        "axes": [
          {
            "border": {
              "show": true,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "font": "13px "Bergoom", "Source Sans 3", system-ui, sans-serif",
            "grid": {
              "dash": [
                2,
                2,
              ],
              "show": false,
              "stroke": "#505050",
              "width": 1,
            },
            "show": false,
            "side": 2,
            "size": 45,
            "splits": "[fn]",
            "stroke": "#FFFFFF",
            "ticks": {
              "show": true,
              "size": 6,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "values": "[fn]",
          },
          {
            "border": {
              "show": true,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "font": "13px "Bergoom", "Source Sans 3", system-ui, sans-serif",
            "gap": 2,
            "grid": {
              "dash": [
                2,
                2,
              ],
              "show": false,
              "stroke": "#505050",
              "width": 1,
            },
            "scale": "y",
            "side": 1,
            "size": "[fn]",
            "splits": "[fn]",
            "stroke": "#FFFFFF",
            "ticks": {
              "show": true,
              "size": 6,
              "stroke": "#FFFFFF",
              "width": 1,
            },
            "values": "[fn]",
          },
        ],
        "cursor": {
          "drag": {
            "setScale": false,
            "x": false,
            "y": false,
          },
          "points": {
            "show": false,
          },
          "sync": {
            "filters": {
              "pub": "[fn]",
              "sub": "[fn]",
            },
            "key": "nqt-link-A",
            "scales": [
              "x",
              null,
            ],
          },
        },
        "height": 300,
        "hooks": {
          "draw": [
            "[fn]",
          ],
          "setCursor": [],
          "setScale": [],
        },
        "legend": {
          "show": false,
        },
        "padding": [
          8,
          26,
          0,
          8,
        ],
        "plugins": [
          {
            "hooks": {},
          },
        ],
        "scales": {
          "x": {
            "range": "[fn]",
            "time": true,
          },
          "y": {
            "auto": true,
            "distr": 1,
            "range": "[fn]",
          },
        },
        "series": [
          {},
          {
            "fill": "#6A1020",
            "fillTo": 0,
            "label": "Underwater",
            "points": {
              "show": false,
            },
            "spanGaps": false,
            "stroke": "#FFFFFF",
            "width": 1,
          },
        ],
        "width": 800,
      }
    `)
  })

  it('draws the same canvas calls as before, on the bottom and on an upper pane', () => {
    // cyrb53 over the recorded calls: a 53-bit fingerprint of every call and argument, in order.
    const fingerprint = (text: string): string => {
      let h1 = 0xdeadbeef
      let h2 = 0x41c6ce57
      for (let i = 0; i < text.length; i += 1) {
        const ch = text.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
      return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
    }
    const digest = (o: uPlot.Options, pane: LineStackPane): string => {
      const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 2, data: [t, ...pane.series.map(() => t.map((_, i) => 1 + i / 10))] })
      for (const hook of o.hooks!.draw!) hook?.(u as unknown as uPlot)
      return fingerprint(JSON.stringify(u.ctx.calls))
    }
    expect([digest(build(), EQ), digest(build({ pane: DD, isBottom: false, showFenceLabel: false }), DD)]).toEqual(['1c5fbae16cf7bc', '10608f74579d2a'])
  })

  it('takes empty context fields as absent ones', () => {
    expect(shape(build({ spans: [], ribbon: undefined }))).toEqual(shape(build()))
  })
})

// ---------------------------------------------------------------------------------------------
// Context layer (roadmap 12): marked windows, the regime strip under the time axis, episode lanes.

const TOK = {
  ...DEFAULT_CHART_TOKENS,
  // Distinct colours, so each drawing is shown to take its own token and no other.
  color: {
    ...DEFAULT_CHART_TOKENS.color,
    chartS1: '#010101', legendBg: '#020202', text: '#030303',
    regimeLow: '#040404', regimeMid: '#050505', regimeHigh: '#060606',
    cDown: '#070707', chartVol: '#080808', data: '#090909',
  },
}
const SPANS: StackSpan[] = [
  { from: t[1]!, to: t[3]!, label: 'Early window' },
  { from: t[8]!, to: t[9]!, label: 'Late window' },
]
const RIBBON: RibbonSpec = {
  name: 'Regime',
  values: ['low', 'low', 'mid', 'mid', 'mid', 'high', 'high', 'high', 'low', null],
  states: { low: { label: 'low volatility', glyph: 'L' }, mid: { label: 'mid volatility', glyph: 'M' }, high: { label: 'high volatility', glyph: 'H' } },
  missing: '--',
}
const EPISODES: LaneEpisode[] = [
  { rank: 1, peak: t[0]!, trough: t[3]!, end: t[7]!, open: false, depth: '-20.0%' },
  { rank: 2, peak: t[2]!, trough: t[5]!, end: t[9]!, open: true, depth: '-10.0%' },
  { rank: 3, peak: t[4]!, trough: t[6]!, end: t[8]!, open: false, depth: '-5.0%' },
]
// A lanes pane ignores the fields a line pane uses: zero, logAllowed and any series.
const LANES: LineStackPane = {
  id: 'lanes', zero: 'white', logAllowed: true, series: [], lanes: { name: 'Episodes', episodes: EPISODES },
}

/** Runs every draw hook of `o` on a fake plot spanning the ten days to the fence (or to `xMax`); returns the plot. */
function drawOn(o: uPlot.Options, pane: LineStackPane = EQ, xMax: number = FENCE_TIME): FakePlot {
  const u = fakePlot({ xMin: t[0]!, xMax, yMin: 0, yMax: 2, data: [t, ...pane.series.map(() => t.map((_, i) => 1 + i / 10))] })
  for (const hook of o.hooks!.draw!) hook?.(u as unknown as uPlot)
  return u
}
const firstCall = (calls: readonly CtxCall[], pred: (c: CtxCall) => boolean) => calls.findIndex(pred)
const setsTo = (prop: string, value: unknown) => (c: CtxCall) => c[0] === `set:${prop}` && c[1] === value
const texts = (calls: readonly CtxCall[]) => calls.filter((c) => c[0] === 'fillText').map((c) => c[1])
/** Every text is drawn on a box filled just before it (a chip, or the fence label): the box of each text. */
const boxes = (calls: readonly CtxCall[]) =>
  calls.flatMap((c, i) => {
    if (c[0] !== 'fillText') return []
    const rect = calls.slice(0, i).reverse().find((earlier) => earlier[0] === 'fillRect')
    return rect === undefined ? [] : [{ text: String(c[1]), left: Number(rect[1]), right: Number(rect[1]) + Number(rect[3]) }]
  })

describe('a regime strip under the time axis', () => {
  it('makes the bottom time axis 45 + 8 px tall: the strip and the gap above it', () => {
    expect(G.ribbonHeight + G.ribbonGap).toBe(8)
    expect(build({ ribbon: RIBBON }).axes![0]).toMatchObject({ show: true, size: 45 + 8 })
    expect(build().axes![0]).toMatchObject({ size: 45 })
  })

  it('leaves an upper pane alone: the strip belongs to the bottom pane', () => {
    const o = build({ isBottom: false, ribbon: RIBBON })
    expect(o.axes![0]).toMatchObject({ show: false, size: 45 })
    const calls = drawOn(o).ctx.calls
    expect(firstCall(calls, setsTo('fillStyle', TOK.color.regimeLow))).toBe(-1)
  })

  it('counts the taller axis when it keeps the curve clear of the legend, before uPlot has laid out', () => {
    // Nothing is laid out yet, so the plot height comes from the options: 300 - 8 padding - the axis.
    const legendBox = () => ({ left: 8, top: 8, width: 200, height: 40 })
    const data = [t.map((_, i) => (i === 0 ? 2 : 1)), t.map(() => 1)]
    const unlaidOut = { bbox: { left: 0, top: 0, width: 0, height: 0 } }
    const rangeOf = (o: uPlot.Options) => (o.scales!.y!.range as (u: unknown, lo: number, hi: number) => [number, number])(unlaidOut, 1, 2)
    // The legend reaches 8 + 40 + 2 px down; the plot's top is the 8px padding.
    const clear = (plotHeight: number) => yRangeClearOfLegend(yRange(1, 2, false), 2, (8 + 40 + 2 - 8) / plotHeight, false)
    expect(rangeOf(build({ data, legendBox }))).toEqual(clear(300 - 8 - 45))
    expect(rangeOf(build({ data, legendBox, ribbon: RIBBON }))).toEqual(clear(300 - 8 - 45 - 8))
    expect(clear(300 - 8 - 45 - 8)[1]).toBeGreaterThan(clear(300 - 8 - 45)[1])
  })

  it('draws the strip after the time axis, one state colour per run and none at a gap', () => {
    const calls = drawOn(build({ ribbon: RIBBON, tokens: TOK })).ctx.calls
    const axis = firstCall(calls, setsTo('textAlign', 'center'))
    const low = firstCall(calls, setsTo('fillStyle', TOK.color.regimeLow))
    expect(axis).toBeGreaterThan(-1)
    expect(low).toBeGreaterThan(axis)
    const fills = calls.filter((c) => c[0] === 'set:fillStyle').map((c) => c[1])
    for (const colour of [TOK.color.regimeLow, TOK.color.regimeMid, TOK.color.regimeHigh]) expect(fills).toContain(colour)
    // Runs: low, mid, high, low (the last session is a gap): four rects of the strip's height.
    const strip = calls.filter((c) => c[0] === 'fillRect' && c[4] === G.ribbonHeight)
    expect(strip).toHaveLength(4)
  })
})

describe('marked windows across the panes', () => {
  it('draws the bands first, before the zero line and the fence, on every pane', () => {
    for (const isBottom of [true, false]) {
      const calls = drawOn(build({ pane: DD, data: [t.map(() => -1)], isBottom, spans: SPANS, tokens: TOK }), DD).ctx.calls
      const band = firstCall(calls, setsTo('globalAlpha', G.spanAlpha))
      // The DD pane's zero line strokes in the chart-series token, the fence in its own.
      const zero = firstCall(calls, setsTo('strokeStyle', TOK.color.chartS1))
      const fence = firstCall(calls, setsTo('strokeStyle', TOK.color.fence))
      expect(band, `isBottom ${isBottom}`).toBeGreaterThan(-1)
      expect(zero, `isBottom ${isBottom}`).toBeGreaterThan(band)
      expect(fence, `isBottom ${isBottom}`).toBeGreaterThan(zero)
    }
  })

  it('fills the band in the chart-series token, then draws the chip in the legend and text tokens', () => {
    const calls = drawOn(build({ spans: SPANS, tokens: TOK })).ctx.calls
    const band = firstCall(calls, setsTo('fillStyle', TOK.color.chartS1))
    const chipBg = firstCall(calls, setsTo('fillStyle', TOK.color.legendBg))
    const chipText = firstCall(calls, setsTo('fillStyle', TOK.color.text))
    expect(band).toBeGreaterThan(-1)
    expect(chipBg).toBeGreaterThan(band)
    expect(chipText).toBeGreaterThan(chipBg)
    expect(texts(calls)).toContain('Early window')
  })

  it('puts the chips on the top pane only, where the fence label is', () => {
    const upper = drawOn(build({ spans: SPANS, showFenceLabel: false, tokens: TOK })).ctx.calls
    expect(texts(upper)).not.toContain('Early window')
    expect(firstCall(upper, setsTo('globalAlpha', G.spanAlpha))).toBeGreaterThan(-1)
  })

  it('keeps a chip out from under the fence label, which is drawn at the same spot', () => {
    // 'Late window' starts 2 days before the fence, inside the label's box; 'Early window' is clear of it.
    const calls = drawOn(build({ spans: SPANS, tokens: TOK })).ctx.calls
    expect(texts(calls)).toContain('IS | 2022+ SPENT')
    expect(texts(calls)).toContain('Early window')
    expect(texts(calls)).not.toContain('Late window')
    // The band itself is not dropped with its chip.
    expect(calls.filter((c) => c[0] === 'fillRect' && Number(c[1]) > 500 && Number(c[3]) > 0 && Number(c[4]) > 300)).not.toHaveLength(0)
  })

  it('draws the chip of a window that starts after the fence', () => {
    // The space right of the fence line is empty (the label sits left of it), so the chip fits there.
    const after: StackSpan = { from: FENCE_TIME + DAY, to: FENCE_TIME + 2 * DAY, label: 'After fence' }
    const u = drawOn(build({ spans: [after], tokens: TOK }), EQ, FENCE_TIME + 4 * DAY)
    expect(texts(u.ctx.calls)).toContain('IS | 2022+ SPENT')
    expect(texts(u.ctx.calls)).toContain('After fence')
    const chip = boxes(u.ctx.calls).find((box) => box.text === 'After fence')!
    expect(chip.left).toBeGreaterThanOrEqual(u.valToPos(FENCE_TIME, 'x', true))
    // Its band is drawn once, not once for each group of windows.
    const bands = u.ctx.calls.filter((c) => c[0] === 'fillRect' && Number(c[4]) === u.bbox.height)
    expect(bands).toHaveLength(1)
  })

  it('draws windows either side of the fence, each band and each chip once', () => {
    const spans: StackSpan[] = [
      { from: t[1]!, to: t[3]!, label: 'Before fence' },
      { from: FENCE_TIME - DAY, to: FENCE_TIME + DAY, label: 'Across fence' },
      { from: FENCE_TIME + DAY, to: FENCE_TIME + 2 * DAY, label: 'After fence' },
    ]
    const u = drawOn(build({ spans, tokens: TOK }), EQ, FENCE_TIME + 4 * DAY)
    const shown = texts(u.ctx.calls).filter((text) => spans.some((s) => s.label === text))
    // The window across the fence starts under the label, so it keeps its band and loses its chip.
    expect(shown.sort()).toEqual(['After fence', 'Before fence'])
    expect(u.ctx.calls.filter((c) => c[0] === 'fillRect' && Number(c[4]) === u.bbox.height)).toHaveLength(3)
  })

  it('never lets a chip touch the fence label, wherever the window starts', () => {
    // The plot runs four days past the fence, so the sweep starts windows before and after the label.
    const xMax = FENCE_TIME + 4 * DAY
    const steps = 52
    let shown = 0
    let dropped = 0
    for (let step = 0; step <= steps; step += 1) {
      const from = t[0]! + (step * DAY) / 4
      const u = drawOn(build({ spans: [{ from, to: from + DAY / 2, label: 'Chip' }], tokens: TOK }), EQ, xMax)
      const all = boxes(u.ctx.calls)
      const label = all.find((box) => box.text === 'IS | 2022+ SPENT')!
      const chips = all.filter((box) => box.text === 'Chip')
      for (const chip of chips) {
        shown += 1
        // Clear of the label either side: entirely left of it, or entirely right of it.
        expect(chip.right <= label.left || chip.left >= label.right, `window from step ${step}`).toBe(true)
      }
      // A chip is dropped only for the label: a window that starts after the fence always keeps its chip.
      if (chips.length === 0) {
        dropped += 1
        expect(u.valToPos(from, 'x', true), `window from step ${step}`).toBeLessThan(u.valToPos(FENCE_TIME, 'x', true))
      }
    }
    // Chips far from the label are still drawn; only the ones that would collide are dropped.
    expect(shown).toBeGreaterThan(20)
    expect(dropped).toBeGreaterThan(0)
    expect(shown + dropped).toBe(steps + 1)
  })

  it('leaves the chip off a window that starts under the legend, and still draws its band', () => {
    // The legend covers the top-left 200 x 60 CSS px, so 'Early window' (from the second day, 71px in) would be hidden but for its tail.
    const legendBox = () => ({ left: 8, top: 8, width: 200, height: 60 })
    const spans: StackSpan[] = [...SPANS, { from: t[5]!, to: t[6]!, label: 'Middle window' }]
    const withLegend = drawOn(build({ spans, legendBox, tokens: TOK })).ctx.calls
    expect(texts(withLegend)).not.toContain('Early window')
    expect(texts(withLegend)).toContain('Middle window')
    const bands = (calls: readonly CtxCall[]) => calls.filter((c) => c[0] === 'fillRect' && Number(c[2]) === 8 && Number(c[4]) === 347)
    expect(bands(withLegend)).toHaveLength(3)
    // Each band is drawn once: two passes must not double the opacity of any window.
    expect(bands(withLegend).map((c) => c[1])).toEqual(expect.arrayContaining(bands(drawOn(build({ spans, tokens: TOK })).ctx.calls).map((c) => c[1])))
    // Without a legend in the way, or on a pane that carries no chips, nothing changes.
    expect(texts(drawOn(build({ spans, tokens: TOK })).ctx.calls)).toContain('Early window')
    expect(texts(drawOn(build({ spans, legendBox, showFenceLabel: false, tokens: TOK })).ctx.calls)).not.toContain('Middle window')
    // A legend that has no size yet (before layout) hides nothing.
    expect(texts(drawOn(build({ spans, legendBox: () => ({ left: 0, top: 0, width: 0, height: 0 }), tokens: TOK })).ctx.calls)).toContain('Early window')
  })

  it('draws every chip when there is no fence label to keep clear', () => {
    const calls = drawOn(build({ spans: SPANS, fence: null, tokens: TOK })).ctx.calls
    expect(texts(calls)).toEqual(expect.arrayContaining(['Early window', 'Late window']))
  })
})

describe('an episode-lanes pane', () => {
  const laneBuild = (extra: Partial<PaneBuild> = {}) => build({ pane: LANES, data: [], isBottom: false, showFenceLabel: false, ...extra })

  it('has a fixed value scale of one unit per episode, not fitted to any data', () => {
    const y = laneBuild().scales!.y!
    expect(y.auto).toBe(false)
    expect((y.range as (u: unknown, lo: number, hi: number) => [number, number])(null, 5, 9)).toEqual([0, 3])
    expect((laneBuild({ pane: { ...LANES, lanes: { name: 'x', episodes: EPISODES.slice(0, 1) } } }).scales!.y!.range as () => [number, number])()).toEqual([0, 1])
  })

  it('keeps a valid scale when there are no episodes', () => {
    const empty = { ...LANES, lanes: { name: 'x', episodes: [] } }
    const [lo, hi] = (laneBuild({ pane: empty }).scales!.y!.range as unknown as () => [number, number])()
    expect(hi).toBeGreaterThan(lo)
  })

  it('draws no value ticks or labels, and no tags', () => {
    const y = laneBuild().axes![1]!
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME, yMin: 0, yMax: 3 })
    expect((y.splits as (u: unknown, i: number, lo: number, hi: number) => number[])(u, 1, 0, 3)).toEqual([])
    expect((y.values as (u: unknown, splits: number[]) => unknown[])(u, [])).toEqual([])
    const calls = drawOn(laneBuild(), LANES).ctx.calls
    // A tag is a filled pentagon: beginPath, five points, closePath, fill.
    expect(calls.some((c) => c[0] === 'closePath')).toBe(false)
  })

  it('still reports its gutter need, so it lines up with the panes above it', () => {
    const reports: [number, number][] = []
    const shared = (index: number, need: number) => {
      reports.push([index, need])
      return 61
    }
    const y = laneBuild({ gutter: { shared, index: 2 } }).axes![1]!
    const u = fakePlot({ xMin: t[0]!, xMax: FENCE_TIME })
    expect((y.size as (u: unknown, v: unknown) => number)(u, [])).toBe(61)
    expect(reports).toEqual([[2, 57]])
  })

  it('never shows a zero line, and never takes the log scale', () => {
    // The pane asks for a zero line and a log scale (both ignored); a zero line would stroke in the chart-series token.
    const calls = drawOn(laneBuild({ tokens: TOK }), LANES).ctx.calls
    expect(firstCall(calls, setsTo('strokeStyle', TOK.color.chartS1))).toBe(-1)
    expect(laneBuild({ log: true }).scales!.y!.distr).toBe(1)
  })

  it('draws one bar per episode after the existing layers, in the fall and recover tokens', () => {
    const calls = drawOn(laneBuild({ tokens: TOK }), LANES).ctx.calls
    const fence = firstCall(calls, setsTo('strokeStyle', TOK.color.fence))
    const fall = firstCall(calls, setsTo('fillStyle', TOK.color.cDown))
    const recover = firstCall(calls, setsTo('fillStyle', TOK.color.chartVol))
    expect(fence).toBeGreaterThan(-1)
    expect(fall).toBeGreaterThan(fence)
    expect(recover).toBeGreaterThan(fall)
    // The open episode's recovery is hatched in the data colour, not filled.
    expect(firstCall(calls, setsTo('strokeStyle', TOK.color.data))).toBeGreaterThan(-1)
    expect(texts(calls)).toEqual(expect.arrayContaining(['1', '2', '3']))
  })

  it('outlines the highlighted lane only, read at every draw', () => {
    let rank: number | null = null
    const o = laneBuild({ tokens: TOK, lanesHighlight: () => rank })
    expect(drawOn(o, LANES).ctx.calls.some((c) => c[0] === 'strokeRect')).toBe(false)
    rank = 2
    const calls = drawOn(o, LANES).ctx.calls
    expect(calls.filter((c) => c[0] === 'strokeRect')).toHaveLength(1)
    expect(firstCall(calls, setsTo('strokeStyle', TOK.color.chartS1))).toBeGreaterThan(-1)
    rank = 99
    expect(drawOn(o, LANES).ctx.calls.some((c) => c[0] === 'strokeRect')).toBe(false)
  })

  it('also carries the marked windows, and the strip when it is the bottom pane', () => {
    const calls = drawOn(laneBuild({ isBottom: true, spans: SPANS, ribbon: RIBBON, tokens: TOK }), LANES).ctx.calls
    expect(firstCall(calls, setsTo('globalAlpha', G.spanAlpha))).toBeGreaterThan(-1)
    expect(firstCall(calls, setsTo('fillStyle', TOK.color.regimeMid))).toBeGreaterThan(firstCall(calls, setsTo('fillStyle', TOK.color.cDown)))
  })
})
