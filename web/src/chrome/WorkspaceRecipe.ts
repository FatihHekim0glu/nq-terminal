// Recipes for named workspaces (roadmap #14): the dockview split tree written as a sequence of command
// lines, and back. Pure; WorkspaceController decides when to read the tree and when to apply a layout.
// - recipeFromDock walks the serialised grid and gives each panel its command line (what its title bar
//   shows), its link group and one split: `ref` is an earlier panel of the recipe, `direction` the side
//   ('right' or 'below') it is split off on. The first panel has no reference.
// - Panels come in the order dockview must build them: inside a branch the first panel of every child is
//   split off along the branch's axis first (each against the first panel of the child before it), and
//   only then is each child divided along the other axis. That is how the HOME default is built, and it
//   rebuilds the same grid, so panels keep their reading numbers (1-GP 2-MON 3-EQ 4-REG for HOME).
// - layoutFromRecipe turns a recipe and its re-parsed commands into the panels to add. The recipe itself
//   is untrusted (state/workspaces.ts rebuilds it on the way out of storage); the caller parses every line
//   again, and nothing here runs a line.
// Only the Workspace controller and Workspace.tsx import this file, so it stays in the Workspace chunk;
// state/workspaces.ts owns the Recipe type and holds no runtime import of it.
import type { ParsedCommand } from '../commands/parser'
import { canonicalJson, fnv1a } from '../state/fnv1a'
import { LINK_GROUPS, type GroupRecord, type LinkContext } from '../state/linkGroups'
import type { Recipe, RecipeDirection, RecipeGroup, RecipePanel } from '../state/workspaces'
import type { LayoutPanel, PanelParams } from './WorkspaceLayouts'

export type { Recipe, RecipeDirection, RecipeGroup, RecipePanel } from '../state/workspaces'

/** The part of dockview's serialised layout a recipe reads (a SerializedDockview satisfies it). */
export interface DockLike {
  readonly grid: { readonly root: unknown; readonly orientation: unknown }
  readonly panels: Readonly<Record<string, unknown>>
}

type Orientation = 'HORIZONTAL' | 'VERTICAL'

type Tree = { readonly kind: 'leaf'; readonly panelId: string } | { readonly kind: 'branch'; readonly children: readonly Tree[] }

/** A dockview grid is a few levels deep; anything deeper is not one of ours. */
const MAX_DEPTH = 32
const GROUPS: readonly string[] = ['-', ...LINK_GROUPS]

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The grid as a tree of panel ids; null unless every group holds exactly one panel. */
function readTree(node: unknown, depth = 0): Tree | null {
  if (!isRecord(node) || depth > MAX_DEPTH) return null
  if (node.type === 'leaf') {
    const views = isRecord(node.data) ? node.data.views : null
    const [id] = Array.isArray(views) ? views : []
    return Array.isArray(views) && views.length === 1 && typeof id === 'string' ? { kind: 'leaf', panelId: id } : null
  }
  if (node.type !== 'branch' || !Array.isArray(node.data) || node.data.length === 0) return null
  const children: Tree[] = []
  for (const raw of node.data) {
    const child = readTree(raw, depth + 1)
    if (!child) return null
    children.push(child)
  }
  return { kind: 'branch', children }
}

function firstLeaf(node: Tree): string {
  return node.kind === 'leaf' ? node.panelId : firstLeaf(node.children[0] as Tree)
}

function readOrientation(value: unknown): Orientation | null {
  return value === 'HORIZONTAL' || value === 'VERTICAL' ? value : null
}

const across = (orientation: Orientation): Orientation => (orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL')

function copyGroups(groups: GroupRecord<LinkContext | null>): GroupRecord<LinkContext | null> {
  const copy = (context: LinkContext | null): LinkContext | null => (context ? { kind: context.kind, value: context.value } : null)
  return { A: copy(groups.A), B: copy(groups.B), C: copy(groups.C) }
}

/**
 * The recipe for the panels in `dock`, or null when it cannot be written down: a group that holds more or
 * fewer than one panel, a panel `paramsOf` cannot read back, a panel that stands twice or outside the grid,
 * or a grid that is not one dockview writes. `lineOf` gives the command line for a panel (the terminal
 * passes the title with the context the panel shows); `groups` are the link group contexts to keep.
 */
export function recipeFromDock(
  dock: DockLike,
  paramsOf: (panelId: string) => PanelParams | null,
  lineOf: (params: PanelParams) => string,
  groups: GroupRecord<LinkContext | null>,
): Recipe | null {
  const grid = isRecord(dock) ? dock.grid : undefined
  const tree = isRecord(grid) ? readTree(grid.root) : null
  const rootOrientation = isRecord(grid) ? readOrientation(grid.orientation) : null
  if (!tree || !rootOrientation) return null
  const panels: RecipePanel[] = []
  const seen = new Set<string>()
  const place = (panelId: string, ref: number | null, direction: RecipeDirection): number | null => {
    const params = seen.has(panelId) ? null : paramsOf(panelId)
    if (!params) return null
    seen.add(panelId)
    panels.push({ line: lineOf(params), group: params.group, ref, direction })
    return panels.length - 1
  }
  // `first` is the index of the first panel of `node`, already placed by the caller.
  const expand = (node: Tree, orientation: Orientation, first: number): boolean => {
    if (node.kind === 'leaf') return true
    const direction: RecipeDirection = orientation === 'HORIZONTAL' ? 'right' : 'below'
    const firsts = [first]
    for (const child of node.children.slice(1)) {
      const at = place(firstLeaf(child), firsts[firsts.length - 1] as number, direction)
      if (at === null) return false
      firsts.push(at)
    }
    return node.children.every((child, i) => expand(child, across(orientation), firsts[i] as number))
  }
  const root = place(firstLeaf(tree), null, 'right')
  if (root === null || !expand(tree, rootOrientation, root)) return null
  // A panel the grid does not hold (a floating or popped out group) would be lost from the recipe.
  if (Object.keys(dock.panels).length !== panels.length) return null
  return { version: 1, panels, groups: copyGroups(groups) }
}

/**
 * The panels to add for `recipe`, named ws-1 to ws-n, each with the screen, context and arguments of its
 * re-parsed command and the link group and split the recipe gives it. Null when `commands` does not match
 * the recipe panel for panel, or a reference does not point at an earlier panel.
 */
export function layoutFromRecipe(recipe: Recipe, commands: readonly ParsedCommand[]): LayoutPanel[] | null {
  if (commands.length === 0 || commands.length !== recipe.panels.length) return null
  const layout: LayoutPanel[] = []
  for (const [i, panel] of recipe.panels.entries()) {
    const command = commands[i] as ParsedCommand
    const { ref, direction, group } = panel
    const validRef = i === 0 ? ref === null : typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < i
    if (!validRef || (direction !== 'right' && direction !== 'below') || !GROUPS.includes(group)) return null
    const position = ref === null ? undefined : { ref: `ws-${ref + 1}`, direction }
    layout.push({
      id: `ws-${i + 1}`,
      code: command.mnemonic.code,
      context: command.context && { kind: command.context.kind, value: command.context.value },
      args: { ...command.args },
      group: group as RecipeGroup,
      ...(position ? { position } : {}),
    })
  }
  return layout
}

/** A short digest of a recipe, the same whatever order its keys arrive in: the edited mark compares two. */
export function recipeSignature(recipe: Recipe): string {
  return fnv1a(canonicalJson(recipe))
}
