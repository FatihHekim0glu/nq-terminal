// REG's evidence matrix (92) Evidence, look spec 7.2, roadmap #5): every registry row against its
// recorded evidence, joined from five GETs already on screen (registry, hypotheses, confirmations,
// SV3's deflated view) plus each row's own hypothesis detail (useHypothesisDetails). Every cell equals
// the field it names, except the two power cells (powerView, [POST HOC], computed in the browser); there is
// no score, no rank and no total, so the terminal adds no pass or fail.
import type { Schemas } from '../../api/types'
import { toCsv, type CsvValue } from '../../chrome/exportCsv'
import { EVIDENCE } from '../../copy/evidence'
import { verdictBadge, type DesExtract } from '../des/desModel'
import { powerView, type PowerFamily } from './powerModel'
import type { HypothesisDetails } from './useHypothesisDetails'
import type { Badge, RegRow, RowTag } from './regModel'

export interface BlocksCount {
  readonly positive: number
  readonly total: number
}

/** How many of a hypothesis's recorded blocks (RL5) are positive, out of how many are recorded at
 *  all: null when there is no unit (no block extract for this screen) or no finite block value. */
export function blocksCount(des: Pick<DesExtract, 'blocks_unit' | 'blocks'> | null | undefined): BlocksCount | null {
  if (!des || des.blocks_unit === null) return null
  const values = des.blocks.map((b) => b.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (values.length === 0) return null
  return { positive: values.filter((v) => v > 0).length, total: values.length }
}

export interface SealedRef {
  readonly name: string
  readonly badge: 'PASS' | 'FAIL' | 'CHECK'
}

export interface EvidenceRow {
  readonly name: string
  readonly registered: boolean
  readonly tag: RowTag
  readonly badge: Badge
  /** The card's own test statistic and its label (t_stat/t_label): plain, Newey-West or alpha t, as
   *  the result file names it. */
  readonly t: number | null
  readonly tLabel: string | null
  readonly holm: number | null
  readonly blocksPositive: number | null
  readonly blocksTotal: number | null
  readonly blocksUnit: string | null
  readonly breakEven: number | null
  readonly sealed: SealedRef | null
  /** SV3a's annualised Sharpe, years (n/periods) and DSR under V0; null when the name is not a
   *  registered trial in the deflated view. */
  readonly sharpe: number | null
  readonly years: number | null
  readonly dsr: number | null
  /** The smallest annual Sharpe a one-sided test at alpha / k detects with 80% power on this trial's
   *  track, and the served Sharpe over it (powerView; [POST HOC], approximate, computed in the browser).
   *  null when the name is not an SV3a trial, or the family (alpha, k) is not known yet. Optional so a
   *  row built before the family is read (and older fixtures) stay valid. */
  readonly mdeFamily?: number | null
  readonly mdeRatio?: number | null
  readonly detail: 'ok' | 'pending' | 'failed'
  readonly detailError: string | null
}

export interface BuildEvidenceInput {
  readonly rows: readonly RegRow[]
  readonly cards: readonly Schemas['HypothesisCard'][]
  readonly confirmations: readonly Schemas['Confirmation'][]
  readonly deflated: Schemas['DeflatedView'] | undefined
  readonly details: HypothesisDetails
  /** The registered family (alpha and k, GET /api/multiple-testing); without it the power cells are null. */
  readonly family?: PowerFamily | null
}

/** REG's evidence rows, in the served registry order (the same order 91) Board shows; W8's effect
 *  map reuses it for its marks). No score, rank or total column exists anywhere on this row. */
export function buildEvidenceRows(input: BuildEvidenceInput): EvidenceRow[] {
  const { rows, cards, confirmations, deflated, details, family } = input
  const byCard = new Map(cards.map((c) => [c.name, c]))
  const byDeflated = new Map((deflated?.rows ?? []).map((r) => [r.name, r]))
  const byPower = new Map(deflated && family ? powerView(deflated, family).rows.map((r) => [r.name, r]) : [])
  return rows.map((row): EvidenceRow => {
    const card = byCard.get(row.name)
    const detailBody = details.byName.get(row.name)
    const failedDetail = details.failed.get(row.name)
    const detail: EvidenceRow['detail'] = detailBody ? 'ok' : failedDetail !== undefined ? 'failed' : 'pending'
    const des = detailBody?.des ?? null
    const counts = blocksCount(des)
    const confirmation = confirmations.find((c) => c.parent === row.name)
    const dsrRow = byDeflated.get(row.name)
    const power = byPower.get(row.name)
    return {
      name: row.name,
      registered: row.registered,
      tag: row.tag,
      badge: row.badge,
      t: card?.t_stat ?? null,
      tLabel: card?.t_label ?? null,
      holm: row.holm,
      blocksPositive: counts?.positive ?? null,
      blocksTotal: counts?.total ?? null,
      blocksUnit: des?.blocks_unit ?? null,
      breakEven: des?.break_even_ticks_per_side ?? null,
      sealed: confirmation ? { name: confirmation.name, badge: verdictBadge(confirmation.verdict) } : null,
      sharpe: dsrRow?.annual_sharpe ?? null,
      years: dsrRow ? dsrRow.n / dsrRow.periods : null,
      dsr: dsrRow?.dsr_null ?? null,
      mdeFamily: power?.mdeFamily ?? null,
      mdeRatio: power?.ratio ?? null,
      detail,
      detailError: failedDetail ?? null,
    }
  })
}

export type DetailStatus =
  | { readonly kind: 'reading'; readonly n: number }
  | { readonly kind: 'failed'; readonly n: number; readonly name: string; readonly detail: string }
  | null

/** The one status line the evidence view shows: reading while anything is still pending, else the
 *  first failure (if any); never both, and never an alert (a missing detail is not the terminal's fault). */
export function detailStatus(rows: readonly EvidenceRow[]): DetailStatus {
  const pending = rows.filter((r) => r.detail === 'pending').length
  if (pending > 0) return { kind: 'reading', n: pending }
  const failed = rows.filter((r) => r.detail === 'failed')
  if (failed.length === 0) return null
  const first = failed[0]!
  return { kind: 'failed', n: failed.length, name: first.name, detail: first.detailError ?? '' }
}

/** The evidence rows as CSV, full precision (raw sealed name and badge, not their display text). */
export function evidenceCsv(rows: readonly EvidenceRow[]): string {
  const body: CsvValue[][] = rows.map((r) => [
    r.name, r.badge, r.t, r.tLabel, r.holm, r.blocksPositive, r.blocksTotal, r.blocksUnit, r.breakEven,
    r.sealed?.name ?? null, r.sealed?.badge ?? null, r.sharpe, r.years, r.dsr,
    r.mdeFamily ?? null, r.mdeRatio ?? null,
  ])
  return toCsv(EVIDENCE.csvHead, body)
}
