// Live bodies of the demo dataset: the fixture backend's live folder (backend/tests/fixtures/live/logs) as
// screens/live/liveFixtures.ts shapes it, with the routes body captured from the fixture backend. The demo event
// source (src/demo/stream.ts) replays the same status and journal rows, so the stream and the GETs agree.
import type { Schemas } from '../../api/types'
import { ALL_ROWS, ROUTES_BODY, performance, status } from '../../screens/live/liveFixtures'
import { NOT_IN_DEMO, served, type DemoBody, type DemoRefusal } from './answer'
import { repage } from './runs'

/** GET /api/live/status, and the `status` event the demo stream sends. */
export const demoLiveStatus: Schemas['LiveStatus'] = status()

/** Every journal row, oldest first, across the fixture journals: GET /api/live/journal, and the stream's replay. */
export const demoLiveJournalRows: readonly Schemas['JournalRowOut'][] = ALL_ROWS

export const LIVE_PERFORMANCE: Schemas['Performance'] = performance()
export const LIVE_ROUTES: Schemas['LiveRoutes'] = ROUTES_BODY

const JOURNALS = new Set(demoLiveStatus.journals.map((j) => j.name))

/** A performance view names one journal: the book's by default, as the backend picks it. */
export function forBookJournal<T extends { readonly journal: string }>(body: T, file: string | null): DemoBody<T> | DemoRefusal {
  return file === null || file === body.journal ? served(body) : NOT_IN_DEMO
}

/** GET /api/live/journal: rows of one journal (or all), of one row type (or all), paged. */
export function journalPage(query: URLSearchParams): DemoBody<Schemas['Page_JournalRowOut_']> | DemoRefusal {
  const file = query.get('file')
  const type = query.get('type')
  if (file !== null && !JOURNALS.has(file)) return NOT_IN_DEMO
  const rows = demoLiveJournalRows.filter((r) => (file === null || r.file === file) && (type === null || r.data['type'] === type))
  return repage({ items: rows, offset: 0, limit: rows.length, total: rows.length }, query)
}
