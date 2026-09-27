// SEAS (TASKS Phase 11): the screen and its mnemonic metadata. src/chrome/WorkspaceScreens.tsx registers the
// screen lazily in BUILT_SCREENS; the mnemonic is in src/commands/registry.ts. It takes an instrument or a
// hypothesis.
import { SEAS } from '../../copy/seas'

export { default as SeasScreen } from './SeasScreen'
export const SEAS_SCREEN = { code: 'SEAS', title: SEAS.title, phase: '11', accepts: ['instrument', 'hypothesis'] } as const
