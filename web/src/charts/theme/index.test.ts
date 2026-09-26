import { describe, expect, it } from 'vitest'
import packageJsonText from '../../../package.json?raw'
import tokensCss from '../../theme/tokens.css?raw'
import {
  CHART_GEOMETRY,
  RANGE_TOOLBAR,
  echartsTheme,
  lwcTheme,
  tagPolygon,
  uplotTheme,
  withGrid,
} from './index'
import { readText } from './themeTestUtil'

const packageJson = JSON.parse(packageJsonText) as {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const a11yCss = readText('../ChartA11y.css')
const chartCss = readText('./chart.css')

// The theme sources, read as text so the no-library and no-hex rules can be checked.
const SOURCES = import.meta.glob(['./*.ts', '!./*.test.ts', '!./themeTestUtil.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const TOKEN_READER = './chartTokens.ts'
const CHART_LIBS = /['"](uplot|lightweight-charts|echarts)(\/[^'"]*)?['"]/

describe('charts theme module (look spec 12, task 4)', () => {
  it('exports plain option objects for the three libraries', () => {
    for (const theme of [uplotTheme, lwcTheme, echartsTheme]) {
      expect(Object.getPrototypeOf(theme)).toBe(Object.prototype)
      expect(JSON.parse(JSON.stringify(theme))).toEqual(theme)
    }
  })

  it('imports no chart library and adds none to package.json', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(6)
    for (const [file, text] of Object.entries(SOURCES)) expect(CHART_LIBS.test(text), file).toBe(false)
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    expect(Object.keys(deps).filter((d) => /uplot|lightweight-charts|echarts/.test(d))).toEqual([])
  })

  it('writes hex colours only in the token reader', () => {
    for (const [file, text] of Object.entries(SOURCES)) {
      if (file === TOKEN_READER) continue
      expect(text.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [], file).toEqual([])
    }
  })

  it('switches the grid for each library through one withGrid', () => {
    expect(withGrid(uplotTheme).axes.every((a) => a.grid.show)).toBe(true)
    expect(withGrid(lwcTheme).chart.grid.horzLines.visible).toBe(true)
    expect(withGrid(echartsTheme).yAxis.splitLine.show).toBe(true)
    expect(withGrid(withGrid(echartsTheme), false).yAxis.splitLine.show).toBe(false)
  })
})

describe('chart geometry (look spec 6, 6.1, 6.4)', () => {
  it('fixes the axis, legend, tag, splitter and pane constants', () => {
    expect(CHART_GEOMETRY).toMatchObject({
      axisGutter: 57,
      xAxisHeight: 45,
      rightPad: 26,
      majorTick: 6,
      minorTick: 3,
      labelGap: 2,
      legendInset: 8,
      legendRadius: 3,
      legendSwatch: 13,
      legendColumnGap: 6,
      legendLineHeight: 16,
      tagHeight: 17,
      tagArrow: 5,
      splitter: { outer: 1, inner: 3, total: 5 },
      volumePaneRatio: 0.25,
      primaryWidth: 1.5,
      gridDash: [2, 2],
      fenceDash: [4, 3],
      datatipOffset: 15,
      datatipDelayMs: 200,
    })
    const s = CHART_GEOMETRY.splitter
    expect(s.outer * 2 + s.inner).toBe(s.total)
  })

  it('draws the last-value tag as a pentagon pointing at the axis line', () => {
    expect(tagPolygon(100, 50, 40)).toEqual([
      [100, 50],
      [105, 41.5],
      [145, 41.5],
      [145, 58.5],
      [105, 58.5],
    ])
  })

  it('specifies the range toolbar rows and buttons (6.4)', () => {
    expect(RANGE_TOOLBAR.ranges).toEqual(['1D', '3D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'])
    expect(RANGE_TOOLBAR).toMatchObject({ row1Height: 22, row2Height: 20, minButtonWidth: 35, separator: 1, fontSize: 13 })
  })
})

describe('chart CSS (ChartA11y.css and theme/chart.css)', () => {
  const declaredNames = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
  const files = { 'ChartA11y.css': a11yCss, 'chart.css': chartCss }

  it.each(Object.entries(files))('%s uses tokens only: no hex, no rgb, no oklch', (_name, css) => {
    expect(css.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|oklch\(/g) ?? []).toEqual([])
  })

  it.each(Object.entries(files))('%s names only tokens that tokens.css declares', (_name, css) => {
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!)
    expect(used.filter((n) => !declaredNames.has(n))).toEqual([])
  })

  it.each(Object.entries(files))('%s needs no fallback value: every token is declared once, in tokens.css', (_name, css) => {
    expect(css.match(/var\(--[a-z0-9-]+\s*,/g) ?? []).toEqual([])
  })

  it.each(Object.entries(files))('%s has no transition, no animation, no uppercase, no zero-slash feature', (_name, css) => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/transition|animation/)
    expect(code).not.toMatch(/text-transform\s*:\s*uppercase/)
    expect(code).not.toMatch(/'zero'|'cv05'|'ss01'/)
    expect(code).not.toMatch(/letter-spacing\s*:\s*(?!0\b)/)
  })
  it.each(Object.entries(files))('%s is square except the 3px chart legend', (name, css) => {
    const radii = [...css.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim())
    const allowed = name === 'chart.css' ? ['0', '3px'] : ['0']
    for (const r of radii) expect(allowed).toContain(r)
    expect(css).not.toMatch(/var\(--r-(sm|md|lg)\)/)
  })

  it('shows keyboard focus as the 2px white --focus ring, never the old lime accent', () => {
    expect(a11yCss).toMatch(/outline:\s*2px solid var\(--focus\)/)
    expect(chartCss).toMatch(/outline:\s*2px solid var\(--focus\)/)
    expect(a11yCss).not.toMatch(/var\(--accent\)/)
  })

  it('styles the table view like a grid: 20px header on --th-bg with a --th-rule top, amber labels, --text numbers', () => {
    expect(a11yCss).toMatch(/\.chart-a11y-table th\s*\{[^}]*background:\s*var\(--th-bg\)/)
    expect(a11yCss).toMatch(/\.chart-a11y-table th\s*\{[^}]*border-top:\s*1px solid var\(--th-rule\)/)
    expect(a11yCss).toMatch(/\.chart-a11y-table td\s*\{[^}]*color:\s*var\(--data\)/)
    expect(a11yCss).toMatch(/\.chart-a11y-table td\.num\s*\{[^}]*color:\s*var\(--text\)/)
    expect(a11yCss).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums/)
  })

  it('lifts muted and down text inside a hovered table cell (4.12)', () => {
    expect(a11yCss).toMatch(/\.chart-a11y-table tbody td:hover\s*\{[^}]*--muted:\s*var\(--muted-hover\)/)
    expect(a11yCss).toMatch(/\.chart-a11y-table tbody td:hover\s*\{[^}]*--c-down:\s*var\(--c-down-hover\)/)
  })

  it('gives the legend its dark box, 13px swatch column and 3px corner', () => {
    expect(chartCss).toMatch(/\.chart-legend\s*\{[^}]*background:\s*var\(--legend-bg\)/)
    expect(chartCss).toMatch(/\.chart-legend\s*\{[^}]*grid-template-columns:\s*13px auto auto/)
    expect(chartCss).toMatch(/\.chart-legend\s*\{[^}]*border-radius:\s*3px/)
  })

  it('draws the 5px splitter as outer, inner, outer', () => {
    expect(chartCss).toMatch(/\.chart-splitter\s*\{[^}]*height:\s*5px/)
    expect(chartCss).toMatch(/\.chart-splitter\s*\{[^}]*background:\s*var\(--chart-split-inner\)/)
    expect(chartCss).toMatch(/\.chart-splitter\s*\{[^}]*border-top:\s*1px solid var\(--chart-split-outer\)/)
  })

  it('marks the active range button with the toggle blue and bold, not colour alone', () => {
    expect(chartCss).toMatch(/\.chart-range-btn\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--sel-toggle\)[^}]*font-weight:\s*700/)
  })
})
