// @vitest-environment jsdom
// U13 (CORR pair selection by keyboard, keyboard-power/11-corr-pickers.json): the heatmap and its T
// table view could not be selected by keyboard. CORR now offers a second, MonitorGrid table view of
// every pair (roots A, B and the correlation r); Enter on a row (a matrix cell, flattened to one row
// per pair) sets it as the rolling pair, fully by keyboard.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { createApiQueryClient } from '../../api/queries'
import { registerNumbered } from '../../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { HeatmapInput } from '../../charts/echarts/heatmapModel'
import type { LineStackProps } from '../../charts/LineStack.types'
import { stubLayout } from '../../grids/testing'
import { BASIS, LABEL, makeUniverse } from '../mon/testUniverse'
import CorrScreen, { pairsRows } from './CorrScreen'
import { blockOf, sectorOrder } from './model'

// The virtualised own-scroll grid needs jsdom element sizes (MonitorGrid.test.tsx uses the same stub),
// so the 351-row pairs table renders a bounded window instead of the whole list at once.
beforeAll(() => stubLayout(400))

vi.mock('../../charts/echarts/Heatmap', () => ({
  Heatmap: ({ data }: { data: HeatmapInput }) => <div role="img" aria-label={data.name} />,
}))
vi.mock('../../charts/LineStack', () => ({
  default: (props: LineStackProps) => <div role="img" aria-label={props.title} />,
}))

const PANEL_ID = 'p-corr-table'
const PARAMS: PanelParams = { code: 'CORR', context: { kind: 'universe', value: '27F' }, args: {}, group: 'B' }
const actions: PanelActions = { panelId: PANEL_ID, related: () => true, back: () => true, forward: () => true, open: () => true }
const DAY = 86_400
const FENCE_T = Date.UTC(2022, 0, 1) / 1000

function pairBody(a: string, b: string, window: number) {
  const t = Array.from({ length: 5 }, (_, i) => FENCE_T - (5 - i) * DAY)
  const date = t.map((s) => new Date(s * 1000).toISOString().slice(0, 10))
  const corr = t.map((_, i) => (i === 0 ? null : 0.1 * i))
  return { a, b, window, label: LABEL, basis: BASIS, t, date, corr, gate: makeUniverse().gate }
}

const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://x')
  const q = url.searchParams
  const window = Number(q.get('window') ?? 252)
  const body = url.pathname === '/api/market/universe' ? makeUniverse(window) : pairBody(q.get('a') ?? '', q.get('b') ?? '', window)
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
})

afterEach(cleanup)

describe('pairsRows: the matrix flattened to one row per pair (U13)', () => {
  it('lists every unordered pair once, in the symbols order, with the served value', () => {
    const u = makeUniverse()
    const block = blockOf(u, 'window')
    const rows = pairsRows(block)
    expect(rows).toHaveLength((block.symbols.length * (block.symbols.length - 1)) / 2)
    expect(rows[0]).toEqual({ a: block.symbols[0], b: block.symbols[1], value: block.matrix[0]?.[1] ?? null })
    expect(rows.some((r) => r.a === r.b)).toBe(false)
  })

  it('honours a given index order: i < j over the order, not the symbols order', () => {
    const block = { symbols: ['A', 'B', 'C'], matrix: [[1, 0.1, 0.2], [0.1, 1, 0.3], [0.2, 0.3, 1]] }
    const rows = pairsRows(block, [2, 0, 1])
    expect(rows).toEqual([
      { a: 'C', b: 'A', value: 0.2 },
      { a: 'C', b: 'B', value: 0.3 },
      { a: 'A', b: 'B', value: 0.1 },
    ])
  })
})

describe('CORR: the matrix as a selectable table (U13)', () => {
  it('defaults to the heatmap, with no table grid drawn', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    expect(screen.queryByRole('grid', { name: /27F correlation pairs/ })).toBeNull()
  })

  it('switches to a selectable grid of every pair', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const grid = await screen.findByRole('grid', { name: /27F correlation pairs, last 252 sessions, clustered order/ })
    expect(screen.queryByRole('img', { name: /27F correlation,/ })).toBeNull()
    const u = makeUniverse()
    const block = blockOf(u, 'window')
    const total = (block.symbols.length * (block.symbols.length - 1)) / 2
    expect(grid.getAttribute('aria-rowcount')).toBe(String(total + 1))
    // Own-scroll windowing (not scroll="panel") renders only a bounded slice of the 351 rows inside
    // the matrix box, not every row at once.
    expect(within(grid).getAllByRole('row').length).toBeLessThan(total + 1)
  })

  it('scrolls the table inside the matrix box, not the panel body (CORR Table overflow)', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const grid = await screen.findByRole('grid', { name: /27F correlation pairs/ })
    const scrollBox = grid.parentElement
    expect(scrollBox?.className.split(' ')).not.toContain('nqt-grid-scroll--panel')
    expect(grid.hasAttribute('data-roving-scroll')).toBe(true)
  })

  it('honours the clustered order from the API (block.order), not the raw symbols order', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const grid = await screen.findByRole('grid', { name: /27F correlation pairs, last 252 sessions, clustered order/ })
    const u = makeUniverse()
    const block = blockOf(u, 'window')
    // The API's clustered order (makeOrder(27, 5) in the fixture) is not the identity order, so this
    // pins the bug: the unfixed table always shows symbols[0]-symbols[1] regardless of block.order.
    expect(block.order.slice(0, 2)).not.toEqual([0, 1])
    const expectedFirst = { a: block.symbols[block.order[0]!]!, b: block.symbols[block.order[1]!]! }
    const firstDataRow = within(grid).getAllByRole('row')[1]!
    const cells = within(firstDataRow).getAllByRole('gridcell')
    expect(cells[0]?.textContent).toContain(expectedFirst.a.split('.')[0]!)
    expect(cells[1]?.textContent).toContain(expectedFirst.b.split('.')[0]!)
  })

  it('reorders the table rows when Order switches from Clustered to By sector', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    await screen.findByRole('grid', { name: /27F correlation pairs, last 252 sessions, clustered order/ })
    fireEvent.click(screen.getByRole('button', { name: 'By sector' }))
    const grid = await screen.findByRole('grid', { name: /27F correlation pairs, last 252 sessions, sector order/ })
    const u = makeUniverse()
    const block = blockOf(u, 'window')
    const idx = sectorOrder(block.symbols, u.rows)
    const expectedFirst = pairsRows(block, idx)[0]!
    const firstDataRow = within(grid).getAllByRole('row')[1]!
    const cells = within(firstDataRow).getAllByRole('gridcell')
    expect(cells[0]?.textContent).toContain(expectedFirst.a.split('.')[0]!)
    expect(cells[1]?.textContent).toContain(expectedFirst.b.split('.')[0]!)
  })

  it('sets the pair with Enter on a row, fully by keyboard, and re-reads the rolling pair', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /Rolling correlation NQ vs ZN/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    const grid = await screen.findByRole('grid', { name: /27F correlation pairs/ })
    // Row 0 (the default active cell) is the clustered order's first pair: symbols[block.order[0]] vs
    // symbols[block.order[1]], not necessarily symbols[0] vs symbols[1] (finding: CORR table Order).
    const u = makeUniverse()
    const block = blockOf(u, 'window')
    const first = pairsRows(block, block.order)[0]!
    const a = first.a.split('.')[0]
    const b = first.b.split('.')[0]
    grid.focus()
    fireEvent.keyDown(grid, { key: 'Enter' })
    await waitFor(() => expect(urls()).toContain(`/api/market/pair-corr?a=${first.a}&b=${first.b}&window=252`))
    await screen.findByRole('img', { name: new RegExp(`Rolling correlation ${a} vs ${b}`) })
  })

  it('switches back to the heatmap', async () => {
    renderCorr()
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    await screen.findByRole('grid', { name: /27F correlation pairs/ })
    fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }))
    await screen.findByRole('img', { name: /27F correlation, last 252 sessions/ })
    expect(screen.queryByRole('grid', { name: /27F correlation pairs/ })).toBeNull()
  })
})
