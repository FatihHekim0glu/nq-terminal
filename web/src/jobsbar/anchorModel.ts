// Pure reading of an anchor comparison (rule 3): the API's verdict (IDENTICAL, DIFFERENT, NOT COMPARABLE) as the
// owner's words MATCH, MISMATCH or NOT COMPARABLE, and the first field that differs, in the fixed order trades, P&L,
// fees, Sharpe. Only an IDENTICAL verdict reads as MATCH: an unknown verdict from a newer server is never a match.
import type { Schemas } from '../api/types'
import { JOBS_BAR } from '../copy/jobsBar'
import { fillCopy } from '../copy/workspace'
import { formatRatio } from '../screens/runs/model'

export type AnchorPair = Schemas['AnchorComparison']
export type AnchorCheck = Schemas['AnchorCheck']
export type AnchorOutcome = 'match' | 'mismatch' | 'incomparable'
export type AnchorField = 'trades' | 'pnl' | 'fees' | 'sharpe'

export interface AnchorView {
  readonly outcome: AnchorOutcome
  /** MATCH, MISMATCH or NOT COMPARABLE. */
  readonly word: string
  readonly firstDifference: AnchorField | null
  /** What the word means, as a clause: the base it matched, the first difference, or why it cannot be compared. */
  readonly detail: string
  /** The whole sentence: `Anchor MATCH: ...`. */
  readonly text: string
}

const A = JOBS_BAR.anchor
const SHARPE_DECIMALS = 4

function firstDifference(pair: AnchorPair): AnchorField | null {
  if (!pair.n_trades_equal) return 'trades'
  if (!pair.pnl_total_equal) return 'pnl'
  if (!pair.fees_total_equal) return 'fees'
  return pair.sharpe_equal ? null : 'sharpe'
}

function fieldWords(field: AnchorField | null, pair: AnchorPair): string {
  if (field === null) return A.fields.unknown
  if (field === 'sharpe' && pair.sharpe_anchor !== null && pair.sharpe_base !== null) {
    return fillCopy(A.sharpeDetail, {
      anchor: formatRatio(pair.sharpe_anchor, SHARPE_DECIMALS),
      base: formatRatio(pair.sharpe_base, SHARPE_DECIMALS),
    })
  }
  return A.fields[field]
}

function build(outcome: AnchorOutcome, word: string, firstDifference: AnchorField | null, detail: string): AnchorView {
  return { outcome, word, firstDifference, detail, text: fillCopy(A.sentence, { word, detail }) }
}

export function anchorView(pair: AnchorPair): AnchorView {
  const base = pair.base ?? A.baseUnknown
  if (pair.verdict === 'IDENTICAL') return build('match', A.match, null, fillCopy(A.matchDetail, { base }))
  if (pair.verdict === 'DIFFERENT') {
    const field = firstDifference(pair)
    return build('mismatch', A.mismatch, field, fillCopy(A.mismatchDetail, { base, field: fieldWords(field, pair) }))
  }
  return build('incomparable', A.notComparable, null, pair.base_found ? A.unusable : A.noBase)
}

/** The exact check's first difference in words: a scalar by its name, a trade row field as `trades[i].key`. */
const CHECK_FIELDS: Readonly<Record<string, AnchorField>> = { n_trades: 'trades', pnl_total: 'pnl', fees_total: 'fees', sharpe: 'sharpe' }

function checkFieldWords(check: AnchorCheck, field: string | null): { readonly key: AnchorField | null; readonly words: string } {
  if (field === null) return { key: null, words: A.fields.unknown }
  const key = CHECK_FIELDS[field]
  if (key === undefined) return { key: field.startsWith('trades') ? 'trades' : null, words: fillCopy(A.tradeRow, { field }) }
  if (key !== 'sharpe') return { key, words: A.fields[key] }
  const sharpe = check.checks.find((c) => c.field === 'sharpe')
  const [mine, theirs] = [sharpe?.anchor, sharpe?.base]
  if (typeof mine !== 'number' || typeof theirs !== 'number') return { key, words: A.fields.sharpe }
  return { key, words: fillCopy(A.sharpeDetail, { anchor: formatRatio(mine, SHARPE_DECIMALS), base: formatRatio(theirs, SHARPE_DECIMALS) }) }
}

/** The exact comparison (GET /api/jobs/actions/anchors/{run_id}: every trade row, P&L, fees, Sharpe) as the owner's words.
 *  Only a MATCH verdict reads as MATCH; PENDING and anything unknown is never one. */
export function anchorCheckView(check: AnchorCheck): AnchorView {
  const base = check.base ?? A.baseUnknown
  if (check.verdict === 'MATCH') return build('match', A.match, null, fillCopy(A.matchDetail, { base }))
  if (check.verdict === 'MISMATCH') {
    const { key, words } = checkFieldWords(check, check.first_difference)
    return build('mismatch', A.mismatch, key, fillCopy(A.mismatchDetail, { base, field: words }))
  }
  return build('incomparable', A.notComparable, null, check.base_found ? A.unusable : A.noBase)
}
