// Keys (spec 5.2; UI_SPEC section 5). Three layers:
//  - globalKeyAction(): a pure map from a keydown to what it asks for, tested on its own;
//  - useCommandLineKeys(): Esc, Ctrl+K and Home focus the command line from anywhere (the command line
//    owns these, so it works on its own);
//  - useTerminalKeys(): the rest (F1, F8 to F11, End, PgUp and PgDn, Shift+PgUp and PgDn, Alt+1 to 9,
//    Alt+K), bound once by the app, which knows the panels.
// No single printable character is bound (WCAG 2.1.4). A key a panel control already handled
// (defaultPrevented) is left alone, so a chart's Home and End or a grid's PgUp keep working.
import { useEffect, useRef, type RefObject } from 'react'
import type { KeyedSector } from '../commands/sectors'

/** The fields of a KeyboardEvent the maps read. */
export interface KeyLike {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly defaultPrevented: boolean
}

export interface KeyWhere {
  readonly inCommandLine: boolean
  readonly lineEmpty: boolean
  /** Focus is in a text field (the command line or an amber field), where Home and End move the caret. */
  readonly inTextField: boolean
}

export type GlobalKeyAction =
  | { readonly kind: 'focus-command' }
  | { readonly kind: 'help' }
  | { readonly kind: 'sector'; readonly sector: KeyedSector }
  | { readonly kind: 'back' }
  | { readonly kind: 'page'; readonly dir: 1 | -1 }
  | { readonly kind: 'history'; readonly older: boolean }
  | { readonly kind: 'panel'; readonly n: number }
  | { readonly kind: 'keymap' }

const SECTOR_F_KEYS: Readonly<Record<string, KeyedSector>> = { F8: 'EQUITY', F9: 'COMDTY', F10: 'INDEX', F11: 'CURNCY' }

function modifiers(e: KeyLike): 'none' | 'shift' | 'alt' | 'other' {
  if (e.ctrlKey || e.metaKey) return 'other'
  if (e.altKey) return e.shiftKey ? 'other' : 'alt'
  return e.shiftKey ? 'shift' : 'none'
}

function altKey(e: KeyLike): GlobalKeyAction | null {
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined)
  if (digit) return { kind: 'panel', n: Number(digit) }
  if (e.code === 'KeyK' || e.key.toLowerCase() === 'k') return { kind: 'keymap' }
  return null
}

function plainKey(e: KeyLike, where: KeyWhere): GlobalKeyAction | null {
  if (e.key === 'F1') return { kind: 'help' }
  const sector = SECTOR_F_KEYS[e.key]
  if (sector) return { kind: 'sector', sector }
  if (e.key === 'PageUp' || e.key === 'PageDown') return { kind: 'page', dir: e.key === 'PageUp' ? -1 : 1 }
  if (e.key === 'End') {
    const caretKey = where.inCommandLine ? !where.lineEmpty : where.inTextField
    return caretKey ? null : { kind: 'back' }
  }
  return null
}

/** What a keydown asks for, or null when it is not a terminal key here. Pure. */
export function globalKeyAction(e: KeyLike, where: KeyWhere): GlobalKeyAction | null {
  if (e.isComposing || e.defaultPrevented) return null
  const mods = modifiers(e)
  if (mods === 'alt') return altKey(e)
  if (mods === 'shift') {
    if (e.key === 'PageUp' || e.key === 'PageDown') return { kind: 'history', older: e.key === 'PageUp' }
    return null
  }
  if (mods !== 'none') return null
  if (e.key === 'Home') return where.inTextField ? null : { kind: 'focus-command' }
  return plainKey(e, where)
}

function isPlain(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

function isTextField(el: Element | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'))
}

export function isFocusKey(e: KeyboardEvent): 'escape' | 'ctrl-k' | 'home' | null {
  if (e.isComposing) return null
  if (e.key === 'Escape' && isPlain(e)) return 'escape'
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return 'ctrl-k'
  if (e.key === 'Home' && isPlain(e) && !isTextField(document.activeElement)) return 'home'
  return null
}

/**
 * Focus `inputRef` on Esc, Ctrl+K or Home, remembering the element that had focus in `previousFocus`
 * so a later Esc (handled by the command line itself) can return there.
 */
export function useCommandLineKeys(inputRef: RefObject<HTMLInputElement | null>, previousFocus: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const input = inputRef.current
      const which = isFocusKey(e)
      if (!input || !which || e.defaultPrevented || document.activeElement === input) return
      e.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) previousFocus.current = active
      input.focus()
      if (which === 'ctrl-k') input.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef, previousFocus])
}

/** Runs the app-level actions for keys `globalKeyAction` maps; focus keys are the command line's own. */
export function useTerminalKeys(where: () => KeyWhere, run: (action: GlobalKeyAction) => void): void {
  const latest = useRef({ where, run })
  latest.current = { where, run }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = globalKeyAction(e, latest.current.where())
      if (!action || action.kind === 'focus-command') return
      e.preventDefault()
      latest.current.run(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
