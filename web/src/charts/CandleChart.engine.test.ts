// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountCandleChart, type CandleEngineInput, type CursorEvent, type CandleView } from './CandleChart.engine'
import type { CandleBars } from './CandleChart.model'
import { FAKE_DAY, FAKE_T0, fakeBars, fakeLib } from './CandleChart.fake'
import { createCrosshairBus, type CrosshairMove } from './sync'
import { DEFAULT_CHART_TOKENS } from './theme'

const C = DEFAULT_CHART_TOKENS.color
const DAY = FAKE_DAY
const T0 = FAKE_T0
const bars = fakeBars

function setup(extra: Partial<CandleEngineInput> = {}, n = 30) {
  const fake = fakeLib()
  const bus = createCrosshairBus()
  const cursors: CursorEvent[] = []
  const views: CandleView[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const input: CandleEngineInput = {
    bars: bars(n), step: DAY, intraday: false, timeZone: 'UTC',
    fills: [{ t: T0 + 2 * DAY + 3600, side: 'buy', qty: 1, price: 102.25 }],
    rolls: [{ t: T0 + 5 * DAY, gapPts: 10, gapPct: 0.1 }],
    indicator: { name: 'RV22', values: Array.from({ length: n }, () => 15), unit: '%' },
    precision: 2, minMove: 0.25, grid: false, link: 'A', chartId: 'test-chart', tokens: DEFAULT_CHART_TOKENS, bus,
    schedule: (f) => f(),
    ...extra,
  }
  const engine = mountCandleChart(fake.lib, host, input, { onCursor: (e) => cursors.push(e), onView: (v) => views.push(v) })
  return { fake, bus, cursors, views, engine, input, host }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('chart options from the theme', () => {
  it('keeps attribution on, overrides the separator colours and sizes itself', () => {
    const { fake } = setup()
    const o = fake.chart.options as { layout: Record<string, unknown>; autoSize: boolean }
    expect(o.autoSize).toBe(true)
    expect(o.layout.attributionLogo).toBe(true)
    expect(o.layout.panes).toEqual({ separatorColor: C.chartSplitInner, separatorHoverColor: C.chartSplitHover, enableResize: false })
    expect(o.layout.background).toEqual({ type: 'solid', color: C.bg })
  })

  it('draws white up and blue down candles, the tag and last-price line replacing the library ones', () => {
    const { fake } = setup()
    const candles = fake.series.find((s) => s.kind === 'Candlestick')!
    expect(candles.options).toMatchObject({
      upColor: C.candleUp, downColor: C.candleDn, wickUpColor: C.candleUp, wickDownColor: C.candleDn, borderVisible: false,
      priceLineVisible: false, lastValueVisible: false,
      priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
    })
    // The library's price line spans the whole plot; the tag primitive draws it from the last bar only.
    const lines = candles.primitives.flatMap((p) => (p as { paneViews?: () => unknown[] }).paneViews?.() ?? [])
    expect(lines.length).toBe(3)
  })

  it('puts volume and its average in pane 1 and the indicator in pane 2, volume a quarter of the height', () => {
    const { fake } = setup()
    const byKind = fake.series.map((s) => [s.kind, s.pane ?? 0])
    expect(byKind).toEqual([['Candlestick', 0], ['Histogram', 1], ['Line', 1], ['Line', 2]])
    expect(fake.series[1]!.options).toMatchObject({ color: C.chartVol, priceFormat: { type: 'volume' }, lastValueVisible: false })
    expect(fake.series[2]!.options).toMatchObject({ color: C.chartS1, lineWidth: 1 })
    expect(fake.factors).toEqual([0.55, 0.25, 0.2])
  })

  it('has two panes when there is no indicator', () => {
    const { fake } = setup({ indicator: undefined })
    expect(fake.series.map((s) => s.kind)).toEqual(['Candlestick', 'Histogram', 'Line'])
    expect(fake.factors).toEqual([0.75, 0.25])
  })

  it('turns the dashed grid on only when asked', () => {
    const grid = (on: boolean) => (setup({ grid: on }).fake.chart.options as { grid: { horzLines: { visible: boolean } } }).grid.horzLines.visible
    expect(grid(false)).toBe(false)
    expect(grid(true)).toBe(true)
  })
})

describe('data, markers and overlays', () => {
  it('sends candles, leaving a bar with a missing price as whitespace', () => {
    const b = bars(3)
    const gap: CandleBars = { ...b, c: [b.c[0]!, null, b.c[2]!] }
    const { fake } = setup({ bars: gap, indicator: undefined, fills: [], rolls: [] }, 3)
    expect(fake.series[0]!.data[1]).toEqual({ time: b.t[1] })
    expect(fake.series[0]!.data[0]).toEqual({ time: b.t[0], open: b.o[0], high: b.h[0], low: b.l[0], close: b.c[0] })
    expect(fake.series[1]!.data[2]).toEqual({ time: b.t[2], value: b.v[2] })
  })

  it('marks fills on the candles', () => {
    const { fake } = setup()
    expect(fake.markers).toHaveLength(1)
    expect(fake.markers[0]!.series.kind).toBe('Candlestick')
    expect(fake.markers[0]!.list).toEqual([{ time: T0 + 2 * DAY, position: 'belowBar', shape: 'arrowUp', color: C.cUp, text: 'B' }])
  })

  it('attaches the fence, the roll lines and a value tag to every pane', () => {
    const { fake } = setup()
    expect(fake.series.map((s) => s.primitives.length)).toEqual([3, 3, 0, 3])
  })

  it('adds dashed day separators to every pane on intraday bars only (look spec 7.6 GIP)', () => {
    const hour = 3600
    const t = Array.from({ length: 12 }, (_, i) => T0 + Math.floor(i / 4) * DAY + (i % 4) * hour)
    const intraday = { ...bars(12), t }
    const { fake } = setup({ bars: intraday, step: hour, intraday: true, indicator: undefined, fills: [], rolls: [] }, 12)
    expect(fake.series.map((s) => s.primitives.length)).toEqual([4, 4, 0])
  })
})

describe('keyboard crosshair and zoom', () => {
  it('starts at the last visible bar, then steps one bar, moving the crosshair and publishing it', () => {
    const { fake, bus, cursors, engine } = setup()
    const heard: CrosshairMove[] = []
    bus.subscribe('A', 'other', (m) => heard.push(m))
    engine.step(-1)
    expect(engine.cursor()).toBe(29)
    engine.step(-1)
    expect(engine.cursor()).toBe(28)
    const candles = fake.series[0]
    expect(fake.chart.crosshair.at(-1)).toEqual(['set', 128, T0 + 28 * DAY, candles])
    expect(heard.at(-1)).toEqual({ sourceId: 'test-chart', library: 'lwc', time: T0 + 28 * DAY })
    expect(cursors.at(-1)).toEqual({ index: 28, source: 'keyboard' })
  })

  it('jumps to the data ends and scrolls the bar into view', () => {
    const { fake, engine } = setup()
    fake.chart.timeScale().setVisibleLogicalRange({ from: 15, to: 25 })
    engine.home()
    expect(engine.cursor()).toBe(0)
    expect(fake.range()).toEqual({ from: -0.5, to: 9.5 })
    engine.end()
    expect(engine.cursor()).toBe(29)
    expect(fake.range()).toEqual({ from: 19.5, to: 29.5 })
  })

  it('zooms in and out about the right edge, or about the keyboard crosshair', () => {
    const { fake, engine } = setup({}, 200)
    fake.chart.timeScale().setVisibleLogicalRange({ from: 100, to: 200 })
    engine.zoom(0.5)
    expect(fake.range()).toEqual({ from: 150, to: 200 })
    engine.zoom(2)
    expect(fake.range()).toEqual({ from: 100, to: 200 })
    engine.moveTo(120)
    engine.zoom(0.5)
    expect(fake.range()).toEqual({ from: 110, to: 160 })
  })

  it('reports the view: bars shown and the time strip', () => {
    const { fake, views } = setup({}, 200)
    fake.chart.timeScale().setVisibleLogicalRange({ from: 100.2, to: 150.7 })
    const v = views.at(-1)!
    expect(v.shown).toBe(50)
    expect(v.count).toBe(200)
    expect(v.width).toBe(800)
    expect(v.paneTops).toEqual([0, 301, 402])
    expect(v.strip.segments.length).toBeGreaterThan(0)
  })

  it('puts a date tag for each roll in view in the time strip', () => {
    const { views } = setup()
    const tags = views.at(-1)!.strip.rolls ?? []
    expect(tags.map((t) => t.label)).toEqual(['2021-12-06'])
    expect(tags[0]!.width).toBeGreaterThan(0)
  })

  it('fits again on a resize until the pointer or a key first touches the chart', () => {
    const { fake, host, engine } = setup()
    const opening = fake.range()
    fake.chart.timeScale().setVisibleLogicalRange({ from: 10, to: 20 })
    fake.resize()
    expect(fake.range()).toEqual(opening)
    host.dispatchEvent(new Event('pointerenter'))
    fake.chart.timeScale().setVisibleLogicalRange({ from: 10, to: 20 })
    fake.resize()
    expect(fake.range()).toEqual({ from: 10, to: 20 })
    const second = setup()
    second.engine.step(-1)
    second.fake.chart.timeScale().setVisibleLogicalRange({ from: 3, to: 9 })
    second.fake.resize()
    expect(second.fake.range()).toEqual({ from: 3, to: 9 })
    expect(engine).toBeDefined()
  })

  it('opens with room left of the first bar for its time label', () => {
    const { fake } = setup()
    const r = fake.range()!
    expect(r.from).toBeLessThan(-0.5)
    expect((0 - r.from) * (800 / (r.to - r.from))).toBeGreaterThanOrEqual(24 - 1e-9)
  })
})

describe('link group crosshair', () => {
  it('follows another chart, snapping its time to the bar that holds it', () => {
    const { fake, bus, cursors } = setup()
    bus.publish('A', { sourceId: 'gp-5m', library: 'lwc', time: T0 + 4 * DAY + 5 * 3600 })
    expect(fake.chart.crosshair.at(-1)).toEqual(['set', 104, T0 + 4 * DAY, fake.series[0]])
    expect(cursors.at(-1)).toEqual({ index: 4, source: 'link' })
    bus.publish('A', { sourceId: 'gp-5m', library: 'lwc', time: null })
    expect(fake.chart.crosshair.at(-1)).toEqual(['clear'])
    expect(cursors.at(-1)).toEqual({ index: null, source: 'link' })
  })

  it('clears for a time outside its data', () => {
    const { fake, bus } = setup()
    bus.publish('A', { sourceId: 'eq', library: 'uplot', time: T0 - 10 * DAY })
    expect(fake.chart.crosshair.at(-1)).toEqual(['clear'])
  })

  it('reports and publishes pointer moves', () => {
    const { fake, bus, cursors, host } = setup()
    const heard: CrosshairMove[] = []
    bus.subscribe('A', 'other', (m) => heard.push(m))
    host.dispatchEvent(new Event('pointerenter'))
    for (const h of fake.moveHandlers) h({ time: T0 + 7 * DAY, point: { x: 75, y: 40 } })
    expect(cursors.at(-1)).toEqual({ index: 7, source: 'pointer', point: { x: 75, y: 40 } })
    expect(heard.at(-1)?.time).toBe(T0 + 7 * DAY)
    for (const h of fake.moveHandlers) h({})
    expect(cursors.at(-1)).toEqual({ index: null, source: 'pointer' })
  })

  it('ignores move events from the library while the pointer is elsewhere (a scroll fires one with no time)', () => {
    const { fake, bus, cursors, engine } = setup()
    const heard: CrosshairMove[] = []
    bus.subscribe('A', 'other', (m) => heard.push(m))
    engine.home()
    for (const h of fake.moveHandlers) h({})
    expect(heard.at(-1)?.time).toBe(T0)
    expect(cursors.at(-1)).toEqual({ index: 0, source: 'keyboard' })
  })

  it('publishes the pointer leaving the chart', () => {
    const { fake, bus, host } = setup()
    const heard: CrosshairMove[] = []
    bus.subscribe('A', 'other', (m) => heard.push(m))
    host.dispatchEvent(new Event('pointerenter'))
    for (const h of fake.moveHandlers) h({ time: T0 + 7 * DAY })
    host.dispatchEvent(new Event('pointerleave'))
    expect(heard.at(-1)?.time).toBeNull()
  })

  it('zooms from the range it last set, even before the library has applied it', () => {
    const { fake, engine } = setup({ schedule: () => undefined }, 200)
    fake.chart.timeScale().setVisibleLogicalRange({ from: 100, to: 200 })
    fake.freeze()
    engine.zoom(0.5)
    engine.zoom(0.5)
    expect(fake.range()).toEqual({ from: 175, to: 200 })
  })

  it('neither publishes nor follows when unlinked', () => {
    const { fake, bus, engine } = setup({ link: '-' })
    const heard = vi.fn()
    bus.subscribe('A', 'other', heard)
    engine.step(-1)
    bus.publish('A', { sourceId: 'eq', library: 'uplot', time: T0 })
    expect(heard.mock.calls.map(([m]) => (m as CrosshairMove).sourceId)).toEqual(['eq'])
    expect(fake.chart.crosshair).toEqual([['set', 129, T0 + 29 * DAY, fake.series[0]]])
  })

  it('lets go of everything on dispose', () => {
    const { fake, bus, engine } = setup()
    engine.dispose()
    expect(fake.chart.removed).toBe(true)
    expect(fake.moveHandlers.size).toBe(0)
    bus.publish('A', { sourceId: 'eq', library: 'uplot', time: T0 })
    expect(fake.chart.crosshair).toEqual([])
  })
})
