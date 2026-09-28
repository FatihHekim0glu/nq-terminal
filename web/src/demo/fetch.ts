// The demo's replacement for the page's fetch, in demo builds only: src/demo/boot.tsx installs it by assignment.
// While the demo runs every request of the page comes through here, so it is narrower than the browser's:
//   GET only: any other method is refused before anything else looks at the request;
//   same origin only: another origin (the real backend on 127.0.0.1:8765 included), blob: and data: URLs
//     are refused;
//   every path starting with /api is answered in the browser from the demo route table (src/demo/routes.ts)
//     as JSON, after a seeded 20 to 120 ms delay, so loading states show as they would against a local
//     server; this matches Vite's own dev and preview proxy rule (server.proxy, a plain string prefix), so
//     no /api-prefixed path can escape to the real backend under `vite preview`;
//   any other same-origin GET (the fonts, the pivot engine's WebAssembly through fetchAsset) goes to the
//     page's own fetch, saved before the demo replaced it, as one canonical same-origin GET (no redirect
//     followed, no caller headers, the caller's own AbortSignal kept).
// A refusal rejects with a TypeError, as the browser's network errors do. An aborted signal rejects with
// the signal's reason (an AbortError), and a route that throws answers 500 with an ErrorDetail.
import { mulberry32 } from '../gallery/fixtures'
import { API_PREFIX } from '../api/client'
import { answerDemo } from './routes'

type Fetch = typeof globalThis.fetch

export const DEMO_DELAY_MS = { min: 20, max: 120 } as const

/** The seed the demo boot uses, so every run of the demo waits the same. */
const DEMO_DELAY_SEED = 20211231

export interface DemoFetchOptions {
  /** The page's own fetch, saved before the demo replaced it: same-origin GETs outside /api go to it. */
  readonly passThrough: Fetch
  /** The page's origin: the only one served. */
  readonly origin: string
  readonly seed?: number
}

/** Whole milliseconds from DEMO_DELAY_MS.min to DEMO_DELAY_MS.max inclusive, the same sequence per seed. */
export function demoDelays(seed: number): () => number {
  const rand = mulberry32(seed)
  const span = DEMO_DELAY_MS.max - DEMO_DELAY_MS.min + 1
  return () => DEMO_DELAY_MS.min + Math.floor(rand() * span)
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  throw new TypeError('the demo answers a URL string, a URL or a Request only')
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  if (typeof method !== 'string') throw new TypeError('the demo answers a string method only')
  return method.toUpperCase()
}

function requestSignal(input: RequestInfo | URL, init: RequestInit | undefined): AbortSignal | null {
  return init?.signal ?? (input instanceof Request ? input.signal : null)
}

/** The URL resolved against the page, or null when it is not an http(s) URL of the page's own origin. */
function sameOrigin(url: string, origin: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url, `${origin}/`)
  } catch {
    return null
  }
  const web = parsed.protocol === 'http:' || parsed.protocol === 'https:'
  return web && parsed.origin === origin ? parsed : null
}

/** Vite's own proxy rule (server.proxy and preview.proxy): a plain string prefix, nothing more specific. */
function isApiPath(pathname: string): boolean {
  return pathname.startsWith(API_PREFIX)
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function answer(pathname: string, search: URLSearchParams): { status: number; body: unknown } {
  try {
    return answerDemo(pathname, search)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: 500, body: { detail: `the demo route failed: ${message}` } }
  }
}

/** Resolves after `ms`, or rejects with the signal's reason once it aborts; no timer outlives either. */
function wait(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(this: AbortSignal): void {
      clearTimeout(timer)
      reject(abortReason(this))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createDemoFetch(options: DemoFetchOptions): Fetch {
  const nextDelay = demoDelays(options.seed ?? DEMO_DELAY_SEED)
  return async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Compared to GET alone: no other method name is written anywhere in the terminal (client.test.ts).
    if (requestMethod(input, init) !== 'GET') throw new TypeError('the demo answers GET only')
    const url = sameOrigin(requestUrl(input), options.origin)
    if (url === null) throw new TypeError('the demo answers same-origin http(s) requests only')
    const signal = requestSignal(input, init)
    if (!isApiPath(url.pathname)) {
      // Forward only the checked, canonical request: same origin, no redirect followed, no caller headers.
      return options.passThrough(url.href, {
        method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: signal ?? undefined,
      })
    }
    if (signal?.aborted) throw abortReason(signal)
    const { status, body } = answer(url.pathname, url.searchParams)
    await wait(nextDelay(), signal)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
}
