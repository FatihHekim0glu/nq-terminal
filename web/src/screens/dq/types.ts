// DQ response types: aliases of the generated contract (src/api/schema.d.ts, from backend/nq_terminal/
// models/dq.py through contract/openapi.json).
import type { Schemas } from '../../api/types'

export type DqCounts = Schemas['DqCounts']
export type DqSymbol = Schemas['DqSymbol']
export type DqIndex = Schemas['DqIndex']
export type DqDay = Schemas['DqDay']
export type DqQaYear = Schemas['DqQaYear']
export type DqCalendar = Schemas['DqCalendar']
export type GuardGroup = Schemas['GuardGroup']
export type GuardStatusReport = Schemas['GuardStatusReport']
export type DayState = DqDay['state']
export type GuardStatus = GuardGroup['status']

export const DAY_STATES: readonly DayState[] = ['vendor', 'gated_out', 'rejected', 'rebuilt', 'unrepairable']
