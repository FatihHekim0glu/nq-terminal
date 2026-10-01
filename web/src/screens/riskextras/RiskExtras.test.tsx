// @vitest-environment jsdom
// The P2 risk extras cards (TASKS Phase 12; RK4, PF11, BR5) from fixture-backend bodies: what each tab shows, the
// table's accessible structure, the greyed rows where the modified ES is not defined, and the pending and refused
// reads.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { RISK_EXTRAS as R } from '../../copy/riskExtras'
import RiskExtras from './RiskExtras'
import { HYP_RISK_EXTRAS, IN_DOMAIN, RUN_RISK_EXTRAS } from './riskExtras.fixtures'

afterEach(cleanup)

describe('RET tab', () => {
  it('shows the PF11 tiles and the RK4 table with its caption and headers', () => {
    render(<RiskExtras tab="RET" data={HYP_RISK_EXTRAS} error={null} />)
    expect(screen.getByRole('heading', { name: /Ulcer index and recovery factor \(PF11\)/ })).toBeTruthy()
    const row = screen.getByRole('list', { name: R.drawdown.label })
    expect(within(row).getAllByRole('button')).toHaveLength(2)
    expect(within(row).getByText('4.39%')).toBeTruthy()
    expect(within(row).getByText('-0.84')).toBeTruthy()
    const table = screen.getByRole('table', { name: /Expected shortfall by level and method, 1 session, a positive loss/ })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      ['Level', 'Gaussian', 'Historical CVaR (RK1)', 'Modified', 'Raw expansion', 'Shown', 'Method'])
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['95%', '99%'])
    expect(screen.queryByRole('heading', { name: /Treynor/ })).toBeNull()
  })

  it('greys the rows where the modified ES is not defined and states the reason', () => {
    render(<RiskExtras tab="RET" data={HYP_RISK_EXTRAS} error={null} />)
    const table = screen.getByRole('table')
    const first = within(table).getAllByRole('row')[1]
    if (!first) throw new Error('no first row')
    expect(within(first).getAllByText(R.es.notDefined)).toHaveLength(1)
    const method = within(first).getByText(R.es.usedHistorical)
    expect(method.className).toBe('muted')
    expect(method.getAttribute('title')).toContain('outside the region')
  })

  it('inside the domain the modified ES is the shown value, not greyed', () => {
    render(<RiskExtras tab="RET" data={IN_DOMAIN} error={null} />)
    const first = within(screen.getByRole('table')).getAllByRole('row')[1]
    if (!first) throw new Error('no first row')
    expect(within(first).getAllByText('2.13%')).toHaveLength(3) // modified, raw expansion and shown
    expect(within(first).getByText(R.es.usedModified).className).toBe('')
    expect(screen.getByText(R.es.usedFloored)).toBeTruthy()
  })

  it('a tile opens its popover with the basis and unit', () => {
    render(<RiskExtras tab="RET" data={HYP_RISK_EXTRAS} error={null} />)
    const button = screen.getAllByRole('button')[0]
    if (!button) throw new Error('no tile')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Unit as the API states it: fraction of K below the running peak/)).toBeTruthy()
    expect(screen.getByText(/Basis A/)).toBeTruthy()
  })

  it('the popover Unit line states the full API unit, not the face unit (G08)', () => {
    render(<RiskExtras tab="RET" data={HYP_RISK_EXTRAS} error={null} />)
    const button = screen.getAllByRole('button')[0]
    if (!button) throw new Error('no tile')
    fireEvent.click(button)
    expect(screen.getByText(`Unit: ${HYP_RISK_EXTRAS.drawdown_tiles[0]?.unit}`)).toBeTruthy()
  })
})

describe('RR tab', () => {
  it('shows the Treynor tile with its note', () => {
    render(<RiskExtras tab="RR" data={HYP_RISK_EXTRAS} error={null} />)
    expect(screen.getByRole('heading', { name: /Treynor ratio \(BR5\)/ })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: R.treynor.label })).getByText('-0.41')).toBeTruthy()
    expect(screen.getByText(/Nautilus compounds instead/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('the Treynor popover Unit line states the full API unit (G08)', () => {
    render(<RiskExtras tab="RR" data={HYP_RISK_EXTRAS} error={null} />)
    fireEvent.click(within(screen.getByRole('list', { name: R.treynor.label })).getByRole('button'))
    expect(screen.getByText(`Unit: ${HYP_RISK_EXTRAS.treynor.tile.unit}`)).toBeTruthy()
  })

  it('without a benchmark says why there is no ratio', () => {
    render(<RiskExtras tab="RR" data={RUN_RISK_EXTRAS} error={null} />)
    expect(screen.getByText('No Treynor ratio: no benchmark for this series')).toBeTruthy()
    expect(screen.getByText('--')).toBeTruthy()
  })
})

describe('pending and refused reads', () => {
  it('says it is reading, then shows the refusal as an alert', () => {
    const { rerender } = render(<RiskExtras tab="RET" data={undefined} error={null} />)
    expect(screen.getByRole('status').textContent).toBe(R.loading)
    const error = new ApiError({ kind: 'http', path: '/api/analytics/run/x/risk-extras', status: 422, detail: 'unusable run' })
    rerender(<RiskExtras tab="RR" data={undefined} error={error} />)
    expect(screen.getByRole('alert').textContent).toBe('Risk extras not available: unusable run')
  })
})
