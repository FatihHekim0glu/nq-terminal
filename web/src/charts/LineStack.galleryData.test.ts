import { describe, expect, it } from 'vitest'
import { FENCE_TIME } from './fence'
import { galleryStack, perfStack, rollingSharpe, underwaterPercent } from './LineStack.galleryData'

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000

describe('LineStack gallery fixtures', () => {
  it('underwater is the percentage below the running peak, with gaps kept', () => {
    expect(underwaterPercent([1, 1.2, 0.9, null, 1.2, 1.5])).toEqual([0, 0, -25, null, 0, 0])
    expect(underwaterPercent([null, 2, 1])).toEqual([null, 0, -50])
  })

  it('rolling Sharpe is the annualised mean over the standard deviation of log returns in the window', () => {
    const v = [1, 1.01, 1.0, 1.02, 1.03]
    const r = [Math.log(1.01), Math.log(1 / 1.01), Math.log(1.02), Math.log(1.03 / 1.02)]
    const mean = r.reduce((a, b) => a + b, 0) / 4
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / 3)
    const out = rollingSharpe(v, 4)
    expect(out.slice(0, 4)).toEqual([null, null, null, null])
    expect(out[4]).toBeCloseTo((mean / sd) * Math.sqrt(252), 10)
  })

  it('rolling Sharpe needs half a window of returns and skips gaps', () => {
    const out = rollingSharpe([1, 1.01, null, null, null, 1.02, 1.01], 4)
    expect(out.every((x) => x === null || Number.isFinite(x))).toBe(true)
    expect(out[4]).toBeNull()
  })

  it('the main entry is in-sample only: 2010-01-04 to 2021-12-31, weekdays, with a missing fortnight in March 2020', () => {
    const { t, panes } = galleryStack()
    expect(t[0]).toBe(utc(2010, 1, 4))
    expect(t.at(-1)).toBe(utc(2021, 12, 31))
    expect(t.every((x) => x < FENCE_TIME)).toBe(true)
    expect(t.every((x) => ![0, 6].includes(new Date(x * 1000).getUTCDay()))).toBe(true)
    const strategy = panes[0]!.series[0]!.values
    const gap = t.map((x, i) => [x, strategy[i]] as const).filter(([x]) => x >= utc(2020, 3, 16) && x <= utc(2020, 3, 27))
    expect(gap).toHaveLength(10)
    expect(gap.every(([, v]) => v === null)).toBe(true)
    expect(panes.map((p) => p.id)).toEqual(['eq', 'dd', 'rr'])
  })

  it('the speed entry has 250,000 one-minute points inside the in-sample window', () => {
    const { t, panes } = perfStack()
    expect(t).toHaveLength(250_000)
    expect(t[1]! - t[0]!).toBe(60)
    expect(t.at(-1)!).toBeLessThan(FENCE_TIME)
    expect(panes.every((p) => p.series.every((s) => s.values.length === 250_000))).toBe(true)
  })
})
