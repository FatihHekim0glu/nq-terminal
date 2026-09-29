// @vitest-environment jsdom
// U09 on MonitorGrid: a grid that is a panel's entry point (tabStop) carries data-roving-entry and lets
// ArrowUp on its header row reach the panel; and every grid gets type-ahead, so with the grid focused a
// letter jumps to the next row whose name starts with it (component-scoped, so allowed under WCAG 2.1.4).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessage } from '../chrome/MessageLine.store'
import { resetNumbered } from '../chrome/NumberedActions'
import { ROVING_ENTRY_ATTR } from '../chrome/WorkspaceFocus'
import MonitorGrid, { type MonitorColumn } from './MonitorGrid'
import { stubLayout } from './testing'

interface Hyp {
  readonly name: string
  readonly round: number
  readonly sector: string
}

const ROWS: Hyp[] = [
  { name: 'overnight_v0', round: 1, sector: 'Edge' },
  { name: 'volmanaged_v0', round: 2, sector: 'Edge' },
  { name: 'za_v0', round: 3, sector: 'Edge' },
  { name: 'za_v0_C3_gao_momentum', round: 3, sector: 'Check' },
  { name: 'zulu_v1', round: 4, sector: 'Check' },
  { name: 'Alpha_v2', round: 5, sector: 'Check' },
]

const COLUMNS: MonitorColumn<Hyp>[] = [
  { id: 'round', header: 'Round', width: 50, kind: 'num', value: (r) => r.round },
  { id: 'name', header: 'Name', width: 140, kind: 'name', value: (r) => r.name },
]

beforeAll(() => stubLayout(400))
beforeEach(() => resetNumbered())
afterEach(() => {
  cleanup()
  resetMessage()
  vi.useRealTimers()
})

const grid = () => screen.getByRole('grid')
const press = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(grid(), { key: k, ...init })
const props = { label: 'Registry', rows: ROWS, columns: COLUMNS, rowId: (r: Hyp) => r.name, rowLabel: (r: Hyp) => r.name }

/** The text of the active data row's name cell (the grid's active descendant is in that row). */
function activeName(): string {
  const id = grid().getAttribute('aria-activedescendant')
  const cell = id ? document.getElementById(id) : null
  const row = cell?.closest('tr')
  return within(row as HTMLElement).getAllByRole('gridcell')[2]?.textContent ?? ''
}

describe('tabStop: the grid is the panel entry point (U09)', () => {
  it('carries data-roving-entry only when asked', () => {
    const { unmount } = render(<MonitorGrid {...props} />)
    expect(grid().hasAttribute(ROVING_ENTRY_ATTR)).toBe(false)
    unmount()
    render(<MonitorGrid {...props} tabStop />)
    expect(grid().hasAttribute(ROVING_ENTRY_ATTR)).toBe(true)
    expect(grid().hasAttribute('data-roving')).toBe(true)
  })

  it('ArrowUp on the header row is left to the panel for a tab stop grid, and swallowed otherwise', () => {
    const { unmount } = render(<MonitorGrid {...props} />)
    press('ArrowUp')
    expect(grid().getAttribute('aria-activedescendant')).toMatch(/-h0$/)
    expect(fireEvent.keyDown(grid(), { key: 'ArrowUp' })).toBe(false)
    unmount()
    render(<MonitorGrid {...props} tabStop />)
    press('ArrowUp')
    expect(fireEvent.keyDown(grid(), { key: 'ArrowUp' })).toBe(true)
  })

  it('ArrowUp on a data row still moves up inside a tab stop grid', () => {
    render(<MonitorGrid {...props} tabStop />)
    press('ArrowDown')
    expect(fireEvent.keyDown(grid(), { key: 'ArrowUp' })).toBe(false)
    expect(activeName()).toBe('overnight_v0')
  })
})

describe('type-ahead: a letter jumps to the next row whose name starts with it (U09)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
  })

  it('jumps to the first matching row after the active one, and swallows the key', () => {
    render(<MonitorGrid {...props} />)
    expect(fireEvent.keyDown(grid(), { key: 'v' })).toBe(false)
    expect(activeName()).toBe('volmanaged_v0')
  })

  it('is case insensitive in both directions', () => {
    render(<MonitorGrid {...props} />)
    press('A')
    expect(activeName()).toBe('Alpha_v2')
    vi.setSystemTime(1_005_000)
    press('O')
    expect(activeName()).toBe('overnight_v0')
  })

  it('builds a prefix from keys typed close together, searching from the row it is on', () => {
    render(<MonitorGrid {...props} />)
    press('z')
    expect(activeName()).toBe('za_v0')
    vi.setSystemTime(1_000_200)
    press('a')
    expect(activeName()).toBe('za_v0')
    vi.setSystemTime(1_000_400)
    press('_')
    press('v')
    press('0')
    press('_')
    press('c')
    expect(activeName()).toBe('za_v0_C3_gao_momentum')
  })

  it('starts a new prefix after a pause', () => {
    render(<MonitorGrid {...props} />)
    press('z')
    expect(activeName()).toBe('za_v0')
    vi.setSystemTime(1_002_000)
    press('o')
    expect(activeName()).toBe('overnight_v0')
  })

  it('repeating one letter cycles through every row that starts with it, wrapping round', () => {
    render(<MonitorGrid {...props} />)
    press('z')
    expect(activeName()).toBe('za_v0')
    press('z')
    expect(activeName()).toBe('za_v0_C3_gao_momentum')
    press('z')
    expect(activeName()).toBe('zulu_v1')
    press('z')
    expect(activeName()).toBe('za_v0')
  })

  it('leaves the active row and the key alone when nothing matches', () => {
    render(<MonitorGrid {...props} />)
    press('ArrowDown')
    expect(fireEvent.keyDown(grid(), { key: 'q' })).toBe(true)
    expect(activeName()).toBe('volmanaged_v0')
  })

  it('searches from the header row too, and keeps the column', () => {
    render(<MonitorGrid {...props} />)
    press('ArrowUp')
    press('ArrowRight')
    press('z')
    expect(activeName()).toBe('za_v0')
    expect(grid().getAttribute('aria-activedescendant')).toMatch(/-r2c1$/)
  })

  it('ignores shortcut chords, Space, named keys and a composing keystroke', () => {
    render(<MonitorGrid {...props} onMark={() => {}} />)
    press('z', { ctrlKey: true })
    press('z', { metaKey: true })
    press('z', { altKey: true })
    press(' ')
    press('Shift')
    press('F1')
    expect(grid().getAttribute('aria-activedescendant')).toMatch(/-r0c0$/)
  })

  it('reads the name from the first column when no rowLabel is given', () => {
    render(<MonitorGrid label="Registry" rows={ROWS} columns={[COLUMNS[1]!]} rowId={(r) => r.name} />)
    press('z')
    const id = grid().getAttribute('aria-activedescendant')!
    expect(document.getElementById(id)?.closest('tr')?.textContent).toContain('za_v0')
  })

  it('skips section headings and does nothing on an empty grid', () => {
    const { unmount } = render(<MonitorGrid {...props} groupOf={(r) => r.sector} />)
    press('E')
    expect(grid().getAttribute('aria-activedescendant')).toMatch(/-r0g$/)
    unmount()
    render(<MonitorGrid {...props} rows={[]} />)
    expect(fireEvent.keyDown(grid(), { key: 'z' })).toBe(true)
  })

  it('the hint tells keyboard users about it', () => {
    render(<MonitorGrid {...props} />)
    const hint = document.getElementById(grid().getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toContain('Type a letter')
  })
})
