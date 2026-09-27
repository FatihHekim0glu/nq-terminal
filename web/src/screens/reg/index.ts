// Public entry of the REG and MT screens (TASKS 6.1). The workspace registers each screen lazily in
// src/chrome/WorkspaceScreens.tsx (BUILT_SCREENS), so this folder's code and ECharts load only when a
// panel shows it:
//   REG: lazy(() => import('../screens/reg/RegScreen')),
//   MT: lazy(() => import('../screens/reg/MtScreen')),
// The mnemonics, their default layout (REG beside MT) and their build phase already exist in
// src/commands/registry.ts and src/chrome/WorkspaceLayouts.ts; nothing there changes.
import type { MnemonicCode } from '../../commands/registry'

export { default as RegScreen } from './RegScreen'
export { default as MtScreen } from './MtScreen'

export interface ScreenMeta {
  readonly code: MnemonicCode
  /** Bracket tags for the panel title bar (look spec 4.3), once the workspace passes screen tags. */
  readonly tags: readonly string[]
  /** Dynamic import for React.lazy in BUILT_SCREENS. */
  readonly load: () => Promise<{ default: unknown }>
}

export const REG_SCREENS: readonly ScreenMeta[] = [
  { code: 'REG', tags: ['PRE-REG'], load: () => import('./RegScreen') },
  { code: 'MT', tags: ['PRE-REG'], load: () => import('./MtScreen') },
]
