// Tests for forkModel.ts (roadmap #4 DES robustness, slice 2 of 3).
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import type { Schemas } from '../../api/types'
import type { Analytics } from '../tear/tearKpis'
import { VOLMANAGED } from './desTestData'
import {
  FORK_NUMBER_START,
  MAX_FORK_RUNS,
  forkLadders,
  forkPoint,
  forkRows,
  forkSpecs,
  type ForkPoint,
  type ForkSpec,
} from './forkModel'

type RunSummary = Schemas['RunSummary']

const CARD = VOLMANAGED.card

function run(id: string, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: id,
    readable: true,
    error: null,
    strategy: 's',
    params: {},
    variant: 'repaired',
    start: null,
    end: null,
    created_utc: null,
    elapsed_s: null,
    nautilus_trader: null,
    kind: null,
    n_trades: null,
    pnl_total: null,
    fees_total: null,
    hit_rate: null,
    mean_net_r: null,
    t_net_r: null,
    t_pnl_usd: null,
    balance_ok: true,
    mtm_ok: null,
    coverage_ok: null,
    usable: true,
    is_probe: false,
    is_anchor: false,
    anchor_of: null,
    ledger: null,
    sidecars: [],
    ...overrides,
  }
}

describe('forkSpecs', () => {
  it('specs a screen fork per recorded cost (0, 1, 2 ticks), the default cost registered', () => {
    const { specs } = forkSpecs(CARD, [run('nt_volmanaged_v0_fixture_m1')])
    const screenSpecs = specs.filter((s) => s.engine === 'screen')
    expect(screenSpecs.map((s) => s.cost)).toEqual([0, 1, 2])
    expect(screenSpecs.map((s) => s.registered)).toEqual([false, true, false])
    expect(screenSpecs.every((s) => s.basis === 'A' && s.freq === null && s.name === CARD.name)).toBe(true)
  })

  it('specs a daily and a monthly run fork (Basis B) for a usable linked run, carrying its flags', () => {
    const { specs, skipped } = forkSpecs(CARD, [run('nt_volmanaged_v0_fixture_m1', { is_probe: true, is_anchor: true })])
    const runSpecs = specs.filter((s) => s.engine === 'run')
    expect(runSpecs.map((s) => s.freq)).toEqual(['D', 'M'])
    expect(runSpecs.every((s) => s.basis === 'B' && s.name === 'nt_volmanaged_v0_fixture_m1' && !s.registered)).toBe(true)
    expect(runSpecs.every((s) => s.flags.includes('[PROBE: never a result]') && s.flags.includes('[ANCHOR]'))).toBe(true)
    expect(skipped).toEqual([])
  })

  it('skips a run whose balance check failed as unusable, drawing nothing for it', () => {
    const { specs, skipped } = forkSpecs(CARD, [run('nt_volmanaged_v0_fixture_m1', { balance_ok: false })])
    expect(specs.filter((s) => s.engine === 'run')).toEqual([])
    expect(skipped).toEqual([{ run: 'nt_volmanaged_v0_fixture_m1', reason: 'unusable' }])
  })

  it('skips a linked run not present in the runs list as unlisted, once runs have loaded', () => {
    const { specs, skipped } = forkSpecs(CARD, [])
    expect(specs.filter((s) => s.engine === 'run')).toEqual([])
    expect(skipped).toEqual([{ run: 'nt_volmanaged_v0_fixture_m1', reason: 'unlisted' }])
  })

  it('skips and specs nothing for runs while /api/runs has not answered (runs undefined)', () => {
    const { specs, skipped } = forkSpecs(CARD, undefined)
    expect(specs.filter((s) => s.engine === 'run')).toEqual([])
    expect(skipped).toEqual([])
  })

  it('caps at MAX_FORK_RUNS listed runs, marking the rest capped', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `r${i}`)
    const card = { ...CARD, nautilus_runs: eight }
    const runs = eight.map((id) => run(id))
    const { specs, skipped } = forkSpecs(card, runs)
    expect(specs.filter((s) => s.engine === 'run')).toHaveLength(MAX_FORK_RUNS * 2)
    expect(skipped).toEqual([
      { run: 'r6', reason: 'capped' },
      { run: 'r7', reason: 'capped' },
    ])
  })

  it('caps by listed position, not by raw index: an unlisted run ahead of six listed ones forks all six', () => {
    const card = { ...CARD, nautilus_runs: ['gone', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5'] }
    const runs = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].map((id) => run(id))
    const { specs, skipped } = forkSpecs(card, runs)
    expect(specs.filter((s) => s.engine === 'run')).toHaveLength(12)
    expect(skipped).toEqual([{ run: 'gone', reason: 'unlisted' }])
  })
})

describe('forkPoint', () => {
  const spec: ForkSpec = { id: 'x', engine: 'screen', name: 'volmanaged_v0', cost: 1, freq: null, basis: 'A', registered: true, flags: [] }
  const analytics = {
    ci: { sharpe: 1.5, lo: 0.5, hi: 2.5, unit: 'ratio, annualised (P = 252)', basis: 'A', z: 1.96, periods_per_year: 252 },
    n: 39,
    tag: '[POST HOC]',
  } as unknown as Analytics

  it('copies the analytics Sharpe interval exactly: nothing computed', () => {
    expect(forkPoint(spec, analytics, null)).toEqual({
      spec, sharpe: 1.5, lo: 0.5, hi: 2.5, n: 39, tag: '[POST HOC]', unit: 'ratio, annualised (P = 252)', error: null,
    })
  })

  it('is all null with no analytics yet (pending)', () => {
    expect(forkPoint(spec, undefined, null)).toEqual({
      spec, sharpe: null, lo: null, hi: null, n: null, tag: null, unit: null, error: null,
    })
  })

  it('carries the error and no value on a failed fetch (404: not available)', () => {
    const error = new ApiError({ kind: 'http', path: '/api/analytics/hypothesis/x', status: 404, detail: 'unknown hypothesis: x' })
    const point = forkPoint(spec, undefined, error)
    expect(point.error).toBe(error)
    expect(point.sharpe).toBeNull()
  })
})

const screenSpec = (cost: number, registered: boolean): ForkSpec => (
  { id: `s${cost}`, engine: 'screen', name: 'volmanaged_v0', cost, freq: null, basis: 'A', registered, flags: [] }
)
const runSpec = (freq: 'D' | 'M', registered = false): ForkSpec => (
  { id: `r-${freq}`, engine: 'run', name: 'nt_x', cost: null, freq, basis: 'B', registered, flags: [] }
)
function point(spec: ForkSpec, sharpe: number | null, error: ApiError | null = null): ForkPoint {
  return { spec, sharpe, lo: sharpe === null ? null : sharpe - 1, hi: sharpe === null ? null : sharpe + 1, n: 10, tag: '[POST HOC]', unit: 'ratio', error }
}

describe('forkLadders', () => {
  it('never mixes Basis A and Basis B on one ladder', () => {
    const points = [point(screenSpec(0, false), 1), point(screenSpec(1, true), 2), point(runSpec('D'), 0.5), point(runSpec('M'), 1.5)]
    const { screen, runs } = forkLadders(points, { screen: 'Screen forks', runs: 'Run forks' })
    expect(screen?.bars).toHaveLength(2)
    expect(runs?.bars).toHaveLength(2)
  })

  it('sorts each ladder ascending by Sharpe and emphasises the registered fork', () => {
    const points = [point(screenSpec(0, false), 2), point(screenSpec(1, true), 1)]
    const { screen } = forkLadders(points, { screen: 'Screen forks', runs: 'Run forks' })
    expect(screen?.bars.map((b) => b.value)).toEqual([1, 2])
    expect(screen?.bars.find((b) => b.value === 1)?.emphasis).toBe(true)
    expect(screen?.bars.find((b) => b.value === 2)?.emphasis).toBeUndefined()
  })

  it('carries the confidence whiskers from lo and hi', () => {
    const points = [point(screenSpec(0, false), 1)]
    const { screen } = forkLadders(points, { screen: 'Screen forks', runs: 'Run forks' })
    expect(screen?.bars[0]).toMatchObject({ lo: 0, hi: 2 })
  })

  it('draws no bar for an errored fork', () => {
    const err = new ApiError({ kind: 'http', path: '/x', status: 404, detail: 'gone' })
    const points = [point(screenSpec(0, false), 1), point(screenSpec(1, true), null, err)]
    const { screen } = forkLadders(points, { screen: 'Screen forks', runs: 'Run forks' })
    expect(screen?.bars).toHaveLength(1)
  })

  it('is null (no ladder) when every point of that basis is errored', () => {
    const err = new ApiError({ kind: 'http', path: '/x', status: 404, detail: 'gone' })
    const points = [point(screenSpec(0, false), null, err)]
    const { screen, runs } = forkLadders(points, { screen: 'Screen forks', runs: 'Run forks' })
    expect(screen).toBeNull()
    expect(runs).toBeNull()
  })
})

describe('forkRows', () => {
  it('numbers rows from FORK_NUMBER_START (the Number <GO> for each row)', () => {
    const spec: ForkSpec = { id: 'x', engine: 'screen', name: 'volmanaged_v0', cost: 1, freq: null, basis: 'A', registered: true, flags: [] }
    const rows = forkRows([forkPoint(spec, undefined, null), forkPoint(spec, undefined, null)])
    expect(rows.map((r) => r.no)).toEqual([FORK_NUMBER_START, FORK_NUMBER_START + 1])
  })

  it('states the error detail of a failed fork', () => {
    const spec: ForkSpec = { id: 'x', engine: 'run', name: 'nt_x', cost: null, freq: 'D', basis: 'B', registered: false, flags: [] }
    const error = new ApiError({ kind: 'http', path: '/api/analytics/run/nt_x', status: 404, detail: 'unknown run: nt_x' })
    const rows = forkRows([forkPoint(spec, undefined, error)])
    expect(rows[0]?.state).toBe('unknown run: nt_x')
    expect(rows[0]?.run).toBe('nt_x')
  })
})
