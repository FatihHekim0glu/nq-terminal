import { describe, expect, it } from 'vitest'
import { FENCE_EPOCH_S } from './CandleChart.model'
import { DAILY_ROLLS, RTH_DAYS, dailyFills, dailyNq, rthBars, toHourly } from './CandleChart.galleryData'

const iso = (t: number) => new Date(t * 1000).toISOString()

describe('CandleChart gallery fixtures', () => {
  it('holds 2021 daily bars that stop at the last session before the fence', () => {
    const b = dailyNq()
    expect(b.t).toHaveLength(260)
    expect(iso(b.t[0]!)).toBe('2021-01-04T00:00:00.000Z')
    expect(iso(b.t.at(-1)!)).toBe('2021-12-31T00:00:00.000Z')
    expect(Math.max(...b.t, ...DAILY_ROLLS.map((r) => r.t))).toBeLessThan(FENCE_EPOCH_S)
  })

  it('puts every fill inside a bar and on the tick grid', () => {
    const b = dailyNq()
    for (const f of dailyFills(b)) {
      expect(f.t).toBeLessThan(FENCE_EPOCH_S)
      expect((f.price * 4) % 1).toBe(0)
    }
  })

  it('builds 78 five-minute RTH bars a session, 09:30 to 15:55 New York', () => {
    const b = rthBars(RTH_DAYS, 300, 7)
    expect(b.t).toHaveLength(78 * 5)
    expect(iso(b.t[0]!)).toBe('2021-03-08T14:30:00.000Z')
    expect(iso(b.t[77]!)).toBe('2021-03-08T20:55:00.000Z')
    b.t.forEach((_, i) => {
      expect(b.h[i]!).toBeGreaterThanOrEqual(Math.max(b.o[i]!, b.c[i]!))
      expect(b.l[i]!).toBeLessThanOrEqual(Math.min(b.o[i]!, b.c[i]!))
    })
  })

  it('aggregates hourly bars with true highs, lows and summed volume', () => {
    const five = rthBars(RTH_DAYS, 300, 7)
    const hour = toHourly(five)
    expect(hour.t).toHaveLength(7 * 5)
    expect(hour.h[0]).toBe(Math.max(...five.h.slice(0, 12).map(Number)))
    expect(hour.v[0]).toBe(five.v.slice(0, 12).reduce((a, v) => a! + v!, 0))
    expect(hour.c[6]).toBe(five.c[77])
  })
})
