// @vitest-environment jsdom
// DQ universe matrix: a grid named by its heading, one tab stop, cells named by their counts, arrow keys, the
// readout, the sealed last bar, the repair status and the blocks in words; the [POST HOC] label verbatim.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ROVING_ATTR, usePanelRoving } from '../../chrome/WorkspaceFocus'
import UniverseMatrix from './UniverseMatrix'
import type { DqUniverse, UniverseCounts, UniverseRoot, UniverseRow } from './universeModel'

const YEARS = [2010, 2011, 2012]
const LABEL = '[POST HOC] descriptive: day states read from the QA reports and repair records'

function counts(sessions: number, usable: number, gated = 0, unrep = 0, rej = 0): UniverseCounts {
  return { sessions, usable, gated_out: gated, unrepairable: unrep, rejected: rej, usable_share: sessions === 0 ? null : usable / sessions }
}

function row(variant: 'vendor' | 'repaired', byYear: Record<number, UniverseCounts>): UniverseRow {
  const cells = YEARS.map((year) => ({ year, ...(byYear[year] ?? counts(0, 0)) }))
  const sessions = cells.reduce((a, c) => a + c.sessions, 0)
  const usable = cells.reduce((a, c) => a + c.usable, 0)
  return { timeframe: '1m', variant, cells, total: counts(sessions, usable) }
}

function root(over: Partial<UniverseRoot> & { root: string }): UniverseRoot {
  return {
    symbol: `${over.root}.V.0`, repair_status: 'v1', source: 'results/x.json', qa_source: 'results/qa.json',
    first_bar: '2010-09-30', last_bar: '2021-12-31', last_sealed: false, rows: [], daily: null, blocks: [], ...over,
  }
}

const UNIVERSE: DqUniverse = {
  label: LABEL, fence: '2021-12-31', years: YEARS, missing: [],
  roots: [
    root({ root: 'GC', rows: [row('vendor', { 2011: counts(100, 90, 8, 2) }), row('repaired', { 2011: counts(100, 98, 0, 2) })],
      daily: { source: 'results/qa_report_carry_1d.json', rows: 2860, first_bar: '2010-09-30', last_bar: '2021-12-31', last_sealed: false, missing_nyse_sessions: 6 } }),
    root({ root: 'NQ', repair_status: 'nq', last_bar: '2021-12-31 or later, sealed', last_sealed: true, rows: [row('vendor', { 2010: counts(50, 50) })] }),
    root({ root: 'ES', repair_status: 'vendor_only', rows: [row('vendor', { 2012: counts(10, 4, 6) })], blocks: ["validation FAIL: failed checks ['H']"] }),
  ],
}

afterEach(cleanup)

/** A stand-in for PanelChrome's frame (as LearnedCount.test.tsx): the panel element with its roving handler, and a roving control above the grid. */
function Frame({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const onKeyDown = usePanelRoving(ref)
  return (
    <section ref={ref} data-testid="panel" onKeyDown={onKeyDown}>
      <button type="button" {...{ [ROVING_ATTR]: '' }}>Control above</button>
      {children}
    </section>
  )
}

describe('UniverseMatrix', () => {
  it('shows the API label verbatim and a grid named by its heading', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    expect(screen.getByText(LABEL)).toBeTruthy()
    const grid = screen.getByRole('grid', { name: 'Data usability, every root by year' })
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      ['Root', 'Series', 'Repair', 'First bar', 'Last bar', '2010', '2011', '2012', 'All years', 'Known blocks'])
    expect(within(grid).getAllByRole('row')).toHaveLength(1 + 3 + 2 + 2) // the header, then GC (vendor, repaired, 1d), NQ (vendor, 1d), ES (vendor, 1d)
  })

  it('names each year cell by its counts and prints the share as text', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    const cell = screen.getByRole('gridcell', { name: 'GC 1m vendor 2011: 90 of 100 sessions usable, 90.0%. Gated out 8, unrepairable 2, rejected 0.' })
    expect(cell.textContent).toBe('90.0%')
    expect(cell.getAttribute('aria-label')).toContain('Gated out 8')
    expect(screen.getByRole('gridcell', { name: 'GC 1m vendor 2010: no session in the records.' }).textContent).toBe('--')
  })

  it('has one tab stop that the arrow keys move, with the readout following', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    const stops = () => screen.getAllByRole('gridcell').concat(screen.getAllByRole('rowheader')).filter((c) => c.getAttribute('tabindex') === '0')
    expect(stops()).toHaveLength(1)
    expect(stops()[0]!.textContent).toBe('GC')
    const grid = screen.getByRole('grid')
    act(() => stops()[0]!.focus())
    expect(screen.getByRole('status').textContent).toBe('GC')
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(document.activeElement?.textContent).toBe('1m vendor')
    fireEvent.keyDown(grid, { key: 'End' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('GC 1m vendor Known blocks: --')
    fireEvent.keyDown(grid, { key: 'Home' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('GC')
    expect(stops()).toHaveLength(1)
    expect(stops()[0]).toBe(document.activeElement)
    fireEvent.keyDown(grid, { key: 'PageDown' })
    expect(document.activeElement?.closest('tr')?.textContent).toContain('ES1d')
    expect(screen.getByRole('status').textContent).toBe('ES')
  })

  it('makes every cell a roving item of the panel and the active cell its entry, so the workspace keeps it as the one Tab stop', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    const grid = screen.getByRole('grid')
    const cells = [...grid.querySelectorAll('td, tbody th')]
    expect(cells.length).toBeGreaterThan(20)
    expect(cells.filter((cell) => !cell.hasAttribute('data-roving')).map((cell) => cell.getAttribute('aria-label'))).toEqual([])
    const entries = cells.filter((cell) => cell.hasAttribute('data-roving-entry'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.getAttribute('tabindex')).toBe('0')
  })

  it('reads a clicked cell into the readout', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    const cell = screen.getByRole('gridcell', { name: /^ES 1m vendor 2012:/ })
    act(() => cell.focus())
    expect(screen.getByRole('status').textContent).toBe('ES 1m vendor 2012: 4 of 10 sessions usable, 40.0%. Gated out 6, unrepairable 0, rejected 0.')
  })

  it('says the last bar of NQ is sealed, never a date after the fence', () => {
    const { container } = render(<UniverseMatrix universe={UNIVERSE} />)
    const nq = screen.getAllByRole('row').find((r) => within(r).queryByRole('rowheader', { name: 'NQ' }))!
    expect(within(nq).getByText('2021-12-31 or later, sealed')).toBeTruthy()
    expect(container.textContent).not.toMatch(/202[2-9]/)
  })

  it('writes the repair status and the quoted block in words', () => {
    render(<UniverseMatrix universe={UNIVERSE} />)
    expect(screen.getAllByText('Vendor only, every candidate excluded').length).toBeGreaterThan(0)
    expect(screen.getByText("validation FAIL: failed checks ['H']")).toBeTruthy()
    expect(screen.getAllByText('NQ repair').length).toBeGreaterThan(0)
    expect(screen.getByText('2,860 bars')).toBeTruthy()
  })

  it('names the files it could not read', () => {
    render(<UniverseMatrix universe={{ ...UNIVERSE, missing: ['results/qa_report_carry_1d.json'] }} />)
    expect(screen.getByText('Not read: results/qa_report_carry_1d.json')).toBeTruthy()
  })

  it('hands ArrowUp on the first row to the panel, so the control above the grid is reached by keyboard', () => {
    render(<Frame><UniverseMatrix universe={UNIVERSE} /></Frame>)
    const entry = document.querySelector<HTMLElement>('[data-roving-entry]')!
    act(() => entry.focus())
    expect(document.activeElement).toBe(entry)
    fireEvent.keyDown(entry, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Control above' }))
  })

  it('still moves up inside the grid below the first row', () => {
    render(<Frame><UniverseMatrix universe={UNIVERSE} /></Frame>)
    const grid = screen.getByRole('grid')
    act(() => document.querySelector<HTMLElement>('[data-roving-entry]')!.focus())
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid.querySelector('[data-roving-entry]')!, { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toBe('GC')
    expect(document.activeElement?.closest('tr')?.textContent).toContain('GC')
  })
})
