import { describe, expect, it } from 'vitest'
import {
  MISSING,
  decimalsForUnit,
  formatNumber,
  formatShare,
  formatValue,
  isPercentUnit,
  scaleSeries,
  shortUnit,
  toDisplay,
} from './tearFormat'

describe('units the API sends (ANALYTICS_CATALOG C1, ARCHITECTURE section 4)', () => {
  it('treats every "fraction ..." unit as a percentage and nothing else', () => {
    expect(isPercentUnit('fraction of the account')).toBe(true)
    expect(isPercentUnit('fraction per year, compounded')).toBe(true)
    expect(isPercentUnit('fraction of K below the running peak')).toBe(true)
    expect(isPercentUnit('fraction below the running peak, compounded')).toBe(true)
    expect(isPercentUnit('% per year')).toBe(false)
    expect(isPercentUnit('USD per session, one NQ contract')).toBe(false)
    expect(isPercentUnit('ratio, annualised (P = 252)')).toBe(false)
    expect(isPercentUnit('notional over equity')).toBe(false)
  })

  it('scales a fraction by 100 and leaves every other unit alone', () => {
    expect(toDisplay(-0.0035802800000001023, 'fraction of the account')).toBeCloseTo(-0.35802800000001023, 12)
    expect(toDisplay(3.47270285188713, '% per year')).toBe(3.47270285188713)
    expect(toDisplay(-124.48, 'below the running peak of the cumulative sum, USD per session, one NQ contract')).toBe(-124.48)
    expect(toDisplay(null, 'fraction of the account')).toBeNull()
    expect(toDisplay(Number.NaN, 'ratio')).toBeNull()
    expect(toDisplay(Number.POSITIVE_INFINITY, 'ratio')).toBeNull()
  })

  it('shortens the API unit for the face of a tile; the popover keeps the full text', () => {
    expect(shortUnit('fraction of the account per year')).toBe('%')
    expect(shortUnit('% per year')).toBe('%')
    expect(shortUnit('ratio, annualised (P = 252)')).toBe('ratio')
    expect(shortUnit('ratio')).toBe('ratio')
    expect(shortUnit('probability that the Sharpe exceeds 0')).toBe('probability')
    expect(shortUnit('t statistic (smallest over Newey-West lags 5, 21)')).toBe('')
    expect(shortUnit('sessions')).toBe('sessions')
    expect(shortUnit('months')).toBe('months')
    expect(shortUnit('sd of USD per session, one NQ contract times sqrt(252)')).toBe('USD')
    expect(shortUnit('USD per session, one NQ contract')).toBe('USD')
  })

  it('picks fixed decimals per unit', () => {
    expect(decimalsForUnit('fraction of the account')).toBe(2)
    expect(decimalsForUnit('USD, compounded from the starting balance K')).toBe(2)
    expect(decimalsForUnit('multiple of K (K = 1), arithmetic')).toBe(4)
    expect(decimalsForUnit('probability that the Sharpe exceeds 0')).toBe(3)
    expect(decimalsForUnit('sessions')).toBe(0)
    expect(decimalsForUnit('ratio, annualised (P = 252)')).toBe(2)
  })
})

describe('number formatting (look spec 3.4)', () => {
  it('uses fixed decimals, an ASCII minus, and -- for a missing value', () => {
    expect(formatNumber(-5.818080911225993, 2)).toBe('-5.82')
    expect(formatNumber(0.004, 2)).toBe('0.00')
    expect(formatNumber(-0.004, 2)).toBe('0.00')
    expect(formatNumber(null, 2)).toBe(MISSING)
    expect(formatNumber(Number.NaN, 2)).toBe(MISSING)
    expect(MISSING).toBe('--')
  })

  it('adds + only when asked, and thousands separators only when asked', () => {
    expect(formatNumber(1053.12, 2, { signed: true })).toBe('+1053.12')
    expect(formatNumber(1053.12, 2, { signed: true, thousands: true })).toBe('+1,053.12')
    expect(formatNumber(-3580.28, 2, { thousands: true })).toBe('-3,580.28')
    expect(formatNumber(1000000, 0, { thousands: true })).toBe('1,000,000')
    expect(formatNumber(999.5, 0, { thousands: true })).toBe('1,000')
    expect(formatNumber(0, 2, { signed: true })).toBe('0.00')
  })

  it('formats a value in its unit: fractions as percentages, % attached with no space', () => {
    expect(formatValue(-0.0035802800000001023, 'fraction of the account', 2, true)).toBe('-0.36%')
    expect(formatValue(0.0035, 'fraction of the account', 2, true)).toBe('+0.35%')
    expect(formatValue(3.47270285188713, '% per year', 2, true)).toBe('+3.47%')
    expect(formatValue(-124.48, 'USD per session, one NQ contract', 2)).toBe('-124.48 USD')
    expect(formatValue(0.9999950687482119, 'probability that the Sharpe exceeds 0', 3)).toBe('1.000')
    expect(formatValue(null, 'fraction of the account', 2)).toBe(MISSING)
  })

  it('formats a share (hit rate, positive months) as a percentage', () => {
    expect(formatShare(0.2222222222222222)).toBe('22.22%')
    expect(formatShare(0.5)).toBe('50.00%')
    expect(formatShare(null)).toBe(MISSING)
  })
})

describe('series scaling for the charts', () => {
  it('returns the API array itself when no scaling is needed, so a chart is not rebuilt', () => {
    const values = [1, 2, null]
    expect(scaleSeries(values, 'USD, compounded from the starting balance K')).toBe(values)
  })

  it('scales a fraction series to percent and keeps gaps as null', () => {
    expect(scaleSeries([0, -0.0125, null], 'fraction below the running peak, compounded')).toEqual([0, -1.25, null])
  })
})
