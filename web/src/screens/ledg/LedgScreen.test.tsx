// @vitest-environment jsdom
// LEDG (TASKS 6.3, UI_SPEC section 7 "LEDG", look spec 7.9): the ledger rows from GET /api/ledger with
// a weekday prefix on the date, the balance column in colour and text, the anchor pair status joined
// from `anchor_pairs`, run links (Enter opens RUN), and an empty state that names the expected file.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Schemas } from '../../api/types'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { activateNumbered, resetNumbered } from '../../chrome/NumberedActions'
import { stubLayout } from '../../grids/testing'
import { LEDGER } from '../runs/runs.fixtures'
import { TEST_PANEL, mountScreen, stubApi } from '../runs/testing'
import LedgScreen from './LedgScreen'

const PARAMS = { code: 'LEDG', context: null, args: {}, group: '-' } as const
const BASE = LEDGER.rows[0] as Schemas['LedgerRow']
const ANCHOR_ROW: Schemas['LedgerRow'] = {
  ...BASE, run_id: 'nt_overnight_v0_fixture_open_a1', exp_id: 'overnight_v0_fixture_anchor', ts_utc: '2026-09-24T10:00:00+00:00',
  balance_check: 'FAIL', matches_result: false,
}
const PAIR: Schemas['AnchorComparison'] = {
  anchor: ANCHOR_ROW.run_id, base: BASE.run_id, base_source: 'name', base_found: true,
  n_trades_equal: true, pnl_total_equal: true, fees_total_equal: true,
  sharpe_anchor: 0.4644167852049855, sharpe_base: 0.4644167852049855, sharpe_equal: true,
  verdict: 'IDENTICAL', regress_check_identical: null,
}
const WITH_PAIR: Schemas['LedgerView'] = { ledger_found: true, rows: [BASE, ANCHOR_ROW], anchor_pairs: [PAIR] }

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
})

async function mountLedg(view: Schemas['LedgerView'] = LEDGER) {
  const seen = stubApi({ '/api/ledger': view })
  mountScreen(<LedgScreen params={PARAMS} context={null} />)
  const grid = await screen.findByRole('grid', { name: /Run ledger/ })
  await waitFor(() => expect(within(grid).getByText(BASE.run_id)).toBeTruthy())
  return { seen, grid }
}

function rowOf(grid: HTMLElement, runId: string): HTMLElement {
  const row = within(grid).getByText(runId).closest('tr')
  if (!row) throw new Error(`no row for ${runId}`)
  return row
}

describe('LEDG: the run ledger', () => {
  it('shows each ledger row with a weekday date, the numbers and the balance as text', async () => {
    const { grid, seen } = await mountLedg()
    const row = rowOf(grid, BASE.run_id)
    // The weekday sits in its own muted span, so match the whole cell text.
    expect(within(row).getByText((_, el) => el?.tagName === 'TD' && el.textContent === 'Sa 2026-09-26')).toBeTruthy()
    expect(within(row).getByText('overnight_v0_fixture')).toBeTruthy()
    expect(within(row).getByText('+617.08')).toBeTruthy()
    expect(within(row).getByText('17.92')).toBeTruthy()
    expect(within(row).getByText('75.0%')).toBeTruthy()
    expect(within(row).getByText('[OK]')).toBeTruthy()
    expect(seen.every((r) => r.method === 'GET' && r.url === '/api/ledger')).toBe(true)
  })

  it('joins the anchor pair and shows IDENTICAL on both runs of the pair', async () => {
    const { grid } = await mountLedg(WITH_PAIR)
    expect(within(rowOf(grid, BASE.run_id)).getByText('IDENTICAL')).toBeTruthy()
    const anchorRow = rowOf(grid, ANCHOR_ROW.run_id)
    expect(within(anchorRow).getByText('IDENTICAL')).toBeTruthy()
    expect(within(anchorRow).getByText('[FAIL]')).toBeTruthy()
    const pairs = screen.getByRole('table', { name: /Anchor pairs/ })
    expect(within(pairs).getByText('IDENTICAL')).toBeTruthy()
    expect(within(pairs).getByText(ANCHOR_ROW.run_id)).toBeTruthy()
  })

  it('counts the rows and the balanced rows', async () => {
    await mountLedg(WITH_PAIR)
    expect(screen.getByTestId('ledger-counts').textContent).toBe('Rows 2  Balanced 1  Match result.json 1')
  })

  it('filters on run id, exp id and strategy', async () => {
    const { grid } = await mountLedg(WITH_PAIR)
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter ledger' }), { target: { value: 'anchor' } })
    await waitFor(() => expect(within(grid).queryByText(BASE.run_id)).toBeNull())
    expect(within(grid).getByText(ANCHOR_ROW.run_id)).toBeTruthy()
  })

  it('opens RUN for a row (Number <GO> 1)', async () => {
    await mountLedg()
    const lines: LineRequest[] = []
    const off = onLineRequest((r) => lines.push(r))
    act(() => {
      expect(activateNumbered(TEST_PANEL, 1)).toBe(true)
    })
    off()
    expect(lines).toEqual([{ line: `${BASE.run_id} RUN`, newPanel: false }])
  })

  it('names the expected file when there is no ledger', async () => {
    stubApi({ '/api/ledger': { ledger_found: false, rows: [], anchor_pairs: [] } })
    mountScreen(<LedgScreen params={PARAMS} context={null} />)
    expect(await screen.findByText('No ledger yet: results/ledger.csv')).toBeTruthy()
  })
})
