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

/** Tracks the page of the panel body that holds `inside`. */
export function usePanelPage(inside: RefObject<HTMLElement | null>): PanelPage | null {
  const [page, setPage] = useState<PanelPage | null>(null)
  useEffect(() => {
    const body = inside.current?.closest<HTMLElement>('.nqt-panel-body')
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
    return () => {
      body.removeEventListener('scroll', update)
      resize?.disconnect()
    }
  }, [inside])
  return page
}
