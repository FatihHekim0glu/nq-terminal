// The LIVE and JRNL screens for the workspace (TASKS 7.3). The merge step registers them in
// chrome/WorkspaceScreens.tsx as
//   LIVE: lazy(() => import('../screens/live').then((m) => ({ default: m.LiveScreen }))),
//   JRNL: lazy(() => import('../screens/live').then((m) => ({ default: m.JrnlScreen }))),
// Both are read only and take no context; the LIVE default layout (LIVE above JRNL) already exists.
import type { MnemonicCode } from '../../commands/registry'
import { JRNL, LIVE } from '../../copy/live'

export { default as LiveScreen } from './LiveScreen'
export { default as JrnlScreen } from './JrnlScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  readonly screen: string
  /** The TASKS phase that delivers it (WorkspaceLayouts.SCREEN_PHASES). */
  readonly phase: string
  /** Whether the panel follows its link group's context (neither screen takes one). */
  readonly usesContext: boolean
}

export const LIVE_META: ScreenMeta = { code: 'LIVE', screen: LIVE.screen, phase: '7', usesContext: false }
export const JRNL_META: ScreenMeta = { code: 'JRNL', screen: JRNL.screen, phase: '7', usesContext: false }
