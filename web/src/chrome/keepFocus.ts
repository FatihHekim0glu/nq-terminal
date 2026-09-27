// Keeping keyboard focus in a panel when a control switches the view it sits in (WCAG 2.4.3). A row button
// that opens another view unmounts itself; without this the browser drops focus to <body> and the next Tab
// starts again at the top of the page. `switchKeepingFocus` applies the update at once (flushSync) and, when
// focus was inside the panel that holds `root` and its element is gone, moves it to the first element of that
// panel matching `selector` (a control that stays mounted, such as the now selected tab or toggle). The panel,
// not only `root`, is searched because a screen's tab strip and function bar render into the panel's slots
// above its body. Outside a panel `root` is the scope. Focus that was elsewhere (the command line running
// Number <GO>) is left where it is.
import { flushSync } from 'react-dom'

/** The panel element (PanelChrome's section) whose slots hold a screen's tab strip. */
const PANEL_SELECTOR = '[data-nqt-panel]'

export function switchKeepingFocus(root: HTMLElement | null, selector: string, update: () => void): void {
  const scope = root?.closest<HTMLElement>(PANEL_SELECTOR) ?? root
  const active = document.activeElement
  const inside = scope !== null && active instanceof HTMLElement && scope.contains(active)
  flushSync(update)
  if (!inside || scope === null || active.isConnected) return
  scope.querySelector<HTMLElement>(selector)?.focus()
}
