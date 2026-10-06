// Second cues under forced colours (theme/chartContrast.ts) in the uPlot and lightweight-charts themes,
// and the default look left exactly as it was.
import { describe, expect, it } from 'vitest'
import { forcedChartTokens, moreContrastTokens } from './chartContrast'
import { DEFAULT_CHART_TOKENS, SYSTEM_COLOUR_FALLBACK, seriesColor } from './chartTokens'
import { CHART_GEOMETRY } from './geometry'
import { lwcTheme, makeLwcTheme } from './lwcTheme'
import { lineStackSeries, makeUplotTheme, uplotTheme } from './uplotTheme'

const FORCED = forcedChartTokens(SYSTEM_COLOUR_FALLBACK, DEFAULT_CHART_TOKENS)
const KEYS = ['compare1', 'compare2', 'compare3', 'compare4', 'compare5', 'compare6', 'compare7', 'compare8'] as const

type Line = { readonly stroke: string; readonly dash?: readonly number[] }
const dashOf = (s: Line) => (s.dash ?? []).join(',')

/** Pairs of lines that share both colour and dash: the reader could only tell them apart by position. */
function lookAlikes(lines: readonly Line[]): [number, number][] {
  const out: [number, number][] = []
  lines.forEach((a, i) => lines.forEach((b, j) => {
    if (j > i && a.stroke === b.stroke && dashOf(a) === dashOf(b)) out.push([i, j])
  }))
  return out
}

describe('LineStack series under forced colours', () => {
  it('born failing: the default compare lines share colours with no other cue once forced colours collapse the palette', () => {
    // The default dashes with the forced palette: compare1 and compare4 are both CanvasText and both solid.
    const s = lineStackSeries(DEFAULT_CHART_TOKENS)
    const collapsed = KEYS.map((k, i) => ({ stroke: seriesColor(i, FORCED), dash: (s[k] as Line).dash }))
    expect(lookAlikes(collapsed).length).toBeGreaterThan(0)
  })

  it('gives the eight compare lines a distinct dash each, so no two look alike', () => {
    const s = lineStackSeries(FORCED)
    expect(lookAlikes(KEYS.map((k) => s[k] as Line))).toEqual([])
    expect(new Set(KEYS.map((k) => dashOf(s[k] as Line))).size).toBe(8)
    expect(s.compare1).not.toHaveProperty('dash')
  })

  it('keeps the lead series solid and dashes the benchmark and the long and volatility lines', () => {
    const s = lineStackSeries(FORCED)
    expect(s.primary).not.toHaveProperty('dash')
    expect(s.rollShort).not.toHaveProperty('dash')
    expect((s.benchmark as Line).dash).toEqual([10, 4])
    expect((s.rollLong as Line).dash).toEqual([10, 4])
    expect((s.rollVol as Line).dash).toEqual([2, 5])
    expect(s.primary.stroke).toBe(SYSTEM_COLOUR_FALLBACK.canvasText)
    expect(s.benchmark.stroke).toBe(SYSTEM_COLOUR_FALLBACK.highlight)
  })

  it('draws axes and the hidden grid in system colours', () => {
    const t = makeUplotTheme(FORCED)
    expect(t.axes.every((a) => a.stroke === SYSTEM_COLOUR_FALLBACK.canvasText && a.grid.stroke === SYSTEM_COLOUR_FALLBACK.grayText)).toBe(true)
  })

  it('leaves the default series exactly as they were (no dash on 1 to 4, the benchmark or the rolling lines)', () => {
    const s = lineStackSeries(DEFAULT_CHART_TOKENS)
    for (const k of KEYS.slice(0, 4)) expect(s[k], k).not.toHaveProperty('dash')
    for (const k of KEYS.slice(4)) expect((s[k] as Line).dash, k).toEqual([...CHART_GEOMETRY.compareDash])
    expect(s.benchmark).toEqual({ stroke: DEFAULT_CHART_TOKENS.color.accent2, width: CHART_GEOMETRY.primaryWidth })
    expect(s.rollLong).toEqual({ stroke: DEFAULT_CHART_TOKENS.color.accent2, width: CHART_GEOMETRY.primaryWidth })
    expect(s.rollVol).toEqual({ stroke: DEFAULT_CHART_TOKENS.color.rollVol, width: CHART_GEOMETRY.primaryWidth })
    expect(makeUplotTheme(DEFAULT_CHART_TOKENS)).toEqual(uplotTheme)
  })

  it('adds no dash under prefers-contrast more (only structure gets stronger)', () => {
    const s = lineStackSeries(moreContrastTokens(DEFAULT_CHART_TOKENS))
    for (const k of KEYS.slice(0, 4)) expect(s[k], k).not.toHaveProperty('dash')
    expect(s.benchmark).not.toHaveProperty('dash')
  })
})

describe('CandleChart theme under forced colours', () => {
  it('draws up candles hollow (outlined) and down candles filled, so direction is not colour alone', () => {
    const c = makeLwcTheme(FORCED).candle
    expect(c.upColor).toBe(SYSTEM_COLOUR_FALLBACK.canvas)
    expect(c.borderVisible).toBe(true)
    expect(c.borderUpColor).toBe(SYSTEM_COLOUR_FALLBACK.canvasText)
    expect(c.downColor).toBe(SYSTEM_COLOUR_FALLBACK.highlight)
    expect(c.borderDownColor).toBe(SYSTEM_COLOUR_FALLBACK.highlight)
    expect(c.upColor).not.toBe(c.borderUpColor)
  })

  it('paints the plot Canvas with CanvasText axes', () => {
    const t = makeLwcTheme(FORCED).chart
    expect(t.layout.background.color).toBe(SYSTEM_COLOUR_FALLBACK.canvas)
    expect(t.layout.textColor).toBe(SYSTEM_COLOUR_FALLBACK.canvasText)
    expect(t.rightPriceScale.borderColor).toBe(SYSTEM_COLOUR_FALLBACK.canvasText)
  })

  it('leaves the default candles filled with no border keys', () => {
    const c = makeLwcTheme(DEFAULT_CHART_TOKENS).candle
    expect(c.borderVisible).toBe(false)
    expect(c).not.toHaveProperty('borderUpColor')
    expect(c).not.toHaveProperty('borderDownColor')
    expect(c.upColor).toBe(DEFAULT_CHART_TOKENS.color.candleUp)
    expect(makeLwcTheme(DEFAULT_CHART_TOKENS)).toEqual(lwcTheme)
  })
})
