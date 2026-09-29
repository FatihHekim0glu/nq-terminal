// Market bodies of the demo dataset. There is no captured price: /api/bars serves synthetic daily vendor bars
// from the gallery's seeded generator (src/gallery/fixtures.ts), one series per universe root, labelled as such,
// with quarterly roll markers placed as the fixture backend's fake serve places them (backend/tests/fakes.py:
// the contract rolls on the 10th of March, June, September and December, so the first session after it carries
// the marker). Each series is walked back from the universe table's last close, so GP and MON agree on it.
// The universe is the MON tests' table (screens/mon/testUniverse.ts: the NQ, ES and ZT rows and the first
// matrix entries as the fixture backend returned them, the rest deterministic fillers); rv, two-day and
// pair-corr are seeded fillers in the same style, whose basis says so. The table is served for two windows: 252
// (MON's default) and 22 (GP's RV22 header, useGpData RV_WINDOW), the second with the same filler rows except
// realised_vol, which is the last value of the RV22 line of /api/market/rv, so GP's header and its RV22 pane
// read one number. Nothing goes through a gate here, so every gate record reads zero reads and no year served.
import type { Schemas } from '../../api/types'
import { fillCopy } from '../../copy/workspace'
import { mulberry32, ohlcvFixture } from '../../gallery/fixtures'
import { FENCE_MS, IS_START_MS, gateRuleText } from '../../screens/gp/model'
import { INSTRUMENT_NQ } from '../../screens/des/desTestData'
import { LABEL, ROOTS, TICKS, makeUniverse } from '../../screens/mon/testUniverse'
import { NOT_IN_DEMO, intParam, refuse, served, utcMs, type DemoBody, type DemoRefusal } from './answer'
import { DEMO_TEXT } from './text'

type Answer<T> = DemoBody<T> | DemoRefusal

const DAY_S = 86_400
const HOUR_S = 3_600
/** The API's defaults and fixed strings (services/bars.py, services/market.py, api/data.py). */
const DEFAULT_MAX_POINTS = 4000
const PAIR_DEFAULT_WINDOW = 63
const TS_CONVENTION = 'bar open, UTC'
const RV_UNIT = 'fraction per year, annualised (0.18 is 18%)'
const DAILY = '1d'
const VENDOR = 'vendor'
/** The window of the universe table MON reads (its default, the API's default). */
const UNIVERSE_WINDOW = 252
/** GP asks for RV22 (useGpData RV_WINDOW): the only rv window the demo serves, and the second window of the universe table. */
const RV_WINDOW = 22
/** The universe windows the demo holds a table for; any other is a 404 (the contract allows 20 to 2520). */
const UNIVERSE_WINDOWS: readonly number[] = [UNIVERSE_WINDOW, RV_WINDOW]
const SEED = 20_260_927
/** backend/tests/fakes.py: the contract rolls on the 10th of March, June, September and December (0-based months). */
const ROLL_MONTHS = [2, 5, 8, 11] as const
const ROLL_DAY = 10

/** The date the fixture captures the demo is built on; the catalog's stand-in for a file time (there is no file). */
const CAPTURED_UTC = '2026-09-27T00:00:00Z'
const DEMO_GATE: Schemas['GateInfo'] = { caller: 'demo', served_years: [], cached: false, reads_this_process: 0 }
const NO_SESSION_QA: Schemas['SessionFlags'] = { assessed: false, gated: [], repaired: [], source: null }

const isoDay = (s: number): string => new Date(s * 1000).toISOString().slice(0, 10)
const isoZ = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')

/** Decimals that write a tick exactly (0.25: 2, 0.00390625: 8, 5e-7: 7). */
function decimalsOf(tick: number): number {
  for (let d = 0; d <= 10; d += 1) if (Number(tick.toFixed(d)) === tick) return d
  return 10
}

// ---------------------------------------------------------------- the universe table

const universes = new Map<number, Schemas['Universe']>()

/**
 * The universe table of a window the demo serves (built once each). The RV22 table repeats the default table's
 * filler rows, and reads each row's realised volatility from the RV22 line, the number GP's pane ends on.
 */
function universeBody(window: number = UNIVERSE_WINDOW): Schemas['Universe'] {
  let body = universes.get(window)
  if (body === undefined) {
    const table = makeUniverse(window)
    // The fixture table carries the gate record of the day it was captured (27 reads); the demo reads no gate, so both windows say so.
    body = window === RV_WINDOW
      ? { ...table, gate: DEMO_GATE, rows: table.rows.map((row) => ({ ...row, realised_vol: rvSeries(row.symbol)?.last ?? row.realised_vol })) }
      : { ...table, gate: DEMO_GATE }
    universes.set(window, body)
  }
  return body
}

/** GET /api/market/universe: a table describes one window, so only the windows the demo holds a table for are answered. */
export function marketUniverse(query: URLSearchParams): Answer<Schemas['Universe']> {
  const window = intParam(query, 'window', UNIVERSE_WINDOW)
  return window !== null && UNIVERSE_WINDOWS.includes(window) ? served(universeBody(window)) : NOT_IN_DEMO
}

const SYMBOLS: readonly string[] = ROOTS.map(([root]) => `${root}.V.0`)

function universeRow(symbol: string): Schemas['UniverseRow'] | undefined {
  return universeBody().rows.find((r) => r.symbol === symbol)
}

// ---------------------------------------------------------------- daily prices

interface DailySeries {
  readonly t: readonly number[]
  readonly o: readonly number[]
  readonly h: readonly number[]
  readonly l: readonly number[]
  readonly c: readonly number[]
  readonly v: readonly number[]
  readonly rolls: readonly Schemas['RollMarker'][]
}

/** Weekdays at 00:00 UTC from the in-sample start to the last session before the fence (no holidays, as in fakes.py). */
function weekdays(): number[] {
  const out: number[] = []
  for (let s = IS_START_MS / 1000; s < FENCE_MS / 1000; s += DAY_S) {
    const dow = new Date(s * 1000).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(s)
  }
  return out
}

/** Every demo session; the generator lays its bars on the same weekdays from the same first day. */
const SESSION_TIMES: readonly number[] = weekdays()
const FIRST_SESSION = isoDay(IS_START_MS / 1000)
const cache = new Map<string, DailySeries>()

/** Roll markers on the first session after each quarterly roll day, with seeded gaps of a few ticks. */
function rollMarkers(t: readonly number[], c: readonly number[], index: number, tick: number): Schemas['RollMarker'][] {
  const rand = mulberry32(SEED + 1000 + index)
  const places = decimalsOf(tick)
  const base = (index + 1) * 1000
  const out: Schemas['RollMarker'][] = []
  for (let year = 2010; year <= 2021; year += 1) {
    for (const month of ROLL_MONTHS) {
      const after = Date.UTC(year, month, ROLL_DAY + 1) / 1000
      const k = t.findIndex((s) => s >= after)
      if (k <= 0) continue
      const gapPts = Number((Math.round((rand() - 0.5) * 32) * tick).toFixed(places))
      const from = base + out.length
      out.push({ t: t[k]!, from, to: from + 1, gap_pts: gapPts, gap_pct: (100 * gapPts) / c[k - 1]! })
    }
  }
  return out
}

/**
 * One root's daily bars: the gallery generator run from the universe table's last close, then read backwards in
 * time, so the last session closes exactly at that price and every open equals the close before it.
 */
function buildSeries(index: number, symbol: string): DailySeries {
  const [root] = ROOTS[index]!
  const tick = TICKS[root]?.[0] ?? 0.01
  const places = decimalsOf(tick)
  const lastClose = universeRow(symbol)?.last_close ?? 100
  const raw = ohlcvFixture({ count: SESSION_TIMES.length, seed: SEED + index, start: FIRST_SESSION, firstPrice: lastClose, tick })
  const fix = (x: number): number => Number(x.toFixed(places))
  const n = raw.length
  const t = raw.map((b) => b.time)
  const back = raw.map((_, k) => raw[n - 1 - k]!)
  const o = back.map((b) => fix(b.close))
  const c = back.map((b) => fix(b.open))
  const h = back.map((b) => fix(b.high))
  const l = back.map((b) => fix(b.low))
  const v = back.map((b) => b.volume)
  // A filler last close need not sit on the root's tick grid; the last candle keeps it exactly.
  c[n - 1] = lastClose
  h[n - 1] = Math.max(h[n - 1]!, lastClose)
  l[n - 1] = Math.min(l[n - 1]!, lastClose)
  return { t, o, h, l, c, v, rolls: rollMarkers(t, c, index, tick) }
}

function dailySeries(symbol: string): DailySeries | undefined {
  const index = SYMBOLS.indexOf(symbol)
  if (index < 0) return undefined
  let series = cache.get(symbol)
  if (!series) {
    series = buildSeries(index, symbol)
    cache.set(symbol, series)
  }
  return series
}

/** GET /api/bars: the checks in the backend's order (window, catalog, gate), then the sessions inside [start, end). */
export function bars(query: URLSearchParams): Answer<Schemas['Bars']> {
  const symbol = query.get('symbol') ?? ''
  const timeframe = query.get('timeframe') ?? DAILY
  const variant = query.get('variant') ?? VENDOR
  const maxPoints = intParam(query, 'max_points', DEFAULT_MAX_POINTS)
  const start = query.get('start')
  const end = query.get('end')
  const endMs = end === null ? FENCE_MS : utcMs(end)
  const startMs = start === null ? IS_START_MS : utcMs(start)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs || maxPoints === null) return NOT_IN_DEMO
  const series = timeframe === DAILY && variant === VENDOR ? dailySeries(symbol) : undefined
  if (!series) return NOT_IN_DEMO
  if (startMs < IS_START_MS || endMs > FENCE_MS) return refuse(403, gateRuleText({ startMs, endMs }))
  const first = series.t.findIndex((s) => s * 1000 >= startMs)
  const stop = series.t.findIndex((s) => s * 1000 >= endMs)
  const lo = first < 0 ? series.t.length : first
  const hi = stop < 0 ? series.t.length : stop
  if (hi - lo > maxPoints) return NOT_IN_DEMO
  const inside = (s: number) => s > (series.t[lo] ?? Infinity) && s < endMs / 1000
  return served({
    symbol, timeframe: DAILY, variant: VENDOR, bucket: DAILY, ts_convention: TS_CONVENTION,
    start: isoZ(startMs), end: isoZ(endMs), label: DEMO_TEXT.barsLabel,
    t: series.t.slice(lo, hi), o: series.o.slice(lo, hi), h: series.h.slice(lo, hi), l: series.l.slice(lo, hi),
    c: series.c.slice(lo, hi), v: series.v.slice(lo, hi),
    rolls: series.rolls.filter((r) => inside(r.t)),
    sessions: NO_SESSION_QA,
    gate: DEMO_GATE,
  })
}

const CATALOG_COLUMNS: Schemas['CatalogColumn'][] = [
  { name: 'ts', type: 'timestamp[ns, tz=UTC]' }, { name: 'o', type: 'double' }, { name: 'h', type: 'double' },
  { name: 'l', type: 'double' }, { name: 'c', type: 'double' }, { name: 'v', type: 'double' },
]

/** GET /api/data/catalog: the one daily vendor series per root that /api/bars serves; no file behind any. */
export function catalog(): Schemas['DataCatalog'] {
  return {
    source: DEMO_TEXT.catalogSource,
    series: ROOTS.map(([root]) => {
      const symbol = `${root}.V.0`
      return {
        symbol, root, timeframe: DAILY, variant: VENDOR, file: fillCopy(DEMO_TEXT.catalogFile, { symbol }),
        size_bytes: 0, modified_utc: CAPTURED_UTC, rows: SESSION_TIMES.length, row_groups: null, columns: CATALOG_COLUMNS,
        first_ts: isoZ(IS_START_MS), extends_past_fence: false, error: null,
      }
    }),
    unrecognised: [],
  }
}

// ---------------------------------------------------------------- fillers

/** `count` seeded values from `from` to exactly `to`, wandering by about `scale` between (a pinned random walk). */
function bridge(from: number, to: number, count: number, seed: number, scale: number): number[] {
  const z = mulberry32(seed)
  const walk = [0]
  for (let k = 1; k < count; k += 1) walk.push(walk[k - 1]! + (z() - 0.5) * scale)
  const end = walk[count - 1]!
  const out = walk.map((w, k) => from + ((to - from) * k) / (count - 1) + w - (end * k) / (count - 1))
  out[count - 1] = to
  return out
}

const rvLines = new Map<string, Schemas['RealisedVolSeries']>()

/** The RV22 line of a universe symbol: a seeded line around the default table row's realised volatility (built once each). */
function rvSeries(symbol: string): Schemas['RealisedVolSeries'] | undefined {
  const row = universeRow(symbol)
  if (!row) return undefined
  let line = rvLines.get(symbol)
  if (line === undefined) {
    const window = RV_WINDOW
    const t = [...SESSION_TIMES]
    const z = mulberry32(SEED + 2000 + SYMBOLS.indexOf(symbol))
    const level = row.realised_vol ?? 0.2
    let x = 0
    const rv = t.map((_, k) => {
      x = 0.97 * x + 0.06 * (z() - 0.5)
      return k < window ? null : Number((level * Math.exp(x)).toFixed(6))
    })
    line = {
      symbol, window, label: LABEL, basis: DEMO_TEXT.rvBasis, unit: RV_UNIT,
      t, date: t.map(isoDay), rv, last: rv[rv.length - 1] ?? null, gate: DEMO_GATE,
    }
    rvLines.set(symbol, line)
  }
  return line
}

/** GET /api/market/rv for GP's RV22 pane. */
export function realisedVol(query: URLSearchParams): Answer<Schemas['RealisedVolSeries']> {
  const line = rvSeries(query.get('symbol') ?? '')
  const window = intParam(query, 'window', RV_WINDOW)
  return line && window === RV_WINDOW ? served(line) : NOT_IN_DEMO
}

/** GET /api/market/pair-corr: a seeded line that ends at the universe matrix entry of the pair, at the same window. */
export function pairCorrelation(query: URLSearchParams): Answer<Schemas['PairCorrelationSeries']> {
  const a = query.get('a') ?? ''
  const b = query.get('b') ?? ''
  const window = intParam(query, 'window', PAIR_DEFAULT_WINDOW)
  const block = universeBody().correlation_window
  const i = block.symbols.indexOf(a)
  const j = block.symbols.indexOf(b)
  const entry = block.matrix[i]?.[j]
  if (i < 0 || j < 0 || i === j || window !== UNIVERSE_WINDOW || typeof entry !== 'number') return NOT_IN_DEMO
  const t = [...SESSION_TIMES]
  const clip = (v: number) => Math.max(-0.99, Math.min(0.99, v))
  const line = bridge(clip(entry * 0.5), entry, t.length - window, SEED + 3000 + i * 32 + j, 0.04)
  const corr = [...t.slice(0, window).map(() => null), ...line.map((v, k) => (k === line.length - 1 ? v : Number(clip(v).toFixed(6))))]
  return served({ a, b, window, label: LABEL, basis: DEMO_TEXT.pairBasis, t, date: t.map(isoDay), corr, gate: DEMO_GATE })
}

/** The last two sessions before the fence; a session's hourly bars run from 22:00 UTC the day before to 20:00. */
const TWO_SESSIONS = SESSION_TIMES.slice(-2)

function twoDayRow(row: Schemas['UniverseRow'], index: number): Schemas['TwoDayRow'] {
  const last = row.last_close ?? 100
  const r1d = row.returns['1D'] ?? 0
  const tick = TICKS[row.root]?.[0] ?? 0.01
  const places = decimalsOf(tick)
  let prior = Number((last / (1 + r1d)).toFixed(places))
  if (r1d > 0 && prior >= last) prior = last - tick
  if (r1d < 0 && prior <= last) prior = last + tick
  const scale = last * 0.002
  const day0 = bridge(prior * (1 - r1d / 2), prior, 23, SEED + 4000 + index, scale)
  const day1 = bridge(prior, last, 24, SEED + 5000 + index, scale).slice(1)
  const fix = (v: number, k: number, all: number[]) => (k === all.length - 1 ? v : Number(v.toFixed(places)))
  const t = TWO_SESSIONS.flatMap((day) => Array.from({ length: 23 }, (_, h) => day - 2 * HOUR_S + h * HOUR_S))
  return {
    symbol: row.symbol, root: row.root, t,
    c: [...day0.map(fix), ...day1.map(fix)],
    day: t.map((_, k) => (k < 23 ? 0 : 1)),
    prior_close: prior, last,
  }
}

/** GET /api/market/two-day for the asked universe symbols (all 27 when none are named). */
export function twoDay(query: URLSearchParams): Answer<Schemas['TwoDay']> {
  const text = query.get('symbols')
  const names = text === null ? [...SYMBOLS] : [...new Set(text.split(',').map((s) => s.trim()).filter((s) => s !== ''))]
  const rows = names.map((name) => universeRow(name)).filter((r) => r !== undefined)
  if (names.length === 0 || rows.length !== names.length) return NOT_IN_DEMO
  return served({
    label: LABEL, basis: DEMO_TEXT.twoDayBasis, bucket: '1h', sessions: TWO_SESSIONS.map(isoDay),
    rows: rows.map((r) => twoDayRow(r, SYMBOLS.indexOf(r.symbol))), missing: [], gate: DEMO_GATE,
  })
}

/** GET /api/instruments/{root}: the fixture backend's NQ answer only. */
export const INSTRUMENTS: ReadonlyMap<string, Schemas['InstrumentDes']> = new Map([[INSTRUMENT_NQ.root, INSTRUMENT_NQ]])
