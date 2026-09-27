// ROLL response types: aliases of the generated contract (src/api/schema.d.ts, from backend/nq_terminal/
// models/roll.py through contract/openapi.json). RollEvent serialises from_id and to_id as `from` and `to`.
import type { Schemas } from '../../api/types'

export type GateInfo = Schemas['GateInfo']
export type RollEvent = Schemas['RollEvent']
export type MarketRolls = Schemas['MarketRolls']
export type RollCalendar = Schemas['RollCalendar']
/** status: past, held (after today's close) or upcoming */
export type PaperRoll = Schemas['PaperRoll']
export type PaperRollSchedule = Schemas['PaperRollSchedule']
