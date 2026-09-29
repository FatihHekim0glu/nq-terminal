// @vitest-environment jsdom
// The tear sheet's provenance for GRAB's caption (roadmap 15): tags, basis, unit, window, sessions, the
// request the numbers came from and the spec sha, all read from the Analytics answer the sheet already
// holds. Nothing is asked or computed here; TearBody registers it for the panel it sits in.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { panelSource, resetPanelSources } from '../../chrome/panelSources'
import { GRAB } from '../../copy/grab'
import { RUN_TAGS } from '../../copy/runs'
import { fillCopy } from '../../copy/workspace'
import { VOLMANAGED } from '../des/desTestData'
import { HYP_ANALYTICS, RUN_ANALYTICS } from './tear.fixtures'
import { HYP_BOOTSTRAP, HYP_EXTENDED, RUN_EXTENDED } from './tearP1.fixtures'
import TearBody from './TearBody'
import type { TearCode } from './TearSheet'
import { tearProvenance } from './tearGrab'
import { tearTags } from './tearKpis'
import type { TearTarget } from './tearQueries'
import { tearSources } from './tearSource'

// jsdom draws no canvas: the charts stand in as plain boxes (this file has no JSX, so the factories build them).
async function box(testId: string) {
  const { createElement: h } = await import('react')
  return () => h('div', { 'data-testid': testId })
}
vi.mock('../../charts/LineStack', async () => ({ default: await box('linestack') }))
vi.mock('../../charts/echarts/Heatmap', async () => ({ Heatmap: await box('heatmap') }))
vi.mock('../../charts/echarts/Distribution', async () => ({ Distribution: await box('distribution') }))
vi.mock('../../charts/echarts/BarLadder', async () => ({ BarLadder: await box('barladder') }))
vi.mock('../../charts/echarts/XyScatter', async () => ({ XyScatter: await box('xyscatter') }))
vi.mock('../../charts/echarts/Cone', async () => ({ Cone: await box('cone') }))

const HYPOTHESIS: TearTarget = { kind: 'hypothesis', name: 'volmanaged_v0' }
const RUN_ID = 'nt_volmanaged_v0_fixture_m1'
const RUN: TearTarget = { kind: 'run', name: RUN_ID }
const SHA = VOLMANAGED.card.spec_sha256

describe('tearProvenance', () => {
  it('describes a hypothesis tear sheet from its Analytics answer', () => {
    const p = tearProvenance(HYP_ANALYTICS, HYPOTHESIS, SHA)
    expect(p.source).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1')
    expect(p.basis).toBe('Basis A: screen (arithmetic on a fixed K)')
    expect(p.unit).toBe('return on capital per session')
    expect(p.window).toBe('2011-04-25..2011-06-17')
    expect(p.n).toBe(39)
    expect(p.specSha).toBe(SHA)
    expect(p.tags).toContain('[POST HOC]')
  })

  it('describes a run tear sheet with its frequency and no spec sha', () => {
    const p = tearProvenance(RUN_ANALYTICS, RUN, null)
    expect(p.source).toBe(`/api/analytics/run/${RUN_ID}?freq=D`)
    expect(p.basis).toBe('Basis B: account (compounded from K)')
    expect(p.unit).toBe('return on the account per session')
    expect(p.window).toBe('2011-06-03..2011-06-16')
    expect(p.n).toBe(10)
    expect(p.specSha).toBeNull()
  })

  it('writes every tag the sheet shows (series tag, then [PRE-REG] tiles) with its brackets', () => {
    const p = tearProvenance(HYP_ANALYTICS, HYPOTHESIS, null)
    expect(p.tags).toEqual(tearTags(HYP_ANALYTICS).map((tag) => `[${tag}]`))
    expect(p.tags.every((tag) => /^\[[^\]]+\]$/.test(tag))).toBe(true)
    expect(p.tags[0]).toBe('[POST HOC]')
  })

  it('words the basis and the window with the GRAB caption templates', () => {
    const p = tearProvenance(HYP_ANALYTICS, HYPOTHESIS, null)
    expect(p.basis).toBe(fillCopy(GRAB.caption.basis, { basis: HYP_ANALYTICS.basis, label: HYP_ANALYTICS.basis_label }))
    expect(p.window).toBe(fillCopy(GRAB.caption.window, { first: HYP_ANALYTICS.first, last: HYP_ANALYTICS.last }))
  })

  it('names the request the answer came from: the answer context, not a guess', () => {
    const monthly = { ...RUN_ANALYTICS, context: { ...RUN_ANALYTICS.context, freq: 'M' as const } }
    expect(tearProvenance(monthly, RUN, null).source).toBe(`/api/analytics/run/${RUN_ID}?freq=M`)
    const dearer = { ...HYP_ANALYTICS, context: { ...HYP_ANALYTICS.context, cost: 2 } }
    expect(tearProvenance(dearer, HYPOTHESIS, null).source).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=2')
  })

  it('keeps a zero cost, which is a recorded cost', () => {
    const free = { ...HYP_ANALYTICS, context: { ...HYP_ANALYTICS.context, cost: 0 } }
    expect(tearProvenance(free, HYPOTHESIS, null).source).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=0')
  })

  it('makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    tearProvenance(HYP_ANALYTICS, HYPOTHESIS, SHA)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('tearProvenance: the honesty tags of a run', () => {
  it('ends with [PROBE: never a result] for a probe, after the sheet tags', () => {
    const p = tearProvenance(RUN_ANALYTICS, RUN, null, { extraTags: [RUN_TAGS.probe] })
    expect(p.tags).toEqual([...tearTags(RUN_ANALYTICS).map((tag) => `[${tag}]`), '[PROBE: never a result]'])
    expect(p.tags.at(-1)).toBe('[PROBE: never a result]')
  })

  it('ends with [ANCHOR] for an anchor, and carries both in the probe then anchor order', () => {
    expect(tearProvenance(RUN_ANALYTICS, RUN, null, { extraTags: [RUN_TAGS.anchor] }).tags.at(-1)).toBe('[ANCHOR]')
    const both = tearProvenance(RUN_ANALYTICS, RUN, null, { extraTags: [RUN_TAGS.probe, RUN_TAGS.anchor] })
    expect(both.tags.slice(-2)).toEqual(['[PROBE: never a result]', '[ANCHOR]'])
  })

  it('adds nothing without extra tags', () => {
    expect(tearProvenance(RUN_ANALYTICS, RUN, null, { extraTags: [] }).tags).toEqual(tearProvenance(RUN_ANALYTICS, RUN, null).tags)
  })
})

describe('tearProvenance: every GET the image draws from', () => {
  const ANALYTICS = '/api/analytics/hypothesis/volmanaged_v0?cost=1'
  const BOOTSTRAP = '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1'
  const EXTENDED = '/api/analytics/hypothesis/volmanaged_v0/extended?cost=1'

  it('names the analytics GET alone without other sources', () => {
    expect(tearProvenance(HYP_ANALYTICS, HYPOTHESIS, null).source).toBe(ANALYTICS)
    expect(tearProvenance(HYP_ANALYTICS, HYPOTHESIS, null, { alsoSources: [] }).source).toBe(ANALYTICS)
  })

  it('joins the analytics path and the other paths with the caption pair, in order', () => {
    const p = tearProvenance(HYP_ANALYTICS, HYPOTHESIS, null, { alsoSources: [BOOTSTRAP, EXTENDED] })
    expect(p.source).toBe([ANALYTICS, BOOTSTRAP, EXTENDED].join(GRAB.caption.pair))
  })
})

describe('tearSources: the GETs behind the figures a tab draws', () => {
  const HYP_CTX = HYP_ANALYTICS.context
  const RUN_CTX = RUN_ANALYTICS.context
  const none = { bootstrap: false, extended: false }
  const A = '/api/analytics/hypothesis/volmanaged_v0?cost=1'
  const B = '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1'
  const X = '/api/analytics/hypothesis/volmanaged_v0/extended?cost=1'
  const RA = `/api/analytics/run/${RUN_ID}?freq=D`
  const RB = `/api/analytics/run/${RUN_ID}/bootstrap?freq=D`
  const RX = `/api/analytics/run/${RUN_ID}/extended?freq=D`
  const BOOKS = ['trades', 'costs', 'exposure', 'excursions', 'trade-paths'].map((leaf) => `/api/analytics/run/${RUN_ID}/${leaf}`)

  it('EQ of a hypothesis with a bootstrap: the analytics GET, then the bootstrap GET (the cone)', () => {
    expect(tearSources(HYPOTHESIS, 'EQ', HYP_CTX, { bootstrap: true, extended: false })).toEqual([A, B])
  })

  it('EQ without a bootstrap (too few sessions) names the analytics GET alone', () => {
    expect(tearSources(HYPOTHESIS, 'EQ', HYP_CTX, none)).toEqual([A])
  })

  it('EQ with the market context adds the extended GET after the bootstrap GET', () => {
    expect(tearSources(HYPOTHESIS, 'EQ', HYP_CTX, { bootstrap: true, extended: true })).toEqual([A, B, X])
    expect(tearSources(HYPOTHESIS, 'EQ', HYP_CTX, { bootstrap: false, extended: true })).toEqual([A, X])
  })

  it('RR and RET add the extended GET with the same query', () => {
    expect(tearSources(HYPOTHESIS, 'RR', HYP_CTX, { bootstrap: false, extended: true })).toEqual([A, X])
    expect(tearSources(HYPOTHESIS, 'RET', HYP_CTX, { bootstrap: false, extended: true })).toEqual([A, X])
  })

  it('DD adds the extended GET only when the market context is drawn', () => {
    expect(tearSources(HYPOTHESIS, 'DD', HYP_CTX, { bootstrap: false, extended: true })).toEqual([A, X])
    expect(tearSources(HYPOTHESIS, 'DD', HYP_CTX, none)).toEqual([A])
  })

  it('a tab that draws neither adds neither, whatever the flags say', () => {
    expect(tearSources(HYPOTHESIS, 'MRET', HYP_CTX, { bootstrap: true, extended: true })).toEqual([A])
    expect(tearSources(HYPOTHESIS, 'DD', HYP_CTX, { bootstrap: true, extended: false })).toEqual([A])
    expect(tearSources(HYPOTHESIS, 'RR', HYP_CTX, { bootstrap: true, extended: true })).toEqual([A, X])
  })

  it('a hypothesis never lists the run books', () => {
    for (const tab of ['EQ', 'DD', 'RET', 'RR', 'MRET'] as const) {
      expect(tearSources(HYPOTHESIS, tab, HYP_CTX, { bootstrap: true, extended: true }).some((path) => path.includes('/trades'))).toBe(false)
    }
  })

  it('leaves the cost out of the sub-routes when none is known, and keeps a zero cost', () => {
    expect(tearSources(HYPOTHESIS, 'EQ', { cost: null, freq: 'D' }, { bootstrap: true, extended: true })).toEqual([
      '/api/analytics/hypothesis/volmanaged_v0',
      '/api/analytics/hypothesis/volmanaged_v0/bootstrap',
      '/api/analytics/hypothesis/volmanaged_v0/extended',
    ])
    expect(tearSources(HYPOTHESIS, 'EQ', { cost: 0, freq: 'D' }, { bootstrap: true, extended: false })[1]).toBe('/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=0')
  })

  it('a run asks at its frequency: the bootstrap and extended GETs carry ?freq=D, then the run books in order', () => {
    expect(tearSources(RUN, 'EQ', RUN_CTX, { bootstrap: true, extended: true })).toEqual([RA, RB, RX, ...BOOKS])
    expect(tearSources(RUN, 'RR', RUN_CTX, { bootstrap: false, extended: true })).toEqual([RA, RX, ...BOOKS])
    expect(tearSources(RUN, 'RET', RUN_CTX, { bootstrap: false, extended: true })).toEqual([RA, RX, ...BOOKS])
  })

  it('a run lists /trades, /costs, /exposure, /excursions and /trade-paths last on every tab', () => {
    for (const tab of ['EQ', 'DD', 'RET', 'RR', 'MRET'] as const satisfies readonly TearCode[]) {
      const paths = tearSources(RUN, tab, RUN_CTX, none)
      expect(paths.slice(-5)).toEqual(BOOKS)
      expect(paths[0]).toBe(RA)
    }
    expect(tearSources(RUN, 'DD', RUN_CTX, none)).toEqual([RA, ...BOOKS])
  })

  it('a run at the monthly frequency asks its sub-routes monthly', () => {
    expect(tearSources(RUN, 'EQ', { cost: null, freq: 'M' }, { bootstrap: true, extended: false }).slice(0, 2)).toEqual([
      `/api/analytics/run/${RUN_ID}?freq=M`,
      `/api/analytics/run/${RUN_ID}/bootstrap?freq=M`,
    ])
  })

  it('encodes the name as one path segment', () => {
    const odd: TearTarget = { kind: 'run', name: 'a b/c' }
    expect(tearSources(odd, 'DD', { cost: null, freq: 'D' }, none)[1]).toBe('/api/analytics/run/a%20b%2Fc/trades')
  })

  it('makes no request', () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    tearSources(RUN, 'EQ', RUN_CTX, { bootstrap: true, extended: true })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ------------------------------------------------------------ TearBody registers it for its panel

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let hypothesisAnalytics: typeof HYP_ANALYTICS = HYP_ANALYTICS
let runFlags = { is_probe: false, is_anchor: false }
let extendedServed = true
let requested: string[] = []

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  requested.push(`${path}${url.search}`)
  if (path === '/api/hypotheses/volmanaged_v0') return json(VOLMANAGED)
  if (path === '/api/analytics/hypothesis/volmanaged_v0') return json(hypothesisAnalytics)
  if (path === '/api/analytics/hypothesis/volmanaged_v0/bootstrap') return json(HYP_BOOTSTRAP)
  if (path === '/api/analytics/hypothesis/volmanaged_v0/extended') return extendedServed ? json(HYP_EXTENDED) : json({ detail: 'no extended here' }, 404)
  if (path === `/api/runs/${RUN_ID}`) return json({ summary: { strategy: 'volmanaged', ...runFlags, balance_ok: true } })
  if (path === `/api/analytics/run/${RUN_ID}`) return json(RUN_ANALYTICS)
  if (path === `/api/analytics/run/${RUN_ID}/extended`) return json(RUN_EXTENDED)
  return json({ detail: 'not in this test' }, 404)
}

function actions(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

function show(target: TearTarget, panelId = 'p1', tab: TearCode = 'EQ') {
  const client = createApiQueryClient()
  return render(
    createElement(ApiProvider, {
      client,
      children: createElement(PanelActionsContext, { value: actions(panelId) }, createElement(TearBody, { target, tab, link: '-' })),
    }),
  )
}

describe('TearBody registers its provenance for GRAB', () => {
  beforeEach(() => {
    hypothesisAnalytics = HYP_ANALYTICS
    runFlags = { is_probe: false, is_anchor: false }
    extendedServed = true
    requested = []
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => route(new URL(String(input), 'http://127.0.0.1')))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
    resetPanelSources()
    vi.restoreAllMocks()
  })

  it('registers a hypothesis with the spec sha of its card, once the sheet has loaded', async () => {
    show(HYPOTHESIS)
    expect(panelSource('p1')).toBeNull()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p1')).not.toBeNull())
    // EQ draws the bootstrap cone (n 39 is enough) and, once it arrives, the market context from /extended.
    const sources = tearSources(HYPOTHESIS, 'EQ', HYP_ANALYTICS.context, { bootstrap: true, extended: true })
    await vi.waitFor(() => expect(panelSource('p1')?.provenance?.source).toContain('/extended'))
    expect(panelSource('p1')?.provenance).toEqual(tearProvenance(HYP_ANALYTICS, HYPOTHESIS, SHA, { alsoSources: sources.slice(1) }))
    expect(panelSource('p1')?.provenance?.source?.startsWith('/api/analytics/hypothesis/volmanaged_v0?cost=1')).toBe(true)
  })

  it('registers a run with no spec sha', async () => {
    show(RUN, 'p7')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p7')).not.toBeNull())
    // A run's EQ draws the market context from /extended once it has arrived (10 sessions are too few for a cone).
    await vi.waitFor(() => expect(panelSource('p7')?.provenance?.source).toContain('/extended'))
    const sources = tearSources(RUN, 'EQ', RUN_ANALYTICS.context, { bootstrap: false, extended: true })
    expect(panelSource('p7')?.provenance).toEqual(tearProvenance(RUN_ANALYTICS, RUN, null, { alsoSources: sources.slice(1) }))
    expect(panelSource('p7')?.provenance?.specSha).toBeNull()
  })

  it('forgets the registration when the sheet leaves the panel', async () => {
    const view = show(RUN)
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p1')).not.toBeNull())
    view.unmount()
    expect(panelSource('p1')).toBeNull()
  })

  it('EQ with 30 sessions or more names the bootstrap GET behind the cone', async () => {
    show(HYPOTHESIS, 'p2')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p2')?.provenance?.source).toContain('/bootstrap'))
    expect(panelSource('p2')?.provenance?.source).toContain('/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1')
  })

  it('EQ with fewer than 30 sessions draws no cone and names no bootstrap GET', async () => {
    hypothesisAnalytics = { ...HYP_ANALYTICS, n: 29 }
    show(HYPOTHESIS, 'p2')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p2')?.provenance?.source).toContain('/extended'))
    expect(panelSource('p2')?.provenance?.source).not.toContain('/bootstrap')
    expect(requested.some((path) => path.includes('/bootstrap'))).toBe(false)
  })

  it('EQ without a market context (extended refused) names the analytics and bootstrap GETs only', async () => {
    extendedServed = false
    show(HYPOTHESIS, 'p2')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(requested.some((path) => path.startsWith('/api/analytics/hypothesis/volmanaged_v0/extended'))).toBe(true))
    await vi.waitFor(() => expect(panelSource('p2')?.provenance).not.toBeNull())
    expect(panelSource('p2')?.provenance?.source).toBe([
      '/api/analytics/hypothesis/volmanaged_v0?cost=1',
      '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1',
    ].join(GRAB.caption.pair))
  })

  it('RR names the extended GET; DD names it only once the market context has arrived', async () => {
    show(HYPOTHESIS, 'p8', 'RR')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p8')?.provenance).not.toBeNull())
    expect(panelSource('p8')?.provenance?.source).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1, /api/analytics/hypothesis/volmanaged_v0/extended?cost=1')
    cleanup()
    extendedServed = false
    show(HYPOTHESIS, 'p9', 'DD')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(requested.filter((path) => path.startsWith('/api/analytics/hypothesis/volmanaged_v0/extended')).length).toBeGreaterThan(1))
    await vi.waitFor(() => expect(panelSource('p9')?.provenance).not.toBeNull())
    expect(panelSource('p9')?.provenance?.source).toBe('/api/analytics/hypothesis/volmanaged_v0?cost=1')
  })

  it('names, word for word, the requests the sheet sent (EQ, market context arrived)', async () => {
    show(HYPOTHESIS, 'p2')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p2')?.provenance?.source).toContain('/extended'))
    const named = (panelSource('p2')?.provenance?.source ?? '').split(GRAB.caption.pair)
    expect(named).toHaveLength(3)
    for (const path of named) expect(requested).toContain(path)
  })

  it('a run names its run book GETs after its own', async () => {
    show(RUN, 'p7')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p7')?.provenance).not.toBeNull())
    const source = panelSource('p7')?.provenance?.source ?? ''
    const named = source.split(GRAB.caption.pair)
    expect(named.slice(-5)).toEqual(['trades', 'costs', 'exposure', 'excursions', 'trade-paths'].map((leaf) => `/api/analytics/run/${RUN_ID}/${leaf}`))
    expect(named[0]).toBe(`/api/analytics/run/${RUN_ID}?freq=D`)
    await vi.waitFor(() => expect(requested).toContain(`/api/analytics/run/${RUN_ID}/trades`))
    expect(requested).toContain(`/api/analytics/run/${RUN_ID}/costs`)
    expect(requested).toContain(`/api/analytics/run/${RUN_ID}/exposure`)
  })

  it('a probe run carries [PROBE: never a result] in its caption tags', async () => {
    runFlags = { is_probe: true, is_anchor: false }
    show(RUN, 'p7')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p7')?.provenance?.tags).toContain('[PROBE: never a result]'))
    expect(panelSource('p7')?.provenance?.tags).not.toContain('[ANCHOR]')
  })

  it('an anchor run carries [ANCHOR] in its caption tags', async () => {
    runFlags = { is_probe: false, is_anchor: true }
    show(RUN, 'p7')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p7')?.provenance?.tags).toContain('[ANCHOR]'))
    expect(panelSource('p7')?.provenance?.tags).not.toContain('[PROBE: never a result]')
  })

  it('an ordinary run and a hypothesis carry neither honesty tag', async () => {
    show(RUN, 'p7')
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    await vi.waitFor(() => expect(panelSource('p7')?.provenance).not.toBeNull())
    expect(panelSource('p7')?.provenance?.tags).toEqual(tearTags(RUN_ANALYTICS).map((tag) => `[${tag}]`))
  })
})
