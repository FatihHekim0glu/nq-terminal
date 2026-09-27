// uPlot options for LineStack (EQ, DD, RR and the rolling panes), look spec 6.3.
// Plain objects with no library import. uPlot writes into the options it is given, so build a fresh
// theme per chart with makeUplotTheme(readChartTokens(), linkGroup); `uplotTheme` is the default
// snapshot for reference and tests.
import { DEFAULT_CHART_TOKENS, canvasFont, type ChartTokens } from './chartTokens'
import { CHART_GEOMETRY as G } from './geometry'

export interface UplotGrid {
  readonly show: boolean
  readonly stroke: string
  readonly width: number
  readonly dash: readonly number[]
}

export interface UplotAxis {
  readonly scale?: string
  readonly side: number
  readonly size: number
  readonly gap?: number
  readonly stroke: string
  readonly font: string
  readonly border: { readonly show: boolean; readonly stroke: string; readonly width: number }
  readonly grid: UplotGrid
  readonly ticks: { readonly show: boolean; readonly stroke: string; readonly width: number; readonly size: number }
}

export interface UplotSeriesStyle {
  readonly stroke?: string
  readonly width?: number
  readonly fill?: string
}

export interface UplotCursor {
  readonly sync?: { readonly key: string }
  readonly points: { readonly show: boolean }
}

export interface UplotTheme {
  readonly axes: readonly UplotAxis[]
  readonly padding: readonly [number, number, number, number]
  readonly series: readonly UplotSeriesStyle[]
  readonly legend: { readonly show: boolean }
  readonly cursor: UplotCursor
}

const SIDE_BOTTOM = 2
const SIDE_RIGHT = 1

export function makeUplotTheme(tokens: ChartTokens = DEFAULT_CHART_TOKENS, syncKey?: string): UplotTheme {
  const c = tokens.color
  const font = canvasFont(tokens)
  const grid = (): UplotGrid => ({ show: false, stroke: c.chartGrid, width: G.lineWidth, dash: [...G.gridDash] })
  const ticks = () => ({ show: true, stroke: c.chartAxis, width: G.lineWidth, size: G.majorTick })
  // 6.1: a white 1px baseline on the time axis; 6.3: a white 1px axis line on the right.
  const border = () => ({ show: true, stroke: c.chartAxis, width: G.lineWidth })
  return {
    axes: [
      { side: SIDE_BOTTOM, stroke: c.chartAxis, size: G.xAxisHeight, font, border: border(), grid: grid(), ticks: ticks() },
      {
        scale: 'y', side: SIDE_RIGHT, size: G.axisGutter, gap: G.labelGap, stroke: c.chartAxis, font,
        border: border(), grid: grid(), ticks: ticks(),
      },
    ],
    padding: [8, G.rightPad, 0, 8],
    series: [
      {},
      { stroke: c.chartS1, width: G.primaryWidth, fill: c.chartArea },
      { stroke: c.accent2, width: G.primaryWidth },
    ],
    // The HTML legend overlay (chart.css .chart-legend) replaces the built-in one.
    legend: { show: false },
    cursor: syncKey === undefined ? { points: { show: false } } : { sync: { key: syncKey }, points: { show: false } },
  }
}

export const uplotTheme: UplotTheme = makeUplotTheme()

/** The same theme with the dotted grid on (or off); the input is left as it was. */
export function uplotWithGrid(theme: UplotTheme, on = true): UplotTheme {
  return { ...theme, axes: theme.axes.map((a) => ({ ...a, grid: { ...a.grid, show: on } })) }
}

/** Series styles for the LineStack panes (6.2, 7.5). */
export function lineStackSeries(tokens: ChartTokens = DEFAULT_CHART_TOKENS) {
  const c = tokens.color
  const w = G.lineWidth
  return {
    primary: { stroke: c.chartS1, width: G.primaryWidth, fill: c.chartArea },
    benchmark: { stroke: c.accent2, width: G.primaryWidth },
    /** EQ lower pane: area from 0, green above, dark red below; the white outline carries the shape. */
    perfDiff: { stroke: c.chartS1, width: w, fillPos: c.perfPos, fillNeg: c.perfNeg },
    /** DD lower pane: underwater area from 0 downward. */
    underwater: { stroke: c.chartS1, width: w, fill: c.perfNeg },
    /** House rule kept from UI_SPEC: an honest solid zero line on EQ and DD. */
    zero: { stroke: c.chartS1, width: w },
    /** RR: 63-session and 252-session rolling Sharpe over a grey zero line; rolling volatility. */
    rollShort: { stroke: c.chartS1, width: G.primaryWidth },
    rollLong: { stroke: c.accent2, width: G.primaryWidth },
    rollZero: { stroke: c.zeroLine, width: w },
    rollVol: { stroke: c.rollVol, width: G.primaryWidth },
    /** RR: the ends of the full-sample bootstrap interval (SV5), thin amber dashes. */
    ciBound: { stroke: c.data, width: w, dash: [...G.fenceDash] },
    fence: { stroke: c.fence, width: w, dash: [...G.fenceDash] },
  } as const
}
