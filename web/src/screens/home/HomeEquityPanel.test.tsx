// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { UplotConstructor } from '../../charts/lazy'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { ResolvedContext } from '../../commands/types'
import { HOME_EQ } from '../../copy/home'
import { HOME_PANEL_IDS } from '../layouts/layouts'
import HomeEquityPanel from './HomeEquityPanel'
import { PANEL_A, PANEL_B } from './homeEquity.fixtures'
import { withHomeEquity } from './homeVariant'

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** uPlot never arrives: the chart stays in its loading state, which is all these tests need. */
const pending: () => Promise<UplotConstructor> = () => new Promise(() => {})

type Reply = { status: number; body: unknown }
let replies: Map<string, Reply>
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  replies = new Map()
  fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
    const reply = replies.get(url) ?? { status: 404, body: { detail: `no reply for ${url}` } }
    expect(init.method).toBe('GET')
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('ResizeObserver', NoResize)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function props(context: ResolvedContext | null): ScreenProps {
  return { params: { code: 'EQ', context, args: {}, group: 'B' }, context }
}

function renderPanel(context: ResolvedContext | null) {
  return render(
    <ApiProvider client={client()}>
      <HomeEquityPanel {...props(context)} loader={pending} />
    </ApiProvider>,
  )
}

describe('HomeEquityPanel (look spec 7.1, HOME [B])', () => {
  it('reads the hypothesis panel with one GET and shows the API values with basis, unit and tag', async () => {
    replies.set('/api/analytics/hypothesis/volmanaged_v0/panel', { status: 200, body: PANEL_A })
    renderPanel({ kind: 'hypothesis', value: 'volmanaged_v0' })
    const tiles = await screen.findByRole('list', { name: 'Key figures for volmanaged_v0' })
    const faces = within(tiles).getAllByRole('button').map((b) => b.querySelector('.kpi-value')?.textContent)
    expect(faces).toEqual(['-3.72', '-3.67', '-9.5%', '-9.4%', '+3.47%', '1.18', '4'])
    expect(screen.getByText('[POST HOC]', { selector: '.home-eq-tag .tag' })).toBeTruthy()
    // U24: the caption names both the return unit and the equity pane's own unit (p.equity_unit),
    // not only the return unit, since a screen basis reads very differently in the two.
    expect(
      screen.getByText('Basis A, screen (arithmetic on a fixed K). Returns in return on capital per session; the equity pane plots multiple of K (K = 1), arithmetic.'),
    ).toBeTruthy()
    expect(screen.getByText('Benchmark: same-exposure buy and hold (r_bh_1).')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/analytics/hypothesis/volmanaged_v0/panel')
  })

  it('reads the run panel for a run context', async () => {
    replies.set('/api/analytics/run/nt_volmanaged_v0_fixture_m1/panel', { status: 200, body: PANEL_B })
    renderPanel({ kind: 'run', value: 'nt_volmanaged_v0_fixture_m1' })
    await screen.findByRole('list', { name: 'Key figures for nt_volmanaged_v0_fixture_m1' })
    expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(['/api/analytics/run/nt_volmanaged_v0_fixture_m1/panel'])
    expect(screen.getByText(HOME_EQ.noBench)).toBeTruthy()
  })

  it('draws the red function bar with the context field, 96) Actions and the title', async () => {
    replies.set('/api/analytics/hypothesis/volmanaged_v0/panel', { status: 200, body: PANEL_A })
    renderPanel({ kind: 'hypothesis', value: 'volmanaged_v0' })
    const bar = screen.getByRole('toolbar', { name: `${HOME_EQ.title} functions` })
    expect(within(bar).getByRole('textbox', { name: HOME_EQ.fieldLabel })).toHaveProperty('value', 'volmanaged_v0')
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
    expect(within(bar).getByText(HOME_EQ.title)).toBeTruthy()
  })

  it('asks for a context and fetches nothing when link group B has none', () => {
    renderPanel(null)
    expect(screen.getByText(/has no run or hypothesis yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /volmanaged_v0 EQ/ })).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows the API refusal text when the panel cannot be built', async () => {
    replies.set('/api/analytics/run/nt_bad/panel', { status: 422, body: { detail: 'unusable run: balance check failed' } })
    renderPanel({ kind: 'run', value: 'nt_bad' })
    expect(await screen.findByText(/unusable run: balance check failed/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: /Key figures/ })).toBeNull()
  })
})

describe('withHomeEquity: the HOME grid shows its own equity panel in panel 3', () => {
  function Full() {
    return <p>full tear sheet</p>
  }
  const Wrapped = withHomeEquity(Full)
  const actions = (panelId: string): PanelActions => ({ panelId, related: () => false, back: () => false, forward: () => false, open: () => false })

  it('renders the HOME equity panel in the HOME layout panel', async () => {
    replies.set('/api/analytics/hypothesis/volmanaged_v0/panel', { status: 200, body: PANEL_A })
    render(
      <ApiProvider client={client()}>
        <PanelActionsContext value={actions(HOME_PANEL_IDS.eq)}>
          <Wrapped {...props({ kind: 'hypothesis', value: 'volmanaged_v0' })} />
        </PanelActionsContext>
      </ApiProvider>,
    )
    expect(await screen.findByRole('toolbar', { name: `${HOME_EQ.title} functions` })).toBeTruthy()
    expect(screen.queryByText('full tear sheet')).toBeNull()
  })

  it('renders the full screen in any other panel', () => {
    render(
      <ApiProvider client={client()}>
        <PanelActionsContext value={actions('nqt-5')}>
          <Wrapped {...props({ kind: 'hypothesis', value: 'volmanaged_v0' })} />
        </PanelActionsContext>
      </ApiProvider>,
    )
    expect(screen.getByText('full tear sheet')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
