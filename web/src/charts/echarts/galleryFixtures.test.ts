import { describe, expect, it } from 'vitest'
import {
  blocksFixture, corrFixture, costFixture, distributionFixture, monFixture, mretFixture, pScatterFixture, swimlaneFixture, weekdayFixture,
} from './galleryFixtures'
import { FENCE_SECONDS } from './shared'

const IS_START = Date.UTC(2010, 0, 1) / 1000

describe('ECharts gallery fixtures (deterministic, in-sample)', () => {
  it('gives twelve years of monthly returns, the average first and 2021 to 2010 after it', () => {
    const m = mretFixture()
    expect(m.rows).toHaveLength(13)
    expect(m.rows[0]).toBe('12 yr avg')
    expect(m.rows.slice(1, 3)).toEqual(['2021', '2020'])
    expect(m.rows[12]).toBe('2010')
    expect(m.values.every((r) => r.length === 12)).toBe(true)
    expect(mretFixture()).toEqual(m)
  })

  it('gives a symmetric 27 by 27 correlation matrix with a unit diagonal', () => {
    const c = corrFixture()
    expect(c.rows).toHaveLength(27)
    expect(c.columns).toEqual(c.rows)
    c.values.forEach((r, i) => r.forEach((v, j) => {
      expect(v).toBe(c.values[j]![i])
      expect(Math.abs(v!)).toBeLessThanOrEqual(1)
      if (i === j) expect(v).toBe(1)
    }))
  })

  it('gives 27 instruments by six return windows with a threshold per window', () => {
    const m = monFixture()
    expect(m.values).toHaveLength(27)
    expect(m.columns).toEqual(['1D', '1W', '1M', '3M', 'YTD', '12M'])
    expect(m.strongAt).toHaveLength(6)
  })

  it('bins every daily return from 2010 to 2021 and keeps the series before the fence', () => {
    const d = distributionFixture()
    const n = d.series!.v.filter((v) => v !== null).length
    expect(d.counts.reduce((a, b) => a + b, 0)).toBe(n)
    expect(d.edges).toHaveLength(d.counts.length + 1)
    expect(Math.min(...d.series!.t)).toBeGreaterThanOrEqual(IS_START)
    expect(Math.max(...d.series!.t)).toBeLessThan(FENCE_SECONDS)
    expect(d.risk.cvar99!).toBeGreaterThan(d.risk.var99!)
    expect(d.risk.var99!).toBeGreaterThan(d.risk.var95!)
  })

  it('gives the ladders their intervals and the cost ladder its break-even marker', () => {
    expect(blocksFixture().bars).toHaveLength(3)
    expect(weekdayFixture().bars).toHaveLength(5)
    const cost = costFixture()
    expect(cost.marker!.at).toBeGreaterThan(0)
    expect(cost.marker!.at).toBeLessThan(cost.bars.length - 1)
  })

  it('gives sixteen registered p-values in [0, 1]', () => {
    const p = pScatterFixture()
    expect(p.points).toHaveLength(16)
    expect(p.points.every((x) => x.p >= 0 && x.p <= 1)).toBe(true)
  })

  it('gives a log the size of the real one, in-sample except the two sealed reads', () => {
    const s = swimlaneFixture()
    expect(s.reads).toHaveLength(2790)
    const sealed = s.reads.filter((r) => r.sealed)
    expect(sealed).toHaveLength(2)
    expect(s.reads.filter((r) => !r.sealed).every((r) => r.start >= IS_START && r.end <= FENCE_SECONDS)).toBe(true)
    expect(swimlaneFixture()).toEqual(s)
  })
})
