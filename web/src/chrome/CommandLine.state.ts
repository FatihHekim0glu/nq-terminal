// The command line's state (spec 4.2 and 5.1): the typed line (shown in upper case), the suggestion
// sheet and which option the user arrowed to, the menu stack, the error, and the history. Messages go
// to the message line (MessageLine.store). CommandLine.tsx renders this; handleCommandKey maps keys
// onto it; CommandLine.dispatch.ts carries out what a line or a menu item asks for.
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { loadHistory, newer, older, record, saveHistory, type HistoryStorage } from '../commands/history'
import { displayLine } from '../commands/line'
import type { ParsedCommand } from '../commands/parser'
import type { MnemonicCode } from '../commands/registry'
import { sheetGroups, suggest, type SheetGroup, type Suggestion, type SuggestionGroup } from '../commands/suggest'
import type { CommandIndexData, ResolvedContext } from '../commands/types'
import type { MenuModel } from './CommandLine.menus'
import { clearMessage } from './MessageLine.store'

export type RunTarget = 'replace' | 'new-panel'
export type Fallback = ResolvedContext | string | null

/** cmdk's value while no option is highlighted: no suggestion can have it (':' is not a command character). */
export const NO_OPTION = ':none:'
/** cmdk value prefix of a group's "More ..." row. */
export const MORE_PREFIX = ':more:'

export interface CommandLineOptions {
  readonly index: CommandIndexData | null
  readonly indexError: boolean
  readonly fallbackContext: Fallback
  /** Read when a command runs; takes precedence over fallbackContext. */
  readonly resolveFallback?: () => Fallback
  /** false when nothing opened (the workspace is not ready); void or true means it ran. */
  readonly onRun: (command: ParsedCommand, target: RunTarget) => boolean | void
  /** Called on the Esc that returns focus when no previous element is known; true when it moved focus. */
  readonly onReturnFocus?: () => boolean
  /** A context typed on its own: load it into the focused panel's link group. */
  readonly onContext?: (context: ResolvedContext) => void
  /** Number <GO> with no menu open: run item n of the focused panel; false when it has none. */
  readonly onNumber?: (n: number) => boolean
  /** NO <GO>: switch the event tape; returns whether it is now on. */
  readonly onTape?: () => boolean
  /** MENU: open the focused panel's own related functions menu; false when there is none. */
  readonly onMenu?: () => boolean
  /** The focused panel's mnemonic, for MENU and F1. */
  readonly focusedCode?: () => MnemonicCode | null
  readonly historyStorage?: HistoryStorage | null
  /** RESET <GO>: put the shown layout back to its default. Text to post, or null when not ready. */
  readonly onReset?: () => string | null
  /** UNDO <GO>: undo the last layout change. Text to post, or null when not ready. */
  readonly onUndo?: () => string | null
  /** The <GO> preview row: what `command` would do, alone or (newPanel) opened in a new panel; null when there is nothing to show. */
  readonly previewRun?: (command: ParsedCommand, newPanel: boolean) => string | null
  /** WATCH <GO>: what changed since the records were marked seen, as a menu; null when not ready. */
  readonly watchMenu?: () => MenuModel | null
  /** WATCH SEEN <GO>: mark the records seen. Text to post, or null when not ready. */
  readonly onWatchSeen?: () => string | null
  /** GRAB <GO>: save the focused panel as an image; false when no panel is focused. */
  readonly onGrab?: () => boolean
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

function useSuggestions(line: string, index: CommandIndexData | null, selected: string, navigated: boolean, expanded: SuggestionGroup | null) {
  const groups: readonly SheetGroup[] = useMemo(() => {
    const list = suggest(line, index).filter((s) => s.value.trimEnd().toUpperCase() !== line.trimEnd().toUpperCase())
    return sheetGroups(list, expanded)
  }, [line, index, expanded])
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const highlighted = navigated ? (ordered.find((s) => s.value.trim() === selected) ?? ordered[0]) : undefined
  return { groups, ordered, highlighted }
}

/** The menu stack: the last menu is shown; its highlighted row once the user arrows. */
function useMenus() {
  const [stack, setStack] = useState<readonly MenuModel[]>([])
  const [row, setRow] = useState<number | null>(null)
  const menu = stack.at(-1) ?? null
  const open = (m: MenuModel, replace = true) => {
    setStack((prev) => (replace ? [m] : [...prev, m]))
    setRow(null)
  }
  const up = () => {
    setStack((prev) => prev.slice(0, -1))
    setRow(null)
  }
  const close = () => {
    setStack([])
    setRow(null)
  }
  return { stack, menu, row, setRow, open, up, close }
}

/** The typed line and the flags that follow it; any edit ends history walking and clears the error. */
function useLine(history: ReturnType<typeof useHistory>) {
  const [line, setLine] = useState('')
  const [selected, setSelected] = useState('')
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<SuggestionGroup | null>(null)
  const [keystrokes, setKeystrokes] = useState(0)
  const edit = (next: string) => {
    setLine(displayLine(next))
    setDismissed(false)
    setNavigated(false)
    setExpanded(null)
    setKeystrokes((k) => k + 1)
    setError(null)
    clearMessage('error')
    // Functional update (D07): a plain value here would race the functional update `remember` queues
    // when Enter re-runs a recalled line, overwriting its newest entry with this render's stale copy.
    history.setHistory((prev) => (prev.cursor === null ? prev : { entries: prev.entries, cursor: null }))
  }
  const walk = (up: boolean) => {
    const step = up ? older(history.history, line) : newer(history.history)
    if (!step) return
    history.setHistory(step.state)
    setLine(displayLine(step.line))
    setKeystrokes((k) => k + 1)
    setError(null)
  }
  return { line, selected, navigated, dismissed, error, expanded, keystrokes, edit, walk, setSelected, setNavigated, setDismissed, setError, setExpanded, setKeystrokes }
}

export type LineState = ReturnType<typeof useLine>
export type MenuState = ReturnType<typeof useMenus>
export type HistoryHook = ReturnType<typeof useHistory>

export function useCommandLineParts(options: CommandLineOptions, inputRef: RefObject<HTMLInputElement | null>) {
  const previousFocus = useRef<HTMLElement | null>(null)
  const history = useHistory(options.historyStorage)
  const s = useLine(history)
  const menus = useMenus()
  const { groups, ordered, highlighted } = useSuggestions(s.line, options.index, s.selected, s.navigated, s.expanded)
  const sheetOpen = menus.menu === null && !s.dismissed && history.history.cursor === null && ordered.length > 0
  return { options, inputRef, previousFocus, history, s, menus, groups, ordered, highlighted, sheetOpen }
}

export type CommandLineParts = ReturnType<typeof useCommandLineParts>
export type { Suggestion }
