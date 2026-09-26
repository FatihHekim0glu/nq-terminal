// Typed fetch client for the terminal API (ARCHITECTURE section 4). Read only by construction:
// - GET only: there is no other method anywhere in src/api (a test scans the sources);
// - same origin only: relative URLs under /api, `mode: 'same-origin'`, redirects refused;
// - every request carries the X-NQT-Client header, so the backend can tell its own client apart;
// - errors come back as ApiError with the contract's ErrorDetail body when the server sent one.
import type { ApiPath, ErrorDetail, GetArgs, GetOptions, SuccessOf } from './types'

export const API_PREFIX = '/api'
export const CLIENT_HEADER = 'X-NQT-Client'
export const CLIENT_ID = 'nq-lab-terminal'
const DETAIL_TEXT_LIMIT = 300

export type ApiErrorKind = 'http' | 'network' | 'decode' | 'refused'

interface ApiErrorInit {
  readonly kind: ApiErrorKind
  readonly path: string
  readonly status?: number
  readonly body?: ErrorDetail | null
  readonly detail: string
  readonly cause?: unknown
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  /** HTTP status; 0 when no response arrived (network) or nothing was sent (refused). */
  readonly status: number
  readonly path: string
  /** The contract's ErrorDetail body when the server sent one, otherwise null. */
  readonly body: ErrorDetail | null
  /** A readable message: the server's detail, the validation messages, or the plain-text refusal. */
  readonly detail: string

  constructor(init: ApiErrorInit) {
    super(`${init.kind} ${init.status ?? 0} ${init.path}: ${init.detail}`, { cause: init.cause })
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status ?? 0
    this.path = init.path
    this.body = init.body ?? null
    this.detail = init.detail
  }
}

type ParamValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>

interface UrlRequest {
  readonly path?: Readonly<Record<string, unknown>>
  readonly query?: Readonly<Record<string, unknown>>
}

function refuse(path: string, detail: string): ApiError {
  return new ApiError({ kind: 'refused', path, detail })
}

function checkTemplate(template: string): void {
  const underApi = template === API_PREFIX || template.startsWith(`${API_PREFIX}/`)
  if (!underApi || template.includes('//') || /(^|\/)\.\.?(\/|$)/.test(template)) {
    throw refuse(template, 'only same-origin paths under /api are fetched')
  }
}

function pathSegment(template: string, name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw refuse(template, `missing path parameter ${name}`)
  }
  const text = String(value)
  if (text === '' || text === '.' || text === '..') {
    throw refuse(template, `path parameter ${name} may not be empty, "." or ".."`)
  }
  return encodeURIComponent(text)
}

function appendQuery(search: URLSearchParams, key: string, value: ParamValue): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value as ReadonlyArray<string | number | boolean>) search.append(key, String(item))
    return
  }
  search.append(key, String(value))
}

/** The relative URL for a GET on `template`, with path parameters encoded and undefined query values dropped. */
export function buildApiUrl(template: string, request: UrlRequest): string {
  checkTemplate(template)
  const filled = template.replace(/\{([^}]+)\}/g, (_, name: string) =>
    pathSegment(template, name, request.path?.[name]),
  )
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(request.query ?? {})) appendQuery(search, key, value as ParamValue)
  const query = search.toString()
  return query ? `${filled}?${query}` : filled
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  if (value === null || typeof value !== 'object' || !('detail' in value)) return false
  const detail = (value as { detail: unknown }).detail
  return typeof detail === 'string' || Array.isArray(detail)
}

function detailText(body: ErrorDetail): string {
  if (typeof body.detail === 'string') return body.detail
  const messages = body.detail.map((item) => (typeof item.msg === 'string' ? item.msg : JSON.stringify(item)))
  return messages.join('; ')
}

async function httpError(url: string, response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  const body = isErrorDetail(parsed) ? parsed : null
  const fallback = text.trim().slice(0, DETAIL_TEXT_LIMIT) || response.statusText || `HTTP ${response.status}`
  return new ApiError({ kind: 'http', path: url, status: response.status, body, detail: body ? detailText(body) : fallback })
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function send(url: string, options: GetOptions): Promise<Response> {
  try {
    return await globalThis.fetch(url, {
      method: 'GET',
      mode: 'same-origin',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/json', [CLIENT_HEADER]: CLIENT_ID },
      signal: options.signal,
    })
  } catch (error) {
    if (isAbort(error)) throw error
    const detail = error instanceof Error ? error.message : 'the request failed'
    throw new ApiError({ kind: 'network', path: url, detail, cause: error })
  }
}

/** GET a contract path. Resolves with the typed 200 body; rejects with ApiError otherwise. */
export async function apiGet<P extends ApiPath>(path: P, ...args: GetArgs<P>): Promise<SuccessOf<P>> {
  const [request, options] = args
  const url = buildApiUrl(path, (request ?? {}) as UrlRequest)
  const response = await send(url, options ?? {})
  if (!response.ok) throw await httpError(url, response)
  try {
    return (await response.json()) as SuccessOf<P>
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError({ kind: 'decode', path: url, status: response.status, detail: 'the response was not valid JSON', cause: error })
  }
}

const WRITE_METHOD = /(['"`])(post|put|patch|delete)\1/gi
const FETCH_CALL = /\bfetch\s*\(/
// Other ways a page can reach the network; none belongs anywhere in the terminal.
const OTHER_CHANNELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsendBeacon\s*\(/, 'sendBeacon'],
  [/\bnew\s+XMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+Request\s*\(/, 'new Request'],
  [/\bnew\s+EventSource\b/, 'EventSource'],
  [/\bnew\s+WebSocket\b/, 'WebSocket'],
]

/**
 * Source scan used by the GET-only test over every module under src: quoted write methods (any
 * case) anywhere, fetch outside src/api/client.ts, and every other request channel.
 */
export function findWriteRequests(file: string, source: string): string[] {
  const methods = [...source.matchAll(WRITE_METHOD)].map((m) => `${file}: write method ${(m[2] ?? '').toUpperCase()}`)
  const strayFetch = !file.endsWith('/api/client.ts') && FETCH_CALL.test(source) ? [`${file}: calls fetch directly`] : []
  const channels = OTHER_CHANNELS.filter(([pattern]) => pattern.test(source)).map(([, name]) => `${file}: uses ${name}`)
  return [...methods, ...strayFetch, ...channels]
}
