// REG's sub views (look spec 7.2, roadmap #5): 91) Board (today's grid, the default) and slices to
// come (92) Evidence, later Cost survival and Effect map). Pure so RegScreen and its tests share one
// source of what each view needs. Hidden inside HOME's REG cell (viewsShown): that panel stays the
// plain board it always was, with no sub tab strip.
import { HOME_PANEL_IDS } from '../layouts/layouts'

export type RegView = 'board' | 'evidence' | 'costs' | 'map'

/** Slice 1 of 3: Board and Evidence only; later slices append Cost survival and Effect map. */
export const REG_VIEWS: readonly RegView[] = ['board', 'evidence']

/** House numbering for REG's sub tab strip (look spec 4.4): 91) Board, 92) Evidence, ... */
export const REG_VIEW_START = 91

/** REG's sub views are hidden inside HOME's REG cell: that panel keeps its plain board, unchanged. */
export function viewsShown(panelId: string): boolean {
  return panelId !== HOME_PANEL_IDS.reg
}

/** Whether a view needs GET /api/hypotheses/{name} for every registry row (useHypothesisDetails). */
export function needsDetails(view: RegView): boolean {
  return view === 'evidence' || view === 'costs'
}

/** Whether a view needs SV3's Deflated Sharpe: always outside a compact panel; in a compact panel
 *  only when the view itself shows the DSR column regardless of width (evidence keeps it, board drops it). */
export function needsDeflated(view: RegView, compact: boolean): boolean {
  return !compact || view !== 'board'
}
