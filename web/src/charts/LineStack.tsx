// LineStack (TASKS 5.1; UI_SPEC sections 2, 5, 6 and 9; look spec 6 and 7.5): uPlot panes stacked on
// one time axis for equity, underwater, rolling and difference series. Options come from the charts
// theme (makeUplotTheme, lineStackSeries); uPlot loads lazily (lazy.ts). It draws the OOS fence, a
// zero line where the pane asks for one, last-value tags and an HTML legend; the crosshair is synced
// across the link group; range buttons, + and - zoom, and the keyboard crosshair move the view; and
// the whole stack is one role="img" with a data summary and a table view (ChartA11y).
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import 'uplot/dist/uPlot.min.css'
import { LINE_STACK } from '../copy/lineStack'
import { fillCopy } from '../copy/workspace'
import ChartA11y from './ChartA11y'
import { FENCE_TIME } from './fence'
import { loadUplot, useChartLibrary } from './lazy'
import { useStackControls, windowFor, type View } from './LineStack.controls'
import { cleanValues, readoutText, stackSummary, stackTable, type Values } from './LineStack.model'
import { useLineStackPlots } from './LineStack.plots'
import { LineStackToolbar } from './LineStack.toolbar'
import type { LineStackPane, LineStackProps } from './LineStack.types'
import './LineStack.css'

/** A pointer readout is announced at most this often (ChartA11y asks callers to throttle). */
const READOUT_THROTTLE_MS = 250
/** The bottom pane also holds the 45px time axis. */
const TIME_AXIS_PX = 45

function allPositive(values: readonly Values[]): boolean {
  return values.every((v) => v.every((x) => x === null || x > 0))
}

/** A held arrow key's readout waits this long after the last repeat, then announces once. */
const KEY_REPEAT_SETTLE_MS = 300

type ReadoutSetters = readonly [
  idx: number | null,
  onKey: (idx: number | null, repeat: boolean) => void,
  onPointer: (idx: number | null) => void,
]

/**
 * The crosshair index for the polite readout. A single key press sets it at once; an auto-repeating
 * key and the pointer would flood a screen reader, so a repeat train commits once it stops, and the
 * pointer at most every READOUT_THROTTLE_MS.
 */
function useReadoutIndex(): ReadoutSetters {
  const [idx, setIdx] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
    clearTimeout(keyTimer.current)
  }, [])
  const onKey = useCallback((next: number | null, repeat: boolean) => {
    // The key's own setCursor also reached the pointer path; the key owns this move.
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    clearTimeout(keyTimer.current)
    if (!repeat) setIdx(next)
    else keyTimer.current = setTimeout(() => setIdx(next), KEY_REPEAT_SETTLE_MS)
  }, [])
  const throttled = useCallback((next: number | null) => {
    latest.current = next
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      setIdx(latest.current)
    }, READOUT_THROTTLE_MS)
  }, [])
  return [idx, onKey, throttled]
}

function useCleanData(panes: readonly LineStackPane[]): { data: Values[][]; takeMs: () => number } {
  const ms = useRef(0)
  const data = useMemo(() => {
    const start = performance.now()
    const out = panes.map((p) => p.series.map((s) => cleanValues(s.values)))
    ms.current = performance.now() - start
    return out
  }, [panes])
  const takeMs = useCallback(() => {
    const value = ms.current
    ms.current = 0
    return value
  }, [])
  return { data, takeMs }
}

function PaneHosts({ panes, hostRef, container, drawn }: {
  readonly panes: readonly LineStackPane[]
  /** A stable (per index) callback ref, so ChartA11y remounting the hosts (table view) is the only
   *  thing that changes their state identity; a fresh function every render would too (D34). */
  readonly hostRef: (i: number) => (el: HTMLDivElement | null) => void
  readonly container: (el: HTMLDivElement | null) => void
  readonly drawn: boolean
}) {
  return (
    <div ref={container} className="linestack-panes" data-chart-lib="uplot" aria-busy={!drawn}>
      {panes.map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 ? <div className="chart-splitter" /> : null}
          <div
            ref={hostRef(i)}
            className="linestack-pane"
            data-pane={p.id}
            style={{ flex: `${p.weight ?? 1} 1 ${i === panes.length - 1 ? TIME_AXIS_PX : 0}px` }}
          />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * The pane hosts as state (D33, D34): ChartA11y unmounts them while the table view is open and
 * remounts fresh elements when it closes, and only a state (not a mutable ref) identity change
 * reruns the plot build effect. Each index keeps the same callback ref across renders, so a re-render
 * that does not remount the DOM (a readout key press, a range button) never re-fires the refs.
 */
function usePaneHosts(): { readonly hosts: readonly (HTMLDivElement | null)[]; readonly hostRef: (i: number) => (el: HTMLDivElement | null) => void } {
  const [hosts, setHosts] = useState<(HTMLDivElement | null)[]>([])
  const callbacks = useRef(new Map<number, (el: HTMLDivElement | null) => void>())
  const hostRef = useCallback((i: number) => {
    let fn = callbacks.current.get(i)
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        setHosts((prev) => {
          if (prev[i] === el && prev.length > i) return prev
          const next = prev.slice()
          next[i] = el
          return next
        })
      }
      callbacks.current.set(i, fn)
    }
    return fn
  }, [])
  return { hosts, hostRef }
}

export default function LineStack(props: LineStackProps) {
  const { title, t, panes, link = '-', fence = FENCE_TIME, initialRange = 'Max', onRender } = props
  const [loader] = useState(() => props.loader ?? loadUplot)
  const lib = useChartLibrary(loader)
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const view = useRef<View>(windowFor(initialRange, t, fence))
  const [log, setLog] = useState(false)
  const [readoutIdx, onKeyReadout, onPointer] = useReadoutIndex()
  const cursorIdx = useRef<number | null>(null)
  const { hosts, hostRef } = usePaneHosts()
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const { data, takeMs } = useCleanData(panes)
  const summary = useMemo(() => stackSummary(t, panes), [t, panes])
  const table = useMemo(() => stackTable(title, t, panes), [title, t, panes])
  const logAvailable = useMemo(() => panes.every((p, i) => p.logAllowed !== true || allPositive(data[i]!)), [panes, data])
  const pointer = useCallback((idx: number | null) => {
    cursorIdx.current = idx
    onPointer(idx)
  }, [onPointer])
  const { plots, drawn } = useLineStackPlots({
    lib: lib.status === 'ready' ? lib.lib : null,
    t, panes, data, link, fence, log: log && logAvailable, uid,
    view: () => view.current,
    paneEls: hosts, container: containerEl, onPointer: pointer, onRender, takeExtraMs: takeMs,
  })
  const controls = useStackControls({ t, data, fence, initialRange, plots, view, cursorIdx, onReadout: onKeyReadout })
  return (
    <div className="linestack">
      <ChartA11y
        label={summary}
        table={table}
        readout={readoutIdx === null ? LINE_STACK.readoutIdle : readoutText(t, panes, readoutIdx)}
        onKeyDown={controls.onKeyDown}
        toolbar={
          <LineStackToolbar
            range={controls.range}
            onRange={controls.chooseRange}
            log={log && logAvailable}
            onLog={setLog}
            logShown={panes.some((p) => p.logAllowed === true)}
            logAvailable={logAvailable}
          />
        }
      >
        {lib.status === 'error' ? <p className="chart-refusal" role="alert">{fillCopy(LINE_STACK.failed, { error: lib.error.message })}</p> : null}
        <PaneHosts panes={panes} hostRef={hostRef} container={setContainerEl} drawn={drawn} />
      </ChartA11y>
    </div>
  )
}
