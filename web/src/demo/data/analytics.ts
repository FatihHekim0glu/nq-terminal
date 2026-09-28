// Analytics bodies of the demo dataset: the fixture backend's answers captured 2026-09-27
// (screens/tear/tear.fixtures.ts and tearP1.fixtures.ts, screens/runs/runs.fixtures.ts, screens/des/desTestData.ts,
// screens/live/trackingFixtures.ts). Series views are keyed by the context each body declares (kind, name, cost,
// freq) and run books by the run id each body carries, so a request is answered only by a body about exactly
// what it asked for; anything else is the honest 404. Nothing here is computed.
import type { Schemas } from '../../api/types'
import { PANEL as HYPOTHESIS_PANEL } from '../../screens/des/desTestData'
import { TRACKING_POPULATED } from '../../screens/live/trackingFixtures'
import { PANEL_DTSMOM } from '../../screens/runs/runs.fixtures'
import { BOOK_TRADES, NO_EXPOSURE, RUN_ANALYTICS, RUN_COSTS, RUN_EXPOSURE, RUN_TRADES, SMOKE_ANALYTICS } from '../../screens/tear/tear.fixtures'
import {
  EXCURSIONS, EXCURSIONS_DAILY, HYP_ANALYTICS, HYP_BOOTSTRAP, HYP_EXTENDED, RUN_EXTENDED, TRADE_PATHS,
} from '../../screens/tear/tearP1.fixtures'
import { intParam } from './answer'

type Context = Schemas['Context']

/** The API's defaults: a hypothesis at 1 tick per side, a run one row per session (api/analytics.py). */
const DEFAULT_COST = 1
const DEFAULT_FREQ = 'D'

function contextKey(kind: Context['kind'], name: string, cost: number | null, freq: string): string {
  return `${kind}|${name}|${cost ?? '-'}|${freq}`
}

function byContext<T extends { readonly context: Context }>(bodies: readonly T[]): ReadonlyMap<string, T> {
  return new Map(bodies.map((body) => {
    const c = body.context
    return [contextKey(c.kind, c.name, c.cost, c.freq), body]
  }))
}

function byRun<T extends { readonly run_id: string }>(bodies: readonly T[]): ReadonlyMap<string, T> {
  return new Map(bodies.map((body) => [body.run_id, body]))
}

export const ANALYTICS = byContext<Schemas['Analytics']>([HYP_ANALYTICS, RUN_ANALYTICS, SMOKE_ANALYTICS])
export const PANELS = byContext<Schemas['HomePanel']>([HYPOTHESIS_PANEL, PANEL_DTSMOM])
export const EXTENDED = byContext<Schemas['ExtendedAnalytics']>([HYP_EXTENDED, RUN_EXTENDED])
export const BOOTSTRAP = byContext<Schemas['BootstrapView']>([HYP_BOOTSTRAP])

export const TRADES = byRun<Schemas['RunTrades']>([RUN_TRADES, BOOK_TRADES])
export const COSTS = byRun<Schemas['RunCosts']>([RUN_COSTS])
export const EXPOSURE = byRun<Schemas['RunExposure']>([RUN_EXPOSURE, NO_EXPOSURE])
export const TRADE_PATH_VIEWS = byRun<Schemas['RunTradePaths']>([TRADE_PATHS])
export const EXCURSION_VIEWS = byRun<Schemas['RunExcursions']>([EXCURSIONS, EXCURSIONS_DAILY])

/** LV5 over the fixture book journal (the only journal it names). */
export const PAPER_TRACKING: Schemas['PaperTracking'] = TRACKING_POPULATED

/** The key a hypothesis GET asks for (its ?cost, 1 when absent), or null when the cost is malformed. */
export function hypothesisKey(name: string, query: URLSearchParams): string | null {
  const cost = intParam(query, 'cost', DEFAULT_COST)
  return cost === null ? null : contextKey('hypothesis', name, cost, DEFAULT_FREQ)
}

/** The key a run GET asks for (its ?freq, D when absent). */
export function runKey(runId: string, query: URLSearchParams): string {
  return contextKey('run', runId, null, query.get('freq') ?? DEFAULT_FREQ)
}
