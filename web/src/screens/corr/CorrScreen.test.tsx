// @vitest-environment jsdom
// CORR screen (TASKS 7.2, look spec 7.8): the clustered matrix from the API, the window and full-sample
// switch, the sector order, and the rolling pair panel as a LineStack in the panel's link group, all from
// GETs; the API's label and basis verbatim. The chart components are stood in, so the test reads the
// exact data each one is given.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import type { LineStackProps } from '../../charts/LineStack.types'
import { BASIS, LABEL, makeUniverse } from '../mon/testUniverse'
import CorrScreen from './CorrScreen'
import { FENCE_T } from './model'

const seen: { heat: HeatmapInput | null; stack: LineStackProps | null } = { heat: null, stack: null }

vi.mock('../../charts/echarts/Heatmap', () => ({
  Heatmap: ({ data }: { data: HeatmapInput }) => {
    seen.heat = data
    return <div role="img" aria-label={data.name} />
  },
}))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => {
    seen.stack = props
    return <div role="img" aria-label={props.title} />
  },
}))

const PANEL_ID = 'p-corr'
const PARAMS: PanelParams = { code: 'CORR', context: { kind: 'universe', value: '27F' }, args: {}, group: 'B' }
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }
const DAY = 86_400

function pairBody(a: string, b: string, window: number, extra = 0) {
  const n = 5 + extra
  const t = Array.from({ length: n }, (_, i) => FENCE_T - (5 - i) * DAY)
  const date = t.map((s) => new Date(s * 1000).toISOString().slice(0, 10))
  const corr = t.map((_, i) => (i === 0 ? null : Math.round((0.1 * i - 0.2) * 1e6) / 1e6))
  return { a, b, window, label: LABEL, basis: BASIS, t, date, corr, gate: makeUniverse().gate }
}

let pairExtra = 0
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  const q = url.searchParams
  const window = Number(q.get('window') ?? 252)
  const body = url.pathname === '/api/market/universe' ? makeUniverse(window) : pairBody(q.get('a') ?? '', q.get('b') ?? '', window, pairExtra)
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
})

function Panel({ children }: { readonly children: ReactNode }) {
  return (
    <ApiProvider client={createApiQueryClient()}>
      <PanelActionsContext value={actions}>
        <NumberingContext value={registerNumbered}>{children}</NumberingContext>
      </PanelActionsContext>
    </ApiProvider>
  )
}

const urls = () => fetchSpy.mock.calls.map(([u]) => String(u))
const renderCorr = () => render(<CorrScreen params={PARAMS} context={PARAMS.context} />, { wrapper: Panel })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  seen.heat = null
  seen.stack = null
  pairExtra = 0
  resetNumbered()
})

afterEach(cleanup)

describe('CORR screen', () => {
  it('reads the universe and the NQ against ZN pair, GET only', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation NQ vs ZN/ })
    expect(urls()).toEqual(['/api/market/universe?window=252', '/api/market/pair-corr?a=NQ.V.0&b=ZN.V.0&window=252'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
    expect(screen.getByRole('toolbar', { name: /Correlation matrix/ })).toBeTruthy()
  })

  it('draws the window matrix in the API cluster order', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /last 252 sessions, clustered order/ })
    const u = makeUniverse()
    const order = u.correlation_window.order
    expect(seen.heat?.rows).toEqual(order.map((i) => u.correlation_window.symbols[i]!.split('.')[0]))
    expect(seen.heat?.values[3]![7]).toBe(u.correlation_window.matrix[order[3]!]![order[7]!])
  })

  it('switches to the full-sample matrix and to sector order', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /clustered order/ })
    fireEvent.click(screen.getByRole('button', { name: 'Full sample' }))
    await screen.findByRole('img', { name: /full sample to 2021-12-31, clustered order/ })
    const u = makeUniverse()
    expect(seen.heat?.rows[0]).toBe(u.correlation_full.symbols[u.correlation_full.order[0]!]!.split('.')[0])
    fireEvent.click(screen.getByRole('button', { name: 'By sector' }))
    await screen.findByRole('img', { name: /sector order/ })
    expect(seen.heat?.rows.slice(0, 3)).toEqual(['ES', 'NQ', 'YM'])
  })

  it('answers Number <GO> 11 and 12 with the window and full matrices', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /last 252 sessions/ })
    activateNumbered(PANEL_ID, 12)
    await screen.findByRole('img', { name: /full sample/ })
    activateNumbered(PANEL_ID, 11)
    await screen.findByRole('img', { name: /last 252 sessions/ })
  })

  it('draws the pair in the panel link group, values as served', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation NQ vs ZN/ })
    const body = pairBody('NQ.V.0', 'ZN.V.0', 252)
    expect(seen.stack?.link).toBe('B')
    expect(seen.stack?.t).toEqual(body.t)
    expect(seen.stack?.panes[0]?.series[0]?.values).toEqual(body.corr)
    expect(seen.stack?.panes[0]?.decimals).toBe(2)
    // A plain white line: the primary style would add an equity area and a drawdown to the summary.
    expect(seen.stack?.panes[0]?.series[0]).toMatchObject({ name: 'Rolling correlation NQ vs ZN', style: 'rollShort' })
    expect(screen.getByText(/^Last rolling value \+0\.20 on 2021-12-31; the 252-session matrix entry is/)).toBeTruthy()
  })

  it('never draws a pair point past the fence', async () => {
    pairExtra = 2
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation/ })
    expect(seen.stack?.t.every((t) => t < FENCE_T)).toBe(true)
    expect(screen.getByText('2 points past 2021-12-31 were not drawn.')).toBeTruthy()
  })

  it('re-reads the pair when the second symbol changes', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation NQ vs ZN/ })
    const second = screen.getByRole('combobox', { name: 'vs' })
    fireEvent.click(second)
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'ES' }))
    await waitFor(() => expect(urls()).toContain('/api/market/pair-corr?a=NQ.V.0&b=ES.V.0&window=252'))
    await screen.findByRole('img', { name: /Rolling correlation NQ vs ES/ })
  })

  it('shows the API label and basis verbatim', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation/ })
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
    expect(screen.getByText(`Basis: ${BASIS}`)).toBeTruthy()
  })
})
