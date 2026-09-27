// SV3 on screen (ANALYTICS_CATALOG SV3 and the SV3a construction): the Deflated Sharpe over the registered
// hypotheses, as REG's DSR column, MT's table and ladder, and DES's line for one hypothesis. Pure functions
// over GET /api/analytics/deflated; every value is the API's. [POST HOC] and an extra view only: nothing here
// is a verdict, and a name that is not a registered trial has no DSR. Each DSR is shown under the empirical
// cross-trial variance V (the paper's construction) and under the null variance V0 (SV3a steps 5 to 9): a trial
// far from the rest for a known cause (mim_v0's cost drag) inflates V until every DSR is below 1e-30, so the
// ladder and REG's column use V0, and MT's table shows both.
import type { Schemas } from '../../api/types'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { DEFLATED } from '../../copy/deflated'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import type { RegRow } from './regModel'

export type DeflatedView = Schemas['DeflatedView']

export interface DeflatedRowView {
  readonly name: string
  readonly kind: string
  readonly periods: string
  readonly n: string
  readonly annual: string
  readonly srSession: string
  readonly skew: string
  readonly kurt: string
  readonly sr0: string
  readonly dsr: string
  readonly sr0Null: string
  readonly dsrNull: string
}

const DSR_DECIMALS = 3
const DSR_FLOOR = 1e-6
const DSR_SMALL = 1e-3

/** A DSR as text: below 1e-6 as "< 0.000001" (never 1e-60 or a rounded 0.000), below 0.001 to 6 decimals. */
export function formatDsr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return formatNumber(value, DSR_DECIMALS)
  if (value < DSR_FLOOR) return DEFLATED.belowFloor
  return formatNumber(value, value < DSR_SMALL ? 6 : DSR_DECIMALS)
}

export function deflatedFacts(view: DeflatedView): string {
  const facts = fillCopy(DEFLATED.facts, {
    n: view.n_trials,
    v: formatNumber(view.variance, 6),
    sessionSr: formatNumber(view.sr0_session, 4),
    annualSr: formatNumber(view.sr0_annual, 2),
    cost: view.cost,
    basis: view.basis,
  })
  // The API names the trial that dominates V in a sentence of its own; it is shown as sent.
  return view.dominant ? `${facts} ${view.dominant.replace(/\.?$/, '.')}` : facts
}

/** V0 and its SR0, the leave-one-out line when the API names a trial, and what N assumes. */
export function deflatedNullFacts(view: DeflatedView): string[] {
  const lines = [fillCopy(DEFLATED.nullFacts, {
    vNull: formatNumber(view.variance_null, 6),
    sessionSr: formatNumber(view.sr0_null_session, 4),
    annualSr: formatNumber(view.sr0_null_annual, 2),
  })]
  const loo = view.leave_one_out
  if (loo.name !== null) {
    lines.push(fillCopy(DEFLATED.leaveOneOut, {
      name: loo.name, v: formatNumber(loo.variance, 6), annualSr: formatNumber(loo.sr0_annual, 2), n: loo.n_trials,
    }))
  }
  lines.push(view.n_note.replace(/\.?$/, '.'))
  return lines
}

export function deflatedRows(view: DeflatedView): DeflatedRowView[] {
  return view.rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    periods: String(r.periods),
    n: formatNumber(r.n, 0, { thousands: true }),
    annual: formatNumber(r.annual_sharpe, 2),
    srSession: formatNumber(r.sr_session, 4),
    skew: formatNumber(r.skew, 2),
    kurt: formatNumber(r.kurt, 2),
    sr0: formatNumber(r.sr0_own_period, 4),
    dsr: formatDsr(r.dsr),
    sr0Null: formatNumber(r.sr0_null_own_period, 4),
    dsrNull: formatDsr(r.dsr_null),
  }))
}

export function deflatedLadder(view: DeflatedView): BarLadderInput {
  const sorted = [...view.rows].sort((a, b) => (b.dsr_null ?? -1) - (a.dsr_null ?? -1))
  return {
    name: DEFLATED.ladderName,
    decimals: DSR_DECIMALS,
    bars: sorted.map((r) => ({ label: r.name, value: r.dsr_null, n: r.n })),
  }
}

/** One trial's row for DES; null for a name that is not a registered trial. */
export function dsrFor(view: DeflatedView, name: string): DeflatedRowView | null {
  return deflatedRows(view).find((r) => r.name === name) ?? null
}

/** REG's rows with each trial's DSR under V0; the same array until the view arrives. */
export function withDeflated(rows: readonly RegRow[], view: DeflatedView | undefined): readonly RegRow[] {
  if (!view) return rows
  const byName = new Map(view.rows.map((r) => [r.name, r.dsr_null]))
  return rows.map((r) => ({ ...r, dsr: byName.get(r.name) ?? null }))
}
