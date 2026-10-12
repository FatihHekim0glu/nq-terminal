// The body of GET /api/analytics/plan (backend models/power.py, PlanView, from the generated contract) and the query the
// screen asks it with.
import type { Schemas } from '../../api/types'

/** The observations a year the planner takes. Never 365. */
export const PERIODS_OPTIONS = [252, 52, 12, 4] as const
export type PeriodsPerYear = (typeof PERIODS_OPTIONS)[number]

export type ServedPlanBar = Schemas['PlanBar']
export type ServedPlanPoint = Schemas['PlanPoint']
export type ServedPlanSlot = Schemas['PlanSlot']
export type ServedPlan = Schemas['PlanView']

/** The query of GET /api/analytics/plan: the book by n or by years (exactly one), the rest optional. */
export interface PlanQuery {
  readonly periods: PeriodsPerYear
  readonly n?: number
  readonly years?: number
  readonly k?: number
  readonly alpha: number
  readonly sharpe?: number
  readonly event_sd?: number
}
