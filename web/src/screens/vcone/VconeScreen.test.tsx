// @vitest-environment jsdom
// VCONE screen (TASKS Phase 11, ANALYTICS MV9 over MV3): the cone of the context instrument from GET /api/market/vcone,
// drawn with its table view and a numbered horizon grid (Number <GO> 1 to 6 opens the 27 futures at that
// horizon from GET /api/market/vcone/universe as small multiples); the API's label and basis verbatim, no
// p-value anywhere. The ECharts figure is stood in, so the test reads the exact option it is given.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { onLineRequest } from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import { BASIS, LABEL, makeCone, makeSmall } from './vconeTestData'
import VconeScreen from './VconeScreen'

const seen: { label: string | null; option: unknown } = { label: null, option: null }

vi.mock('../../charts/echarts/EchartsChart', () => ({
  useChartTokens: () => undefined,
  EchartsFigure: ({ label, option }: { label: string; option: unknown }) => {
    seen.label = label
    seen.option = option
    return <div role="img" aria-label={label} />
  },
}))

const PANEL_ID = 'p-vcone'
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  const q = url.searchParams
  const body = url.pathname === '/api/market/vcone/universe'
    ? makeSmall(Number(q.get('horizon') ?? 21))
    : makeCone((q.get('symbol') ?? 'NQ.V.0').split('.')[0])
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
})

function Panel({ children }: { readonly children: ReactNode }) {
  return (
    <ApiProvider client={createApiQueryClient()}>
      <PanelActionsContext value={actions}>
        <NumberingContext value={registerNumbered}>{children}</NumberingContext>
      </PanelActionsContext>
    </ApiProvider>
  )
}

const urls = () => fetchSpy.mock.calls.map(([u]) => String(u))

function renderVcone(context: ResolvedContext | null = { kind: 'instrument', value: 'NQ' }) {
  const params: PanelParams = { code: 'VCONE', context, args: {}, group: 'A' }
  return render(<VconeScreen params={params} context={context} />, { wrapper: Panel })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  seen.label = null
  seen.option = null
  resetNumbered()
})

afterEach(cleanup)

describe('VCONE screen', () => {
  it('reads the cone of the context instrument, GET only, and names the chart by its data', async () => {
    renderVcone()
    await screen.findByRole('img', { name: /NQ1 Index volatility cone/ })
    expect(urls()).toEqual(['/api/market/vcone?symbol=NQ.V.0'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
    expect(screen.getByRole('toolbar', { name: /Volatility cone/ })).toBeTruthy()
    expect(seen.label).toContain('at 21 sessions median')
  })

  it('passes the served values to the chart in %', async () => {
    renderVcone({ kind: 'instrument', value: 'GC' })
    await screen.findByRole('img', { name: /GC1 Comdty volatility cone/ })
    const option = seen.option as { series: Array<{ id: string; data: Array<number | null> }> }
    const median = option.series.find((s) => s.id === 'median')!
    expect(median.data).toEqual(makeCone('GC').horizons.map((h) => h.p50! * 100))
  })

  it('shows the label, basis and units, and no p-value', async () => {
    renderVcone()
    await screen.findByRole('img', { name: /volatility cone/ })
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
    expect(screen.getByText(`Basis: ${BASIS}`)).toBeTruthy()
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/p-value [0-9]|p = |p=/)
  })

  it('lists the horizons as numbered rows; Number <GO> 3 opens the 27 futures at 21 sessions', async () => {
    renderVcone()
    const grid = await screen.findByRole('table', { name: /Cone by horizon, NQ1 Index/ })
    expect(within(grid).getAllByRole('row')).toHaveLength(7)
    expect(within(grid).getByRole('button', { name: /3\) 21 sessions/ })).toBeTruthy()
    activateNumbered(PANEL_ID, 3)
    await screen.findByRole('img', { name: /27 futures, realised volatility at 21 sessions/ })
    expect(urls()).toContain('/api/market/vcone/universe?horizon=21')
  })

  it('opens the small multiples from a row button and draws 27 tiles on one scale', async () => {
    renderVcone()
    const grid = await screen.findByRole('table', { name: /Cone by horizon/ })
    fireEvent.click(within(grid).getByRole('button', { name: /5\) 126 sessions/ }))
    await screen.findByRole('img', { name: /27 futures, realised volatility at 126 sessions/ })
    expect(document.querySelectorAll('.vcone-tile')).toHaveLength(27)
    expect(screen.getByText(/Every tile uses one scale, 0 to/)).toBeTruthy()
  })

  it('keeps keyboard focus in the panel when a row button opens the small multiples (WCAG 2.4.3)', async () => {
    renderVcone()
    const grid = await screen.findByRole('table', { name: /Cone by horizon/ })
    const row = within(grid).getByRole('button', { name: /1\) 5 sessions/ })
    row.focus()
    fireEvent.click(row)
    const active = document.activeElement as HTMLElement
    expect(active).not.toBe(document.body)
    expect(active.getAttribute('aria-pressed')).toBe('true')
    expect(active.textContent).toBe('27F at one horizon')
    await screen.findByRole('img', { name: /27 futures, realised volatility at 5 sessions/ })
    expect(document.activeElement).toBe(active)
  })

  it('opens a tile cone by Number <GO> in the small multiples view', async () => {
    const lines: string[] = []
    const stop = onLineRequest((r) => lines.push(r.line))
    try {
      renderVcone()
      await screen.findByRole('table', { name: /Cone by horizon/ })
      activateNumbered(PANEL_ID, 32)
      await screen.findByRole('img', { name: /27 futures/ })
      activateNumbered(PANEL_ID, 14)
      expect(lines).toEqual(['CL VCONE'])
      activateNumbered(PANEL_ID, 31)
      await screen.findByRole('img', { name: /NQ1 Index volatility cone/ })
    } finally {
      stop()
    }
  })

  it('falls back to NQ for an instrument outside the 27 futures and says so', async () => {
    renderVcone({ kind: 'instrument', value: 'RTY' })
    await screen.findByRole('img', { name: /NQ1 Index volatility cone/ })
    expect(screen.getByText(/RTY is not one of the 27 futures; the cone shows NQ1 Index/)).toBeTruthy()
    expect(urls()).toEqual(['/api/market/vcone?symbol=NQ.V.0'])
  })

  it('notes sessions with no log return', async () => {
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify(makeCone('CL', 1)), { status: 200 }))
    renderVcone({ kind: 'instrument', value: 'CL' })
    await screen.findByText(/1 sessions had no log return/)
  })

  it('saves the cone with 98) Export and no request', async () => {
    renderVcone()
    await screen.findByRole('img', { name: /volatility cone/ })
    const bar = screen.getByRole('toolbar', { name: /Volatility cone/ })
    const before = fetchSpy.mock.calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(within(bar).getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('vcone_NQ.V.0.csv')).split('\r\n')
      expect(lines).toHaveLength(7)
      expect(fetchSpy.mock.calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })

  it('shows the API error', async () => {
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: 'not in the futures universe: NQ.V.0' }), { status: 404 }))
    renderVcone()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not in the futures universe'))
  })
})
