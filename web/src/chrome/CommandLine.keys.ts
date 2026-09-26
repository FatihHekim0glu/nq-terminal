// Global keys for the command line (UI_SPEC section 5, Keys): Esc and Ctrl+K focus it from anywhere.
// No single-character shortcut is registered (WCAG 2.1.4). A key a panel control already handled
// (defaultPrevented) is left alone, and Ctrl+K is prevented so the browser does not open its search.
import { useEffect, type RefObject } from 'react'

function isPlain(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}

export function isFocusKey(e: KeyboardEvent): 'escape' | 'ctrl-k' | null {
  if (e.isComposing) return null
  if (e.key === 'Escape' && isPlain(e)) return 'escape'
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return 'ctrl-k'
  return null
}

/**
 * Focus `inputRef` on Esc or Ctrl+K, remembering the element that had focus in `previousFocus` so a
 * second Esc (handled by the command line itself) can return there.
 */
export function useCommandLineKeys(
  inputRef: RefObject<HTMLInputElement | null>,
  previousFocus: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const input = inputRef.current
      const which = isFocusKey(e)
      if (!input || !which || e.defaultPrevented) return
      e.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== input && active !== document.body) {
        previousFocus.current = active
      }
      input.focus()
      if (which === 'ctrl-k') input.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef, previousFocus])
}

/** The slice of the command line's state its own keys act on (see CommandLine.state.ts). */
export interface CommandKeyTarget {
  readonly open: boolean
  readonly navigated: boolean
  readonly highlighted: { readonly value: string } | undefined
  readonly first: { readonly value: string } | undefined
  take(s: { readonly value: string }): void
  run(newPanel: boolean): void
  walk(up: boolean): void
  dismiss(): void
  returnFocus(): void
  markNavigated(): void
}

/**
 * Keys inside the command line. Enter runs the typed line (Shift+Enter in a new panel), or takes the
 * option the user arrowed to; Tab completes the highlighted option, or the first one; Esc closes the
 * list, then returns focus; Up and Down move through the list when it is open, else walk the history.
 * Returns true when the key was handled here (the caller then stops it).
 */
export function handleCommandKey(key: string, shiftKey: boolean, t: CommandKeyTarget): boolean {
  if (key === 'Enter') {
    if (t.open && t.navigated && t.highlighted) t.take(t.highlighted)
    else t.run(shiftKey)
    return true
  }
  const completion = t.highlighted ?? t.first
  if (key === 'Tab' && !shiftKey && t.open && completion) {
    t.take(completion)
    return true
  }
  if (key === 'Escape') {
    if (t.open) t.dismiss()
    else t.returnFocus()
    return true
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    // An open list is cmdk's to move through; the first arrow picks its first (or last) option.
    if (t.open) {
      t.markNavigated()
      return false
    }
    t.walk(key === 'ArrowUp')
    return true
  }
  return false
}
