// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { useMessage } from '../../chrome/MessageLine.store'
import { OOS, OPENINGS } from '../../copy/oos'
import { stubLayout } from '../../grids/testing'
import OosScreen from './OosScreen'

vi.mock('../../charts/echarts/Swimlane', () => ({
  Swimlane: ({ data }: { data: { reads: ReadonlyArray<{ caller: string; sealed?: boolean }> } }) => (
    <div data-testid="swimlane">{data.reads.map((r) => `${r.caller}${r.sealed ? '*' : ''}`).join(' ')}</div>
  ),
}))

type Entry = Schemas['OosLogEntry']

function entry(over: Partial<Entry>): Entry {
  return {
    alert: false, caller: 'za_screen', end: '2022-01-01 00:00:00+00:00', end_epoch_s: 1640995200, is_sealed: false, key_set: 'k4',
    line_no: 1, past_fence: false, reason: 'pre-registered za_v0 screen', rows: 3129157, sealed: null, severity: 2, spec_sha256: null,
    start: '2010-09-28 00:00:00+00:00', start_epoch_s: 1285632000, symbol: 'NQ.V.0', timeframe: '1m', variant: 'repaired',
    ts_epoch_s: 1790386325, ts_utc: '2026-09-25T21:32:05.600302+00:00', ...over,
  }
}

const ENTRIES = [
  entry({ line_no: 1 }),
  entry({
    line_no: 2, caller: 'serve_sealed', is_sealed: true, past_fence: true, reason: 'confirm rebal_v1', severity: 4, alert: true,
    start: '2021-10-01 00:00:00+00:00', end: '2026-09-01 00:00:00+00:00', start_epoch_s: 1633046400, end_epoch_s: 1788220800,
    ts_utc: '2026-09-26T11:00:00+00:00',
  }),
  entry({ line_no: 3, caller: 'terminal', reason: 'terminal display: NQ.V.0 1m vendor 2019', ts_utc: '2026-09-27T09:00:00+00:00', severity: 1 }),
]

function log(over: Partial<Schemas['OosLog']> = {}): Schemas['OosLog'] {
  return {
    counts_by_caller: { za_screen: 1, serve_sealed: 1, terminal: 7 }, entries: ENTRIES, fence_end: '2022-01-01',
    filters: { caller: null, since: null, limit: 5000, offset: 0 }, key_sets: { k4: 3 }, log_present: true, matched: 3,
    parse_errors: [], partial_tail: false, returned: 3, sealed_reads: 1, terminal_reads: 7, total: 3,
    severity_levels: [
      { level: 1, meaning: 'terminal display read, inside the in-sample window' },
      { level: 2, meaning: 'research read by another caller, inside the in-sample window' },
      { level: 3, meaning: 'window past the fence, before the in-sample start, or unreadable: check it' },
      { level: 4, meaning: 'sealed read (spent window)' },
    ],
    severity_counts: { '1': 1, '2': 1, '4': 1 },
    ...over,
  }
}

const OPENINGS_BODY: Schemas['Openings'] = {
  label: 'spent window, opened 2026-09-26, descriptive only',
  openings: [{ caller: 'rebal_v1_confirm', window: ['2021-10-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00'], symbols: ['NQ.V.0', 'ZN.V.0'],
    decided_by: 'user', decided_utc: '2026-09-26T10:47:46+00:00', closed: true, closed_utc: '2026-09-26T11:15:20+00:00' }],
  openings_closed: true, openings_pin_ok: true, openings_sha256: 'abc',
  pinned: { openings_sha256: 'abc', sealed_log_lines: 2, sealed_log_sha256: 'def' }, sealed_log: { lines: 2, sha256: 'def' },
  sealed_log_pin_ok: true,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function routes(logBody: unknown = log(), logStatus = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/audit/openings')) return json(OPENINGS_BODY)
    if (url.startsWith('/api/audit/oos-log')) return json(logBody, logStatus)
    return json({ detail: 'unexpected' }, 404)
  })
}

function mount() {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(
    <ApiProvider client={client}>
      <OosScreen params={{ code: 'OOS', context: null, args: {}, group: '-' }} context={null} />
    </ApiProvider>,
  )
}

beforeEach(() => stubLayout(600))
afterEach(() => cleanup())

describe('OOS: the R severity column (Phase 8)', () => {
  it('draws each entry\'s severity as steps with its meaning for assistive technology, and the legend', async () => {
    routes()
    mount()
    const grid = await screen.findByRole('grid', { name: OOS.gridLabel })
    await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(3))
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(rows[1]!.textContent).toContain('severity 4 of 4: sealed read (spent window)')
    expect(rows[1]!.querySelectorAll('.oos-sev-step.on')).toHaveLength(4)
    expect(rows[0]!.querySelectorAll('.oos-sev-step.on')).toHaveLength(1)
    const legend = screen.getByRole('list', { name: OOS.severityLegendLabel })
    expect(within(legend).getByText('4 sealed read (spent window): 1')).toBeTruthy()
  })
})

describe('OOS screen', () => {
  it('draws the red bar with its numbered actions and title', async () => {
    routes()
    mount()
    const bar = screen.getByRole('toolbar', { name: /Gate access log/ })
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: /98\) Export/ })).toBeTruthy()
    expect(bar.textContent).toContain(OOS.title)
  })

  it('shows the whole-log counts from the API, the terminal reads among them', async () => {
    routes()
    mount()
    await waitFor(() => expect(screen.getByText('Terminal reads 7')).toBeTruthy())
    expect(screen.getByText('Sealed reads 1')).toBeTruthy()
    expect(screen.getByText('Log lines 3')).toBeTruthy()
  })

  it('shows the openings card CLOSED with its pin status', async () => {
    routes()
    mount()
    const card = await screen.findByRole('region', { name: OPENINGS.label })
    await waitFor(() => expect(within(card).getByText(OPENINGS.closedTag)).toBeTruthy())
    expect(card.textContent).toContain('opened 2026-09-26 by user')
    expect(card.textContent).toContain(OPENINGS.pinOk)
    expect(card.textContent).toContain(OPENINGS.logPinOk)
    expect(card.textContent).toContain(OPENINGS.spentTag)
  })

  it('lists the entries newest first with their result, the sealed read marked', async () => {
    routes()
    mount()
    const grid = await screen.findByRole('grid', { name: OOS.gridLabel })
    await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(3))
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(rows[0]!.textContent).toContain('2026-09-27 09:00:00')
    expect(rows[1]!.textContent).toContain(OOS.resultSealed)
    expect(rows[1]!.textContent).toContain('2021-10-01..2026-09-01')
    expect(rows[2]!.textContent).toContain(OOS.resultServed)
  })

  it('asks the API for one caller when the caller field changes', async () => {
    const spy = routes()
    mount()
    const field = await screen.findByRole('combobox', { name: OOS.callerField })
    await waitFor(() => expect(screen.getByText('Terminal reads 7')).toBeTruthy())
    fireEvent.click(field)
    fireEvent.click(await screen.findByRole('option', { name: 'terminal (7)' }))
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('caller=terminal'))).toBe(true))
    for (const [, init] of spy.mock.calls) expect(init?.method).toBe('GET')
  })

  it('refuses a since value that is not a date, without a request', async () => {
    const spy = routes()
    mount()
    const since = await screen.findByRole('textbox', { name: OOS.sinceField })
    const before = spy.mock.calls.length
    fireEvent.change(since, { target: { value: '26/09/2026' } })
    fireEvent.keyDown(since, { key: 'Enter' })
    expect(await screen.findByText(OOS.sinceInvalid)).toBeTruthy()
    expect(spy.mock.calls.slice(before).some(([u]) => String(u).includes('since='))).toBe(false)
    fireEvent.change(since, { target: { value: '2026-09-26' } })
    fireEvent.keyDown(since, { key: 'Enter' })
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('since=2026-09-26'))).toBe(true))
  })

  it('switches to the timeline: one span per read, sealed reads marked', async () => {
    routes()
    mount()
    await screen.findByRole('grid', { name: OOS.gridLabel })
    fireEvent.click(screen.getByRole('button', { name: OOS.viewTimeline }))
    const lane = await screen.findByTestId('swimlane')
    expect(lane.textContent).toBe('za_screen serve_sealed* terminal')
  })

  it('names the expected file when there is no log yet', async () => {
    routes(log({ log_present: false, entries: [], total: 0, matched: 0, returned: 0, counts_by_caller: {}, terminal_reads: 0, sealed_reads: 0 }))
    mount()
    expect(await screen.findByText(OOS.noLog)).toBeTruthy()
  })

  it('shows the API error detail instead of a table', async () => {
    routes({ detail: 'since must be an ISO date' }, 422)
    mount()
    expect(await screen.findByText('The access log could not be read: since must be an ISO date')).toBeTruthy()
  })

  it('exports the shown entries as CSV without any request', async () => {
    const spy = routes()
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mount()
    await screen.findByRole('grid', { name: OOS.gridLabel })
    await waitFor(() => expect(screen.getByText('Terminal reads 7')).toBeTruthy())
    const calls = spy.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls.length).toBe(calls)
    expect(useMessage.getState().text).toMatch(/^Saved \d+ access log entries as CSV\.$/)
  })

  it('born failing: says the file could not be saved, never "saved", when the browser cannot save it', async () => {
    routes()
    Object.assign(URL, { createObjectURL: undefined })
    mount()
    await screen.findByRole('grid', { name: OOS.gridLabel })
    await waitFor(() => expect(screen.getByText('Terminal reads 7')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    })
    expect(useMessage.getState().text).toBe(OOS.exportUnavailable)
  })
})
