import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import {
  DOWN_AFTER,
  HEALTH_BACKOFF_MS,
  INITIAL_CONNECTION,
  healthIntervalMs,
  isOutage,
  nextConnection,
  type ConnectionState,
} from './connection'
import { LIVE_POLL_MS } from './queryKey'
import type { ErrorDetail } from './types'

function network(): ApiError {
  return new ApiError({ kind: 'network', path: '/api/health', detail: 'the request failed' })
}

function http(status: number, body: ErrorDetail | null = null): ApiError {
  return new ApiError({ kind: 'http', path: '/api/health', status, body, detail: `${status}` })
}

function decode(): ApiError {
  return new ApiError({ kind: 'decode', path: '/api/health', status: 200, detail: 'the response was not valid JSON' })
}

describe('isOutage (v2 fix 1)', () => {
  it.each<[string, ApiError, boolean]>([
    ['a network failure', network(), true],
    ['http 502', http(502), true],
    ['http 503', http(503), true],
    ['http 504', http(504), true],
    ["http 500 with a null body (Vite's dev proxy answering an unreachable backend)", http(500, null), true],
    ['http 500 with an ErrorDetail body (a FastAPI refusal)', http(500, { detail: 'internal error' }), false],
    ['http 404', http(404), false],
    ['http 429', http(429), false],
    ['a decode error', decode(), false],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isOutage(error)).toBe(expected)
  })
})

describe('nextConnection', () => {
  it('starts unknown, with every count at zero and every timestamp null', () => {
    expect(INITIAL_CONNECTION).toEqual({
      status: 'unknown',
      failures: 0,
      downSince: null,
      lastCheckAt: null,
      lastOkAt: null,
      lastError: null,
      recoveredAt: null,
      retried: 0,
    })
  })

  it('an ok event goes straight to ok and stamps lastOkAt and lastCheckAt', () => {
    const next = nextConnection(INITIAL_CONNECTION, { kind: 'ok', at: 1000 })
    expect(next.status).toBe('ok')
    expect(next.failures).toBe(0)
    expect(next.downSince).toBeNull()
    expect(next.lastOkAt).toBe(1000)
    expect(next.lastCheckAt).toBe(1000)
    expect(next.recoveredAt).toBeNull()
  })

  it('degrades on the first and second consecutive outage failures, without a downSince', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    state = nextConnection(state, { kind: 'fail', at: 1, error: network() })
    expect(state.status).toBe('degraded')
    expect(state.failures).toBe(1)
    expect(state.downSince).toBeNull()
    state = nextConnection(state, { kind: 'fail', at: 2, error: http(502) })
    expect(state.status).toBe('degraded')
    expect(state.failures).toBe(2)
    expect(state.downSince).toBeNull()
  })

  it(`goes down on the ${DOWN_AFTER}rd consecutive outage failure and stamps downSince`, () => {
    let state: ConnectionState = INITIAL_CONNECTION
    state = nextConnection(state, { kind: 'fail', at: 1, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 2, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 3, error: network() })
    expect(state.status).toBe('down')
    expect(state.failures).toBe(3)
    expect(state.downSince).toBe(3)
  })

  it('keeps downSince at the first outage failure of the run while failures keep growing', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 4, error: http(503) })
    state = nextConnection(state, { kind: 'fail', at: 5, error: http(504) })
    expect(state.status).toBe('down')
    expect(state.downSince).toBe(3)
    expect(state.failures).toBe(5)
  })

  it('a non-outage failure (4xx, decode) never goes down and resets the failure count to zero', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    state = nextConnection(state, { kind: 'fail', at: 1, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 2, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 3, error: http(404) })
    expect(state.status).toBe('degraded')
    expect(state.failures).toBe(0)
    expect(state.downSince).toBeNull()
    state = nextConnection(state, { kind: 'fail', at: 4, error: decode() })
    expect(state.status).toBe('degraded')
    expect(state.failures).toBe(0)
  })

  it('a non-outage failure while already down degrades and drops the failure count (it does not stay down)', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: network() })
    expect(state.status).toBe('down')
    state = nextConnection(state, { kind: 'fail', at: 4, error: http(400) })
    expect(state.status).toBe('degraded')
    expect(state.failures).toBe(0)
    expect(state.downSince).toBeNull()
    expect(state.recoveredAt).toBe(4)
  })

  it('a later ok after a non-outage failure that already left down is not a second recovery (recoveredAt stays at the leave-down event)', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: network() })
    expect(state.status).toBe('down')
    state = nextConnection(state, { kind: 'fail', at: 4, error: http(400) })
    expect(state.status).toBe('degraded')
    expect(state.recoveredAt).toBe(4)
    state = nextConnection(state, { kind: 'ok', at: 5 })
    expect(state.status).toBe('ok')
    expect(state.recoveredAt).toBe(4)
  })

  it('records the last error kind, status and detail on a failure', () => {
    const error = new ApiError({ kind: 'http', path: '/api/health', status: 503, body: null, detail: 'unavailable' })
    const state = nextConnection(INITIAL_CONNECTION, { kind: 'fail', at: 1, error })
    expect(state.lastError).toEqual({ kind: 'http', status: 503, detail: 'unavailable' })
  })

  it('sets recoveredAt when the state leaves down', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: network() })
    expect(state.status).toBe('down')
    state = nextConnection(state, { kind: 'ok', at: 10 })
    expect(state.status).toBe('ok')
    expect(state.recoveredAt).toBe(10)
  })

  it('leaves recoveredAt alone on a later ok that was not preceded by down', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    for (const at of [1, 2, 3]) state = nextConnection(state, { kind: 'fail', at, error: network() })
    state = nextConnection(state, { kind: 'ok', at: 10 })
    const again = nextConnection(state, { kind: 'ok', at: 20 })
    expect(again.recoveredAt).toBe(10)
  })

  it('never sets recoveredAt on an ok event that was never preceded by down', () => {
    const state = nextConnection(INITIAL_CONNECTION, { kind: 'ok', at: 1 })
    expect(state.recoveredAt).toBeNull()
  })

  it('clears downSince as soon as an ok event lands, even from degraded', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    state = nextConnection(state, { kind: 'fail', at: 1, error: network() })
    state = nextConnection(state, { kind: 'ok', at: 2 })
    expect(state.downSince).toBeNull()
    expect(state.status).toBe('ok')
  })

  it('drops a stale downSince on a non-outage failure, so the next down period reports its own start time', () => {
    let state: ConnectionState = INITIAL_CONNECTION
    state = nextConnection(state, { kind: 'fail', at: 1, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 2, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 3, error: network() })
    expect(state.status).toBe('down')
    expect(state.downSince).toBe(3)
    state = nextConnection(state, { kind: 'fail', at: 4, error: http(404) })
    expect(state.status).toBe('degraded')
    expect(state.downSince).toBeNull()
    state = nextConnection(state, { kind: 'fail', at: 5, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 6, error: network() })
    state = nextConnection(state, { kind: 'fail', at: 7, error: network() })
    expect(state.status).toBe('down')
    expect(state.downSince).toBe(7)
  })
})

describe('healthIntervalMs', () => {
  it('the backoff table is 2, 4, 8, 16 and 30 s (HOUSE v1: "2 s while ok, then 4, 8, 16 and 30 s while down")', () => {
    expect(HEALTH_BACKOFF_MS).toEqual([2000, 4000, 8000, 16000, 30000])
  })

  it.each([0, 1, 2])('polls at LIVE_POLL_MS while degraded with %i failures (not yet down)', (failures) => {
    expect(healthIntervalMs({ ...INITIAL_CONNECTION, status: 'degraded', failures })).toBe(LIVE_POLL_MS)
  })

  it('polls at LIVE_POLL_MS while unknown or ok', () => {
    expect(healthIntervalMs(INITIAL_CONNECTION)).toBe(LIVE_POLL_MS)
    expect(healthIntervalMs({ ...INITIAL_CONNECTION, status: 'ok' })).toBe(LIVE_POLL_MS)
  })

  it.each([
    [1, LIVE_POLL_MS],
    [2, LIVE_POLL_MS],
    [3, HEALTH_BACKOFF_MS[1]],
    [4, HEALTH_BACKOFF_MS[2]],
    [5, HEALTH_BACKOFF_MS[3]],
    [6, HEALTH_BACKOFF_MS[4]],
    [7, HEALTH_BACKOFF_MS[4]],
  ])('failures %i -> %i ms (the down table backs off then holds at the last entry)', (failures, expected) => {
    const status = failures >= DOWN_AFTER ? 'down' : 'degraded'
    expect(healthIntervalMs({ ...INITIAL_CONNECTION, status, failures })).toBe(expected)
  })
})
