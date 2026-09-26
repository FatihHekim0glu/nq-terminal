// Grey buttons and range or toggle groups (look spec 4.5, 6.4). Grey buttons: flat grey fill
// with a 1px control boundary. Toggle groups: contiguous buttons on the dark gradient split by 1px
// black lines; the pressed one is selection blue and bold, so its state is not colour alone.
import type { ReactNode } from 'react'
import { ROVING_ATTR } from './WorkspaceFocus'
import './Field.css'

const roving = { [ROVING_ATTR]: '' }

export interface GreyButtonProps {
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly children: ReactNode
}

export function GreyButton({ onClick, disabled = false, children }: GreyButtonProps) {
  return (
    <button type="button" className="btn-grey" onClick={onClick} disabled={disabled} {...roving}>
      {children}
    </button>
  )
}

export interface ToggleOption {
  readonly value: string
  readonly label: string
}

export interface ToggleGroupProps {
  readonly label: string
  readonly options: ReadonlyArray<ToggleOption>
  readonly value: string
  readonly onChange: (value: string) => void
}

export function ToggleGroup({ label, options, value, onChange }: ToggleGroupProps) {
  return (
    <div role="group" aria-label={label} className="btn-toggles">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="btn-toggle"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          {...roving}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
