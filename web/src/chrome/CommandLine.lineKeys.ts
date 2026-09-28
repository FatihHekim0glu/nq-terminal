// Keys inside the command line (spec 4.2 and 5.2; UI_SPEC section 5):
//   Enter (and NumpadEnter) runs the typed line (Shift+Enter in a new panel), or chooses the option or
//   menu row the user arrowed to; Tab completes; Esc runs the CANCEL cascade, then returns focus;
//   Up and Down move through a menu or the sheet (Up on the first row hides the sheet), else walk the
//   history, as do Shift+PgUp and Shift+PgDn.
// Returns true when the key was handled here (the caller then stops it).
import { cancelStep, chooseItem, chooseSuggestion, returnFocus, runText, takeSuggestion } from './CommandLine.dispatch'
import { MORE_PREFIX, type CommandLineParts } from './CommandLine.state'

export interface LineKey {
  readonly key: string
  readonly shiftKey: boolean
}

function menuArrow(p: CommandLineParts, down: boolean): void {
  const count = p.menus.menu?.items.length ?? 0
  if (count === 0) return
  const row = p.menus.row
  if (down) p.menus.setRow(row === null ? 0 : Math.min(row + 1, count - 1))
  else p.menus.setRow(row === null || row === 0 ? 0 : row - 1)
}

/** Up and Down: the menu, the sheet (cmdk moves; Up on the first row hides it), or the history. */
function arrow(p: CommandLineParts, up: boolean): boolean {
  if (p.menus.menu) {
    menuArrow(p, !up)
    return true
  }
  if (p.sheetOpen) {
    const onFirst = !p.s.navigated || (p.highlighted === p.ordered[0] && !p.s.selected.startsWith(MORE_PREFIX))
    if (up && onFirst) {
      p.s.setDismissed(true)
      return true
    }
    p.s.setNavigated(true)
    return false
  }
  p.s.walk(up)
  return true
}

function enter(p: CommandLineParts, shiftKey: boolean): void {
  const menu = p.menus.menu
  const row = p.menus.row
  if (menu && row !== null && menu.items[row]) {
    chooseItem(p, menu.items[row], shiftKey)
    return
  }
  if (p.sheetOpen && p.s.navigated && (p.highlighted || p.s.selected.startsWith(MORE_PREFIX))) {
    chooseSuggestion(p, p.s.selected.startsWith(MORE_PREFIX) ? p.s.selected : (p.highlighted?.value ?? ''), shiftKey)
    return
  }
  runText(p, p.s.line, shiftKey)
}

export function handleLineKey(e: LineKey, p: CommandLineParts): boolean {
  if (e.key === 'Enter') {
    enter(p, e.shiftKey)
    return true
  }
  const completion = p.highlighted ?? p.ordered[0]
  if (e.key === 'Tab' && !e.shiftKey && p.sheetOpen && completion) {
    takeSuggestion(p, completion)
    return true
  }
  if (e.key === 'Escape') {
    if (!cancelStep(p)) returnFocus(p)
    return true
  }
  if ((e.key === 'PageUp' || e.key === 'PageDown') && e.shiftKey) {
    p.s.walk(e.key === 'PageUp')
    return true
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return arrow(p, e.key === 'ArrowUp')
  return false
}
