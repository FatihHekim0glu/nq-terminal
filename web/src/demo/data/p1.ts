// Phase 11 bodies of the demo dataset (VCONE, ROLL, SEAS, EVT): the test bodies of those screens, each served
// only for the request it describes, so no body answers under another symbol, window or year range.
// - ROLL: the NQ and CL rows and the paper schedule repeat the fixture backend's answers
//   (screens/roll/rollTestData.ts); its hand-built ES row is left out. The paper schedule shows two contracts
//   behind the held one and one ahead, so it answers that request only.
// - VCONE (screens/vcone/vconeTestData.ts), SEAS (screens/seas/seasTestData.ts) and EVT (screens/evt/fixtures.ts)
//   are hand-built deterministic fillers on the backend's scale. VCONE's, ROLL's, SEAS's and the EVT study's
//   fixtures each carry a gate as the real backend would report it (their own tests expect that); every one of
//   the four is overridden to a zero-read gate here, as data/market.ts does, so it agrees with the status bar's
//   own zero reads (system.ts's health.gate_reads_this_process): nothing here is actually read through a gate.
import type { Schemas } from '../../api/types'
import { makeCalendar as makeEventCalendar, makeStudy } from '../../screens/evt/fixtures'
import { CL, NQ, PAPER, makeCalendar as makeRollCalendar } from '../../screens/roll/rollTestData'
import { makeSeasonality } from '../../screens/seas/seasTestData'
import { ROOTS } from '../../screens/mon/testUniverse'
import { HORIZON_LIST, makeCone, makeSmall } from '../../screens/vcone/vconeTestData'
import { NOT_IN_DEMO, intParam, served, type DemoBody, type DemoRefusal } from './answer'

type Answer<T> = DemoBody<T> | DemoRefusal

/** The API's defaults for these requests (services/vcone.py, api/roll.py, api/events.py, api/seasonality.py). */
const DEFAULT_HORIZON = 21
const PAPER_DEFAULT = { behind: 2, ahead: 8 } as const
const STUDY_DEFAULT = { symbol: 'NQ.V.0', event: 'FOMC', mode: 'daily', pre: 5, post: 5 } as const
const SEAS_DEFAULT_YEARS = { start: 2010, end: 2021 } as const

/** Universe roots by their continuous symbol (NQ.V.0 to NQ). */
const ROOT_OF: ReadonlyMap<string, string> = new Map(ROOTS.map(([root]) => [`${root}.V.0`, root]))

/** The demo's own gate, as data/market.ts reports it: nothing here goes through a real gate. */
const DEMO_GATE: Schemas['GateInfo'] = { caller: 'demo', served_years: [], cached: false, reads_this_process: 0 }

export const ROLL_CALENDAR: Schemas['RollCalendar'] = { ...makeRollCalendar([NQ, CL]), gate: DEMO_GATE }
export const EVENT_CALENDAR: Schemas['EventCalendar'] = makeEventCalendar()
const STUDY: Schemas['EventStudy'] = { ...makeStudy(), gate: DEMO_GATE }
const SEASONALITY: Schemas['Seasonality'] = { ...makeSeasonality(), gate: DEMO_GATE }

/** GET /api/market/vcone: one universe root's cone. */
export function volCone(query: URLSearchParams): Answer<Schemas['VolCone']> {
  const root = ROOT_OF.get(query.get('symbol') ?? '')
  return root === undefined ? NOT_IN_DEMO : served({ ...makeCone(root), gate: DEMO_GATE })
}

/** GET /api/market/vcone/universe at one of the cone's horizons. */
export function volConeUniverse(query: URLSearchParams): Answer<Schemas['VolConeUniverse']> {
  const horizon = intParam(query, 'horizon', DEFAULT_HORIZON)
  return horizon !== null && (HORIZON_LIST as readonly number[]).includes(horizon)
    ? served({ ...makeSmall(horizon), gate: DEMO_GATE })
    : NOT_IN_DEMO
}

/** GET /api/market/paper-rolls: the captured schedule, for the window it was captured with. */
export function paperRolls(query: URLSearchParams): Answer<Schemas['PaperRollSchedule']> {
  const behind = intParam(query, 'behind', PAPER_DEFAULT.behind)
  const ahead = intParam(query, 'ahead', PAPER_DEFAULT.ahead)
  const past = PAPER.rows.filter((r) => r.status === 'past').length
  const upcoming = PAPER.rows.filter((r) => r.status === 'upcoming').length
  return behind === past && ahead === upcoming ? served(PAPER) : NOT_IN_DEMO
}

/** The request the study answers, under the API's parameter names. */
const STUDY_REQUEST: Readonly<Record<keyof typeof STUDY_DEFAULT, string | number>> = {
  symbol: STUDY.symbol, event: STUDY.event_type, mode: STUDY.mode, pre: STUDY.pre, post: STUDY.post,
}

/** GET /api/events/study: the one study the dataset holds, for exactly its symbol, event, mode and window. */
export function eventStudy(query: URLSearchParams): Answer<Schemas['EventStudy']> {
  // Each parameter is read by its key in STUDY_DEFAULT, an absent one taking the API's default.
  const keys = Object.keys(STUDY_DEFAULT) as (keyof typeof STUDY_DEFAULT)[]
  const same = keys.every((key) => {
    const fallback = STUDY_DEFAULT[key]
    const asked = typeof fallback === 'number' ? intParam(query, key, fallback) : query.get(key) ?? fallback
    return asked === STUDY_REQUEST[key]
  })
  return same ? served(STUDY) : NOT_IN_DEMO
}

/** GET /api/seasonality/instrument/{root}: the one body the dataset holds, for its root, years and variant. */
export function instrumentSeasonality(root: string, query: URLSearchParams): Answer<Schemas['Seasonality']> {
  const start = intParam(query, 'start_year', SEAS_DEFAULT_YEARS.start)
  const end = intParam(query, 'end_year', SEAS_DEFAULT_YEARS.end)
  const variant = query.get('variant') ?? SEASONALITY.variant
  const same = `${root}.V.0` === SEASONALITY.subject && start === SEASONALITY.start_year && end === SEASONALITY.end_year
    && variant === SEASONALITY.variant
  return same ? served(SEASONALITY) : NOT_IN_DEMO
}
