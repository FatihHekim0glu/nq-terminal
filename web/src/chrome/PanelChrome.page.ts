// `Page n/m` for a panel whose body scrolls (look spec 4.4): PgUp and PgDn page the body by its own
// height (KeyToolbar.panels pagePanel), so page n of m is the body's scroll position in those steps.
// Null while the body is not laid out or everything fits on one page: the red bar then shows no
// page indicator.
import { useEffect, useState, type RefObject } from 'react'

export interface PanelPage {
  readonly n: number
  readonly m: number
}

/** The page of a scroll box of `height` px showing `top` of `total`; null when it all fits. */
export function pageOf(top: number, height: number, total: number): PanelPage | null {
  if (height <= 0 || total <= height + 1) return null
  const m = Math.ceil(total / height)
  const atEnd = top + height >= total - 1
  const n = atEnd ? m : Math.min(m, Math.floor(top / height) + 1)
  return { n, m }
}

/** The panel body that holds (or, for a header slot such as the red bar, sits beside) `el`: its own
 * closest `.nqt-panel-body` when it is inside one (a screen's own content, the existing callers), else
 * the one `.nqt-panel-body` of its nearest panel section (U27: FunctionBar portals into the bar slot,
 * a sibling of the body, not a descendant of it). */
function panelBodyOf(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  return el.closest<HTMLElement>('.nqt-panel-body') ?? el.closest<HTMLElement>('[data-nqt-panel]')?.querySelector<HTMLElement>('.nqt-panel-body') ?? null
}

/** Tracks the page of the panel body that holds (or sits beside, in a header slot) `inside`. */
export function usePanelPage(inside: RefObject<HTMLElement | null>): PanelPage | null {
  const [page, setPage] = useState<PanelPage | null>(null)
  useEffect(() => {
    const body = panelBodyOf(inside.current)
    if (!body) return undefined
    const update = () => {
      const next = pageOf(body.scrollTop, body.clientHeight, body.scrollHeight)
      setPage((prev) => (prev?.n === next?.n && prev?.m === next?.m ? prev : next))
    }
    update()
    body.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(body)
    if (inside.current) resize?.observe(inside.current)
    // A resize observer alone misses content arriving or leaving while the body's own box stays the
    // same size (e.g. FunctionBar mounted while a screen is 'Loading', rows arrive later; or a filter
    // shrinks the list): the body's scrollHeight changes with no resize of the body itself. childList
    // only (no characterData), so live-ticking cell text does not trigger a layout read on every tick.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    mutations?.observe(body, { childList: true, subtree: true })
    if (body.firstElementChild) resize?.observe(body.firstElementChild)
    return () => {
      body.removeEventListener('scroll', update)
      resize?.disconnect()
      mutations?.disconnect()
    }
  }, [inside])
  return page
}
