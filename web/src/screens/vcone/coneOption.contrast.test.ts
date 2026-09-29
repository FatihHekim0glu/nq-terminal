// U23: the VCONE percentile bands were nearly invisible against black and against each other (min to max fill
// 1.24:1 on black, no outlines; WCAG 1.4.11). Every band edge is now a 1px line of at least 3:1 against the
// page and against the fills on both sides of it, the fills step up toward the middle, and the key under the
// chart uses the very fills the chart draws. Colours still come from the chart tokens only.
import { describe, expect, it } from 'vitest'
import { CHART_GEOMETRY, DEFAULT_CHART_TOKENS, type ChartTokens } from '../../charts/theme'
import { COMPONENT_MIN, contrastRatio } from '../../theme/contrast'
import { coneKey, coneOption, type ConeInput } from './coneOption'
import { coneRow } from './vconeTestData'

const row = (sessions: number, scale: number) => coneRow(sessions, scale)

const INPUT: ConeInput = { name: 'NQ', asOf: '2021-12-31', steps: [5, 21, 63], rows: [row(5, 1.4), row(21, 1.1), row(63, 0.9)] }

interface Line { readonly id: string; readonly z?: number; readonly lineStyle: { readonly width: number; readonly color?: string }; readonly areaStyle?: { readonly color: string; readonly opacity: number } }

function series(tokens: ChartTokens = DEFAULT_CHART_TOKENS): Line[] {
  return coneOption(INPUT, tokens).series as unknown as Line[]
}
const byId = (all: Line[], id: string): Line => all.find((s) => s.id === id)!
const fillOf = (all: Line[], band: 'range' | 'outer' | 'inner'): string => byId(all, `${band}-band`).areaStyle!.color

describe('U23: VCONE band edges and fills', () => {
  const c = DEFAULT_CHART_TOKENS.color
  const all = series()
  const fills = { range: fillOf(all, 'range'), outer: fillOf(all, 'outer'), inner: fillOf(all, 'inner') }
  const edge = byId(all, 'range-band').lineStyle.color!

  it('strokes both edges of every band with a 1px line', () => {
    for (const band of ['range', 'outer', 'inner']) {
      for (const part of ['base', 'band']) {
        const s = byId(all, `${band}-${part}`)
        expect(s.lineStyle.width, `${band}-${part}`).toBe(CHART_GEOMETRY.lineWidth)
        expect(s.lineStyle.color, `${band}-${part}`).toBe(edge)
      }
    }
  })

  it('draws the lower edge of each band above the fills, so a fill never paints over it', () => {
    for (const band of ['range', 'outer', 'inner']) {
      expect(byId(all, `${band}-base`).z ?? 0, band).toBeGreaterThan(byId(all, `${band}-band`).z ?? 0)
    }
  })

  it('keeps every edge at 3:1 or more against the page and against every fill it can touch (WCAG 1.4.11)', () => {
    expect(contrastRatio(edge, c.bg)).toBeGreaterThanOrEqual(COMPONENT_MIN)
    for (const [band, fill] of Object.entries(fills)) {
      expect(contrastRatio(edge, fill), `edge on the ${band} fill`).toBeGreaterThanOrEqual(COMPONENT_MIN)
    }
  })

  it('steps the fills up toward the middle, each pair told apart by more than the old 1.24:1 on black', () => {
    expect(contrastRatio(fills.range, c.bg)).toBeGreaterThanOrEqual(1.2)
    expect(contrastRatio(fills.outer, fills.range)).toBeGreaterThanOrEqual(1.5)
    expect(contrastRatio(fills.inner, fills.outer)).toBeGreaterThanOrEqual(1.5)
    const lum = (hex: string) => contrastRatio(hex, c.bg)
    expect(lum(fills.range)).toBeLessThan(lum(fills.outer))
    expect(lum(fills.outer)).toBeLessThan(lum(fills.inner))
  })

  it('paints the fills solid, so a fill is the colour the key shows and not a blend of what lies under it', () => {
    for (const band of ['range', 'outer', 'inner'] as const) expect(byId(all, `${band}-band`).areaStyle!.opacity).toBe(1)
  })

  it('leaves the median thicker than the edges, so the two white-ish lines are not mistaken for each other', () => {
    expect(byId(all, 'median').lineStyle.width).toBeGreaterThan(byId(all, 'inner-band').lineStyle.width)
  })

  it('keeps the legend swatches in step: the key fills are the chart fills', () => {
    const key = coneKey(INPUT.asOf)
    expect(key.slice(0, 3).map((k) => k.fill)).toEqual([fills.range, fills.outer, fills.inner])
    expect(key.map((k) => k.label).slice(0, 3)).toEqual(['Min to max', '10th to 90th percentile', '25th to 75th percentile'])
  })

  it('takes its colours from the tokens it is given: no colour is written into the chart', () => {
    const other: ChartTokens = { ...DEFAULT_CHART_TOKENS, color: { ...c, barMag: '#00AA55', chartVol: '#AA5500', chartArea: '#100010', text: '#EEEEEE' } }
    const changed = series(other)
    expect(fillOf(changed, 'outer')).not.toBe(fills.outer)
    expect(fillOf(changed, 'inner')).not.toBe(fills.inner)
    expect(byId(changed, 'outer-band').lineStyle.color).toBe('#EEEEEE')
    expect(coneKey(INPUT.asOf, other).slice(0, 3).map((k) => k.fill)).toEqual([fillOf(changed, 'range'), fillOf(changed, 'outer'), fillOf(changed, 'inner')])
  })

  it('still draws the bands only where a horizon has the statistic', () => {
    const holes = { ...INPUT, rows: [row(5, 1.4), { ...row(21, 1.1), p10: null, p90: null }, row(63, 0.9)] }
    const outer = byId(coneOption(holes).series as unknown as Line[], 'outer-band') as unknown as { data: Array<number | null> }
    expect(outer.data[1]).toBeNull()
  })
})
