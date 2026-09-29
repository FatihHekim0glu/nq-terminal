// @vitest-environment jsdom
// G20: Shift+Enter (and a Shift double click) on a LEDG row opens its RUN in a new panel through the command line,
// as HELP promises, instead of replacing the ledger. A plain Enter and a plain double click still open it in place.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import { LEDGER } from '../runs/runs.fixtures'
import { mountScreen, stubApi } from '../runs/testing'
import LedgScreen from './LedgScreen'

const PARAMS = { code: 'LEDG', context: null, args: {}, group: '-' } as const
const RUN_ID = LEDGER.rows[0]!.run_id

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
})

async function mountLedg(): Promise<HTMLElement> {
  stubApi({ '/api/ledger': LEDGER })
  mountScreen(<LedgScreen params={PARAMS} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Run ledger/ })
  await waitFor(() => expect(within(grid).getByText(RUN_ID)).toBeTruthy())
  return grid
}

function captured(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  return { lines, stop: onLineRequest((r) => lines.push(r)) }
}

describe('LEDG: Shift+Enter opens RUN in a new panel (G20)', () => {
  it('Shift+Enter on a row requests "<run_id> RUN" with newPanel true', async () => {
    const grid = await mountLedg()
    const { lines, stop } = captured()
    act(() => grid.focus())
    fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    stop()
    expect(lines).toEqual([{ line: `${RUN_ID} RUN`, newPanel: true }])
  })

  it('a plain Enter still opens it in place (newPanel false)', async () => {
    const grid = await mountLedg()
    const { lines, stop } = captured()
    act(() => grid.focus())
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    expect(lines).toEqual([{ line: `${RUN_ID} RUN`, newPanel: false }])
  })

  it('a Shift double click opens in a new panel, a plain double click in place', async () => {
    const grid = await mountLedg()
    const { lines, stop } = captured()
    const row = within(grid).getByText(RUN_ID).closest('tr')!
    fireEvent.doubleClick(row, { shiftKey: true })
    fireEvent.doubleClick(row)
    stop()
    expect(lines).toEqual([
      { line: `${RUN_ID} RUN`, newPanel: true },
      { line: `${RUN_ID} RUN`, newPanel: false },
    ])
  })
})
