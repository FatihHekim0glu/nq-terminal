// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FunctionBar, { type FunctionBarItem } from './FunctionBar'
import { NumberingContext, type NumberedItem } from './PanelChrome.numbers'

afterEach(cleanup)

function items(onExport = vi.fn(), onFirst = vi.fn()): FunctionBarItem[] {
  return [
    { n: 96, label: 'Actions', menu: [{ label: 'Related functions', onSelect: onFirst }, { label: 'Back', onSelect: () => {} }] },
    { n: 98, label: 'Export', onRun: onExport },
    { n: 97, label: 'Settings', onRun: () => {}, disabled: true },
  ]
}

describe('FunctionBar: the red function bar (look spec 4.4)', () => {
  it('is a named toolbar with numbered buttons, the screen title and an optional page counter', () => {
    const { rerender } = render(<FunctionBar panelId="p" title="Registry board" items={items()} />)
    const bar = screen.getByRole('toolbar', { name: 'Registry board functions' })
    expect(within(bar).getByRole('button', { name: /96\) Actions/ })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: /98\) Export/ })).toBeTruthy()
    expect(within(bar).getByText('Registry board').className).toContain('fn-title')
    expect(within(bar).queryByText(/Page/)).toBeNull()
    rerender(<FunctionBar panelId="p" title="Registry board" items={items()} page={{ n: 1, m: 3 }} />)
    expect(screen.getByText('Page 1/3')).toBeTruthy()
  })

  it('writes the number as `NN)` and marks menu buttons with a down triangle', () => {
    render(<FunctionBar panelId="p" title="t" items={items()} />)
    const actions = screen.getByRole('button', { name: /96\) Actions/ })
    expect(actions.querySelector('.fn-no')?.textContent).toBe('96)')
    expect(actions.getAttribute('aria-haspopup')).toBe('menu')
    expect(actions.querySelector('.fn-caret')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('button', { name: /98\) Export/ }).hasAttribute('aria-haspopup')).toBe(false)
  })

  it('runs a plain button on click', () => {
    const onExport = vi.fn()
    render(<FunctionBar panelId="p" title="t" items={items(onExport)} />)
    fireEvent.click(screen.getByRole('button', { name: /98\) Export/ }))
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('opens a red dropdown under a menu button; the pressed state is aria-expanded', () => {
    render(<FunctionBar panelId="p" title="t" items={items()} />)
    const actions = screen.getByRole('button', { name: /96\) Actions/ })
    expect(actions.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(actions)
    expect(actions.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu', { name: 'Actions menu' })
    expect(menu.className).toContain('menu-red')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Related functions', 'Back'])
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
  })

  it('moves through the dropdown with the arrows, runs an item with Enter and closes', () => {
    const onFirst = vi.fn()
    render(<FunctionBar panelId="p" title="t" items={items(vi.fn(), onFirst)} />)
    fireEvent.click(screen.getByRole('button', { name: /96\) Actions/ }))
    const [first, second] = screen.getAllByRole('menuitem')
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first as HTMLElement, { key: 'Enter' })
    expect(onFirst).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the dropdown on Escape and returns focus to its button', () => {
    render(<FunctionBar panelId="p" title="t" items={items()} />)
    const actions = screen.getByRole('button', { name: /96\) Actions/ })
    fireEvent.click(actions)
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0] as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(actions)
  })

  it('shows a disabled button as aria-disabled and does not run it', () => {
    const run = vi.fn()
    render(<FunctionBar panelId="p" title="t" items={[{ n: 97, label: 'Settings', onRun: run, disabled: true }]} />)
    const settings = screen.getByRole('button', { name: /97\) Settings/ })
    expect(settings.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(settings)
    expect(run).not.toHaveBeenCalled()
  })

  it('registers each enabled button as a numbered item (Number <GO>)', () => {
    const seen: NumberedItem[][] = []
    const onExport = vi.fn()
    render(
      <NumberingContext value={(_id, list) => { seen.push([...list]); return () => {} }}>
        <FunctionBar panelId="p" title="t" items={items(onExport)} />
      </NumberingContext>,
    )
    const last = seen.at(-1) ?? []
    expect(last.map((i) => `${i.n} ${i.label}`)).toEqual(['96 Actions', '98 Export'])
    last[1]?.run()
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('makes every button a roving item of its panel', () => {
    render(<FunctionBar panelId="p" title="t" items={items()} />)
    for (const b of within(screen.getByRole('toolbar')).getAllByRole('button')) expect(b.hasAttribute('data-roving')).toBe(true)
  })
})
