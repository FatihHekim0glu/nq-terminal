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
import { NOT_IN_DEMO, intParam, refuse, served, type DemoBody, type DemoRefusal } from './answer'
import { HYPOTHESIS_DETAILS } from './research'
import { DEMO_DETAIL } from './text'

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

// ---------------------------------------------------------------- designed gaps (N01)

/**
 * The words of a tear sheet gap. The demo holds a tear sheet for very few contexts, so a refusal that only
 * said 'not in the demo dataset' left the reader at a dead end; this one goes on to name what does exist.
 * Words of the demo server, held to the copy rules by routes.test.ts.
 */
export const GAP_TEXT = {
  lead: 'Evidence in this demo:',
  hypotheses: '{names} DES, EQ and RET at {costs} per side',
  runs: 'run tear sheets for {names}',
  tick: 'tick',
  ticks: 'ticks',
  and: 'and',
  join: '; ',
} as const

/** 'a', 'a and b', 'a, b and c'. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${GAP_TEXT.and} ${items[items.length - 1]}`
}

/** The distinct values of `items`, in first-seen order. */
function distinct<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

/**
 * What the dataset really serves as a tear sheet, read from the bodies themselves so the hint cannot drift
 * from them: the hypotheses that have both a tear sheet and their DES card (with the costs the sheets were
 * captured at), and the runs that have a tear sheet.
 */
export function evidenceInDemo(): { readonly hypotheses: readonly string[]; readonly costs: readonly number[]; readonly runs: readonly string[] } {
  const contexts = [...ANALYTICS.values()].map((body) => body.context)
  const sheets = contexts.filter((c) => c.kind === 'hypothesis' && HYPOTHESIS_DETAILS.has(c.name))
  return {
    hypotheses: distinct(sheets.map((c) => c.name)),
    costs: distinct(sheets.flatMap((c) => (c.cost === null ? [] : [c.cost]))).sort((a, b) => a - b),
    runs: distinct(contexts.filter((c) => c.kind === 'run').map((c) => c.name)),
  }
}

/** The pointer sentence, or null when the dataset holds no tear sheet at all. */
export function evidenceHint(): string | null {
  const { hypotheses, costs, runs } = evidenceInDemo()
  const parts: string[] = []
  if (hypotheses.length > 0) {
    const unit = costs.length === 1 && costs[0] === 1 ? GAP_TEXT.tick : GAP_TEXT.ticks
    parts.push(GAP_TEXT.hypotheses.replace('{names}', list(hypotheses)).replace('{costs}', `${list(costs.map(String))} ${unit}`))
  }
  if (runs.length > 0) parts.push(GAP_TEXT.runs.replace('{names}', list(runs)))
  return parts.length === 0 ? null : `${GAP_TEXT.lead} ${parts.join(GAP_TEXT.join)}`
}

/**
 * The 404 of a tear sheet the dataset did not capture: the plain refusal first (the offline server and the
 * page recognise a designed gap by it), then where the evidence is. Only analytics bodies use it; a DES card,
 * a run record or a malformed request keeps the plain refusal.
 */
export function gap(): DemoRefusal {
  const hint = evidenceHint()
  return hint === null ? NOT_IN_DEMO : refuse(404, `${DEMO_DETAIL.notInDemo}. ${hint}`)
}

/** The body when there is one, else the gap that says what exists. */
export function servedOrGap<T>(body: T | undefined): DemoBody<T> | DemoRefusal {
  return body === undefined ? gap() : served(body)
}
