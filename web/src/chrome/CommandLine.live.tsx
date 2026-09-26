// The command line on live data: suggestions and context names from GET /api/commands. The fallback
// for a line that names no context is the focused panel's context, read when the command runs
// (resolveFallback, from the Workspace); without it, the focused group's context in the store.
// What a command opens is the caller's business (onRun and the other callbacks); this wrapper changes
// no state itself.
import { useCommands } from '../api/queries'
import { contextFor, useLinkGroups, type PanelLink } from '../state/linkGroups'
import { CommandLine, type CommandLineProps } from './CommandLine'

export interface LiveCommandLineProps extends Omit<CommandLineProps, 'index' | 'indexError' | 'fallbackContext'> {
  /** The focused panel's link ('-' for an unlinked panel), or null when no panel has focus. */
  readonly focusedGroup: PanelLink | null
}

export function LiveCommandLine({ focusedGroup, ...rest }: LiveCommandLineProps) {
  const commands = useCommands()
  const fallback = useLinkGroups((state) => (focusedGroup === null ? null : contextFor(state, focusedGroup)))
  return <CommandLine {...rest} index={commands.data ?? null} indexError={commands.isError} fallbackContext={fallback} />
}
