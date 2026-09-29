// The line under a ladder that carries recorded ts (N04): the [PRE-REG] or [POST HOC] tag of the result they came
// from (C7), what the t is, that no interval is drawn or computed (C8), and the card's gating statistic.
import { DES } from '../../copy/des'
import { LADDER_T } from '../../copy/ladderT'
import { fillCopy } from '../../copy/workspace'
import { formatNumber } from '../tear/tearFormat'
import type { HypothesisCard } from './desModel'
import { Tag } from './DesParts'

export interface LadderTNoteProps {
  readonly card: HypothesisCard
  /** The paragraph class of the screen it sits on: des-note on DES, books-note on COST and BLK. */
  readonly className: string
}

export function LadderTNote({ card, className }: LadderTNoteProps) {
  const t = card.t_stat
  const gating = typeof t === 'number' && Number.isFinite(t)
    ? ` ${fillCopy(LADDER_T.gating, { label: card.t_label ?? LADDER_T.gatingLabel, t: formatNumber(t, 2) })}`
    : ''
  return (
    <p className={className} data-testid="ladder-t-note">
      <Tag tag={card.registered ? DES.preReg : DES.postHoc} /> {LADDER_T.note}{gating}
    </p>
  )
}
