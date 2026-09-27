// CORR (TASKS 7.2): the screen and its mnemonic metadata for the workspace registry. The merge step adds
// `CORR: lazy(() => import('../screens/corr/CorrScreen'))` to BUILT_SCREENS in
// src/chrome/WorkspaceScreens.tsx; the mnemonic itself is already in src/commands/registry.ts (P0,
// context universe).
import { CORR } from '../../copy/corr'

export { default as CorrScreen } from './CorrScreen'
export const CORR_SCREEN = { code: 'CORR', title: CORR.title, phase: '7.2', accepts: ['universe'] } as const
