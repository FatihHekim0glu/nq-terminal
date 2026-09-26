// CommandLine (UI_SPEC sections 5 and 8): cmdk inline under the nq-lab> prompt.
// Enter runs the typed line (Shift+Enter in a new panel); Tab, a click, or Enter after arrowing
// takes a suggestion; Up and Down in an empty line walk the history; Esc closes the list, then
// returns focus to the panel it came from. Esc and Ctrl+K reach it from anywhere.
// No option is highlighted (or exposed as active) until the user arrows, so what a screen reader
// is told matches what Enter does. Props only: the caller passes GET /api/commands and receives
// parsed commands through onRun. State lives in CommandLine.state.ts, keys in CommandLine.keys.ts.
import { Command } from 'cmdk'
import { useCallback, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import type { HistoryStorage } from '../commands/history'
import { withValue } from '../commands/messages'
import type { ParsedCommand } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import { COMMAND_LINE, SUGGESTION_GROUPS } from '../copy/commands'
import { ComboInput } from './CommandLine.input'
import { handleCommandKey, useCommandLineKeys } from './CommandLine.keys'
import { NO_OPTION, useCommandLineState, type CommandLineState, type Fallback, type Grouped, type RunTarget } from './CommandLine.state'
import './CommandLine.css'

export type { RunTarget } from './CommandLine.state'

export interface CommandLineProps {
  /** GET /api/commands, or null while it loads or after it failed. */
  readonly index: CommandIndexData | null
  readonly indexError?: boolean
  /** The focused panel's link-group context, used when the line names none. */
  readonly fallbackContext?: Fallback
  /** Reads the fallback when a command runs (the focused panel as it is now); wins over fallbackContext. */
  readonly resolveFallback?: () => Fallback
  readonly onRun: (command: ParsedCommand, target: RunTarget) => void
  /** Focus a panel when a second Esc has no previous element to return to; true when it did. */
  readonly onReturnFocus?: () => boolean
  /** History storage; defaults to localStorage, null keeps history for this page view only. */
  readonly historyStorage?: HistoryStorage | null
}

function SuggestionList({ groups, onTake, listRef }: {
  readonly groups: readonly Grouped[]
  readonly onTake: CommandLineState['take']
  readonly listRef: (node: HTMLDivElement | null) => void
}) {
  return (
    <Command.List ref={listRef} className="cmd-list" label={COMMAND_LINE.suggestionsLabel} onMouseDown={(e) => e.preventDefault()}>
      {groups.map(({ group, items }) => (
        <Command.Group key={group} heading={SUGGESTION_GROUPS[group]}>
          {items.map((s) => (
            <Command.Item key={s.value} value={s.value.trim()} onSelect={() => onTake(s)}>
              <span className="lbl">{s.label}</span>
              <span className="det">{s.detail}</span>
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </Command.List>
  )
}

function indexNote(index: CommandIndexData | null, indexError: boolean): string | null {
  if (indexError) return COMMAND_LINE.indexError
  return index?.registry_error ? withValue(COMMAND_LINE.registryError, index.registry_error) : null
}

/** The input's key and focus handlers over the line's state. */
function useInputHandlers(state: CommandLineState, rootRef: RefObject<HTMLDivElement | null>) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Home' || e.key === 'End') e.stopPropagation()
    const handled = handleCommandKey(e.key, e.shiftKey, {
      ...state,
      first: state.ordered[0],
      dismiss: () => state.setDismissed(true),
      markNavigated: () => state.setNavigated(true),
    })
    if (!handled) return
    e.preventDefault()
    e.stopPropagation()
  }
  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    const from = e.relatedTarget
    if (from instanceof HTMLElement && !rootRef.current?.contains(from)) state.previousFocus.current = from
    state.setDismissed(false)
  }
  return { onKeyDown, onFocus }
}

/** The polite status message; a new key per message, so a repeated command is announced again. */
function Notice({ notice }: { readonly notice: CommandLineState['notice'] }) {
  return (
    <span role="status" className="sr-only">
      {notice.text ? <span key={notice.id}>{notice.text}</span> : null}
    </span>
  )
}

export function CommandLine(props: CommandLineProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [listId, setListId] = useState<string | undefined>()
  const listRef = useCallback((node: HTMLDivElement | null) => setListId(node?.id), [])
  const state = useCommandLineState({ ...props, indexError: props.indexError ?? false, fallbackContext: props.fallbackContext ?? null }, inputRef)
  const { onKeyDown, onFocus } = useInputHandlers(state, rootRef)
  useCommandLineKeys(inputRef, state.previousFocus)
  const ids = useId()
  const note = indexNote(props.index, props.indexError ?? false)
  const active = state.highlighted?.value.trim()
  const hintId = `${ids}-hint`
  const errorId = `${ids}-error`
  return (
    <div className="cmd cmdline" ref={rootRef}>
      <span className="prompt" aria-hidden="true">{COMMAND_LINE.prompt}</span>
      <Command className="cmdline-root" shouldFilter={false} vimBindings={false} loop value={active ?? NO_OPTION} onValueChange={state.setSelected}>
        <ComboInput
          inputRef={inputRef}
          value={state.line}
          open={state.open}
          listId={listId}
          activeValue={active}
          invalid={state.error !== null}
          describedBy={state.error ? `${hintId} ${errorId}` : hintId}
          onChange={(e) => state.edit(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={state.leave}
        />
        {state.open ? (
          <div className="cmd-pop">
            <SuggestionList groups={state.groups} onTake={state.take} listRef={listRef} />
            {note ? <p className="cmd-note">{note}</p> : null}
          </div>
        ) : null}
      </Command>
      {state.error ? <p id={errorId} role="alert" className="cmd-error">{state.error}</p> : null}
      <span id={hintId} className="sr-only">{COMMAND_LINE.hint}</span>
      <Notice notice={state.notice} />
    </div>
  )
}
