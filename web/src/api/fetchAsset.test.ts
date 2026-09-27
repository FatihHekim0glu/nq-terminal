// fetchAsset (TASKS 9.1): the one other GET the page makes, for the build's own static files (the pivot
// engine's WebAssembly). Same origin only, never under /api, GET with no credentials beyond the origin's,
// redirects refused; a failure is an ApiError like any other.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, assetUrl, fetchAsset } from './client'

const ORIGIN = 'http://127.0.0.1:8765'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status = 200) {
  const fetch = vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109]), { status }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('fetchAsset (the build asset GET)', () => {
  it('accepts a same-origin build file and refuses everything else', () => {
    expect(assetUrl('/assets/perspective-server-abc.wasm', ORIGIN)).toBe(`${ORIGIN}/assets/perspective-server-abc.wasm`)
    expect(assetUrl(`${ORIGIN}/assets/x.wasm`, ORIGIN)).toBe(`${ORIGIN}/assets/x.wasm`)
    for (const bad of ['https://cdn.example/x.wasm', 'http://127.0.0.1:9999/assets/x.wasm', '/api/health', '/api', 'blob:http://127.0.0.1:8765/x', 'data:application/wasm;base64,AA==']) {
      expect(() => assetUrl(bad, ORIGIN), bad).toThrow(ApiError)
    }
  })

  it('GETs with the same-origin settings the API client uses', async () => {
    vi.stubGlobal('location', new URL(`${ORIGIN}/`))
    const fetch = stubFetch()
    const response = await fetchAsset('/assets/a.wasm')
    expect(response.ok).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${ORIGIN}/assets/a.wasm`)
    expect(init).toMatchObject({ method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error' })
  })

  it('rejects with an ApiError on an HTTP failure', async () => {
    vi.stubGlobal('location', new URL(`${ORIGIN}/`))
    stubFetch(404)
    await expect(fetchAsset('/assets/missing.wasm')).rejects.toBeInstanceOf(ApiError)
  })

  it('born failing: an off-origin asset never reaches fetch', async () => {
    vi.stubGlobal('location', new URL(`${ORIGIN}/`))
    const fetch = stubFetch()
    await expect(fetchAsset('https://cdn.example/x.wasm')).rejects.toBeInstanceOf(ApiError)
    expect(fetch).not.toHaveBeenCalled()
  })
})
