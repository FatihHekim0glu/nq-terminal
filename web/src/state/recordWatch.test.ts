import { describe, expect, it } from 'vitest'
import { diffWatch, extendCheckpoint, mergeAccepted, snapshotOf } from './recordWatch'
import { OOS_TRACKED, type WatchInputs, type WatchSnapshot } from './recordWatch.schema'

const T0 = Date.UTC(2026, 8, 20, 14, 0)
const T1 = T0 + 3_600_000

type RegRow = NonNullable<WatchInputs['registry']>['rows'][number]
type ConfRow = NonNullable<WatchInputs['confirmations']>[number]
type LedgerRow = NonNullable<WatchInputs['ledger']>['rows'][number]
type RunRow = NonNullable<WatchInputs['runs']>[number]

const reg = (name: string, over: Partial<RegRow> = {}): RegRow => ({
  name, p: 0.05, verdict: 'FAIL', spec: name, spec_sha256: 'aa11', n: 100, control_p: null, registered: true, amendments: 0, ...over,
})
const conf = (name: string, over: Partial<ConfRow> = {}): ConfRow => ({
  name, spec: `${name}.json`, spec_sha256: 'bb22', parent: 'a_v0', alpha: 0.05, p: 0.3, verdict: 'FAIL', n: 54, opening_closed: true, ...over,
})
const ledgerRow = (run_id: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
  run_id, ts_utc: '2026-09-26T10:00:00Z', pnl_total: 100, n_trades: 5, t_net_r: 1.5, fees_total: 9, exp_id: 'e1', matches_result: true, ...over,
})
const run = (run_id: string, over: Partial<RunRow> = {}): RunRow => ({ run_id, created_utc: '2026-09-26T10:00:00Z', pnl_total: 100, n_trades: 5, ...over })

/** The gate log, oldest first like the API: lines from..to inclusive. */
const oosLines = (from: number, to: number, tag = ''): { line_no: number; caller: string }[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ line_no: from + i, caller: `terminal${tag}` }))

const inputs = (over: WatchInputs = {}): WatchInputs => ({
  registry: { rows: [reg('a_v0'), reg('volmanaged_v0', { p: 0.12 })] },
  confirmations: [conf('rebal_v1_confirm')],
  openings: { openings: [{ opened: '2026-09-26', by: 'user' }] },
  ledger: { rows: [ledgerRow('r1'), ledgerRow('r2')] },
  oos: { entries: oosLines(1, 10), total: 10 },
  runs: [run('r1'), run('r2')],
  ...over,
})

const snap = (over: WatchInputs = {}, at = T0): WatchSnapshot => snapshotOf(inputs(over), at)

describe('snapshotOf: what is kept of each source', () => {
  it('keys registry rows by name and leaves out holm_p, bh_q and family_k, which move when the family grows', () => {
    const s = snap()
    expect(s.sources.registry?.count).toBe(2)
    expect(s.sources.registry?.records.volmanaged_v0).toEqual({
      p: 0.12, verdict: 'FAIL', spec: 'volmanaged_v0', spec_sha256: 'aa11', n: 100, control_p: null, registered: true, amendments: 0,
    })
    // A full API row carries the family figures too; only the followed fields may be kept.
    const fullRow = { ...reg('x'), holm_p: 0.5, bh_q: 0.2, family_k: 21 }
    const withExtras = snapshotOf({ registry: { rows: [fullRow] } }, T0)
    expect(Object.keys(withExtras.sources.registry?.records.x ?? {})).not.toContain('holm_p')
    expect(Object.keys(withExtras.sources.registry?.records.x ?? {})).not.toContain('bh_q')
    expect(Object.keys(withExtras.sources.registry?.records.x ?? {})).not.toContain('family_k')
  })

  it('keeps the confirmation, ledger and run fields, with the keys of the brief', () => {
    const s = snap({ ledger: { rows: [ledgerRow('r1'), ledgerRow('r9', { ts_utc: null })] } })
    expect(s.sources.confirmations?.records.rebal_v1_confirm).toEqual({
      spec: 'rebal_v1_confirm.json', spec_sha256: 'bb22', parent: 'a_v0', alpha: 0.05, p: 0.3, verdict: 'FAIL', n: 54, opening_closed: true,
    })
    expect(Object.keys(s.sources.ledger?.records ?? {})).toEqual(['r1@2026-09-26T10:00:00Z', 'r9@'])
    expect(s.sources.ledger?.records['r1@2026-09-26T10:00:00Z']).toEqual({
      pnl_total: 100, n_trades: 5, t_net_r: 1.5, fees_total: 9, exp_id: 'e1', matches_result: true,
    })
    expect(s.sources.runs?.records.r1).toEqual({ created_utc: '2026-09-26T10:00:00Z', pnl_total: 100, n_trades: 5 })
  })

  it('keys openings by position and keeps a digest of the entry, the same for any key order', () => {
    const a = snap({ openings: { openings: [{ opened: 'x', by: 'y' }] } }).sources.openings
    const b = snap({ openings: { openings: [{ by: 'y', opened: 'x' }] } }).sources.openings
    expect(Object.keys(a?.records ?? {})).toEqual(['#0'])
    expect(a?.records['#0']).toEqual({ digest: expect.stringMatching(/^[0-9a-f]{8}$/), closed: false })
    expect(b).toEqual(a)
    expect(a?.count).toBe(1)
  })

  it('keeps the newest 2000 gate log lines by line number and counts the whole log', () => {
    const s = snap({ oos: { entries: oosLines(1, 2500), total: 2500 } }).sources.oos
    expect(s?.count).toBe(2500)
    const keys = Object.keys(s?.records ?? {}).map(Number)
    expect(keys).toHaveLength(OOS_TRACKED)
    expect(Math.min(...keys)).toBe(501)
    expect(Math.max(...keys)).toBe(2500)
    expect(s?.records['2500']).toEqual({ digest: expect.stringMatching(/^[0-9a-f]{8}$/) })
  })

  it('takes the newest lines whatever order the entries arrive in', () => {
    const newestFirst = [...oosLines(1, 2100)].reverse()
    const s = snap({ oos: { entries: newestFirst, total: 2100 } }).sources.oos
    expect(Math.min(...Object.keys(s?.records ?? {}).map(Number))).toBe(101)
  })

  it('leaves out a source that was not read, and stamps the time', () => {
    const s = snapshotOf({ runs: [run('r1')] }, T0)
    expect(Object.keys(s.sources)).toEqual(['runs'])
    expect(s.takenAt).toBe(T0)
    expect(s.version).toBe(1)
  })

  it('turns a non finite number into null so the snapshot stays valid JSON', () => {
    const s = snapshotOf({ runs: [run('r1', { pnl_total: Number.NaN })] }, T0)
    expect(s.sources.runs?.records.r1?.pnl_total).toBeNull()
  })

  it('does not lose a record called __proto__', () => {
    const s = snapshotOf({ runs: [run('__proto__')] }, T0)
    expect(Object.keys(s.sources.runs?.records ?? {})).toEqual(['__proto__'])
  })
})

describe('diffWatch', () => {
  it('is empty for two identical snapshots, and keeps the since time', () => {
    expect(diffWatch(snap({}, T0), snap({}, T1))).toEqual({ since: T0, appended: [], updated: [], changed: [] })
  })

  it('lists an appended run', () => {
    const after = snap({ runs: [run('r1'), run('r2'), run('r3')] }, T1)
    const diff = diffWatch(snap({}, T0), after)
    expect(diff.appended).toEqual([{ source: 'runs', key: 'r3', kind: 'appended', field: '', before: null, after: null, line: 'r3 RUN' }])
    expect(diff.updated).toEqual([])
    expect(diff.changed).toEqual([])
  })

  it('reports a rewritten registry p as changed, with the DES line', () => {
    const after = snap({ registry: { rows: [reg('a_v0'), reg('volmanaged_v0', { p: 0.2 })] } }, T1)
    expect(diffWatch(snap(), after)).toMatchObject({
      appended: [],
      updated: [],
      changed: [{ source: 'registry', key: 'volmanaged_v0', kind: 'changed', field: 'p', before: 0.12, after: 0.2, line: 'volmanaged_v0 DES' }],
    })
  })

  it('reports every frozen registry field that differs', () => {
    const rewritten = { ...reg('a_v0', { verdict: 'PASS', spec: 's2', spec_sha256: 'cc', n: 101, control_p: 0.4, registered: false }), family_k: 22 }
    const diff = diffWatch(snap(), snap({ registry: { rows: [rewritten, reg('volmanaged_v0', { p: 0.12 })] } }, T1))
    // family_k is rewritten too (22), and is not in the list: the watch ignores it.
    expect(diff.changed.map((i) => i.field).sort()).toEqual(['control_p', 'n', 'registered', 'spec', 'spec_sha256', 'verdict'])
    expect(diff.updated).toEqual([])
  })

  it('treats one more registered hypothesis as one appended row, not a rewrite of every row', () => {
    const before = snap()
    // The lab rewrites family_k on every registered row when a hypothesis is added.
    const grown = [{ ...reg('a_v0'), family_k: 22 }, { ...reg('volmanaged_v0', { p: 0.12 }), family_k: 22 }, { ...reg('c_v0'), family_k: 22 }]
    const after = snapshotOf({ ...inputs(), registry: { rows: grown } }, T1)
    const diff = diffWatch(before, after)
    expect(diff.changed).toEqual([])
    expect(diff.updated).toEqual([])
    expect(diff.appended).toEqual([{ source: 'registry', key: 'c_v0', kind: 'appended', field: '', before: null, after: null, line: 'c_v0 DES' }])
  })

  it('reports closing an opening as an update, not a rewrite', () => {
    const before = snap({ openings: { openings: [{ caller: 'rebal_v1_confirm', spec: 's.json' }] } })
    const after = snap({ openings: { openings: [{ caller: 'rebal_v1_confirm', spec: 's.json', closed: true, closed_utc: '2026-09-26T11:15:20Z' }] } }, T1)
    const diff = diffWatch(before, after)
    expect(diff.changed).toEqual([])
    expect(diff.updated).toEqual([{ source: 'openings', key: '#0', kind: 'updated', field: 'closed', before: false, after: true, line: 'OOS' }])
  })

  it('keeps a gate log line digest when the API adds derived or empty fields', () => {
    const before = snap()
    const after = snap({
      oos: {
        entries: oosLines(1, 10).map((e) => ({
          ...e, key_set: 'k', is_sealed: false, past_fence: false, ts_epoch_s: 1, start_epoch_s: 2, end_epoch_s: 3, severity: 3, alert: true, schema: null,
        })),
        total: 10,
      },
    }, T1)
    expect(diffWatch(before, after)).toEqual({ since: T0, appended: [], updated: [], changed: [] })
  })

  it('reports a moved amendments count as updated, not changed', () => {
    const after = snap({ registry: { rows: [reg('a_v0', { amendments: 1 }), reg('volmanaged_v0', { p: 0.12 })] } }, T1)
    const diff = diffWatch(snap(), after)
    expect(diff.changed).toEqual([])
    expect(diff.updated).toEqual([{ source: 'registry', key: 'a_v0', kind: 'updated', field: 'amendments', before: 0, after: 1, line: 'a_v0 DES' }])
  })

  it('splits a confirmation into updated tracked fields and changed frozen ones', () => {
    const after = snap({ confirmations: [conf('rebal_v1_confirm', { p: 0.01, verdict: 'PASS', n: 60, opening_closed: false, spec_sha256: 'zz', alpha: 0.1, parent: null })] }, T1)
    const diff = diffWatch(snap(), after)
    expect(diff.updated.map((i) => i.field).sort()).toEqual(['n', 'opening_closed', 'p', 'verdict'])
    expect(diff.changed.map((i) => i.field).sort()).toEqual(['alpha', 'parent', 'spec_sha256'])
    expect(diff.updated.every((i) => i.line === 'rebal_v1_confirm DES')).toBe(true)
  })

  it('reports a removed ledger row and points at its run', () => {
    const after = snap({ ledger: { rows: [ledgerRow('r1')] } }, T1)
    expect(diffWatch(snap(), after).changed).toEqual([
      { source: 'ledger', key: 'r2@2026-09-26T10:00:00Z', kind: 'removed', field: '', before: null, after: null, line: 'r2 RUN' },
    ])
  })

  it('reports a rewritten ledger figure as changed and a new ledger row as appended', () => {
    const after = snap({ ledger: { rows: [ledgerRow('r1', { pnl_total: 101 }), ledgerRow('r2'), ledgerRow('r3')] } }, T1)
    const diff = diffWatch(snap(), after)
    expect(diff.changed).toEqual([{ source: 'ledger', key: 'r1@2026-09-26T10:00:00Z', kind: 'changed', field: 'pnl_total', before: 100, after: 101, line: 'r1 RUN' }])
    expect(diff.appended).toMatchObject([{ source: 'ledger', key: 'r3@2026-09-26T10:00:00Z', line: 'r3 RUN' }])
  })

  it('reports a rewritten run figure as changed', () => {
    const after = snap({ runs: [run('r1', { n_trades: 6 }), run('r2')] }, T1)
    expect(diffWatch(snap(), after).changed).toMatchObject([{ source: 'runs', key: 'r1', field: 'n_trades', before: 5, after: 6, line: 'r1 RUN' }])
  })

  it('reports one shortened item when the gate log has fewer lines than before', () => {
    const after = snap({ oos: { entries: oosLines(1, 8), total: 8 } }, T1)
    const diff = diffWatch(snap(), after)
    const shortened = diff.changed.filter((i) => i.kind === 'shortened')
    expect(shortened).toEqual([{ source: 'oos', key: '', kind: 'shortened', field: 'total', before: 10, after: 8, line: 'OOS' }])
    // The two lines that vanished are listed too, as removed.
    expect(diff.changed.filter((i) => i.kind === 'removed').map((i) => i.key)).toEqual(['9', '10'])
  })

  it('reports a rewritten gate log line by its digest', () => {
    const rewritten = oosLines(1, 10).map((e) => (e.line_no === 4 ? { ...e, caller: 'someone_else' } : e))
    const diff = diffWatch(snap(), snap({ oos: { entries: rewritten, total: 10 } }, T1))
    expect(diff.changed).toMatchObject([{ source: 'oos', key: '4', kind: 'changed', field: 'digest', line: 'OOS' }])
    expect(diff.appended).toEqual([])
  })

  it('reports an opening entry that was rewritten', () => {
    const diff = diffWatch(snap(), snap({ openings: { openings: [{ opened: '2026-09-27', by: 'user' }] } }, T1))
    expect(diff.changed).toMatchObject([{ source: 'openings', key: '#0', kind: 'changed', field: 'digest', line: 'OOS' }])
  })

  it('does not compare lines below the smallest current line number: they left the window', () => {
    const before = snap({ oos: { entries: oosLines(1, 2000), total: 2000 } }, T0)
    const after = snap({ oos: { entries: oosLines(1, 2500), total: 2500 } }, T1)
    const diff = diffWatch(before, after)
    // Lines 1 to 500 fell out of the newest 2000; that is not a rewrite.
    expect(diff.changed).toEqual([])
    expect(diff.appended.map((i) => i.key)).toHaveLength(500)
    expect(diff.appended[0]?.key).toBe('2001')
    expect(diff.appended.at(-1)?.key).toBe('2500')
  })

  it('still reports a line inside the window that disappeared', () => {
    const before = snap({ oos: { entries: oosLines(1, 3000), total: 3000 } }, T0)
    const gap = oosLines(1, 3000).filter((e) => e.line_no !== 2500)
    const diff = diffWatch(before, snap({ oos: { entries: gap, total: 2999 } }, T1))
    expect(diff.changed.map((i) => `${i.kind}:${i.key}`)).toContain('removed:2500')
  })

  it('does not call lines below the previous window appended', () => {
    const before = snap({ oos: { entries: oosLines(501, 2500), total: 2500 } }, T0)
    // The log was rewritten shorter: its window now starts lower than the old one did.
    const after = snap({ oos: { entries: oosLines(101, 2100), total: 2100 } }, T1)
    expect(diffWatch(before, after).appended).toEqual([])
  })

  it('lists appended lines when the checkpoint had an empty gate log', () => {
    const before = snap({ oos: { entries: [], total: 0 } }, T0)
    const after = snap({ oos: { entries: oosLines(1, 3), total: 3 } }, T1)
    expect(diffWatch(before, after).appended.map((i) => i.key)).toEqual(['1', '2', '3'])
  })

  it('ignores a source that is on one side only', () => {
    const before = snapshotOf({ registry: inputs().registry, ledger: inputs().ledger }, T0)
    const after = snapshotOf({ registry: inputs().registry, runs: [run('brand_new')] }, T1)
    expect(diffWatch(before, after)).toEqual({ since: T0, appended: [], updated: [], changed: [] })
  })

  it('compares only fields that both records hold', () => {
    const before = snap()
    const trimmed = JSON.parse(JSON.stringify(before)) as { sources: { runs: { records: { r1: Record<string, unknown> } } } }
    delete trimmed.sources.runs.records.r1.n_trades
    expect(diffWatch(trimmed as unknown as WatchSnapshot, snap({}, T1)).changed).toEqual([])
  })

  it('sorts items by source in the sequence of the watch, then by key', () => {
    const after = snap({
      runs: [run('r1'), run('r2'), run('r10'), run('r3')],
      registry: { rows: [reg('a_v0'), reg('volmanaged_v0', { p: 0.12 }), reg('zeta_v0'), reg('alpha_v0')] },
      confirmations: [conf('rebal_v1_confirm'), conf('b_confirm')],
    }, T1)
    const diff = diffWatch(snap(), after)
    expect(diff.appended.map((i) => `${i.source}:${i.key}`)).toEqual([
      'registry:alpha_v0', 'registry:zeta_v0', 'confirmations:b_confirm', 'runs:r3', 'runs:r10',
    ])
  })

  it('does not mutate its inputs', () => {
    const before = snap()
    const after = snap({ runs: [run('r1'), run('r9')] }, T1)
    const frozen = JSON.stringify([before, after])
    diffWatch(before, after)
    expect(JSON.stringify([before, after])).toBe(frozen)
  })
})

describe('extendCheckpoint: baseline a source the checkpoint has not seen yet', () => {
  it('is null when the checkpoint already holds every source that was read', () => {
    expect(extendCheckpoint(snap(), snap({}, T1))).toBeNull()
  })

  it('adds a missing source from the current read, and keeps the rest and the time', () => {
    const before = snapshotOf({ registry: inputs().registry }, T0)
    const after = snapshotOf({ registry: { rows: [reg('changed_row')] }, runs: [run('r1')] }, T1)
    const extended = extendCheckpoint(before, after)
    expect(extended).not.toBeNull()
    expect(extended?.takenAt).toBe(T0)
    expect(extended?.sources.registry).toEqual(before.sources.registry)
    expect(extended?.sources.runs).toEqual(after.sources.runs)
  })

  it('adds nothing for a source that was not read this time', () => {
    const before = snapshotOf({ registry: inputs().registry }, T0)
    expect(extendCheckpoint(before, snapshotOf({}, T1))).toBeNull()
  })

  it('does not touch the checkpoint it was given', () => {
    const before = snapshotOf({ registry: inputs().registry }, T0)
    const copy = JSON.stringify(before)
    extendCheckpoint(before, snap({}, T1))
    expect(JSON.stringify(before)).toBe(copy)
  })
})

describe('mergeAccepted: mark what was read as seen', () => {
  it('takes the current read for every source in it, and its time', () => {
    const before = snap({}, T0)
    const after = snap({ runs: [run('r1'), run('r9')] }, T1)
    const merged = mergeAccepted(before, after)
    expect(merged.takenAt).toBe(T1)
    expect(merged.sources.runs).toEqual(after.sources.runs)
    expect(diffWatch(merged, after)).toEqual({ since: T1, appended: [], updated: [], changed: [] })
  })

  it('keeps the checkpoint of a source that could not be read this time', () => {
    const before = snap({}, T0)
    const after = snapshotOf({ runs: [run('r9')] }, T1)
    const merged = mergeAccepted(before, after)
    expect(merged.sources.registry).toEqual(before.sources.registry)
    expect(merged.sources.ledger).toEqual(before.sources.ledger)
    expect(merged.sources.runs).toEqual(after.sources.runs)
  })

  it('is just the current read when there is no checkpoint', () => {
    const after = snap({}, T1)
    expect(mergeAccepted(null, after)).toEqual(after)
  })
})
