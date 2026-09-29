// The workspace panels as the chrome sees them (spec 4.2 and 5.2): numbered 1, 2, 3 in reading order
// (the DOM order of the panel elements), focused by number (Alt+1 to Alt+9), and paged (PgUp, PgDn).
// Reads the DOM only; the workspace keeps its own state.
//
// SHELL RULE: this file is part of the first-paint shell, so it must not import WorkspaceFocus.ts, the roving
// focus code of the panels (about 1.2 kB gzip that only the Workspace chunk and the screens need). That file
// hands its syncRoving to registerRovingSync as it loads, always before a panel exists to focus
// (chrome/KeyToolbar.panels.focus.test.ts; scripts/shellBudget.test.ts checks the build).

const PANEL_ATTR = 'data-nqt-panel'

/** WorkspaceFocus.syncRoving: leaves one Tab stop in a panel and returns it. */
type SyncRoving = (panel: HTMLElement, prefer?: HTMLElement) => HTMLElement | undefined
let syncRoving: SyncRoving | null = null

/** WorkspaceFocus.ts calls this as it loads. Until then no panel has been drawn, so focusPanelAt finds none. */
export function registerRovingSync(sync: SyncRoving): void {
  syncRoving = sync
}

export function panelElements(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${PANEL_ATTR}]`))
}

export function panelIdOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest(`[${PANEL_ATTR}]`)?.getAttribute(PANEL_ATTR) ?? null) : null
}

export function panelElement(id: string): HTMLElement | null {
  return panelElements().find((el) => el.getAttribute(PANEL_ATTR) === id) ?? null
}

/** 1 for the first panel in reading order; null when the panel is not on screen. */
export function panelNumberOf(id: string | null): number | null {
  if (!id) return null
  const at = panelElements().findIndex((el) => el.getAttribute(PANEL_ATTR) === id)
  return at < 0 ? null : at + 1
}

/** Focus panel n (its roving Tab stop); false when there is no such panel. */
export function focusPanelAt(n: number): boolean {
  const panel = panelElements()[n - 1]
  if (!panel) return false
  const stop = syncRoving?.(panel)
  stop?.focus()
  return stop !== undefined && panel.contains(document.activeElement)
}

export interface PageDetail {
  readonly dir: 1 | -1
  readonly pages: number
}

export const PAGE_EVENT = 'nqt:page'
export const EXPORT_EVENT = 'nqt:export'

/**
 * Pages the panel: a screen that pages (a grid) listens for `nqt:page` on its panel element and calls
 * preventDefault; otherwise the panel body scrolls by its height. False when neither applies.
 */
export function pagePanel(id: string | null, detail: PageDetail): boolean {
  const panel = id ? panelElement(id) : null
  if (!panel) return false
  const event = new CustomEvent<PageDetail>(PAGE_EVENT, { detail, cancelable: true })
  if (!panel.dispatchEvent(event)) return true
  const body = panel.querySelector<HTMLElement>('.nqt-panel-body') ?? panel
  if (body.scrollHeight <= body.clientHeight) return false
  body.scrollBy({ top: detail.dir * detail.pages * body.clientHeight })
  return true
}

/** Asks the panel to export its table (`nqt:export`); false when no screen answers. */
export function exportPanel(id: string | null): boolean {
  const panel = id ? panelElement(id) : null
  return panel ? !panel.dispatchEvent(new CustomEvent(EXPORT_EVENT, { cancelable: true })) : false
}
