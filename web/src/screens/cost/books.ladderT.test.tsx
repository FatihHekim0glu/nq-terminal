// @vitest-environment jsdom
// N04 on COST and BLK for a hypothesis: the same bars as DES, with the t the screen file records under each, and the
// note that says what it is ([PRE-REG], no interval drawn or computed). The tables beside the bars are untouched.
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { BarLadderInput } from '../../charts/echarts/barLadderModel'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import type { PanelParams } from '../../chrome/WorkspaceLayouts'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import type { ResolvedContext } from '../../commands/types'
import { LADDER_T } from '../../copy/ladderT'
import BlkScreen from '../blk/BlkScreen'
import type { HypothesisDetail } from '../des/desModel'
import { VOLMANAGED } from '../des/desTestData'
import { VOLMANAGED_SCREEN } from '../des/robustness.fixtures'
import CostScreen from './CostScreen'

vi.mock('../../charts/echarts/BarLadder', () => ({
  BarLadder: (props: { chartId?: string; data: BarLadderInput }) => <div data-testid={`ladder-${props.chartId}`} data-labels={JSON.stringify(props.data.bars.map((b) => b.label))} />,
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let served: HypothesisDetail = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN as HypothesisDetail['screen'] }

beforeEach(() => {
  served = { ...VOLMANAGED, screen: VOLMANAGED_SCREEN as HypothesisDetail['screen'] }
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = decodeURIComponent(new URL(String(input), 'http://127.0.0.1').pathname)
    if (path === '/api/hypotheses/volmanaged_v0') return json(served)
    if (path === '/api/confirmations') return json([])
    return json({ detail: 'not in this test' }, 404)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function show(Screen: ComponentType<ScreenProps>, code: string) {
  const context: ResolvedContext = { kind: 'hypothesis', value: 'volmanaged_v0' }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const params: PanelParams = { code: code as PanelParams['code'], context, args: {}, group: '-' }
  const wrap = (node: ReactNode) => (
    <ApiProvider client={client}>
      <NumberingContext value={vi.fn(() => () => {})}>{node}</NumberingContext>
    </ApiProvider>
  )
  return render(wrap(<Screen params={params} context={context} />))
}

const labels = (id: string) => JSON.parse(screen.getByTestId(`ladder-${id}`).getAttribute('data-labels') ?? '[]') as string[]

describe('N04: COST', () => {
  it('prints the recorded t under each cost rung and notes what it is, tagged', async () => {
    show(CostScreen, 'COST')
    await screen.findByTestId('ladder-cost-ladder')
    expect(labels('cost-ladder')).toEqual(['0 ticks, t 1.19', '1 tick, t 1.18', '2 ticks, t 1.16'])
    const note = screen.getByTestId('ladder-t-note')
    expect(within(note).getByText('[PRE-REG]')).toBeTruthy()
    expect(note.textContent).toContain(LADDER_T.note)
    expect(note.textContent).toContain('Gating: alpha t (gating: smaller of Newey-West lags 5 and 21) 1.18.')
  })

  it('keeps the numbered table exactly as it was: labels without t, values as DES prints them', async () => {
    show(CostScreen, 'COST')
    const table = await screen.findByTestId('cost-ladder-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.children[1]?.textContent)).toEqual(['0 ticks', '1 tick', '2 ticks'])
  })

  it('shows no note and plain labels when the file records no t', async () => {
    served = VOLMANAGED
    show(CostScreen, 'COST')
    await screen.findByTestId('ladder-cost-ladder')
    expect(labels('cost-ladder')).toEqual(['0 ticks', '1 tick', '2 ticks'])
    expect(screen.queryByTestId('ladder-t-note')).toBeNull()
  })
})

describe('N04: BLK', () => {
  it('prints the recorded t under each block and notes what it is, tagged', async () => {
    show(BlkScreen, 'BLK')
    await screen.findByTestId('ladder-blk-ladder')
    expect(labels('blk-ladder')).toEqual(['2010-13, t 1.24', '2014-17, t -0.41', '2018-21, t 0.79'])
    const note = screen.getByTestId('ladder-t-note')
    expect(within(note).getByText('[PRE-REG]')).toBeTruthy()
    expect(note.textContent).toContain(LADDER_T.note)
  })

  it('keeps the numbered table exactly as it was', async () => {
    show(BlkScreen, 'BLK')
    const table = await screen.findByTestId('blk-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.children[1]?.textContent)).toEqual(['2010-13', '2014-17', '2018-21'])
  })

  it('shows no note and plain labels when the file records no t', async () => {
    served = VOLMANAGED
    show(BlkScreen, 'BLK')
    await screen.findByTestId('ladder-blk-ladder')
    expect(labels('blk-ladder')).toEqual(['2010-13', '2014-17', '2018-21'])
    expect(screen.queryByTestId('ladder-t-note')).toBeNull()
  })
})
