// Loading and error text for the market screens. A 403 is the OOS gate refusing: its own message is
// shown as it came (TASKS 7.1 and 7.2 honesty rule), in amber; any other failure names the API detail.
import { ApiError } from '../../api/client'
import { fillCopy } from '../../copy/workspace'
import { MARKET } from '../../copy/market'

const FORBIDDEN = 403

export function errorText(error: unknown, failed: string = MARKET.failed): string {
  if (error instanceof ApiError) {
    if (error.status === FORBIDDEN) return fillCopy(MARKET.refused, { detail: error.detail })
    return fillCopy(failed, { detail: error.detail })
  }
  return fillCopy(failed, { detail: error instanceof Error ? error.message : String(error) })
}

export interface QueryStatusProps {
  readonly loading: boolean
  readonly error: unknown
  readonly loadingText?: string
  readonly failedText?: string
}

export default function QueryStatus({ loading, error, loadingText = MARKET.loading, failedText }: QueryStatusProps) {
  if (error) {
    const refused = error instanceof ApiError && error.status === FORBIDDEN
    return (
      <p className={refused ? 'mkt-status mkt-refused' : 'mkt-status mkt-error'} role="alert">
        {errorText(error, failedText)}
      </p>
    )
  }
  // Busy while loading, so readers and screenshots wait for the screen, not this line.
  if (loading) return <p className="mkt-status" role="status" aria-busy="true">{loadingText}</p>
  return null
}
