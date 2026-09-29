// U17: the CF moments line's sigma is a population value at ddof 0 (the Volatility tile elsewhere uses
// ddof 1), so it says so. Tested through fillCopy directly (copy/workspace.ts, an existing stable
// utility) rather than tearP1Model.ts's cfMoments, which this worker does not own.
import { describe, expect, it } from 'vitest'
import { fillCopy } from './workspace'
import { TEAR_P1 } from './tearP1'

describe('TEAR_P1.cf.moments sigma labelled for U17', () => {
  it('names the ddof 0 convention beside the sigma value', () => {
    const line = fillCopy(TEAR_P1.cf.moments, { mean: '1.0000', sigma: '2.0000', skew: '-0.39', kurt: '-0.41' })
    expect(line).toBe('Population moments: mean 1.0000, sigma (ddof 0) 2.0000, skew -0.39, excess kurtosis -0.41.')
  })
})
