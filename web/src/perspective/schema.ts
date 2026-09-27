// Column schema for the Perspective viewer (TASKS 9.1): a table is created from a declared schema, then
// filled with one array per column, so the engine never guesses a type from the first rows. A value that
// does not fit its declared type (NaN, Infinity, a string in a number column) goes in as null: the grid
// shows a gap, never a coerced number. Pure; no engine code is imported here.

export type PspType = 'string' | 'float' | 'integer' | 'boolean' | 'date' | 'datetime'

export type PspValue = string | number | boolean | null

export interface PspColumn<Row> {
  /** The column name as the viewer shows it (from src/copy). */
  readonly name: string
  readonly type: PspType
  /** The API value; dates and datetimes as epoch milliseconds. */
  readonly value: (row: Row) => unknown
}

export type PspSchema = Readonly<Record<string, PspType>>
export type PspColumnar = Readonly<Record<string, PspValue[]>>

export function toSchema<Row>(columns: readonly PspColumn<Row>[]): PspSchema {
  const schema: Record<string, PspType> = {}
  for (const column of columns) {
    if (column.name in schema) throw new Error(`Two Perspective columns are named ${column.name}`)
    schema[column.name] = column.type
  }
  return schema
}

const NUMERIC: ReadonlySet<PspType> = new Set(['float', 'integer', 'date', 'datetime'])

function fit(type: PspType, value: unknown): PspValue {
  if (value === null || value === undefined) return null
  if (NUMERIC.has(type)) return typeof value === 'number' && Number.isFinite(value) ? value : null
  if (type === 'boolean') return typeof value === 'boolean' ? value : null
  return typeof value === 'string' ? value : null
}

export function toColumnar<Row>(rows: readonly Row[], columns: readonly PspColumn<Row>[]): PspColumnar {
  toSchema(columns)
  const out: Record<string, PspValue[]> = {}
  for (const column of columns) out[column.name] = rows.map((row) => fit(column.type, column.value(row)))
  return out
}
