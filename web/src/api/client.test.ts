import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ApiError, CLIENT_HEADER, CLIENT_ID, apiGet, buildApiUrl, findWriteRequests, openEventStream } from './client'
import type { ApiPath, ErrorBodyOf, ErrorDetail } from './types'

// The whole front end, not just src/api: a screen that called fetch or opened a socket would be a
// second network path around the GET-only client.
const sources = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx', '!/src/**/*.d.ts'], {
  eager: true,
  query: '?raw',
  import: 'default',
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch(response: Response | Error) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (response instanceof Error) throw response
    return response
  })
}

function lastCall(spy: ReturnType<typeof stubFetch>): { url: string; init: RequestInit } {
  const call = spy.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called')
  return { url: String(call[0]), init: call[1] ?? {} }
}

describe('buildApiUrl', () => {
  it('fills path parameters with encoded values and appends defined query values', () => {
    const url = buildApiUrl('/api/runs/{run_id}/log/{section}', {
      path: { run_id: 'nt a/b', section: 'decisions' },
      query: { offset: 0, limit: 50, skipped: undefined, gone: null },
    })
    expect(url).toBe('/api/runs/nt%20a%2Fb/log/decisions?offset=0&limit=50')
  })

  it('returns a same-origin relative path with no query string when there is nothing to send', () => {
    expect(buildApiUrl('/api/health', {})).toBe('/api/health')
  })

  it.each(['', '.', '..'])('refuses the path parameter %j (it would climb out of the route)', (value) => {
    expect(() => buildApiUrl('/api/runs/{run_id}', { path: { run_id: value } })).toThrow(ApiError)
  })

  it('refuses a missing path parameter', () => {
    expect(() => buildApiUrl('/api/runs/{run_id}', { path: {} })).toThrow(/run_id/)
  })

  it.each(['/health', 'http://evil.example/api/health', '//evil.example/api/health', '/apix/health', '/api/../x'])(
    'refuses %j: only same-origin paths under /api are fetched',
    (template) => {
      expect(() => buildApiUrl(template, {})).toThrow(ApiError)
    },
  )
})

describe('apiGet', () => {
  it('sends a same-origin GET with the client header and returns the parsed body', async () => {
    const spy = stubFetch(jsonResponse({ now_utc: 'x' }))
    const body = await apiGet('/api/health')
    expect(body).toEqual({ now_utc: 'x' })
    const { url, init } = lastCall(spy)
    expect(url).toBe('/api/health')
    expect(init.method).toBe('GET')
    expect(init.mode).toBe('same-origin')
    expect(init.credentials).toBe('same-origin')
    expect(init.redirect).toBe('error')
    expect(init.body).toBeUndefined()
    const headers = new Headers(init.headers)
    expect(headers.get(CLIENT_HEADER)).toBe(CLIENT_ID)
    expect(headers.get('accept')).toBe('application/json')
  })

  it('passes path and query parameters through', async () => {
    const spy = stubFetch(jsonResponse({ items: [] }))
    await apiGet('/api/runs/{run_id}/trades', { path: { run_id: 'nt_x' }, query: { limit: 10 } })
    expect(lastCall(spy).url).toBe('/api/runs/nt_x/trades?limit=10')
  })

  it('turns a declared error into an ApiError carrying the typed ErrorDetail body', async () => {
    stubFetch(jsonResponse({ detail: 'unknown run_id' }, 404))
    const error = await apiGet('/api/runs/{run_id}', { path: { run_id: 'nope' } }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.kind).toBe('http')
    expect(apiError.status).toBe(404)
    expect(apiError.body).toEqual({ detail: 'unknown run_id' })
    expect(apiError.detail).toBe('unknown run_id')
    expect(apiError.path).toBe('/api/runs/nope')
  })

  it('joins the messages of a validation (422) detail list', async () => {
    stubFetch(jsonResponse({ detail: [{ msg: 'limit too large' }, { msg: 'offset negative' }] }, 422))
    const error = (await apiGet('/api/runs').catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(422)
    expect(error.detail).toBe('limit too large; offset negative')
  })

  it('keeps a plain-text refusal (the security middleware 403) as the detail, with no body', async () => {
    stubFetch(new Response('cross-site requests to the terminal API are refused', { status: 403 }))
    const error = (await apiGet('/api/health').catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(403)
    expect(error.body).toBeNull()
    expect(error.detail).toBe('cross-site requests to the terminal API are refused')
  })

  it('reports a network failure as kind "network" with status 0', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const error = (await apiGet('/api/health').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('network')
    expect(error.status).toBe(0)
  })

  it('reports an undecodable success body as kind "decode"', async () => {
    stubFetch(new Response('{"half": ', { status: 200, headers: { 'content-type': 'application/json' } }))
    const error = (await apiGet('/api/health').catch((e: unknown) => e)) as ApiError
    expect(error.kind).toBe('decode')
    expect(error.status).toBe(200)
  })

  it('lets an abort through unchanged so react-query can drop the request', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    stubFetch(abort)
    await expect(apiGet('/api/health')).rejects.toBe(abort)
  })

  it('refuses before fetching when a path is not under /api', async () => {
    const spy = stubFetch(jsonResponse({}))
    const notUnderApi = '/health' as ApiPath as '/api/health'
    await expect(apiGet(notUnderApi)).rejects.toBeInstanceOf(ApiError)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('openEventStream (TASKS 9.2)', () => {
  it('opens the live stream as a same-origin relative GET without credentials to another origin', () => {
    const made: Array<{ url: string; init: EventSourceInit | undefined }> = []
    class Recorder {
      constructor(url: string, init?: EventSourceInit) {
        made.push({ url, init })
      }
    }
    vi.stubGlobal('EventSource', Recorder)
    try {
      openEventStream('/api/live/stream')
      expect(made).toEqual([{ url: '/api/live/stream', init: { withCredentials: false } }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses a path outside /api before opening anything', () => {
    const spy = vi.fn()
    vi.stubGlobal('EventSource', spy)
    try {
      expect(() => openEventStream('//evil.example/api/live/stream' as '/api/live/stream')).toThrow(ApiError)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('answers null where the browser has no EventSource (the caller then polls)', () => {
    vi.stubGlobal('EventSource', undefined)
    try {
      expect(openEventStream('/api/live/stream')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('GET only (PRD G6, DL5)', () => {
  it('no module under src issues anything but GET, and only src/api/client.ts calls fetch', () => {
    const files = Object.keys(sources)
    expect(files).toContain('/src/api/client.ts')
    expect(files).toContain('/src/App.tsx')
    expect(files.some((f) => f.startsWith('/src/chrome/'))).toBe(true)
    // The demo replaces the page's fetch and EventSource (src/demo/boot.tsx): its modules are scanned too.
    expect(files).toEqual(expect.arrayContaining(['/src/demo/boot.tsx', '/src/demo/fetch.ts', '/src/demo/stream.ts']))
    const findings = Object.entries(sources).flatMap(([file, text]) => findWriteRequests(file, text))
    expect(findings).toEqual([])
  })

  it('born failing: the scan flags a write method and a stray fetch', () => {
    const bad = "fetch('/api/x', { method: 'POST' })\nconst m = \"DELETE\""
    const findings = findWriteRequests('./other.ts', bad)
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/POST/),
        expect.stringMatching(/DELETE/),
        expect.stringMatching(/fetch/),
      ]),
    )
  })

  it.each([
    ["fetch(u, { method: 'post' })", /POST/],
    ['const m = `patch`', /PATCH/],
    ['navigator.sendBeacon(u, body)', /sendBeacon/],
    ['const x = new XMLHttpRequest()', /XMLHttpRequest/],
    ["const r = new Request('/api/x')", /Request/],
    ["const s = new EventSource('/api/x')", /EventSource/],
    ["const w = new WebSocket('ws://x')", /WebSocket/],
    ["globalThis.fetch('/api/x')", /fetch/],
  ])('born failing: flags %s in a module other than the client', (snippet, pattern) => {
    expect(findWriteRequests('/src/screens/x/Screen.tsx', snippet)).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]))
  })

  it('lets the jobs client send a POST and a DELETE with fetch, and nothing else', () => {
    expect(findWriteRequests('/src/api/jobsClient.ts', "x = 'POST'; y = 'DELETE'; fetch(u)")).toEqual([])
    expect(findWriteRequests('/src/api/jobsClient.ts', 'globalThis.fetch(u, init)')).toEqual([])
  })

  it.each([
    ["const m = 'PUT'", /PUT/],
    ["const m = 'patch'", /PATCH/],
    ["const r = new Request('/api/jobs')", /Request/],
    ['navigator.sendBeacon(u, body)', /sendBeacon/],
    ['const x = new XMLHttpRequest()', /XMLHttpRequest/],
    ['const s = new EventSource(u)', /EventSource/],
    ["const w = new WebSocket('ws://x')", /WebSocket/],
  ])('born failing: still flags %s in the jobs client', (snippet, pattern) => {
    expect(findWriteRequests('/src/api/jobsClient.ts', snippet)).toEqual([expect.stringMatching(pattern)])
  })

  it('lets the session page call fetch to redeem its one-time code, and nothing else', () => {
    expect(findWriteRequests('/src/session/main.ts', 'request: (path, init) => fetch(path, init)')).toEqual([])
    expect(findWriteRequests('/src/session/main.ts', "const m = 'POST'")).toEqual([expect.stringMatching(/POST/)])
    expect(findWriteRequests('/src/session/main.ts', 'new EventSource(u)')).toEqual([expect.stringMatching(/EventSource/)])
  })

  it('born failing: the session allowance covers that one file only', () => {
    expect(findWriteRequests('/src/screens/x/main.ts', 'fetch(u)')).toEqual([expect.stringMatching(/fetch/)])
    expect(findWriteRequests('/src/session/redeem.ts', 'fetch(u)')).toEqual([expect.stringMatching(/fetch/)])
  })

  it('born failing: the jobs allowance covers that one file only, not a copy of it elsewhere', () => {
    const body = "x = 'POST'; y = 'DELETE'; fetch(u)"
    expect(findWriteRequests('/src/api/jobsClient2.ts', body)).toHaveLength(3)
    expect(findWriteRequests('/src/screens/jobs/jobsClient.ts', body)).toHaveLength(3)
    expect(findWriteRequests('/src/screens/jobs/JobsScreen.tsx', body)).toHaveLength(3)
    expect(findWriteRequests('./other.ts', body)).toHaveLength(3)
  })

  it('lets the client keep its own fetch, and still flags a write method there', () => {
    expect(findWriteRequests('/src/api/client.ts', 'globalThis.fetch(url, init)')).toEqual([])
    expect(findWriteRequests('/src/api/client.ts', "method: 'delete'")).toEqual([expect.stringMatching(/DELETE/)])
  })

  it('lets the client open the one event stream (a GET), and flags it anywhere else', () => {
    expect(findWriteRequests('/src/api/client.ts', "new EventSource(url)")).toEqual([])
    expect(findWriteRequests('/src/api/liveStream.ts', "new EventSource(url)")).toEqual([expect.stringMatching(/EventSource/)])
  })
})

describe('the demo import boundary', () => {
  /** Every module specifier a file imports or re-exports, relative ones resolved against `file`, kept only
   * when they resolve under /src/demo/ (a static import that would carry demo code past the lazy MODE gate). */
  function demoImports(file: string, text: string): string[] {
    const specs: string[] = []
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specs.push(m[1]!)
    for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!)
    for (const m of text.matchAll(/(^|[\n;{}])\s*import\s+['"]([^'"]+)['"]/g)) specs.push(m[2]!)
    return specs
      .filter((spec) => spec.startsWith('.'))
      .map((spec) => new URL(spec, `file://${file}`).pathname)
      .filter((resolved) => resolved.startsWith('/src/demo/'))
  }

  it('is never imported by app code outside src/demo, except the lazy boot in main.tsx', () => {
    for (const [file, text] of Object.entries(sources)) {
      if (file.startsWith('/src/demo/') || file === '/src/main.tsx') continue
      expect(demoImports(file, text), file).toEqual([])
    }
  })

  it("main.tsx reaches the demo only through the dynamic import('./demo/boot'), never a static import", () => {
    const text = sources['/src/main.tsx']!
    expect(demoImports('/src/main.tsx', text)).toEqual(['/src/demo/boot'])
    expect(text).not.toMatch(/\bfrom\s+['"]\.\/demo/)
  })

  it('born failing: flags a static import and a re-export that reach into src/demo from elsewhere', () => {
    expect(demoImports('/src/screens/x/Screen.tsx', "import { DemoEventSource } from '../../demo/stream'"))
      .toEqual(['/src/demo/stream'])
    expect(demoImports('/src/chrome/X.ts', "export { bars } from '../demo/data/market'"))
      .toEqual(['/src/demo/data/market'])
  })
})

describe('contract types (enforced by tsc -b)', () => {
  it('requires declared path parameters, rejects unknown paths and types the 200 body', async () => {
    stubFetch(jsonResponse({ kill_switch_on: false }))
    // @ts-expect-error run_id is a required path parameter
    await apiGet('/api/runs/{run_id}').catch(() => undefined)
    // @ts-expect-error the contract has no such GET path
    await apiGet('/api/nothing-here').catch(() => undefined)
    expectTypeOf(apiGet<'/api/health'>).returns.resolves.toHaveProperty('kill_switch_on')
    expectTypeOf<ErrorBodyOf<'/api/runs/{run_id}'>>().toEqualTypeOf<ErrorDetail>()
  })
})
