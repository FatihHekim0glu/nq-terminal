// The rendered width of an element, kept current with a ResizeObserver, for screens that drop their
// lower-priority grid columns in a narrow panel rather than scroll sideways (TASKS Phase 8 notes: LEDG
// at 1366x768, REG in a 682px HOME cell). A callback ref, so an element that mounts after the first
// render (a grid shown once its data arrives) is still measured. Null until measured, and where the
// browser lays nothing out (a zero width), so the full column set is the default.
import { useCallback, useLayoutEffect, useState } from 'react'

export interface ElementWidth {
  readonly ref: (el: HTMLElement | null) => void
  readonly width: number | null
}

export function useElementWidth(): ElementWidth {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const ref = useCallback((node: HTMLElement | null) => setEl(node), [])
  useLayoutEffect(() => {
    if (!el) return undefined
    const measure = () => {
      const w = el.getBoundingClientRect().width
      setWidth(w > 0 ? w : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return { ref, width }
}

/** The width a grid of these columns needs without a sideways scroll: the columns, the `N)` column and the borders. */
export function gridWidth(columns: ReadonlyArray<{ readonly width: number }>, numbered = true): number {
  const NUMBER_COLUMN = 40
  return columns.reduce((sum, c) => sum + c.width, 0) + (numbered ? NUMBER_COLUMN : 0) + 2
}
