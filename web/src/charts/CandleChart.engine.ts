// CandleChart's imperative side (TASKS 5.2): builds the lightweight-charts v5 chart from the theme,
// adds the price, volume and indicator panes, fill markers, the fence, roll lines and value tags,
// joins the link group's crosshair (lwcCrosshairSync), and runs the keyboard crosshair and zoom.
// The React component (CandleChart.tsx) owns the DOM and the readout; this module owns the chart.
// The library arrives as an argument from loadLwc (lazy chunk); only its types are imported here.
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  Logical,
  LineData,
  SeriesType,
  Time,
  UTCTimestamp,
  WhitespaceData,
} from 'lightweight-charts'
import { CANDLE } from '../copy/candleChart'
import type { PanelLink } from '../state/linkGroups'
import type { LwcModule } from './lazy'
import { quietAttributionLogo } from './lwcAttribution'
import {
  containingIndex,
  daySeparators,
  fenceLogical,
  fillMarkers,
  formatCompactVolume,
  formatTime,
  movingAverage,
  paneFactors,
  scrollIntoView,
  stepIndex,
  tickLabel,
  timeSegments,
  withLeftRoom,
  withRollTags,
  zoomRange,
  type CandleBars,
  type CandleFill,
  type CandleIndicator,
  type CandleRoll,
  type LogicalRange,
  type TimeStrip,
} from './CandleChart.model'
import { daySeparatorPrimitive, fencePrimitive, lastValueTag, rollPrimitive, type RollMark, type TagValue } from './CandleChart.primitives'
import { crosshairBus, lwcCrosshairSync, type CrosshairBus, type LwcSyncChart } from './sync'
import { canvasFont, makeLwcTheme, withGrid, type ChartTokens, type LwcTheme } from './theme'

/** House choice: a 20-bar average of volume, the white line in the volume pane (look spec 6.1). */
export const VOLUME_MA_BARS = 20
/** lightweight-charts draws a 1px separator between panes (look spec 6.3 colours). */
const PANE_SEPARATOR_PX = 1
/** Room left of the first bar in the opening view: half a time label ("09:30") plus a margin. */
export const LEFT_LABEL_ROOM_PX = 24
/** Fallback label width per character where no canvas can measure (tests). */
const FALLBACK_CHAR_PX = 7

export interface CandleEngineInput {
  readonly bars: CandleBars
  readonly step: number
  readonly intraday: boolean
  readonly timeZone: string
  readonly fills: readonly CandleFill[]
  readonly rolls: readonly CandleRoll[]
  readonly indicator?: CandleIndicator
  readonly precision: number
  readonly minMove: number
  readonly grid: boolean
  readonly link: PanelLink
  /** Unique per mounted chart: the crosshair bus never sends a chart its own moves. */
  readonly chartId: string
  readonly tokens: ChartTokens
  readonly bus?: CrosshairBus
  /** Coalesces view updates (requestAnimationFrame in the browser). */
  readonly schedule?: (run: () => void) => void
}

export type CursorSource = 'pointer' | 'keyboard' | 'link'

export interface CursorEvent {
  readonly index: number | null
  readonly source: CursorSource
  readonly point?: { readonly x: number; readonly y: number }
}

export interface CandleView {
  readonly range: LogicalRange | null
  /** Bars inside the visible range, and all bars. */
  readonly shown: number
  readonly count: number
  readonly width: number
  /** Top of each pane in pixels from the chart's top, for the pane legends. */
  readonly paneTops: readonly number[]
  readonly strip: TimeStrip
}

export interface CandleEngineEvents {
  readonly onCursor: (event: CursorEvent) => void
  readonly onView: (view: CandleView) => void
}

export interface CandleEngine {
  moveTo(index: number): void
  step(delta: number): void
  home(): void
  end(): void
  /** Below 1 zooms in. */
  zoom(factor: number): void
  cursor(): number | null
  /** Recompute the view after the host was resized. */
  refresh(): void
  dispose(): void
}

type Candles = ISeriesApi<'Candlestick'>
type AnySeries = ISeriesApi<SeriesType>

const ts = (t: number) => t as UTCTimestamp
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function lastIndexWhere(values: readonly (number | null)[], ok: (i: number) => boolean): number {
  for (let i = values.length - 1; i >= 0; i -= 1) if (ok(i)) return i
  return -1
}

function candleData(b: CandleBars): (CandlestickData<Time> | WhitespaceData<Time>)[] {
  return b.t.map((t, i) => {
    const [open, high, low, close] = [b.o[i], b.h[i], b.l[i], b.c[i]]
    return finite(open) && finite(high) && finite(low) && finite(close) ? { time: ts(t), open, high, low, close } : { time: ts(t) }
  })
}

function lineData(t: readonly number[], v: readonly (number | null)[]): (LineData<Time> | HistogramData<Time> | WhitespaceData<Time>)[] {
  return t.map((x, i) => {
    const value = v[i]
    return finite(value) ? { time: ts(x), value } : { time: ts(x) }
  })
}

function createThemedChart(lib: LwcModule, host: HTMLElement, input: CandleEngineInput, theme: LwcTheme): IChartApi {
  const { intraday, timeZone } = input
  return lib.createChart(host, {
    ...theme.chart,
    autoSize: true,
    timeScale: {
      ...theme.chart.timeScale,
      timeVisible: intraday,
      secondsVisible: false,
      tickMarkFormatter: (time: Time, type: number) => tickLabel(Number(time), type, intraday, timeZone),
    },
    localization: { timeFormatter: (time: Time) => formatTime(Number(time), intraday, timeZone) },
  })
}

interface Panes {
  readonly candles: Candles
  readonly volume: AnySeries
  readonly indicator: AnySeries | null
}

function addPanes(lib: LwcModule, chart: IChartApi, input: CandleEngineInput, theme: LwcTheme): Panes {
  const { bars, precision, minMove, indicator } = input
  const candles = chart.addSeries(lib.CandlestickSeries, {
    ...theme.candle, lastValueVisible: false, priceFormat: { type: 'price', precision, minMove },
  })
  candles.setData(candleData(bars))
  const pane = theme.volumePane.index
  const volume = chart.addSeries(lib.HistogramSeries, { ...theme.volume, lastValueVisible: false }, pane)
  volume.setData(lineData(bars.t, bars.v))
  const ma = chart.addSeries(lib.LineSeries, { ...theme.volumeMa, crosshairMarkerVisible: false, priceFormat: { type: 'volume' } }, pane)
  ma.setData(lineData(bars.t, movingAverage(bars.v, VOLUME_MA_BARS)))
  let ind: AnySeries | null = null
  if (indicator) {
    const digits = indicator.digits ?? 1
    ind = chart.addSeries(lib.LineSeries, {
      ...theme.volumeMa, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits },
    }, pane + 1)
    ind.setData(lineData(bars.t, indicator.values))
  }
  const factors = paneFactors(ind !== null)
  chart.panes().forEach((p, i) => p.setStretchFactor(factors[i] ?? 1))
  return { candles, volume, indicator: ind }
}

function tagFor(values: readonly (number | null)[], fill: (i: number) => string, text: (v: number) => string): () => TagValue | null {
  const i = lastIndexWhere(values, (k) => finite(values[k]))
  const v = values[i]
  if (!finite(v)) return () => null
  const tag = { value: v, fill: fill(i), text: text(v), index: i }
  return () => tag
}

/** Each roll as the bar that holds it and its date. */
function rollMarks(input: CandleEngineInput): RollMark[] {
  const { bars, step } = input
  return input.rolls.flatMap((r) => {
    const index = containingIndex(bars.t, r.t, step)
    return index === null ? [] : [{ index, label: formatTime(bars.t[index]!, input.intraday, input.timeZone).slice(0, 10) }]
  })
}

/** Label widths in the chart font, for the time strip's roll tags. */
function textMeasure(font: string): (text: string) => number {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d') ?? null
  if (ctx === null) return (text) => text.length * FALLBACK_CHAR_PX
  ctx.font = font
  return (text) => ctx.measureText(text).width
}

function addOverlays(lib: LwcModule, panes: Panes, input: CandleEngineInput, theme: LwcTheme, marks: readonly RollMark[]): void {
  const { bars, step, tokens, precision, indicator } = input
  const c = tokens.color
  const font = canvasFont(tokens)
  const logical = fenceLogical(bars.t, step)
  const tags = new Map<AnySeries, () => TagValue | null>([
    [panes.candles, tagFor(bars.c, (i) => ((bars.c[i] ?? 0) >= (bars.o[i] ?? 0) ? c.candleUp : c.candleDn), (v) => v.toFixed(precision))],
    [panes.volume, tagFor(bars.v, () => c.chartVol, formatCompactVolume)],
  ])
  if (panes.indicator && indicator) {
    tags.set(panes.indicator, tagFor(indicator.values, () => c.chartS1, (v) => v.toFixed(indicator.digits ?? 1)))
  }
  const days = input.intraday ? daySeparators(bars.t, input.timeZone) : []
  for (const [series, value] of tags) {
    const price = series === panes.candles
    const prims: ISeriesPrimitive<Time>[] = [
      ...(days.length > 0 ? [daySeparatorPrimitive({ positions: days, style: theme.daySeparator })] : []),
      fencePrimitive({ logical, style: theme.fence, ...(price ? { label: { before: CANDLE.fenceBefore, after: CANDLE.fenceAfter, font } } : {}) }),
      rollPrimitive({ rolls: marks, style: theme.rollMarker }),
      lastValueTag({ value, font, tokens, ...(price ? { line: theme.candle.priceLineColor } : {}) }),
    ]
    prims.forEach((p) => series.attachPrimitive(p))
  }
  const markers = fillMarkers(bars, input.fills, step, { buy: c.cUp, sell: c.cDown })
  lib.createSeriesMarkers(panes.candles, markers.map((m) => ({ ...m, time: ts(m.time) })))
}

interface ViewInput {
  readonly marks: readonly RollMark[]
  readonly textWidth: (text: string) => number
}

function computeView(chart: IChartApi, input: CandleEngineInput, extra: ViewInput): CandleView {
  const scale = chart.timeScale()
  const range = scale.getVisibleLogicalRange()
  const n = input.bars.t.length
  const width = scale.width()
  const shown = range === null ? 0 : Math.max(0, Math.min(n - 1, Math.floor(range.to)) - Math.max(0, Math.ceil(range.from)) + 1)
  let top = 0
  const paneTops = chart.panes().map((p) => {
    const at = top
    top += p.getHeight() + PANE_SEPARATOR_PX
    return at
  })
  const indexToX = (i: number) => scale.logicalToCoordinate(i as Logical)
  const strip = range === null
    ? { segments: [], dividers: [] }
    : withRollTags(
      timeSegments({ t: input.bars.t, from: range.from, to: range.to, intraday: input.intraday, timeZone: input.timeZone, width, indexToX }),
      extra.marks,
      { indexToX, width, textWidth: extra.textWidth },
    )
  return { range: range === null ? null : { from: range.from, to: range.to }, shown, count: n, width, paneTops, strip }
}

const defaultSchedule = (run: () => void) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else run()
}

type MoveParam = { readonly time?: unknown; readonly point?: { readonly x: number; readonly y: number } }
type MoveHandler = (param: MoveParam) => void

interface PointerMoves {
  subscribe(handler: MoveHandler): void
  unsubscribe(handler: MoveHandler): void
  dispose(): void
}

/**
 * The chart's crosshair moves, passed on only while the pointer is over the chart. The library also
 * fires a move with no time when the view changes under a synthetic crosshair (a keyboard scroll),
 * which would otherwise read as the pointer leaving and clear the whole link group. The pointer
 * leaving is sent from the DOM event instead.
 */
function pointerMoves(chart: IChartApi, host: HTMLElement): PointerMoves {
  let inside = false
  const wrapped = new Map<MoveHandler, MoveHandler>()
  const enter = () => { inside = true }
  const leave = () => {
    inside = false
    for (const h of [...wrapped.keys()]) h({})
  }
  host.addEventListener('pointerenter', enter)
  host.addEventListener('pointerleave', leave)
  return {
    subscribe: (h) => {
      const w: MoveHandler = (param) => { if (inside) h(param) }
      wrapped.set(h, w)
      chart.subscribeCrosshairMove(w)
    },
    unsubscribe: (h) => {
      const w = wrapped.get(h)
      if (w) chart.unsubscribeCrosshairMove(w)
      wrapped.delete(h)
    },
    dispose: () => {
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
    },
  }
}

/** A chart link that snaps other charts' times to this chart's bars and reports what it applied. */
function syncAdapter(chart: IChartApi, moves: PointerMoves, input: CandleEngineInput, onCursor: (e: CursorEvent) => void): LwcSyncChart<Candles> {
  return {
    subscribeCrosshairMove: (h) => moves.subscribe(h),
    unsubscribeCrosshairMove: (h) => moves.unsubscribe(h),
    setCrosshairPosition: (price, time, series) => {
      const i = containingIndex(input.bars.t, time, input.step)
      if (i === null) {
        chart.clearCrosshairPosition()
        onCursor({ index: null, source: 'link' })
        return
      }
      chart.setCrosshairPosition(price, ts(input.bars.t[i]!), series)
      onCursor({ index: i, source: 'link' })
    },
    clearCrosshairPosition: () => {
      chart.clearCrosshairPosition()
      onCursor({ index: null, source: 'link' })
    },
  }
}

interface Controls {
  readonly chart: IChartApi
  readonly candles: Candles
  readonly input: CandleEngineInput
  readonly publish: (time: number) => void
  readonly onCursor: (e: CursorEvent) => void
  /** Runs after the library has drawn the next frame. */
  readonly frame: (run: () => void) => void
}

type KeyboardControls = Pick<CandleEngine, 'moveTo' | 'step' | 'home' | 'end' | 'zoom' | 'cursor'> & {
  /** The pointer moved to bar `i`: the keyboard carries on from there. */
  readonly follow: (i: number) => void
}

interface KeyView {
  /** The visible range, or the one just set if the library has not applied it yet. */
  readonly visible: () => LogicalRange | null
  readonly setRange: (r: LogicalRange) => void
  readonly showCrosshair: (i: number) => void
}

/**
 * The time scale as the keyboard sees it. The library applies a new visible range on its next
 * frame and until then reports the old one, so the range just set is remembered until that frame,
 * when the keyboard crosshair (`kb()`) is drawn again at its bar.
 */
function keyView({ chart, candles, input, frame }: Controls, kb: () => number | null): KeyView {
  const { bars } = input
  const scale = chart.timeScale()
  let target: LogicalRange | null = null
  const showCrosshair = (i: number) => {
    const close = bars.c[i]
    if (finite(close)) chart.setCrosshairPosition(close, ts(bars.t[i]!), candles)
    else chart.clearCrosshairPosition()
  }
  const setRange = (r: LogicalRange) => {
    target = r
    scale.setVisibleLogicalRange(r)
    frame(() => {
      target = null
      const i = kb()
      if (i !== null) showCrosshair(i)
    })
  }
  return { visible: () => target ?? scale.getVisibleLogicalRange(), setRange, showCrosshair }
}

/** The keyboard crosshair (Left, Right, Home, End) and zoom (+, -) over the chart's time scale. */
function keyboardControls(controls: Controls): KeyboardControls {
  const { input, publish, onCursor } = controls
  const n = input.bars.t.length
  let kb: number | null = null
  const view = keyView(controls, () => kb)
  const moveTo = (index: number) => {
    if (n === 0) return
    const i = Math.min(n - 1, Math.max(0, index))
    const range = view.visible()
    if (range !== null) {
      const next = scrollIntoView(range, i)
      if (next !== range) view.setRange(next)
    }
    kb = i
    view.showCrosshair(i)
    publish(input.bars.t[i]!)
    onCursor({ index: i, source: 'keyboard' })
  }
  return {
    moveTo,
    step: (delta) => {
      const i = stepIndex(kb, delta, n, view.visible())
      if (i !== null) moveTo(i)
    },
    home: () => moveTo(0),
    end: () => moveTo(n - 1),
    zoom: (factor) => {
      const range = view.visible()
      if (range === null || n === 0) return
      view.setRange(zoomRange(range, factor, kb, n))
    },
    cursor: () => kb,
    follow: (i) => { kb = i },
  }
}

function pointerHandler(input: CandleEngineInput, follow: (i: number) => void, onCursor: (e: CursorEvent) => void) {
  return (param: MoveParam) => {
    const i = typeof param.time === 'number' ? containingIndex(input.bars.t, param.time, input.step) : null
    if (i === null) {
      onCursor({ index: null, source: 'pointer' })
      return
    }
    follow(i)
    onCursor({ index: i, source: 'pointer', ...(param.point ? { point: { x: param.point.x, y: param.point.y } } : {}) })
  }
}

/** Reports the view at most once per frame, and never after stop(). */
function viewEmitter(schedule: (run: () => void) => void, report: () => void): { readonly emit: () => void; readonly stop: () => void } {
  let live = true
  let pending = false
  return {
    emit: () => {
      if (pending) return
      pending = true
      schedule(() => {
        pending = false
        if (live) report()
      })
    },
    stop: () => { live = false },
  }
}

interface OpeningFit {
  /** The host was resized: fit again unless the user has touched the chart. */
  readonly onSize: () => void
  /** The user pointed at or keyed into the chart: leave their view alone from now on. */
  readonly touched: () => void
  readonly dispose: () => void
}

/**
 * The opening view: every bar, the theme's right offset, and room left of bar 0 for its time label
 * (withLeftRoom). The library has no size until it has laid out, so the fit is made again on each
 * resize until the pointer enters the chart or a key moves it.
 */
function openingFit(chart: IChartApi, host: HTMLElement, n: number, theme: LwcTheme): OpeningFit {
  const scale = chart.timeScale()
  let pristine = true
  const fit = () => {
    const width = scale.width()
    if (!(width > 0)) {
      scale.fitContent()
      return
    }
    const all = { from: -0.5, to: n - 0.5 + theme.chart.timeScale.rightOffset }
    scale.setVisibleLogicalRange(withLeftRoom(all, width, LEFT_LABEL_ROOM_PX))
  }
  const touched = () => { pristine = false }
  host.addEventListener('pointerenter', touched)
  fit()
  return {
    onSize: () => { if (pristine) fit() },
    touched,
    dispose: () => host.removeEventListener('pointerenter', touched),
  }
}

/** The keyboard controls, each first marking the chart as touched (no more opening fits). */
function touching(keys: Omit<KeyboardControls, 'follow'>, fit: OpeningFit): Omit<KeyboardControls, 'follow'> {
  const wrap = <A extends unknown[]>(f: (...args: A) => void) => (...args: A) => {
    fit.touched()
    f(...args)
  }
  return { ...keys, moveTo: wrap(keys.moveTo), step: wrap(keys.step), home: wrap(keys.home), end: wrap(keys.end), zoom: wrap(keys.zoom) }
}

export function mountCandleChart(lib: LwcModule, host: HTMLElement, input: CandleEngineInput, events: CandleEngineEvents): CandleEngine {
  const theme = withGrid(makeLwcTheme(input.tokens), input.grid)
  const chart = createThemedChart(lib, host, input, theme)
  const stopLogo = quietAttributionLogo(host)
  const panes = addPanes(lib, chart, input, theme)
  const marks = rollMarks(input)
  addOverlays(lib, panes, input, theme, marks)
  const viewInput = { marks, textWidth: textMeasure(canvasFont(input.tokens)) }
  const schedule = input.schedule ?? defaultSchedule
  const moves = pointerMoves(chart, host)
  const views = viewEmitter(schedule, () => events.onView(computeView(chart, input, viewInput)))
  const emitView = views.emit
  const sync = lwcCrosshairSync({
    chart: syncAdapter(chart, moves, input, events.onCursor), series: panes.candles, link: input.link, sourceId: input.chartId,
    priceAt: (time) => {
      const i = containingIndex(input.bars.t, time, input.step)
      return i === null ? null : (input.bars.c[i] ?? null)
    },
    bus: input.bus ?? crosshairBus,
  })
  const keys = keyboardControls({ chart, candles: panes.candles, input, publish: sync.publish, onCursor: events.onCursor, frame: schedule })
  const onMove = pointerHandler(input, keys.follow, events.onCursor)
  moves.subscribe(onMove)
  const scale = chart.timeScale()
  const fit = openingFit(chart, host, input.bars.t.length, theme)
  const onSize = () => {
    fit.onSize()
    emitView()
  }
  scale.subscribeVisibleLogicalRangeChange(emitView)
  scale.subscribeSizeChange(onSize)
  emitView()
  const { follow: _follow, ...controls } = keys
  return {
    ...touching(controls, fit),
    refresh: emitView,
    dispose: () => {
      views.stop()
      stopLogo()
      fit.dispose()
      sync.dispose()
      moves.unsubscribe(onMove)
      moves.dispose()
      scale.unsubscribeVisibleLogicalRangeChange(emitView)
      scale.unsubscribeSizeChange(onSize)
      chart.remove()
    },
  }
}
