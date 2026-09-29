// EVT response types: aliases of the generated contract (src/api/schema.d.ts, from backend/nq_terminal/
// models/events.py through contract/openapi.json), plus the screen's request state.
import type { EventStudyQuery } from '../../api/queries.screens'
import type { Schemas } from '../../api/types'

export type EventType = NonNullable<EventStudyQuery['event']>
export type EventMode = NonNullable<EventStudyQuery['mode']>

export type EventCalendarEntry = Schemas['EventCalendarEntry']
export type EventCalendar = Schemas['EventCalendar']
export type EventRow = Schemas['EventRow']
export type EndStats = Schemas['EndStats']
export type EventStudy = Schemas['EventStudy']

export interface StudyRequest {
  readonly symbol: string
  readonly event: EventType
  readonly mode: EventMode
  readonly pre: number
  readonly post: number
}
