import { describe, expect, it } from 'vitest'
import { RANGE_TOOLBAR } from '../../charts/theme/geometry'
import {
  FENCE_MS, IS_START_MS, RANGES, availableVariants, barsQuery, customWindow, fenceRefusal, fillsFor, gateRuleText,
  dayReturnPercent, gipWindow, instrumentMatches, isoDate, parseIsoDate, priceDecimals, quoteFromBars, rangeAllowed, rangeWindow,
  rollsFrom, rv22Percent, sessionBadges, sourceTimeframe, symbolFor, type BarsLike,
} from './model'

const DAY = 86_400_000
const utc = (text: string) => Date.parse(text)

describe('fence constants', () => {
  it('are the in-sample window [2010-01-01, 2022-01-01) in UTC', () => {
    expect(IS_START_MS).toBe(utc('2010-01-01T00:00:00Z'))
    expect(FENCE_MS).toBe(utc('2022-01-01T00:00:00Z'))
  })

  it('uses the range buttons of the chart theme (look spec 6.4)', () => {
    expect([...RANGES]).toEqual([...RANGE_TOOLBAR.ranges])
  })
})

describe('dates', () => {
  it('parses calendar dates only', () => {
    expect(parseIsoDate('2019-03-14')).toBe(utc('2019-03-14T00:00:00Z'))
    expect(parseIsoDate('2019-02-30')).toBeNull()
    expect(parseIsoDate('14/03/2019')).toBeNull()
    expect(parseIsoDate(' 2019-03-14 ')).toBe(utc('2019-03-14T00:00:00Z'))
  })

  it('formats UTC dates', () => {
    expect(isoDate(utc('2021-12-31T23:59:00Z'))).toBe('2021-12-31')
  })
})

describe('rangeWindow: every range ends at the fence unless another end is given', () => {
  it('counts back from the exclusive end', () => {
    expect(rangeWindow('1D')).toEqual({ startMs: utc('2021-12-31T00:00:00Z'), endMs: FENCE_MS })
    expect(rangeWindow('3D').startMs).toBe(utc('2021-12-29T00:00:00Z'))
    expect(rangeWindow('1M').startMs).toBe(utc('2021-12-01T00:00:00Z'))
    expect(rangeWindow('6M').startMs).toBe(utc('2021-07-01T00:00:00Z'))
    expect(rangeWindow('YTD').startMs).toBe(utc('2021-01-01T00:00:00Z'))
    expect(rangeWindow('1Y').startMs).toBe(utc('2021-01-01T00:00:00Z'))
    expect(rangeWindow('5Y').startMs).toBe(utc('2017-01-01T00:00:00Z'))
    expect(rangeWindow('Max').startMs).toBe(IS_START_MS)
  })

  it('anchors YTD at the year of the last included day and never starts before the fence start', () => {
    const end = utc('2015-06-15T00:00:00Z')
    expect(rangeWindow('YTD', end)).toEqual({ startMs: utc('2015-01-01T00:00:00Z'), endMs: end })
    expect(rangeWindow('5Y', utc('2012-01-01T00:00:00Z')).startMs).toBe(IS_START_MS)
  })
})

describe('rangeAllowed: the span caps of /api/bars', () => {
  it('allows one year of 1m, three years of 5m and 1h, anything on 1d', () => {
    expect(rangeAllowed('1m', rangeWindow('1Y'))).toBe(true)
    expect(rangeAllowed('1m', rangeWindow('5Y'))).toBe(false)
    expect(rangeAllowed('5m', rangeWindow('5Y'))).toBe(false)
    expect(rangeAllowed('1h', rangeWindow('1Y'))).toBe(true)
    expect(rangeAllowed('1d', rangeWindow('Max'))).toBe(true)
  })
})

describe('customWindow: the amber date fields', () => {
  it('turns an inclusive end date into an exclusive end', () => {
    expect(customWindow('2021-01-04', '2021-12-31')).toEqual({
      ok: true, window: { startMs: utc('2021-01-04T00:00:00Z'), endMs: FENCE_MS },
    })
  })

  it('rejects malformed dates and a start after the end', () => {
    expect(customWindow('2021-13-01', '2021-12-31')).toEqual({ ok: false, reason: 'bad-date', value: '2021-13-01' })
    expect(customWindow('2021-06-01', '2021-05-01')).toEqual({ ok: false, reason: 'order' })
  })
})

describe('gipWindow: one session from 22:00 UTC the day before', () => {
  it('matches the backend day buckets', () => {
    expect(gipWindow('2019-03-14')).toEqual({ startMs: utc('2019-03-13T22:00:00Z'), endMs: utc('2019-03-14T22:00:00Z') })
    expect(gipWindow('2019-02-30')).toBeNull()
  })
})

describe('fenceRefusal: nothing past 2021-12-31 is ever requested', () => {
  it('passes a window inside the fence', () => {
    expect(fenceRefusal(rangeWindow('Max'))).toBeNull()
    expect(fenceRefusal(gipWindow('2021-12-31')!)).toBeNull()
  })

  it('refuses a 2022 window with the gate rule text', () => {
    const w = gipWindow('2022-03-14')!
    expect(fenceRefusal(w)).toBe(
      'window [2022-03-13 22:00:00+00:00, 2022-03-14 22:00:00+00:00) leaves the in-sample window ' +
        '[2010-01-01 00:00:00+00:00, 2022-01-01 00:00:00+00:00); straddling windows are refused, not clipped',
    )
  })

  it('refuses a straddling window at either end (born failing: the first in-sample session asks for 2009)', () => {
    expect(fenceRefusal(gipWindow('2010-01-01')!)).not.toBeNull()
    expect(fenceRefusal({ startMs: utc('2021-12-01T00:00:00Z'), endMs: FENCE_MS + DAY })).not.toBeNull()
  })

  it('formats timestamps the way the gate prints them', () => {
    expect(gateRuleText({ startMs: utc('2022-03-14T00:00:00Z'), endMs: utc('2022-03-15T00:00:00Z') })).toContain(
      'window [2022-03-14 00:00:00+00:00, 2022-03-15 00:00:00+00:00)',
    )
  })
})

describe('barsQuery: the /api/bars parameters', () => {
  it('omits the end when the window ends at the fence, so no request names 2022', () => {
    expect(barsQuery('NQ.V.0', '1d', 'vendor', rangeWindow('1Y'))).toEqual({
      symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor', start: '2021-01-01',
    })
  })

  it('sends dates for whole days and ISO times otherwise', () => {
    expect(barsQuery('NQ.V.0', '1m', 'repaired', gipWindow('2019-03-14')!)).toEqual({
      symbol: 'NQ.V.0', timeframe: '1m', variant: 'repaired', start: '2019-03-13T22:00:00Z', end: '2019-03-14T22:00:00Z',
    })
    const custom = customWindow('2015-01-02', '2015-06-30')
    if (!custom.ok) throw new Error('expected a window')
    expect(barsQuery('NQ.V.0', '1d', 'vendor', custom.window)).toMatchObject({ start: '2015-01-02', end: '2015-07-01' })
  })

  it('refuses to build a query for a window past the fence', () => {
    expect(() => barsQuery('NQ.V.0', '1d', 'vendor', gipWindow('2022-01-03')!)).toThrow(/fence/)
  })
})

describe('instruments and series', () => {
  it('maps a root to its continuous symbol', () => {
    expect(symbolFor('NQ')).toBe('NQ.V.0')
    expect(symbolFor('6E')).toBe('6E.V.0')
    expect(symbolFor('nq; drop')).toBeNull()
    expect(symbolFor('')).toBeNull()
  })

  it('serves intraday bars from the 1m files', () => {
    expect(sourceTimeframe('1d')).toBe('1d')
    expect(sourceTimeframe('5m')).toBe('1m')
    expect(sourceTimeframe('1h')).toBe('1m')
  })

  it('lists the variants the catalog holds for the source timeframe', () => {
    const series = [
      { symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor' },
      { symbol: 'NQ.V.0', timeframe: '1m', variant: 'repaired' },
      { symbol: 'NQ.V.0', timeframe: '1m', variant: 'vendor' },
      { symbol: 'ES.V.0', timeframe: '1m', variant: 'vendor' },
    ]
    expect(availableVariants(series, 'NQ.V.0', '1d')).toEqual(['vendor'])
    expect(availableVariants(series, 'NQ.V.0', '5m')).toEqual(['vendor', 'repaired'])
    expect(availableVariants(series, 'ES.V.0', '1m')).toEqual(['vendor'])
  })
})

const DAILY: BarsLike = {
  t: [utc('2021-12-29T00:00:00Z') / 1000, utc('2021-12-30T00:00:00Z') / 1000, utc('2021-12-31T00:00:00Z') / 1000],
  o: [16300.25, 16320.5, 16330],
  h: [16350, 16360.75, 16340.5],
  l: [16280, 16300, 16290.25],
  c: [16320.5, 16330, 16310.75],
  v: [100_000, 120_500, 90_250],
}

describe('quoteFromBars: the two-line header from served bars', () => {
  it('uses the last daily bar and the change from the bar before', () => {
    const q = quoteFromBars({ root: 'NQ', ticker: 'NQ1 Index', bars: DAILY, intraday: false, rv22: 18.4, dayReturnPct: -0.12 })
    expect(q).toMatchObject({
      ticker: 'NQ1 Index', root: 'NQ', last: 16310.75, open: 16330, high: 16340.5, low: 16290.25, volume: 90_250,
      lastTick: 'down', time: '2021-12-31', delayed: true, rv22: 18.4, changePct: -0.12, decimals: 2,
    })
    expect(q.change).toBeCloseTo(-19.25, 10)
  })

  it('never divides a back-adjusted change: the percent change comes from the API or stays missing', () => {
    const q = quoteFromBars({ root: 'NQ', ticker: 'NQ1 Index', bars: DAILY, intraday: false, rv22: null, dayReturnPct: null })
    expect(q.change).toBeCloseTo(-19.25, 10)
    expect(q.changePct).toBeNull()
  })

  it('aggregates the last session of intraday bars (22:00 UTC boundary) and dates it in ET', () => {
    const t0 = utc('2019-03-13T21:58:00Z') / 1000
    const bars: BarsLike = {
      t: [t0, t0 + 60, t0 + 120, t0 + 180],
      o: [100, 101, 102, 103],
      h: [100.5, 104, 103, 103.5],
      l: [99.5, 100.75, 101, 102.25],
      c: [100.25, 102, 103, 102.5],
      v: [10, 20, 30, 40],
    }
    const q = quoteFromBars({ root: 'NQ', ticker: 'NQ1 Index', bars, intraday: true, rv22: null, dayReturnPct: null })
    // Session from 22:00 UTC: bars 3 and 4 (22:00 and 22:01).
    expect(q).toMatchObject({ open: 102, high: 103.5, low: 101, volume: 70, last: 102.5, time: '2019-03-13 18:01' })
    expect(q.change).toBeCloseTo(102.5 - 102, 10)
  })

  it('shows missing values when nothing was served', () => {
    const empty: BarsLike = { t: [], o: [], h: [], l: [], c: [], v: [] }
    expect(quoteFromBars({ root: 'NQ', ticker: 'NQ1 Index', bars: empty, intraday: false, rv22: null, dayReturnPct: null })).toMatchObject({
      last: null, change: null, time: null, lastTick: null, spark: [],
    })
  })
})

describe('priceDecimals: displayed precision never rounds a served price', () => {
  it('finds the decimals the prices need', () => {
    expect(priceDecimals(DAILY)).toBe(2)
    expect(priceDecimals({ ...DAILY, c: [1.12345, 1.1234, 1.12], o: [1, 1, 1], h: [1, 1, 1], l: [1, 1, 1] })).toBe(5)
    expect(priceDecimals({ ...DAILY, c: [4700, 4701, 4702], o: [4700, 4700, 4700], h: [4700, 4700, 4700], l: [4700, 4700, 4700] })).toBe(2)
  })
})

describe('sessionBadges: [GATED] and [REPAIRED]', () => {
  it('counts and lists the flagged sessions', () => {
    const s = sessionBadges({ assessed: true, source: 'qa.day_gate', gated: ['2011-01-04', '2011-01-05'], repaired: [] }, null)
    expect(s).toEqual({ assessed: true, source: 'qa.day_gate', gated: ['2011-01-04', '2011-01-05'], repaired: [], day: null })
  })

  it('names the flag of the one GIP date', () => {
    expect(sessionBadges({ assessed: true, source: 'x', gated: ['2011-01-20'], repaired: [] }, '2011-01-20').day).toBe('gated')
    expect(sessionBadges({ assessed: true, source: 'x', gated: [], repaired: ['2011-01-19', '2011-01-20'] }, '2011-01-20').day).toBe('repaired')
    expect(sessionBadges({ assessed: true, source: 'x', gated: [], repaired: ['2011-01-19'] }, '2011-01-20').day).toBeNull()
  })
})

describe('fills from a linked run', () => {
  const row = (over: Record<string, unknown>) => ({
    ts: null, ts_epoch_s: 1_307_390_400, instrument: null, side: 'BUY', qty: 20, px: 6061.25,
    commission: null, commission_float: null, position_id: null, order_id: null, tags: null, ...over,
  })

  it('keeps single-instrument fills and the chart root, drops other roots', () => {
    expect(instrumentMatches('NQ', null)).toBe(true)
    expect(instrumentMatches('NQ', 'NQ.XCME')).toBe(true)
    expect(instrumentMatches('NQ', 'MNQZ6.CME')).toBe(true)
    expect(instrumentMatches('NQ', 'NQH1.XCME')).toBe(true)
    expect(instrumentMatches('NQ', 'ES.XCME')).toBe(false)
    expect(instrumentMatches('ES', 'MESZ1.CME')).toBe(true)
    expect(instrumentMatches('C', 'CL.XCME')).toBe(false)
  })

  it('maps rows to chart fills and skips incomplete ones', () => {
    const fills = fillsFor('NQ', [row({}), row({ side: 'SELL', qty: 3, px: 6040.25 }), row({ px: null }), row({ instrument: 'ES.XCME' }), row({ side: 'HOLD' })])
    expect(fills).toEqual([
      { t: 1_307_390_400, side: 'buy', qty: 20, price: 6061.25 },
      { t: 1_307_390_400, side: 'sell', qty: 3, price: 6040.25 },
    ])
  })
})

describe('rolls and RV22', () => {
  it('maps API roll markers to chart rolls', () => {
    expect(rollsFrom([{ t: 5, from: 1, to: 2, gap_pts: 1.25, gap_pct: 0.0094 }])).toEqual([{ t: 5, gapPts: 1.25, gapPct: 0.0094 }])
  })

  it('reads RV22 from the universe row only when it is dated the chart last session', () => {
    const rows = [{ root: 'NQ', realised_vol: 0.3057, last_date: '2021-12-31' }]
    expect(rv22Percent(rows, 'NQ', '2021-12-31')).toBeCloseTo(30.57, 10)
    expect(rv22Percent(rows, 'NQ', '2021-12-30')).toBeNull()
    expect(rv22Percent(rows, 'ES', '2021-12-31')).toBeNull()
    expect(rv22Percent([{ root: 'NQ', realised_vol: null, last_date: '2021-12-31' }], 'NQ', '2021-12-31')).toBeNull()
  })

  it('reads the 1D return (MV4 convention, a fraction) from the universe row of the same date', () => {
    const rows = [{ root: 'NQ', returns: { '1D': 0.0052 }, last_date: '2021-12-31' }]
    expect(dayReturnPercent(rows, 'NQ', '2021-12-31')).toBeCloseTo(0.52, 10)
    expect(dayReturnPercent(rows, 'NQ', '2021-12-30')).toBeNull()
    expect(dayReturnPercent([{ root: 'NQ', returns: {}, last_date: '2021-12-31' }], 'NQ', '2021-12-31')).toBeNull()
  })
})
