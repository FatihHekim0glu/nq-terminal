// The context layer of LineStack (roadmap 12, part A): marked windows across the panes, a three-state
// regime strip under the time axis, and a lanes pane of drawdown episodes. Like LineStack.draw these are
// pure functions of a plot's geometry and a 2D context, so they are tested with a recording context;
// colours are passed in from the chart tokens and sizes come from the charts theme. The readout,
// table and summary helpers give the same facts as text, since a canvas cannot be read by a screen
// reader (UI_SPEC section 9). Nothing here is mounted yet: LineStack ignores the new props until the
// wiring slice.
import { LINE_STACK } from '../copy/lineStack'
import { fillCopy } from '../copy/workspace'
import type { ChartTable } from './ChartA11y'
import { pixelRatio } from './fence'
import type { DrawPlot } from './LineStack.draw'
import { isIntraday, timeLabel } from './LineStack.model'
import type { LaneEpisode, LanesSpec, RibbonSpec, RibbonState, StackSpan } from './LineStack.types'
import { CHART_GEOMETRY as G, type ChartTokens } from './theme'

/** Space between a span's start and its chip, and between the plot top and the chip. */
const CHIP_INSET = 4
const CHIP_TOP = 2
/** Padding either side of a chip's or a lane label's text, and the gap kept between two chips. */
const CHIP_PAD = 3
const CHIP_GAP = 2
/** A lane's rank sits this far in from the plot's left edge; the gap between two texts on a bar. */
const LANE_INSET = 4
const LANE_TEXT_GAP = 6

const canvasFontOf = (font: ChartTokens['font'], pr: number) => `${font.size * pr}px ${font.family}`

/** The x scale's extent, or null while it is unset (before the first draw) or empty. */
function xExtent(u: DrawPlot): readonly [number, number] | null {
  const min = u.scales.x?.min
  const max = u.scales.x?.max
  return min == null || max == null || !(max > min) ? null : [min, max]
}

/** [from, to] cut to [min, max], or null when it is malformed or does not reach the view. */
function clipInclusive(from: number, to: number, min: number, max: number): readonly [number, number] | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to < min || from > max) return null
  return [Math.max(from, min), Math.min(to, max)]
}

/** As clipInclusive, but a range with some length that only touches the view's edge is out of view. */
function clipRun(from: number, to: number, min: number, max: number): readonly [number, number] | null {
  if (from < to && (to <= min || from >= max)) return null
  return clipInclusive(from, to, min, max)
}

/**
 * Whole canvas pixels for a clipped time range: neighbours that share a boundary share a pixel edge
 * (no seam), a run is never under one pixel wide (a sub-pixel session still shows), and none pokes
 * past the plot's right edge.
 */
function pixelRun(u: DrawPlot, from: number, to: number): readonly [number, number] {
  const right = Math.round(u.bbox.left + u.bbox.width)
  const x0 = Math.min(Math.round(u.valToPos(from, 'x', true)), right - 1)
  const x1 = Math.min(Math.max(Math.round(u.valToPos(to, 'x', true)), x0 + 1), right)
  return [x0, x1]
}

// ---------------------------------------------------------------------------------------------
// Marked windows

export interface SpanStyle {
  /** The band's colour; it is drawn at G.spanAlpha. */
  readonly fill: string
  readonly chipBg: string
  readonly chipText: string
  readonly font: ChartTokens['font']
}

interface VisibleSpan {
  readonly x0: number
  readonly width: number
  readonly from: number
  readonly label: string
}

/**
 * Each span as a translucent band over the full plot height (G.spanAlpha), clipped to the view. With
 * `withChips` (the top pane only) each band also gets a chip carrying its label at its left end; a
 * chip that would touch the previous one, or run past the plot's right edge, is left off, so chips
 * never overlap. The bands are drawn in one saved state, so the alpha never reaches the chips.
 */
export function drawSpans(u: DrawPlot, spans: readonly StackSpan[], style: SpanStyle, withChips: boolean): void {
  const extent = xExtent(u)
  if (extent === null || spans.length === 0) return
  const pr = pixelRatio(u)
  const visible: VisibleSpan[] = []
  for (const s of spans) {
    const clipped = clipInclusive(s.from, s.to, extent[0], extent[1])
    if (clipped === null) continue
    const x0 = u.valToPos(clipped[0], 'x', true)
    // A one-instant window still shows, as a hairline of one device pixel.
    visible.push({ x0, width: Math.max(u.valToPos(clipped[1], 'x', true) - x0, pr), from: s.from, label: s.label })
  }
  if (visible.length === 0) return
  const { ctx } = u
  ctx.save()
  ctx.globalAlpha = G.spanAlpha
  ctx.fillStyle = style.fill
  for (const v of visible) ctx.fillRect(v.x0, u.bbox.top, v.width, u.bbox.height)
  ctx.restore()
  if (withChips) drawChips(u, visible, style, pr)
}

function drawChips(u: DrawPlot, spans: readonly VisibleSpan[], style: SpanStyle, pr: number): void {
  const { ctx } = u
  const right = u.bbox.left + u.bbox.width
  const top = u.bbox.top + CHIP_TOP * pr
  const height = (style.font.size + 3) * pr
  ctx.save()
  ctx.font = canvasFontOf(style.font, pr)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  let previousRight = Number.NEGATIVE_INFINITY
  for (const s of [...spans].sort((a, b) => a.x0 - b.x0 || a.from - b.from)) {
    if (s.label === '') continue
    const left = s.x0 + CHIP_INSET * pr
    const width = ctx.measureText(s.label).width + 2 * CHIP_PAD * pr
    if (left < previousRight + CHIP_GAP * pr || left + width > right) continue
    ctx.fillStyle = style.chipBg
    ctx.fillRect(left, top, width, height)
    ctx.fillStyle = style.chipText
    ctx.fillText(s.label, left + CHIP_PAD * pr, top + pr)
    previousRight = left + width
  }
  ctx.restore()
}

/** How many spans touch [from, to], ends included (the marked windows in a view). */
export function spansInView(spans: readonly StackSpan[] | undefined, from: number, to: number): number {
  let count = 0
  for (const s of spans ?? []) if (s.to >= from && s.from <= to) count += 1
  return count
}

// ---------------------------------------------------------------------------------------------
// The regime strip

export type RibbonColours = Readonly<Record<RibbonState, string>>

/** A run of equal, non-null states, as the strip draws it and the table lists it. */
export interface RibbonRun {
  readonly state: RibbonState
  /** Epoch seconds of the run's first and last session. */
  readonly from: number
  readonly to: number
  readonly sessions: number
}

interface IndexRun {
  readonly state: RibbonState
  readonly first: number
  last: number
}

/** Runs of equal non-null states by index: a null breaks a run, and a short list reads as gaps. */
function runIndexes(count: number, values: ReadonlyArray<RibbonState | null | undefined>): IndexRun[] {
  const runs: IndexRun[] = []
  let current: IndexRun | null = null
  for (let i = 0; i < count; i += 1) {
    const state = values[i] ?? null
    if (state === null) {
      current = null
    } else if (current !== null && current.state === state) {
      current.last = i
    } else {
      current = { state, first: i, last: i }
      runs.push(current)
    }
  }
  return runs
}

export function ribbonRuns(t: readonly number[], values: ReadonlyArray<RibbonState | null | undefined>): RibbonRun[] {
  return runIndexes(t.length, values).map((r) => ({ state: r.state, from: t[r.first]!, to: t[r.last]!, sessions: r.last - r.first + 1 }))
}

/** Where session `i`'s cell starts: half way back to the previous session (mirrored at the first). */
function cellStart(t: readonly number[], i: number): number {
  if (i > 0) return (t[i - 1]! + t[i]!) / 2
  return t.length > 1 ? t[0]! - (t[1]! - t[0]!) / 2 : t[0]!
}

/** Where session `i`'s cell ends: half way on to the next session (mirrored at the last). */
function cellEnd(t: readonly number[], i: number): number {
  const last = t.length - 1
  if (i < last) return (t[i]! + t[i + 1]!) / 2
  return last > 0 ? t[last]! + (t[last]! - t[last - 1]!) / 2 : t[last]!
}

/**
 * The strip under the time axis: one filled rect per run of equal non-null states, its ends at the
 * midpoints between sessions, clipped to the view, G.ribbonGap below the time axis and G.ribbonHeight
 * tall. A gap (null) draws nothing. The strip sits under the bottom pane's time axis, which is
 * G.xAxisHeight tall.
 */
export function drawRibbon(u: DrawPlot, t: readonly number[], ribbon: RibbonSpec, colours: RibbonColours): void {
  const extent = xExtent(u)
  if (extent === null || t.length === 0) return
  const rects: { state: RibbonState; x0: number; x1: number }[] = []
  for (const run of runIndexes(t.length, ribbon.values)) {
    const clipped = clipRun(cellStart(t, run.first), cellEnd(t, run.last), extent[0], extent[1])
    if (clipped === null) continue
    const [x0, x1] = pixelRun(u, clipped[0], clipped[1])
    rects.push({ state: run.state, x0, x1 })
  }
  if (rects.length === 0) return
  const pr = pixelRatio(u)
  const y = u.bbox.top + u.bbox.height + (G.xAxisHeight + G.ribbonGap) * pr
  const { ctx } = u
  ctx.save()
  for (const r of rects) {
    ctx.fillStyle = colours[r.state]
    ctx.fillRect(r.x0, y, r.x1 - r.x0, G.ribbonHeight * pr)
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------------------------
// Episode lanes

export interface LaneColours {
  readonly fall: string
  readonly recover: string
  /** The hatch lines of an episode that has not recovered. */
  readonly hatch: string
  readonly text: string
  readonly outline: string
}

interface LaneBar {
  readonly episode: LaneEpisode
  readonly y: number
  readonly mid: number
  readonly fall: readonly [number, number] | null
  readonly recover: readonly [number, number] | null
}

/** A bar's pixel run, when the part has length and reaches the view. */
function partRun(u: DrawPlot, from: number, to: number, extent: readonly [number, number]): readonly [number, number] | null {
  if (!(to > from)) return null
  const clipped = clipRun(from, to, extent[0], extent[1])
  return clipped === null ? null : pixelRun(u, clipped[0], clipped[1])
}

/** Diagonal lines every `step` pixels inside a box, for an episode that is still open. */
function hatchBox(u: DrawPlot, box: readonly [number, number], y: number, height: number, colour: string, pr: number): void {
  const { ctx } = u
  ctx.save()
  ctx.beginPath()
  ctx.rect(box[0], y, box[1] - box[0], height)
  ctx.clip()
  ctx.beginPath()
  ctx.setLineDash([])
  ctx.lineWidth = pr
  ctx.strokeStyle = colour
  for (let x = box[0] - height; x < box[1]; x += G.hatchStep * pr) {
    ctx.moveTo(x, y + height)
    ctx.lineTo(x + height, y)
  }
  ctx.stroke()
  ctx.restore()
}

/** Labels on the bars: the rank at the plot's left edge, then depth and the word open on the recovery. */
function drawLaneText(u: DrawPlot, bars: readonly LaneBar[], rowHeight: number, barHeight: number, colours: LaneColours, font: ChartTokens['font'], pr: number): void {
  const rankFits = rowHeight >= font.size * pr
  const partsFit = barHeight >= font.size * pr
  if (!rankFits && !partsFit) return
  const { ctx } = u
  ctx.save()
  ctx.font = canvasFontOf(font, pr)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = colours.text
  for (const bar of bars) {
    if (rankFits) ctx.fillText(String(bar.episode.rank), u.bbox.left + LANE_INSET * pr, bar.mid)
    if (!partsFit || bar.recover === null) continue
    const parts = [bar.episode.depth, bar.episode.open ? LINE_STACK.laneOpen : ''].filter((p) => p !== '')
    let x = bar.recover[0] + LANE_INSET * pr
    for (const part of parts) {
      const width = ctx.measureText(part).width
      if (x + width + CHIP_PAD * pr > bar.recover[1]) continue
      ctx.fillText(part, x, bar.mid)
      x += width + LANE_TEXT_GAP * pr
    }
  }
  ctx.restore()
}

/**
 * One row per episode, in the order given. The bar is G.laneBarShare of the row (never under 2px) and
 * centred: the fall runs from peak to trough in `fall`, the recovery from trough to end in `recover`,
 * or hatched every G.hatchStep px for an open episode. The rank sits at the left edge; the depth and
 * the word open follow on the recovery when it is wide enough, and no text is drawn where the row is
 * shorter than the text. The `highlight` rank gets a 1px outline around its whole bar.
 */
export function drawLanes(u: DrawPlot, lanes: LanesSpec, colours: LaneColours, highlight: number | null, font: ChartTokens['font']): void {
  const extent = xExtent(u)
  const count = lanes.episodes.length
  if (extent === null || count === 0) return
  const pr = pixelRatio(u)
  const rowHeight = u.bbox.height / count
  const barHeight = Math.max(2 * pr, Math.round(rowHeight * G.laneBarShare))
  const bars: LaneBar[] = lanes.episodes.map((episode, i) => {
    const rowTop = u.bbox.top + i * rowHeight
    return {
      episode,
      y: Math.round(rowTop + (rowHeight - barHeight) / 2),
      mid: Math.round(rowTop + rowHeight / 2),
      fall: partRun(u, episode.peak, episode.trough, extent),
      recover: partRun(u, episode.trough, episode.end, extent),
    }
  })
  const { ctx } = u
  for (const bar of bars) {
    ctx.save()
    if (bar.fall !== null) {
      ctx.fillStyle = colours.fall
      ctx.fillRect(bar.fall[0], bar.y, bar.fall[1] - bar.fall[0], barHeight)
    }
    if (bar.recover !== null && !bar.episode.open) {
      ctx.fillStyle = colours.recover
      ctx.fillRect(bar.recover[0], bar.y, bar.recover[1] - bar.recover[0], barHeight)
    }
    ctx.restore()
    if (bar.recover !== null && bar.episode.open) hatchBox(u, bar.recover, bar.y, barHeight, colours.hatch, pr)
  }
  drawLaneText(u, bars, rowHeight, barHeight, colours, font, pr)
  const marked = highlight === null ? undefined : bars.find((b) => b.episode.rank === highlight)
  if (marked !== undefined) outlineBar(u, marked, barHeight, colours.outline, pr)
}

/** A 1px outline inside the whole bar (fall and recovery), so the stroke never leaves the bar. */
function outlineBar(u: DrawPlot, bar: LaneBar, barHeight: number, colour: string, pr: number): void {
  const left = bar.fall?.[0] ?? bar.recover?.[0]
  const right = bar.recover?.[1] ?? bar.fall?.[1]
  if (left === undefined || right === undefined) return
  const { ctx } = u
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = pr
  ctx.strokeStyle = colour
  ctx.strokeRect(left + pr / 2, bar.y + pr / 2, Math.max(0, right - left - pr), Math.max(0, barHeight - pr))
  ctx.restore()
}

/**
 * The rank of the lane under a pointer, from its y in CSS pixels measured from the plot top, or null
 * off the lanes. The rows are the ones drawLanes draws: the plot height split evenly.
 */
export function laneAt(lanes: LanesSpec, cssY: number, plotCssHeight: number): number | null {
  const count = lanes.episodes.length
  if (count === 0 || !Number.isFinite(cssY) || !Number.isFinite(plotCssHeight) || plotCssHeight <= 0) return null
  if (cssY < 0 || cssY >= plotCssHeight) return null
  const row = Math.min(count - 1, Math.floor(cssY / (plotCssHeight / count)))
  return lanes.episodes[row]!.rank
}

// ---------------------------------------------------------------------------------------------
// The same facts as text

type LanePhase = keyof typeof LINE_STACK.lanePhase

/** Falling up to and including the trough; after it recovering, or open while the peak is unrecovered. */
function phaseAt(e: LaneEpisode, at: number): LanePhase {
  if (at <= e.trough) return 'fall'
  return e.open ? 'open' : 'recover'
}

/**
 * The context at the crosshair for the polite readout: each marked window it is inside, the regime
 * state with its glyph (or the strip's missing text at a gap), and each episode it falls in with its
 * phase. Empty when nothing applies or the index is off the data.
 */
export function contextReadout(
  t: readonly number[],
  idx: number,
  spans: readonly StackSpan[] | undefined,
  ribbon: RibbonSpec | undefined,
  lanes: readonly LanesSpec[] = [],
): string {
  const at = t[idx]
  if (at === undefined) return ''
  const parts: string[] = []
  for (const s of spans ?? []) {
    if (at >= s.from && at <= s.to) parts.push(fillCopy(LINE_STACK.readoutWindow, { label: s.label }))
  }
  if (ribbon !== undefined) {
    const state = ribbon.values[idx] ?? null
    parts.push(
      state === null
        ? fillCopy(LINE_STACK.readoutValue, { name: ribbon.name, value: ribbon.missing })
        : fillCopy(LINE_STACK.readoutRibbon, { name: ribbon.name, state: ribbon.states[state].label, glyph: ribbon.states[state].glyph }),
    )
  }
  for (const spec of lanes) {
    for (const e of spec.episodes) {
      if (at >= e.peak && at <= e.end) {
        parts.push(fillCopy(LINE_STACK.readoutLane, { rank: e.rank, phase: LINE_STACK.lanePhase[phaseAt(e, at)] }))
      }
    }
  }
  return parts.join(LINE_STACK.contextJoin)
}

/**
 * The context as tables for the T view, after the main table: the marked windows (with whether the
 * data reaches each), the regime runs, and each lanes pane's episodes. A layer with nothing in it adds
 * no table. A stack with several lanes panes names each table by its pane.
 */
export function contextTables(
  title: string,
  t: readonly number[],
  spans: readonly StackSpan[] | undefined,
  ribbon: RibbonSpec | undefined,
  lanes: readonly LanesSpec[] = [],
): ChartTable[] {
  const intraday = isIntraday(t)
  const when = (x: number) => (Number.isFinite(x) ? timeLabel(x, intraday) : LINE_STACK.missing)
  const tables: ChartTable[] = []
  if (spans !== undefined && spans.length > 0) {
    const first = t[0]
    const last = t[t.length - 1]
    const cols = LINE_STACK.spansCols
    tables.push({
      caption: fillCopy(LINE_STACK.spansCaption, { title }),
      columns: [
        { key: 'window', label: cols.window },
        { key: 'from', label: cols.from },
        { key: 'to', label: cols.to },
        { key: 'inView', label: cols.inView },
      ],
      rows: spans.map((s) => ({
        window: s.label,
        from: when(s.from),
        to: when(s.to),
        inView: first !== undefined && last !== undefined && s.to >= first && s.from <= last ? LINE_STACK.inView : LINE_STACK.notInView,
      })),
    })
  }
  if (ribbon !== undefined) {
    const runs = ribbonRuns(t, ribbon.values)
    const cols = LINE_STACK.ribbonCols
    if (runs.length > 0) {
      tables.push({
        caption: fillCopy(LINE_STACK.ribbonCaption, { title, name: ribbon.name }),
        columns: [
          { key: 'state', label: cols.state },
          // The row header names the row: the date window is unique per run, the repeating state is not (ChartA11y D38).
          { key: 'from', label: cols.from, rowHeader: true },
          { key: 'to', label: cols.to },
          { key: 'sessions', label: cols.sessions, numeric: true },
        ],
        rows: runs.map((r) => ({ state: ribbon.states[r.state].label, from: when(r.from), to: when(r.to), sessions: r.sessions })),
      })
    }
  }
  const populated = lanes.filter((l) => l.episodes.length > 0)
  const cols = LINE_STACK.lanesCols
  for (const spec of populated) {
    tables.push({
      caption: populated.length > 1
        ? fillCopy(LINE_STACK.namedTitle, { title, name: spec.name })
        : fillCopy(LINE_STACK.lanesCaption, { title }),
      columns: [
        { key: 'rank', label: cols.rank, numeric: true },
        { key: 'peak', label: cols.peak },
        { key: 'trough', label: cols.trough },
        { key: 'end', label: cols.end },
        { key: 'state', label: cols.state },
        { key: 'depth', label: cols.depth, numeric: true },
      ],
      rows: spec.episodes.map((e) => ({
        rank: e.rank,
        peak: when(e.peak),
        trough: when(e.trough),
        end: when(e.end),
        state: e.open ? LINE_STACK.laneOpen : LINE_STACK.laneRecovered,
        depth: e.depth,
      })),
    })
  }
  return tables
}

/** The sentence the chart's accessible name appends when a context layer is on. */
export function contextSummary(spansInViewCount: number, laneCount: number): string {
  return fillCopy(LINE_STACK.summaryContext, { spans: spansInViewCount, lanes: laneCount })
}
