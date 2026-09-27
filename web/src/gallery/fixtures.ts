// Deterministic fixture data for gallery entries: the same seed gives the same numbers on every run,
// so screenshot baselines are stable. Times are epoch seconds (the API's `t`), daily data at 00:00
// UTC on weekdays. Nothing here is real market data.

/** A small seeded generator (mulberry32): uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal draws from a uniform generator (Box-Muller). */
function normal(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), Number.MIN_VALUE)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
}

const DAY = 86_400

function toSeconds(start: string): number {
  const ms = Date.parse(start.length === 10 ? `${start}T00:00:00Z` : start)
  if (!Number.isFinite(ms)) throw new Error(`Not a date: ${start}`)
  return Math.floor(ms / 1000)
}

/** `count` weekdays from `start` (YYYY-MM-DD), each at 00:00 UTC. */
export function tradingDays(count: number, start = '2010-01-04'): number[] {
  const out: number[] = []
  let s = toSeconds(start)
  while (out.length < count) {
    const dow = new Date(s * 1000).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(s)
    s += DAY
  }
  return out
}

/** `count` evenly spaced times from `start` (an ISO time), `stepSeconds` apart. */
export function intradayTimes(count: number, stepSeconds: number, start: string): number[] {
  const first = toSeconds(start)
  return Array.from({ length: count }, (_, i) => first + i * stepSeconds)
}

export interface EquityFixtureOptions {
  readonly count: number
  readonly seed: number
  /** Half-open index ranges [from, to) that become gaps (null), as in a missing session. */
  readonly gaps?: ReadonlyArray<readonly [number, number]>
  /** First date or time; daily weekdays unless stepSeconds is given. */
  readonly start?: string
  readonly stepSeconds?: number
  /** Daily drift and volatility of the log returns. */
  readonly drift?: number
  readonly vol?: number
}

export interface SeriesFixture {
  readonly t: number[]
  readonly v: (number | null)[]
}

/** An equity curve starting at 1 (a growth-of-1 line), with optional gaps. */
export function equityFixture(opts: EquityFixtureOptions): SeriesFixture {
  const { count, seed, gaps = [], start = '2010-01-04', stepSeconds, drift = 0.0003, vol = 0.01 } = opts
  const t = stepSeconds === undefined ? tradingDays(count, start) : intradayTimes(count, stepSeconds, start)
  const z = normal(mulberry32(seed))
  const v: (number | null)[] = new Array<number | null>(count)
  let level = 1
  for (let i = 0; i < count; i++) {
    if (i > 0) level *= Math.exp(drift + vol * z())
    v[i] = level
  }
  for (const [from, to] of gaps) for (let i = Math.max(0, from); i < Math.min(count, to); i++) v[i] = null
  return { t, v }
}

export interface OhlcvBar {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
}

export interface OhlcvFixtureOptions {
  readonly count: number
  readonly seed: number
  readonly start?: string
  readonly stepSeconds?: number
  readonly firstPrice?: number
  /** Price grid (NQ ticks are 0.25). */
  readonly tick?: number
}

const onGrid = (x: number, tick: number) => Math.round(x / tick) * tick

/** OHLCV bars on a tick grid: high and low always contain open and close. */
export function ohlcvFixture(opts: OhlcvFixtureOptions): OhlcvBar[] {
  const { count, seed, start = '2021-06-01', stepSeconds, firstPrice = 15_000, tick = 0.25 } = opts
  const times = stepSeconds === undefined ? tradingDays(count, start) : intradayTimes(count, stepSeconds, start)
  const rand = mulberry32(seed)
  const z = normal(rand)
  const bars: OhlcvBar[] = []
  let prev = onGrid(firstPrice, tick)
  for (const time of times) {
    const open = prev
    const close = onGrid(open * Math.exp(0.012 * z()), tick)
    const high = onGrid(Math.max(open, close) * (1 + 0.004 * rand()), tick) + tick
    const low = onGrid(Math.min(open, close) * (1 - 0.004 * rand()), tick) - tick
    const volume = Math.round(300_000 + 400_000 * rand())
    bars.push({ time, open, high, low, close, volume })
    prev = close
  }
  return bars
}
