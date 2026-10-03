import { describe, expect, it, vi } from 'vitest'
import { CLIENT_HEADER } from '../api/client'
import { KEEPALIVE_LIMIT, createFetchTransport } from './remoteStore.transport'

function answering(status: number, body: string) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status }))
}

describe('the workspace store transport', () => {
  it('reads a document with a same-origin GET that carries the client header and no credentials elsewhere', async () => {
    const fetcher = answering(200, '{"doc":"prefs","version":3,"data":{}}')
    const reply = await createFetchTransport(() => fetcher as unknown as typeof fetch).read('prefs')
    expect(reply).toEqual({ status: 200, body: { doc: 'prefs', version: 3, data: {} } })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/workspaces/prefs')
    expect(init).toMatchObject({ method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error' })
    expect((init!.headers as Record<string, string>)[CLIENT_HEADER]).toBeDefined()
  })

  it('writes with If-Match, the X-NQT header, a JSON content type and the data in an envelope', async () => {
    const fetcher = answering(200, '{"version":4,"data":{"a":1}}')
    await createFetchTransport(() => fetcher as unknown as typeof fetch).write('watch', 3, { a: 1 })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/workspaces/watch')
    expect(init!.method).toBe('PUT')
    expect(init!.headers).toMatchObject({ 'If-Match': '3', 'X-NQT': '1', 'Content-Type': 'application/json' })
    expect(JSON.parse(init!.body as string)).toEqual({ data: { a: 1 } })
    expect(init!.keepalive).toBe(false)
  })

  it('marks a last-moment write keepalive only while its body fits the browser limit', async () => {
    const fetcher = answering(200, '{}')
    const transport = createFetchTransport(() => fetcher as unknown as typeof fetch)
    await transport.writeLast('history', 1, ['a'])
    await transport.writeLast('history', 1, ['x'.repeat(KEEPALIVE_LIMIT + 1)])
    expect(fetcher.mock.calls[0]![1]!.keepalive).toBe(true)
    expect(fetcher.mock.calls[1]![1]!.keepalive).toBe(false)
  })

  it('shares the keepalive quota across requests in flight: the second big last-moment write is an ordinary fetch, not a failing keepalive', async () => {
    const releases: Array<() => void> = []
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          releases.push(() => resolve(new Response('{}', { status: 200 })))
        }),
    )
    const transport = createFetchTransport(() => fetcher as unknown as typeof fetch)
    const big = ['x'.repeat(40_000)]
    const first = transport.writeLast('layouts', 1, big)
    const second = transport.writeLast('workspaces', 1, big)
    expect(fetcher.mock.calls.map((c) => c[1]!.keepalive)).toEqual([true, false])
    releases.forEach((release) => release())
    await Promise.all([first, second])
    const third = transport.writeLast('layouts', 2, big)
    expect(fetcher.mock.calls[2]![1]!.keepalive).toBe(true)
    releases[2]!()
    await third
  })

  it('counts the keepalive limit in bytes, not characters', async () => {
    const fetcher = answering(200, '{}')
    const transport = createFetchTransport(() => fetcher as unknown as typeof fetch)
    await transport.writeLast('history', 1, ['é'.repeat(35_000)])
    expect(fetcher.mock.calls[0]![1]!.keepalive).toBe(false)
  })

  it('answers status 0 when the request fails, and a null body for text that is not JSON', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await createFetchTransport(() => failing as unknown as typeof fetch).read('meta')).toEqual({ status: 0, body: null })
    const html = answering(200, '<html></html>')
    expect(await createFetchTransport(() => html as unknown as typeof fetch).read('meta')).toEqual({ status: 200, body: null })
  })

  it('refuses a name outside the seven before any request is made', async () => {
    const fetcher = answering(200, '{}')
    const transport = createFetchTransport(() => fetcher as unknown as typeof fetch)
    await expect(transport.read('../jobs' as 'meta')).rejects.toThrow(TypeError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
