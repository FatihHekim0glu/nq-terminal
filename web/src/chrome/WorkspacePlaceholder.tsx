// The labelled placeholder an unbuilt screen shows (TASKS 4.4): what the screen is, when it is built,
// and the context and argument the command gave it, so every mnemonic visibly resolves.
import type { CommandArgs } from '../commands/parser'
import type { MnemonicDef } from '../commands/registry'
import type { ResolvedContext } from '../commands/types'
import { PLACEHOLDER, fillCopy } from '../copy/workspace'
import { SCREEN_PHASES } from './WorkspaceLayouts'

export interface WorkspacePlaceholderProps {
  readonly def: MnemonicDef
  readonly context: ResolvedContext | null
  readonly args: CommandArgs
}

function plan(def: MnemonicDef): string {
  if (def.priority === 'P1') return PLACEHOLDER.P1
  if (def.priority === 'P2') return PLACEHOLDER.P2
  return fillCopy(PLACEHOLDER.P0, { phase: SCREEN_PHASES[def.code] ?? '?' })
}

export default function WorkspacePlaceholder({ def, context, args }: WorkspacePlaceholderProps) {
  const argument = args.date ?? args.timeframe
  return (
    <div className="ws-placeholder" data-placeholder={def.code}>
      <p className="ws-placeholder-head">{fillCopy(PLACEHOLDER.heading, { code: def.code, screen: def.screen })}</p>
      <p className="ws-placeholder-status">{PLACEHOLDER.status}</p>
      <p className="ws-placeholder-plan">{plan(def)}</p>
      <p className="ws-placeholder-meta">
        {context ? fillCopy(PLACEHOLDER.context, { value: `${context.value} (${context.kind})` }) : PLACEHOLDER.noContext}
      </p>
      {argument ? <p className="ws-placeholder-meta">{fillCopy(PLACEHOLDER.argument, { value: argument })}</p> : null}
    </div>
  )
}
