// The OOS screen for the workspace (TASKS 7.3). The merge step registers it in
// chrome/WorkspaceScreens.tsx as `OOS: lazy(() => import('../screens/oos'))`; the default export is
// the screen, so the lazy import needs no adapter.
import type { MnemonicCode } from '../../commands/registry'
import { OOS } from '../../copy/oos'

export { default } from './OosScreen'
export { default as OosScreen } from './OosScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  readonly screen: string
  /** The TASKS phase that delivers it (WorkspaceLayouts.SCREEN_PHASES). */
  readonly phase: string
  /** Whether the panel follows its link group's context (OOS takes no context). */
  readonly usesContext: boolean
}

export const OOS_META: ScreenMeta = { code: 'OOS', screen: OOS.screen, phase: '7', usesContext: false }
