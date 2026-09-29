// @vitest-environment jsdom
// The tear sheet registers its dossier for the evidence pack (roadmap 15 part 2), beside the provenance it
// registers for GRAB: a closure over the answers the sheet already holds (the Analytics answer, the tab,
// the target and, for a hypothesis, its card). Nothing is asked or computed when it is registered or called.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { panelDossier, panelSource, resetPanelSources } from '../../chrome/panelSources'
import { buildDossier } from '../../export/dossier/dossierModel'
import { VOLMANAGED } from '../des/desTestData'
import { HYP_ANALYTICS, RUN_ANALYTICS } from './tear.fixtures'
import { HYP_BOOTSTRAP, HYP_EXTENDED, RUN_EXTENDED } from './tearP1.fixtures'
import TearBody from './TearBody'
import type { TearCode } from './TearSheet'
import type { TearTarget } from './tearQueries'

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let balanceOk = true
let analyticsStatus = 200
let requested: string[] = []

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  requested.push(`${path}${url.search}`)
  if (path === '/api/hypotheses/volmanaged_v0') return json(VOLMANAGED)
  if (path === '/api/analytics/hypothesis/volmanaged_v0') return analyticsStatus === 200 ? json(HYP_ANALYTICS) : json({ detail: 'refused' }, analyticsStatus)
  if (path === '/api/analytics/hypothesis/volmanaged_v0/bootstrap') return json(HYP_BOOTSTRAP)
  if (path === '/api/analytics/hypothesis/volmanaged_v0/extended') return json(HYP_EXTENDED)
  if (path === `/api/runs/${RUN_ID}`) return json({ summary: { strategy: 'volmanaged', is_probe: false, is_anchor: false, balance_ok: balanceOk } })
  if (path === `/api/analytics/run/${RUN_ID}`) return json(RUN_ANALYTICS)
  if (path === `/api/analytics/run/${RUN_ID}/extended`) return json(RUN_EXTENDED)
  return json({ detail: 'not in this test' }, 404)
}

function actions(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

function tree(client: ReturnType<typeof createApiQueryClient>, target: TearTarget, panelId: string, tab: TearCode) {
  return createElement(ApiProvider, {
    client,
    children: createElement(PanelActionsContext, { value: actions(panelId) }, createElement(TearBody, { target, tab, link: '-' })),
  })
}

function show(target: TearTarget, panelId = 'p1', tab: TearCode = 'EQ') {
  const client = createApiQueryClient()
  const view = render(tree(client, target, panelId, tab))
  return { view, client, again: (next: TearTarget, nextTab: TearCode = tab) => view.rerender(tree(client, next, panelId, nextTab)) }
}

const loaded = () => screen.findByRole('list', { name: 'Tear sheet key figures' })

beforeEach(() => {
  balanceOk = true
  analyticsStatus = 200
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

describe('TearBody registers its dossier for the evidence pack', () => {
  it('registers nothing while the sheet is loading', () => {
    show(HYPOTHESIS)
    expect(panelDossier('p1')).toBeNull()
  })

  it('registers a hypothesis: the target, the tab, the Analytics answer and the card, once the sheet has loaded', async () => {
    show(HYPOTHESIS)
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    const input = panelDossier('p1')?.()
    expect(input?.kind).toBe('tear')
    if (input?.kind !== 'tear') return
    expect(input.target).toEqual(HYPOTHESIS)
    expect(input.tab).toBe('EQ')
    expect(input.analytics).toEqual(HYP_ANALYTICS)
    expect(input.card).toEqual(VOLMANAGED.card)
  })

  it('registers a run with no card', async () => {
    show(RUN, 'p7')
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p7')).not.toBeNull())
    const input = panelDossier('p7')?.()
    if (input?.kind !== 'tear') throw new Error('expected a tear input')
    expect(input.target).toEqual(RUN)
    expect(input.analytics).toEqual(RUN_ANALYTICS)
    expect(input.card).toBeNull()
  })

  it('names the tab that is open', async () => {
    show(HYPOTHESIS, 'p2', 'DD')
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p2')).not.toBeNull())
    const input = panelDossier('p2')?.()
    expect(input?.kind === 'tear' ? input.tab : null).toBe('DD')
  })

  it('registers the closure with the provenance in one source, so the panel shows both', async () => {
    show(HYPOTHESIS)
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    await vi.waitFor(() => expect(panelSource('p1')?.provenance).not.toBeNull())
    expect(panelSource('p1')?.dossier).toBe(panelDossier('p1'))
  })

  it('hands over an input the dossier model turns into a dossier', async () => {
    show(HYPOTHESIS)
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    const input = panelDossier('p1')?.()
    if (!input) throw new Error('no input')
    const dossier = buildDossier(input, { now: new Date('2026-09-28T18:02:11Z'), demo: false, fixture: false, asOfUtc: null })
    expect(dossier.title).toBe('volmanaged_v0: tear sheet dossier')
  })

  it('makes no request when the closure is called', async () => {
    show(HYPOTHESIS)
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    const before = requested.length
    const fetchSpy = vi.mocked(globalThis.fetch)
    const calls = fetchSpy.mock.calls.length
    panelDossier('p1')?.()
    panelDossier('p1')?.()
    expect(requested).toHaveLength(before)
    expect(fetchSpy.mock.calls).toHaveLength(calls)
  })

  it('keeps the same closure across renders that change nothing it holds (a new but equal target object)', async () => {
    const { again } = show(HYPOTHESIS)
    await loaded()
    // EQ draws the bootstrap cone and, once it arrives, the market context: the sheet is settled after that.
    await vi.waitFor(() => expect(panelSource('p1')?.provenance?.source).toContain('/extended'))
    const first = panelDossier('p1')
    expect(first).not.toBeNull()
    again({ ...HYPOTHESIS })
    await loaded()
    expect(panelDossier('p1')).toBe(first)
  })

  it('registers a new closure when the tab changes', async () => {
    const { again } = show(HYPOTHESIS, 'p1', 'EQ')
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    const first = panelDossier('p1')
    again(HYPOTHESIS, 'DD')
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBe(first))
    const input = panelDossier('p1')?.()
    expect(input?.kind === 'tear' ? input.tab : null).toBe('DD')
  })

  it('forgets the closure when the sheet leaves the panel', async () => {
    const { view } = show(RUN)
    await loaded()
    await vi.waitFor(() => expect(panelDossier('p1')).not.toBeNull())
    view.unmount()
    expect(panelDossier('p1')).toBeNull()
  })

  it('registers none for a run whose balance check failed: nothing is drawn, so nothing is packed', async () => {
    balanceOk = false
    show(RUN, 'p3')
    await screen.findByRole('alert')
    expect(panelDossier('p3')).toBeNull()
  })

  it('registers none when the analytics route refuses', async () => {
    analyticsStatus = 422
    show(HYPOTHESIS, 'p4')
    await screen.findByRole('alert')
    expect(panelDossier('p4')).toBeNull()
  })

  it('keeps panels apart', async () => {
    show(HYPOTHESIS, 'pa')
    show(RUN, 'pb')
    await vi.waitFor(() => expect(panelDossier('pa')).not.toBeNull())
    await vi.waitFor(() => expect(panelDossier('pb')).not.toBeNull())
    const a = panelDossier('pa')?.()
    const b = panelDossier('pb')?.()
    expect(a?.kind === 'tear' ? a.target.kind : null).toBe('hypothesis')
    expect(b?.kind === 'tear' ? b.target.kind : null).toBe('run')
  })
})
