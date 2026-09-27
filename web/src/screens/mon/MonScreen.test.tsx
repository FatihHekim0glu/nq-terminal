// @vitest-environment jsdom
// MON screen (TASKS 7.2, look spec 7.7): the red bar and settings, the 27 rows by sector from one GET of
// /api/market/universe, the API's honesty label and basis verbatim, the view and window switches, the
// row drill-down menu (Related Functions style) and the gate refusal text.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import { stubLayout } from '../../grids/testing'
import MonScreen from './MonScreen'
import { LABEL, makeUniverse } from './testUniverse'

const PANEL_ID = 'p-mon'
const PARAMS: PanelParams = { code: 'MON', context: { kind: 'universe', value: '27F' }, args: {}, group: 'A' }
const actions: PanelActions = { panelId: PANEL_ID, related: vi.fn(() => true), back: vi.fn(() => true), forward: vi.fn(() => true), open: vi.fn(() => true) }

type Reply = { status: number; body: unknown }
let replyFor: (url: string) => Reply = () => ({ status: 200, body: makeUniverse() })
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const r = replyFor(url)
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } })
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

function renderMon() {
  return render(<MonScreen params={PARAMS} context={PARAMS.context} />, { wrapper: Panel })
}

const urls = () => fetchSpy.mock.calls.map(([u]) => String(u))

beforeAll(() => stubLayout(600))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = () => {}
  fetchSpy.mockClear()
  replyFor = (url) => ({ status: 200, body: makeUniverse(Number(new URL(url, 'http://x').searchParams.get('window') ?? 252)) })
  resetNumbered()
})

afterEach(cleanup)

describe('MON screen', () => {
  it('shows the red bar with its title and numbered buttons', async () => {
    renderMon()
    const bar = screen.getByRole('toolbar', { name: /Futures monitor \(27F\)/ })
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: /97\) Settings/ })).toBeTruthy()
    await screen.findByRole('grid', { name: /Futures monitor/ })
  })

  it('reads the universe with one GET at the 252-session window', async () => {
    renderMon()
    await screen.findByRole('grid', { name: /Futures monitor/ })
    expect(urls()).toEqual(['/api/market/universe?window=252'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
  })

  it('shows the sectors as numbered section rows and the API values in %', async () => {
    renderMon()
    const grid = await screen.findByRole('grid', { name: /Futures monitor/ })
    expect(within(grid).getByText('1) Equity')).toBeTruthy()
    expect(within(grid).getByText('2) Rates')).toBeTruthy()
    const nq = within(grid).getByText('NQ1 Index').closest('tr')!
    expect(within(nq).getByText('+0.52%')).toBeTruthy()
    expect(within(nq).getByText('15959.00')).toBeTruthy()
    expect(within(nq).getByText('27.3%')).toBeTruthy()
    expect(within(nq).getByText('E-mini Nasdaq-100')).toBeTruthy()
    expect(within(grid).getByRole('columnheader', { name: /^1D %/ })).toBeTruthy()
  })

  it('shows the API label and basis verbatim, the tag and the gate line', async () => {
    renderMon()
    await screen.findByRole('grid', { name: /Futures monitor/ })
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
    expect(screen.getByText(/^Basis: daily r = dB \/ \(N - dB\)/)).toBeTruthy()
    expect(screen.getByText('Gate: caller terminal, years 2010 to 2021 served, 27 reads this process, cached')).toBeTruthy()
  })

  it('switches to vol-normalised returns in sd', async () => {
    renderMon()
    const grid = await screen.findByRole('grid', { name: /Futures monitor/ })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vol-normalised' }))
    const nq = within(grid).getByText('NQ1 Index').closest('tr')!
    await waitFor(() => expect(within(nq).getByText('+0.30')).toBeTruthy())
    expect(within(grid).getByRole('columnheader', { name: /^1D sd/ })).toBeTruthy()
  })

  it('fills heat cells on request, with the sign still printed', async () => {
    renderMon()
    const grid = await screen.findByRole('grid', { name: /Futures monitor/ })
    expect(grid.querySelector('.mon-heat')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Heat cells' }))
    const nq = within(grid).getByText('NQ1 Index').closest('tr')!
    await waitFor(() => expect(within(nq).getByText('+6.50%').classList.contains('mon-heat-up2')).toBe(true))
    expect(within(nq).getByText('+0.52%').classList.contains('mon-heat-up1')).toBe(true)
  })

  it('re-reads the universe when the window changes', async () => {
    renderMon()
    await screen.findByRole('grid', { name: /Futures monitor/ })
    fireEvent.click(screen.getByRole('button', { name: /97\) Settings/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Window: 63 sessions' }))
    await waitFor(() => expect(urls()).toContain('/api/market/universe?window=63'))
  })

  it('opens the functions for a row on Enter and runs the chosen line', async () => {
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    renderMon()
    const grid = await screen.findByRole('grid', { name: /Futures monitor/ })
    // Row 11) is NQ: the second row of section 1) Equity (ES is 10).
    act(() => { expect(activateNumbered(PANEL_ID, 11)).toBe(true) })
    const dialog = await screen.findByRole('dialog', { name: 'Functions for NQ1 Index' })
    const items = within(dialog).getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['1) GP Candle chart', '2) GIP Intraday chart', '3) DES Instrument description', '4) CORR Correlation matrix'])
    act(() => { expect(activateNumbered(PANEL_ID, 2)).toBe(true) })
    expect(lines).toEqual([{ line: 'NQ GIP', newPanel: false }])
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(grid, { key: 'Enter' })
    const again = await screen.findByRole('dialog')
    fireEvent.keyDown(within(again).getAllByRole('menuitem')[0]!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    off()
  })

  it('shows the gate refusal text when the gate refuses', async () => {
    replyFor = () => ({ status: 403, body: { detail: 'window 2022-01-01 is past the fence' } })
    renderMon()
    expect(await screen.findByText('The gate refused the request: window 2022-01-01 is past the fence')).toBeTruthy()
    expect(screen.queryByRole('grid')).toBeNull()
  })
})
