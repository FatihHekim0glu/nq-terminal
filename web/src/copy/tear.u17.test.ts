// U17: RET's Summary Skew is bias-corrected (a different formula from the CF moments' population skew
// in tearP1.ts), so it says so. Kurtosis there is already 'Excess kurtosis' (TEAR_RET.rows.excessKurtosis),
// distinct enough from MT's raw Kurtosis, so it is not touched.
import { describe, expect, it } from 'vitest'
import { TEAR_RET } from './tear'

describe('TEAR_RET.rows.skew labelled for U17', () => {
  it("names the bias-corrected convention (the CF moments' skew is a population value)", () => {
    expect(TEAR_RET.rows.skew).toBe('Skew (bias-corrected)')
  })

  it('leaves excess kurtosis as is: already distinct from a raw convention', () => {
    expect(TEAR_RET.rows.excessKurtosis).toBe('Excess kurtosis')
  })
})
