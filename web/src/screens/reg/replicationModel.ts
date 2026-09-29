// The pure parts of MT 86) Replication (roadmap R8): each sealed confirmation joined to the registered
// in-sample p of the hypothesis it tests, and the GlyphScatter input that draws the pairs. Stored numbers
// only, tagged [SPENT]: the sealed window is spent, so nothing here is a new test. No fit, no statistic,
// no verdict of the terminal's own; the badges are the registry's and the confirmation's words.
import type { Schemas } from '../../api/types'
import { formatP } from '../../charts/echarts/format'
import type { GlyphPoint, GlyphRefLine, GlyphScatterInput, PointGlyph } from '../../charts/echarts/glyphScatterModel'
import { REPLICATION as R } from '../../copy/replication'
import { fillCopy } from '../../copy/workspace'
import { badgeText, buildRegRows, confirmationRows, type Badge } from './regModel'

export type UnmatchedReason = keyof typeof R.reasons

export interface ReplicationPoint {
  readonly confirmation: string
  readonly parent: string
  /** The parent's registered in-sample p, as the multiple-testing family stores it. */
  readonly inSampleP: number
  /** The confirmation's p on the sealed window, as stored. */
  readonly sealedP: number
  readonly ownAlpha: number | null
  readonly sealedBadge: Badge
  /** The registry's badge for the parent; null while the registry is unread or has no row for it. */
  readonly inSampleBadge: Badge | null
  /** The parent is a registered risk overlay (in the family, but its PASS is not an edge). */
  readonly overlay: boolean
  readonly window: string
}

export interface Unmatched {
  readonly confirmation: string
  readonly reason: UnmatchedReason
  readonly parent: string | null
}

export interface ReplicationView {
  readonly alpha: number
  readonly k: number
  readonly points: readonly ReplicationPoint[]
  /** Family names with no sealed confirmation at all, in rank order. */
  readonly untested: readonly string[]
  readonly unmatched: readonly Unmatched[]
  /** The distinct own alphas of the drawn confirmations, ascending. */
  readonly ownAlphas: readonly number[]
}

const isRecorded = (p: number | null): p is number => typeof p === 'number' && Number.isFinite(p)

/** Joins the family's confirmations to their parents' in-sample p. Nothing is computed from a p-value. */
export function buildReplication(mt: Schemas['MultipleTesting'], registry: Schemas['RegistryView'] | undefined): ReplicationView {
  const family = new Map(mt.rows.map((r) => [r.name, r]))
  const badges = new Map(registry ? buildRegRows(registry, []).map((r) => [r.name, r.badge]) : [])
  const points: ReplicationPoint[] = []
  const unmatched: Unmatched[] = []
  const confirmed = new Set<string>()
  for (const c of confirmationRows(mt.confirmations)) {
    if (c.parent !== null) confirmed.add(c.parent)
    const row = c.parent === null ? undefined : family.get(c.parent)
    if (c.parent === null) unmatched.push({ confirmation: c.name, reason: 'noParent', parent: null })
    else if (!row) unmatched.push({ confirmation: c.name, reason: 'notInFamily', parent: c.parent })
    else if (!isRecorded(c.p)) unmatched.push({ confirmation: c.name, reason: 'noP', parent: c.parent })
    else {
      points.push({
        confirmation: c.name,
        parent: row.name,
        inSampleP: row.p,
        sealedP: c.p,
        ownAlpha: c.alpha,
        sealedBadge: c.badge,
        inSampleBadge: badges.get(row.name) ?? null,
        overlay: row.tag === 'overlay',
        window: c.label,
      })
    }
  }
  const untested = [...mt.rows].sort((a, b) => a.rank - b.rank).filter((r) => !confirmed.has(r.name)).map((r) => r.name)
  const ownAlphas = [...new Set(points.flatMap((p) => (p.ownAlpha === null ? [] : [p.ownAlpha])))].sort((a, b) => a - b)
  return { alpha: mt.alpha, k: mt.k, points, untested, unmatched, ownAlphas }
}

const glyphOf = (badge: Badge): PointGlyph => (badge === 'PASS' ? 'up' : badge === 'FAIL' ? 'down' : 'ring')

/** Keeps room for a value sitting exactly on a decade, as the chart's own log domain does. */
const LOG_EPS = 1e-9

/** The decade below the lowest value the log axis can show; undefined when there is none. */
function decadeBelow(values: readonly number[]): number | undefined {
  const shown = values.filter((v) => Number.isFinite(v) && v > 0)
  return shown.length === 0 ? undefined : Number(`1e${Math.floor(Math.log10(Math.min(...shown)) - LOG_EPS)}`)
}

function referenceLines(view: ReplicationView): GlyphRefLine[] {
  const bonferroni = view.alpha / view.k
  const candidates: GlyphRefLine[] = [
    { axis: 'x', value: view.alpha, label: fillCopy(R.alphaLine, { alpha: String(view.alpha) }), tone: 'data' },
    ...(view.k >= 1
      ? [{ axis: 'x', value: bonferroni, label: fillCopy(R.bonferroniLine, { value: formatP(bonferroni) }), tone: 'accent' } as const]
      : []),
    ...view.ownAlphas.map((a) => ({ axis: 'y', value: a, label: fillCopy(R.ownAlphaLine, { alpha: String(a) }), tone: 'data' }) as const),
  ]
  const seen = new Set<string>()
  return candidates.filter((l) => {
    const key = `${l.axis}:${l.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The pairs on reversed log p axes with the y = x diagonal and the alpha lines. Both axes share a floor a
 * decade under the lowest p or line, so a line the reader needs is never off the axes and no point is
 * pinned to an edge; a p the log axis cannot show is left out of the chart and counted (the table keeps it).
 */
export function replicationScatter(view: ReplicationView): GlyphScatterInput {
  const lines = referenceLines(view)
  const floor = decadeBelow([...view.points.flatMap((p) => [p.inSampleP, p.sealedP]), ...lines.map((l) => l.value)])
  const axis = { scale: 'log', inverse: true, format: 'p', ...(floor === undefined ? {} : { min: floor }) } as const
  const points: GlyphPoint[] = view.points.map((p) => ({
    label: fillCopy(R.pair, { parent: p.parent, confirmation: p.confirmation }),
    tag: p.parent,
    x: p.inSampleP,
    y: p.sealedP,
    glyph: glyphOf(p.sealedBadge),
    hollow: p.overlay,
    kind: badgeText(p.sealedBadge),
  }))
  return {
    name: R.title,
    x: { label: R.xAxis, ...axis },
    y: { label: R.yAxis, ...axis },
    points,
    lines,
    diagonal: R.diagonal,
  }
}

/** The hypotheses no sealed confirmation tests, or the line saying there are none. */
export function untestedLine(view: ReplicationView): string {
  if (view.untested.length === 0) return R.untestedNone
  return fillCopy(R.untested, { n: view.untested.length, names: view.untested.join(', ') })
}

/** The confirmations that could not be drawn, each with its reason; null when all were. */
export function unmatchedLine(view: ReplicationView): string | null {
  if (view.unmatched.length === 0) return null
  const items = view.unmatched.map((u) =>
    fillCopy(R.unmatchedItem, { name: u.confirmation, reason: fillCopy(R.reasons[u.reason], { parent: u.parent ?? '' }) }),
  )
  return fillCopy(R.unmatched, { n: items.length, items: items.join('; ') })
}
