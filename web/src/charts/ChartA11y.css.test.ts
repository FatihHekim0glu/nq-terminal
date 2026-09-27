// The chart focus ring (UI_SPEC section 9, WCAG 2.4.7 and 2.4.11). Every chart fills its role="img"
// figure edge to edge with an absolutely positioned, opaque layer (LineStack panes, the CandleChart
// frame, the ECharts frame) that paints over the figure's own outline. So the ring is drawn by an
// overlay above the chart content, never by the figure's outline alone.
import { describe, expect, it } from 'vitest'
import { readText } from './theme/themeTestUtil'

const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const a11y = strip(readText('../ChartA11y.css'))
const OVERLAY_CSS = ['../LineStack.css', '../CandleChart.css', '../echarts/echarts.css', './chart.css'].map((f) => strip(readText(f)))

/** The declarations of every rule whose selector list contains `selector`, joined; null if none. */
function rule(css: string, selector: string): string | null {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? '').split(',').map((s) => s.trim()).includes(selector))
    .map((m) => m[2] ?? '')
  return found.length > 0 ? found.join(';') : null
}

const zIndexes = (css: string) => [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]))

describe('ChartA11y.css focus ring', () => {
  it('draws the figure ring on an overlay above the chart content', () => {
    const ring = rule(a11y, '.chart-a11y-figure:focus-visible::after')
    expect(ring, 'no focus overlay rule').not.toBeNull()
    expect(ring).toMatch(/content:\s*''/)
    expect(ring).toMatch(/position:\s*absolute/)
    expect(ring).toMatch(/inset:\s*0/)
    expect(ring).toMatch(/pointer-events:\s*none/)
    // An outline, not a box-shadow: forced-colours mode keeps outlines and drops shadows.
    expect(ring).toMatch(/outline:\s*2px solid var\(--focus\)/)
    const z = Number(/z-index:\s*(\d+)/.exec(ring ?? '')?.[1] ?? 0)
    expect(z).toBeGreaterThan(Math.max(...OVERLAY_CSS.flatMap(zIndexes)))
  })

  it('keeps the overlay stacking local to the figure', () => {
    expect(rule(a11y, '.chart-a11y-figure')).toMatch(/isolation:\s*isolate/)
  })
})
