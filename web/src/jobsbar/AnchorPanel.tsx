// The anchor re-run region of RUN and LEDG (release 0.2.0): `useAnchorPanel()` keeps the base run the Actions menu chose
// and gives the screen an `open(baseRunId)` and the `panel` to render. Nothing is drawn, read or polled until it is open,
// so a closed screen is exactly what it was. The region holds the re-run control (button, progress, MATCH or MISMATCH)
// and a plain note that this is an exact comparison and not the formal regress_check file. Escape closes it and puts
// the focus back where it was; the button takes the focus when it opens.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'
import AnchorRerun from './AnchorRerun'
import { SERVER_ANCHOR_LAUNCHER } from './anchorLauncher'
import { AnchorLauncherContext } from './anchorRerun.store'
import './AnchorBadge.css'

const P = JOBS_BAR.panel
const roving = { [ROVING_ATTR]: '' }

function AnchorPanel({ baseRunId, onClose }: { readonly baseRunId: string; readonly onClose: () => void }) {
  const headingId = useId()
  const body = useRef<HTMLElement>(null)
  useEffect(() => body.current?.querySelector<HTMLElement>('.anchor-rerun-btn')?.focus(), [baseRunId])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }
  return (
    <section className="anchor-panel" aria-labelledby={headingId} ref={body} onKeyDown={onKeyDown}>
      <h3 id={headingId} className="anchor-panel-heading">{fillCopy(P.heading, { base: baseRunId })}</h3>
      <p className="anchor-panel-note">{fillCopy(P.note, { base: baseRunId })}</p>
      <div className="anchor-panel-row">
        <AnchorLauncherContext value={SERVER_ANCHOR_LAUNCHER}>
          <AnchorRerun baseRunId={baseRunId} />
        </AnchorLauncherContext>
        <button type="button" className="anchor-rerun-btn" onClick={onClose} {...roving}>{P.close}</button>
      </div>
    </section>
  )
}

export interface AnchorPanelHost {
  /** Opens the region for this base run (replacing one already open). */
  readonly open: (baseRunId: string) => void
  readonly close: () => void
  readonly isOpen: boolean
  /** The region, or null while it is closed. */
  readonly panel: ReactNode
}

export function useAnchorPanel(): AnchorPanelHost {
  const [base, setBase] = useState<string | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const open = useCallback((next: string) => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnTo.current = document.activeElement
    setBase(next)
  }, [])
  const close = useCallback(() => {
    setBase(null)
    const back = returnTo.current
    returnTo.current = null
    if (back !== null && back.isConnected) back.focus()
  }, [])
  return { open, close, isOpen: base !== null, panel: base === null ? null : <AnchorPanel baseRunId={base} onClose={close} /> }
}
