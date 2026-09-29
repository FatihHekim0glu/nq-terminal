// The power table under SV3 on MT (ANALYTICS_CATALOG SV9): the smallest annual Sharpe ratio each registered test
// can detect, and its power at a fixed reference Sharpe, per trial. [POST HOC], computed in the browser from the
// served Deflated Sharpe view (n, P, annual Sharpe) and the served family (alpha, k). A plain table on purpose: no
// grid, no numbered item (MT owns 1 to 21), no verdict and no alert. Reads no GET of its own: the family is the one
// MT already holds.
import { useMemo, type ReactNode } from 'react'
import { useMultipleTesting } from '../../api/queries'
import { POWER } from '../../copy/power'
import { fillCopy } from '../../copy/workspace'
import { POWER_TAG, powerCells, powerHeaders, powerSummary, powerView, type PowerCol, type PowerView } from './powerModel'
import type { DeflatedView } from './deflatedModel'
import './reg.css'

const NUMERIC: readonly PowerCol[] = ['periods', 'n', 'years', 'sharpe', 'mdeNominal', 'mdeFamily', 'ratio', 'powerNominal', 'powerFamily']
const HEADERS = powerHeaders()

/** The Sharpe cell's tone: up above zero, down below, none at zero or when missing. */
function tone(sharpe: number | null): string {
  if (sharpe === null || sharpe === 0) return 'num'
  return ['num', sharpe > 0 ? 'up' : 'down'].join(' ')
}

/** The table alone, over a computed power view: one row per registered trial, in the served order. */
export function PowerTable({ power }: { readonly power: PowerView }) {
  return (
    <table className="nqt-grid mt-deflated-table">
      <caption className="reg-caption">{POWER.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{HEADERS.name}</th>
          {NUMERIC.map((col) => <th key={col} scope="col" className="num">{HEADERS[col]}</th>)}
        </tr>
      </thead>
      <tbody>
        {power.rows.map((row) => {
          const cells = powerCells(row)
          return (
            <tr key={row.name} data-kind={row.kind}>
              <th scope="row" className="name">{cells.name}</th>
              {NUMERIC.map((col) => <td key={col} className={col === 'sharpe' ? tone(row.sharpe) : 'num'}>{cells[col]}</td>)}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function PowerSection({ children }: { readonly children: ReactNode }) {
  return (
    <section className="reg-confirm mt-power" aria-label={POWER.label}>
      <p className="reg-band">
        <span className="reg-band-title">{POWER.title}</span>{' '}
        <span className="reg-warn">{POWER_TAG}</span>{' '}
        <span className="reg-muted">{POWER.basis}</span>
      </p>
      {children}
    </section>
  )
}

export default function PowerPanel({ view }: { readonly view: DeflatedView }) {
  const family = useMultipleTesting()
  const power = useMemo(
    () => (family.data ? powerView(view, { alpha: family.data.alpha, k: family.data.k }) : null),
    [view, family.data],
  )
  if (family.isError) {
    return (
      <PowerSection>
        <p className="reg-msg">{fillCopy(POWER.unavailable, { detail: family.error.detail })}</p>
      </PowerSection>
    )
  }
  if (!power) return null
  return (
    <PowerSection>
      <p className="reg-msg">{powerSummary(power)}</p>
      <p className="reg-msg">{POWER.approx}</p>
      <p className="reg-msg reg-muted">{POWER.computed}</p>
      <PowerTable power={power} />
    </PowerSection>
  )
}
