// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { LIVE } from '../../copy/live'
import { stubLayout } from '../../grids/testing'
import { BOOK, BOOK_CLOSE_ROWS, emptyStatus, page, performance, status } from './liveFixtures'
import { dateSeconds } from './liveModel'
import LiveScreen from './LiveScreen'

interface StubPane { readonly id: string; readonly series: ReadonlyArray<{ readonly name: string; readonly values: ReadonlyArray<number | null | undefined> }> }

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
}

function routes(b: Bodies = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/live/status')) return json(b.status ?? status())
    if (url.startsWith('/api/live/performance')) return json(b.performance ?? performance())
    if (url.startsWith('/api/live/journal')) return json(b.closeRows ?? page(BOOK_CLOSE_ROWS))
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
afterEach(() => cleanup())

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
    const chart = await screen.findByTestId('linestack')
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
    expect(screen.queryByTestId('linestack')).toBeNull()
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
