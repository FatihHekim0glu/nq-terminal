// The status line on live data: GET /api/health (polled every 2 s by the shared query hook, backing off
// while the connection is down), the connection state that poll drives, the link-group store and the
// record watch the shell hands in. Instrument sector keys come from the known roots (sectors.ts), so this
// reads nothing else. The presentational StatusBar stays props-only.
import { useConnection } from '../api/connection'
import { useHealth } from '../api/queries'
import type { MnemonicCode } from '../commands/registry'
import { useLinkGroups } from '../state/linkGroups'
import type { RecordWatchView } from './RecordWatch.live'
import { StatusBar, type HealthState } from './StatusBar'

export interface LiveStatusBarProps {
  readonly screen: MnemonicCode
  /** The viewer has a saved layout for `screen` (shows the edited mark). */
  readonly edited?: boolean
  /** The record watch (useRecordWatch); without it the status line has no WATCH segment. */
  readonly watch?: RecordWatchView
}

/** The health query as the chrome shows it: a failed poll is unknown, never an earlier answer. */
export function useHealthState(): HealthState {
  const health = useHealth()
  if (health.isError) return { status: 'error' }
  return health.data ? { status: 'ok', data: health.data } : { status: 'loading' }
}

export function LiveStatusBar({ screen, edited, watch }: LiveStatusBarProps) {
  const state = useHealthState()
  const connection = useConnection()
  const contexts = useLinkGroups((s) => s.contexts)
  return <StatusBar screen={screen} edited={edited} contexts={contexts} health={state} connection={connection} watch={watch} />
}
