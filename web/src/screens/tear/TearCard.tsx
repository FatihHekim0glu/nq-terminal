// The DES-style card the tear sheet's lower sections share (look spec 7.3 card bands): the run books
// (RunBooks) and the P1 views (TearP1, RunTradePaths). A title band with the card's tag on the right, then
// its body; a pending or failed read says so inside the card; label and value rows are a real table.
import type { ReactNode } from 'react'
import { ROVING_ATTR, ROVING_SCROLL_ATTR } from '../../chrome/WorkspaceFocus'
import type { ApiError } from '../../api/client'
import { TEAR } from '../../copy/tear'
import { fillCopy } from '../../copy/workspace'

export function Card({ title, tag, className, children }: { readonly title: string; readonly tag?: string; readonly className?: string; readonly children: ReactNode }) {
  return (
    <div className={className ? `nqt-card tear-card ${className}` : 'nqt-card tear-card'}>
      <h3 className="nqt-card-title tear-card-title">
        {title}
        {tag ? <span className="tear-card-tag">{tag}</span> : null}
      </h3>
      <div className="tear-card-body">{children}</div>
    </div>
  )
}

/** A card's read still on its way, or the refusal it got (`failed` holds a {detail} slot). */
export function Pending({ error, failed, loading = TEAR.loadingBooks }: { readonly error: ApiError | null; readonly failed: string; readonly loading?: string }) {
  if (error) return <p className="tear-note" role="alert">{fillCopy(failed, { detail: error.detail })}</p>
  return <p className="tear-note" role="status" aria-busy="true">{loading}</p>
}

export interface Row {
  readonly id: string
  readonly label: string
  readonly value: string
}

/** Label and value rows as a table; the caption names it for assistive technology. */
export function Rows({ caption, rows, visibleCaption = false }: { readonly caption: string; readonly rows: readonly Row[]; readonly visibleCaption?: boolean }) {
  return (
    <table className="nqt-grid tear-kv">
      <caption className={visibleCaption ? 'tear-caption' : 'sr-only'}>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" className="name tear-rowhead">{r.label}</th>
            <td className="num tear-value">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const scrollBox = { [ROVING_ATTR]: '', [ROVING_SCROLL_ATTR]: '' }

/**
 * A wide table that may scroll sideways in a narrow panel: a named region holding a Tab stop inside the
 * panel's roving focus, so the keyboard reaches and scrolls it (WCAG 2.1.1; axe scrollable-region-focusable).
 */
export function ScrollRegion({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="nqt-grid-scroll tear-scroll" role="region" aria-label={label} tabIndex={0} {...scrollBox}>
      {children}
    </div>
  )
}

/** A chart id unique on the page, from a prefix and React's useId value. */
export function chartId(prefix: string, uid: string): string {
  return `${prefix}-${uid.replace(/[^A-Za-z0-9_-]/g, '')}`
}
