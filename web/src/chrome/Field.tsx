// Amber fields, their dropdown lists and the parameter row (look spec 4.4, 4.5, IS-06, IS-14).
// Amber is for real inputs only: a read-only value is a grey box, never amber. A dropdown field is a
// select-only combobox (value, then a ▾ box) opening an amber-text list with the current item in
// selection navy; it opens upward when there is no room below. Inside a ParamRow each field shows
// its label as amber text before it; elsewhere the label is the accessible name only.
import { createContext, useContext, useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FIELD, fillCopy } from '../copy/workspace'
import { ROVING_ATTR } from './WorkspaceFocus'
import './Field.css'

const roving = { [ROVING_ATTR]: '' }
const ParamRowContext = createContext(false)

export interface FieldOption {
  readonly value: string
  readonly label: string
}

interface LabelProps {
  readonly label: string
  readonly id: string
}

function VisibleLabel({ label, id }: LabelProps) {
  return useContext(ParamRowContext) ? <span id={id} className="param-label">{label}</span> : null
}

export interface AmberFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** In angle brackets, e.g. `<Narrow>` or `<Enter keyword filter>`. */
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly width?: string
  /** Runs with the current value on Enter, e.g. a search field that runs HL. */
  readonly onSubmit?: (value: string) => void
}

export function AmberField({ label, value, onChange, placeholder, disabled = false, width, onSubmit }: AmberFieldProps) {
  const labelId = useId()
  const inRow = useContext(ParamRowContext)
  return (
    <>
      <VisibleLabel label={label} id={labelId} />
      <input
        type="text"
        className="field"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-labelledby={inRow ? labelId : undefined}
        aria-label={inRow ? undefined : label}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!onSubmit || e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          onSubmit(e.currentTarget.value)
        }}
        {...roving}
      />
    </>
  )
}

export interface DropdownFieldProps {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<FieldOption>
  readonly onChange: (value: string) => void
  readonly disabled?: boolean
}

function indexOf(options: ReadonlyArray<FieldOption>, value: string): number {
  return Math.max(0, options.findIndex((o) => o.value === value))
}

/** Opens the list upward when there is no room for it below the field. */
function useListDirection(open: boolean, field: HTMLElement | null, list: HTMLElement | null): 'down' | 'up' {
  const [dir, setDir] = useState<'down' | 'up'>('down')
  useLayoutEffect(() => {
    if (!open || !field || !list) return
    const below = window.innerHeight - field.getBoundingClientRect().bottom
    setDir(list.offsetHeight > below && field.getBoundingClientRect().top > below ? 'up' : 'down')
  }, [open, field, list])
  return dir
}

export function DropdownField({ label, value, options, onChange, disabled = false }: DropdownFieldProps) {
  const labelId = useId()
  const listId = useId()
  const inRow = useContext(ParamRowContext)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(() => indexOf(options, value))
  // Both elements are held in state through callback refs, so the direction hook sees committed nodes.
  const [field, setField] = useState<HTMLDivElement | null>(null)
  const [list, setList] = useState<HTMLUListElement | null>(null)
  const dir = useListDirection(open, field, list)
  const current = options.find((o) => o.value === value)
  const optionId = (i: number) => `${listId}-o${i}`

  const openList = () => {
    if (disabled) return
    setActive(indexOf(options, value))
    setOpen(true)
  }
  const choose = (i: number) => {
    const option = options[i]
    setOpen(false)
    if (option && option.value !== value) onChange(option.value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const key = event.key
    if (!open && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ')) {
      event.preventDefault()
      openList()
      return
    }
    if (!open) return
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      const step = key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.min(Math.max(i + step, 0), options.length - 1))
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      choose(active)
    } else if (key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <VisibleLabel label={label} id={labelId} />
      <span className="field-wrap">
        <div
          ref={setField}
          role="combobox"
          tabIndex={0}
          className="field field-dd"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? optionId(active) : undefined}
          aria-disabled={disabled ? true : undefined}
          aria-labelledby={inRow ? labelId : undefined}
          aria-label={inRow ? undefined : label}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          {...roving}
        >
          <span className="field-value">{current?.label ?? value}</span>
          <span className="field-btn" aria-hidden="true">▾</span>
        </div>
        {open ? (
          <ul
            ref={setList}
            id={listId}
            role="listbox"
            aria-label={fillCopy(FIELD.listLabel, { label })}
            className={`field-list field-list-${dir}`}
          >
            {options.map((option, i) => (
              <li
                key={option.value}
                id={optionId(i)}
                role="option"
                aria-selected={option.value === value}
                data-active={i === active ? 'true' : undefined}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                {option.label}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </>
  )
}

export interface ParamRowProps {
  /** Names the row for assistive technology, e.g. "Chart parameters". */
  readonly label: string
  readonly children: ReactNode
}

/** A 24px black row of amber labels and fields: `Range [..]-[..]  Freq [Daily ▾]`. */
export function ParamRow({ label, children }: ParamRowProps) {
  return (
    <div role="group" aria-label={label} className="param-row">
      <ParamRowContext value={true}>{children}</ParamRowContext>
    </div>
  )
}

export interface ReadOnlyValueProps {
  readonly label: string
  readonly children: ReactNode
}

/** A value the user cannot change: a grey box with light text, never amber (4.5). */
export function ReadOnlyValue({ label, children }: ReadOnlyValueProps) {
  return (
    <>
      <span className="param-label">{label}</span>
      <span className="field-ro">{children}</span>
    </>
  )
}
