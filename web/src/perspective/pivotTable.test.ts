import { describe, expect, it } from 'vitest'
import { PIVOT } from '../copy/perspective'
import { DATASETS, type FillRow, type LedgerRow, type OosEntry } from './datasets'
import { pivotTable } from './pivotTable'

const fill = (i: number, px: number | null): FillRow => ({
  ts: `2012-01-0${i}T14:30:00.000000000Z`, ts_epoch_s: Date.UTC(2012, 0, i, 14, 30) / 1000, instrument: 'NQ.XCME', side: 'BUY',
  qty: 2, px, commission: '1.5000', commission_float: 1.5, position_id: `P-${i}`, order_id: `O-${i}`, tags: 'REBAL',
}) as FillRow

const ledger = (run: string, strategy: string | null, trades: number, pnl: number | null, balance: string | null, ts: string): LedgerRow => ({
  ts_utc: ts, run_id: run, exp_id: null, strategy, start: '2012-01-02', end: '2021-12-31', n_trades: trades, pnl_total: pnl,
  fees_total: 1, hit_rate: null, mean_net_r: null, t_net_r: null, balance_check: balance, matches_result: true, runtime_s: 3,
}) as unknown as LedgerRow

const oos = (line: number, caller: string, ts: number, symbol: string, severity: number): OosEntry => ({
  line_no: line, caller, ts_epoch_s: ts, ts_utc: null, reason: 'r', symbol, timeframe: '1m', variant: 'vendor', start_epoch_s: null,
  end_epoch_s: null, rows: 10, severity, is_sealed: false, alert: false,
}) as unknown as OosEntry

describe('pivotTable: the pivot grid opening layout as a plain table', () => {
  it('an ungrouped dataset: every row, the preset columns in order, the preset sort, times in UTC', () => {
    const t = pivotTable(DATASETS.fills, [fill(2, 101.25), fill(4, null), fill(3, 99.5)])
    expect(t.grouped).toBe(false)
    expect(t.columns.map((c) => c.header)).toEqual(DATASETS.fills.preset.columns)
    expect(t.rows).toHaveLength(3)
    const ts = PIVOT.fills.ts
    // Newest first, as the preset sorts, and the datetime printed in UTC whatever the browser zone.
    expect(t.rows.map((r) => r.text[ts])).toEqual(['2012-01-04 14:30:00', '2012-01-03 14:30:00', '2012-01-02 14:30:00'])
    expect(t.rows[0]!.text[PIVOT.fills.px]).toBe('--')
    expect(t.rows[1]!.text[PIVOT.fills.px]).toBe('99.5')
    expect(t.rows[1]!.value[PIVOT.fills.px]).toBe(99.5)
  })

  it('a grouped dataset: a total row, then one row per group with the preset aggregates named in the header', () => {
    const rows = [
      ledger('a1', 'za', 10, 100.5, 'PASS', '2026-09-01T10:00:00Z'),
      ledger('a2', 'za', 5, -20.25, null, '2026-09-02T10:00:00Z'),
      ledger('b1', 'eom', 7, null, 'FAIL', '2026-09-03T10:00:00Z'),
    ]
    const t = pivotTable(DATASETS.ledger, rows)
    const L = PIVOT.ledger
    expect(t.grouped).toBe(true)
    expect(t.columns.map((c) => c.header)).toEqual([L.strategy, `${L.runId} (count)`, `${L.trades} (sum)`, `${L.pnl} (sum)`, `${L.fees} (sum)`, `${L.balance} (count)`])
    expect(t.rows.map((r) => [r.section, r.text[L.strategy]])).toEqual([
      [PIVOT.table.totalSection, PIVOT.table.total],
      [PIVOT.table.groupSection, 'eom'],
      [PIVOT.table.groupSection, 'za'],
    ])
    const [total, eom, za] = t.rows
    expect(total!.value[L.runId]).toBe(3)
    expect(total!.value[L.trades]).toBe(22)
    expect(total!.value[L.pnl]).toBeCloseTo(80.25, 12)
    expect(total!.value[L.balance]).toBe(2) // count of values present
    expect(za!.text[L.pnl]).toBe('80.25')
    expect(eom!.text[L.pnl]).toBe('--') // a sum over no values is missing, not zero
  })

  it('the OOS log: count, latest time (UTC), distinct count and highest severity per caller', () => {
    const t = pivotTable(DATASETS.oos, [
      oos(1, 'terminal', Date.UTC(2026, 6, 1, 12) / 1000, 'NQ', 0),
      oos(2, 'terminal', Date.UTC(2026, 6, 3, 12) / 1000, 'ES', 2),
      oos(3, 'terminal', Date.UTC(2026, 6, 2, 12) / 1000, 'NQ', 1),
      oos(4, 'research', Date.UTC(2026, 5, 1, 9) / 1000, 'NQ', 0),
    ])
    const O = PIVOT.oos
    const terminal = t.rows.find((r) => r.text[O.caller] === 'terminal')!
    expect(terminal.value[O.line]).toBe(3)
    expect(terminal.text[O.ts]).toBe('2026-07-03 12:00:00')
    expect(terminal.value[O.symbol]).toBe(2)
    expect(terminal.value[O.severity]).toBe(2)
    expect(t.columns.map((c) => c.header)).toContain(`${O.ts} (latest)`)
  })

  it('a missing group key is shown as its own group, never dropped', () => {
    const t = pivotTable(DATASETS.ledger, [ledger('a1', null, 1, 1, 'PASS', '2026-09-01T10:00:00Z')])
    expect(t.rows.map((r) => r.text[PIVOT.ledger.strategy])).toEqual([PIVOT.table.total, PIVOT.table.noValue])
  })

  it('born failing: every preset aggregate has a rule here, so no column falls back silently', () => {
    for (const d of Object.values(DATASETS)) expect(() => pivotTable(d as never, [])).not.toThrow()
    const bad = { ...DATASETS.ledger, preset: { ...DATASETS.ledger.preset, aggregates: { [PIVOT.ledger.trades]: 'weighted mean' } } }
    expect(() => pivotTable(bad, [])).toThrow(/weighted mean/)
  })
})
