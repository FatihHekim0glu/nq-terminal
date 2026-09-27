// DQ model (RI4, RI5): calendar layout, per-year counts, the summary, the flagged days and the CSV. Pure functions.
import { describe, expect, it } from 'vitest'
import { calendarLayout, countsText, flaggedCsv, flaggedDays, heatSummary, keyStep, offCalendarDays, offCalendarText, stateLetter, yearCounts, yearTable } from './model'
import type { DqCounts, DqDay } from './types'

const DAYS: DqDay[] = [
  { date: '2011-01-03', state: 'vendor', reason: null }, // Monday
  { date: '2011-01-04', state: 'rebuilt', reason: 'rebuilt from trade prints' },
  { date: '2011-01-10', state: 'unrepairable', reason: 'RepairError: x' }, // next Monday
  { date: '2012-01-02', state: 'gated_out', reason: 'vendor flags: c6' },
  { date: '2012-01-06', state: 'rejected', reason: 'gate: no bars' },
]

describe('calendarLayout', () => {
  it('puts each session in its year block by week column and weekday row', () => {
    const years = calendarLayout(DAYS)
    expect(years.map((y) => y.year)).toEqual([2011, 2012])
    const [a, b, c] = years[0]!.cells
    expect([a!.row, a!.col]).toEqual([0, b!.col])
    expect(b!.row).toBe(1)
    expect(c!.col).toBe(a!.col + 1)
    expect(c!.row).toBe(0)
  })

  it('leaves a weekend or unreadable day off the calendar instead of throwing, and names it', () => {
    const odd: DqDay[] = [{ date: '2011-01-08', state: 'vendor', reason: null }, { date: '2011-13-40', state: 'rebuilt', reason: null }]
    const years = calendarLayout([...DAYS, ...odd])
    expect(years.flatMap((y) => y.cells).map((c) => c.day.date)).toEqual(DAYS.map((d) => d.date))
    expect(offCalendarDays([...DAYS, ...odd]).map((d) => d.date)).toEqual(['2011-01-08', '2011-13-40'])
    expect(offCalendarDays(DAYS)).toEqual([])
    expect(offCalendarText(odd)).toBe('2 recorded days are not weekday sessions and are left off the calendar: 2011-01-08, 2011-13-40.')
  })

  it('does not count days after the fence as off the calendar', () => {
    expect(offCalendarDays([{ date: '2022-01-08', state: 'vendor', reason: null }], '2021-12-31')).toEqual([])
  })

  it('drops days after the fence', () => {
    const years = calendarLayout([...DAYS, { date: '2022-01-03', state: 'vendor', reason: null }], '2021-12-31')
    expect(years.map((y) => y.year)).toEqual([2011, 2012])
  })
})

describe('counts', () => {
  it('counts each state per year', () => {
    const rows = yearCounts(DAYS)
    expect(rows).toEqual([
      { year: 2011, vendor: 1, gated_out: 0, rejected: 0, rebuilt: 1, unrepairable: 1, sessions: 3 },
      { year: 2012, vendor: 0, gated_out: 1, rejected: 1, rebuilt: 0, unrepairable: 0, sessions: 2 },
    ])
  })

  it('names every non-zero state in the summary', () => {
    const counts: DqCounts = { vendor: 1, gated_out: 1, rejected: 1, rebuilt: 1, unrepairable: 1, sessions: 5 }
    expect(countsText({ ...counts, rejected: 0 })).toBe('Vendor 1, Gated out 1, Rebuilt 1, Unrepairable 1')
    expect(heatSummary('GC.V.0', DAYS, counts)).toBe(
      'GC.V.0 data quality calendar, 2011-01-03 to 2012-01-06: 5 sessions; Vendor 1, Gated out 1, Rejected 1, Rebuilt 1, Unrepairable 1.',
    )
  })

  it('builds the table view by year with a total row', () => {
    const t = yearTable('GC.V.0', DAYS)
    expect(t.rows.map((r) => r.year)).toEqual(['2011', '2012', 'Total'])
    expect(t.rows[2]!.sessions).toBe(5)
    expect(t.columns.map((c) => c.key)).toEqual(['year', 'vendor', 'gated_out', 'rejected', 'rebuilt', 'unrepairable', 'sessions'])
  })
})

describe('flagged days', () => {
  it('lists every non-vendor day, newest first', () => {
    expect(flaggedDays(DAYS).map((d) => d.date)).toEqual(['2012-01-06', '2012-01-02', '2011-01-10', '2011-01-04'])
  })

  it('writes a CSV with quoted reasons', () => {
    const csv = flaggedCsv([{ date: '2011-01-04', state: 'rebuilt', reason: 'a, "b"' }])
    expect(csv.split(/\r?\n/)[0]).toBe('date,state,reason')
    expect(csv).toContain('2011-01-04,Rebuilt,"a, ""b"""')
  })

  it('marks every state but vendor with a letter, so colour is never the only cue', () => {
    expect(['vendor', 'gated_out', 'rejected', 'rebuilt', 'unrepairable'].map((s) => stateLetter(s as DqDay['state']))).toEqual(['', 'G', 'R', 'B', 'U'])
  })
})

describe('keyStep (keyboard walk over the calendar)', () => {
  const dates = ['2011-01-03', '2011-01-04', '2011-01-05', '2011-01-10', '2011-01-11']
  it('moves one session with the arrows and jumps with Home and End', () => {
    expect(keyStep(dates, null, 'ArrowRight')).toBe('2011-01-03')
    expect(keyStep(dates, '2011-01-03', 'ArrowRight')).toBe('2011-01-04')
    expect(keyStep(dates, '2011-01-04', 'ArrowDown')).toBe('2011-01-05')
    expect(keyStep(dates, '2011-01-05', 'ArrowLeft')).toBe('2011-01-04')
    expect(keyStep(dates, '2011-01-04', 'ArrowUp')).toBe('2011-01-03')
    expect(keyStep(dates, '2011-01-03', 'ArrowLeft')).toBe('2011-01-03')
    expect(keyStep(dates, '2011-01-11', 'ArrowRight')).toBe('2011-01-11')
    expect(keyStep(dates, '2011-01-04', 'Home')).toBe('2011-01-03')
    expect(keyStep(dates, '2011-01-04', 'End')).toBe('2011-01-11')
  })
  it('moves a week with Page Up and Page Down, to the nearest session', () => {
    expect(keyStep(dates, '2011-01-03', 'PageDown')).toBe('2011-01-10')
    expect(keyStep(dates, '2011-01-05', 'PageDown')).toBe('2011-01-11')
    expect(keyStep(dates, '2011-01-11', 'PageUp')).toBe('2011-01-04')
  })
  it('ignores other keys and an empty calendar', () => {
    expect(keyStep(dates, '2011-01-04', 'a')).toBeNull()
    expect(keyStep([], null, 'ArrowRight')).toBeNull()
  })
})
