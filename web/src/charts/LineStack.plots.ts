// Builds and owns LineStack's uPlot instances: one per pane, each with its HTML legend, the crosshair
// sync for the panel's link group, and the draw bookkeeping (the busy flag, the render time and the
// data attributes the E2E run reads). Pointer moves reach React only through onPointer, which the
// component throttles; the legend is updated as plain DOM. The context layer adds no state here: the
// marked windows and the regime strip are build inputs (a change rebuilds the panes), while the
// highlighted lane and the lane-hover callback are read at use, so changing them never builds a plot.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type uPlot from 'uplot'
import type { PanelLink } from '../state/linkGroups'
import { pixelRatio } from './fence'
import type { UplotConstructor } from './lazy'
import { createLegend, type LegendHandle, type LegendStats } from './LineStack.legend'
import { isIntraday, paneFormat, seriesStats, timeLabel, visibleIndexRange, type Values } from './LineStack.model'
import { laneAt } from './LineStack.context'
import { sharedGutter, type SharedGutter } from './LineStack.draw'
import { paneOptions, paneUplotData, type PaneDrawInfo, type PaneSync } from './LineStack.options'
import type { LanesSpec, LineStackPane, RibbonSpec, StackSpan } from './LineStack.types'
import { uplotCrosshairSync } from './sync'
import { lineStackSeries, readChartTokens, type ChartTokens } from './theme'

export interface PlotsArgs {
  readonly lib: UplotConstructor | null
  readonly t: readonly number[]
  readonly panes: readonly LineStackPane[]
  /** Cleaned values per pane, per series. */
  readonly data: readonly (readonly Values[])[]
  readonly link: PanelLink
  readonly fence: number | null
  readonly log: boolean
  readonly uid: string
  readonly view: () => readonly [number, number]
  /**
   * The pane hosts, kept in state (not a mutable ref): ChartA11y unmounts them while the table view
   * is open, and a fresh identity on remount is what makes the build effect below rerun (D33, D34).
   */
  readonly paneEls: readonly (HTMLDivElement | null)[]
  readonly container: HTMLDivElement | null
  readonly onPointer: (idx: number | null) => void
  readonly onRender?: (ms: number) => void
  /** Milliseconds spent before the build (cleaning the data), added to the first report. */
  readonly takeExtraMs: () => number
  /** Marked windows over every pane. A new array rebuilds the panes, so pass a stable one. */
  readonly spans?: readonly StackSpan[]
  /** The regime strip under the bottom pane's time axis. A new object rebuilds the panes. */
  readonly ribbon?: RibbonSpec
  /** The rank of the lane to outline; a change redraws the lanes panes and nothing else. */
  readonly highlightLane?: number | null
  /** Called when the lane under the pointer changes (a rank, or null off the lanes). */
  readonly onLaneHover?: (rank: number | null) => void
}

export interface PlotsState {
  readonly plots: { readonly current: uPlot[] }
  readonly drawn: boolean
}

function paneSync(link: PanelLink, sourceId: string, privateKey: string): PaneSync {
  if (link === '-') return { cursorSync: { key: privateKey, scales: ['x', null] }, plugin: { hooks: {} } }
  const s = uplotCrosshairSync(link, sourceId)
  return { cursorSync: s.cursorSync, plugin: s.plugin }
}

/** The crosshair's data index, or null when the pointer is off the chart. */
export function cursorIndex(u: uPlot): number | null {
  const { left, idx } = u.cursor
  return left != null && left >= 0 && idx != null ? idx : null
}

function lastIn(v: Values, range: readonly [number, number] | null): number | null {
  if (range === null) return null
  for (let i = range[1]; i >= range[0]; i -= 1) if (v[i] !== null && v[i] !== undefined) return v[i]!
  return null
}

function writeAttrs(el: HTMLElement, u: uPlot, info: PaneDrawInfo): void {
  const pr = pixelRatio(u)
  const { left, top, width, height } = u.bbox
  el.dataset.plot = [left, top, width, height].map((n) => (n / pr).toFixed(1)).join(',')
  el.dataset.xRange = `${u.scales.x?.min ?? ''},${u.scales.x?.max ?? ''}`
  el.dataset.fenceX = info.fenceX === null ? '' : info.fenceX.toFixed(1)
}

interface PaneContext {
  readonly a: PlotsArgs
  /** The latest arguments, for what is read at use rather than at build. */
  readonly live: { readonly current: PlotsArgs }
  readonly i: number
  readonly el: HTMLDivElement
  readonly tokens: ChartTokens
  readonly onFirstDraw: () => void
  readonly gutter: SharedGutter
}

interface PaneLegend {
  readonly handle: LegendHandle
  /** After a draw: the visible window and the single-series stats changed. */
  readonly onScale: (u: uPlot) => void
  /** After a crosshair move: the values follow the cursor, or the last visible bar without one. */
  readonly refresh: (u: uPlot) => void
}

function paneLegend(el: HTMLElement, pane: LineStackPane, values: readonly Values[], t: readonly number[], tokens: ChartTokens): PaneLegend {
  const styles = lineStackSeries(tokens)
  const format = paneFormat(pane)
  const intraday = isIntraday(t)
  const handle = createLegend(el, pane.series.map((s) => ({ name: s.name, colour: styles[s.style].stroke })), pane.series.length === 1)
  let visible: [number, number] | null = null
  let stats: LegendStats | null = null
  const refresh = (u: uPlot) => {
    const idx = cursorIndex(u)
    handle.update(values.map((v) => format(idx !== null ? v[idx] : lastIn(v, visible))), stats)
  }
  const onScale = (u: uPlot) => {
    visible = visibleIndexRange(t, u.scales.x?.min ?? 0, u.scales.x?.max ?? 0)
    const s = values.length === 1 && visible ? seriesStats(values[0]!, visible[0], visible[1]) : null
    stats = s && {
      high: { date: timeLabel(t[s.high.index]!, intraday), value: format(s.high.value) },
      average: format(s.mean),
      low: { date: timeLabel(t[s.low.index]!, intraday), value: format(s.low.value) },
    }
    refresh(u)
  }
  return { handle, onScale, refresh }
}

/** A lanes pane draws episodes, not series: it has no legend to keep (the figure's summary and table say the rest). */
function noLegend(): PaneLegend {
  return { handle: { element: document.createElement('div'), update: () => undefined, destroy: () => undefined }, onScale: () => undefined, refresh: () => undefined }
}

interface LaneHover {
  /** After every cursor move on the pane: reports the lane under the pointer when it changes. */
  readonly onCursor: (u: uPlot) => void
  /** The pane is going away: reports "no lane" if one is reported, so the consumer's outline cannot stick. */
  readonly reset: () => void
}

/**
 * The lane under the pointer, reported when it changes. Only the pointer's own move counts: uPlot sets
 * `cursor.event` to the mouse event that moved the cursor and never clears it (setCursor leaves it
 * alone), so a pane that a synced move only follows keeps the source pane's relative height and either
 * no event or a stale one (a mouseleave from the last visit). A crosshair from another library in the
 * link group reaches the pane the same way (sync.ts calls u.setCursor). Those moves are off the lanes
 * here, not the lane at that height; uPlot itself tests `cursor.event.type == 'mousemove'` for the same
 * reason.
 */
function laneHover(spec: LanesSpec, live: { readonly current: PlotsArgs }): LaneHover {
  let reported: number | null = null
  const report = (rank: number | null) => {
    if (rank === reported) return
    reported = rank
    live.current.onLaneHover?.(rank)
  }
  return {
    onCursor: (u) => {
      const { left, top, event } = u.cursor
      const over = event?.type === 'mousemove' && left != null && left >= 0
      report(over ? laneAt(spec, top ?? -1, u.over.clientHeight) : null)
    },
    reset: () => report(null),
  }
}

function buildPane(Ctor: UplotConstructor, c: PaneContext): { plot: uPlot; legend: LegendHandle; reset: () => void } {
  const { a, live, i, el, tokens, gutter } = c
  const pane = a.panes[i]!
  const values = a.data[i]!
  const legend = pane.lanes === undefined ? paneLegend(el, pane, values, a.t, tokens) : noLegend()
  const hover = pane.lanes === undefined ? null : laneHover(pane.lanes, live)
  const isBottom = i === a.panes.length - 1
  const opts = paneOptions({
    pane,
    data: values,
    t: a.t,
    isBottom,
    showFenceLabel: i === 0,
    tokens,
    width: el.clientWidth,
    height: el.clientHeight,
    log: a.log,
    view: a.view,
    sync: paneSync(a.link, `${a.uid}-${i}`, `nqt-stack-${a.uid}`),
    fence: a.fence,
    pxRatio: Ctor.pxRatio > 0 ? Ctor.pxRatio : 1,
    gutter: { shared: gutter, index: i },
    legendBox: () => {
      const box = legend.handle.element
      return { left: box.offsetLeft, top: box.offsetTop, width: box.offsetWidth, height: box.offsetHeight }
    },
    onDraw: (u, info) => {
      writeAttrs(el, u, info)
      legend.onScale(u)
      c.onFirstDraw()
    },
    onCursor: (u) => {
      legend.refresh(u)
      if (i === 0) a.onPointer(cursorIndex(u))
      hover?.onCursor(u)
    },
    spans: a.spans,
    ribbon: isBottom ? a.ribbon : undefined,
    lanesHighlight: () => live.current.highlightLane ?? null,
  })
  const plot = new Ctor(opts, paneUplotData<readonly (number | null)[]>(a.t, pane, values) as unknown as uPlot.AlignedData, el)
  return { plot, legend: legend.handle, reset: () => hover?.reset() }
}

export function useLineStackPlots(a: PlotsArgs): PlotsState {
  const plots = useRef<uPlot[]>([])
  const [drawn, setDrawn] = useState(false)
  const args = useRef(a)
  useLayoutEffect(() => {
    args.current = a
  })
  const { lib, t, panes, data, link, fence, log, uid, paneEls, spans, ribbon, highlightLane } = a

  useEffect(() => {
    if (lib === null) return
    const cur = args.current
    // ChartA11y unmounts the pane hosts while the table view is open (D33): a build dependency (the
    // Log toggle, a refetch) can change while every host is null. Bail without building rather than
    // throw; the hosts coming back (D34, this effect's `paneEls` dep) rebuilds once they are real.
    if (panes.some((_, i) => !cur.paneEls[i])) return undefined
    const tokens = readChartTokens()
    const start = performance.now()
    const waiting = new Set(panes.map((_, i) => i))
    setDrawn(false)
    // When one pane needs a wider value axis (a 7-digit tag), the others follow on the next tick so
    // every plot keeps the same right edge under the shared time axis.
    const gutter = sharedGutter((_width, from) => {
      queueMicrotask(() => plots.current.forEach((u, k) => k !== from && u.redraw(false, true)))
    })
    const built = panes.map((_, i) => {
      const el = cur.paneEls[i]!
      const onFirstDraw = () => {
        if (!waiting.delete(i) || waiting.size > 0) return
        cur.onRender?.(performance.now() - start + cur.takeExtraMs())
        setDrawn(true)
      }
      return buildPane(lib, { a: cur, live: args, i, el, tokens, onFirstDraw, gutter })
    })
    plots.current = built.map((b) => b.plot)
    return () => {
      for (const b of built) {
        b.reset()
        b.plot.destroy()
        b.legend.destroy()
      }
      plots.current = []
    }
  }, [lib, t, panes, data, link, fence, log, uid, paneEls, spans, ribbon])

  useLaneHighlight(plots, panes, highlightLane ?? null)
  useResizePanes(plots, args, a.container)
  return { plots, drawn }
}

/**
 * Redraws the lanes panes (only) when the highlighted lane changes: the plots read the highlight at
 * every draw, so this builds nothing. A build made after the change already drew the new one.
 */
function useLaneHighlight(plots: { readonly current: uPlot[] }, panes: readonly LineStackPane[], highlight: number | null): void {
  const drawnFor = useRef(highlight)
  useEffect(() => {
    if (drawnFor.current === highlight) return
    drawnFor.current = highlight
    plots.current.forEach((u, i) => {
      if (panes[i]?.lanes !== undefined) u.redraw(false)
    })
  }, [plots, panes, highlight])
}

/** Resizes every pane to its host when the stack's box changes size. */
function useResizePanes(plots: { readonly current: uPlot[] }, args: { readonly current: PlotsArgs }, container: HTMLDivElement | null): void {
  useEffect(() => {
    const box = container
    if (box === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      plots.current.forEach((u, i) => {
        const el = args.current.paneEls[i]
        if (el) u.setSize({ width: el.clientWidth, height: el.clientHeight })
      })
    })
    observer.observe(box)
    return () => observer.disconnect()
    // container is the identity that must retrigger this (D34: a table round trip mounts a new box).
  }, [plots, args, container])
}
