// The market screens' copy under the shared house rules (UI_SPEC section 10): no em or en dashes and no
// US spellings, with a planted dash to show the check fails, and one name per universe contract.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from './copyRules'
import * as corrCopy from './corr'
import * as monCopy from './market'

describe('MON and CORR copy', () => {
  it('has no em or en dashes and no US spellings', () => {
    const violations = [
      ...findCopyViolations(monCopy).map((v) => `mon ${v.path}: ${v.rule}`),
      ...findCopyViolations(corrCopy).map((v) => `corr ${v.path}: ${v.rule}`),
    ]
    expect(violations).toEqual([])
  })

  it('born failing: the same check catches a dash planted in copy of this shape', () => {
    const planted = { ...monCopy, MON: { ...monCopy.MON, title: `Futures monitor ${String.fromCharCode(0x2014)} 27F` } }
    expect(findCopyViolations(planted).map((v) => v.rule)).toContain('em dash')
  })

  it('names every contract of the universe', () => {
    expect(Object.keys(monCopy.CONTRACT_NAMES)).toHaveLength(27)
  })
})
