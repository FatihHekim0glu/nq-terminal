// CandleChart's pure logic (TASKS 5.2): bar lookup, the fence position, keyboard crosshair and zoom
// arithmetic, formatting, the volume average and RV22 indicator, fills and rolls on bars, the
// readout, the accessible summary and table, and the time strip under the axis. No library or DOM
// code here, so every rule is unit-tested without a canvas.
//
// Times are epoch seconds, bars stamped at their open (the API's `ts_convention`). Daily bars sit at
// 00:00 UTC and are always shown as UTC dates; intraday bars are shown in the chart's time zone.
import { CANDLE } from '../copy/candleChart'
import { fillCopy } from '../copy/workspace'
import type { ChartTable } from './ChartA11y'

export interface CandleBars {
  readonly t: readonly number[]
  readonly o: readonly (number | null)[]
  readonly h: readonly (number | null)[]
  readonly l: readonly (number | null)[]
  readonly c: readonly (number | null)[]
  readonly v: readonly (number | null)[]
}

export type FillSide = 'buy' | 'sell'

export interface CandleFill {
  readonly t: number
  readonly side: FillSide
  readonly qty: number
  readonly price: number
}

export interface CandleRoll {
  readonly t: number
  readonly gapPts: number | null
  /** Already in per cent, as the API sends it. */
  readonly gapPct: number | null
}

export interface CandleIndicator {
  readonly name: string
  /** One value per bar (null where it is not defined yet). */
  readonly values: readonly (number | null)[]
  readonly unit?: string
  readonly digits?: number
}

export type CandleEvent =
  | { readonly kind: 'fill'; readonly side: FillSide; readonly qty: number; readonly price: number }
  | { readonly kind: 'roll'; readonly gapPts: number | null; readonly gapPct: number | null }

export type BarEvents = ReadonlyMap<number, readonly CandleEvent[]>

export interface LogicalRange {
  readonly from: number
  readonly to: number
}

/** The in-sample boundary: served data stops before 2022-01-01 (UI_SPEC section 6). */
export const FENCE_EPOCH_S = Date.UTC(2022, 0, 1) / 1000
/** Bars of empty space right of the last bar (the theme's timeScale.rightOffset). */
export const RIGHT_OFFSET_BARS = 5
export const MIN_VISIBLE_BARS = 10
const DAY = 86_400
const HOUR = 3600
/** Daily ranges longer than this group the strip by year, shorter ones by month. */
const YEAR_STRIP_MIN_DAYS = 200

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const pad2 = (n: number) => String(n).padStart(2, '0')

/** The typical bar interval: the median positive step (a day for fewer than two bars). */
export function barStep(t: readonly number[]): number {
  const steps: number[] = []
  for (let i = 1; i < t.length; i += 1) {
    const s = t[i]! - t[i - 1]!
    if (s > 0) steps.push(s)
  }
  if (steps.length === 0) return DAY
  steps.sort((a, b) => a - b)
  return steps[Math.floor((steps.length - 1) / 2)]!
}

export function isIntraday(step: number): boolean {
  return step < DAY
}

export function stepLabel(step: number): string {
  if (step >= DAY) return CANDLE.stepDaily
  if (step >= HOUR && step % HOUR === 0) return fillCopy(CANDLE.stepHour, { n: step / HOUR })
  return fillCopy(CANDLE.stepMinute, { n: Math.max(1, Math.round(step / 60)) })
}

/** The bar whose span holds `time` (last bar opened at or before it), or null outside the data. */
export function containingIndex(t: readonly number[], time: number, step: number): number | null {
  const n = t.length
  if (n === 0 || time < t[0]! || time >= t[n - 1]! + step) return null
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (t[mid]! <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Where the fence falls in logical (bar index) units: between bars, or extrapolated past the end. */
export function fenceLogical(t: readonly number[], step: number, fence = FENCE_EPOCH_S): number | null {
  const n = t.length
  if (n === 0) return null
  const first = t.findIndex((x) => x >= fence)
  if (first !== -1) return first - 0.5
  return n - 1 + Math.max(0.5, (fence - t[n - 1]!) / step - 0.5)
}

/** Zoom the visible range by `factor` (below 1 zooms in) about `anchor`, else about the right edge. */
export function zoomRange(range: LogicalRange, factor: number, anchor: number | null, count: number): LogicalRange {
  const width = range.to - range.from
  const next = clamp(width * factor, MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, count + RIGHT_OFFSET_BARS))
  const a = anchor ?? range.to
  const from = a - (a - range.from) * (next / width)
  return { from, to: from + next }
}

/** The same-width range, shifted just enough that bar `index` is inside it. */
export function scrollIntoView(range: LogicalRange, index: number, margin = 0.5): LogicalRange {
  if (index - margin < range.from) return { from: index - margin, to: index - margin + (range.to - range.from) }
  if (index + margin > range.to) return { from: index + margin - (range.to - range.from), to: index + margin }
  return range
}

/** The keyboard crosshair after a step: the first press lands on the last visible bar. */
export function stepIndex(current: number | null, delta: number, count: number, range: LogicalRange | null): number | null {
  if (count === 0) return null
  if (current === null) return clamp(Math.floor(range?.to ?? count - 1), 0, count - 1)
  return clamp(current + delta, 0, count - 1)
}

// ---------------------------------------------------------------------------------------------
// Formatting

interface Parts {
  readonly y: number
  readonly m: number
  readonly d: number
  readonly hh: number
  readonly mm: number
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>()
const zoneCache = new Map<string, Parts>()
const ZONE_CACHE_MAX = 50_000

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let f = zoneFormats.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    zoneFormats.set(timeZone, f)
  }
  return f
}

function partsOf(t: number, timeZone: string): Parts {
  if (timeZone === 'UTC') {
    const x = new Date(t * 1000)
    return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), hh: x.getUTCHours(), mm: x.getUTCMinutes() }
  }
  const key = `${timeZone}|${t}`
  const hit = zoneCache.get(key)
  if (hit) return hit
  const found: Record<string, number> = {}
  for (const p of zoneFormat(timeZone).formatToParts(new Date(t * 1000))) found[p.type] = Number(p.value)
  const parts = { y: found.year ?? 0, m: (found.month ?? 1) - 1, d: found.day ?? 1, hh: found.hour ?? 0, mm: found.minute ?? 0 }
  if (zoneCache.size >= ZONE_CACHE_MAX) zoneCache.clear()
  zoneCache.set(key, parts)
  return parts
}

const isoDate = (p: Parts) => `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`
const hhmm = (p: Parts) => `${pad2(p.hh)}:${pad2(p.mm)}`

/**
 * Intraday day separators (look spec 7.6 GIP): the bar-index position halfway between the last bar of
 * each local day in `timeZone` and the first bar of the next.
 */
export function daySeparators(t: readonly number[], timeZone: string): number[] {
  const out: number[] = []
  let previous = t.length > 0 ? isoDate(partsOf(t[0]!, timeZone)) : ''
  for (let i = 1; i < t.length; i += 1) {
    const day = isoDate(partsOf(t[i]!, timeZone))
    if (day !== previous) out.push(i - 0.5)
    previous = day
  }
  return out
}

/** Daily: `YYYY-MM-DD` (UTC). Intraday: `YYYY-MM-DD HH:MM` in `timeZone`. */
export function formatTime(t: number, intraday: boolean, timeZone: string): string {
  const p = partsOf(t, intraday ? timeZone : 'UTC')
  return intraday ? `${isoDate(p)} ${hhmm(p)}` : isoDate(p)
}

/** The time-axis tick label (TickMarkType: 0 year, 1 month, 2 day, 3 and 4 time). */
export function tickLabel(t: number, tickType: number, intraday: boolean, timeZone: string): string {
  const p = partsOf(t, intraday ? timeZone : 'UTC')
  if (tickType <= 1) return CANDLE.months[p.m] ?? ''
  if (tickType === 2) return String(p.d)
  return hhmm(p)
}

export function formatPrice(v: number | null | undefined, precision: number): string {
  return isNum(v) ? v.toFixed(precision) : ''
}

/** Whole contracts with thousands separators: 312,004. */
export function formatVolume(v: number | null | undefined): string {
  return isNum(v) ? String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''
}

/** The volume axis style: 312.0k, 1.3M. */
export function formatCompactVolume(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
}

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(digits)}`

function formatIndicator(ind: CandleIndicator, i: number): string {
  const v = ind.values[i]
  return isNum(v) ? `${v.toFixed(ind.digits ?? 1)}${ind.unit ?? ''}` : ''
}

// ---------------------------------------------------------------------------------------------
// Indicators

/** Simple moving average; null until a full window, and for any window with a gap. */
export function movingAverage(values: readonly (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null
    let sum = 0
    for (let k = i - window + 1; k <= i; k += 1) {
      const v = values[k]
      if (!isNum(v)) return null
      sum += v
    }
    return sum / window
  })
}

/** Annualised realised volatility (per cent) of the last `window` log returns, sample variance. */
export function realisedVol(closes: readonly (number | null)[], window = 22, periodsPerYear = 252): (number | null)[] {
  const r: (number | null)[] = closes.map((c, i) => {
    const p = i > 0 ? closes[i - 1] : null
    return isNum(c) && isNum(p) && c > 0 && p > 0 ? Math.log(c / p) : null
  })
  return r.map((_, i) => {
    if (i < window) return null
    const win = r.slice(i - window + 1, i + 1)
    if (!win.every(isNum)) return null
    const xs = win as number[]
    const mean = xs.reduce((a, b) => a + b, 0) / window
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1)
    return Math.sqrt(variance * periodsPerYear) * 100
  })
}

// ---------------------------------------------------------------------------------------------
// Legend, events and readout

export interface LegendStats {
  readonly high: number
  readonly highIndex: number
  readonly low: number
  readonly lowIndex: number
  readonly average: number
}

/** High, low (with their bars) and the average close over the loaded bars. */
export function legendStats(bars: CandleBars): LegendStats | null {
  let high = -Infinity
  let highIndex = -1
  let low = Infinity
  let lowIndex = -1
  let sum = 0
  let n = 0
  for (let i = 0; i < bars.t.length; i += 1) {
    const h = bars.h[i]
    const l = bars.l[i]
    const c = bars.c[i]
    if (isNum(h) && h > high) [high, highIndex] = [h, i]
    if (isNum(l) && l < low) [low, lowIndex] = [l, i]
    if (isNum(c)) [sum, n] = [sum + c, n + 1]
  }
  if (n === 0 || highIndex === -1 || lowIndex === -1) return null
  return { high, highIndex, low, lowIndex, average: sum / n }
}

/** Fills and rolls by bar index; ones outside the loaded bars are left out. Rolls come first. */
export function barEvents(bars: CandleBars, fills: readonly CandleFill[], rolls: readonly CandleRoll[], step: number): BarEvents {
  const out = new Map<number, CandleEvent[]>()
  const add = (t: number, ev: CandleEvent) => {
    const i = containingIndex(bars.t, t, step)
    if (i !== null) out.set(i, [...(out.get(i) ?? []), ev])
  }
  for (const r of rolls) add(r.t, { kind: 'roll', gapPts: r.gapPts, gapPct: r.gapPct })
  for (const f of fills) add(f.t, { kind: 'fill', side: f.side, qty: f.qty, price: f.price })
  return out
}

export function eventText(ev: CandleEvent, precision: number): string {
  if (ev.kind === 'fill') {
    const side = ev.side === 'buy' ? CANDLE.buy : CANDLE.sell
    return fillCopy(CANDLE.fillEvent, { side, qty: ev.qty, price: ev.price.toFixed(precision) })
  }
  if (!isNum(ev.gapPts)) return CANDLE.rollEventBare
  if (!isNum(ev.gapPct)) return fillCopy(CANDLE.rollEventPoints, { gap: signed(ev.gapPts, 2) })
  return fillCopy(CANDLE.rollEvent, { gap: signed(ev.gapPts, 2), pct: `${signed(ev.gapPct, 2)}%` })
}

export interface FillMarker {
  readonly time: number
  readonly position: 'aboveBar' | 'belowBar'
  readonly shape: 'arrowUp' | 'arrowDown'
  readonly color: string
  readonly text: string
}

/** Series markers for fills: buys an up arrow under the bar, sells a down arrow over it, by time. */
export function fillMarkers(bars: CandleBars, fills: readonly CandleFill[], step: number, colours: { readonly buy: string; readonly sell: string }): FillMarker[] {
  const out: FillMarker[] = []
  for (const f of fills) {
    const i = containingIndex(bars.t, f.t, step)
    if (i === null) continue
    const buy = f.side === 'buy'
    out.push({
      time: bars.t[i]!,
      position: buy ? 'belowBar' : 'aboveBar',
      shape: buy ? 'arrowUp' : 'arrowDown',
      color: buy ? colours.buy : colours.sell,
      text: buy ? CANDLE.markerBuy : CANDLE.markerSell,
    })
  }
  return out.sort((a, b) => a.time - b.time)
}

export interface ReadoutPart {
  readonly label: string
  readonly value: string
}

export interface ReadoutOptions {
  readonly precision: number
  readonly intraday: boolean
  readonly timeZone: string
  readonly indicator?: CandleIndicator
  readonly events?: BarEvents
}

/** T O H L C V for bar `i`, then the indicator and the bar's events. */
export function readoutParts(bars: CandleBars, i: number, opts: ReadoutOptions): ReadoutPart[] {
  const px = (v: number | null | undefined) => formatPrice(v, opts.precision)
  const t = bars.t[i]
  const parts: ReadoutPart[] = [
    { label: CANDLE.readoutTime, value: t === undefined ? '' : formatTime(t, opts.intraday, opts.timeZone) },
    { label: CANDLE.readoutOpen, value: px(bars.o[i]) },
    { label: CANDLE.readoutHigh, value: px(bars.h[i]) },
    { label: CANDLE.readoutLow, value: px(bars.l[i]) },
    { label: CANDLE.readoutClose, value: px(bars.c[i]) },
    { label: CANDLE.readoutVolume, value: formatVolume(bars.v[i]) },
  ]
  if (opts.indicator) parts.push({ label: opts.indicator.name, value: formatIndicator(opts.indicator, i) })
  for (const ev of opts.events?.get(i) ?? []) parts.push({ label: '', value: eventText(ev, opts.precision) })
  return parts
}

// ---------------------------------------------------------------------------------------------
// Accessible summary and table view

export interface SummaryInput {
  readonly name: string
  readonly bars: CandleBars
  readonly step: number
  readonly precision: number
  readonly timeZone: string
  readonly fills: number
  readonly rolls: number
}

const plural = (n: number, one: string, many: string) => fillCopy(n === 1 ? one : many, { n })

function lastFinite(v: readonly (number | null)[]): number | null {
  for (let i = v.length - 1; i >= 0; i -= 1) if (isNum(v[i])) return v[i]!
  return null
}

/** The chart's accessible name: range, last close, low and high, marked events and the fence. */
export function candleSummary(input: SummaryInput): string {
  const { bars, step, precision } = input
  const stats = legendStats(bars)
  const last = lastFinite(bars.c)
  const n = bars.t.length
  if (stats === null || last === null || n === 0) return fillCopy(CANDLE.empty, { name: input.name })
  const intraday = isIntraday(step)
  const when = (i: number) => formatTime(bars.t[i]!, intraday, input.timeZone)
  let text = fillCopy(CANDLE.summary, {
    name: input.name, count: n, step: stepLabel(step), start: when(0), end: when(n - 1), last: last.toFixed(precision),
    low: stats.low.toFixed(precision), lowAt: when(stats.lowIndex), high: stats.high.toFixed(precision), highAt: when(stats.highIndex),
  })
  if (input.fills + input.rolls > 0) {
    text += fillCopy(CANDLE.summaryEvents, {
      fills: plural(input.fills, CANDLE.fillOne, CANDLE.fillMany), rolls: plural(input.rolls, CANDLE.rollOne, CANDLE.rollMany),
    })
  }
  const fence = fenceLogical(bars.t, step)
  if (fence !== null && fence >= n - 1 && fence <= n - 1 + RIGHT_OFFSET_BARS) text += CANDLE.summaryFence
  return text
}

export interface TableInput {
  readonly name: string
  readonly bars: CandleBars
  readonly precision: number
  readonly intraday: boolean
  readonly timeZone: string
  readonly events: BarEvents
  readonly indicator?: CandleIndicator
}

/** Every bar as a row: time, OHLC, volume, the indicator and the bar's events. */
export function candleTable(input: TableInput): ChartTable {
  const { bars, precision, indicator } = input
  const num = (key: string, label: string) => ({ key, label, numeric: true })
  const columns = [
    { key: 'time', label: CANDLE.colTime },
    num('open', CANDLE.colOpen), num('high', CANDLE.colHigh), num('low', CANDLE.colLow), num('close', CANDLE.colClose),
    num('volume', CANDLE.colVolume),
    ...(indicator ? [num('indicator', indicator.name)] : []),
    { key: 'events', label: CANDLE.colEvents },
  ]
  const rows = bars.t.map((t, i) => ({
    time: formatTime(t, input.intraday, input.timeZone),
    open: formatPrice(bars.o[i], precision),
    high: formatPrice(bars.h[i], precision),
    low: formatPrice(bars.l[i], precision),
    close: formatPrice(bars.c[i], precision),
    volume: formatVolume(bars.v[i]),
    ...(indicator ? { indicator: formatIndicator(indicator, i) } : {}),
    events: (input.events.get(i) ?? []).map((ev) => eventText(ev, precision)).join('; '),
  }))
  return { caption: fillCopy(CANDLE.tableCaption, { name: input.name }), columns, rows }
}

// ---------------------------------------------------------------------------------------------
// The second axis row (look spec 6.1): years or months for daily data, dates for intraday

export interface StripSegment {
  readonly key: string
  readonly label: string
  readonly left: number
  readonly width: number
}

export interface TimeStrip {
  readonly segments: readonly StripSegment[]
  /** x of each boundary between segments (1px dividers). */
  readonly dividers: readonly number[]
  /** Roll date tags (withRollTags): yellow, square, black text. */
  readonly rolls?: readonly StripTag[]
}

export interface StripTag {
  readonly key: string
  readonly label: string
  readonly left: number
  readonly width: number
}

export interface StripInput {
  readonly t: readonly number[]
  readonly from: number
  readonly to: number
  readonly intraday: boolean
  readonly timeZone: string
  /** Bar index (logical) to x in the plot, as the time scale gives it. */
  readonly indexToX: (i: number) => number | null
  readonly width: number
}

function stripKey(t: number, input: StripInput, byYear: boolean): readonly [string, string] {
  const p = partsOf(t, input.intraday ? input.timeZone : 'UTC')
  if (input.intraday) return [isoDate(p), isoDate(p)]
  if (byYear) return [String(p.y), String(p.y)]
  return [`${p.y}-${pad2(p.m + 1)}`, `${CANDLE.months[p.m] ?? ''} ${p.y}`]
}

export function timeSegments(input: StripInput): TimeStrip {
  const { t } = input
  const i0 = Math.max(0, Math.ceil(input.from))
  const i1 = Math.min(t.length - 1, Math.floor(input.to))
  const x0 = input.indexToX(i0)
  const x1 = input.indexToX(i0 + 1)
  if (i1 < i0 || x0 === null || x1 === null) return { segments: [], dividers: [] }
  const half = (x1 - x0) / 2
  const byYear = (t[i1]! - t[i0]!) / DAY > YEAR_STRIP_MIN_DAYS
  const segments: StripSegment[] = []
  let start = i0
  for (let i = i0; i <= i1; i += 1) {
    const [key, label] = stripKey(t[i]!, input, byYear)
    const nextKey = i < i1 ? stripKey(t[i + 1]!, input, byYear)[0] : null
    if (nextKey === key) continue
    const left = Math.max(0, (input.indexToX(start) ?? 0) - half)
    const right = Math.min(input.width, (input.indexToX(i) ?? 0) + half)
    if (right > left) segments.push({ key, label, left, width: right - left })
    start = i + 1
  }
  const dividers = segments.slice(1).map((s) => s.left).filter((x) => x > 0 && x < input.width)
  return { segments, dividers }
}

/** Space either side of a roll tag's text. */
const ROLL_TAG_PAD = 4
/** Clear space kept between a roll tag and a strip label. */
const ROLL_TAG_GAP = 2

export interface RollTagInput {
  readonly indexToX: (i: number) => number | null
  readonly width: number
  /** The rendered width of a label in the chart font. */
  readonly textWidth: (text: string) => number
}

/**
 * The roll date tags for the second axis row: one square tag centred on each roll bar in view, kept
 * inside the plot. A segment label the tag would cover is blanked, so the tag never sits on top of
 * another label (the library's own time-axis tags have rounded corners and covered month labels).
 */
export function withRollTags(strip: TimeStrip, rolls: readonly { readonly index: number; readonly label: string }[], input: RollTagInput): TimeStrip {
  const tags = rolls.flatMap((r) => {
    const x = input.indexToX(r.index)
    if (x === null || x < 0 || x > input.width) return []
    const width = input.textWidth(r.label) + 2 * ROLL_TAG_PAD
    const left = Math.max(0, Math.min(input.width - width, x - width / 2))
    return [{ key: String(r.index), label: r.label, left, width }]
  })
  const covered = (s: StripSegment) => {
    const w = input.textWidth(s.label)
    const lo = s.left + (s.width - w) / 2 - ROLL_TAG_GAP
    const hi = lo + w + 2 * ROLL_TAG_GAP
    return tags.some((tag) => tag.left < hi && lo < tag.left + tag.width)
  }
  const segments = strip.segments.map((s) => (covered(s) ? { ...s, label: '' } : s))
  return { ...strip, segments, rolls: tags }
}

export interface LogicalSpan {
  readonly from: number
  readonly to: number
}

/**
 * The fitted range widened on the left so bar 0 sits `room` pixels in from the plot's left edge:
 * the library centres a time label on its bar and does not pull the first one inside when the bars
 * are wide, so an hourly chart's first label was cut in half. Solves -from * W / (to - from) = room.
 */
export function withLeftRoom(range: LogicalSpan, widthPx: number, room: number): LogicalSpan {
  const span = range.to - range.from
  if (!(widthPx > room) || !(span > 0)) return range
  const inset = -range.from * (widthPx / span)
  if (inset >= room) return range
  const from = (range.to * room) / (room - widthPx)
  return { from, to: range.to }
}

/** Pane stretch factors: price, volume (a quarter, look spec 6.1) and the indicator if any. */
export function paneFactors(hasIndicator: boolean): number[] {
  return hasIndicator ? [0.55, 0.25, 0.2] : [0.75, 0.25]
}
