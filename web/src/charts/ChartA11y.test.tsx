// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHART } from '../copy/panelParts'
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
    expect(cells[0]?.className).toContain('num')
    const headers = screen.getAllByRole('rowheader')
    expect(headers[0]?.className).not.toContain('num')
  })

  // D38: without a row header, a screen reader moving down a column announces only the value, with no
  // row context (WCAG 1.3.1). The first column is the row label in every DataTable caller today
  // (heatmapTable's 'row', stackTable's and candleTable's 'time').
  it('D38: gives each row a row header, so a screen reader announces the row it is in', () => {
    renderChart({ tableView: true, onTableViewChange: () => {} })
    const table = screen.getByRole('table', { name: 'Equity, basis B' })
    const headers = within(table).getAllByRole('rowheader')
    expect(headers.map((h) => h.textContent)).toEqual(['2019-01-02', '2019-01-03'])
    // The row header is not also a plain data cell.
    expect(within(table).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1.000', '0.987'])
    // Row headers are announced by row, the way column headers are announced by column: the
    // Equity cell of the first row points back at its row header.
    const rows = within(table).getAllByRole('row')
    const firstBodyRow = rows[1]!
    expect(within(firstBodyRow).getByRole('rowheader').textContent).toBe('2019-01-02')
  })

  it('D38: a numeric first column still becomes the row header, styled numeric like the data cell it replaces', () => {
    const table: ChartTable = {
      caption: 'Cone, basis B',
      columns: [
        { key: 'step', label: 'Step', numeric: true },
        { key: 'label', label: 'Label' },
      ],
      rows: [{ step: 1, label: 'a' }, { step: 2, label: 'b' }],
    }
    render(
      <ChartA11y label={LABEL} table={table} tableView onTableViewChange={() => {}}>
        <canvas data-testid="canvas" />
      </ChartA11y>,
    )
    const header = screen.getAllByRole('rowheader')[0]!
    expect(header.className).toContain('num')
    expect(header.textContent).toBe('1')
  })

  it('D38: a column flagged rowHeader becomes the row header instead of the first column', () => {
    const table: ChartTable = {
      caption: 'P-scatter, basis B',
      columns: [
        { key: 'rank', label: 'Rank', numeric: true },
        { key: 'label', label: 'Label', rowHeader: true },
      ],
      rows: [{ rank: 1, label: 'a' }, { rank: 2, label: 'b' }],
    }
    render(
      <ChartA11y label={LABEL} table={table} tableView onTableViewChange={() => {}}>
        <canvas data-testid="canvas" />
      </ChartA11y>,
    )
    const headers = screen.getAllByRole('rowheader')
    expect(headers.map((h) => h.textContent)).toEqual(['a', 'b'])
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '2'])
  })
})

describe('ChartA11y extraTables (LineStack context layer)', () => {
  const WINDOWS: ChartTable = {
    caption: 'Equity, marked windows',
    columns: [
      { key: 'window', label: 'Window' },
      { key: 'days', label: 'Sessions', numeric: true },
    ],
    rows: [{ window: '2020 COVID crash', days: 23 }, { window: '2018 Q4 sell-off', days: 84 }],
  }
  const RUNS: ChartTable = {
    caption: 'Equity, Regime runs',
    columns: [{ key: 'state', label: 'State' }, { key: 'sessions', label: 'Sessions', numeric: true }],
    rows: [{ state: 'low volatility', sessions: 120 }],
  }

  it('renders each extra table after the main one, in order, inside the same table view', () => {
    renderChart({ tableView: true, onTableViewChange: () => {}, extraTables: [WINDOWS, RUNS] })
    const tables = screen.getAllByRole('table')
    expect(tables.map((t) => within(t).getByText(/./, { selector: 'caption' }).textContent)).toEqual([
      'Equity, basis B', 'Equity, marked windows', 'Equity, Regime runs',
    ])
    const region = screen.getByRole('region')
    for (const table of tables) expect(region.contains(table)).toBe(true)
    // Document order: main, then windows, then runs.
    expect(tables[0]!.compareDocumentPosition(tables[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tables[1]!.compareDocumentPosition(tables[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the region named by the main table and the main table\'s own rows', () => {
    renderChart({ tableView: true, onTableViewChange: () => {}, extraTables: [WINDOWS] })
    expect(screen.getByRole('region').getAttribute('aria-label')).toBe('Equity, basis B')
    const main = screen.getByRole('table', { name: 'Equity, basis B' })
    expect(within(main).getAllByRole('row')).toHaveLength(3)
    expect(within(main).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Date', 'Equity'])
  })

  it('renders the extra table as a real table: caption, column headers, row headers, numeric cells', () => {
    renderChart({ tableView: true, onTableViewChange: () => {}, extraTables: [WINDOWS] })
    const extra = screen.getByRole('table', { name: 'Equity, marked windows' })
    expect(within(extra).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Window', 'Sessions'])
    expect(within(extra).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['2020 COVID crash', '2018 Q4 sell-off'])
    const cells = within(extra).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual(['23', '84'])
    expect(cells[0]!.className).toContain('num')
    expect(within(extra).getAllByRole('columnheader')[1]!.className).toContain('num')
  })

  it('shows the extra tables in the T view only, never under the chart', () => {
    renderChart({ extraTables: [WINDOWS] })
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: CHART.tableToggle }))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('img', { name: LABEL })).toBeTruthy()
  })

  // useId gives each render its own id, so the ids are masked before two renders are compared.
  const markup = (container: HTMLElement) => container.innerHTML.replace(/(\bid|aria-describedby)="[^"]*"/g, '$1="_"')

  it('leaves the DOM exactly as it was without them, whether absent or empty', () => {
    const plain = renderChart({ tableView: true, onTableViewChange: () => {} })
    const before = markup(plain.container)
    expect(before).toContain('<table')
    cleanup()
    const undefinedExtras = renderChart({ tableView: true, onTableViewChange: () => {}, extraTables: undefined })
    expect(markup(undefinedExtras.container)).toBe(before)
    cleanup()
    const empty = renderChart({ tableView: true, onTableViewChange: () => {}, extraTables: [] })
    expect(markup(empty.container)).toBe(before)
    expect(within(empty.container).getAllByRole('table')).toHaveLength(1)
  })

  it('leaves the chart view unchanged when extra tables are passed', () => {
    const plain = renderChart()
    const before = markup(plain.container)
    expect(before).toContain('canvas')
    cleanup()
    const withExtras = renderChart({ extraTables: [WINDOWS, RUNS] })
    expect(markup(withExtras.container)).toBe(before)
  })

  it('keeps T and the toggle working with extras present', () => {
    renderChart({ extraTables: [WINDOWS] })
    const img = screen.getByRole('img', { name: LABEL })
    fireEvent.keyDown(img, { key: 't' })
    expect(screen.getAllByRole('table')).toHaveLength(2)
    fireEvent.keyDown(screen.getByRole('region'), { key: 't' })
    expect(screen.queryByRole('table')).toBeNull()
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

  it('states the drawdown the screen passes, with its basis, and never derives one (UI_SPEC section 9)', () => {
    // A Basis A curve (1 + cumulative sum) falls 13.5% from its peak as a ratio while the API's drawdown
    // in units of K is -22.64%: the name carries the API's figure, not a ratio of the plotted values.
    const text = describeSeries({
      name: 'Equity',
      t: ['a', 'b', 'c', 'd', 'e'],
      v: [1, 1.2, 0.9, 1.1, 0.95],
      drawdown: { value: '-22.64%', basis: 'Basis A' },
    })
    expect(text).toBe('Equity: 5 points from a to e; first 1, last 0.95, low 0.9, high 1.2; max drawdown -22.64% (Basis A).')
  })

  it('born failing: states no drawdown unless one is passed', () => {
    const text = describeSeries({ name: 'Gross exposure', t: ['a', 'b', 'c'], v: [0.02, 0.01, 0] })
    expect(text).not.toMatch(/drawdown/)
  })

  it('says so when there is no data', () => {
    expect(describeSeries({ name: 'RV', t: [], v: [] })).toBe('RV: no data.')
    expect(describeSeries({ name: 'RV', t: ['a'], v: [null] })).toBe('RV: no data.')
  })
})
