// What screens import for the pivot views (TASKS 9.1): the Grid | Pivot toggle and the pivot views. A pivot
// view offers the same rows as an accessible table and as the Perspective pivot grid (pivots.tsx); the pivot
// grid's code, its stylesheet and the engine load only when the pivot grid itself is shown.
import { ToggleGroup } from '../chrome/Field.buttons'
import { PIVOT } from '../copy/perspective'
import './toggle.css'

export { FillsPivot, LedgerPivot, OosPivot, TradesPivot } from './pivots'

export type GridView = 'grid' | 'pivot'

const VIEWS = [
  { value: 'grid', label: PIVOT.grid },
  { value: 'pivot', label: PIVOT.pivot },
] as const

export function PivotToggle({ value, onChange }: { readonly value: GridView; readonly onChange: (view: GridView) => void }) {
  return (
    <span className="nqt-psp-toggle">
      <span className="param-label" aria-hidden="true">{PIVOT.viewLabel}</span>
      <ToggleGroup label={PIVOT.viewLabel} options={VIEWS} value={value} onChange={(v) => onChange(v as GridView)} />
    </span>
  )
}
