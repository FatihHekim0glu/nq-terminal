// The accessible equivalent of a pivot view (TASKS 9.1; WCAG 1.3.1, 4.1.2): the Perspective viewer draws its
// grid in a shadow tree that axe leaves out and no screen reader has been run over, so every pivot view also
// offers this plain table of the same rows, in the house MonitorGrid. It shows what the pivot grid opens with
// (the dataset's preset): an ungrouped preset gives every row in the preset's columns and sort; a grouped
// preset gives a total row, then one row per group, each column under its aggregate (named in the header).
// Worked out here from the rows in hand, with no engine, so the table works when Perspective cannot start.
// Pure; formatting follows the pivot's own: datetimes in UTC, dates as ISO days.
import { PIVOT } from '../copy/perspective'
import type { Dataset } from './datasets'
import type { PspColumn, PspType } from './schema'

export type SortCell = string | number | null

export interface PivotTableColumn {
  /** The dataset column name (the key into each row's cells). */
  readonly key: string
  /** The header: the column name, and in a grouped table its aggregate. */
  readonly header: string
  readonly numeric: boolean
}

export interface PivotTableRow {
  readonly id: string
  /** The MonitorGrid section: the total, or the groups (a grouped table only). */
  readonly section: string
  readonly value: Readonly<Record<string, SortCell>>
  readonly text: Readonly<Record<string, string>>
}

export interface PivotTableModel {
  readonly grouped: boolean
  /** The group column's name when grouped. */
  readonly groupBy: string | null
  readonly columns: readonly PivotTableColumn[]
  readonly rows: readonly PivotTableRow[]
}

type Aggregate = 'count' | 'sum' | 'high' | 'distinct count'

const AGGREGATES: ReadonlySet<string> = new Set<Aggregate>(['count', 'sum', 'high', 'distinct count'])
const NUMERIC: ReadonlySet<PspType> = new Set(['float', 'integer'])
const MISSING = '--'
const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4, useGrouping: true })

/** The text of one value of a column type: UTC datetimes, ISO days, grouped numbers, Yes or No. */
export function cellText(type: PspType, value: unknown): string {
  if (value === null || value === undefined || value === '') return MISSING
  if (type === 'datetime' || type === 'date') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return MISSING
    const iso = new Date(value).toISOString()
    return type === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  }
  if (typeof value === 'number') return Number.isFinite(value) ? NUMBER.format(value) : MISSING
  if (typeof value === 'boolean') return value ? PIVOT.table.yes : PIVOT.table.no
  return String(value)
}

/** A value as the column sorts it: numbers and epoch times as numbers, the rest as text. */
function sortValue(type: PspType, value: unknown): SortCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (type === 'boolean') return value ? 1 : 0
  return String(value)
}

/** Perspective's default aggregate: sum for numbers, count for everything else. */
function aggregateOf<Row>(dataset: Dataset<Row>, column: PspColumn<Row>): Aggregate {
  const named = dataset.preset.aggregates?.[column.name]
  if (named === undefined) return NUMERIC.has(column.type) ? 'sum' : 'count'
  if (!AGGREGATES.has(named)) throw new Error(`No table rule for the pivot aggregate "${named}" on ${column.name}`)
  return named as Aggregate
}

function aggregate(kind: Aggregate, values: readonly unknown[]): number | null {
  const present = values.filter((v) => v !== null && v !== undefined && !(typeof v === 'number' && !Number.isFinite(v)))
  if (kind === 'count') return present.length
  if (kind === 'distinct count') return new Set(present.map((v) => String(v))).size
  const numbers = present.filter((v): v is number => typeof v === 'number')
  if (numbers.length === 0) return null
  return kind === 'sum' ? numbers.reduce((a, b) => a + b, 0) : Math.max(...numbers)
}

function aggregateLabel(kind: Aggregate, type: PspType): string {
  const A = PIVOT.table.aggregates
  if (kind === 'high') return type === 'datetime' || type === 'date' ? A.latest : A.highest
  return kind === 'sum' ? A.sum : kind === 'count' ? A.count : A.distinct
}

function byName<Row>(dataset: Dataset<Row>, name: string): PspColumn<Row> {
  const column = dataset.columns.find((c) => c.name === name)
  if (!column) throw new Error(`The pivot preset names a column the dataset lacks: ${name}`)
  return column
}

function compare(a: SortCell, b: SortCell): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en')
}

function sortedRows<Row>(dataset: Dataset<Row>, rows: readonly Row[]): Row[] {
  const [first] = dataset.preset.sort ?? []
  if (!first) return [...rows]
  const column = byName(dataset, first[0])
  const sign = first[1] === 'desc' ? -1 : 1
  const keyed = rows.map((row, i) => ({ row, i, v: sortValue(column.type, column.value(row)) }))
  // Missing values last in both directions; ties keep the API order.
  keyed.sort((a, b) => (a.v === null || b.v === null ? compare(a.v, b.v) : sign * compare(a.v, b.v)) || a.i - b.i)
  return keyed.map((k) => k.row)
}

function flatTable<Row>(dataset: Dataset<Row>, rows: readonly Row[]): PivotTableModel {
  const shown = dataset.preset.columns.map((name) => byName(dataset, name))
  const columns = shown.map((c) => ({ key: c.name, header: c.name, numeric: NUMERIC.has(c.type) }))
  const out = sortedRows(dataset, rows).map((row, i) => ({
    id: String(i),
    section: '',
    value: Object.fromEntries(shown.map((c) => [c.name, sortValue(c.type, c.value(row))])),
    text: Object.fromEntries(shown.map((c) => [c.name, cellText(c.type, c.value(row))])),
  }))
  return { grouped: false, groupBy: null, columns, rows: out }
}

function groupedTable<Row>(dataset: Dataset<Row>, rows: readonly Row[], groupName: string): PivotTableModel {
  const group = byName(dataset, groupName)
  const shown = dataset.preset.columns.map((name) => ({ column: byName(dataset, name), kind: aggregateOf(dataset, byName(dataset, name)) }))
  const columns: PivotTableColumn[] = [
    { key: group.name, header: group.name, numeric: false },
    ...shown.map(({ column, kind }) => ({ key: column.name, header: `${column.name} (${aggregateLabel(kind, column.type)})`, numeric: kind !== 'high' || NUMERIC.has(column.type) })),
  ]
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const raw = group.value(row)
    const key = raw === null || raw === undefined || raw === '' ? PIVOT.table.noValue : String(raw)
    const members = groups.get(key)
    if (members) members.push(row)
    else groups.set(key, [row])
  }
  const summary = (id: string, section: string, label: string, members: readonly Row[]): PivotTableRow => {
    const value: Record<string, SortCell> = { [group.name]: label }
    const text: Record<string, string> = { [group.name]: label }
    for (const { column, kind } of shown) {
      const v = aggregate(kind, members.map((m) => column.value(m)))
      value[column.name] = v
      text[column.name] = kind === 'high' ? cellText(column.type, v) : cellText(kind === 'sum' ? column.type : 'integer', v)
    }
    return { id, section, value, text }
  }
  const names = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'en'))
  const out = [
    summary('total', PIVOT.table.totalSection, PIVOT.table.total, rows),
    ...names.map((name) => summary(`g:${name}`, PIVOT.table.groupSection, name, groups.get(name) ?? [])),
  ]
  return { grouped: true, groupBy: group.name, columns, rows: out }
}

/** The pivot grid's opening layout of `rows` as a plain table (see the header). */
export function pivotTable<Row>(dataset: Dataset<Row>, rows: readonly Row[]): PivotTableModel {
  const [groupName] = dataset.preset.group_by ?? []
  return groupName ? groupedTable(dataset, rows, groupName) : flatTable(dataset, rows)
}
