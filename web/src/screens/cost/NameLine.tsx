// The name line of COST, BLK and SEAL for a hypothesis (look spec 7.3): the name in cyan, the verdict
// badge, [OVERLAY] for a registered risk overlay, and [PRE-REG] or [POST HOC], all from the card.
import type { HypothesisCard } from '../des/desModel'
import { Tag, VerdictBadge } from '../des/DesParts'
import { DES } from '../../copy/des'

export function NameLine({ card }: { readonly card: HypothesisCard }) {
  return (
    <div className="books-head" data-testid="books-head">
      <h3 className="books-name">{card.name}</h3>
      <VerdictBadge badge={card.verdict_badge} />
      {card.tag === 'overlay' ? <Tag tag={DES.overlay} /> : null}
      <Tag tag={card.registered ? DES.preReg : DES.postHoc} />
    </div>
  )
}
