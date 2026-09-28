// Research bodies of the demo dataset. Two capture sources, each served whole and under its own names:
// - REG, MT, the hypothesis cards, the confirmations and SV3 are the API's answers on the real research files
//   (screens/reg/regFixtures.ts and deflatedFixtures.ts, 2026-09-27), the only RegistryView the web has;
// - the DES cards (HypothesisDetail) are the fixture backend's and real answers of GET /api/hypotheses/{name}
//   (screens/des/desTestData.ts). A name without a captured card answers the honest 404.
// The sealed index is empty: the fixture tree has no results/sealed folder, so the fixture backend lists none.
import type { Schemas } from '../../api/types'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../../screens/des/desTestData'
import { DEFLATED_REAL } from '../../screens/reg/deflatedFixtures'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from '../../screens/reg/regFixtures'

export { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY }
export const DEFLATED: Schemas['DeflatedView'] = DEFLATED_REAL
export const SEALED_INDEX: Schemas['SealedItem'][] = []

/** DES cards by the name each card carries, so a card is never served under another name. */
export const HYPOTHESIS_DETAILS: ReadonlyMap<string, Schemas['HypothesisDetail']> = new Map(
  [OVERNIGHT, VOLMANAGED, REBAL, ZA, ZA_C3].map((detail) => [detail.card.name, detail]),
)
