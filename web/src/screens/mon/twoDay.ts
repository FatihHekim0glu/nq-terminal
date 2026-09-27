// MON's 2Day sparkline (look spec 7.7): the last two in-sample sessions' hourly closes as served by
// GET /api/market/two-day. Pure geometry and words; nothing is computed from the prices beyond placing
// them in the box. x runs over the served points in order; y from the lowest close (bottom) to the
// highest (top); a missing close is a gap. The final segment's tone compares the last close with the
// prior session's close, and the words say the same, so colour is never the only cue.
import type { Schemas } from '../../api/types'
import { fillCopy } from '../../copy/workspace'
import { MON } from '../../copy/market'

type Row = Schemas['TwoDayRow']

export interface Sparkline {
  /** SVG polyline points of the prior session, the last session and its final segment. */
  readonly prior: string
  readonly current: string
  readonly final: string
  readonly tone: 'up' | 'down' | 'flat'
}

const round = (v: number) => String(Math.round(v * 100) / 100)
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function points(xs: ReadonlyArray<readonly [number, number]>): string {
  return xs.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')
}

/** The sparkline in a `width` by `height` box; null when fewer than two closes are served. */
export function sparkline(row: Row, width: number, height: number): Sparkline | null {
  const closes = row.c.filter(finite)
  if (closes.length < 2) return null
  const lo = Math.min(...closes)
  const span = Math.max(...closes) - lo || 1
  const step = row.c.length > 1 ? width / (row.c.length - 1) : 0
  const at = (i: number, v: number): [number, number] => [i * step, height - ((v - lo) / span) * height]
  const prior: [number, number][] = []
  const current: [number, number][] = []
  row.c.forEach((v, i) => {
    if (!finite(v)) return
    ;(row.day[i] === 0 ? prior : current).push(at(i, v))
  })
  const last = row.last
  const tone = !finite(last) || !finite(row.prior_close) || last === row.prior_close ? 'flat' : last > row.prior_close ? 'up' : 'down'
  return { prior: points(prior), current: points(current), final: points(current.slice(-2)), tone }
}

/** The cell in words: sessions, last close, prior close and direction (prices in the column's format). */
export function sparkText(row: Row, sessions: readonly string[], price: (v: number) => string): string {
  if (!finite(row.last)) return MON.twoDayNone
  const direction = !finite(row.prior_close) ? MON.twoDayFlat : row.last > row.prior_close ? MON.twoDayUp : row.last < row.prior_close ? MON.twoDayDown : MON.twoDayFlat
  return fillCopy(MON.twoDayText, {
    first: sessions[0] ?? '--',
    end: sessions[sessions.length - 1] ?? '--',
    last: price(row.last),
    prior: finite(row.prior_close) ? price(row.prior_close) : '--',
    direction,
  })
}
