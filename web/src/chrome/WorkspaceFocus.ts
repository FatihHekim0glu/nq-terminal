// Panel focus handling (UI_SPEC section 5, Keys): each panel is one Tab stop, with a roving
// tabindex inside. Items that take part carry `data-roving`; the one that should get focus first
// carries `data-roving-default`. Every other focusable element inside a panel is taken out of the
// Tab order, so Tab and Shift+Tab move between panels. Left and Right move between the items of
// the focused panel unless the item (a chart, a grid) already handled the key, so the panel reads the
// key after the item's own React handler (usePanelRoving returns a React onKeyDown for the panel
// element, never a native listener, which would run before React's). In a text field they move the
// caret, and only Right at the end or Left at the start moves on. On a tab they stay in
// its tablist and wrap, Home and End go to the first and last tab (the ARIA tabs pattern) and Down
// goes into the panel's content. Home and End on any other item are left to the item, because they
// scroll. Up and Down on any other item are left to the item too (they scroll), except inside a
// container marked `data-roving-vertical-list` (U12: HELP's mnemonic rail, a KPI tile row), where they
// rove between its items like Left and Right do, clamped at the ends; elsewhere, once the browser's own
// scroll has run, the still-focused item is nudged back into view (`scrollIntoView({block:'nearest'})`)
// so 3 to 5 presses can no longer carry it under the header or the command zone. While a panel shows an
// overlay marked `data-roving-overlay` (the related functions menu), the Tab stop is taken from that
// overlay's items, so Tab from the command line lands in the open menu and its scroll region stays
// keyboard reachable; the panel's body, which the overlay's dim covers, is marked inert meanwhile so it
// is not a scroll region no key reaches. A box that scrolls on its own inside the body (a virtualised grid, a statistics
// table in a fixed column) carries `data-roving-scroll`: it takes the Tab stop from the body when both
// render as stops, since a scroll region no Tab reaches fails WCAG 2.1.1 (axe scrollable-region-focusable).
// A panel whose main content is one grid behind many controls (REG: 16 round and 8 criteria buttons come
// first in the walk) marks that grid `data-roving-entry` (U09): it takes the Tab stop ahead of the body and
// of a scroll box, and ArrowUp on it, once the grid has no row above to move to, steps back to the item
// before it, so the controls above stay one key away and the grid is one Tab away.
import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { registerRovingSync } from './KeyToolbar.panels'

export const ROVING_ATTR = 'data-roving'
export const ROVING_DEFAULT_ATTR = 'data-roving-default'
export const ROVING_OVERLAY_ATTR = 'data-roving-overlay'
export const ROVING_SCROLL_ATTR = 'data-roving-scroll'
/** U09: the item Tab lands on when the panel has one, ahead of a scroll box and of the body (REG's grid). */
export const ROVING_ENTRY_ATTR = 'data-roving-entry'
/** U12: a container of `data-roving` items that reads top to bottom (HELP's mnemonic rail, a KPI tile
 * row), opted in to Up/Down roving instead of leaving those keys to the browser's own scroll, which can
 * carry the focused item out from under the header or the command zone. */
export const ROVING_VERTICAL_ATTR = 'data-roving-vertical-list'

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'iframe', 'summary',
  'audio[controls]', 'video[controls]', '[contenteditable="true"]', '[tabindex]',
].join(',')

const NEXT_KEY = 'ArrowRight'
const PREV_KEY = 'ArrowLeft'
const INTO_KEY = 'ArrowDown'
const DOWN_KEY = 'ArrowDown'
const UP_KEY = 'ArrowUp'

function isDisabled(el: HTMLElement): boolean {
  return el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || Boolean(el.hidden)
}

// Text-like input types: the ones with a caret and a selection range (an input with no type attribute
// defaults to 'text'). A checkbox, button, submit or other non-text input has no caret, so it joins the
// roving walk instead of swallowing the arrows (G11).
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'email', 'tel', 'url', 'password', 'date'])

function isTextField(el: HTMLElement): boolean {
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)
}

/** A select or a radio input keeps its own native arrow-key behaviour and never joins the roving walk. */
function isNativeArrowField(el: HTMLElement): boolean {
  return el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'radio')
}

/**
 * True when a Left or Right in this text field has no caret left to move: Right with the caret at
 * the end, Left with it at the start, and no selection. A text area is read the same way (JOBS'
 * parameters box would otherwise trap the arrows); selects and editable content keep them.
 */
function caretAtEdge(el: HTMLElement, key: string): boolean {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false
  const start = el.selectionStart
  const end = el.selectionEnd
  if (start === null || end === null || start !== end) return false
  return key === NEXT_KEY ? end === el.value.length : start === 0
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

/**
 * The Tab stop: `prefer` when it is an item; else the one stop already chosen (one item at tabindex
 * 0); else, among several rendered stops (or none), the entry item (U09), a box that scrolls on its
 * own, then the default item, then the first.
 */
function pickCurrent(items: readonly HTMLElement[], prefer?: HTMLElement): HTMLElement | undefined {
  if (prefer && items.includes(prefer)) return prefer
  const stops = items.filter((el) => el.getAttribute('tabindex') === '0')
  if (stops.length === 1) return stops[0]
  const pool = stops.length > 1 ? stops : items
  return (
    pool.find((el) => el.hasAttribute(ROVING_ENTRY_ATTR)) ??
    pool.find((el) => el.hasAttribute(ROVING_SCROLL_ATTR)) ??
    pool.find((el) => el.hasAttribute(ROVING_DEFAULT_ATTR)) ??
    pool[0]
  )
}

/**
 * When the current stop sits outside the scrolling default item (a title-bar or function-bar
 * control, e.g. Options or a Variant dropdown) and that default item overflows, leaving it as the
 * sole stop takes the panel's one scrolling region out of the Tab order entirely (axe
 * scrollable-region-focusable, G21). This only fires on an ambient resync (no explicit `prefer`),
 * but usePanelRoving's own MutationObserver turns every tabindex write, including the one a
 * deliberate arrow-key move onto a title-bar control just made, into exactly such a resync: within a
 * microtask of that move, this hands the Tab stop straight back to the overflowing body, even while
 * the title-bar control still holds real DOM focus (WorkspaceFocus.test.ts characterizes this). Tab
 * from that control therefore lands on the same panel's body (one extra Tab) rather than on whatever
 * comes after the panel; that is deliberate, so the panel's one scrolling region is never left with
 * no Tab stop of its own.
 */
function keepBodyReachable(items: readonly HTMLElement[], current: HTMLElement): HTMLElement | undefined {
  const body = items.find((el) => el.hasAttribute(ROVING_DEFAULT_ATTR))
  if (!body || body === current || body.contains(current)) return undefined
  return body.scrollHeight > body.clientHeight ? body : undefined
}

/**
 * While an overlay is open the Tab stop belongs to it, so the panel body (which the overlay's dim covers)
 * would be left at tabindex -1: a scroll region no key reaches (axe scrollable-region-focusable, WCAG
 * 2.1.1). Marking it inert for as long as the overlay is open takes it out of the page for the keyboard,
 * the pointer and assistive technology, and the mark goes with the overlay. Writes only what changes, so the
 * MutationObserver cannot loop (`inert` is not an attribute it watches in any case).
 */
function setBodyInert(items: readonly HTMLElement[], overlay: HTMLElement | null): void {
  for (const body of items) {
    if (!body.hasAttribute(ROVING_DEFAULT_ATTR)) continue
    const shouldBeInert = overlay !== null && !body.contains(overlay) && !overlay.contains(body)
    if (body.hasAttribute('inert') !== shouldBeInert) body.toggleAttribute('inert', shouldBeInert)
  }
}

/**
 * Leaves exactly one Tab stop in the panel: `prefer` when it is an item, else the current one
 * (subject to keepBodyReachable, above, when `prefer` was not given), else the default item, else
 * the first. Writes only attributes that change, so the MutationObserver that calls this on every
 * mutation (usePanelRoving, below) cannot loop forever on its own writes, though one such echo call
 * is itself expected, immediately after any write that moves the stop off an overflowing body.
 * Returns the Tab stop.
 */
export function syncRoving(panel: HTMLElement, prefer?: HTMLElement): HTMLElement | undefined {
  const items = rovingItems(panel)
  const overlay = panel.querySelector<HTMLElement>(`[${ROVING_OVERLAY_ATTR}]`)
  setBodyInert(items, overlay)
  const inOverlay = overlay ? items.filter((el) => overlay.contains(el)) : []
  let current = pickCurrent(inOverlay.length > 0 ? inOverlay : items, prefer)
  if (!overlay && !prefer && current) current = keepBodyReachable(items, current) ?? current
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
 * Moves to the first of `candidates` that takes focus and makes it the Tab stop; at the end of the walk (no
 * candidate takes focus) the current item keeps both. An item folded away by CSS (REG's rail and criteria in a
 * HOME quadrant are `display: none`) cannot take focus, and made the Tab stop it would leave the panel with
 * none the eye could see, or Tab could reach.
 */
function moveToFirst(panel: HTMLElement, event: KeyboardEvent, candidates: readonly HTMLElement[], stay: HTMLElement): true {
  event.preventDefault()
  for (const next of candidates) {
    syncRoving(panel, next)
    next.focus()
    if (document.activeElement === next) return true
  }
  syncRoving(panel, stay)
  stay.focus()
  return true
}

/** The roving items of the vertical list (ROVING_VERTICAL_ATTR) nearest `target`, in DOM order; null
 * when `target` is not inside one, so plain Up/Down still falls through to the browser's own scroll. */
function verticalGroup(panel: HTMLElement, target: HTMLElement): HTMLElement[] | null {
  const list = target.closest<HTMLElement>(`[${ROVING_VERTICAL_ATTR}]`)
  return list ? rovingItems(panel).filter((el) => list.contains(el)) : null
}

/** Up and Down inside an opted-in vertical list move between its items, clamped at the ends (U12):
 * HELP's mnemonic rail read top to bottom like any other list, not a region that merely scrolls. */
function handleVerticalKey(panel: HTMLElement, target: HTMLElement, event: KeyboardEvent): boolean {
  const items = verticalGroup(panel, target)
  if (!items) return false
  const index = items.indexOf(target)
  if (index === -1) return false
  const step = event.key === DOWN_KEY ? 1 : -1
  const next = items[Math.min(Math.max(index + step, 0), items.length - 1)]
  return next && next !== target ? moveTo(panel, event, next) : false
}

/** U12: elsewhere, Up and Down are still left to the browser's own scroll (a chart, a long grid), but
 * that scroll can carry the still-focused control out from under the header or the command zone (3 to
 * 5 presses, HELP's rail before it opted into handleVerticalKey, a KPI tile row, a RUN range button).
 * Chrome and Firefox animate arrow-key scrolling, so a single animation frame after keydown checks
 * visibility before the scroll has actually landed: it misses the first overshoot, then can snap the
 * control back mid-animation. Wait for the scroll to settle instead: the non-bubbling `scrollend` event
 * (captured at document, since it does not bubble to a listener on the scrolled element's ancestors), or
 * a fallback timeout for a browser without it, or a press that did not scroll at all. Once settled,
 * nudge the still-focused control back into view; `block: 'nearest'` moves nothing when it is already
 * visible, so a focused control is kept in view, by design (U12); genuine reading scroll with no focused
 * control left inside the moved region is untouched. */
const SCROLL_SETTLE_TIMEOUT_MS = 300

function keepScrolledIntoView(el: HTMLElement): void {
  let timer = 0
  const done = () => {
    window.clearTimeout(timer)
    document.removeEventListener('scrollend', done, true)
    if (document.activeElement === el) el.scrollIntoView({ block: 'nearest' })
  }
  document.addEventListener('scrollend', done, { capture: true, once: true })
  timer = window.setTimeout(done, SCROLL_SETTLE_TIMEOUT_MS)
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

/** U09: ArrowUp that reached the panel from an entry item (the grid had no row above and left the key
 * alone) steps back to the nearest item before it in the walk that takes focus. False when it is not an
 * entry item, or there is no item before it. */
function handleEntryUp(panel: HTMLElement, target: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== UP_KEY || !target.hasAttribute(ROVING_ENTRY_ATTR)) return false
  const items = rovingItems(panel)
  const index = items.indexOf(target)
  if (index <= 0) return false
  return moveToFirst(panel, event, items.slice(0, index).reverse(), target)
}

/** Moves between items on Left and Right (and between tabs on Home and End). True when it handled the key. */
export function handleRovingKey(panel: HTMLElement, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  const target = event.target as HTMLElement | null
  if (!target) return false
  if (isNativeArrowField(target)) return false
  if (isTextField(target) && !caretAtEdge(target, event.key)) return false
  const tab = handleTabKey(panel, target, event)
  if (tab !== null) return tab
  if (event.key === UP_KEY || event.key === DOWN_KEY) {
    if (handleVerticalKey(panel, target, event)) return true
    if (handleEntryUp(panel, target, event)) return true
    if (target.hasAttribute(ROVING_ATTR)) keepScrolledIntoView(target)
    return false
  }
  if (event.key !== NEXT_KEY && event.key !== PREV_KEY) return false
  const items = rovingItems(panel)
  const index = items.indexOf(target)
  if (index === -1) return false
  const ahead = event.key === NEXT_KEY ? items.slice(index + 1) : items.slice(0, index).reverse()
  return moveToFirst(panel, event, ahead, target)
}

/**
 * Keeps a panel element's roving tabindex in step with its content as screens render, and returns
 * the panel's keydown handler. It is a React handler on purpose: React dispatches from its root, so a
 * native listener on the panel would see a key before the grid or chart that handles it.
 */
export function usePanelRoving(ref: RefObject<HTMLElement | null>): (event: ReactKeyboardEvent<HTMLElement>) => void {
  useEffect(() => {
    const panel = ref.current
    if (!panel) return undefined
    syncRoving(panel)
    const observer = new MutationObserver(() => syncRoving(panel))
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', ROVING_ATTR, ROVING_OVERLAY_ATTR, ROVING_SCROLL_ATTR, 'disabled', 'href'] })
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.hasAttribute(ROVING_ATTR)) syncRoving(panel, target)
    }
    panel.addEventListener('focusin', onFocus)
    return () => {
      observer.disconnect()
      panel.removeEventListener('focusin', onFocus)
    }
  }, [ref])
  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const panel = ref.current
      if (panel && panel.contains(event.target as Node)) handleRovingKey(panel, event.nativeEvent)
    },
    [ref],
  )
}

// Alt+N (KeyToolbar.panels.ts, part of the shell) focuses a panel through syncRoving without importing this file.
registerRovingSync(syncRoving)
