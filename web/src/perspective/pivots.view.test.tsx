// @vitest-environment jsdom
// The accessible table in every pivot view (TASKS 9.1; WCAG 1.3.1, 2.1.1, 4.1.2): a visible Show as
// [Table | Pivot grid] toggle over the same rows; the table is the default under prefers-reduced-motion and
// takes over when the pivot grid cannot start. The Perspective grid is a stand-in here (the engine needs a
// real browser: e2e/perspective.spec.ts).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PIVOT } from '../copy/perspective'
import { fillCopy } from '../copy/workspace'
import { stubLayout } from '../grids/testing'
import type { LedgerRow } from './datasets'

const grid = vi.hoisted(() => ({ fail: null as string | null, mounted: 0 }))

vi.mock('./PerspectiveGrid', () => ({
  default: (props: { name: string; onFailed?: (detail: string) => void }) => {
    grid.mounted += 1
    if (grid.fail) {
      const detail = grid.fail
      queueMicrotask(() => props.onFailed?.(detail))
    }
    return <div data-testid="psp-grid">{props.name}</div>
  },
}))
vi.mock('./engine', () => ({ loadPerspective: vi.fn(() => new Promise(() => undefined)) }))

const { LedgerPivot } = await import('./pivots')
const { resetPivotMode } = await import('./pivotMode')

function reducedMotion(on: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion: reduce'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const ROWS = [
  { ts_utc: '2026-09-01T10:00:00Z', run_id: 'a1', strategy: 'za', n_trades: 10, pnl_total: 100, fees_total: 1, balance_check: 'PASS' },
  { ts_utc: '2026-09-02T10:00:00Z', run_id: 'b1', strategy: 'eom', n_trades: 4, pnl_total: -5, fees_total: 2, balance_check: 'PASS' },
] as unknown as LedgerRow[]

const toggle = () => screen.getByRole('group', { name: PIVOT.show })
const pressed = (label: string) => within(toggle()).getByRole('button', { name: label }).getAttribute('aria-pressed')
const table = () => screen.queryByRole('grid', { name: fillCopy(PIVOT.table.label, { name: PIVOT.names.ledger, rows: 2 }) })

beforeEach(() => {
  stubLayout()
  grid.fail = null
  grid.mounted = 0
  resetPivotMode()
})
afterEach(cleanup)

describe('pivot views: the accessible table', () => {
  it('opens as the table under prefers-reduced-motion, says why, and never starts the pivot grid', () => {
    reducedMotion(true)
    render(<LedgerPivot rows={ROWS} />)
    expect(pressed(PIVOT.showTable)).toBe('true')
    expect(pressed(PIVOT.showPivot)).toBe('false')
    const t = table()
    expect(t).not.toBeNull()
    // The same rows: a total row and one row per strategy, with the aggregates.
    expect(t!.textContent).toContain(PIVOT.table.total)
    expect(t!.textContent).toContain('eom')
    expect(t!.textContent).toContain('za')
    expect(t!.textContent).toContain('95')
    expect(screen.getByRole('status').textContent).toBe(fillCopy(PIVOT.table.ready, { name: PIVOT.names.ledger, rows: 2 }))
    expect(screen.getByText(PIVOT.table.reducedMotion)).toBeTruthy()
    expect(grid.mounted).toBe(0)
  })

  it('opens as the pivot grid otherwise; the visible toggle switches to the table and back', async () => {
    reducedMotion(false)
    render(<LedgerPivot rows={ROWS} />)
    expect(await screen.findByTestId('psp-grid')).toBeTruthy()
    expect(pressed(PIVOT.showPivot)).toBe('true')
    expect(table()).toBeNull()
    fireEvent.click(within(toggle()).getByRole('button', { name: PIVOT.showTable }))
    expect(table()).not.toBeNull()
    expect(screen.queryByTestId('psp-grid')).toBeNull()
    fireEvent.click(within(toggle()).getByRole('button', { name: PIVOT.showPivot }))
    expect(await screen.findByTestId('psp-grid')).toBeTruthy()
  })

  it('born failing: when the pivot grid cannot start, the table takes over and an alert says why', async () => {
    reducedMotion(false)
    grid.fail = 'no WebAssembly'
    render(<LedgerPivot rows={ROWS} />)
    await waitFor(() => expect(table()).not.toBeNull())
    expect(screen.getByRole('alert').textContent).toBe(fillCopy(PIVOT.table.fallback, { detail: 'no WebAssembly' }))
    expect(pressed(PIVOT.showTable)).toBe('true')
  })

  it('keeps the choice made on the toggle for the next pivot view, whatever the motion setting', async () => {
    reducedMotion(true)
    const first = render(<LedgerPivot rows={ROWS} />)
    fireEvent.click(within(toggle()).getByRole('button', { name: PIVOT.showPivot }))
    first.unmount()
    render(<LedgerPivot rows={ROWS} />)
    expect(await screen.findByTestId('psp-grid')).toBeTruthy()
    expect(screen.queryByText(PIVOT.table.reducedMotion)).toBeNull()
  })

  it('the table is one keyboard stop that moves its active cell with the arrow keys', () => {
    reducedMotion(true)
    render(<LedgerPivot rows={ROWS} />)
    const t = table()!
    expect(t.getAttribute('tabindex')).toBe('0')
    t.focus()
    const before = t.getAttribute('aria-activedescendant')
    fireEvent.keyDown(t, { key: 'ArrowDown' })
    expect(t.getAttribute('aria-activedescendant')).not.toBe(before)
  })
})
