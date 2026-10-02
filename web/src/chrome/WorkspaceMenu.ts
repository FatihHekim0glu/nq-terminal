// LOAD on its own (roadmap #14): the saved workspaces as a menu, each row running LOAD NAME. The command line asks for it
// while the user types, so it stays in the first-paint shell; the rest of the chrome's key actions (KeyToolbar.actions.ts,
// which re-exports this) load on demand through KeyToolbar.lazy.ts.
import { WORKSPACE_LINES } from '../copy/commands'
import type { Recipe } from '../state/workspaces'
import type { MenuItem, MenuModel } from './CommandLine.menus'

/** Saved workspaces by name, as the menus need them: only the panels' lines are read. */
export type SavedWorkspaces = Readonly<Record<string, Pick<Recipe, 'panels'>>>

/** A saved workspace's row: LOAD NAME, with the lines of its first panels to tell it apart. */
export function workspaceRows(saved: SavedWorkspaces, first: number): MenuItem[] {
  return Object.entries(saved).map(([name, recipe], i) => ({
    n: first + i,
    label: name,
    detail: recipe.panels.slice(0, 4).map((p) => p.line).join(', '),
    category: false,
    act: { kind: 'run', line: `LOAD ${name}` } as const,
  }))
}

/** LOAD on its own: the saved workspaces, each row running LOAD NAME. */
export function workspaceMenu(saved: SavedWorkspaces): MenuModel {
  const items = workspaceRows(saved, 1)
  return { key: 'workspaces', title: WORKSPACE_LINES.menuTitle, breadcrumb: [WORKSPACE_LINES.menuTitle], intro: items.length === 0 ? [WORKSPACE_LINES.none] : [], items }
}
