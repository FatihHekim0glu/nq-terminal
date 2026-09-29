// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FUNCTION_BAR, PANEL } from '../copy/workspace'
import FunctionBar from './FunctionBar'
import PanelChrome from './PanelChrome'
import { NumberingContext, type NumberedItem } from './PanelChrome.numbers'
import { panelTabStops } from './WorkspaceFocus'

afterEach(cleanup)

type Props = Parameters<typeof PanelChrome>[0]

function renderPanel(extra: Partial<Props> = {}) {
  return render(
    <PanelChrome panelId="p1" number={1} code="GP" title="NQ GP 1d" subject="NQ 1d" group="A" {...extra}>
      <p>content</p>
      <button type="button">inner control</button>
    </PanelChrome>,
  )
}

describe('PanelChrome title bar (look spec 4.3)', () => {
  it('shows <panel no>-<MNEMONIC>, the link chip and the context, and names the region by that heading', () => {
    renderPanel()
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading.textContent).toContain('1-GP')
    expect(heading.textContent).toContain('NQ 1d')
    expect(within(heading).getByText('Link group A')).toBeTruthy()
    const region = screen.getByRole('region')
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(region.getAttribute('data-nqt-panel')).toBe('p1')
    expect(region.getAttribute('data-nqt-title')).toBe('NQ GP 1d')
  })

  it('draws the chip as a square with the group letter, and shows no chip on an unlinked panel', () => {
    const { container, rerender } = renderPanel()
    const chip = container.querySelector('.pchip')
    expect(chip?.getAttribute('data-group')).toBe('A')
    expect(chip?.textContent).toContain('A')
    rerender(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <p>x</p>
      </PanelChrome>,
    )
    expect(container.querySelector('.pchip')).toBeNull()
  })

  it('renders each tag in brackets on the title bar', () => {
    renderPanel({ tags: ['PRE-REG', 'SPENT'] })
    expect(screen.getByText('[PRE-REG]').className).toContain('ptag')
    expect(screen.getByText('[SPENT]').className).toContain('ptag')
  })

  it('offers the T toggle only when the panel has a table view, and reports the change', () => {
    const { rerender } = renderPanel()
    expect(screen.queryByRole('button', { name: PANEL.tableViewLabel })).toBeNull()
    const onChange = vi.fn()
    rerender(
      <PanelChrome panelId="p1" number={1} code="GP" title="NQ GP 1d" group="A" tableView={false} onTableViewChange={onChange}>
        <p>content</p>
      </PanelChrome>,
    )
    const toggle = screen.getByRole('button', { name: PANEL.tableViewLabel })
    expect(toggle.textContent).toBe(PANEL.tableViewKey)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('has a maximise control whose state is in aria-pressed', () => {
    const onToggleMaximise = vi.fn()
    renderPanel({ onToggleMaximise, maximised: false })
    const max = screen.getByRole('button', { name: PANEL.maximise })
    expect(max.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(max)
    expect(onToggleMaximise).toHaveBeenCalledTimes(1)
  })

  it('opens the Options menu with related functions, back, forward and maximise', () => {
    const onRelated = vi.fn()
    const onBack = vi.fn()
    renderPanel({ onRelated, onBack, onForward: () => {}, onToggleMaximise: () => {} })
    const options = screen.getByRole('button', { name: PANEL.options })
    expect(options.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(options)
    const menu = screen.getByRole('menu')
    const labels = within(menu).getAllByRole('menuitem').map((m) => m.textContent)
    expect(labels).toEqual([PANEL.related, PANEL.back, PANEL.forward, PANEL.maximise])
    fireEvent.click(within(menu).getByRole('menuitem', { name: PANEL.back }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks the focused panel for the 1px focus line (data-focused)', () => {
    const { container, rerender } = renderPanel({ focused: true })
    expect(container.querySelector('section')?.getAttribute('data-focused')).toBe('true')
    rerender(
      <PanelChrome panelId="p1" number={1} code="GP" title="NQ GP 1d" group="A" focused={false}>
        <p>content</p>
      </PanelChrome>,
    )
    expect(container.querySelector('section')?.getAttribute('data-focused')).toBe('false')
  })

  it('keeps one landmark per panel: the body is a named group', () => {
    renderPanel()
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'NQ GP 1d content' })).toBeTruthy()
  })

  it('is exactly one Tab stop: the panel body, with every title-bar control out of the Tab order', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {}, onToggleMaximise: () => {}, onRelated: () => {} })
    const region = screen.getByRole('region')
    const stops = panelTabStops(region)
    expect(stops).toHaveLength(1)
    expect(stops[0]?.getAttribute('aria-label')).toBe('NQ GP 1d content')
  })

  it('moves from the body to the title-bar controls with the Left arrow', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {} })
    const body = screen.getByLabelText('NQ GP 1d content')
    body.focus()
    fireEvent.keyDown(body, { key: 'ArrowLeft' })
    expect((document.activeElement as HTMLElement).closest('.ptitle')).not.toBeNull()
  })

  // A grid or a chart handles Left and Right in its own React handler. The panel must see the key
  // after that handler, so a key the item used never also moves the panel's focus.
  it('born failing: leaves Left and Right to an item that handled them, so focus stays on the item', () => {
    const handled = vi.fn()
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <button type="button" data-roving="">before</button>
        <div
          role="grid"
          aria-label="Board"
          tabIndex={-1}
          data-roving=""
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              handled(e.key)
            }
          }}
        >
          cells
        </div>
        <button type="button" data-roving="">after</button>
      </PanelChrome>,
    )
    const grid = screen.getByRole('grid', { name: 'Board' })
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(grid)
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(grid)
    expect(handled.mock.calls).toEqual([['ArrowLeft'], ['ArrowRight']])
  })

  it('still moves on a Left or Right that the item left unhandled', () => {
    render(
      <PanelChrome panelId="p1" number={1} code="REG" title="REG" group="-">
        <button type="button" data-roving="">before</button>
        <div role="grid" aria-label="Board" tabIndex={-1} data-roving="" onKeyDown={() => undefined}>cells</div>
      </PanelChrome>,
    )
    const grid = screen.getByRole('grid', { name: 'Board' })
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before' }))
  })

  it('places a FunctionBar rendered by the screen above the scrolling body, not inside it', () => {
    render(
      <PanelChrome panelId="p1" number={2} code="REG" title="REG" group="-">
        <FunctionBar panelId="p1" title="Registry board" items={[{ n: 96, label: FUNCTION_BAR.actions, menu: [{ label: 'x', onSelect: () => {} }] }]} />
        <p>rows</p>
      </PanelChrome>,
    )
    const bar = screen.getByRole('toolbar', { name: 'Registry board functions' })
    const body = screen.getByRole('group', { name: 'REG content' })
    expect(body.contains(bar)).toBe(false)
    expect(bar.closest('section')).not.toBeNull()
  })

  it('registers the numbered items of its screen, once per panel, through the numbering context', () => {
    const calls: Array<{ panelId: string; items: ReadonlyArray<NumberedItem> }> = []
    const registrar = vi.fn((panelId: string, items: ReadonlyArray<NumberedItem>) => {
      calls.push({ panelId, items })
      return () => {}
    })
    render(
      <NumberingContext value={registrar}>
        <PanelChrome panelId="p9" number={1} code="REG" title="REG" group="-">
          <FunctionBar panelId="p9" title="Registry board" items={[{ n: 96, label: 'Actions', menu: [{ label: 'x', onSelect: () => {} }] }, { n: 98, label: 'Export', onRun: () => {} }]} />
        </PanelChrome>
      </NumberingContext>,
    )
    const last = calls.at(-1)
    expect(last?.panelId).toBe('p9')
    expect(last?.items.map((i) => i.n)).toEqual([96, 98])
    act(() => last?.items[0]?.run())
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('has no control whose text could read as a trading action', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {}, onToggleMaximise: () => {}, onRelated: () => {} })
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/order|submit|cancel|modify/i)
    }
  })
})

describe('PanelChrome extraOptions (a generic extension of the Options menu)', () => {
  const rows = (onSelect: () => void = () => {}) => [
    { label: 'Extra one', onSelect },
    { label: 'Extra two', onSelect },
  ]
  const optionsButton = () => screen.getByRole('button', { name: PANEL.options })
  const menuLabels = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)

  it('appends the extra rows after the panel own rows', () => {
    renderPanel({ onRelated: () => {}, onBack: () => {}, onForward: () => {}, onToggleMaximise: () => {}, extraOptions: () => rows() })
    fireEvent.click(optionsButton())
    expect(menuLabels()).toEqual([PANEL.related, PANEL.back, PANEL.forward, PANEL.maximise, 'Extra one', 'Extra two'])
  })

  it('runs the chosen extra row and closes the menu', () => {
    const onSelect = vi.fn()
    renderPanel({ extraOptions: () => rows(onSelect) })
    fireEvent.click(optionsButton())
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Extra two' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows Options when extraOptions is the only source of rows', () => {
    renderPanel({ extraOptions: () => rows() })
    expect(optionsButton().getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(optionsButton())
    expect(menuLabels()).toEqual(['Extra one', 'Extra two'])
  })

  it('shows no Options at all when the panel has neither rows nor extraOptions', () => {
    renderPanel()
    expect(screen.queryByRole('button', { name: PANEL.options })).toBeNull()
  })

  it('evaluates extraOptions only when the menu opens, not on render', () => {
    const extraOptions = vi.fn(() => rows())
    const { rerender } = renderPanel({ extraOptions })
    expect(extraOptions).not.toHaveBeenCalled()
    rerender(
      <PanelChrome panelId="p1" number={1} code="GP" title="NQ GP 1d" subject="NQ 1d" group="A" extraOptions={extraOptions}>
        <p>content</p>
      </PanelChrome>,
    )
    expect(extraOptions).not.toHaveBeenCalled()
    fireEvent.click(optionsButton())
    expect(extraOptions).toHaveBeenCalledTimes(1)
  })

  it('does not evaluate it again while the menu stays open, and again at the next open', () => {
    const extraOptions = vi.fn(() => rows())
    const { rerender } = renderPanel({ extraOptions, onRelated: () => {} })
    fireEvent.click(optionsButton())
    rerender(
      <PanelChrome panelId="p1" number={1} code="GP" title="NQ GP 1d" subject="NQ 1d" group="A" onRelated={() => {}} extraOptions={extraOptions} focused>
        <p>content</p>
      </PanelChrome>,
    )
    expect(extraOptions).toHaveBeenCalledTimes(1)
    fireEvent.click(optionsButton())
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(optionsButton())
    expect(extraOptions).toHaveBeenCalledTimes(2)
  })

  it('reads the rows as they are at the moment of opening', () => {
    let label = 'Before'
    renderPanel({ extraOptions: () => [{ label, onSelect: () => {} }] })
    label = 'After'
    fireEvent.click(optionsButton())
    expect(menuLabels()).toEqual(['After'])
  })
})
