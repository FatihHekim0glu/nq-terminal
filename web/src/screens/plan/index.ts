// PLAN (research_ux.md item 2): the pre-registration planner. A screen with no context and no data read; it asks
// GET /api/analytics/plan. The merge step registers the mnemonic (commands/registry.ts, constants.MNEMONICS,
// copy/commands.ts) and the lazy screen in chrome/WorkspaceScreens.tsx.
import { PLAN } from '../../copy/plan'

export { default as PlanScreen } from './PlanScreen'
export const PLAN_SCREEN = { code: 'PLAN', title: PLAN.title, accepts: [] } as const
