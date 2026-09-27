// ROLL model (ANALYTICS MV10, gaps as MV2): the calendar strip, the per-market table and chart input, and the text the
// screen shows, from the API's rolls. Nothing is recomputed from prices; the only derivation is the month
// bucketing of roll dates, and every roll dated after 2021-12-31 is cut before anything else.
import { describe, expect, it } from 'vitest'
import { CL, ES, NQ, makeCalendar } from './rollTestData'
import {
  STRIP_FIRST_NUMBER,
  cellLabel,
  cellText,
  formatPct,
  formatPts,
  gapChart,
  qaText,
  rollsCsv,
  shownRolls,
  stripCsv,
  stripRows,
  summaryText,
  yearsOf,
} from './model'

const MAR = 2
const JUN = 5
const SEP = 8

describe('the fence', () => {
  it('drops every roll dated on or after 2022-01-01 and counts it', () => {
    const { rolls, fenced } = shownRolls(ES)
    expect(fenced).toBe(1)
    expect(rolls.map((r) => r.date)).toEqual(['2020-03-12', '2021-03-01', '2021-03-19', '2021-09-17'])
    expect(shownRolls(NQ)).toEqual({ rolls: NQ.rolls, fenced: 0 })
  })
})

describe('the calendar strip', () => {
  it('offers the in-sample years, oldest first', () => {
    const years = yearsOf(makeCalendar())
    expect(years[0]).toBe('2010')
    expect(years.at(-1)).toBe('2021')
    expect(years).toHaveLength(12)
  })

  it('puts each roll of the chosen year in its month, numbered rows in the API order', () => {
    const rows = stripRows(makeCalendar(), '2021')
    expect(rows.map((r) => [r.n, r.root])).toEqual([[STRIP_FIRST_NUMBER, 'ES'], [STRIP_FIRST_NUMBER + 1, 'NQ'], [STRIP_FIRST_NUMBER + 2, 'CL']])
    const [es, nq, cl] = rows
    expect(es!.cells).toHaveLength(12)
    expect(es!.cells[MAR]).toEqual({ count: 2, gapPct: null, dates: ['2021-03-01', '2021-03-19'] })
    expect(cellText(es!.cells[MAR]!, '2021')).toBe('2x')
    expect(cellText(es!.cells[SEP]!, '2021')).toBe('--')
    expect(cellText(nq!.cells[JUN]!, '2021')).toBe('-0.002%')
    expect(cellText(cl!.cells[SEP + 3]!, '2021')).toBe('+0.271%')
    expect(cellText(cl!.cells[0]!, '2021')).toBe('')
    expect(es!.total).toBe(3)
  })

  it('counts rolls per calendar month over all years, never the one past the fence (born failing)', () => {
    const [es] = stripRows(makeCalendar(), 'all')
    // With the 2022-03 roll leaking through, March would read 4.
    expect(es!.cells[MAR]!.count).toBe(3)
    expect(cellText(es!.cells[MAR]!, 'all')).toBe('3')
    expect(cellText(es!.cells[0]!, 'all')).toBe('')
    expect(es!.total).toBe(4)
  })

  it('names each cell for assistive technology', () => {
    const [es, nq] = stripRows(makeCalendar(), '2021')
    expect(cellLabel(nq!, JUN, '2021')).toBe('NQ Jun 2021: roll on 2021-06-11, gap -0.002%')
    expect(cellLabel(es!, MAR, '2021')).toBe('ES Mar 2021: 2 rolls (2021-03-01, 2021-03-19)')
    expect(cellLabel(es!, 0, '2021')).toBe('ES Jan 2021: no roll')
    const [esAll] = stripRows(makeCalendar(), 'all')
    expect(cellLabel(esAll!, MAR, 'all')).toBe('ES Mar, all years: 3 rolls')
  })

  it('exports the strip as shown', () => {
    const { text, rows } = stripCsv(stripRows(makeCalendar(), '2021'), '2021')
    const lines = text.split('\r\n')
    expect(rows).toBe(3)
    expect(lines[0]).toBe('ticker,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,rolls')
    expect(lines[1]).toBe('ES,,,2x,,,,,,,,,,3')
    expect(lines[2]).toBe('NQ,,,,,,-0.0016381894729944465,,,-0.03029493005435267,,,0.025133627117508085,3')
  })
})

describe('numbers', () => {
  it('formats signed percent gaps with three decimals and points at the tick precision', () => {
    expect(formatPct(0.025133627117508085)).toBe('+0.025%')
    expect(formatPct(-0.03029493005435267)).toBe('-0.030%')
    expect(formatPct(null)).toBe('--')
    expect(formatPts(3.75, 0.25)).toBe('+3.75')
    expect(formatPts(0.010000000000000009, 0.01)).toBe('+0.01')
    expect(formatPts(-0.015625, 1 / 64)).toBe('-0.015625')
    expect(formatPts(null, 0.25)).toBe('--')
  })

  it('summarises a market and states the QA report comparison honestly', () => {
    expect(summaryText(NQ)).toBe('NQ: 3 rolls from 2021-06-11 to 2021-12-13; mean absolute gap 0.019%, largest 0.030%.')
    expect(qaText(NQ)).toBe('QA report count 3: matches.')
    expect(qaText(ES)).toBe('QA report count 46: differs from the 5 rolls shown.')
    expect(qaText(CL)).toBe('QA report count: not available.')
  })
})

describe('rounding', () => {
  it('rounds with the screens one rule (toDecimal), not toFixed', () => {
    expect(formatPct(1.0005)).toBe('+1.001%') // 1.00049999... in binary: toFixed(3) prints 1.000
    expect(formatPct(-1.0005)).toBe('-1.001%')
    expect(formatPts(0.735, 0.01)).toBe('+0.74') // toFixed(2) prints 0.73
  })
})

describe('the gap chart input', () => {
  it('places each shown roll on a time axis that ends at the fence', () => {
    const chart = gapChart(CL)
    expect(chart.points).toHaveLength(3)
    expect(chart.points.every((p) => p.x > 0 && p.x < 1)).toBe(true)
    expect(chart.points.map((p) => p.value)).toEqual(CL.rolls.map((r) => r.gap_pct))
    expect(chart.name).toBe('CL roll gap in percent, 3 rolls')
    expect(chart.label).toBe('CL roll gap in percent, 3 rolls: from 2021-06-11 to 2021-12-13; smallest -0.098% on 2021-06-11, largest +0.271% on 2021-12-13.')
    expect(chart.table.rows).toHaveLength(3)
    expect(chart.table.rows[2]).toEqual({ date: '2021-12-13', gapPts: '+0.19', gapPct: '+0.271%' })
  })

  it('leaves out a missing gap and anything past the fence', () => {
    const chart = gapChart(ES)
    expect(chart.points.map((p) => p.date)).toEqual(['2020-03-12', '2021-03-01', '2021-03-19'])
    expect(chart.table.rows).toHaveLength(4)
    expect(chart.fenced).toBe(1)
  })

  it('says so when a market has no roll', () => {
    const chart = gapChart({ ...NQ, rolls: [], count: 0 })
    expect(chart.points).toEqual([])
    expect(chart.label).toBe('NQ: no roll in the served sample')
  })
})

describe('export', () => {
  it('saves the shown rolls with full precision', () => {
    const { text, rows } = rollsCsv(ES)
    const lines = text.split('\r\n')
    expect(rows).toBe(4)
    expect(lines[0]).toBe('symbol,date,last_date,from,to,close_before,gap_pts,gap_pct')
    expect(lines[1]).toBe('ES.V.0,2020-03-12,2020-03-11,736,737,2480.5,1.5,0.060471')
    expect(lines.some((l) => l.includes('2022-'))).toBe(false)
  })
})
