// @vitest-environment jsdom
// G19: the OOS log grid said 'Enter on a row opens it' but had no onOpen: Enter and Number <GO> did
// nothing and the amber callers were inert. A row now opens the caller's DES when the caller is a
// registered hypothesis (Shift+Enter in a new panel), and otherwise reads the entry's full reason out on
// the message line. The grid's description says Enter opens a row only because it now does.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage, useMessage } from '../../chrome/MessageLine.store'
import { activateNumbered, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import { GRID } from '../../copy/grids'
import { stubLayout } from '../../grids/testing'
import OosLogGrid from './OosLogGrid'

type Entry = Schemas['OosLogEntry']

function entry(over: Partial<Entry>): Entry {
  return {
    alert: false, caller: 'za_screen', end: '2022-01-01 00:00:00+00:00', end_epoch_s: 1640995200, is_sealed: false, key_set: 'k4',
    line_no: 1, past_fence: false, reason: 'pre-registered za_v0 screen', rows: 3129157, sealed: null, severity: 2, spec_sha256: null,
    start: '2010-09-28 00:00:00+00:00', start_epoch_s: 1285632000, symbol: 'NQ.V.0', timeframe: '1m', variant: 'repaired',
    ts_epoch_s: 1790386325, ts_utc: '2026-09-25T21:32:05.600302+00:00', ...over,
  }
}

// Newest first, as OosScreen hands them over.
const ROWS: Entry[] = [
  entry({ line_no: 3, caller: 'terminal', reason: 'terminal display: NQ.V.0 1m vendor 2019', ts_utc: '2026-09-27T09:00:00+00:00', severity: 1 }),
  entry({ line_no: 2, caller: 'fomccycle_v0', reason: 'pre-registered fomc cycle screen', ts_utc: '2026-09-26T11:00:00+00:00' }),
  entry({ line_no: 1 }),
]

const LEVELS: Schemas['SeverityLevel'][] = [
  { level: 1, meaning: 'terminal display read' },
  { level: 2, meaning: 'research read' },
  { level: 3, meaning: 'check it' },
  { level: 4, meaning: 'sealed read' },
]

const PANEL = 'p-oos'
const actions: PanelActions = { panelId: PANEL, related: () => false, back: () => false, forward: () => false, open: () => false }

function respond(cards: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/hypotheses')) {
      return new Response(JSON.stringify(status === 200 ? cards : { detail: 'down' }), { status, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ detail: 'unexpected' }), { status: 404, headers: { 'content-type': 'application/json' } })
  })
}

async function mount(cards: unknown = [{ name: 'fomccycle_v0' }, { name: 'za_v0' }], status = 200): Promise<HTMLElement> {
  respond(cards, status)
  const client = createApiQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  render(
    <ApiProvider client={client}>
      <PanelActionsContext value={actions}>
        <NumberingContext value={registerNumbered}>
          <OosLogGrid rows={ROWS} emptyText="No entries." panelId={PANEL} levels={LEVELS} />
        </NumberingContext>
      </PanelActionsContext>
    </ApiProvider>,
  )
  const grid = await screen.findByRole('grid')
  // The hypotheses answer decides what Enter does; wait for it to land before pressing keys.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  return grid
}

function requests(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  return { lines, stop: onLineRequest((r) => lines.push(r)) }
}

beforeEach(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
  resetMessage()
  vi.restoreAllMocks()
})

describe('OOS log grid: Enter on a row (G19)', () => {
  it('describes Enter as opening a row, now that it does', async () => {
    const grid = await mount()
    const hint = document.getElementById(grid.getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toContain(GRID.openHint)
  })

  it('opens the caller\'s DES when the caller is a registered hypothesis', async () => {
    const grid = await mount()
    const { lines, stop } = requests()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    expect(lines).toEqual([{ line: 'fomccycle_v0 DES', newPanel: false }])
  })

  it('Shift+Enter opens that DES in a new panel', async () => {
    const grid = await mount()
    const { lines, stop } = requests()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    stop()
    expect(lines).toEqual([{ line: 'fomccycle_v0 DES', newPanel: true }])
  })

  it('Number <GO> on that row does the same', async () => {
    await mount()
    const { lines, stop } = requests()
    act(() => {
      expect(activateNumbered(PANEL, 2)).toBe(true)
    })
    stop()
    expect(lines).toEqual([{ line: 'fomccycle_v0 DES', newPanel: false }])
  })

  it('reads the full reason on the message line for a caller that is not a hypothesis, and opens nothing', async () => {
    const grid = await mount()
    const { lines, stop } = requests()
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    expect(lines).toEqual([])
    expect(useMessage.getState().text).toBe('terminal: terminal display: NQ.V.0 1m vendor 2019')
  })

  it('falls back to the reason when the hypotheses cannot be read, rather than guessing a DES', async () => {
    const grid = await mount(null, 503)
    const { lines, stop } = requests()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    expect(lines).toEqual([])
    expect(useMessage.getState().text).toBe('fomccycle_v0: pre-registered fomc cycle screen')
  })

  it('still lists every row with its caller', async () => {
    const grid = await mount()
    const callers = within(grid).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('gridcell')[4]?.textContent)
    expect(callers).toEqual(['terminal', 'fomccycle_v0', 'za_screen'])
  })
})
