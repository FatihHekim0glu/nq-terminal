// The run records of the demo (RUN_DETAILS) are built from captured data only. This test reads the fixture run
// folders the fixture backend serves (backend/tests/fixtures/backtests/output/<run>/result.json, as text), applies the
// backend's own reading of them (RunService.detail: everything but trades, fills and the strategy log; the
// sanitiser turns NaN into null and gives a Decimal string a <key>_float twin), and requires the demo's record
// to be exactly that. A number typed by hand, or a field the source does not hold, fails here.
import { describe, expect, it } from 'vitest'
import volmanagedResult from '../../../../backend/tests/fixtures/backtests/output/nt_volmanaged_v0_fixture_m1/result.json?raw'
import smokeResult from '../../../../backend/tests/fixtures/backtests/output/smoke_2015_01/result.json?raw'
import { RUNS, RUN_DETAILS } from './runs'

/** The fixture run folders' result.json, as text. */
const RESULT_FILES: Readonly<Record<string, string>> = {
  nt_volmanaged_v0_fixture_m1: volmanagedResult,
  smoke_2015_01: smokeResult,
}
const LOG_SECTIONS = ['decisions', 'closes', 'notes', 'rolls', 'snapshots']
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/
/** The sanitiser turns an int inside the nanosecond window into an ISO string; this reader does not, so it refuses to guess. */
const NS_FLOOR = 946_684_800 * 1e9

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** result.json as Python wrote it: bare NaN tokens (smoke_2015_01 has them in its empty blocks) are read as null. */
function readResult(runId: string): Record<string, Json> {
  const text = RESULT_FILES[runId]!
  expect(text, 'a NaN inside a string would be rewritten too').not.toMatch(/"[^"\n]*NaN[^"\n]*"/)
  return JSON.parse(text.replace(/\bNaN\b/g, 'null')) as Record<string, Json>
}

/** files.sanitise for the parts of a head this test reads: no NaN, and a <key>_float twin for a Decimal string. */
function sanitise(value: Json): Json {
  if (Array.isArray(value)) return value.map(sanitise)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value)) out[key] = sanitise(item)
    for (const [key, item] of Object.entries(value)) {
      const twin = `${key}_float`
      if (typeof item === 'string' && DECIMAL.test(item) && Number.isFinite(Number(item)) && !(twin in value)) out[twin] = Number(item)
    }
    return out
  }
  if (typeof value === 'number') {
    expect(Math.abs(value), 'a nanosecond timestamp needs the full sanitiser').toBeLessThan(NS_FLOOR)
    return Number.isFinite(value) ? value : null
  }
  return value
}

const object = (value: Json | undefined): Record<string, Json> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {})

const TEAR_RUNS = ['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01'] as const

describe.each(TEAR_RUNS)('%s: the demo record is the fixture run folder, read as the backend reads it', (id) => {
  const source = readResult(id)
  const detail = RUN_DETAILS.get(id)!

  it('holds a record', () => {
    expect(detail).toBeDefined()
  })

  it('carries the config, data, venue, summary and balance check of result.json unchanged', () => {
    expect(detail.config).toEqual(sanitise(source['config']!))
    expect(detail.data).toEqual(sanitise(source['data']!))
    expect(detail.venue).toEqual(sanitise(source['venue']!))
    expect(detail.summary_stats).toEqual(sanitise(source['summary']!))
    expect(detail.balance_check).toEqual(sanitise(source['balance_check']!))
  })

  it('carries the coverage check and the skipped list only when the file has them, else null', () => {
    const coverage = source['coverage_check']
    const skipped = source['strategy_skipped']
    expect(detail.coverage_check).toEqual(coverage === undefined ? null : sanitise(coverage))
    expect(detail.strategy_skipped).toEqual(Array.isArray(skipped) ? sanitise(skipped) : null)
  })

  it('counts the trades and fills of the file, the log sections it holds, and its log metadata', () => {
    const log = object(source['strategy_log'])
    const sections = Object.fromEntries(Object.entries(log).filter(([key, item]) => LOG_SECTIONS.includes(key) && Array.isArray(item)).map(([key, item]) => [key, (item as Json[]).length]))
    const meta = Object.fromEntries(Object.entries(log).filter(([key]) => !LOG_SECTIONS.includes(key)))
    expect(detail.counts).toEqual({ trades: (source['trades'] as Json[]).length, fills: Array.isArray(source['fills']) ? source['fills'].length : 0 })
    expect(detail.log_sections).toEqual(sections)
    expect(detail.log_meta).toEqual(sanitise(meta))
  })

  it('has a summary that is the run list row, whose totals are the file totals', () => {
    expect(detail.summary).toBe(RUNS.find((r) => r.run_id === id))
    expect(detail.summary.run_id).toBe(source['run_id'])
    expect(detail.summary.n_trades).toBe(source['n_trades'])
    expect(detail.summary.pnl_total).toBe(source['pnl_total'])
    expect(detail.summary.fees_total).toBe(source['fees_total'])
    expect(detail.summary.created_utc).toBe(source['created_utc'])
  })

  it('offers the copy command the backend builds for a usable run that is in no ledger, and runs nothing', () => {
    expect(detail.summary.ledger).toBeNull()
    expect(detail.anchor).toBeNull()
    expect(detail.run_log_file).toBe(false)
    expect(detail.ledger_command).toMatchObject({ eligible: true, reasons: [], exp_id: null, exp_id_source: 'placeholder' })
    expect(detail.ledger_command.command).toContain(`backtests\\output\\${id}\\result.json --exp-id <exp>`)
  })

  it('leaves out what has no source: no invented balance-check or coverage field', () => {
    expect(Object.keys(detail.balance_check).sort()).toEqual(Object.keys(sanitise(source['balance_check']!) as object).sort())
    if (source['coverage_check'] === undefined) expect(detail.coverage_check).toBeNull()
  })
})
