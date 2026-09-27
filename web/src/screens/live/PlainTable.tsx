// A plain, unvirtualised table in the grid style (grid.css: `nqt-grid`, name and num cells), for the
// short lists on LIVE (reconciliation rows, journals). It has no scroll box of its own: the panel body
// scrolls and is the panel's Tab stop, so there is no nested scroll region without a keyboard stop.
import type { ReactNode } from 'react'
import type { CellTone } from '../../grids/MonitorGrid'
import '../../grids/grid.css'

export interface PlainColumn<Row> {
  readonly id: string
  readonly header: string
  readonly width: number
  readonly kind: 'name' | 'num' | 'text'
  readonly text: (row: Row) => ReactNode
  readonly tone?: (row: Row) => CellTone | undefined
}

export interface PlainTableProps<Row> {
  /** Names the table (its caption, read by assistive technology). */
  readonly label: string
  readonly rows: readonly Row[]
  readonly columns: readonly PlainColumn<Row>[]
  readonly rowId: (row: Row) => string
  readonly rowClassName?: (row: Row) => string | undefined
  readonly emptyText: string
}

function cellClass<Row>(col: PlainColumn<Row>, row: Row): string | undefined {
  const parts = [col.kind === 'text' ? '' : col.kind, col.tone?.(row) ?? ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export default function PlainTable<Row>({ label, rows, columns, rowId, rowClassName, emptyText }: PlainTableProps<Row>) {
  const width = columns.reduce((sum, c) => sum + c.width, 0)
  return (
    <table className="nqt-grid live-table" aria-label={label} style={{ width: `${width}px` }}>
      <colgroup>
        {columns.map((c) => <col key={c.id} style={{ width: `${c.width}px` }} />)}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => <th key={c.id} scope="col" className={c.kind === 'num' ? 'num' : undefined}>{c.header}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={columns.length} className="muted">{emptyText}</td></tr>
        ) : (
          rows.map((row) => (
            <tr key={rowId(row)} className={rowClassName?.(row)}>
              {columns.map((c) => <td key={c.id} className={cellClass(c, row)}>{c.text(row)}</td>)}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
