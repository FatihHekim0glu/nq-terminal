// Default layout per screen (UI_SPEC sections 2 and 7): the types. WorkspaceModel turns a layout
// into dockview calls.
import type { MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import type { CommandArgs } from '../commands/parser'
import type { PanelLink } from '../state/linkGroups'

/** A panel's link group: A, B, C, or '-' for unlinked (the link-group store's PanelLink). */
export type LinkGroup = PanelLink

/** What a panel shows. JSON only, because dockview keeps it in the serialised layout. */
export interface PanelParams {
  readonly code: MnemonicCode
  readonly context: ResolvedContext | null
  readonly args: CommandArgs
  readonly group: LinkGroup
}

export type SplitDirection = 'right' | 'below'

export interface LayoutPanel extends PanelParams {
  readonly id: string
  /** Where the panel goes relative to an earlier panel of the same layout; the first has none. */
  readonly position?: { readonly ref: string; readonly direction: SplitDirection }
}

export interface ScreenLayout {
  readonly screen: MnemonicCode
  readonly panels: readonly LayoutPanel[]
}

// The layout table itself (HOME 2x2, REG beside MT, LIVE above JRNL, one panel for the rest) lives in
// src/screens/layouts (TASKS 7.4). That module imports only types from here, so there is no runtime cycle.
export { DEFAULT_LAYOUTS, SCREEN_PHASES, layoutFor } from '../screens/layouts'
