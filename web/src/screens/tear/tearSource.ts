// The tear sheet's analytics GET paths, in one place. tearQueries.ts sends these requests (useTearAnalytics,
// useTearBootstrap, useTearExtended, useRunBooks, useRunPaths); the GRAB caption (W8 tearGrab) and the dossier
// name them as their source. Pure: it builds relative URLs with the client's own builder, so the path is
// encoded and refused the same way, and makes no request.
import { buildApiUrl } from '../../api/client'
import type { ApiPath } from '../../api/types'
import type { TearCode } from './TearSheet'
import type { TearTarget } from './tearQueries'

const RUN_ANALYTICS_PATH = '/api/analytics/run/{run_id}' satisfies ApiPath
const HYPOTHESIS_ANALYTICS_PATH = '/api/analytics/hypothesis/{name}' satisfies ApiPath
const RUN_BOOTSTRAP_PATH = '/api/analytics/run/{run_id}/bootstrap' satisfies ApiPath
const HYPOTHESIS_BOOTSTRAP_PATH = '/api/analytics/hypothesis/{name}/bootstrap' satisfies ApiPath
const RUN_EXTENDED_PATH = '/api/analytics/run/{run_id}/extended' satisfies ApiPath
const HYPOTHESIS_EXTENDED_PATH = '/api/analytics/hypothesis/{name}/extended' satisfies ApiPath
/** A run's books, in the order the run panel lists them (RunBooks, then RunTradePaths). */
const RUN_BOOK_PATHS = [
  '/api/analytics/run/{run_id}/trades',
  '/api/analytics/run/{run_id}/costs',
  '/api/analytics/run/{run_id}/exposure',
  '/api/analytics/run/{run_id}/excursions',
  '/api/analytics/run/{run_id}/trade-paths',
] as const satisfies readonly ApiPath[]

/** The setting each kind is asked at: a run its frequency, a hypothesis its cost in ticks per side. */
export interface TearSourceContext {
  readonly cost: number | null
  readonly freq: string | null
}

/**
 * The request the tear sheet sends for `target`: a run as `/api/analytics/run/{run_id}` with its freq, a
 * hypothesis as `/api/analytics/hypothesis/{name}` with its cost when it has one. The setting of the other
 * kind is ignored. An Analytics answer's own `context` fits `context`.
 */
export function tearAnalyticsPath(target: TearTarget, context: TearSourceContext): string {
  if (target.kind === 'run') {
    return buildApiUrl(RUN_ANALYTICS_PATH, { path: { run_id: target.name }, query: { freq: context.freq } })
  }
  return buildApiUrl(HYPOTHESIS_ANALYTICS_PATH, {
    path: { name: target.name },
    query: context.cost === null ? {} : { cost: context.cost },
  })
}

/** A sub-route of the tear sheet's own series: a run at its freq, a hypothesis at its cost (none when unknown). */
function seriesPath(target: TearTarget, context: TearSourceContext, run: ApiPath, hypothesis: ApiPath): string {
  if (target.kind === 'run') return buildApiUrl(run, { path: { run_id: target.name }, query: { freq: context.freq } })
  return buildApiUrl(hypothesis, { path: { name: target.name }, query: context.cost === null ? {} : { cost: context.cost } })
}

/** What the tab's figures were drawn from beyond the analytics answer (the flags are decided by the caller). */
export interface TearDrawn {
  /** EQ's cone (SV6): the series has enough observations for a bootstrap (bootstrapPossible). */
  readonly bootstrap: boolean
  /** EQ's and DD's market context, or RET's and RR's P1 cards: the /extended body has arrived. */
  readonly extended: boolean
}

/**
 * Every GET whose numbers the image of `tab` can hold, analytics first: the bootstrap cone on EQ, the /extended
 * body on EQ and DD (market context, when it arrived) and on RET and RR (their P1 cards, always asked), and, for a
 * run, its books on every tab (trades, costs, exposure, excursions, trade-paths). The sub-routes carry exactly the
 * query their hooks send: a hypothesis its cost when it has one, a run its freq. A tab that draws neither
 * ignores the flags.
 */
export function tearSources(target: TearTarget, tab: TearCode, context: TearSourceContext, drawn: TearDrawn): string[] {
  const paths = [tearAnalyticsPath(target, context)]
  if (tab === 'EQ' && drawn.bootstrap) paths.push(seriesPath(target, context, RUN_BOOTSTRAP_PATH, HYPOTHESIS_BOOTSTRAP_PATH))
  const asksExtended = tab === 'RET' || tab === 'RR'
  const showsExtended = tab === 'EQ' || tab === 'DD'
  if (asksExtended || (showsExtended && drawn.extended)) paths.push(seriesPath(target, context, RUN_EXTENDED_PATH, HYPOTHESIS_EXTENDED_PATH))
  if (target.kind === 'run') for (const book of RUN_BOOK_PATHS) paths.push(buildApiUrl(book, { path: { run_id: target.name } }))
  return paths
}
