// uPlot options for one LineStack pane (look spec 6.3), built from the charts theme: axes, padding
// and fonts from makeUplotTheme, series styles from lineStackSeries, colours from the chart tokens.
// The hooks draw what uPlot has no option for: the zero line, the OOS fence, 3px minor ticks, the
// two-row time axis and the last-value tags. uPlot writes into its options, so this returns a fresh
// object every call. The uPlot import is type-only (the library itself comes from lazy.ts).
import type uPlot from 'uplot'
import { FENCE } from '../copy/lineStack'
import { drawFence, fenceCanvasX, fenceStyle, pixelRatio } from './fence'
import { drawMinorYTicks, drawTags, drawTimeAxis, drawZeroLine, labelLeavesCanvas, lastValueTags, tagBlocksLabel, type Tag } from './LineStack.draw'
import { yRange, type Values } from './LineStack.model'
import { formatAxisValue, linearTicks, logTicks, timeAxisLayout, type TimeAxisLayout } from './LineStack.time'
import type { LineStackPane, LineStackSeries } from './LineStack.types'
import { lineStackSeries, makeUplotTheme, type ChartTokens } from './theme'

export interface PaneDrawInfo {
  /** The fence's x in CSS pixels from the plot's left edge, or null when it is out of view. */
  readonly fenceX: number | null
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

function seriesOptions(s: LineStackSeries, styles: Styles): uPlot.Series {
  const base = { label: s.name, spanGaps: false, points: { show: false } }
  switch (s.style) {
    case 'primary': {
      const { stroke, width, fill } = styles.primary
      // Look spec 6.2: a flat area down to the pane bottom.
      return { ...base, stroke, width, fill, fillTo: (u: uPlot) => u.scales.y?.min ?? 0 }
    }
    case 'underwater': {
      const { stroke, width, fill } = styles.underwater
      return { ...base, stroke, width, fill, fillTo: 0 }
    }
    case 'perfDiff': {
      const { stroke, width, fillPos, fillNeg } = styles.perfDiff
      return { ...base, stroke, width, fill: signedFill(fillPos, fillNeg), fillTo: 0 }
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
  // Time labels stop at the view's end: none in the padding past the fence.
  const layoutOf = (u: uPlot) => {
    const min = u.scales.x?.min ?? 0
    const max = u.scales.x?.max ?? 0
    const end = Math.min(max, b.view()[1])
    return timeAxisLayout(min, end, (u.bbox.width / b.pxRatio) * ((end - min) / (max - min || 1)))
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
  }
  const draw = (u: uPlot) => {
    // After the series (uPlot runs drawAxes before them), so an area fill never covers the zero line.
    if (zeroColour !== null) drawZeroLine(u, zeroColour)
    const fenceX = b.fence === null ? null : fenceCanvasX(u, b.fence)
    if (b.fence !== null) drawFence(u, fenceStyle(b.tokens, b.showFenceLabel ? FENCE.label : null), b.fence)
    drawMinorYTicks(u, splitsY, c.chartAxis)
    if (b.isBottom) drawTimeAxis(u, layoutOf(u), { axis: c.chartAxis, divider: c.chartYearDiv, font: b.tokens.font })
    drawTags(u, computeTags(u), b.tokens.font)
    b.onDraw?.(u, { fenceX: fenceX === null ? null : (fenceX - u.bbox.left) / pixelRatio(u) })
  }
  return { yAxis, layoutOf, draw }
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
      y: { auto: true, distr: logOn ? 3 : 1, ...(logOn ? { log: 10 as const } : {}), range: (_u, min, max) => yRange(min, max, logOn) },
    },
    axes: [timeAxis(theme, b, decor.layoutOf), decor.yAxis],
    series: [{}, ...b.pane.series.map((s) => seriesOptions(s, styles))],
    hooks: {
      draw: [decor.draw],
      setCursor: b.onCursor ? [b.onCursor] : [],
      setScale: b.onScale ? [(u, key) => key === 'x' && b.onScale!(u)] : [],
    },
    plugins: [b.sync.plugin],
  }
}
