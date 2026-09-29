// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HINT_EVERY_MS, globalKeyAction, isFocusKey, strayLetter, useCommandLineKeys, useTerminalKeys, type KeyLike, type KeyWhere } from './CommandLine.keys'
import { resetMessage, useMessage } from './MessageLine.store'
import { TYPE_HINT } from '../copy/typeHint'

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
})

const inPanel = { inCommandLine: false, lineEmpty: true, inTextField: false }
const inLine = { inCommandLine: true, lineEmpty: true, inTextField: true }
const inTypedLine = { inCommandLine: true, lineEmpty: false, inTextField: true }

describe('global keys (spec 5.2)', () => {
  it('F1 is HELP; F8 to F11 insert Equity, Comdty, Index and Curncy', () => {
    expect(globalKeyAction(key('F1'), inPanel)).toEqual({ kind: 'help' })
    expect(globalKeyAction(key('F8'), inLine)).toEqual({ kind: 'sector', sector: 'EQUITY' })
    expect(globalKeyAction(key('F9'), inLine)).toEqual({ kind: 'sector', sector: 'COMDTY' })
    expect(globalKeyAction(key('F10'), inPanel)).toEqual({ kind: 'sector', sector: 'INDEX' })
    expect(globalKeyAction(key('F11'), inPanel)).toEqual({ kind: 'sector', sector: 'CURNCY' })
  })

  it('holds F2 to F7 back from the browser with no terminal action (spec 5.2 drops the F-key plan; U11 adds F3 and F5 to F7)', () => {
    for (const where of [inPanel, inLine, inTypedLine]) {
      for (const f of ['F2', 'F3', 'F4', 'F5', 'F6', 'F7'] as const) {
        expect(globalKeyAction(key(f), where)).toEqual({ kind: 'reserved', key: f })
      }
    }
    // Alt+F4 and Ctrl+F4 stay the system's and the browser's; so do Ctrl+R (reload) and other
    // modified presses of the reserved keys.
    expect(globalKeyAction(key('F4', { altKey: true }), inPanel)).toBeNull()
    expect(globalKeyAction(key('F4', { ctrlKey: true }), inPanel)).toBeNull()
    expect(globalKeyAction(key('F5', { ctrlKey: true }), inPanel)).toBeNull()
  })

  it('leaves F12 (dev tools) to the browser: nq-lab does not use it', () => {
    expect(globalKeyAction(key('F12'), inPanel)).toBeNull()
  })

  it('End is BACK from a panel or an empty line, and the caret key inside a typed line', () => {
    expect(globalKeyAction(key('End'), inPanel)).toEqual({ kind: 'back' })
    expect(globalKeyAction(key('End'), inLine)).toEqual({ kind: 'back' })
    expect(globalKeyAction(key('End'), inTypedLine)).toBeNull()
    expect(globalKeyAction(key('End'), { ...inPanel, inTextField: true })).toBeNull()
  })

  it('Shift+End is FORWARD from a panel or an empty line, and the caret key (select to end) inside a typed line or a text field (U10)', () => {
    expect(globalKeyAction(key('End', { shiftKey: true }), inPanel)).toEqual({ kind: 'forward' })
    expect(globalKeyAction(key('End', { shiftKey: true }), inLine)).toEqual({ kind: 'forward' })
    expect(globalKeyAction(key('End', { shiftKey: true }), inTypedLine)).toBeNull()
    expect(globalKeyAction(key('End', { shiftKey: true }), { ...inPanel, inTextField: true })).toBeNull()
  })

  it('Home focuses the command line from elsewhere and is the caret key inside it', () => {
    expect(globalKeyAction(key('Home'), inPanel)).toEqual({ kind: 'focus-command' })
    expect(globalKeyAction(key('Home'), inLine)).toBeNull()
  })

  it('PgUp and PgDn page; with Shift they walk the command history', () => {
    expect(globalKeyAction(key('PageDown'), inPanel)).toEqual({ kind: 'page', dir: 1 })
    expect(globalKeyAction(key('PageUp'), inTypedLine)).toEqual({ kind: 'page', dir: -1 })
    expect(globalKeyAction(key('PageUp', { shiftKey: true }), inPanel)).toEqual({ kind: 'history', older: true })
    expect(globalKeyAction(key('PageDown', { shiftKey: true }), inLine)).toEqual({ kind: 'history', older: false })
  })

  it('Alt+1 to Alt+9 focus panel N, by key or by physical digit', () => {
    expect(globalKeyAction(key('1', { altKey: true, code: 'Digit1' }), inPanel)).toEqual({ kind: 'panel', n: 1 })
    expect(globalKeyAction(key('¡', { altKey: true, code: 'Digit1' }), inLine)).toEqual({ kind: 'panel', n: 1 })
    expect(globalKeyAction(key('9', { altKey: true, code: 'Digit9' }), inPanel)).toEqual({ kind: 'panel', n: 9 })
    expect(globalKeyAction(key('0', { altKey: true, code: 'Digit0' }), inPanel)).toBeNull()
  })

  it('Alt+K opens and closes the key map', () => {
    expect(globalKeyAction(key('k', { altKey: true, code: 'KeyK' }), inPanel)).toEqual({ kind: 'keymap' })
  })

  it('born failing: a key a panel control already handled, or an IME composition, is left alone', () => {
    expect(globalKeyAction(key('F1', { defaultPrevented: true }), inPanel)).toBeNull()
    expect(globalKeyAction(key('End', { defaultPrevented: true }), inPanel)).toBeNull()
    expect(globalKeyAction(key('F10', { isComposing: true }), inPanel)).toBeNull()
  })

  it('binds no single printable character (WCAG 2.1.4)', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789+-') expect(globalKeyAction(key(c), inPanel)).toBeNull()
  })
})

describe('useCommandLineKeys: Ctrl+K inside the command line (D11)', () => {
  afterEach(() => {
    // Unmounts every renderHook tree from this file, so its window 'storage'/'keydown' listener is
    // removed and cannot fire (with a now-detached input) during a later test.
    cleanup()
    document.body.innerHTML = ''
  })

  it('is recognised as the focus key everywhere, even with the input already focused', () => {
    expect(isFocusKey(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))).toBe('ctrl-k')
    expect(isFocusKey(new KeyboardEvent('keydown', { key: 'K', metaKey: true }))).toBe('ctrl-k')
  })

  it('born failing: selects the line and prevents the browser default even when the input already has focus', () => {
    const input = document.createElement('input')
    input.value = 'NQ GP'
    document.body.appendChild(input)
    input.focus()
    expect(document.activeElement).toBe(input)

    const inputRef = { current: input } as RefObject<HTMLInputElement | null>
    const previousFocus = { current: null } as RefObject<HTMLElement | null>
    renderHook(() => useCommandLineKeys(inputRef, previousFocus))

    let notPrevented = true
    act(() => {
      notPrevented = window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    })

    expect(notPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  it('still lets Escape and Home take the early-return path unaffected when the input is already focused', () => {
    const input = document.createElement('input')
    input.value = 'NQ GP'
    document.body.appendChild(input)
    input.focus()

    const inputRef = { current: input } as RefObject<HTMLInputElement | null>
    const previousFocus = { current: null } as RefObject<HTMLElement | null>
    renderHook(() => useCommandLineKeys(inputRef, previousFocus))

    let notPrevented = true
    act(() => {
      notPrevented = window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    // Escape with the input already focused is the command line's own cascade (CommandLine.tsx), not this hook.
    expect(notPrevented).toBe(true)
  })
})

describe('useTerminalKeys: a held or repeated F1 never piles up HELP panels (U20)', () => {
  afterEach(cleanup)

  const where: KeyWhere = { inCommandLine: false, lineEmpty: true, inTextField: false }

  it('a repeat F1 keydown is prevented (so the browser help page never opens) but never runs the action', () => {
    const run = vi.fn()
    renderHook(() => useTerminalKeys(() => where, run))

    let notPrevented = true
    act(() => {
      notPrevented = window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', repeat: true, bubbles: true, cancelable: true }))
    })

    expect(notPrevented).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('a plain, non-repeat F1 keydown still runs the help action', () => {
    const run = vi.fn()
    renderHook(() => useTerminalKeys(() => where, run))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }))
    })
    expect(run).toHaveBeenCalledWith({ kind: 'help' })
  })
})

describe('strayLetter: a printable key that lands where nothing takes it (U05)', () => {
  it('is any plain character or digit on a panel or the page, with or without Shift', () => {
    for (const k of ['e', 'E', '9', '/', '?', 'é']) expect(strayLetter(key(k), inPanel)).toBe(true)
    expect(strayLetter(key('E', { shiftKey: true }), inPanel)).toBe(true)
  })

  it('is not one in a text field (the command line, an amber field) or a popup', () => {
    expect(strayLetter(key('e'), inLine)).toBe(false)
    expect(strayLetter(key('e'), inTypedLine)).toBe(false)
    expect(strayLetter(key('e'), { ...inPanel, inTextField: true })).toBe(false)
    expect(strayLetter(key('e'), { ...inPanel, inPopup: true })).toBe(false)
    expect(strayLetter(key('e'), { ...inPanel, inPopup: false })).toBe(true)
  })

  it('is not one for keys that do something else: Space, named keys, chords, held keys, composition, handled keys', () => {
    expect(strayLetter(key(' '), inPanel)).toBe(false)
    for (const k of ['Enter', 'Tab', 'Escape', 'Home', 'End', 'ArrowUp', 'F1', 'Dead', 'Shift']) expect(strayLetter(key(k), inPanel)).toBe(false)
    expect(strayLetter(key('e', { ctrlKey: true }), inPanel)).toBe(false)
    expect(strayLetter(key('e', { metaKey: true }), inPanel)).toBe(false)
    expect(strayLetter(key('e', { altKey: true }), inPanel)).toBe(false)
    expect(strayLetter(key('e', { repeat: true }), inPanel)).toBe(false)
    expect(strayLetter(key('e', { isComposing: true }), inPanel)).toBe(false)
    expect(strayLetter(key('e', { defaultPrevented: true }), inPanel)).toBe(false)
  })
})

describe('useTerminalKeys: the hint for a letter typed on a panel (U05)', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    resetMessage()
  })

  const where: KeyWhere = { inCommandLine: false, lineEmpty: true, inTextField: false }
  const press = (init: KeyboardEventInit) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    })

  it('posts the hint, runs nothing and leaves the key to the browser', () => {
    const run = vi.fn()
    renderHook(() => useTerminalKeys(() => where, run))
    let notPrevented = false
    act(() => {
      notPrevented = window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }))
    })
    expect(notPrevented).toBe(true)
    expect(run).not.toHaveBeenCalled()
    expect(useMessage.getState().text).toBe(TYPE_HINT)
    expect(TYPE_HINT).toBe('Type in the command line: <Esc> or <Home>')
  })

  it('posts nothing for a letter typed in the command line', () => {
    renderHook(() => useTerminalKeys(() => ({ inCommandLine: true, lineEmpty: true, inTextField: true }), vi.fn()))
    press({ key: 'e' })
    expect(useMessage.getState().text).toBe('')
  })

  it('says it once for a line typed into a panel, and again only after a while', () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    renderHook(() => useTerminalKeys(() => where, vi.fn()))
    press({ key: 'r' })
    const first = useMessage.getState().id
    expect(useMessage.getState().text).toBe(TYPE_HINT)
    now += 400
    press({ key: 'e' })
    press({ key: 'g' })
    expect(useMessage.getState().id).toBe(first)
    now += HINT_EVERY_MS
    press({ key: 'x' })
    expect(useMessage.getState().id).toBe(first + 1)
  })

  it('does not replace another message with the hint for a key that is not a letter', () => {
    renderHook(() => useTerminalKeys(() => where, vi.fn()))
    press({ key: 'Enter' })
    press({ key: ' ' })
    press({ key: 'e', ctrlKey: true })
    expect(useMessage.getState().text).toBe('')
  })
})

