// @vitest-environment jsdom
// The P1 views on the tear sheet (TASKS Phase 10 on screen): what each tab asks for and shows, from real
// fixture-backend responses (tearP1.fixtures.ts). Charts are stand-ins that record their inputs.
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiQueryClient } from '../../api/queries'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import type { MnemonicCode } from '../../commands/registry'
import type { ResolvedContext } from '../../commands/types'
import { RCT } from '../../copy/regimesCapacityTerm'
import { RISK_EXTRAS } from '../../copy/riskExtras'
import { TEAR_P1 } from '../../copy/tearP1'
import { TRADE_PATHS as T } from '../../copy/tradePaths'
import { BOOK_TRADES, RUN_ANALYTICS, RUN_COSTS, RUN_EXPOSURE, RUN_TRADES, SMOKE_ANALYTICS } from './tear.fixtures'
import { EXCURSIONS, EXCURSIONS_DAILY, EXCURSIONS_ON_BASIS, HYP_ANALYTICS, HYP_BOOTSTRAP, HYP_EXTENDED, TRADE_PATHS } from './tearP1.fixtures'
import { RUN_CAPACITY, TREND_VIEW } from '../p2rct/p2rct.fixtures'
import { HYP_RISK_EXTRAS, RUN_RISK_EXTRAS } from '../riskextras/riskExtras.fixtures'
import { formatNumber } from './tearFormat'
import TearSheet from './TearSheet'

const seen = vi.hoisted(() => ({ charts: [] as Array<{ kind: string; props: Record<string, unknown> }> }))

function stand(kind: string) {
  return (props: { data?: { name: string }; title?: string }) => {
    seen.charts.push({ kind, props: props as Record<string, unknown> })
    return <div data-chart={kind}>{props.data?.name ?? props.title}</div>
  }
}

vi.mock('../../charts/LineStack', () => ({ default: stand('linestack') }))
vi.mock('../../charts/echarts/Heatmap', () => ({ Heatmap: stand('heatmap') }))
vi.mock('../../charts/echarts/Distribution', () => ({ Distribution: stand('distribution') }))
vi.mock('../../charts/echarts/BarLadder', () => ({ BarLadder: stand('barladder') }))
vi.mock('../../charts/echarts/XyScatter', () => ({ XyScatter: stand('xyscatter') }))
vi.mock('../../charts/echarts/Cone', () => ({ Cone: stand('cone') }))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A run whose rolling Sharpe has values and whose length allows a bootstrap (the fixture series are shorter). */
const ROLLING = { ...SMOKE_ANALYTICS, n: 40, rolling: { ...SMOKE_ANALYTICS.rolling, sharpe_short: SMOKE_ANALYTICS.rolling.t.map(() => 0.5) } }

let calls: string[] = []
let bootstrapStatus = 200
let excursions: typeof EXCURSIONS = EXCURSIONS_ON_BASIS

const ROUTES: ReadonlyArray<readonly [RegExp, () => Response]> = [
  [/^\/api\/hypotheses\/volmanaged_v0$/, () => json({ card: { name: 'volmanaged_v0', series_costs: [0, 1, 2] } })],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\/extended\?cost=1$/, () => json(HYP_EXTENDED)],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\/risk-extras\?cost=1$/, () => json(HYP_RISK_EXTRAS)],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\/trend-regime\?cost=1$/, () => json(TREND_VIEW)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/risk-extras\?freq=D$/, () => json(RUN_RISK_EXTRAS)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/trend-regime$/, () => json(TREND_VIEW)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/capacity$/, () => json(RUN_CAPACITY)],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\/bootstrap\?cost=1$/, () => (bootstrapStatus === 200 ? json(HYP_BOOTSTRAP) : json({ detail: 'no bootstrap for this series: a block length needs at least 30 observations, got 10' }, bootstrapStatus))],
  [/^\/api\/analytics\/hypothesis\/volmanaged_v0\?cost=1$/, () => json(HYP_ANALYTICS)],
  [/^\/api\/runs\/nt_za_v0_fixture_a$/, () => json({ summary: { strategy: 'za_orb', balance_ok: true } })],
  [/^\/api\/runs\/nt_volmanaged_v0_fixture_m1$/, () => json({ summary: { strategy: 'volmanaged', balance_ok: true } })],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/trades$/, () => json(RUN_TRADES)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/costs$/, () => json(RUN_COSTS)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/exposure$/, () => json(RUN_EXPOSURE)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/excursions$/, () => json(excursions)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/trade-paths$/, () => json(TRADE_PATHS)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\?freq=D$/, () => json(ROLLING)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/bootstrap\?freq=D$/, () => json(HYP_BOOTSTRAP)],
  [/^\/api\/analytics\/run\/nt_za_v0_fixture_a\/extended\?freq=D$/, () => json(HYP_EXTENDED)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/trades$/, () => json(BOOK_TRADES)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/costs$/, () => json(RUN_COSTS)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/exposure$/, () => json(RUN_EXPOSURE)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/excursions$/, () => json(EXCURSIONS_DAILY)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\/trade-paths$/, () => json(TRADE_PATHS)],
  [/^\/api\/analytics\/run\/nt_volmanaged_v0_fixture_m1\?freq=D$/, () => json(RUN_ANALYTICS)],
]

beforeEach(() => {
  calls = []
  bootstrapStatus = 200
  excursions = EXCURSIONS_ON_BASIS
  seen.charts = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    expect(init?.method ?? 'GET').toBe('GET')
    calls.push(url)
    const hit = ROUTES.find(([re]) => re.test(url))
    return hit ? hit[1]() : json({ detail: `not in this test: ${url}` }, 404)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const ACTIONS: PanelActions = { panelId: 'p1-test', related: () => false, back: () => false, forward: () => false, open: () => false }

function mount(code: MnemonicCode, context: ResolvedContext) {
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <PanelActionsContext value={ACTIONS}>{node}</PanelActionsContext>
    </QueryClientProvider>
  )
  return render(wrap(<TearSheet params={{ code, context: null, args: {}, group: '-' }} context={context} />))
}

const hyp: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }
const section = () => screen.findByRole('region', { name: `Extended analytics for ${hyp.value}` })
/** A heading whose accessible name starts with `title` (the card's tag follows it in the same heading). */
const titled = (title: string) => (name: string) => name.startsWith(title)
const chartsOf = (kind: string) => seen.charts.filter((c) => c.kind === kind)

describe('EQ: SV5 intervals and the SV6 cone', () => {
  it('lists the bootstrap intervals with the method, block length, replications and seed, and draws the cone', async () => {
    mount('EQ', hyp)
    const p1 = await section()
    await waitFor(() => expect(p1.textContent).toContain('Block length 1.04'))
    expect(p1.textContent).toContain('10,000 replications, seed 20260927')
    const table = within(p1).getAllByRole('table')[0]!
    expect(within(table).getByRole('rowheader', { name: 'Sharpe' }).closest('tr')!.textContent).toContain('-8.67 to +1.26')
    expect(within(p1).getAllByText('[POST HOC]').length).toBeGreaterThan(0)
    await waitFor(() => expect(chartsOf('cone')).not.toHaveLength(0))
    const cone = chartsOf('cone').at(-1)!.props.data as { label: string; steps: number[] }
    expect(cone.label).toBe('resampled history, not a forecast; pointwise percentiles at each horizon, not a band that whole paths stay inside')
    expect(cone.steps).toHaveLength(39)
    // The percentiles are pointwise, and the card says so in words, not only in the chart's accessible name.
    expect(p1.textContent).toContain('Pointwise percentiles 5, 25, 50, 75 and 95 at each step, not a band that whole paths stay inside')
    await waitFor(() => expect(calls.filter((u) => u.includes('/extended'))).toEqual(['/api/analytics/hypothesis/volmanaged_v0/extended?cost=1']))
  })

  it('shows a refusal the API sends', async () => {
    bootstrapStatus = 422
    mount('EQ', hyp)
    const p1 = await section()
    await waitFor(() => expect(within(p1).getByRole('alert').textContent).toContain('a block length needs at least 30 observations'))
  })

  it('born failing: never asks for a bootstrap of a series shorter than the minimum (the API would refuse it)', async () => {
    mount('EQ', { kind: 'run', value: 'nt_volmanaged_v0_fixture_m1' })
    await waitFor(() => expect(screen.getByText('No bootstrap: the block length needs at least 30 observations and this series has 10.')).toBeTruthy())
    expect(calls.some((u) => u.includes('/bootstrap'))).toBe(false)
  })
})

describe('RET: ratios, Cornish-Fisher VaR, normality and the stress panel', () => {
  it('shows PF7 to PF9, RK3 not defined outside its domain (historical VaR beside it, normal greyed), Jarque-Bera on the whole series and the QQ plot', async () => {
    mount('RET', hyp)
    const p1 = await section()
    await waitFor(() => expect(p1.textContent).toContain('Omega (0)'))
    expect(p1.textContent).toContain('Gain to pain (monthly)')
    const cf = within(p1).getByRole('table', { name: /Normal and Cornish-Fisher VaR by level/ })
    const r95 = within(cf).getByRole('rowheader', { name: '95%' }).closest('tr')!
    expect(r95.textContent).toContain(TEAR_P1.cf.usedHistorical)
    expect(r95.textContent).toContain(TEAR_P1.cf.notDefined)
    expect(r95.querySelector('td.muted')).not.toBeNull()
    const jb = within(p1).getByRole('table', { name: TEAR_P1.jb.caption })
    expect(jb.textContent).toContain('0.5354')
    expect(chartsOf('xyscatter').some((c) => (c.props.data as { name: string }).name === 'volmanaged_v0 QQ plot')).toBe(true)
    expect(calls.some((u) => u.includes('/bootstrap'))).toBe(false)
  })

  it('shows the frozen stress windows as their own panel, with the note on the missing spent row and no p-value', async () => {
    mount('RET', hyp)
    const p1 = await section()
    const stress = await within(p1).findByRole('table', { name: TEAR_P1.stress.caption })
    expect(within(stress).getAllByRole('row')).toHaveLength(1 + HYP_EXTENDED.stress.rows.length)
    expect(stress.textContent).toContain('2020-02-19 to 2020-03-20')
    expect(p1.textContent).toContain(HYP_EXTENDED.stress.spent_note!)
    expect(stress.textContent).not.toMatch(/\bp\b/)
    expect(within(p1).getByRole('region', { name: TEAR_P1.stress.caption })).toBeTruthy()
  })
})

describe('RET and RR: the P2 cards (RK4, PF11, BR5, RG2)', () => {
  it('RET adds the ulcer index and recovery factor card and the modified expected shortfall card, from the risk-extras read', async () => {
    mount('RET', hyp)
    const p1 = await section()
    expect(await within(p1).findByRole('heading', { name: titled(RISK_EXTRAS.es.title) })).toBeTruthy()
    expect(within(p1).getByRole('heading', { name: titled(RISK_EXTRAS.drawdown.title) })).toBeTruthy()
    expect(within(p1).queryByRole('heading', { name: titled(RISK_EXTRAS.treynor.title) })).toBeNull()
    expect(calls).toContain('/api/analytics/hypothesis/volmanaged_v0/risk-extras?cost=1')
  })

  it('RR adds the Treynor ratio card and the trend regime card, each from its own read; RET never asks for the trend regime', async () => {
    mount('RR', hyp)
    const p1 = await section()
    expect(await within(p1).findByRole('heading', { name: titled(RISK_EXTRAS.treynor.title) })).toBeTruthy()
    expect(await within(p1).findByRole('heading', { name: titled(RCT.trend.title) })).toBeTruthy()
    expect(calls).toContain('/api/analytics/hypothesis/volmanaged_v0/trend-regime?cost=1')
    cleanup()
    calls = []
    mount('RET', hyp)
    await section()
    await waitFor(() => expect(calls.some((u) => u.includes('/risk-extras'))).toBe(true))
    expect(calls.some((u) => u.includes('trend-regime'))).toBe(false)
  })

  it('a run asks for its own risk extras at its freq and for the trend regime at the daily frequency only', async () => {
    mount('RR', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    await waitFor(() => expect(calls).toContain('/api/analytics/run/nt_za_v0_fixture_a/trend-regime'))
    expect(calls).toContain('/api/analytics/run/nt_za_v0_fixture_a/risk-extras?freq=D')
  })

  it('a refused risk-extras read is an alert inside the card, and the P1 cards beside it still draw', async () => {
    const real = ROUTES.findIndex(([re]) => re.test('/api/analytics/hypothesis/volmanaged_v0/risk-extras?cost=1'))
    const original = ROUTES[real]!
    ;(ROUTES as Array<readonly [RegExp, () => Response]>)[real] = [original[0], () => json({ detail: 'refused here' }, 422)]
    try {
      mount('RET', hyp)
      const p1 = await section()
      await waitFor(() => expect(within(p1).getAllByRole('alert').some((a) => (a.textContent ?? '').includes('refused here'))).toBe(true))
      expect(p1.textContent).toContain('Omega (0)')
    } finally {
      ;(ROUTES as Array<readonly [RegExp, () => Response]>)[real] = original
    }
  })
})

describe("EX5: the capacity card closes a run's books", () => {
  it('asks for the capacity of a run once its sheet answered, and names the card in the books grid', async () => {
    mount('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const heading = await screen.findByRole('heading', { name: titled(RCT.capacity.title) })
    expect(heading.closest('.tear-books-grid')).not.toBeNull()
    expect(calls).toContain('/api/analytics/run/nt_za_v0_fixture_a/capacity')
  })

  it('a hypothesis has no run books, so it never asks for a capacity', async () => {
    mount('EQ', hyp)
    await section()
    expect(calls.some((u) => u.includes('/capacity'))).toBe(false)
  })
})

describe('RR: relative views and the bootstrap band', () => {
  it('draws rolling beta and correlation, capture, the scatter with BR1 line and the regimes with Welch t and no p-value', async () => {
    mount('RR', hyp)
    const p1 = await section()
    await waitFor(() => expect(p1.textContent).toContain('Full sample: beta 1.004, correlation 1.000.'))
    const capture = within(p1).getByRole('table', { name: TEAR_P1.capture.caption })
    expect(capture.textContent).toContain('0.991')
    const scatter = chartsOf('xyscatter').at(-1)!.props.data as { name: string; line: { label: string } }
    expect(scatter.name).toBe('volmanaged_v0 against its benchmark')
    expect(scatter.line.label).toBe('OLS (BR1)')
    expect(p1.textContent).toContain(TEAR_P1.regimes.noP)
    expect(p1.textContent).not.toMatch(/p-value [0-9]/)
  })

  it("draws each window's RL1 range on the rolling Sharpe pane and says so, without asking for the bootstrap", async () => {
    mount('RR', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const band = ROLLING.rolling.sharpe_bands[0]!
    const words = `a 63-session Sharpe, ${formatNumber(band.lo!, 2)} to ${formatNumber(band.hi!, 2)}, if the full-sample Sharpe`
    await waitFor(() => expect(screen.getByText((text) => text.startsWith(`Dashed amber lines: the range (95%) of ${words}`))).toBeTruthy())
    const rr = chartsOf('linestack').filter((c) => String(c.props.title).includes('rolling statistics')).at(-1)!
    const sharpe = (rr.props.panes as Array<{ id: string; series: Array<{ style: string }> }>).find((p) => p.id === 'sharpe')!
    expect(sharpe.series.map((s) => s.style)).toEqual(['rollShort', 'rollLong', 'ciBound', 'ciBound'])
    expect(calls.some((u) => u.includes('/bootstrap'))).toBe(false)
  })

  it('draws no band note where the series is shorter than the rolling window (no lines are drawn)', async () => {
    mount('RR', hyp)
    const p1 = await section()
    await waitFor(() => expect(p1.textContent).toContain('Full sample: beta'))
    expect(screen.queryByText(/Dashed amber lines/)).toBeNull()
  })
})

describe('DD and MRET have no P1 view', () => {
  it('asks only for the market context on DD and draws no P1 view', async () => {
    mount('DD', hyp)
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/analytics/hypothesis/volmanaged_v0?'))).toBe(true))
    await waitFor(() => expect(calls.filter((u) => u.includes('/extended'))).toEqual(['/api/analytics/hypothesis/volmanaged_v0/extended?cost=1']))
    expect(screen.queryByRole('region', { name: `Extended analytics for ${hyp.value}` })).toBeNull()
    expect(calls.some((u) => u.includes('/bootstrap'))).toBe(false)
  })
})

describe('trade paths on a run (TA2, TA4, TA5)', () => {
  it('scatters MAE and MFE in R, bins the holding times and gives the streaks with the runs test on the whole list', async () => {
    mount('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const card = (await screen.findByText(T.title)).closest('.tear-card') as HTMLElement
    await waitFor(() => expect(card.textContent).toContain('Runs test p (whole list)'))
    expect(card.textContent).toContain('0.0679')
    const names = chartsOf('xyscatter').map((c) => (c.props.data as { name: string }).name)
    expect(names).toEqual(expect.arrayContaining(['nt_za_v0_fixture_a MAE against the final result', 'nt_za_v0_fixture_a MFE against the final result']))
    expect(chartsOf('barladder').some((c) => (c.props.data as { name: string }).name === 'nt_za_v0_fixture_a holding time')).toBe(true)
  })

  it('says why the bars are refused when they sit on another price basis than the fills', async () => {
    excursions = EXCURSIONS
    mount('EQ', { kind: 'run', value: 'nt_za_v0_fixture_a' })
    const card = (await screen.findByText(T.title)).closest('.tear-card') as HTMLElement
    await waitFor(() => expect(card.textContent).toContain(EXCURSIONS.note!))
    expect(chartsOf('xyscatter')).toHaveLength(0)
  })

  it('says why a daily run has no MAE and MFE', async () => {
    mount('EQ', { kind: 'run', value: 'nt_volmanaged_v0_fixture_m1' })
    const card = (await screen.findByText(T.title)).closest('.tear-card') as HTMLElement
    await waitFor(() => expect(card.textContent).toContain(EXCURSIONS_DAILY.note!))
  })
})
