// SEAS response types: aliases of the generated contract (src/api/schema.d.ts, from backend/nq_terminal/
// models/seasonality.py through contract/openapi.json), plus the screen's own request state.
import type { Schemas } from '../../api/types'

export type Seasonality = Schemas['Seasonality']
export type SeasonPanel = Schemas['SeasonPanel']
export type SeasonBucket = Schemas['SeasonBucket']
export type SeasonHeatmap = Schemas['SeasonHeatmap']
export type SeasPanelId = SeasonPanel['id']

export type SeasVariant = 'vendor' | 'repaired'

export interface SeasQuery {
  readonly kind: 'instrument' | 'hypothesis'
  /** A universe root (NQ) or a hypothesis name. */
  readonly subject: string
  readonly startYear: number
  readonly endYear: number
  /** Instruments only; null asks for the API's default (repaired when it exists). */
  readonly variant: SeasVariant | null
  /** Hypotheses only: ticks per side. */
  readonly cost: number
}
