// REG's sub views (look spec 7.2, roadmap #5): the data each one needs, and the switch that draws it.
// RegViewBody's props already carry what slice 3 (the Effect map) will need, so RegScreen itself
// needs no further change once it lands.
import { useMemo, type ReactNode } from 'react'
import type { Schemas } from '../../api/types'
import { COST_BOARD } from '../../copy/evidence'
import CostBoard from './CostBoard'
import { buildCostBoard } from './costBoardModel'
import { buildEvidenceRows, type EvidenceRow } from './evidenceModel'
import { needsDetails, type RegView } from './regViews'
import RegEvidence from './RegEvidence'
import type { RegRow } from './regModel'
import { useHypothesisDetails, type HypothesisDetails } from './useHypothesisDetails'

export interface EvidenceDataInput {
  /** Every registry row, the served order: the fan-out for useHypothesisDetails is stable and never
   *  churns as the filters change. */
  readonly rows: readonly RegRow[] | null
  /** The rows the board's filters keep (still in served order): buildEvidenceRows is given these, so
   *  91) Board and 92) Evidence (and later 93) Cost survival, 94) Effect map) agree on what shows. */
  readonly shown: readonly RegRow[]
  readonly cards: readonly Schemas['HypothesisCard'][] | undefined
  readonly confirmations: readonly Schemas['Confirmation'][] | undefined
  readonly deflated: Schemas['DeflatedView'] | undefined
}

export interface EvidenceData {
  readonly details: HypothesisDetails
  readonly evidence: readonly EvidenceRow[] | null
}

/** Fans out useHypothesisDetails only while a view needs it, on every registered name (so the fan-out
 *  stays stable as the filters change), and builds the evidence rows only for the evidence view
 *  itself (later: also the cost survival view), on the filtered `shown` rows. */
export function useEvidenceData(view: RegView, input: EvidenceDataInput): EvidenceData {
  const names = useMemo(() => (input.rows ?? []).map((r) => r.name), [input.rows])
  const details = useHypothesisDetails(names, needsDetails(view))
  const evidence = useMemo(() => {
    if (view !== 'evidence') return null
    return buildEvidenceRows({ rows: input.shown, cards: input.cards ?? [], confirmations: input.confirmations ?? [], deflated: input.deflated, details })
  }, [view, input.shown, input.cards, input.confirmations, input.deflated, details])
  return { details, evidence }
}

export interface RegViewBodyProps {
  readonly view: RegView
  /** Today's board, unchanged: rendered as is when the view is 'board'. */
  readonly board: ReactNode
  readonly evidence: readonly EvidenceRow[] | null
  readonly width: number | null
  readonly panelId: string
  readonly rows: readonly RegRow[]
  readonly details: HypothesisDetails
  readonly deflated: Schemas['DeflatedView'] | undefined
}

export function RegViewBody(p: RegViewBodyProps): ReactNode {
  // Built only for 93) Cost survival itself: cheap and pure, but there is no reason to sort and scale
  // every tile while another view is showing.
  const costs = useMemo(() => (p.view === 'costs' ? buildCostBoard(p.rows, p.details) : null), [p.view, p.rows, p.details])
  switch (p.view) {
    case 'evidence':
      return <RegEvidence rows={p.evidence ?? []} width={p.width} />
    case 'costs':
      return costs ? (
        <>
          <p className="reg-msg reg-muted">{COST_BOARD.note}</p>
          <CostBoard panelId={p.panelId} view={costs} />
        </>
      ) : null
    case 'board':
    default:
      return p.board
  }
}
