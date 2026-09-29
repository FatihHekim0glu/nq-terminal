// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { liveStreamHub } from '../../api/useLiveStream'
import type { ConeInput } from '../../charts/echarts/coneModel'
import { EXPECTATION } from '../../copy/expectation'
import { LIVE } from '../../copy/live'
import { STREAM } from '../../copy/liveStream'
import { TRACKING } from '../../copy/tracking'
import { stubLayout } from '../../grids/testing'
import { VOLMANAGED } from '../des/desTestData'
import { RUNS } from '../runs/runs.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import { HYP_BOOTSTRAP } from '../tear/tearP1.fixtures'
import { BANNER, BOOK, BOOK_CLOSE_ROWS, ROUTES_BODY, emptyStatus, page, performance, status } from './liveFixtures'
import { dateSeconds } from './liveModel'
import LiveScreen from './LiveScreen'
import { TRACKING_POPULATED } from './trackingFixtures'
import { formatNumber } from '../tear/tearFormat'

interface StubPane { readonly id: string; readonly series: ReadonlyArray<{ readonly name: string; readonly values: ReadonlyArray<number | null | undefined> }> }

vi.mock('../../charts/echarts/Cone', () => ({
  Cone: ({ data, chartId }: { data: ConeInput; chartId: string }) => (
    <div data-testid="cone" data-chart-id={chartId} data-overlays={(data.overlays ?? []).map((o) => o.id).join(',')}>{data.name}</div>
  ),
}))

vi.mock('../../charts/LineStack', () => ({
  default: ({ t, panes }: { t: readonly number[]; panes: readonly StubPane[] }) => (
    <div data-testid="linestack" data-t={t.join(',')}>
      {panes.flatMap((p) => p.series.map((s) => <span key={s.name} data-series={s.name}>{s.values.join(',')}</span>))}
    </div>
  ),
}))

function json(body: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'content-type': 'application/json' } })
}

interface Bodies {
  status?: unknown
  performance?: unknown
  closeRows?: unknown
  tracking?: unknown
}

const TRACKING_BODY = {
  journal: 'volmanaged_paper_journal.jsonl', present: true, empty_state: null, banner: BANNER,
  basis: 'performance rows only (plumbing rows dropped)', tag: '[POST HOC]', label: 'paper P&L against the rule',
  unit: 'USD per session', multiplier: 2, plumbing_rows_skipped: 2,
  t: [1790726400, 1790812800, 1790899200], date: ['2026-09-30', '2026-10-01', '2026-10-02'],
  paper: [null, 12.5, -4], model: [null, 10, -2], difference: [null, 2.5, -2],
  paper_cumulative: [null, 12.5, 8.5], model_cumulative: [null, 10, 8], n: 2, total_difference: 0.5, tracking_sd: 3.18,
}

function routes(b: Bodies = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/live/status')) return json(b.status ?? status())
    if (url.startsWith('/api/live/performance')) return json(b.performance ?? performance())
    if (url.startsWith('/api/live/journal')) return json(b.closeRows ?? page(BOOK_CLOSE_ROWS))
    if (url.startsWith('/api/live/routes')) return json(ROUTES_BODY)
    if (url.startsWith('/api/analytics/paper-tracking')) return json(b.tracking ?? TRACKING_BODY)
    if (url === '/api/hypotheses/volmanaged_v0') return json(VOLMANAGED)
    if (url === '/api/runs') return json(RUNS)
    if (url === '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1') return json(HYP_BOOTSTRAP)
    if (url === '/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D') return json(RUN_ANALYTICS)
    return json({ detail: 'unexpected' }, 404)
  })
}

function mount() {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <LiveScreen params={{ code: 'LIVE', context: null, args: {}, group: '-' }} context={null} />
    </ApiProvider>,
  )
}

const strip = (name: string) => screen.getByRole('list', { name })

beforeEach(() => stubLayout(600))
afterEach(() => {
  cleanup()
  liveStreamHub.reset()
})

describe('LIVE: the live stream line and LV5 (P1)', () => {
  it('says whether server events flow; without EventSource it polls and says why', async () => {
    routes()
    mount()
    const line = await screen.findByRole('group', { name: STREAM.label })
    expect(within(line).getByRole('status').textContent).toBe(`polling every 2 s: ${STREAM.reasons.unsupported}`)
  })

  it('draws paper against model from /api/analytics/paper-tracking with its tag, unit and totals', async () => {
    const spy = routes()
    mount()
    const section = await screen.findByRole('region', { name: TRACKING.label })
    await waitFor(() => expect(within(section).getByTestId('linestack').getAttribute('data-t')).toBe('1790726400,1790812800,1790899200'))
    expect(within(section).getByText('[POST HOC]')).toBeTruthy()
    expect(section.textContent).toContain('Plumbing rows dropped from this view: 2.')
    expect(section.textContent).toContain('Total difference +0.50 USD. Tracking sd 3.18 USD per session.')
    expect(section.querySelector('[data-series="Paper, cumulative"]')?.textContent).toBe(',12.5,8.5')
    expect(spy.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it("shows the backend's own populated LV5 response at the displayed precision (roll rows, crosschecked)", async () => {
    routes({ tracking: TRACKING_POPULATED })
    mount()
    const section = await screen.findByRole('region', { name: TRACKING.label })
    const tr = TRACKING_POPULATED
    expect(tr.n).toBe(2)
    await waitFor(() => expect(section.textContent).toContain(
      `Sessions with a close on both days ${tr.n}. Total difference ${formatNumber(tr.total_difference, 2, { signed: true, thousands: true })} USD. `
      + `Tracking sd ${formatNumber(tr.tracking_sd, 2, { thousands: true })} USD per session.`))
    expect(section.textContent).toContain('Total difference -1.00 USD. Tracking sd 0.71 USD per session.')
    const dated = tr.t.flatMap((t, i) => (typeof t === 'number' ? [i] : []))
    const shown = (values: ReadonlyArray<number | null>) => dated.map((i) => values[i] ?? '').join(',')
    expect(section.querySelector('[data-series="Paper, cumulative"]')?.textContent).toBe(shown(tr.paper_cumulative))
    expect(section.querySelector('[data-series="Model, cumulative"]')?.textContent).toBe(shown(tr.model_cumulative))
    expect(section.querySelector('[data-series="Paper minus model"]')?.textContent).toBe(shown(tr.difference))
  })

  it('names the expected journal when the paper book has not written it yet', async () => {
    routes({ tracking: { ...TRACKING_BODY, present: false, empty_state: 'no journal yet: live/logs/volmanaged_paper_journal.jsonl' } })
    mount()
    const section = await screen.findByRole('region', { name: TRACKING.label })
    await waitFor(() => expect(section.textContent).toContain('no journal yet: live/logs/volmanaged_paper_journal.jsonl'))
  })
})

describe('LIVE: LV6, the paper book on its SV6 cone', () => {
  const expectationRegion = () => screen.findByRole('region', { name: EXPECTATION.label })

  it('answers the five GETs of the card and draws the cone with the paper and model overlays', async () => {
    const spy = routes()
    mount()
    const section = await expectationRegion()
    const cone = await within(section).findByTestId('cone')
    expect(cone.getAttribute('data-chart-id')).toBe('live-expectation')
    expect(cone.getAttribute('data-overlays')).toBe('paper,model')
    const urls = spy.mock.calls.map(([input]) => String(input))
    for (const wanted of [
      '/api/analytics/paper-tracking',
      '/api/hypotheses/volmanaged_v0',
      '/api/runs',
      '/api/analytics/hypothesis/volmanaged_v0/bootstrap?cost=1',
      '/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D',
    ]) expect(urls, wanted).toContain(wanted)
    expect(spy.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('sits after the paper tracking and before the journals, tagged [POST HOC], with K named', async () => {
    routes()
    mount()
    const tracking = await screen.findByRole('region', { name: TRACKING.label })
    const section = await expectationRegion()
    await within(section).findByTestId('cone')
    expect(tracking.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const journals = screen.getByRole('table', { name: LIVE.journalsLabel })
    expect(section.compareDocumentPosition(journals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(section).getByText('[POST HOC]')).toBeTruthy()
    expect(section.textContent).toContain('K = 1,000,000 USD: the starting capital of nt_volmanaged_v0_fixture_m1')
    expect(within(section).queryAllByRole('alert')).toEqual([])
  })

  it('says there is no paper session with a value when the tracking has none, and draws no cone', async () => {
    routes({ tracking: { ...TRACKING_BODY, paper_cumulative: [null, null, null], model_cumulative: [null, null, null] } })
    mount()
    const section = await expectationRegion()
    await waitFor(() => expect(section.textContent).toContain(EXPECTATION.empty))
    expect(within(section).queryByTestId('cone')).toBeNull()
  })

  it('leaves the other cards as they were: LV5 still draws its own chart beside the cone', async () => {
    routes()
    mount()
    const section = await screen.findByRole('region', { name: TRACKING.label })
    await waitFor(() => expect(within(section).getByTestId('linestack')).toBeTruthy())
    expect(within(section).queryByTestId('cone')).toBeNull()
  })
})

describe('LIVE: Routes, Fills and the footer strip (Phase 8)', () => {
  it('lists the routes and fills from /api/live/routes, B/S as coloured text, the plumbing row with its banner', async () => {
    routes()
    mount()
    const table = await screen.findByRole('table', { name: LIVE.routesLabel })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(ROUTES_BODY.routes.length)
    expect(rows[0]!.className).toContain('plumbing-row')
    expect(rows[0]!.textContent).toContain(BANNER)
    const buy = within(rows[3]!).getByText('BUY')
    expect(buy.className).toContain('up')
    const fills = screen.getByRole('table', { name: LIVE.fillsLabel })
    expect(within(fills).getAllByRole('row')).toHaveLength(ROUTES_BODY.fills.length + 1)
    expect(within(fills).getAllByText('298,215.00').length).toBeGreaterThan(0)
    const foot = strip(LIVE.footerLabel)
    expect(foot.textContent).toContain('1 routes, 1 fills (not counted)')
    expect(screen.getByText(/the journal records no send time/)).toBeTruthy()
  })
})

describe('LIVE screen', () => {
  it('draws the red bar titled as read only, with GET requests only', async () => {
    const spy = routes()
    mount()
    const bar = screen.getByRole('toolbar', { name: /Paper book/ })
    expect(bar.textContent).toContain(LIVE.title)
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('list', { name: LIVE.stateLabel })).toBeTruthy())
    for (const [, init] of spy.mock.calls) expect(init?.method).toBe('GET')
  })

  it('shows the book state and the guards from /api/live/status', async () => {
    routes()
    mount()
    await waitFor(() => expect(strip(LIVE.stateLabel).textContent).toContain('MNQZ6'))
    const book = strip(LIVE.stateLabel)
    expect(book.textContent).toContain('reconciliation failed: MNQZ6.CME holds 5, expected 6')
    const guards = strip(LIVE.guardLabel)
    expect(guards.textContent).toContain(`${LIVE.kill} ${LIVE.killOff}`)
    expect(guards.textContent).toContain('not monitored')
    expect(guards.textContent).toContain('none')
  })

  it('follows the kill switch file: [on] when the status says so', async () => {
    routes({ status: status({ kill_switch_on: true }) })
    mount()
    await waitFor(() => expect(strip(LIVE.guardLabel).textContent).toContain(`${LIVE.kill} ${LIVE.killOn}`))
  })

  it('shows the countdown to the decision and order times and the roll date', async () => {
    routes()
    mount()
    const times = await screen.findByRole('group', { name: 'Paper book times for 2026-10-02 (ET)' })
    expect(times.textContent).toContain('15:55:05 ET')
    expect(times.textContent).toContain('15:59:30 ET')
    expect(times.textContent).toContain('2026-12-08 (MNQZ6)')
  })

  it('shows the exposure summary as Basis B tiles with units', async () => {
    routes()
    mount()
    const row = await screen.findByRole('list', { name: LIVE.kpiLabel })
    expect(row.textContent).toContain('0.2982')
    expect(row.textContent).toContain(LIVE.unitX)
    expect(row.textContent).toContain('[POST HOC]')
  })

  it('draws target against actual from performance rows only: no plumbing date', async () => {
    routes()
    mount()
    const chart = await waitFor(() => {
      const found = document.querySelector('.live-perf [data-testid="linestack"]')
      if (!found) throw new Error('no target against actual chart yet')
      return found
    })
    const t = chart.getAttribute('data-t')!.split(',').map(Number)
    expect(t).toEqual([dateSeconds('2026-09-28'), dateSeconds('2026-09-30'), dateSeconds('2026-10-01')])
    expect(t).not.toContain(dateSeconds('2026-10-02'))
    expect(screen.getByText('Plumbing rows dropped from this view: 1.', { exact: false })).toBeTruthy()
  })

  it('born failing: a leaked plumbing row stops the chart with the guard message', async () => {
    const leaked = performance({
      date: ['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-02'], contract: ['a', 'a', 'a', 'a'], target: [6, 6, null, 6],
      expected: [6, 6, null, 6], actual: [6, 6, null, 6], reconciled_ok: [true, true, null, true], exposure: [0.3, null, null, 0.31],
      slippage_ticks: [1, null, null, 2], sent: [true, false, null, true], refused: [null, null, null, null], error: [null, null, null, null],
      halted: [false, false, true, false],
    })
    routes({ performance: leaked })
    mount()
    expect(await screen.findByText(/Not drawn: the performance rows do not match/)).toBeTruthy()
    // LV5's own chart sits in its section; the target-against-actual chart must not be drawn.
    expect(screen.queryAllByTestId('linestack').filter((el) => el.closest('.live-tracking') === null)).toEqual([])
  })

  it('lists the reconciliation rows and the journals under live/logs', async () => {
    routes()
    mount()
    const recon = await screen.findByRole('table', { name: LIVE.reconLabel })
    await waitFor(() => expect(within(recon).getAllByRole('row').length).toBe(4))
    expect(recon.textContent).toContain('0.2982')
    const journals = screen.getByRole('table', { name: LIVE.journalsLabel })
    await waitFor(() => expect(journals.textContent).toContain(BOOK))
    expect(journals.textContent).toContain(LIVE.plumbingTag)
  })

  it('names the expected file when no journal is written yet', async () => {
    routes({
      status: emptyStatus(),
      performance: { ...performance({ date: [], contract: [], target: [], expected: [], actual: [], reconciled_ok: [], exposure: [], slippage_ticks: [], sent: [], refused: [], error: [], halted: [], plumbing_rows_skipped: 0 }), present: false, empty_state: `no journal yet: live/logs/${BOOK}` },
      closeRows: page([]),
      tracking: { ...TRACKING_BODY, present: false, empty_state: `no journal yet: live/logs/${BOOK}` },
    })
    mount()
    expect((await screen.findAllByText(`no journal yet: live/logs/${BOOK}`)).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('linestack')).toBeNull()
  })

  it('shows the status error detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ detail: 'live folder unreadable' }, 422))
    mount()
    expect(await screen.findByText('The paper book status could not be read: live folder unreadable')).toBeTruthy()
  })
})
