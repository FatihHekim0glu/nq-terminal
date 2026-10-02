// The SV8 response (GET /api/analytics/spa; backend `nq_terminal/models/spa.py`) under the names the panel reads: the
// generated contract types, so a field the backend changes is a compile error here.
import type { Schemas } from '../../api/types'

export type SpaEffectiveMembers = Schemas['SpaEffectiveMembers']
export type SpaView = Schemas['SpaView']
export type SpaMember = Schemas['SpaMember']
export type SpaExcluded = Schemas['SpaExcluded']
export type SpaPValues = SpaView['pvalues']
export type SpaCritical = SpaView['critical_values']

/** The query state the panel reads: react-query's result narrowed to what it uses. */
export interface SpaQueryState {
  readonly isError: boolean
  readonly error: { readonly detail: string } | null
  readonly data: SpaView | undefined
}
