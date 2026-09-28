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

/** A rule's declaration block for one exact selector, first match, anywhere in the (comment-stripped) file. */
function ruleFor(stylesheet: string, selector: string): string | undefined {
  for (const m of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return m[2]
  }
  return undefined
}

// G02: MT's adjusted table painted over the sealed confirmations and the deflated Sharpe (SV3) at every
// size, because panelScroll.css lets '.mt-grid .nqt-grid-scroll' overflow visible (so the grid can grow
// to fit every row) while the MT body rule pinned a fixed height the grid could never grow past.
describe('.mt-body: stays free to grow while panelScroll.css lets .mt-grid overflow visible (G02)', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const panelScroll = readText(new URL('../../theme/panelScroll.css', import.meta.url)).replace(/\/\*[\s\S]*?\*\//g, '')

  it('panelScroll.css makes .mt-grid .nqt-grid-scroll overflow visible (precondition)', () => {
    const rule = ruleFor(panelScroll, '.nqt-panel .nqt-panel-body .mt-grid .nqt-grid-scroll')
    expect(rule, '.mt-grid .nqt-grid-scroll rule').toBeTruthy()
    expect(rule ?? '').toMatch(/overflow:\s*visible/)
  })

  it('the MT body rule sets no fixed height, only a min-height, so the grid can grow past one screen', () => {
    const body = ruleFor(stripped, '.reg-screen[data-screen="MT"] > .mt-body')
    expect(body, '.mt-body rule').toBeTruthy()
    expect(body ?? '').not.toMatch(/(?<!min-)(?<!max-)height\s*:/)
    expect(body ?? '').toMatch(/min-height\s*:\s*100cqh/)
  })

  it('.mt-grid takes its content height (flex: 0 0 auto), never a flex-grow share of the body', () => {
    const grid = ruleFor(stripped, '.mt-grid')
    expect(grid, '.mt-grid rule').toBeTruthy()
    expect(grid ?? '').toMatch(/flex:\s*0 0 auto/)
  })
})

// U06: a short panel (1366x768) used to hide the MT provenance line, the sealed-confirmations note and
// the REG verdict notes outright, or ellipsis-clip the first MT line with no tooltip. They wrap instead.
describe('short panel (max-height: 560px): keeps [PRE-REG]/[POST HOC] provenance readable (U06)', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const match = /@container reg \(max-height: 560px\) \{\n([\s\S]*?)\n\}/.exec(stripped)
  const block = match?.[1] ?? ''

  it('finds the short-panel container block', () => {
    expect(match).toBeTruthy()
  })

  it('never hides the MT provenance line, the sealed-confirmations band note or the verdict notes', () => {
    expect(block).not.toMatch(/\.mt-head\s+\.mt-line\s*\+\s*\.mt-line\s*\{[^}]*display:\s*none/)
    expect(block).not.toMatch(/\.reg-band\s+\.reg-muted[^{]*\{[^}]*display:\s*none/)
    expect(block).not.toMatch(/(^|,)\s*\.reg-notes\s*(\{|,)/m)
  })

  it('wraps them instead, so the full text stays reachable without a tooltip', () => {
    expect(block).toMatch(/\.mt-head \.mt-line[^{]*\{[^}]*white-space:\s*normal/)
    expect(block).toMatch(/\.reg-band\b[^{]*\{[^}]*white-space:\s*normal/)
    expect(block).toMatch(/\.reg-notes li[^{]*\{[^}]*white-space:\s*normal/)
  })
})
