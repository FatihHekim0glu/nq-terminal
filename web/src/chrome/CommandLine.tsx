// CommandLine (spec 4.2 and 5.1; UI_SPEC sections 5 and 8): the global command box of the command zone.
// A 22px black box with a blue border (bright while focused, dim while focus is in a panel), a caret
// triangle and a blinking block cursor; typed letters show in upper case. The sheet under it holds the
// grouped suggestions (cmdk) or a numbered menu; the message line under that holds prompts and errors.
// Keys: Enter runs (Shift+Enter or NXTW in a new panel), Tab completes, Esc runs the CANCEL cascade,
// Up and Down move through the sheet or walk the history. No option is highlighted (or exposed as
// active) until the user arrows, so what a screen reader is told matches what Enter does.
// Props only: the caller passes GET /api/commands and receives parsed commands through onRun.
import { Command } from 'cmdk'
import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { displayLine } from '../commands/line'
import { withValue } from '../commands/messages'
import type { MnemonicCode } from '../commands/registry'
import { insertSectorWord } from '../commands/sectors'
import type { CommandIndexData } from '../commands/types'
import { COMMAND_LINE } from '../copy/commands'
import { onLineRequest } from './CommandLine.bus'
import { BlockCursor, CaretTriangle } from './CommandLine.cursor'
import { cancelStep, chooseItem, chooseSuggestion, runText } from './CommandLine.dispatch'
import { ComboInput } from './CommandLine.input'
import { useCommandLineKeys } from './CommandLine.keys'
import { handleLineKey } from './CommandLine.lineKeys'
import { MenuSheet, menuOptionId } from './CommandLine.menu'
import { helpMenu, relatedMenu, type MenuModel } from './CommandLine.menus'
import { PreviewAnnouncer, usePreviewText } from './CommandLine.preview'
import { Sheet } from './CommandLine.sheet'
import { NO_OPTION, useCommandLineParts, type CommandLineOptions, type CommandLineParts, type Fallback } from './CommandLine.state'
import { MessageLine } from './MessageLine'
import { clearMessage } from './MessageLine.store'
import './CommandLine.css'

export type { RunTarget } from './CommandLine.state'

/** What the rest of the chrome asks of the command line (key toolbar, F-keys, nav toolbar). */
export interface CommandLineHandle {
  focus(select?: boolean): void
  /** Put a sector word at the caret, one space from its neighbours (F8 to F11), and focus the line. */
  insert(text: string): void
  runLine(line: string, newPanel?: boolean): void
  /** The CANCEL key: one step of the Esc cascade, without moving focus. */
  cancel(): void
  walkHistory(older: boolean): void
  /** A function's help in the sheet. */
  help(code: MnemonicCode): void
  /** Related functions for the focused panel (MENU). */
  related(): void
  showMenu(menu: MenuModel): void
  /** The digits typed for `N <PgDn>`, cleared from the line; null when the line is not a number. */
  takeCount(): number | null
  lineText(): string
}

export interface CommandLineProps extends Partial<Omit<CommandLineOptions, 'index' | 'onRun' | 'indexError'>> {
  readonly ref?: Ref<CommandLineHandle>
  /** GET /api/commands, or null while it loads or after it failed. */
  readonly index: CommandIndexData | null
  readonly indexError?: boolean
  readonly onRun: CommandLineOptions['onRun']
  /** The zone's right side (the context strip), on the box row. */
  readonly aside?: ReactNode
  /** End on an empty line: BACK in the focused panel. */
  readonly onBack?: () => void
}

function indexNote(index: CommandIndexData | null, indexError: boolean): string | null {
  if (indexError) return COMMAND_LINE.indexError
  return index?.registry_error ? withValue(COMMAND_LINE.registryError, index.registry_error) : null
}

function fallbackOf(p: CommandLineParts): Fallback {
  return p.options.resolveFallback ? p.options.resolveFallback() : p.options.fallbackContext
}

function useHandle(ref: Ref<CommandLineHandle> | undefined, p: CommandLineParts) {
  const focus = () => p.inputRef.current?.focus()
  useImperativeHandle(ref, () => ({
    focus: (select = false) => {
      focus()
      if (select) p.inputRef.current?.select()
    },
    insert: (text) => {
      const input = p.inputRef.current
      const next = insertSectorWord(p.s.line, input?.selectionStart ?? p.s.line.length, text)
      p.s.edit(next.line)
      focus()
      // The caret follows the word once the line has rendered (a controlled value moves it to the end).
      requestAnimationFrame(() => p.inputRef.current?.setSelectionRange(next.caret, next.caret))
    },
    runLine: (line, newPanel = false) => runText(p, line, newPanel),
    cancel: () => void cancelStep(p),
    walkHistory: (older) => {
      p.s.walk(older)
      focus()
    },
    help: (code) => {
      p.menus.open(helpMenu(code))
      focus()
    },
    related: () => {
      const f = fallbackOf(p)
      p.menus.open(relatedMenu(f && typeof f !== 'string' ? f : null, p.options.index))
      focus()
    },
    showMenu: (menu) => {
      p.menus.open(menu)
      focus()
    },
    takeCount: () => {
      const text = p.s.line.trim()
      if (!/^\d{1,3}$/.test(text)) return null
      p.s.edit('')
      return Number(text)
    },
    lineText: () => p.s.line,
  }))
}

/** Runs a line asked for from elsewhere on the page (command links), through the same path as typing. */
function useLineRequests(p: CommandLineParts) {
  const latest = useRef(p)
  latest.current = p
  useEffect(() => onLineRequest((r) => runText(latest.current, r.line, r.newPanel)), [])
}

function useInputHandlers(p: CommandLineParts, rootRef: RefObject<HTMLDivElement | null>, onBack: (() => void) | undefined) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    p.s.setKeystrokes((k) => k + 1)
    // Home and End are caret keys here, kept from cmdk; End on an empty line is BACK (spec 5.2).
    if (e.key === 'Home' || e.key === 'End') e.stopPropagation()
    if (e.key === 'End' && p.s.line === '' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && onBack) {
      e.preventDefault()
      onBack()
      return
    }
    if (!handleLineKey(e, p)) return
    e.preventDefault()
    e.stopPropagation()
  }
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const shown = displayLine(e.target.value)
    if (shown !== e.target.value) {
      const at = e.target.selectionStart
      e.target.value = shown
      if (at !== null) e.target.setSelectionRange(at, at)
    }
    if (p.menus.menu && !/^\d*$/.test(shown.trim())) p.menus.close()
    p.s.edit(shown)
  }
  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    const from = e.relatedTarget
    if (from instanceof HTMLElement && !rootRef.current?.contains(from)) p.previousFocus.current = from
    p.s.setDismissed(false)
  }
  /** Leaving the line closes the sheet, the menu and an error, so none covers a panel header. */
  const onBlur = () => {
    p.s.setDismissed(true)
    p.s.setError(null)
    p.menus.close()
    clearMessage('error')
  }
  return { onKeyDown, onChange, onFocus, onBlur }
}

export function CommandLine(props: CommandLineProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [listId, setListId] = useState<string | undefined>()
  const listRef = useCallback((node: HTMLDivElement | null) => setListId(node?.id), [])
  const [caret, setCaret] = useState({ column: 0, scroll: 0 })
  const p = useCommandLineParts({ ...props, indexError: props.indexError ?? false, fallbackContext: props.fallbackContext ?? null }, inputRef)
  const handlers = useInputHandlers(p, rootRef, props.onBack)
  useHandle(props.ref, p)
  useLineRequests(p)
  useCommandLineKeys(inputRef, p.previousFocus)
  const ids = useId()
  const menuId = `${ids}-menu`
  const hintId = `${ids}-hint`
  const msgId = `${ids}-msg`
  const note = indexNote(props.index, props.indexError ?? false)
  const menu = p.menus.menu
  const popupId = menu ? (menu.items.length > 0 ? menuId : undefined) : p.sheetOpen ? listId : undefined
  const activeMenuItem = menu && p.menus.row !== null ? menu.items[p.menus.row] : undefined
  const typed = p.s.line.split(/\s+/).at(-1) ?? ''
  // Hooks run unconditionally; the row itself is withheld below while a menu is open.
  const rawPreviewText = usePreviewText(p)
  const previewText = menu ? null : rawPreviewText
  const previewRow = previewText !== null ? (
    <p className="cmd-preview" aria-hidden="true">
      {previewText}
    </p>
  ) : null
  return (
    <div className="cmdline" ref={rootRef}>
      <div className="cmd-row">
        <Command className="cmdline-root" shouldFilter={false} vimBindings={false} loop value={p.s.navigated ? (p.s.selected || (p.highlighted?.value.trim() ?? NO_OPTION)) : NO_OPTION} onValueChange={p.s.setSelected}>
          <div className="cmd-box">
            <CaretTriangle />
            <ComboInput
              inputRef={inputRef}
              value={p.s.line}
              popupId={popupId}
              activeValue={p.s.navigated ? (p.s.selected || p.highlighted?.value.trim()) : undefined}
              activeMenuId={activeMenuItem ? menuOptionId(menuId, activeMenuItem.n) : undefined}
              invalid={p.s.error !== null}
              describedBy={p.s.error ? `${hintId} ${msgId}` : hintId}
              onChange={handlers.onChange}
              onKeyDown={handlers.onKeyDown}
              onFocus={(e) => {
                setFocused(true)
                handlers.onFocus(e)
              }}
              onBlur={() => {
                setFocused(false)
                handlers.onBlur()
              }}
              onCaret={(column, scroll) => setCaret({ column, scroll })}
            />
            <BlockCursor column={Math.min(caret.column, p.s.line.length)} scrollLeft={caret.scroll} restart={p.s.keystrokes} />
          </div>
          {p.sheetOpen ? (
            <div className="cmd-pop">
              <Sheet groups={p.groups} typed={typed} onChoose={(value) => chooseSuggestion(p, value)} listRef={listRef} />
              {note ? <p className="cmd-note">{note}</p> : null}
              {previewRow}
            </div>
          ) : null}
          {menu ? (
            <div className="cmd-pop">
              <MenuSheet id={menuId} menu={menu} row={p.menus.row} onChoose={(item) => chooseItem(p, item)} onClose={p.menus.close} />
            </div>
          ) : null}
          {focused && !p.sheetOpen && !menu && previewRow ? <div className="cmd-pop">{previewRow}</div> : null}
        </Command>
        {props.aside}
      </div>
      <MessageLine id={msgId} />
      {p.options.previewRun ? <PreviewAnnouncer text={previewText} /> : null}
      <span id={hintId} className="sr-only">{COMMAND_LINE.hint}</span>
    </div>
  )
}
