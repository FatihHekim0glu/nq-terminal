// The command line on live data: suggestions and context names from GET /api/commands. The fallback
// for a line that names no context is the focused panel's context, read when the command runs
// (resolveFallback, from the Workspace); without it, the focused group's context in the store.
// What a command opens is the caller's business (onRun and the other callbacks); this wrapper changes
// no state itself. After the first paint it also starts loading the lazy HL search index.
import { useEffect } from 'react'
import { useCommands } from '../api/queries'
import { loadSearchIndex } from '../commands/searchIndexLoader'
import { contextFor, useLinkGroups, type PanelLink } from '../state/linkGroups'
import { CommandLine, type CommandLineProps } from './CommandLine'

export interface LiveCommandLineProps extends Omit<CommandLineProps, 'index' | 'indexError' | 'fallbackContext'> {
  /** The focused panel's link ('-' for an unlinked panel), or null when no panel has focus. */
  readonly focusedGroup: PanelLink | null
}

export function LiveCommandLine({ focusedGroup, ...rest }: LiveCommandLineProps) {
  const commands = useCommands()
  // HL finds metrics, instruments and help text once this chunk is in; until then it shows today's results.
  useEffect(() => {
    void loadSearchIndex()
  }, [])
  const fallback = useLinkGroups((state) => (focusedGroup === null ? null : contextFor(state, focusedGroup)))
  // A failed background refetch (the index re-reads every COMMANDS_POLL_MS) keeps the last good data:
  // the index is still in use, so only say it did not load when there is truly nothing to show (D32).
  const indexError = commands.isError && commands.data === undefined
  return <CommandLine {...rest} index={commands.data ?? null} indexError={indexError} fallbackContext={fallback} />
}
