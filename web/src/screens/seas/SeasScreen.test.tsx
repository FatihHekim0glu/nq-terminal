// @vitest-environment jsdom
// SEAS screen (TASKS Phase 11): one GET per subject and settings, the five numbered tabs, each panel's
// ladder (mean with a one standard error band) and numbered grid, an unavailable panel's note, the
// heatmap, the [POST HOC] label verbatim, 98) Export, and no p-value anywhere. The chart components are
// stood in, so the test reads the exact data each one is given.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import { captureDownloads } from '../../chrome/download.testUtil'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import SeasScreen from './SeasScreen'
import { LABEL, makeSeasonality } from './seasTestData'
import type { Seasonality } from './types'

const seen: { ladder: BarLadderInput | null; heat: HeatmapInput | null } = { ladder: null, heat: null }

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: ({ data }: { data: BarLadderInput }) => {
    seen.ladder = data
    return <div role="img" aria-label={data.name} />
  },
}))
vi.mock('../../charts/echarts/Heatmap', () => ({
  Heatmap: ({ data }: { data: HeatmapInput }) => {
    seen.heat = data
    return <div role="img" aria-label={data.name} />
  },
}))

const PANEL_ID = 'p-seas'
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }

function hypothesisBody(subject: string): Seasonality {
  const base = makeSeasonality()
  return {
    ...base,
    subject,
    kind: 'hypothesis',
    unit: 'return on capital per session',
    aggregation: 'sum',
    variant: null,
    cost: 1,
    gate: null,
    panels: base.panels.map((p) => (p.id === 'intraday' ? { ...p, available: false, note: 'a hypothesis series has no 1m bars', buckets: [], excluded_sessions: null, source: null } : p)),
  }
}

/** The card's recorded series costs per hypothesis name, as GET /api/hypotheses/{name} would answer. */
let seriesCosts: Record<string, readonly number[]> = {}

function hypothesisCard(name: string): unknown {
  return { card: { name, series_costs: seriesCosts[name] ?? [0, 1, 2] } }
}

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  const name = url.pathname.split('/').pop() ?? ''
  const body = url.pathname.startsWith('/api/seasonality/hypothesis/')
    ? hypothesisBody(name)
    : url.pathname.startsWith('/api/hypotheses/')
      ? hypothesisCard(name)
      : makeSeasonality()
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

function renderSeas(context: ResolvedContext | null) {
  const params: PanelParams = { code: 'SEAS', context, args: {}, group: 'B' }
  return render(<SeasScreen params={params} context={context} />, { wrapper: Panel })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  seen.ladder = null
  seen.heat = null
  seriesCosts = {}
  resetNumbered()
})

afterEach(cleanup)

describe('SEAS screen', () => {
  it('asks for a subject and reads nothing without one', () => {
    renderSeas(null)
    expect(screen.getByText(/Give an instrument or a registered hypothesis/)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads an instrument with one GET and draws the month ladder first', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /NQ.V.0 mean monthly return by calendar month/ })
    expect(urls()).toEqual(['/api/seasonality/instrument/NQ?start_year=2010&end_year=2021'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
    expect(seen.ladder?.bars).toHaveLength(12)
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
  })

  it('switches tabs by click and by Number <GO>, with the band at one standard error', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    fireEvent.click(screen.getByRole('tab', { name: /Weekday/ }))
    await screen.findByRole('img', { name: /by weekday/ })
    const mon = seen.ladder!.bars[0]!
    expect(mon.value).toBeCloseTo(0.1, 12)
    expect(mon.hi! - mon.value!).toBeCloseTo(0.05, 12)
    activateNumbered(PANEL_ID, 85)
    await screen.findByRole('img', { name: /monthly return, years by months/ })
    expect(seen.heat?.rows).toEqual(['2021', '2020'])
    activateNumbered(PANEL_ID, 84)
    await screen.findByRole('img', { name: /30-minute return by bucket/ })
    expect(screen.getByText('4 sessions left out of the 30-minute buckets (qa.day_gate).')).toBeTruthy()
  })

  it('reads a picked grid row out', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    fireEvent.click(screen.getByRole('tab', { name: /Weekday/ }))
    await screen.findByRole('img', { name: /by weekday/ })
    const grid = screen.getByRole('grid', { name: /n, mean, standard error and hit rate/ })
    const row = within(grid).getByText('Mon').closest('tr')!
    fireEvent.doubleClick(row)
    await screen.findByText('Row Mon: mean +0.10%, one standard error 0.05%, hit rate 55.0%, n 100.')
  })

  it('answers Number <GO> on a grid row, while the tabs keep 81) to 85)', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    expect(screen.getByRole('tab', { name: /81\) Month/ })).toBeTruthy()
    expect(activateNumbered(PANEL_ID, 2)).toBe(true)
    await screen.findByText(/^Row Feb: mean/)
  })

  it('reads a hypothesis with its cost and says why it has no 30-minute panel', async () => {
    renderSeas({ kind: 'hypothesis', value: 'volmanaged_v0' })
    await screen.findByRole('img', { name: /volmanaged_v0 mean monthly return/ })
    expect(urls()).toEqual(['/api/hypotheses/volmanaged_v0', '/api/seasonality/hypothesis/volmanaged_v0?start_year=2010&end_year=2021&cost=1'])
    expect(screen.getByRole('combobox', { name: 'Cost' })).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: 'Variant' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /30 minutes/ }))
    await screen.findByText('Not shown: a hypothesis series has no 1m bars.')
  })

  it('only offers a hypothesis the costs its card recorded, and never asks for one it did not (D19)', async () => {
    seriesCosts = { vt_har_v0: [1] }
    renderSeas({ kind: 'hypothesis', value: 'vt_har_v0' })
    await screen.findByRole('img', { name: /vt_har_v0 mean monthly return/ })
    expect(urls()).toEqual(['/api/hypotheses/vt_har_v0', '/api/seasonality/hypothesis/vt_har_v0?start_year=2010&end_year=2021&cost=1'])
    fireEvent.click(screen.getByRole('combobox', { name: 'Cost' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['1 tick(s)'])
    expect(urls().some((u) => u.includes('cost=0') || u.includes('cost=2'))).toBe(false)
  })

  it('shows a no-series note and asks for nothing when a hypothesis card records no cost (D19)', async () => {
    seriesCosts = { za_v0_c3: [] }
    renderSeas({ kind: 'hypothesis', value: 'za_v0_c3' })
    await screen.findByText(/No return series is recorded for za_v0_c3/)
    expect(urls()).toEqual(['/api/hypotheses/za_v0_c3'])
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('re-reads when the first year changes', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    fireEvent.click(screen.getByRole('combobox', { name: 'From' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '2015' }))
    await waitFor(() => expect(urls()).toContain('/api/seasonality/instrument/NQ?start_year=2015&end_year=2021'))
  })

  it('shows no p-value and no test statistic, only the note that there is none', async () => {
    const { container } = renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).toContain('no p-value')
    expect(text.replace('no p-value', '')).not.toMatch(/p-value|p value|t-stat|welch|significan/)
  })

  it('exports the shown tab with no request', async () => {
    renderSeas({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('img', { name: /by calendar month/ })
    fireEvent.click(screen.getByRole('tab', { name: /Weekday/ }))
    await screen.findByRole('img', { name: /by weekday/ })
    const before = fetchSpy.mock.calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const files = saved.files.map((f) => f.name)
      expect(files).toHaveLength(1)
      const lines = (await saved.text(files[0])).split('\r\n')
      expect(lines[1]).toBe('Mon,100,0.001,0.0005,0.55')
      expect(fetchSpy.mock.calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })
})
