// Fixture stacks for the LineStack gallery entries (gallery builds only: nothing but *.gallery.tsx
// imports this). Seeded, so the screenshots are stable; in-sample dates only; not market data.
import { LINE_STACK_GALLERY as G } from '../copy/lineStack'
import { equityFixture, tradingDays } from '../gallery/fixtures'
import type { LineStackPane } from './LineStack.types'

const TRADING_DAYS_PER_YEAR = 252
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

type Series = (number | null)[]

/** Percentage below the running peak (0 at a new high); gaps stay gaps. */
export function underwaterPercent(v: readonly (number | null)[]): Series {
  let peak = -Infinity
  return v.map((x) => {
    if (x === null) return null
    peak = Math.max(peak, x)
    return (x / peak - 1) * 100
  })
}

/**
 * Annualised Sharpe of daily log returns over the last `window` returns (sample deviation), from the
 * first full window on. Returns across a gap are missing; at least half the window must be present.
 */
export function rollingSharpe(v: readonly (number | null)[], window: number, perYear = TRADING_DAYS_PER_YEAR): Series {
  const r = v.map((x, i) => {
    const prev = i > 0 ? v[i - 1] : null
    return x === null || prev === null || prev === undefined ? null : Math.log(x / prev)
  })
  return v.map((_, i) => {
    if (i < window) return null
    const w = r.slice(i - window + 1, i + 1).filter((x): x is number => x !== null)
    if (w.length < Math.max(2, window / 2)) return null
    const mean = w.reduce((a, b) => a + b, 0) / w.length
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (w.length - 1))
    return sd > 0 ? (mean / sd) * Math.sqrt(perYear) : null
  })
}

export interface GalleryStack {
  readonly t: number[]
  readonly panes: LineStackPane[]
}

/** Weekdays from 2010-01-04 to 2021-12-31, the whole in-sample window. */
function inSampleDays(): number[] {
  const last = utc('2021-12-31')
  return tradingDays(3200, '2010-01-04').filter((t) => t <= last)
}

/** EQ, DD and RR panes (look spec 7.5) for a fixture strategy against a same-exposure benchmark. */
export function galleryStack(): GalleryStack {
  const t = inSampleDays()
  const gapFrom = t.findIndex((x) => x >= utc('2020-03-16'))
  const gapTo = t.findIndex((x) => x > utc('2020-03-27'))
  const strategy = equityFixture({ count: t.length, seed: 21, start: '2010-01-04', drift: 0.00032, vol: 0.009, gaps: [[gapFrom, gapTo]] }).v
  const benchmark = equityFixture({ count: t.length, seed: 5, start: '2010-01-04', drift: 0.00042, vol: 0.013 }).v
  return {
    t,
    panes: [
      {
        id: 'eq', weight: 3, logAllowed: true, decimals: 2,
        series: [{ name: G.strategy, style: 'primary', values: strategy }, { name: G.benchmark, style: 'benchmark', values: benchmark }],
      },
      { id: 'dd', weight: 1.3, unit: '%', decimals: 1, zero: 'white', series: [{ name: G.underwater, style: 'underwater', values: underwaterPercent(strategy) }] },
      {
        id: 'rr', weight: 1.3, zero: 'grey', decimals: 2,
        series: [
          { name: G.sharpe63, style: 'rollShort', values: rollingSharpe(strategy, 63) },
          { name: G.sharpe252, style: 'rollLong', values: rollingSharpe(strategy, 252) },
        ],
      },
    ],
  }
}

export const PERF_POINTS = 250_000

/** 250,000 one-minute points from 2019-01-02 (about 174 days), as an equity pane and an underwater pane. */
export function perfStack(): GalleryStack {
  const { t, v } = equityFixture({ count: PERF_POINTS, seed: 7, start: '2019-01-02T00:00:00Z', stepSeconds: 60, drift: 0.000002, vol: 0.0006 })
  return {
    t,
    panes: [
      { id: 'eq', weight: 2, logAllowed: true, decimals: 4, series: [{ name: G.strategy, style: 'primary', values: v }] },
      { id: 'dd', weight: 1, unit: '%', decimals: 2, zero: 'white', series: [{ name: G.underwater, style: 'underwater', values: underwaterPercent(v) }] },
    ],
  }
}

/** Two years of daily equity from `seed`, ending 2021-12-31, for the linked-group entry. */
export function smallStack(seed: number): GalleryStack {
  const t = inSampleDays().filter((x) => x >= utc('2020-01-02'))
  const { v } = equityFixture({ count: t.length, seed, start: '2020-01-02', drift: 0.0004, vol: 0.011 })
  return {
    t,
    panes: [
      { id: 'eq', weight: 2, decimals: 2, series: [{ name: G.strategy, style: 'primary', values: v }] },
      { id: 'dd', weight: 1, unit: '%', decimals: 1, zero: 'white', series: [{ name: G.underwater, style: 'underwater', values: underwaterPercent(v) }] },
    ],
  }
}
