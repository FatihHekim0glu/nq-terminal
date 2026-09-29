// The demo dataset over HTTP, for the offline Playwright project (roadmap #18). The in-page demo
// (src/demo/boot.tsx, fetch.ts) answers /api inside the browser, so Playwright's page.on('request'), page.route
// and page.request never see that traffic. e2e/offline/vite.offline.config.ts therefore serves the gallery build
// with this module answering GET /api/* in Node, from the same route table (src/demo/routes.ts), so a spec sees
// real requests and responses.
//
// This module is pure: a method and a request target in, a status, headers and JSON text out, plus the stream's
// frames. It imports nothing from Node, so tsc -b types it under the app config, and no module of the app
// imports it (serve.test.ts scans for that), so no build carries it. Only the offline preview config and tests
// use it.
//
// Same rules as the in-page demo: GET only (any other method is answered 405 without being quoted), and a
// request the dataset has no honest body for answers 404 with the refusal header, so a spec can tell that the
// demo declined it from a page bug or a wrong path.
import { API_PREFIX } from '../api/client'
import { LIVE_STREAM, type StreamEvent } from '../api/liveStream'
import { DEMO_DETAIL } from './data/text'
import { answerDemo } from './routes'
import { DEMO_STREAM, demoStreamOpening } from './stream'

export { demoStreamOpening }

/** The response header that marks a 404 the demo dataset owns: e2e/target.ts restates it (serve.test.ts pins equality). */
export const DEMO_REFUSAL_HEADER = 'x-nqt-demo'
export const DEMO_REFUSAL_VALUE = 'not-in-dataset'

/** The one method the demo answers, and the only one this module names. */
const GET = 'GET'

/** What the demo says to any other method; it never repeats the method. */
export const DEMO_GET_ONLY = 'the demo answers GET only'

export interface DemoHttpAnswer {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** JSON text. */
  readonly body: string
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const

/** The path and query of a request target in origin form; null for anything else (absolute, `//host`, empty). */
function splitTarget(target: string): { readonly path: string; readonly query: string } | null {
  if (!target.startsWith('/') || target.startsWith('//')) return null
  const cut = target.indexOf('?')
  return cut < 0 ? { path: target, query: '' } : { path: target.slice(0, cut), query: target.slice(cut + 1) }
}

/** Whether a request target is /api or under /api/ (with or without a query): the demo's, and nothing else's. */
export function isDemoApiTarget(target: string): boolean {
  const parts = splitTarget(target)
  return parts !== null && (parts.path === API_PREFIX || parts.path.startsWith(`${API_PREFIX}/`))
}

/**
 * The demo's answer to `method` on the request target `target` (path and query, as the request line spells
 * it), or null when the path is not /api or /api/*: the static server answers that. Any method but GET is
 * refused with 405 and `allow: GET`; a GET is answered from the route table.
 */
export function answerDemoHttp(method: string, target: string): DemoHttpAnswer | null {
  const parts = splitTarget(target)
  if (parts === null || !isDemoApiTarget(target)) return null
  if (method !== GET) {
    return { status: 405, headers: { ...JSON_HEADERS, allow: GET }, body: JSON.stringify({ detail: DEMO_GET_ONLY }) }
  }
  const { status, body } = answerDemo(parts.path, new URLSearchParams(parts.query))
  // A refusal is the bare text or the text followed by what the dataset does hold (a designed tear sheet gap).
  const detail = (body as { detail?: unknown } | null)?.detail
  const refused = status >= 400 && typeof detail === 'string' && detail.startsWith(DEMO_DETAIL.notInDemo)
  return {
    status,
    headers: refused ? { ...JSON_HEADERS, [DEMO_REFUSAL_HEADER]: DEMO_REFUSAL_VALUE } : { ...JSON_HEADERS },
    body: JSON.stringify(body),
  }
}

/** Loopback peers, as Node's socket reports them (IPv4, IPv6, and IPv4 mapped into IPv6). */
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
/** Sec-Fetch-Site values of a request the page (or the address bar) made itself. */
const OWN_SITE: ReadonlySet<string> = new Set(['same-origin', 'none'])

/**
 * Whether the offline demo API answers a request from `remoteAddress` carrying this Sec-Fetch-Site header:
 * a loopback peer only, and a browser request only when it says it is same-origin or a navigation ('none').
 * No header at all (curl, Playwright's request fixture) is allowed; a repeated header is not.
 */
export function demoPeerAllowed(remoteAddress: string | undefined, secFetchSite: string | readonly string[] | undefined): boolean {
  if (remoteAddress === undefined || !LOOPBACK_PEERS.has(remoteAddress)) return false
  return secFetchSite === undefined || (typeof secFetchSite === 'string' && OWN_SITE.has(secFetchSite))
}

/** Whether a request target is the live stream (the one route served as server-sent events): exactly its path, no query. */
export function isDemoStreamPath(target: string): boolean {
  return target === LIVE_STREAM.path
}

/** One server-sent event as the wire carries it. JSON text is a single line, so the data field never breaks. */
export function sseFrame(event: StreamEvent, id: number): string {
  return `id: ${id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

/** The heartbeat the stream sends every DEMO_STREAM.heartbeatS seconds, stamped with `now`. */
export function heartbeatEvent(now: Date): StreamEvent {
  return { kind: 'heartbeat', interval_s: DEMO_STREAM.heartbeatS, utc: now.toISOString() }
}
