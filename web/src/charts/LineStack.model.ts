// LineStack's data rules, free of React and uPlot: gaps, the visible window, range buttons, the
// keyboard crosshair and zoom, and the text the chart gives assistive technology (summary, readout,
// table view). Everything is one pass over the data at most, so a 250k-point series stays fast.
import { LINE_STACK } from '../copy/lineStack'
import { fillCopy } from '../copy/workspace'
import type { ChartTable } from './ChartA11y'
import { describeSeries } from './ChartA11ySummary'
import type { LineStackPane, RangeKey } from './LineStack.types'

const DAY = 86_400

export type Values = readonly (number | null)[]

/** NaN, Infinity and undefined become null: gaps that uPlot never draws a line across. */
export function cleanValues(v: ReadonlyArray<number | null | undefined>): (number | null)[] {
  const out = new Array<number | null>(v.length)
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i]
    out[i] = typeof x === 'number' && Number.isFinite(x) ? x : null
  }
  return out
}

export interface IndexedValue {
  readonly index: number
  readonly value: number
}

export interface SeriesStats {
  readonly last: IndexedValue
  readonly high: IndexedValue
  readonly low: IndexedValue
  readonly mean: number
}

/** Last, high, low and average over indexes i0..i1, skipping gaps; null when all are gaps. */
export function seriesStats(v: Values, i0: number, i1: number): SeriesStats | null {
  let count = 0
  let sum = 0
  let last = -1
  let hi = -1
  let lo = -1
  for (let i = Math.max(0, i0); i <= Math.min(v.length - 1, i1); i += 1) {
    const x = v[i]
    if (x === null || x === undefined) continue
    count += 1
    sum += x
    last = i
    if (hi === -1 || x > v[hi]!) hi = i
    if (lo === -1 || x < v[lo]!) lo = i
  }
  if (count === 0) return null
  const at = (index: number): IndexedValue => ({ index, value: v[index]! })
  return { last: at(last), high: at(hi), low: at(lo), mean: sum / count }
}

/** Fixed decimals, ASCII minus, never "-0", an optional explicit plus, then the unit; -- for a gap. */
export function formatValue(v: number | null | undefined, decimals: number, unit: string, signed = false): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return LINE_STACK.missing
  const text = v.toFixed(decimals)
  if (Number(text) === 0) return `${(0).toFixed(decimals)}${unit}`
  return `${signed && v > 0 ? '+' : ''}${text}${unit}`
}

/** True when any time is not at 00:00 UTC (intraday bars). */
export function isIntraday(t: readonly number[]): boolean {
  for (const x of t) if (x % DAY !== 0) return true
  return false
}

export function timeLabel(t: number, intraday: boolean): string {
  const iso = new Date(t * 1000).toISOString()
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

function monthsBack(last: number, months: number): number {
  const d = new Date(last * 1000)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1))
  const days = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), days), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000
}

/** The window a range button shows (look spec 6.4): it ends at the last point, never starts before the first. */
export function rangeWindow(key: RangeKey, first: number, last: number): [number, number] {
  const starts: Record<RangeKey, () => number> = {
    '1D': () => last - DAY,
    '3D': () => last - 3 * DAY,
    '1M': () => monthsBack(last, 1),
    '6M': () => monthsBack(last, 6),
    YTD: () => Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000,
    '1Y': () => monthsBack(last, 12),
    '5Y': () => monthsBack(last, 60),
    Max: () => first,
  }
  return [Math.max(first, starts[key]()), last]
}

/** First and last index with min <= t <= max (t ascending), or null when none is. */
export function visibleIndexRange(t: readonly number[], min: number, max: number): [number, number] | null {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (t[mid]! < min) lo = mid + 1
    else hi = mid
  }
  const i0 = lo
  hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (t[mid]! <= max) lo = mid + 1
    else hi = mid
  }
  const i1 = lo - 1
  return i0 <= i1 ? [i0, i1] : null
}

const PAD = 0.05

/** The value range uPlot shows for data min..max: 5% padding, a log range kept above zero. */
export function yRange(min: number | null | undefined, max: number | null | undefined, log: boolean): [number, number] {
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) return log ? [1, 10] : [0, 1]
  if (log && min > 0) return [min / (1 + PAD), max * (1 + PAD)]
  if (max === min) {
    const pad = min === 0 ? 1 : Math.abs(min) * PAD
    return [min - pad, max + pad]
  }
  const pad = (max - min) * PAD
  return [min - pad, max + pad]
}

export interface CrosshairStep {
  readonly idx: number
  readonly view: readonly [number, number]
}

function panTo(view: readonly [number, number], time: number): readonly [number, number] {
  const width = view[1] - view[0]
  if (time < view[0]) return [time, time + width]
  if (time > view[1]) return [time - width, time]
  return view
}

/**
 * The keyboard crosshair (UI_SPEC section 5): Left and Right step one bar, Home and End jump to the
 * data ends, and the view pans to keep the bar in sight. Null means the key is not handled (Left at
 * the first bar and Right at the last are left to the panel, so focus can move on).
 */
export function stepCrosshair(key: string, idx: number | null, t: readonly number[], view: readonly [number, number]): CrosshairStep | null {
  const n = t.length
  if (n === 0) return null
  const visible = visibleIndexRange(t, view[0], view[1])
  let next: number
  if (key === 'ArrowRight') next = idx === null ? (visible?.[0] ?? 0) : idx + 1
  else if (key === 'ArrowLeft') next = idx === null ? (visible?.[1] ?? n - 1) : idx - 1
  else if (key === 'Home') next = 0
  else if (key === 'End') next = n - 1
  else return null
  if (next < 0 || next > n - 1) return null
  return { idx: next, view: panTo(view, t[next]!) }
}

/** Zoom by `factor` (0.5 halves the width) about `centre`, kept inside `bounds` and at least `minWidth` wide. */
export function zoomView(view: readonly [number, number], factor: number, centre: number, bounds: readonly [number, number], minWidth: number): [number, number] {
  const [b0, b1] = bounds
  const current = view[1] - view[0]
  const width = Math.max(minWidth, current * factor)
  if (width >= b1 - b0 || current <= 0) return [b0, b1]
  const c = Math.min(view[1], Math.max(view[0], centre))
  let lo = c - (c - view[0]) * (width / current)
  let hi = lo + width
  if (lo < b0) [lo, hi] = [b0, b0 + width]
  if (hi > b1) [lo, hi] = [b1 - width, b1]
  return [lo, hi]
}

// ---------------------------------------------------------------------------------------------
// Text for assistive technology

export type TableBucket = 'all' | 'day' | 'month' | 'year'

/** Civil year and month (0-11) of a UTC day number, without allocating a Date. */
function civil(days: number): [number, number] {
  const z = days + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const m = mp < 10 ? mp + 2 : mp - 10
  return [yoe + era * 400 + (m <= 1 ? 1 : 0), m]
}

function bucketKey(t: number, bucket: Exclude<TableBucket, 'all'>): number {
  const day = Math.floor(t / DAY)
  if (bucket === 'day') return day
  const [y, m] = civil(day)
  return bucket === 'month' ? y * 12 + m : y
}

function countKeys(t: readonly number[], bucket: Exclude<TableBucket, 'all'>): number {
  let count = 0
  let prev = Number.NaN
  for (const x of t) {
    const k = bucketKey(x, bucket)
    if (k !== prev) count += 1
    prev = k
  }
  return count
}

/** Every point when there are at most maxRows, else the finest of day, month and year ends that fits. */
export function tableBucket(t: readonly number[], maxRows: number): TableBucket {
  if (t.length <= maxRows) return 'all'
  for (const b of ['day', 'month', 'year'] as const) if (countKeys(t, b) <= maxRows) return b
  return 'year'
}

/** The last index of each period (every index for 'all'). */
export function periodEndIndexes(t: readonly number[], bucket: TableBucket): number[] {
  if (bucket === 'all') return t.map((_, i) => i)
  const out: number[] = []
  for (let i = 0; i < t.length; i += 1) {
    if (i === t.length - 1 || bucketKey(t[i]!, bucket) !== bucketKey(t[i + 1]!, bucket)) out.push(i)
  }
  return out
}

const BUCKET_LABEL: Record<TableBucket, string> = {
  all: LINE_STACK.bucketAll,
  day: LINE_STACK.bucketDay,
  month: LINE_STACK.bucketMonth,
  year: LINE_STACK.bucketYear,
}

export function paneFormat(pane: LineStackPane): (v: number | null | undefined) => string {
  const decimals = pane.decimals ?? 2
  const unit = pane.unit ?? ''
  return (v) => formatValue(v, decimals, unit, pane.signed === true)
}

export const DEFAULT_TABLE_ROWS = 400

export function stackTable(title: string, t: readonly number[], panes: readonly LineStackPane[], maxRows: number = DEFAULT_TABLE_ROWS): ChartTable {
  const bucket = tableBucket(t, maxRows)
  const intraday = isIntraday(t)
  const series = panes.flatMap((p) => p.series.map((s) => ({ s, format: paneFormat(p) })))
  const rows = periodEndIndexes(t, bucket).map((i) => {
    const row: Record<string, string> = { time: timeLabel(t[i]!, intraday) }
    series.forEach(({ s, format }, k) => {
      row[`s${k}`] = format(s.values[i])
    })
    return row
  })
  return {
    caption: fillCopy(LINE_STACK.tableCaption, { title, bucket: BUCKET_LABEL[bucket] }),
    columns: [
      { key: 'time', label: intraday ? LINE_STACK.colTime : LINE_STACK.colDate },
      ...series.map(({ s }, k) => ({ key: `s${k}`, label: s.name, numeric: true })),
    ],
    rows,
  }
}

/** The values at the crosshair, for the polite readout under the chart. */
export function readoutText(t: readonly number[], panes: readonly LineStackPane[], idx: number): string {
  const values = panes.flatMap((p) => {
    const format = paneFormat(p)
    return p.series.map((s) => fillCopy(LINE_STACK.readoutValue, { name: s.name, value: format(s.values[idx]) }))
  })
  return fillCopy(LINE_STACK.readout, { time: timeLabel(t[idx] ?? 0, isIntraday(t)), values: values.join(LINE_STACK.readoutJoin) })
}

/** Labels only at the first and last finite value: describeSeries reads no other index. */
function endLabels(t: readonly number[], v: Values, intraday: boolean): string[] {
  const labels: string[] = []
  let first = -1
  let last = -1
  for (let i = 0; i < v.length; i += 1) {
    if (v[i] === null) continue
    if (first === -1) first = i
    last = i
  }
  if (first !== -1) {
    labels[first] = timeLabel(t[first]!, intraday)
    labels[last] = timeLabel(t[last]!, intraday)
  }
  return labels
}

/** The accessible name: the first series of every pane, with the equity line's maximum drawdown. */
export function stackSummary(t: readonly number[], panes: readonly LineStackPane[]): string {
  const intraday = isIntraday(t)
  return panes
    .filter((p) => p.series.length > 0)
    .map((p) => {
      const s = p.series[0]!
      const v = cleanValues(s.values)
      const format = paneFormat(p)
      return describeSeries({
        name: s.name,
        t: endLabels(t, v, intraday),
        v,
        format: (x) => format(x),
        drawdown: s.style === 'primary' && (p.unit ?? '') !== '%',
      })
    })
    .join(LINE_STACK.summaryJoin)
}
