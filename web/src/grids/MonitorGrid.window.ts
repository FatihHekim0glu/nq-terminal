// The virtual window of MonitorGrid (TanStack Virtual): which display rows are rendered, the spacer
// heights above and below them, and scrolling a row or a cell into view. Rows are 20px (decision D1);
// the sticky 20px header sits at the top of the same scroll box, so the body starts 20px down and a
// row scrolled into view is never hidden under the header (WCAG 2.4.11).
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { spacerHeights } from './MonitorGrid.model'

export const ROW_PX = 20
const OVERSCAN = 12

interface Keyed {
  readonly key: string
}

export function useGridWindow(display: readonly Keyed[]) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: OVERSCAN,
    paddingStart: ROW_PX,
    scrollPaddingStart: ROW_PX,
    getItemKey: (i) => display[i]?.key ?? i,
  })
  const latest = useRef(virtualizer)
  useLayoutEffect(() => {
    latest.current = virtualizer
  })
  const items = virtualizer.getVirtualItems()
  const spacer = spacerHeights(items, virtualizer.getTotalSize(), ROW_PX)
  const firstIndex = items[0]?.index ?? 0
  const lastIndex = items[items.length - 1]?.index ?? -1

  const scrollToRow = useCallback((index: number) => latest.current.scrollToIndex(index, { align: 'auto' }), [])
  const pageRows = useCallback(() => {
    const height = latest.current.scrollRect?.height ?? 0
    return Math.max(1, Math.floor((height - ROW_PX) / ROW_PX))
  }, [])
  const revealColumn = useCallback((cell: HTMLElement | null) => {
    const box = scrollRef.current
    if (!cell || !box) return
    const left = cell.offsetLeft
    const right = left + cell.offsetWidth
    if (left < box.scrollLeft) box.scrollLeft = left
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth
  }, [])
  const isRendered = (index: number) => index >= firstIndex && index <= lastIndex

  return { scrollRef, items, spacer, scrollToRow, pageRows, revealColumn, isRendered }
}
