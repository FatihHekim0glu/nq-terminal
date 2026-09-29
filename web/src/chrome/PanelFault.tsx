// PanelFault (roadmap #7): the one fault line every panel's status area shows for a request that
// failed or was refused, and the waiting line it shows instead while the connection store is down and
// the failure is an outage (W1's isOutage): network, 502 to 504, or a bodiless 500 (the dev proxy
// answering an unreachable backend). A screen still owns its own wording (failedText, refusedText);
// this only decides which of the three states applies and renders it, tokens only.
//
// PanelLoading is the loading-side twin: busy (aria-busy) while the backend is reachable, a plain,
// not-busy status line while it is down, so a reader is not told to keep waiting for a request that
// has not even been tried yet.
import { useStore } from 'zustand'
import { ApiError } from '../api/client'
import { connectionStore, isOutage } from '../api/connection'
import { CONNECTION } from '../copy/connection'
import { MARKET } from '../copy/market'
import { fillCopy } from '../copy/workspace'
import { ROVING_ATTR } from './WorkspaceFocus'
import './PanelFault.css'

const FORBIDDEN = 403
const roving = { [ROVING_ATTR]: '' }

/** Down, and `error` (null counts as not tried yet) is not itself a refusal or another non-outage
 *  failure: the backend has not answered at all, so a fault or a loading line should say so rather
 *  than blame the request in front of it. Reads only the store's status (useStore's own selector),
 *  so a health poll that changes lastCheckAt but not status re-renders nothing here. */
export function useWaitingForBackend(error: ApiError | null): boolean {
  const down = useStore(connectionStore, (s) => s.status === 'down')
  return down && (error === null || isOutage(error))
}

/** The waiting sentence for one ApiError: `GET <path without query> answered <status or no answer>.` */
export function waitingLine(error: ApiError): string {
  const path = error.path.split('?')[0]
  const answer = error.status !== 0 ? String(error.status) : CONNECTION.noAnswer
  return fillCopy(CONNECTION.waiting, { request: `GET ${path}`, answer })
}

function classes(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ')
}

export interface PanelFaultProps {
  readonly error: unknown
  /** A template with a {detail} slot, filled with the error's own detail text. */
  readonly failedText: string
  /** A template with a {detail} slot, shown instead of failedText for a 403; MARKET.refused by default. */
  readonly refusedText?: string
  readonly onRetry?: () => void
  readonly className?: string
}

export default function PanelFault({ error, failedText, refusedText = MARKET.refused, onRetry, className }: PanelFaultProps) {
  const apiError = error instanceof ApiError ? error : null
  const down = useWaitingForBackend(apiError)
  const waiting = apiError !== null && down

  if (waiting) {
    return (
      <p role="status" className={classes('panel-fault', 'panel-fault-waiting', className)}>
        {waitingLine(apiError)}
      </p>
    )
  }
  if (apiError !== null && apiError.status === FORBIDDEN) {
    return (
      <p role="alert" className={classes('panel-fault', 'panel-fault-refused', className)}>
        {fillCopy(refusedText, { detail: apiError.detail })}
      </p>
    )
  }
  const detail = apiError ? apiError.detail : error instanceof Error ? error.message : String(error)
  return (
    <p role="alert" className={classes('panel-fault', 'panel-fault-failed', className)}>
      {fillCopy(failedText, { detail })}
      {onRetry ? (
        <button type="button" className="panel-fault-retry" aria-label={CONNECTION.retryLabel} onClick={() => onRetry()} {...roving}>
          {CONNECTION.retry}
        </button>
      ) : null}
    </p>
  )
}

export interface PanelLoadingProps {
  readonly text: string
  readonly className?: string
}

export function PanelLoading({ text, className }: PanelLoadingProps) {
  const waiting = useWaitingForBackend(null)
  if (waiting) {
    return (
      <p role="status" className={classes('panel-fault', 'panel-fault-waiting', className)}>
        {CONNECTION.waitingLoad}
      </p>
    )
  }
  return (
    <p role="status" aria-busy="true" className={classes('panel-fault', className)}>
      {text}
    </p>
  )
}
