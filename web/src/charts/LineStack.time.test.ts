import { describe, expect, it } from 'vitest'
import { axisDecimals, formatAxisValue, linearTicks, logTicks, timeAxisLayout } from './LineStack.time'

const utc = (y: number, m: number, d = 1, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000
const iso = (t: number) => new Date(t * 1000).toISOString()

describe('two-row time axis (look spec 6.1)', () => {
  it('daily data over three years: months in row 1, centred in each month; years in row 2 split by dividers', () => {
    const l = timeAxisLayout(utc(2019, 1), utc(2021, 12, 31), 1200)
    expect(l.level).toBe('month')
    expect(l.majors.map(iso).slice(0, 3)).toEqual(['2019-01-01T00:00:00.000Z', '2019-03-01T00:00:00.000Z', '2019-05-01T00:00:00.000Z'])
    expect(l.row1.slice(0, 3).map((x) => x.text)).toEqual(['Jan', 'Mar', 'May'])
    expect(l.row1[0]!.at).toBe((utc(2019, 1) + utc(2019, 2)) / 2)
    expect(l.row2.map((x) => x.text)).toEqual(['2019', '2020', '2021'])
    expect(l.row2[1]!.at).toBe((utc(2020, 1) + utc(2021, 1)) / 2)
    // A boundary at the very start of the view is not a divider.
    expect(l.dividers.map(iso)).toEqual(['2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z'])
  })

  it('the full in-sample window: half-years in row 1, twelve years in row 2, the first one centred in its visible part', () => {
    const min = utc(2010, 1, 4)
    const max = utc(2022, 1, 1)
    const l = timeAxisLayout(min, max, 1250)
    expect(l.level).toBe('month')
    expect(new Set(l.row1.map((x) => x.text))).toEqual(new Set(['Jan', 'Jul']))
    expect(l.row2.map((x) => x.text)).toEqual(['2010', '2011', '2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021'])
    expect(l.row2[0]!.at).toBe((min + utc(2011, 1)) / 2)
    // A month label is centred in its month but may use its whole step: Jul 2010 has Jul to Dec.
    const jul = l.row1.find((x) => x.text === 'Jul')!
    expect(jul.at).toBe((utc(2010, 7) + utc(2010, 8)) / 2)
    expect(jul.room).toBe(utc(2011, 1) - utc(2010, 7))
    // Every major tick is inside the view and on a month start.
    for (const t of l.majors) {
      expect(t).toBeGreaterThanOrEqual(min)
      expect(t).toBeLessThanOrEqual(max)
      expect(iso(t)).toMatch(/-(01|07)-01T00:00:00/)
    }
  })

  it('one month of daily data: every second day in row 1, month and year in row 2', () => {
    const l = timeAxisLayout(utc(2019, 3, 1), utc(2019, 3, 29), 1200)
    expect(l.level).toBe('day')
    expect(l.row1.slice(0, 3).map((x) => x.text)).toEqual(['1', '3', '5'])
    expect(l.row1[0]!.at).toBe(utc(2019, 3, 1) + 43_200)
    expect(l.row2.map((x) => x.text)).toEqual(['Mar 2019'])
  })

  it('one session of intraday data: HH:MM at each tick, the date centred on the day', () => {
    const min = utc(2019, 3, 14, 13, 30)
    const max = utc(2019, 3, 14, 20, 0)
    const l = timeAxisLayout(min, max, 1200)
    expect(l.level).toBe('minute')
    expect(l.row1[0]).toMatchObject({ at: min, text: '13:30' })
    expect(l.row1[1]!.text).toBe('13:45')
    expect(l.row2.map(({ at, text }) => ({ at, text }))).toEqual([{ at: (min + max) / 2, text: '2019-03-14' }])
    expect(l.dividers).toEqual([])
    // Each label carries the width it may use: a tick label its step, a span label its visible span.
    expect(l.row1[1]!.room).toBe(900)
    expect(l.row2[0]!.room).toBe(max - min)
  })

  it('intraday across midnight: a divider at midnight and one date per day', () => {
    const l = timeAxisLayout(utc(2019, 3, 14, 20), utc(2019, 3, 15, 8), 600)
    expect(l.level).toBe('hour')
    expect(l.dividers.map(iso)).toEqual(['2019-03-15T00:00:00.000Z'])
    expect(l.row2.map((x) => x.text)).toEqual(['2019-03-14', '2019-03-15'])
  })

  it('decades of data fall back to years in row 1 and nothing in row 2', () => {
    const l = timeAxisLayout(utc(1960, 1), utc(2021, 12, 31), 900)
    expect(l.level).toBe('year')
    expect(l.row2).toEqual([])
    expect(l.row1.every((x) => /^\d{4}$/.test(x.text))).toBe(true)
  })

  it('keeps every label at least the minimum spacing apart', () => {
    for (const [min, max] of [[utc(2010, 1), utc(2022, 1)], [utc(2019, 1), utc(2019, 7)], [utc(2019, 3, 14), utc(2019, 3, 16)]] as const) {
      const width = 700
      const l = timeAxisLayout(min, max, width)
      const px = (t: number) => ((t - min) / (max - min)) * width
      for (let i = 1; i < l.majors.length; i++) expect(px(l.majors[i]!) - px(l.majors[i - 1]!)).toBeGreaterThanOrEqual(44)
    }
  })

  it('returns an empty layout for an empty or reversed view', () => {
    expect(timeAxisLayout(10, 10, 800).majors).toEqual([])
    expect(timeAxisLayout(10, 5, 800).row1).toEqual([])
  })
})

describe('value axis ticks', () => {
  it('picks 1, 2, 2.5 or 5 steps that keep labels apart', () => {
    expect(linearTicks(0, 1, 300)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1])
    expect(linearTicks(-0.35, 0.02, 120)).toEqual([-0.3, -0.2, -0.1, 0])
    expect(linearTicks(0.93, 3.4, 300)).toEqual([1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25])
  })

  it('never returns floating-point noise', () => {
    for (const t of linearTicks(0.1, 0.7, 300)) expect(String(t).length).toBeLessThanOrEqual(4)
  })

  it('handles an empty or flat range', () => {
    expect(linearTicks(1, 1, 300)).toEqual([1])
    expect(linearTicks(Number.NaN, 1, 300)).toEqual([])
  })

  it('log scale: 1, 2 and 5 per decade over a wide range, plain steps over a narrow one', () => {
    expect(logTicks(0.8, 30, 400)).toEqual([1, 2, 5, 10, 20])
    expect(logTicks(0.8, 3000, 120)).toEqual([1, 10, 100, 1000])
    expect(logTicks(0.9, 3.1, 300)).toEqual(linearTicks(0.9, 3.1, 300))
  })

  it('formats labels with the decimals the step needs, ASCII minus and the unit', () => {
    expect(axisDecimals(0.25)).toBe(2)
    expect(axisDecimals(0.1)).toBe(1)
    expect(axisDecimals(5)).toBe(0)
    expect(formatAxisValue(-0.1, 0.1, '%')).toBe('-0.1%')
    expect(formatAxisValue(-0.0000001, 0.1, '')).toBe('0.0')
    expect(formatAxisValue(1.25, 0.25, '')).toBe('1.25')
  })
})
