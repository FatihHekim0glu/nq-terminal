// The demo dataset's route table (demo builds only; src/demo/fetch.ts answers same-origin /api GETs from it).
// DEMO_ROUTES has one handler per contract GET, typed over ApiPath, so the table cannot lose a path without a
// compile error, and each handler returns the contract's success body for its path or a refusal. Bodies come
// from the captured fixture modules and the few built in src/demo/data; a path, id or request the dataset has
// no honest body for answers 404 'not in the demo dataset', never another body relabelled.
import type { ApiPath, RequestOf } from '../api/types'
import { NOT_IN_DEMO, refuse, served, servedOr, type DemoAnswer } from './data/answer'
import {
  ANALYTICS, BOOTSTRAP, COSTS, EXCURSION_VIEWS, EXPOSURE, EXTENDED, PANELS, PAPER_TRACKING, TRADES, TRADE_PATH_VIEWS,
  hypothesisKey, runKey, servedOrGap,
} from './data/analytics'
import { OPENINGS, oosLog } from './data/audit'
import { runComparison } from './data/compare'
import { LIVE_PERFORMANCE, LIVE_ROUTES, demoLiveStatus, forBookJournal, journalPage } from './data/live'
import { INSTRUMENTS, bars, catalog, marketUniverse, pairCorrelation, realisedVol, twoDay } from './data/market'
import {
  EVENT_CALENDAR, ROLL_CALENDAR, eventStudy, instrumentSeasonality, paperRolls, volCone, volConeUniverse,
} from './data/p1'
import {
  CONFIRMATIONS, DEFLATED, HYPOTHESES, HYPOTHESIS_DETAILS, MULTIPLE_TESTING, REGISTRY, SEALED_INDEX,
} from './data/research'
import { LEDGER, RUNS, RUN_DETAILS, RUN_FILLS, RUN_TRADES, compareStats, logPage, repage } from './data/runs'
import { COMMAND_INDEX, health } from './data/system'
import { IB_OFF, JOBS_OFF } from './data/p2'
import { DEMO_DETAIL } from './data/text'

export type { DemoAnswer }

/** A path's parameters as the URL carries them, decoded; none for a path without any. */
export type DemoParams<P extends ApiPath> = RequestOf<P> extends { path: infer T }
  ? { readonly [K in keyof T]: string }
  : Readonly<Record<string, never>>

export interface DemoRequest<P extends ApiPath> {
  readonly params: DemoParams<P>
  readonly query: URLSearchParams
}

export type DemoHandler<P extends ApiPath> = (request: DemoRequest<P>) => DemoAnswer<P>

/** One handler for every contract GET: deleting any one is a compile error. */
export type DemoRoutes = { readonly [P in ApiPath]: DemoHandler<P> }

/** What demo fetch sends: the status, and the success body or an ErrorDetail. */
export interface DemoResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * A hypothesis view at the cost the request names (1 tick when absent), by the context its body declares.
 * A tear sheet that was not captured answers the gap that names what was (N01); a malformed cost is the plain 404.
 */
function hypothesisView<T>(views: ReadonlyMap<string, T>, name: string, query: URLSearchParams) {
  const key = hypothesisKey(name, query)
  return key === null ? NOT_IN_DEMO : servedOrGap(views.get(key))
}

export const DEMO_ROUTES: DemoRoutes = {
  // System
  '/api/health': () => served(health(new Date())),
  '/api/commands': () => served(COMMAND_INDEX),

  // Research
  '/api/registry': () => served(REGISTRY),
  '/api/hypotheses': () => served(HYPOTHESES),
  '/api/hypotheses/{name}': ({ params }) => servedOr(HYPOTHESIS_DETAILS.get(params.name)),
  '/api/hypotheses/{name}/series': () => NOT_IN_DEMO,
  '/api/multiple-testing': () => served(MULTIPLE_TESTING),
  '/api/confirmations': () => served(CONFIRMATIONS),
  '/api/sealed': () => served(SEALED_INDEX),
  '/api/sealed/{name}': () => NOT_IN_DEMO,

  // Runs and the ledger
  '/api/runs': () => served(RUNS),
  '/api/runs/stats': ({ query }) => compareStats(query.get('ids')),
  '/api/runs/compare': ({ query }) => runComparison(query.get('ids')),
  '/api/runs/{run_id}': ({ params }) => servedOr(RUN_DETAILS.get(params.run_id)),
  '/api/runs/{run_id}/equity': () => NOT_IN_DEMO,
  '/api/runs/{run_id}/trades': ({ params, query }) => repage(RUN_TRADES.get(params.run_id), query),
  '/api/runs/{run_id}/fills': ({ params, query }) => repage(RUN_FILLS.get(params.run_id), query),
  '/api/runs/{run_id}/log/{section}': ({ params, query }) => logPage(params.run_id, params.section, query),
  '/api/runs/{run_id}/sidecar/{name}': () => NOT_IN_DEMO,
  '/api/ledger': () => served(LEDGER),

  // Market data (demo prices; nothing is read through a gate)
  '/api/bars': ({ query }) => bars(query),
  '/api/data/catalog': () => served(catalog()),
  '/api/market/universe': ({ query }) => marketUniverse(query),
  '/api/market/pair-corr': ({ query }) => pairCorrelation(query),
  '/api/market/rv': ({ query }) => realisedVol(query),
  '/api/market/two-day': ({ query }) => twoDay(query),
  '/api/market/vcone': ({ query }) => volCone(query),
  '/api/market/vcone/universe': ({ query }) => volConeUniverse(query),
  '/api/market/rolls': () => served(ROLL_CALENDAR),
  '/api/market/paper-rolls': ({ query }) => paperRolls(query),
  '/api/qa': () => NOT_IN_DEMO,
  '/api/qa/{name}': () => NOT_IN_DEMO,
  '/api/instruments/{root}': ({ params }) => servedOr(INSTRUMENTS.get(params.root)),

  // Analytics
  '/api/analytics/hypothesis/{name}': ({ params, query }) => hypothesisView(ANALYTICS, params.name, query),
  '/api/analytics/hypothesis/{name}/panel': ({ params, query }) => hypothesisView(PANELS, params.name, query),
  '/api/analytics/hypothesis/{name}/extended': ({ params, query }) => hypothesisView(EXTENDED, params.name, query),
  '/api/analytics/hypothesis/{name}/bootstrap': ({ params, query }) => hypothesisView(BOOTSTRAP, params.name, query),
  '/api/analytics/run/{run_id}': ({ params, query }) => servedOrGap(ANALYTICS.get(runKey(params.run_id, query))),
  '/api/analytics/run/{run_id}/panel': ({ params, query }) => servedOrGap(PANELS.get(runKey(params.run_id, query))),
  '/api/analytics/run/{run_id}/extended': ({ params, query }) => servedOrGap(EXTENDED.get(runKey(params.run_id, query))),
  '/api/analytics/run/{run_id}/bootstrap': ({ params, query }) => servedOrGap(BOOTSTRAP.get(runKey(params.run_id, query))),
  '/api/analytics/run/{run_id}/trades': ({ params }) => servedOrGap(TRADES.get(params.run_id)),
  '/api/analytics/run/{run_id}/costs': ({ params }) => servedOrGap(COSTS.get(params.run_id)),
  '/api/analytics/run/{run_id}/exposure': ({ params }) => servedOrGap(EXPOSURE.get(params.run_id)),
  '/api/analytics/run/{run_id}/trade-paths': ({ params }) => servedOrGap(TRADE_PATH_VIEWS.get(params.run_id)),
  '/api/analytics/run/{run_id}/excursions': ({ params }) => servedOrGap(EXCURSION_VIEWS.get(params.run_id)),
  '/api/analytics/deflated': () => served(DEFLATED),
  '/api/analytics/paper-tracking': ({ query }) => forBookJournal(PAPER_TRACKING, query.get('file')),

  // Audit
  '/api/audit/oos-log': ({ query }) => oosLog(query),
  '/api/audit/openings': () => served(OPENINGS),
  '/api/audit/spec-hashes': () => NOT_IN_DEMO,

  // Live (read only; the stream is src/demo/stream.ts)
  '/api/live/status': () => served(demoLiveStatus),
  '/api/live/journal': ({ query }) => journalPage(query),
  '/api/live/log': () => NOT_IN_DEMO,
  '/api/live/performance': ({ query }) => forBookJournal(LIVE_PERFORMANCE, query.get('file')),
  '/api/live/routes': ({ query }) => forBookJournal(LIVE_ROUTES, query.get('file')),
  '/api/live/stream': () => refuse(503, DEMO_DETAIL.streamOnly),

  // Seasonality and events
  '/api/seasonality/instrument/{root}': ({ params, query }) => instrumentSeasonality(params.root, query),
  '/api/seasonality/hypothesis/{name}': () => NOT_IN_DEMO,
  '/api/events/calendar': () => served(EVENT_CALENDAR),
  '/api/events/study': ({ query }) => eventStudy(query),

  // Data quality: the QA and repair records are not in the demo dataset
  '/api/dq/symbols': () => NOT_IN_DEMO,
  '/api/dq/calendar/{symbol}': () => NOT_IN_DEMO,
  '/api/dq/guards': () => NOT_IN_DEMO,

  // P2: the demo holds no body for these views; the queue and the IB snapshot answer as a server with both off
  '/api/analytics/hypothesis/{name}/risk-extras': () => NOT_IN_DEMO,
  '/api/analytics/run/{run_id}/risk-extras': () => NOT_IN_DEMO,
  '/api/analytics/hypothesis/{name}/trend-regime': () => NOT_IN_DEMO,
  '/api/analytics/run/{run_id}/trend-regime': () => NOT_IN_DEMO,
  '/api/analytics/run/{run_id}/capacity': () => NOT_IN_DEMO,
  '/api/analytics/spa': () => NOT_IN_DEMO,
  '/api/market/term-structure/{root}': () => NOT_IN_DEMO,
  '/api/ib/snapshot': () => served(IB_OFF),
  '/api/jobs': () => served(JOBS_OFF),
  '/api/jobs/{job_id}': () => NOT_IN_DEMO,
}

// ---------------------------------------------------------------- matching a URL to a template

interface Template {
  readonly path: ApiPath
  readonly parts: readonly string[]
  readonly literals: number
}

const PARAM = /^\{([^}]+)\}$/

/** Every template, those with more literal segments first, so /api/runs/stats wins over /api/runs/{run_id}. */
const TEMPLATES: readonly Template[] = (Object.keys(DEMO_ROUTES) as ApiPath[])
  .map((path) => {
    const parts = path.split('/')
    return { path, parts, literals: parts.filter((p) => !PARAM.test(p)).length }
  })
  .sort((a, b) => b.literals - a.literals)

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

type Match = { readonly path: ApiPath; readonly params: Readonly<Record<string, string>> } | { readonly path: ApiPath; readonly params: null }

/** The template a pathname (as the URL spells it) falls under, with its decoded parameters; null params when one is malformed. */
function match(pathname: string): Match | null {
  const segments = pathname.split('/')
  for (const template of TEMPLATES) {
    if (template.parts.length !== segments.length) continue
    const fits = template.parts.every((part, i) => PARAM.test(part) ? (segments[i] ?? '') !== '' : part === segments[i])
    if (!fits) continue
    const params: Record<string, string> = {}
    for (const [i, part] of template.parts.entries()) {
      const name = PARAM.exec(part)?.[1]
      if (name === undefined) continue
      const value = decode(segments[i] ?? '')
      if (value === null) return { path: template.path, params: null }
      params[name] = value
    }
    return { path: template.path, params }
  }
  return null
}

/**
 * The demo answer to a GET of `pathname` (percent-encoded, as the URL spells it) with `search`: a success body,
 * or an ErrorDetail `{detail}` the API client reads as the error's detail.
 */
export function answerDemo(pathname: string, search: URLSearchParams): DemoResponse {
  const hit = match(pathname)
  if (hit === null) return { status: 404, body: { detail: DEMO_DETAIL.unknownPath } }
  if (hit.params === null) return { status: NOT_IN_DEMO.status, body: { detail: NOT_IN_DEMO.detail } }
  // One cast at the table's edge: the matched template's own handler, with the parameters that template names.
  const handler = DEMO_ROUTES[hit.path] as unknown as (request: DemoRequest<ApiPath>) => DemoAnswer<ApiPath>
  const answer = handler({ params: hit.params as DemoParams<ApiPath>, query: search })
  return answer.status === 200 ? { status: 200, body: answer.body } : { status: answer.status, body: { detail: answer.detail } }
}
