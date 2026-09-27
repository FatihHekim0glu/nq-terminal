// MON (TASKS 7.2): the screen and its mnemonic metadata for the workspace registry. The merge step adds
// `MON: lazy(() => import('../screens/mon/MonScreen'))` to BUILT_SCREENS in src/chrome/WorkspaceScreens.tsx;
// the mnemonic itself is already in src/commands/registry.ts (P0, context universe).
import { MON } from '../../copy/market'

export { default as MonScreen } from './MonScreen'
export const MON_SCREEN = { code: 'MON', title: MON.title, phase: '7.2', accepts: ['universe'] } as const
