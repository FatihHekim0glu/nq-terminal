// What a demo handler returns: a contract success body, or a refusal the demo fetch sends as an ErrorDetail.
// The statuses are the ones the backend uses for the same cases: 403 the gate's refusal, 404 an id or
// request the dataset does not hold, 503 a path that is not served over a plain GET.
import type { ApiPath, SuccessOf } from '../../api/types'
import { DEMO_DETAIL } from './text'

export interface DemoRefusal {
  readonly status: 403 | 404 | 503
  readonly detail: string
}

export interface DemoBody<T> {
  readonly status: 200
  readonly body: T
}

export type DemoAnswer<P extends ApiPath> = DemoBody<SuccessOf<P>> | DemoRefusal

export function served<T>(body: T): DemoBody<T> {
  return { status: 200, body }
}

export function refuse(status: DemoRefusal['status'], detail: string): DemoRefusal {
  return { status, detail }
}

export const NOT_IN_DEMO: DemoRefusal = refuse(404, DEMO_DETAIL.notInDemo)

/** The body when there is one, else the honest 404. */
export function servedOr<T>(body: T | undefined): DemoBody<T> | DemoRefusal {
  return body === undefined ? NOT_IN_DEMO : served(body)
}

// ---------------------------------------------------------------- query parameters

/** backend/nq_terminal/models/common.py DEFAULT_LIMIT and MAX_LIMIT: the rows of one page. */
export const PAGE_LIMITS = { default: 500, max: 5000 } as const

/** An ISO 8601 date or date-time in epoch ms, a value without an offset read as UTC (as the backend reads it); NaN when malformed. */
export function utcMs(text: string): number {
  const trimmed = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return Date.parse(`${trimmed}T00:00:00Z`)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) return Date.parse(`${trimmed.replace(' ', 'T')}Z`)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) return Date.parse(trimmed.replace(' ', 'T'))
  return Number.NaN
}

/** A whole number from the query (the API's integer parameters); `fallback` when absent, null when malformed. */
export function intParam(query: URLSearchParams, key: string, fallback: number): number | null {
  const text = query.get(key)
  if (text === null) return fallback
  return /^\d{1,9}$/.test(text) ? Number(text) : null
}
