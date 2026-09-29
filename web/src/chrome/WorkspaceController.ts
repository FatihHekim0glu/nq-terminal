// The Workspace's imperative side (UI_SPEC sections 2 and 5, look spec 4.3, 4.7 and 5.2):
// what a command, a layout load, a focus change, back and forward, and the related functions menu do
// to dockview and to the stores. Workspace.tsx is the thin React shell around it.
// - run(): Enter replaces the panel the user last focused (a multi-panel screen, or no focused
//   panel, loads the screen's layout); Shift+Enter opens a new panel (WorkspaceModel.planOpen).
// - A layout is saved only after a command changes it (replace, new panel, back, forward), never on
//   load, so an untouched default is never stored and a changed default reaches every viewer.
// - A screen's mnemonic always restores its saved layout, on the screen it is typed from and on the
//   screen already shown alike: typing a bare mnemonic never loses a customised layout. RESET
//   (resetLayout()) is the only way back to a screen's default; a 10-deep undo ring (WorkspaceUndo)
//   can bring back what RESET, or a stale saved layout dropped for an old default, took away.
// - Each panel keeps its own history: a replace records what the panel showed; goBack and
//   goForward walk it (WorkspaceHistory), retargeting the panel's link group to what comes back.
// - The focused panel and its context are read when asked (focusedContext), never cached, so a
//   command that replaced the panel or retargeted its link group is seen by the next command.
// - The command line always addresses one panel (look spec 4.2, 4.3): the panel the user last focused,
//   else the panel the last command ran in, else panel 1. That panel carries the focus line and is
//   what the nav toolbar and the command zone name, what Number <GO> and MENU act on and whose
//   context a contextless command takes. Whether Enter replaces a panel or loads a layout still
//   follows real focus (UI_SPEC section 5).
// - Focus moving into another panel closes the related functions menu; focus on the chrome does not.
// - The layout on screen belongs to a screen or to a named workspace (roadmap #14). A screen keeps its
//   layout in nqt.layouts as above. A workspace (SAVE NAME, LOAD NAME) is a recipe of command lines
//   (WorkspaceRecipe): while it owns the layout nothing is written to nqt.layouts, and the edited mark
//   means the panels no longer give the recipe they were saved or loaded as. Loading a screen's layout
//   gives the layout back to the screen. UNDO restores the owner along with the panels. RESET on a
//   workspace discards the edits and puts the workspace's own panels back (the dock and link group
//   contexts kept when it was saved or loaded); it never reads or writes nqt.layouts.
import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from 'dockview-react'
import { flushSync } from 'react-dom'
import type { LineResult } from '../commands/line'
import { describeError } from '../commands/messages'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { WORKSPACES } from '../copy/workspaces'
import { WORKSPACE, fillCopy } from '../copy/workspace'
import { layoutFor as savedLayoutFor, type LayoutsStore } from '../state/layouts'
import { LINK_GROUPS, type GroupRecord, type LinkContext, type LinkGroupsStore } from '../state/linkGroups'
import { MAX_WORKSPACES, isWorkspaceName, type WorkspacesStore } from '../state/workspaces'
import { syncRoving } from './WorkspaceFocus'
import { EMPTY_HISTORY, recordVisit, stepBack, stepForward, type HistoryStep, type PanelHistory } from './WorkspaceHistory'
import { layoutFor } from './WorkspaceLayouts'
import { applyPlan, effectiveContext, panelTitle, planOpen, sanitiseParams, type DockApiLike, type OpenPlan, type PanelParams } from './WorkspaceModel'
import { describePlan, type PreviewInput, type RunPreview } from './WorkspacePreview'
import { layoutFromRecipe, recipeFromDock, recipeSignature, type Recipe } from './WorkspaceRecipe'
import { fromStored, layoutSignature, readDock, toStored } from './WorkspaceStorage'
import { EMPTY_RING, popUndo, pushUndo, type UndoCause, type UndoEntry, type UndoRing } from './WorkspaceUndo'
import { createWorkspaceView, patchView, readingOrder, type WorkspaceView } from './WorkspaceView'

export type RunTarget = 'replace' | 'new-panel'
type LoadMode = 'restore' | 'reset' | 'plain'
type LoadPlan = Extract<OpenPlan, { kind: 'load' }>

export interface FocusedPanel {
  readonly panelId: string
  /** The panel's number in reading order (1-based), as its title bar shows it. */
  readonly number: number
  readonly params: PanelParams
  readonly context: ResolvedContext | null
}

/** The screen whose layout the panels are arranged under, for the chrome to show an edited mark and
 * offer RESET and UNDO. `workspace` names the workspace that owns the layout (then `code` is the screen
 * its first panel shows, and `edited` means the panels no longer give its recipe), else null. */
export interface ShownLayout {
  readonly code: MnemonicCode
  readonly edited: boolean
  readonly workspace: string | null
}

/** Who the layout on screen belongs to: a screen (saved per screen in nqt.layouts) or a named workspace,
 * with the signature of the recipe it was saved or loaded as, to tell whether it has been edited since,
 * and the panels (`dock`) and link group contexts as they were then, which RESET puts back. */
type Owner =
  | { readonly kind: 'screen' }
  | {
      readonly kind: 'workspace'
      readonly name: string
      readonly base: string
      readonly dock: SerializedDockview
      readonly contexts: GroupRecord<LinkContext | null>
    }

const SCREEN_OWNER: Owner = { kind: 'screen' }

export interface ControllerEnv {
  readonly initialScreen: MnemonicCode
  readonly layouts: LayoutsStore
  readonly linkGroups: LinkGroupsStore
  readonly workspaces: WorkspacesStore
  readonly root: () => HTMLElement | null
  readonly onFocusedPanelChange?: (panel: FocusedPanel | null) => void
  /** The shown screen and whether it is edited, after every change that could affect either. */
  readonly onLayoutChange?: (shown: ShownLayout) => void
  /** A saved layout was refused because it was made from an old default, and the default now shows;
   * UNDO can still bring it back. Never fires for a tampered layout (today's silent fallback). */
  readonly onLayoutDropped?: (code: MnemonicCode) => void
}

export interface WorkspaceController {
  /** Panel numbers, the focused panel, the menu owner and the maximised panel, for rendering. */
  readonly view: WorkspaceView
  onReady(api: DockviewApi): void
  /** False when there was no dockview api yet (a command typed before the Workspace finished loading). */
  run(command: ParsedCommand, target: RunTarget): boolean
  /** What run(command, target) would do, with no side effects. Null with no dockview api yet. */
  preview(command: ParsedCommand, target: RunTarget): RunPreview | null
  /** Recompute the addressed panel and report it again, for a change (e.g. a link-group retarget) that
   * did not itself go through run(). */
  refreshFocused(): void
  /** Focus the panel the user last focused, else the first panel. False when there is none. */
  focusPanel(): boolean
  /** Focus panel N in reading order (Alt+N). False when there is no such panel. */
  focusPanelNumber(n: number): boolean
  /** Focus the panel showing mnemonic `code`, when one exists (U20: a second or held F1 with a HELP
   * panel already open focuses it instead of adding another). False when none shows it. */
  focusPanelShowing(code: MnemonicCode): boolean
  /** The context of the panel the user last focused, as it is now (null when none). */
  focusedContext(): ResolvedContext | null
  /** A focus event inside the workspace. */
  onFocusIn(target: EventTarget | null): void
  /** Show what the panel showed before its last change. False when there is nothing behind it. */
  goBack(panelId: string): boolean
  /** Undo a goBack. False when there is nothing ahead. */
  goForward(panelId: string): boolean
  /** What panel `id` shows right now (its effective context, not its raw stored one): the code and
   * context to report after goBack/goForward moved it (U10). Null when the panel does not exist. */
  shownIn(id: string): { readonly code: MnemonicCode; readonly context: ResolvedContext | null } | null
  /** Open the related functions menu in a panel (default: the focused one). */
  openRelatedMenu(panelId?: string): boolean
  closeRelatedMenu(): void
  /** Open a function in a panel, keeping its link group and, when the function takes it, its context. */
  openInPanel(panelId: string, code: MnemonicCode): boolean
  toggleMaximise(panelId: string): void
  /** Reset the layout on screen. A screen goes back to its default layout; a workspace goes back to the
   * panels it was saved or loaded with, stays the owner, and leaves every saved screen layout alone. 'reset'
   * when something changed (UNDO can bring it back), 'default' when nothing needed to, null with no dockview
   * api yet. */
  resetLayout(): 'reset' | 'default' | null
  /** Undo the last of up to 10 layout changes (a replace, add, back, forward, related-menu open, RESET,
   * a workspace load or a dropped saved layout). The screen it restored, or null when there is nothing to
   * undo. The layout's owner (screen or workspace) comes back with the panels. */
  undo(): MnemonicCode | null
  /** The recipe of the panels on screen; the workspace `name` then owns the layout, unedited. Null (and
   * nothing changes) for a name that is not a workspace name, with no dockview api yet, or when a panel
   * cannot be written as a command line. */
  saveRecipe(name: string): Recipe | null
  /** Rebuild the panels from `recipe`, whose lines were parsed into `commands` (panel for panel); the
   * workspace `name` then owns the layout, unedited. Snapshots undo first. False, with nothing changed,
   * when there is no dockview api, the name is not a workspace name or the commands do not fit the recipe. */
  loadRecipe(name: string, recipe: Recipe, commands: readonly ParsedCommand[]): boolean
  /** SAVE: keep the panels on screen under `name`. The message to show: saved, or why not. */
  saveWorkspace(name: string): string
  /** LOAD: parse every line of the saved workspace `name` with `parse` and, when all are screen commands,
   * rebuild the panels from them. The message to show: loaded, or why not (nothing changes then). */
  loadWorkspace(name: string, parse: (line: string) => LineResult): string
  /** FORGET: drop the saved workspace `name`. When it owns the layout on screen the layout goes back to the shown
   * screen (the panels stay, and the next edit is saved for the screen as usual). The message to show: forgotten,
   * or that no workspace has that name (nothing changes then). */
  forgetWorkspace(name: string): string
}

function adapt(api: DockviewApi): DockApiLike {
  return {
    get panels() {
      return api.panels
    },
    clear: () => api.clear(),
    addPanel: (o) => {
      api.addPanel({ id: o.id, component: o.component, title: o.title, params: { ...o.params }, ...(o.position ? { position: o.position } : {}) })
    },
    replacePanel: (id, params, title) => {
      const panel = api.getPanel(id)
      panel?.api.updateParameters({ ...params })
      panel?.api.setTitle(title)
    },
  }
}

/** Hide a group's tab strip (PanelChrome is the header) and drop the tabpanel role it leaves orphaned. */
export function prepareGroup(group: DockviewGroupPanel): void {
  group.header.hidden = true
  for (const el of group.element.querySelectorAll('.dv-content-container')) {
    el.removeAttribute('role')
    el.removeAttribute('aria-labelledby')
  }
}

/** Applies a dockview JSON already checked structurally sound (readDock or fromStored); false (and no
 * change attempted beyond what dockview itself did) when it throws or a panel fails sanitiseParams. */
function applyDock(api: DockviewApi, dock: SerializedDockview): boolean {
  try {
    api.fromJSON(dock)
  } catch {
    return false
  }
  return api.panels.length > 0 && api.panels.every((p) => sanitiseParams(p.params) !== null)
}

function tryStoredLayout(api: DockviewApi, code: MnemonicCode, stored: Readonly<Record<string, unknown>>): boolean {
  const dock = fromStored(code, stored)
  return dock !== null && applyDock(api, dock)
}

function panelElement(root: HTMLElement | null, id: string): HTMLElement | null {
  const all = root?.querySelectorAll<HTMLElement>('[data-nqt-panel]') ?? []
  return Array.from(all).find((el) => el.getAttribute('data-nqt-panel') === id) ?? null
}

function panelIdOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('[data-nqt-panel]')?.getAttribute('data-nqt-panel') ?? null) : null
}

/** Give each empty link group the context of the first panel in it, so the strip names what shows. */
function seedLinkGroups(api: DockviewApi, linkGroups: LinkGroupsStore): void {
  const store = linkGroups.getState()
  for (const panel of api.panels) {
    const params = sanitiseParams(panel.params)
    if (!params || params.group === '-' || !params.context) continue
    if (linkGroups.getState().contexts[params.group] === null) store.setContext(params.group, params.context)
  }
}

/** A bare command (no typed context, no argument) always restores the screen's saved layout, even on
 * the screen already shown; RESET (resetLayout()) is the only way to reset a screen to its default. */
function loadMode(command: ParsedCommand): LoadMode {
  const bare = command.context === null && Object.keys(command.args).length === 0
  return bare ? 'restore' : 'plain'
}

/** What the controller remembers between calls; only the controller's own functions change it. */
interface ControllerState {
  api: DockviewApi | null
  lastFocused: string | null
  /** The panel the last command ran in (replaced or added); null after a layout load. */
  ranIn: string | null
  /** The screen whose layout the panels are currently arranged under (what a save keys on). */
  shown: MnemonicCode
  /** Who the layout on screen belongs to; a screen load, RESET or an UNDO to a screen entry sets it back. */
  owner: Owner
  /** The owner each undo entry has to give back (an entry not listed here belongs to a screen). */
  readonly owners: WeakMap<UndoEntry, Owner>
  /** True while the controller itself moves link group contexts (a load, an undo), which are not edits. */
  applying: boolean
  histories: ReadonlyMap<string, PanelHistory>
  undo: UndoRing
  readonly view: WorkspaceView
}

/** G13: while a panel is maximised it is the only one actually on screen, so a stale reference to a
 * different, now-hidden panel (real DOM focus that landed there before the maximise, or a plain
 * fallback such as order[0]) must yield to it instead of silently addressing what the user cannot
 * see. No maximised panel: `id` unchanged. */
function visibleId(st: ControllerState, id: string | null): string | null {
  const { maximised } = st.view.getState()
  if (!maximised) return id
  return id === maximised ? id : maximised
}

function focusedId(st: ControllerState): string | null {
  const real = st.lastFocused && st.api?.getPanel(st.lastFocused) ? st.lastFocused : null
  return visibleId(st, real)
}

function paramsOf(st: ControllerState, id: string): PanelParams | null {
  return sanitiseParams(st.api?.getPanel(id)?.params)
}

/** The panel the command line addresses: last focused, else where the last command ran, else panel 1;
 * never one hidden behind a maximised panel (G13). */
function targetId(st: ControllerState, order: readonly string[] = st.view.getState().order): string | null {
  const alive = (id: string | null) => (id && st.api?.getPanel(id) ? id : null)
  return visibleId(st, alive(st.lastFocused) ?? alive(st.ranIn) ?? order[0] ?? null)
}

function focusedPanel(st: ControllerState, env: ControllerEnv): FocusedPanel | null {
  const id = targetId(st)
  const params = id ? paramsOf(st, id) : null
  if (!id || !params) return null
  const groupContext = params.group === '-' ? null : env.linkGroups.getState().contexts[params.group]
  const number = st.view.getState().order.indexOf(id) + 1
  return { panelId: id, number, params, context: effectiveContext(params, groupContext) }
}

/** Panel numbers follow the grid's reading order; ids that left drop their history and menu. */
function refreshView(st: ControllerState): void {
  const dock = st.api
  if (!dock) return
  const order = readingOrder(dock.groups.map((g) => ({ element: g.element, panelIds: g.panels.map((p) => p.id) })))
  const alive = new Set(order)
  st.histories = new Map([...st.histories].filter(([id]) => alive.has(id)))
  const { menu } = st.view.getState()
  const maximised = dock.panels.find((p) => p.api.isMaximized())?.id ?? null
  patchView(st.view, {
    order,
    menu: menu && alive.has(menu) ? menu : null,
    focused: targetId(st, order),
    maximised,
  })
}

function prepareAll(st: ControllerState, dock: DockviewApi): void {
  for (const group of dock.groups) prepareGroup(group)
  refreshView(st)
}

/** Remember the panels as the shown screen's layout. Suspended while a workspace owns the layout: the
 * screen's own layout is not touched by edits made in a workspace, which stay edits until SAVE. */
function saveShown(st: ControllerState, env: ControllerEnv, dock: DockviewApi): void {
  if (st.owner.kind === 'workspace') return
  env.layouts.getState().saveLayout(st.shown, toStored(st.shown, dock.toJSON()))
}

/** Remembers the panels' current state (before whatever the caller is about to do) as an undo entry. */
function snapshot(st: ControllerState, env: ControllerEnv, cause: UndoCause): void {
  const api = st.api
  if (!api) return
  const entry: UndoEntry = {
    screen: st.shown,
    dock: api.toJSON() as unknown as Readonly<Record<string, unknown>>,
    stored: savedLayoutFor(env.layouts.getState(), st.shown),
    contexts: env.linkGroups.getState().contexts,
    cause,
  }
  st.undo = pushUndo(st.undo, entry)
  // pushUndo skips an entry that repeats the newest one; only a new entry needs its owner remembered.
  if (st.undo.at(-1) === entry) st.owners.set(entry, st.owner)
}

/** The recipe for the panels on screen: each line is the panel's title with the context it shows now. */
function deriveRecipe(st: ControllerState, env: ControllerEnv): Recipe | null {
  const api = st.api
  if (!api) return null
  const contexts = env.linkGroups.getState().contexts
  const lineOf = (params: PanelParams): string => {
    const groupContext = params.group === '-' ? null : contexts[params.group]
    return panelTitle({ ...params, context: effectiveContext(params, groupContext) })
  }
  return recipeFromDock(api.toJSON(), (id) => paramsOf(st, id), lineOf, contexts)
}

/** Tells the chrome what screen is shown and whether it is edited: for a screen, that a saved layout
 * exists for it; for a workspace, that the panels no longer give the recipe it was saved or loaded as. */
function reportShown(st: ControllerState, env: ControllerEnv): void {
  const { owner } = st
  if (owner.kind === 'workspace') {
    const now = deriveRecipe(st, env)
    const edited = now === null || recipeSignature(now) !== owner.base
    env.onLayoutChange?.({ code: st.shown, edited, workspace: owner.name })
    return
  }
  const edited = savedLayoutFor(env.layouts.getState(), st.shown) !== null
  env.onLayoutChange?.({ code: st.shown, edited, workspace: null })
}

function loadScreen(st: ControllerState, env: ControllerEnv, dock: DockviewApi, plan: LoadPlan, mode: LoadMode): void {
  const { layouts, linkGroups } = env
  const code = plan.layout.screen
  if (mode === 'reset') layouts.getState().resetLayout(code)
  const stored = mode === 'restore' ? savedLayoutFor(layouts.getState(), code) : null
  const restored = stored !== null && tryStoredLayout(dock, code, stored)
  // Structurally sound but saved from an old default: dropped, not silently discarded (D-defect: the
  // viewer's layout used to vanish with no way back). Structurally unsound (tampered, or truly not a
  // dockview layout at all) keeps today's silent fallback: no undo entry, no announcement.
  const droppedDock = stored && !restored ? readDock(stored) : null
  const restorable = droppedDock !== null && Object.values(droppedDock.panels).every((p) => sanitiseParams(p.params) !== null)
  const dropped = stored !== null && restorable && stored.base !== layoutSignature(code)
  const contexts = linkGroups.getState().contexts
  if (stored && !restored) layouts.getState().resetLayout(code)
  if (!restored) applyPlan(adapt(dock), plan)
  st.histories = new Map()
  prepareAll(st, dock)
  seedLinkGroups(dock, linkGroups)
  st.shown = code
  st.owner = SCREEN_OWNER
  if (dropped && stored && droppedDock) {
    st.undo = pushUndo(st.undo, { screen: code, dock: droppedDock as unknown as Readonly<Record<string, unknown>>, stored, contexts, cause: 'dropped' })
    env.onLayoutDropped?.(code)
  }
}

/** Marks the command target with the focus line and tells the chrome which panel it is. */
function announce(st: ControllerState, env: ControllerEnv): void {
  patchView(st.view, { focused: targetId(st) })
  env.onFocusedPanelChange?.(focusedPanel(st, env))
}

/** The panel a plan put its command in: the replaced panel, the added one, or none after a load. */
function ranInAfter(plan: OpenPlan, before: ReadonlySet<string>, dock: DockviewApi): string | null {
  if (plan.kind === 'replace') return plan.panelId
  if (plan.kind === 'add') return dock.panels.find((p) => !before.has(p.id))?.id ?? null
  return null
}

/** What panel `id` actually displays right now: its link group's context, when the screen takes it,
 * not its raw stored params, which may hold a context the panel stopped showing the moment another
 * panel retargeted the group. Null when the panel does not exist. */
function shownParams(st: ControllerState, env: ControllerEnv, id: string): PanelParams | null {
  const params = paramsOf(st, id)
  if (!params) return null
  return { ...params, context: effectiveContext(params, params.group === '-' ? null : env.linkGroups.getState().contexts[params.group]) }
}

/** Remember what panel `id` shows before it changes to `next`: what it actually displayed, not its raw
 * stored params (see shownParams). */
function remember(st: ControllerState, env: ControllerEnv, id: string, next: PanelParams): void {
  const shown = shownParams(st, env, id)
  if (!shown) return
  const was = JSON.stringify(shown)
  if (was === JSON.stringify(next)) return
  const history = st.histories.get(id) ?? EMPTY_HISTORY
  st.histories = new Map([...st.histories, [id, recordVisit(history, was)]])
}

function applyToPanel(st: ControllerState, env: ControllerEnv, plan: Exclude<OpenPlan, LoadPlan>, command: ParsedCommand): void {
  const dock = st.api as DockviewApi
  if (plan.kind === 'replace') remember(st, env, plan.panelId, plan.params)
  applyPlan(adapt(dock), plan)
  prepareAll(st, dock)
  saveShown(st, env, dock)
  const group = plan.params.group
  if (command.contextSource === 'typed' && command.context && group !== '-') {
    env.linkGroups.getState().setContext(group, command.context)
  }
}

/** A dockview panels dict, keyed for a stable JSON.stringify: fromJSON rebuilds it in grid-traversal
 * order, which differs from the insertion order an incremental replace leaves behind, even when the
 * two states are otherwise identical. */
function sortedPanels(panels: unknown): unknown {
  if (typeof panels !== 'object' || panels === null) return panels
  return Object.fromEntries(Object.entries(panels as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The dockview JSON a snapshot is compared on: grid and panels only, ignoring which group has focus
 * (activeGroup), so a command that only shifted focus is still seen as a no-op layout change. */
function layoutKey(dock: Readonly<Record<string, unknown>>): string {
  const { grid, panels } = dock as { grid?: unknown; panels?: unknown }
  return JSON.stringify({ grid, panels: sortedPanels(panels) })
}

/** The owner an undo entry gives back; a workspace that has been forgotten since is the screen's layout again. */
function ownerOf(st: ControllerState, env: ControllerEnv, e: UndoEntry): Owner {
  const owner = st.owners.get(e) ?? SCREEN_OWNER
  return owner.kind === 'workspace' && !Object.hasOwn(env.workspaces.getState().list, owner.name) ? SCREEN_OWNER : owner
}

function sameOwner(a: Owner, b: Owner): boolean {
  return a.kind === 'screen' ? b.kind === 'screen' : b.kind === 'workspace' && a.name === b.name && a.base === b.base
}

/** True when undo entry `e` (the state snapshotted before a command ran) already equals the state the
 * workspace is in right now: same screen, dock layout, link-group contexts and saved layout. A command
 * whose net effect was a no-op (e.g. a bare restore of the layout already shown) leaves nothing worth
 * undoing, and a first UNDO that visibly did nothing would look like a bug. */
function unchanged(st: ControllerState, env: ControllerEnv, e: UndoEntry): boolean {
  const api = st.api
  if (!api) return false
  return (
    e.screen === st.shown &&
    sameOwner(ownerOf(st, env, e), st.owner) &&
    layoutKey(e.dock) === layoutKey(api.toJSON() as unknown as Readonly<Record<string, unknown>>) &&
    JSON.stringify(e.contexts) === JSON.stringify(env.linkGroups.getState().contexts) &&
    JSON.stringify(e.stored) === JSON.stringify(savedLayoutFor(env.layouts.getState(), st.shown))
  )
}

function run(st: ControllerState, env: ControllerEnv, command: ParsedCommand, target: RunTarget): boolean {
  const api = st.api
  if (!api) return false
  const ringBefore = st.undo
  snapshot(st, env, 'change')
  const pushed = st.undo === ringBefore ? null : (st.undo.at(-1) ?? null)
  // Replace or load follows real focus (UI_SPEC section 5), not the display target; a new panel still
  // anchors to the panel the command line addresses (the focus line) when nothing has real DOM focus,
  // so it opens beside that panel instead of hidden as a tab of whatever group dockview left active.
  const real = focusedId(st)
  const anchor = target === 'new-panel' ? (real ?? targetId(st)) : real
  const focused = { activePanelId: anchor ?? undefined, activeGroup: anchor ? paramsOf(st, anchor)?.group : undefined }
  const plan = planOpen({ ...focused, panelCount: api.panels.length }, command, target === 'new-panel')
  // G12: only genuine DOM focus still inside the panel being replaced (a grid-row Enter drill, not a
  // command typed on the command line, which lives outside the workspace) should trigger a refocus;
  // `real` is the sticky lastFocused and stays set after focus moves elsewhere, so it must not gate this.
  const focusedBefore = document.activeElement
  const hadFocus = plan.kind === 'replace' && (panelElement(env.root(), plan.panelId)?.contains(focusedBefore) ?? false)
  const before = new Set(api.panels.map((p) => p.id))
  if (plan.kind === 'load') loadScreen(st, env, api, plan, loadMode(command))
  else applyToPanel(st, env, plan, command)
  st.ranIn = ranInAfter(plan, before, api)
  if (!focusedId(st)) st.lastFocused = null
  announce(st, env)
  reportShown(st, env)
  // Restoring ringBefore wholesale, instead of slicing off just the newest entry, also keeps the
  // oldest entry the ring dropped when it was already full at UNDO_DEPTH.
  if (pushed && st.undo.at(-1) === pushed && unchanged(st, env, pushed)) st.undo = ringBefore
  // G12: a replace in the panel that held real keyboard focus (a grid-row Enter drill, e.g. REG or
  // RUNS) unmounts whatever inside it had focus with the old screen, dropping focus to <body>. Land
  // back on the new screen's Tab stop once it has rendered and the panel's own roving MutationObserver
  // has synced (both happen after this call returns). A command typed on the command line does not
  // count: focus was never inside the replaced panel, so it must stay wherever the user left it.
  if (hadFocus) refocusAfterReplace(env, plan.panelId, focusedBefore)
  return true
}

/** G12: how long run() keeps trying to land focus back in the panel it replaced. */
const REFOCUS_DEADLINE_MS = 2000

/**
 * G12: once the replace has committed, land focus on the replaced panel's Tab stop, checked once per
 * frame. The first frame can run before React commits the replace (a screen whose lazy chunk loads on
 * first use, in the real browser), while the old item still has focus: keep waiting for it to unmount
 * instead of deciding then. Refocus only while focus is lost (<body>), and stop the moment it is
 * anywhere else, so it never steals focus back from wherever the user or the new screen put it.
 */
function refocusAfterReplace(env: ControllerEnv, panelId: string, focusedBefore: Element | null): void {
  const deadline = performance.now() + REFOCUS_DEADLINE_MS
  const tick = () => {
    const a = document.activeElement
    const lost = a === null || a === document.body
    if (lost && focusById(env, panelId)) return
    const pending = a !== null && a === focusedBefore && focusedBefore.isConnected
    if ((lost || pending) && performance.now() < deadline) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function preview(st: ControllerState, env: ControllerEnv, command: ParsedCommand, target: RunTarget): RunPreview | null {
  const api = st.api
  if (!api) return null
  const real = focusedId(st)
  const anchor = target === 'new-panel' ? (real ?? targetId(st)) : real
  const focused = { activePanelId: anchor ?? undefined, activeGroup: anchor ? paramsOf(st, anchor)?.group : undefined }
  const plan = planOpen({ ...focused, panelCount: api.panels.length }, command, target === 'new-panel')
  const input: PreviewInput = {
    plan,
    command,
    order: st.view.getState().order,
    paramsOf: (id) => paramsOf(st, id),
    shown: st.shown,
    hasSaved: (code) => savedLayoutFor(env.layouts.getState(), code) !== null,
  }
  return describePlan(input)
}

/** Replace panel `id` with `params` without recording history (back, forward). */
function showInPanel(st: ControllerState, env: ControllerEnv, id: string, params: PanelParams): void {
  const dock = st.api as DockviewApi
  adapt(dock).replacePanel(id, params, panelTitle(params))
  prepareAll(st, dock)
  saveShown(st, env, dock)
  if (params.group !== '-' && params.context) env.linkGroups.getState().setContext(params.group, params.context)
  reportShown(st, env)
  if (targetId(st) === id) announce(st, env)
}

function walk(st: ControllerState, env: ControllerEnv, id: string, step: (h: PanelHistory, current: string) => HistoryStep | null): boolean {
  const current = shownParams(st, env, id)
  if (!current) return false
  const result = step(st.histories.get(id) ?? EMPTY_HISTORY, JSON.stringify(current))
  if (!result) return false
  let target: PanelParams | null = null
  try {
    target = sanitiseParams(JSON.parse(result.target))
  } catch {
    target = null
  }
  st.histories = new Map([...st.histories, [id, result.history]])
  if (!target) return false
  snapshot(st, env, 'change')
  showInPanel(st, env, id, target)
  return true
}

function openInPanel(st: ControllerState, env: ControllerEnv, id: string, code: MnemonicCode): boolean {
  const current = paramsOf(st, id)
  const def = findMnemonic(code)
  const dock = st.api
  if (!current || !def || !dock) return false
  snapshot(st, env, 'change')
  const groupContext = current.group === '-' ? null : env.linkGroups.getState().contexts[current.group]
  const shown = effectiveContext(current, groupContext)
  const context = shown && def.accepts.includes(shown.kind) ? shown : null
  const next: PanelParams = { code: def.code, context, args: {}, group: current.group }
  remember(st, env, id, next)
  adapt(dock).replacePanel(id, next, panelTitle(next))
  // G05: as in Workspace.tsx's onClose, flush the overlay's unmount before focusById runs syncRoving,
  // so it never focuses the (about to vanish) overlay's own item instead of the new screen.
  flushSync(() => patchView(st.view, { menu: null }))
  prepareAll(st, dock)
  saveShown(st, env, dock)
  reportShown(st, env)
  if (targetId(st) === id) announce(st, env)
  focusById(env, id)
  return true
}

function focusElement(el: HTMLElement | null): boolean {
  const stop = el ? syncRoving(el) : undefined
  stop?.focus()
  return stop !== undefined && document.activeElement === stop
}

function focusById(env: ControllerEnv, id: string): boolean {
  return focusElement(panelElement(env.root(), id))
}

/** Focus the panel the command line addresses (last focused, last run in, else panel 1). */
function focusPanel(st: ControllerState, env: ControllerEnv): boolean {
  const id = targetId(st)
  const root = env.root()
  return focusElement(id ? panelElement(root, id) : (root?.querySelector<HTMLElement>('[data-nqt-panel]') ?? null))
}

function onReady(st: ControllerState, env: ControllerEnv, dock: DockviewApi): void {
  st.api = dock
  dock.onDidAddGroup((group) => prepareGroup(group))
  dock.onDidLayoutChange(() => refreshView(st))
  loadScreen(st, env, dock, { kind: 'load', layout: layoutFor(env.initialScreen) }, 'restore')
  announce(st, env)
  reportShown(st, env)
}

function onFocusIn(st: ControllerState, env: ControllerEnv, target: EventTarget | null): void {
  const id = panelIdOf(target)
  if (!id) return
  // The related functions menu belongs to its panel: focus moving into another panel closes it.
  const { menu } = st.view.getState()
  patchView(st.view, { focused: id, ...(menu && menu !== id ? { menu: null } : {}) })
  if (id === st.lastFocused) return
  st.lastFocused = id
  env.onFocusedPanelChange?.(focusedPanel(st, env))
}

function openRelatedMenu(st: ControllerState, id: string | undefined): boolean {
  const target = id ?? targetId(st)
  if (!target || !st.api?.getPanel(target)) return false
  patchView(st.view, { menu: target })
  return true
}

function toggleMaximise(st: ControllerState, id: string): void {
  const panel = st.api?.getPanel(id)
  if (!panel) return
  if (panel.api.isMaximized()) panel.api.exitMaximized()
  else panel.api.maximize()
  refreshView(st)
}

/** RESET on a workspace: the edits go, and the panels and link group contexts the workspace was saved or
 * loaded with come back (the pattern UNDO uses). The workspace stays the owner and nqt.layouts is never
 * read or written on this path. 'default' with nothing to undo when the panels already give the recipe.
 * Should the kept panels not apply, the shown screen's layout is loaded instead: the layout then belongs
 * to that screen, and its saved layout stays as it was. */
function resetWorkspace(st: ControllerState, env: ControllerEnv, api: DockviewApi, owner: Extract<Owner, { kind: 'workspace' }>): 'reset' | 'default' {
  const now = deriveRecipe(st, env)
  if (now !== null && recipeSignature(now) === owner.base) return 'default'
  snapshot(st, env, 'reset')
  const validated = readDock({ dock: owner.dock })
  if (validated && applyDock(api, validated)) {
    setGroupContexts(st, env, owner.contexts)
    st.histories = new Map()
    prepareAll(st, api)
  } else {
    loadScreen(st, env, api, { kind: 'load', layout: layoutFor(st.shown) }, 'restore')
  }
  st.ranIn = null
  if (!focusedId(st)) st.lastFocused = null
  announce(st, env)
  reportShown(st, env)
  return 'reset'
}

/** Reset the layout on screen. A screen's goes back to its default: its saved layout is cleared, after a
 * snapshot so UNDO can bring it back. A workspace's goes back to the panels it was saved or loaded with
 * (resetWorkspace), leaving every screen's saved layout alone. */
function resetLayout(st: ControllerState, env: ControllerEnv): 'reset' | 'default' | null {
  const api = st.api
  if (!api) return null
  if (st.owner.kind === 'workspace') return resetWorkspace(st, env, api, st.owner)
  const code = st.shown
  if (savedLayoutFor(env.layouts.getState(), code) === null) return 'default'
  snapshot(st, env, 'reset')
  loadScreen(st, env, api, { kind: 'load', layout: layoutFor(code) }, 'reset')
  st.ranIn = null
  if (!focusedId(st)) st.lastFocused = null
  announce(st, env)
  reportShown(st, env)
  return 'reset'
}

/** Undo the last layout change. Untrusted dock JSON off the ring is re-validated through readDock and
 * sanitiseParams the same way a stored layout is, and falls back to the screen's default plan; the
 * layouts store is written only once that validation succeeds, so a corrupt undo entry never saves a
 * layout that could not itself be restored. */
function undo(st: ControllerState, env: ControllerEnv): MnemonicCode | null {
  const api = st.api
  if (!api) return null
  const popped = popUndo(st.undo)
  if (!popped) return null
  st.undo = popped.ring
  const { entry } = popped
  const validated = readDock({ dock: entry.dock })
  const ok = validated !== null && applyDock(api, validated)
  if (ok && validated) {
    if (entry.cause === 'dropped') env.layouts.getState().saveLayout(entry.screen, toStored(entry.screen, validated))
    else if (entry.stored) env.layouts.getState().saveLayout(entry.screen, entry.stored)
    else env.layouts.getState().resetLayout(entry.screen)
  } else {
    env.layouts.getState().resetLayout(entry.screen)
    applyPlan(adapt(api), { kind: 'load', layout: layoutFor(entry.screen) })
  }
  setGroupContexts(st, env, entry.contexts)
  st.histories = new Map()
  prepareAll(st, api)
  st.shown = entry.screen
  // A layout restored from the ring gives back its owner; the default fallback above is a screen's.
  st.owner = ok ? ownerOf(st, env, entry) : SCREEN_OWNER
  st.ranIn = null
  st.lastFocused = null
  announce(st, env)
  reportShown(st, env)
  return entry.screen
}

/** Set every link group's context without reporting each one as an edit of a workspace. */
function setGroupContexts(st: ControllerState, env: ControllerEnv, contexts: GroupRecord<LinkContext | null>): void {
  st.applying = true
  try {
    for (const group of LINK_GROUPS) env.linkGroups.getState().setContext(group, contexts[group])
  } finally {
    st.applying = false
  }
}

function saveRecipe(st: ControllerState, env: ControllerEnv, name: string): Recipe | null {
  const api = st.api
  const recipe = api && isWorkspaceName(name) ? deriveRecipe(st, env) : null
  if (!api || !recipe) return null
  st.owner = { kind: 'workspace', name, base: recipeSignature(recipe), dock: api.toJSON(), contexts: env.linkGroups.getState().contexts }
  reportShown(st, env)
  return recipe
}

/** True when loading changed nothing worth undoing: the same workspace, the same panels and the same link
 * group contexts as before it. */
function loadChangedNothing(before: { owner: Owner; signature: string | null; contexts: string }, st: ControllerState, env: ControllerEnv): boolean {
  if (!sameOwner(before.owner, st.owner) || before.contexts !== JSON.stringify(env.linkGroups.getState().contexts)) return false
  const now = deriveRecipe(st, env)
  return before.signature !== null && now !== null && before.signature === recipeSignature(now)
}

function loadRecipe(st: ControllerState, env: ControllerEnv, name: string, recipe: Recipe, commands: readonly ParsedCommand[]): boolean {
  const api = st.api
  const first = commands[0]
  const panels = api && first && isWorkspaceName(name) ? layoutFromRecipe(recipe, commands) : null
  if (!api || !first || !panels) return false
  const currentRecipe = deriveRecipe(st, env)
  const before = {
    owner: st.owner,
    signature: currentRecipe ? recipeSignature(currentRecipe) : null,
    contexts: JSON.stringify(env.linkGroups.getState().contexts),
  }
  const ringBefore = st.undo
  snapshot(st, env, 'change')
  const pushed = st.undo === ringBefore ? null : (st.undo.at(-1) ?? null)
  applyPlan(adapt(api), { kind: 'load', layout: { screen: first.mnemonic.code, panels } })
  setGroupContexts(st, env, recipe.groups)
  st.histories = new Map()
  prepareAll(st, api)
  seedLinkGroups(api, env.linkGroups)
  st.shown = first.mnemonic.code
  // The base is what the panels give now, not the recipe as stored: they are compared like with like.
  const loaded = deriveRecipe(st, env)
  st.owner = { kind: 'workspace', name, base: recipeSignature(loaded ?? recipe), dock: api.toJSON(), contexts: env.linkGroups.getState().contexts }
  st.ranIn = null
  if (!focusedId(st)) st.lastFocused = null
  announce(st, env)
  reportShown(st, env)
  if (pushed && st.undo.at(-1) === pushed && loadChangedNothing(before, st, env)) st.undo = ringBefore
  return true
}

/** Why a saved line cannot be run, in words; null when it is a screen command. */
function lineProblem(result: LineResult): string | null {
  if (!result.ok) return describeError(result.error).replace(/\.+$/, '')
  return result.action.kind === 'run' ? null : WORKSPACES.notScreen
}

/** The first panel, in reading order, that takes a subject and shows none. Its line would be a bare
 * mnemonic ("DES"), which LOAD parses with no fallback context and refuses, so SAVE refuses it first. */
function firstBarePanel(st: ControllerState, env: ControllerEnv): PanelParams | null {
  for (const id of st.view.getState().order) {
    const shown = shownParams(st, env, id)
    if (shown && shown.context === null && (findMnemonic(shown.code)?.accepts.length ?? 0) > 0) return shown
  }
  return null
}

function saveWorkspace(st: ControllerState, env: ControllerEnv, text: string): string {
  const name = text.trim().toUpperCase()
  if (!isWorkspaceName(name)) return WORKSPACES.badName
  const { list } = env.workspaces.getState()
  if (!Object.hasOwn(list, name) && Object.keys(list).length >= MAX_WORKSPACES) return WORKSPACES.full
  const recipe = deriveRecipe(st, env)
  if (!recipe) return WORKSPACES.notKept
  const bare = firstBarePanel(st, env)
  if (bare) return fillCopy(WORKSPACES.noContext, { name, line: panelTitle(bare) })
  if (!env.workspaces.getState().save(name, recipe)) return WORKSPACES.notKept
  // Read before setLast writes again: it says whether this save reached storage.
  const { persisted } = env.workspaces.getState()
  saveRecipe(st, env, name)
  env.workspaces.getState().setLast(name)
  if (!persisted) return fillCopy(WORKSPACES.savedSession, { name })
  const n = recipe.panels.length
  return n === 1 ? fillCopy(WORKSPACES.savedOne, { name }) : fillCopy(WORKSPACES.saved, { name, n })
}

function loadWorkspace(st: ControllerState, env: ControllerEnv, text: string, parse: (line: string) => LineResult): string {
  const name = text.trim().toUpperCase()
  const { list } = env.workspaces.getState()
  const recipe = isWorkspaceName(name) && Object.hasOwn(list, name) ? list[name] : undefined
  if (!recipe) return fillCopy(WORKSPACES.missing, { name: name === '' ? text : name })
  // A recipe is untrusted: every line is parsed again, and one that no longer runs refuses the whole load.
  const commands: ParsedCommand[] = []
  for (const line of recipe.panels.map((p) => p.line)) {
    const result = parse(line)
    const problem = lineProblem(result)
    if (problem !== null) return fillCopy(WORKSPACES.lineFailed, { name, line, reason: problem })
    if (result.ok && result.action.kind === 'run') commands.push(result.action.command)
  }
  if (!loadRecipe(st, env, name, recipe, commands)) return WORKSPACE.notReady
  env.workspaces.getState().setLast(name)
  return fillCopy(WORKSPACES.loaded, { name })
}

function forgetWorkspace(st: ControllerState, env: ControllerEnv, text: string): string {
  const name = text.trim().toUpperCase()
  if (!env.workspaces.getState().forget(name)) return fillCopy(WORKSPACES.missing, { name: name === '' ? text : name })
  // The workspace that owned the layout no longer exists: the layout is the shown screen's again. Nothing is
  // saved now (the panels are as they were); the next edit is saved for the screen like any other.
  if (st.owner.kind === 'workspace' && st.owner.name === name) {
    st.owner = SCREEN_OWNER
    reportShown(st, env)
  }
  return fillCopy(WORKSPACES.forgotten, { name })
}

/** `env` is read on every call, so the controller always sees the Workspace's latest props. */
export function createWorkspaceController(env: () => ControllerEnv): WorkspaceController {
  const st: ControllerState = {
    api: null,
    lastFocused: null,
    ranIn: null,
    shown: env().initialScreen,
    histories: new Map(),
    undo: EMPTY_RING,
    owner: SCREEN_OWNER,
    owners: new WeakMap(),
    applying: false,
    view: createWorkspaceView(),
  }
  return {
    view: st.view,
    onReady: (dock) => onReady(st, env(), dock),
    run: (command, target) => run(st, env(), command, target),
    preview: (command, target) => preview(st, env(), command, target),
    refreshFocused: () => {
      announce(st, env())
      // A link group retarget changes the lines and groups a workspace would be saved as.
      if (st.owner.kind === 'workspace' && !st.applying) reportShown(st, env())
    },
    focusPanel: () => focusPanel(st, env()),
    focusPanelNumber: (n) => {
      const id = Number.isInteger(n) && n > 0 ? st.view.getState().order[n - 1] : undefined
      if (!id) return false
      // G13: a panel hidden behind a maximised one is never silently focused or addressed while it stays
      // hidden (a stale real-focus reference, or a plain fallback, must yield to the maximised panel:
      // visibleId, focusedId, targetId). Alt+N asking for a different, hidden panel by number is a clear
      // request for that panel, so it exits the maximise first, rather than refusing with a message
      // ('No panel N on this screen.') that is false: the panel is there, just hidden.
      const { maximised } = st.view.getState()
      if (maximised && maximised !== id) toggleMaximise(st, maximised)
      return focusById(env(), id)
    },
    focusPanelShowing: (code) => {
      const id = st.view.getState().order.find((pid) => paramsOf(st, pid)?.code === code)
      if (!id) return false
      const { maximised } = st.view.getState()
      if (maximised && maximised !== id) toggleMaximise(st, maximised)
      return focusById(env(), id)
    },
    focusedContext: () => focusedPanel(st, env())?.context ?? null,
    onFocusIn: (target) => onFocusIn(st, env(), target),
    goBack: (id) => walk(st, env(), id, stepBack),
    goForward: (id) => walk(st, env(), id, stepForward),
    shownIn: (id) => {
      const params = shownParams(st, env(), id)
      return params ? { code: params.code, context: params.context } : null
    },
    openRelatedMenu: (id) => openRelatedMenu(st, id),
    closeRelatedMenu: () => patchView(st.view, { menu: null }),
    openInPanel: (id, code) => openInPanel(st, env(), id, code),
    toggleMaximise: (id) => toggleMaximise(st, id),
    resetLayout: () => resetLayout(st, env()),
    undo: () => undo(st, env()),
    saveRecipe: (name) => saveRecipe(st, env(), name),
    loadRecipe: (name, recipe, commands) => loadRecipe(st, env(), name, recipe, commands),
    saveWorkspace: (name) => saveWorkspace(st, env(), name),
    loadWorkspace: (name, parse) => loadWorkspace(st, env(), name, parse),
    forgetWorkspace: (name) => forgetWorkspace(st, env(), name),
  }
}
