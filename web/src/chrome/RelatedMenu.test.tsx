// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELATED } from '../copy/workspace'
import { NumberingContext, type NumberedItem } from './PanelChrome.numbers'
import RelatedMenu, { relatedEntries } from './RelatedMenu'
import { ROVING_OVERLAY_ATTR, panelTabStops, syncRoving } from './WorkspaceFocus'

afterEach(cleanup)

const NQ = { kind: 'instrument' as const, value: 'NQ' }

function renderMenu(extra: Partial<Parameters<typeof RelatedMenu>[0]> = {}) {
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const utils = render(<RelatedMenu panelId="p1" context={NQ} onOpen={onOpen} onClose={onClose} {...extra} />)
  return { ...utils, onOpen, onClose }
}

function rowTexts(): string[] {
  return screen.getAllByRole('menuitem').map((m) => (m.textContent ?? '').replace(/\s+/g, ' ').trim())
}

describe('relatedEntries: the functions that accept the panel context', () => {
  it('keeps functions that take the context kind or no context, grouped by category', () => {
    const cats = relatedEntries(NQ)
    const codes = cats.flatMap((c) => c.functions.map((f) => f.code))
    expect(codes).toEqual(expect.arrayContaining(['GP', 'GIP', 'DES', 'REG', 'HELP']))
    expect(codes).not.toContain('RUN')
    expect(codes).not.toContain('EQ')
    expect(cats.every((c) => c.functions.length > 0)).toBe(true)
  })

  it('lists every P0 function when the panel has no context, and no P1 or P2 function', () => {
    const codes = relatedEntries(null).flatMap((c) => c.functions.map((f) => f.code))
    expect(codes).toContain('RUN')
    expect(codes).not.toContain('COST')
    expect(codes).not.toContain('JOBS')
  })
})

describe('RelatedMenu (look spec 4.7)', () => {
  it('is a named dialog over a dim that belongs to the panel, with an italic breadcrumb and <Cancel>', () => {
    const { container } = renderMenu()
    const dialog = screen.getByRole('dialog', { name: RELATED.title })
    // Non-modal said out loud (a11y review): the chrome stays usable while it is open.
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(container.querySelector('.menu-dim')).not.toBeNull()
    expect(within(dialog).getByText(`${RELATED.root} > NQ`).className).toContain('menu-crumb')
    expect(within(dialog).getByRole('button', { name: RELATED.cancelLabel }).textContent).toContain(RELATED.cancel)
  })

  it('holds the panel Tab stop while open, so its scroll region is keyboard reachable', () => {
    const { container } = renderMenu()
    const dialog = screen.getByRole('dialog', { name: RELATED.title })
    expect(dialog.hasAttribute(ROVING_OVERLAY_ATTR)).toBe(true)
    syncRoving(container)
    expect(panelTabStops(container)).toEqual([dialog])
  })

  it('numbers rows sequentially across both columns, category rows included', () => {
    renderMenu()
    const rows = rowTexts()
    rows.forEach((text, i) => expect(text.startsWith(`${i + 1})`), text).toBe(true))
    expect(rows[0]).toBe(`1) ${RELATED.categories.prices} >`)
    expect(rows[1]).toMatch(/^2\) GP /)
    const columns = screen.getAllByRole('group')
    expect(columns.length).toBe(2)
  })

  it('focuses the first row on open and moves with the arrows', () => {
    renderMenu()
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[0])
  })

  it('opens a function row in the panel', () => {
    const { onOpen } = renderMenu()
    fireEvent.click(screen.getAllByRole('menuitem')[1] as HTMLElement)
    expect(onOpen).toHaveBeenCalledWith('GP')
  })

  it('drills into a category, extends the breadcrumb, and goes back up on Escape before closing', () => {
    const { onClose } = renderMenu()
    const first = screen.getAllByRole('menuitem')[0] as HTMLElement
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(screen.getByText(`${RELATED.root} > NQ > ${RELATED.categories.prices}`)).toBeTruthy()
    expect(rowTexts()[0]).toMatch(/^1\) GP /)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(rowTexts()[0]).toBe(`1) ${RELATED.categories.prices} >`)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from <Cancel> X', () => {
    const { onClose } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: RELATED.cancelLabel }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('registers its rows as the panel numbered items while open (Number <GO>)', () => {
    const onOpen = vi.fn()
    let last: NumberedItem[] = []
    render(
      <NumberingContext value={(_id, list) => { last = [...list]; return () => {} }}>
        <RelatedMenu panelId="p1" context={NQ} onOpen={onOpen} onClose={() => {}} />
      </NumberingContext>,
    )
    expect(last.map((i) => i.n)).toEqual(last.map((_, i) => i + 1))
    last[1]?.run()
    expect(onOpen).toHaveBeenCalledWith('GP')
  })
})
