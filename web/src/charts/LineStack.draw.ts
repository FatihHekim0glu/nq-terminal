// Canvas drawing for LineStack's uPlot hooks (look spec 6 and 6.1): the honest zero line, the 3px
// minor ticks, the two-row time axis and the last-value pentagon tags. Pure functions of a plot's
// geometry and a 2D context, so they are tested with a recording context. Colours are passed in
// from the chart tokens; geometry comes from the charts theme.
import { pixelRatio, type ScaleExtent } from './fence'
import { formatValue, visibleIndexRange, type Values } from './LineStack.model'
import type { TimeAxisLayout } from './LineStack.time'
import { CHART_GEOMETRY as G, DEFAULT_CHART_TOKENS, tagPolygon, textOn, type ChartTokens, type Point } from './theme'

/** The parts of a uPlot instance the drawing uses (a real uPlot satisfies it). */
export interface DrawPlot {
  readonly ctx: CanvasRenderingContext2D
  readonly bbox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly scales: Readonly<Record<string, ScaleExtent | undefined>>
  readonly width: number
  /** The whole canvas height in CSS pixels (plot plus axes). */
  readonly height: number
  valToPos(value: number, scaleKey: string, canvasPixels?: boolean): number
}

/** Height of one time-axis text row. */
const ROW_HEIGHT = 16
/** Space kept either side of a time label inside its room. */
const LABEL_MARGIN = 2
/** Padding either side of a tag's text. */
const TAG_PAD = 3

const crisp = (v: number) => Math.round(v) + 0.5
const canvasFontOf = (font: ChartTokens['font'], pr: number) => `${font.size * pr}px ${font.family}`

function strokeLines(u: DrawPlot, colour: string, lines: ReadonlyArray<readonly [number, number, number, number]>): void {
  if (lines.length === 0) return
  const { ctx } = u
  ctx.save()
  ctx.beginPath()
  ctx.setLineDash([])
  ctx.lineWidth = G.lineWidth * pixelRatio(u)
  ctx.strokeStyle = colour
  for (const [x0, y0, x1, y1] of lines) {
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
  }
  ctx.stroke()
  ctx.restore()
}

/** A solid 1px line across the plot at zero, when zero is in the value range. */
export function drawZeroLine(u: DrawPlot, colour: string): void {
  const min = u.scales.y?.min
  const max = u.scales.y?.max
  if (min == null || max == null || min > 0 || max < 0) return
  const y = crisp(u.valToPos(0, 'y', true))
  strokeLines(u, colour, [[u.bbox.left, y, u.bbox.left + u.bbox.width, y]])
}

/** 3px ticks right of the value axis line, halfway between the labelled ticks. */
export function drawMinorYTicks(u: DrawPlot, splits: readonly number[], colour: string): void {
  const x = u.bbox.left + u.bbox.width
  const len = G.minorTick * pixelRatio(u)
  const lines: [number, number, number, number][] = []
  for (let i = 1; i < splits.length; i += 1) {
    const y = crisp((u.valToPos(splits[i - 1]!, 'y', true) + u.valToPos(splits[i]!, 'y', true)) / 2)
    lines.push([x, y, x + len, y])
  }
  strokeLines(u, colour, lines)
}

export interface TimeAxisStyle {
  readonly axis: string
  readonly divider: string
  readonly font: ChartTokens['font']
}

function drawLabelRow(u: DrawPlot, labels: TimeAxisLayout['row1'], y: number, pr: number): void {
  const { ctx } = u
  const min = u.scales.x?.min
  const max = u.scales.x?.max
  if (min == null || max == null || max <= min) return
  const pxPerSecond = u.bbox.width / (max - min)
  for (const label of labels) {
    const x = u.valToPos(label.at, 'x', true)
    const w = ctx.measureText(label.text).width
    if (w + 2 * LABEL_MARGIN * pr > label.room * pxPerSecond) continue
    if (x - w / 2 < 0 || x + w / 2 > ctx.canvas.width) continue
    ctx.fillText(label.text, x, y)
  }
}

/** The time axis under the bottom pane: minor ticks, row 1, row 2 and the row-2 dividers. */
export function drawTimeAxis(u: DrawPlot, layout: TimeAxisLayout, style: TimeAxisStyle): void {
  const pr = pixelRatio(u)
  const bottom = u.bbox.top + u.bbox.height
  const minors: [number, number, number, number][] = []
  for (let i = 1; i < layout.majors.length; i += 1) {
    const x = crisp((u.valToPos(layout.majors[i - 1]!, 'x', true) + u.valToPos(layout.majors[i]!, 'x', true)) / 2)
    minors.push([x, bottom, x, bottom + G.minorTick * pr])
  }
  strokeLines(u, style.axis, minors)
  const row1 = bottom + (G.majorTick + G.labelGap) * pr
  const row2 = row1 + ROW_HEIGHT * pr
  const { ctx } = u
  ctx.save()
  ctx.font = canvasFontOf(style.font, pr)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = style.axis
  drawLabelRow(u, layout.row1, row1, pr)
  drawLabelRow(u, layout.row2, row2, pr)
  ctx.fillStyle = style.divider
  for (const t of layout.dividers) ctx.fillRect(Math.round(u.valToPos(t, 'x', true)), row2, pr, ROW_HEIGHT * pr)
  ctx.restore()
}

// ---------------------------------------------------------------------------------------------
// Last-value tags

export interface TagSeries {
  readonly values: Values
  readonly colour: string
}

export interface Tag {
  /** Canvas pixels: the tag's centre line and its body width. */
  readonly y: number
  readonly width: number
  readonly text: string
  readonly fill: string
  readonly textColour: string
}

function lastIndex(v: Values, i0: number, i1: number): number {
  for (let i = i1; i >= i0; i -= 1) if (v[i] !== null && v[i] !== undefined) return i
  return -1
}

/**
 * One tag per series at its last visible value, filled in the series colour with black or white
 * text (whichever contrasts more), pushed apart so no two overlap.
 */
export function lastValueTags(
  u: DrawPlot,
  t: readonly number[],
  series: readonly TagSeries[],
  decimals: number,
  unit: string,
  signed = false,
  tokens: ChartTokens = DEFAULT_CHART_TOKENS,
  /** Pass uPlot.pxRatio when calling before uPlot has sized the canvas (axis layout). */
  pr: number = pixelRatio(u),
): Tag[] {
  const min = u.scales.x?.min
  const max = u.scales.x?.max
  const visible = min == null || max == null ? null : visibleIndexRange(t, min, max)
  if (visible === null) return []
  const { ctx } = u
  ctx.save()
  ctx.font = canvasFontOf(tokens.font, pr)
  const tags: Tag[] = []
  for (const s of series) {
    const i = lastIndex(s.values, visible[0], visible[1])
    if (i === -1) continue
    const text = formatValue(s.values[i], decimals, unit, signed)
    const width = Math.min(ctx.measureText(text).width + 2 * TAG_PAD * pr, (G.axisGutter - G.tagArrow) * pr)
    tags.push({ y: u.valToPos(s.values[i]!, 'y', true), width, text, fill: s.colour, textColour: textOn(s.colour, tokens) })
  }
  ctx.restore()
  const order = tags.map((_, k) => k).sort((a, b) => tags[a]!.y - tags[b]!.y)
  const ys = tags.map((tag) => tag.y)
  for (let k = 1; k < order.length; k += 1) {
    const prev = ys[order[k - 1]!]!
    if (ys[order[k]!]! - prev < G.tagHeight * pr) ys[order[k]!] = prev + G.tagHeight * pr
  }
  return tags.map((tag, k) => ({ ...tag, y: ys[k]! }))
}

/** Draws each tag: the theme's pentagon pointing at the axis line, then its text. */
export function drawTags(u: DrawPlot, tags: readonly Tag[], font: ChartTokens['font']): void {
  if (tags.length === 0) return
  const pr = pixelRatio(u)
  const axisX = u.bbox.left + u.bbox.width
  const { ctx } = u
  ctx.save()
  ctx.font = canvasFontOf(font, pr)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const tag of tags) {
    const poly: Point[] = tagPolygon(axisX / pr, tag.y / pr, tag.width / pr).map(([x, y]) => [x * pr, y * pr])
    ctx.fillStyle = tag.fill
    ctx.beginPath()
    ctx.moveTo(...poly[0]!)
    for (const p of poly.slice(1)) ctx.lineTo(...p)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = tag.textColour
    ctx.fillText(tag.text, axisX + (G.tagArrow + TAG_PAD) * pr, tag.y)
  }
  ctx.restore()
}

/** Whether a value-axis label at `value` would sit under a tag (the tag replaces it, look spec 6.1). */
/**
 * Whether a value label centred on `value` would run past the canvas top or bottom. A pane with no
 * time axis has its plot flush with the canvas bottom, so such a label is cut by the splitter.
 */
export function labelLeavesCanvas(
  u: DrawPlot,
  value: number,
  font: ChartTokens['font'] = DEFAULT_CHART_TOKENS.font,
  pr: number = pixelRatio(u),
): boolean {
  const centre = u.valToPos(value, 'y', true) / pr
  const half = font.size / 2
  return centre - half < 0 || centre + half > u.height
}

export function tagBlocksLabel(
  u: DrawPlot,
  tags: readonly Tag[],
  value: number,
  font: ChartTokens['font'] = DEFAULT_CHART_TOKENS.font,
  pr: number = pixelRatio(u),
): boolean {
  const y = u.valToPos(value, 'y', true)
  // Half the tag plus half the label's text, so the two never touch.
  const reach = (G.tagHeight / 2 + font.size / 2 + LABEL_MARGIN) * pr
  return tags.some((tag) => Math.abs(tag.y - y) < reach)
}
