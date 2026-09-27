// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import * as bus from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { NumberingContext, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import { DEFLATED } from '../../copy/deflated'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { DEFLATED_REAL } from '../reg/deflatedFixtures'
import DesScreen from './DesScreen'
import { CONFIRMATION, HYPOTHESES, INSTRUMENT_NQ, OVERNIGHT, PANEL, REBAL, VOLMANAGED, ZA_C3 } from './desTestData'

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string; t: readonly number[]; panes: ReadonlyArray<{ summaryDrawdown?: unknown; series: ReadonlyArray<{ name: string; values: readonly unknown[] }> }> }) => (
    <div
      data-testid="des-linestack"
      data-title={props.title}
      data-series={JSON.stringify(props.panes[0]?.series.map((s) => [s.name, s.values.length]))}
      data-drawdown={JSON.stringify(props.panes[0]?.summaryDrawdown ?? null)}
    />
  ),
}))

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { chartId?: string; data: { bars: unknown; unit?: string; marker?: unknown } }) => (
    <div data-testid={`ladder-${props.chartId}`} data-bars={JSON.stringify(props.data.bars)} data-unit={props.data.unit} data-marker={JSON.stringify(props.data.marker ?? null)} />
  ),
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const SEALED_INDEX = [
  { name: 'rebal_v1_confirm', kind: 'json', label: CONFIRMATION.label },
  { name: 'rebal_v1_confirm_trades', kind: 'csv', label: CONFIRMATION.label },
]
const DETAILS: Record<string, unknown> = {
  overnight_v0: OVERNIGHT,
  volmanaged_v0: VOLMANAGED,
  rebal_v0: REBAL,
  za_v0_C3_gao_momentum: ZA_C3,
}
const COMMANDS = {
  grammar: '', mnemonics: [], universe: ['27F'], hypotheses: Object.keys(DETAILS), confirmations: ['rebal_v1_confirm'], runs: [], registry_error: null,
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
}
const CATALOG = {
  source: 'processed price files',
  series: [
    { symbol: 'NQ.V.0', root: 'NQ', timeframe: '1m', variant: 'repaired', file: 'NQ.V.0_1m_back_repaired.parquet', size_bytes: 0, modified_utc: '2026-09-26T00:00:00Z', rows: 3318549, row_groups: 4, columns: [], first_ts: '2010-09-28T00:00:00Z', extends_past_fence: false, error: null },
    { symbol: 'ES.V.0', root: 'ES', timeframe: '1d', variant: 'vendor', file: 'ES.V.0_1d_back.parquet', size_bytes: 0, modified_utc: '2026-09-26T00:00:00Z', rows: null, row_groups: null, columns: [], first_ts: null, extends_past_fence: null, error: null },
  ],
}
const HEALTH = { fence: { is_start: '2010-01-01', is_end: '2022-01-01' }, gate_reads_this_process: 7, kill_switch_on: false, fixture_mode: true }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function route(url: URL): Response {
  const path = url.pathname
  if (path === '/api/confirmations') return confirmationsFail ? json({ detail: 'confirmations unavailable' }, 500) : json(confirmationBody ?? [CONFIRMATION])
  if (path === '/api/sealed') return json(SEALED_INDEX)
  if (path === '/api/hypotheses') return json([...HYPOTHESES, REBAL.card, ZA_C3.card])
  if (path === '/api/commands') return json(COMMANDS)
  if (path === '/api/data/catalog') return json(CATALOG)
  if (path === '/api/health') return json(HEALTH)
  if (path === '/api/instruments/NQ') return json(INSTRUMENT_NQ)
  if (path === '/api/analytics/deflated') return json(DEFLATED_REAL)
  const panel = /^\/api\/analytics\/hypothesis\/([^/]+)\/panel$/.exec(path)
  if (panel) return json(PANEL)
  const detail = /^\/api\/hypotheses\/([^/]+)$/.exec(path)
  const name = decodeURIComponent(detail?.[1] ?? '')
  if (detail && DETAILS[name]) return json(DETAILS[name])
  if (detail) return json({ detail: `unknown hypothesis: ${name}` }, 404)
  return json({ detail: 'not in this test' }, 404)
}

let calls: Array<{ url: string; method: string }> = []
// The /api/confirmations body a test serves in place of the default (null: [CONFIRMATION]).
let confirmationBody: unknown[] | null = null
// When true, /api/confirmations answers 500.
let confirmationsFail = false

beforeEach(() => {
  calls = []
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    calls.push({ url: `${url.pathname}${url.search}`, method: init?.method ?? 'GET' })
    return route(url)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  confirmationBody = null
  confirmationsFail = false
})

const PARAMS: PanelParams = { code: 'DES', context: null, args: {}, group: '-' }

function renderDes(context: ResolvedContext | null, registrar = vi.fn(() => () => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={registrar}>{node}</NumberingContext>
    </ApiProvider>
  )
  return { ...render(wrap(<DesScreen params={{ ...PARAMS, context }} context={context} />)), registrar }
}

const hyp = (value: string): ResolvedContext => ({ kind: 'hypothesis', value })

async function openHypothesis(name: string) {
  const utils = renderDes(hyp(name))
  await screen.findByRole('heading', { name, level: 3 })
  return utils
}

function kpiValue(label: string): string {
  const tile = screen.getAllByRole('button').find((b) => b.querySelector('.kpi-label')?.textContent === label)
  return tile?.querySelector('.kpi-value')?.textContent ?? 'missing'
}

describe('DES, hypothesis tear sheet', () => {
  it('shows the registration line: name, verdict, tag, spec hash and its checks', async () => {
    await openHypothesis('overnight_v0')
    const head = screen.getByTestId('des-head')
    expect(head.textContent).toContain('[PASS]')
    expect(head.textContent).toContain('[PRE-REG]')
    expect(head.textContent).toContain('spec b1dc...9816')
    expect(head.textContent).toContain('[sha ok]')
    expect(head.textContent).toContain('[re-hash ok]')
    expect(head.textContent).toContain('round 1')
  })

  it('shows the pass bar verbatim from the spec', async () => {
    await openHypothesis('overnight_v0')
    expect(screen.getByTestId('des-passbar').textContent).toBe((OVERNIGHT.spec as Record<string, unknown>)['pass_bar'])
  })

  it('shows the registered values in the KPI row at their displayed precision', async () => {
    await openHypothesis('overnight_v0')
    expect(kpiValue(OVERNIGHT.card.headline_display ?? '')).toBe('+2.87')
    expect(kpiValue('n')).toBe('2,825')
    expect(kpiValue(OVERNIGHT.card.t_label ?? '')).toBe('+2.78')
    // One precision per quantity on every screen: p and adjusted p at 4 decimals, as REG and MT show them.
    expect(kpiValue('p')).toBe('0.0027')
    expect(kpiValue('Control p')).toBe('--')
    expect(kpiValue('Bonferroni')).toBe('0.0054')
    expect(kpiValue('BH q')).toBe('0.0054')
  })

  it('lists every pass check with its reading and result', async () => {
    await openHypothesis('overnight_v0')
    fireEvent.click(screen.getByRole('tab', { name: `2) ${DES.tabs.checks}` }))
    const table = screen.getByRole('table', { name: /Pass checks of overnight_v0/ })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(OVERNIGHT.card.pass_checks.length)
    expect(rows[0]?.textContent).toContain('t >= 2.5')
    expect(rows[0]?.textContent).toContain('[PASS]')
  })

  it('labels the dsr check as the Sharpe difference (m - BH)', async () => {
    await openHypothesis('volmanaged_v0')
    fireEvent.click(screen.getByRole('tab', { name: `2) ${DES.tabs.checks}` }))
    const cell = screen.getByRole('cell', { name: `${DES.dsrLabel} 2tick > 0` })
    expect(cell).toBeTruthy()
  })

  it('draws the blocks and the cost ladder with the JSON values unchanged', async () => {
    await openHypothesis('volmanaged_v0')
    fireEvent.click(screen.getByRole('tab', { name: `3) ${DES.tabs.costs}` }))
    const blocks = JSON.parse(screen.getByTestId('ladder-des-blocks').dataset['bars'] ?? '[]') as Array<{ value: number }>
    expect(blocks.map((b) => b.value)).toEqual(VOLMANAGED.des.blocks.map((b) => b.value))
    const cost = JSON.parse(screen.getByTestId('ladder-des-cost').dataset['bars'] ?? '[]') as Array<{ value: number }>
    expect(cost.map((b) => b.value)).toEqual(VOLMANAGED.des.cost_ladder.map((r) => r.value))
    expect(screen.getByTestId('ladder-des-cost').dataset['unit']).toBe(VOLMANAGED.des.cost_ladder_unit)
    expect(screen.getByText('Break-even 66.11 ticks per side, beyond the ladder')).toBeTruthy()
  })

  it('shows the in-sample against sealed strip with SPENT for rebal_v0', async () => {
    await openHypothesis('rebal_v0')
    const strip = await screen.findByTestId('des-spent')
    expect(strip.textContent).toContain('[SPENT]')
    expect(strip.textContent).toContain('rebal_v1_confirm')
    expect(strip.textContent).toContain(CONFIRMATION.label)
    await waitFor(() => expect(strip.textContent).toContain('rebal_v1_confirm_trades'))
  })

  it('shows the hypothesis DSR against SR0 from SV3, [POST HOC], in the registration box', async () => {
    await openHypothesis('volmanaged_v0')
    const vm = DEFLATED_REAL.rows.find((r) => r.name === 'volmanaged_v0')!
    const label = await screen.findByText(DEFLATED.desLabel)
    const box = label.closest('tr') ?? label.parentElement!
    await waitFor(() => expect(box.textContent).toContain(
      `DSR < 0.000001 under V (SR0 ${vm.sr0_own_period!.toFixed(4)}), ${vm.dsr_null!.toFixed(3)} under V0 (SR0 ${vm.sr0_null_own_period!.toFixed(4)}), N 21`))
    expect(calls.filter((c) => c.url === '/api/analytics/deflated').every((c) => c.method === 'GET')).toBe(true)
  })

  it('says a check row is not an SV3 trial', async () => {
    await openHypothesis('za_v0_C3_gao_momentum')
    const label = await screen.findByText(DEFLATED.desLabel)
    const box = label.closest('tr') ?? label.parentElement!
    await waitFor(() => expect(box.textContent).toContain(DEFLATED.desNone))
  })

  it('shows no sealed strip where nothing was sealed', async () => {
    await openHypothesis('overnight_v0')
    await waitFor(() => expect(calls.some((c) => c.url === '/api/sealed')).toBe(true))
    expect(screen.queryByTestId('des-spent')).toBeNull()
  })

  it('plots the equity panel at 1 tick and refetches at another recorded cost', async () => {
    await openHypothesis('volmanaged_v0')
    const stack = await screen.findByTestId('des-linestack')
    // The accessible name states the API's drawdown on its basis, never a ratio of the curve's peaks.
    expect(JSON.parse(stack.getAttribute('data-drawdown') ?? 'null')).toEqual({ value: '-9.49%', basis: 'Basis A' })
    expect(calls.some((c) => c.url === '/api/analytics/hypothesis/volmanaged_v0/panel?cost=1')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '0 ticks' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/analytics/hypothesis/volmanaged_v0/panel?cost=0')).toBe(true))
    expect((await screen.findAllByText(`[${DES.postHoc}]`)).length).toBeGreaterThan(0)
    expect(screen.getByText(DES.equityDescriptive)).toBeTruthy()
  })

  it('asks for no series where none is recorded', async () => {
    await openHypothesis('za_v0_C3_gao_momentum')
    expect(screen.getByText(DES.equityNone)).toBeTruthy()
    expect(calls.some((c) => c.url.includes('/panel'))).toBe(false)
    expect(screen.getByTestId('des-head').textContent).toContain('[POST HOC]')
  })

  it('opens a linked run in RUN through the command line', async () => {
    const spy = vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
    await openHypothesis('overnight_v0')
    fireEvent.click(screen.getByRole('tab', { name: `4) ${DES.tabs.links}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Open nt_overnight_v0_fixture_open in RUN' }))
    expect(spy).toHaveBeenCalledWith('nt_overnight_v0_fixture_open RUN')
  })

  it('offers its tabs and links to Number <GO>', async () => {
    const { registrar } = await openHypothesis('overnight_v0')
    await waitFor(() => {
      const items = registrar.mock.calls.flatMap((c) => (c as unknown as [string, NumberedItem[]])[1])
      expect(items.map((i) => i.n)).toEqual(expect.arrayContaining([1, 2, 3, 4, 8, 14]))
    })
  })

  it('shows the API refusal for an unknown name', async () => {
    renderDes(hyp('nope_v0'))
    expect(await screen.findByText(/unknown hypothesis: nope_v0/)).toBeTruthy()
  })

  it('renders the round summary from markdown', async () => {
    await openHypothesis('rebal_v0')
    expect(screen.getByRole('region', { name: /Round summary: round4_summary.md/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'verdict' })).toBeTruthy()
  })
})

describe('DES, other contexts', () => {
  it('shows the sealed confirmation as SPENT, with its own alpha, and links to its parent', async () => {
    const spy = vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
    renderDes(hyp('rebal_v1_confirm'))
    await screen.findByRole('heading', { name: 'rebal_v1_confirm', level: 3 })
    const head = screen.getByTestId('des-head')
    expect(head.textContent).toContain('[SPENT]')
    expect(head.textContent).toContain('[FAIL]')
    expect(screen.getByText(CONFIRMATION.label)).toBeTruthy()
    expect(screen.getByText('0.05')).toBeTruthy()
    expect(screen.getByText('CLOSED')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open rebal_v0 in DES' }))
    expect(spy).toHaveBeenCalledWith('rebal_v0 DES')
    expect(calls.some((c) => c.url === '/api/hypotheses/rebal_v1_confirm')).toBe(false)
  })

  it('against a backend that does not serve the confirmation spec, says so rather than "no pass bar"', async () => {
    const { pass_bar: _p, hypothesis: _h, ...older } = CONFIRMATION
    confirmationBody = [older]
    renderDes(hyp('rebal_v1_confirm'))
    await screen.findByRole('heading', { name: 'rebal_v1_confirm', level: 3 })
    expect(screen.getByText(DES.confirmation.passBarGap)).toBeTruthy()
    expect(screen.queryByText(DES.passBarNone)).toBeNull()
    confirmationBody = null
  })

  it('born failing: a failed /api/confirmations read is an alert, never a fall-through to the registry route', async () => {
    confirmationsFail = true
    renderDes(hyp('rebal_v1_confirm'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(fillCopy(DES.confirmationsError, { name: 'rebal_v1_confirm', detail: 'confirmations unavailable' }))
    expect(calls.some((c) => c.url.startsWith('/api/hypotheses/'))).toBe(false)
  })

  it('shows the confirmation spec pass bar and hypothesis verbatim, as /api/confirmations serves them', async () => {
    renderDes(hyp('rebal_v1_confirm'))
    await screen.findByRole('heading', { name: 'rebal_v1_confirm', level: 3 })
    expect(typeof CONFIRMATION.pass_bar).toBe('string')
    const bar = screen.getByTestId('des-confirm-pass-bar')
    expect(bar.textContent).toBe(CONFIRMATION.pass_bar)
    expect(screen.getByTestId('des-confirm-hypothesis').textContent).toBe(CONFIRMATION.hypothesis)
  })

  it('describes an instrument from GET /api/instruments/{root}: contract, hours and related dates on page 1', async () => {
    renderDes({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('heading', { name: 'NQ1 Index', level: 3 })
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['1) Profile', '2) Coverage', '3) Notes', '4) Contracts (CT)'])
    const contract = await screen.findByRole('region', { name: DES.instrument.contract })
    expect(within(contract).getByText('0.25')).toBeTruthy()
    expect(within(contract).getByText('20.00 USD')).toBeTruthy()
    const related = screen.getByRole('region', { name: DES.instrument.related })
    expect(within(related).getByText('2026-12-08')).toBeTruthy()
    expect(within(related).getByText('MNQZ6')).toBeTruthy()
    const hours = screen.getByRole('region', { name: DES.instrument.hours })
    expect(within(hours).getByText('15:55:05 ET')).toBeTruthy()
    expect(within(hours).getByText(INSTRUMENT_NQ.hours_note)).toBeTruthy()
    // The price card reads one year of daily vendor bars to the fence, as GP does (look spec 7.3).
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/bars'))).toBe(true))
    const bars = calls.filter((c) => c.url.startsWith('/api/bars')).map((c) => new URL(c.url, 'http://127.0.0.1').searchParams)
    expect(bars.every((q) => q.get('timeframe') === '1d' && q.get('variant') === 'vendor' && q.get('start') === '2021-01-01' && q.get('end') === null)).toBe(true)
  })

  it('shows coverage, notes and the month-code strip on their own tabs', async () => {
    renderDes({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('heading', { name: 'NQ1 Index', level: 3 })
    fireEvent.click(screen.getByRole('tab', { name: '2) Coverage' }))
    const coverage = await screen.findByRole('table', { name: /Processed price series of NQ1 Index/ })
    expect(within(coverage).getAllByRole('row')).toHaveLength(INSTRUMENT_NQ.coverage.series.length + 1)
    expect(within(coverage).getByText('NQ.V.0_1m_back_repaired.parquet')).toBeTruthy()
    expect(screen.getByText('2010-01-01 to 2022-01-01 (the fence)')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '3) Notes' }))
    const notes = await screen.findByRole('list', { name: DES.instrument.notes })
    expect(within(notes).getAllByRole('listitem')).toHaveLength(INSTRUMENT_NQ.notes.length)
    expect(within(notes).getByText(/qa.day_gate rejects 498 in-sample sessions/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '4) Contracts (CT)' }))
    const strip = await screen.findByRole('list', { name: DES.instrument.monthStrip })
    const items = within(strip).getAllByRole('listitem')
    expect(items.map((i) => i.textContent?.replace(/\s+listed$/, ''))).toEqual(['Jan:F', 'Feb:G', 'Mar:H', 'Apr:J', 'May:K', 'Jun:M', 'Jul:N', 'Aug:Q', 'Sep:U', 'Oct:V', 'Nov:X', 'Dec:Z'])
    expect(items.filter((i) => i.classList.contains('des-month-on')).map((i) => i.textContent?.slice(0, 5))).toEqual(['Mar:H', 'Jun:M', 'Sep:U', 'Dec:Z'])
  })

  it('98) Report saves the description as Markdown, with no request', async () => {
    renderDes({ kind: 'instrument', value: 'NQ' })
    await screen.findByRole('region', { name: DES.instrument.contract })
    const before = calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Report/ }))
      const text = await saved.text('NQ_DES.md')
      expect(text.split('\n')[0]).toBe('# NQ1 Index: futures description')
      expect(calls.length).toBe(before)
    } finally {
      saved.restore()
    }
    cleanup()
    renderDes(hyp('volmanaged_v0'))
    await screen.findByRole('heading', { name: 'volmanaged_v0', level: 3 })
    const again = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Report/ }))
      expect((await again.text('volmanaged_v0_DES.md')).startsWith('# volmanaged_v0: hypothesis description')).toBe(true)
    } finally {
      again.restore()
    }
  })

  it('asks for a context when it has none', () => {
    renderDes(null)
    expect(screen.getByText(/DES needs a hypothesis or an instrument/)).toBeTruthy()
  })

  it('reads only with GET, only under /api, and never asks for prices', async () => {
    await openHypothesis('rebal_v0')
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: `3) ${DES.tabs.costs}` }))
    })
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.method === 'GET' && c.url.startsWith('/api/'))).toBe(true)
    expect(calls.some((c) => c.url.startsWith('/api/bars'))).toBe(false)
  })
})
