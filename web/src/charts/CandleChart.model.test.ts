import { describe, expect, it } from 'vitest'
import {
  FENCE_EPOCH_S,
  barEvents,
  barStep,
  candleSummary,
  candleTable,
  containingIndex,
  daySeparators,
  fenceLogical,
  fillMarkers,
  formatCompactVolume,
  formatTime,
  formatVolume,
  isIntraday,
  legendStats,
  movingAverage,
  paneFactors,
  readoutParts,
  realisedVol,
  scrollIntoView,
  stepIndex,
  stepLabel,
  tickLabel,
  timeSegments,
  withLeftRoom,
  withRollTags,
  zoomRange,
  type CandleBars,
} from './CandleChart.model'

const DAY = 86_400
const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

/** Five daily bars, Mon 2021-12-27 to Fri 2021-12-31, the last week before the fence. */
const DAILY: CandleBars = {
  t: [d('2021-12-27'), d('2021-12-28'), d('2021-12-29'), d('2021-12-30'), d('2021-12-31')],
  o: [100, 101, 102, 101.5, 103],
  h: [101.5, 102.5, 103, 103.25, 104],
  l: [99.5, 100.5, 101, 100.75, 102.5],
  c: [101, 102, 101.5, 103, 103.75],
  v: [1000, 2000, 1500, 312_004, 900],
}

describe('bar spacing', () => {
  it('takes the median positive step, so weekends do not stretch daily data', () => {
    expect(barStep([d('2021-12-23'), d('2021-12-24'), d('2021-12-27'), d('2021-12-28')])).toBe(DAY)
    expect(barStep([0, 300, 600, 900, 4000])).toBe(300)
  })

  it('falls back to a day for fewer than two bars', () => {
    expect(barStep([])).toBe(DAY)
    expect(barStep([5])).toBe(DAY)
  })

  it('calls anything under a day intraday', () => {
    expect(isIntraday(DAY)).toBe(false)
    expect(isIntraday(300)).toBe(true)
  })

  it('names the bar size for the summary', () => {
    expect(stepLabel(DAY)).toBe('daily')
    expect(stepLabel(3600)).toBe('1-hour')
    expect(stepLabel(300)).toBe('5-minute')
    expect(stepLabel(60)).toBe('1-minute')
  })
})

describe('containingIndex', () => {
  const t = DAILY.t
  it('finds the bar whose span holds the time (bars are open-stamped)', () => {
    expect(containingIndex(t, t[0]!, DAY)).toBe(0)
    expect(containingIndex(t, t[1]! + 3600 * 14, DAY)).toBe(1)
    expect(containingIndex(t, t[4]! + DAY - 1, DAY)).toBe(4)
  })

  it('gives null before the first bar and after the last bar ends', () => {
    expect(containingIndex(t, t[0]! - 1, DAY)).toBeNull()
    expect(containingIndex(t, t[4]! + DAY, DAY)).toBeNull()
    expect(containingIndex([], 5, DAY)).toBeNull()
  })

  it('maps a weekend time to the Friday bar inside the data', () => {
    const fri = [d('2021-12-23'), d('2021-12-24'), d('2021-12-27')]
    expect(containingIndex(fri, d('2021-12-25') + 3600, DAY)).toBe(1)
  })
})

describe('fenceLogical', () => {
  it('sits half a bar after the last bar when the data stops at the fence', () => {
    expect(fenceLogical(DAILY.t, DAY)).toBe(4.5)
  })

  it('sits between the bars that straddle it', () => {
    const t = [d('2021-12-30'), d('2021-12-31'), d('2022-01-03')]
    expect(fenceLogical(t, DAY)).toBe(1.5)
  })

  it('extrapolates by the bar step when the data ends well before the fence', () => {
    const t = [d('2021-12-20'), d('2021-12-21')]
    // 2021-12-21 to 2022-01-01 is 11 days: 1 + 11 - 0.5
    expect(fenceLogical(t, DAY)).toBe(11.5)
  })

  it('is null without bars and uses the in-sample boundary by default', () => {
    expect(fenceLogical([], DAY)).toBeNull()
    expect(FENCE_EPOCH_S).toBe(d('2022-01-01'))
  })
})

describe('zoom and scroll', () => {
  it('zooms in about the right edge when no crosshair is set', () => {
    expect(zoomRange({ from: 0, to: 100 }, 0.5, null, 200)).toEqual({ from: 50, to: 100 })
  })

  it('zooms about the crosshair bar, keeping it at the same place', () => {
    expect(zoomRange({ from: 0, to: 100 }, 0.5, 20, 200)).toEqual({ from: 10, to: 60 })
  })

  it('never shows fewer than ten bars or more than all bars plus the right offset', () => {
    const tight = zoomRange({ from: 90, to: 100 }, 0.5, null, 200)
    expect(tight.to - tight.from).toBe(10)
    const wide = zoomRange({ from: 0, to: 100 }, 4, null, 50)
    expect(wide.to - wide.from).toBeCloseTo(55, 9)
  })

  it('scrolls just enough to show a bar, keeping the width', () => {
    expect(scrollIntoView({ from: 10, to: 20 }, 25)).toEqual({ from: 15.5, to: 25.5 })
    expect(scrollIntoView({ from: 10, to: 20 }, 5)).toEqual({ from: 4.5, to: 14.5 })
    expect(scrollIntoView({ from: 10, to: 20 }, 15)).toEqual({ from: 10, to: 20 })
  })

  it('steps the keyboard crosshair one bar, starting at the last visible bar', () => {
    expect(stepIndex(null, -1, 100, { from: 10, to: 40.3 })).toBe(40)
    expect(stepIndex(null, 1, 100, { from: 10, to: 140 })).toBe(99)
    expect(stepIndex(40, -1, 100, null)).toBe(39)
    expect(stepIndex(3, 1, 0, null)).toBeNull()
  })

  // D35: null (not the clamped, unchanged index) at an edge, so a caller that only prevents default
  // on a real move gives Left and Right back to the panel once there (CandleChart.tsx, GP and GIP).
  it('releases the edges: null when a step would not move (already at the first or last bar)', () => {
    expect(stepIndex(99, 1, 100, null)).toBeNull()
    expect(stepIndex(0, -1, 100, null)).toBeNull()
    expect(stepIndex(0, 1, 100, null)).toBe(1)
    expect(stepIndex(99, -1, 100, null)).toBe(98)
    // A single-bar chart: current already sits at both the first and last bar.
    expect(stepIndex(0, -1, 1, null)).toBeNull()
    expect(stepIndex(0, 1, 1, null)).toBeNull()
  })
})

describe('formatting', () => {
  it('writes daily times as UTC dates and intraday times in the given zone', () => {
    expect(formatTime(d('2021-03-10'), false, 'America/New_York')).toBe('2021-03-10')
    const open = Date.parse('2021-03-10T14:35:00Z') / 1000
    expect(formatTime(open, true, 'America/New_York')).toBe('2021-03-10 09:35')
    expect(formatTime(open, true, 'UTC')).toBe('2021-03-10 14:35')
  })

  it('groups volume by thousands and shortens it for the axis tag', () => {
    expect(formatVolume(312_004)).toBe('312,004')
    expect(formatVolume(null)).toBe('')
    expect(formatCompactVolume(312_004)).toBe('312.0k')
    expect(formatCompactVolume(1_250_000)).toBe('1.3M')
    expect(formatCompactVolume(950)).toBe('950')
  })

  it('labels ticks: months for daily data (the year goes in the strip), times for intraday', () => {
    expect(tickLabel(d('2021-03-01'), 1, false, 'UTC')).toBe('Mar')
    expect(tickLabel(d('2021-01-01'), 0, false, 'UTC')).toBe('Jan')
    // Born failing: a day-of-month tick printed '20' in the daily month row and '13' in the intraday
    // HH:MM row; the dates live in the second axis row, so these ticks carry no label.
    expect(tickLabel(d('2021-03-10'), 2, false, 'UTC')).toBe('')
    expect(tickLabel(Date.parse('2021-03-10T14:35:00Z') / 1000, 3, true, 'America/New_York')).toBe('09:35')
    expect(tickLabel(Date.parse('2021-03-10T05:00:00Z') / 1000, 2, true, 'America/New_York')).toBe('')
    expect(tickLabel(Date.parse('2021-03-01T05:00:00Z') / 1000, 1, true, 'America/New_York')).toBe('')
  })
})

describe('indicators', () => {
  it('computes a simple moving average that waits for a full window and skips gaps', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
    expect(movingAverage([1, null, 3, 4], 2)).toEqual([null, null, null, 3.5])
  })

  it('computes annualised realised volatility in per cent from log returns', () => {
    const closes = [100, 101, 100, 101, 100]
    const out = realisedVol(closes, 4, 252)
    expect(out.slice(0, 4)).toEqual([null, null, null, null])
    const r = Math.log(101 / 100)
    const mean = 0
    const variance = (4 * (r - mean) ** 2) / 3
    expect(out[4]).toBeCloseTo(Math.sqrt(variance * 252) * 100, 10)
  })

  it('gives null where a close in the window is missing', () => {
    expect(realisedVol([100, null, 101, 102, 103], 2, 252)).toEqual([null, null, null, null, expect.any(Number)])
  })
})

describe('legend and readout', () => {
  it('finds the high, the low and their bars, and the average close', () => {
    const s = legendStats(DAILY)
    expect(s).toEqual({ high: 104, highIndex: 4, low: 99.5, lowIndex: 0, average: (101 + 102 + 101.5 + 103 + 103.75) / 5 })
    expect(legendStats({ t: [], o: [], h: [], l: [], c: [], v: [] })).toBeNull()
  })

  it('reads T O H L C V for a bar, plus the indicator', () => {
    const parts = readoutParts(DAILY, 3, { precision: 2, intraday: false, timeZone: 'UTC', indicator: { name: 'RV22', values: [null, null, null, 18.44, 19], unit: '%' } })
    expect(parts.map((p) => `${p.label} ${p.value}`)).toEqual([
      'T 2021-12-30', 'O 101.50', 'H 103.25', 'L 100.75', 'C 103.00', 'V 312,004', 'RV22 18.4%',
    ])
  })

  it('leaves a missing value blank rather than zero', () => {
    const gap: CandleBars = { ...DAILY, o: [null, ...DAILY.o.slice(1)], v: [null, ...DAILY.v.slice(1)] }
    const parts = readoutParts(gap, 0, { precision: 2, intraday: false, timeZone: 'UTC' })
    expect(parts.find((p) => p.label === 'O')?.value).toBe('')
    expect(parts.find((p) => p.label === 'V')?.value).toBe('')
  })
})

describe('events: fills and rolls', () => {
  const fills = [
    { t: DAILY.t[1]! + 3600 * 15, side: 'buy' as const, qty: 2, price: 101.25 },
    { t: DAILY.t[3]! + 3600 * 20, side: 'sell' as const, qty: 2, price: 102.75 },
    { t: d('2021-06-01'), side: 'buy' as const, qty: 1, price: 90 },
  ]
  const rolls = [{ t: DAILY.t[2]!, gapPts: 12.5, gapPct: 0.08 }]

  it('puts each fill and roll on the bar that holds it and drops ones outside the data', () => {
    const ev = barEvents(DAILY, fills, rolls, DAY)
    expect([...ev.keys()].sort()).toEqual([1, 2, 3])
    expect(ev.get(1)).toEqual([{ kind: 'fill', side: 'buy', qty: 2, price: 101.25 }])
    expect(ev.get(2)).toEqual([{ kind: 'roll', gapPts: 12.5, gapPct: 0.08 }])
  })

  it('makes an up arrow below the bar for a buy and a down arrow above it for a sell', () => {
    const colours = { buy: '#51EE6C', sell: '#FF2C4A' }
    expect(fillMarkers(DAILY, fills, DAY, colours)).toEqual([
      { time: DAILY.t[1], position: 'belowBar', shape: 'arrowUp', color: '#51EE6C', text: 'B' },
      { time: DAILY.t[3], position: 'aboveBar', shape: 'arrowDown', color: '#FF2C4A', text: 'S' },
    ])
  })

  it('shows the events of the bar in the readout', () => {
    const parts = readoutParts(DAILY, 2, { precision: 2, intraday: false, timeZone: 'UTC', events: barEvents(DAILY, fills, rolls, DAY) })
    expect(parts.at(-1)).toEqual({ label: '', value: 'Roll, gap +12.50 pts (+0.08%)' })
  })
})

describe('accessible summary and table', () => {
  it('names the range, last close, low and high, events and the fence', () => {
    const text = candleSummary({ name: 'NQ1 Index', bars: DAILY, step: DAY, precision: 2, timeZone: 'UTC', fills: 2, rolls: 1 })
    expect(text).toBe(
      'NQ1 Index: 5 daily bars from 2021-12-27 to 2021-12-31; last close 103.75; low 99.50 on 2021-12-27, high 104.00 on 2021-12-31. 2 fills and 1 roll marked. The 2022-01-01 fence follows the last bar.',
    )
  })

  it('leaves the fence out when the data ends long before it', () => {
    const early: CandleBars = { ...DAILY, t: DAILY.t.map((t) => t - 400 * DAY) }
    const text = candleSummary({ name: 'NQ1 Index', bars: early, step: DAY, precision: 2, timeZone: 'UTC', fills: 0, rolls: 0 })
    expect(text).not.toMatch(/fence/)
    expect(text).not.toMatch(/marked/)
  })

  it('says when there are no bars', () => {
    const none = { t: [], o: [], h: [], l: [], c: [], v: [] }
    expect(candleSummary({ name: 'NQ1 Index', bars: none, step: DAY, precision: 2, timeZone: 'UTC', fills: 0, rolls: 0 })).toBe('NQ1 Index: no bars.')
  })

  it('gives every bar as a table row with its events', () => {
    const table = candleTable({
      name: 'NQ1 Index', bars: DAILY, precision: 2, intraday: false, timeZone: 'UTC',
      events: barEvents(DAILY, [], [{ t: DAILY.t[2]!, gapPts: null, gapPct: null }], DAY),
      indicator: { name: 'RV22', values: [null, null, null, null, 20], unit: '%' },
    })
    expect(table.caption).toBe('NQ1 Index bars')
    expect(table.columns.map((c) => c.label)).toEqual(['Time', 'Open', 'High', 'Low', 'Close', 'Volume', 'RV22', 'Events'])
    expect(table.rows).toHaveLength(5)
    expect(table.rows[3]).toEqual({ time: '2021-12-30', open: '101.50', high: '103.25', low: '100.75', close: '103.00', volume: '312,004', indicator: '', events: '' })
    expect(table.rows[2]?.events).toBe('Roll')
    expect(table.rows[4]?.indicator).toBe('20.0%')
  })
})

describe('day separators (look spec 7.6 GIP)', () => {
  it('puts one halfway between the last bar of a local day and the first bar of the next', () => {
    // 2021-03-08 and 03-09, 15:00 and 20:00 UTC: 10:00 and 15:00 in New York.
    const d0 = Date.UTC(2021, 2, 8, 15) / 1000
    const t = [d0, d0 + 5 * 3600, d0 + 86400, d0 + 86400 + 5 * 3600]
    expect(daySeparators(t, 'America/New_York')).toEqual([1.5])
  })

  it('splits days in the chart time zone, not in UTC', () => {
    // 23:00 and 01:00 UTC on either side of midnight UTC are both 2021-03-08 evening in New York.
    const t = [Date.UTC(2021, 2, 8, 23) / 1000, Date.UTC(2021, 2, 9, 1) / 1000]
    expect(daySeparators(t, 'America/New_York')).toEqual([])
    expect(daySeparators(t, 'UTC')).toEqual([0.5])
  })

  it('gives none for a single day or no bars', () => {
    expect(daySeparators([], 'UTC')).toEqual([])
    expect(daySeparators([Date.UTC(2021, 2, 8, 15) / 1000], 'UTC')).toEqual([])
  })
})

describe('time strip under the axis', () => {
  const x = (i: number) => 10 + i * 20

  it('groups daily bars by year across a wide range and puts a divider at each boundary', () => {
    const t = [d('2020-12-30'), d('2020-12-31'), d('2021-01-04'), ...Array.from({ length: 300 }, (_, i) => d('2021-01-05') + i * DAY)]
    const strip = timeSegments({ t, from: 0, to: t.length - 1, intraday: false, timeZone: 'UTC', indexToX: x, width: 10_000 })
    expect(strip.segments.map((s) => s.label)).toEqual(['2020', '2021'])
    expect(strip.dividers).toEqual([x(2) - 10])
    expect(strip.segments[0]).toEqual({ key: '2020', label: '2020', left: 0, width: x(1) + 10 })
  })

  it('groups daily bars by month over a short range', () => {
    const t = [d('2021-02-25'), d('2021-02-26'), d('2021-03-01'), d('2021-03-02')]
    const strip = timeSegments({ t, from: 0, to: 3, intraday: false, timeZone: 'UTC', indexToX: x, width: 1000 })
    expect(strip.segments.map((s) => s.label)).toEqual(['Feb 2021', 'Mar 2021'])
  })

  it('groups intraday bars by date in the display zone and clips to the plot', () => {
    const t = [Date.parse('2021-03-09T20:55:00Z') / 1000, Date.parse('2021-03-10T14:30:00Z') / 1000]
    const strip = timeSegments({ t, from: -3, to: 1, intraday: true, timeZone: 'America/New_York', indexToX: x, width: 35 })
    expect(strip.segments.map((s) => s.label)).toEqual(['2021-03-09', '2021-03-10'])
    expect(strip.segments[1]).toEqual({ key: '2021-03-10', label: '2021-03-10', left: 20, width: 15 })
  })

  it('is empty when nothing is visible', () => {
    expect(timeSegments({ t: [], from: 0, to: 5, intraday: false, timeZone: 'UTC', indexToX: x, width: 100 })).toEqual({ segments: [], dividers: [] })
  })
})

describe('roll date tags in the second axis row (look spec 6.1, 8.5 d)', () => {
  const x = (i: number) => 10 + i * 20
  const t = [d('2021-02-24'), d('2021-02-25'), d('2021-02-26'), d('2021-03-01'), d('2021-03-02'), d('2021-03-03')]
  const strip = timeSegments({ t, from: 0, to: 5, intraday: false, timeZone: 'UTC', indexToX: x, width: 120 })
  const width = (text: string) => text.length * 7

  it('centres a square tag on each roll bar in view, kept inside the plot', () => {
    const rolls = [{ index: 3, label: '2021-03-01' }, { index: 5, label: '2021-03-03' }, { index: 40, label: '2021-06-18' }]
    const tagged = withRollTags(strip, rolls, { indexToX: x, width: 120, textWidth: width })
    // 70px of text plus 4px either side, centred on x(3) = 70; the one at x(5) = 110 is pulled in
    // from the right edge; index 40 is out of view.
    expect(tagged.rolls).toEqual([
      { key: '3', label: '2021-03-01', left: 70 - 39, width: 78 },
      { key: '5', label: '2021-03-03', left: 120 - 78, width: 78 },
    ])
  })

  it('blanks a month label that the tag would cover, and keeps the others', () => {
    expect(strip.segments.map((s) => s.label)).toEqual(['Feb 2021', 'Mar 2021'])
    const tagged = withRollTags(strip, [{ index: 1, label: '02-25' }], { indexToX: x, width: 120, textWidth: width })
    expect(tagged.segments.map((s) => s.label)).toEqual(['', 'Mar 2021'])
    expect(tagged.dividers).toEqual(strip.dividers)
  })

  it('changes nothing without rolls in view', () => {
    expect(withRollTags(strip, [], { indexToX: x, width: 120, textWidth: width })).toEqual({ ...strip, rolls: [] })
  })
})

describe('room for the first time label at the left edge', () => {
  it('widens the fitted range on the left so bar 0 sits at least `room` pixels in', () => {
    const r = withLeftRoom({ from: -0.5, to: 34 }, 800, 24)
    expect(r.to).toBe(34)
    const spacing = 800 / (r.to - r.from)
    expect((0 - r.from) * spacing).toBeCloseTo(24, 9)
  })

  it('leaves a range that already has the room', () => {
    expect(withLeftRoom({ from: -5, to: 34 }, 800, 24)).toEqual({ from: -5, to: 34 })
    expect(withLeftRoom({ from: -0.5, to: 34 }, 0, 24)).toEqual({ from: -0.5, to: 34 })
  })
})

describe('pane sizes', () => {
  it('gives the volume pane a quarter of the height (look spec 6.1)', () => {
    expect(paneFactors(false)).toEqual([0.75, 0.25])
    const three = paneFactors(true)
    expect(three[1]).toBe(0.25)
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  })
})
