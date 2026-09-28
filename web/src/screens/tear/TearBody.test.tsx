// @vitest-environment jsdom
// D20 regression: run honesty tags ([PROBE: never a result], [ANCHOR]) must travel onto the tear
// sheet header, the same as RUN and RUNS (runs/model.ts runTags, UI_SPEC section 6). TearBody already
// shows tearTags(data) (the analytics [POST HOC] tag); a probe or anchor run must show its own tag too.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { BOOK_TRADES, RUN_ANALYTICS, RUN_COSTS, RUN_EXPOSURE } from './tear.fixtures'
import TearBody from './TearBody'
import type { TearTarget } from './tearQueries'

vi.mock('../../charts/LineStack', () => ({ default: () => <div data-testid="linestack" /> }))
vi.mock('../../charts/echarts/Heatmap', () => ({ Heatmap: () => <div data-testid="heatmap" /> }))
vi.mock('../../charts/echarts/Distribution', () => ({ Distribution: () => <div data-testid="distribution" /> }))
vi.mock('../../charts/echarts/BarLadder', () => ({ BarLadder: () => <div data-testid="barladder" /> }))

const RUN_ID = 'nt_volmanaged_v0_fixture_m1'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function summaryFor(overrides: Record<string, unknown>): unknown {
  return { summary: { strategy: 'volmanaged', is_probe: false, is_anchor: false, balance_ok: true, ...overrides } }
}

let runDetail: unknown = summaryFor({})

function route(url: URL): Response {
  const path = decodeURIComponent(url.pathname)
  if (path === `/api/runs/${RUN_ID}`) return json(runDetail)
  if (path === `/api/analytics/run/${RUN_ID}`) return json(RUN_ANALYTICS)
  if (path === `/api/analytics/run/${RUN_ID}/trades`) return json(BOOK_TRADES)
  if (path === `/api/analytics/run/${RUN_ID}/costs`) return json(RUN_COSTS)
  if (path === `/api/analytics/run/${RUN_ID}/exposure`) return json(RUN_EXPOSURE)
  return json({ detail: 'not in this test' }, 404)
}

beforeEach(() => {
  runDetail = summaryFor({})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => route(new URL(String(input), 'http://127.0.0.1')))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TARGET: TearTarget = { kind: 'run', name: RUN_ID }

function show() {
  const client = createApiQueryClient()
  return render(
    <ApiProvider client={client}>
      <TearBody target={TARGET} tab="EQ" link="-" />
    </ApiProvider>,
  )
}

describe('tear sheet honesty tags (D20)', () => {
  it('shows [PROBE: never a result] on the header of a probe run, with the full KPI row', async () => {
    runDetail = summaryFor({ is_probe: true })
    show()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    const row = screen.getByRole('group', { name: 'Tear sheet parameters' })
    expect(within(row).getByText('[PROBE: never a result]')).toBeTruthy()
  })

  it('shows [ANCHOR] on the header of an anchor run', async () => {
    runDetail = summaryFor({ is_anchor: true, anchor_of: 'base_run' })
    show()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    const row = screen.getByRole('group', { name: 'Tear sheet parameters' })
    expect(within(row).getByText('[ANCHOR]')).toBeTruthy()
  })

  it('shows no honesty tag on a plain usable run', async () => {
    show()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    const row = screen.getByRole('group', { name: 'Tear sheet parameters' })
    expect(within(row).queryByText('[PROBE: never a result]')).toBeNull()
    expect(within(row).queryByText('[ANCHOR]')).toBeNull()
  })
})

// G08: the tile face shortens a unit ('%' for '% per year', nothing for a unitless ratio such as a t
// statistic), but the popover must still state the API's own full unit, not the shortened one. The
// fix wires kpiTiles' `unit` field (already computed) into KpiTile's `unit` prop at TearBody.tsx.
describe('KPI tile popovers show the API\'s full unit, not the shortened tile-face one (G08)', () => {
  function tileByLabel(label: string): HTMLElement {
    const el = screen.getByText(label, { selector: '.kpi-label' })
    const button = el.closest('button')
    if (!button) throw new Error(`no KPI tile button for ${label}`)
    return button
  }

  it('the Alpha t popover states the API\'s own unit in full, not a blank tile-face unit', async () => {
    show()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    const tile = tileByLabel('Alpha t')
    fireEvent.click(tile)
    const fullUnit = RUN_ANALYTICS.kpis.find((k) => k.key === 'alpha_t')!.unit
    expect(fullUnit.length).toBeGreaterThan(0)
    expect(screen.getByText(`Unit: ${fullUnit}`)).toBeTruthy()
  })

  it('the Alpha popover states "per year", not the tile face\'s bare %', async () => {
    show()
    await screen.findByRole('list', { name: 'Tear sheet key figures' })
    const tile = tileByLabel('Alpha')
    fireEvent.click(tile)
    expect(screen.getByText(/^Unit: /).textContent).toContain('per year')
  })
})
