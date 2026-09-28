// KpiTile (TASKS 5.4, UI_SPEC sections 6 and 8, look spec 7.1): one key figure on a --raised card,
// muted label over a white value, with its [PRE-REG] or [POST HOC] tag. The tile is a disclosure
// button: its popover always states the basis (A screen, B account) and the unit, plus the
// description and any note on a missing value. Escape or a pointer press outside closes it. The value
// never animates (UI_SPEC principle 4).
import { Children, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Schemas } from '../api/types'
import { KPI } from '../copy/tiles'
import { fillCopy } from '../copy/workspace'
import { ROVING_ATTR } from '../chrome/WorkspaceFocus'
import './tiles.css'

export type Kpi = Schemas['Kpi']

export interface KpiTileProps {
  readonly kpi: Kpi
  /** Fixed decimals for the value (default 2). */
  readonly decimals?: number
  /** Changes and returns carry an explicit `+`. */
  readonly signed?: boolean
  /** What the figure is and how it is computed, shown in the popover. */
  readonly description?: string
  /** A confidence interval shown beside the value, e.g. Sharpe [CI]. */
  readonly ci?: readonly [number, number] | null
  /** The API's full unit for the popover's "Unit: ..." line (G08); `kpi.unit` alone, already shortened
   * for the tile face, would print a bare '%' for '% per year' and nothing at all for a unitless ratio
   * such as a t statistic. Defaults to `kpi.unit` when not given. */
  readonly unit?: string
}

const MISSING = '--'
/** Units shown on the face; `%` attaches to the value and these say nothing a label does not. */
const UNITLESS: ReadonlySet<string> = new Set(['', 'ratio', 'x', 'probability', 'count'])
const roving = { [ROVING_ATTR]: '' }

function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

/** The value as the tile prints it: fixed decimals, `%` attached, `+` on signed positives. */
export function formatKpi(value: number | null, unit: string, decimals: number, signed: boolean): string {
  if (value === null || !Number.isFinite(value)) return MISSING
  const text = fixed(value, decimals)
  const plus = signed && Number(text) > 0 ? '+' : ''
  const [whole = '', frac] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${plus}${frac === undefined ? grouped : `${grouped}.${frac}`}${unit === '%' ? '%' : ''}`
}

/** Basis A reads two ways (G08): [PRE-REG] means the screen recorded the value; [POST HOC] means the
 * terminal computed it from the screen's series. Basis B is always the Nautilus account. */
function basisText(kpi: Kpi): string {
  if (kpi.basis !== 'A') return KPI.basisB
  return kpi.tag === '[POST HOC]' ? KPI.basisAComputed : KPI.basisA
}

function Popover({ id, kpi, description, unit }: { readonly id: string; readonly kpi: Kpi; readonly description?: string; readonly unit: string }) {
  return (
    <div id={id} className="kpi-pop">
      <p className="kpi-pop-title">{kpi.label}</p>
      {description ? <p>{description}</p> : null}
      <p className="kpi-pop-basis">{basisText(kpi)}</p>
      <p>{fillCopy(KPI.unit, { unit })}</p>
      {kpi.note ? <p>{fillCopy(KPI.note, { note: kpi.note })}</p> : null}
    </div>
  )
}

/** Closes the popover on a pointer press outside `root`. */
function useOutsidePress(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, root, close])
}

export default function KpiTile({ kpi, decimals = 2, signed = false, description, ci, unit }: KpiTileProps) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(() => setOpen(false)).current
  useOutsidePress(open, root, close)
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
  }
  const showUnit = kpi.unit !== '%' && !UNITLESS.has(kpi.unit)
  const ciText = ci ? { lo: fixed(ci[0], decimals), hi: fixed(ci[1], decimals) } : null
  return (
    <div className="kpi" ref={root}>
      <button
        type="button"
        className="kpi-tile"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-description={KPI.detailsHint}
        onClick={() => setOpen(!open)}
        onKeyDown={onKeyDown}
        {...roving}
      >
        <span className="kpi-label">{kpi.label}</span>
        <span className="kpi-line">
          <span className="kpi-value">{formatKpi(kpi.value, kpi.unit, decimals, signed)}</span>
          {showUnit ? <span className="kpi-unit">{kpi.unit}</span> : null}
          {ciText ? <span className="kpi-ci" aria-label={fillCopy(KPI.ciLabel, ciText)}>{fillCopy(KPI.ci, ciText)}</span> : null}
        </span>
        <span className="kpi-tag">{kpi.tag}</span>
      </button>
      {open ? <Popover id={popId} kpi={kpi} description={description} unit={unit ?? kpi.unit} /> : null}
    </div>
  )
}

/** A row of KPI tiles with 8px black gutters, as a labelled list. */
export function KpiRow({ label = KPI.rowLabel, children }: { readonly label?: string; readonly children: ReactNode }) {
  return (
    <ul className="kpi-row" aria-label={label}>
      {Children.toArray(children).map((child, i) => (
        <li key={i}>{child}</li>
      ))}
    </ul>
  )
}
