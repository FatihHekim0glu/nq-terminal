// Page 3 of the DES tear sheet (ANALYTICS_CATALOG RL5 and EX4): the block bars and the cost ladder as the
// screen JSON recorded them, never recomputed, each a BarLadder (role="img", a summary and a table view)
// under its [PRE-REG] tag, unit and basis, with the break-even cost marked where it lies on the ladder.
import { BarLadder } from '../../charts/echarts/BarLadder'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { MISSING, blocksInput, breakEvenText, costInput, type HypothesisDetail } from './desModel'
import { DesCard, Tag } from './DesParts'
import { DES_NUMBERS } from './desNumbers'

export interface DesCostsProps {
  readonly detail: HypothesisDetail
}

export default function DesCosts({ detail }: DesCostsProps) {
  const { card, des } = detail
  const tag = card.registered ? DES.preReg : DES.postHoc
  const blocks = blocksInput(des, card.name)
  const cost = costInput(des, card.name)
  return (
    <div className="des-page des-ladders">
      <DesCard title={DES.cards.cost} n={DES_NUMBERS.costs}>
        <p className="des-note"><Tag tag={tag} /> {DES.basisLine}</p>
        <p className="des-note">{fillCopy(DES.unitLine, { unit: des.cost_ladder_unit ?? MISSING })}</p>
        <p className="des-note">{breakEvenText(des)}</p>
        {cost ? <div className="des-ladder"><BarLadder data={cost} chartId="des-cost" /></div> : <p className="des-note">{DES.ladderNone}</p>}
      </DesCard>
      <DesCard title={fillCopy(DES.blocksName, { name: card.name })}>
        <p className="des-note"><Tag tag={tag} /> {DES.basisLine}</p>
        <p className="des-note">{fillCopy(DES.unitLine, { unit: des.blocks_unit ?? MISSING })}</p>
        {blocks ? <div className="des-ladder"><BarLadder data={blocks} chartId="des-blocks" /></div> : <p className="des-note">{DES.blocksNone}</p>}
      </DesCard>
    </div>
  )
}
