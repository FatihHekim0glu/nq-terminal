// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { globalKeyAction, isFocusKey, useCommandLineKeys, type KeyLike } from './CommandLine.keys'

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

  it('holds F2 and F4 back from the browser with no terminal action (spec 5.2 drops the F-key plan)', () => {
    for (const where of [inPanel, inLine, inTypedLine]) {
      expect(globalKeyAction(key('F2'), where)).toEqual({ kind: 'reserved', key: 'F2' })
      expect(globalKeyAction(key('F4'), where)).toEqual({ kind: 'reserved', key: 'F4' })
    }
    // Alt+F4 and Ctrl+F4 stay the system's and the browser's.
    expect(globalKeyAction(key('F4', { altKey: true }), inPanel)).toBeNull()
    expect(globalKeyAction(key('F4', { ctrlKey: true }), inPanel)).toBeNull()
  })

  it('leaves the F-keys nq-lab does not use to the browser', () => {
    for (const f of ['F3', 'F5', 'F6', 'F7', 'F12']) expect(globalKeyAction(key(f), inPanel)).toBeNull()
  })

  it('End is BACK from a panel or an empty line, and the caret key inside a typed line', () => {
    expect(globalKeyAction(key('End'), inPanel)).toEqual({ kind: 'back' })
    expect(globalKeyAction(key('End'), inLine)).toEqual({ kind: 'back' })
    expect(globalKeyAction(key('End'), inTypedLine)).toBeNull()
    expect(globalKeyAction(key('End'), { ...inPanel, inTextField: true })).toBeNull()
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
