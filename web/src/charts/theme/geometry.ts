// Chart geometry shared by the three libraries and the HTML overlays (look spec 6, 6.1, 6.4).
// Pixel values at 100% scale. The option objects and chart.css use these numbers.

export const CHART_GEOMETRY = {
  /** Right value-axis gutter; labels sit 2px after the tick. */
  axisGutter: 57,
  xAxisHeight: 45,
  /** Space between the last bar and the value axis (about 2.5%). */
  rightPad: 26,
  majorTick: 6,
  minorTick: 3,
  labelGap: 2,
  /** Legend overlay: top-left, inset 6 to 12px in the reference; we use 8px. */
  legendInset: 8,
  /** The only rounded corner in the spec. */
  legendRadius: 3,
  legendSwatch: 13,
  legendColumnGap: 6,
  legendLineHeight: 16,
  /** Last-value pentagon on the value axis. */
  tagHeight: 17,
  tagArrow: 5,
  /** 5px pane splitter: 1px outer, 3px inner, 1px outer. */
  splitter: { outer: 1, inner: 3, total: 5 },
  volumePaneRatio: 0.25,
  primaryWidth: 1.5,
  lineWidth: 1,
  /** Grid when switched on: 1px, dash 2 on 2. */
  gridDash: [2, 2],
  /** House choice: a longer dash so the fence never reads as grid. */
  fenceDash: [4, 3],
  /** House choice (the spec names no dash): intraday day separators, 7.6 GIP; unlike the fence and grid. */
  dayDash: [3, 3],
  /** Compare lines 5 to 8: longer than the grid, fence and day dashes, so a dashed series is never read as one of them. */
  compareDash: [6, 3],
  /** Event-marker data tip: offset right of the pointer tip, and delay after the pointer rests. */
  datatipOffset: 15,
  datatipDelayMs: 200,
} as const

/** Range toolbar (6.4): row 1 date fields, row 2 contiguous range buttons. */
export const RANGE_TOOLBAR = {
  ranges: ['1D', '3D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'],
  intradayBars: ['1m', '5m', '1h'],
  row1Height: 22,
  row2Height: 20,
  minButtonWidth: 35,
  /** 1px black between adjacent buttons. */
  separator: 1,
  fontSize: 13,
} as const

export type Point = readonly [number, number]

/**
 * The last-value tag: a pentagon whose point touches the axis line at (axisX, y), then a box
 * `width` wide running right, CHART_GEOMETRY.tagHeight tall, centred on y.
 */
export function tagPolygon(axisX: number, y: number, width: number): Point[] {
  const half = CHART_GEOMETRY.tagHeight / 2
  const bodyX = axisX + CHART_GEOMETRY.tagArrow
  return [
    [axisX, y],
    [bodyX, y - half],
    [bodyX + width, y - half],
    [bodyX + width, y + half],
    [bodyX, y + half],
  ]
}
