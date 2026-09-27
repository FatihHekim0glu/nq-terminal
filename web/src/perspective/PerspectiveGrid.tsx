// The Perspective viewer as a panel component (TASKS 9.1). Everything the engine needs loads on first
// mount (engine.ts); the component then makes one named table from the declared schema, fills it with
// the rows, points a <perspective-viewer> at it and restores the dataset's preset. The viewer is themed
// from the look tokens (perspective.css) and sits in one focusable host: Tab reaches it (a roving stop
// in the panel), arrow keys and Page Up and Page Down scroll the grid, Tab again enters the viewer's own
// controls and Escape brings focus back to the host. Around it: a [POST HOC] note, a polite status and the row count.
// `data-psp-state` and `data-psp-load-ms` expose the state and the table-to-painted time to the E2E run.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ROVING_ATTR, ROVING_SCROLL_ATTR } from '../chrome/WorkspaceFocus'
import { PIVOT } from '../copy/perspective'
import { fillCopy } from '../copy/workspace'
import type { PivotPreset } from './datasets'
import { loadPerspective } from './engine'
import { mountViewer, releaseViewer, withTimeout, type MountViewerElement, type PivotTiming, type TableHandle } from './mount'
import type { PspColumnar, PspSchema } from './schema'
import { applyScroll, deepQuery, scrollStep } from './scroll'
import '@perspective-dev/viewer/dist/css/pro-dark.css'
import './perspective.css'

// Upgraded by the engine it has delete(); a viewer whose engine never started is a plain element without it.
interface ViewerElement extends HTMLElement, MountViewerElement {
  delete?: () => Promise<unknown>
}

export type { PivotTiming }

export interface PerspectiveGridProps {
  /** What the grid holds, for its accessible name (`Fills of <run>`). */
  readonly name: string
  readonly schema: PspSchema
  readonly data: PspColumnar
  readonly rows: number
  readonly preset: PivotPreset
  readonly onRendered?: (timing: PivotTiming) => void
  /** The engine or the viewer could not start: the pivot view then shows its accessible table instead. */
  readonly onFailed?: (detail: string) => void
}

/** An engine that has not started by then counts as failed, so the view falls back to its table. */
const ENGINE_START_MS = 20_000

const startEngine = () => withTimeout(loadPerspective(), ENGINE_START_MS, PIVOT.engineTimeout)

type Phase = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly timing: PivotTiming } | { readonly kind: 'error'; readonly detail: string }

// A roving stop that takes the panel's Tab stop (it scrolls on its own; WorkspaceFocus).
const roving = { [ROVING_ATTR]: '', [ROVING_SCROLL_ATTR]: '' }

function useViewer(host: React.RefObject<HTMLDivElement | null>, props: PerspectiveGridProps): Phase {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const latest = useRef(props)
  latest.current = props
  const { schema, data, preset } = props
  useEffect(() => {
    const el = host.current
    if (!el) return undefined
    let alive = true
    let table: TableHandle | null = null
    const viewer = document.createElement('perspective-viewer') as ViewerElement
    viewer.className = 'nqt-psp'
    el.append(viewer)
    setPhase({ kind: 'loading' })
    mountViewer(viewer, { ...latest.current, schema, data, preset }, () => alive, startEngine).then(
      (done) => {
        if (done === null) return
        // Unmounted during the viewer's own load: the cleanup below has already run without this table.
        if (!alive) {
          void done.table.delete().catch(() => undefined)
          return
        }
        table = done.table
        setPhase({ kind: 'ready', timing: done.timing })
        latest.current.onRendered?.(done.timing)
      },
      (error: unknown) => {
        if (!alive) return
        const detail = error instanceof Error ? error.message : String(error)
        setPhase({ kind: 'error', detail })
        latest.current.onFailed?.(detail)
      },
    )
    return () => {
      alive = false
      void releaseViewer(viewer, table)
    }
  }, [host, schema, data, preset])
  return phase
}

function statusText(phase: Phase, rows: number): string {
  if (phase.kind === 'error') return fillCopy(PIVOT.failed, { detail: phase.detail })
  if (phase.kind === 'loading') return PIVOT.loadingEngine
  return fillCopy(PIVOT.ready, { rows: rows.toLocaleString('en-GB') })
}

export default function PerspectiveGrid(props: PerspectiveGridProps) {
  const host = useRef<HTMLDivElement>(null)
  const phase = useViewer(host, props)
  const noteId = useId()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Tab can move into the viewer's own controls (its shadow tree); Escape always brings focus back to the
    // grid's single Tab stop, so the panel is never a keyboard trap (WCAG 2.1.2).
    if (e.target !== e.currentTarget && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.focus()
      return
    }
    if (e.target !== e.currentTarget) return
    const table = host.current ? deepQuery(host.current, 'regular-table') : null
    const step = scrollStep(e.key, table?.clientHeight ?? 0, e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
    if (!table || !step) return
    e.preventDefault()
    applyScroll(table, step)
  }
  const timing = phase.kind === 'ready' ? phase.timing : null
  return (
    <div className="nqt-psp-panel">
      <p className="nqt-psp-note" id={noteId}>
        <span className="nqt-psp-tag">{PIVOT.tag}</span> {PIVOT.note} {PIVOT.keys}
      </p>
      <p className={phase.kind === 'error' ? 'nqt-psp-status nqt-psp-error' : 'nqt-psp-status'} role={phase.kind === 'error' ? 'alert' : 'status'}>
        {statusText(phase, props.rows)}
      </p>
      <div
        ref={host}
        className="nqt-psp-host"
        role="group"
        tabIndex={0}
        aria-label={fillCopy(PIVOT.region, { name: props.name, rows: props.rows.toLocaleString('en-GB') })}
        aria-describedby={noteId}
        aria-busy={phase.kind === 'loading'}
        data-psp-state={phase.kind}
        data-psp-load-ms={timing ? timing.loadMs.toFixed(1) : undefined}
        data-psp-engine-ms={timing ? timing.engineMs.toFixed(1) : undefined}
        onKeyDown={onKeyDown}
        {...roving}
      />
    </div>
  )
}
