import { describe, expect, it } from 'vitest'
import { fixed, formatP, isoDate, signed } from './format'

describe('number formats for the ECharts set', () => {
  it('prints signed values with an explicit sign and no negative zero', () => {
    expect(signed(1.454, 2)).toBe('+1.45')
    expect(signed(-6.8249, 2)).toBe('-6.82')
    expect(signed(0, 2)).toBe('0.00')
    expect(signed(-0.001, 2)).toBe('0.00')
    expect(signed(0.004, 2)).toBe('0.00')
  })

  it('prints fixed values without negative zero', () => {
    expect(fixed(-0.0004, 3)).toBe('0.000')
    expect(fixed(2.5, 1)).toBe('2.5')
    expect(fixed(-2.5, 1)).toBe('-2.5')
  })

  it('groups thousands, so a cost ladder in USD reads as the waterfall beside it does', () => {
    expect(signed(1609172.86, 2)).toBe('+1,609,172.86')
    expect(fixed(-10354.14, 2)).toBe('-10,354.14')
    expect(fixed(999.5, 1)).toBe('999.5')
  })

  it('prints p-values to four decimals with a floor', () => {
    expect(formatP(0.04567)).toBe('0.0457')
    expect(formatP(0.00003)).toBe('<0.0001')
    expect(formatP(1)).toBe('1.0000')
  })

  it('rounds decimal ties half away from zero like every other screen (born failing: toFixed gave -0.73)', () => {
    // the SV6 cone's p25 at step 1 for volmanaged_v0 is -0.735%: format/decimal.ts toDecimal prints -0.74
    expect(signed(-0.735, 2)).toBe('-0.74')
    expect(fixed(7759147.975, 2)).toBe('7,759,147.98')
    expect(signed(0.125, 2)).toBe('+0.13')
    expect(signed(-0.004, 2)).toBe('0.00')
    expect(formatP(0.00125)).toBe('0.0013')
  })

  it('prints epoch seconds as an ISO date', () => {
    expect(isoDate(Date.UTC(2021, 11, 31) / 1000)).toBe('2021-12-31')
  })
})
