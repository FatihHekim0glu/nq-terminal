// The copy rules of UI_SPEC section 10 over the LEDG copy, which lives beside the screen
// (src/copy/copyRules.test.ts globs src/copy only).
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import * as copy from './copy'

describe('LEDG copy (UI_SPEC section 10)', () => {
  it('has no em or en dashes and no US spellings', () => {
    expect(findCopyViolations(copy)).toEqual([])
  })

  it('names the expected file in the empty state (UI_SPEC section 7)', () => {
    expect(copy.LEDG.missing).toContain('results/ledger.csv')
  })
})
