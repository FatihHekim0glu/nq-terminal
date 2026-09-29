// Page 3 of the DES tear sheet (ANALYTICS_CATALOG RL5 and EX4): the block bars and the cost ladder as the
// screen JSON recorded them, never recomputed, each a BarLadder (role="img", a summary and a table view)
// under its [PRE-REG] tag, unit and basis, with the break-even cost marked where it lies on the ladder. N04: where
// the screen file records a t beside a bar, it is printed with the bar (ladderT.ts); no interval is drawn.
import { useMemo } from 'react'
import { BarLadder } from '../../charts/echarts/BarLadder'
import { DES } from '../../copy/des'
import { fillCopy } from '../../copy/workspace'
import { MISSING, blocksInput, breakEvenText, costInput, type HypothesisDetail } from './desModel'
import { DesCard, Tag } from './DesParts'
import { DES_NUMBERS } from './desNumbers'
import { LadderTNote } from './LadderTNote'
import { withRecordedT } from './ladderT'

export interface DesCostsProps {
  readonly detail: HypothesisDetail
}

export default function DesCosts({ detail }: DesCostsProps) {
  const { card, des } = detail
  const tag = card.registered ? DES.preReg : DES.postHoc
  const blocks = useMemo(() => withRecordedT(blocksInput(des, card.name), detail.screen), [des, card.name, detail.screen])
  const cost = useMemo(() => withRecordedT(costInput(des, card.name), detail.screen), [des, card.name, detail.screen])
  return (
    <div className="des-page des-ladders">
      <DesCard title={DES.cards.cost} n={DES_NUMBERS.costs}>
        <p className="des-note"><Tag tag={tag} /> {DES.basisLine}</p>
        <p className="des-note">{fillCopy(DES.unitLine, { unit: des.cost_ladder_unit ?? MISSING })}</p>
        <p className="des-note">{breakEvenText(des)}</p>
        {cost.input ? <div className="des-ladder"><BarLadder data={cost.input} chartId="des-cost" /></div> : <p className="des-note">{DES.ladderNone}</p>}
        {cost.count > 0 ? <LadderTNote card={card} className="des-note" /> : null}
      </DesCard>
      <DesCard title={fillCopy(DES.blocksName, { name: card.name })}>
        <p className="des-note"><Tag tag={tag} /> {DES.basisLine}</p>
        <p className="des-note">{fillCopy(DES.unitLine, { unit: des.blocks_unit ?? MISSING })}</p>
        {blocks.input ? <div className="des-ladder"><BarLadder data={blocks.input} chartId="des-blocks" /></div> : <p className="des-note">{DES.blocksNone}</p>}
        {blocks.count > 0 ? <LadderTNote card={card} className="des-note" /> : null}
      </DesCard>
    </div>
  )
}
