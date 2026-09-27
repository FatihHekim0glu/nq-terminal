// The OOS fence on a uPlot time axis (UI_SPEC section 6, look spec 6.1): a 1px dashed amber line at
// 2022-01-01 00:00 UTC, labelled `IS | 2022+ SPENT`. Served data stops at the fence, so a chart
// whose data ends within a month of it reaches out to show it (viewMaxWithFence). Colours come from
// the chart tokens; the dash from the chart geometry. No chart library is imported here.
import { CHART_GEOMETRY, type ChartTokens } from './theme'

/** 2022-01-01 00:00 UTC in epoch seconds: the first second that is not in-sample. */
export const FENCE_TIME = Date.UTC(2022, 0, 1) / 1000

/** Data that ends at most this long before the fence pulls the view out to it. */
export const FENCE_REACH_SECONDS = 31 * 86_400

const LABEL_GAP = 4
const LABEL_TOP = 2
const LABEL_PAD = 3

/** The view's right edge for data ending at `lastT`: the fence when the data stops just short of it. */
export function viewMaxWithFence(lastT: number, fence: number = FENCE_TIME): number {
  return fence > lastT && fence - lastT <= FENCE_REACH_SECONDS ? fence : lastT
}

/** A scale's current extent, as uPlot keeps it. */
export interface ScaleExtent {
  readonly min?: number | null
  readonly max?: number | null
}

/** The parts of a uPlot instance the fence uses (a real uPlot satisfies it). */
export interface FencePlot {
  readonly ctx: CanvasRenderingContext2D
  readonly bbox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
  readonly scales: Readonly<Record<string, ScaleExtent | undefined>>
  /** The whole chart's width in CSS pixels. */
  readonly width: number
  valToPos(value: number, scaleKey: string, canvasPixels?: boolean): number
}

export interface FenceStyle {
  readonly colour: string
  /** The box behind the label, so a series under it cannot hide it. */
  readonly background: string
  readonly font: ChartTokens['font']
  /** Null draws the line without its label (lower panes of a stack). */
  readonly label: string | null
}

export function fenceStyle(tokens: ChartTokens, label: string | null): FenceStyle {
  return { colour: tokens.color.fence, background: tokens.color.bg, font: tokens.font, label }
}

/** Canvas pixels per CSS pixel for a uPlot chart. */
export function pixelRatio(u: Pick<FencePlot, 'ctx' | 'width'>): number {
  return u.width > 0 ? u.ctx.canvas.width / u.width : 1
}

/** The fence's x in canvas pixels, or null when the x scale does not contain it. */
export function fenceCanvasX(u: FencePlot, fence: number = FENCE_TIME): number | null {
  const min = u.scales.x?.min
  const max = u.scales.x?.max
  if (min == null || max == null || fence < min || fence > max) return null
  return u.valToPos(fence, 'x', true)
}

function drawLabel(u: FencePlot, x: number, style: FenceStyle, label: string, pr: number): void {
  const { ctx, bbox } = u
  ctx.font = `${style.font.size * pr}px ${style.font.family}`
  ctx.textBaseline = 'top'
  const width = ctx.measureText(label).width
  const roomLeft = x - bbox.left >= width + (LABEL_GAP + LABEL_PAD) * pr
  ctx.textAlign = roomLeft ? 'right' : 'left'
  const textX = roomLeft ? x - LABEL_GAP * pr : x + LABEL_GAP * pr
  const boxX = roomLeft ? textX - width - LABEL_PAD * pr : textX - LABEL_PAD * pr
  const top = bbox.top + LABEL_TOP * pr
  ctx.fillStyle = style.background
  ctx.fillRect(boxX, top, width + 2 * LABEL_PAD * pr, (style.font.size + 3) * pr)
  ctx.fillStyle = style.colour
  ctx.fillText(label, textX, top + pr)
}

/** Draws the fence if it is in view; returns its x in canvas pixels, or null. */
export function drawFence(u: FencePlot, style: FenceStyle, fence: number = FENCE_TIME): number | null {
  const raw = fenceCanvasX(u, fence)
  if (raw === null) return null
  const pr = pixelRatio(u)
  const x = Math.round(raw) + 0.5
  const { ctx, bbox } = u
  ctx.save()
  ctx.beginPath()
  ctx.setLineDash(CHART_GEOMETRY.fenceDash.map((d) => d * pr))
  ctx.lineWidth = CHART_GEOMETRY.lineWidth * pr
  ctx.strokeStyle = style.colour
  ctx.moveTo(x, bbox.top)
  ctx.lineTo(x, bbox.top + bbox.height)
  ctx.stroke()
  ctx.setLineDash([])
  if (style.label !== null) drawLabel(u, x, style, style.label, pr)
  ctx.restore()
  return x
}

export interface FencePlugin {
  readonly hooks: { readonly draw: (u: FencePlot) => void }
}

/**
 * A uPlot plugin that draws the fence after the series. `onDraw` receives the fence's x in CSS
 * pixels from the plot's left edge (null when out of view), for tests and the E2E run.
 */
export function fencePlugin(style: () => FenceStyle, onDraw?: (cssX: number | null) => void, fence: number = FENCE_TIME): FencePlugin {
  return {
    hooks: {
      draw: (u) => {
        const x = drawFence(u, style(), fence)
        const raw = x === null ? null : fenceCanvasX(u, fence)
        onDraw?.(raw === null ? null : (raw - u.bbox.left) / pixelRatio(u))
      },
    },
  }
}
