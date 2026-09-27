// EVT (TASKS Phase 11): the screen and its mnemonic metadata. src/chrome/WorkspaceScreens.tsx registers the
// screen lazily in BUILT_SCREENS; the mnemonic is in src/commands/registry.ts.
import { EVT } from '../../copy/evt'

export { default as EvtScreen } from './EvtScreen'
export const EVT_SCREEN = { code: 'EVT', title: EVT.title, phase: '11', accepts: ['instrument'] } as const
