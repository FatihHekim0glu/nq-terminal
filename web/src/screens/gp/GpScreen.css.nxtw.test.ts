// U22: at 200% zoom (960x540 CSS px) the short-panel rule (HOME at 1366x768, look spec 7.6) zeroed
// out .gp-chart's minimum height along with its fixed 100cqh, so a container query height under 160px
// let the CandleChart panes (price, volume, the RV22 indicator) collapse to unreadable slivers. The
// chart keeps its 160px floor even in the short-panel rule; the panel body already scrolls
// (PanelChrome.css's .nqt-panel-body) for whatever that floor pushes past the fold (WCAG 1.4.4).
import { describe, expect, it } from 'vitest'

const css = String((await import('./GpScreen.css?raw')).default)

function block(pattern: RegExp): string {
  const m = pattern.exec(css)
  if (!m) throw new Error(`no match for ${pattern}`)
  return m[0]
}

describe('GpScreen.css: the chart never collapses under 300px container height (U22)', () => {
  it('keeps a real minimum height for .gp-chart inside the short-panel container query', () => {
    const short = block(/@container gp \(max-height:\s*300px\)\s*\{[\s\S]*?\n\}/)
    const rule = /\.gp-screen > \.gp-chart\s*\{([^}]*)\}/.exec(short)?.[1] ?? ''
    expect(rule).not.toMatch(/min-height:\s*0\b/)
    expect(rule).toMatch(/min-height:\s*160px/)
  })

  it('matches the base minimum height (160px), so the floor never changes', () => {
    const base = /\.gp-chart\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(base).toMatch(/min-height:\s*160px/)
  })
})
