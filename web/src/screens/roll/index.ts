// ROLL (TASKS Phase 11): the screen and its mnemonic metadata. src/chrome/WorkspaceScreens.tsx registers the
// screen lazily in BUILT_SCREENS; the mnemonic is in src/commands/registry.ts.
import { ROLL } from '../../copy/roll'

export { default as RollScreen } from './RollScreen'
export const ROLL_SCREEN = { code: 'ROLL', title: ROLL.title, phase: '11', accepts: ['instrument'] } as const
