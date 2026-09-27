// GP and GIP pure logic (TASKS 7.1; UI_SPEC section 7 "GP / GIP"; look spec 7.6; ANALYTICS MV1 to MV3).
// No React, no fetch: windows and the OOS fence, the /api/bars query, the quote header from served
// bars, session flags, fills from a linked run and roll markers. Every rule is unit-tested.
//
// The fence is checked here before any request: a window that leaves [2010-01-01, 2022-01-01) is
// refused in the terminal with the gate's own rule text (nq_lab.oos_gate.check_window), so no price
// request past 2021-12-31 ever leaves the page. A 403 from the server is still shown verbatim.
import type { BarsQuery } from '../../api/queries'
import type { Schemas } from '../../api/types'
import type { CandleBars, CandleFill, CandleIndicator, CandleRoll } from '../../charts/CandleChart.model'
import type { QuoteData } from '../../chrome/QuoteHeader'
import { GP_COPY } from '../../copy/gp'
import { fillCopy } from '../../copy/workspace'

export const IS_START_MS = Date.UTC(2010, 0, 1)
/** The fence: the exclusive end of the in-sample window. */
export const FENCE_MS = Date.UTC(2022, 0, 1)
export const ET_ZONE = 'America/New_York'

export const GP_TIMEFRAMES = ['1m', '5m', '1h', '1d'] as const
export const GIP_TIMEFRAMES = ['1m', '5m', '1h'] as const
export type GpTimeframe = (typeof GP_TIMEFRAMES)[number]
export type Variant = 'vendor' | 'repaired'
export const VARIANTS: readonly Variant[] = ['vendor', 'repaired']

export const RANGES = ['1D', '3D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'] as const
export type RangeCode = (typeof RANGES)[number]
export const DEFAULT_RANGE: Readonly<Record<GpTimeframe, RangeCode>> = { '1m': '1D', '5m': '3D', '1h': '1M', '1d': '1Y' }
/** The longest span one /api/bars request may cover, in years (services/bars.py MAX_SPAN). */
export const SPAN_CAP_YEARS: Readonly<Partial<Record<GpTimeframe, number>>> = { '1m': 1, '5m': 3, '1h': 3 }

/** Day buckets and sessions start at 22:00 UTC, the Globex open (services/bars.py). */
const SESSION_SHIFT_S = 2 * 3600
const DAY_MS = 86_400_000
const DAY_S = 86_400
const SPARK_POINTS = 60
const MAX_DECIMALS = 7
const MIN_DECIMALS = 2
const SYMBOL = /^[A-Z0-9]{1,5}$/
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A half-open UTC window [startMs, endMs). */
export interface DateWindow {
  readonly startMs: number
  readonly endMs: number
}

export type BarsLike = CandleBars

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const pad2 = (n: number) => String(n).padStart(2, '0')

// ---------------------------------------------------------------------------------------------
// Dates and windows

/** 00:00 UTC of a calendar date `YYYY-MM-DD`, or null. */
export function parseIsoDate(text: string): number | null {
  const m = ISO_DATE.exec(text.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null
}

export function isoDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function shiftUtc(ms: number, years: number, months: number, days: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth() + months, d.getUTCDate() + days)
}

function rangeStart(range: RangeCode, endMs: number): number {
  switch (range) {
    case '1D': return shiftUtc(endMs, 0, 0, -1)
    case '3D': return shiftUtc(endMs, 0, 0, -3)
    case '1M': return shiftUtc(endMs, 0, -1, 0)
    case '6M': return shiftUtc(endMs, 0, -6, 0)
    case 'YTD': return Date.UTC(new Date(endMs - 1).getUTCFullYear(), 0, 1)
    case '1Y': return shiftUtc(endMs, -1, 0, 0)
    case '5Y': return shiftUtc(endMs, -5, 0, 0)
    case 'Max': return IS_START_MS
  }
}

/** The window a range button asks for, counted back from `endMs` (the fence by default). */
export function rangeWindow(range: RangeCode, endMs: number = FENCE_MS): DateWindow {
  return { startMs: Math.max(IS_START_MS, rangeStart(range, endMs)), endMs }
}

/** False when the window is longer than one request may span for the timeframe (a 422 otherwise). */
export function rangeAllowed(tf: GpTimeframe, w: DateWindow): boolean {
  const years = SPAN_CAP_YEARS[tf]
  return years === undefined || w.startMs >= shiftUtc(w.endMs, -years, 0, 0)
}

export type CustomWindow =
  | { readonly ok: true; readonly window: DateWindow }
  | { readonly ok: false; readonly reason: 'bad-date'; readonly value: string }
  | { readonly ok: false; readonly reason: 'order' }

/** The window of the two amber date fields; the end date is inclusive, as the fields show it. */
export function customWindow(start: string, endInclusive: string): CustomWindow {
  const s = parseIsoDate(start)
  if (s === null) return { ok: false, reason: 'bad-date', value: start.trim() }
  const e = parseIsoDate(endInclusive)
  if (e === null) return { ok: false, reason: 'bad-date', value: endInclusive.trim() }
  if (s > e) return { ok: false, reason: 'order' }
  return { ok: true, window: { startMs: s, endMs: e + DAY_MS } }
}

/** One GIP session: [the day before at 22:00 UTC, the day at 22:00 UTC). Null for a bad date. */
export function gipWindow(date: string): DateWindow | null {
  const day = parseIsoDate(date)
  if (day === null) return null
  return { startMs: day - SESSION_SHIFT_S * 1000, endMs: day + DAY_MS - SESSION_SHIFT_S * 1000 }
}

// ---------------------------------------------------------------------------------------------
// The fence

/** A time as pandas prints a UTC Timestamp: `2022-03-14 00:00:00+00:00`. */
function pandasStamp(ms: number): string {
  const d = new Date(ms)
  return `${isoDate(ms)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+00:00`
}

/** The OOS gate's refusal text for a window (nq_lab.oos_gate.check_window, word for word). */
export function gateRuleText(w: DateWindow): string {
  return fillCopy(GP_COPY.gateRule, {
    start: pandasStamp(w.startMs),
    end: pandasStamp(w.endMs),
    isStart: pandasStamp(IS_START_MS),
    isEnd: pandasStamp(FENCE_MS),
  })
}

/** The gate's refusal text when the window leaves [2010-01-01, 2022-01-01), else null. */
export function fenceRefusal(w: DateWindow): string | null {
  return w.startMs < IS_START_MS || w.endMs > FENCE_MS ? gateRuleText(w) : null
}

// ---------------------------------------------------------------------------------------------
// Series and the request

/** The continuous symbol the API serves for an instrument root, or null for anything else. */
export function symbolFor(root: string): string | null {
  const upper = root.trim().toUpperCase()
  return SYMBOL.test(upper) ? `${upper}.V.0` : null
}

/** Intraday timeframes are bucketed from the 1m files; 1d has its own file. */
export function sourceTimeframe(tf: GpTimeframe): '1m' | '1d' {
  return tf === '1d' ? '1d' : '1m'
}

interface SeriesRef {
  readonly symbol: string
  readonly timeframe: string
  readonly variant: string
}

/** The variants the catalog lists for the symbol at the timeframe's source file, vendor first. */
export function availableVariants(series: readonly SeriesRef[], symbol: string, tf: GpTimeframe): Variant[] {
  const source = sourceTimeframe(tf)
  return VARIANTS.filter((v) => series.some((s) => s.symbol === symbol && s.timeframe === source && s.variant === v))
}

function stampParam(ms: number): string {
  return ms % DAY_MS === 0 ? isoDate(ms) : new Date(ms).toISOString().replace('.000Z', 'Z')
}

/** The /api/bars query; the end is left out when it is the fence. Throws on a window past the fence. */
export function barsQuery(symbol: string, tf: GpTimeframe, variant: Variant, w: DateWindow): BarsQuery {
  if (fenceRefusal(w) !== null) throw new Error('bars window leaves the fence; refuse it before building a query')
  const base = { symbol, timeframe: tf, variant, start: stampParam(w.startMs) }
  return w.endMs === FENCE_MS ? base : { ...base, end: stampParam(w.endMs) }
}

// ---------------------------------------------------------------------------------------------
// Quote header

function decimalsOf(x: number): number {
  for (let d = 0; d <= MAX_DECIMALS; d += 1) if (Number(x.toFixed(d)) === x) return d
  return MAX_DECIMALS
}

/** Decimals that show every served price exactly (at least two, at most seven). */
export function priceDecimals(bars: BarsLike): number {
  let most = MIN_DECIMALS
  for (const column of [bars.o, bars.h, bars.l, bars.c]) {
    for (const v of column) if (isNum(v)) most = Math.max(most, decimalsOf(v))
  }
  return Math.min(most, MAX_DECIMALS)
}

const sessionKey = (t: number) => Math.floor((t + SESSION_SHIFT_S) / DAY_S)

const ET_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** `YYYY-MM-DD HH:MM` in New York time. */
export function etStamp(t: number): string {
  const parts = Object.fromEntries(ET_PARTS.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

interface Session {
  readonly first: number
  readonly last: number
  readonly prevClose: number | null
}

/** The last bar's session (the whole bar for daily data) and the close before it. */
function lastSession(bars: BarsLike, intraday: boolean): Session {
  const last = bars.t.length - 1
  if (!intraday) return { first: last, last, prevClose: bars.c[last - 1] ?? null }
  const key = sessionKey(bars.t[last] ?? 0)
  let first = last
  while (first > 0 && sessionKey(bars.t[first - 1] ?? 0) === key) first -= 1
  return { first, last, prevClose: first > 0 ? bars.c[first - 1] ?? null : null }
}

function extreme(values: readonly (number | null)[], from: number, to: number, pick: (a: number, b: number) => number): number | null {
  let out: number | null = null
  for (let i = from; i <= to; i += 1) {
    const v = values[i]
    if (isNum(v)) out = out === null ? v : pick(out, v)
  }
  return out
}

function sum(values: readonly (number | null)[], from: number, to: number): number | null {
  let out: number | null = null
  for (let i = from; i <= to; i += 1) {
    const v = values[i]
    if (isNum(v)) out = (out ?? 0) + v
  }
  return out
}

export interface QuoteInput {
  readonly root: string
  readonly ticker: string
  readonly bars: BarsLike
  readonly intraday: boolean
  /** Per cent, from /api/market/universe; null where it does not apply. */
  readonly rv22: number | null
  /**
   * Per cent, the universe's 1D return (MV4: dB / (N - dB) on the raw close). A change of the
   * back-adjusted series is never divided by a back-adjusted price, so this is null when the API
   * has no return for the last bar, and the header shows `--`.
   */
  readonly dayReturnPct: number | null
}

function emptyQuote(root: string, ticker: string, rv22: number | null): QuoteData {
  return {
    ticker, root, last: null, change: null, changePct: null, lastTick: null, time: null, delayed: true,
    volume: null, open: null, high: null, low: null, rv22, spark: [],
  }
}

/** The quote header from served bars: last session O H L V, last close, points change against the close before. */
export function quoteFromBars({ root, ticker, bars, intraday, rv22, dayReturnPct }: QuoteInput): QuoteData {
  const n = bars.t.length
  if (n === 0) return emptyQuote(root, ticker, rv22)
  const s = lastSession(bars, intraday)
  const last = bars.c[s.last] ?? null
  const prev = s.prevClose
  const change = isNum(last) && isNum(prev) ? last - prev : null
  const before = bars.c[s.last - 1]
  const tick = isNum(last) && isNum(before) && last !== before ? (last > before ? 'up' : 'down') : null
  const t = bars.t[s.last] ?? 0
  return {
    ticker, root, last, change,
    changePct: dayReturnPct,
    lastTick: tick,
    time: intraday ? etStamp(t) : isoDate(t * 1000),
    delayed: true,
    volume: sum(bars.v, s.first, s.last),
    open: bars.o[s.first] ?? null,
    high: extreme(bars.h, s.first, s.last, Math.max),
    low: extreme(bars.l, s.first, s.last, Math.min),
    rv22,
    spark: bars.c.slice(intraday ? s.first : Math.max(0, n - SPARK_POINTS)).filter(isNum),
    decimals: priceDecimals(bars),
  }
}

type UniverseRowLike = Pick<Schemas['UniverseRow'], 'root' | 'last_date'>

function rowOn<R extends UniverseRowLike>(rows: readonly R[], root: string, lastDate: string | null): R | null {
  const row = rows.find((r) => r.root === root)
  return row && lastDate !== null && row.last_date === lastDate ? row : null
}

/** RV22 in per cent from the universe row, only when it is dated the chart's last session. */
export function rv22Percent(
  rows: readonly (UniverseRowLike & Pick<Schemas['UniverseRow'], 'realised_vol'>)[], root: string, lastDate: string | null,
): number | null {
  const vol = rowOn(rows, root, lastDate)?.realised_vol
  return isNum(vol) ? vol * 100 : null
}

/** The 1D return in per cent from the universe row (a fraction there), only for the chart's last session. */
export function dayReturnPercent(
  rows: readonly (UniverseRowLike & { readonly returns: Readonly<Record<string, number | null>> })[], root: string, lastDate: string | null,
): number | null {
  // A malformed row without `returns` shows `--`, never breaks the header.
  const r = rowOn(rows, root, lastDate)?.returns?.['1D']
  return isNum(r) ? r * 100 : null
}

/** The part of GET /api/market/rv the RV pane uses (RealisedVolSeries). */
export interface RvLine {
  readonly date: readonly string[]
  readonly rv: readonly (number | null)[]
  readonly window: number
}

const RV_DIGITS = 1

/**
 * GP's RV22 pane (look spec 7.6; ANALYTICS MV3): the API's rolling realised volatility at each daily bar's
 * session date (the bar opens at 22:00 UTC the evening before), in percent; a bar with no value on that
 * date is a gap. Null when no bar has a value, so no empty pane is drawn. Nothing is computed here.
 */
export function rvIndicator(bars: BarsLike, line: RvLine): CandleIndicator | null {
  const byDate = new Map<string, number>()
  line.date.forEach((d, i) => {
    const v = line.rv[i]
    if (isNum(v)) byDate.set(d, v * 100)
  })
  const values = bars.t.map((t) => byDate.get(isoDate((t + SESSION_SHIFT_S) * 1000)) ?? null)
  if (!values.some((v) => v !== null)) return null
  return { name: `RV${line.window}`, values, unit: '%', digits: RV_DIGITS }
}

// ---------------------------------------------------------------------------------------------
// Sessions, fills and rolls

export type DayFlag = 'gated' | 'repaired' | null

export interface SessionBadges {
  readonly assessed: boolean
  readonly source: string | null
  readonly gated: readonly string[]
  readonly repaired: readonly string[]
  /** GIP: the flag of the one date shown; null on GP. */
  readonly day: DayFlag
}

export function sessionBadges(flags: Schemas['SessionFlags'], date: string | null): SessionBadges {
  const day: DayFlag =
    date === null ? null : flags.gated.includes(date) ? 'gated' : flags.repaired.includes(date) ? 'repaired' : null
  return { assessed: flags.assessed, source: flags.source, gated: flags.gated, repaired: flags.repaired, day }
}

const CONTRACT_CODE = /^[FGHJKMNQUVXZ]\d{1,2}$/

/** True when a fill's instrument is the chart's root: the full or micro contract, continuous or dated. */
export function instrumentMatches(root: string, instrument: string | null): boolean {
  if (instrument === null) return true
  const base = (instrument.split('.')[0] ?? '').toUpperCase()
  return [root, `M${root}`].some((r) => base === r || (base.startsWith(r) && CONTRACT_CODE.test(base.slice(r.length))))
}

/** A run's fills as chart markers for the chart's root; rows without time, side, size or price are left out. */
export function fillsFor(root: string, rows: readonly Schemas['FillRow'][]): CandleFill[] {
  const out: CandleFill[] = []
  for (const r of rows) {
    const side = r.side?.toUpperCase()
    if ((side !== 'BUY' && side !== 'SELL') || !isNum(r.ts_epoch_s) || !isNum(r.qty) || !isNum(r.px)) continue
    if (!instrumentMatches(root, r.instrument)) continue
    out.push({ t: r.ts_epoch_s, side: side === 'BUY' ? 'buy' : 'sell', qty: r.qty, price: r.px })
  }
  return out
}

export function rollsFrom(rolls: readonly Schemas['RollMarker'][]): CandleRoll[] {
  return rolls.map((r) => ({ t: r.t, gapPts: r.gap_pts, gapPct: r.gap_pct }))
}
