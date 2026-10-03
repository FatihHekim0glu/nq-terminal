// Keeps a dropdown inside the panel that holds it. .nqt-panel clips (overflow: hidden), and a menu opens under its button
// with its natural size, so in a short panel (a stacked panel of a 200% window is about 256 CSS px high) the last rows lay
// outside the box, out of a pointer's reach, and a keyboard focus on one scrolled the clipped panel and pushed the title bar
// away (WCAG 2.2 SC 1.4.4 Resize Text, SC 1.4.10 Reflow). The menu is held to the panel's box instead: it scrolls inside the
// height the panel leaves under the button, and is moved or narrowed sideways to stay between the panel's edges.

export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface MenuFit {
  readonly maxHeight: number
  readonly maxWidth: number
  readonly shiftX: number
}

/** The menu's own 1px border, kept inside the panel on every side. */
const EDGE = 1
/** Two 24px rows: a menu is never squeezed below what a person can still scroll and read. */
const MIN_HEIGHT = 48

/** The height, width and sideways shift that keep `menu` (laid out at its natural size) inside `bounds`. */
export function fitMenu(menu: Box, bounds: Box, align: 'left' | 'right'): MenuFit {
  const maxHeight = Math.max(MIN_HEIGHT, bounds.bottom - menu.top - EDGE)
  const maxWidth = bounds.right - bounds.left - 2 * EDGE
  const width = Math.min(menu.right - menu.left, maxWidth)
  // A right-aligned menu keeps its right edge when it narrows; a left-aligned one keeps its left edge.
  const left = align === 'right' ? menu.right - width : menu.left
  const inside = Math.min(0, bounds.right - EDGE - (left + width))
  const shiftX = left + inside < bounds.left + EDGE ? bounds.left + EDGE - left : inside
  return { maxHeight, maxWidth, shiftX }
}

/** Measures `menu` against its panel and writes the fit as inline style; a menu outside a panel, or a panel with no box, is left alone. */
export function applyMenuFit(menu: HTMLElement, align: 'left' | 'right'): void {
  const panel = menu.closest<HTMLElement>('.nqt-panel')
  if (!panel) return
  menu.style.maxHeight = ''
  menu.style.maxWidth = ''
  menu.style.transform = ''
  menu.removeAttribute('data-wrap')
  const bounds = panel.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return
  const natural = menu.getBoundingClientRect()
  const fit = fitMenu(natural, bounds, align)
  menu.style.maxHeight = `${fit.maxHeight}px`
  menu.style.maxWidth = `${fit.maxWidth}px`
  if (fit.shiftX !== 0) menu.style.transform = `translateX(${fit.shiftX}px)`
  if (natural.right - natural.left > fit.maxWidth) menu.setAttribute('data-wrap', 'true')
}
