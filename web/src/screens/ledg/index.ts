// LEDG (TASKS 6.3) for the workspace. The merge step registers it in src/chrome/WorkspaceScreens.tsx
// through lazy(), so the screen and the grid library load only when a panel shows LEDG:
//   LEDG: lazy(() => import('../screens/ledg').then((m) => ({ default: m.LedgScreen }))),
// The mnemonic is already in src/commands/registry.ts (context none) and on the key toolbar.
import type { MnemonicCode } from '../../commands/registry'
import type { ContextKind } from '../../commands/types'
import { LEDG } from './copy'

export { default as LedgScreen } from './LedgScreen'

export const LEDG_SCREEN_META: {
  readonly code: MnemonicCode
  readonly title: string
  readonly accepts: readonly ContextKind[]
  readonly phase: string
  readonly follows: string
} = { code: 'LEDG', title: LEDG.title, accepts: [], phase: '6.3', follows: 'HP density: weekday dates, balance in text; no PRTU totals row, because a sum is not an API value' }
