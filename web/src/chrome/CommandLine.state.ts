// The command line's state (UI_SPEC section 5): the typed line, the suggestion list and which
// option the user arrowed to, the error and the status notice, and the history. CommandLine.tsx
// renders it; handleCommandKey maps keys onto it.
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { loadHistory, newer, older, record, saveHistory, type HistoryStorage } from '../commands/history'
import { describeError, withValue } from '../commands/messages'
import { parseCommand, type ParsedCommand } from '../commands/parser'
import { suggest, type Suggestion, type SuggestionGroup } from '../commands/suggest'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import { COMMAND_LINE } from '../copy/commands'

export type RunTarget = 'replace' | 'new-panel'
export type Fallback = ResolvedContext | string | null

/** cmdk's value while no option is highlighted: no suggestion can have it (':' is not a command character). */
export const NO_OPTION = ':none:'

export interface CommandLineOptions {
  readonly index: CommandIndexData | null
  readonly indexError: boolean
  readonly fallbackContext: Fallback
  /** Read when a command runs; takes precedence over fallbackContext. */
  readonly resolveFallback?: () => Fallback
  readonly onRun: (command: ParsedCommand, target: RunTarget) => void
  /** Called on the Esc that returns focus when no previous element is known; true when it moved focus. */
  readonly onReturnFocus?: () => boolean
  readonly historyStorage?: HistoryStorage | null
}

export interface Grouped {
  readonly group: SuggestionGroup
  readonly items: readonly Suggestion[]
}

/** Group in order of first appearance, keeping the ranking inside each group. */
function groupSuggestions(list: readonly Suggestion[]): Grouped[] {
  const order = [...new Set(list.map((s) => s.group))]
  return order.map((group) => ({ group, items: list.filter((s) => s.group === group) }))
}

function useHistory(storage: HistoryStorage | null | undefined) {
  const [history, setHistory] = useState(() => loadHistory(storage))
  const remember = useCallback(
    (line: string) => {
      setHistory((prev) => {
        const next = record(prev, line)
        saveHistory(next, storage)
        return next
      })
    },
    [storage],
  )
  return { history, setHistory, remember }
}

/** The status message; each change gets a new key so a repeated message is announced again. */
function useNotice() {
  const [notice, setNotice] = useState({ text: '', id: 0 })
  const announce = useCallback((text: string) => setNotice((prev) => ({ text, id: prev.id + 1 })), [])
  return { notice, announce }
}

function useSuggestions(line: string, index: CommandIndexData | null, selected: string, navigated: boolean) {
  const groups = useMemo(() => {
    const list = suggest(line, index).filter((s) => s.value.trimEnd() !== line.trimEnd())
    return groupSuggestions(list)
  }, [line, index])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const highlighted = navigated ? (ordered.find((s) => s.value.trim() === selected) ?? ordered[0]) : undefined
  return { groups, ordered, highlighted }
}

/** The typed line and the flags that follow it; any edit closes history walking and clears the error. */
function useLine(history: ReturnType<typeof useHistory>) {
  const [line, setLine] = useState('')
  const [selected, setSelected] = useState('')
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const edit = (next: string) => {
    setLine(next)
    setDismissed(false)
    setNavigated(false)
    setError(null)
    if (history.history.cursor !== null) history.setHistory({ entries: history.history.entries, cursor: null })
  }
  const walk = (up: boolean) => {
    const step = up ? older(history.history, line) : newer(history.history)
    if (!step) return
    history.setHistory(step.state)
    setLine(step.line)
    setError(null)
  }
  return { line, selected, navigated, dismissed, error, edit, walk, setSelected, setNavigated, setDismissed, setError }
}

type LineState = ReturnType<typeof useLine>

/** Parse the line and hand the command over, or show why it cannot run. */
function runLine(options: CommandLineOptions, s: LineState, done: (canonical: string, newPanel: boolean) => void, newPanel: boolean): void {
  const fallbackContext = options.resolveFallback ? options.resolveFallback() : options.fallbackContext
  const result = parseCommand(s.line, { index: options.index, fallbackContext })
  if (!result.ok) {
    s.setError(describeError(result.error))
    s.setDismissed(true)
    return
  }
  options.onRun(result.command, newPanel ? 'new-panel' : 'replace')
  done(result.command.canonical, newPanel)
}

export function useCommandLineState(options: CommandLineOptions, inputRef: RefObject<HTMLInputElement | null>) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const { notice, announce } = useNotice()
  const history = useHistory(options.historyStorage)
  const s = useLine(history)
  const { groups, ordered, highlighted } = useSuggestions(s.line, options.index, s.selected, s.navigated)
  const open = !s.dismissed && history.history.cursor === null && ordered.length > 0

  const take = (suggestion: Suggestion) => {
    s.edit(suggestion.value)
    inputRef.current?.focus()
  }
  const run = (newPanel: boolean) =>
    runLine(options, s, (canonical) => {
      history.remember(canonical)
      s.edit('')
      announce(withValue(newPanel ? COMMAND_LINE.ranNewPanel : COMMAND_LINE.ran, canonical))
    }, newPanel)
  const returnFocus = () => {
    s.setError(null)
    const previous = previousFocus.current
    if (previous?.isConnected) previous.focus()
    else if (!options.onReturnFocus?.()) inputRef.current?.blur()
  }
  /** Leaving the line closes the list and the error box, so neither covers a panel header. */
  const leave = () => {
    s.setDismissed(true)
    s.setError(null)
  }
  return {
    line: s.line, navigated: s.navigated, error: s.error, groups, ordered, open, highlighted, notice, previousFocus,
    edit: s.edit, walk: s.walk, take, run, returnFocus, leave,
    setSelected: s.setSelected, setNavigated: s.setNavigated, setDismissed: s.setDismissed,
  }
}

export type CommandLineState = ReturnType<typeof useCommandLineState>
