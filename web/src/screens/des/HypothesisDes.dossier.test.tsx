// @vitest-environment jsdom
// DES registers its dossier for the evidence pack (roadmap 15 part 2): a closure over the description it
// holds and, read at the moment the pack is made, the hypothesis tear sheet the browser already has cached
// under the exact key the tear sheet asks with. It fetches nothing, ever. The dossier sits in its own slot
// of the panel source registry, so the equity chart's provenance (Profile) and the forks' (Robustness)
// neither hide it nor are hidden by it.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { apiQueryKey } from '../../api/queryKey'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { panelDossier, panelSource, resetPanelSources } from '../../chrome/panelSources'
import { buildDossier } from '../../export/dossier/dossierModel'
import type { DossierInput } from '../../export/dossier/types'
import { RUNS } from '../runs/runs.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_ANALYTICS } from '../tear/tearP1.fixtures'
import type { HypothesisDetail } from './desModel'
import { PANEL, VOLMANAGED } from './desTestData'
import HypothesisDes from './HypothesisDes'

vi.mock('../../charts/LineStack', async () => {
  const { createElement: h } = await import('react')
  return { default: () => h('div', { 'data-testid': 'des-linestack' }) }
})
vi.mock('../../charts/echarts/BarLadder', async () => {
  const { createElement: h } = await import('react')
  return { BarLadder: (props: { chartId?: string }) => h('div', { 'data-testid': `ladder-${props.chartId}` }) }
})

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function actions(panelId: string): PanelActions {
  return { panelId, related: () => false, back: () => false, forward: () => false, open: () => false }
}

let served: HypothesisDetail = VOLMANAGED
let requested: string[] = []
let releasePanel: () => void = () => {}

function withCosts(costs: number[]): HypothesisDetail {
  return { ...VOLMANAGED, card: { ...VOLMANAGED.card, series_costs: costs } }
}

const tearKey = (cost: number | null) => apiQueryKey('/api/analytics/hypothesis/{name}', { path: { name: 'volmanaged_v0' }, query: cost === null ? {} : { cost } })

function show(panelId = 'p1', client: QueryClient = createApiQueryClient()) {
  const view = render(
    createElement(ApiProvider, {
      client,
      children: createElement(PanelActionsContext, { value: actions(panelId) }, createElement(HypothesisDes, { name: 'volmanaged_v0', link: '-' })),
    }),
  )
  return { view, client }
}

/** The DES input the panel's closure hands over right now. */
function desInput(panelId: string): Extract<DossierInput, { kind: 'des' }> {
  const input = panelDossier(panelId)?.()
  if (input?.kind !== 'des') throw new Error('expected a DES dossier input')
  return input
}

const tab = (n: number, label: string) => screen.getByRole('tab', { name: `${n}) ${label}` })

beforeEach(() => {
  served = VOLMANAGED
  requested = []
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  const gate = new Promise<void>((resolve) => {
    releasePanel = resolve
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    requested.push(`${url.pathname}${url.search}`)
    if (url.pathname === '/api/hypotheses/volmanaged_v0') return json(served)
    if (url.pathname === '/api/analytics/hypothesis/volmanaged_v0/panel') {
      await gate
      return json(PANEL)
    }
    if (url.pathname === '/api/analytics/hypothesis/volmanaged_v0') return json(HYP_ANALYTICS)
    if (url.pathname === '/api/runs') return json(RUNS)
    if (url.pathname === '/api/analytics/run/nt_volmanaged_v0_fixture_m1') return json(RUN_ANALYTICS)
    return json({ detail: 'not in this test' }, 404)
  })
})

afterEach(() => {
  cleanup()
  resetPanelSources()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('HypothesisDes registers its dossier for the evidence pack', () => {
  it('registers nothing until the description has loaded', () => {
    show('p1')
    expect(panelDossier('p1')).toBeNull()
  })

  it('registers the description as soon as it has loaded, on the Profile tab, before any chart provenance', async () => {
    show('p3')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    // The card alone is not what Profile draws: the dossier does not stand in for the chart's provenance.
    expect(panelSource('p3')).toBeNull()
    expect(desInput('p3').detail).toEqual(VOLMANAGED)
  })

  it('has no tear sheet in it when the browser never opened one, and asks for none', async () => {
    show('p3')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    const before = [...requested]
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls.length
    expect(desInput('p3').analytics).toBeNull()
    expect(requested).toEqual(before)
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(fetchCalls)
    expect(requested.some((r) => r.startsWith('/api/analytics/hypothesis/volmanaged_v0?'))).toBe(false)
  })

  it('carries the tear sheet cached under the exact key the tear sheet asks with (the default cost, 1 tick)', async () => {
    const client = createApiQueryClient()
    client.setQueryData(tearKey(1), HYP_ANALYTICS)
    show('p3', client)
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    expect(desInput('p3').analytics).toEqual(HYP_ANALYTICS)
  })

  it('reads the cache when the closure is called, so a tear sheet opened after DES is in the dossier', async () => {
    const { client } = show('p3')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    const closure = panelDossier('p3')
    expect(desInput('p3').analytics).toBeNull()
    client.setQueryData(tearKey(1), HYP_ANALYTICS)
    expect(panelDossier('p3')).toBe(closure)
    expect(desInput('p3').analytics).toEqual(HYP_ANALYTICS)
  })

  it('uses the exact key only: a tear sheet cached at another cost is not the one DES joins', async () => {
    const client = createApiQueryClient()
    client.setQueryData(tearKey(2), HYP_ANALYTICS)
    client.setQueryData(tearKey(null), HYP_ANALYTICS)
    show('p3', client)
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    expect(desInput('p3').analytics).toBeNull()
  })

  it('asks the cache for the first recorded cost when 1 tick is not recorded', async () => {
    served = withCosts([2, 3])
    const client = createApiQueryClient()
    client.setQueryData(tearKey(2), HYP_ANALYTICS)
    show('p3', client)
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    expect(desInput('p3').analytics).toEqual(HYP_ANALYTICS)
  })

  it('asks the cache for the query without a cost when the card records none', async () => {
    served = withCosts([])
    const client = createApiQueryClient()
    client.setQueryData(tearKey(null), HYP_ANALYTICS)
    client.setQueryData(tearKey(1), { ...HYP_ANALYTICS, label: 'not this one' })
    show('p3', client)
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    expect(desInput('p3').analytics).toEqual(HYP_ANALYTICS)
  })

  it('hands over an input the dossier model turns into a hypothesis dossier with the tear sheet in it', async () => {
    const client = createApiQueryClient()
    client.setQueryData(tearKey(1), HYP_ANALYTICS)
    show('p3', client)
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    const dossier = buildDossier(desInput('p3'), { now: new Date('2026-09-28T18:02:11Z'), demo: false, fixture: false, asOfUtc: null })
    expect(dossier.title).toBe('volmanaged_v0: hypothesis dossier')
    expect(dossier.story.map((s) => s.id)).toContain('kpis')
    expect(dossier.evidence.map((s) => s.id)).not.toContain('tearMissing')
  })

  it('says the tear sheet is missing in the dossier when it was never opened', async () => {
    show('p3')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    const dossier = buildDossier(desInput('p3'), { now: new Date('2026-09-28T18:02:11Z'), demo: false, fixture: false, asOfUtc: null })
    expect(dossier.evidence.map((s) => s.id)).toContain('tearMissing')
  })

  it('does not hide the equity chart provenance that registers after it, and is not hidden by it', async () => {
    show('p3')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p3')).not.toBeNull())
    const closure = panelDossier('p3')
    releasePanel()
    await vi.waitFor(() => expect(panelSource('p3')).not.toBeNull())
    expect(panelSource('p3')?.provenance?.tags).toEqual(['[POST HOC]'])
    expect(panelSource('p3')?.provenance?.source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=1')
    expect(panelDossier('p3')).toBe(closure)
  })

  it('is on every tab, next to the provenance the tab registers', async () => {
    releasePanel()
    show('p4')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=1'))
    expect(panelDossier('p4')).not.toBeNull()
    fireEvent.click(tab(3, 'Costs and blocks'))
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe('/api/hypotheses/volmanaged_v0'))
    expect(panelDossier('p4')).not.toBeNull()
    fireEvent.click(tab(2, 'Pass checks'))
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.tags).toEqual(['[PRE-REG]']))
    expect(panelDossier('p4')).not.toBeNull()
    fireEvent.click(tab(5, 'Robustness'))
    await screen.findByTestId('ladder-des-forks-a')
    expect(panelDossier('p4')).not.toBeNull()
    fireEvent.click(tab(1, 'Profile'))
    await vi.waitFor(() => expect(panelSource('p4')?.provenance?.source).toBe('/api/analytics/hypothesis/volmanaged_v0/panel?cost=1'))
    expect(panelDossier('p4')).not.toBeNull()
  })

  it('keeps one closure while the tabs change (the description is what it holds)', async () => {
    show('p5')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p5')).not.toBeNull())
    fireEvent.click(tab(3, 'Costs and blocks'))
    await vi.waitFor(() => expect(panelSource('p5')?.provenance?.source).toBe('/api/hypotheses/volmanaged_v0'))
    expect(desInput('p5').detail).toEqual(VOLMANAGED)
  })

  it('forgets the closure when the panel closes', async () => {
    const { view } = show('p6')
    await screen.findByTestId('des-head')
    await vi.waitFor(() => expect(panelDossier('p6')).not.toBeNull())
    view.unmount()
    expect(panelDossier('p6')).toBeNull()
  })
})
