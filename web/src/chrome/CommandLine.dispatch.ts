// What the command line does (spec 5.1 and 5.2): run a typed line through parseLine and carry out the
// action (a command, a context menu, Number <GO>, a menu, HELP, HL, LAST, NO); choose a suggestion or a
// menu item; the Esc (CANCEL) cascade. Messages go to the message line. SAVE, LOAD and FORGET (roadmap #14) hand
// their name to the workspace callbacks of the options and post the text those answer.
import { describeError, withValue } from '../commands/messages'
import { parseLine, type LineAction } from '../commands/line'
import { displayContext } from '../commands/sectors'
import type { ResolvedContext } from '../commands/types'
import { COMMAND_LINE } from '../copy/commands'
import { MESSAGES } from '../copy/chrome'
import { WORKSPACE } from '../copy/workspace'
import { requestHelpTopic } from '../screens/help/helpTopic.store'
import { takeOpened } from './CommandLine.bus'
import type { MenuItem } from './CommandLine.menus'
import { withMenus } from './CommandLine.menus.load'
import { MORE_PREFIX, type CommandLineParts, type Suggestion } from './CommandLine.state'
import { postMessage } from './MessageLine.store'
import type { SuggestionGroup } from '../commands/suggest'

function fallbackOf(p: CommandLineParts) {
  return p.options.resolveFallback ? p.options.resolveFallback() : p.options.fallbackContext
}

function contextOf(p: CommandLineParts): ResolvedContext | null {
  const f = fallbackOf(p)
  return f && typeof f !== 'string' ? f : null
}

function loadContext(p: CommandLineParts, context: ResolvedContext): void {
  p.options.onContext?.(context)
  withMenus((m) => p.menus.open(m.functionMenu(context, p.options.index)))
  postMessage(withValue(COMMAND_LINE.loaded, displayContext(context, p.options.index)))
}

/** Number <GO>: item n of the open menu, else of the focused panel. Returns the line to keep, or null. */
function numberGo(p: CommandLineParts, n: number, newPanel: boolean): string | null {
  const menu = p.menus.menu
  if (!menu) {
    if (!p.options.onNumber?.(n)) postMessage(withValue(COMMAND_LINE.noItem, String(n)))
    return ''
  }
  const item = menu.items.find((i) => i.n === n)
  if (!item) {
    postMessage(withValue(COMMAND_LINE.noMenuItem, String(n)))
    return ''
  }
  chooseItem(p, item, newPanel)
  return null
}

function openMenuAction(p: CommandLineParts, action: LineAction): void {
  const index = p.options.index
  if (action.kind === 'sector') withMenus((m) => p.menus.open(m.sectorMenu(action.sector, index)))
  else if (action.kind === 'help') {
    withMenus((m) => p.menus.open(m.helpMenu(action.code)))
    // An open HELP panel also shows that function's page beside the menu.
    requestHelpTopic(action.code)
  }
  else if (action.kind === 'last') withMenus((m) => p.menus.open(m.lastMenu(p.history.history.entries)))
  else if (action.kind === 'menu') {
    if (p.menus.stack.length > 1) p.menus.up()
    else if (!p.options.onMenu?.()) withMenus((m) => p.menus.open(m.relatedMenu(contextOf(p), index)))
  }
}

/** SAVE, LOAD and FORGET (roadmap #14): the callbacks answer with the text to post, or null while the workspace is not ready. */
function workspaceWord(p: CommandLineParts, action: Extract<LineAction, { kind: 'save' | 'load' | 'forget' }>): string {
  p.menus.close()
  if (action.kind === 'load' && action.name === null) {
    const menu = p.options.workspaceMenu?.()
    if (menu) p.menus.open(menu)
    else postMessage(COMMAND_LINE.layoutUnavailable)
    return ''
  }
  const name = action.name ?? ''
  // The saved lines are read again with the plain grammar: the same index, and no focused panel to lean on.
  const parse = (line: string) => parseLine(line, { index: p.options.index, fallbackContext: null })
  const text =
    action.kind === 'save' ? p.options.onSaveWorkspace?.(name) : action.kind === 'load' ? p.options.onLoadWorkspace?.(name, parse) : p.options.onForgetWorkspace?.(name)
  postMessage(text ?? COMMAND_LINE.layoutUnavailable)
  p.history.remember(`${action.kind.toUpperCase()} ${name}`)
  return ''
}

/** Carries out a parsed line. Returns the line to keep in the box ('' clears it), or null to leave it. */
function perform(p: CommandLineParts, action: LineAction, newPanel: boolean): string | null {
  switch (action.kind) {
    case 'run': {
      const panel = newPanel || action.newPanel
      // A plain stub (most tests) returns undefined, which reads as having run; the real Workspace
      // answers `false` when it has no dockview api yet (its own lazy chunk still loading, or mounted
      // but not past onReady), meaning nothing opened.
      takeOpened()
      const ran = p.options.onRun(action.command, panel ? 'new-panel' : 'replace')
      if (ran === false) {
        p.menus.close()
        postMessage(WORKSPACE.notReady)
        // Keep the line (not history.remember'd below, since it did not run) so the user can just
        // press Enter again once the Workspace is ready, instead of retyping the whole command (D18).
        return action.command.canonical
      }
      // G14: the words of the panel that opened, when its link group made it show something else than the line.
      const opened = takeOpened() ?? action.command.canonical
      p.history.remember(action.command.canonical)
      p.menus.close()
      postMessage(withValue(panel ? COMMAND_LINE.ranNewPanel : COMMAND_LINE.ran, opened))
      return ''
    }
    case 'context':
      p.history.remember(displayContext(action.context, p.options.index))
      loadContext(p, action.context)
      return ''
    case 'number':
      return numberGo(p, action.n, newPanel)
    case 'search':
      if (action.query === '') {
        postMessage(COMMAND_LINE.searchEmpty)
        return 'HL '
      }
      withMenus((m) => p.menus.open(m.searchMenu(action.query, p.options.index, { lazy: true })))
      return ''
    case 'tape':
      postMessage(p.options.onTape?.() ? MESSAGES.tapeOn : MESSAGES.tapeOff)
      return ''
    case 'reset':
    case 'undo': {
      const callback = action.kind === 'reset' ? p.options.onReset : p.options.onUndo
      postMessage(callback?.() ?? COMMAND_LINE.layoutUnavailable)
      p.history.remember(action.kind === 'reset' ? 'RESET' : 'UNDO')
      return ''
    }
    case 'watch': {
      const menu = p.options.watchMenu?.()
      if (menu) p.menus.open(menu)
      else postMessage(COMMAND_LINE.watchUnavailable)
      return ''
    }
    case 'watch-seen':
      postMessage(p.options.onWatchSeen?.() ?? COMMAND_LINE.watchUnavailable)
      return ''
    case 'grab':
      if (!p.options.onGrab?.()) postMessage(COMMAND_LINE.grabUnavailable)
      p.menus.close()
      return ''
    case 'save':
    case 'load':
    case 'forget':
      return workspaceWord(p, action)
    default:
      openMenuAction(p, action)
      return ''
  }
}

/** An error that keeps the typed text in the box and says why on the message line. */
function refuse(p: CommandLineParts, text: string, message: string): void {
  p.s.edit(text)
  p.s.setError(message)
  p.s.setDismissed(true)
  postMessage(message, 'error')
}

// A pasted `#go=...` string (Copy link outside the fixed browser door, 03 section 4.6). The link reader is not part of
// the first paint, so a line that could be a link (it starts with `#`, `go=`, a Markdown bracket or a web address) loads
// it on demand; any other line never touches it. The reader answers in its own words (readPastedLink).
const LINK_SHAPED = /^\s*(#|go=|\[|http)/i

/** Parses `text` and carries it out; an error keeps the text and explains it. */
export function runText(p: CommandLineParts, text: string, newPanel: boolean): void {
  if (!LINK_SHAPED.test(text)) return runTyped(p, text, newPanel)
  // The reader (chrome/deepLink.paste.ts) runs a link or refuses it, in the address bar's own words; text it does not
  // take for a link, or a reader that cannot be loaded, is an ordinary line.
  const typed = () => runTyped(p, text, newPanel)
  void import('./deepLink.paste').then((m) => m.runPastedLink(p, text, newPanel, refuse, typed), typed)
}

function runTyped(p: CommandLineParts, text: string, newPanel: boolean): void {
  const result = parseLine(text, { index: p.options.index, fallbackContext: fallbackOf(p) })
  if (!result.ok) return refuse(p, text, describeError(result.error))
  const keep = perform(p, result.action, newPanel)
  if (keep !== null) p.s.edit(keep)
}

export function chooseItem(p: CommandLineParts, item: MenuItem, newPanel = false): void {
  const act = item.act
  if (act.kind === 'open') p.menus.open(act.menu, false)
  else if (act.kind === 'context') loadContext(p, act.context)
  else if (act.kind === 'fill') {
    p.menus.close()
    p.s.edit(act.line)
    p.inputRef.current?.focus()
  } else runText(p, act.line, newPanel)
}

/** Tab: complete the line with the suggestion's text. */
export function takeSuggestion(p: CommandLineParts, s: Suggestion): void {
  p.s.edit(s.value)
  p.inputRef.current?.focus()
}

/** A click, or Enter after arrowing: an instrument loads, the SEARCH row runs, More opens its group. */
export function chooseSuggestion(p: CommandLineParts, value: string, newPanel = false): void {
  if (value.startsWith(MORE_PREFIX)) {
    p.s.setExpanded(value.slice(MORE_PREFIX.length) as SuggestionGroup)
    p.inputRef.current?.focus()
    return
  }
  const s = p.ordered.find((x) => x.value.trim() === value.trim())
  if (!s) return
  if (s.group === 'instrument' || s.group === 'search') runText(p, s.value, newPanel)
  else takeSuggestion(p, s)
  p.inputRef.current?.focus()
}

/** Esc and the CANCEL key: close a menu (one level), else the sheet, else clear the line. False when nothing was open or typed. */
export function cancelStep(p: CommandLineParts): boolean {
  if (p.menus.menu) {
    if (p.menus.stack.length > 1) p.menus.up()
    else p.menus.close()
    return true
  }
  if (p.sheetOpen) {
    p.s.setDismissed(true)
    return true
  }
  if (p.s.line !== '') {
    p.s.edit('')
    return true
  }
  return false
}

export function returnFocus(p: CommandLineParts): void {
  p.s.setError(null)
  const previous = p.previousFocus.current
  if (previous?.isConnected) previous.focus()
  else if (!p.options.onReturnFocus?.()) p.inputRef.current?.blur()
}
