// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onLineRequest } from '../../chrome/CommandLine.bus'
import { NumberingContext, type NumberedItem } from '../../chrome/PanelChrome.numbers'
import { PanelActionsContext, type PanelActions } from '../../chrome/PanelChrome.actions'
import { HOME_LAUNCHPAD } from '../../copy/home'
import HomeScreen, { launchpadLines } from './HomeScreen'

afterEach(cleanup)

const actions: PanelActions = { panelId: 'nqt-7', related: () => false, back: () => false, forward: () => false, open: () => false }
const props = { params: { code: 'HOME' as const, context: null, args: {}, group: '-' as const }, context: null }

describe('launchpadLines: the HOME grid as commands, then the screens that open with Shift+Enter', () => {
  it('lists the four HOME panels in reading order with their link groups, then the other screens', () => {
    expect(launchpadLines().map((l) => [l.n, l.line, l.group])).toEqual([
      [1, 'NQ GP 1d', 'A'],
      [2, '27F MON', 'A'],
      [3, 'volmanaged_v0 EQ', 'B'],
      [4, 'REG', '-'],
      [5, 'LIVE', '-'],
      [6, 'OOS', '-'],
      [7, 'RUNS', '-'],
      [8, 'LEDG', '-'],
      [9, 'HELP', '-'],
    ])
  })
})

describe('HomeScreen: the launchpad index a HOME panel shows on its own', () => {
  it('draws the red bar titled Launchpad and a numbered grid with the screen names', () => {
    render(<HomeScreen {...props} />)
    expect(screen.getByRole('toolbar', { name: `${HOME_LAUNCHPAD.title} functions` })).toBeTruthy()
    const grid = screen.getByRole('table', { name: HOME_LAUNCHPAD.caption })
    const rows = within(grid).getAllByRole('row').filter((r) => r.querySelector('.ix'))
    expect(rows).toHaveLength(9)
    expect(rows[0]!.textContent).toContain('1)')
    expect(rows[0]!.textContent).toContain('NQ GP 1d')
    expect(rows[0]!.textContent).toContain('Candles with volume and roll markers')
    expect(within(grid).getByText(HOME_LAUNCHPAD.sections.home)).toBeTruthy()
    expect(within(grid).getByText(HOME_LAUNCHPAD.sections.more)).toBeTruthy()
  })

  it('runs a line through the command line when its link is pressed', () => {
    const seen = vi.fn()
    const off = onLineRequest(seen)
    render(<HomeScreen {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '27F MON <GO>' }))
    off()
    expect(seen).toHaveBeenCalledWith({ line: '27F MON', newPanel: false })
  })

  it('offers every line as Number <GO> in its panel', () => {
    const registered: NumberedItem[][] = []
    const registrar = vi.fn((_panel: string, items: ReadonlyArray<NumberedItem>) => {
      registered.push([...items])
      return () => {}
    })
    const seen = vi.fn()
    const off = onLineRequest(seen)
    render(
      <NumberingContext value={registrar}>
        <PanelActionsContext value={actions}>
          <HomeScreen {...props} />
        </PanelActionsContext>
      </NumberingContext>,
    )
    const launch = registered.find((items) => items.some((i) => i.label === 'volmanaged_v0 EQ'))
    expect(launch?.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    launch?.find((i) => i.n === 3)?.run()
    off()
    expect(seen).toHaveBeenCalledWith({ line: 'volmanaged_v0 EQ', newPanel: false })
  })
})
