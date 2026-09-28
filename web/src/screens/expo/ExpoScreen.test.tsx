// @vitest-environment jsdom
// D20 regression: run honesty tags ([PROBE: never a result], [ANCHOR]) must travel with the run onto
// EXPO, the same as RUN and RUNS (runs/model.ts runTags, UI_SPEC section 6). EXPO already shows
// [POST HOC]; a probe or anchor run must show its own tag as well.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import { DETAIL_DTSMOM } from '../runs/runs.fixtures'
import { RUN_EXPOSURE } from '../tear/tear.fixtures'
import ExpoScreen from './ExpoScreen'

vi.mock('../../charts/LineStack', () => ({
  default: () => <div data-testid="linestack" />,
}))

const NO_EXPOSURE = { run_id: 'r1', tag: '[POST HOC]', available: false, note: 'this run has no mark to market snapshots (an intraday run), so it has no exposure or turnover', exposure: null, turnover: null }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function summaryFor(overrides: Partial<typeof DETAIL_DTSMOM.summary>): typeof DETAIL_DTSMOM {
  return { ...DETAIL_DTSMOM, summary: { ...DETAIL_DTSMOM.summary, run_id: 'r1', ...overrides } }
}

let runDetail: unknown = summaryFor({})

const R2_EXPOSURE = { ...RUN_EXPOSURE, run_id: 'r2' }

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  if (path === '/api/analytics/run/r1/exposure') return json(NO_EXPOSURE)
  if (path === '/api/analytics/run/r2/exposure') return json(R2_EXPOSURE)
  if (path === '/api/runs/r1') return json(runDetail)
  if (path === '/api/runs/r2') return json(summaryFor({ run_id: 'r2' }))
  return json({ detail: 'not in this test' }, 404)
}

beforeEach(() => {
  runDetail = summaryFor({})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => route(new URL(String(input), 'http://127.0.0.1')))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show(context: ResolvedContext | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const params: PanelParams = { code: 'EXPO', context, args: {}, group: '-' }
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={vi.fn(() => () => {})}>{node}</NumberingContext>
    </ApiProvider>
  )
  return render(wrap(<ExpoScreen params={params} context={context} />))
}

describe('EXPO honesty tags (D20)', () => {
  it('shows [PROBE: never a result] next to [POST HOC] on a probe run', async () => {
    runDetail = summaryFor({ is_probe: true })
    show({ kind: 'run', value: 'r1' })
    const heading = await screen.findByRole('heading', { level: 3, name: 'r1' })
    const head = within(heading.parentElement as HTMLElement)
    expect(head.getByText('[POST HOC]')).toBeTruthy()
    expect(head.getByText('[PROBE: never a result]')).toBeTruthy()
  })

  it('shows [ANCHOR] on an anchor run', async () => {
    runDetail = summaryFor({ is_anchor: true, anchor_of: 'base_run' })
    show({ kind: 'run', value: 'r1' })
    const heading = await screen.findByRole('heading', { level: 3, name: 'r1' })
    expect(within(heading.parentElement as HTMLElement).getByText('[ANCHOR]')).toBeTruthy()
  })
})

describe('EXPO exposure card precision (D23)', () => {
  it('shows the same means at the same precision as the summary table, not rounded to 2 decimals', async () => {
    show({ kind: 'run', value: 'r2' })
    await screen.findByTestId('expo-summary')
    // The summary rows print the API's means at 2 significant figures below 1 (expoModel.sig): the
    // exposure card beside them must show the same text, not formatNumber(v, 2).
    const summary = screen.getByTestId('expo-summary')
    expect(summary.textContent).toContain('0.082')
    expect(summary.textContent).toContain('0.023')
    // "Mean gross exposure" (row label) versus "Mean gross {value}" (the card's own means paragraph).
    const card = screen.getByText(/^Mean gross \d/).closest('.nqt-card') as HTMLElement
    expect(within(card).getByText(/0\.082/)).toBeTruthy()
    expect(within(card).getByText(/0\.023/)).toBeTruthy()
    expect(card.textContent).not.toMatch(/\b0\.08\b/)
    expect(card.textContent).not.toMatch(/\b0\.02\b/)
  })
})
