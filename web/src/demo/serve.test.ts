// The demo dataset over HTTP (src/demo/serve.ts), for the offline Playwright project: e2e/offline/vite.offline.config.ts
// answers GET /api/* in Node from the demo route table, so page.route, page.on('request') and page.request see the
// traffic the in-page demo (src/demo/fetch.ts) hides. serve.ts is pure (no node import): a method and a request
// target in, a status, headers and a JSON text out, plus the stream's frames. Write method names are built by join
// so this file, like the sources it scans, never spells one.
import { describe, expect, it } from 'vitest'
import targetSource from '../../e2e/target.ts?raw'
import { LIVE_STREAM } from '../api/liveStream'
import { demoLiveJournalRows } from './data/live'
import { DEMO_DETAIL } from './data/text'
import { answerDemo } from './routes'
import {
  DEMO_REFUSAL_HEADER, DEMO_REFUSAL_VALUE, answerDemoHttp, demoPeerAllowed, demoStreamOpening, heartbeatEvent, isDemoApiTarget, isDemoStreamPath,
  sseFrame,
} from './serve'
import * as stream from './stream'

const WRITE_METHODS = [['PO', 'ST'], ['PU', 'T'], ['PAT', 'CH'], ['DELE', 'TE']].map((parts) => parts.join(''))
const OTHER_METHODS = ['HEAD', 'OPTIONS', 'TRACE', 'CONNECT', 'get']
const NOT_GET = [...WRITE_METHODS, ...OTHER_METHODS]

/** The one answer to a request the demo owns; fails the test when serve.ts left it to the static server. */
function answer(method: string, target: string) {
  const got = answerDemoHttp(method, target)
  if (got === null) throw new Error(`${method} ${target} was not answered`)
  return got
}

describe('answerDemoHttp: GET /api/*', () => {
  it('answers /api/health as JSON with the fixture flag, no store and no sniffing', () => {
    const got = answer('GET', '/api/health')
    expect(got.status).toBe(200)
    expect(got.headers).toEqual({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    const body = JSON.parse(got.body) as { fixture_mode: boolean }
    expect(body.fixture_mode).toBe(true)
  })

  it('serves exactly the body the in-page demo serves for the same path and query', () => {
    const target = '/api/runs/stats?ids=nt_dtsmom_v0_fixture_ts1'
    const got = answer('GET', target)
    const url = new URL(target, 'http://127.0.0.1')
    expect(got.body).toBe(JSON.stringify(answerDemo(url.pathname, url.searchParams).body))
  })

  it('reads the query string into the route: a paged list honours its limit', () => {
    const all = JSON.parse(answer('GET', '/api/live/journal').body) as { items: unknown[]; total: number }
    const page = JSON.parse(answer('GET', '/api/live/journal?limit=2').body) as { items: unknown[]; total: number }
    expect(all.total).toBe(demoLiveJournalRows.length)
    expect(page.items).toHaveLength(Math.min(2, demoLiveJournalRows.length))
    expect(page.total).toBe(all.total)
  })

  it('answers the fence with the gate 403 and no refusal header (a 403 is the gate, not a hole in the dataset)', () => {
    const got = answer('GET', '/api/bars?symbol=NQ.V.0&timeframe=1d&variant=vendor&start=2021-06-01&end=2022-06-30')
    expect(got.status).toBe(403)
    expect(got.headers[DEMO_REFUSAL_HEADER]).toBeUndefined()
    expect(JSON.parse(got.body)).toEqual({ detail: expect.stringContaining('leaves the in-sample window') })
  })
})

describe('answerDemoHttp: the refusal header', () => {
  it.each(['/api/qa', '/api/runs/no_such_run', '/api/hypotheses/no_such_name', '/api/runs/%E0%A4%A'])(
    'marks %s: 404, the dataset has no honest body for it',
    (target) => {
      const got = answer('GET', target)
      expect(got.status).toBe(404)
      expect(JSON.parse(got.body)).toEqual({ detail: DEMO_DETAIL.notInDemo })
      expect(got.headers[DEMO_REFUSAL_HEADER]).toBe(DEMO_REFUSAL_VALUE)
    },
  )

  it('leaves a path outside the contract as a plain 404 without the header', () => {
    for (const target of ['/api/no_such_path', '/api', '/api/']) {
      const got = answer('GET', target)
      expect(got.status, target).toBe(404)
      expect(JSON.parse(got.body), target).toEqual({ detail: DEMO_DETAIL.unknownPath })
      expect(got.headers[DEMO_REFUSAL_HEADER], target).toBeUndefined()
    }
  })

  it('leaves the plain-GET stream route as its own 503 without the header', () => {
    const got = answer('GET', LIVE_STREAM.path)
    expect(got.status).toBe(503)
    expect(JSON.parse(got.body)).toEqual({ detail: DEMO_DETAIL.streamOnly })
    expect(got.headers[DEMO_REFUSAL_HEADER]).toBeUndefined()
  })

  it('never sets the header on a success', () => {
    expect(answer('GET', '/api/registry').headers[DEMO_REFUSAL_HEADER]).toBeUndefined()
  })
})

describe('answerDemoHttp: everything that is not a GET', () => {
  it.each(NOT_GET)('answers %s with 405, allow GET and a body that quotes no method', (method) => {
    const got = answer(method, '/api/registry')
    expect(got.status).toBe(405)
    expect(got.headers['allow']).toBe('GET')
    expect(got.headers['content-type']).toBe('application/json')
    expect(got.headers[DEMO_REFUSAL_HEADER]).toBeUndefined()
    expect(JSON.parse(got.body)).toEqual({ detail: 'the demo answers GET only' })
    expect(JSON.stringify(got)).not.toContain(method)
  })

  it('refuses a write before it looks at the path, on a path outside the contract too', () => {
    for (const method of WRITE_METHODS) {
      expect(answer(method, '/api/no_such_path').status).toBe(405)
      expect(answer(method, LIVE_STREAM.path).status).toBe(405)
    }
  })

  it('leaves a method on a non-API path to the static server', () => {
    for (const method of NOT_GET) expect(answerDemoHttp(method, '/index.html')).toBeNull()
  })
})

describe('answerDemoHttp: only /api and /api/* belong to the demo', () => {
  it.each([
    '/', '/index.html', '/assets/index-abc.js', '/__gallery/LineStack', '/apiary', '/api-docs', '/API/health', '/x/api/health',
    '//evil.example/api/health', 'http://evil.example/api/health', 'api/health', '',
  ])('is null for %j', (target) => {
    expect(answerDemoHttp('GET', target)).toBeNull()
  })
})

describe('isDemoApiTarget', () => {
  it('holds /api and /api/*, with or without a query, and nothing else', () => {
    for (const target of ['/api', '/api/', '/api/health', '/api/bars?symbol=NQ.V.0', '/api?x=1', '/api/live/stream']) {
      expect(isDemoApiTarget(target), target).toBe(true)
    }
    for (const target of ['/', '/apiary', '/api-docs', '/x/api', '//evil.example/api/health', 'http://x.example/api/health', '', 'api']) {
      expect(isDemoApiTarget(target), target).toBe(false)
    }
  })

  it('agrees with answerDemoHttp: an answer exactly when the target is the demo\'s', () => {
    for (const target of ['/api', '/api/health', '/apiary', '/', '//x/api/health']) {
      expect(answerDemoHttp('GET', target) !== null, target).toBe(isDemoApiTarget(target))
    }
  })
})

describe('demoPeerAllowed: this machine and this origin only', () => {
  it('allows a loopback peer whose request is same-origin, a navigation (none) or carries no Sec-Fetch-Site', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      for (const site of ['same-origin', 'none', undefined]) expect(demoPeerAllowed(peer, site), `${peer} ${site}`).toBe(true)
    }
  })

  it('refuses a peer that is not loopback, or unknown, whatever the site says', () => {
    for (const peer of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '0.0.0.0', '', undefined]) {
      expect(demoPeerAllowed(peer, 'same-origin'), String(peer)).toBe(false)
      expect(demoPeerAllowed(peer, undefined), String(peer)).toBe(false)
    }
  })

  it('refuses a loopback browser request that says it is same-site or cross-site, or sends the header twice', () => {
    for (const site of ['same-site', 'cross-site', 'SAME-ORIGIN', '', ['same-origin'], ['same-origin', 'none']]) {
      expect(demoPeerAllowed('127.0.0.1', site), JSON.stringify(site)).toBe(false)
    }
  })
})

describe('the stream route', () => {
  it('is exactly /api/live/stream, with no query and no trailing text', () => {
    expect(isDemoStreamPath(LIVE_STREAM.path)).toBe(true)
    for (const target of ['/api/live/stream?from=0', '/api/live/stream/', '/api/live/stream/x', '/api/live/status', '/api/live', '/']) {
      expect(isDemoStreamPath(target), target).toBe(false)
    }
  })

  it('frames an event as id, event, data and a blank line, on the server-sent events wire', () => {
    const event = { kind: 'heartbeat', interval_s: 10, utc: '2026-09-29T09:00:00.000Z' } as const
    expect(sseFrame(event, 3)).toBe(
      'id: 3\nevent: heartbeat\ndata: {"kind":"heartbeat","interval_s":10,"utc":"2026-09-29T09:00:00.000Z"}\n\n',
    )
  })

  it('keeps the data on one line whatever the event carries', () => {
    const [hello] = demoStreamOpening()
    if (hello?.kind !== 'hello') throw new Error('the opening starts with hello')
    const frame = sseFrame({ ...hello, banner: 'two\nlines\r\nand a third' }, 1)
    expect(frame.split('\n')).toHaveLength(5)
    expect(frame.endsWith('\n\n')).toBe(true)
    const data = frame.split('\n')[2] ?? ''
    expect(JSON.parse(data.slice('data: '.length))).toMatchObject({ banner: 'two\nlines\r\nand a third' })
  })

  it('builds the heartbeat the demo event source sends, from the time it is given', () => {
    expect(heartbeatEvent(new Date('2026-09-29T09:00:10.500Z'))).toEqual({
      kind: 'heartbeat', interval_s: stream.DEMO_STREAM.heartbeatS, utc: '2026-09-29T09:00:10.500Z',
    })
  })

  it('opens with hello and status, then every journal row: the opening the in-page event source plays', () => {
    const opening = demoStreamOpening()
    expect(opening.map((e) => e.kind)).toEqual(['hello', 'status', ...demoLiveJournalRows.map(() => 'journal_row')])
    expect(demoStreamOpening).toBe(stream.demoStreamOpening)
  })
})

describe('constants shared with e2e/target.ts', () => {
  /** The string a top-level `export const NAME = '...'` of e2e/target.ts holds. */
  const restated = (name: string): string | undefined => new RegExp(String.raw`export const ${name} = '([^']*)'`).exec(targetSource)?.[1]

  it('are restated there, because a spec cannot import from src, and are equal', () => {
    expect(restated('DEMO_REFUSAL_HEADER')).toBe(DEMO_REFUSAL_HEADER)
    expect(restated('DEMO_REFUSAL_VALUE')).toBe(DEMO_REFUSAL_VALUE)
  })

  it('spell the header and value the route table promises', () => {
    expect(DEMO_REFUSAL_HEADER).toBe('x-nqt-demo')
    expect(DEMO_REFUSAL_VALUE).toBe('not-in-dataset')
  })
})

describe('serve.ts stays out of the app', () => {
  const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/demo/serve.ts'], {
    query: '?raw', import: 'default', eager: true,
  })

  it('is imported by no module of the app, so no build carries it', () => {
    expect(Object.keys(sources)).toContain('/src/demo/boot.tsx')
    const importers = Object.entries(sources).filter(([, text]) => /from\s+['"][^'"]*\/serve['"]/.test(text)).map(([file]) => file)
    expect(importers).toEqual([])
  })
})
