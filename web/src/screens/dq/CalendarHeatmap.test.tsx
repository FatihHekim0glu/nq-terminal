// @vitest-environment jsdom
// D37: the calendar heatmap must give Left, Right, Up and Down back once keyStep can no longer move
// (the first or last date), or a roving panel's other items (the flagged grid, the Table toggle)
// become unreachable by arrows once the calendar holds the panel's one Tab stop.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePanelRoving } from '../../chrome/WorkspaceFocus'
import { CHART } from '../../copy/workspace'
import CalendarHeatmap from './CalendarHeatmap'
import type { DqCounts, DqDay } from './types'

/** A panel using the real roving-focus hook, so D37 can be tested end to end. */
function Panel({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = usePanelRoving(ref)
  return (
    <div ref={ref} onKeyDown={onKeyDown}>
      <button data-roving="">Prev</button>
      {children}
      <button data-roving="">Next</button>
    </div>
  )
}

const DAYS: DqDay[] = [
  { date: '2011-01-03', state: 'vendor', reason: null },
  { date: '2011-01-04', state: 'rebuilt', reason: 'rebuilt from trade prints' },
  { date: '2011-01-05', state: 'vendor', reason: null },
]
const COUNTS: DqCounts = { vendor: 2, gated_out: 0, rejected: 0, rebuilt: 1, unrepairable: 0, sessions: 3 }

afterEach(cleanup)

function renderBare() {
  render(<CalendarHeatmap symbol="GC.V.0" days={DAYS} counts={COUNTS} fence="2021-12-31" selected={null} />)
  return screen.getByRole('img')
}

function renderCalendar() {
  render(
    <Panel>
      <CalendarHeatmap symbol="GC.V.0" days={DAYS} counts={COUNTS} fence="2021-12-31" selected={null} />
    </Panel>,
  )
  return screen.getByRole('img')
}

describe('CalendarHeatmap keyboard (D37)', () => {
  it('releases Left and Up at the first date, without a roving panel', () => {
    const figure = renderBare()
    fireEvent.keyDown(figure, { key: 'Home' })
    expect(fireEvent.keyDown(figure, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(figure, { key: 'ArrowUp' })).toBe(true)
  })

  it('releases Right and Down at the last date, without a roving panel', () => {
    const figure = renderBare()
    fireEvent.keyDown(figure, { key: 'End' })
    expect(fireEvent.keyDown(figure, { key: 'ArrowRight' })).toBe(true)
    expect(fireEvent.keyDown(figure, { key: 'ArrowDown' })).toBe(true)
  })

  it('gives Left back to a real roving panel at the first date, so focus reaches the Table toggle', () => {
    const figure = renderCalendar()
    figure.focus()
    fireEvent.keyDown(figure, { key: 'Home' })
    fireEvent.keyDown(figure, { key: 'ArrowLeft' })
    expect(document.activeElement?.textContent).toBe(CHART.tableToggle)
  })

  it('gives Right back to a real roving panel at the last date, so focus reaches the next panel item', () => {
    const figure = renderCalendar()
    figure.focus()
    fireEvent.keyDown(figure, { key: 'End' })
    fireEvent.keyDown(figure, { key: 'ArrowRight' })
    expect(document.activeElement?.textContent).toBe('Next')
  })

  it('still steps and consumes the key away from the edges', () => {
    const figure = renderCalendar()
    fireEvent.keyDown(figure, { key: 'Home' })
    expect(fireEvent.keyDown(figure, { key: 'ArrowRight' })).toBe(false)
    const readout = screen.getByRole('status')
    expect(readout.textContent).toContain('2011-01-04')
  })

  // Holding the key at the edge (auto-repeat) must not keep giving it back to the panel on every
  // repeat, or focus walks on through the panel's other controls while the key is still held. Only a
  // fresh press releases the key.
  it('gives Right back to the panel only on a fresh press, not on every auto-repeat at the last date', () => {
    const figure = renderCalendar()
    figure.focus()
    fireEvent.keyDown(figure, { key: 'End' })
    expect(fireEvent.keyDown(figure, { key: 'ArrowRight', repeat: true })).toBe(false)
    expect(document.activeElement).toBe(figure)
    fireEvent.keyDown(figure, { key: 'ArrowRight' })
    expect(document.activeElement?.textContent).toBe('Next')
  })
})
