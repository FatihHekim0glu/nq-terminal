// A DES ladder as a numbered table (TASKS 9.4): `N)` in muted text, the rung or block label in amber and
// the value right-aligned, exactly as the DES ladder's own table view prints it (ladder.ts).
import type { LadderRow } from './ladder'
import '../../grids/grid.css'

export interface LadderTableProps {
  readonly caption: string
  readonly columns: { readonly n: string; readonly label: string; readonly value: string }
  readonly rows: readonly LadderRow[]
  readonly testId: string
}

export default function LadderTable({ caption, columns, rows, testId }: LadderTableProps) {
  return (
    <div className="nqt-grid-scroll">
      <table className="nqt-grid books-table" data-testid={testId}>
        <caption className="books-note">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num books-no">{columns.n}</th>
            <th scope="col">{columns.label}</th>
            <th scope="col" className="num">{columns.value}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="num muted books-no">{`${r.n})`}</td>
              <th scope="row" className="name">{r.label}</th>
              <td className="num" data-value={r.raw ?? ''}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
