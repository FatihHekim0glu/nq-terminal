// Keys (spec 5.2; UI_SPEC section 5). Three layers:
//  - globalKeyAction(): a pure map from a keydown to what it asks for, tested on its own;
//  - useCommandLineKeys(): Esc, Ctrl+K and Home focus the command line from anywhere (the command line
//    owns these, so it works on its own);
//  - useTerminalKeys(): the rest (F1 to F7, F8 to F11, End, Shift+End, PgUp and PgDn, Shift+PgUp
//    and PgDn, Alt+1 to 9, Alt+K), bound once by the app, which knows the panels.
// F2 to F7 are reserved (spec 5.2 drops the old F2 REG and F4 LEDG plan; U11 adds F3, F5, F6 and F7 so
// none of them reload the terminal, leave it or cover the command line): the browser never gets them,
// and the message line says what to type instead. Alt+F4 and Ctrl+F4 stay the system's and the browser's.
// No single printable character is bound (WCAG 2.1.4). A key a panel control already handled
// (defaultPrevented) is left alone, so a chart's Home and End or a grid's PgUp keep working. A printable
// character that lands where nothing takes it (a panel, the page) is not bound either: it only earns a hint
// on the message line, once in a while, saying where typing goes (U05).
import { useEffect, useRef, type RefObject } from 'react'
import type { KeyedSector } from '../commands/sectors'
import { TYPE_HINT } from '../copy/typeHint'
import { postMessage } from './MessageLine.store'

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
  /** A held key repeating (absent in the maps' own tests: not a repeat). */
  readonly repeat?: boolean
}

export interface KeyWhere {
  readonly inCommandLine: boolean
  readonly lineEmpty: boolean
  /** Focus is in a text field (the command line or an amber field), where Home and End move the caret. */
  readonly inTextField: boolean
  /** Focus is inside a dialog, menu, list or grid, which take letters of their own (typeahead, mnemonics; absent: not in one). */
  readonly inPopup?: boolean
}

export type GlobalKeyAction =
  | { readonly kind: 'focus-command' }
  | { readonly kind: 'help' }
  | { readonly kind: 'sector'; readonly sector: KeyedSector }
  | { readonly kind: 'back' }
  | { readonly kind: 'forward' }
  | { readonly kind: 'page'; readonly dir: 1 | -1 }
  | { readonly kind: 'history'; readonly older: boolean }
  | { readonly kind: 'panel'; readonly n: number }
  | { readonly kind: 'keymap' }
  | { readonly kind: 'reserved'; readonly key: ReservedFKey }

/**
 * F-keys held back from the browser with no terminal action of their own (spec 5.2). F3 (browser
 * find), F5 (reload: every panel history would be lost), F6 (address bar) and F7 (caret browsing)
 * join F2 and F4 (U11): a sector key near them (F8 to F11) must never reload the terminal or leave it. F12,
 * Ctrl+R and Alt+F4 stay the browser's and the system's, unchanged.
 */
export const RESERVED_F_KEYS = ['F2', 'F3', 'F4', 'F5', 'F6', 'F7'] as const
export type ReservedFKey = (typeof RESERVED_F_KEYS)[number]

function isReserved(key: string): key is ReservedFKey {
  return (RESERVED_F_KEYS as readonly string[]).includes(key)
}

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
  if (isReserved(e.key)) return { kind: 'reserved', key: e.key }
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
    if (e.key === 'End') {
      // FORWARD (U10): the same caret-key guard as End (Back), so Shift+End still selects to the end
      // of a typed line or another text field rather than paging the focused panel forward.
      const caretKey = where.inCommandLine ? !where.lineEmpty : where.inTextField
      return caretKey ? null : { kind: 'forward' }
    }
    return null
  }
  if (mods !== 'none') return null
  if (e.key === 'Home') return where.inTextField ? null : { kind: 'focus-command' }
  return plainKey(e, where)
}

/**
 * A plain printable character that lands where nothing takes it: focus is on a panel or the page, not in a
 * text field or a popup, and no control handled the key. Space is left out (it presses a focused button), as
 * are held keys, composition and every chord with Ctrl, Alt or Meta. Pure.
 */
export function strayLetter(e: KeyLike, where: KeyWhere): boolean {
  if (e.isComposing || e.defaultPrevented || e.repeat === true) return false
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key === ' ' || [...e.key].length !== 1) return false
  return !where.inTextField && where.inPopup !== true
}

/** The least time between two hints, so a line typed into a panel says it once, not once per letter. */
export const HINT_EVERY_MS = 5000

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
      if (!input || !which || e.defaultPrevented) return
      // Ctrl+K must still select the line and hold the browser's own shortcut back (the omnibox search
      // in Chrome and Edge, the search bar in Firefox) even when the command line already has focus
      // (D11); Esc and Home stay the command line's own cascade once it is focused.
      const alreadyFocused = document.activeElement === input
      if (alreadyFocused && which !== 'ctrl-k') return
      e.preventDefault()
      const active = document.activeElement
      // Ctrl+K pressed with the input already focused moves nothing: keep whatever earlier element
      // previousFocus already names, rather than overwriting it with the input itself.
      if (active instanceof HTMLElement && active !== document.body && active !== input) previousFocus.current = active
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
    let hintedAt = -HINT_EVERY_MS
    function onKeyDown(e: KeyboardEvent) {
      const here = latest.current.where()
      const action = globalKeyAction(e, here)
      if (!action && strayLetter(e, here) && Date.now() - hintedAt >= HINT_EVERY_MS) {
        hintedAt = Date.now()
        postMessage(TYPE_HINT)
      }
      if (!action || action.kind === 'focus-command') return
      // A held or repeated F1 (U20) still must not reach the browser's own help page, but must not
      // run help again either: help() itself has no key-repeat guard (it reads a real clock for the
      // F1-twice window), so a repeat event run through it piles up HELP panels one per event.
      if (e.repeat && action.kind === 'help') {
        e.preventDefault()
        return
      }
      e.preventDefault()
      latest.current.run(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
