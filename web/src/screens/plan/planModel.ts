// PLAN's model: the typed draft of a design -> the bounded query of GET /api/analytics/plan, and the served plan -> the
// cells of its two tables. Pure functions over strings and numbers; no request, no component. The bounds are the
// backend's (api/analytics.py): a value outside one is refused here before it is asked, and the server refuses it again.
import { PLAN } from '../../copy/plan'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import { PERIODS_OPTIONS, type PeriodsPerYear, type PlanQuery, type ServedPlan, type ServedPlanPoint } from './planTypes'

export interface Bound {
  readonly min: number
  readonly max: number
}

/** The inclusive range the backend accepts for each number (api/analytics.py MIN_PLAN_N ... MAX_EVENT_SD). */
export const PLAN_BOUNDS = {
  n: { min: 2, max: 100_000 },
  years: { min: 0.5, max: 100 },
  k: { min: 0, max: 1000 },
  alpha: { min: 0.001, max: 0.25 },
  sharpe: { min: 0, max: 5 },
  eventSd: { min: 0.01, max: 10_000 },
} as const satisfies Record<string, Bound>

export const DEFAULT_ALPHA = '0.05'
export const DEFAULT_SIZE = '2520'
export const POWER_TARGET = 0.8
export const REFERENCE_SHARPE = 0.5

export type BookBy = 'n' | 'years'

/** What the researcher has typed: every field as text, so a half-typed number is never lost. */
export interface PlanDraft {
  readonly periods: PeriodsPerYear
  readonly by: BookBy
  readonly size: string
  readonly k: string
  readonly alpha: string
  readonly sharpe: string
  readonly eventSd: string
}

export const INITIAL_DRAFT: PlanDraft = {
  periods: 252,
  by: 'n',
  size: DEFAULT_SIZE,
  k: '',
  alpha: DEFAULT_ALPHA,
  sharpe: '',
  eventSd: '',
}

export interface ParsedDraft {
  /** The query to ask, or null while any field is unusable. */
  readonly query: PlanQuery | null
  /** One line per unusable field, in field order. */
  readonly problems: readonly string[]
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

function bounded(label: string, text: string, bound: Bound, whole: boolean): { value?: number; problem?: string } {
  const trimmed = text.trim()
  if (!PLAIN_NUMBER.test(trimmed)) return { problem: fillCopy(PLAN.problems.number, { field: label }) }
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { problem: fillCopy(PLAN.problems.number, { field: label }) }
  if (whole && !Number.isInteger(value)) return { problem: fillCopy(PLAN.problems.whole, { field: label }) }
  if (value < bound.min || value > bound.max) {
    return { problem: fillCopy(PLAN.problems.range, { field: label, min: String(bound.min), max: String(bound.max) }) }
  }
  return { value }
}

/** Read one optional number: blank is "not given", anything else must be a bounded number. */
function optional(label: string, text: string, bound: Bound, whole: boolean): { value?: number; problem?: string } {
  return text.trim() === '' ? {} : bounded(label, text, bound, whole)
}

/** Turn the typed draft into the query of the plan route; unusable fields are named and nothing is asked. */
export function parseDraft(draft: PlanDraft): ParsedDraft {
  const f = PLAN.fields
  const size = draft.by === 'n'
    ? bounded(f.size, draft.size, PLAN_BOUNDS.n, true)
    : bounded(f.size, draft.size, PLAN_BOUNDS.years, false)
  const k = optional(f.k, draft.k, PLAN_BOUNDS.k, true)
  const alpha = bounded(f.alpha, draft.alpha, PLAN_BOUNDS.alpha, false)
  const sharpe = optional(f.sharpe, draft.sharpe, PLAN_BOUNDS.sharpe, false)
  const eventSd = optional(f.eventSd, draft.eventSd, PLAN_BOUNDS.eventSd, false)
  const problems = [size, k, alpha, sharpe, eventSd].flatMap((r) => (r.problem === undefined ? [] : [r.problem]))
  if (problems.length > 0 || size.value === undefined || alpha.value === undefined) return { query: null, problems }
  const query: PlanQuery = {
    periods: draft.periods,
    ...(draft.by === 'n' ? { n: size.value } : { years: size.value }),
    ...(k.value === undefined ? {} : { k: k.value }),
    alpha: alpha.value,
    ...(sharpe.value === undefined ? {} : { sharpe: sharpe.value }),
    ...(eventSd.value === undefined ? {} : { event_sd: eventSd.value }),
  }
  return { query, problems }
}

/** True for one of the four periods the planner takes. */
export function isPeriods(value: number): value is PeriodsPerYear {
  return (PERIODS_OPTIONS as readonly number[]).includes(value)
}

// ------------------------------------------------------------------ formatting

const DECIMALS = 2
const ALPHA_DIGITS = 3
const Z_DECIMALS = 3

/** An alpha at three significant digits, no exponent: 0.05, 0.000833. */
export function formatAlpha(alpha: number): string {
  return String(Number(alpha.toPrecision(ALPHA_DIGITS)))
}

function fixed(value: number | null, decimals = DECIMALS): string {
  return formatNumber(value, decimals)
}

function count(value: number | null): string {
  return value === null ? PLAN.notReachable : formatNumber(value, 0, { thousands: true })
}

/** The one-line statement of the book: n, periods, years and alpha. */
export function bookLine(plan: ServedPlan): string {
  return fillCopy(PLAN.book, {
    n: formatNumber(plan.n, 0, { thousands: true }),
    periods: String(plan.periods),
    years: fixed(plan.years),
    alpha: formatAlpha(plan.alpha),
  })
}

/** What the live region says once an answer has settled: the book, then per family size the next slot, its Bonferroni
 * bar and minimum detectable Sharpe, with the typed power and the mean per event when those were typed. Every typed
 * field changes it, so a screen reader hears a change whichever one was edited. */
export function answerSummary(plan: ServedPlan): string {
  const slots = plan.slots.map((slot) => {
    const point = slot.at_slot
    const parts = [
      fillCopy(PLAN.summarySlot, {
        source: sourceLabel(slot.source, slot.k),
        slot: String(slot.slot),
        bar: formatAlpha(slot.bonferroni.alpha),
        mde: fixed(point.mde_sharpe),
      }),
    ]
    if (plan.typed_sharpe !== null) {
      parts.push(fillCopy(PLAN.summaryTyped, { sharpe: String(plan.typed_sharpe), power: fixed(point.power_at_typed) }))
    }
    if (plan.event_sd !== null) parts.push(fillCopy(PLAN.summaryEvent, { mean: fixed(point.mean_per_event) }))
    return parts.join(' ')
  })
  return slots.join(' ')
}

export type BarsCol = keyof typeof PLAN.barsCols

export const BARS_COLUMNS: readonly BarsCol[] = [
  'family', 'slot', 'bonferroni', 'bonferroniZ', 'holmStrictest', 'holmStrictestZ', 'holmLoosest', 'holmLoosestZ',
]

function sourceLabel(source: 'registry' | 'typed', k: number): string {
  return fillCopy(source === 'registry' ? PLAN.sourceRegistry : PLAN.sourceTyped, { k: String(k) })
}

/** One row per family size (the registry's, and the typed one when it differs): the bars at the next slot. */
export function barsRows(plan: ServedPlan): readonly (Record<BarsCol, string> & { readonly id: string })[] {
  return plan.slots.map((slot) => ({
    id: `${slot.source}-${slot.k}`,
    family: sourceLabel(slot.source, slot.k),
    slot: String(slot.slot),
    bonferroni: formatAlpha(slot.bonferroni.alpha),
    bonferroniZ: fixed(slot.bonferroni.z, Z_DECIMALS),
    holmStrictest: formatAlpha(slot.holm_strictest.alpha),
    holmStrictestZ: fixed(slot.holm_strictest.z, Z_DECIMALS),
    holmLoosest: formatAlpha(slot.holm_loosest.alpha),
    holmLoosestZ: fixed(slot.holm_loosest.z, Z_DECIMALS),
  }))
}

export type DesignCol = keyof typeof PLAN.designCols

/** The design columns that apply: the typed-Sharpe columns and the event column appear only when typed. */
export function designColumns(plan: ServedPlan): readonly DesignCol[] {
  return [
    'test', 'alpha', 'z', 'mde', 'powerReference',
    ...(plan.typed_sharpe === null ? [] : (['powerTyped'] as const)),
    'nReference',
    ...(plan.typed_sharpe === null ? [] : (['nTyped'] as const)),
    ...(plan.event_sd === null ? [] : (['meanPerEvent'] as const)),
  ]
}

/** The column headers with the power target and the reference Sharpe named. */
export function designHeaders(): Record<DesignCol, string> {
  const slots = { target: fixed(POWER_TARGET), s: fixed(REFERENCE_SHARPE) }
  const out = { ...PLAN.designCols } as Record<DesignCol, string>
  for (const key of Object.keys(out) as DesignCol[]) out[key] = fillCopy(PLAN.designCols[key], slots)
  return out
}

function designCells(label: string, point: ServedPlanPoint): Record<DesignCol, string> {
  return {
    test: label,
    alpha: formatAlpha(point.alpha),
    z: fixed(point.z, Z_DECIMALS),
    mde: fixed(point.mde_sharpe),
    powerReference: fixed(point.power_at_reference),
    powerTyped: fixed(point.power_at_typed),
    nReference: count(point.observations_for_reference),
    nTyped: count(point.observations_for_typed),
    meanPerEvent: fixed(point.mean_per_event),
  }
}

/** One row for the single-test alpha, then one per slot at its Bonferroni bar. */
export function designRows(plan: ServedPlan): readonly (Record<DesignCol, string> & { readonly id: string })[] {
  const single = { id: 'nominal', ...designCells(PLAN.nominalRow, plan.nominal) }
  const slots = plan.slots.map((slot) => ({
    id: `${slot.source}-${slot.k}`,
    ...designCells(fillCopy(PLAN.slotRow, { slot: String(slot.slot), source: sourceLabel(slot.source, slot.k) }), slot.at_slot),
  }))
  return [single, ...slots]
}
