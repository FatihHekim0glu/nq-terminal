// The JOBS screen for the workspace, registered in chrome/WorkspaceScreens.tsx (lazy) and listed in
// commands/built.ts BUILT_CODES. The screen takes no context and no argument.
import type { MnemonicCode } from '../../commands/registry'
import { JOBS } from '../../copy/jobs'

export { default as JobsScreen } from './JobsScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  readonly screen: string
  /** The TASKS phase that delivers it (WorkspaceLayouts.SCREEN_PHASES). */
  readonly phase: string
  /** Whether the panel follows its link group's context (it does not). */
  readonly usesContext: boolean
}

export const JOBS_META: ScreenMeta = { code: 'JOBS', screen: JOBS.screen, phase: '12', usesContext: false }
