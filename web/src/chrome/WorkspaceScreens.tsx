// Built screens by mnemonic. A mnemonic missing here renders WorkspacePlaceholder, so every command
// resolves to a labelled panel. Phases 6 and 7 add their screens to this map, each through lazy(),
// so a screen's code (and its chart libraries) loads only when a panel shows it; ScreenPanel wraps
// every screen in Suspense.
import { lazy, type ComponentType } from 'react'
import type { MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import type { PanelParams } from './WorkspaceLayouts'

export interface ScreenProps {
  readonly params: PanelParams
  /** The context to show: the panel's link-group context when the screen accepts it, else its own. */
  readonly context: ResolvedContext | null
}

export type ScreenRegistry = Readonly<Partial<Record<MnemonicCode, ComponentType<ScreenProps>>>>

const HelpScreen = lazy(() => import('./HelpScreen'))

function HelpPanel() {
  return <HelpScreen built={builtScreens(BUILT_SCREENS)} />
}

export const BUILT_SCREENS: ScreenRegistry = {
  HELP: HelpPanel,
}

export function builtScreens(registry: ScreenRegistry): ReadonlySet<string> {
  return new Set(Object.keys(registry))
}
