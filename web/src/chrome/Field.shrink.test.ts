// G09: the wrapped header rows (the parameter row, the RUN chip strip and the ledger) each declare a
// min-height, and a flex item's default flex-shrink of 1 let a squeezed column (a HOME quadrant, where
// the chart's 240px floor takes the room first) shrink them below their wrapped content: the chip strip
// and ledger overprinted, the focused Copy button was covered (WCAG 2.4.11) and the OOS read counts
// slid under the Openings card. flex-shrink 0 makes the chart area, not the rows, take the squeeze.
import { describe, expect, it } from 'vitest'
import fieldCss from './Field.css?raw'
import gpCss from '../screens/gp/GpScreen.css?raw'
import oosCss from '../screens/oos/oos.css?raw'
import runsCss from '../screens/runs/runs.css?raw'

/** Every declaration block for one exact selector (comment-stripped), in source order. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) out.push(m[2] ?? '')
  }
  return out
}

/** True when the selector's own rule stops the item shrinking: `flex: 0 0 auto` or `flex-shrink: 0`. */
function noShrink(css: string, selector: string): boolean {
  return blocks(css, selector).some((b) => /\bflex\s*:\s*0\s+0\s+auto\b/.test(b) || /\bflex-shrink\s*:\s*0\b/.test(b))
}

describe('G09: wrapped header rows never shrink below their content', () => {
  it('reads the sheets', () => {
    for (const css of [fieldCss, gpCss, oosCss, runsCss]) expect(css.length).toBeGreaterThan(100)
  })

  it('.param-row (the shared parameter row) declares flex-shrink 0', () => {
    expect(noShrink(fieldCss, '.param-row')).toBe(true)
  })

  it('.run-strip (the RUN chip strip) declares flex-shrink 0', () => {
    expect(noShrink(runsCss, '.run-strip')).toBe(true)
  })

  it('.run-ledger declares flex-shrink 0', () => {
    expect(noShrink(runsCss, '.run-ledger')).toBe(true)
  })

  it('keeps the min-height each row already had (the fix adds a floor, it does not remove one)', () => {
    expect(blocks(fieldCss, '.param-row').join(';')).toMatch(/min-height\s*:\s*26px/)
    expect(blocks(runsCss, '.run-strip').join(';')).toMatch(/min-height\s*:\s*var\(--param-h\)/)
    expect(blocks(runsCss, '.run-ledger').join(';')).toMatch(/min-height\s*:\s*var\(--param-h\)/)
  })

  it('needs no GP-local override any more: the shared rule carries it', () => {
    expect(blocks(gpCss, '.gp-screen .param-row').join(';')).not.toMatch(/flex\s*:\s*0\s+0\s+auto/)
  })

  it('leaves the OOS body, not its header rows, as the shrinkable part of the screen', () => {
    expect(blocks(oosCss, '.oos-body').join(';')).toMatch(/flex\s*:\s*1\s+1\s+auto/)
    expect(noShrink(oosCss, '.oos-card')).toBe(true)
  })
})
