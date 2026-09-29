// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import * as bus from '../../chrome/CommandLine.bus'
import { NumberingContext, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { DES_ROBUSTNESS } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { RUNS } from '../runs/runs.fixtures'
import { HYP_ANALYTICS } from '../tear/tearP1.fixtures'
import { RUN_ANALYTICS } from '../tear/tear.fixtures'
import DesRobustness, { ForkCurveView, ScreenEvidence } from './DesRobustness'
import { OVERNIGHT, VOLMANAGED } from './desTestData'
import type { ForkPoint } from './forkModel'
import { OVERNIGHT_SCREEN, VOLMANAGED_SCREEN } from './robustness.fixtures'

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { chartId?: string; data: { bars: unknown; unit?: string } }) => (
    <div data-testid={`ladder-${props.chartId}`} data-bars={JSON.stringify(props.data.bars)} data-unit={props.data.unit ?? ''} />
  ),
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const DETAIL = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let calls: string[] = []
let hypothesisStatus: Record<string, number> = {}
let runsStatus: number | null = null

function route(url: URL): Response {
  const path = url.pathname
  const search = url.search
  if (path === '/api/runs') return runsStatus !== null ? json({ detail: 'runs list failed' }, runsStatus) : json(RUNS)
  if (path === '/api/analytics/hypothesis/volmanaged_v0') {
    const forced = hypothesisStatus[search]
    if (forced) return json({ detail: `unknown hypothesis: volmanaged_v0${search}` }, forced)
    return json(HYP_ANALYTICS)
  }
  if (path === '/api/analytics/run/nt_volmanaged_v0_fixture_m1') return json(RUN_ANALYTICS)
  return json({ detail: 'not in this test' }, 404)
}

beforeEach(() => {
  calls = []
  hypothesisStatus = {}
  runsStatus = null
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    calls.push(`${url.pathname}${url.search}`)
    return route(url)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDetail(registrar = vi.fn(() => () => {})) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={registrar}>{node}</NumberingContext>
    </ApiProvider>
  )
  return { ...render(wrap(<DesRobustness detail={DETAIL} />)), registrar }
}

describe('ScreenEvidence', () => {
  it('draws the spec curve as a 14-bar ladder (headline plus 13 recorded variants) with the exact [POST HOC] count line', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    const dsr = screen.getByTestId('ladder-des-spec-dsr')
    const alpha = screen.getByTestId('ladder-des-spec-alpha')
    expect((JSON.parse(dsr.dataset['bars'] ?? '[]') as unknown[]).length).toBe(14)
    expect((JSON.parse(alpha.dataset['bars'] ?? '[]') as unknown[]).length).toBe(14)
    expect(screen.getByTestId('des-robustness-negative-line').textContent).toBe(
      '9 of 13 recorded variants have a negative Sharpe difference (m - BH) at 1 tick; counted by the terminal from the screen file [POST HOC].',
    )
  })

  it('draws the placebo ladder with the recorded percentile', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    expect(screen.getByTestId('ladder-des-placebo')).toBeTruthy()
    expect(screen.getByText(/0\.8775/)).toBeTruthy()
  })

  it('shows every section naming its tag and basis', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    expect(screen.getAllByText(/Basis A \(screen series\)/).length).toBeGreaterThan(0)
    // volmanaged_v0 is registered: every section carries its card-level [PRE-REG] tag.
    expect(screen.getAllByText('[PRE-REG]').length).toBeGreaterThan(0)
  })

  it('shows nothing recorded for a bare screen', () => {
    render(<ScreenEvidence screen={{ name: 'x' }} card={VOLMANAGED.card} />)
    expect(screen.getByText(DES_ROBUSTNESS.none)).toBeTruthy()
  })

  it('draws overnight_v0 subsets with never a p column', () => {
    render(<ScreenEvidence screen={OVERNIGHT_SCREEN} card={OVERNIGHT.card} />)
    const table = screen.getByRole('table', { name: DES_ROBUSTNESS.subsetsTitle })
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers.some((h) => /\bp\b/i.test(h ?? ''))).toBe(false)
    expect(screen.getByText('weeknight')).toBeTruthy()
    expect(screen.getByText(DES_ROBUSTNESS.pOmitted)).toBeTruthy()
  })

  it('every recorded section names its own basis (spec, placebo, stability, quintiles, tails, subsets, other)', () => {
    const { unmount } = render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    for (const id of ['des-robustness-spec', 'des-robustness-placebo', 'des-robustness-stability', 'des-robustness-quintiles', 'des-robustness-tails']) {
      expect(screen.getByTestId(id).textContent).toContain('Basis A (screen series)')
    }
    unmount()
    render(<ScreenEvidence screen={OVERNIGHT_SCREEN} card={OVERNIGHT.card} />)
    for (const id of ['des-robustness-subsets', 'des-robustness-other']) {
      expect(screen.getByTestId(id).textContent).toContain('Basis A (screen series)')
    }
  })

  it('never hard-codes a % unit for a section whose measures are not all percentages', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    for (const id of ['des-robustness-stability', 'des-robustness-quintiles', 'des-robustness-tails']) {
      expect(screen.getByTestId(id).textContent).not.toContain('Basis A (screen series), %;')
    }
  })

  it('the tails card names its units by measure', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    expect(screen.getByTestId('des-robustness-tails').textContent).toContain(DES_ROBUSTNESS.unitsByMeasure)
  })

  it('the quintiles header shows Mean % and SD %', () => {
    render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)
    const quintiles = screen.getByTestId('des-robustness-quintiles')
    expect(within(quintiles).getByText('Mean %')).toBeTruthy()
    expect(within(quintiles).getByText('SD %')).toBeTruthy()
  })

  it('gives every table a row header identifying its row (WCAG 1.3.1)', () => {
    const { unmount } = render(<ScreenEvidence screen={VOLMANAGED_SCREEN} card={VOLMANAGED.card} />)

    const variants = document.querySelector('.des-robustness-variants') as HTMLElement
    const variantHeaders = within(variants).getAllByRole('rowheader').map((h) => h.textContent)
    expect(variantHeaders[0]).toBe(DES_ROBUSTNESS.headline)
    expect(variantHeaders).toHaveLength(14)

    const years = document.querySelectorAll('.des-robustness-years')
    expect(years.length).toBeGreaterThan(0)
    for (const table of Array.from(years)) {
      const headers = within(table as HTMLElement).getAllByRole('rowheader').map((h) => h.textContent)
      expect(headers[0]).toBe('2011')
    }

    const quintiles = document.querySelector('.des-robustness-quintiles') as HTMLElement
    expect(within(quintiles).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['1', '2', '3', '4', '5'])

    const tails = document.querySelector('.des-robustness-tails') as HTMLElement
    expect(within(tails).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'vol_of_vol_pct', 'shortfall_1pct', 'shortfall_5pct', 'max_drawdown_pct', 'skew',
    ])

    unmount()
    render(<ScreenEvidence screen={OVERNIGHT_SCREEN} card={OVERNIGHT.card} />)
    const subsets = document.querySelector('.des-robustness-subsets') as HTMLElement
    expect(within(subsets).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'weeknight', 'weekend_or_holiday', 'early_close_entry', 'roll_nights', 'non_roll_nights',
      'late_exit', 'long_gap_gt4', 'without_repaired_days', 'day_gate_both_sessions',
    ])
  })
})

describe('ForkCurveView', () => {
  const screenSpec = { id: 's0', engine: 'screen' as const, name: 'volmanaged_v0', cost: 0, freq: null, basis: 'A' as const, registered: false, flags: [] }
  const points: ForkPoint[] = [{ spec: screenSpec, sharpe: 1, lo: 0.5, hi: 1.5, n: 39, tag: '[POST HOC]', unit: 'ratio', error: null }]

  it('activating Number 70 requests the fork EQ line', () => {
    const items: NumberedItem[] = []
    const registrar = vi.fn((_panelId: string, given: readonly NumberedItem[]) => {
      items.push(...given)
      return () => {}
    })
    const spy = vi.spyOn(bus, 'requestLine').mockImplementation(() => {})
    render(
      <NumberingContext value={registrar}>
        <ForkCurveView points={points} skipped={[]} name="volmanaged_v0" panelId="p1" />
      </NumberingContext>,
    )
    const item = items.find((i) => i.n === 70)
    expect(item).toBeTruthy()
    item?.run()
    expect(spy).toHaveBeenCalledWith('volmanaged_v0 EQ')
  })

  it('shows a 404 fork as not available', () => {
    const error = new ApiError({ kind: 'http', path: '/api/analytics/hypothesis/volmanaged_v0', status: 404, detail: 'unknown hypothesis: volmanaged_v0' })
    const errored: ForkPoint[] = [{ ...points[0]!, sharpe: null, lo: null, hi: null, n: null, tag: null, unit: null, error }]
    render(<ForkCurveView points={errored} skipped={[]} name="volmanaged_v0" panelId="p1" />)
    expect(screen.getByText(fillCopy(DES_ROBUSTNESS.notAvailable, { detail: 'unknown hypothesis: volmanaged_v0' }))).toBeTruthy()
  })

  it('gives the fork table a No. row header', () => {
    render(<ForkCurveView points={points} skipped={[]} name="volmanaged_v0" panelId="p1" />)
    const forks = document.querySelector('.des-robustness-forks') as HTMLElement
    expect(within(forks).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['70'])
  })
})

describe('DesRobustness (default export, the fetching container)', () => {
  it('asks exactly /api/runs, the hypothesis at cost 0/1/2 and the linked run at freq D/M', async () => {
    renderDetail()
    await waitFor(() => {
      expect(calls).toContain('/api/runs')
      expect(calls).toContain('/api/analytics/hypothesis/volmanaged_v0?cost=0')
      expect(calls).toContain('/api/analytics/hypothesis/volmanaged_v0?cost=1')
      expect(calls).toContain('/api/analytics/hypothesis/volmanaged_v0?cost=2')
      expect(calls).toContain('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=D')
      expect(calls).toContain('/api/analytics/run/nt_volmanaged_v0_fixture_m1?freq=M')
    })
    const unexpected = calls.filter((c) => !c.startsWith('/api/runs') && !c.startsWith('/api/analytics/hypothesis/volmanaged_v0') && !c.startsWith('/api/analytics/run/nt_volmanaged_v0_fixture_m1'))
    expect(unexpected).toEqual([])
  })

  it('draws Basis A and Basis B fork ladders', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('ladder-des-forks-a')).toBeTruthy())
    await waitFor(() => expect(screen.getByTestId('ladder-des-forks-b')).toBeTruthy())
  })

  it('shows a not available fork when the hypothesis analytics answers 404', async () => {
    hypothesisStatus['?cost=0'] = 404
    renderDetail()
    await waitFor(() => expect(screen.getByText(/not available: unknown hypothesis: volmanaged_v0\?cost=0/)).toBeTruthy())
  })

  it('reads "The terminal could not load the runs list" and not "No usable linked run" when /api/runs fails', async () => {
    runsStatus = 500
    renderDetail()
    await waitFor(() => expect(screen.getByText(/The terminal could not load the runs list: runs list failed/)).toBeTruthy())
    expect(screen.queryByText(DES_ROBUSTNESS.forksNoneB)).toBeNull()
  })

  it('reads "Loading the runs list..." and not "No usable linked run" while /api/runs has not answered', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://127.0.0.1')
      if (url.pathname === '/api/runs') return new Promise<Response>(() => {})
      return route(url)
    })
    renderDetail()
    await waitFor(() => expect(screen.getByText('Loading the runs list...')).toBeTruthy())
    expect(screen.queryByText(DES_ROBUSTNESS.forksNoneB)).toBeNull()
  })
})
