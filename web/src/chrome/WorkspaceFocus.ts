// Panel focus handling (UI_SPEC section 5, Keys): each panel is one Tab stop, with a roving
// tabindex inside. Items that take part carry `data-roving`; the one that should get focus first
// carries `data-roving-default`. Every other focusable element inside a panel is taken out of the
// Tab order, so Tab and Shift+Tab move between panels. Left and Right move between the items of
// the focused panel unless the item (a chart, a grid) already handled the key; on a tab they stay in
// its tablist and wrap, Home and End go to the first and last tab (the ARIA tabs pattern) and Down
// goes into the panel's content. Up and
// Down, and Home and End on any other item, are left to the item, because they scroll. While a panel shows an overlay marked
// `data-roving-overlay` (the related functions menu), the Tab stop is taken from that overlay's items,
// so Tab from the command line lands in the open menu and its scroll region stays keyboard reachable.
import { useEffect, type RefObject } from 'react'

export const ROVING_ATTR = 'data-roving'
export const ROVING_DEFAULT_ATTR = 'data-roving-default'
export const ROVING_OVERLAY_ATTR = 'data-roving-overlay'

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'iframe', 'summary',
  'audio[controls]', 'video[controls]', '[contenteditable="true"]', '[tabindex]',
].join(',')

const NEXT_KEY = 'ArrowRight'
const PREV_KEY = 'ArrowLeft'
const INTO_KEY = 'ArrowDown'

function isDisabled(el: HTMLElement): boolean {
  return el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || Boolean(el.hidden)
}

function isTextField(el: HTMLElement): boolean {
  return el.isContentEditable || el.matches('input, textarea, select')
}

function setTabIndex(el: HTMLElement, value: number): void {
  if (el.getAttribute('tabindex') !== String(value)) el.tabIndex = value
}

export function rovingItems(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(`[${ROVING_ATTR}]`)).filter((el) => !isDisabled(el))
}

// Hidden containers (dockview hides a group's tab strip with an inline display: none).
const HIDDEN_ANCESTOR = '[hidden], [inert], [style*="display: none"], [style*="display:none"]'

/** Elements inside `root` that Tab would stop on (tabindex 0 or natively focusable, not hidden). */
export function panelTabStops(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !isDisabled(el) && el.closest(HIDDEN_ANCESTOR) === null,
  )
}

function pickCurrent(items: readonly HTMLElement[], prefer?: HTMLElement): HTMLElement | undefined {
  if (prefer && items.includes(prefer)) return prefer
  return (
    items.find((el) => el.getAttribute('tabindex') === '0') ??
    items.find((el) => el.hasAttribute(ROVING_DEFAULT_ATTR)) ??
    items[0]
  )
}

/**
 * Leaves exactly one Tab stop in the panel: `prefer` when it is an item, else the current one,
 * else the default item, else the first. Writes only attributes that change, so a
 * MutationObserver that calls it cannot loop. Returns the Tab stop.
 */
export function syncRoving(panel: HTMLElement, prefer?: HTMLElement): HTMLElement | undefined {
  const items = rovingItems(panel)
  const overlay = panel.querySelector<HTMLElement>(`[${ROVING_OVERLAY_ATTR}]`)
  const inOverlay = overlay ? items.filter((el) => overlay.contains(el)) : []
  const current = pickCurrent(inOverlay.length > 0 ? inOverlay : items, prefer)
  for (const el of panel.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!items.includes(el)) setTabIndex(el, -1)
  }
  for (const el of items) setTabIndex(el, el === current ? 0 : -1)
  return current
}

function moveTo(panel: HTMLElement, event: KeyboardEvent, next: HTMLElement): true {
  event.preventDefault()
  syncRoving(panel, next)
  next.focus()
  return true
}

/**
 * A tab follows the ARIA tabs pattern its role promises: Left and Right stay inside its tablist and
 * wrap at the ends, Home and End go to the first and last tab. Enter or Space selects (TabStrip).
 */
function handleTabKey(panel: HTMLElement, target: HTMLElement, event: KeyboardEvent): boolean | null {
  if (target.getAttribute('role') !== 'tab') return null
  const list = target.closest<HTMLElement>('[role="tablist"]')
  if (!list) return null
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter((el) => !isDisabled(el))
  const index = tabs.indexOf(target)
  const n = tabs.length
  if (index === -1 || n === 0) return null
  if (event.key === INTO_KEY) {
    // Tab moves between panels, so Down is the way from the tabs into the panel's content.
    const items = rovingItems(panel)
    const after = items.slice(items.indexOf(tabs[n - 1]!) + 1).find((el) => !list.contains(el))
    return after ? moveTo(panel, event, after) : false
  }
  const pick: Record<string, number> = { [NEXT_KEY]: (index + 1) % n, [PREV_KEY]: (index - 1 + n) % n, Home: 0, End: n - 1 }
  const at = pick[event.key]
  if (at === undefined) return false
  return moveTo(panel, event, tabs[at]!)
}

/** Moves between items on Left and Right (and between tabs on Home and End). True when it handled the key. */
export function handleRovingKey(panel: HTMLElement, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  const target = event.target as HTMLElement | null
  if (!target || isTextField(target)) return false
  const tab = handleTabKey(panel, target, event)
  if (tab !== null) return tab
  if (event.key !== NEXT_KEY && event.key !== PREV_KEY) return false
  const items = rovingItems(panel)
  const index = items.indexOf(target)
  if (index === -1) return false
  const step = event.key === NEXT_KEY ? 1 : -1
  const next = items[Math.min(Math.max(index + step, 0), items.length - 1)]
  if (!next) return false
  return moveTo(panel, event, next)
}

/** Keeps a panel element's roving tabindex in step with its content as screens render. */
export function usePanelRoving(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return undefined
    syncRoving(panel)
    const observer = new MutationObserver(() => syncRoving(panel))
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', ROVING_ATTR, ROVING_OVERLAY_ATTR, 'disabled', 'href'] })
    const onKey = (event: KeyboardEvent) => handleRovingKey(panel, event)
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.hasAttribute(ROVING_ATTR)) syncRoving(panel, target)
    }
    panel.addEventListener('keydown', onKey)
    panel.addEventListener('focusin', onFocus)
    return () => {
      observer.disconnect()
      panel.removeEventListener('keydown', onKey)
      panel.removeEventListener('focusin', onFocus)
    }
  }, [ref])
}
