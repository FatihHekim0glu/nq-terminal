// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../../api/queries'
import * as bus from '../../chrome/CommandLine.bus'
import { captureDownloads } from '../../chrome/download.testUtil'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import { BOOK_TRADES, HYP_ANALYTICS, NO_EXPOSURE, RUN_ANALYTICS, RUN_COSTS, RUN_EXPOSURE, RUN_TRADES, SMOKE_ANALYTICS } from './tear.fixtures'
import { HYP_EXTENDED } from './tearP1.fixtures'
import TearSheet, { TEAR_CODES } from './TearSheet'

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
// The P1 cards under RET and RR draw these once /extended answers.
vi.mock('../../charts/echarts/XyScatter', () => ({
  XyScatter: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'xyscatter', props })
    return <div data-chart="xyscatter">{props.data.name}</div>
  },
}))
vi.mock('../../charts/echarts/Cone', () => ({
  Cone: (props: { data: { name: string } }) => {
    seen.charts.push({ kind: 'cone', props })
    return <div data-chart="cone">{props.data.name}</div>
  },
}))

const UNUSABLE = { detail: 'unusable run: nt_za_v0_fixture_unbalanced: balance check failed: the run is unusable (rule 4)' }
const HYP_DETAIL = { card: { name: 'volmanaged_v0', series_costs: [0, 1, 2] } }
const EMPTY_TRADES = { ...BOOK_TRADES, stats: { ...BOOK_TRADES.stats, n: 0 } }
const CHECK_DETAIL = {
  card: { name: 'za_v0_C3_gao_momentum', tag: 'check', spec: 'za_v0', verdict: 'check inside za_v0 (no own pass bar)', series_costs: [] },
}
const NO_SERIES_DETAIL = { card: { name: 'noseries_v0', tag: 'edge', spec: 'noseries_v0', verdict: 'FAIL', series_costs: [] } }
const GONE_DETAIL = { card: { name: 'gone_v0', tag: 'edge', spec: 'gone_v0', verdict: 'FAIL', series_costs: [1] } }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const detailOf = (strategy: string, balanceOk: boolean | null = true) => ({ summary: { strategy, balance_ok: balanceOk } })

const ROUTES: ReadonlyArray<readonly [RegExp, () => Response]> = [
  [/^\/api\/runs\/nt_za_v0_fixture_a$/, () => json(detailOf('za_orb'))],
  [/^\/api\/runs\/nt_volmanaged_v0_fixture_m1$/, () => json(detailOf('volmanaged'))],
  [/^\/api\/runs\/empty_run$/, () => json(detailOf('dtsmom'))],
  [/^\/api\/runs\/nt_za_v0_fixture_unbalanced$/, () => json(detailOf('za_orb', false))],
  [/^\/api\/runs\/nt_za_v0_fixture_negative$/, () => json(detailOf('dtsmom'))],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_negative/, () => json(UNUSABLE, 422)],
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
  // The extended body (RK5 and RG1 among others): the captured hypothesis response, for the run as well.
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\/extended\?/, () => json(HYP_EXTENDED)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/extended\?/, () => json(HYP_EXTENDED)],
  // A check row (the real card's shape): 200 with no recorded series, so no analytics are asked.
  [/^\/api\/hypotheses\/za_v0_C3_gao_momentum$/, () => json(CHECK_DETAIL)],
  [/^\/api\/hypotheses\/noseries_v0$/, () => json(NO_SERIES_DETAIL)],
  [/^\/api\/hypotheses\/gone_v0$/, () => json(GONE_DETAIL)],
  [/^\/api\/runs\/books_gone_run$/, () => json(detailOf('volmanaged'))],
  [/^\/api\/analytics\/run\/books_gone_run\?/, () => json(RUN_ANALYTICS)],
  // Everything else answers 404 (see beforeEach): gone_v0's analytics, books_gone_run's books.
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
    expect(screen.getByRole('region', { name: /Top drawdowns/ }).hasAttribute('data-roving-scroll')).toBe(true)
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
    // The statistics scroll in their own column in a short panel: that box is a named region that
    // holds the panel's Tab stop (axe scrollable-region-focusable).
    const stats = screen.getByRole('region', { name: 'Return statistics' })
    expect(stats.tabIndex).toBe(0)
    expect(stats.hasAttribute('data-roving')).toBe(true)
    expect(stats.hasAttribute('data-roving-scroll')).toBe(true)
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

  // Rule 4: the run's own record already says its balance check failed, so the screen never asks
  // the analytics route (which would answer 422, a console error in the browser).
  it('born failing: shows [UNUSABLE: BALANCE] for a run whose balance check failed without asking the analytics route', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_unbalanced' })
    expect(await screen.findByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('rule 4')
    expect(chartsOf('linestack')).toHaveLength(0)
    expect(urls()).toContain('/api/runs/nt_za_v0_fixture_unbalanced')
    expect(urls().some((u) => u.startsWith('/api/analytics/'))).toBe(false)
  })

  it('still reads a 422 from the analytics route as unusable when the run record did not say so', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_negative' })
    expect(await screen.findByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(screen.getByText(UNUSABLE.detail)).toBeTruthy()
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

describe('Phase 8: the full look spec 7.5 templates', () => {
  it('EQ draws the performance-difference pane under the equity and names its unit', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    await screen.findByText('nt_za_v0_fixture_a equity')
    const stack = chartsOf('linestack').find((c) => c.props.title === 'nt_za_v0_fixture_a equity')!.props as { panes: Array<{ id: string }> }
    expect(stack.panes.map((p) => p.id)).toEqual(['equity', 'perfDiff'])
    expect(screen.getByText(/Lower pane: performance difference, fraction of K, strategy minus benchmark cumulative return \(compounded\)/)).toBeTruthy()
  })

  it('RET passes the per-period series to the histogram; RR states the volatility extremes', async () => {
    show('RET', RUN)
    await screen.findByText('nt_volmanaged_v0_fixture_m1 return distribution')
    const dist = chartsOf('distribution').at(-1)!.props as { data: { series?: { t: unknown } } }
    expect(dist.data.series?.t).toEqual(RUN_ANALYTICS.distribution.series.t)
    cleanup()
    show('RR', RUN)
    const list = await screen.findByRole('list', { name: 'Rolling volatility extremes' })
    expect(within(list).getByText('63 sessions: no rolling value.')).toBeTruthy()
  })

  it('98) Export saves the open tab as CSV with no request', async () => {
    show('EQ', RUN)
    await screen.findByText('nt_volmanaged_v0_fixture_m1 equity')
    const before = fetchSpy.mock.calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('nt_volmanaged_v0_fixture_m1_EQ.csv')).split('\r\n')
      expect(lines[0]).toBe('date,equity,bench,perf_diff')
      expect(lines).toHaveLength(RUN_ANALYTICS.equity.t.length + 1)
      expect(fetchSpy.mock.calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })
})

describe('TA6: real fill slippage beside its own strategy only', () => {
  it('a za_orb run shows the quote-check rows under a caption naming the sample', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const table = await screen.findByRole('table', { name: /za_orb quote-check sample/ })
    expect(within(table).getByText('entry')).toBeTruthy()
    expect(within(table).queryByText('live close')).toBeNull()
  })

  it('a volmanaged run shows the paper book close rows only', async () => {
    show('EQ', RUN)
    const table = await screen.findByRole('table', { name: /paper book close rows/ })
    expect(within(table).getByText('live close')).toBeTruthy()
    expect(within(table).queryByText('entry')).toBeNull()
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

  it('RET draws the SV7 Sharpe difference ladder from the analytics response, with no request of its own', async () => {
    show('RET', HYP)
    await screen.findByText('volmanaged_v0 return distribution')
    const sv7 = chartsOf('barladder').map((c) => c.props.data as { name: string; bars: Array<{ label: string; value: number | null }> })
      .find((d) => d.name.includes('Sharpe difference (m - BH)'))!
    expect(sv7.name).toBe('volmanaged_v0 Sharpe difference (m - BH) by cost, Ledoit-Wolf, annualised')
    expect(sv7.bars.map((b) => [b.label, b.value])).toEqual([['1 tick', -0.0032012791246315434], ['2 ticks', -0.006124067750212914]])
    expect(screen.getByRole('group', { name: 'Sharpe difference tests' })).toBeTruthy()
    expect(urls().filter((u) => !u.startsWith('/api/analytics/hypothesis/volmanaged_v0/extended'))).toEqual([
      '/api/hypotheses/volmanaged_v0', '/api/analytics/hypothesis/volmanaged_v0?cost=1',
    ])
  })
})

describe('SV7 on the tear sheet of a run', () => {
  it('RET says the Sharpe difference tests are not recorded and draws no ladder for them', async () => {
    show('RET', RUN)
    await screen.findByText('nt_volmanaged_v0_fixture_m1 return distribution')
    expect(screen.getByText('Sharpe difference (m - BH): not recorded for this series.')).toBeTruthy()
    expect(chartsOf('barladder').some((c) => (c.props.data as { name: string }).name.includes('Sharpe difference'))).toBe(false)
  })
})

// Roadmap 12, part B: EQ and DD draw the market context from /extended, the body RET and RR already read.
const extendedCalls = (re: RegExp = /\/extended\?/) => urls().filter((u) => re.test(u))
// The tab's own stack (a run's books draw LineStacks of their own below it).
const lastStack = () => {
  const own = chartsOf('linestack').filter((c) => / (equity|drawdown)$/.test(String(c.props.title)))
  return own.at(-1)!.props as { spans?: unknown[]; ribbon?: { values: unknown[] } }
}

describe('market context on EQ and DD (roadmap 12, part B)', () => {
  for (const code of ['EQ', 'DD'] as const) {
    it(`${code} of a hypothesis adds one /extended GET, and hands the chart the five windows and the strip`, async () => {
      show(code, HYP)
      await screen.findByText(code === 'EQ' ? 'volmanaged_v0 equity' : 'volmanaged_v0 drawdown')
      await waitFor(() => expect(lastStack().spans).toHaveLength(5))
      expect(lastStack().ribbon!.values).toHaveLength(HYP_ANALYTICS.equity.t.length)
      expect(extendedCalls()).toEqual(['/api/analytics/hypothesis/volmanaged_v0/extended?cost=1'])
      expect(screen.getByText(/^0 of 5 frozen stress windows/)).toBeTruthy()
      expect(screen.getByText(/; 0 of 39 sessions labelled\./)).toBeTruthy()
      for (const call of fetchSpy.mock.calls) expect((call[1] as RequestInit).method).toBe('GET')
    })

    it(`${code} of a run adds one /extended GET at the run's Freq`, async () => {
      show(code, RUN)
      await waitFor(() => expect(extendedCalls()).toEqual(['/api/analytics/run/nt_volmanaged_v0_fixture_m1/extended?freq=D']))
      await waitFor(() => expect(lastStack().spans).toHaveLength(5))
      for (const call of fetchSpy.mock.calls) expect((call[1] as RequestInit).method).toBe('GET')
    })

    it(`${code} draws its chart before /extended answers, and says the context is loading`, async () => {
      const held = new Promise<Response>(() => {})
      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (/\/extended\?/.test(url)) return held
        const hit = ROUTES.find(([re]) => re.test(url))
        return hit ? hit[1]() : json({ detail: `no route ${url}` }, 404)
      })
      show(code, HYP)
      await screen.findByText(code === 'EQ' ? 'volmanaged_v0 equity' : 'volmanaged_v0 drawdown')
      expect(await screen.findByText('Market context loading.')).toBeTruthy()
      expect(lastStack().spans).toBeUndefined()
    })

    it(`${code} says the context is unavailable when /extended fails, keeps the chart, and raises no alert`, async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (/\/extended\?/.test(url)) return json({ detail: 'extended analytics are down' }, 500)
        const hit = ROUTES.find(([re]) => re.test(url))
        return hit ? hit[1]() : json({ detail: `no route ${url}` }, 404)
      })
      show(code, HYP)
      const note = await screen.findByText('Market context unavailable: extended analytics are down', {}, SOON)
      expect(note.getAttribute('role')).toBe('status')
      expect(chartsOf('linestack').length).toBeGreaterThan(0)
      expect(lastStack().spans).toBeUndefined()
      expect(screen.queryAllByRole('alert').filter((a) => /Market context/.test(a.textContent ?? ''))).toEqual([])
    })
  }

  it('shares one /extended GET with RET and with RR, and MRET asks none', async () => {
    show('RET', HYP)
    await screen.findByText('volmanaged_v0 return distribution')
    await screen.findByRole('heading', { name: /Stress windows \(RK5\)/ })
    expect(extendedCalls()).toHaveLength(1)
    cleanup()
    fetchSpy.mockClear()
    show('RR', HYP)
    await screen.findByRole('heading', { name: /Volatility regimes \(RG1\)/ })
    expect(extendedCalls()).toHaveLength(1)
    cleanup()
    fetchSpy.mockClear()
    show('MRET', HYP)
    await screen.findByText('volmanaged_v0 monthly returns')
    expect(extendedCalls()).toHaveLength(0)
    for (const call of fetchSpy.mock.calls) expect((call[1] as RequestInit).method).toBe('GET')
  })

  it('asks one /extended GET when the tab moves from EQ to RET on the same series (one key)', async () => {
    const client = createApiQueryClient()
    const params = (code: MnemonicCode) => ({ code, context: HYP, args: {}, group: 'B' as const })
    const view = (code: MnemonicCode) => (
      <QueryClientProvider client={client}><TearSheet params={params(code)} context={HYP} /></QueryClientProvider>
    )
    const { rerender } = render(view('EQ'))
    await waitFor(() => expect(lastStack().spans).toHaveLength(5))
    rerender(view('RET'))
    await screen.findByText('volmanaged_v0 return distribution')
    await screen.findByRole('heading', { name: /Stress windows \(RK5\)/ })
    expect(extendedCalls()).toHaveLength(1)
  })

  it('never asks /extended for a run whose balance check failed, or before the analytics answer', async () => {
    show('EQ', { kind: 'run', value: 'nt_za_v0_fixture_unbalanced' })
    expect(await screen.findByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(extendedCalls()).toEqual([])
    cleanup()
    show('DD', { kind: 'run', value: 'nt_za_v0_fixture_negative' })
    expect(await screen.findByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(extendedCalls()).toEqual([])
  })

  it('asks no /extended for a check row or a card with no series', async () => {
    show('EQ', { kind: 'hypothesis', value: 'noseries_v0' })
    await screen.findByText('No return series is recorded for noseries_v0, so there is nothing to draw.', {}, SOON)
    expect(extendedCalls()).toEqual([])
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

// Real-data smoke run: EQ on the registry's check row stayed on "Loading the tear sheet." for over
// 60 s. Every tab must reach a visible state within seconds: an empty state for a row with no return
// series (a check names its parent and links to its tear sheet), a refusal for any 4xx.
const SOON = { timeout: 3000 }
const CHECK: ResolvedContext = { kind: 'hypothesis', value: 'za_v0_C3_gao_momentum' }
const asked = (re: RegExp) => urls().filter((u) => re.test(u)).length

function expectSettled(): void {
  expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  expect(screen.queryByText('Loading the tear sheet.')).toBeNull()
}

describe('a row with no return series, and 4xx answers: never an endless load', () => {
  for (const code of TEAR_CODES) {
    it(`${code} of a check row says it has no series and links to its parent's tear sheet`, async () => {
      const spy = vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
      try {
        show(code, CHECK)
        const note = await screen.findByText('No return series: this row is a check inside za_v0.', {}, SOON)
        expect(note.closest('[role="status"]')).not.toBeNull()
        expectSettled()
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByText("Open za_v0's tear sheet:")).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: `za_v0 ${code} <GO>` }))
        expect(spy).toHaveBeenCalledWith(`za_v0 ${code}`, false)
        expect(asked(/\/api\/analytics\//)).toBe(0)
      } finally {
        spy.mockRestore()
      }
    })
  }

  it('a registered row with no recorded series says so, with no link and no analytics request', async () => {
    show('EQ', { kind: 'hypothesis', value: 'noseries_v0' })
    const note = await screen.findByText('No return series is recorded for noseries_v0, so there is nothing to draw.', {}, SOON)
    expect(note.closest('[role="status"]')).not.toBeNull()
    expectSettled()
    expect(screen.queryByRole('button', { name: /<GO>/ })).toBeNull()
    expect(asked(/\/api\/analytics\//)).toBe(0)
  })

  it('a 404 on the hypothesis card is a refusal, asked once', async () => {
    show('DD', { kind: 'hypothesis', value: 'unknown_v0' })
    expect((await screen.findByRole('alert', {}, SOON)).textContent).toContain('The server refused this tear sheet')
    expectSettled()
    expect(asked(/^\/api\/hypotheses\/unknown_v0$/)).toBe(1)
  })

  it('a 404 on the hypothesis analytics is a refusal, asked once', async () => {
    show('RET', { kind: 'hypothesis', value: 'gone_v0' })
    expect((await screen.findByRole('alert', {}, SOON)).textContent).toContain('no route /api/analytics/hypothesis/gone_v0?cost=1')
    expectSettled()
    expect(asked(/^\/api\/analytics\/hypothesis\/gone_v0\?/)).toBe(1)
  })

  it('a 404 on the run record is a refusal, and the analytics route is not asked', async () => {
    show('RR', { kind: 'run', value: 'unknown_run' })
    expect((await screen.findByRole('alert', {}, SOON)).textContent).toContain('The server refused this tear sheet')
    expectSettled()
    expect(asked(/^\/api\/runs\/unknown_run$/)).toBe(1)
    expect(asked(/\/api\/analytics\//)).toBe(0)
  })

  it('a 404 on each run book shows in its own card, asked once each', async () => {
    show('MRET', { kind: 'run', value: 'books_gone_run' })
    await waitFor(() => expect(screen.getAllByText(/^Could not read this panel:/)).toHaveLength(3), SOON)
    expectSettled()
    for (const book of ['trades', 'costs', 'exposure']) expect(asked(new RegExp(`/books_gone_run/${book}$`))).toBe(1)
  })
})
