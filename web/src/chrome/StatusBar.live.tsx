// The status bar on live data: GET /api/health (polled every 2 s by the shared query hook) and the
// link-group store. The presentational StatusBar stays props-only.
import { useHealth } from '../api/queries'
import type { MnemonicCode } from '../commands/registry'
import { useLinkGroups } from '../state/linkGroups'
import { StatusBar, type HealthState } from './StatusBar'

export interface LiveStatusBarProps {
  readonly screen: MnemonicCode
}

export function LiveStatusBar({ screen }: LiveStatusBarProps) {
  const health = useHealth()
  const contexts = useLinkGroups((state) => state.contexts)
  // A failed poll shows the kill state as unknown, never an earlier answer as if it were current.
  const state: HealthState = health.isError
    ? { status: 'error' }
    : health.data
      ? { status: 'ok', data: health.data }
      : { status: 'loading' }
  return <StatusBar screen={screen} contexts={contexts} health={state} />
}
