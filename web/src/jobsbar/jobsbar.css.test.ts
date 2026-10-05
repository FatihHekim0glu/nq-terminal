// The job indicator and the anchor badge take every colour from the theme tokens (so the colour-vision themes and the
// amber theme reach them), and their text colours pass 4.5:1 on the chrome fill they sit on (WCAG 1.4.3).
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../theme/contrast'

// Read from disk: the test runner only processes the stylesheets of chrome, grids and screens (vite.config.ts), so a
// ?raw import of a stylesheet in this folder would come back empty. The app tsconfig carries browser types only, so the
// Node built-in is typed here by hand (as export/print/print.css.test.ts does).
const builtins = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process
const fs = builtins.getBuiltinModule('node:fs') as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (name: string): string => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const badgeCss = read('./AnchorBadge.css')
const indicatorCss = read('./JobIndicator.css')
const tokensCss = read('../theme/tokens.css')

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokensCss)
  if (match?.[1] === undefined) throw new Error(`no token ${name}`)
  return match[1]
}

describe('job indicator styles', () => {
  it('reads the stylesheets (not empty)', () => {
    expect(indicatorCss.length).toBeGreaterThan(200)
    expect(badgeCss.length).toBeGreaterThan(200)
  })

  it('has no colour literal: tokens only', () => {
    for (const css of [indicatorCss, badgeCss]) {
      expect(stripComments(css)).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/)
    }
  })

  it('keeps every text colour above 4.5:1 on the chrome fill', () => {
    for (const name of ['text', 'data', 'muted', 'c-up', 'warn']) {
      expect(contrastRatio(token(name), token('chrome')), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has a visible focus ring on its buttons', () => {
    expect(stripComments(indicatorCss)).toMatch(/\.jobbar-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/)
    expect(stripComments(badgeCss)).toMatch(/\.anchor-rerun-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/)
  })
})
