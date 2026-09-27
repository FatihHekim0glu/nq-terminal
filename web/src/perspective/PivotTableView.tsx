// The accessible table of a pivot view (pivotTable.ts): the pivot grid's opening layout of the same rows in the
// house MonitorGrid, so the keys, the focus ring, the active-cell announcements and the axe coverage are the
// grid's own. A polite status names what it holds; a note says how it is laid out.
import { useMemo } from 'react'
import { PIVOT } from '../copy/perspective'
import { fillCopy } from '../copy/workspace'
import MonitorGrid, { type MonitorColumn } from '../grids/MonitorGrid'
import type { Dataset } from './datasets'
import { pivotTable, type PivotTableModel, type PivotTableRow } from './pivotTable'

const TEXT_WIDTH = 150
const NUM_WIDTH = 120

function gridColumns(model: PivotTableModel): MonitorColumn<PivotTableRow>[] {
  return model.columns.map((c, i) => ({
    id: `c${i}`,
    header: c.header,
    width: c.numeric ? NUM_WIDTH : TEXT_WIDTH,
    kind: i === 0 ? 'name' : c.numeric ? 'num' : 'text',
    value: (r) => r.value[c.key] ?? null,
    format: (r) => r.text[c.key] ?? '--',
  }))
}

const rowId = (r: PivotTableRow) => r.id
const sectionOf = (r: PivotTableRow) => r.section

export interface PivotTableViewProps<Row> {
  readonly name: string
  readonly dataset: Dataset<Row>
  readonly rows: readonly Row[]
}

export default function PivotTableView<Row>({ name, dataset, rows }: PivotTableViewProps<Row>) {
  const model = useMemo(() => pivotTable(dataset, rows), [dataset, rows])
  const columns = useMemo(() => gridColumns(model), [model])
  const count = rows.length.toLocaleString('en-GB')
  const note = model.grouped ? fillCopy(PIVOT.table.groupedNote, { group: (model.groupBy ?? '').toLowerCase() }) : PIVOT.table.flatNote
  return (
    <div className="nqt-pivot-table">
      <p className="nqt-psp-note">
        <span className="nqt-psp-tag">{PIVOT.tag}</span> {note}
      </p>
      <p className="nqt-psp-status" role="status">{fillCopy(PIVOT.table.ready, { name, rows: count })}</p>
      <MonitorGrid
        label={fillCopy(PIVOT.table.label, { name, rows: count })}
        rows={model.rows}
        columns={columns}
        rowId={rowId}
        groupOf={model.grouped ? sectionOf : undefined}
        numbered={false}
      />
    </div>
  )
}
