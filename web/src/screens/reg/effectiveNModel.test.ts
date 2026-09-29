// MT 87) Effective trials, the model (ANALYTICS_CATALOG SV3b, roadmap #19 slice 2): computeEffectiveN refuses
// unless the browser formula reproduces the served SV3 view (SR0 to 1e-12, every dsr_null to 1e-9, every daily
// trial's n and per-session Sharpe), and only then draws a correlation matrix. The ok result is pinned to the golden
// panel of qa/crosscheck/p12_neff.py; each refusal comes from one tampering with an otherwise passing input.
import { describe, expect, it } from 'vitest'
import raw from '../../../../qa/golden/p12_neff.json?raw'
import { describeHeatmap, heatmapCells } from '../../charts/echarts/heatmapModel'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { fillCopy } from '../../copy/workspace'
import { CLUSTER_CUT } from '../../quant/cluster'
import { expectedMaxSr0, probabilisticSharpe } from '../../quant/trials'
import { DEFLATED_REAL } from './deflatedFixtures'
import { SYNTHETIC_MONTHLY, SYNTHETIC_VIEW, buildSyntheticView, syntheticPanel } from './effectiveN.fixtures'
import {
  ANCHOR_TOLERANCE_DSR,
  ANCHOR_TOLERANCE_SR0,
  DAILY_PERIODS,
  MIN_COMMON_SESSIONS,
  SERIES_TOLERANCE,
  TRIAL_COST,
  clustersText,
  computeEffectiveN,
  dailyTrialNames,
  dsrRows,
  effectiveNHeatmap,
  estimateRows,
  refusalText,
  windowText,
  type EffectiveNOk,
  type EffectiveNResult,
  type EffectiveNInput,
  type Refusal,
  type TrialSeries,
} from './effectiveNModel'

interface Golden {
  panel: { names: string[]; dates: string[]; columns: number[][] }
  correlation: number[][]
  eigenvalues: number[]
  participation_ratio: number
  li_ji: number
  clusters: number[][]
  cluster_cut: number
}
const GOLDEN = JSON.parse(raw) as Golden

const NONE: ReadonlyMap<string, string> = new Map()
const PANEL = syntheticPanel()
const BASE: EffectiveNInput = { view: SYNTHETIC_VIEW, series: PANEL, failed: NONE }

/** A series a test may edit in place. */
interface Mutable {
  name: string
  date: string[]
  r: (number | null)[]
}

function copyOf(series: readonly TrialSeries[]): Mutable[] {
  return series.map((s) => ({ name: s.name, date: [...s.date], r: [...s.r] }))
}

function goldenSeries(): TrialSeries[] {
  return GOLDEN.panel.names.map((name, i) => ({ name, date: GOLDEN.panel.dates, r: GOLDEN.panel.columns[i] as number[] }))
}

function ok(result: EffectiveNResult): EffectiveNOk {
  if (!result.ok) throw new Error(`expected an ok result, got ${result.refusal.kind}`)
  return result
}

function refusal(result: EffectiveNResult): Refusal {
  if (result.ok) throw new Error('expected a refusal')
  return result.refusal
}

/** Runs the formula over a tampered series panel whose served view is rebuilt from that same panel. */
function overSeries(series: readonly TrialSeries[]): EffectiveNResult {
  return computeEffectiveN({ view: buildSyntheticView(series, SYNTHETIC_MONTHLY), series, failed: NONE })
}

function withRows(edit: (rows: (typeof SYNTHETIC_VIEW)['rows']) => (typeof SYNTHETIC_VIEW)['rows']): EffectiveNInput {
  return { ...BASE, view: { ...SYNTHETIC_VIEW, rows: edit(SYNTHETIC_VIEW.rows) } }
}

function maxDifference(a: readonly number[], b: readonly number[]): number {
  expect(a).toHaveLength(b.length)
  return a.reduce((max, x, i) => Math.max(max, Math.abs(x - (b[i] as number))), 0)
}

describe('the pre-registered constants (SV3b)', () => {
  it('holds the values the catalogue records', () => {
    expect(CLUSTER_CUT).toBe(0.5)
    expect(TRIAL_COST).toBe(1)
    expect(DAILY_PERIODS).toBe(252)
    expect(MIN_COMMON_SESSIONS).toBe(252)
    expect(SERIES_TOLERANCE).toBe(1e-9)
    expect(ANCHOR_TOLERANCE_SR0).toBe(1e-12)
    expect(ANCHOR_TOLERANCE_DSR).toBe(1e-9)
  })
})

describe('dailyTrialNames', () => {
  it('lists the 15 rows with 252 periods a year, in the served order, and leaves the 6 monthly books out', () => {
    const names = dailyTrialNames(DEFLATED_REAL)
    expect(names).toHaveLength(15)
    expect(names[0]).toBe('za_v0')
    expect(names).toContain('volmanaged_v0')
    expect(names).not.toContain('tsmom_v0')
    expect(DEFLATED_REAL.rows.filter((r) => r.periods === 12)).toHaveLength(6)
    expect(names).toEqual(DEFLATED_REAL.rows.filter((r) => r.periods === 252).map((r) => r.name))
  })

  it('is empty for a view with no daily row', () => {
    expect(dailyTrialNames({ ...DEFLATED_REAL, rows: [] })).toEqual([])
  })
})

describe('computeEffectiveN: the ok result on the golden panel (qa/golden/p12_neff.json)', () => {
  const series = goldenSeries()
  const view = buildSyntheticView(series, SYNTHETIC_MONTHLY)
  const result = ok(computeEffectiveN({ view, series, failed: NONE }))
  const byId = (id: string) => result.estimates.find((e) => e.id === id)!

  it('reproduces the served numbers first: the synthetic view passes every anchor', () => {
    expect(view.n_trials).toBe(11)
    expect(result.daily).toEqual(GOLDEN.panel.names)
    expect(result.monthly).toEqual(SYNTHETIC_MONTHLY.map((m) => m.name))
  })

  it('has the golden correlation and eigenvalues to 1e-12', () => {
    for (let i = 0; i < 9; i += 1) {
      expect(maxDifference(result.correlation[i] as number[], GOLDEN.correlation[i] as number[]), `row ${i}`).toBeLessThanOrEqual(1e-12)
    }
    expect(maxDifference(result.eigenvalues, GOLDEN.eigenvalues)).toBeLessThanOrEqual(1e-12)
  })

  it('has the golden participation ratio and Li and Ji count as the daily N', () => {
    expect(Math.abs(byId('participation').nDaily - GOLDEN.participation_ratio)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(byId('liJi').nDaily - GOLDEN.li_ji)).toBeLessThanOrEqual(1e-12)
  })

  it('has the golden clusters at the cut of 0.5 on 1 - rho, and the cluster count as the daily N', () => {
    expect(GOLDEN.cluster_cut).toBe(0.5)
    expect(result.clusters).toEqual(GOLDEN.clusters)
    expect(byId('clusters').nDaily).toBe(GOLDEN.clusters.length)
  })

  it('counts the monthly books as independent trials: nTotal is the daily N plus 2', () => {
    for (const id of ['participation', 'liJi', 'clusters']) {
      const e = byId(id)
      expect(e.nTotal, id).toBeCloseTo(e.nDaily + 2, 12)
      expect(e.served, id).toBe(false)
    }
    expect(byId('clusters').nTotal).toBe(GOLDEN.clusters.length + 2)
  })

  it('keeps the served row as it is: 9 daily trials, N 11, the served SR0 under V0', () => {
    const served = byId('registered')
    expect(served).toMatchObject({ nDaily: 9, nTotal: 11, served: true, sr0Session: view.sr0_null_session })
    expect(served.sr0Annual).toBeCloseTo((view.sr0_null_session as number) * Math.sqrt(252), 12)
    expect(result.estimates.map((e) => e.id)).toEqual(['registered', 'participation', 'liJi', 'clusters'])
  })

  it('sets SR0 under the served V0 and gamma for each N, annual = session x sqrt(252)', () => {
    for (const e of result.estimates.filter((x) => !x.served)) {
      const want = expectedMaxSr0(view.variance_null as number, e.nTotal, view.euler_gamma) as number
      expect(e.sr0Session, e.id).toBe(want)
      expect(e.sr0Annual, e.id).toBeCloseTo(want * Math.sqrt(252), 12)
    }
    // fewer effective trials, a lower bar
    expect(byId('participation').sr0Session as number).toBeLessThan(byId('registered').sr0Session as number)
  })

  it('reports the common window: first and last date and the session count', () => {
    expect(result.window).toEqual({ from: GOLDEN.panel.dates[0], to: GOLDEN.panel.dates[399], sessions: 400 })
    expect(windowText(result)).toBe(fillCopy(EFFECTIVE_N.window, { from: GOLDEN.panel.dates[0] as string, to: GOLDEN.panel.dates[399] as string, sessions: 400 }))
  })

  it('gives every registered row its DSR under each N, the monthly books with SR0 moved to their period', () => {
    expect(result.dsr.map((d) => d.name)).toEqual(view.rows.map((r) => r.name))
    const daily = view.rows[0]!
    const monthly = view.rows[9]!
    expect(monthly.periods).toBe(12)
    for (const [row, entry] of [[daily, result.dsr[0]!], [monthly, result.dsr[9]!]] as const) {
      expect(entry.periods).toBe(row.periods)
      expect(entry.served).toBe(row.dsr_null)
      for (const id of ['participation', 'liJi', 'clusters'] as const) {
        const bar = expectedMaxSr0(view.variance_null as number, byId(id).nTotal, view.euler_gamma) as number
        const want = probabilisticSharpe(row.sr as number, bar * Math.sqrt(252 / row.periods), row.n, row.skew as number, row.kurt as number)
        expect(entry[id], `${row.name} ${id}`).toBe(want)
      }
    }
  })

  it('a smaller N gives a higher DSR for the same trial', () => {
    const entry = result.dsr[0]!
    expect(entry.participation as number).toBeGreaterThan(entry.served as number)
  })

  it('orders the sequence by cluster size, largest first, then first member, members ascending', () => {
    const ranked = [...GOLDEN.clusters].sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
    expect(result.sequence).toEqual(ranked.flat())
    expect([...result.sequence].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('names the clusters at the cut, largest first, trials by name', () => {
    const names = GOLDEN.panel.names
    const ranked = [...GOLDEN.clusters].sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
    const groups = ranked.map((c) => c.map((i) => names[i]).join(', ')).join('; ')
    expect(clustersText(result)).toBe(fillCopy(EFFECTIVE_N.clusters, { groups }))
  })
})

describe('computeEffectiveN: the common window', () => {
  it('counts only the dates every daily trial records with a finite return', () => {
    const series = copyOf(PANEL)
    for (let i = 0; i < 50; i += 1) (series[0] as Mutable).r[i] = null
    const result = ok(overSeries(series))
    expect(result.window).toEqual({ from: PANEL[0]!.date[50], to: PANEL[0]!.date[599], sessions: 550 })
  })

  it('drops a date one trial does not list at all', () => {
    const series = copyOf(PANEL)
    const target = series[3] as Mutable
    target.date.splice(10, 1)
    target.r.splice(10, 1)
    const result = ok(overSeries(series))
    expect(result.window.sessions).toBe(599)
    expect(result.window.from).toBe(PANEL[0]!.date[0])
  })

  it('is unchanged by a series in other units: a Sharpe ratio and a correlation are scale free', () => {
    const series = copyOf(PANEL)
    const scaled = series.map((s, i) => (i === 2 ? { ...s, r: s.r.map((x) => (x === null ? x : x * 1000)) } : s))
    const base = ok(computeEffectiveN(BASE))
    const result = ok(computeEffectiveN({ ...BASE, series: scaled }))
    expect(maxDifference(result.eigenvalues, base.eigenvalues)).toBeLessThanOrEqual(1e-12)
  })

  it('computes a panel of the served length, 9 trials over 3,000 sessions, without trouble', () => {
    const wide = syntheticPanel(7, 3000)
    const result = ok(overSeries(wide))
    expect(result.window.sessions).toBe(3000)
    expect(result.correlation).toHaveLength(9)
  })
})

describe('computeEffectiveN: what the planted blocks give', () => {
  const result = ok(computeEffectiveN(BASE))

  it('finds the two planted blocks and the two singles at the cut', () => {
    expect(result.clusters).toEqual([[0, 1, 2, 3], [4, 5, 6], [7], [8]])
    const byId = (id: string) => result.estimates.find((e) => e.id === id)!
    expect(byId('clusters').nDaily).toBe(4)
    expect(byId('clusters').nTotal).toBe(6)
  })

  it('has fewer effective than registered trials under both eigenvalue estimators', () => {
    for (const id of ['participation', 'liJi']) {
      const e = result.estimates.find((x) => x.id === id)!
      expect(e.nDaily, id).toBeLessThan(9)
      expect(e.nDaily, id).toBeGreaterThan(1)
    }
  })
})

describe('computeEffectiveN: each refusal from one tampering', () => {
  it('passes untouched, so a refusal below is the tampering and nothing else', () => {
    expect(computeEffectiveN(BASE).ok).toBe(true)
  })

  it('noDaily: a view that names no daily trial', () => {
    const result = computeEffectiveN(withRows((rows) => rows.filter((r) => r.periods !== 252)))
    expect(refusal(result)).toEqual({ kind: 'noDaily' })
    expect(refusalText(refusal(result))).toBe(EFFECTIVE_N.refused.noDaily)
  })

  it('unavailable: series that could not be read, named in the view order with the first detail', () => {
    const failed = new Map([['syn_b1', 'boom'], ['syn_a2', 'not found']]) // reverse of the view order
    const series = PANEL.filter((s) => !failed.has(s.name))
    const r = refusal(computeEffectiveN({ ...BASE, series, failed }))
    expect(r).toEqual({ kind: 'unavailable', names: ['syn_a2', 'syn_b1'], total: 9, detail: 'not found' })
    expect(refusalText(r)).toBe(
      'Not computed: 2 of 9 daily trials series could not be read (first syn_a2: not found). Every trial is needed, as in SV3.',
    )
  })

  it('unavailable: a series that is neither read nor reported failed is missing, and says so', () => {
    const r = refusal(computeEffectiveN({ ...BASE, series: PANEL.slice(0, 8) }))
    expect(r).toMatchObject({ kind: 'unavailable', names: ['syn_d1'], total: 9, detail: EFFECTIVE_N.notRead })
  })

  it('unavailable: a name in both lists is failed', () => {
    const failed = new Map([['syn_c1', 'late error']])
    expect(refusal(computeEffectiveN({ ...BASE, failed }))).toMatchObject({ kind: 'unavailable', names: ['syn_c1'], detail: 'late error' })
  })

  it('unavailable: on the served view with only volmanaged_v0 read, names the other 14 trials', () => {
    const only: TrialSeries[] = [{ name: 'volmanaged_v0', date: PANEL[0]!.date, r: PANEL[0]!.r }]
    const r = refusal(computeEffectiveN({ view: DEFLATED_REAL, series: only, failed: NONE }))
    expect(r.kind).toBe('unavailable')
    if (r.kind !== 'unavailable') return
    expect(r.names).toHaveLength(14)
    expect(r.names[0]).toBe('za_v0')
    expect(r.names).not.toContain('volmanaged_v0')
    expect(r.total).toBe(15)
    expect(refusalText(r)).toContain('14 of 15 daily trials series could not be read (first za_v0: ')
  })

  it('unavailable: the served view with every read failing gives the demo line', () => {
    const failed = new Map(dailyTrialNames(DEFLATED_REAL).map((name) => [name, 'not in the demo dataset'] as const))
    const r = refusal(computeEffectiveN({ view: DEFLATED_REAL, series: [], failed }))
    expect(refusalText(r)).toBe(
      'Not computed: 15 of 15 daily trials series could not be read (first za_v0: not in the demo dataset). Every trial is needed, as in SV3.',
    )
  })

  it('anchor: an SR0 that is 1e-6 off the browser value, named SR0 at N 11', () => {
    const view = { ...SYNTHETIC_VIEW, sr0_null_session: (SYNTHETIC_VIEW.sr0_null_session as number) + 1e-6 }
    const r = refusal(computeEffectiveN({ ...BASE, view }))
    expect(r).toMatchObject({ kind: 'anchor', name: 'SR0', n: 11, served: view.sr0_null_session })
    expect(refusalText(r)).toBe(fillCopy(EFFECTIVE_N.refused.anchor, { n: 11, name: 'SR0' }))
  })

  it('anchor: SR0 is held to 1e-12 (5e-13 passes, 5e-12 refuses)', () => {
    const at = (delta: number) =>
      computeEffectiveN({ ...BASE, view: { ...SYNTHETIC_VIEW, sr0_null_session: (SYNTHETIC_VIEW.sr0_null_session as number) + delta } })
    expect(at(5e-13).ok).toBe(true)
    expect(refusal(at(5e-12)).kind).toBe('anchor')
    expect(refusal(at(-5e-12)).kind).toBe('anchor')
  })

  it('anchor: a DSR that is 1e-6 off, named after the trial', () => {
    const input = withRows((rows) => rows.map((r, i) => (i === 3 ? { ...r, dsr_null: (r.dsr_null as number) + 1e-6 } : r)))
    const r = refusal(computeEffectiveN(input))
    expect(r).toMatchObject({ kind: 'anchor', name: 'syn_a4', n: 11 })
  })

  it('anchor: a monthly book is anchored too (its SR0 moved to months)', () => {
    const input = withRows((rows) => rows.map((r, i) => (i === 9 ? { ...r, dsr_null: (r.dsr_null as number) + 1e-6 } : r)))
    expect(refusal(computeEffectiveN(input))).toMatchObject({ kind: 'anchor', name: 'syn_m1' })
  })

  it('anchor: DSR is held to 1e-9 (5e-10 passes, 2e-9 refuses)', () => {
    const at = (delta: number) => computeEffectiveN(withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, dsr_null: (r.dsr_null as number) + delta } : r))))
    expect(at(5e-10).ok).toBe(true)
    expect(refusal(at(2e-9)).kind).toBe('anchor')
  })

  it('anchor: skips a row whose served DSR is null or below 1e-300, as SV3 prints those as a floor', () => {
    const input = withRows((rows) => rows.map((r, i) => (i === 0 ? { ...r, dsr_null: null } : i === 1 ? { ...r, dsr_null: 1e-301 } : r)))
    expect(computeEffectiveN(input).ok).toBe(true)
  })

  it('anchor: a row that cannot be recomputed (no skew served) is refused, not skipped', () => {
    const input = withRows((rows) => rows.map((r, i) => (i === 2 ? { ...r, skew: null } : r)))
    expect(refusal(computeEffectiveN(input))).toMatchObject({ kind: 'anchor', name: 'syn_a3' })
  })

  it('anchor: a view with no V0, a wrong gamma or a wrong N cannot be reproduced', () => {
    expect(refusal(computeEffectiveN({ ...BASE, view: { ...SYNTHETIC_VIEW, variance_null: null } })).kind).toBe('anchor')
    expect(refusal(computeEffectiveN({ ...BASE, view: { ...SYNTHETIC_VIEW, euler_gamma: 0.5 } })).kind).toBe('anchor')
    expect(refusal(computeEffectiveN({ ...BASE, view: { ...SYNTHETIC_VIEW, n_trials: 15 } })).kind).toBe('anchor')
    expect(refusal(computeEffectiveN({ ...BASE, view: { ...SYNTHETIC_VIEW, sr0_null_session: null } })).kind).toBe('anchor')
  })

  it('basis: a series that serves one session fewer than SV3 counts', () => {
    const series = copyOf(PANEL)
    ;(series[2] as Mutable).r[100] = null
    const r = refusal(computeEffectiveN({ ...BASE, series }))
    expect(r).toEqual({ kind: 'basis', name: 'syn_a3', served: 600, read: 599 })
    expect(refusalText(r)).toBe('Not computed: syn_a3 serves 599 sessions but SV3 counts 600.')
  })

  it('basis: a value that is not finite is not a session', () => {
    const series = copyOf(PANEL)
    ;(series[0] as Mutable).r[0] = Number.NaN
    expect(refusal(computeEffectiveN({ ...BASE, series }))).toMatchObject({ kind: 'basis', name: 'syn_a1', read: 599 })
  })

  it('sharpe: one return changed, the count kept, gives a different per-session Sharpe', () => {
    const series = copyOf(PANEL)
    ;(series[1] as Mutable).r[5] = ((series[1] as Mutable).r[5] as number) + 0.02
    const r = refusal(computeEffectiveN({ ...BASE, series }))
    expect(r.kind).toBe('sharpe')
    if (r.kind !== 'sharpe') return
    expect(r.name).toBe('syn_a2')
    expect(r.served).toBe(SYNTHETIC_VIEW.rows[1]!.sr_session)
    expect(r.computed).not.toBeCloseTo(r.served as number, 5)
    const text = refusalText(r)
    expect(text).toContain('the syn_a2 series gives a per-session Sharpe of ')
    expect(text).toContain(', but SV3 serves ')
  })

  it('sharpe: is held to 1e-9 relative (a 1e-11 relative drift passes, 1e-7 refuses)', () => {
    const view = (delta: number) => ({
      ...SYNTHETIC_VIEW,
      rows: SYNTHETIC_VIEW.rows.map((r, i) => (i === 4 ? { ...r, sr_session: (r.sr_session as number) * (1 + delta) } : r)),
    })
    expect(computeEffectiveN({ ...BASE, view: view(1e-11) }).ok).toBe(true)
    expect(refusal(computeEffectiveN({ ...BASE, view: view(1e-7) })).kind).toBe('sharpe')
  })

  it('sharpe: a served per-session Sharpe that is missing is refused', () => {
    const view = { ...SYNTHETIC_VIEW, rows: SYNTHETIC_VIEW.rows.map((r, i) => (i === 0 ? { ...r, sr_session: null } : r)) }
    expect(refusal(computeEffectiveN({ ...BASE, view }))).toMatchObject({ kind: 'sharpe', name: 'syn_a1', served: null })
  })

  it('checks in order: the view against itself first, then the series counts, then the Sharpe ratios', () => {
    const series = copyOf(PANEL)
    ;(series[0] as Mutable).r[3] = ((series[0] as Mutable).r[3] as number) + 0.02 // would be a sharpe refusal
    ;(series[5] as Mutable).r[7] = null // would be a basis refusal, later in the view order
    expect(refusal(computeEffectiveN({ ...BASE, series })).kind).toBe('sharpe') // trial by trial in the view order
    const both = { ...BASE, series, view: { ...SYNTHETIC_VIEW, sr0_null_session: 1 } }
    expect(refusal(computeEffectiveN(both)).kind).toBe('anchor')
    const unread = { ...both, failed: new Map([['syn_d1', 'gone']]) }
    expect(refusal(computeEffectiveN(unread)).kind).toBe('unavailable')
    expect(refusal(computeEffectiveN(withRows((rows) => rows.filter((r) => r.periods !== 252)))).kind).toBe('noDaily')
  })

  it('tooFew: 251 common sessions refuse, 252 compute', () => {
    const cut = (keep: number) => {
      const series = copyOf(PANEL)
      const target = series[0] as Mutable
      for (let i = 0; i < 600 - keep; i += 1) target.r[i] = null
      return overSeries(series)
    }
    expect(cut(252).ok).toBe(true)
    const r = refusal(cut(251))
    expect(r).toEqual({ kind: 'tooFew', sessions: 251 })
    expect(refusalText(r)).toBe('Not computed: only 251 sessions are common to every daily trial (at least 252 are needed).')
  })

  it('degenerate: a trial that does not vary on the common window', () => {
    const series = copyOf(PANEL)
    // the other trials record only the last 300 sessions; the flat trial varies before them and is flat inside
    for (const s of series) {
      if (s.name === 'syn_c1') {
        for (let i = 300; i < 600; i += 1) s.r[i] = 0
      } else {
        for (let i = 0; i < 300; i += 1) s.r[i] = null
      }
    }
    const r = refusal(overSeries(series))
    expect(r).toEqual({ kind: 'degenerate', name: 'syn_c1' })
    expect(refusalText(r)).toBe('Not computed: syn_c1 does not vary on the common window.')
  })
})

describe('computeEffectiveN: the captured SV3 view (DEFLATED_REAL) passes the anchor', () => {
  // No series are read, so the run reaches the basis check: everything before it (the served SR0 and every served
  // DSR reproduced at N 21) has passed. This backs the catalogue's SV3b claim about the captured view.
  const empty = dailyTrialNames(DEFLATED_REAL).map((name) => ({ name, date: [] as string[], r: [] as (number | null)[] }))

  it('reproduces the served SR0 and every served DSR at N 21, so the first refusal is the basis of the first trial', () => {
    expect(refusal(computeEffectiveN({ view: DEFLATED_REAL, series: empty, failed: NONE }))).toEqual({
      kind: 'basis',
      name: 'za_v0',
      served: 2825,
      read: 0,
    })
  })

  it('refuses at the anchor, named SR0, when the served SR0 is 1e-11 off', () => {
    const view = { ...DEFLATED_REAL, sr0_null_session: (DEFLATED_REAL.sr0_null_session as number) + 1e-11 }
    expect(refusal(computeEffectiveN({ view, series: empty, failed: NONE }))).toMatchObject({ kind: 'anchor', name: 'SR0', n: 21 })
  })

  it('refuses at the anchor, named after the trial, when the first served DSR at or above 1e-300 is 1e-6 off', () => {
    const view = {
      ...DEFLATED_REAL,
      rows: DEFLATED_REAL.rows.map((r) => (r.name === 'za_v0' ? { ...r, dsr_null: (r.dsr_null as number) + 1e-6 } : r)),
    }
    expect(refusal(computeEffectiveN({ view, series: empty, failed: NONE }))).toMatchObject({ kind: 'anchor', name: 'za_v0', n: 21 })
  })
})

describe('effectiveNHeatmap', () => {
  const result = ok(computeEffectiveN(BASE))
  const input = effectiveNHeatmap(result)

  it('is a corr heatmap of 9 rows and 9 columns, rows numbered and named in the cluster sequence, columns numbered as the rows', () => {
    expect(input.kind).toBe('corr')
    expect(input.name).toBe(EFFECTIVE_N.heatmapName)
    expect(input.decimals).toBe(2)
    expect(input.columns).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(input.rows).toEqual(result.sequence.map((k, i) => `${i + 1}) ${result.daily[k]}`))
    expect(input.rows).toHaveLength(9)
    expect(input.values).toHaveLength(9)
    for (const row of input.values) expect(row).toHaveLength(9)
  })

  it('leaves the diagonal null and holds the correlation of the trials in the sequence elsewhere', () => {
    input.values.forEach((row, i) => {
      row.forEach((value, j) => {
        if (i === j) expect(value, `(${i}, ${j})`).toBeNull()
        else expect(value, `(${i}, ${j})`).toBe((result.correlation[result.sequence[i] as number] as number[])[result.sequence[j] as number])
      })
    })
  })

  it('puts the members of a cluster in adjacent rows', () => {
    const position = new Map(result.sequence.map((k, i) => [k, i] as const))
    for (const cluster of result.clusters) {
      const at = cluster.map((k) => position.get(k) as number).sort((a, b) => a - b)
      expect(at[at.length - 1]! - at[0]!).toBe(cluster.length - 1)
    }
  })

  it('is accepted by the heatmap: blank diagonal cells, a summary that names the chart', () => {
    const cells = heatmapCells(input)
    expect(cells).toHaveLength(81)
    expect(cells.filter((c) => c.row === c.col).every((c) => c.value === null && c.label === '')).toBe(true)
    expect(describeHeatmap(input)).toContain(EFFECTIVE_N.heatmapName)
  })
})

describe('estimateRows and dsrRows: the text cells', () => {
  const result = ok(computeEffectiveN(BASE))

  it('gives four estimator rows in the copy wording, the registered row marked served', () => {
    const rows = estimateRows(result)
    expect(rows.map((r) => r.label)).toEqual([
      EFFECTIVE_N.estimates.registered,
      EFFECTIVE_N.estimates.participation,
      EFFECTIVE_N.estimates.liJi,
      fillCopy(EFFECTIVE_N.estimates.clusters, { cut: CLUSTER_CUT }),
    ])
    expect(rows.map((r) => r.served)).toEqual([true, false, false, false])
  })

  it('prints whole trial counts bare and fractional ones to 2 decimals, SR0 to 4 and 2 decimals', () => {
    const rows = estimateRows(result)
    expect(rows[0]!.cells.slice(0, 2)).toEqual(['9', '11'])
    expect(rows[3]!.cells.slice(0, 2)).toEqual(['4', '6'])
    expect(rows[1]!.cells[0]).toMatch(/^\d+\.\d\d$/)
    const registered = SYNTHETIC_VIEW.sr0_null_session as number
    expect(rows[0]!.cells[2]).toBe(registered.toFixed(4))
    expect(rows[0]!.cells[3]).toBe((registered * Math.sqrt(252)).toFixed(2))
  })

  it('gives one DSR row per registered trial: name, P and four DSR cells with the floor as text', () => {
    const rows = dsrRows(result)
    expect(rows).toHaveLength(11)
    expect(rows[0]!.name).toBe('syn_a1')
    expect(rows[0]!.periods).toBe('252')
    expect(rows[9]!.periods).toBe('12')
    expect(rows[0]!.cells).toHaveLength(4)
    for (const cell of rows.flatMap((r) => r.cells)) expect(cell).toMatch(/^(\d\.\d+|< 0\.000001|--)$/)
  })
})
