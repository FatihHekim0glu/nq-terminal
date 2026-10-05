// Born-failing cases for the flow checks (TASKS 8.1; the nq-lab project rules, rule 5): each check in
// e2e/flows/scan.ts must catch a planted bad case and pass the matching good one before the safety and
// rule flows trust it. No browser: these run on plain data.
import { expect, test } from '@playwright/test'
import {
  actionNames,
  badJobWrites,
  chunkName,
  FENCE_SECONDS,
  isActionName,
  isJobWrite,
  ALLOWED_WRITES,
  JOB_WRITES,
  nonGetRequests,
  openApiNames,
  pointsPastFence,
  ticketControls,
  writeOperations,
  type OpenApiDoc,
} from './scan.ts'
import { STORE_DOCUMENTS, isStoreWrite } from '../storeWrites.ts'

const ORIGIN = 'http://127.0.0.1:4273'

test.describe('action-name scan (order|submit|cancel|modify)', () => {
  test('catches each banned word in routes, files and component names, in every casing', () => {
    const planted: Array<readonly [string, string]> = [
      ['route', '/api/orders'],
      ['route', '/api/live/orders'],
      ['operation', 'submit_order_api_orders_post'],
      ['schema', 'OrdersSummary'],
      ['component', 'CancelButton'],
      ['component', 'modifyPosition'],
      ['chunk', 'OrderTicket'],
      ['screen', 'order-entry'],
      ['mnemonic', 'SUBMIT'],
      ['screen', 'cancelled_orders'],
    ]
    expect(actionNames(planted)).toHaveLength(planted.length)
  })

  test('passes names that only contain the letters inside another word', () => {
    const clean: Array<readonly [string, string]> = [
      ['class', 'border-int'],
      ['route', '/api/runs/{run_id}/fills'],
      ['component', 'RecorderPane'],
      ['schema', 'LiveRouteRow'],
      ['chunk', 'LiveScreen'],
      ['mnemonic', 'MRET'],
    ]
    expect(actionNames(clean)).toEqual([])
  })

  test('reads a built chunk without its hash, so the module name is what is checked', () => {
    expect(chunkName('/assets/OrderTicket-Ab12Cd.js')).toBe('OrderTicket')
    expect(isActionName(chunkName('/assets/OrderTicket-Ab12Cd.js'))).toBe(true)
    expect(chunkName('/assets/LiveScreen-Xy9.js')).toBe('LiveScreen')
  })

  test('lists the routes, operations and schemas of an OpenAPI document, and every write method', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/api/runs': { get: { operationId: 'runs_api_runs_get' } },
        '/api/orders': { post: { operationId: 'place_api_orders_post' }, delete: {} },
      },
      components: { schemas: { RunSummary: {}, CancelRequest: {} } },
    }
    expect(actionNames(openApiNames(doc))).toEqual([
      'operation: place_api_orders_post',
      'route: /api/orders',
      'schema: CancelRequest',
    ])
    expect(writeOperations(doc)).toEqual(['POST /api/orders', 'DELETE /api/orders'])
    expect(writeOperations({ paths: { '/api/runs': { get: {} } } })).toEqual([])
  })
})

test.describe('GET-only check', () => {
  test('flags a write method and a request to another origin; passes same-origin GETs', () => {
    const requests = [
      { method: 'GET', url: `${ORIGIN}/api/runs` },
      { method: 'POST', url: `${ORIGIN}/api/runs` },
      { method: 'DELETE', url: `${ORIGIN}/api/live/journal` },
      { method: 'GET', url: 'http://127.0.0.1:8765/api/runs' },
    ]
    expect(nonGetRequests(requests, ORIGIN)).toEqual([
      `POST ${ORIGIN}/api/runs`,
      `DELETE ${ORIGIN}/api/live/journal`,
      'GET http://127.0.0.1:8765/api/runs',
    ])
    expect(nonGetRequests(requests.slice(0, 1), ORIGIN)).toEqual([])
  })
})

test.describe("the workspace store's PUT (03 section 10.3)", () => {
  test('is exactly PUT /api/workspaces/<one of the seven documents> on the page origin', () => {
    for (const doc of STORE_DOCUMENTS) expect(isStoreWrite('PUT', `${ORIGIN}/api/workspaces/${doc}`, ORIGIN), doc).toBe(true)
    for (const [method, url] of [
      ['POST', `${ORIGIN}/api/workspaces/prefs`],
      ['DELETE', `${ORIGIN}/api/workspaces/prefs`],
      ['PATCH', `${ORIGIN}/api/workspaces/prefs`],
      ['GET', `${ORIGIN}/api/workspaces/prefs`],
      ['PUT', `${ORIGIN}/api/workspaces/orders`],
      ['PUT', `${ORIGIN}/api/workspaces/prefs/extra`],
      ['PUT', `${ORIGIN}/api/workspaces`],
      ['PUT', `${ORIGIN}/api/workspaces/prefs?x=1`],
      ['PUT', `${ORIGIN}/api/jobs`],
      ['PUT', 'http://127.0.0.1:8765/api/workspaces/prefs'],
    ] as const) {
      expect(isStoreWrite(method, url, ORIGIN), `${method} ${url}`).toBe(false)
    }
  })
})

test.describe("the queue's two writes (PRD U3)", () => {
  const JOB = 'j_0123456789ab'

  test('lets exactly POST /api/jobs and DELETE /api/jobs/<job id> through, and reports every other write', () => {
    const requests = [
      { method: 'POST', url: `${ORIGIN}/api/jobs` },
      { method: 'DELETE', url: `${ORIGIN}/api/jobs/${JOB}` },
      { method: 'PUT', url: `${ORIGIN}/api/jobs` },
      { method: 'PATCH', url: `${ORIGIN}/api/jobs/${JOB}` },
      { method: 'POST', url: `${ORIGIN}/api/jobs/${JOB}` },
      { method: 'DELETE', url: `${ORIGIN}/api/jobs` },
      { method: 'DELETE', url: `${ORIGIN}/api/jobs/${JOB}/extra` },
      { method: 'DELETE', url: `${ORIGIN}/api/jobs/not-a-job-id` },
      { method: 'POST', url: `${ORIGIN}/api/orders` },
      { method: 'POST', url: `${ORIGIN}/api/jobs?x=1` },
      { method: 'POST', url: 'http://127.0.0.1:8765/api/jobs' },
    ]
    expect(nonGetRequests(requests, ORIGIN, true)).toEqual(requests.slice(2).map((r) => `${r.method} ${r.url}`))
    expect(nonGetRequests(requests, ORIGIN)).toHaveLength(requests.length)
  })

  test('says what a job write is by method, origin and path', () => {
    expect(isJobWrite('POST', `${ORIGIN}/api/jobs`, ORIGIN)).toBe(true)
    expect(isJobWrite('DELETE', `${ORIGIN}/api/jobs/${JOB}`, ORIGIN)).toBe(true)
    expect(isJobWrite('POST', `${ORIGIN}/api/jobs/actions`, ORIGIN)).toBe(true)
    expect(isJobWrite('GET', `${ORIGIN}/api/jobs/actions`, ORIGIN)).toBe(false)
    expect(isJobWrite('POST', `${ORIGIN}/api/jobs/actions/presets`, ORIGIN)).toBe(false)
    expect(isJobWrite('POST', `${ORIGIN}/api/jobs/actions?x=1`, ORIGIN)).toBe(false)
    expect(isJobWrite('DELETE', `${ORIGIN}/api/jobs/actions`, ORIGIN)).toBe(false)
    expect(isJobWrite('GET', `${ORIGIN}/api/jobs`, ORIGIN)).toBe(false)
    expect(isJobWrite('POST', 'http://evil.example/api/jobs', ORIGIN)).toBe(false)
  })

  test('reports a queue write that lacks X-NQT 1, and a POST that lacks a JSON content type', () => {
    const post = { method: 'POST', url: `${ORIGIN}/api/jobs` }
    const good = { ...post, headers: { 'x-nqt': '1', 'content-type': 'application/json' } }
    expect(badJobWrites([good], ORIGIN)).toEqual([])
    expect(badJobWrites([{ ...post, headers: { 'content-type': 'application/json' } }], ORIGIN)).toEqual([`POST ${ORIGIN}/api/jobs`])
    expect(badJobWrites([{ ...post, headers: { 'x-nqt': '1' } }], ORIGIN)).toEqual([`POST ${ORIGIN}/api/jobs`])
    const del = { method: 'DELETE', url: `${ORIGIN}/api/jobs/${JOB}` }
    expect(badJobWrites([{ ...del, headers: { 'x-nqt': '1' } }], ORIGIN)).toEqual([])
    expect(badJobWrites([{ ...del, headers: {} }], ORIGIN)).toEqual([`DELETE ${ORIGIN}/api/jobs/${JOB}`])
  })

  test('lists the two writes of an OpenAPI document, and finds a third', () => {
    const doc: OpenApiDoc = { paths: { '/api/jobs': { get: {}, post: {} }, '/api/jobs/{job_id}': { get: {}, delete: {} } } }
    expect(writeOperations(doc).sort()).toEqual(JOB_WRITES)
    const third: OpenApiDoc = { paths: { ...doc.paths, '/api/ib/snapshot': { get: {}, post: {} } } }
    expect(writeOperations(third).sort()).not.toEqual(JOB_WRITES)
  })

  test('lists the four writes of an OpenAPI document, and finds a fifth', () => {
    const doc: OpenApiDoc = {
      paths: {
        '/api/jobs': { get: {}, post: {} },
        '/api/jobs/{job_id}': { get: {}, delete: {} },
        '/api/jobs/actions': { post: {} },
        '/api/workspaces/{doc}': { get: {}, put: {} },
      },
    }
    expect(writeOperations(doc).sort()).toEqual(ALLOWED_WRITES)
    expect(ALLOWED_WRITES).toHaveLength(4)
    const fourth: OpenApiDoc = { paths: { ...doc.paths, '/api/workspaces': { get: {}, post: {} } } }
    expect(writeOperations(fourth).sort()).not.toEqual(ALLOWED_WRITES)
    const widened: OpenApiDoc = { paths: { ...doc.paths, '/api/workspaces/{doc}': { get: {}, put: {}, delete: {} } } }
    expect(writeOperations(widened).sort()).not.toEqual(ALLOWED_WRITES)
  })
})

test.describe('fence scan of served price points', () => {
  test('flags a bar time at or after 2022-01-01 00:00 UTC, in seconds or milliseconds', () => {
    expect(pointsPastFence({ t: [FENCE_SECONDS - 60, FENCE_SECONDS] })).toHaveLength(1)
    expect(pointsPastFence({ rows: [{ t: [(FENCE_SECONDS + 3600) * 1000] }] })).toHaveLength(1)
  })

  test('flags a session date after 2021-12-31 in any nested row', () => {
    expect(pointsPastFence({ sessions: ['2021-12-31', '2022-01-03'] })).toHaveLength(1)
    expect(pointsPastFence({ rows: [{ last_date: '2022-01-03' }] })).toHaveLength(1)
    expect(pointsPastFence({ vol_extremes: [{ hi_date: '2022-02-01T00:00:00Z' }] })).toHaveLength(1)
  })

  test('passes points that stop at the fence and ignores the exclusive request bound', () => {
    const body = {
      start: '2021-11-01T00:00:00Z',
      end: '2022-01-01T00:00:00Z',
      t: [FENCE_SECONDS - 86_400],
      sessions: ['2021-12-30', '2021-12-31'],
      rows: [{ last_date: '2021-12-31', as_of: '2021-12-31' }],
    }
    expect(pointsPastFence(body)).toEqual([])
  })
})

test.describe('order-ticket controls', () => {
  test('flags ticket words, and cancel unless the control is the Esc key', () => {
    const names = [
      'Place order',
      'Submit',
      'Modify target',
      'Buy 2 MNQ',
      'Cancel all',
      'CANCEL key, Esc: close the list, then clear the command line',
      '98) Export',
      'Routes',
    ]
    expect(ticketControls(names)).toEqual(['Place order', 'Submit', 'Modify target', 'Buy 2 MNQ', 'Cancel all'])
  })
})
