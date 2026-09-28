// Keyboard scrolling for the pivot grid (WCAG 2.1.1): the viewer's scrolling table sits inside its
// plugin's shadow root, where panel focus never lands, so the host element (one Tab stop in the panel)
// turns arrow keys, Page Up, Page Down, Home and End into scrolls of that table. Pure maths plus one
// lookup through open shadow roots.

export interface ScrollStep {
  readonly left: number
  readonly top: number
  /** Absolute target instead of a step (Home and End). */
  readonly to?: 'start' | 'end'
}

const LINE_PX = 20

/** The scroll a key asks for, given the visible height; null for any other key or a modified key. */
export function scrollStep(key: string, page: number, modified: boolean): ScrollStep | null {
  if (modified) return null
  const pageStep = Math.max(LINE_PX, page - LINE_PX)
  switch (key) {
    case 'ArrowDown': return { left: 0, top: LINE_PX }
    case 'ArrowUp': return { left: 0, top: -LINE_PX }
    case 'ArrowRight': return { left: LINE_PX * 4, top: 0 }
    case 'ArrowLeft': return { left: -LINE_PX * 4, top: 0 }
    case 'PageDown': return { left: 0, top: pageStep }
    case 'PageUp': return { left: 0, top: -pageStep }
    case 'Home': return { left: 0, top: 0, to: 'start' }
    case 'End': return { left: 0, top: 0, to: 'end' }
    default: return null
  }
}

/** A pixel or so of slack at each edge: browser zoom or Windows display scaling (125%/150% on the PRD
 *  platform) can leave scrollLeft a fraction of a pixel short of the exact edge value, so a strict
 *  comparison would never release the key (D36). */
const EDGE_TOLERANCE_PX = 1

/**
 * Whether the table can still scroll the way `key` asks (D36): ArrowLeft only past the start, and
 * ArrowRight only short of the end, so the host gives the key back to the panel's roving focus (the
 * Show as [Table | Pivot grid] toggle) once there is nothing left to scroll that way. Every other key
 * (vertical, Page Up/Down, Home, End) is not gated by horizontal position.
 */
export function canScrollHorizontally(key: string, table: { readonly scrollLeft: number; readonly clientWidth: number; readonly scrollWidth: number }): boolean {
  if (key === 'ArrowLeft') return table.scrollLeft > EDGE_TOLERANCE_PX
  if (key === 'ArrowRight') return table.scrollLeft + table.clientWidth < table.scrollWidth - EDGE_TOLERANCE_PX
  return true
}

/** The first element matching `selector` under `root`, looking inside open shadow roots too. */
export function deepQuery(root: Element | ShadowRoot, selector: string): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector)
  if (direct) return direct
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const inner = el.shadowRoot ? deepQuery(el.shadowRoot, selector) : null
    if (inner) return inner
  }
  return null
}

export function applyScroll(target: HTMLElement, step: ScrollStep): void {
  if (step.to === 'start') target.scrollTop = 0
  else if (step.to === 'end') target.scrollTop = target.scrollHeight
  else target.scrollBy({ left: step.left, top: step.top })
}
