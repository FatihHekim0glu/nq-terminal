// lwcTheme.ts was written before lightweight-charts was installed, so it spells out the library's
// enum values by hand. This file checks them against the installed package (5.2.1), at run time
// and at compile time (`pnpm test:types` type-checks this file: the theme objects must be
// assignable to the library's own option types with no cast in the chart component).
import {
  ColorType,
  LineStyle,
  type CandlestickSeriesPartialOptions,
  type ChartOptions,
  type DeepPartial,
  type HistogramSeriesPartialOptions,
  type LineSeriesPartialOptions,
} from 'lightweight-charts'
import { describe, expect, it } from 'vitest'
import { LWC_COLOR_TYPE_SOLID, LWC_LINE_STYLE, lwcTheme, lwcWithGrid } from './lwcTheme'

// Read as text through relative paths: the package's `exports` map hides its dist files.
import libraryJs from '../../../node_modules/lightweight-charts/dist/lightweight-charts.production.mjs?raw'
import libraryPkg from '../../../node_modules/lightweight-charts/package.json?raw'

describe('lwcTheme against the installed lightweight-charts', () => {
  it('is checked against v5.2.1', () => {
    const pkg = JSON.parse(libraryPkg) as { version: string }
    expect(pkg.version).toBe('5.2.1')
  })

  it('writes ColorType.Solid with the library value', () => {
    expect(LWC_COLOR_TYPE_SOLID).toBe(ColorType.Solid)
    expect(lwcTheme.chart.layout.background.type).toBe(ColorType.Solid)
  })

  it('writes every LineStyle member with the library value', () => {
    expect(LWC_LINE_STYLE).toEqual({
      Solid: LineStyle.Solid,
      Dotted: LineStyle.Dotted,
      Dashed: LineStyle.Dashed,
      LargeDashed: LineStyle.LargeDashed,
      SparseDotted: LineStyle.SparseDotted,
    })
  })

  it('overrides the pane separator defaults that the installed build really uses', () => {
    const match = /separatorColor:"([^"]+)",separatorHoverColor:"([^"]+)"/.exec(libraryJs)
    expect(match).not.toBeNull()
    const [, sep, hover] = match ?? []
    expect(lwcTheme.chart.layout.panes.separatorColor).not.toBe(sep)
    expect(lwcTheme.chart.layout.panes.separatorHoverColor).not.toBe(hover)
  })

  it('keeps the attribution logo on (Apache-2.0 notice, ARCHITECTURE section 1)', () => {
    expect(lwcTheme.chart.layout.attributionLogo).toBe(true)
  })

  it('passes to the library option types without a cast', () => {
    const chart: DeepPartial<ChartOptions> = lwcWithGrid(lwcTheme).chart
    const candle: CandlestickSeriesPartialOptions = lwcTheme.candle
    const volume: HistogramSeriesPartialOptions = lwcTheme.volume
    const volumeMa: LineSeriesPartialOptions = lwcTheme.volumeMa
    expect([chart, candle, volume, volumeMa].every((o) => typeof o === 'object')).toBe(true)
  })
})
