// ROLL strip colours, checked as text (look spec 2.1 and 8.2): a roll cell sits on the header grey (--th-bg), where
// the plain down red (#FF2C4A, 4.27:1) fails 4.5:1, so the strip switches down text to --c-down-raised as the grid
// does on its header and band rows.
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../theme/contrast'
import css from './roll.css?raw'

const SPEC = { 'c-down': '#FF2C4A', 'c-down-raised': '#FF5566', 'th-bg': '#232323' } as const

function rule(selector: string): string {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

describe('roll strip', () => {
  it('puts roll cells on the header grey', () => {
    expect(rule('.roll-strip .roll-on')).toMatch(/background:\s*var\(--th-bg\)/)
  })

  it('switches down text on a roll cell to the raised red, which passes 4.5:1 there', () => {
    expect(rule('.roll-strip .roll-on')).toMatch(/--c-down:\s*var\(--c-down-raised\)/)
    expect(contrastRatio(SPEC['c-down-raised'], SPEC['th-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('born failing: the plain down red on the header grey is below 4.5:1', () => {
    expect(contrastRatio(SPEC['c-down'], SPEC['th-bg'])).toBeLessThan(4.5)
  })
})
