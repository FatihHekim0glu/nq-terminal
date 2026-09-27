// Series primitives CandleChart draws with (look spec 6.1, 6.3; UI_SPEC section 6):
//   - the fence: an amber 1px dashed vertical line at 2022-01-01 across each pane, labelled
//     "IS | 2022+ SPENT" in the price pane (the line itself is the bar between the two words);
//   - roll markers: a full-height 1px yellow line per roll (the square yellow date tags sit in the
//     second axis row, CandleChart.model withRollTags);
//   - day separators (intraday only, look spec 7.6 GIP): a full-height 1px grey dashed line between
//     sessions, behind the bars;
//   - the last-value tag: a pentagon on the value axis, 17px tall with its 5px point at the axis
//     line, filled with the series colour, text black or white by contrast, clearing the tick
//     labels it touches so it replaces the label at that height; on candles also the 1px last-price line from the
//     last bar to the axis.
// Colours, widths and dashes come from the theme (makeLwcTheme) and the chart tokens; nothing here
// writes a colour of its own. Only types come from the library (erased), so this file adds no
// library code to any chunk.
import type {
  IPrimitivePaneRenderer,
  ISeriesPrimitive,
  IPrimitivePaneView,
  Logical,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import { CHART_GEOMETRY as G, tagPolygon, textOn, type ChartTokens, type LwcTheme } from './theme'

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0]
type Attached = SeriesAttachedParameter<Time>

/** Pixels between the fence line and each word of its label. */
const FENCE_LABEL_GAP = 4
const FENCE_LABEL_TOP = 4

/**
 * x of a bar-index position. lightweight-charts 5.2.1 maps only whole indexes (any other gives 0),
 * so a position between bars, like the fence, is interpolated between its two neighbours.
 */
function logicalX(param: Attached | null, logical: number | null): number | null {
  if (param === null || logical === null) return null
  const scale = param.chart.timeScale()
  const k = Math.floor(logical)
  const a = scale.logicalToCoordinate(k as Logical)
  if (a === null || k === logical) return a
  const b = scale.logicalToCoordinate((k + 1) as Logical)
  return b === null ? null : a + (logical - k) * (b - a)
}

/** A crisp vertical line the full height of the pane at media x. */
function verticalLine(target: Target, x: number, colour: string, width: number, dash: readonly number[]): void {
  target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
    const w = Math.max(1, Math.floor(width * hpr))
    const bx = Math.round(x * hpr) + (w % 2 === 1 ? 0.5 : 0)
    ctx.save()
    ctx.strokeStyle = colour
    ctx.lineWidth = w
    ctx.setLineDash(dash.map((d) => d * vpr))
    ctx.beginPath()
    ctx.moveTo(bx, 0)
    ctx.lineTo(bx, bitmapSize.height)
    ctx.stroke()
    ctx.restore()
  })
}

function paneView(draw: (target: Target) => void, zOrder: 'bottom' | 'normal' | 'top' = 'normal'): IPrimitivePaneView {
  const renderer: IPrimitivePaneRenderer = { draw }
  return { zOrder: () => zOrder, renderer: () => renderer }
}

export interface FenceLabel {
  readonly before: string
  readonly after: string
  readonly font: string
}

export interface FenceOptions {
  /** Bar-index position of the fence (CandleChart.model fenceLogical), or null for none. */
  readonly logical: number | null
  readonly style: LwcTheme['fence']
  /** Only the price pane carries the label. */
  readonly label?: FenceLabel
}

function drawFenceLabel(target: Target, x: number, colour: string, label: FenceLabel): void {
  target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
    ctx.save()
    ctx.font = label.font
    ctx.fillStyle = colour
    ctx.textBaseline = 'top'
    ctx.textAlign = 'right'
    const fits = x + FENCE_LABEL_GAP + ctx.measureText(label.after).width <= mediaSize.width
    if (fits) {
      ctx.fillText(label.before, x - FENCE_LABEL_GAP, FENCE_LABEL_TOP)
      ctx.textAlign = 'left'
      ctx.fillText(label.after, x + FENCE_LABEL_GAP, FENCE_LABEL_TOP)
    } else {
      // No room right of the line (data that stops at the fence): the whole label goes left of it.
      ctx.fillText(`${label.before} | ${label.after}`, x - FENCE_LABEL_GAP, FENCE_LABEL_TOP)
    }
    ctx.restore()
  })
}

export function fencePrimitive(opts: FenceOptions): ISeriesPrimitive<Time> {
  let param: Attached | null = null
  const views = [paneView((target) => {
    const x = logicalX(param, opts.logical)
    if (x === null) return
    verticalLine(target, x, opts.style.color, opts.style.width, opts.style.dash)
    if (opts.label) drawFenceLabel(target, x, opts.style.color, opts.label)
  }, 'top')]
  return {
    attached: (p) => { param = p },
    detached: () => { param = null },
    paneViews: () => views,
  }
}

export interface RollMark {
  readonly index: number
  /** The date tag on the time axis. */
  readonly label: string
}

export interface RollOptions {
  readonly rolls: readonly RollMark[]
  readonly style: LwcTheme['rollMarker']
}

export function rollPrimitive(opts: RollOptions): ISeriesPrimitive<Time> {
  let param: Attached | null = null
  const views = [paneView((target) => {
    for (const r of opts.rolls) {
      const x = logicalX(param, r.index)
      if (x !== null) verticalLine(target, x, opts.style.color, G.lineWidth, [])
    }
  })]
  return {
    attached: (p) => { param = p },
    detached: () => { param = null },
    paneViews: () => views,
  }
}

export interface DaySeparatorOptions {
  /** Bar-index positions between sessions (CandleChart.model daySeparators). */
  readonly positions: readonly number[]
  readonly style: LwcTheme['daySeparator']
}

export function daySeparatorPrimitive(opts: DaySeparatorOptions): ISeriesPrimitive<Time> {
  let param: Attached | null = null
  const views = [paneView((target) => {
    for (const at of opts.positions) {
      const x = logicalX(param, at)
      if (x !== null) verticalLine(target, x, opts.style.color, opts.style.width, opts.style.dash)
    }
  }, 'bottom')]
  return {
    attached: (p) => { param = p },
    detached: () => { param = null },
    paneViews: () => views,
  }
}

export interface TagValue {
  readonly value: number
  readonly fill: string
  readonly text: string
  /** The bar the value belongs to (the last-price line starts there). */
  readonly index?: number
}

export interface TagOptions {
  /** The value to tag now (read at draw time), or null for no tag. */
  readonly value: () => TagValue | null
  readonly font: string
  readonly tokens: ChartTokens
  /** Also draw a 1px line in this colour from the tagged bar to the axis (the candles' last price). */
  readonly line?: string
}

/** Clear space kept around the tag: a label this close counts as touching it. */
const TAG_CLEARANCE = 2
/** A channel above this on the black axis is label ink (anti-aliased text included). */
const INK_MIN = 24

/** Runs of consecutive inked rows, as [first, last] row indexes. */
export function inkRuns(ink: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = []
  ink.forEach((on, i) => {
    if (!on) return
    const last = runs[runs.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  })
  return runs
}

/**
 * The tag replaces the tick label at its height (look spec 6.1): every label the tag touches is
 * cleared whole, found by its ink in the label column right of the ticks. The tag draws in the
 * normal order, on the axis canvas just after the tick labels, so the ink is there to read.
 */
function clearTouchedLabels(target: Target, y: number, opts: TagOptions): void {
  target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
    if (typeof ctx.getImageData !== 'function') return
    const x0 = Math.ceil((G.majorTick + 1) * hpr)
    const width = bitmapSize.width - x0
    const box = (G.tagHeight / 2 + TAG_CLEARANCE) * vpr
    const reach = box + (opts.tokens.font.size + 1) * vpr
    const top = Math.max(0, Math.floor(y * vpr - reach))
    const bottom = Math.min(bitmapSize.height, Math.ceil(y * vpr + reach))
    if (width <= 0 || bottom <= top) return
    const { data } = ctx.getImageData(x0, top, width, bottom - top)
    const ink = Array.from({ length: bottom - top }, (_, r) => {
      for (let i = r * width * 4; i < (r + 1) * width * 4; i += 4) {
        if (data[i]! > INK_MIN || data[i + 1]! > INK_MIN || data[i + 2]! > INK_MIN) return true
      }
      return false
    })
    ctx.fillStyle = opts.tokens.color.bg
    for (const [a, b] of inkRuns(ink)) {
      if (top + b + 1 > y * vpr - box && top + a < y * vpr + box) ctx.fillRect(x0, top + a - 1, width, b - a + 3)
    }
  })
}

function drawTag(target: Target, y: number, tag: TagValue, opts: TagOptions): void {
  clearTouchedLabels(target, y, opts)
  target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
    const points = tagPolygon(0, y, mediaSize.width - G.tagArrow)
    ctx.save()
    ctx.fillStyle = tag.fill
    ctx.beginPath()
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)))
    ctx.closePath()
    ctx.fill()
    ctx.font = opts.font
    ctx.fillStyle = textOn(tag.fill, opts.tokens)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(tag.text, G.tagArrow + G.labelGap, y)
    ctx.restore()
  })
}

/** A crisp horizontal line from media x to the pane's right edge at media y. */
function lineToAxis(target: Target, x: number, y: number, colour: string): void {
  target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
    const w = Math.max(1, Math.floor(G.lineWidth * vpr))
    const by = Math.round(y * vpr) + (w % 2 === 1 ? 0.5 : 0)
    ctx.save()
    ctx.strokeStyle = colour
    ctx.lineWidth = w
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(Math.round(x * hpr), by)
    ctx.lineTo(bitmapSize.width, by)
    ctx.stroke()
    ctx.restore()
  })
}

export function lastValueTag(opts: TagOptions): ISeriesPrimitive<Time> {
  let param: Attached | null = null
  const at = (): { tag: TagValue; y: number } | null => {
    const tag = opts.value()
    if (param === null || tag === null) return null
    const y = param.series.priceToCoordinate(tag.value)
    return y === null ? null : { tag, y }
  }
  // Normal order: on the axis canvas right after the tick labels (so it can clear them), and under
  // the crosshair label, which the library draws on its top layer.
  const axisViews = [paneView((target) => {
    const found = at()
    if (found) drawTag(target, found.y, found.tag, opts)
  })]
  const line = opts.line
  const lineViews = line === undefined ? [] : [paneView((target) => {
    const found = at()
    const x = found?.tag.index === undefined ? null : logicalX(param, found.tag.index)
    if (found && x !== null) lineToAxis(target, x, found.y, line)
  })]
  return {
    attached: (p) => { param = p },
    detached: () => { param = null },
    priceAxisPaneViews: () => axisViews,
    paneViews: () => lineViews,
  }
}
