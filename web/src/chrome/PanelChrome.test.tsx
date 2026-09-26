// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PANEL } from '../copy/workspace'
import PanelChrome from './PanelChrome'
import { panelTabStops } from './WorkspaceFocus'

afterEach(cleanup)

function renderPanel(extra: Partial<Parameters<typeof PanelChrome>[0]> = {}) {
  return render(
    <PanelChrome panelId="p1" title="NQ GP 1d" screen="Candles with volume and an indicator pane" group="A" {...extra}>
      <p>content</p>
      <button type="button">inner control</button>
    </PanelChrome>,
  )
}

describe('PanelChrome (UI_SPEC sections 2 and 8)', () => {
  it('is a region named by its title, with the link chip, title and screen name in the header', () => {
    renderPanel()
    const region = screen.getByRole('region', { name: 'NQ GP 1d' })
    expect(region.getAttribute('data-nqt-panel')).toBe('p1')
    expect(within(region).getByRole('heading', { name: 'NQ GP 1d' })).toBeTruthy()
    expect(within(region).getByText('[A]')).toBeTruthy()
    expect(within(region).getByText('Link group A')).toBeTruthy()
    expect(within(region).getByText('Candles with volume and an indicator pane')).toBeTruthy()
  })

  it('shows an unlinked panel as [-] with a readable label', () => {
    renderPanel({ group: '-' })
    expect(screen.getByText('[-]')).toBeTruthy()
    expect(screen.getByText(PANEL.linkChipNone)).toBeTruthy()
  })

  it('renders each tag as a bracket tag', () => {
    renderPanel({ tags: ['PRE-REG', 'SPENT'] })
    expect(screen.getByText('PRE-REG').className).toContain('tag-b')
    expect(screen.getByText('SPENT').className).toContain('tag-b')
  })

  it('offers a table toggle only when the panel has a table view, and reports the change', () => {
    const { rerender } = renderPanel()
    expect(screen.queryByRole('button', { name: PANEL.tableViewLabel })).toBeNull()
    const onChange = vi.fn()
    rerender(
      <PanelChrome panelId="p1" title="NQ GP 1d" screen="s" group="A" tableView={false} onTableViewChange={onChange}>
        <p>content</p>
      </PanelChrome>,
    )
    const toggle = screen.getByRole('button', { name: PANEL.tableViewLabel })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('names the table toggle by its visible label, with the state in aria-pressed alone (2.5.3)', () => {
    renderPanel({ tableView: true, onTableViewChange: () => {} })
    const toggle = screen.getByRole('button', { name: PANEL.tableViewLabel })
    expect(toggle.hasAttribute('aria-label')).toBe(false)
    expect(toggle.textContent).toBe(PANEL.tableViewLabel)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps one landmark per panel: the body is a named group, and the full title stays readable', () => {
    renderPanel()
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'NQ GP 1d content' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'NQ GP 1d' }).getAttribute('title')).toBe('NQ GP 1d')
  })

  it('is exactly one Tab stop: the panel body, with inner controls taken out of the Tab order', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {} })
    const region = screen.getByRole('region', { name: 'NQ GP 1d' })
    const stops = panelTabStops(region)
    expect(stops).toHaveLength(1)
    expect(stops[0]?.getAttribute('aria-label')).toBe('NQ GP 1d content')
  })

  it('moves from the body to the table toggle with the Left arrow', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {} })
    const body = screen.getByLabelText('NQ GP 1d content')
    body.focus()
    fireEvent.keyDown(body, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: PANEL.tableViewLabel }))
  })

  it('has no control whose text could read as a trading action', () => {
    renderPanel({ tableView: false, onTableViewChange: () => {} })
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/order|submit|cancel|modify/i)
    }
  })
})
