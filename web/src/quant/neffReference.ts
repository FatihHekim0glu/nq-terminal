// TEST REFERENCE, not shipped: the browser's own effective number of trials (SV3b) and of family members (SV8 step 8),
// kept so the tests can show that what the backend serves (nq_terminal/analytics/neff.py) equals what the browser used
// to compute, to 1e-12 relative (integers and cluster labels exactly), on the golden panel and the served views. No
// production file imports this module or linalg, cluster and trials (src/quant/importGuard.test.ts fails the build of
// the tests when one does): the screens show the served numbers (ANALYTICS_CATALOG C8; the client-phase exception for
// SV3b, SV8 and LV6 is closed by the backend mirror).
//
// The results carry the served field names (snake case), so a test compares them with the served view field by field.
// The refusals are the data ones the backend also serves: no daily trial, fewer than 252 common sessions, a trial
// that does not vary on the common window. The anchor, basis and Sharpe refusals of the browser formula (it first
// reproduced the served SR0, n and per-session Sharpe) are not here: the backend computes from the very series SV3 used.
import type { DeflatedView } from '../screens/reg/deflatedModel'
import { CLUSTER_CUT, averageLinkage, flatClusters } from './cluster'
import { pearsonMatrix, symmetricEigenvalues } from './linalg'
import { expectedMaxSr0, liJiCount, participationRatio, probabilisticSharpe } from './trials'

const DAILY_PERIODS = 252
const MIN_COMMON_SESSIONS = 252

type Row = DeflatedView['rows'][number]

export interface ReferenceSeries {
  readonly name: string
  readonly date: readonly string[]
  readonly r: readonly (number | null)[]
}

export type ReferenceRefusal = {
  readonly kind: 'no_daily' | 'too_few' | 'degenerate'
  readonly name: string | null
  readonly sessions: number | null
}

export interface ReferenceEstimate {
  readonly id: 'registered' | 'participation' | 'li_ji' | 'clusters'
  readonly n_daily: number
  readonly n_total: number
  readonly sr0_session: number | null
  readonly sr0_annual: number | null
  readonly served: boolean
}

export interface ReferenceDsr {
  readonly name: string
  readonly periods: number
  readonly served: number | null
  readonly participation: number | null
  readonly li_ji: number | null
  readonly clusters: number | null
}

export interface ReferenceEffectiveN {
  readonly refusal: ReferenceRefusal | null
  readonly daily: readonly string[]
  readonly monthly: readonly string[]
  readonly window: { readonly first: string; readonly last: string; readonly sessions: number } | null
  readonly correlation: readonly (readonly number[])[]
  readonly eigenvalues: readonly number[]
  readonly clusters: readonly (readonly number[])[]
  readonly sequence: readonly number[]
  readonly estimates: readonly ReferenceEstimate[]
  readonly dsr: readonly ReferenceDsr[]
}

const isDaily = (row: Row): boolean => row.periods === DAILY_PERIODS

function refused(daily: readonly string[], monthly: readonly string[], refusal: ReferenceRefusal): ReferenceEffectiveN {
  return { refusal, daily, monthly, window: null, correlation: [], eigenvalues: [], clusters: [], sequence: [], estimates: [], dsr: [] }
}

/** Largest cluster first, then by first member. */
function rankClusters(clusters: readonly (readonly number[])[]): (readonly number[])[] {
  return [...clusters].sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
}

function commonWindow(series: readonly ReferenceSeries[]): { dates: string[]; columns: number[][] } {
  const maps = series.map((s) => {
    const byDate = new Map<string, number>()
    s.date.forEach((d, i) => {
      const value = s.r[i]
      if (typeof value === 'number' && Number.isFinite(value)) byDate.set(d, value)
    })
    return byDate
  })
  const first = maps[0] as Map<string, number>
  const dates = [...first.keys()].filter((d) => maps.every((m) => m.has(d))).sort()
  return { dates, columns: maps.map((m) => dates.map((d) => m.get(d) as number)) }
}

function dsrAt(row: Row, sr0Session: number | null): number | null {
  if (sr0Session === null || row.sr === null || row.skew === null || row.kurt === null) return null
  return probabilisticSharpe(row.sr, sr0Session * Math.sqrt(DAILY_PERIODS / row.periods), row.n, row.skew, row.kurt)
}

/** The browser's SV3b over the served SV3 view and the daily trials' series (in the served order). */
export function referenceEffectiveN(view: DeflatedView, series: readonly ReferenceSeries[]): ReferenceEffectiveN {
  const dailyRows = view.rows.filter(isDaily)
  const monthly = view.rows.filter((row) => !isDaily(row)).map((row) => row.name)
  const daily = dailyRows.map((row) => row.name)
  if (dailyRows.length === 0) return refused(daily, monthly, { kind: 'no_daily', name: null, sessions: null })
  const byName = new Map(series.map((s) => [s.name, s] as const))
  const { dates, columns } = commonWindow(daily.map((name) => byName.get(name) as ReferenceSeries))
  if (dates.length < MIN_COMMON_SESSIONS) return refused(daily, monthly, { kind: 'too_few', name: null, sessions: dates.length })
  const flat = columns.findIndex((column) => column.every((x) => x === column[0]))
  if (flat >= 0) return refused(daily, monthly, { kind: 'degenerate', name: daily[flat] as string, sessions: null })

  const correlation = pearsonMatrix(columns)
  const eigenvalues = symmetricEigenvalues(correlation)
  const clusters = flatClusters(averageLinkage(correlation.map((row) => row.map((x) => 1 - x))), correlation.length, CLUSTER_CUT)
  const variance0 = view.variance_null as number
  const estimate = (id: 'participation' | 'li_ji' | 'clusters', nDaily: number): ReferenceEstimate => {
    const nTotal = nDaily + monthly.length
    const sr0 = expectedMaxSr0(variance0, nTotal, view.euler_gamma)
    return { id, n_daily: nDaily, n_total: nTotal, sr0_session: sr0, sr0_annual: sr0 === null ? null : sr0 * Math.sqrt(DAILY_PERIODS), served: false }
  }
  const registered: ReferenceEstimate = {
    id: 'registered',
    n_daily: dailyRows.length,
    n_total: view.n_trials,
    sr0_session: view.sr0_null_session,
    sr0_annual: (view.sr0_null_session as number) * Math.sqrt(DAILY_PERIODS),
    served: true,
  }
  const estimates = [
    registered,
    estimate('participation', participationRatio(eigenvalues)),
    estimate('li_ji', liJiCount(eigenvalues)),
    estimate('clusters', clusters.length),
  ]
  const bar = (id: string): number | null => (estimates.find((e) => e.id === id) as ReferenceEstimate).sr0_session
  return {
    refusal: null,
    daily,
    monthly,
    window: { first: dates[0] as string, last: dates[dates.length - 1] as string, sessions: dates.length },
    correlation,
    eigenvalues,
    clusters,
    sequence: rankClusters(clusters).flat(),
    estimates,
    dsr: view.rows.map((row) => ({
      name: row.name,
      periods: row.periods,
      served: row.dsr_null,
      participation: dsrAt(row, bar('participation')),
      li_ji: dsrAt(row, bar('li_ji')),
      clusters: dsrAt(row, bar('clusters')),
    })),
  }
}

// ---------------------------------------------------------------- SV8 step 8

export interface ReferenceMembers {
  readonly k: number
  readonly cut: number
  readonly refusal: { readonly kind: 'single' | 'undefined'; readonly name: string | null } | null
  readonly participation: number | null
  readonly li_ji: number | null
  readonly clusters: readonly (readonly string[])[]
  readonly strongest: { readonly a: string; readonly b: string; readonly rho: number } | null
}

type Matrix = readonly (readonly (number | null)[])[]

function strongestPair(matrix: readonly (readonly number[])[], names: readonly string[]): { a: string; b: string; rho: number } {
  let best = { a: names[0] as string, b: names[1] as string, rho: (matrix[0] as readonly number[])[1] as number }
  matrix.forEach((row, i) => {
    row.forEach((rho, j) => {
      if (j > i && Math.abs(rho) > Math.abs(best.rho)) best = { a: names[i] as string, b: names[j] as string, rho }
    })
  })
  return best
}

/** The browser's SV8 step 8 over the correlation of the differentials (null where a member has no correlation). */
export function referenceMembers(names: readonly string[], matrix: Matrix): ReferenceMembers {
  const k = names.length
  const empty = { k, cut: CLUSTER_CUT, participation: null, li_ji: null, clusters: [], strongest: null }
  if (k < 2) return { ...empty, refusal: { kind: 'single', name: null } }
  const gap = matrix.findIndex((row, i) => row[i] === null)
  if (gap >= 0) return { ...empty, refusal: { kind: 'undefined', name: names[gap] as string } }
  const dense = matrix as readonly (readonly number[])[]
  const eigenvalues = symmetricEigenvalues(dense)
  const groups = flatClusters(averageLinkage(dense.map((row) => row.map((rho) => 1 - rho))), k, CLUSTER_CUT)
  return {
    ...empty,
    refusal: null,
    participation: participationRatio(eigenvalues),
    li_ji: liJiCount(eigenvalues),
    clusters: rankClusters(groups).map((members) => members.map((i) => names[i] as string)),
    strongest: strongestPair(dense, names),
  }
}
