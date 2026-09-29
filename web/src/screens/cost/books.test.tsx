// @vitest-environment jsdom
// COST, BLK, EXPO and SEAL (TASKS 9.4) against a stubbed API: the values equal what DES and the API
// give (the DES ladder table's own text, the API means), a confirmation is never asked for as a registry
// row, sealed files open by Number <GO> or a click with the spent label, and every request is a GET.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { barLadderTable } from '../../charts/echarts/barLadderModel'
import type { CompositionInput } from '../../charts/echarts/compositionModel'
import { captureDownloads } from '../../chrome/download.testUtil'
import { NumberingContext, type NumberedItem, type Registrar } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { ResolvedContext } from '../../commands/types'
import { COMPOSITION } from '../../copy/composition'
import BlkScreen from '../blk/BlkScreen'
import { blocksInput, breakEvenText, costInput } from '../des/desModel'
import { CONFIRMATION, OVERNIGHT, REBAL, VOLMANAGED } from '../des/desTestData'
import ExpoScreen from '../expo/ExpoScreen'
import SealScreen from '../seal/SealScreen'
import { compositionInput, compositionView } from '../tear/bookComposition'
import RunBooks from '../tear/RunBooks'
import CostScreen from './CostScreen'

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => <div data-testid="linestack" data-title={props.title} />,
}))

vi.mock('../../charts/echarts/Composition', () => ({
  Composition: (props: { mode: string; data: CompositionInput }) => (
    <div data-testid="composition" data-mode={props.mode} data-rows={JSON.stringify(props.data.rows)} />
  ),
}))

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { chartId?: string; data: { bars: unknown } }) => <div data-testid={`ladder-${props.chartId}`} data-bars={JSON.stringify(props.data.bars)} />,
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const LABEL = CONFIRMATION.label
const SEALED_INDEX = [
  { name: 'rebal_v1_confirm', kind: 'json', label: LABEL },
  { name: 'rebal_v1_confirm_trades', kind: 'csv', label: LABEL },
]
const SEALED_FILES: Record<string, unknown> = {
  rebal_v1_confirm: { name: 'rebal_v1_confirm', kind: 'json', label: LABEL, columns: null, values: null, n_rows: null, markdown: null, data: { verdict: 'FAIL', t: 0.42 } },
  rebal_v1_confirm_trades: {
    name: 'rebal_v1_confirm_trades', kind: 'csv', label: LABEL, columns: ['month', 'side', 'r'], n_rows: 2, markdown: null, data: null,
    values: { month: ['2022-01', '2022-02'], side: ['buy', 'sell'], r: [0.0123, -0.004] },
  },
}
const DETAILS: Record<string, unknown> = { overnight_v0: OVERNIGHT, volmanaged_v0: VOLMANAGED, rebal_v0: REBAL }

const COSTS = {
  run_id: 'r1', tag: '[POST HOC]',
  waterfall: {
    run_id: 'r1', unit: 'USD', label: 'Commissions are the fee per contract side.', ticks: 1, sides: 62, gross: 61539.375, commissions: 155, slippage: 726.25, net: 60658.125, costs_total: 881.25,
    rows: [{ step: 'gross', value: 61539.375 }, { step: 'commissions', value: -155 }, { step: 'modelled slippage', value: -726.25 }, { step: 'net', value: 60658.125 }],
    by_instrument: [{ instrument: 'ES.XCME', sides: 20, commissions: 50, slippage: 250 }],
  },
  sensitivity: { run_id: 'r1', unit: 'USD', label: 'Net P&L at each cost.', ticks: [0, 1, 2], net_usd: [61384.375, 60658.125, 59931.875], net_pct_of_k: [0.0006, 0.0006, 0.0006], run_ticks: 1, cost_per_tick_usd: 726.25, break_even_ticks_per_side: 84.5 },
}
const EXPOSURE = {
  run_id: 'r1', tag: '[POST HOC]', available: true, note: null,
  exposure: {
    run_id: 'r1', basis: 'B', unit: 'notional over equity', label: 'Notional over equity', price_basis: 'raw close', positions_reconcile: true,
    t: [1325548800, 1325635200], date: ['2012-01-03', '2012-01-04'], gross: [1.25, 1.5], net: [0.5, -0.25], mean_gross: 1.375, mean_net: 0.125, by_instrument: {},
  },
  turnover: { run_id: 'r1', basis: 'B', unit: 'traded notional over equity', label: 'Turnover', price_basis: 'raw close', source: 'fills', periods: 252, t: [1325635200], date: ['2012-01-04'], daily: [0.3], mean_daily: 0.3, annualised: 75.6 },
}
// Two instruments, a micro and its parent's sector, as GET /api/analytics/run/{id}/exposure sends them.
const R3_EXPOSURE = {
  ...EXPOSURE,
  run_id: 'r3',
  exposure: { ...EXPOSURE.exposure, basis: 'B' as const, run_id: 'r3', by_instrument: { 'MNQ.XCME': [0.6, 0.55], 'ZN.XCME': [0.65, 0.95] } },
}
const COMMAND_INDEX = {
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
  ],
}
const NO_EXPOSURE = { run_id: 'r2', tag: '[POST HOC]', available: false, note: 'this run has no mark to market snapshots (an intraday run), so it has no exposure or turnover', exposure: null, turnover: null }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  if (path === '/api/confirmations') return json([CONFIRMATION])
  if (path === '/api/sealed') return json(SEALED_INDEX)
  if (path === '/api/commands') return json(COMMAND_INDEX)
  if (path === '/api/analytics/run/r1/costs') return json(COSTS)
  if (path === '/api/analytics/run/r3/costs') return json({ ...COSTS, run_id: 'r3' })
  if (path === '/api/analytics/run/r3/exposure') return json(R3_EXPOSURE)
  if (path === '/api/analytics/run/r1/exposure') return json(EXPOSURE)
  if (path === '/api/analytics/run/r2/exposure') return json(NO_EXPOSURE)
  const sealed = /^\/api\/sealed\/(.+)$/.exec(path)
  if (sealed) return SEALED_FILES[sealed[1] ?? ''] ? json(SEALED_FILES[sealed[1] ?? '']) : json({ detail: 'unknown' }, 404)
  const detail = /^\/api\/hypotheses\/([^/]+)$/.exec(path)
  if (detail && DETAILS[detail[1] ?? '']) return json(DETAILS[detail[1] ?? ''])
  return json({ detail: 'not in this test' }, 404)
}

let calls: Array<{ path: string; method: string }> = []

beforeEach(() => {
  calls = []
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    calls.push({ path: decodeURIComponent(url.pathname), method: init?.method ?? 'GET' })
    return route(url)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show(Screen: ComponentType<ScreenProps>, code: string, context: ResolvedContext | null, registrar: Registrar = vi.fn(() => () => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const params: PanelParams = { code: code as PanelParams['code'], context, args: {}, group: '-' }
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={registrar}>{node}</NumberingContext>
    </ApiProvider>
  )
  return { ...render(wrap(<Screen params={params} context={context} />)), registrar }
}

const hyp = (value: string): ResolvedContext => ({ kind: 'hypothesis', value })
const run = (value: string): ResolvedContext => ({ kind: 'run', value })

function cells(testId: string, column: number): string[] {
  const table = screen.getByTestId(testId)
  return within(table).getAllByRole('row').slice(1).map((r) => r.children[column]?.textContent ?? '')
}

function expectGetOnly(): void {
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
}

describe('BLK', () => {
  it('shows the blocks exactly as the DES ladder table prints them, numbered', async () => {
    show(BlkScreen, 'BLK', hyp('overnight_v0'))
    await screen.findByTestId('blk-table')
    const des = barLadderTable(blocksInput(OVERNIGHT.des, 'overnight_v0')!)
    expect(cells('blk-table', 1)).toEqual(des.rows.map((r) => String(r['label'])))
    expect(cells('blk-table', 2)).toEqual(des.rows.map((r) => String(r['value'])))
    expect(cells('blk-table', 0)).toEqual(['1)', '2)', '3)'])
    expect(screen.getByTestId('books-head').textContent).toContain('[PRE-REG]')
    expect(screen.getByTestId('ladder-blk-ladder')).toBeTruthy()
    expectGetOnly()
  })

  it('never asks the registry for a sealed-window confirmation', async () => {
    show(BlkScreen, 'BLK', hyp('rebal_v1_confirm'))
    await screen.findByText(/is a sealed-window confirmation and has no in-sample blocks/)
    expect(calls.some((c) => c.path === '/api/hypotheses/rebal_v1_confirm')).toBe(false)
  })

  it('says how to give it a hypothesis when it has none', () => {
    show(BlkScreen, 'BLK', null)
    expect(screen.getByText(/Give BLK a hypothesis/)).toBeTruthy()
  })
})

describe('COST', () => {
  it('for a hypothesis: the DES cost ladder, its values and its break-even line', async () => {
    show(CostScreen, 'COST', hyp('volmanaged_v0'))
    await screen.findByTestId('cost-ladder-table')
    const des = barLadderTable(costInput(VOLMANAGED.des, 'volmanaged_v0')!)
    expect(cells('cost-ladder-table', 1)).toEqual(des.rows.map((r) => String(r['label'])))
    expect(cells('cost-ladder-table', 2)).toEqual(des.rows.map((r) => String(r['value'])))
    expect(screen.getByTestId('cost-break-even').textContent).toBe(breakEvenText(VOLMANAGED.des))
    expectGetOnly()
  })

  it('for a run: the waterfall, the costs by instrument and each sensitivity rung, as the API sends them', async () => {
    show(CostScreen, 'COST', run('r1'))
    await screen.findByTestId('cost-by-instrument')
    expect(cells('cost-by-instrument', 0)).toEqual(['ES.XCME'])
    expect(cells('cost-by-instrument', 3)).toEqual(['250.00'])
    expect(cells('cost-sensitivity', 1)).toEqual(['61,384.38', '60,658.13', '59,931.88'])
    // The run's own rung is marked and equals the waterfall's net.
    const charged = within(screen.getByTestId('cost-sensitivity')).getAllByRole('row').find((r) => r.className === 'charged-row')
    expect(charged?.textContent).toContain('60,658.13')
    expect(screen.getByText('60,658.13', { selector: '.tear-kv td' })).toBeTruthy()
    expect(calls.map((c) => c.path)).toContain('/api/analytics/run/r1/costs')
    expectGetOnly()
  })
})

describe('EXPO', () => {
  it('shows the API means and the exposure card', async () => {
    show(ExpoScreen, 'EXPO', run('r1'))
    await screen.findByTestId('expo-summary')
    const rows = within(screen.getByTestId('expo-summary')).getAllByRole('row').map((r) => [r.getAttribute('data-row'), r.lastElementChild?.textContent])
    expect(rows).toEqual([['meanGross', '1.38'], ['meanNet', '0.13'], ['sessions', '2'], ['meanTurnover', '0.30'], ['annualTurnover', '75.60'], ['periods', '252']])
    expect(screen.getByTestId('linestack')).toBeTruthy()
    // The exposure card reads the instrument index; a run with no per-instrument values offers no toggle.
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('/api/commands'))
    expect(screen.queryByRole('group', { name: COMPOSITION.toggle })).toBeNull()
    expectGetOnly()
  })

  it('offers Totals, By instrument and By sector when the run has per-instrument values, and draws them as served', async () => {
    show(ExpoScreen, 'EXPO', run('r3'))
    await screen.findByTestId('expo-summary')
    const toggle = await screen.findByRole('group', { name: COMPOSITION.toggle })
    expect(within(toggle).getAllByRole('button').map((b) => b.textContent)).toEqual(['Totals', 'By instrument', 'By sector'])
    expect(screen.getByTestId('linestack')).toBeTruthy()
    fireEvent.click(within(toggle).getByRole('button', { name: COMPOSITION.views.heat }))
    const chart = screen.getByTestId('composition')
    expect(chart.getAttribute('data-mode')).toBe('heat')
    await waitFor(() => expect(JSON.parse(screen.getByTestId('composition').getAttribute('data-rows') ?? '[]')).toEqual(
      compositionInput(compositionView(R3_EXPOSURE.exposure, COMMAND_INDEX)!, 'r3', 'heat').rows,
    ))
    const rows = JSON.parse(screen.getByTestId('composition').getAttribute('data-rows') ?? '[]') as Array<{ kind: string; label: string; values?: number[] }>
    expect(rows.map((r) => r.label)).toEqual(['Equity', 'MNQ', 'Rates', 'ZN'])
    expect(rows.find((r) => r.label === 'ZN')?.values).toEqual([0.65, 0.95])
    fireEvent.click(within(toggle).getByRole('button', { name: COMPOSITION.views.stack }))
    expect(screen.getByTestId('composition').getAttribute('data-mode')).toBe('stack')
    expect(screen.getByText(COMPOSITION.absolute)).toBeTruthy()
    expectGetOnly()
  })

  it('98) Export saves the sessions with one full precision column per instrument, no request', async () => {
    show(ExpoScreen, 'EXPO', run('r3'))
    await screen.findByTestId('expo-summary')
    const before = calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(await screen.findByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text()).split('\r\n')
      expect(lines).toEqual([
        'Session,Gross,Net,Turnover,MNQ.XCME,ZN.XCME',
        '2012-01-04,1.5,-0.25,0.3,0.55,0.95',
        '2012-01-03,1.25,0.5,,0.6,0.65',
      ])
      expect(calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })

  it('says why a run has no exposure', async () => {
    show(ExpoScreen, 'EXPO', run('r2'))
    expect((await screen.findAllByText(/no mark to market snapshots/)).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('expo-summary')).toBeNull()
    expect(screen.queryByRole('group', { name: COMPOSITION.toggle })).toBeNull()
  })
})

describe('RUN books', () => {
  it('put the composition toggle on the exposure card, reading the instrument index by GET', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ApiProvider client={client}>
        <RunBooks runId="r3" />
      </ApiProvider>,
    )
    const toggle = await screen.findByRole('group', { name: COMPOSITION.toggle })
    fireEvent.click(within(toggle).getByRole('button', { name: COMPOSITION.views.stack }))
    expect(screen.getByTestId('composition').getAttribute('data-mode')).toBe('stack')
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(expect.arrayContaining(['/api/commands', '/api/analytics/run/r3/exposure'])))
    expectGetOnly()
  })
})

describe('SEAL', () => {
  it('lists the sealed files numbered, spent, and opens one by Number <GO>', async () => {
    let items: readonly NumberedItem[] = []
    const registrar = vi.fn((_panel: string, next: readonly NumberedItem[]) => {
      items = next
      return () => {}
    })
    show(SealScreen, 'SEAL', hyp('rebal_v0'), registrar)
    await screen.findByTestId('seal-files')
    expect(cells('seal-files', 1)).toEqual(['rebal_v1_confirm', 'rebal_v1_confirm_trades'])
    expect(screen.getByTestId('seal-spent').textContent).toContain('[SPENT]')
    expect(screen.getByTestId('seal-spent').textContent).toContain(LABEL)
    await waitFor(() => expect(items.map((i) => i.n)).toEqual([1, 2]))
    items[1]?.run()
    await screen.findByTestId('seal-csv')
    expect(cells('seal-csv', 2)).toEqual(['0.0123', '-0.004'])
    expect(screen.getByTestId('seal-file').textContent).toContain(LABEL)
    expectGetOnly()
  })

  it('shows JSON without asking for anything but GETs, and a confirmation shows its parent files', async () => {
    show(SealScreen, 'SEAL', hyp('rebal_v1_confirm'))
    await screen.findByTestId('seal-files')
    expect(screen.getByText(/is the sealed-window confirmation of rebal_v0/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Show rebal_v1_confirm' }))
    const pre = await screen.findByTestId('seal-json')
    expect(JSON.parse(pre.textContent ?? '')).toEqual({ verdict: 'FAIL', t: 0.42 })
    expect(calls.some((c) => c.path === '/api/hypotheses/rebal_v1_confirm')).toBe(false)
    expectGetOnly()
  })

  it('says so when a hypothesis has no sealed files', async () => {
    show(SealScreen, 'SEAL', hyp('overnight_v0'))
    await screen.findByText(/has no sealed-window files/)
    expect(calls.some((c) => c.path.startsWith('/api/sealed/'))).toBe(false)
  })
})
