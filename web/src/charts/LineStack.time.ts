// Axis layout for LineStack (look spec 6 and 6.1), as plain numbers so it can be tested without a
// canvas. The time axis has two rows:
//   - daily data: month abbreviations centred in each month span, then years centred and split by
//     1px dividers; over a short range, days as `DD Mon` (look spec 6.1), then the years;
//   - intraday data: HH:MM at each tick, then the date centred on the day.
// The level (minutes, hours, days, months or years) is the finest whose labels stay MIN_LABEL_PX
// apart. All times are UTC epoch seconds (the API's `t`); daily bars sit at 00:00 UTC.
import { MONTHS } from '../copy/lineStack'
import { groupThousands } from './LineStack.model'

export type TimeLevel = 'minute' | 'hour' | 'day' | 'month' | 'year'

export interface AxisLabel {
  /** Where the label's centre goes, in seconds. */
  readonly at: number
  readonly text: string
  /** Seconds of room the label may use: a tick label its step, a span label its visible span. */
  readonly room: number
}

export interface TimeAxisLayout {
  readonly level: TimeLevel
  /** Major tick times (6px ticks; the 3px minor ticks go halfway between). */
  readonly majors: readonly number[]
  readonly row1: readonly AxisLabel[]
  readonly row2: readonly AxisLabel[]
  /** Row-2 boundaries inside the view (year starts, month starts or midnights). */
  readonly dividers: readonly number[]
}

/** Labels closer than this would touch at 13px. */
export const MIN_LABEL_PX = 44
/** A day label (`DD Mon`) needs more room than a month or a year label. */
export const DAY_LABEL_PX = 56
/** Value-axis labels at least this far apart. */
export const MIN_TICK_SPACE_PX = 28

const MINUTE = 60
const HOUR = 3_600
const DAY = 86_400

interface Step {
  readonly level: TimeLevel
  readonly n: number
  /** The shortest this step can be, in seconds (a two-month step is at least 59 days). */
  readonly minSeconds: number
}

const MONTH_MIN_DAYS: Readonly<Record<number, number>> = { 1: 28, 2: 59, 3: 89, 6: 181 }

const STEPS: readonly Step[] = [
  ...[1, 5, 10, 15, 30].map((n) => ({ level: 'minute' as const, n, minSeconds: n * MINUTE })),
  ...[1, 2, 3, 6, 12].map((n) => ({ level: 'hour' as const, n, minSeconds: n * HOUR })),
  ...[1, 2].map((n) => ({ level: 'day' as const, n, minSeconds: n * DAY })),
  ...[1, 2, 3, 6].map((n) => ({ level: 'month' as const, n, minSeconds: MONTH_MIN_DAYS[n]! * DAY })),
  ...[1, 2, 5, 10, 20, 50].map((n) => ({ level: 'year' as const, n, minSeconds: n * 365 * DAY })),
]

const pad2 = (n: number) => String(n).padStart(2, '0')
const monthStart = (y: number, m: number) => Date.UTC(y, m, 1) / 1000
const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

function hhmm(t: number): string {
  const d = new Date(t * 1000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** A label centred on the part of [from, to) inside [min, max]; null when none of it is. */
function spanLabel(from: number, to: number, min: number, max: number, text: string): AxisLabel | null {
  const a = Math.max(from, min)
  const b = Math.min(to, max)
  return b > a ? { at: (a + b) / 2, text, room: b - a } : null
}

/**
 * A label centred on the visible part of its span [from, spanEnd) that may use the visible part of its
 * whole step [from, stepEnd): a month label sits in its month but has the room up to the next tick.
 */
function stepLabel(from: number, spanEnd: number, stepEnd: number, min: number, max: number, text: string): AxisLabel | null {
  const span = spanLabel(from, spanEnd, min, max, text)
  if (span === null) return null
  return { ...span, room: Math.min(stepEnd, max) - Math.max(from, min) }
}

interface Rows {
  majors: number[]
  row1: AxisLabel[]
}

function clockTicks(min: number, max: number, stepSeconds: number): Rows {
  const rows: Rows = { majors: [], row1: [] }
  for (let t = Math.ceil(min / stepSeconds) * stepSeconds; t <= max; t += stepSeconds) {
    rows.majors.push(t)
    rows.row1.push({ at: t, text: hhmm(t), room: stepSeconds })
  }
  return rows
}

/** Calls fn(year, month) for every month from the one holding min to the one holding max. */
function eachMonth(min: number, max: number, fn: (y: number, m: number) => void): void {
  const a = new Date(min * 1000)
  const b = new Date(max * 1000)
  for (let y = a.getUTCFullYear(), m = a.getUTCMonth(); y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth()); m += 1) {
    if (m === 12) {
      m = 0
      y += 1
    }
    fn(y, m)
  }
}

function dayTicks(min: number, max: number, n: number): Rows {
  const rows: Rows = { majors: [], row1: [] }
  eachMonth(min, max, (y, m) => {
    const start = monthStart(y, m)
    const days = (monthStart(y, m + 1) - start) / DAY
    // Skip a last tick closer than one step to the next month's first.
    for (let d = 1; d + n - 1 <= days; d += n) {
      const t = start + (d - 1) * DAY
      if (t < min || t > max) continue
      rows.majors.push(t)
      const label = stepLabel(t, t + DAY, t + n * DAY, min, max, `${pad2(d)} ${MONTHS[m]}`)
      if (label) rows.row1.push(label)
    }
  })
  return rows
}

function monthTicks(min: number, max: number, n: number): Rows {
  const rows: Rows = { majors: [], row1: [] }
  eachMonth(min, max, (y, m) => {
    const t = monthStart(y, m)
    if (m % n !== 0 || t < min || t > max) return
    rows.majors.push(t)
    const label = stepLabel(t, monthStart(y, m + 1), monthStart(y, m + n), min, max, MONTHS[m]!)
    if (label) rows.row1.push(label)
  })
  return rows
}

function yearTicks(min: number, max: number, n: number): Rows {
  const rows: Rows = { majors: [], row1: [] }
  const last = new Date(max * 1000).getUTCFullYear()
  for (let y = new Date(min * 1000).getUTCFullYear(); y <= last; y += 1) {
    const t = monthStart(y, 0)
    if (y % n !== 0 || t < min || t > max) continue
    rows.majors.push(t)
    const label = stepLabel(t, monthStart(y + 1, 0), monthStart(y + n, 0), min, max, String(y))
    if (label) rows.row1.push(label)
  }
  return rows
}

interface Band {
  readonly start: number
  readonly end: number
  readonly text: string
}

function bands(min: number, max: number, level: TimeLevel): Band[] {
  const out: Band[] = []
  if (level === 'minute' || level === 'hour') {
    for (let d = Math.floor(min / DAY) * DAY; d <= max; d += DAY) out.push({ start: d, end: d + DAY, text: isoDay(d) })
  } else if (level === 'day' || level === 'month') {
    const last = new Date(max * 1000).getUTCFullYear()
    for (let y = new Date(min * 1000).getUTCFullYear(); y <= last; y += 1) out.push({ start: monthStart(y, 0), end: monthStart(y + 1, 0), text: String(y) })
  }
  return out
}

function chooseStep(min: number, max: number, widthPx: number, minLabelPx: number, daily: boolean): Step {
  const pxPerSecond = widthPx / (max - min)
  const need = (s: Step) => (s.level === 'day' ? Math.max(minLabelPx, DAY_LABEL_PX) : minLabelPx)
  const steps = daily ? STEPS.filter((s) => s.level !== 'minute' && s.level !== 'hour') : STEPS
  return steps.find((s) => s.minSeconds * pxPerSecond >= need(s)) ?? steps[steps.length - 1]!
}

/** True when every time sits at 00:00 UTC: one point per session, so the axis never shows clock times. */
export function isDailyAxis(t: readonly number[]): boolean {
  return t.length > 0 && t.every((s) => s % DAY === 0)
}

const EMPTY: TimeAxisLayout = { level: 'day', majors: [], row1: [], row2: [], dividers: [] }

/** `daily`: the data has one point per session (isDailyAxis), so the finest level is the day. */
export function timeAxisLayout(min: number, max: number, widthPx: number, minLabelPx: number = MIN_LABEL_PX, daily = false): TimeAxisLayout {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || widthPx <= 0) return EMPTY
  const step = chooseStep(min, max, widthPx, minLabelPx, daily)
  const ticks =
    step.level === 'minute' ? clockTicks(min, max, step.n * MINUTE)
    : step.level === 'hour' ? clockTicks(min, max, step.n * HOUR)
    : step.level === 'day' ? dayTicks(min, max, step.n)
    : step.level === 'month' ? monthTicks(min, max, step.n)
    : yearTicks(min, max, step.n)
  const band = bands(min, max, step.level)
  return {
    level: step.level,
    majors: ticks.majors,
    row1: ticks.row1,
    row2: band.map((b) => spanLabel(b.start, b.end, min, max, b.text)).filter((l): l is AxisLabel => l !== null),
    dividers: band.map((b) => b.start).filter((t) => t > min && t < max),
  }
}

// ---------------------------------------------------------------------------------------------
// Value axis

const NICE = [1, 2, 2.5, 5]

/** Decimals needed to print multiples of `step` exactly (0.25 needs 2, 5 needs 0). */
export function axisDecimals(step: number): number {
  const text = String(Number(Math.abs(step).toPrecision(12)))
  if (text.includes('e-')) return Number(text.split('e-')[1])
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

function snap(v: number, step: number): number {
  const out = Number(v.toFixed(axisDecimals(step)))
  return out === 0 ? 0 : out
}

/** The smallest 1, 2, 2.5 or 5 times a power of ten whose pixel length is at least minSpace. */
function niceStep(pxPerUnit: number, minSpace: number): number {
  const raw = minSpace / pxPerUnit
  const exp = Math.floor(Math.log10(raw))
  for (let e = exp; e <= exp + 1; e += 1) {
    for (const m of NICE) {
      const s = Number((m * 10 ** e).toPrecision(12))
      if (s >= raw * (1 - 1e-9)) return s
    }
  }
  return 10 ** (exp + 1)
}

export function linearTicks(min: number, max: number, heightPx: number, minSpace: number = MIN_TICK_SPACE_PX): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || heightPx <= 0) return []
  if (max === min) return [min]
  const step = niceStep(heightPx / (max - min), minSpace)
  const out: number[] = []
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k += 1) out.push(snap(k * step, step))
  return out
}

/** Log-scale ticks: 1, 2 and 5 per decade when they fit, else decades (every k-th); narrow ranges fall back to linear. */
export function logTicks(min: number, max: number, heightPx: number, minSpace: number = MIN_TICK_SPACE_PX): number[] {
  if (!(min > 0) || !(max > min) || max / min < 10) return linearTicks(min, max, heightPx, minSpace)
  const decadePx = heightPx / (Math.log10(max) - Math.log10(min))
  const mults = decadePx * Math.log10(2) >= minSpace ? [1, 2, 5] : [1]
  const every = mults.length === 1 ? Math.max(1, Math.ceil(minSpace / decadePx)) : 1
  const out: number[] = []
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e += 1) {
    if (e % every !== 0) continue
    for (const m of mults) {
      const v = Number((m * 10 ** e).toPrecision(12))
      if (v >= min && v <= max) out.push(v)
    }
  }
  return out
}

/**
 * A value-axis label: the decimals the step needs, thousands grouped as on the tags and legend
 * (look spec 3.4), ASCII minus, never "-0", then the unit.
 */
export function formatAxisValue(v: number, step: number, unit: string): string {
  const d = axisDecimals(step)
  const text = v.toFixed(d)
  if (Number(text) === 0) return `${(0).toFixed(d)}${unit}`
  const sign = text.startsWith('-') ? '-' : ''
  return `${sign}${groupThousands(sign ? text.slice(1) : text)}${unit}`
}
