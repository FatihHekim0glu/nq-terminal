// spa.css follows the look spec's style rules (3, 4.12, 8.5 d and e) as reg.css does: colours only through tokens,
// square corners, no transition, and no sideways scroll in the member table or the notes (WCAG 1.4.10 reflow).
import { describe, expect, it } from 'vitest'
import { readText } from '../../grids/testing'

const css = readText(new URL('./spa.css', import.meta.url))
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('spa.css', () => {
  it('writes no colour literal', () => {
    expect(stripped).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    expect(stripped).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('has no transition or animation and no rounded corner', () => {
    expect(stripped).not.toMatch(/\btransition\b|\banimation\b/)
    expect(stripped).not.toMatch(/border-radius:(?!\s*0\b)/)
  })

  it('takes every var() from the token names', () => {
    const tokens = readText(new URL('../../theme/tokens.css', import.meta.url))
    const used = [...stripped.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!)
    const missing = [...new Set(used)].filter((name) => !tokens.includes(`${name}:`))
    expect(missing).toEqual([])
  })

  it('lets the table cells and the notes wrap, and takes the panel its content height', () => {
    expect(stripped).toMatch(/\.mt-spa\s*\{[^}]*flex:\s*0 0 auto/)
    expect(stripped).toMatch(/\.mt-spa \.reg-msg\s*\{[^}]*white-space:\s*normal/)
    expect(stripped).toMatch(/\.mt-spa-table th, \.mt-spa-table td\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
