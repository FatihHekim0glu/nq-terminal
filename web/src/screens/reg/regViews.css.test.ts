// regViews.css follows the look spec's style rules (3, 4.12, 8.5 d and e): colours only through
// tokens, square corners, and no transition on anything.
import { describe, expect, it } from 'vitest'
import { readText } from '../../grids/testing'

const css = readText(new URL('./regViews.css', import.meta.url))

describe('regViews.css', () => {
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
