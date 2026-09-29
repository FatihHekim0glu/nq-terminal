// Research bodies of the demo dataset. Two capture sources, each served whole and under its own names:
// - REG, MT, the hypothesis cards, the confirmations and SV3 are the API's answers on the real research files
//   (screens/reg/regFixtures.ts and deflatedFixtures.ts, 2026-09-27), the only RegistryView the web has;
// - the DES cards (HypothesisDetail) are the fixture backend's and real answers of GET /api/hypotheses/{name}
//   (screens/des/desTestData.ts). A name without a captured card answers the honest 404.
// The two hypotheses that have a screen file in the fixture backend (volmanaged_v0 and overnight_v0) carry it
// whole, so DES tab 5 Robustness has its evidence to read; every other card keeps the screen it was captured with.
// The sealed index is empty: the fixture tree has no results/sealed folder, so the fixture backend lists none.
import type { Schemas } from '../../api/types'
import { OVERNIGHT, REBAL, VOLMANAGED, ZA, ZA_C3 } from '../../screens/des/desTestData'
import { OVERNIGHT_SCREEN, VOLMANAGED_SCREEN } from '../../screens/des/robustness.fixtures'
import { DEFLATED_REAL } from '../../screens/reg/deflatedFixtures'
import { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY } from '../../screens/reg/regFixtures'

export { CONFIRMATIONS, HYPOTHESES, MULTIPLE_TESTING, REGISTRY }
export const DEFLATED: Schemas['DeflatedView'] = DEFLATED_REAL
export const SEALED_INDEX: Schemas['SealedItem'][] = []

type HypothesisDetail = Schemas['HypothesisDetail']

/**
 * The detail with a whole screen file in place of its captured stub, but only when the file is this card's own:
 * the file's `name` is the card's name and its `spec_sha256` is the card's spec sha. A file is never served under
 * another hypothesis, nor under the same name at another spec version; on any mismatch (or a file that records
 * no spec sha) the detail is returned as it is, stub and all, so the robustness tab says nothing is recorded
 * rather than showing another hypothesis's evidence.
 */
export function withScreen(detail: HypothesisDetail, screen: Readonly<Record<string, unknown>>): HypothesisDetail {
  const sameName = screen['name'] === detail.card.name
  const sameSpec = typeof screen['spec_sha256'] === 'string' && screen['spec_sha256'] === detail.card.spec_sha256
  return sameName && sameSpec ? { ...detail, screen } : detail
}

/** DES cards by the name each card carries, so a card is never served under another name. */
export const HYPOTHESIS_DETAILS: ReadonlyMap<string, HypothesisDetail> = new Map(
  [withScreen(OVERNIGHT, OVERNIGHT_SCREEN), withScreen(VOLMANAGED, VOLMANAGED_SCREEN), REBAL, ZA, ZA_C3].map((detail) => [detail.card.name, detail]),
)
