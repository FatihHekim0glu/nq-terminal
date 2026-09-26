// The Workspace's imperative side (UI_SPEC sections 2 and 5): what a command, a layout load and a
// focus change do to dockview and to the stores. Workspace.tsx is the thin React shell around it.
// - run(): Enter replaces the panel the user last focused (a multi-panel screen, or no focused
//   panel, loads the screen's layout); Shift+Enter opens a new panel (WorkspaceModel.planOpen).
// - A layout is saved only after a command changes it (replace or new panel), never on load, so
//   an untouched default is never stored and a changed default reaches every viewer.
// - A screen's mnemonic typed from another screen restores its saved layout; typed on the screen
//   already shown, it resets that screen to its default.
// - The focused panel and its context are read when asked (focusedContext), never cached, so a
//   command that replaced the panel or retargeted its link group is seen by the next command.
import type { DockviewApi, DockviewGroupPanel } from 'dockview-react'
import type { ParsedCommand } from '../commands/parser'
import type { MnemonicCode } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { layoutFor as savedLayoutFor, type LayoutsStore } from '../state/layouts'
import type { LinkGroupsStore } from '../state/linkGroups'
import { syncRoving } from './WorkspaceFocus'
import { layoutFor } from './WorkspaceLayouts'
import { applyPlan, effectiveContext, planOpen, sanitiseParams, type DockApiLike, type OpenPlan, type PanelParams } from './WorkspaceModel'
import { fromStored, toStored } from './WorkspaceStorage'

export type RunTarget = 'replace' | 'new-panel'
type LoadMode = 'restore' | 'reset' | 'plain'
type LoadPlan = Extract<OpenPlan, { kind: 'load' }>

export interface FocusedPanel {
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
  onReady(api: DockviewApi): void
  run(command: ParsedCommand, target: RunTarget): void
  /** Focus the panel the user last focused, else the first panel. False when there is none. */
  focusPanel(): boolean
  /** The context of the panel the user last focused, as it is now (null when none). */
  focusedContext(): ResolvedContext | null
  /** A focus event inside the workspace. */
  onFocusIn(target: EventTarget | null): void
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
  shown: MnemonicCode
}

function focusedId(st: ControllerState): string | null {
  return st.lastFocused && st.api?.getPanel(st.lastFocused) ? st.lastFocused : null
}

function focusedPanel(st: ControllerState, env: ControllerEnv): FocusedPanel | null {
  const id = focusedId(st)
  const params = id ? sanitiseParams(st.api?.getPanel(id)?.params) : null
  if (!params) return null
  const groupContext = params.group === '-' ? null : env.linkGroups.getState().contexts[params.group]
  return { params, context: effectiveContext(params, groupContext) }
}

function prepareAll(dock: DockviewApi): void {
  for (const group of dock.groups) prepareGroup(group)
}

function loadScreen(st: ControllerState, env: ControllerEnv, dock: DockviewApi, plan: LoadPlan, mode: LoadMode): void {
  const { layouts, linkGroups } = env
  const code = plan.layout.screen
  if (mode === 'reset') layouts.getState().resetLayout(code)
  const stored = mode === 'restore' ? savedLayoutFor(layouts.getState(), code) : null
  const restored = stored !== null && tryStoredLayout(dock, code, stored)
  if (stored && !restored) layouts.getState().resetLayout(code)
  if (!restored) applyPlan(adapt(dock), plan)
  prepareAll(dock)
  seedLinkGroups(dock, linkGroups)
  st.shown = code
}

function applyToPanel(st: ControllerState, env: ControllerEnv, plan: Exclude<OpenPlan, LoadPlan>, command: ParsedCommand): void {
  const dock = st.api as DockviewApi
  applyPlan(adapt(dock), plan)
  prepareAll(dock)
  env.layouts.getState().saveLayout(st.shown, toStored(st.shown, dock.toJSON()))
  const group = plan.params.group
  if (command.contextSource === 'typed' && command.context && group !== '-') {
    env.linkGroups.getState().setContext(group, command.context)
  }
}

function run(st: ControllerState, env: ControllerEnv, command: ParsedCommand, target: RunTarget): void {
  const api = st.api
  if (!api) return
  const focused = { activePanelId: focusedId(st) ?? undefined, activeGroup: focusedPanel(st, env)?.params.group }
  const plan = planOpen({ ...focused, panelCount: api.panels.length }, command, target === 'new-panel')
  if (plan.kind === 'load') loadScreen(st, env, api, plan, loadMode(command, plan, st.shown))
  else applyToPanel(st, env, plan, command)
  if (!focusedId(st)) st.lastFocused = null
  env.onScreenChange?.(command.mnemonic.code)
  env.onFocusedPanelChange?.(focusedPanel(st, env))
}

/** Focus the panel the user last focused; before any, the first panel in reading order. */
function focusPanel(st: ControllerState, env: ControllerEnv): boolean {
  const id = focusedId(st)
  const root = env.root()
  const el = id ? panelElement(root, id) : (root?.querySelector<HTMLElement>('[data-nqt-panel]') ?? null)
  const stop = el ? syncRoving(el) : undefined
  stop?.focus()
  return stop !== undefined && document.activeElement === stop
}

function onReady(st: ControllerState, env: ControllerEnv, dock: DockviewApi): void {
  st.api = dock
  dock.onDidAddGroup((group) => prepareGroup(group))
  loadScreen(st, env, dock, { kind: 'load', layout: layoutFor(env.initialScreen) }, 'restore')
  env.onScreenChange?.(env.initialScreen)
}

function onFocusIn(st: ControllerState, env: ControllerEnv, target: EventTarget | null): void {
  const id = panelIdOf(target)
  if (!id || id === st.lastFocused) return
  st.lastFocused = id
  env.onFocusedPanelChange?.(focusedPanel(st, env))
}

/** `env` is read on every call, so the controller always sees the Workspace's latest props. */
export function createWorkspaceController(env: () => ControllerEnv): WorkspaceController {
  const st: ControllerState = { api: null, lastFocused: null, shown: env().initialScreen }
  return {
    onReady: (dock) => onReady(st, env(), dock),
    run: (command, target) => run(st, env(), command, target),
    focusPanel: () => focusPanel(st, env()),
    focusedContext: () => focusedPanel(st, env())?.context ?? null,
    onFocusIn: (target) => onFocusIn(st, env(), target),
  }
}
