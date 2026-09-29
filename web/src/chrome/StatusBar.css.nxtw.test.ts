// U22: at 200% zoom (960x540 CSS px) the status line was still one row, so its shrinking segments
// (the link-group contexts and the DATA fence) were squeezed to a 28ch ellipsis, cutting the DATA
// fence text to one letter (also failing under the WCAG 1.4.12 text-spacing override, which needs the
// same room). Below about 1100 CSS px the line now wraps to a second row before that happens, and the
// segments that used to shrink-and-ellipsise print their text in full once they can drop to their own
// line.
import { describe, expect, it } from 'vitest'

const css = String((await import('./StatusBar.css?raw')).default)

function block(pattern: RegExp): string {
  const m = pattern.exec(css)
  if (!m) throw new Error(`no match for ${pattern}`)
  return m[0]
}

describe('StatusBar.css: two-line status bar below about 1100 CSS px (U22)', () => {
  it('wraps the line at 1100px, ahead of the 700px (400% zoom) reflow break', () => {
    const zoom200 = block(/@media \(max-width:\s*1100px\)\s*\{[\s\S]*?\n\}/)
    expect(zoom200).toMatch(/\.nqt-status\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/@media \(max-width:\s*700px\)/)
  })

  it('keeps the DATA fence and the link-group contexts whole once the line can wrap, no ellipsis', () => {
    const zoom200 = block(/@media \(max-width:\s*1100px\)\s*\{[\s\S]*?\n\}/)
    expect(zoom200).toMatch(/\.nqt-status \.seg\.shrink\s*\{[^}]*max-width:\s*none/)
    expect(zoom200).not.toMatch(/text-overflow:\s*ellipsis/)
  })

  it('never sets a colour literal (tokens only)', () => {
    expect(css.match(/#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?|oklch)\(/g) ?? []).toEqual([])
  })
})
