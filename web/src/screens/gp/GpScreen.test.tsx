// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { ResolvedContext } from '../../commands/types'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import { useLinkGroups } from '../../state/linkGroups'
import { GIPScreen, GPScreen } from './index'

// The chart library needs a canvas; the screen's job is what it feeds the chart, so the chart is a probe.
vi.mock('../../charts/CandleChart', () => ({
  default: (props: { name: string; bars: { t: number[] }; fills?: unknown[]; rolls?: unknown[]; link?: string; grid?: boolean }) => (
    <div
      data-testid="candle"
      data-name={props.name}
      data-bars={props.bars.t.length}
      data-fills={props.fills?.length ?? 0}
      data-rolls={props.rolls?.length ?? 0}
      data-link={props.link}
      data-grid={String(Boolean(props.grid))}
    />
  ),
}))

const D = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000

function barsBody(over: Record<string, unknown> = {}) {
  return {
    symbol: 'NQ.V.0', timeframe: '1d', variant: 'vendor', bucket: '1d', ts_convention: 'bar open, UTC',
    start: '2021-01-01T00:00:00Z', end: '2022-01-01T00:00:00Z',
    label: 'back-adjusted prices served through the OOS gate; descriptive, in-sample',
    t: [D('2021-12-29'), D('2021-12-30'), D('2021-12-31')],
    o: [16300.25, 16320.5, 16330], h: [16350, 16360.75, 16340.5], l: [16280, 16300, 16290.25],
    c: [16320.5, 16330, 16310.75], v: [100000, 120500, 90250],
    rolls: [{ t: D('2021-12-30'), from: 1, to: 2, gap_pts: 1.25, gap_pct: 0.0094 }],
    sessions: { assessed: true, source: 'qa.day_gate, from results/screens/za_v0_rejected_days.json', gated: [], repaired: [] },
    gate: { caller: 'terminal', served_years: [2021], cached: true, reads_this_process: 4 },
    ...over,
  }
}

const CATALOG = {
  source: 'fixture', unrecognised: [],
  series: [
    { symbol: 'NQ.V.0', root: 'NQ', timeframe: '1d', variant: 'vendor' },
    { symbol: 'NQ.V.0', root: 'NQ', timeframe: '1m', variant: 'vendor' },
    { symbol: 'NQ.V.0', root: 'NQ', timeframe: '1m', variant: 'repaired' },
  ].map((s) => ({ ...s, file: 'x', size_bytes: 1, modified_utc: '', rows: 1, row_groups: 1, columns: [], first_ts: null, extends_past_fence: false, error: null })),
}

const UNIVERSE = { rows: [{ root: 'NQ', realised_vol: 0.3057, last_date: '2021-12-31', returns: { '1D': -0.0011787 } }] }
const RUNS = [{ run_id: 'nt_volmanaged_v0_fixture_m1' }, { run_id: 'nt_dtsmom_v0_fixture_ts1' }]
const FILLS = {
  items: [
    { ts: null, ts_epoch_s: D('2021-12-30') + 72000, instrument: null, side: 'BUY', qty: 20, px: 6061.25, commission: null, commission_float: null, position_id: null, order_id: null, tags: null },
    { ts: null, ts_epoch_s: D('2021-12-31') + 72000, instrument: null, side: 'SELL', qty: 3, px: 6040.25, commission: null, commission_float: null, position_id: null, order_id: null, tags: null },
  ],
  total: 2, offset: 0, limit: 5000,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Router = (url: URL) => Response | undefined

let urls: string[] = []
let methods: string[] = []

function serve(route: Router = () => undefined) {
  urls = []
  methods = []
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    urls.push(`${url.pathname}${url.search}`)
    methods.push(init?.method ?? 'GET')
    const own = route(url)
    if (own) return own
    if (url.pathname === '/api/bars') return json(barsBody({ timeframe: url.searchParams.get('timeframe'), variant: url.searchParams.get('variant') }))
    if (url.pathname === '/api/data/catalog') return json(CATALOG)
    if (url.pathname === '/api/market/universe') return json(UNIVERSE)
    if (url.pathname === '/api/runs') return json(RUNS)
    if (url.pathname.endsWith('/fills')) return json(FILLS)
    return json({ detail: 'not found' }, 404)
  })
}

function mount(node: ReactNode) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return render(<ApiProvider client={client}>{node}</ApiProvider>)
}

const NQ: ResolvedContext = { kind: 'instrument', value: 'NQ' }

function params(code: 'GP' | 'GIP', args: PanelParams['args'] = {}, group: PanelParams['group'] = '-'): PanelParams {
  return { code, context: NQ, args, group }
}

const barRequests = () => urls.filter((u) => u.startsWith('/api/bars'))
const lastBars = () => new URLSearchParams((barRequests().at(-1) ?? '').split('?')[1] ?? '')

beforeEach(() => useLinkGroups.getState().clearAll())
afterEach(() => {
  cleanup()
  useLinkGroups.getState().clearAll()
})

describe('GP: candles from /api/bars', () => {
  it('draws the served bars and puts the served values in the quote header', async () => {
    serve()
    mount(<GPScreen params={params('GP', { timeframe: '1d' })} context={NQ} />)
    const chart = await screen.findByTestId('candle')
    expect(chart.dataset.bars).toBe('3')
    expect(chart.dataset.name).toBe('NQ1 Index')
    expect(chart.dataset.rolls).toBe('1')
    const quote = screen.getByRole('group', { name: 'Quote for NQ1 Index' })
    expect(within(quote).getByText('16310.75')).toBeTruthy()
    expect(within(quote).getByText('16330.00')).toBeTruthy()
    expect(within(quote).getByText('16340.50')).toBeTruthy()
    expect(within(quote).getByText('16290.25')).toBeTruthy()
    expect(within(quote).getByText('90,250')).toBeTruthy()
    expect(within(quote).getByText('-19.25')).toBeTruthy()
    await waitFor(() => expect(within(quote).getByText('30.6%')).toBeTruthy())
    // The percent change is the universe's 1D return, not a back-adjusted change over a back-adjusted price.
    expect(within(quote).getByText('-0.12%')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Candle chart functions' })).toBeTruthy()
    expect(lastBars().get('symbol')).toBe('NQ.V.0')
    expect(lastBars().get('timeframe')).toBe('1d')
    expect(lastBars().get('start')).toBe('2021-01-01')
    expect(lastBars().has('end')).toBe(false)
  })

  it('shows the basis, the gate bookkeeping and the bucket from the response', async () => {
    serve()
    mount(<GPScreen params={params('GP')} context={NQ} />)
    await screen.findByTestId('candle')
    expect(screen.getByText(/back-adjusted prices served through the OOS gate; descriptive, in-sample/)).toBeTruthy()
    expect(screen.getByText(/Gate: caller terminal, served 2021 \(cached\), reads this process 4/)).toBeTruthy()
    expect(screen.getByText('Bucket 1d')).toBeTruthy()
  })

  it('switches between 1m, 5m, 1h and 1d, each with its default range', async () => {
    serve()
    mount(<GPScreen params={params('GP')} context={NQ} />)
    await screen.findByTestId('candle')
    const bar = screen.getByRole('group', { name: 'Bar size' })
    for (const [tf, start] of [['1h', '2021-12-01'], ['5m', '2021-12-29'], ['1m', '2021-12-31'], ['1d', '2021-01-01']] as const) {
      fireEvent.click(within(bar).getByRole('button', { name: tf }))
      await waitFor(() => expect(lastBars().get('timeframe')).toBe(tf))
      expect(lastBars().get('start')).toBe(start)
      expect(within(bar).getByRole('button', { name: tf }).getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('disables ranges longer than one request may span', async () => {
    serve()
    mount(<GPScreen params={params('GP', { timeframe: '1m' })} context={NQ} />)
    await screen.findByTestId('candle')
    const ranges = screen.getByRole('group', { name: 'Time range' })
    expect(within(ranges).getByRole('button', { name: /^Max/ }).getAttribute('aria-disabled')).toBe('true')
    expect(within(ranges).getByRole('button', { name: /^5Y/ }).getAttribute('aria-disabled')).toBe('true')
    expect(within(ranges).getByRole('button', { name: /^1Y/ }).getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(within(ranges).getByRole('button', { name: /^Max/ }))
    expect(barRequests().every((u) => !u.includes('start=2010'))).toBe(true)
  })

  it('offers repaired only where the catalog has it and requests it', async () => {
    serve()
    mount(<GPScreen params={params('GP', { timeframe: '1m' })} context={NQ} />)
    await screen.findByTestId('candle')
    const field = await screen.findByRole('combobox', { name: 'Variant' })
    await waitFor(() => {
      fireEvent.click(field)
      expect(screen.getByRole('option', { name: 'repaired' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('option', { name: 'repaired' }))
    await waitFor(() => expect(lastBars().get('variant')).toBe('repaired'))
    fireEvent.click(within(screen.getByRole('group', { name: 'Bar size' })).getByRole('button', { name: '1d' }))
    await waitFor(() => expect(lastBars().get('timeframe')).toBe('1d'))
    expect(lastBars().get('variant')).toBe('vendor')
    expect(screen.getByText('No repaired series at 1d for NQ1 Index; showing vendor.')).toBeTruthy()
  })

  it('refuses a range past the fence with the gate rule and requests nothing past 2021-12-31', async () => {
    serve()
    mount(<GPScreen params={params('GP')} context={NQ} />)
    await screen.findByTestId('candle')
    const before = barRequests().length
    const end = screen.getByRole('textbox', { name: 'Range end' })
    fireEvent.change(end, { target: { value: '2022-03-14' } })
    fireEvent.keyDown(end, { key: 'Enter' })
    expect(await screen.findByText('Gate refused this window.')).toBeTruthy()
    expect(screen.getByText(/leaves the in-sample window \[2010-01-01 00:00:00\+00:00, 2022-01-01 00:00:00\+00:00\); straddling windows are refused, not clipped/)).toBeTruthy()
    expect(screen.queryByTestId('candle')).toBeNull()
    expect(barRequests().length).toBe(before)
    expect(urls.every((u) => !u.includes('2022'))).toBe(true)
  })

  it('shows the gate text of a 403 verbatim', async () => {
    const detail = 'window [2019-01-01 00:00:00+00:00, 2023-01-01 00:00:00+00:00) leaves the in-sample window'
    serve((url) => (url.pathname === '/api/bars' ? json({ detail }, 403) : undefined))
    mount(<GPScreen params={params('GP')} context={NQ} />)
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.getByText('The gate refused the request:')).toBeTruthy()
  })

  it('shows another API error with its status', async () => {
    serve((url) => (url.pathname === '/api/bars' ? json({ detail: 'no processed series NQ.V.0 1d repaired' }, 404) : undefined))
    mount(<GPScreen params={params('GP')} context={NQ} />)
    expect(await screen.findByText('no processed series NQ.V.0 1d repaired')).toBeTruthy()
    expect(screen.getByText('Bars could not be loaded (404):')).toBeTruthy()
  })

  it('marks gated and repaired sessions in the window', async () => {
    serve((url) =>
      url.pathname === '/api/bars'
        ? json(barsBody({ sessions: { assessed: true, source: 'qa.day_gate', gated: ['2011-01-04', '2011-01-05'], repaired: ['2011-01-19'] } }))
        : undefined,
    )
    mount(<GPScreen params={params('GP')} context={NQ} />)
    const flags = await screen.findByRole('group', { name: 'Session flags' })
    expect(within(flags).getByText('[GATED]')).toBeTruthy()
    expect(within(flags).getByText(/2 sessions rejected by qa.day_gate/)).toBeTruthy()
    expect(within(flags).getByText('[REPAIRED]')).toBeTruthy()
    expect(within(flags).getByText(/1 session rebuilt from trades/)).toBeTruthy()
  })

  it('says when a symbol has no session QA', async () => {
    serve((url) => (url.pathname === '/api/bars' ? json(barsBody({ sessions: { assessed: false, source: null, gated: [], repaired: [] } })) : undefined))
    mount(<GPScreen params={params('GP')} context={NQ} />)
    expect(await screen.findByText('Sessions not assessed: no session QA for this symbol.')).toBeTruthy()
  })

  it('overlays the fills of the run in its link group', async () => {
    serve()
    act(() => {
      useLinkGroups.getState().setContext('A', { kind: 'run', value: 'nt_volmanaged_v0_fixture_m1' })
    })
    mount(<GPScreen params={params('GP', {}, 'A')} context={NQ} />)
    await waitFor(() => expect(screen.getByTestId('candle').dataset.fills).toBe('2'))
    expect(screen.getByTestId('candle').dataset.link).toBe('A')
    expect(screen.getByText('2 fills from nt_volmanaged_v0_fixture_m1. Fill prices are contract prices; candles are back-adjusted.')).toBeTruthy()
    expect(urls).toContain('/api/runs/nt_volmanaged_v0_fixture_m1/fills?limit=5000')
  })

  it('asks for an instrument when the panel has none', () => {
    serve()
    mount(<GPScreen params={{ code: 'GP', context: null, args: {}, group: '-' }} context={null} />)
    expect(screen.getByText(/No instrument in this panel/)).toBeTruthy()
    expect(barRequests()).toEqual([])
  })

  it('sends GET only', async () => {
    serve()
    mount(<GPScreen params={params('GP')} context={NQ} />)
    await screen.findByTestId('candle')
    expect(new Set(methods)).toEqual(new Set(['GET']))
  })
})

describe('GIP: one session intraday', () => {
  it('requests the session window of the date at 1m with the intraday title', async () => {
    serve()
    mount(<GIPScreen params={params('GIP', { date: '2019-03-14' })} context={NQ} />)
    await screen.findByTestId('candle')
    expect(screen.getByRole('toolbar', { name: 'Intraday chart functions' })).toBeTruthy()
    expect(lastBars().get('timeframe')).toBe('1m')
    expect(lastBars().get('start')).toBe('2019-03-13T22:00:00Z')
    expect(lastBars().get('end')).toBe('2019-03-14T22:00:00Z')
    const bar = screen.getByRole('group', { name: 'Bar size' })
    expect(within(bar).queryByRole('button', { name: '1d' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Time range' })).toBeNull()
  })

  it('refuses a date past the fence without any bars request', async () => {
    serve()
    mount(<GIPScreen params={params('GIP', { date: '2022-03-14' })} context={NQ} />)
    expect(await screen.findByText('Gate refused this window.')).toBeTruthy()
    expect(screen.getByText(/^window \[2022-03-13 22:00:00\+00:00, 2022-03-14 22:00:00\+00:00\) leaves the in-sample window/)).toBeTruthy()
    expect(barRequests()).toEqual([])
  })

  it('shows [GATED] or [REPAIRED] for the date itself', async () => {
    let flags = { assessed: true, source: 'qa.day_gate', gated: ['2011-01-20'], repaired: [] as string[] }
    serve((url) => (url.pathname === '/api/bars' ? json(barsBody({ sessions: flags })) : undefined))
    mount(<GIPScreen params={params('GIP', { date: '2011-01-20' })} context={NQ} />)
    expect(await screen.findByText('2011-01-20 was rejected by qa.day_gate.')).toBeTruthy()
    expect(screen.getByText('[GATED]')).toBeTruthy()
    flags = { assessed: true, source: 'qa.day_gate', gated: [], repaired: ['2011-01-19', '2011-01-20'] }
    fireEvent.click(await screen.findByRole('combobox', { name: 'Variant' }))
    fireEvent.click(await screen.findByRole('option', { name: 'repaired' }))
    expect(await screen.findByText('2011-01-20 was rebuilt from trades.')).toBeTruthy()
    expect(screen.getByText('[REPAIRED]')).toBeTruthy()
  })

  it('moves to another date from the amber date field', async () => {
    serve()
    mount(<GIPScreen params={params('GIP', { date: '2019-03-14' })} context={NQ} />)
    await screen.findByTestId('candle')
    const field = screen.getByRole('textbox', { name: 'Date' })
    fireEvent.change(field, { target: { value: '2019-03-15' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(lastBars().get('start')).toBe('2019-03-14T22:00:00Z'))
    fireEvent.change(field, { target: { value: '2019-3-15' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByText('2019-3-15 is not a date. Use YYYY-MM-DD.')).toBeTruthy()
  })
})
