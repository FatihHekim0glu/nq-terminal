// Loading and error text for the market screens (MON, CORR, VCONE, SEAS, EVT, ROLL and DQ). A 403 is
// the OOS gate refusing: its own message is shown as it came (TASKS 7.1 and 7.2 honesty rule), in
// amber; any other failure names the API detail; while the connection store is down and the failure is
// an outage, PanelFault shows the waiting line instead (roadmap #7).
import { ApiError } from '../../api/client'
import PanelFault, { PanelLoading } from '../../chrome/PanelFault'
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

export default function QueryStatus({ loading, error, loadingText = MARKET.loading, failedText = MARKET.failed }: QueryStatusProps) {
  if (error) {
    return <PanelFault className="mkt-status" error={error} failedText={failedText} refusedText={MARKET.refused} />
  }
  // Busy while loading, so readers and screenshots wait for the screen, not this line (not busy while
  // the backend is down and has not been tried yet: PanelLoading shows the waiting sentence instead).
  if (loading) return <PanelLoading className="mkt-status" text={loadingText} />
  return null
}
