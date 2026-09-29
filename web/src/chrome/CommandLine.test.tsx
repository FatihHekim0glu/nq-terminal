// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HistoryStorage } from '../commands/history'
import type { ParsedCommand } from '../commands/parser'
import type { CommandIndexData } from '../commands/types'
import { COMMAND_LINE, PARSE_MESSAGES } from '../copy/commands'
import { MESSAGES } from '../copy/chrome'
import { LAYOUT } from '../copy/layout'
import { CommandLine, type CommandLineHandle, type CommandLineProps } from './CommandLine'
import { resetMessage } from './MessageLine.store'

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
afterEach(() => {
  cleanup()
  resetMessage()
})

const INDEX: CommandIndexData = {
  grammar: '<context> <FUNCTION> [args]',
  mnemonics: [],
  instruments: [
    { root: 'NQ', symbol: 'NQ.V.0', sector: 'equity' },
    { root: 'ES', symbol: 'ES.V.0', sector: 'equity' },
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
  const ref = createRef<CommandLineHandle>()
  render(
    <div>
      <button type="button">panel</button>
      <header>
        <CommandLine ref={ref} index={INDEX} onRun={onRun} historyStorage={memoryStorage()} {...props} />
      </header>
    </div>,
  )
  const input = screen.getByRole('combobox', { name: COMMAND_LINE.label }) as HTMLInputElement
  const type = (text: string) => fireEvent.change(input, { target: { value: text } })
  const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input, { key: k, ...init })
  // Scoped to .msg-line: PreviewAnnouncer (CommandLine.preview.tsx) mounts another role='status'
  // region beside it whenever the caller offers previewRun, for the preview row instead of prompts
  // and errors.
  const message = () => {
    const el = screen.getAllByRole('status').find((n) => n.classList.contains('msg-line'))
    expect(el).toBeDefined()
    return el as HTMLElement
  }
  return { onRun, input, type, key, ref, message, panel: screen.getByRole('button', { name: 'panel' }) }
}

describe('CommandLine: the command box (spec 4.2)', () => {
  it('has no prompt text and no placeholder sentence', () => {
    const { input } = setup()
    expect(screen.queryByText('nq-lab>')).toBeNull()
    expect(input.getAttribute('placeholder')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.getAttribute('aria-controls')).toBeNull()
  })

  it('shows typed letters in upper case and a sector key in title case', () => {
    const { type, input } = setup()
    type('nq1 index gp')
    expect(input.value).toBe('NQ1 Index GP')
  })

  it('draws the caret triangle and a block cursor, both hidden from assistive technology', () => {
    const { input } = setup()
    const box = input.closest('.cmd-box') as HTMLElement
    expect(box.querySelector('.cmd-caret')?.getAttribute('aria-hidden')).toBe('true')
    expect(box.querySelector('.cmd-cursor')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('restarts the block cursor in the bright phase on each keystroke', () => {
    const { type, input } = setup()
    const box = input.closest('.cmd-box') as HTMLElement
    const before = box.querySelector('.cmd-cursor')
    type('N')
    expect(box.querySelector('.cmd-cursor')).not.toBe(before)
  })
})

describe('CommandLine: running commands', () => {
  it('Enter runs the typed line and replaces the focused panel; the line clears', () => {
    const { onRun, type, key, input, message } = setup()
    type('NQ GP')
    key('Enter')
    expect(onRun).toHaveBeenCalledTimes(1)
    const [command, target] = onRun.mock.calls[0]!
    expect(command).toMatchObject({ canonical: 'NQ GP', context: { kind: 'instrument', value: 'NQ' } })
    expect(target).toBe('replace')
    expect(input.value).toBe('')
    expect(message().textContent).toBe('Opened NQ GP.')
  })

  it('NumpadEnter runs the line too (its key is Enter)', () => {
    const { onRun, type, key } = setup()
    type('REG')
    key('Enter', { code: 'NumpadEnter' })
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter and NXTW open the result in a new panel', () => {
    const { onRun, type, key, message } = setup()
    type('REG')
    key('Enter', { shiftKey: true })
    expect(onRun.mock.calls[0]?.[1]).toBe('new-panel')
    expect(message().textContent).toBe('Opened REG in a new panel.')
    type('NXTW NQ GP')
    key('Enter')
    expect(onRun.mock.calls[1]?.[1]).toBe('new-panel')
    expect(onRun.mock.calls[1]?.[0].canonical).toBe('NQ GP')
  })

  it('a generic ticker with its sector key runs against the root', () => {
    const { onRun, type, key } = setup()
    type('TY1 COMDTY DES')
    key('Enter')
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('ZN DES')
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

  it('announces a repeated command again (a fresh node in the message line)', () => {
    const { type, key, message } = setup()
    type('REG')
    key('Enter')
    const first = message().firstElementChild
    type('REG')
    key('Enter')
    expect(message().textContent).toBe('Opened REG.')
    expect(message().firstElementChild).not.toBe(first)
  })

  it('a malformed line runs nothing, keeps the text and explains why in the message line', () => {
    const { onRun, type, key, input, message } = setup()
    type('NQ FOO')
    key('Enter')
    expect(onRun).not.toHaveBeenCalled()
    expect(input.value).toBe('NQ FOO')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(message().textContent).toBe(PARSE_MESSAGES['unknown-function'].replace('{token}', 'FOO'))
    expect(input.getAttribute('aria-describedby')).toContain(message().id)
    type('NQ FO')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(message().textContent).toBe('')
  })

  it('names F10 when the sector key does not fit the instrument', () => {
    const { type, key, message } = setup()
    type('NQ COMDTY')
    key('Enter')
    expect(message().textContent).toBe('NQ is an Index future: use INDEX (F10).')
  })

  it('an empty Enter explains the grammar and runs nothing', () => {
    const { onRun, key, message } = setup()
    key('Enter')
    expect(onRun).not.toHaveBeenCalled()
    expect(message().textContent).toBe(PARSE_MESSAGES.empty)
  })
})

describe('CommandLine: menus in the sheet (spec 5.1)', () => {
  it('a context on its own loads it and lists its functions, numbered; N <GO> runs one', () => {
    const onContext = vi.fn()
    const { onRun, type, key, input } = setup({ onContext })
    type('NQ1 INDEX')
    key('Enter')
    expect(onContext).toHaveBeenCalledWith({ kind: 'instrument', value: 'NQ' })
    const menu = screen.getByRole('listbox', { name: 'NQ1 Index' })
    expect(input.getAttribute('aria-controls')).toBe(menu.id)
    const options = within(menu).getAllByRole('option')
    expect(options[0]?.textContent).toMatch(/^1\)GP/)
    type('1')
    key('Enter')
    expect(onRun.mock.calls[0]?.[0].canonical).toBe('NQ GP')
    expect(screen.queryByRole('listbox', { name: 'NQ1 Index' })).toBeNull()
  })

  it('choosing an instrument in the suggestions loads it and shows its menu', () => {
    const onContext = vi.fn()
    const { type, input } = setup({ onContext })
    input.focus()
    type('es')
    fireEvent.click(within(screen.getByRole('listbox')).getByText('ES1 Index'))
    expect(onContext).toHaveBeenCalledWith({ kind: 'instrument', value: 'ES' })
    expect(screen.getByRole('listbox', { name: 'ES1 Index' })).toBeTruthy()
  })

  it('a menu item that needs an argument fills the line and waits for it', () => {
    const { type, key, input } = setup()
    type('NQ')
    key('Enter')
    const menu = screen.getByRole('listbox', { name: 'NQ1 Index' })
    const gip = within(menu).getAllByRole('option').find((o) => o.textContent?.includes('GIP'))
    fireEvent.click(gip!)
    expect(input.value).toBe('NQ GIP ')
  })

  it('INDEX lists the Index futures; COMDTY lists categories that open their futures', () => {
    const { type, key } = setup()
    type('INDEX')
    key('Enter')
    const index = screen.getByRole('listbox', { name: 'Index' })
    expect(within(index).getAllByRole('option').map((o) => o.textContent)).toEqual(['1)NQ1 IndexNQ.V.0 back-adj', '2)ES1 IndexES.V.0 back-adj'])
    type('COMDTY')
    key('Enter')
    const comdty = screen.getByRole('listbox', { name: 'Comdty' })
    fireEvent.click(within(comdty).getByText('Rates >'))
    expect(within(screen.getByRole('listbox', { name: 'Rates' })).getByText('TY1 Comdty')).toBeTruthy()
  })

  it('LAST lists the last commands, newest first', () => {
    const { type, key } = setup()
    for (const line of ['REG', 'NQ GP', 'HELP']) {
      type(line)
      key('Enter')
    }
    type('LAST')
    key('Enter')
    const last = screen.getByRole('listbox', { name: COMMAND_LINE.lastTitle })
    expect(within(last).getAllByRole('option').map((o) => o.textContent)).toEqual(['1)HELP', '2)NQ GP', '3)REG'])
  })

  it('GP HELP opens the help for GP with runnable examples', () => {
    const { type, key } = setup()
    type('GP HELP')
    key('Enter')
    const help = screen.getByRole('listbox', { name: /^GP/ })
    expect(within(help).getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('Number <GO> with no menu open asks the focused panel, and says when it has no such item', () => {
    const onNumber = vi.fn((n: number) => n === 7)
    const { type, key, message } = setup({ onNumber })
    type('7')
    key('Enter')
    expect(onNumber).toHaveBeenCalledWith(7)
    type('42')
    key('Enter')
    expect(message().textContent).toBe('No item 42 on this screen.')
  })

  it('NO toggles the event tape and says so', () => {
    const onTape = vi.fn(() => true)
    const { type, key, message } = setup({ onTape })
    type('NO')
    key('Enter')
    expect(onTape).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe(MESSAGES.tapeOn)
  })

  it('Esc closes an open menu', () => {
    const { type, key } = setup()
    type('INDEX')
    key('Enter')
    key('Escape')
    expect(screen.queryByRole('listbox', { name: 'Index' })).toBeNull()
  })
})

describe('CommandLine: suggestions (spec 4.2 autocomplete)', () => {
  it('typing opens a listbox of suggestions tied to the input', () => {
    const { type, input } = setup()
    type('re')
    const list = screen.getByRole('listbox')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('REG')
  })

  it('heads each group in capitals and puts the hide hint on the first heading', () => {
    const { type } = setup()
    type('re')
    const list = screen.getByRole('listbox')
    expect(within(list).getByText('FUNCTIONS')).toBeTruthy()
    expect(within(list).getByText(COMMAND_LINE.hideHint)).toBeTruthy()
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

  it('ArrowUp on the first row closes the sheet', () => {
    const { type, key, input } = setup()
    type('re')
    key('ArrowDown')
    key('ArrowUp')
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('offers contexts from /api/commands, instruments as generic tickers', () => {
    const { type } = setup()
    type('nq')
    const list = screen.getByRole('listbox')
    expect(within(list).getByText('NQ1 Index')).toBeTruthy()
    // The typed letters are bold inside the description, so its text spans two elements.
    const detail = Array.from(list.querySelectorAll('.det')).find((d) => d.textContent === 'NQ.V.0 back-adj')
    expect(detail?.querySelector('b')?.textContent).toBe('NQ')
  })

  it('shows a More row for a long group and opens the whole group on it', () => {
    const many = { ...INDEX, runs: Array.from({ length: 20 }, (_, i) => `run_${i}`) }
    const { type } = setup({ index: many })
    type('run_')
    const more = within(screen.getByRole('listbox')).getByText('More runs...')
    fireEvent.click(more)
    expect(within(screen.getByRole('listbox')).getAllByRole('option').filter((o) => o.textContent?.startsWith('run_'))).toHaveLength(20)
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

  it('shows a note when the index failed, and still offers functions', () => {
    const { type } = setup({ index: null, indexError: true })
    type('re')
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]?.textContent).toContain('REG')
    expect(screen.getByText(COMMAND_LINE.indexError)).toBeTruthy()
  })
})

describe('CommandLine: RESET, UNDO, WATCH and GRAB (roadmap #15, #16)', () => {
  it('RESET and UNDO post the callback text and remember the word in history', () => {
    const onReset = vi.fn(() => 'Home is back to its default layout. UNDO restores yours.')
    const onUndo = vi.fn(() => 'Undone: Home is back as it was.')
    const { type, key, message, input } = setup({ onReset, onUndo })
    type('RESET')
    key('Enter')
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe('Home is back to its default layout. UNDO restores yours.')
    expect(input.value).toBe('')
    type('UNDO')
    key('Enter')
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe('Undone: Home is back as it was.')
    type('LAST')
    key('Enter')
    const last = within(screen.getByRole('listbox', { name: COMMAND_LINE.lastTitle }))
    expect(last.getAllByRole('option').map((o) => o.textContent)).toEqual(['1)UNDO', '2)RESET'])
  })

  it('RESET and UNDO post the unavailable message without a callback', () => {
    const { type, key, message } = setup()
    type('RESET')
    key('Enter')
    expect(message().textContent).toBe(COMMAND_LINE.layoutUnavailable)
    type('UNDO')
    key('Enter')
    expect(message().textContent).toBe(COMMAND_LINE.layoutUnavailable)
  })

  it('WATCH opens the menu it is given; WATCH SEEN posts the callback text', () => {
    const watchMenu = vi.fn(() => ({
      key: 'watch',
      title: 'Since you last looked',
      breadcrumb: ['Since you last looked'],
      intro: [],
      items: [{ n: 1, label: 'za_v0', detail: 'DES', category: false, act: { kind: 'run' as const, line: 'za_v0 DES' } }],
    }))
    const onWatchSeen = vi.fn(() => 'Marked seen.')
    const { type, key, message } = setup({ watchMenu, onWatchSeen })
    type('WATCH')
    key('Enter')
    expect(watchMenu).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('listbox', { name: 'Since you last looked' })).toBeTruthy()
    type('WATCH SEEN')
    key('Enter')
    expect(onWatchSeen).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe('Marked seen.')
  })

  it('WATCH and WATCH SEEN post the unavailable message without a callback (a null watchMenu counts as none)', () => {
    const { type, key, message } = setup({ watchMenu: () => null })
    type('WATCH')
    key('Enter')
    expect(message().textContent).toBe(COMMAND_LINE.watchUnavailable)
    type('WATCH SEEN')
    key('Enter')
    expect(message().textContent).toBe(COMMAND_LINE.watchUnavailable)
  })

  it('GRAB posts grabUnavailable when onGrab is absent', () => {
    const { type, key, message } = setup()
    type('GRAB')
    key('Enter')
    expect(message().textContent).toBe(COMMAND_LINE.grabUnavailable)
  })

  it('GRAB posts grabUnavailable when onGrab returns false', () => {
    const onGrab = vi.fn(() => false)
    const { type, key, message } = setup({ onGrab })
    type('GRAB')
    key('Enter')
    expect(onGrab).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe(COMMAND_LINE.grabUnavailable)
  })

  it('GRAB posts nothing when onGrab returns true', () => {
    const onGrab = vi.fn(() => true)
    const { type, key, message } = setup({ onGrab })
    type('GRAB')
    key('Enter')
    expect(onGrab).toHaveBeenCalledTimes(1)
    expect(message().textContent).toBe('')
  })
})

describe('CommandLine: the <GO> preview row (roadmap #6 slice 2)', () => {
  function preview(command: ParsedCommand, newPanel: boolean) {
    return `${newPanel ? 'Shift' : 'Enter'}: ${command.canonical}`
  }

  it('renders the preview row from previewRun, aria-hidden, under the suggestions', () => {
    // 'NQ GP' still fuzzy-suggests GIP, so the sheet and a valid preview for the typed line show together.
    const { type, input } = setup({ previewRun: preview })
    type('NQ GP')
    const list = screen.getByRole('listbox')
    const row = list.parentElement?.querySelector('.cmd-preview')
    expect(row?.getAttribute('aria-hidden')).toBe('true')
    expect(row?.textContent).toBe(`Enter: NQ GP${LAYOUT.separator}Shift: NQ GP`)
    expect(input.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders its own popup row when the sheet is dismissed', () => {
    const { type, key, input } = setup({ previewRun: preview })
    input.focus()
    type('NQ GP')
    key('Escape')
    expect(screen.queryByRole('listbox')).toBeNull()
    const row = document.querySelector('.cmd-pop .cmd-preview')
    expect(row?.textContent).toBe(`Enter: NQ GP${LAYOUT.separator}Shift: NQ GP`)
  })

  it('hides the standalone preview popup once the line loses focus', () => {
    const { type, key, input } = setup({ previewRun: preview })
    act(() => input.focus())
    type('NQ GP')
    key('Escape')
    expect(document.querySelector('.cmd-pop .cmd-preview')).not.toBeNull()
    fireEvent.blur(input)
    expect(document.querySelector('.cmd-preview')).toBeNull()
  })

  it('never renders while a menu is open, even with a valid line underneath it', () => {
    const { type, ref } = setup({ previewRun: preview })
    type('NQ GP')
    act(() => ref.current?.showMenu({ key: 'x', title: 'X', breadcrumb: ['X'], intro: [], items: [] }))
    expect(document.querySelector('.cmd-menu')).toBeTruthy()
    expect(document.querySelector('.cmd-preview')).toBeNull()
  })

  it('renders nothing without previewRun', () => {
    const { type } = setup()
    type('NQ GP')
    expect(document.querySelector('.cmd-preview')).toBeNull()
  })

  it('without previewRun the line mounts exactly one role=status region (the message line)', () => {
    setup()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('with previewRun the announcer region is mounted before any text', () => {
    setup({ previewRun: preview })
    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    const announcer = statuses.find((n) => !n.classList.contains('msg-line'))
    expect(announcer).toBeDefined()
    expect(announcer?.textContent).toBe('')
  })
})

describe('CommandLine: Esc (CANCEL) cascade (spec 5.2)', () => {
  it('closes an open list, then clears a typed line, then returns focus to the panel', () => {
    const { type, key, input, panel } = setup()
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    type('re')
    key('Escape')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.value).toBe('RE')
    key('Escape')
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    key('Escape')
    expect(document.activeElement).toBe(panel)
  })

  it('a final Esc with no previous panel asks the workspace to focus one', () => {
    const onReturnFocus = vi.fn(() => true)
    const { key, input } = setup({ onReturnFocus })
    input.focus()
    key('Escape')
    expect(onReturnFocus).toHaveBeenCalledTimes(1)
  })

  it('clears an error when focus leaves the line by any route', () => {
    const { type, key, input, panel, message } = setup()
    input.focus()
    type('XYZ')
    key('Enter')
    expect(message().textContent).not.toBe('')
    act(() => panel.focus())
    expect(message().textContent).toBe('')
  })

  it('the handle runs the same cascade for the CANCEL key, without moving focus', () => {
    const { type, ref, input } = setup()
    type('NQ G')
    act(() => ref.current?.cancel())
    expect(input.getAttribute('aria-expanded')).toBe('false')
    act(() => ref.current?.cancel())
    expect(input.value).toBe('')
  })
})

describe('CommandLine: history and keys', () => {
  it('Up and Down in the empty line walk the history; Shift+PgUp and Shift+PgDn do too', () => {
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
    key('PageUp', { shiftKey: true })
    expect(input.value).toBe('HELP')
    key('PageDown', { shiftKey: true })
    expect(input.value).toBe('')
  })

  it('history survives a remount through storage', () => {
    const storage = memoryStorage()
    const first = setup({ historyStorage: storage })
    first.type('27F MON')
    first.key('Enter')
    cleanup()
    const second = setup({ historyStorage: storage })
    second.key('ArrowUp')
    expect(second.input.value).toBe('27F MON')
  })

  it('the handle inserts a sector key at the caret, focusing the line', () => {
    const { type, ref, input } = setup()
    type('NQ1')
    act(() => ref.current?.insert(' Index'))
    expect(input.value).toBe('NQ1 Index')
    expect(document.activeElement).toBe(input)
  })

  it('Esc, Ctrl+K and Home from anywhere focus the command line; the browser does not act on Ctrl+K', () => {
    const { input, panel } = setup()
    panel.focus()
    const notPrevented = fireEvent.keyDown(panel, { key: 'k', ctrlKey: true })
    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    panel.focus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(document.activeElement).toBe(input)
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Home' })
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
