// New York wall-clock helpers for the Countdown and the journal (the book decides at 15:55:05 ET).
// Checked across both 2021 daylight-saving changes, since a fixed offset would be wrong for half the year.
import { describe, expect, it } from 'vitest'
import { daysBetween, etClock, etEpochMs, formatDuration } from './etTime'

describe('etEpochMs', () => {
  it('reads an ET wall time in winter (EST, UTC-5) and in summer (EDT, UTC-4)', () => {
    expect(new Date(etEpochMs('2021-11-10', '15:55:05')).toISOString()).toBe('2021-11-10T20:55:05.000Z')
    expect(new Date(etEpochMs('2021-07-14', '15:55:05')).toISOString()).toBe('2021-07-14T19:55:05.000Z')
  })

  it('is right on the days the clocks change (2021-03-14 and 2021-11-07)', () => {
    expect(new Date(etEpochMs('2021-03-14', '15:55:05')).toISOString()).toBe('2021-03-14T19:55:05.000Z')
    expect(new Date(etEpochMs('2021-11-07', '15:55:05')).toISOString()).toBe('2021-11-07T20:55:05.000Z')
  })

  it('refuses a malformed date or time', () => {
    expect(() => etEpochMs('2021-13-40', '15:55:05')).toThrow()
    expect(() => etEpochMs('2021-11-10', '3pm')).toThrow()
  })
})

describe('etClock', () => {
  it('prints the ET wall time of an epoch second', () => {
    expect(etClock(1636577705)).toBe('15:55:05')
    expect(etClock(1626292505)).toBe('15:55:05')
  })

  it('prints -- for a missing or bad value', () => {
    expect(etClock(null)).toBe('--')
    expect(etClock(Number.NaN)).toBe('--')
  })
})

describe('formatDuration', () => {
  it('prints hours, minutes and seconds with two digits each', () => {
    expect(formatDuration(0)).toBe('00:00:00')
    expect(formatDuration(3_723_000)).toBe('01:02:03')
    expect(formatDuration(26 * 3_600_000)).toBe('26:00:00')
  })

  it('rounds partial seconds up, so the count never shows zero before the moment', () => {
    expect(formatDuration(500)).toBe('00:00:01')
  })
})

describe('daysBetween', () => {
  it('counts calendar days between two ISO dates', () => {
    expect(daysBetween('2021-11-10', '2021-12-07')).toBe(27)
    expect(daysBetween('2021-12-07', '2021-12-07')).toBe(0)
    expect(daysBetween('2021-12-08', '2021-12-07')).toBe(-1)
  })
})
