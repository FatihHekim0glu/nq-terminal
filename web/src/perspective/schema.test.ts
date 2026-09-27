import { describe, expect, it } from 'vitest'
import { toColumnar, toSchema, type PspColumn } from './schema'

interface Row {
  readonly name: string | null
  readonly qty: number | null
  readonly ts: number | null
  readonly ok: boolean | null
}

const COLUMNS: readonly PspColumn<Row>[] = [
  { name: 'Name', type: 'string', value: (r) => r.name },
  { name: 'Qty', type: 'float', value: (r) => r.qty },
  { name: 'Time', type: 'datetime', value: (r) => (r.ts === null ? null : r.ts * 1000) },
  { name: 'Ok', type: 'boolean', value: (r) => r.ok },
]

describe('perspective schema (TASKS 9.1)', () => {
  it('declares every column with its type, in order', () => {
    expect(toSchema(COLUMNS)).toEqual({ Name: 'string', Qty: 'float', Time: 'datetime', Ok: 'boolean' })
    expect(Object.keys(toSchema(COLUMNS))).toEqual(['Name', 'Qty', 'Time', 'Ok'])
  })

  it('turns rows into one array per column, keeping nulls as nulls', () => {
    const rows: Row[] = [
      { name: 'a', qty: 1.5, ts: 10, ok: true },
      { name: null, qty: null, ts: null, ok: null },
    ]
    expect(toColumnar(rows, COLUMNS)).toEqual({ Name: ['a', null], Qty: [1.5, null], Time: [10_000, null], Ok: [true, null] })
  })

  it('drops values that do not fit the declared type instead of passing them to the engine', () => {
    const rows = [{ name: 'x', qty: Number.NaN, ts: Number.POSITIVE_INFINITY, ok: true }] as Row[]
    const cols = toColumnar(rows, COLUMNS)
    expect(cols['Qty']).toEqual([null])
    expect(cols['Time']).toEqual([null])
  })

  it('born failing: a string in a float column is refused, not coerced', () => {
    const bad: PspColumn<{ v: unknown }>[] = [{ name: 'V', type: 'float', value: (r) => r.v as number }]
    expect(toColumnar([{ v: '12' }], bad)).toEqual({ V: [null] })
  })

  it('refuses two columns with one name', () => {
    expect(() => toSchema([...COLUMNS, { name: 'Qty', type: 'integer', value: () => 1 }])).toThrow(/Qty/)
  })

  it('gives an empty array per column for no rows', () => {
    expect(toColumnar([], COLUMNS)).toEqual({ Name: [], Qty: [], Time: [], Ok: [] })
  })
})
