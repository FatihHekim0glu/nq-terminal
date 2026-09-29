// [POST HOC] Basis A, per session (SV3a), computed in the browser (ANALYTICS_CATALOG C8 client phase, SV3b): the
// effective number of trials from the registered daily trials' own return correlations, and the SR0 and DSR each N
// would set. Pure functions over the served SV3 view (GET /api/analytics/deflated) and the trials' served series
// (GET /api/analytics/hypothesis/{name}?cost=1). The arithmetic is src/quant (linalg, cluster, trials), pinned to
// qa/crosscheck/p12_neff.py. An extra view only: it never overrides a frozen pass bar and gives no verdict.
//
// computeEffectiveN REFUSES unless the browser formula first reproduces what SV3 served. The checks run in this
// order and the first failure is the answer, so the terminal never draws a matrix it cannot anchor to the served
// numbers:
//   1. noDaily       the view names no daily trial (a row with 252 periods a year);
//   2. unavailable   any daily trial's series could not be read (every trial is needed, as in SV3);
//   3. anchor        expectedMaxSr0(V0, N, gamma) equals the served sr0_null_session within 1e-12, and every row whose
//                    served dsr_null is at least 1e-300 is reproduced by probabilisticSharpe within 1e-9;
//   4. basis, sharpe for each daily trial in the view order: the finite returns count exactly the served n, and their
//                    per-session Sharpe equals the served sr_session within 1e-9 relative;
//   5. tooFew        fewer than 252 sessions on which every daily trial has a return;
//   6. degenerate    a trial that does not vary on the common window has no correlation.
// Then: the Pearson correlation on the common window, its eigenvalues, the participation ratio and the Li and Ji
// count, UPGMA clusters at 1 - rho = 0.5 (CLUSTER_CUT), and SR0 (under the served V0 and gamma) and every row's DSR
// under each N. The monthly books are counted as independent trials: N_total = N_eff(daily) + the monthly count.
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { fillCopy } from '../../copy/workspace'
import { CLUSTER_CUT, averageLinkage, flatClusters } from '../../quant/cluster'
import { pearsonMatrix, symmetricEigenvalues } from '../../quant/linalg'
import { expectedMaxSr0, liJiCount, participationRatio, probabilisticSharpe, sessionSharpe } from '../../quant/trials'
import { formatNumber } from '../tear/tearFormat'
import { formatDsr, type DeflatedView } from './deflatedModel'

type Row = DeflatedView['rows'][number]

// Pre-registered constants (SV3b).
/** The one cost every screen records: 1 tick per side, the cost SV3 reads its series at. */
export const TRIAL_COST = 1
/** A daily trial is a row with this many periods a year; the rest are monthly books. */
export const DAILY_PERIODS = 252
/** The fewest sessions every daily trial must record for the correlation to be drawn. */
export const MIN_COMMON_SESSIONS = 252
/** A series must reproduce the served per-session Sharpe to this relative error. */
export const SERIES_TOLERANCE = 1e-9
/** The browser SR0 must reproduce the served sr0_null_session to this absolute error. */
export const ANCHOR_TOLERANCE_SR0 = 1e-12
/** The browser DSR must reproduce each served dsr_null to this absolute error. */
export const ANCHOR_TOLERANCE_DSR = 1e-9
/** A served DSR below this is printed as a floor, so it cannot anchor anything. */
export const ANCHOR_DSR_FLOOR = 1e-300
/** The name an SR0 mismatch carries (a DSR mismatch carries the trial's name). */
export const SR0_NAME = 'SR0'

/** One daily trial's series as GET /api/analytics/hypothesis/{name} serves it (distribution.series). */
export interface TrialSeries {
  readonly name: string
  readonly date: readonly string[]
  readonly r: readonly (number | null)[]
}

export type Refusal =
  | { readonly kind: 'noDaily' }
  | { readonly kind: 'unavailable'; readonly names: readonly string[]; readonly total: number; readonly detail: string }
  | { readonly kind: 'anchor'; readonly name: string; readonly n: number; readonly served: number | null; readonly computed: number | null }
  | { readonly kind: 'basis'; readonly name: string; readonly served: number; readonly read: number }
  | { readonly kind: 'sharpe'; readonly name: string; readonly served: number | null; readonly computed: number | null }
  | { readonly kind: 'tooFew'; readonly sessions: number }
  | { readonly kind: 'degenerate'; readonly name: string }

export type EstimateId = 'registered' | 'participation' | 'liJi' | 'clusters'

/** N and the SR0 it sets under the served V0: `served` marks the registered rows, which SV3 itself sends. */
export interface Estimate {
  readonly id: EstimateId
  readonly nDaily: number
  readonly nTotal: number
  readonly sr0Session: number | null
  readonly sr0Annual: number | null
  readonly served: boolean
}

/** One registered row's DSR under V0: as served (N = the registered count) and under each estimated N. */
export interface TrialDsr {
  readonly name: string
  readonly periods: number
  readonly served: number | null
  readonly participation: number | null
  readonly liJi: number | null
  readonly clusters: number | null
}

export interface EffectiveNOk {
  readonly ok: true
  /** The daily trials' names in the served order: the rows and columns of `correlation`. */
  readonly daily: readonly string[]
  /** The monthly books' names, counted as independent trials. */
  readonly monthly: readonly string[]
  readonly window: { readonly from: string; readonly to: string; readonly sessions: number }
  readonly correlation: readonly (readonly number[])[]
  /** Largest first. */
  readonly eigenvalues: readonly number[]
  /** Flat clusters at the cut, as indexes into `daily`: members ascending, ordered by first member. */
  readonly clusters: readonly (readonly number[])[]
  /** The daily trials grouped by cluster (largest cluster first, then first member), the heatmap's row order. */
  readonly sequence: readonly number[]
  readonly estimates: readonly Estimate[]
  readonly dsr: readonly TrialDsr[]
}

export type EffectiveNResult = { readonly ok: false; readonly refusal: Refusal } | EffectiveNOk

export interface EffectiveNInput {
  readonly view: DeflatedView
  /** The daily trials' series that were read. */
  readonly series: readonly TrialSeries[]
  /** The daily trials whose series could not be read, with the reason. */
  readonly failed: ReadonlyMap<string, string>
}

const isDaily = (row: Row): boolean => row.periods === DAILY_PERIODS

/** The names of the daily trials (rows with 252 periods a year) in the served order. */
export function dailyTrialNames(view: DeflatedView): string[] {
  return view.rows.filter(isDaily).map((row) => row.name)
}

function refuse(refusal: Refusal): EffectiveNResult {
  return { ok: false, refusal }
}

function finiteReturns(series: TrialSeries): number[] {
  return series.r.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
}

/** The row's DSR when the bar `sr0Session` is moved to the row's own period; null when a moment is missing. */
function dsrAt(row: Row, sr0Session: number): number | null {
  if (row.sr === null || row.skew === null || row.kurt === null) return null
  return probabilisticSharpe(row.sr, sr0Session * Math.sqrt(DAILY_PERIODS / row.periods), row.n, row.skew, row.kurt)
}

interface Anchored {
  readonly bar: number
  readonly variance0: number
  readonly gamma: number
}

/** Reproduces the served SR0 and DSR at the registered N, or names what does not match. */
function anchorView(view: DeflatedView): Anchored | Refusal {
  const n = view.n_trials
  const served = view.sr0_null_session
  const variance0 = view.variance_null
  const gamma = view.euler_gamma
  const bar = variance0 === null ? null : expectedMaxSr0(variance0, n, gamma)
  if (variance0 === null || bar === null || served === null || !(Math.abs(bar - served) <= ANCHOR_TOLERANCE_SR0)) {
    return { kind: 'anchor', name: SR0_NAME, n, served, computed: bar }
  }
  for (const row of view.rows) {
    const dsr = row.dsr_null
    if (dsr === null || !Number.isFinite(dsr) || dsr < ANCHOR_DSR_FLOOR) continue
    const computed = dsrAt(row, bar)
    if (computed === null || !(Math.abs(computed - dsr) <= ANCHOR_TOLERANCE_DSR)) {
      return { kind: 'anchor', name: row.name, n, served: dsr, computed }
    }
  }
  return { bar, variance0, gamma }
}

/** The clusters largest first, then by first member: the order the heatmap and the cluster line follow. */
function rankClusters(clusters: readonly (readonly number[])[]): (readonly number[])[] {
  return [...clusters].sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
}

/** The dates on which every series has a finite return, ascending, and each series' return on them. */
function commonWindow(series: readonly TrialSeries[]): { dates: string[]; columns: number[][] } {
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

function estimateAt(id: EstimateId, nDaily: number, monthly: number, anchored: Anchored): Estimate {
  const nTotal = nDaily + monthly
  const sr0 = expectedMaxSr0(anchored.variance0, nTotal, anchored.gamma)
  return { id, nDaily, nTotal, sr0Session: sr0, sr0Annual: sr0 === null ? null : sr0 * Math.sqrt(DAILY_PERIODS), served: false }
}

/**
 * The effective number of trials and the SR0 and DSR each N sets, or the first reason it cannot be trusted. See the
 * header for the order of the checks. Never throws for served data; a series with a value that is not a finite number
 * is a missing return.
 */
export function computeEffectiveN({ view, series, failed }: EffectiveNInput): EffectiveNResult {
  const dailyRows = view.rows.filter(isDaily)
  const monthlyRows = view.rows.filter((row) => !isDaily(row))
  if (dailyRows.length === 0) return refuse({ kind: 'noDaily' })

  const byName = new Map(series.map((s) => [s.name, s] as const))
  const unread = dailyRows.filter((row) => failed.has(row.name) || !byName.has(row.name))
  if (unread.length > 0) {
    const first = unread[0] as Row
    const detail = failed.get(first.name) ?? EFFECTIVE_N.notRead
    return refuse({ kind: 'unavailable', names: unread.map((row) => row.name), total: dailyRows.length, detail })
  }

  const anchored = anchorView(view)
  if ('kind' in anchored) return refuse(anchored)

  const daily = dailyRows.map((row) => byName.get(row.name) as TrialSeries)
  for (const [i, row] of dailyRows.entries()) {
    const finite = finiteReturns(daily[i] as TrialSeries)
    if (finite.length !== row.n) return refuse({ kind: 'basis', name: row.name, served: row.n, read: finite.length })
    const computed = sessionSharpe(finite)
    const served = row.sr_session
    if (computed === null || served === null || Math.abs(computed - served) > SERIES_TOLERANCE * Math.abs(served)) {
      return refuse({ kind: 'sharpe', name: row.name, served, computed })
    }
  }

  const { dates, columns } = commonWindow(daily)
  if (dates.length < MIN_COMMON_SESSIONS) return refuse({ kind: 'tooFew', sessions: dates.length })
  const flat = columns.findIndex((column) => column.every((x) => x === column[0]))
  if (flat >= 0) return refuse({ kind: 'degenerate', name: (dailyRows[flat] as Row).name })

  const correlation = pearsonMatrix(columns)
  const eigenvalues = symmetricEigenvalues(correlation)
  const distance = correlation.map((row) => row.map((x) => 1 - x))
  const clusters = flatClusters(averageLinkage(distance), correlation.length, CLUSTER_CUT)
  const sequence = rankClusters(clusters).flat()

  const monthly = monthlyRows.length
  const registered: Estimate = {
    id: 'registered',
    nDaily: dailyRows.length,
    nTotal: view.n_trials,
    sr0Session: view.sr0_null_session,
    sr0Annual: (view.sr0_null_session as number) * Math.sqrt(DAILY_PERIODS),
    served: true,
  }
  const participation = estimateAt('participation', participationRatio(eigenvalues), monthly, anchored)
  const liJi = estimateAt('liJi', liJiCount(eigenvalues), monthly, anchored)
  const grouped = estimateAt('clusters', clusters.length, monthly, anchored)

  const under = (row: Row, estimate: Estimate): number | null => {
    const sr0 = expectedMaxSr0(anchored.variance0, estimate.nTotal, anchored.gamma)
    return sr0 === null ? null : dsrAt(row, sr0)
  }
  return {
    ok: true,
    daily: dailyRows.map((row) => row.name),
    monthly: monthlyRows.map((row) => row.name),
    window: { from: dates[0] as string, to: dates[dates.length - 1] as string, sessions: dates.length },
    correlation,
    eigenvalues,
    clusters,
    sequence,
    estimates: [registered, participation, liJi, grouped],
    dsr: view.rows.map((row) => ({
      name: row.name,
      periods: row.periods,
      served: row.dsr_null,
      participation: under(row, participation),
      liJi: under(row, liJi),
      clusters: under(row, grouped),
    })),
  }
}

// ---------------------------------------------------------------- text

/** Whole numbers with thousands separators, as SV3's table prints n. */
function count(value: number): string {
  return formatNumber(value, 0, { thousands: true })
}

/** The refusal in words (copy/effectiveN.ts), with the numbers it names. */
export function refusalText(refusal: Refusal): string {
  const text = EFFECTIVE_N.refused
  switch (refusal.kind) {
    case 'noDaily':
      return text.noDaily
    case 'unavailable':
      return fillCopy(text.unavailable, {
        n: refusal.names.length,
        total: refusal.total,
        name: refusal.names[0] ?? '',
        detail: refusal.detail,
      })
    case 'anchor':
      return fillCopy(text.anchor, { n: refusal.n, name: refusal.name })
    case 'basis':
      return fillCopy(text.basis, { name: refusal.name, read: count(refusal.read), served: count(refusal.served) })
    case 'sharpe':
      return fillCopy(text.sharpe, {
        name: refusal.name,
        computed: formatNumber(refusal.computed, 6),
        served: formatNumber(refusal.served, 6),
      })
    case 'tooFew':
      return fillCopy(text.tooFew, { sessions: count(refusal.sessions) })
    case 'degenerate':
      return fillCopy(text.degenerate, { name: refusal.name })
  }
}

/** The band's basis line: how many daily trials are in the matrix and how many monthly books are counted alongside. */
export function basisText(view: DeflatedView): string {
  const daily = view.rows.filter(isDaily).length
  return fillCopy(EFFECTIVE_N.basis, { daily, monthly: view.rows.length - daily })
}

export function windowText(result: EffectiveNOk): string {
  const { from, to, sessions } = result.window
  return fillCopy(EFFECTIVE_N.window, { from, to, sessions: count(sessions) })
}

/** The clusters at the cut, largest first, each as its trials' names; a trial alone is a cluster of one. */
export function clustersText(result: EffectiveNOk): string {
  const groups = rankClusters(result.clusters).map((members) => members.map((k) => result.daily[k]).join(', '))
  return fillCopy(EFFECTIVE_N.clusters, { groups: groups.join('; ') })
}

/** A trial count: whole numbers bare, an effective (fractional) count to two decimals. */
function formatN(value: number): string {
  return Number.isInteger(value) ? String(value) : formatNumber(value, 2)
}

const ESTIMATE_LABEL: Readonly<Record<EstimateId, string>> = {
  registered: EFFECTIVE_N.estimates.registered,
  participation: EFFECTIVE_N.estimates.participation,
  liJi: EFFECTIVE_N.estimates.liJi,
  clusters: fillCopy(EFFECTIVE_N.estimates.clusters, { cut: CLUSTER_CUT }),
}

export interface EstimateRow {
  readonly id: EstimateId
  readonly label: string
  /** The row SV3 itself serves (the registered count and its SR0). */
  readonly served: boolean
  /** N daily, N total, SR0 per session, SR0 annualised. */
  readonly cells: readonly [string, string, string, string]
}

export function estimateRows(result: EffectiveNOk): EstimateRow[] {
  return result.estimates.map((e) => ({
    id: e.id,
    label: ESTIMATE_LABEL[e.id],
    served: e.served,
    cells: [formatN(e.nDaily), formatN(e.nTotal), formatNumber(e.sr0Session, 4), formatNumber(e.sr0Annual, 2)],
  }))
}

export interface DsrRow {
  readonly name: string
  readonly periods: string
  /** DSR V0 as served, then under N participation, N Li and Ji, N clusters. */
  readonly cells: readonly [string, string, string, string]
}

export function dsrRows(result: EffectiveNOk): DsrRow[] {
  return result.dsr.map((d) => ({
    name: d.name,
    periods: String(d.periods),
    cells: [formatDsr(d.served), formatDsr(d.participation), formatDsr(d.liJi), formatDsr(d.clusters)],
  }))
}

/** The DSR table's column headings; the served column names the registered N. */
export function dsrHeaders(view: DeflatedView) {
  const cols = EFFECTIVE_N.dsrCols
  return {
    name: cols.name,
    periods: cols.periods,
    served: fillCopy(cols.served, { n: view.n_trials }),
    participation: cols.participation,
    liJi: cols.liJi,
    clusters: cols.clusters,
  }
}

/**
 * The correlation of the daily trials as a CORR heatmap: rows `${i}) ${name}` in the cluster sequence (so a cluster
 * is a block), columns numbered as the rows, the diagonal left blank.
 */
export function effectiveNHeatmap(result: EffectiveNOk): HeatmapInput {
  const { sequence, correlation } = result
  return {
    kind: 'corr',
    name: EFFECTIVE_N.heatmapName,
    columns: sequence.map((_, i) => String(i + 1)),
    rows: sequence.map((k, i) => `${i + 1}) ${result.daily[k]}`),
    values: sequence.map((a, i) =>
      sequence.map((b, j) => (i === j ? null : ((correlation[a] as readonly number[])[b] as number))),
    ),
    decimals: 2,
  }
}
