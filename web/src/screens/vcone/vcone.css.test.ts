// U23: the cone chart fills its bands with token mixes (coneOption: the outer fill is the range fill mixed toward the
// bar blue, the inner fill the blue mixed toward the volume grey). The 27 small multiples on the same VCONE screen
// draw the same three bands in SVG, so their fills must be the same mixes, or one band would be two colours on one
// screen. The percentages here are derived from the cone's own constants, and the mixes are made of tokens only.
import { describe, expect, it } from 'vitest'
import css from './vcone.css?raw'
import { INNER_MIX, OUTER_MIX } from './coneOption'

const sheet = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declaration block of one rule, e.g. `.vcone-outer` (comments removed first). */
function rule(selector: string): string {
  const escaped = selector.replace(/[.\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(sheet)
  if (!match) throw new Error(`no rule for ${selector}`)
  return match[1]!
}
const fillOf = (selector: string): string => /fill:\s*([^;]+);/.exec(rule(selector))![1]!.trim()

/** `a` mixed toward `b` by `t` in CSS: `a` keeps (1 - t) of it. */
const mix = (a: string, b: string, t: number): string =>
  `color-mix(in srgb, var(--${a}) ${Math.round((1 - t) * 100)}%, var(--${b}) ${Math.round(t * 100)}%)`

describe('U23: the VCONE small multiples fill their bands like the cone chart', () => {
  it('fills the outer 10th to 90th box with the range colour mixed toward the bar blue, as the cone does', () => {
    expect(fillOf('.vcone-outer')).toBe(mix('chart-area', 'bar-mag', OUTER_MIX))
    expect(fillOf('.vcone-outer')).toBe('color-mix(in srgb, var(--chart-area) 30%, var(--bar-mag) 70%)')
  })

  it('fills the inner 25th to 75th box with the bar blue mixed toward the volume grey, as the cone does', () => {
    expect(fillOf('.vcone-inner')).toBe(mix('bar-mag', 'chart-vol', INNER_MIX))
    expect(fillOf('.vcone-inner')).toBe('color-mix(in srgb, var(--bar-mag) 40%, var(--chart-vol) 60%)')
  })

  it('keeps the min to max range on the chart area token', () => {
    expect(fillOf('.vcone-range')).toBe('var(--chart-area)')
  })

  it('uses tokens only in the band fills: no literal colour', () => {
    for (const selector of ['.vcone-range', '.vcone-outer', '.vcone-inner']) {
      expect(fillOf(selector)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    }
  })
})
