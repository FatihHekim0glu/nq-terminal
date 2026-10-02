// MT 87) Effective trials, the words, cells and heatmap over the served `effective_n` of GET /api/analytics/deflated
// (ANALYTICS_CATALOG SV3b). [POST HOC] Basis A, per session (SV3a). Every number is the backend's: the correlation of the
// registered daily trials, its eigenvalues, the three estimates of the effective N (eigenvalue participation, Li and
// Ji, UPGMA clusters at 1 - rho = 0.5), the SR0 and DSR each sets under the served V0, and the refusals the data can
// give (no daily trial, fewer than 252 common sessions, a trial that does not vary). The browser computes none of it
// (the C8 client-phase exception for SV3b is closed by analytics/neff.py; the old browser estimators survive only as a
// test reference, src/quant/neffReference.ts). An extra view only: it never overrides a frozen pass bar and gives no
// verdict.
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import { EFFECTIVE_N } from '../../copy/effectiveN'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import { formatDsr } from './deflatedModel'
import type {
  DeflatedWithEffective,
  EffectiveNRefusal,
  EffectiveNServed,
  EffectiveNWindow,
  EstimateId,
} from './effectiveNTypes'

/**
 * The served effective_n of the SV3 view, or null when the backend sent none (an answer from before SV3b was served):
 * the panel then says so and draws nothing, rather than computing a number of its own.
 */
export function servedOf(view: DeflatedWithEffective): EffectiveNServed | null {
  return (view as { readonly effective_n?: EffectiveNServed | null }).effective_n ?? null
}

/** Whole numbers with thousands separators, as SV3's table prints n. */
function count(value: number): string {
  return formatNumber(value, 0, { thousands: true })
}

/** The refusal in words (copy/effectiveN.ts), with the numbers it names. */
export function refusalText(refusal: EffectiveNRefusal): string {
  const text = EFFECTIVE_N.refused
  switch (refusal.kind) {
    case 'no_daily':
      return text.noDaily
    case 'too_few':
      return fillCopy(text.tooFew, { sessions: count(refusal.sessions ?? 0) })
    case 'degenerate':
      return fillCopy(text.degenerate, { name: refusal.name ?? '' })
  }
}

/** The band's basis line: how many daily trials are in the matrix and how many monthly books are counted alongside. */
export function basisText(served: EffectiveNServed): string {
  return fillCopy(EFFECTIVE_N.basis, { daily: served.daily.length, monthly: served.monthly.length })
}

export function windowText(window: EffectiveNWindow): string {
  return fillCopy(EFFECTIVE_N.window, { from: window.first, to: window.last, sessions: count(window.sessions) })
}

/** The served clusters largest first (then by first member): the order the heatmap and the cluster line follow. */
function rankedClusters(served: EffectiveNServed): (readonly number[])[] {
  return [...served.clusters].sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number))
}

/** The clusters at the cut, largest first, each as its trials' names; a trial alone is a cluster of one. */
export function clustersText(served: EffectiveNServed): string {
  const groups = rankedClusters(served).map((members) => members.map((k) => served.daily[k]).join(', '))
  return fillCopy(EFFECTIVE_N.clusters, { groups: groups.join('; ') })
}

/** A trial count: whole numbers bare (also one that floating point left a hair off), an effective count to 2 decimals. */
export function formatN(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : formatNumber(value, 2)
}

const ESTIMATE_LABEL: Readonly<Record<EstimateId, (cut: number) => string>> = {
  registered: () => EFFECTIVE_N.estimates.registered,
  participation: () => EFFECTIVE_N.estimates.participation,
  li_ji: () => EFFECTIVE_N.estimates.liJi,
  clusters: (cut) => fillCopy(EFFECTIVE_N.estimates.clusters, { cut }),
}

export interface EstimateRow {
  readonly id: EstimateId
  readonly label: string
  /** The row SV3 itself serves (the registered count and its SR0). */
  readonly served: boolean
  /** N daily, N total, SR0 per session, SR0 annualised. */
  readonly cells: readonly [string, string, string, string]
}

export function estimateRows(served: EffectiveNServed): EstimateRow[] {
  return served.estimates.map((e) => ({
    id: e.id,
    label: ESTIMATE_LABEL[e.id](served.cluster_cut),
    served: e.served,
    cells: [formatN(e.n_daily), formatN(e.n_total), formatNumber(e.sr0_session, 4), formatNumber(e.sr0_annual, 2)],
  }))
}

export interface DsrRow {
  readonly name: string
  readonly periods: string
  /** DSR V0 as served, then under N participation, N Li and Ji, N clusters. */
  readonly cells: readonly [string, string, string, string]
}

export function dsrRows(served: EffectiveNServed): DsrRow[] {
  return served.dsr.map((d) => ({
    name: d.name,
    periods: String(d.periods),
    cells: [formatDsr(d.served), formatDsr(d.participation), formatDsr(d.li_ji), formatDsr(d.clusters)],
  }))
}

/** The DSR table's column headings; the served column names the registered N. */
export function dsrHeaders(view: Pick<DeflatedWithEffective, 'n_trials'>) {
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
 * The served correlation of the daily trials as a CORR heatmap: rows `${i}) ${name}` in the served cluster sequence (so
 * a cluster is a block), columns numbered as the rows, the diagonal left blank.
 */
export function effectiveNHeatmap(served: EffectiveNServed): HeatmapInput {
  const { sequence, correlation, daily } = served
  return {
    kind: 'corr',
    name: EFFECTIVE_N.heatmapName,
    columns: sequence.map((_, i) => String(i + 1)),
    rows: sequence.map((k, i) => `${i + 1}) ${daily[k]}`),
    values: sequence.map((a, i) =>
      sequence.map((b, j) => (i === j ? null : ((correlation[a] as readonly number[])[b] as number))),
    ),
    decimals: 2,
  }
}
