// @vitest-environment jsdom
// EVT screen (TASKS Phase 11): the calendar and the study from GETs only, the [POST HOC] label and the API's
// basis verbatim, no p-value on screen, the mode switch, Number <GO> on a grid row drawing that event, the export,
// the refusal of an intraday window where 1m data is not validated, and the gate's own 403 message. The chart is
// stood in, so the test reads the exact data it is given.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { captureDownloads } from '../../chrome/download.testUtil'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { EventPathInput } from './chartModel'
import EvtScreen from './EvtScreen'
import { makeCalendar, makeStudy } from './fixtures'

const seen: { chart: EventPathInput | null } = { chart: null }

vi.mock('./EventPathChart', () => ({
  EventPathChart: ({ data }: { data: EventPathInput }) => {
    seen.chart = data
    return <div role="img" aria-label={data.name} />
  },
}))

const PANEL_ID = 'p-evt'
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }
const params = (value: string | null): PanelParams => ({
  code: 'EVT',
  context: value === null ? null : { kind: 'instrument', value },
  args: {},
  group: 'A',
}) as PanelParams

let refuse = false
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  if (url.pathname === '/api/events/calendar') return json(makeCalendar())
  if (refuse) return json({ detail: 'window 2022-01-01 is outside the in-sample fence' }, 403)
  const q = url.searchParams
  const mode = (q.get('mode') ?? 'daily') as 'daily' | 'intraday'
  return json(makeStudy({ symbol: q.get('symbol') ?? 'NQ.V.0', event_type: q.get('event') ?? 'FOMC', mode }))
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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
const renderEvt = (root: string | null = 'NQ') => {
  const p = params(root)
  return render(<EvtScreen params={p} context={p.context} />, { wrapper: Panel })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  seen.chart = null
  refuse = false
  resetNumbered()
})

afterEach(cleanup)

describe('EVT screen', () => {
  it('reads the calendar and the default study, GET only', async () => {
    renderEvt()
    await screen.findByRole('img', { name: /NQ around FOMC, 2 sessions before to 2 after/ })
    expect(urls()).toEqual(['/api/events/calendar', '/api/events/study?symbol=NQ.V.0&event=FOMC&mode=daily&pre=5&post=5'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
    expect(screen.getByRole('toolbar', { name: /Event study/ })).toBeTruthy()
  })

  it('shows the API label, basis and band note verbatim and no p-value figure', async () => {
    renderEvt()
    await screen.findByRole('img')
    const body = document.body.textContent ?? ''
    expect(body).toContain('[POST HOC] descriptive event study')
    expect(body).toContain('Basis: cumulative sum of daily r')
    expect(body).toContain('Gate: caller terminal')
    expect(body).not.toMatch(/\bp\s*[=<]\s*0/)
    expect(body).not.toMatch(/t stat/i)
  })

  it('gives the chart the API values in percent and states the end distribution', async () => {
    renderEvt()
    await screen.findByRole('img')
    expect(seen.chart?.mean).toEqual([-0.1, 0, 0.2, 0.3, 0.5])
    expect(seen.chart?.n).toBe(2)
    const table = screen.getByRole('table', { name: /At the last offset \(2\)/ })
    expect(within(table).getAllByRole('cell').map((c) => c.textContent)).toEqual(['+0.50%', '+0.50%', '0.10%', '0.07%', '100%', '2'])
  })

  it('asks for the intraday window with its own defaults when the mode switches', async () => {
    renderEvt()
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Intraday' }))
    await waitFor(() => expect(urls()).toContain('/api/events/study?symbol=NQ.V.0&event=FOMC&mode=intraday&pre=60&post=120'))
  })

  it('asks for another event type when one is picked', async () => {
    renderEvt()
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'CPI (133)' }))
    await waitFor(() => expect(urls()).toContain('/api/events/study?symbol=NQ.V.0&event=CPI&mode=daily&pre=5&post=5'))
  })

  it('draws the event picked with Number <GO> over the mean, and not a void one', async () => {
    renderEvt()
    await screen.findByRole('img')
    expect(screen.getByRole('grid', { name: /Events, 3 rows/ })).toBeTruthy()
    expect(activateNumbered(PANEL_ID, 1)).toBe(true)
    await waitFor(() => expect(seen.chart?.selected?.label).toBe('2015-01-28 FOMC'))
    expect(seen.chart?.selected?.values).toEqual([-0.2, 0, 0.1, 0.2, 0.4])
    activateNumbered(PANEL_ID, 3)
    await waitFor(() => expect(seen.chart?.selected).toBeNull())
    expect(screen.getByText(/Void: stale close on 2016-06-14/)).toBeTruthy()
  })

  it('exports the mean path and its band with no request', async () => {
    renderEvt()
    await screen.findByRole('img')
    const before = fetchSpy.mock.calls.length
    const saved = captureDownloads()
    try {
      const bar = screen.getByRole('toolbar', { name: /Event study/ })
      fireEvent.click(within(bar).getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('evt_NQ_FOMC_daily_2_2.csv')).split('\r\n')
      expect(lines[0]).toBe('offset,mean,se,lower,upper')
      expect(lines).toHaveLength(6)
      expect(fetchSpy.mock.calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })

  it('refuses an intraday window where no repaired 1m series exists, without asking', async () => {
    renderEvt('ES')
    await screen.findByRole('img', { name: /ES around FOMC/ })
    fireEvent.click(screen.getByRole('button', { name: 'Intraday' }))
    await screen.findByText(/ES has no repaired 1m series/)
    expect(urls().some((u) => u.includes('symbol=ES.V.0&event=FOMC&mode=intraday'))).toBe(false)
    expect(screen.getByText(/Intraday windows are open for NQ, ZN/)).toBeTruthy()
  })

  it("shows the gate's own refusal", async () => {
    refuse = true
    renderEvt()
    await screen.findByText(/The gate refused the request: window 2022-01-01 is outside the in-sample fence/)
  })
})
