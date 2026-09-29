import { describe, expect, it } from 'vitest'
import { snapshotOf } from './recordWatch'
import { OOS_TRACKED, WATCH_SOURCES, WATCH_VERSION, emptyDiff, isWatchSnapshot, type WatchSnapshot } from './recordWatch.schema'

const GOOD: WatchSnapshot = {
  version: 1,
  takenAt: 1_790_000_000_000,
  sources: {
    registry: { count: 1, records: { a_v0: { p: 0.05, verdict: 'FAIL', registered: true, control_p: null } } },
    runs: { count: 0, records: {} },
  },
}

describe('constants', () => {
  it('pins the version, the gate log window and the source list', () => {
    expect(WATCH_VERSION).toBe(1)
    expect(OOS_TRACKED).toBe(2000)
    expect(WATCH_SOURCES).toEqual(['registry', 'confirmations', 'openings', 'ledger', 'oos', 'runs'])
  })

  it('emptyDiff has no items and keeps the since time', () => {
    expect(emptyDiff(7)).toEqual({ since: 7, appended: [], updated: [], changed: [] })
  })
})

describe('isWatchSnapshot: a strict check of what comes back from storage', () => {
  it('accepts a snapshot from snapshotOf, with every source', () => {
    const snapshot = snapshotOf(
      {
        registry: { rows: [{ name: 'a_v0', p: 0.1, verdict: 'FAIL', spec: 'a_v0', spec_sha256: 'ab', n: 10, control_p: null, registered: true, amendments: 0 }] },
        confirmations: [{ name: 'c', spec: 's', spec_sha256: null, parent: null, alpha: 0.05, p: 0.2, verdict: 'FAIL', n: 5, opening_closed: true }],
        openings: { openings: [{ opened: '2026-09-26' }] },
        ledger: { rows: [{ run_id: 'r1', ts_utc: null, pnl_total: 1, n_trades: 2, t_net_r: null, fees_total: 0, exp_id: null, matches_result: true }] },
        oos: { entries: [{ line_no: 3, caller: 'terminal' }], total: 3 },
        runs: [{ run_id: 'r1', created_utc: '2026-09-26', pnl_total: 1, n_trades: 2 }],
      },
      1_790_000_000_000,
    )
    expect(Object.keys(snapshot.sources).sort()).toEqual([...WATCH_SOURCES].sort())
    expect(isWatchSnapshot(snapshot)).toBe(true)
    expect(isWatchSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true)
  })

  it('accepts a snapshot with no sources', () => {
    expect(isWatchSnapshot({ version: 1, takenAt: 0, sources: {} })).toBe(true)
    expect(isWatchSnapshot(GOOD)).toBe(true)
  })

  const bad: ReadonlyArray<readonly [string, unknown]> = [
    ['a wrong version', { ...GOOD, version: 2 }],
    ['an unknown source', { ...GOOD, sources: { ...GOOD.sources, sealed: { count: 0, records: {} } } }],
    ['a negative count', { ...GOOD, sources: { runs: { count: -1, records: {} } } }],
    ['a nested object value', { ...GOOD, sources: { runs: { count: 1, records: { r1: { nested: { a: 1 } } } } } }],
    ['array records', { ...GOOD, sources: { runs: { count: 1, records: [{ a: 1 }] } } }],
    ['a NaN takenAt', { ...GOOD, takenAt: Number.NaN }],
    ['an extra top level key', { ...GOOD, extra: true }],
    ['a string count', { ...GOOD, sources: { runs: { count: '1', records: {} } } }],
  ]
  it.each(bad)('rejects %s', (_name, value) => {
    expect(isWatchSnapshot(value)).toBe(false)
  })

  const also: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a string', 'snapshot'],
    ['an array', []],
    ['a missing sources key', { version: 1, takenAt: 1 }],
    ['an infinite takenAt', { ...GOOD, takenAt: Number.POSITIVE_INFINITY }],
    ['a fractional count', { ...GOOD, sources: { runs: { count: 1.5, records: {} } } }],
    ['an extra key inside a source', { ...GOOD, sources: { runs: { count: 0, records: {}, more: 1 } } }],
    ['a record that is not an object', { ...GOOD, sources: { runs: { count: 1, records: { r1: 5 } } } }],
    ['an array record', { ...GOOD, sources: { runs: { count: 1, records: { r1: [1] } } } }],
    ['a non finite number value', { ...GOOD, sources: { runs: { count: 1, records: { r1: { a: Number.POSITIVE_INFINITY } } } } }],
    ['an undefined value', { ...GOOD, sources: { runs: { count: 1, records: { r1: { a: undefined } } } } }],
    ['a source that is not an object', { ...GOOD, sources: { runs: 3 } }],
  ]
  it.each(also)('also rejects %s', (_name, value) => {
    expect(isWatchSnapshot(value)).toBe(false)
  })

  it.each([
    ['a takenAt of 1e20, beyond the range of a Date', 1e20],
    ['a negative takenAt', -1],
    ['a fractional takenAt', 1.5],
    ['a takenAt one past the largest time a Date holds', 8.64e15 + 1],
  ])('rejects %s', (_name, takenAt) => {
    expect(isWatchSnapshot({ ...GOOD, takenAt })).toBe(false)
  })

  it.each([
    ['a takenAt of 0', 0],
    ['the largest time a Date holds', 8.64e15],
  ])('accepts %s', (_name, takenAt) => {
    expect(isWatchSnapshot({ ...GOOD, takenAt })).toBe(true)
  })

  it('rejects a __proto__ record key from stored JSON', () => {
    const parsed: unknown = JSON.parse('{"version":1,"takenAt":1,"sources":{"runs":{"count":1,"records":{"__proto__":{"a":1}}}}}')
    expect(isWatchSnapshot(parsed)).toBe(false)
  })
})
