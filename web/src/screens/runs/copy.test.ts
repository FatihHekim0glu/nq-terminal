// The copy rules of UI_SPEC section 10 over the RUNS and RUN copy, which lives beside the screens
// (src/copy/copyRules.test.ts globs src/copy only). Same checker, same born-failing cases there.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import * as copy from './copy'

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
