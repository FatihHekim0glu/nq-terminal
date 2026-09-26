// lightweight-charts v5 options for CandleChart (GP, GIP), look spec 6.3.
// Plain objects with no library import: the enum values the library expects are written out below
// (ColorType.Solid, LineStyle), so Phase 5 passes `chart` to createChart, `candle` to
// addSeries(CandlestickSeries, ...) and `volume` to addSeries(HistogramSeries, ..., volumePane.index).
import { DEFAULT_CHART_TOKENS, type ChartTokens } from './chartTokens'
import { CHART_GEOMETRY as G } from './geometry'

/** ColorType.Solid in lightweight-charts v5. */
export const LWC_COLOR_TYPE_SOLID = 'solid'

/** LineStyle in lightweight-charts v5. Dashed at width 1 draws dash 2 on 2, the grid spec. */
export const LWC_LINE_STYLE = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 } as const

type LineStyleValue = (typeof LWC_LINE_STYLE)[keyof typeof LWC_LINE_STYLE]

export interface LwcGridLines {
  readonly visible: boolean
  readonly color: string
  readonly style: LineStyleValue
}

export interface LwcCrosshairLine {
  readonly color: string
  readonly width: number
  readonly style: LineStyleValue
  readonly labelBackgroundColor: string
}

export interface LwcChartOptions {
  readonly layout: {
    readonly background: { readonly type: typeof LWC_COLOR_TYPE_SOLID; readonly color: string }
    readonly textColor: string
    readonly fontFamily: string
    readonly fontSize: number
    readonly panes: { readonly separatorColor: string; readonly separatorHoverColor: string; readonly enableResize: boolean }
  }
  readonly grid: { readonly vertLines: LwcGridLines; readonly horzLines: LwcGridLines }
  readonly rightPriceScale: { readonly visible: boolean; readonly borderVisible: boolean; readonly borderColor: string; readonly ticksVisible: boolean }
  readonly leftPriceScale: { readonly visible: boolean }
  readonly timeScale: { readonly borderVisible: boolean; readonly borderColor: string; readonly rightOffset: number }
  readonly crosshair: { readonly vertLine: LwcCrosshairLine; readonly horzLine: LwcCrosshairLine }
}

export interface LwcTheme {
  readonly chart: LwcChartOptions
  readonly candle: {
    readonly upColor: string
    readonly downColor: string
    readonly borderVisible: boolean
    readonly wickUpColor: string
    readonly wickDownColor: string
    readonly priceLineVisible: boolean
    readonly priceLineColor: string
    readonly priceLineStyle: LineStyleValue
    readonly priceLineWidth: 1
    readonly lastValueVisible: boolean
  }
  readonly volume: {
    readonly color: string
    readonly priceFormat: { readonly type: 'volume' }
    readonly lastValueVisible: boolean
    readonly priceLineVisible: boolean
  }
  readonly volumePane: { readonly index: number; readonly heightRatio: number }
  readonly volumeMa: { readonly color: string; readonly lineWidth: 1; readonly priceLineVisible: boolean; readonly lastValueVisible: boolean }
  readonly bollinger: {
    readonly upper: string
    readonly middle: string
    readonly lower: string
    readonly lineWidth: 1
    readonly periods: number
    readonly sd: number
  }
  /** Roll markers: full-height 1px yellow line with a yellow date tag and black text. */
  readonly rollMarker: { readonly color: string; readonly textColor: string }
  /** The 2022 fence: amber 1px dashed vertical line (drawn by a series primitive). */
  readonly fence: { readonly color: string; readonly width: number; readonly dash: readonly number[] }
}

const RIGHT_OFFSET_BARS = 5
const BOLLINGER_PERIODS = 20
const BOLLINGER_SD = 2

export function makeLwcTheme(tokens: ChartTokens = DEFAULT_CHART_TOKENS): LwcTheme {
  const c = tokens.color
  const gridLines = (): LwcGridLines => ({ visible: false, color: c.chartGrid, style: LWC_LINE_STYLE.Dashed })
  // House choice (best guess 9.2): no capture shows the crosshair lines; the pale cyan axis labels
  // come from one capture. The library picks the label text colour by contrast (black here).
  const cross = (): LwcCrosshairLine => ({
    color: c.chartCross, width: G.lineWidth, style: LWC_LINE_STYLE.Solid, labelBackgroundColor: c.chartCrossLabel,
  })
  return {
    chart: {
      layout: {
        background: { type: LWC_COLOR_TYPE_SOLID, color: c.bg },
        textColor: c.chartAxis,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size,
        // The library defaults (a light grey separator and a translucent hover) must never show.
        panes: { separatorColor: c.chartSplitInner, separatorHoverColor: c.chartSplitHover, enableResize: false },
      },
      grid: { vertLines: gridLines(), horzLines: gridLines() },
      rightPriceScale: { visible: true, borderVisible: true, borderColor: c.chartAxis, ticksVisible: true },
      leftPriceScale: { visible: false },
      timeScale: { borderVisible: true, borderColor: c.chartAxis, rightOffset: RIGHT_OFFSET_BARS },
      crosshair: { vertLine: cross(), horzLine: cross() },
    },
    candle: {
      upColor: c.candleUp,
      downColor: c.candleDn,
      borderVisible: false,
      wickUpColor: c.candleUp,
      wickDownColor: c.candleDn,
      priceLineVisible: true,
      priceLineColor: c.lastLine,
      priceLineStyle: LWC_LINE_STYLE.Solid,
      priceLineWidth: 1,
      lastValueVisible: true,
    },
    volume: { color: c.chartVol, priceFormat: { type: 'volume' }, lastValueVisible: true, priceLineVisible: false },
    volumePane: { index: 1, heightRatio: G.volumePaneRatio },
    volumeMa: { color: c.chartS1, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
    bollinger: { upper: c.chartMagenta, middle: c.chartS1, lower: c.chartGreen, lineWidth: 1, periods: BOLLINGER_PERIODS, sd: BOLLINGER_SD },
    rollMarker: { color: c.marker, textColor: c.bg },
    fence: { color: c.fence, width: G.lineWidth, dash: [...G.fenceDash] },
  }
}

export const lwcTheme: LwcTheme = makeLwcTheme()

/** The same theme with the dashed grid on (or off); the input is left as it was. */
export function lwcWithGrid(theme: LwcTheme, on = true): LwcTheme {
  const grid = theme.chart.grid
  return {
    ...theme,
    chart: {
      ...theme.chart,
      grid: { vertLines: { ...grid.vertLines, visible: on }, horzLines: { ...grid.horzLines, visible: on } },
    },
  }
}
