// @vitest-environment jsdom
// U09: REG's 'Registry board' grid was 25 ArrowRight presses from the panel's Tab stop (16 round buttons and
// 8 criteria buttons come first in the item walk), so 'row 9 and Enter' cost 35 keys. The grid is now the
// panel's Tab stop; ArrowUp from its header reaches the criteria; a letter jumps to the row by name.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { onLineRequest, type LineRequest } from '../../chrome/CommandLine.bus'
import { resetMessage } from '../../chrome/MessageLine.store'
import { resetNumbered } from '../../chrome/NumberedActions'
import { ROVING_ATTR, ROVING_DEFAULT_ATTR, panelTabStops, usePanelRoving } from '../../chrome/WorkspaceFocus'
import { stubLayout } from '../../grids/testing'
import { REGISTRY } from './regFixtures'
import RegScreen from './RegScreen'
import { mountScreen, panelParams, stubApi } from './testHarness'

/** A stand-in for PanelChrome's frame: the panel element with its roving handler and its scrolling body. */
function Frame({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const onKeyDown = usePanelRoving(ref)
  return (
    <section ref={ref} data-testid="panel" onKeyDown={onKeyDown}>
      <div className="nqt-panel-body" role="group" aria-label="REG body" tabIndex={0} {...{ [ROVING_ATTR]: '', [ROVING_DEFAULT_ATTR]: '' }}>
        {children}
      </div>
    </section>
  )
}

beforeAll(() => stubLayout(600))
afterEach(() => {
  cleanup()
  resetNumbered()
  resetMessage()
})

async function ready(): Promise<{ panel: HTMLElement; grid: HTMLElement }> {
  stubApi()
  mountScreen(<Frame><RegScreen params={panelParams('REG')} context={null} /></Frame>)
  const grid = await screen.findByRole('grid', { name: /Registry board/ })
  await waitFor(() => expect(within(grid).getAllByRole('row').length - 1).toBe(REGISTRY.counts.rows))
  return { panel: screen.getByTestId('panel'), grid }
}

const nameOf = (row: HTMLElement | null | undefined) => row?.querySelectorAll('td')[1]?.textContent ?? ''

function activeRow(grid: HTMLElement): HTMLElement | null {
  const id = grid.getAttribute('aria-activedescendant')
  return id ? document.getElementById(id)?.closest('tr') ?? null : null
}

describe('REG: the grid is the panel Tab stop (U09)', () => {
  it('is the panel\'s only Tab stop once the rows are in, not the panel body', async () => {
    const { panel, grid } = await ready()
    expect(panelTabStops(panel)).toEqual([grid])
    expect(grid.hasAttribute('data-roving-entry')).toBe(true)
  })

  it('Tab lands on the grid, so row 3 and Enter is two ArrowDowns and Enter', async () => {
    const { grid } = await ready()
    grid.focus()
    const lines: LineRequest[] = []
    const stop = onLineRequest((r) => lines.push(r))
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    const third = nameOf(activeRow(grid))
    fireEvent.keyDown(grid, { key: 'Enter' })
    stop()
    expect(lines).toEqual([{ line: `${third} DES`, newPanel: false }])
  })

  it('ArrowUp from row 1 goes to the header, and once more reaches the criteria buttons', async () => {
    const { panel, grid } = await ready()
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    expect(grid.getAttribute('aria-activedescendant')).toMatch(/-h0$/)
    expect(document.activeElement).toBe(grid)
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    expect(document.activeElement).not.toBe(grid)
    expect(document.activeElement?.closest('[aria-label="Screening criteria"]')).not.toBeNull()
    expect(panelTabStops(panel)).toEqual([document.activeElement])
  })

  it('a letter jumps to the row whose name starts with it', async () => {
    const { grid } = await ready()
    grid.focus()
    fireEvent.keyDown(grid, { key: 'v' })
    expect(nameOf(activeRow(grid)).startsWith('v')).toBe(true)
    expect(document.activeElement).toBe(grid)
  })
})
