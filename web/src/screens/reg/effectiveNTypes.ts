// The SV3b response under the names the panel reads: `DeflatedView.effective_n` of GET /api/analytics/deflated (backend
// `nq_terminal/models/neff.py`), taken from the generated contract so a field the backend changes is a compile error.
import type { Schemas } from '../../api/types'

export type EffectiveNServed = Schemas['EffectiveNView']
export type EffectiveNRefusal = Schemas['EffectiveNRefusal']
export type EffectiveNWindow = Schemas['EffectiveNWindow']
export type EffectiveNEstimate = Schemas['EffectiveNEstimate']
export type EffectiveNDsr = Schemas['EffectiveNDsr']
export type EstimateId = EffectiveNEstimate['id']

/** The SV3 view as the backend serves it: it carries SV3b as `effective_n`. */
export type DeflatedWithEffective = Schemas['DeflatedView']
