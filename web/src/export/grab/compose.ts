// Draws GRAB's image: the panel's chart canvases copied whole (their own pixels, no re-render), each
// under the summary the chart states, then a rule and the caption that says where the numbers came from.
// The colours and the font come from the chart tokens, read from the page as it is now, so the image
// follows the theme; there is no colour written in this file. Everything is drawn through a small canvas
// interface, so a test can record the drawing without a browser.
import { readLiveChartTokens } from '../../charts/theme/chartContrast'
import { canvasFont, type ChartTokens } from '../../charts/theme/chartTokens'
import type { GrabFigure } from './collect'
import { GRAB_MAX_CANVAS, GRAB_METRICS, grabLayout, grabScale, grabWidth, wrapLine, type GrabBox } from './grabModel'

export interface GrabPalette {
  readonly background: string
  readonly text: string
  /** The first caption line: the panel's name. */
  readonly label: string
  readonly rule: string
  readonly font: string
}

/** The palette from the chart tokens: page background, text, the data orange, the grid grey. */
export function readGrabPalette(tokens: ChartTokens = readLiveChartTokens()): GrabPalette {
  return {
    background: tokens.color.bg,
    text: tokens.color.text,
    label: tokens.color.data,
    rule: tokens.color.chartGrid,
    font: canvasFont(tokens),
  }
}

/** The part of a 2D context the drawing needs; the real one satisfies it. */
export type CanvasContextLike = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'font' | 'textBaseline' | 'fillRect' | 'fillText' | 'drawImage' | 'measureText' | 'scale'
>

export interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): CanvasContextLike | null
  toBlob(callback: BlobCallback, type?: string): void
}

export type MakeCanvas = (width: number, height: number) => CanvasLike

const makeCanvas: MakeCanvas = (width, height) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export interface GrabComposition {
  readonly canvas: CanvasLike
  /** How many figures fit in the image, from the first. */
  readonly kept: number
}

interface CaptionRow {
  readonly text: string
  readonly first: boolean
}

/**
 * A side in device pixels, rounded up so the whole layout fits (a fractional chart box or display scaling of
 * 125% or 150% gives a fraction). The small allowance keeps float noise at the 16000 px cap from adding a pixel.
 */
function pixels(size: number, scale: number): number {
  return Math.min(GRAB_MAX_CANVAS, Math.max(1, Math.ceil(size * scale - 1e-6)))
}

/** Fills the whole canvas, to its last device pixel, in the page background (drawing is scaled to CSS px). */
function fillBackground(ctx: CanvasContextLike, canvas: CanvasLike, scale: number, colour: string): void {
  ctx.fillStyle = colour
  ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale)
}

function drawLayers(ctx: CanvasContextLike, figure: GrabFigure, x: number, y: number): void {
  for (const layer of figure.layers) {
    ctx.drawImage(layer.source, x + layer.x, y + layer.y, layer.width, layer.height)
  }
}

function drawRows(ctx: CanvasContextLike, rows: readonly string[], x: number, y: number): void {
  rows.forEach((row, i) => ctx.fillText(row, x, y + i * GRAB_METRICS.lineHeight + GRAB_METRICS.lineHeight / 2))
}

/**
 * The image for a panel: `figures` from the first, as many as fit under the height cap, then the caption.
 * The image is drawn at the device pixel ratio (lowered to stay within the canvas limit) with each
 * chart canvas copied at its full resolution. Null when there is nothing to draw or the browser gives
 * no drawing surface.
 */
export function composeGrab(
  figures: readonly GrabFigure[],
  caption: readonly string[],
  palette: GrabPalette,
  dpr: number,
  make: MakeCanvas = makeCanvas,
): GrabComposition | null {
  if (figures.length === 0) return null
  const probe = make(1, 1).getContext('2d')
  if (!probe) return null
  probe.font = palette.font
  const measure = (text: string): number => probe.measureText(text).width

  const { pad, lineHeight } = GRAB_METRICS
  const boxes: GrabBox[] = figures.map(({ width, height }) => ({ width, height }))
  const textWidth = grabWidth(boxes) - 2 * pad
  const summaries = figures.map((figure) => wrapLine(figure.summary, textWidth, measure))
  const rows: CaptionRow[] = caption.flatMap((line, i) =>
    wrapLine(line, textWidth, measure).map((text) => ({ text, first: i === 0 })),
  )
  const layout = grabLayout(boxes, summaries.map((s) => s.length), rows.length)

  const scale = grabScale(dpr, layout.width, layout.height)
  const canvas = make(pixels(layout.width, scale), pixels(layout.height, scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  fillBackground(ctx, canvas, scale, palette.background)
  ctx.font = palette.font
  ctx.textBaseline = 'middle'

  for (const place of layout.placements) {
    ctx.fillStyle = palette.text
    drawRows(ctx, summaries[place.index] ?? [], place.x, place.summaryY)
    drawLayers(ctx, figures[place.index]!, place.x, place.y)
  }
  ctx.fillStyle = palette.rule
  ctx.fillRect(pad, layout.ruleY, layout.width - 2 * pad, 1)
  rows.forEach((row, i) => {
    ctx.fillStyle = row.first ? palette.label : palette.text
    ctx.fillText(row.text, pad, layout.captionY + i * lineHeight + lineHeight / 2)
  })
  return { canvas, kept: layout.kept }
}

/** One figure alone, on the page background: the canvases copied whole, no caption (dossier figures). */
export function composeFigure(
  figure: GrabFigure,
  dpr: number,
  make: MakeCanvas = makeCanvas,
  palette: GrabPalette = readGrabPalette(),
): CanvasLike | null {
  const scale = grabScale(dpr, figure.width, figure.height)
  const canvas = make(pixels(figure.width, scale), pixels(figure.height, scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(scale, scale)
  fillBackground(ctx, canvas, scale, palette.background)
  drawLayers(ctx, figure, 0, 0)
  return canvas
}
