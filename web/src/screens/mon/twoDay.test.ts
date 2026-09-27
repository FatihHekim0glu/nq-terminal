// MON's 2Day cell (look spec 7.7): a sparkline of the last two in-sample sessions' hourly closes from
// GET /api/market/two-day, the prior session in #4D4D4D, the last in white, the final segment in up or
// down colour against the prior close; and the same in words for assistive technology.
import { describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { MON } from '../../copy/market'
import { sparkline, sparkText } from './twoDay'

const ROW: Schemas['TwoDayRow'] = {
  symbol: 'NQ.V.0', root: 'NQ',
  t: [100, 200, 300, 400, 500],
  c: [10, 12, null, 11, 14],
  day: [0, 0, 1, 1, 1],
  last: 14,
  prior_close: 12,
}

describe('sparkline', () => {
  it('scales the closes to the box, the prior session and the last one as separate lines', () => {
    const s = sparkline(ROW, 40, 10)!
    // x runs over the points in order, y from the lowest close (bottom) to the highest (top).
    expect(s.prior).toBe('0,10 10,5')
    expect(s.current).toBe('30,7.5 40,0')
    expect(s.final).toBe('30,7.5 40,0')
    expect(s.tone).toBe('up')
  })

  it('colours the final segment down when the last close is below the prior close', () => {
    expect(sparkline({ ...ROW, last: 11, c: [10, 12, null, 13, 11] }, 40, 10)!.tone).toBe('down')
  })

  it('is null when fewer than two closes are served (nothing to draw)', () => {
    expect(sparkline({ ...ROW, c: [null, null, null, null, 5] }, 40, 10)).toBeNull()
  })
})

describe('sparkText', () => {
  it('names the sessions, the last close, the prior close and the direction', () => {
    expect(sparkText(ROW, ['2021-12-30', '2021-12-31'], (v) => v.toFixed(2))).toBe(
      '2Day 2021-12-30 to 2021-12-31: last 14.00, prior close 12.00, up',
    )
    expect(MON.twoDayText).toContain('{last}')
  })

  it('says when there is no close', () => {
    expect(sparkText({ ...ROW, last: null }, ['2021-12-30', '2021-12-31'], String)).toBe(MON.twoDayNone)
  })
})
