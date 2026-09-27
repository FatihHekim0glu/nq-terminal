// The RUNS and RUN copy under the rules of UI_SPEC section 10 (the same checker as copyRules.test.ts),
// plus the honesty tags of UI_SPEC section 6 word for word.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from './copyRules'
import * as copy from './runs'

describe('RUNS and RUN copy (UI_SPEC section 10)', () => {
  it('has no em or en dashes and no US spellings', () => {
    expect(findCopyViolations(copy)).toEqual([])
  })

  it('carries the honesty tags of UI_SPEC section 6 verbatim', () => {
    expect(copy.RUN_TAGS.probe).toBe('[PROBE: never a result]')
    expect(copy.RUN_TAGS.unusableBalance).toBe('[UNUSABLE: BALANCE]')
    expect(copy.RUN_TAGS.anchor).toBe('[ANCHOR]')
  })
})
