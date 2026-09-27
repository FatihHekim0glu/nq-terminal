// tiles.css read as text (look spec 2, 4.5, 7.1, 7.3 and 8.5): tokens only, square corners, hard-cut
// states, 24px targets for every control (decision D1, WCAG 2.5.8), and the card and tile colours.
import { describe, expect, it } from 'vitest'
import { readText } from '../grids/testing'

const css = readText(new URL('./tiles.css', import.meta.url))
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

function rule(selector: string): string {
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((m[1] ?? '').split(',').map((s) => s.trim()).includes(selector)) return m[2] ?? ''
  }
  throw new Error(`no rule for ${selector}`)
}

describe('tiles.css', () => {
  it('uses tokens for every colour', () => {
    expect(bare.length).toBeGreaterThan(200)
    expect(bare).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(bare).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/)
  })

  it('has square corners and no transitions', () => {
    for (const m of bare.matchAll(/border-radius\s*:\s*([^;]+);/g)) expect(m[1]?.trim()).toBe('0')
    expect(bare).not.toMatch(/transition/)
  })

  it('keeps the KPI tile and the card buttons at least 24px', () => {
    for (const sel of ['.kpi-tile', '.nqt-card-btn']) {
      const decls = rule(sel)
      expect(Number(/min-height:\s*(\d+)px/.exec(decls)?.[1] ?? 0), sel).toBeGreaterThanOrEqual(24)
      expect(Number(/min-width:\s*(\d+)px/.exec(decls)?.[1] ?? 0), sel).toBeGreaterThanOrEqual(24)
    }
  })

  it('draws KPI tiles on --raised with a white value at --fs-kpi and a muted label (7.1)', () => {
    expect(rule('.kpi-tile')).toMatch(/background:\s*var\(--raised\)/)
    expect(rule('.kpi-value')).toMatch(/color:\s*var\(--white\)/)
    expect(rule('.kpi-value')).toMatch(/font-size:\s*var\(--fs-kpi\)/)
    expect(rule('.kpi-label')).toMatch(/color:\s*var\(--muted\)/)
    expect(rule('.kpi-row')).toMatch(/gap:\s*8px/)
  })

  it('draws cards with a --box-border edge, a 20px --raised title band in white bold, amber labels (7.3)', () => {
    expect(rule('.nqt-card')).toMatch(/border:\s*1px solid var\(--box-border\)/)
    const title = rule('.nqt-card-title')
    expect(title).toMatch(/background:\s*var\(--raised\)/)
    expect(title).toMatch(/color:\s*var\(--white\)/)
    expect(title).toMatch(/font-weight:\s*700/)
    expect(title).toMatch(/height:\s*var\(--row-h\)/)
    expect(rule('.nqt-card-rows dt')).toMatch(/color:\s*var\(--data\)/)
    expect(rule('.nqt-card-rows dd')).toMatch(/text-align:\s*right/)
  })

  it('shows keyboard focus as the 2px white ring', () => {
    expect(rule('.kpi-tile:focus-visible')).toMatch(/outline:\s*2px solid var\(--focus\)/)
    expect(rule('.nqt-card-btn:focus-visible')).toMatch(/outline:\s*2px solid var\(--focus\)/)
  })
})
