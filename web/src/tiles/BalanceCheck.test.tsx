// @vitest-environment jsdom
// BalanceCheck (TASKS 5.4, UI_SPEC sections 6 and 7 RUN, look spec 7.4, nq-lab rule 4): the run's
// balance reconciliation as [OK] or [FAIL] with the difference, the MTM check, coverage and anchor;
// a failed check marks the run [UNUSABLE: BALANCE].
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import BalanceCheck, { readBalance } from './BalanceCheck'

const OK = {
  starting_usd: 100000000.0, final_usd: 100060658.125, delta_usd: 60658.125, realized_sum_usd: 60658.125, diff_usd: 0.0, ok: true,
  open_positions: 0, trade_list_sum_usd: 60658.125,
  mtm: { rows: 15, fills: 11, fills_after_last_snapshot: 0, max_abs_diff_usd: 0.0, net_qty_ok: true, lots_match: true, final_flat: true, bad_rows: [], n_bad: 0, ok: true },
}
const BAD = {
  starting_usd: 1000000.0, final_usd: 1001065.46, delta_usd: 1065.46, realized_sum_usd: 1053.12, diff_usd: 12.34, ok: false, open_positions: 0, trade_list_sum_usd: 1053.12,
}

afterEach(() => cleanup())

function value(label: string): HTMLElement {
  const dd = screen.getByText(label, { selector: 'dt' }).nextElementSibling
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${label}`)
  return dd
}

describe('readBalance', () => {
  it('reads the fields it knows and ignores the rest', () => {
    const b = readBalance(OK)
    expect(b).toMatchObject({ ok: true, diffUsd: 0, startingUsd: 100000000, openPositions: 0 })
    expect(b.mtm).toMatchObject({ ok: true, maxAbsDiffUsd: 0, nBad: 0, rows: 15 })
    expect(readBalance(BAD).mtm).toBeNull()
  })

  it('treats a missing or odd ok flag as not recorded, never as passed', () => {
    expect(readBalance({}).ok).toBeNull()
    expect(readBalance({ ok: 'true' }).ok).toBeNull()
    expect(readBalance({ diff_usd: 'NaN' }).diffUsd).toBeNull()
  })
})

describe('BalanceCheck', () => {
  it('shows [OK] with the difference, and the MTM check, in the summary line', () => {
    render(<BalanceCheck check={OK} coverage={{ sessions: 15, processed: 15, ok: true }} anchor="IDENTICAL" />)
    const summary = screen.getByTestId('balance-summary')
    expect(summary.textContent).toBe('Balance [OK] diff 0.00 USD | MTM [OK] max abs diff 0.00 USD, 0 bad rows | Coverage 15/15 | Anchor IDENTICAL')
    expect(summary.querySelector('.tone-up')?.textContent).toBe('[OK]')
    expect(screen.queryByText('[UNUSABLE: BALANCE]')).toBeNull()
  })

  it('lists the reconciliation in USD with thousands separators and two decimals', () => {
    render(<BalanceCheck check={OK} />)
    expect(value('Starting balance (USD)').textContent).toBe('100,000,000.00')
    expect(value('Final balance (USD)').textContent).toBe('100,060,658.13')
    expect(value('Change (USD)').textContent).toBe('+60,658.13')
    expect(value('Difference (USD)').textContent).toBe('0.00')
    expect(value('Open positions').textContent).toBe('0')
    expect(value('MTM rows checked').textContent).toBe('15')
  })

  it('marks a failed check [FAIL] and the run [UNUSABLE: BALANCE], with the reason in words', () => {
    render(<BalanceCheck check={BAD} />)
    const summary = screen.getByTestId('balance-summary')
    expect(summary.textContent).toBe('Balance [FAIL] diff 12.34 USD')
    expect(summary.querySelector('.tone-down')?.textContent).toBe('[FAIL]')
    expect(screen.getByText('[UNUSABLE: BALANCE]')).toBeTruthy()
    expect(screen.getByText('The balance check failed, so this run is unusable and its equity is not drawn (rule 4).')).toBeTruthy()
  })

  it('says NOT RECORDED when the run has no ok flag', () => {
    render(<BalanceCheck check={{}} />)
    expect(screen.getByTestId('balance-summary').textContent).toBe('Balance [NOT RECORDED] diff -- USD')
  })

  it('is a titled region', () => {
    render(<BalanceCheck check={OK} runId="nt_dtsmom_v0_ts1" />)
    expect(screen.getByRole('region', { name: 'Balance check: nt_dtsmom_v0_ts1' })).toBeTruthy()
  })
})
