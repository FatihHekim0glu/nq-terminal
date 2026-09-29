// @vitest-environment jsdom
// G20: Shift+Enter (and a Shift double click) on a RUNS row opens RUN in a new panel through the command
// line, as HELP promises, instead of replacing the RUNS panel. A plain Enter still opens it in place.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LineStackProps } from '../../charts/LineStack.types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import RunsScreen from './RunsScreen'
import { COMPARE_STATS, RUNS } from './runs.fixtures'
import { mountScreen, stubApi } from './testing'

vi.mock('../../charts/LineStack', () => ({
  default: (_props: LineStackProps) => <div data-testid="linestack" />,
}))

const PARAMS = { code: 'RUNS', context: null, args: {}, group: '-' } as const

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
  resetMessage()
})

async function mountRuns(): Promise<HTMLElement> {
  stubApi({ '/api/runs': RUNS, '/api/runs/stats': COMPARE_STATS })
  mountScreen(<RunsScreen params={PARAMS} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Nautilus runs/ })
  await waitFor(() => expect(within(grid).getByText('8.34')).toBeTruthy())
  return grid
}

function captured(): { lines: LineRequest[]; stop: () => void } {
  const lines: LineRequest[] = []
  return { lines, stop: onLineRequest((r) => lines.push(r)) }
}

describe('RUNS: Shift+Enter opens RUN in a new panel (G20)', () => {
  it('Shift+Enter on the second row requests "<id> RUN" with newPanel true', async () => {
    const grid = await mountRuns()
    const { lines, stop } = captured()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    act(() => {
      fireEvent.keyDown(grid, { key: 'Enter', shiftKey: true })
    })
    stop()
    expect(lines).toEqual([{ line: `${RUNS[1]?.run_id} RUN`, newPanel: true }])
  })

  it('a plain Enter still opens it in place (newPanel false)', async () => {
    const grid = await mountRuns()
    const { lines, stop } = captured()
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    act(() => {
      fireEvent.keyDown(grid, { key: 'Enter' })
    })
    stop()
    expect(lines).toEqual([{ line: `${RUNS[1]?.run_id} RUN`, newPanel: false }])
  })

  it('a Shift double click opens in a new panel, a plain double click in place', async () => {
    const grid = await mountRuns()
    const { lines, stop } = captured()
    const row = within(grid).getByText(RUNS[0]!.run_id).closest('tr')!
    fireEvent.doubleClick(row, { shiftKey: true })
    fireEvent.doubleClick(row)
    stop()
    expect(lines).toEqual([
      { line: `${RUNS[0]?.run_id} RUN`, newPanel: true },
      { line: `${RUNS[0]?.run_id} RUN`, newPanel: false },
    ])
  })
})
