// reg.css follows the look spec's style rules (3, 4.12, 8.5 d and e): colours only through tokens,
// square corners, and no transition on anything.
import { describe, expect, it } from 'vitest'
import { readText } from '../../grids/testing'

const css = readText(new URL('./reg.css', import.meta.url))

describe('reg.css', () => {
  it('writes no colour literal', () => {
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('has no transition or animation and no rounded corner', () => {
    expect(css).not.toMatch(/\btransition\b|\banimation\b/)
    expect(css).not.toMatch(/border-radius:(?!\s*0\b)/)
  })

  it('takes every var() from the token names', () => {
    const tokens = readText(new URL('../../theme/tokens.css', import.meta.url))
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!)
    const missing = [...new Set(used)].filter((name) => !tokens.includes(`${name}:`))
    expect(missing).toEqual([])
  })
})

// REG's sealed confirmations and accepted amendments (finding 10, axe scrollable-region-focusable on HOME):
// both scroll wrappers render whole and let the panel body scroll them (grid.css nqt-grid-scroll--panel),
// so no inner scroller ever needs its own Tab stop under the roving model.
describe('.reg-confirm-scroll: the panel body scrolls it whole, never an inner scroller', () => {
  it('is never given a max-height, anywhere in the file, container blocks included', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
      if (!selectors.includes('.reg-confirm-scroll')) continue
      expect(m[2] ?? '', `rule for .reg-confirm-scroll: ${m[2]}`).not.toMatch(/max-height/)
    }
  })
})
