// Fixture data for the CandleChart gallery entries (gallery builds only): seeded, so screenshots are
// stable, and in-sample only (2021 dates, before the fence). Nothing here is real market data; the
// roll dates follow NQ's quarterly pattern (about eight sessions before each March, June, September
// and December expiry).
import { mulberry32, ohlcvFixture, type OhlcvBar } from '../gallery/fixtures'
import { realisedVol, type CandleBars, type CandleFill, type CandleIndicator, type CandleRoll } from './CandleChart.model'

const onTick = (x: number, tick = 0.25) => Math.round(x / tick) * tick

export function toColumns(bars: readonly OhlcvBar[]): CandleBars {
  return {
    t: bars.map((b) => b.time), o: bars.map((b) => b.open), h: bars.map((b) => b.high),
    l: bars.map((b) => b.low), c: bars.map((b) => b.close), v: bars.map((b) => b.volume),
  }
}

/** 260 NQ-like daily bars, 2021-01-04 to 2021-12-31: the last week before the fence. */
export function dailyNq(): CandleBars {
  return toColumns(ohlcvFixture({ count: 260, seed: 21, start: '2021-01-04', firstPrice: 12_880, tick: 0.25 }))
}

const at = (iso: string) => Date.parse(`${iso}Z`) / 1000

/** Quarterly rolls with back-adjustment gaps (points and per cent of the prior close). */
export const DAILY_ROLLS: readonly CandleRoll[] = [
  { t: at('2021-03-11T00:00:00'), gapPts: -18.25, gapPct: -0.14 },
  { t: at('2021-06-10T00:00:00'), gapPts: -21.5, gapPct: -0.15 },
  { t: at('2021-09-16T00:00:00'), gapPts: -24.75, gapPct: -0.16 },
  { t: at('2021-12-09T00:00:00'), gapPts: -26.0, gapPct: -0.16 },
]

/** Round trips from a linked run: entries and exits a few hours into the session. */
export function dailyFills(bars: CandleBars): CandleFill[] {
  const trades: ReadonlyArray<readonly [number, 'buy' | 'sell', number]> = [
    [38, 'buy', 2], [52, 'sell', 2], [118, 'sell', 1], [131, 'buy', 1], [196, 'buy', 3], [233, 'sell', 3],
  ]
  return trades.map(([i, side, qty]) => ({ t: (bars.t[i] ?? 0) + 15 * 3600, side, qty, price: bars.c[i] ?? 0 }))
}

export function rv22(bars: CandleBars, name: string): CandleIndicator {
  return { name, values: realisedVol(bars.c, 22, 252), unit: '%', digits: 1 }
}

/** RTH bars (09:30 to 16:00 New York, EST) of `stepSeconds`, for the given sessions. */
export function rthBars(days: readonly string[], stepSeconds: number, seed: number, firstPrice = 13_020): CandleBars {
  const rand = mulberry32(seed)
  const perDay = Math.round((6.5 * 3600) / stepSeconds)
  const out: OhlcvBar[] = []
  let prev = firstPrice
  for (const day of days) {
    const open0 = at(`${day}T14:30:00`)
    for (let k = 0; k < perDay; k += 1) {
      const open = prev
      const close = onTick(open * (1 + (rand() - 0.5) * 0.004 * Math.sqrt(stepSeconds / 300)))
      const high = onTick(Math.max(open, close) + rand() * 6) + 0.25
      const low = onTick(Math.min(open, close) - rand() * 6) - 0.25
      const u = k / (perDay - 1)
      const volume = Math.round((8000 + 22_000 * (2 * (u - 0.5)) ** 2 + 4000 * rand()) * (stepSeconds / 300))
      out.push({ time: open0 + k * stepSeconds, open, high, low, close, volume })
      prev = close
    }
  }
  return toColumns(out)
}

/** Hourly bars built from 5-minute bars (true highs and lows), stamped at each hour's first bar. */
export function toHourly(five: CandleBars): CandleBars {
  const groups = new Map<number, number[]>()
  five.t.forEach((t, i) => {
    const day = Math.floor(t / 86_400) * 86_400
    const open = day + 14.5 * 3600
    const key = open + Math.floor((t - open) / 3600) * 3600
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  const bars: OhlcvBar[] = [...groups.values()].map((idx) => {
    const first = idx[0]!
    const last = idx[idx.length - 1]!
    return {
      time: five.t[first]!, open: five.o[first]!, close: five.c[last]!,
      high: Math.max(...idx.map((i) => five.h[i]!)), low: Math.min(...idx.map((i) => five.l[i]!)),
      volume: idx.reduce((a, i) => a + (five.v[i] ?? 0), 0),
    }
  })
  return toColumns(bars)
}

export const RTH_DAYS = ['2021-03-08', '2021-03-09', '2021-03-10', '2021-03-11', '2021-03-12'] as const
