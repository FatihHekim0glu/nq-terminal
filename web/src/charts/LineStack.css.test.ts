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

  it('sets the legend on one line in a pane under 120px, so it never runs past the pane foot', () => {
    expect(code).toMatch(/@container\s*\(max-height:\s*120px\)\s*\{\s*\.linestack-legend\s*\{[^}]*grid-auto-flow:\s*column/)
  })

  it('lets a legend name wrap only in a maximised panel, so a shared pane keeps its legend short and the curve clear (look spec 6.1)', () => {
    // A shared pane (the DES chart at 1366x768) is as narrow as a maximised panel's pane at 200% zoom. A legend that wraps there
    // grows past the share of the plot the y range keeps clear of it, and covers the curve's high and its last-value tag.
    const header = '@container style(--panel-maximised: 1)'
    const start = code.indexOf(header)
    expect(start).toBeGreaterThanOrEqual(0)
    let depth = 0
    let end = code.indexOf('{', start)
    for (; end < code.length; end += 1) {
      if (code[end] === '{') depth += 1
      if (code[end] === '}') depth -= 1
      if (depth === 0) break
    }
    const block = code.slice(start, end + 1)
    expect(block).toMatch(/@container\s*\(max-width:\s*\d+px\)\s*\{[^@]*\.chart-legend-name\s*\{[^}]*white-space:\s*normal/)
    expect(code.replace(block, '')).not.toMatch(/white-space:\s*normal/)
  })

  it("replaces uPlot's dashed grey cursor with solid 1px lines in the crosshair token (look spec 9.2)", () => {
    expect(code).toMatch(/\.u-cursor-x\s*\{[^}]*border-right:\s*1px solid var\(--crosshair\)/)
    expect(code).toMatch(/\.u-cursor-y\s*\{[^}]*border-bottom:\s*1px solid var\(--crosshair\)/)
  })

  it('shows keyboard focus with the 2px white ring', () => {
    expect(code).toMatch(/outline:\s*2px solid var\(--focus\)/)
  })
})
