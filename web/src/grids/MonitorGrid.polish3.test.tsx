// @vitest-environment jsdom
// Polish 3 on MonitorGrid (dogfood round):
//  - G19: the described-by hint promises 'Enter on a row opens it' only when the grid has an onOpen;
//  - G20: Shift+Enter (and Shift with a double click) asks onOpen for a new panel, as HELP promises;
//  - U08: a cell that is cut to an ellipsis carries its full text as a title on hover, and the active
//    truncated cell's full text is echoed on the message line (keyboard users have no hover).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessage, useMessage } from '../chrome/MessageLine.store'
import { resetNumbered } from '../chrome/NumberedActions'
import { GRID } from '../copy/grids'
import MonitorGrid, { type MonitorColumn } from './MonitorGrid'
import { stubLayout } from './testing'

interface Row {
  readonly id: string
  readonly reason: string
}

const LONG = 'pre-registered za_v0_C3_gao_momentum screen over the whole in-sample window'
const ROWS: Row[] = [
  { id: 'a', reason: 'short' },
  { id: 'b', reason: LONG },
  { id: 'c', reason: 'also short' },
]

const COLUMNS: MonitorColumn<Row>[] = [
  { id: 'id', header: 'Id', width: 60, kind: 'name', value: (r) => r.id },
  { id: 'reason', header: 'Reason', width: 400, kind: 'text', value: (r) => r.reason },
]

beforeAll(() => stubLayout(400))
beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  resetMessage()
  vi.restoreAllMocks()
})

const grid = () => screen.getByRole('grid')
const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(grid(), { key: k, ...init })
const bodyRows = () => within(grid()).getAllByRole('row').filter((r) => r.closest('tbody'))
const cellsOf = (row: HTMLElement | undefined) => within(row!).getAllByRole('gridcell')

function hintText(): string {
  const id = grid().getAttribute('aria-describedby')
  const el = id ? document.getElementById(id) : null
  if (!el) throw new Error('no hint element')
  return el.textContent ?? ''
}

const props = { label: 'Log', rows: ROWS, columns: COLUMNS, rowId: (r: Row) => r.id }

describe('G19: the hint says Enter opens a row only when the grid can open one', () => {
  it('a grid without onOpen does not announce that Enter opens a row, but keeps the rest', () => {
    render(<MonitorGrid {...props} />)
    expect(hintText()).not.toContain('Enter on a row opens it')
    expect(hintText()).toContain('Enter on a column header sorts by it')
    expect(hintText()).toBe(GRID.keysHint)
  })

  it('a grid with onOpen announces it', () => {
    render(<MonitorGrid {...props} onOpen={() => {}} />)
    expect(hintText()).toContain('Enter on a row opens it')
    expect(hintText()).toBe(`${GRID.keysHint} ${GRID.openHint}`)
  })

  it('adds the marking hint after the opening hint when both are given', () => {
    render(<MonitorGrid {...props} onOpen={() => {}} onMark={() => {}} />)
    expect(hintText()).toBe(`${GRID.keysHint} ${GRID.openHint} ${GRID.markHint}`)
  })
})

describe('G20: Shift+Enter opens the drill in a new panel', () => {
  it('Shift+Enter on a data row calls onOpen(row, { newPanel: true })', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid {...props} onOpen={onOpen} />)
    key('ArrowDown')
    key('Enter', { shiftKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], { newPanel: true })
  })

  it('a plain Enter still calls onOpen with the row alone', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid {...props} onOpen={onOpen} />)
    key('ArrowDown')
    key('Enter')
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1])
    expect(onOpen.mock.lastCall).toHaveLength(1)
  })

  it('a double click opens in place, and a Shift double click opens in a new panel', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid {...props} onOpen={onOpen} />)
    fireEvent.doubleClick(cellsOf(bodyRows()[2])[1]!)
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[2])
    fireEvent.doubleClick(cellsOf(bodyRows()[0])[1]!, { shiftKey: true })
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], { newPanel: true })
  })

  it('Shift+Enter on a header still sorts and opens nothing', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid {...props} onOpen={onOpen} />)
    key('ArrowUp')
    key('ArrowRight')
    key('Enter', { shiftKey: true })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Shift+Enter on a grid without onOpen does nothing and still swallows the key', () => {
    render(<MonitorGrid {...props} />)
    key('ArrowDown')
    expect(fireEvent.keyDown(grid(), { key: 'Enter', shiftKey: true })).toBe(false)
  })
})

// jsdom has no layout, so scrollWidth and clientWidth are 0. A cell is cut when its text is wider than
// 60px at 5px a character, which the test's own 60px cell width fixes.
function stubCutCells(): void {
  const define = (name: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get(this: HTMLElement) { return this.tagName === 'TD' || this.tagName === 'TH' ? get(this) : 0 } })
  define('scrollWidth', (el) => (el.textContent ?? '').length * 5)
  define('clientWidth', () => 60)
}

describe('U08: the full text of a cell that is cut to an ellipsis', () => {
  beforeEach(() => stubCutCells())

  it('sets the full text as the title on hover of a cut cell, and none on a cell that fits', () => {
    render(<MonitorGrid {...props} />)
    const long = cellsOf(bodyRows()[1])[2]!
    const short = cellsOf(bodyRows()[0])[2]!
    fireEvent.mouseOver(long)
    fireEvent.mouseOver(short)
    expect(long.getAttribute('title')).toBe(LONG)
    expect(short.hasAttribute('title')).toBe(false)
  })

  it('titles a cell only once it is hovered (no measuring of a whole grid on render)', () => {
    render(<MonitorGrid {...props} />)
    expect(document.querySelectorAll('td[title]')).toHaveLength(0)
  })

  it('takes the title back when the cell no longer overflows', () => {
    render(<MonitorGrid {...props} />)
    const long = cellsOf(bodyRows()[1])[2]!
    fireEvent.mouseOver(long)
    expect(long.getAttribute('title')).toBe(LONG)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 10_000 })
    fireEvent.mouseOver(long)
    expect(long.hasAttribute('title')).toBe(false)
  })

  it('titles the text of a nested element hovered inside the cell', () => {
    const cols: MonitorColumn<Row>[] = [
      { id: 'id', header: 'Id', width: 60, kind: 'name', value: (r) => r.id },
      { id: 'reason', header: 'Reason', width: 400, kind: 'text', value: (r) => r.reason, render: (r) => <span data-testid="inner">{r.reason}</span> },
    ]
    render(<MonitorGrid {...props} columns={cols} />)
    fireEvent.mouseOver(screen.getAllByTestId('inner')[1]!)
    expect(cellsOf(bodyRows()[1])[2]!.getAttribute('title')).toBe(LONG)
  })

  it('echoes the full text of a cut active cell on the message line as the arrows reach it', () => {
    render(<MonitorGrid {...props} />)
    expect(useMessage.getState().text).toBe('')
    key('ArrowRight')
    key('ArrowRight')
    expect(useMessage.getState().text).toBe('')
    key('ArrowDown')
    expect(useMessage.getState().text).toBe(LONG)
    expect(useMessage.getState().tone).toBe('info')
  })

  it('posts nothing for a cell that fits, and never on mount', () => {
    render(<MonitorGrid {...props} />)
    expect(useMessage.getState().text).toBe('')
    key('End', { ctrlKey: true })
    expect(cellsOf(bodyRows()[2])[2]!.textContent).toBe('also short')
    expect(useMessage.getState().text).toBe('')
  })

  it('does not echo a header cell, however long its text', () => {
    const cols: MonitorColumn<Row>[] = [
      { id: 'id', header: 'Id', width: 60, kind: 'name', value: (r) => r.id },
      { id: 'reason', header: 'A header that is much longer than its column', width: 60, kind: 'text', value: (r) => r.reason },
    ]
    render(<MonitorGrid {...props} columns={cols} />)
    key('ArrowUp')
    key('ArrowRight')
    key('ArrowRight')
    expect(grid().getAttribute('aria-activedescendant')).toMatch(/-h2$/)
    expect(useMessage.getState().text).toBe('')
  })
})
