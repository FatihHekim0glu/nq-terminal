// What a command does to the workspace (UI_SPEC section 5), as a plan, and how a plan becomes
// dockview calls. Pure except for applyPlan, which only touches the api it is given.
//   Enter:       a multi-panel screen loads its default layout; otherwise the focused panel is
//                replaced in place (keeping its link group); with nothing focused, the layout loads.
//   Shift+Enter: a new panel opens to the right of the focused one, in its link group.
import type { CommandArgs, ParsedCommand } from '../commands/parser'
import { TIMEFRAMES, findMnemonic } from '../commands/registry'
import { displayContext } from '../commands/sectors'
import type { ResolvedContext } from '../commands/types'
import { isLinkContext, isLinkGroup, type LinkContext } from '../state/linkGroups'
import { layoutFor, type LayoutPanel, type LinkGroup, type PanelParams, type ScreenLayout } from './WorkspaceLayouts'

export type { LayoutPanel, LinkGroup, PanelParams, ScreenLayout } from './WorkspaceLayouts'

export const PANEL_COMPONENT = 'screen'
const ID_PREFIX = 'nqt-'

export interface WorkspaceFocusState {
  readonly activePanelId?: string
  readonly activeGroup?: LinkGroup
  readonly panelCount: number
}

export type OpenPlan =
  | { readonly kind: 'load'; readonly layout: ScreenLayout }
  | { readonly kind: 'replace'; readonly panelId: string; readonly params: PanelParams }
  | { readonly kind: 'add'; readonly ref: string | undefined; readonly params: PanelParams }

export interface AddOptions {
  readonly id: string
  readonly component: string
  readonly title: string
  readonly params: PanelParams
  readonly position?: { readonly referencePanel: string; readonly direction: 'right' | 'below' }
}

/** The slice of dockview's api the plans need; Workspace adapts the real one to it. */
export interface DockApiLike {
  readonly panels: ReadonlyArray<{ readonly id: string }>
  clear(): void
  addPanel(options: AddOptions): void
  replacePanel(id: string, params: PanelParams, title: string): void
}

/** `<context> <CODE> [argument]`, the way the command line writes it. */
export function panelTitle(params: Pick<PanelParams, 'code' | 'context' | 'args'>): string {
  const argument = params.args.date ?? params.args.timeframe
  return [params.context?.value, params.code, argument].filter(Boolean).join(' ')
}

/** What the title bar shows after the link-group square: context and argument, e.g. "NQ 1d". */
export function panelSubject(params: Pick<PanelParams, 'context' | 'args'>): string {
  const argument = params.args.date ?? params.args.timeframe
  // Instruments show as the chrome shows them everywhere (`NQ1 Index`, look spec 5.1 item 2).
  const context = params.context ? displayContext(params.context, null) : undefined
  return [context, argument].filter(Boolean).join(' ')
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanArgs(raw: unknown): CommandArgs | null {
  if (!isRecord(raw)) return null
  const { date, timeframe } = raw
  if (date !== undefined && (typeof date !== 'string' || !ISO_DATE.test(date))) return null
  if (timeframe !== undefined && !(TIMEFRAMES as readonly unknown[]).includes(timeframe)) return null
  return {
    ...(typeof date === 'string' ? { date } : {}),
    ...(typeof timeframe === 'string' ? { timeframe } : {}),
  }
}

/** Params read back from a stored layout, rebuilt field by field; null when anything is off. */
export function sanitiseParams(raw: unknown): PanelParams | null {
  if (!isRecord(raw)) return null
  const def = typeof raw.code === 'string' ? findMnemonic(raw.code) : undefined
  const group = raw.group === '-' || isLinkGroup(raw.group) ? raw.group : null
  const context = raw.context === null ? null : isLinkContext(raw.context) ? raw.context : undefined
  const args = cleanArgs(raw.args)
  if (!def || def.code !== raw.code || group === null || context === undefined || args === null) return null
  return { code: def.code, context: context && { kind: context.kind, value: context.value }, args, group }
}

/** The context a panel shows: its link group's, when the screen accepts that kind; else its own. */
export function effectiveContext(params: PanelParams, groupContext: LinkContext | null): ResolvedContext | null {
  if (params.group === '-' || !groupContext) return params.context
  const accepts = findMnemonic(params.code)?.accepts ?? []
  return accepts.includes(groupContext.kind) ? { kind: groupContext.kind, value: groupContext.value } : params.context
}

export function paramsFromCommand(command: ParsedCommand, group: LinkGroup): PanelParams {
  const args = { ...command.args }
  return { code: command.mnemonic.code, context: command.context, args, group }
}

/** The screen's default layout, with the command's context and argument on its first panel. */
function layoutForCommand(command: ParsedCommand): ScreenLayout {
  const layout = layoutFor(command.mnemonic.code)
  if (!command.context && Object.keys(command.args).length === 0) return layout
  const panels = layout.panels.map((panel, i): LayoutPanel =>
    i === 0 ? { ...panel, context: command.context, args: { ...command.args } } : panel,
  )
  return { ...layout, panels }
}

export function planOpen(state: WorkspaceFocusState, command: ParsedCommand, newPanel: boolean): OpenPlan {
  const group = state.activeGroup ?? '-'
  if (newPanel) return { kind: 'add', ref: state.activePanelId, params: paramsFromCommand(command, group) }
  const layout = layoutForCommand(command)
  if (layout.panels.length > 1 || !state.activePanelId) return { kind: 'load', layout }
  return { kind: 'replace', panelId: state.activePanelId, params: paramsFromCommand(command, group) }
}

function freshId(api: DockApiLike): string {
  const taken = new Set(api.panels.map((p) => p.id))
  let n = api.panels.length + 1
  while (taken.has(`${ID_PREFIX}${n}`)) n += 1
  return `${ID_PREFIX}${n}`
}

function toParams(panel: LayoutPanel): PanelParams {
  return { code: panel.code, context: panel.context, args: panel.args, group: panel.group }
}

function loadLayout(api: DockApiLike, layout: ScreenLayout): void {
  api.clear()
  for (const panel of layout.panels) {
    const position = panel.position
      ? { referencePanel: panel.position.ref, direction: panel.position.direction }
      : undefined
    api.addPanel({ id: panel.id, component: PANEL_COMPONENT, title: panelTitle(panel), params: toParams(panel), position })
  }
}

function addPanel(api: DockApiLike, params: PanelParams, ref: string | undefined): void {
  const known = ref !== undefined && api.panels.some((p) => p.id === ref)
  const position = known ? { referencePanel: ref, direction: 'right' as const } : undefined
  api.addPanel({ id: freshId(api), component: PANEL_COMPONENT, title: panelTitle(params), params, position })
}

export function applyPlan(api: DockApiLike, plan: OpenPlan): void {
  if (plan.kind === 'load') {
    loadLayout(api, plan.layout)
    return
  }
  if (plan.kind === 'add') {
    addPanel(api, plan.params, plan.ref)
    return
  }
  if (api.panels.some((p) => p.id === plan.panelId)) {
    api.replacePanel(plan.panelId, plan.params, panelTitle(plan.params))
    return
  }
  addPanel(api, plan.params, undefined)
}
