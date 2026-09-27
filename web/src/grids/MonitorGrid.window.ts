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

const NO_SPACER = { top: 0, bottom: 0 }

/** Every row as a window item (panel mode renders the whole bounded grid). */
function allItems(count: number): { readonly index: number }[] {
  return Array.from({ length: count }, (_, index) => ({ index }))
}

/** Where the grid scrolls: its own box (default), or the enclosing panel body. */
export type GridScroll = 'own' | 'panel'

const PANEL_BODY = '.nqt-panel-body'

export function useGridWindow(display: readonly Keyed[], scroll: GridScroll = 'own') {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inPanel = scroll === 'panel'
  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => (inPanel ? scrollRef.current?.closest<HTMLElement>(PANEL_BODY) ?? null : scrollRef.current),
    estimateSize: () => ROW_PX,
    // In the panel body every row is rendered (a bounded grid such as MON or REG): the body, a Tab stop
    // of its own, is then the one scroll box, so its content stays keyboard reachable (WCAG 2.1.1).
    overscan: inPanel ? display.length : OVERSCAN,
    paddingStart: ROW_PX,
    scrollPaddingStart: ROW_PX,
    getItemKey: (i) => display[i]?.key ?? i,
  })
  const latest = useRef(virtualizer)
  useLayoutEffect(() => {
    latest.current = virtualizer
  })
  const windowed = virtualizer.getVirtualItems()
  const items: ReadonlyArray<{ readonly index: number }> = inPanel ? allItems(display.length) : windowed
  const spacer = inPanel ? NO_SPACER : spacerHeights(windowed, virtualizer.getTotalSize(), ROW_PX)
  const firstIndex = items[0]?.index ?? 0
  const lastIndex = items[items.length - 1]?.index ?? -1

  const scrollToRow = useCallback((index: number) => {
    if (!inPanel) {
      latest.current.scrollToIndex(index, { align: 'auto' })
      return
    }
    // Every row is in the DOM; the row's scroll margin keeps it clear of the sticky header (2.4.11).
    const row = scrollRef.current?.querySelector('tbody')?.rows[index]
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [inPanel])
  const pageRows = useCallback(() => {
    const height = inPanel
      ? scrollRef.current?.closest<HTMLElement>(PANEL_BODY)?.clientHeight ?? 0
      : latest.current.scrollRect?.height ?? 0
    return Math.max(1, Math.floor((height - ROW_PX) / ROW_PX))
  }, [inPanel])
  const revealColumn = useCallback((cell: HTMLElement | null) => {
    const box = scrollRef.current
    if (!cell || !box) return
    const left = cell.offsetLeft
    const right = left + cell.offsetWidth
    if (left < box.scrollLeft) box.scrollLeft = left
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth
  }, [])
  const isRendered = (index: number) => (inPanel ? index < display.length : index >= firstIndex && index <= lastIndex)

  return { scrollRef, items, spacer, scrollToRow, pageRows, revealColumn, isRendered }
}
