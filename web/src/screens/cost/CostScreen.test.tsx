// @vitest-environment jsdom
// D20 regression: run honesty tags ([PROBE: never a result], [ANCHOR]) must travel with the run onto
// COST, the same as RUN and RUNS (runs/model.ts runTags, UI_SPEC section 6). A probe or anchor run
// served to COST must carry its tag next to the run name.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import { DETAIL_DTSMOM } from '../runs/runs.fixtures'
import CostScreen from './CostScreen'

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: () => <div data-testid="ladder" />,
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const COSTS = {
  run_id: 'r1', tag: '[POST HOC]',
  waterfall: {
    run_id: 'r1', unit: 'USD', label: 'Commissions are the fee per contract side.', ticks: 1, sides: 2, gross: 100, commissions: 5, slippage: 2, net: 93, costs_total: 7,
    rows: [{ step: 'gross', value: 100 }, { step: 'net', value: 93 }],
    by_instrument: [],
  },
  sensitivity: { run_id: 'r1', unit: 'USD', label: 'Net P&L at each cost.', ticks: [0, 1, 2], net_usd: [95, 93, 91], net_pct_of_k: [0.0009, 0.0009, 0.0009], run_ticks: 1, cost_per_tick_usd: 2, break_even_ticks_per_side: 50 },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function summaryFor(overrides: Partial<typeof DETAIL_DTSMOM.summary>): typeof DETAIL_DTSMOM {
  return { ...DETAIL_DTSMOM, summary: { ...DETAIL_DTSMOM.summary, run_id: 'r1', ...overrides } }
}

let runDetail: unknown = summaryFor({})

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  if (path === '/api/analytics/run/r1/costs') return json(COSTS)
  if (path === '/api/runs/r1') return json(runDetail)
  return json({ detail: 'not in this test' }, 404)
}

beforeEach(() => {
  runDetail = summaryFor({})
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => route(new URL(String(input), 'http://127.0.0.1')))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show(context: ResolvedContext | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const params: PanelParams = { code: 'COST', context, args: {}, group: '-' }
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={vi.fn(() => () => {})}>{node}</NumberingContext>
    </ApiProvider>
  )
  return render(wrap(<CostScreen params={params} context={context} />))
}

describe('COST honesty tags (D20)', () => {
  it('shows [PROBE: never a result] next to the run name on a probe run', async () => {
    runDetail = summaryFor({ is_probe: true })
    show({ kind: 'run', value: 'r1' })
    await screen.findByRole('heading', { level: 3, name: 'r1' })
    expect(screen.getByText('[PROBE: never a result]')).toBeTruthy()
  })

  it('shows [ANCHOR] next to the run name on an anchor run', async () => {
    runDetail = summaryFor({ is_anchor: true, anchor_of: 'base_run' })
    show({ kind: 'run', value: 'r1' })
    await screen.findByRole('heading', { level: 3, name: 'r1' })
    expect(screen.getByText('[ANCHOR]')).toBeTruthy()
  })

  it('shows no honesty tag on a plain usable run', async () => {
    show({ kind: 'run', value: 'r1' })
    await screen.findByRole('heading', { level: 3, name: 'r1' })
    expect(screen.queryByText('[PROBE: never a result]')).toBeNull()
    expect(screen.queryByText('[ANCHOR]')).toBeNull()
  })
})
