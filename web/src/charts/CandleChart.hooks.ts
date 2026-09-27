// CandleChart hooks: mounting the engine, and the cursor state. The legend follows the crosshair at once; the readout, a polite live
// region, follows a key press at once but an auto-repeating key, pointer and link-group moves only
// once they settle, so a screen reader is not flooded while a key is held or the mouse sweeps. The event data tip shows
// after the pointer rests on a bar with a fill or roll and hides at once when it leaves.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { mountCandleChart, type CandleEngine, type CandleEngineInput, type CandleView, type CursorEvent } from './CandleChart.engine'
import type { ChartLibraryState, LwcModule } from './lazy'
import { eventText, type BarEvents } from './CandleChart.model'
import type { TipState } from './CandleChart.overlays'
import { CHART_GEOMETRY as G, readChartTokens } from './theme'

/** How long a held key, a pointer or a linked move must settle before the readout announces it. */
export const READOUT_SETTLE_MS = 300

export interface CandleCursor {
  /** The bar the legend shows (null: the last bar). */
  readonly legend: number | null
  /** The bar the readout shows (null: the last bar). */
  readonly readout: number | null
  readonly tip: TipState | null
  readonly onCursor: (event: CursorEvent) => void
  /** Runs a key's engine action; `repeat` (the key auto-repeats) makes its readout wait to settle. */
  readonly onKey: (repeat: boolean, run: () => void) => void
}

export function useCandleCursor(events: BarEvents, precision: number): CandleCursor {
  const [legend, setLegend] = useState<number | null>(null)
  const [readout, setReadout] = useState<number | null>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const readoutTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keyRepeat = useRef(false)
  const latest = useRef({ events, precision })
  useEffect(() => {
    latest.current = { events, precision }
  }, [events, precision])

  useEffect(() => () => {
    clearTimeout(readoutTimer.current)
    clearTimeout(tipTimer.current)
  }, [])

  const onCursor = useCallback((e: CursorEvent) => {
    setLegend(e.index)
    clearTimeout(readoutTimer.current)
    if (e.source === 'keyboard' && !keyRepeat.current) setReadout(e.index)
    else readoutTimer.current = setTimeout(() => setReadout(e.index), READOUT_SETTLE_MS)
    clearTimeout(tipTimer.current)
    setTip(null)
    const list = e.index === null ? undefined : latest.current.events.get(e.index)
    if (e.source !== 'pointer' || !e.point || !list?.length) return
    const tipAt = { x: e.point.x, y: e.point.y, lines: list.map((ev) => eventText(ev, latest.current.precision)) }
    tipTimer.current = setTimeout(() => setTip(tipAt), G.datatipDelayMs)
  }, [])

  const onKey = useCallback((repeat: boolean, run: () => void) => {
    keyRepeat.current = repeat
    try {
      run()
    } finally {
      keyRepeat.current = false
    }
  }, [])

  return { legend, readout, tip, onCursor, onKey }
}

/** Runs `run` after two painted frames; returns the cancel. */
export function afterTwoFrames(run: () => void): () => void {
  let second = 0
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(run)
  })
  return () => {
    cancelAnimationFrame(first)
    cancelAnimationFrame(second)
  }
}

export interface EngineHookInput extends Omit<CandleEngineInput, 'tokens'> {
  readonly onCursor: (event: CursorEvent) => void
  readonly onRendered?: (ms: number) => void
}

export interface EngineHook {
  readonly engine: RefObject<CandleEngine | null>
  readonly drawn: boolean
  readonly view: CandleView | null
}

/**
 * Mounts the chart once the library is in and `host` exists; rebuilds it when an input or the host
 * element changes (ChartA11y unmounts the host while the table view is open).
 */
export function useCandleEngine(lib: ChartLibraryState<LwcModule>, host: HTMLElement | null, input: EngineHookInput): EngineHook {
  const engine = useRef<CandleEngine | null>(null)
  const [drawn, setDrawn] = useState(false)
  const [view, setView] = useState<CandleView | null>(null)
  const onRendered = useRef(input.onRendered)
  useEffect(() => {
    onRendered.current = input.onRendered
  }, [input.onRendered])
  const { bars, step, intraday, timeZone, fills, rolls, indicator, precision, minMove, grid, link, chartId, onCursor } = input

  useEffect(() => {
    const el = host
    if (lib.status !== 'ready' || el === null) return
    const started = performance.now()
    const eng = mountCandleChart(lib.lib, el, {
      bars, step, intraday, timeZone, fills, rolls, ...(indicator ? { indicator } : {}), precision, minMove, grid, link, chartId,
      tokens: readChartTokens(),
    }, { onCursor, onView: setView })
    engine.current = eng
    const cancelFrames = afterTwoFrames(() => {
      setDrawn(true)
      onRendered.current?.(performance.now() - started)
    })
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => eng.refresh()) : null
    resize?.observe(el)
    return () => {
      cancelFrames()
      resize?.disconnect()
      eng.dispose()
      engine.current = null
      setDrawn(false)
    }
  }, [lib, host, bars, step, intraday, timeZone, fills, rolls, indicator, precision, minMove, grid, link, chartId, onCursor])

  return { engine, drawn, view }
}

/**
 * The zoom state for the readout: the first view at once (so the drawn chart is complete), later
 * changes once they settle (so a wheel zoom is announced once).
 */
export function useSettledShown(view: CandleView | null): number | null {
  const [settled, setSettled] = useState<number | null>(null)
  const current = view?.shown ?? null
  useEffect(() => {
    const id = setTimeout(() => setSettled(current), READOUT_SETTLE_MS)
    return () => clearTimeout(id)
  }, [current])
  return settled ?? current
}
