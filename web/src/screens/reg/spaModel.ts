// SV8 on MT (ANALYTICS_CATALOG SV8): White's Reality Check, a non-studentised SPA (arch's form) and Romano-Wolf StepM over the
// pre-registered NQ hypotheses on one contract, against cash with NQ buy and hold as a second row. Pure functions over GET
// /api/analytics/spa; every value is the API's. [POST HOC] and an extra view only: the p-values are family-wise
// over a family fixed by a rule on the registry, and nothing here is a verdict on one hypothesis.
import { SPA } from '../../copy/spa'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import type { SpaView } from './spaTypes'

const P_DECIMALS = 4
const USD_DECIMALS = 2
const BLOCK_DECIMALS = 1

export interface SpaRowView {
  readonly name: string
  readonly meanReturn: string
  readonly meanDiff: string
  readonly block: string
  readonly consistent: string
  readonly stepm: string
  readonly leftOut: string
  readonly rejected: boolean
}

const count = (value: number): string => formatNumber(value, 0, { thousands: true })

/** The benchmark's plain name in the copy's words, by the id the API serves. */
export const benchmarkName = (view: SpaView): string => SPA.benchmarks[view.benchmark_id].name

/** The caption of one row's member table: it names the benchmark, so the two tables have distinct names. */
export const spaCaption = (view: SpaView): string => fillCopy(SPA.caption, { benchmark: benchmarkName(view) })

/** The family line, and the benchmark gap line when sessions were left out for it. */
export function spaFacts(view: SpaView): string[] {
  const lines = [fillCopy(SPA.facts, {
    k: view.members.length,
    n: count(view.n_sessions),
    first: view.first,
    last: view.last,
    cost: view.cost,
    benchmark: benchmarkName(view),
    unit: view.unit,
  })]
  if (view.bench_missing > 0) lines.push(fillCopy(SPA.benchMissing, { count: count(view.bench_missing) }))
  return lines
}

export function spaBootstrapLine(view: SpaView): string {
  return fillCopy(SPA.bootstrap, {
    block: formatNumber(view.block, 2),
    reps: count(view.reps),
    seed: String(view.seed),
  })
}

export function spaPValues(view: SpaView): string {
  return fillCopy(SPA.pvalues, {
    consistent: formatNumber(view.pvalues.consistent, P_DECIMALS),
    lower: formatNumber(view.pvalues.lower, P_DECIMALS),
    upper: formatNumber(view.pvalues.upper, P_DECIMALS),
    rc: formatNumber(view.reality_check, P_DECIMALS),
  })
}

/** StepM's rejections in registry order (the members' order), or the plain "none". */
export function spaStepM(view: SpaView): string {
  const size = String(view.size)
  const rejected = view.members.filter((m) => view.superior.includes(m.name)).map((m) => m.name)
  if (rejected.length === 0) return fillCopy(SPA.stepmNone, { size, none: SPA.benchmarks[view.benchmark_id].none })
  return fillCopy(SPA.stepm, { size, steps: view.stepm_steps, names: rejected.join(', ') })
}

export function spaRows(view: SpaView): SpaRowView[] {
  return view.members.map((m) => ({
    name: m.name,
    meanReturn: formatNumber(m.mean_return, USD_DECIMALS),
    meanDiff: formatNumber(m.mean_differential, USD_DECIMALS),
    block: formatNumber(m.block, BLOCK_DECIMALS),
    consistent: m.in_consistent_set ? SPA.yes : SPA.no,
    stepm: m.rejected && m.step !== null ? fillCopy(SPA.rejectedAt, { step: m.step }) : SPA.notRejected,
    leftOut: fillCopy(SPA.leftOut, { count: count(m.left_out), pnl: count(m.left_out_with_pnl) }),
    rejected: m.rejected,
  }))
}

/** Each registered hypothesis outside the family with the API's reason, as one sentence. */
export function spaExcluded(view: SpaView): string[] {
  return view.excluded.map((e) => `${e.name}: ${e.reason.replace(/\.?$/, '.')}`)
}

/** The API's own explanatory sentences, each ending in a full stop. */
export function spaNotes(view: SpaView): string[] {
  return [view.family_note, view.statistic, view.block_rule, view.note, view.construction].map((line) =>
    line.replace(/\.?$/, '.'),
  )
}
