// MON's 2Day cell (look spec 7.7): a #181818 box with the last two sessions' hourly closes, the prior
// session grey, the last white, the final segment in up or down colour, and the same in words for
// assistive technology. Each cell asks GET /api/market/two-day for its own symbol only once its row has
// been on screen (every symbol is a gated 1m read in the backend, so rows never scrolled to cost nothing);
// the query cache keeps the answer for the session.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTwoDay } from '../../api/queries.screens'
import { MON } from '../../copy/market'
import { formatLast } from './model'
import { sparkline, sparkText } from './twoDay'

export const SPARK_W = 52
export const SPARK_H = 12

/** True once the element has been in view (IntersectionObserver); true at once where there is none. */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || !el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}

const NONE: readonly string[] = []

export interface TwoDayCellProps {
  readonly symbol: string
  readonly root: string
  readonly tick: number | null
}

export default function TwoDayCell({ symbol, root, tick }: TwoDayCellProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useSeen(ref)
  const query = useTwoDay(seen ? [symbol] : NONE)
  const row = query.data?.rows.find((r) => r.symbol === symbol)
  const spark = row ? sparkline(row, SPARK_W, SPARK_H) : null
  const text = row
    ? sparkText(row, query.data?.sessions ?? [], (v) => formatLast(root, v, tick))
    : query.isPending && seen ? MON.twoDayLoading : MON.twoDayNone
  // Busy while its read is in flight, so a screenshot or a screen reader waits for the line.
  const busy = seen && query.isFetching && !row
  return (
    <span ref={ref} className="mon-spark" aria-busy={busy ? true : undefined}>
      {spark ? (
        <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden="true" focusable="false">
          <polyline className="mon-spark-prior" points={spark.prior} />
          <polyline className="mon-spark-current" points={spark.current} />
          <polyline className={`mon-spark-final mon-spark-${spark.tone}`} points={spark.final} />
        </svg>
      ) : null}
      <span className="sr-only">{text}</span>
    </span>
  )
}
