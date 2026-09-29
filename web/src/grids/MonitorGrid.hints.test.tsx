// @vitest-environment jsdom
// U03 (tooltips): a column header can explain itself. REG and MT's Holm, BH q, Hash ok and Amend were bare
// words; a header now carries a hint, shown as the house tooltip when the pointer rests on it and read out
// on the message line when the header becomes the active cell by keyboard (the grid never moves DOM focus,
// so the tooltip's focus path cannot fire). A column may name its own hint; the shared ones live in
// copy/grids.ts keyed by the header text.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessage, useMessage } from '../chrome/MessageLine.store'
import { resetNumbered } from '../chrome/NumberedActions'
import { TOOLTIP_DELAY_MS } from '../chrome/Tooltip'
import { COLUMN_HINTS } from '../copy/grids'
import MonitorGrid, { type MonitorColumn } from './MonitorGrid'
import { stubLayout } from './testing'

interface Row {
  readonly id: string
  readonly holm: number
}

const ROWS: Row[] = [{ id: 'a', holm: 0.02 }]

const COLUMNS: MonitorColumn<Row>[] = [
  { id: 'id', header: 'Name', width: 100, kind: 'name', value: (r) => r.id },
  { id: 'holm', header: 'Holm', width: 60, kind: 'num', value: (r) => r.holm },
  { id: 'own', header: 'Own', width: 60, kind: 'num', value: (r) => r.holm, hint: 'A hint the column names itself.' },
  { id: 'holmOwn', header: 'BH q', width: 60, kind: 'num', value: (r) => r.holm, hint: 'Overrides the shared hint.' },
]

beforeAll(() => stubLayout(400))
beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  resetMessage()
  vi.useRealTimers()
})

const grid = () => screen.getByRole('grid')
const header = (name: string) => within(grid()).getByRole('columnheader', { name: new RegExp(`^${name}`) })
const props = { label: 'Registry', rows: ROWS, columns: COLUMNS, rowId: (r: Row) => r.id }

describe('column hints (U03)', () => {
  it('a known header word gets the shared hint without the column saying anything', () => {
    render(<MonitorGrid {...props} />)
    expect(header('Holm').getAttribute('data-hint')).toBe(COLUMN_HINTS.Holm)
    expect(COLUMN_HINTS.Holm).toMatch(/Holm/)
  })

  it('a column\'s own hint wins over the shared one for the same header', () => {
    render(<MonitorGrid {...props} />)
    expect(header('BH q').getAttribute('data-hint')).toBe('Overrides the shared hint.')
    expect(header('Own').getAttribute('data-hint')).toBe('A hint the column names itself.')
  })

  it('a header with no hint carries none and no tooltip wrapper', () => {
    render(<MonitorGrid {...props} />)
    expect(header('Name').hasAttribute('data-hint')).toBe(false)
    expect(header('Name').hasAttribute('aria-describedby')).toBe(false)
  })

  it('shows the house tooltip after the pointer rests on the header, and hides it when it leaves', () => {
    vi.useFakeTimers()
    render(<MonitorGrid {...props} />)
    const th = header('Holm')
    fireEvent.pointerMove(th, { clientX: 10, clientY: 10 })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS))
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toBe(COLUMN_HINTS.Holm)
    expect(th.getAttribute('aria-describedby')).toBe(tip.id)
    fireEvent.pointerLeave(th, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('still sorts on a click of a header that has a hint', () => {
    render(<MonitorGrid {...props} />)
    fireEvent.click(header('Holm'))
    expect(header('Holm').getAttribute('aria-sort')).toBe('ascending')
  })

  it('reads the hint out on the message line when the keyboard reaches the header', () => {
    render(<MonitorGrid {...props} />)
    fireEvent.keyDown(grid(), { key: 'ArrowUp' })
    expect(useMessage.getState().text).toBe('')
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(useMessage.getState().text).toBe('')
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(useMessage.getState().text).toBe(COLUMN_HINTS.Holm)
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    expect(useMessage.getState().text).toBe('A hint the column names itself.')
  })
})
