// LineStack.css against the look rules (look spec 2, 6.1, 4.12; UI_SPEC section 3): tokens only,
// only declared tokens, hard cuts, square corners, and the crosshair in the house crosshair colour.
import { describe, expect, it } from 'vitest'
import tokensCss from '../theme/tokens.css?raw'
import { readText } from './theme/themeTestUtil'

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const code = strip(readText('../LineStack.css'))
const galleryCode = strip(readText('../LineStack.gallery.css'))
const declared = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))

describe('LineStack.gallery.css', () => {
  it('uses declared tokens only, with no transition', () => {
    expect(galleryCode.match(/#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/g) ?? []).toEqual([])
    const used = [...galleryCode.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(used.filter((n) => !declared.has(n))).toEqual([])
    expect(galleryCode).not.toMatch(/transition|animation/)
  })
})

describe('LineStack.css', () => {
  it('writes no colour of its own: no hex, rgb, hsl or oklch', () => {
    expect(code.match(/#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/g) ?? []).toEqual([])
  })

  it('names only tokens that tokens.css declares, with no fallback values', () => {
    const used = [...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(0)
    expect(used.filter((n) => !declared.has(n))).toEqual([])
    expect(code).not.toMatch(/var\(--[a-z0-9-]+\s*,/)
  })

  it('has no transition or animation, and square corners', () => {
    expect(code).not.toMatch(/transition|animation/)
    for (const m of code.matchAll(/border-radius\s*:\s*([^;]+);/g)) expect(m[1]!.trim()).toBe('0')
  })

  it('hides the High, Average and Low legend rows in a short pane, so the legend never covers the time axis', () => {
    expect(code).toMatch(/\.linestack-pane\s*\{[^}]*container-type:\s*size/)
    expect(code).toMatch(/@container\s*\(max-height:\s*\d+px\)\s*\{\s*\.linestack-legend-stat\s*\{\s*display:\s*none/)
  })

  it("replaces uPlot's dashed grey cursor with solid 1px lines in the crosshair token (look spec 9.2)", () => {
    expect(code).toMatch(/\.u-cursor-x\s*\{[^}]*border-right:\s*1px solid var\(--crosshair\)/)
    expect(code).toMatch(/\.u-cursor-y\s*\{[^}]*border-bottom:\s*1px solid var\(--crosshair\)/)
  })

  it('shows keyboard focus with the 2px white ring', () => {
    expect(code).toMatch(/outline:\s*2px solid var\(--focus\)/)
  })
})
