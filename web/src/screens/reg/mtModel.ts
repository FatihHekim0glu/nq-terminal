// The pure parts of MT (UI_SPEC 7 "REG and MT", ANALYTICS_CATALOG SV4): the PScatter input from
// GET /api/multiple-testing, a check that the Bonferroni, Holm and BH lines the chart draws
// (pScatterModel.multipleTests) equal the API's lines at every rank, the table rows with the rules
// each p-value sits under, and the family line. Nothing here changes a verdict: the stored adjusted
// values are shown as the registry holds them.
import type { Schemas } from '../../api/types'
import { multipleTests, type Passes, type PScatterInput } from '../../charts/echarts/pScatterModel'
import { P_SCATTER } from '../../copy/echarts'
import { MT } from '../../copy/reg'
import { fillCopy } from '../../copy/workspace'

export type PScale = NonNullable<PScatterInput['scale']>

export function mtScatterInput(mt: Schemas['MultipleTesting'], scale: PScale): PScatterInput {
  return { name: MT.chartName, alpha: mt.alpha, points: mt.rows.map((r) => ({ label: r.name, p: r.p })), scale }
}

export interface BoundaryCheck {
  readonly ok: boolean
  readonly maxDiff: number
  /** The first hypothesis where the lines differ most, or null. */
  readonly worst: string | null
}

/** Relative tolerance for the line comparison: both sides are the same three quotients in doubles. */
const LINE_TOLERANCE = 1e-12

/**
 * The drawn boundaries against the API's: same names in the same rank order, and Bonferroni, Holm and
 * BH equal at every rank. Any mismatch (or a p-value the chart would refuse) fails.
 */
export function boundaryCheck(mt: Schemas['MultipleTesting']): BoundaryCheck {
  if (mt.rows.length === 0) return { ok: true, maxDiff: 0, worst: null }
  let drawn
  try {
    drawn = multipleTests(mt.rows.map((r) => ({ label: r.name, p: r.p })), mt.alpha)
  } catch {
    return { ok: false, maxDiff: Number.POSITIVE_INFINITY, worst: mt.rows[0]?.name ?? null }
  }
  let maxDiff = 0
  let worst: string | null = null
  mt.rows.forEach((r, i) => {
    const d = drawn[i]
    const diff = !d || d.label !== r.name || d.rank !== r.rank
      ? Number.POSITIVE_INFINITY
      : Math.max(Math.abs(d.bonferroni - r.bonferroni_line), Math.abs(d.holm - r.holm_line), Math.abs(d.bh - r.bh_line))
    if (diff > maxDiff) {
      maxDiff = diff
      worst = r.name
    }
  })
  return { ok: maxDiff <= LINE_TOLERANCE * mt.alpha, maxDiff, worst }
}

export interface MtRow {
  readonly name: string
  readonly rank: number
  readonly p: number
  readonly bonferroniLine: number
  readonly holmLine: number
  readonly bhLine: number
  readonly bonferroni: number | null
  readonly holm: number | null
  readonly bhQ: number | null
  readonly passes: Passes
}

const NO_PASS: Passes = { bonferroni: false, holm: false, bh: false }

export function buildMtRows(mt: Schemas['MultipleTesting']): MtRow[] {
  let passes = new Map<string, Passes>()
  try {
    passes = new Map(multipleTests(mt.rows.map((r) => ({ label: r.name, p: r.p })), mt.alpha).map((t) => [t.label, t.passes]))
  } catch {
    // A p-value out of range: boundaryCheck reports it; the table still shows the stored values.
  }
  return mt.rows.map((r) => ({
    name: r.name,
    rank: r.rank,
    p: r.p,
    bonferroniLine: r.bonferroni_line,
    holmLine: r.holm_line,
    bhLine: r.bh_line,
    bonferroni: r.bonferroni_p,
    holm: r.holm_p,
    bhQ: r.bh_q,
    passes: passes.get(r.name) ?? NO_PASS,
  }))
}

/** `Bonferroni, Holm, BH`, the rules whose line the p-value sits under, or `none`. */
export function passesText(passes: Passes): string {
  const rules: ReadonlyArray<readonly [boolean, string]> = [
    [passes.bonferroni, P_SCATTER.bonferroni],
    [passes.holm, P_SCATTER.holm],
    [passes.bh, P_SCATTER.bh],
  ]
  const names = rules.filter(([ok]) => ok).map(([, name]) => name)
  return names.length === 0 ? P_SCATTER.passesNone : names.join(', ')
}

const diffText = (d: number): string => (Number.isFinite(d) ? d.toExponential(1) : String(d))

export function familyLine(mt: Schemas['MultipleTesting']): string {
  const family = fillCopy(MT.family, { k: mt.k, alpha: String(mt.alpha) })
  const stored = fillCopy(mt.matches_registry ? MT.stored : MT.storedDiffer, { diff: diffText(mt.max_abs_diff) })
  return `${family} ${stored}`
}

export function linesLine(check: BoundaryCheck): string {
  return check.ok ? MT.linesOk : fillCopy(MT.linesDiffer, { diff: diffText(check.maxDiff), name: check.worst ?? '?' })
}
