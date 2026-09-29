// Up to six workspace tabs (names of up to 16 characters) sit in `.frame-tabs { overflow: hidden }`. A tab that
// cannot shrink is clipped there yet still takes focus (WCAG 2.4.11), so the inactive workspace tabs are the
// shrinkable part of the strip: they give room with an ellipsis (their full name is the tab's title), while the
// active tab and the + tab keep their width.
import { describe, expect, it } from 'vitest'
import frameCss from './FrameStrip.css?raw'

const INACTIVE_WORKSPACE_TAB = '.frame-tab[data-tab="workspace"]:not([aria-current="page"])'

/** Every declaration block for one exact selector (comment-stripped), in source order. */
function blocks(css: string, selector: string): string[] {
  const out: string[] = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim())
    if (selectors.includes(selector)) out.push(m[2] ?? '')
  }
  return out
}

const declared = (selector: string) => blocks(frameCss, selector).join(';')
const NO_SHRINK = /\bflex\s*:\s*0\s+0\s+auto\b|\bflex-shrink\s*:\s*0\b/

describe('the frame strip gives way to long workspace names', () => {
  it('reads the sheet', () => {
    expect(frameCss.length).toBeGreaterThan(500)
  })

  it('lets an inactive workspace tab shrink, to a floor and a ceiling, with an ellipsis', () => {
    const rule = declared(INACTIVE_WORKSPACE_TAB)
    expect(rule).not.toBe('')
    expect(rule).toMatch(/\bflex\s*:\s*0\s+1\s+auto\b|\bflex-shrink\s*:\s*1\b/)
    expect(rule).toMatch(/\bmin-width\s*:\s*\d+(\.\d+)?(ch|px|em)\b/)
    expect(rule).toMatch(/\bmax-width\s*:\s*\d+(\.\d+)?(ch|px|em)\b/)
    expect(rule).toMatch(/\boverflow\s*:\s*hidden\b/)
    expect(rule).toMatch(/\btext-overflow\s*:\s*ellipsis\b/)
  })

  it('keeps the floor under the ceiling', () => {
    const rule = declared(INACTIVE_WORKSPACE_TAB)
    const min = Number(/\bmin-width\s*:\s*(\d+(?:\.\d+)?)/.exec(rule)?.[1])
    const max = Number(/\bmax-width\s*:\s*(\d+(?:\.\d+)?)/.exec(rule)?.[1])
    expect(min).toBeGreaterThan(0)
    expect(max).toBeGreaterThan(min)
  })

  it('never shrinks the + tab', () => {
    expect(declared('.frame-new')).toMatch(NO_SHRINK)
  })

  it('never shrinks the active tab: the base tab does not shrink and nothing lets the active one', () => {
    expect(declared('.frame-tab')).toMatch(NO_SHRINK)
    const active = declared('.frame-tab[aria-current="page"]')
    expect(active).not.toMatch(/\bflex\s*:\s*\d+\s+[1-9]/)
    expect(active).not.toMatch(/\bflex-shrink\s*:\s*[1-9]/)
    // The shrinkable rule excludes it by selector, not by a later override.
    expect(INACTIVE_WORKSPACE_TAB).toContain(':not([aria-current="page"])')
  })

  it('leaves the layout tabs (HOME, RESEARCH, LIVE) and the + tab out of the shrinkable rule', () => {
    expect(INACTIVE_WORKSPACE_TAB).toContain('[data-tab="workspace"]')
    expect(blocks(frameCss, '.frame-tab[data-tab="workspace"]')).toEqual([])
  })

  it('adds no colour of its own: the rule uses no literal', () => {
    expect(declared(INACTIVE_WORKSPACE_TAB)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})
