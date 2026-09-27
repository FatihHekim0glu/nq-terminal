// A stand-in for the lightweight-charts module in unit tests (jsdom has no canvas): it records what
// CandleChart asks of the library. Used by CandleChart.engine.test.ts and CandleChart.test.tsx only;
// no application code imports it.
import type { CandleBars } from './CandleChart.model'
import type { LwcModule } from './lazy'

export const FAKE_DAY = 86_400
export const FAKE_T0 = Date.parse('2021-12-01T00:00:00Z') / 1000

/** n daily bars from 2021-12-01, close 100 + i. */
export function fakeBars(n: number): CandleBars {
  const t = Array.from({ length: n }, (_, i) => FAKE_T0 + i * FAKE_DAY)
  const c = t.map((_, i) => 100 + i)
  return { t, o: c.map((x) => x - 0.5), h: c.map((x) => x + 1), l: c.map((x) => x - 1), c, v: c.map((x) => x * 10) }
}

export interface FakeSeries {
  readonly kind: string
  readonly options: Record<string, unknown>
  readonly pane: number | undefined
  data: unknown[]
  readonly primitives: unknown[]
}

export type FakeMoveHandler = (p: { time?: unknown; point?: { x: number; y: number } }) => void

/** A stand-in for the lightweight-charts module: records what the engine asks of it. */
export function fakeLib() {
  const series: FakeSeries[] = []
  const markers: { series: FakeSeries; list: unknown[] }[] = []
  let range: { from: number; to: number } | null = null
  /** A range the library still reports because it applies a new one on the next frame. */
  let frozen: { from: number; to: number } | null = null
  const rangeHandlers = new Set<() => void>()
  const sizeHandlers = new Set<() => void>()
  const moveHandlers = new Set<(p: { time?: unknown; point?: { x: number; y: number } }) => void>()
  const factors: number[] = []
  const chart = {
    options: null as Record<string, unknown> | null,
    crosshair: [] as unknown[],
    removed: false,
    addSeries: (def: { kind: string }, options: Record<string, unknown>, pane?: number) => {
      const s: FakeSeries = {
        kind: def.kind, options, pane, data: [], primitives: [],
      }
      series.push(s)
      return Object.assign(s, {
        setData: (d: unknown[]) => { s.data = d },
        attachPrimitive: (p: unknown) => s.primitives.push(p),
      })
    },
    panes: () => [0, 1, 2].slice(0, 1 + Math.max(0, ...series.map((s) => s.pane ?? 0))).map((i) => ({
      setStretchFactor: (f: number) => { factors[i] = f },
      getHeight: () => [300, 100, 80][i] ?? 0,
    })),
    timeScale: () => ({
      fitContent: () => { range = { from: -0.5, to: series[0]!.data.length - 1 + 5 }; rangeHandlers.forEach((h) => h()) },
      getVisibleLogicalRange: () => frozen ?? range,
      setVisibleLogicalRange: (r: { from: number; to: number }) => { range = { ...r }; rangeHandlers.forEach((h) => h()) },
      // Like lightweight-charts 5.2.1: only a whole bar index has a coordinate (others give 0).
      logicalToCoordinate: (l: number) => (Number.isInteger(l) ? 5 + (l - (range?.from ?? 0)) * 10 : 0),
      width: () => 800,
      subscribeVisibleLogicalRangeChange: (h: () => void) => rangeHandlers.add(h),
      unsubscribeVisibleLogicalRangeChange: (h: () => void) => rangeHandlers.delete(h),
      subscribeSizeChange: (h: () => void) => sizeHandlers.add(h),
      unsubscribeSizeChange: (h: () => void) => sizeHandlers.delete(h),
    }),
    subscribeCrosshairMove: (h: (p: { time?: unknown }) => void) => moveHandlers.add(h),
    unsubscribeCrosshairMove: (h: (p: { time?: unknown }) => void) => moveHandlers.delete(h),
    setCrosshairPosition: (price: number, time: number, s: unknown) => chart.crosshair.push(['set', price, time, s]),
    clearCrosshairPosition: () => chart.crosshair.push(['clear']),
    remove: () => { chart.removed = true },
  }
  const lib = {
    createChart: (_host: HTMLElement, options: Record<string, unknown>) => {
      chart.options = options
      return chart
    },
    CandlestickSeries: { kind: 'Candlestick' },
    HistogramSeries: { kind: 'Histogram' },
    LineSeries: { kind: 'Line' },
    createSeriesMarkers: (s: FakeSeries, list: unknown[]) => { markers.push({ series: s, list }) },
  }
  return {
    lib: lib as unknown as LwcModule, chart, series, markers, factors, moveHandlers,
    range: () => range,
    /** The host changed size (the library reports it through its size-change subscribers). */
    resize: () => sizeHandlers.forEach((h) => h()),
    freeze: () => { frozen = range === null ? null : { ...range } },
  }
}
