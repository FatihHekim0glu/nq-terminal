// The field pieces of the Start from form: a labelled shell that ties a control to its hint and its error (WCAG 1.3.1,
// 3.3.1, 4.1.2: label for, aria-describedby, aria-invalid), and the control one parameter gets by its type (a checkbox
// for a flag, the terminal's picker for a fixed set, a plain text box otherwise). Every control is a roving item: the
// panel is one Tab stop and the arrow keys move between the controls (chrome/WorkspaceFocus.ts). The boxes are plain
// text, never a native number input, which would keep the Up and Down keys and the wheel for itself.
import type { ChangeEvent, ReactNode } from 'react'
import { DropdownField, type FieldOption } from '../../chrome/Field'
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'
import { LAUNCH } from '../../copy/launch'
import type { ParamSpec } from './types'

const roving = { [ROVING_ATTR]: '' }

export interface FieldShellProps {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly error?: string
  readonly mono?: boolean
  /** The control is not a native one a label can point at (the picker names itself), so the label is plain text. */
  readonly custom?: boolean
  readonly extra?: ReactNode
  /** Marks the field as the preset picker, so the form can return the focus to it. */
  readonly picker?: boolean
  readonly children: (describedBy: string | undefined, invalid: boolean) => ReactNode
}

export function FieldShell({ id, label, hint, error, mono = false, custom = false, extra, picker = false, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : ''
  const errorId = error ? `${id}-error` : ''
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const labelClass = mono ? 'launch-label launch-mono' : 'launch-label'
  return (
    <div className="launch-field" data-launch-picker={picker ? '' : undefined}>
      {custom ? <span className={labelClass}>{label}</span> : <label htmlFor={id} className={labelClass}>{label}</label>}
      {children(describedBy, error !== undefined)}
      {hint ? <span id={hintId} className="launch-hint">{hint}</span> : null}
      {extra}
      {error ? <span id={errorId} className="launch-error"><b>{LAUNCH.errorPrefix}</b> {error}</span> : null}
    </div>
  )
}

export interface TextBoxProps {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly describedBy: string | undefined
  readonly invalid: boolean
  readonly mono?: boolean
  readonly numeric?: boolean
  readonly maxLength?: number
}

export function TextBox({ id, value, onChange, describedBy, invalid, mono = false, numeric = false, maxLength }: TextBoxProps) {
  return (
    <input
      id={id}
      className={mono ? 'launch-input launch-mono' : 'launch-input'}
      type="text"
      inputMode={numeric ? 'decimal' : undefined}
      autoComplete="off"
      spellCheck={false}
      maxLength={maxLength}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      {...roving}
    />
  )
}

export interface ParamControlProps {
  readonly spec: ParamSpec
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly describedBy: string | undefined
  readonly invalid: boolean
}

/** The control of one parameter, by its type. */
export function ParamControl({ spec, id, value, onChange, describedBy, invalid }: ParamControlProps) {
  if (spec.kind === 'bool') {
    return (
      <input
        id={id}
        className="launch-check"
        type="checkbox"
        checked={value.trim() === 'true'}
        onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        {...roving}
      />
    )
  }
  if (spec.kind === 'text' && spec.choices !== null) {
    const options: readonly FieldOption[] = spec.choices.map((c) => ({ value: String(c), label: String(c) }))
    return <DropdownField label={spec.name} value={value} options={options} onChange={onChange} />
  }
  return <TextBox id={id} value={value} onChange={onChange} describedBy={describedBy} invalid={invalid} mono numeric={spec.kind === 'int' || spec.kind === 'float'} />
}
