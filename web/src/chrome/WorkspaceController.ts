// The Workspace's imperative side (UI_SPEC sections 2 and 5, look spec 4.3, 4.7 and 5.2):
// what a command, a layout load, a focus change, back and forward, and the related functions menu do
// to dockview and to the stores. Workspace.tsx is the thin React shell around it.
// - run(): Enter replaces the panel the user last focused (a multi-panel screen, or no focused
//   panel, loads the screen's layout); Shift+Enter opens a new panel (WorkspaceModel.planOpen).
// - A layout is saved only after a command changes it (replace, new panel, back, forward), never on
//   load, so an untouched default is never stored and a changed default reaches every viewer.
// - A screen's mnemonic typed from another screen restores its saved layout; typed on the screen
//   already shown, it resets that screen to its default.
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
import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'
import type { ParsedCommand } from '../commands/parser'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { layoutFor as savedLayoutFor, type LayoutsStore } from '../state/layouts'
import type { LinkGroupsStore } from '../state/linkGroups'
import { syncRoving } from './WorkspaceFocus'
import { EMPTY_HISTORY, recordVisit, stepBack, stepForward, type HistoryStep, type PanelHistory } from './WorkspaceHistory'
import { layoutFor } from './WorkspaceLayouts'
import { applyPlan, effectiveContext, panelTitle, planOpen, sanitiseParams, type DockApiLike, type OpenPlan, type PanelParams } from './WorkspaceModel'
import { fromStored, toStored } from './WorkspaceStorage'
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

export interface ControllerEnv {
  readonly initialScreen: MnemonicCode
  readonly layouts: LayoutsStore
  readonly linkGroups: LinkGroupsStore
  readonly root: () => HTMLElement | null
  readonly onScreenChange?: (code: MnemonicCode) => void
  readonly onFocusedPanelChange?: (panel: FocusedPanel | null) => void
}

export interface WorkspaceController {
  /** Panel numbers, the focused panel, the menu owner and the maximised panel, for rendering. */
  readonly view: WorkspaceView
  onReady(api: DockviewApi): void
  run(command: ParsedCommand, target: RunTarget): void
  /** Focus the panel the user last focused, else the first panel. False when there is none. */
  focusPanel(): boolean
  /** Focus panel N in reading order (Alt+N). False when there is no such panel. */
  focusPanelNumber(n: number): boolean
  /** The context of the panel the user last focused, as it is now (null when none). */
  focusedContext(): ResolvedContext | null
  /** A focus event inside the workspace. */
  onFocusIn(target: EventTarget | null): void
  /** Show what the panel showed before its last change. False when there is nothing behind it. */
  goBack(panelId: string): boolean
  /** Undo a goBack. False when there is nothing ahead. */
  goForward(panelId: string): boolean
  /** Open the related functions menu in a panel (default: the focused one). */
  openRelatedMenu(panelId?: string): boolean
  closeRelatedMenu(): void
  /** Open a function in a panel, keeping its link group and, when the function takes it, its context. */
  openInPanel(panelId: string, code: MnemonicCode): boolean
  toggleMaximise(panelId: string): void
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

function tryStoredLayout(api: DockviewApi, code: MnemonicCode, stored: Readonly<Record<string, unknown>>): boolean {
  const dock = fromStored(code, stored)
  if (!dock) return false
  try {
    api.fromJSON(dock)
  } catch {
    return false
  }
  return api.panels.length > 0 && api.panels.every((p) => sanitiseParams(p.params) !== null)
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

function loadMode(command: ParsedCommand, plan: LoadPlan, shown: MnemonicCode): LoadMode {
  const bare = command.context === null && Object.keys(command.args).length === 0
  if (!bare) return 'plain'
  return plan.layout.screen === shown ? 'reset' : 'restore'
}

/** What the controller remembers between calls; only the controller's own functions change it. */
interface ControllerState {
  api: DockviewApi | null
  lastFocused: string | null
  /** The panel the last command ran in (replaced or added); null after a layout load. */
  ranIn: string | null
  shown: MnemonicCode
  histories: ReadonlyMap<string, PanelHistory>
  readonly view: WorkspaceView
}

function focusedId(st: ControllerState): string | null {
  return st.lastFocused && st.api?.getPanel(st.lastFocused) ? st.lastFocused : null
}

function paramsOf(st: ControllerState, id: string): PanelParams | null {
  return sanitiseParams(st.api?.getPanel(id)?.params)
}

/** The panel the command line addresses: last focused, else where the last command ran, else panel 1. */
function targetId(st: ControllerState, order: readonly string[] = st.view.getState().order): string | null {
  const alive = (id: string | null) => (id && st.api?.getPanel(id) ? id : null)
  return alive(st.lastFocused) ?? alive(st.ranIn) ?? order[0] ?? null
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

function saveShown(st: ControllerState, env: ControllerEnv, dock: DockviewApi): void {
  env.layouts.getState().saveLayout(st.shown, toStored(st.shown, dock.toJSON()))
}

function loadScreen(st: ControllerState, env: ControllerEnv, dock: DockviewApi, plan: LoadPlan, mode: LoadMode): void {
  const { layouts, linkGroups } = env
  const code = plan.layout.screen
  if (mode === 'reset') layouts.getState().resetLayout(code)
  const stored = mode === 'restore' ? savedLayoutFor(layouts.getState(), code) : null
  const restored = stored !== null && tryStoredLayout(dock, code, stored)
  if (stored && !restored) layouts.getState().resetLayout(code)
  if (!restored) applyPlan(adapt(dock), plan)
  st.histories = new Map()
  prepareAll(st, dock)
  seedLinkGroups(dock, linkGroups)
  st.shown = code
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

/** Remember what panel `id` shows before it changes to `next`. */
function remember(st: ControllerState, id: string, next: PanelParams): void {
  const before = paramsOf(st, id)
  if (!before) return
  const was = JSON.stringify(before)
  if (was === JSON.stringify(next)) return
  const history = st.histories.get(id) ?? EMPTY_HISTORY
  st.histories = new Map([...st.histories, [id, recordVisit(history, was)]])
}

function applyToPanel(st: ControllerState, env: ControllerEnv, plan: Exclude<OpenPlan, LoadPlan>, command: ParsedCommand): void {
  const dock = st.api as DockviewApi
  if (plan.kind === 'replace') remember(st, plan.panelId, plan.params)
  applyPlan(adapt(dock), plan)
  prepareAll(st, dock)
  saveShown(st, env, dock)
  const group = plan.params.group
  if (command.contextSource === 'typed' && command.context && group !== '-') {
    env.linkGroups.getState().setContext(group, command.context)
  }
}

function run(st: ControllerState, env: ControllerEnv, command: ParsedCommand, target: RunTarget): void {
  const api = st.api
  if (!api) return
  // Replace or load follows real focus (UI_SPEC section 5), not the display target.
  const real = focusedId(st)
  const focused = { activePanelId: real ?? undefined, activeGroup: real ? paramsOf(st, real)?.group : undefined }
  const plan = planOpen({ ...focused, panelCount: api.panels.length }, command, target === 'new-panel')
  const before = new Set(api.panels.map((p) => p.id))
  if (plan.kind === 'load') loadScreen(st, env, api, plan, loadMode(command, plan, st.shown))
  else applyToPanel(st, env, plan, command)
  st.ranIn = ranInAfter(plan, before, api)
  if (!focusedId(st)) st.lastFocused = null
  env.onScreenChange?.(command.mnemonic.code)
  announce(st, env)
}

/** Replace panel `id` with `params` without recording history (back, forward). */
function showInPanel(st: ControllerState, env: ControllerEnv, id: string, params: PanelParams): void {
  const dock = st.api as DockviewApi
  adapt(dock).replacePanel(id, params, panelTitle(params))
  prepareAll(st, dock)
  saveShown(st, env, dock)
  if (params.group !== '-' && params.context) env.linkGroups.getState().setContext(params.group, params.context)
  if (targetId(st) === id) announce(st, env)
}

function walk(st: ControllerState, env: ControllerEnv, id: string, step: (h: PanelHistory, current: string) => HistoryStep | null): boolean {
  const current = paramsOf(st, id)
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
  showInPanel(st, env, id, target)
  return true
}

function openInPanel(st: ControllerState, env: ControllerEnv, id: string, code: MnemonicCode): boolean {
  const current = paramsOf(st, id)
  const def = findMnemonic(code)
  const dock = st.api
  if (!current || !def || !dock) return false
  const groupContext = current.group === '-' ? null : env.linkGroups.getState().contexts[current.group]
  const shown = effectiveContext(current, groupContext)
  const context = shown && def.accepts.includes(shown.kind) ? shown : null
  const next: PanelParams = { code: def.code, context, args: {}, group: current.group }
  remember(st, id, next)
  adapt(dock).replacePanel(id, next, panelTitle(next))
  patchView(st.view, { menu: null })
  prepareAll(st, dock)
  saveShown(st, env, dock)
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
  env.onScreenChange?.(env.initialScreen)
  announce(st, env)
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

/** `env` is read on every call, so the controller always sees the Workspace's latest props. */
export function createWorkspaceController(env: () => ControllerEnv): WorkspaceController {
  const st: ControllerState = { api: null, lastFocused: null, ranIn: null, shown: env().initialScreen, histories: new Map(), view: createWorkspaceView() }
  return {
    view: st.view,
    onReady: (dock) => onReady(st, env(), dock),
    run: (command, target) => run(st, env(), command, target),
    focusPanel: () => focusPanel(st, env()),
    focusPanelNumber: (n) => {
      const id = Number.isInteger(n) && n > 0 ? st.view.getState().order[n - 1] : undefined
      return id ? focusById(env(), id) : false
    },
    focusedContext: () => focusedPanel(st, env())?.context ?? null,
    onFocusIn: (target) => onFocusIn(st, env(), target),
    goBack: (id) => walk(st, env(), id, stepBack),
    goForward: (id) => walk(st, env(), id, stepForward),
    openRelatedMenu: (id) => openRelatedMenu(st, id),
    closeRelatedMenu: () => patchView(st.view, { menu: null }),
    openInPanel: (id, code) => openInPanel(st, env(), id, code),
    toggleMaximise: (id) => toggleMaximise(st, id),
  }
}
