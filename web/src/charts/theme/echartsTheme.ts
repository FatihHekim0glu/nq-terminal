// ECharts options for Heatmap, Distribution, BarLadder, PScatter and Swimlane (look spec 6.3).
// Plain objects with no library import. `echartsTheme` is the base to merge under each chart's own
// option; echartsPresets() gives the per-chart colours so no component writes a colour itself.
import { DEFAULT_CHART_TOKENS, type ChartTokens } from './chartTokens'
import { CHART_GEOMETRY as G } from './geometry'
import { CORR_STRONG, CORR_WEAK } from './scales'

interface LineStyle {
  readonly color: string
}

interface SplitLine {
  readonly show: boolean
  readonly lineStyle: { readonly color: string; readonly width: number; readonly type: readonly number[] }
}

export interface EchartsTheme {
  readonly backgroundColor: string
  readonly animation: boolean
  readonly textStyle: { readonly fontFamily: string; readonly fontSize: number; readonly color: string }
  readonly yAxis: {
    readonly position: 'right'
    readonly axisLine: { readonly show: boolean; readonly onZero: false; readonly lineStyle: LineStyle }
    readonly axisTick: { readonly show: boolean; readonly length: number; readonly lineStyle: LineStyle }
    readonly minorTick: { readonly show: boolean; readonly splitNumber: number; readonly length: number; readonly lineStyle: LineStyle }
    readonly splitLine: SplitLine
    readonly axisLabel: { readonly color: string; readonly margin: number }
  }
  readonly xAxis: {
    readonly axisLine: { readonly show: boolean; readonly onZero: false; readonly lineStyle: LineStyle }
    readonly axisTick: { readonly show: boolean; readonly lineStyle: LineStyle }
    readonly splitLine: SplitLine
    readonly axisLabel: { readonly color: string }
  }
  readonly legend: { readonly show: boolean }
}

/** Minor ticks halfway between major ones. */
const MINOR_SPLIT = 2

export function makeEchartsTheme(tokens: ChartTokens = DEFAULT_CHART_TOKENS): EchartsTheme {
  const c = tokens.color
  const axis = { color: c.chartAxis }
  const splitLine = (): SplitLine => ({ show: false, lineStyle: { color: c.chartGrid, width: G.lineWidth, type: [...G.gridDash] } })
  return {
    backgroundColor: c.bg,
    // House choice: every state change in the look is a hard cut, so charts do not animate either.
    animation: false,
    textStyle: { fontFamily: tokens.font.family, fontSize: tokens.font.size, color: c.chartAxis },
    yAxis: {
      position: 'right',
      // onZero off: against a value x axis (PScatter) ECharts would move the line to x = 0, the left edge.
      axisLine: { show: true, onZero: false, lineStyle: { ...axis } },
      axisTick: { show: true, length: G.majorTick, lineStyle: { ...axis } },
      minorTick: { show: true, splitNumber: MINOR_SPLIT, length: G.minorTick, lineStyle: { ...axis } },
      splitLine: splitLine(),
      // ECharts measures the margin from the axis line, not the tick end: tick plus gap (look spec 6).
      axisLabel: { color: c.chartAxis, margin: G.majorTick + G.labelGap },
    },
    xAxis: {
      // onZero off: against a value y axis (Distribution, BarLadder) ECharts would draw the baseline at
      // y = 0, mid-pane; it stays at the pane bottom (look spec 6.1). Zero lines are markLines.
      axisLine: { show: true, onZero: false, lineStyle: { ...axis } },
      axisTick: { show: true, lineStyle: { ...axis } },
      splitLine: splitLine(),
      axisLabel: { color: c.chartAxis },
    },
    // The HTML legend overlay (chart.css .chart-legend) replaces the built-in one.
    legend: { show: false },
  }
}

export const echartsTheme: EchartsTheme = makeEchartsTheme()

/** The same theme with the dotted grid on (or off); the input is left as it was. */
export function echartsWithGrid(theme: EchartsTheme, on = true): EchartsTheme {
  return {
    ...theme,
    yAxis: { ...theme.yAxis, splitLine: { ...theme.yAxis.splitLine, show: on } },
    xAxis: { ...theme.xAxis, splitLine: { ...theme.xAxis.splitLine, show: on } },
  }
}

export interface CorrPiece {
  readonly lt?: number
  readonly lte?: number
  readonly gt?: number
  readonly gte?: number
  readonly color: string
}

/** Per-chart colours (6.3, 7.5, 7.8, 7.10). */
export function echartsPresets(tokens: ChartTokens = DEFAULT_CHART_TOKENS) {
  const c = tokens.color
  const corrPieces: readonly CorrPiece[] = [
    { lt: -CORR_STRONG, color: c.corrDn2 },
    { gte: -CORR_STRONG, lte: -CORR_WEAK, color: c.corrDn1 },
    { gt: -CORR_WEAK, lt: CORR_WEAK, color: c.corr0 },
    { gte: CORR_WEAK, lte: CORR_STRONG, color: c.corrUp1 },
    { gt: CORR_STRONG, color: c.corrUp2 },
  ]
  return {
    /** CORR: visualMap type 'piecewise' with these pieces; the diagonal cell is set per item. */
    corr: { pieces: corrPieces, diagonal: c.corrDiag, label: { color: c.white } },
    /** Signed bars with white confidence whiskers. */
    barLadder: { pos: c.barPos, neg: c.barNeg, whisker: c.white },
    /** Sorted p against rank: white points; Bonferroni, Holm and BH lines, each with a text label. */
    pScatter: { point: c.white, bonferroni: c.chartMagenta, holm: c.chartGreen, bh: c.accent2 },
    /** RET: signed bars, fitted normal curve and its mean and sigma lines; VaR and CVaR lines amber. */
    distribution: { pos: c.barPos, neg: c.barNeg, curve: c.distCurve, risk: c.data },
    /** OOS timeline: amber lane labels, yellow sealed reads. */
    swimlane: { label: c.data, sealed: c.marker },
    fence: { color: c.fence, width: G.lineWidth, type: [...G.fenceDash] },
  } as const
}
