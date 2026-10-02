// @vitest-environment jsdom
// A line typed straight after load (v2.1 polish, SHELL-DIET-4): the command line's menus and suggestion sheet are chunks of
// their own, so a context typed and run before they have arrived must not be lost. The line stays as typed, the menu opens
// as soon as its chunk arrives, and a suggestion sheet is drawn as soon as its chunk arrives. vi.resetModules() gives this
// file a command line with nothing loaded, the way the page is at first paint (the other CommandLine tests wait for the
// chunks first, as the app has them by its first idle moment).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CommandIndexData } from '../commands/types'

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [{ root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' }],
  universe: ['27F'],
  hypotheses: ['za_v0'],
  confirmations: [],
  runs: [],
  registry_error: null,
}

beforeAll(() => {
  class NoResize {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoResize)
  Element.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)

async function mountFresh() {
  vi.resetModules()
  const { CommandLine } = await import('./CommandLine')
  const { COMMAND_LINE } = await import('../copy/commands')
  const { COMMAND_MENUS } = await import('../copy/menus')
  render(<CommandLine index={INDEX} onRun={vi.fn()} historyStorage={null} />)
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
  return { input, COMMAND_MENUS }
}

describe('CommandLine before its menu and sheet chunks have arrived', () => {
  it('opens the function menu of a context run at once, as soon as the menu code arrives', async () => {
    const { input } = await mountFresh()
    fireEvent.change(input, { target: { value: 'NQ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const menu = await screen.findByRole('listbox', { name: 'NQ1 Index' })
    expect(menu.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
  })

  it('keeps working for the next menu once the code is here: LAST opens in the same tick', async () => {
    const { input, COMMAND_MENUS } = await mountFresh()
    fireEvent.change(input, { target: { value: 'NQ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByRole('listbox', { name: 'NQ1 Index' })
    fireEvent.change(input, { target: { value: 'LAST' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('listbox', { name: COMMAND_MENUS.lastTitle })).toBeTruthy()
  })

  it('draws the suggestion sheet for a line typed early, once its code arrives', async () => {
    const { input } = await mountFresh()
    fireEvent.change(input, { target: { value: 'RE' } })
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
  })
})
