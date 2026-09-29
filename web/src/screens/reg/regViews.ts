// REG's sub views (look spec 7.2, roadmap #5): 91) Board (today's grid, the default), 92) Evidence,
// 93) Cost survival and 94) Effect map. Pure so RegScreen and its tests share one source of what each
// view needs. Hidden inside HOME's REG cell (viewsShown): that panel stays the
// plain board it always was, with no sub tab strip.
import { HOME_PANEL_IDS } from '../layouts/layouts'

export type RegView = 'board' | 'evidence' | 'costs' | 'map'

/** The four views in tab order: 91) Board, 92) Evidence, 93) Cost survival, 94) Effect map. */
export const REG_VIEWS: readonly RegView[] = ['board', 'evidence', 'costs', 'map']

/** House numbering for REG's sub tab strip (look spec 4.4): 91) Board, 92) Evidence, ... */
export const REG_VIEW_START = 91

/** REG's sub views are hidden inside HOME's REG cell: that panel keeps its plain board, unchanged. */
export function viewsShown(panelId: string): boolean {
  return panelId !== HOME_PANEL_IDS.reg
}

/** Whether a view needs GET /api/hypotheses/{name} for every registry row (useHypothesisDetails). The
 *  Effect map reads only the registry rows and SV3's Deflated Sharpe, so it asks for no detail. */
export function needsDetails(view: RegView): boolean {
  return view === 'evidence' || view === 'costs'
}

/** Whether a view needs SV3's Deflated Sharpe: always outside a compact panel; in a compact panel
 *  only when the view itself shows the DSR column regardless of width (evidence keeps it, board drops it). */
export function needsDeflated(view: RegView, compact: boolean): boolean {
  return !compact || view !== 'board'
}
