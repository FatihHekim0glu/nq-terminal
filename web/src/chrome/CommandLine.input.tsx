// The command-line combobox input. cmdk's own Command.Input always reports aria-expanded="true" and
// takes Home and End from the caret, so the line uses this input inside the cmdk root instead, with
// the ARIA 1.2 combobox attributes set from the real popup: the suggestion sheet or a menu. The active
// option of the sheet is found by its cmdk data-value, since cmdk generates the option ids.
// No placeholder and no prompt (spec 4.2); the native caret is hidden and drawn as a block instead.
import { useLayoutEffect, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from 'react'
import { COMMAND_LINE } from '../copy/commands'

export interface ComboInputProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly value: string
  /** The id of the open popup (sheet or menu), or undefined when none is open. */
  readonly popupId: string | undefined
  /** cmdk value (trimmed) of the highlighted sheet option; used when the popup is the sheet. */
  readonly activeValue: string | undefined
  /** The id of the highlighted menu row; used when the popup is a menu. */
  readonly activeMenuId: string | undefined
  readonly invalid: boolean
  readonly describedBy: string
  readonly onChange: (e: ChangeEvent<HTMLInputElement>) => void
  readonly onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  readonly onFocus: (e: FocusEvent<HTMLInputElement>) => void
  readonly onBlur: () => void
  readonly onCaret: (position: number, scrollLeft: number) => void
}

function optionId(listId: string | undefined, value: string | undefined): string | undefined {
  if (!listId || value === undefined) return undefined
  const list = document.getElementById(listId)
  const options = list ? Array.from(list.querySelectorAll('[cmdk-item]')) : []
  return options.find((el) => el.getAttribute('data-value') === value)?.id || undefined
}

export function ComboInput(props: ComboInputProps) {
  const [activeId, setActiveId] = useState<string | undefined>()
  const expanded = props.popupId !== undefined
  // Options are in the DOM by the time layout effects run, so the id is read after each commit.
  useLayoutEffect(() => {
    setActiveId(props.activeMenuId ?? (expanded ? optionId(props.popupId, props.activeValue) : undefined))
  }, [expanded, props.popupId, props.activeValue, props.activeMenuId])
  const caret = (e: SyntheticEvent<HTMLInputElement>) => props.onCaret(e.currentTarget.selectionStart ?? e.currentTarget.value.length, e.currentTarget.scrollLeft)
  return (
    <input
      ref={props.inputRef}
      id="cmd"
      name="command"
      type="text"
      role="combobox"
      aria-label={COMMAND_LINE.label}
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={props.popupId}
      aria-activedescendant={expanded && activeId ? activeId : undefined}
      aria-invalid={props.invalid ? true : undefined}
      aria-describedby={props.describedBy}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={props.value}
      onChange={props.onChange}
      onKeyDown={props.onKeyDown}
      onKeyUp={caret}
      onSelect={caret}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    />
  )
}
