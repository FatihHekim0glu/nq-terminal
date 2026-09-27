import { describe, expect, it } from 'vitest'
import { equityFixture, intradayTimes, mulberry32, ohlcvFixture, tradingDays } from './fixtures'

describe('gallery fixtures (deterministic, so screenshots are stable)', () => {
  it('repeats the same numbers for the same seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const xs = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(mulberry32(8)()).not.toBe(xs[0])
  })

  it('makes weekday dates in epoch seconds at midnight UTC', () => {
    const t = tradingDays(10, '2021-12-27')
    expect(t).toHaveLength(10)
    expect(t[0]).toBe(Date.UTC(2021, 11, 27) / 1000)
    for (const s of t) expect([0, 6]).not.toContain(new Date(s * 1000).getUTCDay())
    // The fence (2022-01-01) falls inside: Friday 31 December is followed by Monday 3 January.
    expect(t).toContain(Date.UTC(2022, 0, 3) / 1000)
    expect(t).not.toContain(Date.UTC(2022, 0, 1) / 1000)
  })

  it('makes an equity line with gaps where asked, and 250k points quickly', () => {
    const eq = equityFixture({ count: 300, seed: 1, gaps: [[100, 110]] })
    expect(eq.t).toHaveLength(300)
    expect(eq.v[0]).toBe(1)
    expect(eq.v.slice(100, 110).every((v) => v === null)).toBe(true)
    expect(eq.v[99]).not.toBeNull()
    const started = performance.now()
    const big = equityFixture({ count: 250_000, seed: 2, start: '2010-01-04', stepSeconds: 60 })
    expect(big.v).toHaveLength(250_000)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('makes consistent OHLCV bars', () => {
    const bars = ohlcvFixture({ count: 200, seed: 3 })
    expect(bars).toHaveLength(200)
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close))
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close))
      expect(b.volume).toBeGreaterThan(0)
      expect(Number.isInteger(b.volume)).toBe(true)
    }
    // Prices sit on the NQ tick grid of 0.25.
    expect(bars.every((b) => [b.open, b.high, b.low, b.close].every((p) => Number.isInteger(p * 4)))).toBe(true)
  })

  it('steps intraday times evenly', () => {
    expect(intradayTimes(3, 60, '2019-03-14T13:30:00Z')).toEqual([1552570200, 1552570260, 1552570320])
  })
})
