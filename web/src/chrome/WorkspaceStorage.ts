// How the Workspace keeps a viewer's layout in the layouts store (UI_SPEC section 2).
// - A saved layout carries the signature of the default it was made from. When a default changes
//   (WorkspaceLayouts.ts), every layout saved from the old default is dropped, so viewers see it.
// - A saved layout is untrusted input: it is refused when it asks for floating, popout or edge
//   groups (the terminal uses none) or holds a panel of any component other than PANEL_COMPONENT.
import type { SerializedDockview } from 'dockview-react'
import type { MnemonicCode } from '../commands/registry'
import { fnv1a } from '../state/fnv1a'
import { layoutFor } from './WorkspaceLayouts'
import { PANEL_COMPONENT } from './WorkspaceModel'

// The hash lives in state/fnv1a.ts, shared with the record watch; it is re-exported here for the callers
// that already import it from this module.
export { fnv1a }

const EXTRA_GROUP_KEYS = ['floatingGroups', 'popoutGroups', 'edgeGroups'] as const

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The signature of a screen's default layout; it changes whenever the default does. */
export function layoutSignature(code: MnemonicCode): string {
  return fnv1a(JSON.stringify(layoutFor(code)))
}

/** What the layouts store keeps for a screen: the dockview JSON and the default it came from. */
export function toStored(code: MnemonicCode, dock: SerializedDockview): Record<string, unknown> {
  return { base: layoutSignature(code), dock: dock as unknown as Record<string, unknown> }
}

function hasExtraGroups(dock: Readonly<Record<string, unknown>>): boolean {
  return EXTRA_GROUP_KEYS.some((key) => {
    const value = dock[key]
    return value !== undefined && !(Array.isArray(value) && value.length === 0)
  })
}

function panelsAreScreens(panels: unknown): boolean {
  if (!isRecord(panels)) return false
  const list = Object.values(panels)
  return list.length > 0 && list.every((p) => isRecord(p) && p.contentComponent === PANEL_COMPONENT)
}

/**
 * The dockview JSON inside a stored entry, or null when it asks for groups the terminal does not use,
 * or holds a panel that is not a screen panel. Does not check the entry's base signature: a caller
 * that means to restore it under the screen it names (undo, a stale-base drop) wants exactly this, not
 * the signature check fromStored also makes.
 */
export function readDock(stored: Readonly<Record<string, unknown>>): SerializedDockview | null {
  const dock = stored.dock
  if (!isRecord(dock) || !isRecord(dock.grid) || hasExtraGroups(dock) || !panelsAreScreens(dock.panels)) return null
  return dock as unknown as SerializedDockview
}

/**
 * The dockview JSON to restore for `code`, or null when the stored entry was saved from another
 * default, asks for groups the terminal does not use, or holds a panel that is not a screen panel.
 */
export function fromStored(code: MnemonicCode, stored: Readonly<Record<string, unknown>>): SerializedDockview | null {
  if (stored.base !== layoutSignature(code)) return null
  return readDock(stored)
}
