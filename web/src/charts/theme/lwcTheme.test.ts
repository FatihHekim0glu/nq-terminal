import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_TOKENS } from './chartTokens'
import { collectColours } from './themeTestUtil'
import { LWC_COLOR_TYPE_SOLID, LWC_LINE_STYLE, lwcTheme, lwcWithGrid, makeLwcTheme } from './lwcTheme'

const C = DEFAULT_CHART_TOKENS.color
const TOKEN_VALUES = new Set(Object.values(C))

describe('lwcTheme (look spec 6.3, CandleChart)', () => {
  it('paints a black plot with white 13px Bergoom text', () => {
    expect(lwcTheme.chart.layout).toMatchObject({
      background: { type: LWC_COLOR_TYPE_SOLID, color: C.bg },
      textColor: C.chartAxis,
      fontFamily: DEFAULT_CHART_TOKENS.font.family,
      fontSize: 13,
    })
  })

  it('overrides the library pane separator defaults (#E0E3EB and a translucent hover)', () => {
    const panes = lwcTheme.chart.layout.panes
    expect(panes).toEqual({ separatorColor: C.chartSplitInner, separatorHoverColor: C.chartSplitHover, enableResize: false })
    expect(panes.separatorColor).not.toBe('#E0E3EB')
    expect(panes.separatorHoverColor).not.toBe('rgba(178, 181, 189, 0.2)')
  })

  it('has the grid off by default; switched on it is #505050 dashed [2,2] at width 1', () => {
    expect(lwcTheme.chart.grid.vertLines.visible).toBe(false)
    expect(lwcTheme.chart.grid.horzLines.visible).toBe(false)
    const on = lwcWithGrid(lwcTheme)
    for (const lines of [on.chart.grid.vertLines, on.chart.grid.horzLines]) {
      expect(lines).toEqual({ visible: true, color: C.chartGrid, style: LWC_LINE_STYLE.Dashed })
    }
    expect(lwcTheme.chart.grid.vertLines.visible).toBe(false)
  })

  it('puts a white bordered price scale on the right with ticks, and 5 bars of right offset', () => {
    expect(lwcTheme.chart.rightPriceScale).toEqual({ visible: true, borderVisible: true, borderColor: C.chartAxis, ticksVisible: true })
    expect(lwcTheme.chart.leftPriceScale).toEqual({ visible: false })
    expect(lwcTheme.chart.timeScale).toEqual({ borderVisible: true, borderColor: C.chartAxis, rightOffset: 5 })
  })

  it('draws candles white up and blue down, borderless, with a solid 1px orange last-price line', () => {
    expect(lwcTheme.candle).toEqual({
      upColor: C.candleUp,
      downColor: C.candleDn,
      borderVisible: false,
      wickUpColor: C.candleUp,
      wickDownColor: C.candleDn,
      priceLineVisible: true,
      priceLineColor: C.lastLine,
      priceLineStyle: LWC_LINE_STYLE.Solid,
      priceLineWidth: 1,
      lastValueVisible: true,
    })
  })

  it('puts volume in pane 1 at a quarter of the height, with a white moving-average line', () => {
    expect(lwcTheme.volume).toEqual({ color: C.chartVol, priceFormat: { type: 'volume' }, lastValueVisible: true, priceLineVisible: false })
    expect(lwcTheme.volumePane).toEqual({ index: 1, heightRatio: 0.25 })
    expect(lwcTheme.volumeMa).toEqual({ color: C.chartS1, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
  })

  it('uses the best-guess crosshair (9.2): grey 1px solid lines, pale cyan labels', () => {
    const line = { color: C.chartCross, width: 1, style: LWC_LINE_STYLE.Solid, labelBackgroundColor: C.chartCrossLabel }
    expect(lwcTheme.chart.crosshair).toEqual({ vertLine: line, horzLine: line })
  })

  it('marks rolls yellow with black text and the fence amber dashed', () => {
    expect(lwcTheme.rollMarker).toEqual({ color: C.marker, textColor: C.bg })
    expect(lwcTheme.fence).toEqual({ color: C.fence, width: 1, dash: [4, 3] })
  })

  it('draws Bollinger bands as three unfilled lines: magenta, white, green (6.2)', () => {
    expect(lwcTheme.bollinger).toEqual({ upper: C.chartMagenta, middle: C.chartS1, lower: C.chartGreen, lineWidth: 1, periods: 20, sd: 2 })
  })

  it('uses the enum values of lightweight-charts v5', () => {
    expect(LWC_COLOR_TYPE_SOLID).toBe('solid')
    expect(LWC_LINE_STYLE).toEqual({ Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 })
  })

  it('uses a token value for every colour (no stray hex) and returns fresh objects', () => {
    for (const found of collectColours(lwcTheme)) expect(TOKEN_VALUES.has(found.value), found.path).toBe(true)
    expect(makeLwcTheme()).toEqual(lwcTheme)
    expect(makeLwcTheme().chart).not.toBe(lwcTheme.chart)
  })
})
