// Pure checks behind the safety and rule flows (TASKS 8.1; ARCHITECTURE section 9). They take plain
// data (names, request records, response bodies) so e2e/flows/scan.spec.ts can show each one fails on
// a planted bad case before the flows trust it (the nq-lab project rules, rule 5: born failing).

/** The acceptance pattern, `order|submit|cancel|modify`, applied to each word of a name. */
export const ACTION_PATTERN = /^(order|submit|cancel|modif)/i

/**
 * The words of a route, file or component name: path segments, dots, dashes and underscores split,
 * then camelCase and PascalCase split. `LiveOrdersPanel` gives Live, Orders, Panel; `/api/live/orders`
 * gives api, live, orders. A word matches when it starts with one of the action stems, so `orders`,
 * `submitted`, `cancelled` and `modified` match while `border` and `recorder` do not.
 */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

export function isActionName(name: string): boolean {
  return nameWords(name).some((w) => ACTION_PATTERN.test(w))
}

/** Each `source: name` whose name reads as a trading action, sorted, for one readable failure. */
export function actionNames(named: ReadonlyArray<readonly [source: string, name: string]>): string[] {
  const hits = named.filter(([, name]) => isActionName(name)).map(([source, name]) => `${source}: ${name}`)
  return [...new Set(hits)].sort()
}

/** A built chunk's module name without its content hash: `LiveScreen-Ab12Cd.js` gives `LiveScreen`. */
export function chunkName(pathname: string): string {
  const file = pathname.split('/').pop() ?? pathname
  const stem = file.replace(/\.(m?js|css|woff2?|ttf|svg|png|map)$/i, '')
  const dash = stem.lastIndexOf('-')
  return dash > 0 ? stem.slice(0, dash) : stem
}

export interface OpenApiDoc {
  readonly paths: Readonly<Record<string, Readonly<Record<string, { readonly operationId?: string }>>>>
  readonly components?: { readonly schemas?: Readonly<Record<string, unknown>> }
}

const HTTP_METHODS = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace'])

/** Route paths, operation ids and schema (component) names of an OpenAPI document. */
export function openApiNames(doc: OpenApiDoc): Array<readonly [string, string]> {
  const named: Array<readonly [string, string]> = []
  for (const [path, item] of Object.entries(doc.paths)) {
    named.push(['route', path])
    for (const [method, op] of Object.entries(item)) {
      if (HTTP_METHODS.has(method) && op.operationId) named.push(['operation', op.operationId])
    }
  }
  for (const schema of Object.keys(doc.components?.schemas ?? {})) named.push(['schema', schema])
  return named
}

/** Every `METHOD path` in an OpenAPI document other than GET (HEAD is answered for GET routes). */
export function writeOperations(doc: OpenApiDoc): string[] {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item).filter((m) => HTTP_METHODS.has(m) && m !== 'get').map((m) => `${m.toUpperCase()} ${path}`),
  )
}

export interface RequestRecord {
  readonly method: string
  readonly url: string
}

/** Requests that are not a GET to the page's own origin. */
export function nonGetRequests(requests: readonly RequestRecord[], origin: string): string[] {
  return requests
    .filter((r) => r.method !== 'GET' || new URL(r.url).origin !== origin)
    .map((r) => `${r.method} ${r.url}`)
}

/** The in-sample fence: served price points stop before 2022-01-01 00:00 UTC. */
export const FENCE_SECONDS = Date.UTC(2022, 0, 1) / 1000
export const LAST_IN_SAMPLE_DATE = '2021-12-31'

// Keys that hold served points (bar times, session dates). Request bounds such as `end` (exclusive,
// so it may read 2022-01-01) and labels are not points and are left out.
const TIME_KEYS = new Set(['t'])
const DATE_KEYS = new Set(['date', 'dates', 'sessions', 'last_date', 'as_of', 'hi_date', 'lo_date'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
const MS_THRESHOLD = 1e11

function timePastFence(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const seconds = value > MS_THRESHOLD ? value / 1000 : value
  return seconds >= FENCE_SECONDS
}

function datePastFence(value: unknown): boolean {
  return typeof value === 'string' && ISO_DATE.test(value) && value.slice(0, 10) > LAST_IN_SAMPLE_DATE
}

function pointsUnder(key: string, value: unknown, where: string, out: string[]): void {
  const values = Array.isArray(value) ? value : [value]
  const past = TIME_KEYS.has(key) ? values.filter(timePastFence) : DATE_KEYS.has(key) ? values.filter(datePastFence) : []
  if (past.length > 0) out.push(`${where}.${key}: ${past.length} point(s) past the fence, first ${String(past[0])}`)
}

/** Served price points after 2021-12-31 anywhere in a response body (bars and market answers). */
export function pointsPastFence(body: unknown, where = '$', out: string[] = []): string[] {
  if (Array.isArray(body)) {
    body.forEach((item, i) => pointsPastFence(item, `${where}[${i}]`, out))
  } else if (body !== null && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      pointsUnder(key, value, where, out)
      if (value !== null && typeof value === 'object') pointsPastFence(value, `${where}.${key}`, out)
    }
  }
  return out
}

/** Price endpoints: every point they serve must sit inside the in-sample window. */
export function isPriceEndpoint(pathname: string): boolean {
  return pathname === '/api/bars' || pathname.startsWith('/api/market/')
}

// Words that would make a control an order ticket. The CANCEL key is the terminal's Esc key (UI_SPEC
// section 5, Keys): a control may say "cancel" only when its name also names the Esc key.
const TICKET_WORD = /\b(orders?|submit\w*|modif\w*|buy|sell|transmit\w*|place order)\b/i
const ESC_ONLY_WORD = /\bcancel\w*\b/i
const ESC_KEY = /\bEsc\b/

/** Accessible names of controls that read as order-ticket actions. */
export function ticketControls(names: readonly string[]): string[] {
  return names.filter((n) => TICKET_WORD.test(n) || (ESC_ONLY_WORD.test(n) && !ESC_KEY.test(n)))
}
