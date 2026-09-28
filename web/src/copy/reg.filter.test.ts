// U25 regression: the REG filter field's visible placeholder used to read '<Enter filter>', naming what
// it filters only in the aria-label ('Filter hypotheses by name'), so typing a verdict word such as PASS
// found nothing and nothing visible said why. The placeholder now names the field itself.
import { describe, expect, it } from 'vitest'
import { REG } from './reg'

describe('REG.filterPlaceholder (U25): names what the filter matches, same as the field label', () => {
  it('says the filter is by name, not just "filter"', () => {
    expect(REG.filterPlaceholder.toLowerCase()).toContain('name')
  })

  it('is angle-bracketed placeholder text, like every other field placeholder in this module', () => {
    expect(REG.filterPlaceholder).toMatch(/^<.*>$/)
  })

  it('agrees with the field label: both say the filter matches by name', () => {
    expect(REG.filterLabel.toLowerCase()).toContain('name')
    expect(REG.filterPlaceholder.toLowerCase()).toContain('name')
  })
})
