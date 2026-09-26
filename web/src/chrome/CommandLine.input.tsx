// The command-line combobox input. cmdk's own Command.Input always reports aria-expanded="true" and
// takes Home and End from the caret, so the line uses this input inside the cmdk root instead, with
// the ARIA 1.2 combobox attributes set from the real list state. The active option is found in the
// list by its cmdk data-value, since cmdk generates the option ids.
import { useLayoutEffect, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { COMMAND_LINE } from '../copy/commands'

export interface ComboInputProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly value: string
  readonly open: boolean
  readonly listId: string | undefined
  /** cmdk value (trimmed) of the highlighted option. */
  readonly activeValue: string | undefined
  readonly invalid: boolean
  readonly describedBy: string
  readonly onChange: (e: ChangeEvent<HTMLInputElement>) => void
  readonly onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  readonly onFocus: (e: FocusEvent<HTMLInputElement>) => void
  readonly onBlur: () => void
}

function optionId(listId: string | undefined, value: string | undefined): string | undefined {
  if (!listId || value === undefined) return undefined
  const list = document.getElementById(listId)
  const options = list ? Array.from(list.querySelectorAll('[cmdk-item]')) : []
  return options.find((el) => el.getAttribute('data-value') === value)?.id || undefined
}

export function ComboInput(props: ComboInputProps) {
  const [activeId, setActiveId] = useState<string | undefined>()
  const expanded = props.open && props.listId !== undefined
  // Options are in the DOM by the time layout effects run, so the id is read after each commit.
  useLayoutEffect(() => {
    setActiveId(expanded ? optionId(props.listId, props.activeValue) : undefined)
  }, [expanded, props.listId, props.activeValue])
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
      aria-controls={expanded ? props.listId : undefined}
      aria-activedescendant={expanded && activeId ? activeId : undefined}
      aria-invalid={props.invalid ? true : undefined}
      aria-describedby={props.describedBy}
      placeholder={COMMAND_LINE.placeholder}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={props.value}
      onChange={props.onChange}
      onKeyDown={props.onKeyDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    />
  )
}
