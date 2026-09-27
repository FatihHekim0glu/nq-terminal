// @vitest-environment jsdom
// ROLL screen (TASKS Phase 11; UI_SPEC 5; ANALYTICS MV10, gaps as MV2): the calendar strip of every market's rolls by
// month, one market's rolls as a gap chart (role img, summary, table view) and a table, and the MNQ paper
// book's roll schedule, all from GETs; the API's label and basis verbatim; nothing after 2021-12-31 shown.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { captureDownloads } from '../../chrome/download.testUtil'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ResolvedContext } from '../../commands/types'
import RollScreen from './RollScreen'
import { BASIS, LABEL, PAPER, UNIT_NOTE, makeCalendar } from './rollTestData'

const PANEL_ID = 'p-roll'
const PARAMS: PanelParams = { code: 'ROLL', context: null, args: {}, group: 'A' }
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }

let status = 200
const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  if (status !== 200) {
    return new Response(JSON.stringify({ detail: 'window 2022-01-03 is past the fence' }), { status, headers: { 'content-type': 'application/json' } })
  }
  const body = url.pathname === '/api/market/rolls' ? makeCalendar() : PAPER
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
const renderRoll = (context: ResolvedContext | null = null) =>
  render(<RollScreen params={{ ...PARAMS, context }} context={context} />, { wrapper: Panel })
const strip = () => screen.findByRole('table', { name: /Rolls by month, 2021/ })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
  status = 200
  resetNumbered()
})

afterEach(cleanup)

describe('ROLL screen', () => {
  it('reads the roll calendar with one GET and nothing else until the paper tab opens', async () => {
    renderRoll()
    await strip()
    expect(urls()).toEqual(['/api/market/rolls'])
    for (const [, init] of fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>) expect(init.method).toBe('GET')
    expect(screen.getByRole('toolbar', { name: /Roll calendar/ })).toBeTruthy()
  })

  it('draws the strip for the last in-sample year, one numbered row per market', async () => {
    renderRoll()
    const table = await strip()
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)
    const es = rows[1]!
    expect(within(es).getByText('11)')).toBeTruthy()
    expect(within(es).getByText('ES Mar 2021: 2 rolls (2021-03-01, 2021-03-19)')).toBeTruthy()
    expect(within(rows[2]!).getByText('NQ Jun 2021: roll on 2021-06-11, gap -0.002%')).toBeTruthy()
    expect(table.textContent).not.toContain('2022')
  })

  it('shows the label, basis, unit note, gate and missing markets verbatim', async () => {
    renderRoll()
    await strip()
    expect(screen.getByText(LABEL)).toBeTruthy()
    expect(screen.getByText(`Basis: ${BASIS}`)).toBeTruthy()
    expect(screen.getByText(UNIT_NOTE)).toBeTruthy()
    expect(UNIT_NOTE).toContain('old contract less new, so it is negative when the new contract trades above the old')
    expect(screen.getByText(/Gate: caller terminal, years 2010 to 2021 served/)).toBeTruthy()
    expect(screen.getByText(/ZW\.V\.0/)).toBeTruthy()
  })

  it('opens a market with Number <GO> on its row: summary, QA comparison, chart and table', async () => {
    renderRoll()
    await strip()
    expect(activateNumbered(PANEL_ID, 12)).toBe(true)
    const chart = await screen.findByRole('img', { name: /^NQ roll gap in percent, 3 rolls: from 2021-06-11/ })
    expect(chart).toBeTruthy()
    expect(screen.getByText('NQ: 3 rolls from 2021-06-11 to 2021-12-13; mean absolute gap 0.019%, largest 0.030%.')).toBeTruthy()
    expect(screen.getByText('QA report count 3: matches.')).toBeTruthy()
    const rolls = screen.getByRole('table', { name: /NQ rolls, oldest first/ })
    expect(within(rolls).getAllByRole('row')).toHaveLength(4)
    expect(within(rolls).getByText('+3.75')).toBeTruthy()
  })

  it('keeps keyboard focus in the panel when a ticker opens the market view (WCAG 2.4.3)', async () => {
    renderRoll()
    const table = await strip()
    const pick = within(table).getByRole('button', { name: /ES/ })
    pick.focus()
    fireEvent.click(pick)
    const active = document.activeElement as HTMLElement
    expect(active).not.toBe(document.body)
    expect(active.getAttribute('role')).toBe('tab')
    expect(active.getAttribute('aria-selected')).toBe('true')
  })

  it('gives the gap chart a table view', async () => {
    renderRoll({ kind: 'instrument', value: 'CL' })
    await strip()
    fireEvent.click(screen.getByRole('tab', { name: /2\) Market/ }))
    await screen.findByRole('img', { name: /^CL roll gap in percent/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const table = screen.getByRole('table', { name: 'CL roll gaps' })
    expect(within(table).getByText('+0.271%')).toBeTruthy()
  })

  it('never shows a roll past the fence and says how many it left out', async () => {
    renderRoll({ kind: 'instrument', value: 'ES' })
    await strip()
    fireEvent.click(screen.getByRole('tab', { name: /2\) Market/ }))
    const rolls = await screen.findByRole('table', { name: /ES rolls, oldest first/ })
    expect(rolls.textContent).not.toContain('2022')
    expect(screen.getByText('1 rolls dated after 2021-12-31 were not shown.')).toBeTruthy()
    expect(screen.getByText('QA report count 46: differs from the 5 rolls shown.')).toBeTruthy()
  })

  it('reads the paper book schedule on its tab: dates only, the held contract marked', async () => {
    renderRoll()
    await strip()
    fireEvent.click(screen.getByRole('tab', { name: /3\) Paper book MNQ/ }))
    const table = await screen.findByRole('table', { name: /MNQ contracts around the one the book holds/ })
    expect(urls()).toContain('/api/market/paper-rolls?behind=2&ahead=8')
    const held = within(table).getByRole('rowheader', { name: 'MNQZ6' }).closest('tr')!
    expect(held.getAttribute('aria-current')).toBe('true')
    expect(within(held).getByText('2026-12-08')).toBeTruthy()
    expect(screen.getByText('Held after the close of 2026-09-27 (New York): MNQZ6; next roll 2026-12-08.')).toBeTruthy()
    expect(screen.getByText(/Dates only; no price is read/)).toBeTruthy()
  })

  it('98) Export saves the strip on screen with no request', async () => {
    renderRoll()
    await strip()
    const before = fetchSpy.mock.calls.length
    const saved = captureDownloads()
    try {
      fireEvent.click(within(screen.getByRole('toolbar', { name: /Roll calendar/ })).getByRole('button', { name: /98\) Export/ }))
      const lines = (await saved.text('rolls_27F_2021.csv')).split('\r\n')
      expect(lines).toHaveLength(4)
      expect(lines[0]!.startsWith('ticker,Jan')).toBe(true)
      expect(fetchSpy.mock.calls.length).toBe(before)
    } finally {
      saved.restore()
    }
  })

  it('shows the gate refusal as it came', async () => {
    status = 403
    renderRoll()
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The gate refused the request: window 2022-01-03 is past the fence')
  })
})
