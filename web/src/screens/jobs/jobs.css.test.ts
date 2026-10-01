// JOBS status colours inside the selected row, checked as text (WCAG 1.4.3). The selected row takes --sel-bg
// (#0C2B4A), where the plain down red (#FF2C4A) is 3.91:1, so the row switches down text to --c-down-raised as
// the grid does on tr[aria-selected]. The up green and the warn yellow already pass there.
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../theme/contrast'
import css from './jobs.css?raw'

const SPEC = {
  'sel-bg': '#0C2B4A',
  'c-up': '#51EE6C',
  'c-down': '#FF2C4A',
  'c-down-raised': '#FF5566',
  warn: '#FFE100',
} as const

function rule(selector: string): string {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

describe('jobs selected row colours', () => {
  it('fills the selected row with the selection colour', () => {
    expect(rule('.live-table tbody tr.jobs-selected td')).toMatch(/background:\s*var\(--sel-bg\)/)
  })

  it('switches down text in the selected row to the raised red, which passes 4.5:1 there', () => {
    expect(rule('.live-table tbody tr.jobs-selected')).toMatch(/--c-down:\s*var\(--c-down-raised\)\s*;/)
    expect(rule('.jobs-status.jobs-down')).toMatch(/color:\s*var\(--c-down\)/)
    expect(contrastRatio(SPEC['c-down-raised'], SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps up and warn text above 4.5:1 on the selected fill', () => {
    expect(rule('.jobs-status.jobs-up')).toMatch(/color:\s*var\(--c-up\)/)
    expect(rule('.jobs-status.jobs-warn')).toMatch(/color:\s*var\(--warn\)/)
    expect(contrastRatio(SPEC['c-up'], SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(SPEC.warn, SPEC['sel-bg'])).toBeGreaterThanOrEqual(4.5)
  })

  it('born failing: the plain down red on the selected fill is below 4.5:1', () => {
    expect(contrastRatio(SPEC['c-down'], SPEC['sel-bg'])).toBeLessThan(4.5)
  })
})
