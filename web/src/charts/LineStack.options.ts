// uPlot options for one LineStack pane (look spec 6.3), built from the charts theme: axes, padding
// and fonts from makeUplotTheme, series styles from lineStackSeries, colours from the chart tokens.
// The hooks draw what uPlot has no option for: the zero line, the OOS fence, 3px minor ticks, the
// two-row time axis and the last-value tags. uPlot writes into its options, so this returns a fresh
// object every call. The uPlot import is type-only (the library itself comes from lazy.ts).
import type uPlot from 'uplot'
import { FENCE } from '../copy/lineStack'
import { drawFence, fenceCanvasX, fenceStyle, pixelRatio } from './fence'
import { drawCallouts, drawMinorYTicks, drawTags, drawTimeAxis, drawZeroLine, labelLeavesCanvas, lastValueTags, tagBlocksLabel, valueAxisSize, type SharedGutter, type Tag } from './LineStack.draw'
import { visibleIndexRange, yRange, yRangeClearOfLegend, type Values } from './LineStack.model'
import { MIN_LABEL_PX, formatAxisValue, isDailyAxis, linearTicks, logTicks, timeAxisLayout, type TimeAxisLayout } from './LineStack.time'
import type { LineStackPane, LineStackSeries } from './LineStack.types'
import { lineStackSeries, makeUplotTheme, type ChartTokens } from './theme'

export interface PaneDrawInfo {
  /** The fence's x in CSS pixels from the plot's left edge, or null when it is out of view. */
  readonly fenceX: number | null
}

/** A box in CSS pixels from the pane element's top-left corner. */
export interface PaneBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface PaneSync {
  readonly cursorSync: uPlot.Cursor.Sync | undefined
  readonly plugin: uPlot.Plugin
}

export interface PaneBuild {
  readonly pane: LineStackPane
  /** The pane's series values, cleaned (gaps are null), in series order. */
  readonly data: readonly Values[]
  readonly t: readonly number[]
  readonly isBottom: boolean
  readonly showFenceLabel: boolean
  readonly tokens: ChartTokens
  readonly width: number
  readonly height: number
  readonly log: boolean
  /** The stack's current x window; every pane reads the same one. */
  readonly view: () => readonly [number, number]
  readonly sync: PaneSync
  readonly fence: number | null
  /** uPlot.pxRatio: canvas pixels per CSS pixel. The canvas is not sized yet when the axes are laid out. */
  readonly pxRatio: number
  readonly onDraw?: (u: uPlot, info: PaneDrawInfo) => void
  readonly onCursor?: (u: uPlot) => void
  readonly onScale?: (u: uPlot) => void
  /** Where the pane's HTML legend sits, so the value range can keep the curve out from under it. */
  readonly legendBox?: () => PaneBox | null
  /** The stack's shared value-axis width and this pane's index in it; alone, a pane sizes itself. */
  readonly gutter?: { readonly shared: SharedGutter; readonly index: number }
}

type Styles = ReturnType<typeof lineStackSeries>

/** Look spec 6: about 2.5% of the window between the last bar and the value axis. */
export const RIGHT_PAD_FRACTION = 0.025

/** The x scale for a view: the view plus the right padding, so the fence sits inside the plot. */
function paddedView(view: readonly [number, number]): [number, number] {
  return [view[0], view[1] + (view[1] - view[0]) * RIGHT_PAD_FRACTION]
}

function seriesColour(styles: Styles, s: LineStackSeries): string {
  return styles[s.style].stroke
}

/** Fill above zero in `pos` and below in `neg`: a hard colour stop at the zero line. */
function signedFill(pos: string, neg: string): uPlot.Series.Fill {
  return (u) => {
    const { ctx, bbox } = u
    const at = Math.min(1, Math.max(0, (u.valToPos(0, 'y', true) - bbox.top) / bbox.height))
    const g = ctx.createLinearGradient(0, bbox.top, 0, bbox.top + bbox.height)
    g.addColorStop(0, pos)
    g.addColorStop(at, pos)
    g.addColorStop(at, neg)
    g.addColorStop(1, neg)
    return g
  }
}

/** 'area' is the primary series' fill alone, 'line' its stroke alone; 'whole' is a series as it is. */
type SeriesPart = 'whole' | 'area' | 'line'

interface DrawStep {
  readonly index: number
  readonly part: SeriesPart
}

/** The white series a pane is about: the equity curve, or the underwater curve of a drawdown pane. */
const LEAD_STYLES: ReadonlySet<LineStackSeries['style']> = new Set(['primary', 'underwater'])

/**
 * The order uPlot draws a pane's series in (it draws by index). The lead series is split: its area
 * first, under every line, and its line last, so a benchmark that runs close to it never covers the
 * series the screen is about. A pane without a lead series, or with only one series, keeps its order.
 */
function drawOrder(pane: LineStackPane): readonly DrawStep[] {
  const p = pane.series.findIndex((s) => LEAD_STYLES.has(s.style))
  const whole = pane.series.map((_, index): DrawStep => ({ index, part: 'whole' }))
  if (p === -1 || pane.series.length < 2) return whole
  return [{ index: p, part: 'area' }, ...whole.filter((d) => d.index !== p), { index: p, part: 'line' }]
}

/** uPlot's data for a pane: the times, then each series' values in draw order. */
export function paneUplotData<T>(t: T, pane: LineStackPane, values: readonly T[]): T[] {
  return [t, ...drawOrder(pane).map((d) => values[d.index]!)]
}

function seriesOptions(s: LineStackSeries, styles: Styles, part: SeriesPart = 'whole'): uPlot.Series {
  const base = { label: s.name, spanGaps: false, points: { show: false } }
  switch (s.style) {
    case 'primary': {
      const { stroke, width, fill } = styles.primary
      if (part === 'line') return { ...base, stroke, width }
      // Look spec 6.2: a flat area down to the pane bottom.
      const fillTo = (u: uPlot) => u.scales.y?.min ?? 0
      if (part === 'area') return { ...base, stroke, width: 0, fill, fillTo }
      return { ...base, stroke, width, fill, fillTo }
    }
    case 'underwater': {
      const { stroke, width, fill } = styles.underwater
      if (part === 'line') return { ...base, stroke, width }
      return { ...base, stroke, width: part === 'area' ? 0 : width, fill, fillTo: 0 }
    }
    case 'perfDiff': {
      const { stroke, width, fillPos, fillNeg } = styles.perfDiff
      return { ...base, stroke, width, fill: signedFill(fillPos, fillNeg), fillTo: 0 }
    }
    case 'ciBound': {
      const { stroke, width, dash } = styles.ciBound
      return { ...base, stroke, width, dash: [...dash] }
    }
    default: {
      const { stroke, width } = styles[s.style]
      return { ...base, stroke, width }
    }
  }
}


function isArithmetic(splits: readonly number[]): boolean {
  if (splits.length < 3) return true
  const d = splits[1]! - splits[0]!
  return splits.every((v, i) => i === 0 || Math.abs(v - splits[i - 1]! - d) <= Math.abs(d) * 1e-6)
}

/** The x axis: uPlot draws the baseline and the 6px major ticks; the labels are drawn in the draw hook. */
function timeAxis(theme: ReturnType<typeof makeUplotTheme>, b: PaneBuild, layoutOf: (u: uPlot) => TimeAxisLayout): uPlot.Axis {
  return {
    ...(structuredClone(theme.axes[0]) as uPlot.Axis),
    show: b.isBottom,
    splits: (u) => [...layoutOf(u).majors],
    values: (_u, splits) => splits.map(() => null),
  }
}

interface PaneDecor {
  readonly yAxis: uPlot.Axis
  readonly layoutOf: (u: uPlot) => TimeAxisLayout
  readonly draw: (u: uPlot) => void
}

/**
 * The value axis and the draw hook of one pane. They share the last splits and tags: the axis lays
 * them out (hiding labels under a tag) and the draw hook adds minor ticks, the time axis and the tags.
 */
function paneDecor(b: PaneBuild, theme: ReturnType<typeof makeUplotTheme>, logOn: boolean): PaneDecor {
  const c = b.tokens.color
  const unit = b.pane.unit ?? ''
  const styles = lineStackSeries(b.tokens)
  const tagSeries = b.pane.series.map((s, i) => ({ values: b.data[i] ?? [], colour: seriesColour(styles, s) }))
  const zeroColour = b.pane.zero === 'white' ? styles.zero.stroke : b.pane.zero === 'grey' ? styles.rollZero.stroke : null
  let tags: Tag[] = []
  let splitsY: number[] = []
  const computeTags = (u: uPlot) => {
    tags = lastValueTags(u, b.t, tagSeries, b.pane.decimals ?? 2, unit, b.pane.signed === true, b.tokens, b.pxRatio)
    return tags
  }
  // Time labels stop at the view's end: none in the padding past the fence. Daily data never shows clock times.
  const daily = isDailyAxis(b.t)
  const layoutOf = (u: uPlot) => {
    const min = u.scales.x?.min ?? 0
    const max = u.scales.x?.max ?? 0
    const end = Math.min(max, b.view()[1])
    return timeAxisLayout(min, end, (u.bbox.width / b.pxRatio) * ((end - min) / (max - min || 1)), MIN_LABEL_PX, daily)
  }
  const yAxis: uPlot.Axis = {
    ...(structuredClone(theme.axes[1]) as uPlot.Axis),
    splits: (u, _i, min, max) => (splitsY = (logOn ? logTicks : linearTicks)(min, max, u.bbox.height / b.pxRatio)),
    values: (u, splits) => {
      computeTags(u)
      const step = isArithmetic(splits) && splits.length > 1 ? Math.abs(splits[1]! - splits[0]!) : null
      const hidden = (v: number) => tagBlocksLabel(u, tags, v, b.tokens.font, b.pxRatio) || labelLeavesCanvas(u, v, b.tokens.font, b.pxRatio)
      return splits.map((v) => (hidden(v) ? null : formatAxisValue(v, step ?? v, unit)))
    },
    // uPlot calls size after values, so the tags of this layout are known here.
    size: (u, values) => {
      const need = valueAxisSize(u, values ?? [], tags, b.tokens.font, b.pxRatio)
      return b.gutter ? b.gutter.shared(b.gutter.index, need) : need
    },
  }
  const draw = (u: uPlot) => {
    // After the series (uPlot runs drawAxes before them), so an area fill never covers the zero line.
    if (zeroColour !== null) drawZeroLine(u, zeroColour)
    const fenceX = b.fence === null ? null : fenceCanvasX(u, b.fence)
    if (b.fence !== null) drawFence(u, fenceStyle(b.tokens, b.showFenceLabel ? FENCE.label : null), b.fence)
    drawMinorYTicks(u, splitsY, c.chartAxis)
    if (b.isBottom) drawTimeAxis(u, layoutOf(u), { axis: c.chartAxis, divider: c.chartYearDiv, font: b.tokens.font })
    drawTags(u, computeTags(u), b.tokens.font)
    if (b.pane.callouts) drawCallouts(u, b.pane.callouts, styles.primary.stroke, b.tokens.font)
    b.onDraw?.(u, { fenceX: fenceX === null ? null : (fenceX - u.bbox.left) / pixelRatio(u) })
  }
  return { yAxis, layoutOf, draw }
}

/** The gap in CSS pixels kept between the legend's edge and the curve. */
const LEGEND_GAP_PX = 2

/** Highest value of any series between indexes i0 and i1, or null when all are gaps. */
function peakIn(data: readonly Values[], i0: number, i1: number): number | null {
  let peak: number | null = null
  for (const v of data) {
    for (let i = i0; i <= i1; i += 1) {
      const x = v[i]
      if (x !== null && x !== undefined && (peak === null || x > peak)) peak = x
    }
  }
  return peak
}

/**
 * The y range with room above the curve where it runs under the legend (look spec 6.1). The plot box
 * comes from uPlot once it is laid out, and from the options before that. An underwater pane peaks at
 * its zero line, which may pass under the legend, so it keeps the plain range.
 */
function legendClearRange(u: uPlot | null, b: PaneBuild, range: [number, number], logOn: boolean, theme: ReturnType<typeof makeUplotTheme>): [number, number] {
  const box = b.legendBox?.() ?? null
  if (box === null || box.width <= 0 || box.height <= 0 || u === null) return range
  if (b.pane.series.some((s) => s.style === 'underwater')) return range
  const pr = b.pxRatio
  const padding = theme.padding
  const laidOut = (u.bbox?.height ?? 0) > 0 && (u.bbox?.width ?? 0) > 0
  const plotTop = laidOut ? u.bbox.top / pr : padding[0]!
  const plotLeft = laidOut ? u.bbox.left / pr : padding[3]!
  const plotH = laidOut ? u.bbox.height / pr : b.height - padding[0]! - padding[2]! - (b.isBottom ? theme.axes[0]!.size : 0)
  const plotW = laidOut ? u.bbox.width / pr : b.width - padding[1]! - padding[3]! - theme.axes[1]!.size
  const below = box.top + box.height + LEGEND_GAP_PX - plotTop
  const right = box.left + box.width + LEGEND_GAP_PX - plotLeft
  if (plotH <= 0 || plotW <= 0 || below <= 0 || right <= 0) return range
  const [x0, x1] = paddedView(b.view())
  const span = visibleIndexRange(b.t, x0, x0 + (x1 - x0) * Math.min(1, right / plotW))
  const peak = span === null ? null : peakIn(b.data, span[0], span[1])
  return yRangeClearOfLegend(range, peak, below / plotH, logOn)
}

export function paneOptions(b: PaneBuild): uPlot.Options {
  const theme = makeUplotTheme(b.tokens)
  const styles = lineStackSeries(b.tokens)
  const logOn = b.log && b.pane.logAllowed === true
  const decor = paneDecor(b, theme, logOn)
  return {
    width: b.width,
    height: b.height,
    padding: [...theme.padding] as uPlot.Padding,
    legend: { show: false },
    cursor: {
      ...(b.sync.cursorSync ? { sync: b.sync.cursorSync } : {}),
      points: { show: false },
      drag: { x: false, y: false, setScale: false },
    },
    scales: {
      x: { time: true, range: () => paddedView(b.view()) },
      y: {
        auto: true,
        distr: logOn ? 3 : 1,
        ...(logOn ? { log: 10 as const } : {}),
        range: (u, min, max) => legendClearRange(u, b, yRange(min, max, logOn), logOn, theme),
      },
    },
    axes: [timeAxis(theme, b, decor.layoutOf), decor.yAxis],
    series: [{}, ...drawOrder(b.pane).map((d) => seriesOptions(b.pane.series[d.index]!, styles, d.part))],
    hooks: {
      draw: [decor.draw],
      setCursor: b.onCursor ? [b.onCursor] : [],
      setScale: b.onScale ? [(u, key) => key === 'x' && b.onScale!(u)] : [],
    },
    plugins: [b.sync.plugin],
  }
}
