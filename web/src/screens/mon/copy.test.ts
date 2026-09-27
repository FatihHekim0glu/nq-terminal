// The market screens' copy under the shared house rules (UI_SPEC section 10): no em or en dashes and no
// US spellings. copyRules.test.ts checks src/copy/*.ts only, and this copy sits with the screens.
import { describe, expect, it } from 'vitest'
import { findCopyViolations } from '../../copy/copyRules'
import * as corrCopy from '../corr/copy'
import * as monCopy from './copy'

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
