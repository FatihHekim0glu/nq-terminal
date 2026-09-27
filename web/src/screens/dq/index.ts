// DQ (TASKS Phase 11): the screen and its mnemonic metadata. src/chrome/WorkspaceScreens.tsx registers the
// screen lazily in BUILT_SCREENS; the mnemonic is in src/commands/registry.ts.
import { DQ } from '../../copy/dq'

export { default as DqScreen } from './DqScreen'
export const DQ_SCREEN = { code: 'DQ', title: DQ.title, phase: '11', accepts: ['instrument'] } as const
