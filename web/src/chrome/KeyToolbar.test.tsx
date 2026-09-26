// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEY_TOOLBAR } from '../copy/chrome'
import { KeyToolbar } from './KeyToolbar'

afterEach(cleanup)

describe('KeyToolbar: the 32px key toolbar (spec 4.2)', () => {
  it('keeps the official key order, then the custom keys, then the key map', () => {
    render(<KeyToolbar onKey={vi.fn()} />)
    const bar = screen.getByRole('group', { name: KEY_TOOLBAR.label })
    const labels = within(bar).getAllByRole('button').map((b) => b.getAttribute('data-key'))
    expect(labels).toEqual(['esc', 'help', 'search', 'menu', 'pgback', 'pgfwd', 'HOME', 'REG', 'RUNS', 'LEDG', 'LIVE', 'OOS', 'keymap'])
  })

  it('shows the uppercase key label and names the key and its action for assistive technology', () => {
    render(<KeyToolbar onKey={vi.fn()} />)
    const help = screen.getByRole('button', { name: KEY_TOOLBAR.keys.help.name })
    expect(help.textContent).toBe('HELP')
    expect(help.getAttribute('aria-label')).toMatch(/F1/)
    const esc = document.querySelector('[data-key="esc"]')
    expect(esc?.textContent).toBe('CANCEL')
    expect(esc?.getAttribute('aria-label')).toMatch(/Esc/)
  })

  it('colours CANCEL red and every other key green', () => {
    render(<KeyToolbar onKey={vi.fn()} />)
    const colours = Array.from(document.querySelectorAll('.key-btn')).map((b) => b.getAttribute('data-colour'))
    expect(colours[0]).toBe('cancel')
    expect(new Set(colours.slice(1))).toEqual(new Set(['go']))
  })

  it('reports the key pressed', () => {
    const onKey = vi.fn()
    render(<KeyToolbar onKey={onKey} />)
    fireEvent.click(screen.getByRole('button', { name: KEY_TOOLBAR.keys.pgfwd.name }))
    fireEvent.click(screen.getByRole('button', { name: KEY_TOOLBAR.custom.REG }))
    fireEvent.click(screen.getByRole('button', { name: KEY_TOOLBAR.keymap }))
    expect(onKey.mock.calls.map((c) => c[0])).toEqual(['pgfwd', 'REG', 'keymap'])
  })

  it('has no sector keys: F8 to F11 insert them instead', () => {
    render(<KeyToolbar onKey={vi.fn()} />)
    for (const word of ['INDEX', 'COMDTY', 'CURNCY']) expect(screen.queryByText(word)).toBeNull()
  })
})
