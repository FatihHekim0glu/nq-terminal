// The ECharts set writes no colour of its own (TASKS 5.3, look spec 6): every colour comes from the
// chart tokens (src/charts/theme) or the heat scales (scales.ts), and the stylesheet uses var() only.
import { describe, expect, it } from 'vitest'
import tokensCss from '../../theme/tokens.css?raw'
import { readText } from '../theme/themeTestUtil'

const SOURCES = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CSS = readText('../echarts/echarts.css')
const COLOUR_LITERAL = /#[0-9A-Fa-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g
/** Named CSS colours a component could slip in (the common ones). */
const NAMED = /['"](white|black|red|green|blue|yellow|orange|grey|gray|transparent)['"]/g

export function colourLiterals(text: string): string[] {
  return [...(text.match(COLOUR_LITERAL) ?? []), ...(text.match(NAMED) ?? [])]
}

describe('ECharts set sources', () => {
  it('reads the component sources', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining(['./core.ts', './heatmapModel.ts', './Heatmap.tsx', './Swimlane.tsx']))
  })

  it('write no colour literal in any source file', () => {
    const found = Object.entries(SOURCES).flatMap(([file, text]) => colourLiterals(text).map((c) => `${file}: ${c}`))
    expect(found).toEqual([])
  })

  it('style with declared tokens only', () => {
    expect(colourLiterals(CSS)).toEqual([])
    const declared = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
    const used = [...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(0)
    expect(used.filter((name) => !declared.has(name))).toEqual([])
  })

  it('has no colour transition (every state change is a hard cut)', () => {
    expect(CSS).not.toMatch(/transition\s*:/)
  })
})

describe('born-failing cases (rule 5)', () => {
  it('flags hex, rgb, oklch and named colours', () => {
    expect(colourLiterals("color: '#FFF', fill: 'rgba(0,0,0,.5)', x: oklch(1 0 0), c: 'white'")).toHaveLength(4)
  })
})
