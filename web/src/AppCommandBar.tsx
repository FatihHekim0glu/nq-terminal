// The 28px command-line bar (UI_SPEC section 2): nq-lab> prompt and the live command line, the live
// context strip and the READ ONLY / NO ORDER PATH labels.
import type { ParsedCommand } from './commands/parser'
import type { ResolvedContext } from './commands/types'
import type { RunTarget } from './chrome/CommandLine'
import { LiveCommandLine } from './chrome/CommandLine.live'
import { LiveContextStrip } from './chrome/ContextStrip.live'
import { FRAME } from './copy/frame'
import type { PanelLink } from './state/linkGroups'

export interface CommandLineBarProps {
  /** The focused panel's link, or null when no panel has focus. */
  readonly focusedGroup: PanelLink | null
  /** The focused panel's context as it is when a command runs. */
  readonly resolveFallback: () => ResolvedContext | null
  readonly onRun: (command: ParsedCommand, target: RunTarget) => void
  readonly onReturnFocus: () => boolean
}

export default function CommandLineBar(props: CommandLineBarProps) {
  return (
    <header className="cmdbar">
      <LiveCommandLine
        focusedGroup={props.focusedGroup}
        resolveFallback={props.resolveFallback}
        onRun={props.onRun}
        onReturnFocus={props.onReturnFocus}
      />
      <div className="seg">
        <LiveContextStrip focusedGroup={props.focusedGroup} />
      </div>
      <div className="seg safe" role="group" aria-label={FRAME.safetyLabel}>
        <span>{FRAME.readOnly}</span>
        <span>{FRAME.noOrderPath}</span>
      </div>
    </header>
  )
}
