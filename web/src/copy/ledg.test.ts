// The LEDG copy under the rules of UI_SPEC section 10 (copyRules.test.ts checks every copy module too),
// plus the empty state the spec names.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from './copyRules'
import * as copy from './ledg'

describe('LEDG copy (UI_SPEC section 10)', () => {
  it('has no em or en dashes and no US spellings', () => {
    expect(findCopyViolations(copy)).toEqual([])
  })

  it('names the expected file in the empty state (UI_SPEC section 7)', () => {
    expect(copy.LEDG.missing).toContain('results/ledger.csv')
  })
})
