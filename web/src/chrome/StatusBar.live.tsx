// The status line on live data: GET /api/health (polled every 2 s by the shared query hook) and the
// link-group store. Instrument sector keys come from the known roots (sectors.ts), so this reads
// nothing else. The presentational StatusBar stays props-only.
import { useHealth } from '../api/queries'
import type { MnemonicCode } from '../commands/registry'
import { useLinkGroups } from '../state/linkGroups'
import { StatusBar, type HealthState } from './StatusBar'

export interface LiveStatusBarProps {
  readonly screen: MnemonicCode
}

/** The health query as the chrome shows it: a failed poll is unknown, never an earlier answer. */
export function useHealthState(): HealthState {
  const health = useHealth()
  if (health.isError) return { status: 'error' }
  return health.data ? { status: 'ok', data: health.data } : { status: 'loading' }
}

export function LiveStatusBar({ screen }: LiveStatusBarProps) {
  const state = useHealthState()
  const contexts = useLinkGroups((s) => s.contexts)
  return <StatusBar screen={screen} contexts={contexts} health={state} />
}
