// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHART } from '../copy/workspace'
import ChartA11y, { type ChartTable } from './ChartA11y'
import { describeSeries } from './ChartA11ySummary'

afterEach(cleanup)

const TABLE: ChartTable = {
  caption: 'Equity, basis B',
  columns: [
    { key: 'date', label: 'Date' },
    { key: 'equity', label: 'Equity', numeric: true },
  ],
  rows: [
    { date: '2019-01-02', equity: '1.000' },
    { date: '2019-01-03', equity: '0.987' },
  ],
}

const LABEL = 'Equity: 2 points from 2019-01-02 to 2019-01-03'

function renderChart(extra: Partial<Parameters<typeof ChartA11y>[0]> = {}) {
  return render(
    <ChartA11y label={LABEL} table={TABLE} {...extra}>
      <canvas data-testid="canvas" />
    </ChartA11y>,
  )
}

describe('ChartA11y (UI_SPEC section 9: axe cannot see into canvas)', () => {
  it('wraps the chart in role="img" with the summary as its accessible name', () => {
    renderChart()
    const img = screen.getByRole('img', { name: LABEL })
    expect(within(img).getByTestId('canvas')).toBeTruthy()
  })

  it('switches to a real table with caption and column headers, and back', () => {
    renderChart()
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    const table = screen.getByRole('table', { name: 'Equity, basis B' })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Equity'])
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.queryByRole('img', { name: LABEL })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    expect(screen.getByRole('img', { name: LABEL })).toBeTruthy()
  })

  it('puts the chart toolbar in the Table row, before the toggle, outside the figure', () => {
    renderChart({ toolbar: <button type="button">Max</button> })
    const toggle = screen.getByRole('button', { name: CHART.tableToggle })
    const tool = screen.getByRole('button', { name: 'Max' })
    expect(tool.parentElement).toBe(toggle.parentElement)
    expect(tool.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('img', { name: LABEL }).contains(tool)).toBe(false)
  })

  it('makes the chart and its scrolling table Tab stops on their own (a panel narrows them to one)', () => {
    renderChart()
    expect(screen.getByRole('img', { name: LABEL }).tabIndex).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    expect(screen.getByRole('region').tabIndex).toBe(0)
  })

  it('toggles with T only while the chart has focus', () => {
    renderChart()
    const img = screen.getByRole('img', { name: LABEL })
    fireEvent.keyDown(document.body, { key: 't' })
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.keyDown(img, { key: 't' })
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('passes other keys to the chart first (crosshair steps), unchanged', () => {
    const onKeyDown = vi.fn()
    renderChart({ onKeyDown })
    fireEvent.keyDown(screen.getByRole('img', { name: LABEL }), { key: 'ArrowRight' })
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown.mock.calls[0]?.[0].key).toBe('ArrowRight')
  })

  it('follows a controlled table view and reports changes', () => {
    const onTableViewChange = vi.fn()
    renderChart({ tableView: true, onTableViewChange })
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    expect(onTableViewChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('keeps one visible label on the toggle; aria-pressed alone carries the state (2.5.3)', () => {
    renderChart()
    const toggle = screen.getByRole('button', { name: CHART.tableToggle })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe(CHART.tableToggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('born failing: puts the crosshair readout in a live region outside role=img, so it is not hidden', () => {
    renderChart({ readout: 'T 09:35 O 1 H 2 L 0 C 1' })
    const readout = screen.getByRole('status', { name: CHART.readoutLabel })
    expect(readout.textContent).toBe('T 09:35 O 1 H 2 L 0 C 1')
    expect(readout.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('img', { name: LABEL }).contains(readout)).toBe(false)
  })

  it('right-aligns numeric columns', () => {
    renderChart({ tableView: true, onTableViewChange: () => {} })
    const cells = screen.getAllByRole('cell')
    expect(cells[1]?.className).toContain('num')
    expect(cells[0]?.className).not.toContain('num')
  })
})

describe('describeSeries: the aria-label summary', () => {
  it('names range, first, last, low and high with the unit', () => {
    const text = describeSeries({
      name: 'Equity',
      t: ['2019-01-02', '2019-01-03', '2019-01-04'],
      v: [1, 0.9, 1.1],
      unit: 'x',
      format: (n) => n.toFixed(2),
    })
    expect(text).toBe('Equity: 3 points from 2019-01-02 to 2019-01-04; first 1.00, last 1.10, low 0.90, high 1.10 x.')
  })

  it('skips gaps (null and NaN) instead of reporting them as zero', () => {
    const text = describeSeries({ name: 'RV', t: ['a', 'b', 'c', 'd'], v: [null, 2, Number.NaN, 4] })
    expect(text).toBe('RV: 2 points from b to d; first 2, last 4, low 2, high 4.')
  })

  it('born failing: summarises a series far longer than the argument-spread limit', () => {
    const n = 300_000
    const v = Array.from({ length: n }, (_, i) => (i === 1234 ? -5 : i === 250_000 ? 9 : i % 3))
    const t = v.map((_, i) => String(i))
    expect(describeSeries({ name: 'Long', t, v })).toBe(`Long: ${n} points from 0 to ${n - 1}; first 0, last 2, low -5, high 9.`)
  })

  it('adds the maximum drawdown when asked (UI_SPEC section 9)', () => {
    const text = describeSeries({ name: 'Equity', t: ['a', 'b', 'c', 'd', 'e'], v: [1, 1.2, 0.9, 1.1, 0.95], drawdown: true })
    expect(text).toBe('Equity: 5 points from a to e; first 1, last 0.95, low 0.9, high 1.2; max drawdown -25.0%.')
  })

  it('says so when there is no data', () => {
    expect(describeSeries({ name: 'RV', t: [], v: [] })).toBe('RV: no data.')
    expect(describeSeries({ name: 'RV', t: ['a'], v: [null] })).toBe('RV: no data.')
  })
})
