// REG's sub views (look spec 7.2, roadmap #5): the data each one needs, and the switch that draws it.
// RegViewBody's props carry everything the four views need (the effect map reads the same rows and SV3's
// deflated view), and useEvidenceData reads the family (alpha, k) from the same cache RegScreen already
// fills, so RegScreen itself needs no change when a view is added.
import { useMemo, type ReactNode } from 'react'
import { useDeflated, useMultipleTesting } from '../../api/queries'
import type { Schemas } from '../../api/types'
import { COST_BOARD, EVIDENCE_MAP } from '../../copy/evidence'
import { fillCopy } from '../../copy/workspace'
import CostBoard from './CostBoard'
import { buildCostBoard } from './costBoardModel'
import EvidenceMap from './EvidenceMap'
import { buildEvidenceMap } from './evidenceMapModel'
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
 *  itself, on the filtered `shown` rows. The evidence rows' power cells need the registered family
 *  (alpha and k): it is read here from the multiple-testing query RegScreen already holds (the same
 *  cache entry, so no second request), and stays null, with the cells empty, until it arrives. */
export function useEvidenceData(view: RegView, input: EvidenceDataInput): EvidenceData {
  const names = useMemo(() => (input.rows ?? []).map((r) => r.name), [input.rows])
  const details = useHypothesisDetails(names, needsDetails(view))
  const mt = useMultipleTesting()
  const alpha = mt.data?.alpha
  const k = mt.data?.k
  const family = useMemo(() => (alpha === undefined || k === undefined ? null : { alpha, k }), [alpha, k])
  const evidence = useMemo(() => {
    if (view !== 'evidence') return null
    return buildEvidenceRows({ rows: input.shown, cards: input.cards ?? [], confirmations: input.confirmations ?? [], deflated: input.deflated, details, family })
  }, [view, input.shown, input.cards, input.confirmations, input.deflated, details, family])
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
  // The effect map numbers its points by the rows the board shows (`rows`, served order) and needs SV3's
  // deflated view. The query is the one RegScreen holds (same key); it is read here only for its failure,
  // which RegScreen does not pass down, so the map says so instead of reading forever.
  const map = useMemo(() => (p.view === 'map' && p.deflated ? buildEvidenceMap(p.deflated, p.rows) : null), [p.view, p.deflated, p.rows])
  const deflated = useDeflated(p.view === 'map')
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
    case 'map':
      if (map) return <EvidenceMap panelId={p.panelId} map={map} />
      return deflated.isError ? (
        <p className="reg-msg down" role="alert">{fillCopy(EVIDENCE_MAP.failed, { detail: deflated.error.detail })}</p>
      ) : (
        <p className="reg-msg" role="status">{EVIDENCE_MAP.loading}</p>
      )
    case 'board':
    default:
      return p.board
  }
}
