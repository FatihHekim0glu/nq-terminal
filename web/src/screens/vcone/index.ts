// VCONE (TASKS Phase 11): the screen and its mnemonic metadata. src/chrome/WorkspaceScreens.tsx registers the
// screen lazily in BUILT_SCREENS; the mnemonic is in src/commands/registry.ts.
import { VCONE } from '../../copy/vcone'

export { default as VconeScreen } from './VconeScreen'
export const VCONE_SCREEN = { code: 'VCONE', title: VCONE.title, phase: '11', accepts: ['instrument'] } as const
