// Panel focus handling (UI_SPEC section 5, Keys): each panel is one Tab stop, with a roving
// tabindex inside. Items that take part carry `data-roving`; the one that should get focus first
// carries `data-roving-default`. Every other focusable element inside a panel is taken out of the
// Tab order, so Tab and Shift+Tab move between panels. Left and Right move between the items of
// the focused panel unless the item (a chart, a grid) already handled the key. Up, Down, Home and
// End are left to the item, because they scroll.
import { useEffect, type RefObject } from 'react'

export const ROVING_ATTR = 'data-roving'
export const ROVING_DEFAULT_ATTR = 'data-roving-default'

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'iframe', 'summary',
  'audio[controls]', 'video[controls]', '[contenteditable="true"]', '[tabindex]',
].join(',')

const NEXT_KEY = 'ArrowRight'
const PREV_KEY = 'ArrowLeft'

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
  const current = pickCurrent(items, prefer)
  for (const el of panel.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!items.includes(el)) setTabIndex(el, -1)
  }
  for (const el of items) setTabIndex(el, el === current ? 0 : -1)
  return current
}

/** Moves between items on Left and Right. Returns true when it handled the key. */
export function handleRovingKey(panel: HTMLElement, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  if (event.key !== NEXT_KEY && event.key !== PREV_KEY) return false
  const target = event.target as HTMLElement | null
  if (!target || isTextField(target)) return false
  const items = rovingItems(panel)
  const index = items.indexOf(target)
  if (index === -1) return false
  const step = event.key === NEXT_KEY ? 1 : -1
  const next = items[Math.min(Math.max(index + step, 0), items.length - 1)]
  if (!next) return false
  event.preventDefault()
  syncRoving(panel, next)
  next.focus()
  return true
}

/** Keeps a panel element's roving tabindex in step with its content as screens render. */
export function usePanelRoving(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return undefined
    syncRoving(panel)
    const observer = new MutationObserver(() => syncRoving(panel))
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', ROVING_ATTR, 'disabled', 'href'] })
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
