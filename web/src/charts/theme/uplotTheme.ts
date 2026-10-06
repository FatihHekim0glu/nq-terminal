// uPlot options for LineStack (EQ, DD, RR and the rolling panes), look spec 6.3.
// Plain objects with no library import. uPlot writes into the options it is given, so build a fresh
// theme per chart with makeUplotTheme(readChartTokens(), linkGroup); `uplotTheme` is the default
// snapshot for reference and tests.
import { forcedDash } from './chartContrast'
import { DEFAULT_CHART_TOKENS, canvasFont, seriesColor, type ChartTokens } from './chartTokens'
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

/**
 * Under forced colours (chartContrast.ts) a series that differs from its neighbours only by colour
 * gets the dash for its position as a second cue; in every other mode the style is returned as it is.
 */
function cue<T extends { readonly stroke: string; readonly width: number }>(
  style: T, tokens: ChartTokens, position: number,
): T & { readonly dash?: readonly number[] } {
  const dash = forcedDash(tokens, position)
  return dash !== undefined && dash.length > 0 ? { ...style, dash } : style
}

/** Series styles for the LineStack panes (6.2, 7.5). */
export function lineStackSeries(tokens: ChartTokens = DEFAULT_CHART_TOKENS) {
  const c = tokens.color
  const w = G.lineWidth
  return {
    primary: { stroke: c.chartS1, width: G.primaryWidth, fill: c.chartArea },
    benchmark: cue({ stroke: c.accent2, width: G.primaryWidth }, tokens, 1),
    /** EQ lower pane: area from 0, green above, dark red below; the white outline carries the shape. */
    perfDiff: { stroke: c.chartS1, width: w, fillPos: c.perfPos, fillNeg: c.perfNeg },
    /** DD lower pane: underwater area from 0 downward. */
    underwater: { stroke: c.chartS1, width: w, fill: c.perfNeg },
    /** House rule kept from UI_SPEC: an honest solid zero line on EQ and DD. */
    zero: { stroke: c.chartS1, width: w },
    /** RR: 63-session and 252-session rolling Sharpe over a grey zero line; rolling volatility. */
    rollShort: { stroke: c.chartS1, width: G.primaryWidth },
    rollLong: cue({ stroke: c.accent2, width: G.primaryWidth }, tokens, 1),
    rollZero: { stroke: c.zeroLine, width: w },
    rollVol: cue({ stroke: c.rollVol, width: G.primaryWidth }, tokens, 2),
    /** RR: the ends of the full-sample bootstrap interval (SV5), thin amber dashes. */
    ciBound: { stroke: c.data, width: w, dash: [...G.fenceDash] },
    fence: { stroke: c.fence, width: w, dash: [...G.fenceDash] },
    /** Compare baskets (RUNS, REG): line N in seriesColor(N - 1); 5 to 8 also dashed, so colour is not the only cue. */
    compare1: compareSolid(0, tokens),
    compare2: compareSolid(1, tokens),
    compare3: compareSolid(2, tokens),
    compare4: compareSolid(3, tokens),
    compare5: compareDashed(4, tokens),
    compare6: compareDashed(5, tokens),
    compare7: compareDashed(6, tokens),
    compare8: compareDashed(7, tokens),
  } as const
}

function compareSolid(index: number, tokens: ChartTokens) {
  return cue({ stroke: seriesColor(index, tokens), width: G.primaryWidth }, tokens, index)
}

function compareDashed(index: number, tokens: ChartTokens) {
  return { stroke: seriesColor(index, tokens), width: G.primaryWidth, dash: forcedDash(tokens, index) ?? [...G.compareDash] }
}
