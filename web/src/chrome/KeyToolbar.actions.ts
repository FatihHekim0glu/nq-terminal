// What the chrome's keys do (spec 4.2 and 5.2): the key toolbar buttons, the nav toolbar controls and
// the global keys (F1, F2 and F4, F8 to F11, End, PgUp and PgDn, Shift+PgUp and PgDn, Alt+1 to 9, Alt+K) all land
// here, so a button and its key always do the same thing. Every action is a read or a focus change:
// nothing here can place, change or withdraw anything.
import { withValue } from '../commands/messages'
import { findMnemonic, type MnemonicCode } from '../commands/registry'
import type { KeyedSector } from '../commands/sectors'
import { MESSAGES, NAV_TOOLBAR, FRAME_STRIP } from '../copy/chrome'
import { SECTOR_TITLES } from '../copy/commands'
import type { CommandLineHandle } from './CommandLine'
import type { GlobalKeyAction } from './CommandLine.keys'
import type { MenuModel } from './CommandLine.menus'
import { exportPanel, focusPanelAt, pagePanel } from './KeyToolbar.panels'
import type { KeyId } from './KeyToolbar'
import { postMessage } from './MessageLine.store'
import type { NavAction } from './NavToolbar'

/** The workspace calls the chrome uses, each optional so the chrome degrades to its own fallback. */
export interface ChromeWorkspace {
  goBack?(panelId: string): boolean
  goForward?(panelId: string): boolean
  /** Alt+N: focus panel N in reading order. */
  focusPanelNumber?(n: number): boolean
  /** MENU: the related functions menu inside the focused panel (spec 4.7, with its panel dim). */
  openRelatedMenu?(panelId?: string): boolean
}

export interface ChromeEnv {
  readonly cmd: () => CommandLineHandle | null
  readonly workspace: () => ChromeWorkspace | null
  readonly focusedPanelId: () => string | null
  readonly focusedCode: () => MnemonicCode | null
  /** The focused panel's context as the command line writes it (`NQ1 Index`), or null. */
  readonly focusedContextLine: () => string | null
  readonly toggleKeymap: () => void
  readonly now?: () => number
}

export const HELP_TWICE_MS = 500

function favouritesMenu(): MenuModel {
  const tabs = [
    [FRAME_STRIP.tabs.HOME, 'HOME'],
    [FRAME_STRIP.tabs.RESEARCH, 'REG'],
    [FRAME_STRIP.tabs.LIVE, 'LIVE'],
  ] as const
  const items = tabs.map(([tab, line], i) => ({ n: i + 1, label: tab.label, detail: tab.title, category: false, act: { kind: 'run', line } as const }))
  return { key: 'favourites', title: NAV_TOOLBAR.favouritesTitle, breadcrumb: [NAV_TOOLBAR.favouritesTitle], intro: [], items }
}

export function createChromeActions(env: ChromeEnv) {
  let lastHelp = Number.NEGATIVE_INFINITY
  const now = env.now ?? (() => performance.now())

  /** F1: the focused screen's help (or the function typed in the line); twice quickly: the HELP index. */
  const help = () => {
    const t = now()
    const twice = t - lastHelp <= HELP_TWICE_MS
    lastHelp = twice ? Number.NEGATIVE_INFINITY : t
    const cmd = env.cmd()
    if (!cmd) return
    const typed = cmd.lineText().split(/\s+/).map((w) => findMnemonic(w)).find((m) => m !== undefined)?.code
    const code = typed ?? env.focusedCode()
    if (twice || !code) cmd.runLine('HELP')
    else cmd.help(code)
  }
  const back = (forward: boolean) => {
    const id = env.focusedPanelId()
    const ws = env.workspace()
    const moved = id !== null && (forward ? ws?.goForward?.(id) : ws?.goBack?.(id))
    if (!moved) postMessage(forward ? MESSAGES.forwardNone : MESSAGES.backNone)
  }
  const page = (dir: 1 | -1) => {
    const pages = env.cmd()?.takeCount() ?? 1
    if (!pagePanel(env.focusedPanelId(), { dir, pages })) postMessage(MESSAGES.onePage)
  }
  const sector = (s: KeyedSector) => {
    env.cmd()?.insert(SECTOR_TITLES[s])
    if (s === 'EQUITY') postMessage(MESSAGES.noEquities)
  }
  const panel = (n: number) => {
    const focused = env.workspace()?.focusPanelNumber?.(n) ?? focusPanelAt(n)
    if (!focused) postMessage(withValue(MESSAGES.noPanel, String(n)))
  }
  /** MENU: the panel's own related functions menu when the workspace has one, else the command sheet's. */
  const related = () => {
    if (!env.workspace()?.openRelatedMenu?.(env.focusedPanelId() ?? undefined)) env.cmd()?.related()
  }
  const runAndFocus = (line: string) => {
    env.cmd()?.runLine(line)
    env.cmd()?.focus()
  }
  return { help, back, page, sector, panel, related, runAndFocus }
}

export type ChromeActions = ReturnType<typeof createChromeActions>

/** A key toolbar button. */
export function runKey(a: ChromeActions, env: ChromeEnv, key: KeyId): void {
  const cmd = env.cmd()
  if (key === 'esc') cmd?.cancel()
  else if (key === 'help') a.help()
  else if (key === 'search') a.runAndFocus('HL')
  else if (key === 'menu') a.related()
  else if (key === 'pgback' || key === 'pgfwd') a.page(key === 'pgback' ? -1 : 1)
  else if (key === 'keymap') env.toggleKeymap()
  else a.runAndFocus(key)
}

/** A nav toolbar control. */
export function runNav(a: ChromeActions, env: ChromeEnv, action: NavAction): void {
  const cmd = env.cmd()
  if (action === 'back' || action === 'forward') a.back(action === 'forward')
  else if (action === 'context') a.runAndFocus(env.focusedContextLine() ?? 'INDEX')
  else if (action === 'mnemonic' || action === 'help') a.help()
  else if (action === 'related') a.related()
  else if (action === 'favourites') cmd?.showMenu(favouritesMenu())
  else if (!exportPanel(env.focusedPanelId())) postMessage(MESSAGES.noExport)
}

/** A global key (spec 5.2). */
export function runGlobalKey(a: ChromeActions, env: ChromeEnv, action: GlobalKeyAction): void {
  switch (action.kind) {
    case 'help':
      return a.help()
    case 'sector':
      return a.sector(action.sector)
    case 'back':
      return a.back(false)
    case 'page':
      return a.page(action.dir)
    case 'history':
      return env.cmd()?.walkHistory(action.older)
    case 'panel':
      return a.panel(action.n)
    case 'keymap':
      return env.toggleKeymap()
    case 'reserved':
      return postMessage(MESSAGES.reservedKeys[action.key])
    default:
      return undefined
  }
}
