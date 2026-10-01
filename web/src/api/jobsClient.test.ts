import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, findWriteRequests } from './client'
import { getJob, listJobs, queueJob, stopJob } from './jobsClient'
import { SPEC, job } from '../screens/jobs/jobs.fixtures'

// The job queue holds the only writes in the web app. Method names are matched as patterns, not quoted words,
// so this test file stays clear of the GET-only source scan (which skips tests anyway).
const POST = /^post$/i
const DELETE = /^delete$/i

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stub(response: Response | (() => Response)) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (typeof response === 'function' ? response() : response))
}

function sent(spy: ReturnType<typeof stub>): { url: string; init: RequestInit; headers: Headers } {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}

afterEach(() => vi.restoreAllMocks())

describe('reads', () => {
  it('lists the jobs with a same-origin GET and no write header', async () => {
    const spy = stub(reply({ jobs: [job({})], queue_cap: 10 }))
    const out = await listJobs()
    const { url, init, headers } = sent(spy)
    expect(url).toBe('/api/jobs')
    expect(init.method).toBe('GET')
    expect(init.mode).toBe('same-origin')
    expect(init.credentials).toBe('same-origin')
    expect(init.redirect).toBe('error')
    expect(headers.get('X-NQT')).toBeNull()
    expect(headers.get('X-NQT-Client')).toBe('nq-lab-terminal')
    expect(out.jobs).toHaveLength(1)
  })

  it('reads one job by its id, encoded', async () => {
    const spy = stub(reply({ ...job({}), log_tail: ['a'] }))
    await getJob('j_1.a-b')
    expect(sent(spy).url).toBe('/api/jobs/j_1.a-b')
  })
})

describe('writes', () => {
  it('queues a job with POST, X-NQT 1, a JSON content type and the spec as the body', async () => {
    const spy = stub(reply(job({}), 202))
    await queueJob(SPEC)
    const { url, init, headers } = sent(spy)
    expect(url).toBe('/api/jobs')
    expect(String(init.method)).toMatch(POST)
    expect(headers.get('X-NQT')).toBe('1')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.mode).toBe('same-origin')
    expect(init.credentials).toBe('same-origin')
    expect(init.redirect).toBe('error')
    expect(init.referrerPolicy).toBe('no-referrer')
    expect(JSON.parse(String(init.body))).toEqual(SPEC)
  })

  it('stops a job with DELETE, X-NQT 1 and a JSON content type (the server requires it), and no body', async () => {
    const spy = stub(reply(job({ state: 'stopped' })))
    await stopJob('j1')
    const { url, init, headers } = sent(spy)
    expect(url).toBe('/api/jobs/j1')
    expect(String(init.method)).toMatch(DELETE)
    expect(headers.get('X-NQT')).toBe('1')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.body).toBeUndefined()
  })

  it('born failing: a read sends neither the write header nor a content type', async () => {
    const spy = stub(reply({ jobs: [], queue_cap: 10, queued: 0, running: 0, enabled: true }))
    await listJobs()
    const { headers } = sent(spy)
    expect(headers.get('X-NQT')).toBeNull()
    expect(headers.get('Content-Type')).toBeNull()
  })

  it.each(['', '.', '..', 'a/b', 'a?b', 'a#b', '../x', 'j 1', '%2e%2e', '-x', 'a\\b'])('refuses to build a job path from %j, before any request', async (id) => {
    const spy = stub(reply({}))
    await expect(stopJob(id)).rejects.toMatchObject({ kind: 'refused' })
    await expect(getJob(id)).rejects.toMatchObject({ kind: 'refused' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('errors', () => {
  it('turns a 422 validation list into one readable detail', async () => {
    stub(reply({ detail: [{ loc: ['body', 'start'], msg: 'start before 2010-01-01', type: 'value_error' }, { msg: 'run_id bad' }] }, 422))
    const error = await queueJob(SPEC).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ kind: 'http', status: 422, detail: 'start before 2010-01-01; run_id bad' })
  })

  it('keeps a string detail on a 409 (queue full or id in use) and a 503', async () => {
    stub(reply({ detail: 'the queue is full' }, 409))
    await expect(queueJob(SPEC)).rejects.toMatchObject({ status: 409, detail: 'the queue is full' })
    stub(reply({ detail: 'the job runner is off' }, 503))
    await expect(listJobs()).rejects.toMatchObject({ status: 503, detail: 'the job runner is off' })
  })

  it('reports a plain-text body, a network failure and invalid JSON each as an ApiError', async () => {
    stub(new Response('Forbidden', { status: 403 }))
    await expect(stopJob('j1')).rejects.toMatchObject({ kind: 'http', status: 403, detail: 'Forbidden' })
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'))
    await expect(listJobs()).rejects.toMatchObject({ kind: 'network' })
    vi.restoreAllMocks()
    stub(new Response('<html>', { status: 200 }))
    await expect(listJobs()).rejects.toMatchObject({ kind: 'decode' })
  })

  it('lets an abort through as an abort, not as an ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    await expect(listJobs({ signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the source scan allowance', () => {
  it('the scan allows this file its POST, DELETE and fetch, and flags nothing else in it', () => {
    const files = import.meta.glob<string>('./jobsClient.ts', { query: '?raw', import: 'default', eager: true })
    const source = Object.values(files)[0] ?? ''
    expect(source).not.toBe('')
    expect(findWriteRequests('/src/api/jobsClient.ts', source)).toEqual([])
    // born failing: under any other name the same text is flagged three ways (POST, DELETE and fetch)
    expect(findWriteRequests('/src/api/other.ts', source)).toEqual(expect.arrayContaining([
      '/src/api/other.ts: write method POST',
      '/src/api/other.ts: write method DELETE',
      '/src/api/other.ts: calls fetch directly',
    ]))
  })

  it('no other file of the JOBS slice carries a write method or calls fetch', () => {
    const sources = import.meta.glob<string>(
      ['../screens/jobs/**/*.ts', '../screens/jobs/**/*.tsx', '../copy/jobs.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      { query: '?raw', import: 'default', eager: true },
    )
    const files = Object.keys(sources)
    expect(files.length).toBeGreaterThan(5)
    const findings = Object.entries(sources).flatMap(([file, text]) => findWriteRequests(file, text))
    expect(findings).toEqual([])
  })
})
