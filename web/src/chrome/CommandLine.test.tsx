// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HistoryStorage } from '../commands/history'
import type { CommandIndexData } from '../commands/types'
import { COMMAND_LINE, PARSE_MESSAGES } from '../copy/commands'
import { CommandLine, type CommandLineProps } from './CommandLine'

// cmdk measures its list with ResizeObserver and scrolls the selected item into view; jsdom has neither.
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

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ZN', symbol: 'ZN.V.0', sector: 'rates' },
  ],
  universe: ['27F'],
  hypotheses: ['za_v0', 'volmanaged_v0'],
  confirmations: ['rebal_v1_confirm'],
  runs: ['nt_dtsmom_v0_ts1'],
  registry_error: null,
}

function memoryStorage(): HistoryStorage {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function setup(props: Partial<CommandLineProps> = {}) {
  const onRun = vi.fn()
  render(
    <div>
      <button type="button">panel</button>
      <header>
        <CommandLine index={INDEX} onRun={onRun} historyStorage={memoryStorage()} {...props} />
      </header>
    </div>,
  )
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
  const type = (text: string) => fireEvent.change(input, { target: { value: text } })
  const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input, { key: k, ...init })
  return { onRun, input, type, key, panel: screen.getByRole('button', { name: 'panel' }) }
}

describe('CommandLine: running commands', () => {
  it('shows the nq-lab> prompt and a collapsed, labelled combobox', () => {
    const { input } = setup()
    expect(screen.getByText(COMMAND_LINE.prompt)).toBeTruthy()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.getAttribute('aria-controls')).toBeNull()
  })

  it('Enter runs the typed line and replaces the focused panel; the line clears', () => {
    const { onRun, type, key, input } = setup()
    type('NQ GP')
    key('Enter')
    expect(onRun).toHaveBeenCalledTimes(1)
    const [command, target] = onRun.mock.calls[0]!
    expect(command).toMatchObject({ canonical: 'NQ GP', context: { kind: 'instrument', value: 'NQ' } })
    expect(command.mnemonic.code).toBe('GP')
    expect(target).toBe('replace')
    expect(input.value).toBe('')
    expect(screen.getByRole('status').textContent).toBe('Opened NQ GP.')
  })

  it('Shift+Enter opens the result in a new panel', () => {
    const { onRun, type, key } = setup()
    type('REG')
    key('Enter', { shiftKey: true })
    expect(onRun.mock.calls[0]?.[1]).toBe('new-panel')
    expect(screen.getByRole('status').textContent).toBe('Opened REG in a new panel.')
  })

  it('uses the focused panel link-group context when the line names none', () => {
    const { onRun, type, key } = setup({ fallbackContext: 'ZN' })
    type('GP')
    key('Enter')
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('ZN GP')
  })

  it('born failing: reads the fallback context when the command runs, not when the panel was focused', () => {
    let current = 'NQ'
    const { onRun, type, key } = setup({ resolveFallback: () => ({ kind: 'instrument', value: current }) })
    type('GP')
    key('Enter')
    current = 'ZN'
    type('GP')
    key('Enter')
    expect(onRun.mock.calls.map((c) => c[0].canonical)).toEqual(['NQ GP', 'ZN GP'])
  })

  it('announces a repeated command again (a fresh node in the status region)', () => {
    const { type, key } = setup()
    type('REG')
    key('Enter')
    const status = screen.getByRole('status')
    const first = status.firstElementChild
    type('REG')
    key('Enter')
    expect(status.textContent).toBe('Opened REG.')
    expect(status.firstElementChild).not.toBe(first)
  })

  it('a malformed line runs nothing, keeps the text and explains why', () => {
    const { onRun, type, key, input } = setup()
    type('NQ FOO')
    key('Enter')
    expect(onRun).not.toHaveBeenCalled()
    expect(input.value).toBe('NQ FOO')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(PARSE_MESSAGES['unknown-function'].replace('{token}', 'FOO'))
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
    type('NQ FO')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an empty Enter explains the grammar and runs nothing', () => {
    const { onRun, key } = setup()
    key('Enter')
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(PARSE_MESSAGES.empty)
  })
})

describe('CommandLine: suggestions (cmdk inline)', () => {
  it('typing opens a listbox of suggestions tied to the input', () => {
    const { type, input } = setup()
    type('re')
    const list = screen.getByRole('listbox')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    const options = within(list).getAllByRole('option')
    expect(options[0]?.textContent).toContain('REG')
  })

  it('born failing: no option is marked active until the user arrows, so Enter and ARIA agree', () => {
    const { type, input } = setup()
    type('re')
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    expect(screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toEqual([])
  })

  it('born failing: the first ArrowDown lands on the first option, not the second', () => {
    const { type, key, input } = setup()
    type('re')
    const first = screen.getAllByRole('option')[0]
    key('ArrowDown')
    expect(first?.getAttribute('aria-selected')).toBe('true')
    expect(input.getAttribute('aria-activedescendant')).toBe(first?.id)
  })

  it('offers contexts from /api/commands', () => {
    const { type } = setup()
    type('nq')
    expect(within(screen.getByRole('listbox')).getByText('NQ.V.0 equity')).toBeTruthy()
  })

  it('Tab completes the highlighted suggestion; Enter still runs the typed line', () => {
    const { type, key, input, onRun } = setup()
    type('NQ G')
    key('Tab')
    expect(input.value).toBe('NQ GP ')
    key('Enter')
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('NQ GP')
  })

  it('after arrowing to a suggestion, Enter takes it instead of running', () => {
    const { type, key, input, onRun } = setup()
    type('re')
    key('ArrowDown')
    key('ArrowDown')
    const selected = screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected).toBe(screen.getAllByRole('option')[1])
    expect(input.getAttribute('aria-activedescendant')).toBe(selected?.id)
    key('Enter')
    expect(onRun).not.toHaveBeenCalled()
    expect(input.value).toBe(`${selected?.querySelector('.lbl')?.textContent} `)
  })

  it('clicking a suggestion takes it and keeps focus on the line', () => {
    const { type, input } = setup()
    input.focus()
    type('27')
    fireEvent.click(within(screen.getByRole('listbox')).getByText('27F'))
    expect(input.value).toBe('27F ')
    expect(document.activeElement).toBe(input)
  })

  it('Esc closes an open list first, a second Esc returns focus to the panel', () => {
    const { type, key, input, panel } = setup()
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    type('re')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    key('Escape')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(input)
    key('Escape')
    expect(document.activeElement).toBe(panel)
  })

  it('a second Esc with no previous panel asks the workspace to focus one', () => {
    const onReturnFocus = vi.fn(() => true)
    const { key, input } = setup({ onReturnFocus })
    input.focus()
    key('Escape')
    expect(onReturnFocus).toHaveBeenCalledTimes(1)
  })

  it('clears the error box when focus leaves the line by any route', () => {
    const { type, key, input, panel } = setup()
    input.focus()
    type('XYZ')
    key('Enter')
    expect(screen.getByRole('alert')).toBeTruthy()
    act(() => panel.focus())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the error box when Esc returns focus, so it does not cover a panel header', () => {
    const { type, key, panel } = setup()
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Escape' })
    type('XYZ')
    key('Enter')
    expect(screen.getByRole('alert')).toBeTruthy()
    key('Escape')
    expect(document.activeElement).toBe(panel)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a note when the index failed, and still offers functions', () => {
    const { type } = setup({ index: null, indexError: true })
    type('re')
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('REG')
    expect(screen.getByText(COMMAND_LINE.indexError)).toBeTruthy()
  })
})

describe('CommandLine: history and keys', () => {
  it('Up and Down in the empty line walk the history', () => {
    const { type, key, input } = setup()
    for (const line of ['REG', 'HELP']) {
      type(line)
      key('Enter')
    }
    key('ArrowUp')
    expect(input.value).toBe('HELP')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    key('ArrowUp')
    expect(input.value).toBe('REG')
    key('ArrowDown')
    expect(input.value).toBe('HELP')
    key('ArrowDown')
    expect(input.value).toBe('')
  })

  it('history survives a remount through storage', () => {
    const storage = memoryStorage()
    const first = setup({ historyStorage: storage })
    first.type('MON')
    first.type('27F MON')
    first.key('Enter')
    cleanup()
    const second = setup({ historyStorage: storage })
    second.key('ArrowUp')
    expect(second.input.value).toBe('27F MON')
  })

  it('Esc and Ctrl+K from anywhere focus the command line; the browser does not act on Ctrl+K', () => {
    const { input, panel } = setup()
    panel.focus()
    const notPrevented = fireEvent.keyDown(panel, { key: 'k', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    panel.focus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
  })

  it('leaves Esc alone when a panel control already handled it', () => {
    const { input, panel } = setup()
    panel.focus()
    panel.addEventListener('keydown', (e) => e.preventDefault(), { once: true })
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.activeElement).not.toBe(input)
  })

  it('removes its key listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    setup()
    const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1]
    expect(handler).toBeTypeOf('function')
    cleanup()
    expect(remove).toHaveBeenCalledWith('keydown', handler)
  })

  it('fetches nothing itself and names nothing like an order path', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { type } = setup()
    type('r')
    expect(fetchSpy).not.toHaveBeenCalled()
    const names = [...document.querySelectorAll('[id],[name],[class],[aria-label]')].map((el) =>
      ['id', 'name', 'class', 'aria-label'].map((a) => el.getAttribute(a) ?? '').join(' '),
    )
    for (const n of names) expect(n).not.toMatch(/order|submit|cancel|modify/i)
  })
})
