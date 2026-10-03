// Detectors for the reflow and resize-text checks (WCAG 2.2 SC 1.4.4 Resize Text, SC 1.4.10 Reflow): which controls of a scope
// can be reached, which boxes of text or controls overlap, and what pushes a body to scroll sideways. They run in the page
// (no eval: the page's CSP forbids it, so the logic is written out where it runs) and are shared by the browser survey
// (reflow-200.spec.ts) and the desktop zoom specs (desktop/50-zoom.desktop.ts), so both judge a panel the same way.
import type { Page } from '@playwright/test'

export const ALL_CONTROLS = 'button, [role="button"], [role="tab"], [role="combobox"], [role="menuitem"], a[href], input, select, textarea'

/**
 * What the controls under `scope` are, for comparing a roomy page with a narrow or zoomed one: role or tag, and the accessible
 * name or text, of those that can be reached: a size, inside the viewport sideways, and the middle of the control inside every
 * ancestor that clips (overflow hidden or clip). A scroller (overflow auto or scroll) is reachable by scrolling it, so a control
 * inside one counts as being where the scroller is; a fixed or absolute control is only held by the boxes that contain it.
 */
export async function controlsIn(page: Page, scope: string, controlSelector: string = ALL_CONTROLS): Promise<string[]> {
  return page.evaluate(([selector, controlsSelector]) => {
    const root = document.querySelector(selector)
    if (root === null) return []
    // A control is reachable when the middle of its box lies inside every ancestor that clips an axis (overflow hidden or clip) and
    // inside the viewport sideways. An ancestor that scrolls an axis (overflow auto or scroll) brings the control into its own box by
    // scrolling, so from there on the control counts as being where that box is. A fixed control is only held by what contains it.
    const reachable = (el: Element): boolean => {
      const r = el.getBoundingClientRect()
      const own = getComputedStyle(el)
      if (own.visibility === 'hidden' || own.display === 'none' || r.width <= 0 || r.height <= 0) return false
      let x = r.left + r.width / 2
      let y = r.top + r.height / 2
      let child: Element = el
      let skipStatic = false
      for (let box = el.parentElement; box !== null; child = box, box = box.parentElement) {
        const childPosition = getComputedStyle(child).position
        if (childPosition === 'fixed') break
        if (childPosition === 'absolute') skipStatic = true
        const cs = getComputedStyle(box)
        if (skipStatic && cs.position === 'static') continue
        skipStatic = false
        const clipsX = ['hidden', 'clip'].includes(cs.overflowX)
        const clipsY = ['hidden', 'clip'].includes(cs.overflowY)
        const scrollsX = ['auto', 'scroll'].includes(cs.overflowX)
        const scrollsY = ['auto', 'scroll'].includes(cs.overflowY)
        if (!clipsX && !clipsY && !scrollsX && !scrollsY) continue
        const b = box.getBoundingClientRect()
        if ((clipsX && (x < b.left - 1 || x > b.right + 1)) || (clipsY && (y < b.top - 1 || y > b.bottom + 1))) return false
        if (scrollsX) x = Math.min(Math.max(x, b.left), b.right)
        if (scrollsY) y = Math.min(Math.max(y, b.top), b.bottom)
      }
      return x >= 0 && x <= window.innerWidth
    }
    const name = (el: Element): string => (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return Array.from(root.querySelectorAll(controlsSelector)).filter(reachable).map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()}: ${name(el)}`).sort()
  }, [scope, controlSelector] as const)
}

/** What `want` has that `got` lacks, counting repeats (four panels each have a bar button of the same name). */
export function missingFrom(want: readonly string[], got: readonly string[]): string[] {
  const left = [...got]
  return want.filter((c) => {
    const at = left.indexOf(c)
    if (at < 0) return true
    left.splice(at, 1)
    return false
  })
}

/**
 * Pairs of controls and of text lines under `scope` that overlap by more than a pixel in both directions, measured on the part
 * of each box a person can see (cut to every ancestor that scrolls or clips). A control and the text inside it, and a box and
 * its own descendant, are one thing, not a pair; a one-pixel clipped box (visually hidden text) is not drawn.
 */
export async function overlapsIn(page: Page, scope: string, controlSelector: string = ALL_CONTROLS): Promise<string[]> {
  return page.evaluate(([selector, controlsSelector]) => {
    const root = document.querySelector(selector)
    if (root === null) return []
    interface Box { readonly el: Element; readonly label: string; readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
    // One box per line of the element (an inline span that wraps is several boxes, not one tall box that covers its neighbours).
    const visibleBoxes = (el: Element): Box[] => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return []
      const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const label = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}: ${text}`
      const out: Box[] = []
      for (const r of Array.from(el.getClientRects())) {
        let left = r.left
        let top = r.top
        let right = r.right
        let bottom = r.bottom
        for (let box = el.parentElement; box !== null && box !== document.documentElement; box = box.parentElement) {
          const bs = getComputedStyle(box)
          if (bs.display === 'contents') continue
          const clipsX = bs.overflowX !== 'visible'
          const clipsY = bs.overflowY !== 'visible'
          if (!clipsX && !clipsY) continue
          const br = box.getBoundingClientRect()
          if (clipsX) { left = Math.max(left, br.left); right = Math.min(right, br.right) }
          if (clipsY) { top = Math.max(top, br.top); bottom = Math.min(bottom, br.bottom) }
        }
        if (right - left > 1 && bottom - top > 1) out.push({ el, label, left, top, right, bottom })
      }
      return out
    }
    const controls = Array.from(root.querySelectorAll(controlsSelector))
    const lines = Array.from(root.querySelectorAll('*')).filter((el) =>
      el.children.length === 0 && (el.textContent ?? '').trim() !== '' && !['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) &&
      el.closest(controlsSelector) === null && el.closest('svg, canvas') === null)
    const boxes = [...controls, ...lines].flatMap(visibleBoxes)
    const found: string[] = []
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i]!
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j]!
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (across > 1 && down > 1) found.push(`${a.label} | ${b.label}`)
      }
    }
    return found
  }, [scope, controlSelector] as const)
}

/**
 * What makes the page or the body of the panel under `scope` scroll sideways: the page's scroll width past its width, the body's scroll
 * width past its width when no data table is what is wide, and the boxes that run past the body's right edge outside any inner box
 * that scrolls or clips its own overflow. A data table or grid is exempt (WCAG 1.4.10: data tables need a two-dimensional layout
 * for usage or meaning); text and controls are not.
 */
export async function sidewaysIn(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const body = document.querySelector(`${selector} .nqt-panel-body`)
    if (body === null) return [`no panel body under ${selector}`]
    const found: string[] = []
    const page = document.documentElement
    if (page.scrollWidth > page.clientWidth + 1) found.push(`the page scrolls sideways (${page.scrollWidth} px of ${page.clientWidth} px)`)
    const edge = body.getBoundingClientRect().right
    const dataTables = 'table, [role="grid"], [role="table"], [role="treegrid"], .chart-a11y-tablewrap'
    const tableIsWide = Array.from(body.querySelectorAll(dataTables)).some((t) => t.getBoundingClientRect().right > edge + 1)
    if (body.scrollWidth > body.clientWidth + 1 && !tableIsWide) found.push(`the body scrolls sideways (${body.scrollWidth} px of ${body.clientWidth} px)`)
    for (const el of Array.from(body.querySelectorAll('*'))) {
      if (el.closest(dataTables) !== null) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1 || r.right <= edge + 1) continue
      let own = false
      for (let box = el.parentElement; box !== null && box !== body; box = box.parentElement) {
        const bs = getComputedStyle(box)
        if (bs.overflowX !== 'visible') { own = true; break }
      }
      if (own || (el.children.length > 0 && el.tagName !== 'BUTTON')) continue
      found.push(`${el.tagName.toLowerCase()}: ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)} (right edge ${Math.round(r.right)} px past ${Math.round(edge)} px)`)
    }
    return found
  }, scope)
}

/**
 * Text and controls under `scope` that a box cuts off sideways: a box that clips (overflow hidden or clip) or shortens with an
 * ellipsis (text-overflow: ellipsis) and holds more than it shows (scroll width past its width), while it is a line of text or
 * a control itself, has text of its own, or has a line of text or a control running past its right edge. controlsIn only asks
 * whether the middle of a control is reachable, and overlapsIn and sidewaysIn look at the visible part of a box (sidewaysIn
 * skips what sits inside a box that clips), so a label that is shortened to "Run summ..." passes all three; this is the check
 * that sees it. A cell of a data table, and the table's own column headers, may be shortened (WCAG 1.4.10 exempts data tables
 * needing a two-dimensional layout) and are not reported, nor is a visually hidden one-pixel box. A scroller (overflow auto or
 * scroll) cuts nothing off, it is reached by scrolling, so it is not a clipping box.
 */
export async function cutOffIn(page: Page, scope: string, controlSelector: string = ALL_CONTROLS): Promise<string[]> {
  return page.evaluate(([selector, controlsSelector]) => {
    const root = document.querySelector(selector)
    if (root === null) return []
    const dataTables = 'table, [role="grid"], [role="table"], [role="treegrid"], .chart-a11y-tablewrap'
    const cells = 'td, th, [role="gridcell"], [role="columnheader"], [role="rowheader"], [role="cell"]'
    const inDataCell = (el: Element): boolean => el.closest(cells) !== null && el.closest(dataTables) !== null
    const shown = (el: Element): boolean => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 2 && r.height > 2
    }
    const rightEdge = (el: Element): number => Math.max(...Array.from(el.getClientRects()).map((r) => r.right))
    const isLine = (el: Element): boolean =>
      el.children.length === 0 && (el.textContent ?? '').trim() !== '' && !['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) && el.closest('svg, canvas') === null
    const hasOwnText = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
    const label = (el: Element): string => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className !== '' ? '.' + el.className.split(' ')[0] : ''}: ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)}`
    const found: string[] = []
    for (const box of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const cs = getComputedStyle(box)
      const clips = ['hidden', 'clip'].includes(cs.overflowX) || cs.textOverflow === 'ellipsis'
      if (!clips || ['auto', 'scroll'].includes(cs.overflowX) || !shown(box) || inDataCell(box)) continue
      if (box.scrollWidth <= box.clientWidth + 1 || box.clientWidth <= 0) continue
      const edge = box.getBoundingClientRect().right
      const own = box.matches(controlsSelector) || isLine(box) || hasOwnText(box)
      const pushedOut = Array.from(box.querySelectorAll('*')).some((el) =>
        (isLine(el) || el.matches(controlsSelector)) && !inDataCell(el) && shown(el) && getComputedStyle(el).position !== 'fixed' && rightEdge(el) > edge + 1)
      if (own || pushedOut) found.push(label(box))
    }
    return found
  }, [scope, controlSelector] as const)
}
