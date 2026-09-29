// @vitest-environment jsdom
// MonitorGrid (TASKS 5.4, look spec 4.8 and 4.12, UI_SPEC section 9): a virtualised TanStack grid on
// the grid.css classes, one Tab stop with aria-activedescendant, APG keys, Enter to drill down,
// header sorting, and rows registered for Number <GO>.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { resetMessage, useMessage } from '../chrome/MessageLine.store'
import { activateNumbered, numberedItems, registerNumbered, resetNumbered } from '../chrome/NumberedActions'
import { PanelActionsContext, type PanelActions } from '../chrome/PanelChrome.actions'
import { NumberingContext } from '../chrome/PanelChrome.numbers'
import { GRID } from '../copy/grids'
import MonitorGrid, { signTone, type MonitorColumn } from './MonitorGrid'
import { stubLayout } from './testing'

interface Quote {
  readonly sym: string
  readonly sector: string
  readonly last: number
  readonly chg: number | null
}

const QUOTES: Quote[] = [
  { sym: 'NQ', sector: 'Equity', last: 16320.25, chg: 0.42 },
  { sym: 'ES', sector: 'Equity', last: 4766.25, chg: -0.31 },
  { sym: 'ZN', sector: 'Rates', last: 130.19, chg: null },
  { sym: 'YM', sector: 'Equity', last: 36338.0, chg: 0.1 },
]

const COLUMNS: MonitorColumn<Quote>[] = [
  { id: 'sym', header: 'Name', width: 120, kind: 'name', value: (r) => r.sym },
  { id: 'last', header: 'Last', width: 90, kind: 'num', value: (r) => r.last, format: (r) => r.last.toFixed(2) },
  {
    id: 'chg', header: '1D', width: 70, kind: 'num', value: (r) => r.chg,
    format: (r) => (r.chg === null ? '--' : `${r.chg > 0 ? '+' : ''}${r.chg.toFixed(2)}`),
    tone: (r) => signTone(r.chg),
  },
]

const PANEL_ID = 'p-test'
const actions: PanelActions = { panelId: PANEL_ID, related: () => false, back: () => false, forward: () => false, open: () => false }

function Panel({ children }: { readonly children: ReactNode }) {
  return (
    <PanelActionsContext value={actions}>
      <NumberingContext value={registerNumbered}>{children}</NumberingContext>
    </PanelActionsContext>
  )
}

// jsdom has no layout: a 400px box per element, so the virtualiser renders a window.
beforeAll(() => stubLayout(400))

beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  resetMessage()
})

function grid(): HTMLElement {
  return screen.getByRole('grid')
}

function activeCell(): HTMLElement {
  const id = grid().getAttribute('aria-activedescendant')
  if (!id) throw new Error('no active descendant')
  const el = document.getElementById(id)
  if (!el) throw new Error(`active descendant ${id} is not rendered`)
  return el
}

function key(k: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(grid(), { key: k, ...init })
}

function bodyRows(): HTMLElement[] {
  return within(grid()).getAllByRole('row').filter((r) => r.closest('tbody'))
}

describe('MonitorGrid structure (look spec 4.8)', () => {
  it('is a grid named by its label on the grid.css classes, with a sticky 20px header and no zebra', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    const g = grid()
    expect(g.tagName).toBe('TABLE')
    expect(g.classList.contains('nqt-grid')).toBe(true)
    expect(g.closest('.nqt-grid-scroll')).not.toBeNull()
    expect(g).toHaveProperty('ariaLabel', 'Futures monitor')
    expect(g.getAttribute('aria-rowcount')).toBe('5')
    expect(g.getAttribute('aria-colcount')).toBe('4')
    const headers = within(g).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Number', 'Name', 'Last', '1D'])
  })

  it('writes names amber (.name), numbers right-aligned (.num) and signs as up and down text', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    const [nq, es, zn] = bodyRows()
    const cells = (row: HTMLElement | undefined) => within(row!).getAllByRole('gridcell')
    expect(cells(nq).map((c) => c.textContent)).toEqual(['1)', 'NQ', '16320.25', '+0.42'])
    expect(cells(nq)[0]?.classList.contains('hot')).toBe(true)
    expect(cells(nq)[1]?.classList.contains('name')).toBe(true)
    expect(cells(nq)[2]?.classList.contains('num')).toBe(true)
    expect(cells(nq)[3]?.classList.contains('up')).toBe(true)
    expect(cells(es)[3]?.classList.contains('down')).toBe(true)
    expect(cells(zn)[3]?.textContent).toBe('--')
  })

  it('shows sections as numbered white rows with their rows numbered 10) 11) ... (7.7)', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} />)
    const rows = bodyRows()
    expect(rows.map((r) => r.textContent?.slice(0, 6))).toEqual(['1) Equ', '10)NQ1', '11)ES4', '12)YM3', '2) Rat', '20)ZN1'])
    expect(rows[0]?.classList.contains('group-row')).toBe(true)
    expect(grid().getAttribute('aria-rowcount')).toBe('7')
  })

  it('renders only a window of a 10,000-row grid (virtualised)', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({ sym: `S${i}`, sector: 'Equity', last: i, chg: null }))
    render(<MonitorGrid label="Many" rows={many} columns={COLUMNS} rowId={(r) => r.sym} />)
    const rendered = bodyRows().length
    expect(rendered).toBeGreaterThan(10)
    expect(rendered).toBeLessThan(60)
    expect(grid().getAttribute('aria-rowcount')).toBe('10001')
    expect(bodyRows()[0]?.getAttribute('aria-rowindex')).toBe('2')
  })

  it('scroll="panel": renders every row and leaves the scrolling to the panel body (axe 2.1.1 on HOME)', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ sym: `S${i}`, sector: 'Equity', last: i, chg: null }))
    render(
      <div className="nqt-panel-body" tabIndex={0}>
        <MonitorGrid label="Panel" rows={many} columns={COLUMNS} rowId={(r) => r.sym} scroll="panel" />
      </div>,
    )
    expect(bodyRows()).toHaveLength(200)
    const box = grid().closest('.nqt-grid-scroll')
    expect(box?.classList.contains('nqt-grid-scroll--panel')).toBe(true)
    expect(document.querySelectorAll('tr.nqt-grid-spacer')).toHaveLength(0)
  })

  it('born failing: the default grid keeps its own scroll box and its window', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ sym: `S${i}`, sector: 'Equity', last: i, chg: null }))
    render(<MonitorGrid label="Own" rows={many} columns={COLUMNS} rowId={(r) => r.sym} />)
    expect(bodyRows().length).toBeLessThan(200)
    expect(grid().closest('.nqt-grid-scroll')?.classList.contains('nqt-grid-scroll--panel')).toBe(false)
  })

  it('applies a row class from rowClassName (the journal hatches plumbing rows this way)', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} rowClassName={(r) => (r.sym === 'ES' ? 'plumbing-row' : undefined)} />)
    expect(bodyRows()[1]?.classList.contains('plumbing-row')).toBe(true)
    expect(bodyRows()[0]?.classList.contains('plumbing-row')).toBe(false)
  })

  it('says so when there are no rows', () => {
    render(<MonitorGrid label="Empty" rows={[]} columns={COLUMNS} rowId={(r) => r.sym} emptyText="No rows yet." />)
    expect(within(grid()).getByText('No rows yet.')).toBeTruthy()
  })
})

describe('MonitorGrid keyboard (UI_SPEC 2.1.1, APG grid)', () => {
  it('is one Tab stop that marks its active cell, starting on the first row', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    expect(grid().tabIndex).toBe(0)
    expect(grid().hasAttribute('data-roving')).toBe(true)
    expect(activeCell().textContent).toBe('1)')
    expect(activeCell().classList.contains('is-active')).toBe(true)
    expect(bodyRows()[0]?.getAttribute('aria-selected')).toBe('true')
    expect(bodyRows()[1]?.getAttribute('aria-selected')).toBe('false')
  })

  // A grid that scrolls in its own box holds the panel's Tab stop (axe scrollable-region-focusable);
  // one whose rows the panel body scrolls leaves the stop to the body.
  it('marks a grid that scrolls in its own box as the Tab stop of its panel, and a panel-scrolled one not', () => {
    const { unmount } = render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    expect(grid().hasAttribute('data-roving-scroll')).toBe(true)
    unmount()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} scroll="panel" />)
    expect(grid().hasAttribute('data-roving-scroll')).toBe(false)
  })

  it('moves the active cell with the arrow keys and selects the active row', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    key('ArrowDown')
    key('ArrowRight')
    expect(activeCell().textContent).toBe('ES')
    expect(bodyRows()[1]?.getAttribute('aria-selected')).toBe('true')
    expect(bodyRows()[0]?.getAttribute('aria-selected')).toBe('false')
  })

  it('handles Right inside the row but leaves Left on the first cell to the panel', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    grid().dispatchEvent(left)
    expect(left.defaultPrevented).toBe(false)
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    act(() => {
      grid().dispatchEvent(right)
    })
    expect(right.defaultPrevented).toBe(true)
  })

  it('drills down with Enter on a row and on a double click (TASKS 5.4)', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onOpen={onOpen} />)
    key('ArrowDown')
    key('ArrowDown')
    key('Enter')
    expect(onOpen).toHaveBeenLastCalledWith(QUOTES[2])
    fireEvent.doubleClick(within(bodyRows()[3]!).getAllByRole('gridcell')[1]!)
    expect(onOpen).toHaveBeenLastCalledWith(QUOTES[3])
  })

  it('does not drill down from a section row', () => {
    const onOpen = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} onOpen={onOpen} />)
    key('Home', { ctrlKey: true })
    key('Enter')
    expect(onOpen).not.toHaveBeenCalled()
    expect(activeCell().textContent).toBe('1) Equity')
  })

  it('reaches the last of 10,000 rows with Control+End and opens it', async () => {
    const onOpen = vi.fn()
    const many = Array.from({ length: 10_000 }, (_, i) => ({ sym: `S${i}`, sector: 'Equity', last: i, chg: null }))
    render(<MonitorGrid label="Many" rows={many} columns={COLUMNS} rowId={(r) => r.sym} onOpen={onOpen} />)
    await act(async () => key('End', { ctrlKey: true }))
    expect(activeCell().textContent).toBe('--')
    expect(activeCell().closest('tr')?.getAttribute('aria-rowindex')).toBe('10001')
    key('Enter')
    expect(onOpen).toHaveBeenCalledWith(many[9_999])
  })

  it('sorts by a column with Enter on its header: ascending, then descending', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    key('ArrowUp')
    key('ArrowRight')
    key('ArrowRight')
    const header = activeCell()
    expect(header.textContent).toContain('Last')
    key('Enter')
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(bodyRows().map((r) => within(r).getAllByRole('gridcell')[1]?.textContent)).toEqual(['ZN', 'ES', 'NQ', 'YM'])
    key('Enter')
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(bodyRows().map((r) => within(r).getAllByRole('gridcell')[1]?.textContent)).toEqual(['YM', 'NQ', 'ES', 'ZN'])
  })

  it('puts missing values last whichever way a column is sorted', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} initialSort={{ id: 'chg', desc: true }} />)
    expect(bodyRows().map((r) => within(r).getAllByRole('gridcell')[1]?.textContent)).toEqual(['NQ', 'YM', 'ES', 'ZN'])
  })

  it('sorts from a pointer click on a header', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    const header = within(grid()).getAllByRole('columnheader')[1]!
    fireEvent.click(header)
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(bodyRows().map((r) => within(r).getAllByRole('gridcell')[1]?.textContent)).toEqual(['ES', 'NQ', 'YM', 'ZN'])
  })

  it('makes a clicked cell the active one', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    fireEvent.mouseDown(within(bodyRows()[2]!).getAllByRole('gridcell')[2]!)
    expect(activeCell().textContent).toBe('130.19')
  })
})

describe('MonitorGrid and Number <GO> (look spec 5.1 item 5)', () => {
  it('registers every numbered row for the panel, and N <GO> selects and opens row N', () => {
    const onOpen = vi.fn()
    render(<Panel><MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onOpen={onOpen} /></Panel>)
    expect(numberedItems(PANEL_ID).map((i) => `${i.n} ${i.label}`)).toEqual(['1 NQ', '2 ES', '3 ZN', '4 YM'])
    act(() => {
      expect(activateNumbered(PANEL_ID, 3)).toBe(true)
    })
    expect(onOpen).toHaveBeenCalledWith(QUOTES[2])
    expect(bodyRows()[2]?.getAttribute('aria-selected')).toBe('true')
  })

  it('uses the section numbers in a sectioned grid, and a section number moves to its section', () => {
    const onOpen = vi.fn()
    render(<Panel><MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} onOpen={onOpen} /></Panel>)
    expect(numberedItems(PANEL_ID).map((i) => i.n)).toEqual([1, 2, 10, 11, 12, 20])
    act(() => {
      activateNumbered(PANEL_ID, 11)
    })
    expect(onOpen).toHaveBeenCalledWith(QUOTES[1])
    act(() => {
      activateNumbered(PANEL_ID, 2)
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(activeCell().textContent).toBe('2) Rates')
  })

  // U26 (P-keys): a section heading is a hot-link number too, but selecting it used to post nothing.
  it('a heading number selects its section and posts what it holds, not a silent select', () => {
    const onOpen = vi.fn()
    render(<Panel><MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} onOpen={onOpen} /></Panel>)
    act(() => {
      expect(activateNumbered(PANEL_ID, 1)).toBe(true)
    })
    expect(onOpen).not.toHaveBeenCalled()
    expect(activeCell().textContent).toBe('1) Equity')
    expect(useMessage.getState().text).toBe('1) Equity is a heading: rows 10 to 12.')
  })

  it('drops its registration when it unmounts', () => {
    const view = render(<Panel><MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} /></Panel>)
    view.unmount()
    expect(numberedItems(PANEL_ID)).toEqual([])
  })
})

describe('signTone', () => {
  it('maps the sign of a value to the up and down text tones, and zero or missing to none', () => {
    expect(signTone(0.1)).toBe('up')
    expect(signTone(-0.1)).toBe('down')
    expect(signTone(0)).toBeUndefined()
    expect(signTone(null)).toBeUndefined()
    expect(signTone(Number.NaN)).toBeUndefined()
  })
})

// Row marking (roadmap 9): opt-in through onMark. Space on the active data row asks the screen to mark
// it; the grid only draws what `marked` says (a fill, an ASCII plus and a screen reader word).
describe('MonitorGrid row marking (opt-in)', () => {
  const SPACE = ' '

  function hintText(): string {
    const id = grid().getAttribute('aria-describedby')
    const el = id ? document.getElementById(id) : null
    if (!el) throw new Error('no hint element')
    return el.textContent ?? ''
  }

  const numberCell = (row: HTMLElement | undefined) => within(row!).getAllByRole('gridcell')[0]!

  it('Space on the active data row calls onMark with that row and stops the page scrolling', () => {
    const onMark = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={onMark} />)
    key('ArrowDown')
    const notPrevented = fireEvent.keyDown(grid(), { key: SPACE })
    expect(onMark).toHaveBeenCalledTimes(1)
    expect(onMark).toHaveBeenCalledWith(QUOTES[1])
    expect(notPrevented).toBe(false)
  })

  it('marks the row it is on after a sort, not the row at that position in the source', () => {
    const onMark = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={onMark} initialSort={{ id: 'last', desc: true }} />)
    key(SPACE)
    expect(onMark).toHaveBeenLastCalledWith(QUOTES[3])
  })

  it('does not mark from a header cell or a section row', () => {
    const onMark = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} onMark={onMark} />)
    expect(activeCell().textContent).toBe('1) Equity')
    expect(fireEvent.keyDown(grid(), { key: SPACE })).toBe(true)
    key('ArrowUp')
    expect(activeCell().tagName).toBe('TH')
    expect(fireEvent.keyDown(grid(), { key: SPACE })).toBe(true)
    expect(onMark).not.toHaveBeenCalled()
  })

  it('leaves Space alone without onMark: the default is not prevented and nothing is marked', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    expect(fireEvent.keyDown(grid(), { key: SPACE })).toBe(true)
    expect(document.querySelectorAll('tr[data-marked], .mark-glyph')).toHaveLength(0)
  })

  it('leaves Control+Space and Shift+Space to the browser and ignores a held key', () => {
    const onMark = vi.fn()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={onMark} />)
    expect(fireEvent.keyDown(grid(), { key: SPACE, ctrlKey: true })).toBe(true)
    expect(fireEvent.keyDown(grid(), { key: SPACE, shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(grid(), { key: SPACE, metaKey: true })).toBe(true)
    expect(fireEvent.keyDown(grid(), { key: SPACE, altKey: true })).toBe(true)
    expect(onMark).not.toHaveBeenCalled()
    // A held Space repeats keydown: only the first press toggles, and the page still does not scroll.
    fireEvent.keyDown(grid(), { key: SPACE })
    expect(fireEvent.keyDown(grid(), { key: SPACE, repeat: true })).toBe(false)
    expect(onMark).toHaveBeenCalledTimes(1)
  })

  it('draws a marked row with data-marked, an ASCII plus and the word marked for screen readers', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set(['ES', 'YM'])} />)
    const rows = bodyRows()
    expect(rows.map((r) => r.getAttribute('data-marked'))).toEqual([null, 'true', null, 'true'])
    const cell = numberCell(rows[1])
    const glyph = cell.querySelector('.mark-glyph')
    expect(glyph?.textContent).toBe('+')
    expect(glyph?.textContent).toBe(GRID.markGlyph)
    expect(GRID.markGlyph).toMatch(/^[\x21-\x7e]$/)
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(cell.querySelector('.sr-only')?.textContent).toBe(GRID.marked)
    expect(cell.textContent).toContain('2)')
  })

  it('draws nothing extra on unmarked rows: same number text, no glyph, no sr word', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set(['ES'])} />)
    const plain = numberCell(bodyRows()[0])
    expect(plain.textContent).toBe('1)')
    expect(plain.querySelector('.mark-glyph')).toBeNull()
    expect(plain.querySelector('.sr-only')).toBeNull()
    expect(document.querySelectorAll('.mark-glyph')).toHaveLength(1)
  })

  it('marks by row id, so a marked row keeps its mark when the sort moves it', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set(['NQ'])} initialSort={{ id: 'last', desc: true }} />)
    const marked = bodyRows().filter((r) => r.hasAttribute('data-marked'))
    expect(marked).toHaveLength(1)
    expect(within(marked[0]!).getAllByRole('gridcell')[1]?.textContent).toBe('NQ')
  })

  it('keeps aria-selected for the active row only: marking never changes it', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set(['ES', 'NQ'])} />)
    expect(bodyRows().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    key('ArrowDown')
    key('ArrowDown')
    expect(bodyRows().map((r) => r.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false'])
  })

  it('marks data rows only: a section row never carries data-marked', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} groupOf={(r) => r.sector} onMark={() => {}} marked={new Set(['Equity', 'NQ'])} />)
    expect(bodyRows().map((r) => r.hasAttribute('data-marked'))).toEqual([false, true, false, false, false, false])
  })

  it('updates the marks when the set changes and clears them when it empties', () => {
    const { rerender } = render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set(['ZN'])} />)
    expect(document.querySelectorAll('tr[data-marked]')).toHaveLength(1)
    rerender(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} marked={new Set()} />)
    expect(document.querySelectorAll('tr[data-marked]')).toHaveLength(0)
    expect(document.querySelectorAll('.mark-glyph')).toHaveLength(0)
  })

  it('still shows the glyph and the word without a number column (numbered false), in the first cell', () => {
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} numbered={false} onMark={() => {}} marked={new Set(['ES'])} />)
    const row = bodyRows()[1]!
    expect(row.getAttribute('data-marked')).toBe('true')
    const first = within(row).getAllByRole('gridcell')[0]!
    expect(first.querySelector('.mark-glyph')?.textContent).toBe(GRID.markGlyph)
    expect(first.querySelector('.sr-only')?.textContent).toBe(GRID.marked)
    expect(first.textContent).toContain('ES')
  })

  it('adds the marking hint to the grid description only when onMark is given', () => {
    const { unmount } = render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} />)
    expect(hintText()).toBe(GRID.keysHint)
    expect(hintText()).not.toContain(GRID.markHint)
    unmount()
    render(<MonitorGrid label="Futures monitor" rows={QUOTES} columns={COLUMNS} rowId={(r) => r.sym} onMark={() => {}} />)
    expect(hintText()).toBe(`${GRID.keysHint} ${GRID.markHint}`)
    expect(GRID.markHint).toBe('Space marks the row for 95) Compare.')
  })
})
