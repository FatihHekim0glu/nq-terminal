// @vitest-environment jsdom
// DQ screen (ANALYTICS RI4 and RI5): the calendar heatmap named by its data summary with a table view, the
// legend with letters, hover and Number <GO> reasons, the flagged-day grid, the QA years, the [POST HOC]
// label verbatim, the symbol switch, the guard fingerprint tab and the universe matrix; all from GETs under /api/dq.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import { DQ } from '../../copy/dq'
import { stubLayout } from '../../grids/testing'
import DqScreen from './DqScreen'
import type { DqCalendar, DqIndex, DqSymbol, GuardStatusReport } from './types'
import type { DqUniverse } from './universeModel'

const PANEL_ID = 'p-dq'
const PARAMS: PanelParams = { code: 'DQ', context: null, args: {}, group: 'A' }
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }
const LABEL = '[POST HOC] descriptive: day states read from the QA reports and repair records'

function sym(symbol: string, counts: Partial<DqSymbol['counts']>): DqSymbol {
  const c = { vendor: 0, gated_out: 0, rejected: 0, rebuilt: 0, unrepairable: 0, sessions: 0, ...counts }
  return { symbol, root: symbol.slice(0, 2), source: 'results/x.json', repair: 'v1', status: 'repaired', why_not_repaired: null, counts: c, first: '2011-01-03', last: '2011-01-07', }
}

const INDEX: DqIndex = { label: LABEL, fence: '2021-12-31', missing: [], symbols: [sym('NQ.V.0', { vendor: 3, rebuilt: 1, unrepairable: 1, sessions: 5 }), sym('GC.V.0', { vendor: 1, sessions: 1 })] }

function calendarFor(symbol: string): DqCalendar {
  const s = INDEX.symbols.find((x) => x.symbol === symbol)!
  const days = symbol === 'NQ.V.0'
    ? [
        { date: '2011-01-03', state: 'vendor' as const, reason: null },
        { date: '2011-01-04', state: 'rebuilt' as const, reason: 'vendor day rejected (no bars); rebuilt from trade prints' },
        { date: '2011-01-05', state: 'vendor' as const, reason: null },
        { date: '2011-01-06', state: 'unrepairable' as const, reason: 'still rejected: no bars; repair: RepairError: no trades' },
        { date: '2011-01-07', state: 'vendor' as const, reason: null },
      ]
    : [{ date: '2011-01-03', state: 'vendor' as const, reason: null }]
  return { label: LABEL, fence: '2021-12-31', symbol: s, days, qa_source: 'results/qa_report.json', qa_years: [{ year: 2011, rows: 1000, ohlc_violations: 0, duplicate_ts: 0, contract_changes: null, rth_days_with_gaps: 3 }] }
}

const GUARDS: GuardStatusReport = {
  label: 'guard fingerprint status',
  ok: 1, mismatch: 1, no_record: 0,
  groups: [
    { name: 'CONSTANTS', keys: 11, live_sha256: 'a'.repeat(64), recorded_sha256: 'a'.repeat(64), record: 'results/guard_constants.json', status: 'OK', changed_keys: [] },
    { name: 'SIZING_GUARDS', keys: 5, live_sha256: 'b'.repeat(64), recorded_sha256: 'c'.repeat(64), record: 'tests/test_sizing_guards.py FROZEN_SIZING_SHA', status: 'MISMATCH', changed_keys: [] },
  ],
}

const UNIVERSE_COUNTS = { sessions: 10, usable: 9, gated_out: 1, unrepairable: 0, rejected: 0, usable_share: 0.9 }
const UNIVERSE: DqUniverse = {
  label: LABEL, fence: '2021-12-31', years: [2010, 2011], missing: [],
  roots: [{
    root: 'NQ', symbol: 'NQ.V.0', repair_status: 'nq', source: 'results/x.json', qa_source: 'results/qa_report.json',
    first_bar: '2010-09-29', last_bar: '2021-12-31 or later, sealed', last_sealed: true, daily: null, blocks: [],
    rows: [{ timeframe: '1m', variant: 'vendor', total: UNIVERSE_COUNTS,
      cells: [{ year: 2010, ...UNIVERSE_COUNTS, sessions: 0, usable: 0, gated_out: 0, usable_share: null }, { year: 2011, ...UNIVERSE_COUNTS }] }],
  }],
}

async function defaultFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://x')
  let body: unknown = INDEX
  if (url.pathname.startsWith('/api/dq/calendar/')) body = calendarFor(decodeURIComponent(url.pathname.split('/').pop()!))
  if (url.pathname === '/api/dq/guards') body = GUARDS
  if (url.pathname === '/api/dq/universe') body = UNIVERSE
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const fetchSpy = vi.fn(defaultFetch)

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
const renderDq = () => render(<DqScreen params={PARAMS} context={PARAMS.context} />, { wrapper: Panel })

beforeAll(() => stubLayout(600))

describe('DQ screen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    Element.prototype.scrollIntoView = () => {}
    fetchSpy.mockClear()
    resetNumbered()
  })
  afterEach(cleanup)

  it('draws the calendar as an image named by its summary, with the API label verbatim', async () => {
    renderDq()
    const img = await screen.findByRole('img', { name: /NQ\.V\.0 data quality calendar, 2011-01-03 to 2011-01-07: 5 sessions/ })
    expect(img.getAttribute('aria-label')).toContain('Rebuilt 1, Unrepairable 1')
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
    expect(urls()).toContain('/api/dq/symbols')
    expect(urls()).toContain('/api/dq/calendar/NQ.V.0')
    expect(urls().every((u) => u.startsWith('/api/dq/'))).toBe(true)
  })

  it('gives each cell its date, state and reason on hover, and letters that do not rely on colour', async () => {
    const { container } = renderDq()
    await screen.findByRole('img', { name: /NQ\.V\.0/ })
    const cell = container.querySelector('[data-date="2011-01-06"]')!
    expect(cell.querySelector('title')?.textContent).toBe('2011-01-06: Unrepairable. still rejected: no bars; repair: RepairError: no trades')
    expect(cell.textContent).toContain('U')
    fireEvent.mouseMove(cell)
    expect(screen.getByRole('status', { name: /readout/i }).textContent).toContain('2011-01-06')
  })

  it('walks the readout with the keyboard, one session per arrow, and outlines the day it reads', async () => {
    const { container } = renderDq()
    const img = await screen.findByRole('img', { name: /NQ\.V\.0/ })
    const readout = () => screen.getByRole('status', { name: /readout/i }).textContent
    fireEvent.keyDown(img, { key: 'ArrowRight' })
    expect(readout()).toContain('2011-01-03')
    fireEvent.keyDown(img, { key: 'ArrowRight' })
    expect(readout()).toContain('2011-01-04: Rebuilt')
    expect(container.querySelector('[data-date="2011-01-04"]')!.getAttribute('class')).toContain('dq-hover')
    fireEvent.keyDown(img, { key: 'End' })
    expect(readout()).toContain('2011-01-07')
    expect(screen.getByText(/Arrow keys move the readout one session/)).toBeTruthy()
  })

  it('keeps drawing when a record holds a weekend day, and names that day', async () => {
    const weekend = { ...calendarFor('NQ.V.0') }
    const days = [...weekend.days, { date: '2011-01-08', state: 'rebuilt' as const, reason: 'a calendar slip' }]
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x')
      const body = url.pathname.startsWith('/api/dq/calendar/') ? { ...weekend, days } : url.pathname === '/api/dq/guards' ? GUARDS : INDEX
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    try {
      renderDq()
      expect(await screen.findByRole('img', { name: /NQ\.V\.0/ })).toBeTruthy()
      expect(screen.getByText('1 recorded days are not weekday sessions and are left off the calendar: 2011-01-08.')).toBeTruthy()
    } finally {
      fetchSpy.mockReset()
      fetchSpy.mockImplementation(defaultFetch)
    }
  })

  it('switches to the table view with counts per year', async () => {
    renderDq()
    await screen.findByRole('img', { name: /NQ\.V\.0/ })
    fireEvent.click(screen.getAllByRole('button', { name: 'Table' })[0]!)
    const table = screen.getByRole('table', { name: 'NQ.V.0 sessions by year and state' })
    const total = within(table).getByText('Total').closest('tr')!
    expect(total.textContent).toContain('5')
  })

  it('lists the flagged days in a numbered grid; Number <GO> selects one and shows its reason', async () => {
    renderDq()
    await screen.findByRole('grid', { name: 'NQ.V.0 flagged days' })
    act(() => {
      activateNumbered(PANEL_ID, 1)
    })
    expect(await screen.findByText(/Selected 2011-01-06: Unrepairable\./)).toBeTruthy()
  })

  it('shows the QA report years and the source', async () => {
    renderDq()
    const qa = await screen.findByRole('table', { name: /QA report, per year/ })
    expect(within(qa).getByText('1,000')).toBeTruthy()
    expect(screen.getByText('Source: results/qa_report.json')).toBeTruthy()
  })

  it('reads another symbol when the symbol field changes', async () => {
    renderDq()
    await screen.findByRole('img', { name: /NQ\.V\.0/ })
    fireEvent.click(screen.getByRole('combobox', { name: 'Symbol' }))
    fireEvent.click(await screen.findByRole('option', { name: 'GC.V.0' }))
    await waitFor(() => expect(urls()).toContain('/api/dq/calendar/GC.V.0'))
    expect(await screen.findByRole('img', { name: /GC\.V\.0 data quality calendar/ })).toBeTruthy()
  })

  it('shows OK and MISMATCH per guard group on the second tab, in words', async () => {
    renderDq()
    await screen.findByRole('img', { name: /NQ\.V\.0/ })
    act(() => {
      activateNumbered(PANEL_ID, 86)
    })
    const grid = await screen.findByRole('grid', { name: 'Guard groups' })
    expect(within(grid).getByText('MISMATCH')).toBeTruthy()
    expect(within(grid).getByText('OK')).toBeTruthy()
    expect(screen.getByText('1 OK, 1 mismatch, 0 with no record.')).toBeTruthy()
    expect(urls()).toContain('/api/dq/guards')
  })

  it('shows the universe matrix on the third tab, 87, read from /api/dq/universe only when it is opened', async () => {
    renderDq()
    await screen.findByRole('img', { name: /NQ\.V\.0/ })
    expect(urls()).not.toContain('/api/dq/universe')
    act(() => {
      activateNumbered(PANEL_ID, 87)
    })
    const grid = await screen.findByRole('grid', { name: 'Data usability, every root by year' })
    expect(urls()).toContain('/api/dq/universe')
    expect(within(grid).getByRole('gridcell', { name: /^NQ 1m vendor 2011: 9 of 10 sessions usable, 90\.0%/ })).toBeTruthy()
    expect(within(grid).getByText('2021-12-31 or later, sealed')).toBeTruthy()
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
    expect(screen.getByRole('tab', { name: /Universe/ })).toBeTruthy()
  })

  it('opens on the universe matrix when the context is a universe', async () => {
    render(<DqScreen params={PARAMS} context={{ kind: 'universe', value: 'NQ' }} />, { wrapper: Panel })
    expect(await screen.findByRole('grid', { name: 'Data usability, every root by year' })).toBeTruthy()
    expect(screen.queryByRole('img', { name: /data quality calendar/ })).toBeNull()
  })

  it('says so when the universe cannot be read', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x')
      if (url.pathname === '/api/dq/universe') return new Response(JSON.stringify({ detail: 'a repair record could not be classified' }), { status: 502, headers: { 'content-type': 'application/json' } })
      return defaultFetch(input)
    })
    try {
      render(<DqScreen params={PARAMS} context={{ kind: 'universe', value: 'NQ' }} />, { wrapper: Panel })
      expect(await screen.findByText(/could not be read: a repair record could not be classified/, {}, { timeout: 4000 })).toBeTruthy()
    } finally {
      fetchSpy.mockReset()
      fetchSpy.mockImplementation(defaultFetch)
    }
  })

  it('shows no permanent Loading when the symbol index is empty (D31)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://x')
      const body = url.pathname === '/api/dq/symbols' ? { label: LABEL, fence: '2021-12-31', missing: ['x'], symbols: [] } : INDEX
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    renderDq()
    await screen.findByText(DQ.noSymbols)
    // A disabled calendar query (no symbol to ask for) must never leave a permanent aria-busy Loading
    // line beside "No symbols": react-query reports a disabled query with no data as isPending forever.
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.queryByText(DQ.loading)).toBeNull()
  })
})
