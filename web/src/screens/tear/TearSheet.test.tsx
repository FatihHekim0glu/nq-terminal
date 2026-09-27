// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../../api/queries'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import { BOOK_TRADES, HYP_ANALYTICS, NO_EXPOSURE, RUN_ANALYTICS, RUN_COSTS, RUN_EXPOSURE, RUN_TRADES, SMOKE_ANALYTICS } from './tear.fixtures'
import TearSheet from './TearSheet'

// The chart components draw on canvas through lazily loaded libraries; here each is a stand-in that
// records the input it was given, so the tests check what the screen feeds them.
const seen = vi.hoisted(() => ({ charts: [] as Array<{ kind: string; props: Record<string, unknown> }> }))

vi.mock('../../charts/LineStack', () => ({
  default: (props: { title: string }) => {
    seen.charts.push({ kind: 'linestack', props })
    return <div data-chart="linestack">{props.title}</div>
  },
}))
vi.mock('../../charts/echarts/Heatmap', () => ({
  Heatmap: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'heatmap', props })
    return <div data-chart="heatmap">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/Distribution', () => ({
  Distribution: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'distribution', props })
    return <div data-chart="distribution">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'barladder', props })
    return <div data-chart="barladder">{props.data.name}</div>
  },
}))

const UNUSABLE = { detail: 'unusable run: nt_za_v0_fixture_unbalanced: balance check failed: the run is unusable (rule 4)' }
const HYP_DETAIL = { card: { name: 'volmanaged_v0', series_costs: [0, 1, 2] } }
const EMPTY_TRADES = { ...BOOK_TRADES, stats: { ...BOOK_TRADES.stats, n: 0 } }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const ROUTES: ReadonlyArray<readonly [RegExp, () => Response]> = [
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_unbalanced/, () => json(UNUSABLE, 422)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/trades/, () => json(RUN_TRADES)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/exposure/, () => json(NO_EXPOSURE)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/costs/, () => json(RUN_COSTS)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\?/, () => json(SMOKE_ANALYTICS)],
  [/^\/api\/analytics\/run\/empty_run\/trades/, () => json(EMPTY_TRADES)],
  [/^\/api\/analytics\/run\/empty_run\/exposure/, () => json(RUN_EXPOSURE)],
  [/^\/api\/analytics\/run\/empty_run\/costs/, () => json(RUN_COSTS)],
  [/^\/api\/analytics\/run\/empty_run\?/, () => json(RUN_ANALYTICS)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/trades/, () => json(BOOK_TRADES)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/exposure/, () => json(RUN_EXPOSURE)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/costs/, () => json(RUN_COSTS)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\?/, () => json(RUN_ANALYTICS)],
  [/^\/api\/hypotheses\/volmanaged_v0$/, () => json(HYP_DETAIL)],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\?/, () => json(HYP_ANALYTICS)],
]

let fetchSpy: ReturnType<typeof vi.spyOn>

function urls(): string[] {
  return fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]))
}

beforeEach(() => {
  seen.charts.length = 0
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    const hit = ROUTES.find(([re]) => re.test(url))
    return hit ? hit[1]() : json({ detail: `no route ${url}` }, 404)
  })
})
afterEach(cleanup)

const RUN: ResolvedContext = { kind: 'run', value: 'nt_volmanaged_v0_fixture_m1' }
const HYP: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }

function show(code: MnemonicCode, context: ResolvedContext | null, actions?: PanelActions) {
  const client = createApiQueryClient()
  const wrap = (node: ReactNode) => (actions ? <PanelActionsContext value={actions}>{node}</PanelActionsContext> : node)
  return render(
    <QueryClientProvider client={client}>
      {wrap(<TearSheet params={{ code, context, args: {}, group: 'B' }} context={context} />)}
    </QueryClientProvider>,
  )
}

const tile = (label: RegExp) => screen.getByRole('button', { name: label })
const chartsOf = (kind: string) => seen.charts.filter((c) => c.kind === kind)

describe('tear sheet of a run (TASKS 6.4)', () => {
  it('asks for the run analytics by GET and shows the 13 KPI tiles with API values', async () => {
    show('EQ', RUN)
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    expect(within(screen.getByRole('list', { name: 'Tear sheet key figures' })).getAllByRole('listitem')).toHaveLength(13)
    expect(tile(/^Total return/).textContent).toContain('-0.36%')
    expect(tile(/^Sharpe/).textContent).toContain('-5.82')
    expect(tile(/^Sharpe/).textContent).toContain('[-15.93, 4.30]')
    expect(urls()).toContain('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
    for (const call of fetchSpy.mock.calls) expect((call[1] as RequestInit).method).toBe('GET')
  })

  it('names the basis and unit of the chart, and the [POST HOC] tag', async () => {
    show('EQ', RUN)
    await screen.findByText(/Basis B: account \(compounded from K\)\. Unit: USD, compounded from the starting balance K\./)
    expect(screen.getAllByText('[POST HOC]').length).toBeGreaterThan(0)
  })

  it('feeds the equity chart the API arrays unchanged', async () => {
    show('EQ', RUN)
    await screen.findByText('nt_volmanaged_v0_fixture_m1 equity')
    const stack = chartsOf('linestack').at(-1)!.props as { t: unknown; panes: Array<{ series: Array<{ values: unknown }> }> }
    expect(stack.t).toEqual(RUN_ANALYTICS.equity.t)
    expect(stack.panes[0]!.series[0]!.values).toEqual(RUN_ANALYTICS.equity.equity)
  })

  it('titles the red bar after the tab and numbers the five tabs', async () => {
    show('DD', RUN)
    await screen.findByText('Performance: drawdown')
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['1) Equity', '2) Drawdown', '3) Returns', '4) Rolling', '5) Monthly'])
    expect(screen.getByRole('tab', { name: '2) Drawdown' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('table', { name: /Top drawdowns/ })).toBeTruthy()
  })

  it('carries the context as an amber field in the red bar (look spec 7.5)', async () => {
    show('EQ', RUN)
    await screen.findByText('Performance: equity curve')
    expect((screen.getByRole('textbox', { name: 'Hypothesis or run' }) as HTMLInputElement).value).toBe(RUN.value)
  })

  it('switches tab in place outside a workspace', async () => {
    show('EQ', RUN)
    await screen.findByText('Performance: equity curve')
    fireEvent.click(screen.getByRole('tab', { name: '4) Rolling' }))
    expect(await screen.findByText('Performance: rolling statistics')).toBeTruthy()
    // The fixture run has 10 sessions, under the 63-session window: each pane says so instead of a scale.
    expect(await screen.findByRole('group', { name: 'nt_volmanaged_v0_fixture_m1 rolling statistics' })).toBeTruthy()
    expect(screen.getAllByText('Needs 63 sessions; this series has 10.')).toHaveLength(2)
  })

  it('opens the tab as its own function inside a workspace, so back and forward work', async () => {
    const open = vi.fn(() => true)
    const actions: PanelActions = { panelId: 'p1', related: () => true, back: () => true, forward: () => true, open }
    show('EQ', RUN, actions)
    await screen.findByText('Performance: equity curve')
    fireEvent.click(screen.getByRole('tab', { name: '5) Monthly' }))
    expect(open).toHaveBeenCalledWith('MRET')
  })

  it('draws the RET histogram with the stats panel and the MRET heat map', async () => {
    show('RET', RUN)
    await screen.findByText('nt_volmanaged_v0_fixture_m1 return distribution')
    expect(screen.getByRole('table', { name: 'Return statistics' })).toBeTruthy()
    cleanup()
    show('MRET', RUN)
    expect(await screen.findByText('nt_volmanaged_v0_fixture_m1 monthly returns')).toBeTruthy()
  })

  it('asks again with freq=M when Monthly is chosen', async () => {
    show('EQ', RUN)
    await screen.findByText('Performance: equity curve')
    fireEvent.click(screen.getByRole('combobox', { name: 'Freq' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Monthly' }))
    await waitFor(() => expect(urls()).toContain('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=M'))
  })

  it('shows [UNUSABLE: BALANCE] and draws nothing for a run whose balance check failed', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_unbalanced' })
    expect(await screen.findByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(screen.getByText(UNUSABLE.detail)).toBeTruthy()
    expect(chartsOf('linestack')).toHaveLength(0)
    expect(urls().some((u) => u.includes('/trades'))).toBe(false)
  })
})

describe('run books (trades, costs, exposure)', () => {
  it('shows the trade panels for a run with trades', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const books = await screen.findByRole('region', { name: /Run books of nt_za_v0_fixture_a/ })
    expect(await within(books).findByRole('table', { name: 'Trade statistics' })).toBeTruthy()
    expect(within(books).getByText(/no mark to market snapshots/)).toBeTruthy()
    expect(within(books).getByRole('table', { name: /Cost waterfall/ })).toBeTruthy()
  })

  it('shows no trade panels for a run without trades', async () => {
    show('EQ', { kind: 'run', value: 'empty_run' })
    const books = await screen.findByRole('region', { name: /Run books of empty_run/ })
    expect(await within(books).findByText(/has no closed trades/)).toBeTruthy()
    expect(within(books).queryByRole('table', { name: 'Trade statistics' })).toBeNull()
  })
})

describe('tear sheet of a hypothesis', () => {
  it('reads the recorded costs, then the analytics at 1 tick, and asks for no run books', async () => {
    show('EQ', HYP)
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    expect(urls()).toContain('/api/hypotheses/volmanaged_v0')
    expect(urls()).toContain('/api/analytics/hypothesis/volmanaged_v0?cost=1')
    expect(urls().some((u) => /\/(trades|costs|exposure)/.test(u))).toBe(false)
    expect(tile(/^Alpha\b(?! t)/).textContent).toContain('[PRE-REG]')
    expect(screen.getAllByText('[PRE-REG]').length).toBeGreaterThan(1)
  })
})

describe('context', () => {
  it('asks for a run or a hypothesis when there is none, and fetches nothing', () => {
    show('EQ', null)
    expect(screen.getByText(/needs a run or a hypothesis/)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses an instrument context', () => {
    show('EQ', { kind: 'instrument', value: 'NQ' })
    expect(screen.getByText('The tear sheet takes a run or a hypothesis, not the instrument NQ.')).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
