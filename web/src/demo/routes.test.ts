// The demo dataset (src/demo/routes.ts over src/demo/data): every contract GET has a handler, the screens
// the demo promises (HOME and the A6 command lines) get 200 bodies, the fence refuses as the gate does,
// ids the dataset does not hold answer an honest 404, and every id the command index offers resolves.
import { describe, expect, it } from 'vitest'
import contract from '../../../contract/openapi.json?raw'
import { buildApiUrl } from '../api/client'
import type { ApiPath, RequestOf, Schemas, SuccessOf } from '../api/types'
import { findCopyViolations } from '../copy/copyRules'
import { DEFAULT_WINDOW } from '../screens/mon/model'
import { FENCE_MS, barsQuery, gateRuleText, rangeWindow } from '../screens/gp/model'
import { RV_WINDOW } from '../screens/gp/useGpData'
import { PAGE_ROWS } from '../screens/runs/runModel'
import { BOOK } from '../screens/live/liveFixtures'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../screens/des/desTestData'
import { OVERNIGHT_SCREEN, VOLMANAGED_SCREEN } from '../screens/des/robustness.fixtures'
import { intParam } from './data/answer'
import { GAP_TEXT, evidenceInDemo } from './data/analytics'
import { DEMO_DETAIL, DEMO_TEXT } from './data/text'
import { demoLiveJournalRows, demoLiveStatus } from './data/live'
import { HYPOTHESIS_DETAILS, withScreen } from './data/research'
import { DEMO_ROUTES, answerDemo, type DemoRoutes } from './routes'

/** What a GET on `path` with `request` answers, the URL built exactly as the API client builds it. */
function get<P extends ApiPath>(path: P, request: RequestOf<P> | Record<string, never> = {}) {
  const url = new URL(buildApiUrl(path, request), 'http://127.0.0.1:5174')
  return answerDemo(url.pathname, url.searchParams)
}

/** The body of a 200, typed as the contract's success body for `path` (fails the test otherwise). */
function ok<P extends ApiPath>(path: P, request: RequestOf<P> | Record<string, never> = {}) {
  const answer = get(path, request)
  expect(answer.status, `${path} ${JSON.stringify(request)}: ${JSON.stringify(answer.body)}`).toBe(200)
  return answer.body as SuccessOf<P>
}

function refused(answer: { status: number; body: unknown }, status: number, detail: string = DEMO_DETAIL.notInDemo) {
  expect(answer).toEqual({ status, body: { detail } })
}

/** A tear sheet the dataset did not capture: the plain refusal, then where the evidence is (N01). */
function gapped(answer: { status: number; body: unknown }) {
  expect(answer.status).toBe(404)
  const detail = (answer.body as { detail: string }).detail
  expect(detail.startsWith(`${DEMO_DETAIL.notInDemo}. ${GAP_TEXT.lead} `)).toBe(true)
}

const CONTRACT_PATHS = Object.keys((JSON.parse(contract) as { paths: Record<string, unknown> }).paths).sort()

describe('DEMO_ROUTES covers the contract (acceptance A1, A2)', () => {
  it('has exactly the 64 GET paths of contract/openapi.json, the file gen-api.mjs generates the types from', () => {
    expect(CONTRACT_PATHS).toHaveLength(64)
    expect(Object.keys(DEMO_ROUTES).sort()).toEqual(CONTRACT_PATHS)
  })

  it('is typed so that a table missing any one path does not compile', () => {
    const { '/api/health': _dropped, ...rest } = DEMO_ROUTES
    // @ts-expect-error: DemoRoutes needs a handler for every contract path, /api/health included
    const incomplete: DemoRoutes = rest
    expect(Object.keys(incomplete)).toHaveLength(63)
  })
})

describe('answerDemo: path templates and error bodies', () => {
  it('answers a path the contract does not have with 404 and an ErrorDetail', () => {
    refused(answerDemo('/api/nothing/here', new URLSearchParams()), 404, DEMO_DETAIL.unknownPath)
    refused(answerDemo('/api/runs/', new URLSearchParams()), 404, DEMO_DETAIL.unknownPath)
    refused(answerDemo('/elsewhere', new URLSearchParams()), 404, DEMO_DETAIL.unknownPath)
  })

  it('prefers a literal segment to a parameter (/api/runs/stats is not a run id)', () => {
    const stats = get('/api/runs/stats', { query: { ids: 'nt_dtsmom_v0_fixture_ts1' } })
    expect(stats.status).toBe(200)
    expect(Array.isArray(stats.body)).toBe(true)
  })

  it('decodes path parameters, and refuses a malformed escape instead of throwing', () => {
    expect(answerDemo('/api/hypotheses/volmanaged%5Fv0', new URLSearchParams()).status).toBe(200)
    refused(answerDemo('/api/hypotheses/%E0%A4%A', new URLSearchParams()), 404)
  })

  it('answers ids and requests the dataset does not hold with the honest 404', () => {
    refused(get('/api/runs/{run_id}', { path: { run_id: 'nt_not_in_the_demo' } }), 404)
    refused(get('/api/hypotheses/{name}', { path: { name: 'tom_v0' } }), 404)
    gapped(get('/api/analytics/hypothesis/{name}', { path: { name: 'overnight_v0' }, query: { cost: 1 } }))
    gapped(get('/api/analytics/hypothesis/{name}', { path: { name: 'volmanaged_v0' }, query: { cost: 2 } }))
    gapped(get('/api/analytics/run/{run_id}', { path: { run_id: 'nt_volmanaged_v0_fixture_m1' }, query: { freq: 'M' } }))
    refused(get('/api/instruments/{root}', { path: { root: 'ES' } }), 404)
    refused(get('/api/market/universe', { query: { window: 63 } }), 404)
    refused(get('/api/runs/stats', { query: { ids: 'nt_dtsmom_v0_fixture_ts1,nope' } }), 404)
    refused(get('/api/qa'), 404)
    refused(get('/api/dq/symbols'), 404)
  })

  it('answers the live stream path over plain GET with a 503 that names the event source', () => {
    refused(get('/api/live/stream'), 503, DEMO_DETAIL.streamOnly)
  })

  it('answers a log section named after an object prototype member with the honest 404, not a crash', () => {
    for (const section of ['constructor', 'toString', '__proto__']) {
      refused(answerDemo(`/api/runs/nt_dtsmom_v0_fixture_ts1/log/${section}`, new URLSearchParams()), 404)
    }
  })
})

describe('the demo prices: /api/bars behind the fence (acceptance A3)', () => {
  const nq = { symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor' } as const

  it('refuses a window that ends past 2021-12-31 with 403 and the gate rule, as the OOS gate does', () => {
    const answer = get('/api/bars', { query: { ...nq, start: '2021-06-01', end: '2022-06-30' } })
    refused(answer, 403, gateRuleText({ startMs: Date.UTC(2021, 5, 1), endMs: Date.UTC(2022, 5, 30) }))
  })

  it('refuses a window that starts before 2010-01-01 the same way', () => {
    expect(get('/api/bars', { query: { ...nq, start: '2009-06-01' } }).status).toBe(403)
  })

  it('serves the window up to the fence (the end is exclusive) and nothing on or after it', () => {
    const bars = ok('/api/bars', { query: { ...nq, start: '2021-01-01', end: '2022-01-01' } })
    expect(bars.t.length).toBeGreaterThan(200)
    expect(Math.max(...bars.t)).toBeLessThan(FENCE_MS / 1000)
    expect(bars.end).toBe('2022-01-01T00:00:00Z')
  })

  it('gives columns of one length, candles that hold their open and close, and ascending times', () => {
    const bars = ok('/api/bars', { query: { ...nq, start: '2020-01-01' } })
    const n = bars.t.length
    for (const column of [bars.o, bars.h, bars.l, bars.c, bars.v]) expect(column).toHaveLength(n)
    for (let i = 0; i < n; i += 1) {
      const [o, h, l, c] = [bars.o[i]!, bars.h[i]!, bars.l[i]!, bars.c[i]!]
      expect(h).toBeGreaterThanOrEqual(Math.max(o, c))
      expect(l).toBeLessThanOrEqual(Math.min(o, c))
      if (i > 0) expect(bars.t[i]!).toBeGreaterThan(bars.t[i - 1]!)
    }
  })

  it('marks quarterly rolls on the first session after the 10th of March, June, September and December', () => {
    const bars = ok('/api/bars', { query: { ...nq, start: '2021-01-01' } })
    const days = bars.rolls.map((r) => new Date(r.t * 1000).toISOString().slice(0, 10))
    expect(days).toEqual(['2021-03-11', '2021-06-11', '2021-09-13', '2021-12-13'])
    for (const roll of bars.rolls) expect(roll.to).toBe(roll.from + 1)
  })

  it('is the same on every call, ends at the universe table last close, and says it is synthetic', () => {
    const a = ok('/api/bars', { query: { ...nq, start: '2021-01-01' } })
    const b = ok('/api/bars', { query: { ...nq, start: '2021-01-01' } })
    expect(b).toEqual(a)
    const universe = ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } })
    expect(a.c[a.c.length - 1]).toBe(universe.rows.find((r) => r.symbol === 'NQ.V.0')?.last_close)
    expect(a.label).toBe(DEMO_TEXT.barsLabel)
    expect(a.gate.reads_this_process).toBe(0)
  })

  it('reads a time without an offset as UTC, as the backend does, and refuses one that does not parse', () => {
    const naive = ok('/api/bars', { query: { ...nq, start: '2021-12-01', end: '2021-12-31T00:00:00' } })
    const zoned = ok('/api/bars', { query: { ...nq, start: '2021-12-01', end: '2021-12-31T00:00:00Z' } })
    expect(naive.t).toEqual(zoned.t)
    expect(new Date(naive.t[naive.t.length - 1]! * 1000).toISOString().slice(0, 10)).toBe('2021-12-30')
    refused(get('/api/bars', { query: { ...nq, start: 'last tuesday' } }), 404)
    refused(get('/api/bars', { query: { ...nq, start: '2021-06-01', end: '2021-01-01' } }), 404)
  })

  it('lists in the catalog as many rows as the whole daily series holds, weekdays only', () => {
    const all = ok('/api/bars', { query: nq })
    expect(ok('/api/data/catalog').series.find((s) => s.symbol === 'NQ.V.0')?.rows).toBe(all.t.length)
    expect(all.t.every((s) => ![0, 6].includes(new Date(s * 1000).getUTCDay()))).toBe(true)
    expect(all.start).toBe('2010-01-01T00:00:00Z')
  })

  it('serves daily vendor series only, as the demo catalog lists them', () => {
    const catalog = ok('/api/data/catalog')
    expect(new Set(catalog.series.map((s) => `${s.timeframe} ${s.variant}`))).toEqual(new Set(['1d vendor']))
    refused(get('/api/bars', { query: { ...nq, timeframe: '1m', start: '2021-12-01' } }), 404)
    refused(get('/api/bars', { query: { ...nq, variant: 'repaired' } }), 404)
    refused(get('/api/bars', { query: { ...nq, symbol: 'XX.V.0' } }), 404)
  })
})

/** The first 200 of `path` must pass `check`; one light shape test per screen read. */
type Probe = readonly [label: string, answer: () => { status: number; body: unknown }, check: (body: never) => unknown]

const RUN = 'nt_dtsmom_v0_fixture_ts1'
const HYP = 'volmanaged_v0'
const RUN_IDS = ['nt_dtsmom_v0_fixture_ts1', 'nt_overnight_v0_fixture_open', 'nt_volmanaged_v0_fixture_m1', 'nt_za_v0_fixture_a',
  'nt_za_v0_fixture_unbalanced', 'smoke_2015_01']
const gp1y = barsQuery('NQ.V.0', '1d', 'vendor', rangeWindow('1Y'))

// HOME's default layout (GP NQ 1d, MON 27F, EQ volmanaged_v0, REG), the chrome, and each A6 command line's reads.
const PROBES: readonly Probe[] = [
  ['health', () => get('/api/health'), (h: Schemas['Health']) => h.fixture_mode === true && h.fence.is_end === '2022-01-01'],
  ['commands', () => get('/api/commands'), (c: Schemas['CommandIndex']) => c.universe.includes('27F') && c.mnemonics.length === 30],
  ['HOME GP bars', () => get('/api/bars', { query: gp1y }), (b: Schemas['Bars']) => b.t.length > 200 && b.symbol === 'NQ.V.0'],
  ['GP catalog', () => get('/api/data/catalog'), (c: Schemas['DataCatalog']) => c.series.some((s) => s.symbol === 'NQ.V.0')],
  ['GP rv', () => get('/api/market/rv', { query: { symbol: 'NQ.V.0', window: RV_WINDOW } }), (r: Schemas['RealisedVolSeries']) => r.rv.length === r.t.length && r.last !== null],
  ['GP runs', () => get('/api/runs'), (r: Schemas['RunSummary'][]) => r.length === 6],
  ['GP universe (RV22 header)', () => get('/api/market/universe', { query: { window: RV_WINDOW } }), (u: Schemas['Universe']) => u.rows.length === 27 && u.window === RV_WINDOW],
  ['MON universe', () => get('/api/market/universe', { query: { window: DEFAULT_WINDOW } }), (u: Schemas['Universe']) => u.rows.length === 27],
  ['MON two-day', () => get('/api/market/two-day', { query: { symbols: 'NQ.V.0' } }), (d: Schemas['TwoDay']) => d.rows.length === 1 && d.sessions.length === 2],
  ['HOME EQ panel', () => get('/api/analytics/hypothesis/{name}/panel', { path: { name: HYP } }), (p: Schemas['HomePanel']) => p.context.name === HYP],
  ['REG registry', () => get('/api/registry'), (r: Schemas['RegistryView']) => r.rows.length > 0],
  ['REG hypotheses', () => get('/api/hypotheses'), (h: Schemas['HypothesisCard'][]) => h.some((c) => c.name === HYP)],
  ['REG confirmations', () => get('/api/confirmations'), (c: Schemas['Confirmation'][]) => c.length > 0],
  ['REG deflated', () => get('/api/analytics/deflated'), (d: Schemas['DeflatedView']) => d.tag === '[POST HOC]'],
  ['MT', () => get('/api/multiple-testing'), (m: Schemas['MultipleTesting']) => m.rows.length > 0],
  ['DES card', () => get('/api/hypotheses/{name}', { path: { name: HYP } }), (d: Schemas['HypothesisDetail']) => d.card.name === HYP],
  ['DES panel at 1 tick', () => get('/api/analytics/hypothesis/{name}/panel', { path: { name: HYP }, query: { cost: 1 } }), (p: Schemas['HomePanel']) => p.context.cost === 1],
  ['DES sealed index', () => get('/api/sealed'), (s: Schemas['SealedItem'][]) => Array.isArray(s)],
  ['RUNS stats', () => get('/api/runs/stats', { query: { ids: RUN_IDS.join(',') } }), (s: Schemas['CompareStats'][]) => s.length === 6],
  ['RUN detail', () => get('/api/runs/{run_id}', { path: { run_id: RUN } }), (d: Schemas['RunDetail']) => d.summary.run_id === RUN],
  ['RUN chart', () => get('/api/analytics/run/{run_id}/panel', { path: { run_id: RUN }, query: { freq: 'D' } }), (p: Schemas['HomePanel']) => p.context.name === RUN],
  ['RUN trades', () => get('/api/runs/{run_id}/trades', { path: { run_id: RUN }, query: { offset: 0, limit: PAGE_ROWS } }), (p: Schemas['Page_TradeRow_']) => p.items.length === p.total],
  ['RUN fills', () => get('/api/runs/{run_id}/fills', { path: { run_id: RUN }, query: { offset: 0, limit: PAGE_ROWS } }), (p: Schemas['Page_FillRow_']) => p.items.length > 0],
  ['RUN decisions', () => get('/api/runs/{run_id}/log/{section}', { path: { run_id: RUN, section: 'decisions' }, query: { offset: 0, limit: PAGE_ROWS } }), (p: Schemas['Page_dict_str__Any__']) => p.total === 1],
  ['EQ DD RET analytics', () => get('/api/analytics/hypothesis/{name}', { path: { name: HYP }, query: { cost: 1 } }), (a: Schemas['Analytics']) => a.context.name === HYP && a.n === 39],
  ['RET extended', () => get('/api/analytics/hypothesis/{name}/extended', { path: { name: HYP }, query: { cost: 1 } }), (e: Schemas['ExtendedAnalytics']) => e.context.name === HYP],
  ['RET bootstrap', () => get('/api/analytics/hypothesis/{name}/bootstrap', { path: { name: HYP }, query: { cost: 1 } }), (b: Schemas['BootstrapView']) => b.context.name === HYP],
  ['LEDG', () => get('/api/ledger'), (l: Schemas['LedgerView']) => l.ledger_found && l.rows.length > 0],
  ['OOS log', () => get('/api/audit/oos-log', { query: { limit: 5000 } }), (o: Schemas['OosLog']) => o.returned === 16 && o.parse_errors.length === 0],
  ['OOS tape', () => get('/api/audit/oos-log', { query: { limit: 3 } }), (o: Schemas['OosLog']) => o.entries.length === 3],
  ['OOS openings', () => get('/api/audit/openings'), (o: Schemas['Openings']) => o.openings.length === 1],
  ['LIVE status', () => get('/api/live/status'), (s: Schemas['LiveStatus']) => s.read_only && s.order_path === 'none'],
  ['LIVE performance', () => get('/api/live/performance'), (p: Schemas['Performance']) => p.present],
  ['LIVE routes', () => get('/api/live/routes'), (r: Schemas['LiveRoutes']) => r.present],
  ['LIVE tracking', () => get('/api/analytics/paper-tracking'), (t: Schemas['PaperTracking']) => t.present],
  ['LIVE closes', () => get('/api/live/journal', { query: { file: BOOK, type: 'close', limit: 5000 } }), (p: Schemas['Page_JournalRowOut_']) => p.items.every((r) => r.data['type'] === 'close')],
  ['JRNL rows', () => get('/api/live/journal', { query: { limit: 5000, offset: 0 } }), (p: Schemas['Page_JournalRowOut_']) => p.total === demoLiveJournalRows.length],
  ['CORR pair', () => get('/api/market/pair-corr', { query: { a: 'NQ.V.0', b: 'ZN.V.0', window: DEFAULT_WINDOW } }), (p: Schemas['PairCorrelationSeries']) => p.corr.length === p.t.length],
]

describe('HOME and the A6 command lines get 200 bodies (acceptance A5, A6)', () => {
  it.each(PROBES)('%s', (_label, answer, check) => {
    const { status, body } = answer()
    expect(status, JSON.stringify(body).slice(0, 300)).toBe(200)
    expect(check(body as never)).toBe(true)
  })
})

describe('the command index and the bodies agree (every id the index offers opens its screen or is honestly absent)', () => {
  const index = ok('/api/commands')

  it('lists every registry row as a hypothesis (G01), each answering its DES card or the honest 404', () => {
    const registry = ok('/api/registry').rows.map((r) => r.name)
    expect(index.hypotheses).toContain(HYP)
    expect([...index.hypotheses].sort()).toEqual([...registry].sort())
    for (const name of index.hypotheses) {
      const answer = get('/api/hypotheses/{name}', { path: { name } })
      if (answer.status === 200) expect((answer.body as Schemas['HypothesisDetail']).card.name).toBe(name)
      else refused(answer, 404)
    }
  })

  it('answers the honest 404, not a parser error, for a passing hypothesis with no captured card (G01)', () => {
    for (const name of ['tom_v0', 'eomtsy_v0', 'vt_har_v0']) {
      expect(index.hypotheses).toContain(name)
      refused(get('/api/hypotheses/{name}', { path: { name } }), 404)
    }
  })

  it('lists confirmations that /api/confirmations holds', () => {
    const held = ok('/api/confirmations').map((c) => c.name)
    expect(index.confirmations.length).toBeGreaterThan(0)
    for (const name of index.confirmations) expect(held).toContain(name)
  })

  it('lists every run of /api/runs (G01), each answering its record or the honest 404', () => {
    const listed = ok('/api/runs').map((r) => r.run_id)
    expect(index.runs).toContain(RUN)
    expect([...index.runs].sort()).toEqual([...listed].sort())
    for (const id of index.runs) {
      const answer = get('/api/runs/{run_id}', { path: { run_id: id } })
      if (answer.status === 200) expect((answer.body as Schemas['RunDetail']).summary.run_id).toBe(id)
      else refused(answer, 404)
    }
  })

  it('reaches both run tear sheets the demo serves (nt_volmanaged_v0_fixture_m1 and smoke_2015_01) through the index', () => {
    for (const id of ['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01']) {
      expect(index.runs).toContain(id)
      expect(get('/api/analytics/run/{run_id}', { path: { run_id: id } }).status).toBe(200)
    }
  })

  it('lists instruments that each have demo prices', () => {
    expect(index.instruments.map((i) => i.root)).toContain('NQ')
    for (const { symbol } of index.instruments) {
      expect(ok('/api/bars', { query: { symbol, start: '2021-12-01' } }).symbol).toBe(symbol)
    }
  })

  it('keeps the mnemonic list the registry has, and the fixture flag on health', () => {
    expect(index.mnemonics.map((m) => m.code)).toContain('JOBS')
    expect(index.registry_error).toBeNull()
  })
})

describe('no body is served under another context', () => {
  it('answers each analytics GET only with a body whose own context is the one asked for', () => {
    const hyp = ok('/api/analytics/hypothesis/{name}', { path: { name: HYP } })
    expect(hyp.context).toEqual({ kind: 'hypothesis', name: HYP, cost: 1, freq: 'D' })
    const run = ok('/api/analytics/run/{run_id}', { path: { run_id: 'nt_volmanaged_v0_fixture_m1' } })
    expect(run.context).toMatchObject({ kind: 'run', name: 'nt_volmanaged_v0_fixture_m1', freq: 'D' })
    const trades = ok('/api/analytics/run/{run_id}/trades', { path: { run_id: 'nt_za_v0_fixture_a' } })
    expect(trades.run_id).toBe('nt_za_v0_fixture_a')
    gapped(get('/api/analytics/run/{run_id}/panel', { path: { run_id: 'nt_overnight_v0_fixture_open' } }))
  })

  it('serves the P1 test bodies only for the request they describe', () => {
    expect(ok('/api/events/study', { query: { symbol: 'NQ.V.0', event: 'FOMC', mode: 'daily', pre: 2, post: 2 } }).n_used).toBe(2)
    refused(get('/api/events/study', { query: { symbol: 'NQ.V.0', event: 'FOMC', mode: 'daily', pre: 5, post: 5 } }), 404)
    expect(ok('/api/market/vcone', { query: { symbol: 'NQ.V.0' } }).root).toBe('NQ')
    refused(get('/api/seasonality/instrument/{root}', { path: { root: 'NQ' }, query: { start_year: 2010, end_year: 2021 } }), 404)
    expect(ok('/api/seasonality/instrument/{root}', { path: { root: 'NQ' }, query: { start_year: 2020, end_year: 2021 } }).subject).toBe('NQ.V.0')
    expect(ok('/api/market/rolls').markets.map((m) => m.root)).toEqual(['NQ', 'CL'])
  })

  it('reads every Phase 11 demo gate (VCONE, ROLL, EVT study, SEAS) as zero reads, consistent with the status bar (no real gate read backs the demo)', () => {
    const zeroGate = { caller: 'demo', served_years: [], cached: false, reads_this_process: 0 }
    const cone = ok('/api/market/vcone', { query: { symbol: 'NQ.V.0' } })
    expect(cone.gate).toEqual(zeroGate)
    const universe = ok('/api/market/vcone/universe', { query: { horizon: 21 } })
    expect(universe.gate).toEqual(zeroGate)
    const rolls = ok('/api/market/rolls')
    expect(rolls.gate).toEqual(zeroGate)
    const study = ok('/api/events/study', { query: { symbol: 'NQ.V.0', event: 'FOMC', mode: 'daily', pre: 2, post: 2 } })
    expect(study.gate).toEqual(zeroGate)
    const seas = ok('/api/seasonality/instrument/{root}', { path: { root: 'NQ' }, query: { start_year: 2020, end_year: 2021 } })
    expect(seas.gate).toEqual(zeroGate)
  })

  it('reads every market body as zero reads: the universe table at 252 and 22, the RV22 line and the pair correlation', () => {
    // MON and CORR print this record as "Gate: caller ..., N reads this process": the fixture table (screens/mon/testUniverse.ts)
    // carries the 27 reads of the day it was captured, which the demo must not repeat (health says gate_reads 0).
    const zeroGate = { caller: 'demo', served_years: [], cached: false, reads_this_process: 0 }
    expect(ok('/api/market/universe', { query: { window: 252 } }).gate).toEqual(zeroGate)
    expect(ok('/api/market/universe', { query: { window: 22 } }).gate).toEqual(zeroGate)
    expect(ok('/api/market/rv', { query: { symbol: 'NQ.V.0', window: 22 } }).gate).toEqual(zeroGate)
    expect(ok('/api/market/pair-corr', { query: { a: 'NQ.V.0', b: 'ZN.V.0', window: DEFAULT_WINDOW } }).gate).toEqual(zeroGate)
  })
})

describe('a run tear sheet reads the run record first, so every run with analytics has one (P5)', () => {
  // useTearAnalytics asks GET /api/runs/{id} and only then the analytics route: a run that has analytics but no record
  // refuses every tear sheet tab (EQ, DD, RET, RR, MRET) with "not in the demo dataset".
  const TEAR_RUNS = ['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01'] as const

  it.each(TEAR_RUNS)('%s: GET /api/runs/{run_id} answers 200 with the record of that run', (id) => {
    const detail = ok('/api/runs/{run_id}', { path: { run_id: id } })
    expect(detail.summary.run_id).toBe(id)
    expect(detail.config['run_id']).toBe(id)
    expect(detail.summary.readable).toBe(true)
    // The tear sheet asks analytics only for a run whose balance check passed (rule 4).
    expect(detail.summary.balance_ok).toBe(true)
    expect(detail.summary.usable).toBe(true)
  })

  it.each(TEAR_RUNS)('%s: the record agrees with the analytics body about the same run (id, freq, dates)', (id) => {
    const detail = ok('/api/runs/{run_id}', { path: { run_id: id } })
    const analytics = ok('/api/analytics/run/{run_id}', { path: { run_id: id } })
    expect(analytics.context).toMatchObject({ kind: 'run', name: detail.summary.run_id, freq: 'D' })
    // The daily series lies inside the dates the run covered (start inclusive, end exclusive).
    expect(analytics.first! >= detail.summary.start!).toBe(true)
    expect(analytics.last! < detail.summary.end!).toBe(true)
  })

  it.each(TEAR_RUNS)('%s: the record is the very row the run list holds, and the counts match the tables it names', (id) => {
    const detail = ok('/api/runs/{run_id}', { path: { run_id: id } })
    expect(detail.summary).toEqual(ok('/api/runs').find((r) => r.run_id === id))
    expect(detail.counts.trades).toBe(detail.summary.n_trades)
    expect(detail.summary_stats['n_trades']).toBe(detail.summary.n_trades)
    expect(detail.balance_check['ok']).toBe(true)
  })

  it('a run with mark to market snapshots carries them (the analytics series is built from them)', () => {
    const detail = ok('/api/runs/{run_id}', { path: { run_id: 'nt_volmanaged_v0_fixture_m1' } })
    const analytics = ok('/api/analytics/run/{run_id}', { path: { run_id: 'nt_volmanaged_v0_fixture_m1' } })
    expect(analytics.source).toBe('mtm_snapshots')
    expect(detail.log_sections['snapshots']).toBe(analytics.n)
    expect(detail.summary.kind).toBe('sized')
  })

  it('names as evidence only runs that have both a record and analytics', () => {
    const named = evidenceInDemo().runs
    expect([...named].sort()).toEqual([...TEAR_RUNS].sort())
    for (const id of named) {
      expect(get('/api/runs/{run_id}', { path: { run_id: id } }).status, `${id} record`).toBe(200)
      expect(get('/api/analytics/run/{run_id}', { path: { run_id: id } }).status, `${id} analytics`).toBe(200)
    }
  })

  it('still answers the honest 404 for a run the dataset holds no record of', () => {
    refused(get('/api/runs/{run_id}', { path: { run_id: 'nt_za_v0_fixture_a' } }), 404)
    refused(get('/api/runs/{run_id}', { path: { run_id: 'nt_not_in_the_demo' } }), 404)
  })
})

describe('GP asks the universe at its RV window (P5)', () => {
  // useGpData reads GET /api/market/universe?window=22 for the RV22 header on every daily chart that ends at the fence,
  // HOME's GP included. A refusal there is a console error on every page that opens GP.
  const rowOf = (u: Schemas['Universe'], symbol: string) => u.rows.find((r) => r.symbol === symbol)!

  it('serves the window GP asks for, describing that window', () => {
    const u = ok('/api/market/universe', { query: { window: RV_WINDOW } })
    expect(u.window).toBe(RV_WINDOW)
    expect(u.correlation_window.sessions).toBe(RV_WINDOW)
    expect(u.rows).toHaveLength(27)
    expect(u.as_of).toBe('2021-12-31')
    // The same filler table as the default window, so the same gate record too.
    expect(u.gate).toEqual(ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } }).gate)
  })

  it('is the same on every call and keeps the same symbols, last closes and one day returns as the default window', () => {
    const a = ok('/api/market/universe', { query: { window: RV_WINDOW } })
    expect(ok('/api/market/universe', { query: { window: RV_WINDOW } })).toEqual(a)
    const d = ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } })
    expect(a.rows.map((r) => r.symbol)).toEqual(d.rows.map((r) => r.symbol))
    for (const row of a.rows) {
      expect(row.last_close, row.symbol).toBe(rowOf(d, row.symbol).last_close)
      expect(row.returns['1D'], row.symbol).toBe(rowOf(d, row.symbol).returns['1D'])
    }
  })

  it('reads the RV22 header from the same number as the RV22 pane ends on, for every symbol', () => {
    const u = ok('/api/market/universe', { query: { window: RV_WINDOW } })
    for (const row of u.rows) {
      const line = ok('/api/market/rv', { query: { symbol: row.symbol, window: RV_WINDOW } })
      expect(row.realised_vol, row.symbol).toBe(line.last)
    }
  })

  it('leaves the default window table exactly as it was', () => {
    const d = ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } })
    expect(d.window).toBe(252)
    expect(d.correlation_window.sessions).toBe(252)
    expect(rowOf(d, 'NQ.V.0').realised_vol).toBe(0.27304595530797793)
    expect(ok('/api/market/universe')).toEqual(d)
  })

  it('still refuses a window the dataset holds no table for, and one outside the contract (20 to 2520)', () => {
    for (const window of [63, 126, 21, 253]) refused(get('/api/market/universe', { query: { window } }), 404)
    refused(raw('/api/market/universe', { window: '19' }), 404)
    refused(raw('/api/market/universe', { window: '2521' }), 404)
    refused(raw('/api/market/universe', { window: '22.5' }), 404)
  })
})

describe('DES cards carry a screen file only under the hypothesis it was recorded for', () => {
  const screenOf = (name: string) => ok('/api/hypotheses/{name}', { path: { name } }).screen as Record<string, unknown> | null

  it('serves volmanaged_v0 with its screen: the variants and the card spec sha', () => {
    const detail = ok('/api/hypotheses/{name}', { path: { name: HYP } })
    const screen = detail.screen as Record<string, unknown>
    expect(screen['name']).toBe(HYP)
    expect(screen['spec_sha256']).toBe(detail.card.spec_sha256)
    expect(Object.keys(screen['variants'] as Record<string, unknown>)).toHaveLength(13)
    expect(screen['placebo']).toBeTruthy()
    // The whole file the fixture holds, served unchanged.
    expect(screen).toEqual(VOLMANAGED_SCREEN)
  })

  it('serves overnight_v0 with its own screen, subsets included', () => {
    const detail = ok('/api/hypotheses/{name}', { path: { name: 'overnight_v0' } })
    const screen = detail.screen as Record<string, unknown>
    expect(screen['name']).toBe('overnight_v0')
    expect(screen['spec_sha256']).toBe(detail.card.spec_sha256)
    expect(screen['subsets']).toBeTruthy()
    expect(screen).toEqual(OVERNIGHT_SCREEN)
  })

  it('leaves every other card with the screen it was captured with (its name only)', () => {
    for (const captured of [REBAL, ZA, ZA_C3]) {
      expect(screenOf(captured.card.name)).toEqual(captured.screen)
    }
  })

  it('never serves a screen file whose name or spec sha is not its card\'s', () => {
    // A captured stub is just {name} (a card can name a differently named screen, za_v0's is za_v0_repaired);
    // a whole file carries its spec sha and must be the card's own.
    const whole = [...HYPOTHESIS_DETAILS].filter(([, detail]) => detail.screen !== null && 'spec_sha256' in detail.screen)
    expect(whole.map(([name]) => name).sort()).toEqual(['overnight_v0', 'volmanaged_v0'])
    for (const [name, detail] of whole) {
      expect(detail.screen?.['name']).toBe(name)
      expect(detail.screen?.['spec_sha256']).toBe(detail.card.spec_sha256)
    }
  })

  it('does not write into the captured cards the tests and the gallery share', () => {
    expect(VOLMANAGED.screen).toEqual({ name: HYP })
    expect(OVERNIGHT.screen).toEqual({ name: 'overnight_v0' })
  })

  describe('withScreen', () => {
    it('attaches the screen of a matching name and spec sha, as a copy of the card', () => {
      const attached = withScreen(VOLMANAGED, VOLMANAGED_SCREEN)
      expect(attached.screen).toBe(VOLMANAGED_SCREEN)
      expect(attached).not.toBe(VOLMANAGED)
      expect(attached.card).toBe(VOLMANAGED.card)
    })

    it('leaves the detail as it is when the screen belongs to another hypothesis', () => {
      expect(withScreen(VOLMANAGED, OVERNIGHT_SCREEN)).toBe(VOLMANAGED)
      expect(withScreen(OVERNIGHT, VOLMANAGED_SCREEN)).toBe(OVERNIGHT)
    })

    it('leaves the detail as it is when only the name matches (a screen of another spec version)', () => {
      expect(withScreen(VOLMANAGED, { ...VOLMANAGED_SCREEN, spec_sha256: 'f'.repeat(64) })).toBe(VOLMANAGED)
    })

    it('leaves the detail as it is when only the spec sha matches (a file under another name)', () => {
      expect(withScreen(VOLMANAGED, { ...VOLMANAGED_SCREEN, name: 'overnight_v0' })).toBe(VOLMANAGED)
    })

    it('leaves the detail as it is when the screen records no spec sha', () => {
      const { spec_sha256: _sha, ...unsealed } = VOLMANAGED_SCREEN
      expect(withScreen(VOLMANAGED, unsealed)).toBe(VOLMANAGED)
    })
  })
})

describe('pages, filters and fillers', () => {
  it('pages a run table the way the API does (offset, limit, total)', () => {
    const page = ok('/api/runs/{run_id}/fills', { path: { run_id: RUN }, query: { offset: 2, limit: 3 } })
    expect(page).toMatchObject({ offset: 2, limit: 3, total: 11 })
    expect(page.items).toHaveLength(3)
  })

  it('filters the journal by file and row type, and refuses a journal the dataset does not hold', () => {
    const book = ok('/api/live/journal', { query: { file: BOOK } })
    expect(book.items.every((r) => r.file === BOOK)).toBe(true)
    refused(get('/api/live/journal', { query: { file: 'other.jsonl' } }), 404)
  })

  it('exports the journal rows and status the demo event source replays, the same ones the routes serve', () => {
    expect(ok('/api/live/status')).toEqual(demoLiveStatus)
    expect(ok('/api/live/journal', { query: { limit: 5000 } }).items).toEqual(demoLiveJournalRows)
  })

  it('pages the OOS log from the newest entry back, and filters it by caller', () => {
    const newest = ok('/api/audit/oos-log', { query: { limit: 2 } })
    expect(newest.entries.map((e) => e.line_no)).toEqual([15, 16])
    const before = ok('/api/audit/oos-log', { query: { limit: 2, offset: 2 } })
    expect(before.entries.map((e) => e.line_no)).toEqual([13, 14])
    const sealed = ok('/api/audit/oos-log', { query: { caller: 'rebal_v1_confirm' } })
    expect(sealed.matched).toBe(2)
    expect(sealed.entries.every((e) => e.is_sealed && e.severity === 4 && e.alert)).toBe(true)
  })

  it('ends the two-day line at the universe last close, on the side the 1D return points to', () => {
    const universe = ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } })
    const symbols = universe.rows.map((r) => r.symbol)
    const twoDay = ok('/api/market/two-day', { query: { symbols: symbols.join(',') } })
    for (const row of twoDay.rows) {
      const u = universe.rows.find((r) => r.symbol === row.symbol)!
      expect(row.last).toBe(u.last_close)
      const r1d = u.returns['1D'] ?? 0
      if (r1d !== 0) expect(Math.sign(row.last! - row.prior_close!)).toBe(Math.sign(r1d))
    }
  })

  it('ends the pair filler at the universe matrix entry for the same window', () => {
    const universe = ok('/api/market/universe', { query: { window: DEFAULT_WINDOW } })
    const block = universe.correlation_window
    const entry = block.matrix[block.symbols.indexOf('NQ.V.0')]![block.symbols.indexOf('ZN.V.0')]
    const pair = ok('/api/market/pair-corr', { query: { a: 'NQ.V.0', b: 'ZN.V.0', window: DEFAULT_WINDOW } })
    expect(pair.corr[pair.corr.length - 1]).toBe(entry)
    expect(pair.corr.every((v) => v === null || (v >= -1 && v <= 1))).toBe(true)
  })
})

describe('designed tear sheet gaps say where the evidence is (N01)', () => {
  const EVIDENCE = 'Evidence in this demo: volmanaged_v0 DES, EQ and RET at 1 tick per side; run tear sheets for nt_volmanaged_v0_fixture_m1 and smoke_2015_01'
  const GAP = `${DEMO_DETAIL.notInDemo}. ${EVIDENCE}`

  /** Every analytics GET the tear screens make for a context the dataset did not capture. */
  const GAPS: ReadonlyArray<readonly [string, () => { status: number; body: unknown }]> = [
    ['hypothesis tear sheet', () => get('/api/analytics/hypothesis/{name}', { path: { name: 'overnight_v0' }, query: { cost: 1 } })],
    ['hypothesis panel', () => get('/api/analytics/hypothesis/{name}/panel', { path: { name: 'overnight_v0' }, query: { cost: 2 } })],
    ['hypothesis extended', () => get('/api/analytics/hypothesis/{name}/extended', { path: { name: 'overnight_v0' }, query: { cost: 0 } })],
    ['hypothesis bootstrap', () => get('/api/analytics/hypothesis/{name}/bootstrap', { path: { name: 'eomtsy_v0' } })],
    ['run tear sheet', () => get('/api/analytics/run/{run_id}', { path: { run_id: 'nt_overnight_v0_fixture_open' } })],
    ['run panel', () => get('/api/analytics/run/{run_id}/panel', { path: { run_id: 'nt_overnight_v0_fixture_open' } })],
    ['run trades', () => get('/api/analytics/run/{run_id}/trades', { path: { run_id: 'nt_overnight_v0_fixture_open' } })],
    ['a cost of the captured hypothesis that was not captured', () => get('/api/analytics/hypothesis/{name}', { path: { name: 'volmanaged_v0' }, query: { cost: 2 } })],
  ]

  it.each(GAPS)('%s: the 404 keeps the demo refusal words and points to what exists', (_label, answer) => {
    refused(answer(), 404, GAP)
  })

  it('always starts with the plain demo refusal, so the offline server can still recognise a designed gap', () => {
    for (const [, answer] of GAPS) {
      const { status, body } = answer()
      expect(status).toBe(404)
      expect((body as { detail: string }).detail.startsWith(DEMO_DETAIL.notInDemo)).toBe(true)
    }
  })

  it('names only evidence that is really served: the hypothesis tear sheet, its DES card and both run tear sheets answer 200', () => {
    expect(ok('/api/analytics/hypothesis/{name}', { path: { name: 'volmanaged_v0' }, query: { cost: 1 } }).context.name).toBe('volmanaged_v0')
    expect(get('/api/hypotheses/{name}', { path: { name: 'volmanaged_v0' } }).status).toBe(200)
    for (const id of ['nt_volmanaged_v0_fixture_m1', 'smoke_2015_01']) {
      expect(get('/api/analytics/run/{run_id}', { path: { run_id: id } }).status, id).toBe(200)
    }
  })

  it('leaves the other honest 404s as the plain refusal (a DES card, a run record, a QA record)', () => {
    refused(get('/api/hypotheses/{name}', { path: { name: 'overnight_v0_missing' } }), 404)
    refused(get('/api/runs/{run_id}', { path: { run_id: 'nt_not_in_the_demo' } }), 404)
    refused(get('/api/qa'), 404)
  })

  it('follows the copy rules', () => {
    expect(findCopyViolations({ GAP })).toEqual([])
  })
})

describe('the dataset own words follow the copy rules (UI_SPEC section 10)', () => {
  it('has no dash and no US spelling in any detail or label it serves', () => {
    expect(findCopyViolations({ DEMO_DETAIL, DEMO_TEXT, GAP_TEXT })).toEqual([])
  })
})

/** answerDemo over a raw query, bypassing buildApiUrl's typing (a malformed value is not a legal RequestOf). */
function raw(pathname: string, query: Record<string, string>) {
  return answerDemo(pathname, new URLSearchParams(query))
}

describe("a malformed integer query parameter is the honest 404, never the default's body", () => {
  it('gives NOT_IN_DEMO instead of quietly falling back to the default', () => {
    refused(raw('/api/analytics/hypothesis/volmanaged_v0', { cost: 'abc' }), 404)
    refused(raw('/api/runs/nt_dtsmom_v0_fixture_ts1/trades', { offset: '-1' }), 404)
    refused(raw('/api/runs/nt_dtsmom_v0_fixture_ts1/trades', { limit: 'x' }), 404)
    refused(raw('/api/audit/oos-log', { limit: '-5' }), 404)
    refused(raw('/api/market/universe', { window: 'abc' }), 404)
    refused(raw('/api/bars', { symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor', start: '2021-01-01', max_points: 'abc' }), 404)
  })

  it('still answers 200 for the same paths when the parameter is simply absent', () => {
    expect(raw('/api/analytics/hypothesis/volmanaged_v0', {}).status).toBe(200)
    expect(raw('/api/runs/nt_dtsmom_v0_fixture_ts1/trades', {}).status).toBe(200)
    expect(raw('/api/audit/oos-log', {}).status).toBe(200)
    expect(raw('/api/market/universe', {}).status).toBe(200)
    expect(raw('/api/bars', { symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor', start: '2021-01-01' }).status).toBe(200)
  })
})

describe('intParam', () => {
  const q = (text?: string) => new URLSearchParams(text === undefined ? {} : { k: text })

  it('gives the fallback when absent, the number when valid, and null when malformed', () => {
    expect(intParam(q(), 'k', 7)).toBe(7)
    expect(intParam(q('12'), 'k', 7)).toBe(12)
    expect(intParam(q('abc'), 'k', 7)).toBeNull()
    expect(intParam(q('-1'), 'k', 7)).toBeNull()
    expect(intParam(q('1.5'), 'k', 7)).toBeNull()
  })
})
