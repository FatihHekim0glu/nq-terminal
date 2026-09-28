// The demo's fetch (src/demo/fetch.ts): while the demo runs it is the page's only network door, so it is
// narrower than the browser's. GET only and same origin only; /api paths are answered in the browser from
// the demo route table (src/demo/routes.ts), and every other same-origin GET (fonts, the pivot engine's
// WebAssembly) goes to the page's own saved fetch. Each refusal is born failing: it must reach neither the
// route table nor the saved fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiGet } from '../api/client'
import { DEMO_DELAY_MS, createDemoFetch, demoDelays } from './fetch'
import { answerDemo } from './routes'

vi.mock('./routes', () => ({ answerDemo: vi.fn() }))

const ORIGIN = 'http://127.0.0.1:5174'
const answer = vi.mocked(answerDemo)

function setup() {
  const passThrough = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('asset', { status: 200 }))
  const demoFetch = createDemoFetch({ passThrough, origin: ORIGIN, seed: 1 })
  return { demoFetch, passThrough }
}

/** Runs the request to completion: every demo answer waits at most DEMO_DELAY_MS.max. */
async function settle(pending: Promise<Response>): Promise<Response> {
  await vi.advanceTimersByTimeAsync(DEMO_DELAY_MS.max)
  return pending
}

function lastAnswerCall(): { pathname: string; search: URLSearchParams } {
  const call = answer.mock.calls.at(-1)
  if (!call) throw new Error('the route table was not asked')
  return { pathname: call[0], search: call[1] }
}

beforeEach(() => {
  answer.mockReset()
  answer.mockReturnValue({ status: 200, body: { ok: true } })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('demoFetch answers /api from the route table', () => {
  it('answers a same-origin /api GET as JSON, after a delay within the demo range', async () => {
    const { demoFetch, passThrough } = setup()
    answer.mockReturnValue({ status: 200, body: { now_utc: '2021-12-31T21:00:00Z' } })
    let settled = false
    const pending = demoFetch('/api/health', { method: 'GET' }).then((r) => {
      settled = true
      return r
    })
    await vi.advanceTimersByTimeAsync(DEMO_DELAY_MS.min - 1)
    expect(settled).toBe(false)
    const response = await settle(pending)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ now_utc: '2021-12-31T21:00:00Z' })
    expect(lastAnswerCall().pathname).toBe('/api/health')
    expect(passThrough).not.toHaveBeenCalled()
  })

  it('hands the route table the pathname as the URL spells it, and the query', async () => {
    const { demoFetch } = setup()
    await settle(demoFetch('/api/runs/nt%20a%2Fb/log/decisions?offset=0&limit=50'))
    const { pathname, search } = lastAnswerCall()
    expect(pathname).toBe('/api/runs/nt%20a%2Fb/log/decisions')
    expect(search.get('offset')).toBe('0')
    expect(search.get('limit')).toBe('50')
  })

  it('routes an absolute same-origin URL, a URL object and a GET Request alike', async () => {
    const { demoFetch } = setup()
    await settle(demoFetch(`${ORIGIN}/api/health`))
    await settle(demoFetch(new URL(`${ORIGIN}/api/runs`)))
    await settle(demoFetch(new Request(`${ORIGIN}/api/reg?status=open`)))
    expect(answer.mock.calls.map((c) => c[0])).toEqual(['/api/health', '/api/runs', '/api/reg'])
    expect(lastAnswerCall().search.get('status')).toBe('open')
  })

  it('treats a lower-case get as GET, as the browser does', async () => {
    const { demoFetch } = setup()
    const response = await settle(demoFetch('/api/health', { method: 'get' }))
    expect(response.status).toBe(200)
  })

  it('sends a non-2xx answer with its ErrorDetail body, which the API client reads as the detail', async () => {
    const { demoFetch } = setup()
    answer.mockReturnValue({ status: 404, body: { detail: 'not in the demo dataset' } })
    const response = await settle(demoFetch('/api/runs/nope'))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'not in the demo dataset' })

    vi.stubGlobal('fetch', demoFetch)
    const failed = apiGet('/api/runs/{run_id}', { path: { run_id: 'nope' } }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(DEMO_DELAY_MS.max)
    const error = (await failed) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe('http')
    expect(error.status).toBe(404)
    expect(error.detail).toBe('not in the demo dataset')
  })

  it('answers 500 with an ErrorDetail when a route throws, as a server would', async () => {
    const { demoFetch } = setup()
    answer.mockImplementation(() => {
      throw new Error('bad fixture')
    })
    const response = await settle(demoFetch('/api/health'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ detail: expect.stringContaining('bad fixture') })
  })
})

describe('demoFetch refuses what the terminal never sends (born failing)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'post'])('refuses %s before routing, and never reaches the saved fetch', async (method) => {
    const { demoFetch, passThrough } = setup()
    await expect(demoFetch('/api/health', { method })).rejects.toThrow(TypeError)
    await expect(demoFetch('/assets/x.woff2', { method })).rejects.toThrow(/GET only/)
    expect(answer).not.toHaveBeenCalled()
    expect(passThrough).not.toHaveBeenCalled()
  })

  it('refuses a Request object carrying another method', async () => {
    const { demoFetch, passThrough } = setup()
    await expect(demoFetch(new Request(`${ORIGIN}/api/health`, { method: 'POST' }))).rejects.toThrow(/GET only/)
    expect(answer).not.toHaveBeenCalled()
    expect(passThrough).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.example/api/health',
    // The real backend's origin: the demo must never reach it, even though it is on this machine.
    'http://127.0.0.1:8765/api/health',
    '//evil.example/api/health',
    // User info before the host: this is evil.example, whatever it starts with.
    'http://127.0.0.1:5174@evil.example/api/health',
    // Not a URL at all.
    'http://[::1/api/health',
    'blob:http://127.0.0.1:5174/0f1e2d3c',
    'data:application/json,{}',
  ])('refuses %s: same origin only', async (url) => {
    const { demoFetch, passThrough } = setup()
    await expect(demoFetch(url)).rejects.toThrow(/same-origin/)
    expect(answer).not.toHaveBeenCalled()
    expect(passThrough).not.toHaveBeenCalled()
  })
})

const CANONICAL_INIT = {
  method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
} as const

describe('demoFetch hands the page its own static files', () => {
  it.each(['/assets/perspective-server-abc.wasm', `${ORIGIN}/assets/latin-400.woff2`, '/favicon.svg'])(
    'delegates the same-origin non-/api GET %s to the saved fetch, as one canonical request, unchanged and without delay',
    async (url) => {
      const { demoFetch, passThrough } = setup()
      const init = { method: 'GET', mode: 'same-origin', credentials: 'same-origin' } as const
      const response = await demoFetch(url, init)
      expect(await response.text()).toBe('asset')
      expect(passThrough).toHaveBeenCalledTimes(1)
      expect(passThrough).toHaveBeenCalledWith(new URL(url, `${ORIGIN}/`).href, expect.objectContaining(CANONICAL_INIT))
      expect(answer).not.toHaveBeenCalled()
    },
  )

  it.each(['/apix/health', '/api%2Fhealth'])('answers %s from the route table instead, matching Vite\'s /api proxy prefix rule', async (url) => {
    const { demoFetch, passThrough } = setup()
    await settle(demoFetch(url))
    expect(lastAnswerCall().pathname).toBe(url)
    expect(passThrough).not.toHaveBeenCalled()
  })

  it('drops the caller\'s own mode, redirect and headers, forwarding the canonical init instead', async () => {
    const { demoFetch, passThrough } = setup()
    const callerInit = { method: 'GET', mode: 'cors', redirect: 'follow', headers: { 'x-a': '1' } } as const
    await demoFetch('/assets/x.wasm', callerInit)
    const forwarded = passThrough.mock.calls.at(-1)?.[1] as RequestInit
    expect(forwarded).toEqual(expect.objectContaining(CANONICAL_INIT))
    expect(forwarded.headers).toBeUndefined()
  })

  it('forwards the caller\'s AbortSignal to the saved fetch', async () => {
    const { demoFetch, passThrough } = setup()
    const controller = new AbortController()
    await demoFetch('/assets/x.wasm', { method: 'GET', signal: controller.signal })
    const forwarded = passThrough.mock.calls.at(-1)?.[1] as RequestInit
    expect(forwarded.signal).toBe(controller.signal)
  })

  it('rejects a non-string, non-URL, non-Request input with a TypeError, before touching the route table or the saved fetch', async () => {
    const { demoFetch, passThrough } = setup()
    const foreign = { url: '/assets/x.wasm', method: 'GET' } as unknown as RequestInfo
    await expect(demoFetch(foreign)).rejects.toThrow(TypeError)
    expect(answer).not.toHaveBeenCalled()
    expect(passThrough).not.toHaveBeenCalled()
  })

  it('rejects a non-string method value with a TypeError, before touching the saved fetch', async () => {
    const { demoFetch, passThrough } = setup()
    const method = { toUpperCase: () => 'GET', toString: () => 'OTHER' } as unknown as string
    await expect(demoFetch('/assets/x.wasm', { method })).rejects.toThrow(TypeError)
    expect(passThrough).not.toHaveBeenCalled()
  })
})

describe('demoFetch honours AbortSignal', () => {
  it('rejects with AbortError when the signal is already aborted, before routing', async () => {
    const { demoFetch } = setup()
    const controller = new AbortController()
    controller.abort()
    const error = await demoFetch('/api/health', { signal: controller.signal }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(answer).not.toHaveBeenCalled()
  })

  it('rejects with AbortError when aborted during the delay, and leaves no timer behind', async () => {
    const { demoFetch } = setup()
    const controller = new AbortController()
    const failed = demoFetch('/api/health', { signal: controller.signal }).catch((e: unknown) => e)
    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    const error = await failed
    expect((error as DOMException).name).toBe('AbortError')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the API client lets that abort through unchanged, so react-query can drop the request', async () => {
    const { demoFetch } = setup()
    vi.stubGlobal('fetch', demoFetch)
    const controller = new AbortController()
    const failed = apiGet('/api/health', undefined, { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    const error = await failed
    expect(error).not.toBeInstanceOf(ApiError)
    expect((error as DOMException).name).toBe('AbortError')
  })
})

describe('demoDelays', () => {
  it('gives the same delays for the same seed, each within 20 to 120 ms', () => {
    const a = demoDelays(7)
    const b = demoDelays(7)
    const first = Array.from({ length: 200 }, () => a())
    expect(Array.from({ length: 200 }, () => b())).toEqual(first)
    expect(DEMO_DELAY_MS).toEqual({ min: 20, max: 120 })
    for (const ms of first) {
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(20)
      expect(ms).toBeLessThanOrEqual(120)
    }
    expect(new Set(first).size).toBeGreaterThan(20)
  })

  it('gives another sequence for another seed', () => {
    const a = demoDelays(1)
    const b = demoDelays(2)
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(Array.from({ length: 10 }, () => b()))
  })
})

// The demo dataset itself (src/demo/routes.ts) behind this door, unmocked: the honest refusals a
// screen shows as its normal error copy.
describe('demoFetch over the demo route table', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('./routes')>('./routes')
    answer.mockImplementation(actual.answerDemo)
  })

  it('answers an unknown run id with 404 and a JSON ErrorDetail', async () => {
    const { demoFetch } = setup()
    const response = await settle(demoFetch('/api/runs/nt_not_in_the_demo'))
    expect(response.status).toBe(404)
    const body: unknown = await response.json()
    expect(body).toEqual({ detail: expect.any(String) })
  })

  it('refuses /api/bars ending after 2021-12-31 with 403, as the OOS gate does', async () => {
    const { demoFetch } = setup()
    const response = await settle(demoFetch('/api/bars?symbol=NQ.V.0&timeframe=1d&start=2021-06-01&end=2022-06-30'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: expect.any(String) })
  })
})
