// The CSV of a MonitorGrid as the screen shows it: its columns in order under their headers, one line
// per shown row; a number column keeps the value the grid sorts by (full precision), any other column
// the text the cell shows.
import { describe, expect, it } from 'vitest'
import type { MonitorColumn } from './MonitorGrid'
import { gridCsv } from './gridCsv'

interface Row {
  readonly name: string
  readonly pnl: number | null
  readonly ok: boolean | null
}

const COLUMNS: MonitorColumn<Row>[] = [
  { id: 'name', header: 'Run id', width: 100, kind: 'name', value: (r) => r.name },
  { id: 'pnl', header: 'Net P&L (USD)', width: 90, kind: 'num', value: (r) => r.pnl, format: (r) => (r.pnl === null ? '--' : r.pnl.toFixed(2)) },
  { id: 'ok', header: 'Balance', width: 60, kind: 'text', value: (r) => (r.ok ? 'OK' : 'FAIL'), format: (r) => (r.ok === null ? '--' : r.ok ? '[OK]' : '[FAIL]') },
]

describe('gridCsv', () => {
  it('writes the headers, then each row: numbers at full precision, text as shown, a missing value empty', () => {
    const rows: Row[] = [
      { name: 'nt_a', pnl: 1234.5678, ok: true },
      { name: 'nt,b', pnl: null, ok: null },
    ]
    expect(gridCsv(COLUMNS, rows)).toBe(['Run id,Net P&L (USD),Balance', 'nt_a,1234.5678,[OK]', '"nt,b",,'].join('\r\n'))
  })

  it('writes only the header for no rows', () => {
    expect(gridCsv(COLUMNS, [])).toBe('Run id,Net P&L (USD),Balance')
  })
})
