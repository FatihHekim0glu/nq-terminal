// LineStack's view controls: the range buttons, + and - zoom, and the keyboard crosshair (UI_SPEC
// section 5: Left and Right step one bar, Home and End jump to the ends). The view lives in a ref
// that every pane's x scale reads, and changes go to uPlot at once (batch) so a keyboard move that
// pans the view can place the cursor in the same frame.
import { useEffect, useState, type KeyboardEvent } from 'react'
import type uPlot from 'uplot'
import { viewMaxWithFence } from './fence'
import { rangeWindow, stepCrosshair, zoomView, type Values } from './LineStack.model'
import type { RangeKey } from './LineStack.types'
import type { UplotSyncPlot } from './sync'

export type View = readonly [number, number]

const DAY = 86_400
/** Zoom never goes narrower than this many bars. */
const MIN_ZOOM_BARS = 4
const ZOOM_IN = 0.5
const ZOOM_OUT = 2

/** The window a range shows, reaching out to the fence when the data stops just short of it. */
export function windowFor(key: RangeKey, t: readonly number[], fence: number | null): View {
  if (t.length === 0) return [0, DAY]
  const [lo, hi] = rangeWindow(key, t[0]!, t[t.length - 1]!)
  const max = fence === null ? hi : viewMaxWithFence(hi, fence)
  return max > lo ? [lo, max] : [lo - DAY / 2, max + DAY / 2]
}

function setView(plots: readonly uPlot[], view: View): void {
  for (const u of plots) u.batch(() => u.setScale('x', { min: view[0], max: view[1] }))
}

/** Puts the crosshair on bar `idx` of the first pane and publishes it to the pane sync and link group. */
function placeCursor(u: uPlot, t: readonly number[], first: readonly Values[] | undefined, idx: number): void {
  const y = first?.find((v) => v[idx] !== null)?.[idx] ?? null
  const top = y === null ? u.over.clientHeight / 2 : u.valToPos(y, 'y')
  ;(u as unknown as UplotSyncPlot).setCursor({ left: u.valToPos(t[idx]!, 'x'), top }, true, true)
}

function zoomed(view: View, factor: number, centre: number, t: readonly number[], fence: number | null): View {
  const bounds = windowFor('Max', t, fence)
  const minWidth = t.length > 1 ? ((t[t.length - 1]! - t[0]!) / (t.length - 1)) * MIN_ZOOM_BARS : DAY
  return zoomView(view, factor, centre, bounds, minWidth)
}

export interface ControlsArgs {
  readonly t: readonly number[]
  readonly data: readonly (readonly Values[])[]
  readonly fence: number | null
  readonly initialRange: RangeKey
  readonly plots: { readonly current: uPlot[] }
  readonly view: { current: View }
  readonly cursorIdx: { current: number | null }
  /** A keyboard move; `repeat` is true while the key auto-repeats (the readout then waits). */
  readonly onReadout: (idx: number, repeat: boolean) => void
}

export interface Controls {
  /** The pressed range button, or null after a zoom or a pan. */
  readonly range: RangeKey | null
  readonly chooseRange: (key: RangeKey) => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export function useStackControls(a: ControlsArgs): Controls {
  const { t, fence, initialRange, view } = a
  const [range, setRange] = useState<RangeKey | null>(initialRange)

  useEffect(() => {
    view.current = windowFor(initialRange, t, fence)
    setRange(initialRange)
  }, [t, fence, initialRange, view])

  const apply = (next: View, key: RangeKey | null) => {
    view.current = next
    setRange(key)
    setView(a.plots.current, next)
  }

  const zoom = (factor: number) => {
    const centre = a.cursorIdx.current !== null ? t[a.cursorIdx.current]! : (view.current[0] + view.current[1]) / 2
    const next = zoomed(view.current, factor, centre, t, fence)
    const full = windowFor('Max', t, fence)
    apply(next, next[0] === full[0] && next[1] === full[1] ? 'Max' : null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const first = a.plots.current[0]
    if (!first || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault()
      zoom(event.key === '-' ? ZOOM_OUT : ZOOM_IN)
      return
    }
    const step = stepCrosshair(event.key, a.cursorIdx.current, t, view.current)
    if (step === null) return
    event.preventDefault()
    if (step.view !== view.current) apply(step.view, null)
    a.cursorIdx.current = step.idx
    placeCursor(first, t, a.data[0], step.idx)
    a.onReadout(step.idx, event.repeat)
  }

  return { range, chooseRange: (key) => apply(windowFor(key, t, fence), key), onKeyDown }
}
