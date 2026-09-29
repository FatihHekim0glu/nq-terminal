// @vitest-environment jsdom
// CostBoard (93) Cost survival, look spec 7.2, roadmap #5): the tiles inside one ChartA11y, numbered
// 1..N, each drawing its own scale in CSS classes only (no colour attribute), with a "No ladder" list
// for rows without a ladder.
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, numberedItems, registerNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { NumberingContext } from '../../chrome/PanelChrome.numbers'
import { COST_BOARD, EVIDENCE } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../des/desTestData'
import CostBoard from './CostBoard'
import { buildCostBoard } from './costBoardModel'
import { buildRegRows } from './regModel'
import { HYPOTHESES, REGISTRY } from './regFixtures'
import type { HypothesisDetails } from './useHypothesisDetails'

const PANEL_ID = 'cost-board-test'

const REG_ROWS = buildRegRows(REGISTRY, HYPOTHESES)

const DETAILS: HypothesisDetails = {
  byName: new Map([
    ['overnight_v0', OVERNIGHT],
    ['volmanaged_v0', VOLMANAGED],
    ['rebal_v0', REBAL],
    ['za_v0', ZA],
    ['za_v0_C3_gao_momentum', ZA_C3],
  ]),
  failed: new Map([['tom_v0', 'not found']]),
  pending: 0,
}

const VIEW = buildCostBoard(REG_ROWS, DETAILS)

beforeEach(() => resetNumbered())
afterEach(() => cleanup())

function mount() {
  return render(
    <NumberingContext value={registerNumbered}>
      <CostBoard panelId={PANEL_ID} view={VIEW} />
    </NumberingContext>,
  )
}

function captureLines(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  const stop = onLineRequest((r) => lines.push(r))
  return { lines, stop }
}

describe('CostBoard', () => {
  it('draws one ChartA11y named by the board summary, with a T table view of the same rows', () => {
    mount()
    const figure = screen.getByRole('img', { name: VIEW.label })
    expect(figure).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    act(() => {
      screen.getByRole('button', { name: /Table/ }).click()
    })
    const table = screen.getByRole('table')
    expect(within(table).getByText(VIEW.table.caption)).toBeTruthy()
  })

  it('draws tiles 1..4 in served (sorted) order', () => {
    mount()
    const tiles = document.querySelectorAll('.reg-cost-tile')
    expect(tiles).toHaveLength(4)
    expect(tiles[0]?.textContent).toContain('volmanaged_v0')
    expect(tiles[3]?.textContent).toContain('za_v0')
    expect(screen.getByText('1)').closest('.reg-cost-tile')?.textContent).toContain('volmanaged_v0')
  })

  it('Number <GO> 1 requests volmanaged_v0 COST', () => {
    mount()
    const { lines, stop } = captureLines()
    try {
      expect(numberedItems(PANEL_ID).find((i) => i.n === 1)?.label).toBe('Open volmanaged_v0 COST')
      act(() => {
        expect(activateNumbered(PANEL_ID, 1)).toBe(true)
      })
      expect(lines.at(-1)).toEqual({ line: 'volmanaged_v0 COST', newPanel: false })
    } finally {
      stop()
    }
  })

  it('states its own scale on every tile', () => {
    mount()
    const scales = screen.getAllByText(/^own scale /)
    expect(scales).toHaveLength(4)
  })

  it('lists only rows read but recording no ladder, outside the chart image, with no alert', () => {
    mount()
    const none = VIEW.missing.filter((m) => m.reason === 'none')
    const noLadder = screen.getByText(new RegExp(`^No ladder \\(${none.length}\\): ${none.map((m) => m.name).join(', ')}\\.$`))
    expect(screen.getByRole('img').contains(noLadder)).toBe(false)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('shows a reading status line while any row is pending, ahead of a failure', () => {
    mount()
    expect(VIEW.status).toEqual({ kind: 'reading', n: expect.any(Number) })
    const status = screen.getByRole('status')
    expect(status.textContent).toBe(fillCopy(EVIDENCE.reading, { n: (VIEW.status as { n: number }).n }))
  })

  it('shows a failed status line naming the first failure once nothing is pending', () => {
    const rows = REG_ROWS.filter((r) => DETAILS.byName.has(r.name) || r.name === 'tom_v0')
    const view = buildCostBoard(rows, DETAILS)
    render(
      <NumberingContext value={registerNumbered}>
        <CostBoard panelId={PANEL_ID} view={view} />
      </NumberingContext>,
    )
    expect(screen.getByRole('status').textContent).toBe(fillCopy(COST_BOARD.failed, { n: 1, name: 'tom_v0', detail: 'not found' }))
  })

  it('draws bars, the zero line and the break-even marker with CSS classes only, never a colour attribute', () => {
    mount()
    const svgEls = document.querySelectorAll('.reg-cost-svg *')
    expect(svgEls.length).toBeGreaterThan(0)
    for (const el of svgEls) {
      expect(el.hasAttribute('fill')).toBe(false)
      expect(el.hasAttribute('stroke')).toBe(false)
      expect(el.hasAttribute('color')).toBe(false)
      expect(el.hasAttribute('style')).toBe(false)
    }
    expect(document.querySelectorAll('.reg-cost-zero').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.reg-cost-pos, .reg-cost-neg').length).toBeGreaterThan(0)
  })

  it('draws no dashed marker for a tile whose break-even is off the drawn ladder', () => {
    mount()
    const volmanaged = screen.getByText('volmanaged_v0').closest('.reg-cost-tile')!
    expect(volmanaged.querySelectorAll('.reg-cost-even')).toHaveLength(0)
  })
})
