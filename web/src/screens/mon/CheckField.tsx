// A checkbox for a parameter row (look spec 7.7 `☐ Vol-normalised  ☐ Heat cells`): a native checkbox
// with its amber label, one roving item of the panel. The shared Field set has no checkbox, so the two
// market screens keep this one here.
import { ROVING_ATTR } from '../../chrome/WorkspaceFocus'

const roving = { [ROVING_ATTR]: '' }

export interface CheckFieldProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}

export default function CheckField({ label, checked, onChange }: CheckFieldProps) {
  return (
    <label className="mkt-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...roving} />
      <span>{label}</span>
    </label>
  )
}
