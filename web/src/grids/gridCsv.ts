// A MonitorGrid's shown rows as CSV (98) Export): the columns in their order under their headers. A
// number column writes the value it sorts by, at the precision the API sent; every other column writes
// the text its cell shows. A missing value (`--` on screen) is an empty field.
import type { RowData } from '@tanstack/react-table'
import { toCsv, type CsvValue } from '../chrome/exportCsv'
import { cellText, type MonitorColumn } from './MonitorGrid'

const MISSING = '--'

function cell<Row extends RowData>(col: MonitorColumn<Row>, row: Row): CsvValue {
  const value = col.value(row)
  if (col.kind === 'num' && typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = cellText(col, row)
  return text === MISSING ? null : text
}

export function gridCsv<Row extends RowData>(columns: readonly MonitorColumn<Row>[], rows: readonly Row[]): string {
  return toCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((col) => cell(col, row))),
  )
}
