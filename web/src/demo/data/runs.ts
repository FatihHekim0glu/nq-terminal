// Run bodies of the demo dataset: the fixture backend's answers for its six fixture runs
// (screens/runs/runs.fixtures.ts, captured 2026-09-27). Records, tables and log sections are keyed by the
// run id the body itself carries; a run without a captured body for a view answers the honest 404.
import type { Schemas } from '../../api/types'
import {
  COMPARE_STATS, DECISIONS_DTSMOM, DETAIL_DTSMOM, DETAIL_OVERNIGHT, DETAIL_UNBALANCED, FILLS_DTSMOM, LEDGER, NOTES_DTSMOM,
  ROLLS_DTSMOM, RUNS, TRADES_DTSMOM,
} from '../../screens/runs/runs.fixtures'
import { NOT_IN_DEMO, PAGE_LIMITS, intParam, served, type DemoBody, type DemoRefusal } from './answer'

export { COMPARE_STATS, LEDGER, RUNS }

type Page<T> = { readonly items: T[]; readonly offset: number; readonly limit: number; readonly total: number }
type LogPage = Schemas['Page_dict_str__Any__']

export const RUN_DETAILS: ReadonlyMap<string, Schemas['RunDetail']> = new Map(
  [DETAIL_DTSMOM, DETAIL_OVERNIGHT, DETAIL_UNBALANCED].map((detail) => [detail.summary.run_id, detail]),
)

const DTSMOM = DETAIL_DTSMOM.summary.run_id

export const RUN_TRADES: ReadonlyMap<string, Schemas['Page_TradeRow_']> = new Map([[DTSMOM, TRADES_DTSMOM]])
export const RUN_FILLS: ReadonlyMap<string, Schemas['Page_FillRow_']> = new Map([[DTSMOM, FILLS_DTSMOM]])
/** The captured log sections by run; the fixture run's snapshots and closes were not captured. */
const RUN_LOGS: ReadonlyMap<string, ReadonlyMap<string, LogPage>> = new Map([
  [DTSMOM, new Map([['decisions', DECISIONS_DTSMOM], ['notes', NOTES_DTSMOM], ['rolls', ROLLS_DTSMOM]])],
])

/** One page of a captured table, cut as the API cuts it: items[offset, offset + limit), total unchanged. */
export function repage<T>(page: Page<T> | undefined, query: URLSearchParams): DemoBody<Page<T>> | DemoRefusal {
  const offset = intParam(query, 'offset', 0)
  const limit = intParam(query, 'limit', PAGE_LIMITS.default)
  if (page === undefined || offset === null || limit === null || limit < 1 || limit > PAGE_LIMITS.max) return NOT_IN_DEMO
  const items = page.items.slice(offset, offset + limit)
  return served({ items, offset, limit, total: page.total })
}

/** One page of a run's log section, when the dataset holds that section. */
export function logPage(runId: string, section: string, query: URLSearchParams): DemoBody<LogPage> | DemoRefusal {
  return repage(RUN_LOGS.get(runId)?.get(section), query)
}

/** CompareStats of distinct listed runs, in the order asked; any id the dataset does not hold is a 404. */
export function compareStats(ids: string | null): DemoBody<Schemas['CompareStats'][]> | DemoRefusal {
  const wanted = (ids ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '')
  const found = wanted.map((id) => COMPARE_STATS.find((s) => s.run_id === id))
  if (wanted.length === 0 || new Set(wanted).size !== wanted.length || found.some((s) => s === undefined)) return NOT_IN_DEMO
  return served(found as Schemas['CompareStats'][])
}
