// A preview of what run(command, target) would do (roadmap #6, look spec 5): pure, so the command
// line can show it before Enter or Shift+Enter runs the command for real. The shapes mirror
// WorkspaceModel's OpenPlan; WorkspaceController.preview() builds the PreviewInput the same way run()
// builds a plan, but never calls applyPlan.
import { findMnemonic } from '../commands/registry'
import type { MnemonicCode } from '../commands/registry'
import type { ParsedCommand } from '../commands/parser'
import type { LinkGroup } from '../state/linkGroups'
import { fillCopy } from '../copy/workspace'
import { LAYOUT } from '../copy/layout'
import type { OpenPlan, PanelParams } from './WorkspaceModel'

export interface PanelRef {
  readonly number: number
  readonly code: MnemonicCode
}

export interface Retarget {
  readonly group: LinkGroup
  readonly panels: readonly PanelRef[]
}

export type RunPreview =
  | { readonly kind: 'replace'; readonly panel: PanelRef; readonly code: MnemonicCode; readonly retarget: Retarget | null }
  | { readonly kind: 'add'; readonly after: PanelRef | null; readonly code: MnemonicCode; readonly retarget: Retarget | null }
  | {
      readonly kind: 'load'
      readonly screen: MnemonicCode
      readonly panels: number
      readonly source: 'saved' | 'default' | 'context'
      readonly same: boolean
    }

export interface PreviewInput {
  readonly plan: OpenPlan
  readonly command: ParsedCommand
  /** Panel ids in reading order, as WorkspaceView keeps them. */
  readonly order: readonly string[]
  /** A panel's current params, or null when it no longer exists. */
  paramsOf(id: string): PanelParams | null
  readonly shown: MnemonicCode
  /** Whether the layouts store holds a saved layout for `code`. */
  hasSaved(code: MnemonicCode): boolean
}

function refFrom(order: readonly string[], paramsOf: (id: string) => PanelParams | null, id: string): PanelRef | null {
  const params = paramsOf(id)
  return params ? { number: order.indexOf(id) + 1, code: params.code } : null
}

/** Panels of `group` (other than `exceptId`, the one the plan itself already retargets) whose
 * mnemonic accepts the typed context's kind; null when the command did not type a context. */
function retargetFor(
  command: ParsedCommand,
  group: PanelParams['group'],
  order: readonly string[],
  paramsOf: (id: string) => PanelParams | null,
  exceptId: string | undefined,
): Retarget | null {
  if (command.contextSource !== 'typed' || !command.context || group === '-') return null
  const kind = command.context.kind
  const panels = order.flatMap((id): PanelRef[] => {
    if (id === exceptId) return []
    const params = paramsOf(id)
    if (!params || params.group !== group) return []
    const accepts = findMnemonic(params.code)?.accepts ?? []
    return accepts.includes(kind) ? [{ number: order.indexOf(id) + 1, code: params.code }] : []
  })
  return panels.length > 0 ? { group, panels } : null
}

/** What a plan (replace a panel, add one, or load a whole layout) will do. */
export function describePlan(i: PreviewInput): RunPreview {
  const { plan, command, order, paramsOf, shown, hasSaved } = i
  if (plan.kind === 'replace') {
    const panel: PanelRef = { number: order.indexOf(plan.panelId) + 1, code: paramsOf(plan.panelId)?.code ?? plan.params.code }
    return { kind: 'replace', panel, code: plan.params.code, retarget: retargetFor(command, plan.params.group, order, paramsOf, plan.panelId) }
  }
  if (plan.kind === 'add') {
    const after = plan.ref !== undefined ? refFrom(order, paramsOf, plan.ref) : null
    // The new panel does not exist yet, so no existing panel (not even the anchor) is excluded here.
    return { kind: 'add', after, code: plan.params.code, retarget: retargetFor(command, plan.params.group, order, paramsOf, undefined) }
  }
  const code = plan.layout.screen
  const hasContext = command.context !== null || Object.keys(command.args).length > 0
  const source: 'saved' | 'default' | 'context' = hasContext ? 'context' : hasSaved(code) ? 'saved' : 'default'
  return { kind: 'load', screen: code, panels: plan.layout.panels.length, source, same: code === shown }
}

function refText(ref: PanelRef): string {
  return `${ref.number}-${ref.code}`
}

function withRetarget(text: string, retarget: Retarget | null): string {
  if (!retarget) return text
  const panels = retarget.panels.map(refText).join(', ')
  return text + LAYOUT.separator + fillCopy(LAYOUT.retarget, { group: retarget.group, panels })
}

/** `p` as the line the command line shows before Enter ('enter') or Shift+Enter ('shift') runs it;
 * '' when `variant` does not match what `p` describes (a load never follows Shift+Enter, an add never
 * follows Enter, per WorkspaceModel.planOpen). */
export function previewText(p: RunPreview, variant: 'enter' | 'shift'): string {
  if (variant === 'enter' && p.kind === 'replace') {
    return withRetarget(fillCopy(LAYOUT.replace, { panel: refText(p.panel), code: p.code }), p.retarget)
  }
  if (variant === 'shift' && p.kind === 'add') {
    const base = p.after ? fillCopy(LAYOUT.add, { code: p.code, panel: refText(p.after) }) : fillCopy(LAYOUT.addAlone, { code: p.code })
    return withRetarget(base, p.retarget)
  }
  if (variant === 'enter' && p.kind === 'load') {
    const template = p.source === 'saved' ? LAYOUT.loadSaved : p.source === 'context' ? LAYOUT.loadContext : LAYOUT.loadDefault
    return fillCopy(template, { screen: p.screen, n: p.panels })
  }
  return ''
}
